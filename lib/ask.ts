/**
 * Telegram ask-user-question tool
 * Zones: telegram outbound, assistant interaction, callback routing
 * Owns the telegram_ask tool: renders structured questions as inline buttons,
 * blocks on the user's tap, and resolves the tapped option back as the tool result.
 */

import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";

import type { ExtensionAPI } from "./pi.ts";
import {
  type TelegramInlineKeyboardButton,
  type TelegramInlineKeyboardMarkup,
  assertTelegramCallbackData,
} from "./keyboard.ts";

const TELEGRAM_ASK_CALLBACK_PREFIX = "tgask";
const TELEGRAM_ASK_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const TELEGRAM_ASK_MAX_QUESTIONS = 4;
const TELEGRAM_ASK_MAX_OPTIONS = 8;

export interface TelegramAskOption {
  label: string;
  /** Optional value returned to the tool; defaults to the label. */
  value?: string;
}

export interface TelegramAskQuestion {
  question: string;
  header?: string;
  options: TelegramAskOption[];
}

export interface TelegramAskAnswer {
  question: string;
  header?: string;
  /** The label of the option the user tapped. */
  label: string;
  /** The value of the option the user tapped (label when no explicit value). */
  value: string;
}

export type TelegramAskReplyMarkup = TelegramInlineKeyboardMarkup;

/** A single question rendered for delivery, with a per-option callback token. */
export interface TelegramAskRenderedQuestion {
  question: string;
  header?: string;
  markdown: string;
  replyMarkup: TelegramAskReplyMarkup;
}

interface PendingTelegramAskQuestion {
  askId: string;
  question: TelegramAskQuestion;
  /** callback token -> resolved option */
  tokens: Map<string, TelegramAskOption>;
  resolve: (answer: TelegramAskAnswer) => void;
}

export interface TelegramAskCallbackResolution {
  askId: string;
  answer: TelegramAskAnswer;
}

export interface TelegramAskRuntime {
  /**
   * Register a question and obtain its rendered inline-button payload plus a
   * promise that resolves when the user taps one of the options (or rejects on
   * timeout / cancellation).
   */
  register(question: TelegramAskQuestion): {
    askId: string;
    rendered: TelegramAskRenderedQuestion;
    wait: () => Promise<TelegramAskAnswer>;
  };
  /**
   * Resolve a callback tap. Returns the resolution when the callback_data
   * belonged to a pending ask question, otherwise undefined (so the caller can
   * fall through to other callback handlers).
   */
  resolveCallback(
    callbackData: string | undefined,
  ): TelegramAskCallbackResolution | undefined;
  /** True when callbackData targets an ask question (even if already expired). */
  ownsCallback(callbackData: string | undefined): boolean;
  /** Number of questions awaiting an answer (for diagnostics/tests). */
  pendingCount(): number;
}

export function isTelegramAskCallbackData(
  callbackData: string | undefined,
): boolean {
  return (
    typeof callbackData === "string" &&
    callbackData.startsWith(`${TELEGRAM_ASK_CALLBACK_PREFIX}:`)
  );
}

function normalizeAskOption(option: TelegramAskOption): TelegramAskOption {
  const label = option.label.trim();
  const value =
    typeof option.value === "string" && option.value.length > 0
      ? option.value
      : label;
  return { label, value };
}

function buildAskKeyboard(
  askId: string,
  options: TelegramAskOption[],
  tokens: Map<string, TelegramAskOption>,
): TelegramAskReplyMarkup {
  const rows: TelegramInlineKeyboardButton[][] = [];
  options.forEach((option, index) => {
    const callbackData = `${TELEGRAM_ASK_CALLBACK_PREFIX}:${askId}:${index}`;
    assertTelegramCallbackData(callbackData, "telegram_ask callback_data");
    tokens.set(callbackData, option);
    rows.push([{ text: option.label, callback_data: callbackData }]);
  });
  return { inline_keyboard: rows };
}

function renderAskMarkdown(question: TelegramAskQuestion): string {
  const header = question.header?.trim();
  const prompt = question.question.trim();
  return header ? `*${header}*\n${prompt}` : prompt;
}

export interface CreateTelegramAskRuntimeOptions {
  /** Override the pending-answer timeout (ms). Defaults to 30 minutes. */
  timeoutMs?: number;
  /** Injectable timer for tests. */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  /** Injectable id generator for deterministic tests. */
  generateId?: () => string;
}

export function createTelegramAskRuntime(
  options: CreateTelegramAskRuntimeOptions = {},
): TelegramAskRuntime {
  const timeoutMs = options.timeoutMs ?? TELEGRAM_ASK_DEFAULT_TIMEOUT_MS;
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const generateId =
    options.generateId ?? (() => randomUUID().replace(/-/g, "").slice(0, 10));
  const pending = new Map<string, PendingTelegramAskQuestion>();

  const finalize = (askId: string): PendingTelegramAskQuestion | undefined => {
    const entry = pending.get(askId);
    if (entry) pending.delete(askId);
    return entry;
  };

  return {
    register(question) {
      const normalizedOptions = question.options.map(normalizeAskOption);
      const askId = generateId();
      const tokens = new Map<string, TelegramAskOption>();
      const replyMarkup = buildAskKeyboard(askId, normalizedOptions, tokens);

      let resolveFn!: (answer: TelegramAskAnswer) => void;
      let rejectFn!: (error: Error) => void;
      const promise = new Promise<TelegramAskAnswer>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
      });

      pending.set(askId, {
        askId,
        question: { ...question, options: normalizedOptions },
        tokens,
        resolve: resolveFn,
      });

      const timer = setTimer(() => {
        if (finalize(askId)) {
          rejectFn(
            new Error(
              `Telegram question timed out after ${Math.round(timeoutMs / 1000)}s with no answer.`,
            ),
          );
        }
      }, timeoutMs);

      const rendered: TelegramAskRenderedQuestion = {
        question: question.question,
        ...(question.header ? { header: question.header } : {}),
        markdown: renderAskMarkdown(question),
        replyMarkup,
      };

      return {
        askId,
        rendered,
        wait: () =>
          promise.finally(() => {
            clearTimer(timer);
          }),
      };
    },

    resolveCallback(callbackData) {
      if (!isTelegramAskCallbackData(callbackData)) return undefined;
      // Format: tgask:<askId>:<index>
      const parts = (callbackData as string).split(":");
      const askId = parts[1];
      if (!askId) return undefined;
      const entry = pending.get(askId);
      if (!entry) return undefined;
      const option = entry.tokens.get(callbackData as string);
      if (!option) return undefined;
      finalize(askId);
      const answer: TelegramAskAnswer = {
        question: entry.question.question,
        ...(entry.question.header ? { header: entry.question.header } : {}),
        label: option.label,
        value: option.value ?? option.label,
      };
      entry.resolve(answer);
      return { askId, answer };
    },

    ownsCallback(callbackData) {
      return isTelegramAskCallbackData(callbackData);
    },

    pendingCount() {
      return pending.size;
    },
  };
}

export interface TelegramAskToolSendDeps {
  /**
   * Send a single interactive question to Telegram. Returns the message id
   * (or undefined). Mirrors the bridge sendInteractiveMessage contract.
   */
  sendQuestion: (
    markdown: string,
    replyMarkup: TelegramAskReplyMarkup,
  ) => Promise<number | undefined>;
}

export interface TelegramAskToolRegistrationDeps {
  askRuntime: Pick<TelegramAskRuntime, "register">;
  /** Whether a Telegram delivery target is currently reachable. */
  canSendDirect: () => boolean;
  /** Resolve the send transport for the current default/active target. */
  getSender: () => TelegramAskToolSendDeps | undefined;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

export function registerTelegramAskTool(
  pi: ExtensionAPI,
  deps: TelegramAskToolRegistrationDeps,
): void {
  pi.registerTool({
    name: "telegram_ask",
    label: "Telegram Ask",
    description:
      "Ask the user one or more multiple-choice questions on Telegram, rendered as inline buttons, and wait for the tapped answer. Use this instead of ask_user_question when the current turn is a Telegram turn.",
    promptSnippet:
      "Ask the user a multiple-choice question on Telegram with inline buttons and return the tapped option.",
    promptGuidelines: [
      "On a [telegram] turn, prefer telegram_ask over ask_user_question so the choices render as native inline buttons.",
      "Each question needs 2-8 concise options; the tool blocks until the user taps a button and returns the chosen label/value.",
      "Keep option labels short (they must fit Telegram inline buttons and the 64-byte callback limit is handled automatically).",
    ],
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String({
            description: "The question text shown to the user.",
          }),
          header: Type.Optional(
            Type.String({
              description: "Short bold header shown above the question.",
            }),
          ),
          options: Type.Array(
            Type.Object({
              label: Type.String({
                description: "Button label shown to the user.",
              }),
              value: Type.Optional(
                Type.String({
                  description:
                    "Value returned when tapped; defaults to the label.",
                }),
              ),
            }),
            { minItems: 2, maxItems: TELEGRAM_ASK_MAX_OPTIONS },
          ),
        }),
        { minItems: 1, maxItems: TELEGRAM_ASK_MAX_QUESTIONS },
      ),
    }),
    async execute(_toolCallId, params) {
      if (!deps.canSendDirect()) {
        throw new Error(
          "telegram_ask requires an active Telegram delivery target. Use it on a Telegram turn or after /telegram-connect.",
        );
      }
      const sender = deps.getSender();
      if (!sender) {
        throw new Error(
          "telegram_ask could not resolve a Telegram send target.",
        );
      }

      const answers: TelegramAskAnswer[] = [];
      try {
        for (const question of params.questions) {
          const { rendered, wait } = deps.askRuntime.register({
            question: question.question,
            ...(question.header ? { header: question.header } : {}),
            options: question.options,
          });
          await sender.sendQuestion(rendered.markdown, rendered.replyMarkup);
          const answer = await wait();
          answers.push(answer);
        }
      } catch (error) {
        deps.recordRuntimeEvent?.("ask", error, {
          phase: "await-answer",
        });
        throw error;
      }

      const text = answers
        .map((answer) => {
          const header = answer.header ? `[${answer.header}] ` : "";
          return `${header}${answer.question}\n→ ${answer.value}`;
        })
        .join("\n\n");
      return {
        content: [{ type: "text", text }],
        details: { answers },
      };
    },
  });
}
