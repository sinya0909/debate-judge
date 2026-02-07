import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { endDebate } from "@/lib/debate-service";
import { AI_USER_ID } from "@/lib/constants";
import { evaluateDebate } from "@/lib/evaluation";
import { loadPrompt } from "@/lib/prompts/loader";
import type { EvaluationResult, PreviousFallacies } from "@/lib/types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { messageId, debateId, userId, content, theme, previousMessages } =
      await request.json();

    const { data: debate } = await supabase
      .from("debates")
      .select("player1_id, player2_id, settings, status")
      .eq("id", debateId)
      .single();

    if (!debate) {
      return NextResponse.json({ error: "Debate not found" }, { status: 404 });
    }

    const isPlayer1 = userId === debate.player1_id;
    const allMessages = [
      ...previousMessages,
      { content, isPlayer1 },
    ] as { content: string; isPlayer1: boolean }[];

    // 前回の評価結果を取得（詭弁の累積用）
    const { data: lastEvalMsg } = await supabase
      .from("messages")
      .select("ai_evaluation")
      .eq("debate_id", debateId)
      .not("ai_evaluation", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const prevFallacies: PreviousFallacies = {
      p1_fallacies: lastEvalMsg?.ai_evaluation?.p1_fallacies || [],
      p2_fallacies: lastEvalMsg?.ai_evaluation?.p2_fallacies || [],
    };

    // 各プレイヤーの議論を分離して全体評価
    const evaluation = await evaluateDebate(theme, allMessages, prevFallacies);

    // メッセージにフィードバックを保存
    await supabase
      .from("messages")
      .update({ ai_evaluation: evaluation })
      .eq("id", messageId);

    // 討論テーブルのスコアと優勢度を更新
    const advantage = evaluation.player1_score - evaluation.player2_score;
    await supabase
      .from("debates")
      .update({
        player1_score: evaluation.player1_score,
        player2_score: evaluation.player2_score,
        advantage,
      })
      .eq("id", debateId);

    // 終了条件チェック
    const ended = await checkEndCondition(debateId);

    // AI対戦: 人間の発言後にAI応答を生成
    const settings = debate.settings as { is_ai_match?: boolean };
    if (!ended && settings.is_ai_match && userId !== AI_USER_ID) {
      await handleAITurn(debateId, theme, allMessages, evaluation);
    }

    return NextResponse.json({ evaluation });
  } catch (error) {
    console.error("Evaluation error:", error);
    return NextResponse.json({ error: "Evaluation failed" }, { status: 500 });
  }
}

/**
 * AI対戦時のAIターン処理
 */
async function handleAITurn(
  debateId: string,
  theme: string,
  currentMessages: { content: string; isPlayer1: boolean }[],
  lastEvaluation: EvaluationResult
) {
  // 重複防止: 最新メッセージがAIでないか確認
  const { data: latestMessages } = await supabase
    .from("messages")
    .select("user_id")
    .eq("debate_id", debateId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (latestMessages?.[0]?.user_id === AI_USER_ID) return;

  // 討論がまだactiveか確認
  const { data: debateCheck } = await supabase
    .from("debates")
    .select("status")
    .eq("id", debateId)
    .single();

  if (!debateCheck || debateCheck.status !== "active") return;

  // AI応答を生成
  const aiResponse = await generateAIResponse(theme, currentMessages);

  // メッセージを挿入（Realtime → UI自動更新）
  const { data: aiMessage } = await supabase
    .from("messages")
    .insert({
      debate_id: debateId,
      user_id: AI_USER_ID,
      content: aiResponse,
    })
    .select("id")
    .single();

  if (!aiMessage) return;

  // AI発言を含む全メッセージで再評価
  const allMessagesWithAI = [
    ...currentMessages,
    { content: aiResponse, isPlayer1: false },
  ];

  const prevFallaciesForAI: PreviousFallacies = {
    p1_fallacies: lastEvaluation.p1_fallacies,
    p2_fallacies: lastEvaluation.p2_fallacies,
  };
  const aiEvaluation = await evaluateDebate(theme, allMessagesWithAI, prevFallaciesForAI);

  // AI発言のフィードバックを保存
  await supabase
    .from("messages")
    .update({ ai_evaluation: aiEvaluation })
    .eq("id", aiMessage.id);

  // スコア更新
  const advantage = aiEvaluation.player1_score - aiEvaluation.player2_score;
  await supabase
    .from("debates")
    .update({
      player1_score: aiEvaluation.player1_score,
      player2_score: aiEvaluation.player2_score,
      advantage,
    })
    .eq("id", debateId);

  // 終了条件チェック
  await checkEndCondition(debateId);
}

/**
 * AI（Player2）の反論を生成
 */
async function generateAIResponse(
  theme: string,
  allMessages: { content: string; isPlayer1: boolean }[]
): Promise<string> {
  const conversationHistory = allMessages
    .map((m) => `${m.isPlayer1 ? "相手" : "あなた"}: ${m.content}`)
    .join("\n");

  const prompt = loadPrompt("ai-response", { theme, conversationHistory });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const text = response.choices[0]?.message?.content?.trim() || "";
    // 200文字制限
    return text.slice(0, 200);
  } catch (e) {
    console.error("AI response generation error:", e);
    return "（AI応答の生成に失敗しました）";
  }
}

/**
 * 終了条件チェック。終了した場合trueを返す。
 */
async function checkEndCondition(debateId: string): Promise<boolean> {
  const { data: debate } = await supabase
    .from("debates")
    .select("*")
    .eq("id", debateId)
    .single();

  if (!debate || debate.status !== "active") return true;

  const settings = debate.settings as {
    time_limit: number;
    max_comments: number;
    is_ai_match?: boolean;
  };

  const { count } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("debate_id", debateId);

  if (count && count >= settings.max_comments * 2) {
    const excludeIds = settings.is_ai_match ? [AI_USER_ID] : [];
    await endDebate(debateId, debate, excludeIds);
    return true;
  }

  return false;
}
