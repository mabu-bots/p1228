// ==========================================
// 🤖 ローカルAI（llama-server）連携（グループ e）
// ==========================================
// 🤖 llama.cpp の llama-server が公開する OpenAI 互換 API
// (POST /v1/chat/completions) を叩く。旧実装（workers/src/general/
// ai.ts）の移植。応答生成は最大で数十秒かかるため、タイムアウトは
// 長め (120秒) に取る。ベース URL は config の llamaBaseUrl を使う。

import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { logger } from "../logger.js";
import type { SeitouDeps } from "./deps.js";
import { errorMessage, truncateToCodePoints } from "./shared.js";

export const AI_SYSTEM_PROMPT =
  "あなたはDiscordボット『星燈』に組み込まれたAIアシスタントです。日本語で簡潔に答えてください。";

const AI_TIMEOUT_MS = 120_000;

// ⚠️ 同時実行制限に引っかかったことを示すエラー。呼び出し側は通常の
// 生成失敗とは別の文面（混み合っている旨）で返信する。
export class AiBusyError extends Error {
  constructor() {
    super("AI request already in flight");
    this.name = "AiBusyError";
  }
}

// 🧠 リクエスト本文を組み立てる。
export function buildAiRequestBody(prompt: string): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: AI_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    max_tokens: 400,
    temperature: 0.7,
  };
}

// 🧠 応答 JSON から本文を取り出す。空なら例外にする。
export function extractAiContent(payload: unknown): string {
  const choices = (payload as { choices?: unknown } | null | undefined)?.choices;
  const first = Array.isArray(choices)
    ? (choices[0] as { message?: { content?: unknown } } | undefined)
    : undefined;
  const content = first?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("AI returned an empty response");
  return content;
}

// ------------------------------------------
// 🤖 応答生成（同時実行は1件まで）
// ------------------------------------------
// 🚧 llama-server は単一モデルで生成するため、複数リクエストを
// 同時に投げると全員が遅くなる。同時1件に制限し、超過分は待たせず
// AiBusyError で即座に弾く（旧実装の簡易ガード）。

let aiInFlight = false;

export function isAiBusy(): boolean {
  return aiInFlight;
}

export async function chatWithAi(
  baseUrl: string,
  prompt: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (!prompt || !prompt.trim()) throw new Error("AI prompt is empty");
  if (aiInFlight) throw new AiBusyError();
  aiInFlight = true;
  try {
    const response = await fetchFn(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAiRequestBody(prompt)),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`AI chat request failed: HTTP ${response.status}`);
    return extractAiContent(await response.json());
  } finally {
    aiInFlight = false;
  }
}

// ------------------------------------------
// 🤖 /ai コマンド処理
// ------------------------------------------

// 🤖 LLM の応答生成には時間がかかるため、先に defer で応答を保留し、
// 生成が終わってから元の応答を編集して回答を届ける。生成に失敗した
// 場合も編集で失敗メッセージを届け、理由は log に残す。
export async function handleAiCommand(
  deps: SeitouDeps,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (interaction.commandName !== "ai") return false;
  const prompt = interaction.options.getString("prompt", true).trim();
  if (!prompt) {
    await interaction.reply({ content: "質問を入力してください。", flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const answer = await chatWithAi(deps.llamaBaseUrl, prompt);
    await interaction.editReply({ content: truncateToCodePoints(answer, 2000) });
  } catch (error) {
    if (error instanceof AiBusyError) {
      await interaction.editReply({
        content: "ただいまAIが混み合っています。少し時間をおいて再度お試しください。",
      });
      return true;
    }
    logger.error("ai_chat_failed", { user_id: interaction.user.id, error: errorMessage(error) });
    await interaction.editReply({ content: "AIの応答取得に失敗しました。時間をおいて再度お試しください。" });
  }
  return true;
}
