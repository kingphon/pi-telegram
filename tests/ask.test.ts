/**
 * Regression tests for the Telegram ask-user-question tool
 * Exercises the pending-question registry, inline-button rendering, callback
 * resolution, timeout handling, and the telegram_ask tool execute flow.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createTelegramAskRuntime,
  isTelegramAskCallbackData,
  registerTelegramAskTool,
  type TelegramAskReplyMarkup,
} from "../lib/ask.ts";

function makeDeterministicRuntime() {
  let counter = 0;
  const timers: Array<{ cb: () => void; ms: number; fired: boolean }> = [];
  const runtime = createTelegramAskRuntime({
    timeoutMs: 1000,
    generateId: () => `id${++counter}`,
    setTimer: (cb, ms) => {
      const timer = { cb, ms, fired: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { fired: boolean }).fired = true;
    },
  });
  return { runtime, timers };
}

test("register renders one inline button per option with ask-scoped callback data", () => {
  const { runtime } = makeDeterministicRuntime();
  const { askId, rendered } = runtime.register({
    question: "Pick a color?",
    header: "Color",
    options: [{ label: "Red" }, { label: "Blue", value: "blue-value" }],
  });

  assert.equal(askId, "id1");
  assert.equal(rendered.markdown, "*Color*\nPick a color?");
  assert.deepEqual(rendered.replyMarkup, {
    inline_keyboard: [
      [{ text: "Red", callback_data: "tgask:id1:0" }],
      [{ text: "Blue", callback_data: "tgask:id1:1" }],
    ],
  } satisfies TelegramAskReplyMarkup);
  assert.equal(runtime.pendingCount(), 1);
});

test("resolveCallback resolves the waiting promise with the tapped option value", async () => {
  const { runtime } = makeDeterministicRuntime();
  const { rendered, wait } = runtime.register({
    question: "Continue?",
    options: [{ label: "Yes" }, { label: "No" }],
  });

  const tapped = rendered.replyMarkup.inline_keyboard[1][0].callback_data;
  const resolution = runtime.resolveCallback(tapped);

  assert.ok(resolution);
  assert.equal(resolution?.answer.label, "No");
  assert.equal(resolution?.answer.value, "No");
  assert.equal(resolution?.answer.question, "Continue?");
  assert.equal(runtime.pendingCount(), 0);

  const answer = await wait();
  assert.equal(answer.value, "No");
});

test("resolveCallback returns undefined for foreign or expired callback data", () => {
  const { runtime } = makeDeterministicRuntime();
  runtime.register({
    question: "Q?",
    options: [{ label: "A" }, { label: "B" }],
  });

  // Foreign prefix (belongs to the follow-up-prompt button flow, not ask).
  assert.equal(runtime.resolveCallback("tgbtn:whatever"), undefined);
  // Unknown ask id.
  assert.equal(runtime.resolveCallback("tgask:missing:0"), undefined);
  // Still owns anything with the ask prefix even when unresolved.
  assert.equal(runtime.ownsCallback("tgask:missing:0"), true);
  assert.equal(runtime.ownsCallback("tgbtn:x"), false);
});

test("isTelegramAskCallbackData discriminates ask callbacks", () => {
  assert.equal(isTelegramAskCallbackData("tgask:id:0"), true);
  assert.equal(isTelegramAskCallbackData("tgbtn:id"), false);
  assert.equal(isTelegramAskCallbackData(undefined), false);
});

test("pending question rejects on timeout", async () => {
  const { runtime, timers } = makeDeterministicRuntime();
  const { wait } = runtime.register({
    question: "Slow?",
    options: [{ label: "A" }, { label: "B" }],
  });

  assert.equal(timers.length, 1);
  // Fire the timeout timer.
  timers[0].cb();
  assert.equal(runtime.pendingCount(), 0);

  await assert.rejects(wait(), /timed out/);
});

test("telegram_ask tool sends buttons, blocks, and returns the tapped answers", async () => {
  const { runtime } = makeDeterministicRuntime();
  const sent: Array<{ markdown: string; replyMarkup: TelegramAskReplyMarkup }> =
    [];
  let registeredExecute:
    | ((
        toolCallId: string,
        params: unknown,
      ) => Promise<{ content: { type: string; text: string }[] }>)
    | undefined;

  const fakePi = {
    registerTool(tool: {
      name: string;
      execute: (
        toolCallId: string,
        params: unknown,
      ) => Promise<{ content: { type: string; text: string }[] }>;
    }) {
      assert.equal(tool.name, "telegram_ask");
      registeredExecute = tool.execute;
    },
  };

  registerTelegramAskTool(fakePi as never, {
    askRuntime: runtime,
    canSendDirect: () => true,
    getSender: () => ({
      sendQuestion: async (markdown, replyMarkup) => {
        sent.push({ markdown, replyMarkup });
        // Simulate the user tapping the first option as soon as it is sent.
        const tapped = replyMarkup.inline_keyboard[0][0].callback_data;
        queueMicrotask(() => runtime.resolveCallback(tapped));
        return 123;
      },
    }),
  });

  assert.ok(registeredExecute);
  const result = await registeredExecute!("call-1", {
    questions: [
      {
        question: "Ship it?",
        header: "Deploy",
        options: [{ label: "Yes", value: "ship" }, { label: "No" }],
      },
    ],
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].markdown, "*Deploy*\nShip it?");
  assert.match(result.content[0].text, /Ship it\?/);
  assert.match(result.content[0].text, /ship/);
});

test("telegram_ask tool throws when no Telegram target is reachable", async () => {
  const { runtime } = makeDeterministicRuntime();
  let execute:
    | ((toolCallId: string, params: unknown) => Promise<unknown>)
    | undefined;
  const fakePi = {
    registerTool(tool: {
      execute: (toolCallId: string, params: unknown) => Promise<unknown>;
    }) {
      execute = tool.execute;
    },
  };

  registerTelegramAskTool(fakePi as never, {
    askRuntime: runtime,
    canSendDirect: () => false,
    getSender: () => undefined,
  });

  await assert.rejects(
    execute!("call-1", {
      questions: [
        { question: "Q?", options: [{ label: "A" }, { label: "B" }] },
      ],
    }),
    /requires an active Telegram delivery target/,
  );
});
