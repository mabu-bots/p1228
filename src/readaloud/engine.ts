// ==========================================
// 🎙️ VOICEVOX 連携と音声キャッシュ
// ==========================================
// 🎙️ VOICEVOX ENGINE 互換 HTTP API（audio_query → synthesis）で
// WAV を合成し、設定・辞書の revision を含むキーでローカル
// ディスクへキャッシュする（旧 Worker の AudioEngineClient と
// 同じ意味）。上限は容量（既定512MB）と TTL（既定24時間）で、
// 追い出しは最長未使用（LRU）。ヒット時に mtime を更新して
// LRU の順序を保つ。
// HTTP は fetch の差し替えでモックできるようにし、実サーバーへは
// 接続しない形でテストできるようにする。

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ------------------------------------------
// 🧰 ユーティリティ
// ------------------------------------------

// 🧰 WAV かどうかを先頭の RIFF / WAVE マジックで判定する。
export function isWav(audio: Buffer): boolean {
  return (
    audio.byteLength >= 44 &&
    audio.toString("ascii", 0, 4) === "RIFF" &&
    audio.toString("ascii", 8, 12) === "WAVE"
  );
}

// 🧰 値を範囲内に丸める（非有限値は下限にする。旧実装と同じ）。
export function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

// 🔊 話速・音量の許容範囲（設定の検証範囲と同じ）。
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2.0;
export const VOLUME_MIN = 0.0;
export const VOLUME_MAX = 2.0;

// ------------------------------------------
// 🎙️ VOICEVOX クライアント
// ------------------------------------------

export type FetchFn = typeof fetch;

export interface VoicevoxEngineOptions {
  // 🎙️ VOICEVOX ENGINE 互換 API のベース URL
  baseUrl: string;
  // 🎙️ fetch の差し替え（テスト用）。未指定ならグローバルの fetch
  fetchFn?: FetchFn;
  // 🕐 audio_query のタイムアウト（ミリ秒）
  queryTimeoutMs?: number;
  // 🕐 synthesis のタイムアウト（ミリ秒）
  synthesisTimeoutMs?: number;
}

export class VoicevoxEngine {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly queryTimeoutMs: number;
  private readonly synthesisTimeoutMs: number;

  constructor(options: VoicevoxEngineOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.queryTimeoutMs = options.queryTimeoutMs ?? 20_000;
    this.synthesisTimeoutMs = options.synthesisTimeoutMs ?? 60_000;
  }

  // 🎙️ ベース URL（キャッシュキーに含めるエンジン識別子）。
  get engineId(): string {
    return this.baseUrl;
  }

  // 🎙️ audio_query を取得し、話速・音量を反映して synthesis する。
  // 戻り値は WAV のバイト列。失敗は例外にする。
  async synthesize(text: string, speakerId: number, speed: number, volume: number): Promise<Buffer> {
    if (!text.trim()) throw new Error("Audio text is empty");
    const queryUrl = new URL(`${this.baseUrl}/audio_query`);
    queryUrl.searchParams.set("text", text);
    queryUrl.searchParams.set("speaker", String(speakerId));
    const queryResponse = await this.fetchFn(queryUrl, {
      method: "POST",
      signal: AbortSignal.timeout(this.queryTimeoutMs),
    });
    if (!queryResponse.ok) {
      throw new Error(`Audio engine query failed: HTTP ${queryResponse.status}`);
    }
    const query = (await queryResponse.json()) as Record<string, unknown>;
    query["speedScale"] = clamp(speed, SPEED_MIN, SPEED_MAX);
    query["volumeScale"] = clamp(volume, VOLUME_MIN, VOLUME_MAX);

    const synthesisUrl = new URL(`${this.baseUrl}/synthesis`);
    synthesisUrl.searchParams.set("speaker", String(speakerId));
    const synthesisResponse = await this.fetchFn(synthesisUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(this.synthesisTimeoutMs),
    });
    if (!synthesisResponse.ok) {
      throw new Error(`Audio engine synthesis failed: HTTP ${synthesisResponse.status}`);
    }
    const audio = Buffer.from(await synthesisResponse.arrayBuffer());
    if (!isWav(audio)) throw new Error("Audio engine returned an empty or invalid WAV payload");
    return audio;
  }
}

// ------------------------------------------
// 💾 音声キャッシュ
// ------------------------------------------

export interface AudioCacheOptions {
  // 💾 キャッシュの保存先ディレクトリ
  dir: string;
  // 🔢 上限サイズ（バイト）
  maxBytes: number;
  // 🕐 保持時間（ミリ秒）
  ttlMs: number;
  // 🕐 時計の差し替え（テスト用）。未指定なら実時計
  now?: () => number;
}

export interface CacheKeyParams {
  // 🎙️ エンジンの識別子（ベース URL）
  engine: string;
  // 🔊 合成する文章（辞書適用後）
  text: string;
  // 🔊 話者 ID
  speakerId: number;
  // 🔊 話速（キー計算前に範囲へ丸める）
  speed: number;
  // 🔊 音量（キー計算前に範囲へ丸める）
  volume: number;
  // 🔊 設定・辞書の revision（古い読み上げを使い回さないため）
  revision: string;
}

interface CacheFile {
  path: string;
  size: number;
  modifiedAt: number;
}

export class AudioCache {
  private readonly now: () => number;

  constructor(private readonly options: AudioCacheOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  // 💾 合成パラメータからキャッシュキーを作る（旧実装と同じ材料）。
  keyFor(params: CacheKeyParams): string {
    const normalized = {
      engine: params.engine,
      text: params.text,
      speakerId: params.speakerId,
      speed: clamp(params.speed, SPEED_MIN, SPEED_MAX),
      volume: clamp(params.volume, VOLUME_MIN, VOLUME_MAX),
      revision: params.revision,
    };
    return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  }

  private pathFor(key: string): string {
    return join(this.options.dir, `${key}.wav`);
  }

  // 🔢 上限サイズ（バイト）。これより大きい音声は保存しない。
  get maxBytes(): number {
    return this.options.maxBytes;
  }

  // 💾 キャッシュを読む。期限切れ・不正・上限超は破棄して null。
  async get(key: string): Promise<Buffer | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      if (
        !info.isFile() ||
        info.size < 44 ||
        info.size > this.options.maxBytes ||
        this.now() - info.mtimeMs > this.options.ttlMs
      ) {
        await unlink(path).catch(() => undefined);
        return null;
      }
      const audio = await readFile(path);
      if (!isWav(audio)) return null;
      // 🕐 ヒット時に mtime を更新する: 追い出しが LRU になる。
      const now = new Date(this.now());
      await utimes(path, now, now).catch(() => undefined);
      return audio;
    } catch {
      return null;
    }
  }

  // 💾 キャッシュへ書く（一時ファイル + rename で原子的）。書いた後に
  // 上限管理を行う。大きな一度きりのファイルは呼び出し側で弾く前提。
  async put(key: string, audio: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(this.options.dir, { recursive: true, mode: 0o770 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, audio, { mode: 0o660, flag: "wx" });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    await this.enforceLimit(path);
  }

  // 🧹 期限切れを消し、上限を超えたら古いものから追い出す。
  // protectedPath（今書いたファイル）だけは追い出し対象にしない。
  private async enforceLimit(protectedPath: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.options.dir);
    } catch {
      return;
    }
    const files: CacheFile[] = [];
    for (const name of names) {
      if (!name.endsWith(".wav")) continue;
      const path = join(this.options.dir, name);
      try {
        const info = await stat(path);
        if (info.isFile()) files.push({ path, size: info.size, modifiedAt: info.mtimeMs });
      } catch {
        // 🧹 同時クリーンアップや置換時の競合は無視する。
      }
    }
    const now = this.now();
    for (const file of files) {
      if (file.path !== protectedPath && now - file.modifiedAt > this.options.ttlMs) {
        await unlink(file.path).catch(() => undefined);
      }
    }
    const retained = files
      .filter((file) => file.path === protectedPath || now - file.modifiedAt <= this.options.ttlMs)
      .sort((a, b) => a.modifiedAt - b.modifiedAt);
    let total = retained.reduce((sum, file) => sum + file.size, 0);
    for (const file of retained) {
      if (total <= this.options.maxBytes) break;
      if (file.path === protectedPath) continue;
      await unlink(file.path).catch(() => undefined);
      total -= file.size;
    }
  }
}

// ------------------------------------------
// 🎙️ 合成（キャッシュつき）
// ------------------------------------------

export interface SynthesisRequest {
  // 🔊 合成する文章（辞書適用後）
  text: string;
  // 🔊 話者 ID
  speakerId: number;
  // 🔊 話速
  speed: number;
  // 🔊 音量
  volume: number;
  // 🔊 設定・辞書の revision（合成したキャッシュキーに使う）
  cacheRevision: string;
}

// 🎙️ キャッシュを介して合成する窓口。サービス層はこれだけを使う。
export class AudioSynthesizer {
  constructor(
    private readonly engine: VoicevoxEngine,
    private readonly cache: AudioCache,
  ) {}

  // 🎙️ キャッシュにあればそれを返し、無ければ合成して保存する。
  // 上限より大きい音声は保存せずにそのまま返す（旧実装と同じ）。
  async synthesize(request: SynthesisRequest): Promise<Buffer> {
    if (!request.text.trim()) throw new Error("Audio text is empty");
    const key = this.cache.keyFor({
      engine: this.engine.engineId,
      text: request.text,
      speakerId: request.speakerId,
      speed: request.speed,
      volume: request.volume,
      revision: request.cacheRevision,
    });
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const audio = await this.engine.synthesize(
      request.text,
      request.speakerId,
      request.speed,
      request.volume,
    );
    // 💾 上限より大きい一度きりの音声は保存しない（旧実装と同じ）。
    // キャッシュ書き込みの失敗で再生自体は止めない。
    if (audio.byteLength <= this.cache.maxBytes) {
      await this.cache.put(key, audio).catch(() => undefined);
    }
    return audio;
  }
}
