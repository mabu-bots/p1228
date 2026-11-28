// ==========================================
// 🧪 読み上げキューのテスト
// ==========================================
import assert from "node:assert/strict";
import { test } from "node:test";
import { SPEECH_QUEUE_LIMIT, SpeechQueue, type SpeechQueueItem } from "../src/readaloud/queue.js";

function item(text: string): SpeechQueueItem {
  return { text };
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("items are processed serially in FIFO order", async () => {
  const started: string[] = [];
  const finished: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const queue = new SpeechQueue({
    processItem: async (current) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      started.push(current.text);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      finished.push(current.text);
    },
  });
  queue.enqueue(item("one"));
  queue.enqueue(item("two"));
  queue.enqueue(item("three"));
  await waitFor(() => finished.length === 3);
  assert.deepEqual(started, ["one", "two", "three"]);
  assert.deepEqual(finished, ["one", "two", "three"]);
  assert.equal(maxRunning, 1);
  assert.equal(queue.size, 0);
});

test("enqueue beyond the limit throws the parity error message", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let processed = 0;
  const queue = new SpeechQueue({
    processItem: async () => {
      processed += 1;
      await gate;
    },
  });
  queue.enqueue(item("first"));
  for (let i = 0; i < SPEECH_QUEUE_LIMIT; i += 1) queue.enqueue(item(`queued-${i}`));
  assert.equal(queue.size, SPEECH_QUEUE_LIMIT);
  assert.throws(() => queue.enqueue(item("overflow")), /読み上げキューが上限（50件）に達しています。/);
  release();
  await waitFor(() => processed === SPEECH_QUEUE_LIMIT + 1);
});

test("a failing item does not stop the queue", async () => {
  const finished: string[] = [];
  const errors: string[] = [];
  const queue = new SpeechQueue({
    processItem: async (current) => {
      if (current.text === "bad") throw new Error("synthesis failed");
      finished.push(current.text);
    },
    onItemError: (error, current) => {
      errors.push(`${current.text}:${error instanceof Error ? error.message : String(error)}`);
    },
  });
  queue.enqueue(item("ok-1"));
  queue.enqueue(item("bad"));
  queue.enqueue(item("ok-2"));
  await waitFor(() => finished.length === 2 && errors.length === 1);
  assert.deepEqual(finished, ["ok-1", "ok-2"]);
  assert.deepEqual(errors, ["bad:synthesis failed"]);
});

test("clear drops waiting items but lets the current one finish", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished: string[] = [];
  const queue = new SpeechQueue({
    processItem: async (current) => {
      if (current.text === "current") await gate;
      finished.push(current.text);
    },
  });
  queue.enqueue(item("current"));
  queue.enqueue(item("waiting-1"));
  queue.enqueue(item("waiting-2"));
  queue.clear();
  assert.equal(queue.size, 0);
  release();
  await waitFor(() => finished.length === 1);
  assert.deepEqual(finished, ["current"]);
});

test("pump stops when the session is no longer active", async () => {
  let active = true;
  const finished: string[] = [];
  const queue = new SpeechQueue({
    processItem: async (current) => {
      finished.push(current.text);
      active = false;
    },
    isActive: () => active,
  });
  queue.enqueue(item("one"));
  queue.enqueue(item("two"));
  await waitFor(() => finished.length === 1);
  // Give the pump a chance to (not) continue.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(finished, ["one"]);
});
