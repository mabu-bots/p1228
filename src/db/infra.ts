// ==========================================
// 📨 配送基盤テーブルのアクセサ
// ==========================================
// 📨 gateway_sessions / event_inbox / event_dead_letters /
// worker_instances / discord_operations / event_idempotency_keys
// の読み書き。旧実装（Go の storage.go）の受け渡し手順を意味
// そのままに移したもの。
//
// ⚠️ TS 単一構成では Gateway/Worker 分離が無くなるため、これらの
// テーブルは新構成では使われなくなる見込み（DESIGN §3.3）。ただし
// 既存 DB をそのまま読む互換のため、削除はせず読み書きを用意する。

import type { DbContext } from "./context.js";
import { formatUtcTimestamp } from "./context.js";
import type {
  DiscordOperationRow,
  EventDeadLetterRow,
  EventIdempotencyKeyRow,
  EventInboxRow,
  GatewaySessionRow,
  WorkerInstanceRow,
} from "./rows.js";

// ------------------------------------------
// 🔌 セッション（gateway_sessions）
// ------------------------------------------

export interface GatewaySession {
  botId: string;
  sessionId: string;
  resumeGatewayUrl: string;
  // 🔢 -1 は「セッションなし」を表す（実際のシーケンス 0 とは別物）
  lastSequence: number;
  botUserId: string;
}

// 🔌 保存済みセッションを読む（旧 LoadSession 相当）。
// 行が無ければ lastSequence = -1 の空セッションを返す。
export function loadSession(ctx: DbContext, botId: string): GatewaySession {
  const row = ctx.db
    .prepare("SELECT * FROM gateway_sessions WHERE bot_id = ?")
    .get(botId) as GatewaySessionRow | undefined;
  if (row === undefined) {
    return { botId, sessionId: "", resumeGatewayUrl: "", lastSequence: -1, botUserId: "" };
  }
  return {
    botId: row.bot_id,
    sessionId: row.session_id,
    resumeGatewayUrl: row.resume_gateway_url,
    lastSequence: row.last_sequence,
    botUserId: row.bot_user_id,
  };
}

// 🔌 セッション行をそのまま取得する（無ければ null）。
export function getGatewaySessionRow(ctx: DbContext, botId: string): GatewaySessionRow | null {
  return (
    (ctx.db.prepare("SELECT * FROM gateway_sessions WHERE bot_id = ?").get(botId) as
      | GatewaySessionRow
      | undefined) ?? null
  );
}

// 🔌 セッションを消去する（旧 ClearSession 相当）。
export function clearSession(ctx: DbContext, botId: string): void {
  ctx.db
    .prepare(
      "UPDATE gateway_sessions SET session_id = '', resume_gateway_url = '', last_sequence = -1, updated_at = ? WHERE bot_id = ?",
    )
    .run(ctx.now(), botId);
}

// ------------------------------------------
// 📨 イベント受付（event_inbox）
// ------------------------------------------

export interface InboxEvent {
  eventId: string;
  correlationId: string;
  botId: string;
  sessionId: string;
  sequence: number;
  eventType: string;
  orderingKey: string;
  occurredAt: string;
  botUserId: string;
  payloadJson: string;
}

// 📨 受信記録とシーケンスのチェックポイントを原子的にコミットする
// （旧 RecordDispatch 相当）。イベントは重複を無視して記録する。
export function recordDispatch(ctx: DbContext, session: GatewaySession, event: InboxEvent | null): void {
  const run = ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO bots(bot_id, display_name, application_id, bot_user_id) VALUES(?, ?, '', ?)
         ON CONFLICT(bot_id) DO UPDATE SET bot_user_id = CASE
           WHEN excluded.bot_user_id <> '' THEN excluded.bot_user_id ELSE bots.bot_user_id END`,
      )
      .run(session.botId, session.botId, session.botUserId);
    ctx.db
      .prepare(
        `INSERT INTO gateway_sessions(bot_id, session_id, resume_gateway_url, last_sequence, bot_user_id, updated_at)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(bot_id) DO UPDATE SET
           session_id = CASE WHEN excluded.session_id <> '' THEN excluded.session_id ELSE gateway_sessions.session_id END,
           resume_gateway_url = CASE WHEN excluded.resume_gateway_url <> '' THEN excluded.resume_gateway_url ELSE gateway_sessions.resume_gateway_url END,
           last_sequence = MAX(gateway_sessions.last_sequence, excluded.last_sequence),
           bot_user_id = CASE WHEN excluded.bot_user_id <> '' THEN excluded.bot_user_id ELSE gateway_sessions.bot_user_id END,
           updated_at = excluded.updated_at`,
      )
      .run(
        session.botId,
        session.sessionId,
        session.resumeGatewayUrl,
        session.lastSequence,
        session.botUserId,
        ctx.now(),
      );
    if (event !== null) {
      ctx.db
        .prepare(
          `INSERT OR IGNORE INTO event_inbox(event_id, correlation_id, bot_id, session_id, sequence,
             event_type, ordering_key, occurred_at, received_at, bot_user_id, payload_json, status)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        )
        .run(
          event.eventId,
          event.correlationId,
          event.botId,
          event.sessionId,
          event.sequence,
          event.eventType,
          event.orderingKey,
          event.occurredAt,
          ctx.now(),
          event.botUserId,
          event.payloadJson,
        );
    }
  });
  run();
}

// 📨 イベント行をそのまま取得する（無ければ null）。
export function getEventInboxRow(ctx: DbContext, eventId: string): EventInboxRow | null {
  return (
    (ctx.db.prepare("SELECT * FROM event_inbox WHERE event_id = ?").get(eventId) as
      | EventInboxRow
      | undefined) ?? null
  );
}

// 📨 Bot のイベントを状態で絞って新しい順に返す。
export function listEventInbox(
  ctx: DbContext,
  botId: string,
  status?: string,
  limit = 100,
): EventInboxRow[] {
  if (status !== undefined) {
    return ctx.db
      .prepare(
        "SELECT * FROM event_inbox WHERE bot_id = ? AND status = ? ORDER BY received_at DESC LIMIT ?",
      )
      .all(botId, status, limit) as EventInboxRow[];
  }
  return ctx.db
    .prepare("SELECT * FROM event_inbox WHERE bot_id = ? ORDER BY received_at DESC LIMIT ?")
    .all(botId, limit) as EventInboxRow[];
}

export interface ClaimedEvent {
  event: EventInboxRow;
  leaseToken: string;
  attempts: number;
}

// 📨 処理対象のイベントを1件確保する（旧 ClaimEvent 相当）。
// リース切れで上限に達したものはデッドレター化し、同一 ordering_key
// の古い未完了イベントがあるものは順序維持のため後回しにする。
export function claimEvent(
  ctx: DbContext,
  args: { botId: string; instanceId: string; leaseSeconds: number; maxAttempts: number },
): ClaimedEvent | null {
  const { botId, instanceId, leaseSeconds, maxAttempts } = args;
  const run = ctx.db.transaction((): ClaimedEvent | null => {
    const nowDate = ctx.nowDate();
    const nstr = formatUtcTimestamp(nowDate);
    const until = formatUtcTimestamp(new Date(nowDate.getTime() + leaseSeconds * 1000));
    ctx.db
      .prepare(
        `INSERT OR REPLACE INTO event_dead_letters(event_id, bot_id, event_type, reason, attempts, payload_json, created_at)
         SELECT event_id, bot_id, event_type, 'lease expired beyond retry limit', attempts, payload_json, ?
         FROM event_inbox
         WHERE bot_id = ? AND status = 'processing' AND lease_until <= ? AND attempts >= ?`,
      )
      .run(nstr, botId, nstr, maxAttempts);
    ctx.db
      .prepare(
        `UPDATE event_inbox SET status = 'dead', lease_until = NULL, lease_owner = NULL,
           lease_token = NULL, last_error = 'lease expired beyond retry limit'
         WHERE bot_id = ? AND status = 'processing' AND lease_until <= ? AND attempts >= ?`,
      )
      .run(botId, nstr, maxAttempts);
    const row = ctx.db
      .prepare(
        `SELECT e.* FROM event_inbox e
         WHERE e.bot_id = ? AND e.status IN ('pending', 'processing')
           AND (e.not_before IS NULL OR e.not_before <= ?)
           AND (e.lease_until IS NULL OR e.lease_until <= ?)
           AND e.attempts < ?
           AND NOT EXISTS (
             SELECT 1 FROM event_inbox p
             WHERE p.bot_id = e.bot_id AND p.ordering_key = e.ordering_key
               AND p.status NOT IN ('acked', 'dead') AND p.received_at < e.received_at)
         ORDER BY CASE WHEN e.event_type = 'INTERACTION_CREATE' THEN 0 ELSE 1 END, e.received_at
         LIMIT 1`,
      )
      .get(botId, nstr, nstr, maxAttempts) as EventInboxRow | undefined;
    if (row === undefined) return null;
    const token = ctx.randomId("lease_");
    ctx.db
      .prepare(
        `UPDATE event_inbox SET status = 'processing', attempts = attempts + 1,
           lease_until = ?, lease_owner = ?, lease_token = ?, not_before = NULL
         WHERE event_id = ?`,
      )
      .run(until, instanceId, token, row.event_id);
    const claimed = getEventInboxRow(ctx, row.event_id);
    if (claimed === null) throw new Error("claimed event disappeared");
    return { event: claimed, leaseToken: token, attempts: row.attempts + 1 };
  });
  return run();
}

// 📨 処理完了を記録する（旧 AckEvent 相当）。
// リースが自分のものでなければ例外にする。
export function ackEvent(ctx: DbContext, botId: string, eventId: string, token: string): void {
  const result = ctx.db
    .prepare(
      `UPDATE event_inbox SET status = 'acked', lease_until = NULL, lease_owner = NULL,
         lease_token = NULL, last_error = NULL
       WHERE bot_id = ? AND event_id = ? AND status = 'processing' AND lease_token = ?`,
    )
    .run(botId, eventId, token);
  if (result.changes === 0) {
    throw new Error("event lease is missing, expired or owned by another worker");
  }
}

// 📨 処理失敗を記録する（旧 NackEvent 相当）。
// 上限未満なら指数バックオフで pending に戻し、上限ならデッドレター化する。
export function nackEvent(
  ctx: DbContext,
  args: { botId: string; eventId: string; token: string; reason: string; maxAttempts: number },
): void {
  const { botId, eventId, token, reason, maxAttempts } = args;
  const run = ctx.db.transaction(() => {
    const row = ctx.db
      .prepare(
        `SELECT bot_id, event_type, payload_json, attempts FROM event_inbox
         WHERE bot_id = ? AND event_id = ? AND status = 'processing' AND lease_token = ?`,
      )
      .get(botId, eventId, token) as
      | Pick<EventInboxRow, "bot_id" | "event_type" | "payload_json" | "attempts">
      | undefined;
    if (row === undefined) {
      throw new Error("event lease is missing, expired or owned by another worker");
    }
    if (row.attempts >= maxAttempts) {
      ctx.db
        .prepare(
          `INSERT OR REPLACE INTO event_dead_letters(event_id, bot_id, event_type, reason, attempts, payload_json, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(eventId, row.bot_id, row.event_type, reason, row.attempts, row.payload_json, ctx.now());
      ctx.db
        .prepare(
          `UPDATE event_inbox SET status = 'dead', lease_until = NULL, lease_owner = NULL,
             lease_token = NULL, last_error = ? WHERE bot_id = ? AND event_id = ?`,
        )
        .run(reason, botId, eventId);
    } else {
      const delaySeconds = 2 ** Math.min(row.attempts, 8);
      const notBefore = formatUtcTimestamp(new Date(ctx.nowDate().getTime() + delaySeconds * 1000));
      ctx.db
        .prepare(
          `UPDATE event_inbox SET status = 'pending', not_before = ?, lease_until = NULL,
             lease_owner = NULL, lease_token = NULL, last_error = ?
           WHERE bot_id = ? AND event_id = ?`,
        )
        .run(notBefore, reason, botId, eventId);
    }
  });
  run();
}

// ------------------------------------------
// 🗑️ デッドレター（event_dead_letters）
// ------------------------------------------

// 🗑️ デッドレターを1件取得する（無ければ null）。
export function getEventDeadLetter(ctx: DbContext, eventId: string): EventDeadLetterRow | null {
  return (
    (ctx.db.prepare("SELECT * FROM event_dead_letters WHERE event_id = ?").get(eventId) as
      | EventDeadLetterRow
      | undefined) ?? null
  );
}

// 🗑️ デッドレターを新しい順に返す。
export function listEventDeadLetters(ctx: DbContext, botId?: string): EventDeadLetterRow[] {
  if (botId !== undefined) {
    return ctx.db
      .prepare("SELECT * FROM event_dead_letters WHERE bot_id = ? ORDER BY created_at DESC")
      .all(botId) as EventDeadLetterRow[];
  }
  return ctx.db
    .prepare("SELECT * FROM event_dead_letters ORDER BY created_at DESC")
    .all() as EventDeadLetterRow[];
}

// 🗑️ デッドレターを直接記録する。
export function insertEventDeadLetter(ctx: DbContext, letter: Omit<EventDeadLetterRow, "created_at">): void {
  ctx.db
    .prepare(
      `INSERT OR REPLACE INTO event_dead_letters(event_id, bot_id, event_type, reason, attempts, payload_json, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(letter.event_id, letter.bot_id, letter.event_type, letter.reason, letter.attempts, letter.payload_json, ctx.now());
}

// ------------------------------------------
// 💓 ワーカー（worker_instances）
// ------------------------------------------

export interface WorkerIdentity {
  workerId: string;
  role: string;
  botId: string;
}

// 💓 ワーカーを登録する（旧 RegisterWorker 相当）。
// 同じ instance_id が別の worker / bot で登録済みなら例外にする。
export function registerWorker(ctx: DbContext, instanceId: string, worker: WorkerIdentity): void {
  const existing = ctx.db
    .prepare("SELECT worker_id, bot_id FROM worker_instances WHERE instance_id = ?")
    .get(instanceId) as Pick<WorkerInstanceRow, "worker_id" | "bot_id"> | undefined;
  if (existing !== undefined && (existing.worker_id !== worker.workerId || existing.bot_id !== worker.botId)) {
    throw new Error("worker instance id is already registered to another worker");
  }
  const stamp = ctx.now();
  ctx.db
    .prepare(
      `INSERT INTO worker_instances(instance_id, worker_id, role, bot_id, started_at, last_heartbeat, status)
       VALUES(?, ?, ?, ?, ?, ?, 'online')
       ON CONFLICT(instance_id) DO UPDATE SET last_heartbeat = excluded.last_heartbeat, status = 'online'`,
    )
    .run(instanceId, worker.workerId, worker.role, worker.botId, stamp, stamp);
}

// 💓 ワーカーが登録済みで online かを返す（旧 IsWorkerRegistered 相当）。
export function isWorkerRegistered(
  ctx: DbContext,
  instanceId: string,
  workerId: string,
  botId: string,
): boolean {
  const row = ctx.db
    .prepare(
      `SELECT COUNT(*) AS count FROM worker_instances
       WHERE instance_id = ? AND worker_id = ? AND bot_id = ? AND status = 'online'`,
    )
    .get(instanceId, workerId, botId) as { count: number };
  return row.count === 1;
}

// 💓 ハートビートを更新する（旧 Heartbeat 相当）。未登録なら例外。
export function heartbeat(ctx: DbContext, instanceId: string, workerId: string, botId: string): void {
  const result = ctx.db
    .prepare(
      `UPDATE worker_instances SET last_heartbeat = ?, status = 'online'
       WHERE instance_id = ? AND worker_id = ? AND bot_id = ?`,
    )
    .run(ctx.now(), instanceId, workerId, botId);
  if (result.changes === 0) {
    throw new Error("worker instance is not registered for this identity");
  }
}

// 💓 Bot ごとの最新ハートビートを返す（旧 LatestWorkerHeartbeats 相当）。
export function latestWorkerHeartbeats(ctx: DbContext): Map<string, string> {
  const rows = ctx.db
    .prepare(
      `SELECT bot_id, MAX(last_heartbeat) AS last_heartbeat FROM worker_instances
       WHERE status = 'online' GROUP BY bot_id`,
    )
    .all() as Pick<WorkerInstanceRow, "bot_id" | "last_heartbeat">[];
  return new Map(rows.map((row) => [row.bot_id, row.last_heartbeat]));
}

// 💓 ワーカー行をそのまま取得する（無ければ null）。
export function getWorkerInstance(ctx: DbContext, instanceId: string): WorkerInstanceRow | null {
  return (
    (ctx.db.prepare("SELECT * FROM worker_instances WHERE instance_id = ?").get(instanceId) as
      | WorkerInstanceRow
      | undefined) ?? null
  );
}

// 💓 全ワーカーを返す。
export function listWorkerInstances(ctx: DbContext): WorkerInstanceRow[] {
  return ctx.db
    .prepare("SELECT * FROM worker_instances ORDER BY instance_id")
    .all() as WorkerInstanceRow[];
}

// ------------------------------------------
// 🔒 操作の冪等性（discord_operations）
// ------------------------------------------

// 🔒 operation_id をちょうど1回だけ確保する（旧 CreateOperation 相当）。
// 確保できたら true、既に存在したら false。
export function createOperation(
  ctx: DbContext,
  id: string,
  botId: string,
  operation: string,
): boolean {
  const stamp = ctx.now();
  const result = ctx.db
    .prepare(
      `INSERT OR IGNORE INTO discord_operations(operation_id, bot_id, operation, status, created_at, updated_at)
       VALUES(?, ?, ?, 'pending', ?, ?)`,
    )
    .run(id, botId, operation, stamp, stamp);
  return result.changes === 1;
}

// 🔒 操作の状態と応答参照を返す（旧 GetOperationResult 相当）。
export function getOperationResult(
  ctx: DbContext,
  id: string,
  botId: string,
  operation: string,
): { status: string; responseRef: string } | null {
  const row = ctx.db
    .prepare(
      `SELECT status, COALESCE(response_ref, '') AS response_ref FROM discord_operations
       WHERE operation_id = ? AND bot_id = ? AND operation = ?`,
    )
    .get(id, botId, operation) as Pick<DiscordOperationRow, "status" | "response_ref"> | undefined;
  if (row === undefined) return null;
  return { status: row.status, responseRef: row.response_ref ?? "" };
}

// 🔒 操作行をそのまま取得する（無ければ null）。
export function getOperation(ctx: DbContext, operationId: string): DiscordOperationRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM discord_operations WHERE operation_id = ?")
      .get(operationId) as DiscordOperationRow | undefined) ?? null
  );
}

// 🔒 操作の状態を更新する（旧 UpdateOperation 相当）。
export function updateOperation(
  ctx: DbContext,
  args: {
    id: string;
    botId: string;
    operation: string;
    status: string;
    responseRef: string;
    errorMessage: string;
  },
): void {
  const stamp = ctx.now();
  ctx.db
    .prepare(
      `INSERT INTO discord_operations(operation_id, bot_id, operation, status, response_ref, error_message, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(operation_id) DO UPDATE SET status = excluded.status,
         response_ref = excluded.response_ref, error_message = excluded.error_message,
         updated_at = excluded.updated_at`,
    )
    .run(args.id, args.botId, args.operation, args.status, args.responseRef, args.errorMessage, stamp, stamp);
}

// ------------------------------------------
// 🔑 イベント冪等性キー（event_idempotency_keys）
// ------------------------------------------

// 🔑 冪等性キーを記録する。
// ⚠️ 旧実装ではこのテーブルへの書き手は存在せず、期限切れ掃除だけが
// 動いていた。ここでは将来の利用に備えた最小アクセサを用意する。
export function putEventIdempotencyKey(
  ctx: DbContext,
  handlerKey: string,
  idempotencyKey: string,
  expiresAt: string,
): void {
  ctx.db
    .prepare(
      `INSERT INTO event_idempotency_keys(handler_key, idempotency_key, expires_at, created_at)
       VALUES(?, ?, ?, ?)
       ON CONFLICT(handler_key, idempotency_key) DO UPDATE SET expires_at = excluded.expires_at`,
    )
    .run(handlerKey, idempotencyKey, expiresAt, ctx.now());
}

// 🔑 冪等性キーが（期限内に）存在するかを返す。
export function hasEventIdempotencyKey(
  ctx: DbContext,
  handlerKey: string,
  idempotencyKey: string,
): boolean {
  const row = ctx.db
    .prepare(
      `SELECT COUNT(*) AS count FROM event_idempotency_keys
       WHERE handler_key = ? AND idempotency_key = ? AND expires_at > ?`,
    )
    .get(handlerKey, idempotencyKey, ctx.now()) as { count: number };
  return row.count > 0;
}

// 🔑 冪等性キー全件を返す。
export function listEventIdempotencyKeys(ctx: DbContext): EventIdempotencyKeyRow[] {
  return ctx.db
    .prepare("SELECT * FROM event_idempotency_keys ORDER BY handler_key, idempotency_key")
    .all() as EventIdempotencyKeyRow[];
}

// 🔑 期限切れのキーを削除し、削除件数を返す。
export function deleteExpiredEventIdempotencyKeys(ctx: DbContext): number {
  const result = ctx.db
    .prepare("DELETE FROM event_idempotency_keys WHERE expires_at < ?")
    .run(ctx.now());
  return result.changes;
}

// ------------------------------------------
// 🗑️ 保持期限の掃除（旧 PruneExpiredEvents 相当）
// ------------------------------------------

// 🗑️ 保持期限を過ぎたイベントをデッドレター化してから削除する。
// ACK されなかったイベントの本文を無期限に残さないための掃除で、
// 削除した inbox 件数を返す。
export function pruneExpiredEvents(ctx: DbContext, retentionHours: number): number {
  if (retentionHours < 1) throw new Error("event retention must be at least one hour");
  const run = ctx.db.transaction((): number => {
    const cutoff = formatUtcTimestamp(
      new Date(ctx.nowDate().getTime() - retentionHours * 3_600_000),
    );
    ctx.db
      .prepare(
        `INSERT OR IGNORE INTO event_dead_letters(event_id, bot_id, event_type, reason, attempts, payload_json, created_at)
         SELECT event_id, bot_id, event_type,
           'event expired before processing/ACK by payload retention policy',
           attempts, payload_json, received_at
         FROM event_inbox WHERE received_at < ? AND status IN ('pending', 'processing')`,
      )
      .run(cutoff);
    ctx.db.prepare("UPDATE event_dead_letters SET payload_json = '{}' WHERE created_at < ?").run(cutoff);
    const deleted = ctx.db.prepare("DELETE FROM event_inbox WHERE received_at < ?").run(cutoff);
    // 📝 旧実装と同じく、冪等性キーの期限切れ掃除もここで行う。
    ctx.db.prepare("DELETE FROM event_idempotency_keys WHERE expires_at < ?").run(ctx.now());
    return deleted.changes;
  });
  return run();
}
