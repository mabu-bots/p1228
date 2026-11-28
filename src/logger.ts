// ==========================================
// 📝 ロガー（JSON 形式＋[exec] 統一形式）
// ==========================================
// 📝 旧実装（workers/src/core/logger.ts）の移植。
// イベントログは JSON 1行形式で標準出力へ、コマンド実行ログは
// `[exec]` 統一形式で記録する。秘匿情報らしきキー（token / secret /
// authorization / password / content / message_body）は伏せ字にする。

// ------------------------------------------
// 🔒 秘匿情報のマスキング
// ------------------------------------------
const secretKeys = /token|secret|authorization|password|content|message_body/i;

function sanitize(value: unknown, key = ""): unknown {
  if (secretKeys.test(key)) return "[REDACTED]";
  // 🔒 キーの文脈を残す：秘匿キー配下の配列（例："tokens": [...]）は
  // 要素も伏せ字にする。
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  }
  return value;
}

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, sanitize(value, key)]));
}

// ------------------------------------------
// 📝 イベントログ
// ------------------------------------------

// 📝 ログの service 名（Bot ごとに起動時に設定する。旧実装の
// P1228_WORKER_ID 相当）。
let logService = "p1228";

export function setLogService(service: string): void {
  logService = service;
}

function write(level: string, event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: logService,
    event,
    ...sanitizeFields(fields),
  });
  process.stdout.write(`${line}\n`);
}

export const logger = {
  info(event: string, fields: Record<string, unknown> = {}): void {
    write("INFO", event, fields);
  },
  warn(event: string, fields: Record<string, unknown> = {}): void {
    write("WARN", event, fields);
  },
  error(event: string, fields: Record<string, unknown> = {}): void {
    write("ERROR", event, fields);
  },
};

// ------------------------------------------
// 📝 コマンド実行ログ（[exec] 統一形式）
// ------------------------------------------
// 📝 スラッシュコマンドの実行を標準出力へ1行で記録する:
//   [exec] <ISO時刻> cmd=<コマンド名> route=slash guild=<ID> channel=<ID> user=<ID> result=<ok|error>
// 失敗時は末尾に error="<要点>" を付ける。記録するのはコマンド名・ID類・
// 成否のみで、ユーザーの入力テキスト（オプション値）は記録しない。
function idOrDash(value: string | undefined): string {
  return value && value.trim() ? value : "-";
}

function summarizeExecError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const cleaned = message.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  if (!cleaned) return "unknown error";
  return Array.from(cleaned).slice(0, 120).join("");
}

export function formatExecLog(
  now: Date,
  command: string,
  guildId: string | undefined,
  channelId: string | undefined,
  userId: string | undefined,
  error?: unknown,
): string {
  let line = `[exec] ${now.toISOString()} cmd=${idOrDash(command)} route=slash guild=${idOrDash(guildId)} channel=${idOrDash(channelId)} user=${idOrDash(userId)}`;
  line += error === undefined ? " result=ok" : ` result=error error="${summarizeExecError(error)}"`;
  return line;
}

export function execLog(
  command: string,
  guildId: string | undefined,
  channelId: string | undefined,
  userId: string | undefined,
  error?: unknown,
): void {
  process.stdout.write(`${formatExecLog(new Date(), command, guildId, channelId, userId, error)}\n`);
}
