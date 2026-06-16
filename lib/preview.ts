/**
 * Telegram preview streaming helpers
 * Zones: telegram outbound, native rich markdown drafts
 * Owns safe draft preview selection, runtime updates, and preview finalization
 */

import { normalizeTelegramNativeMarkdown } from "./replies.ts";
import { stripTelegramCommentMarkupForPreview } from "./outbound.ts";
import { shouldSuppressPreviewForVoice } from "./voice.ts";

const TELEGRAM_PREVIEW_THROTTLE_MS = 0;
const TELEGRAM_DRAFT_ID_MAX = 2_147_483_647;
const TELEGRAM_DRAFT_PREVIEW_MAX_CHARS = 4096;

export type TelegramDraftSupport = "unknown" | "supported";

export interface TelegramPreviewState {
  mode: "draft";
  draftId?: number;
  pendingText: string;
  lastSentText: string;
}

export interface TelegramPreviewRuntimeState extends TelegramPreviewState {
  flushTimer?: ReturnType<typeof setTimeout>;
  flushPromise?: Promise<void>;
  flushRequested?: boolean;
}

export type TelegramPreviewReplyMarkup = unknown;

export interface TelegramPreviewRuntimeDeps<
  TReplyMarkup = TelegramPreviewReplyMarkup,
> {
  getState: () => TelegramPreviewRuntimeState | undefined;
  setState: (state: TelegramPreviewRuntimeState | undefined) => void;
  clearScheduledFlush: (state: TelegramPreviewRuntimeState) => void;
  maxMessageLength: number;
  getDraftSupport: () => TelegramDraftSupport;
  setDraftSupport: (support: TelegramDraftSupport) => void;
  allocateDraftId: () => number;
  sendDraft: (
    chatId: number,
    draftId: number,
    text?: string,
    options?: {
      parse_mode?: string;
      entities?: unknown[];
      message_thread_id?: number;
    },
  ) => Promise<unknown>;
  canSend?: () => boolean;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

export interface TelegramPreviewActiveTurn {
  chatId: number;
  voiceReplyPreferred?: boolean;
  voiceReplyRequired?: boolean;
}

export interface TelegramAssistantMessagePreviewStartDeps<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
> {
  getActiveTurn: () => TelegramPreviewActiveTurn | undefined;
  isAssistantMessage: (message: TMessage) => boolean;
  getState: () => TelegramPreviewRuntimeState | undefined;
  setState: (state: TelegramPreviewRuntimeState | undefined) => void;
  createPreviewState: () => TelegramPreviewRuntimeState;
  finalizePreview: (chatId: number) => Promise<boolean>;
  finalizeMarkdownPreview: (
    chatId: number,
    markdown: string,
    replyToMessageId?: number,
    options?: { replyMarkup?: TReplyMarkup },
  ) => Promise<boolean>;
}

export interface TelegramAssistantMessagePreviewUpdateDeps<TMessage> {
  getActiveTurn: () => TelegramPreviewActiveTurn | undefined;
  isAssistantMessage: (message: TMessage) => boolean;
  getState: () => TelegramPreviewRuntimeState | undefined;
  setState: (state: TelegramPreviewRuntimeState | undefined) => void;
  createPreviewState: () => TelegramPreviewRuntimeState;
  getMessageText: (message: TMessage) => string;
  schedulePreviewFlush: (chatId: number) => void;
}

export type TelegramAssistantMessagePreviewHookDeps<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
> = TelegramAssistantMessagePreviewStartDeps<TMessage, TReplyMarkup> &
  TelegramAssistantMessagePreviewUpdateDeps<TMessage>;

export interface TelegramAssistantMessagePreviewHookEvent<TMessage> {
  message: TMessage;
}

export interface TelegramAssistantMessagePreviewHooks<TMessage> {
  onMessageStart: (
    event: TelegramAssistantMessagePreviewHookEvent<TMessage>,
  ) => Promise<void>;
  onMessageUpdate: (
    event: TelegramAssistantMessagePreviewHookEvent<TMessage>,
  ) => Promise<void>;
}

export interface TelegramPreviewControllerDeps<
  TReplyMarkup = TelegramPreviewReplyMarkup,
> {
  getDefaultReplyToMessageId?: () => number | undefined;
  maxMessageLength?: number;
  initialDraftSupport?: TelegramDraftSupport;
  sendDraft: (
    chatId: number,
    draftId: number,
    text?: string,
    options?: {
      parse_mode?: string;
      entities?: unknown[];
      message_thread_id?: number;
    },
  ) => Promise<unknown>;
  canSend?: () => boolean;
  throttleMs?: number;
  maxDraftId?: number;
  setTimer?: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

export interface TelegramPreviewController<
  TReplyMarkup = TelegramPreviewReplyMarkup,
> {
  getState: () => TelegramPreviewRuntimeState | undefined;
  setState: (state: TelegramPreviewRuntimeState | undefined) => void;
  setPendingText: (text: string) => void;
  createState: () => TelegramPreviewRuntimeState;
  resetState: () => void;
  clear: (chatId: number) => Promise<void>;
  flush: (chatId: number) => Promise<void>;
  scheduleFlush: (chatId: number) => void;
  finalize: (chatId: number, replyToMessageId?: number) => Promise<boolean>;
}

export type TelegramPreviewControllerRuntimeDeps<
  TReplyMarkup = TelegramPreviewReplyMarkup,
> = TelegramPreviewControllerDeps<TReplyMarkup>;

export function createTelegramPreviewControllerRuntime<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  deps: TelegramPreviewControllerRuntimeDeps<TReplyMarkup>,
): TelegramPreviewController<TReplyMarkup> {
  return createTelegramPreviewController({
    getDefaultReplyToMessageId: deps.getDefaultReplyToMessageId,
    maxMessageLength: deps.maxMessageLength,
    initialDraftSupport: deps.initialDraftSupport,
    sendDraft: deps.sendDraft,
    throttleMs: deps.throttleMs,
    maxDraftId: deps.maxDraftId,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    recordRuntimeEvent: deps.recordRuntimeEvent,
  });
}

export interface TelegramAssistantPreviewRuntimeDeps<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
> extends TelegramPreviewControllerRuntimeDeps<TReplyMarkup> {
  getActiveTurn: () => TelegramPreviewActiveTurn | undefined;
  isAssistantMessage: (message: TMessage) => boolean;
  getMessageText: (message: TMessage) => string;
  sendMarkdownReply: (
    chatId: number,
    replyToMessageId: number | undefined,
    markdown: string,
    options?: { replyMarkup?: TReplyMarkup },
  ) => Promise<number | undefined>;
}

export type TelegramAssistantPreviewRuntime<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
> = TelegramPreviewController<TReplyMarkup> &
  TelegramAssistantMessagePreviewHooks<TMessage> & {
    finalizeMarkdown: (
      chatId: number,
      markdown: string,
      replyToMessageId?: number,
      options?: { replyMarkup?: TReplyMarkup },
    ) => Promise<boolean>;
  };

export function createTelegramNativeMarkdownPreviewFinalizer<TReplyMarkup>(deps: {
  getState: () => TelegramPreviewRuntimeState | undefined;
  clear: (chatId: number) => Promise<void>;
  discard?: () => void;
  sendMarkdownReply: (
    chatId: number,
    replyToMessageId: number | undefined,
    markdown: string,
    options?: { replyMarkup?: TReplyMarkup },
  ) => Promise<number | undefined>;
}): (
  chatId: number,
  markdown: string,
  replyToMessageId?: number,
  options?: { replyMarkup?: TReplyMarkup },
) => Promise<boolean> {
  return async (chatId, markdown, replyToMessageId, options) => {
    const state = deps.getState();
    if (state?.flushPromise) {
      await state.flushPromise.catch(() => {});
    }
    await deps.sendMarkdownReply(chatId, replyToMessageId, markdown, options);
    deps.discard?.();
    return true;
  };
}

export function createTelegramAssistantPreviewRuntime<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  deps: TelegramAssistantPreviewRuntimeDeps<TMessage, TReplyMarkup>,
): TelegramAssistantPreviewRuntime<TMessage, TReplyMarkup> {
  const controller = createTelegramPreviewControllerRuntime(deps);
  const finalizeMarkdownPreview = createTelegramNativeMarkdownPreviewFinalizer({
    getState: controller.getState,
    clear: controller.clear,
    discard: () => controller.setState(undefined),
    sendMarkdownReply: deps.sendMarkdownReply,
  });
  return {
    ...controller,
    finalizeMarkdown: finalizeMarkdownPreview,
    ...createTelegramAssistantMessagePreviewHooks({
      getActiveTurn: deps.getActiveTurn,
      isAssistantMessage: deps.isAssistantMessage,
      getState: controller.getState,
      setState: controller.setState,
      createPreviewState: controller.createState,
      finalizePreview: controller.finalize,
      finalizeMarkdownPreview,
      getMessageText: deps.getMessageText,
      schedulePreviewFlush: controller.scheduleFlush,
    }),
  };
}

export function createTelegramPreviewController<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  deps: TelegramPreviewControllerDeps<TReplyMarkup>,
): TelegramPreviewController<TReplyMarkup> {
  let state: TelegramPreviewRuntimeState | undefined;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const setTimer =
    deps.setTimer ??
    ((callback: () => void, ms: number): ReturnType<typeof setTimeout> =>
      setTimeout(callback, ms));
  const throttleMs = deps.throttleMs ?? TELEGRAM_PREVIEW_THROTTLE_MS;
  const maxDraftId = deps.maxDraftId ?? TELEGRAM_DRAFT_ID_MAX;
  const maxMessageLength =
    deps.maxMessageLength ?? TELEGRAM_DRAFT_PREVIEW_MAX_CHARS;
  let draftSupport = deps.initialDraftSupport ?? "unknown";
  let nextDraftId = 0;
  const getRuntimeDeps = (): TelegramPreviewRuntimeDeps<TReplyMarkup> => ({
    getState: () => state,
    setState: (nextState) => {
      state = nextState;
    },
    clearScheduledFlush: (nextState) => {
      if (!nextState.flushTimer) return;
      clearTimer(nextState.flushTimer);
      nextState.flushTimer = undefined;
    },
    maxMessageLength,
    getDraftSupport: () => draftSupport,
    setDraftSupport: (support) => {
      draftSupport = support;
    },
    allocateDraftId: () => {
      nextDraftId = allocateTelegramDraftId(nextDraftId, maxDraftId);
      return nextDraftId;
    },
    sendDraft: deps.sendDraft,
    canSend: deps.canSend,
    recordRuntimeEvent: deps.recordRuntimeEvent,
  });
  return {
    getState: () => state,
    setState: (nextState) => {
      state = nextState;
    },
    setPendingText: (text) => {
      if (state) state.pendingText = text;
    },
    createState: () => createTelegramPreviewRuntimeState(draftSupport),
    resetState: () => {
      state = createTelegramPreviewRuntimeState(draftSupport);
    },
    clear: (chatId) => clearTelegramPreview(chatId, getRuntimeDeps()),
    flush: (chatId) => flushTelegramPreview(chatId, getRuntimeDeps()),
    scheduleFlush: (chatId) => {
      if (!state || state.flushTimer) return;
      if (throttleMs <= 0) {
        void flushTelegramPreview(chatId, getRuntimeDeps());
        return;
      }
      state.flushTimer = setTimer(() => {
        void flushTelegramPreview(chatId, getRuntimeDeps());
      }, throttleMs);
      state.flushTimer.unref?.();
    },
    finalize: (chatId, _replyToMessageId) =>
      finalizeTelegramPreview(chatId, getRuntimeDeps()),
  };
}

export function createTelegramAssistantMessagePreviewHooks<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  deps: TelegramAssistantMessagePreviewHookDeps<TMessage, TReplyMarkup>,
): TelegramAssistantMessagePreviewHooks<TMessage> {
  return {
    onMessageStart: async (
      event: TelegramAssistantMessagePreviewHookEvent<TMessage>,
    ): Promise<void> => {
      await handleTelegramAssistantMessagePreviewStart(event.message, deps);
    },
    onMessageUpdate: async (
      event: TelegramAssistantMessagePreviewHookEvent<TMessage>,
    ): Promise<void> => {
      await handleTelegramAssistantMessagePreviewUpdate(event.message, deps);
    },
  };
}

export async function handleTelegramAssistantMessagePreviewStart<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  message: TMessage,
  deps: TelegramAssistantMessagePreviewStartDeps<TMessage, TReplyMarkup>,
): Promise<void> {
  const turn = deps.getActiveTurn();
  if (!turn || !deps.isAssistantMessage(message)) return;
  if (shouldSuppressPreviewForVoice(turn)) {
    deps.setState(undefined);
    return;
  }
  const state = deps.getState();
  if (
    state &&
    (state.pendingText.trim().length > 0 ||
      state.lastSentText.trim().length > 0)
  ) {
    const previousText = state.pendingText.trim();
    if (previousText.length > 0) {
      await deps.finalizeMarkdownPreview(turn.chatId, previousText);
    } else {
      await deps.finalizePreview(turn.chatId);
    }
  }
  deps.setState(deps.createPreviewState());
}

export async function handleTelegramAssistantMessagePreviewUpdate<TMessage>(
  message: TMessage,
  deps: TelegramAssistantMessagePreviewUpdateDeps<TMessage>,
): Promise<void> {
  const turn = deps.getActiveTurn();
  if (!turn || !deps.isAssistantMessage(message)) return;
  if (shouldSuppressPreviewForVoice(turn)) return;
  let state = deps.getState();
  if (!state) {
    state = deps.createPreviewState();
    deps.setState(state);
  }
  state.pendingText = stripTelegramCommentMarkupForPreview(
    deps.getMessageText(message),
  );
  deps.schedulePreviewFlush(turn.chatId);
}

export function buildTelegramPreviewFinalText(
  state: TelegramPreviewState,
): string | undefined {
  const finalText = state.pendingText.trim();
  if (finalText) return finalText;
  return state.lastSentText.trim() || undefined;
}

export function createTelegramPreviewRuntimeState(
  draftSupport: TelegramDraftSupport,
): TelegramPreviewRuntimeState {
  return {
    mode: "draft",
    pendingText: "",
    lastSentText: "",
  };
}

export function allocateTelegramDraftId(
  currentDraftId: number,
  maxDraftId: number,
): number {
  return currentDraftId >= maxDraftId ? 1 : currentDraftId + 1;
}

interface TelegramNativeMarkdownPreviewSnapshot {
  text: string;
}

export function shouldUseTelegramDraftPreview(_options: {
  draftSupport: TelegramDraftSupport;
  snapshot?: TelegramNativeMarkdownPreviewSnapshot;
}): boolean {
  return true;
}

export async function clearTelegramPreview<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  chatId: number,
  deps: TelegramPreviewRuntimeDeps<TReplyMarkup>,
  options: { awaitFlush?: boolean } = {},
): Promise<void> {
  const state = deps.getState();
  if (!state) return;
  deps.clearScheduledFlush(state);
  if (state.flushPromise && options.awaitFlush !== false) {
    state.flushRequested = false;
    await state.flushPromise.catch(() => {});
    if (deps.getState() !== state) return;
  }
  deps.setState(undefined);
  if (state.mode === "draft" && state.draftId !== undefined) {
    try {
      await deps.sendDraft(chatId, state.draftId, undefined);
    } catch (error) {
      deps.recordRuntimeEvent?.("preview", error, {
        phase: "clear-draft",
        chatId,
        draftId: state.draftId,
      });
    }
  }
}

interface TelegramDraftInlineState {
  codeTicks: number;
  htmlComment: boolean;
  displayMath: boolean;
  fence?: { marker: "`" | "~"; length: number };
  strongAsterisk: boolean;
  emphasisAsterisk: boolean;
  strongUnderscore: boolean;
  emphasisUnderscore: boolean;
  strike: boolean;
  linkText: boolean;
  linkDestination: boolean;
}

function createTelegramDraftInlineState(): TelegramDraftInlineState {
  return {
    codeTicks: 0,
    htmlComment: false,
    displayMath: false,
    strongAsterisk: false,
    emphasisAsterisk: false,
    strongUnderscore: false,
    emphasisUnderscore: false,
    strike: false,
    linkText: false,
    linkDestination: false,
  };
}

function isTelegramDraftInlineStateClosed(state: TelegramDraftInlineState): boolean {
  return state.codeTicks === 0 &&
    !state.htmlComment &&
    !state.displayMath &&
    !state.fence &&
    !state.strongAsterisk &&
    !state.emphasisAsterisk &&
    !state.strongUnderscore &&
    !state.emphasisUnderscore &&
    !state.strike &&
    !state.linkText &&
    !state.linkDestination;
}

function countRepeatedChars(text: string, index: number, char: string): number {
  let count = 0;
  while (text[index + count] === char) count += 1;
  return count;
}

function isEscapedMarkdownChar(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isInlineDelimiterCandidate(text: string, index: number, length: number): boolean {
  const previous = text[index - 1] ?? "";
  const next = text[index + length] ?? "";
  if (!next || /\s/.test(next)) return previous.length > 0 && !/\s/.test(previous);
  if (!previous || /\s/.test(previous)) return true;
  return /[\p{P}\p{S}]/u.test(previous) || /[\p{P}\p{S}]/u.test(next);
}

function updateTelegramDraftInlineStateForLine(
  line: string,
  state: TelegramDraftInlineState,
): void {
  if (state.fence || state.displayMath) return;
  for (let index = 0; index < line.length; index += 1) {
    if (state.htmlComment) {
      const closeIndex = line.indexOf("-->", index);
      if (closeIndex === -1) return;
      state.htmlComment = false;
      index = closeIndex + 2;
      continue;
    }
    if (state.codeTicks > 0) {
      const ticks = countRepeatedChars(line, index, "`");
      if (ticks >= state.codeTicks) {
        state.codeTicks = 0;
        index += ticks - 1;
      }
      continue;
    }
    if (isEscapedMarkdownChar(line, index)) continue;
    if (line.startsWith("<!--", index)) {
      const closeIndex = line.indexOf("-->", index + 4);
      if (closeIndex === -1) {
        state.htmlComment = true;
        return;
      }
      index = closeIndex + 2;
      continue;
    }
    const ticks = countRepeatedChars(line, index, "`");
    if (ticks > 0) {
      state.codeTicks = ticks;
      index += ticks - 1;
      continue;
    }
    if (line.startsWith("][", index) || line.startsWith("](", index)) {
      state.linkText = false;
      state.linkDestination = true;
      index += 1;
      continue;
    }
    if (line[index] === "[" && !state.linkDestination) {
      state.linkText = true;
      continue;
    }
    if (line[index] === ")" && state.linkDestination) {
      state.linkDestination = false;
      continue;
    }
    if (line.startsWith("~~", index) && isInlineDelimiterCandidate(line, index, 2)) {
      state.strike = !state.strike;
      index += 1;
      continue;
    }
    if (line.startsWith("**", index) && isInlineDelimiterCandidate(line, index, 2)) {
      state.strongAsterisk = !state.strongAsterisk;
      index += 1;
      continue;
    }
    if (line[index] === "*" && isInlineDelimiterCandidate(line, index, 1)) {
      state.emphasisAsterisk = !state.emphasisAsterisk;
      continue;
    }
    if (line.startsWith("__", index) && isInlineDelimiterCandidate(line, index, 2)) {
      state.strongUnderscore = !state.strongUnderscore;
      index += 1;
      continue;
    }
    if (line[index] === "_" && isInlineDelimiterCandidate(line, index, 1)) {
      state.emphasisUnderscore = !state.emphasisUnderscore;
    }
  }
}

function updateTelegramDraftBlockStateForLine(
  line: string,
  state: TelegramDraftInlineState,
): boolean {
  const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (state.fence) {
    if (new RegExp(`^ {0,3}${state.fence.marker}{${state.fence.length},}\\s*$`).test(line)) {
      state.fence = undefined;
    }
    return true;
  }
  if (state.displayMath) {
    if (line.trim() === "$$") state.displayMath = false;
    return true;
  }
  if (fenceMatch) {
    const markerText = fenceMatch[1] ?? "```";
    state.fence = { marker: markerText[0] as "`" | "~", length: markerText.length };
    return true;
  }
  if (line.trim() === "$$") {
    state.displayMath = true;
    return true;
  }
  return false;
}

function findSafeTelegramRichMarkdownDraftEnd(markdown: string): number {
  const state = createTelegramDraftInlineState();
  let offset = 0;
  let safeEnd = 0;
  for (const line of markdown.split("\n")) {
    const lineEnd = offset + line.length;
    const consumedAsBlock = updateTelegramDraftBlockStateForLine(line, state);
    if (!consumedAsBlock) updateTelegramDraftInlineStateForLine(line, state);
    const nextOffset = lineEnd + 1;
    if (isTelegramDraftInlineStateClosed(state)) safeEnd = lineEnd;
    offset = nextOffset;
  }
  if (isTelegramDraftInlineStateClosed(state)) return markdown.length;
  return safeEnd;
}

export function getSafeTelegramRichMarkdownDraftPrefix(
  markdown: string,
  maxMessageLength: number,
): string | undefined {
  const source = markdown.trim();
  if (!source) return undefined;
  const limited = source.length > maxMessageLength
    ? source.slice(0, maxMessageLength)
    : source;
  const safeEnd = findSafeTelegramRichMarkdownDraftEnd(limited);
  if (safeEnd > 0) return limited.slice(0, safeEnd).trimEnd() || undefined;
  let candidateEnd = limited.length;
  while (candidateEnd > 0) {
    candidateEnd = limited.lastIndexOf(" ", candidateEnd - 1);
    if (candidateEnd <= 0) return undefined;
    const candidate = limited.slice(0, candidateEnd).trimEnd();
    if (findSafeTelegramRichMarkdownDraftEnd(candidate) === candidate.length) {
      return candidate || undefined;
    }
  }
  return undefined;
}

function buildTelegramNativeMarkdownPreviewSnapshot(
  state: TelegramPreviewState,
  maxMessageLength: number,
): TelegramNativeMarkdownPreviewSnapshot | undefined {
  const safeText = getSafeTelegramRichMarkdownDraftPrefix(
    state.pendingText,
    maxMessageLength,
  );
  if (!safeText || safeText === state.lastSentText) return undefined;
  return { text: safeText };
}

async function performTelegramPreviewFlush<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  chatId: number,
  state: TelegramPreviewRuntimeState,
  deps: TelegramPreviewRuntimeDeps<TReplyMarkup>,
): Promise<void> {
  if (deps.canSend && !deps.canSend()) {
    await clearTelegramPreview(chatId, deps, { awaitFlush: false });
    return;
  }
  const snapshot = buildTelegramNativeMarkdownPreviewSnapshot(
    state,
    deps.maxMessageLength,
  );
  if (!snapshot) return;
  if (
    shouldUseTelegramDraftPreview({
      draftSupport: deps.getDraftSupport(),
      snapshot,
    })
  ) {
    const draftId = state.draftId ?? deps.allocateDraftId();
    state.draftId = draftId;
    try {
      await deps.sendDraft(
        chatId,
        draftId,
        normalizeTelegramNativeMarkdown(snapshot.text),
      );
      deps.setDraftSupport("supported");
      state.mode = "draft";
      state.lastSentText = snapshot.text;
      return;
    } catch (error) {
      deps.recordRuntimeEvent?.("preview", error, {
        phase: "draft",
        chatId,
        draftId,
      });
      return;
    }
  }
}

export async function flushTelegramPreview<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  chatId: number,
  deps: TelegramPreviewRuntimeDeps<TReplyMarkup>,
): Promise<void> {
  const state = deps.getState();
  if (!state) return;
  if (state.flushPromise) {
    state.flushRequested = true;
    await state.flushPromise;
    return;
  }
  state.flushTimer = undefined;
  state.flushPromise = (async () => {
    do {
      state.flushRequested = false;
      try {
        await performTelegramPreviewFlush(chatId, state, deps);
      } catch (error) {
        deps.recordRuntimeEvent?.("preview", error, {
          phase: "flush",
          chatId,
          draftId: state.draftId,
        });
        break;
      }
    } while (deps.getState() === state && state.flushRequested);
  })();
  try {
    await state.flushPromise;
  } finally {
    if (deps.getState() === state) {
      state.flushPromise = undefined;
    }
  }
}

export async function finalizeTelegramPreview<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  chatId: number,
  deps: TelegramPreviewRuntimeDeps<TReplyMarkup>,
): Promise<boolean> {
  const state = deps.getState();
  if (!state) return false;
  if (deps.canSend && !deps.canSend()) {
    await clearTelegramPreview(chatId, deps);
    return false;
  }
  await flushTelegramPreview(chatId, deps);
  const finalText = buildTelegramPreviewFinalText(state);
  if (!finalText) {
    await clearTelegramPreview(chatId, deps);
    return false;
  }
  deps.setState(undefined);
  return false;
}
