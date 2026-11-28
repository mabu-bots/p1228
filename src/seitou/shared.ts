// ==========================================
// 🧩 星燈の共有ヘルパー（Discord 非依存の純粋ロジック）
// ==========================================
// 🧩 権限判定・文言整形・エラー文面の対応付けなど、Discord の
// オブジェクトに触れないロジックをここに集め、単体テスト可能にする。

// ------------------------------------------
// 🔐 権限判定
// ------------------------------------------

// 🔐 管理コマンドの実行権限（旧 isGuildAdmin 相当）。
// Administrator（8）または Manage Server（32）のどちらかがあれば可。
export function hasServerAdminPermission(permissions: bigint | null | undefined): boolean {
  if (permissions === null || permissions === undefined) return false;
  return (permissions & 8n) !== 0n || (permissions & 32n) !== 0n;
}

// 🔐 管理コマンドかどうか（旧 respondToCommand の判定相当）。
// 一般コマンド（omikuji / points / lottery / buy / ai）と、
// shop list・ticket close は一般利用者でも実行できる。
export function isAdminCommand(commandName: string, subcommandName: string): boolean {
  if (["omikuji", "points", "lottery", "buy", "ai"].includes(commandName)) return false;
  if (commandName === "shop" && subcommandName === "list") return false;
  if (commandName === "ticket" && subcommandName === "close") return false;
  return true;
}

// ------------------------------------------
// ✉️ 文言整形
// ------------------------------------------

// ✉️ コードポイント単位の切り詰め（サロゲートペアを割らない）。
export function truncateToCodePoints(text: string, maxCodePoints: number): string {
  return Array.from(text).slice(0, maxCodePoints).join("");
}

// ✉️ 参加・退出メッセージの placeholder を置換し、2,000コードポイント
// に切り詰める（旧 formatMemberMessage 相当）。
// 置換: {user} → メンション、{user_id}、{username}、{server}
export function formatMemberMessage(
  message: string,
  userId: string,
  username: string,
  serverName: string,
): string {
  const formatted = message
    .replaceAll("{user}", `<@${userId}>`)
    .replaceAll("{user_id}", userId)
    .replaceAll("{username}", username)
    .replaceAll("{server}", serverName);
  return truncateToCodePoints(formatted, 2000);
}

// ------------------------------------------
// 📨 エラー処理
// ------------------------------------------

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// 🎮 ゲーム系の既知エラーを利用者向け文面へ対応付ける（旧
// expectedGameError 相当）。対象外は undefined を返す。
export function expectedGameErrorMessage(error: unknown): string | undefined {
  const detail = errorMessage(error).toLowerCase();
  if (detail.includes("insufficient points")) return "ポイントが足りません。";
  if (detail.includes("omikuji already drawn today")) return "おみくじは本日すでに引いています。";
  if (detail.includes("shop item already owned")) return "この商品はすでに購入済みです。";
  if (detail.includes("shop item not found")) return "商品が見つかりません。";
  if (detail.includes("shop item is disabled")) return "商品が見つかりません。";
  return undefined;
}
