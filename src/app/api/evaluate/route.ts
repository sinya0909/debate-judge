import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { endDebate } from "@/lib/debate-service";
import { AI_USER_ID } from "@/lib/constants";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type EvaluationResult = {
  player1_score: number;
  player2_score: number;
  latest_feedback: string;
};

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

    // 各プレイヤーの議論を分離して全体評価
    const evaluation = await evaluateDebate(theme, allMessages);

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
      await handleAITurn(debateId, theme, allMessages);
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
  currentMessages: { content: string; isPlayer1: boolean }[]
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

  const aiEvaluation = await evaluateDebate(theme, allMessagesWithAI);

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

  const prompt = `あなたは討論の参加者（Player2）です。相手（Player1）に反論してください。

【討論テーマ】
${theme}

【これまでの議論】
${conversationHistory}

以下のルールに従って反論してください：
- 200文字以内で簡潔に
- 相手の論点に直接反論する
- 具体的な根拠や事例を示す
- 感情的にならず論理的に

反論のみを出力してください（前置きや説明は不要）：`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "あなたは討論の参加者です。相手の主張に対して論理的かつ具体的に反論してください。",
        },
        { role: "user", content: prompt },
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

async function evaluateDebate(
  theme: string,
  allMessages: { content: string; isPlayer1: boolean }[]
): Promise<EvaluationResult> {
  const dialogue = allMessages
    .map((m, i) => `${i + 1}. [${m.isPlayer1 ? "Player1" : "Player2"}] ${m.content}`)
    .join("\n");

  const prompt = `あなたは討論の審判です。以下の討論を時系列で読み、各プレイヤーを評価してください。

【討論テーマ】
${theme}

【討論の流れ】
${dialogue || "（まだ発言なし）"}

まず、各プレイヤーの発言に矛盾がないか確認してください。
例：以前「Xは失敗した」と言ったのに後で「Xは成功した」と言っている等。
矛盾が見つかった場合、そのプレイヤーのスコアを大きく下げてください。
相手の矛盾を正しく指摘したプレイヤーは加点してください。

その上で、各プレイヤーを0〜10点で総合評価してください：

評価基準：
- 反論の的確さ: 相手の主張に直接反論できているか（論点ずらしは減点）
- 論理の一貫性: 自身の過去の発言と矛盾していないか（矛盾は-3点）
- 主張の発展性: そのプレイヤー自身が過去の自分の発言と比べて新しい論点・根拠を提示できているか
- 議論の主導権: 相手に答えさせているか
- 矛盾の指摘: 相手の矛盾を突いているか（正当な戦術として加点）

JSON形式のみで回答：
{"p1_contradictions": "Player1の矛盾（なければ空文字）", "p2_contradictions": "Player2の矛盾（なければ空文字）", "player1_score": 数値, "player2_score": 数値, "latest_feedback": "最新発言へのフィードバック（30文字以内）"}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "討論の審判です。JSON形式でのみ回答してください。判定上の注意：相手の過去の発言との矛盾を指摘する行為は「論点ずらし」ではなく、正当な反論技術です。矛盾を突かれた側が回答を避けている場合、突いた側を加点し避けた側を減点してください。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 400,
    });

    const responseText = response.choices[0]?.message?.content || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const cleanedJson = jsonMatch[0].replace(/:\s*\+(\d)/g, ": $1");
      const parsed = JSON.parse(cleanedJson);

      return {
        player1_score: Math.max(0, Math.min(10, Math.round(parsed.player1_score || 0))),
        player2_score: Math.max(0, Math.min(10, Math.round(parsed.player2_score || 0))),
        latest_feedback: String(parsed.latest_feedback || ""),
      };
    }
  } catch (e) {
    console.error("Failed to parse AI response:", e);
  }

  return {
    player1_score: 0,
    player2_score: 0,
    latest_feedback: "評価できませんでした",
  };
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
