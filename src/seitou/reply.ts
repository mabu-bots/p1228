// ==========================================
// 📤 インタラクション応答の定型
// ==========================================
// 📤 旧実装の応答は全て ephemeral（flags 64）。その方針をそのまま
// 引き継ぎ、応答は実行した本人にだけ見せる。
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

// 📤 ephemeral で即時応答する。
export async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
