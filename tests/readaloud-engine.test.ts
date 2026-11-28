// ==========================================
// 🧪 VOICEVOX 連携と音声キャッシュのテスト
// ==========================================
// 🎙️ fetch をモックし、実サーバーには接続しない。
import assert from "node:assert/strict";
import { mkdtemp, readdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  AudioCache,
  AudioSynthesizer,
  VoicevoxEngine,
  isWav,
  type FetchFn,
} from "../src/readaloud/engine.js";

// 🧪 最小の WAV バイト列（44バイトのヘッダ＋中身）。
function fakeWav(payloadBytes = 56): Buffer {
  const audio = Buffer.alloc(44 + payloadBytes, 0);
  audio.write("RIFF", 0, "ascii");
  audio.write("WAVE", 8, "ascii");
  return audio;
}

interface RecordedCall {
  url: string;
  body?: string;
}

// 🧪 audio_query / synthesis を再現する fetch モック。
function mockFetch(calls: RecordedCall[], synthesisAudio: Buffer = fakeWav()): FetchFn {
  return (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    calls.push({ url, ...(init?.body ? { body: init.body } : {}) });
    if (url.includes("/audio_query")) {
      return new Response(JSON.stringify({ speedScale: 1, volumeScale: 1, kana: "テスト" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/synthesis")) {
      return new Response(new Uint8Array(synthesisAudio), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as FetchFn;
}

async function tempCacheDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "p1228-audio-cache-"));
}

test("isWav checks the RIFF/WAVE magic and minimum size", () => {
  assert.equal(isWav(fakeWav()), true);
  assert.equal(isWav(Buffer.alloc(100, 0)), false);
  assert.equal(isWav(Buffer.from("RIFF")), false);
});

test("synthesize runs audio_query then synthesis with speed/volume applied", async () => {
  const calls: RecordedCall[] = [];
  const engine = new VoicevoxEngine({ baseUrl: "http://voicevox.test:50021/", fetchFn: mockFetch(calls) });
  const audio = await engine.synthesize("こんにちは", 3, 1.4, 0.7);
  assert.equal(isWav(audio), true);
  assert.equal(calls.length, 2);
  const queryUrl = new URL(calls[0]?.url ?? "");
  assert.equal(queryUrl.pathname, "/audio_query");
  assert.equal(queryUrl.searchParams.get("text"), "こんにちは");
  assert.equal(queryUrl.searchParams.get("speaker"), "3");
  const synthesisUrl = new URL(calls[1]?.url ?? "");
  assert.equal(synthesisUrl.pathname, "/synthesis");
  const body = JSON.parse(calls[1]?.body ?? "{}") as Record<string, unknown>;
  assert.equal(body["speedScale"], 1.4);
  assert.equal(body["volumeScale"], 0.7);
});

test("synthesize clamps out-of-range speed and volume", async () => {
  const calls: RecordedCall[] = [];
  const engine = new VoicevoxEngine({ baseUrl: "http://voicevox.test", fetchFn: mockFetch(calls) });
  await engine.synthesize("テスト", 1, 99, -5);
  const body = JSON.parse(calls[1]?.body ?? "{}") as Record<string, unknown>;
  assert.equal(body["speedScale"], 2.0);
  assert.equal(body["volumeScale"], 0.0);
});

test("synthesize rejects empty text and HTTP failures", async () => {
  const engine = new VoicevoxEngine({ baseUrl: "http://voicevox.test", fetchFn: mockFetch([]) });
  await assert.rejects(() => engine.synthesize("  ", 1, 1, 1), /Audio text is empty/);

  const failing = new VoicevoxEngine({
    baseUrl: "http://voicevox.test",
    fetchFn: (async () => new Response("boom", { status: 500 })) as FetchFn,
  });
  await assert.rejects(() => failing.synthesize("テスト", 1, 1, 1), /Audio engine query failed: HTTP 500/);

  const notWav = new VoicevoxEngine({
    baseUrl: "http://voicevox.test",
    fetchFn: mockFetch([], Buffer.alloc(100, 1)),
  });
  await assert.rejects(() => notWav.synthesize("テスト", 1, 1, 1), /invalid WAV/);
});

test("synthesizer caches by parameters and revision", async () => {
  const calls: RecordedCall[] = [];
  const dir = await tempCacheDir();
  const synthesizer = new AudioSynthesizer(
    new VoicevoxEngine({ baseUrl: "http://voicevox.test", fetchFn: mockFetch(calls) }),
    new AudioCache({ dir, maxBytes: 10 * 1024 * 1024, ttlMs: 60 * 60 * 1000 }),
  );
  const request = { text: "テスト", speakerId: 1, speed: 1, volume: 1, cacheRevision: "0:0:rev1" };
  await synthesizer.synthesize(request);
  assert.equal(calls.length, 2);
  // Same request: cache hit, no new HTTP calls.
  await synthesizer.synthesize(request);
  assert.equal(calls.length, 2);
  // Different revision: synthesized again.
  await synthesizer.synthesize({ ...request, cacheRevision: "0:0:rev2" });
  assert.equal(calls.length, 4);
  // Different speaker: synthesized again.
  await synthesizer.synthesize({ ...request, speakerId: 2 });
  assert.equal(calls.length, 6);
});

test("cache expires entries older than the TTL", async () => {
  const dir = await tempCacheDir();
  const cache = new AudioCache({
    dir,
    maxBytes: 10 * 1024 * 1024,
    ttlMs: 1_000,
    now: () => Date.now() + 60_000,
  });
  const key = cache.keyFor({ engine: "e", text: "t", speakerId: 1, speed: 1, volume: 1, revision: "r" });
  await cache.put(key, fakeWav());
  assert.equal(await cache.get(key), null);
  assert.deepEqual(await readdir(dir), []);
});

test("cache evicts least recently used files beyond the size limit", async () => {
  const dir = await tempCacheDir();
  const cache = new AudioCache({ dir, maxBytes: 250, ttlMs: 60 * 60 * 1000 });
  const params = { engine: "e", speakerId: 1, speed: 1, volume: 1, revision: "r" };
  const wav = fakeWav(56); // 100 bytes each
  const key1 = cache.keyFor({ ...params, text: "one" });
  const key2 = cache.keyFor({ ...params, text: "two" });
  const key3 = cache.keyFor({ ...params, text: "three" });
  await cache.put(key1, wav);
  // Make key1 clearly the oldest.
  const old = new Date(Date.now() - 10_000);
  await utimes(join(dir, `${key1}.wav`), old, old);
  await cache.put(key2, wav);
  await cache.put(key3, wav);
  assert.equal(await cache.get(key1), null);
  assert.notEqual(await cache.get(key2), null);
  assert.notEqual(await cache.get(key3), null);
});
