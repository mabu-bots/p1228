// ==========================================
// 🗂️ 星燈のインメモリ状態（スナップショット）
// ==========================================
// 🗂️ 旧実装（star-shared.ts）の共有 Map 群に相当する。
// 再起動後に GuildCreate（ready）から再構築し、GuildDelete で破棄する
// インメモリのスナップショットのみを保持する（永続化は DB 層の担当）。
// ロール変更の記録は、メンバーの以前のロールがここに入っている場合に
// だけ行う（旧実装と同じ）。

export class SeitouState {
  // 🏠 ギルド名（guildId → 名前）
  readonly guildNames = new Map<string, string>();
  // 👤 メンバー表示名（"guildId:userId" → 名前）
  readonly memberNames = new Map<string, string>();
  // 🎭 メンバーのロール集合（"guildId:userId" → ロールID集合）
  readonly memberRoles = new Map<string, Set<string>>();
  // 🔊 VC の親カテゴリー（"guildId:channelId" → カテゴリーID）
  readonly channelParents = new Map<string, string>();
  // 🔊 メンバーの接続先 VC（"guildId:userId" → チャンネルID）
  readonly voiceChannels = new Map<string, string>();

  // 🔑 複合キーの組み立て
  static key(guildId: string, id: string): string {
    return `${guildId}:${id}`;
  }

  // 👤 メンバー表示名を引く（無ければ fallback）。
  memberName(guildId: string, userId: string, fallback: string): string {
    return this.memberNames.get(SeitouState.key(guildId, userId)) ?? fallback;
  }

  // 👤 メンバー表示名を記録する。
  setMemberName(guildId: string, userId: string, name: string): void {
    this.memberNames.set(SeitouState.key(guildId, userId), name);
  }

  // 🔊 チャンネルの在室人数を数える（一時 VC の空判定用）。
  countOccupants(guildId: string, channelId: string): number {
    let count = 0;
    for (const [key, value] of this.voiceChannels) {
      if (key.startsWith(`${guildId}:`) && value === channelId) count++;
    }
    return count;
  }

  // 🗑️ ギルド分のスナップショットを全て破棄する（GuildDelete 時）。
  clearGuild(guildId: string): void {
    const prefix = `${guildId}:`;
    for (const map of [this.memberNames, this.memberRoles, this.channelParents, this.voiceChannels]) {
      for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
    }
    this.guildNames.delete(guildId);
  }
}
