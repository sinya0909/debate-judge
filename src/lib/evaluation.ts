import OpenAI from "openai";
import { MERIT_POINTS } from "@/lib/constants";
import { sanitizeContent } from "@/lib/sanitize";
import { loadPrompt } from "@/lib/prompts/loader";
import type { FallacyEntry, EvaluationResult, PreviousFallacies } from "@/lib/types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 詭弁リストをマージ（message番号+typeで重複排除）
 * 一度検出された詭弁は消えない（累積）
 */
export function mergeFallacies(
  previous: FallacyEntry[],
  current: FallacyEntry[]
): FallacyEntry[] {
  const seen = new Set(previous.map((f) => `${f.message}:${f.type}`));
  const merged = [...previous];
  for (const f of current) {
    const key = `${f.message}:${f.type}`;
    if (!seen.has(key)) {
      merged.push(f);
      seen.add(key);
    }
  }
  return merged;
}

/**
 * Pass 2: コードによる機械的スコア算出
 * AIの判断は一切入らない
 */
export function calculateScore(
  fallacies: FallacyEntry[],
  merits: string[]
): number {
  const BASE = 5;
  const penaltyTotal = fallacies.reduce((sum, f) => sum + Math.abs(f.penalty), 0);
  const meritTotal = merits.reduce((sum, m) => {
    for (const [key, points] of Object.entries(MERIT_POINTS)) {
      if (m.includes(key)) return sum + points;
    }
    return sum + 1; // 未知の加点理由はデフォルト1点
  }, 0);
  return Math.max(0, Math.min(10, BASE + meritTotal - penaltyTotal));
}

/**
 * Pass 1 (AI): 詭弁と加点要素の検出のみ
 * Pass 2 (コード): スコア算出
 */
export async function evaluateDebate(
  theme: string,
  allMessages: { content: string; isPlayer1: boolean }[],
  prevFallacies?: PreviousFallacies
): Promise<EvaluationResult> {
  // サニタイズ済みの対話ログを構築
  const dialogue = allMessages
    .map((m, i) => `${i + 1}. [${m.isPlayer1 ? "Player1" : "Player2"}] ${sanitizeContent(m.content)}`)
    .join("\n") || "（まだ発言なし）";

  // 前回検出済みの詭弁を文字列化（AIへの参考情報）
  const prevP1 = prevFallacies?.p1_fallacies || [];
  const prevP2 = prevFallacies?.p2_fallacies || [];
  const prevFallacySection =
    prevP1.length > 0 || prevP2.length > 0
      ? `\n■ 前回検出済みの詭弁（確定済み。これらは維持すること）
Player1: ${prevP1.length > 0 ? prevP1.map((f) => `M${f.message}:${f.type}`).join(", ") : "なし"}
Player2: ${prevP2.length > 0 ? prevP2.map((f) => `M${f.message}:${f.type}`).join(", ") : "なし"}
`
      : "";

  const prompt = loadPrompt("evaluation-detect", {
    theme,
    dialogue,
    prevFallacySection,
  });

  console.log("\n====== PASS 1: DETECTION PROMPT ======");
  console.log(prompt.user);
  console.log("======================================\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const responseText = response.choices[0]?.message?.content || "";
    console.log("====== PASS 1: AI DETECTION RESULT ======");
    console.log(responseText);
    console.log("=========================================\n");
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const cleanedJson = jsonMatch[0].replace(/:\s*\+(\d)/g, ": $1");
      const parsed = JSON.parse(cleanedJson);

      const newP1Fallacies: FallacyEntry[] = Array.isArray(parsed.p1_fallacies) ? parsed.p1_fallacies : [];
      const newP2Fallacies: FallacyEntry[] = Array.isArray(parsed.p2_fallacies) ? parsed.p2_fallacies : [];
      const p1Merits: string[] = Array.isArray(parsed.p1_merits) ? parsed.p1_merits : [];
      const p2Merits: string[] = Array.isArray(parsed.p2_merits) ? parsed.p2_merits : [];

      // 過去の検出結果とマージ（一度検出された詭弁は消えない）
      const p1Fallacies = mergeFallacies(prevP1, newP1Fallacies);
      const p2Fallacies = mergeFallacies(prevP2, newP2Fallacies);

      // Pass 2: コードで機械的にスコア算出
      const player1_score = calculateScore(p1Fallacies, p1Merits);
      const player2_score = calculateScore(p2Fallacies, p2Merits);

      console.log("====== PASS 2: SCORE CALCULATION ======");
      console.log(`P1: base=5, merits=${JSON.stringify(p1Merits)}, fallacies=${p1Fallacies.length}, score=${player1_score}`);
      console.log(`P2: base=5, merits=${JSON.stringify(p2Merits)}, fallacies=${p2Fallacies.length}, score=${player2_score}`);
      console.log("=======================================\n");

      const p1Contradictions = p1Fallacies.map((f) => `M${f.message}: ${f.type} - ${f.reason}`).join('; ');
      const p2Contradictions = p2Fallacies.map((f) => `M${f.message}: ${f.type} - ${f.reason}`).join('; ');

      return {
        player1_score,
        player2_score,
        latest_feedback: String(parsed.latest_feedback || ""),
        p1_fallacies: p1Fallacies,
        p2_fallacies: p2Fallacies,
        p1_merits: p1Merits,
        p2_merits: p2Merits,
        p1_contradictions: p1Contradictions,
        p2_contradictions: p2Contradictions,
      };
    }
  } catch (e) {
    console.error("Failed to parse AI response:", e);
  }

  return {
    player1_score: 0,
    player2_score: 0,
    latest_feedback: "評価できませんでした",
    p1_fallacies: [],
    p2_fallacies: [],
    p1_merits: [],
    p2_merits: [],
    p1_contradictions: "",
    p2_contradictions: "",
  };
}
