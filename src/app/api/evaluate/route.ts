import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

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
      .select("player1_id, player2_id")
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
    await checkEndCondition(debateId);

    return NextResponse.json({ evaluation });
  } catch (error) {
    console.error("Evaluation error:", error);
    return NextResponse.json({ error: "Evaluation failed" }, { status: 500 });
  }
}

async function evaluateDebate(
  theme: string,
  allMessages: { content: string; isPlayer1: boolean }[]
): Promise<EvaluationResult> {
  const player1Args = allMessages
    .filter((m) => m.isPlayer1)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join("\n");

  const player2Args = allMessages
    .filter((m) => !m.isPlayer1)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join("\n");

  const prompt = `あなたは討論の審判です。各プレイヤーの議論全体を評価してください。

【討論テーマ】
${theme}

【Player1の議論】
${player1Args || "（まだ発言なし）"}

【Player2の議論】
${player2Args || "（まだ発言なし）"}

各プレイヤーの議論を以下の観点で0〜10点で総合評価してください：

評価基準：
- 論理の一貫性: 主張が矛盾なく一貫しているか
- 根拠の具体性: 具体的な根拠・事例を示しているか
- 反論の成功度: 相手の主張を効果的に崩せているか
- 議論の主導権: 議論をリードし、相手に答えさせているか
- 前提への問い: 相手の前提や定義を的確に突いているか

加えて、最新の発言に対する短いフィードバックを書いてください。

JSON形式のみで回答：
{"player1_score": 数値, "player2_score": 数値, "latest_feedback": "最新発言へのフィードバック（30文字以内）"}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "討論の審判です。各プレイヤーの議論全体を公平に評価します。JSON形式でのみ回答してください。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 200,
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

async function checkEndCondition(debateId: string) {
  const { data: debate } = await supabase
    .from("debates")
    .select("*")
    .eq("id", debateId)
    .single();

  if (!debate || debate.status !== "active") return;

  const settings = debate.settings as {
    time_limit: number;
    max_comments: number;
  };

  const { count } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("debate_id", debateId);

  if (count && count >= settings.max_comments * 2) {
    await endDebate(debateId, debate);
  }
}

async function endDebate(
  debateId: string,
  debate: {
    theme: string;
    player1_id: string;
    player2_id: string;
    player1_score: number;
    player2_score: number;
  }
) {
  const { data: messages } = await supabase
    .from("messages")
    .select("content, user_id")
    .eq("debate_id", debateId)
    .order("created_at", { ascending: true });

  let summary = {
    player1_reason: "",
    player2_reason: "",
  };

  if (messages && messages.length >= 2) {
    summary = await generateSummary(
      debate.theme,
      messages,
      debate.player1_id,
      debate.player2_id
    );
  }

  // 勝者判定: スコア差で決定
  const diff = (debate.player1_score || 0) - (debate.player2_score || 0);
  let winnerId = null;
  if (diff > 0.5) {
    winnerId = debate.player1_id;
  } else if (diff < -0.5) {
    winnerId = debate.player2_id;
  }

  const { error: updateError } = await supabase
    .from("debates")
    .update({
      status: "finished",
      winner_id: winnerId,
      final_summary: summary,
      finished_at: new Date().toISOString(),
    })
    .eq("id", debateId);

  if (updateError) {
    console.error("Failed to update debate:", updateError);
    await supabase
      .from("debates")
      .update({
        status: "finished",
        winner_id: winnerId,
        finished_at: new Date().toISOString(),
      })
      .eq("id", debateId);
  }

  if (winnerId) {
    await updateUserStats(debate.player1_id, debate.player2_id, winnerId);
  }
}

async function generateSummary(
  theme: string,
  messages: { content: string; user_id: string }[],
  player1Id: string,
  player2Id: string
) {
  const player1Args = messages
    .filter((m) => m.user_id === player1Id)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join("\n");

  const player2Args = messages
    .filter((m) => m.user_id === player2Id)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join("\n");

  const prompt = `あなたは討論の審判です。以下の討論全体を総評してください。

【討論テーマ】
${theme}

【Player1の議論】
${player1Args || "（発言なし）"}

【Player2の議論】
${player2Args || "（発言なし）"}

各プレイヤーの総評を簡潔に述べてください（各50文字以内の文字列で）。

JSON形式で回答：
{"player1_reason": "Player1の総評（文字列）", "player2_reason": "Player2の総評（文字列）"}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "討論の総評を行う審判です。JSON形式でのみ回答してください。値は必ず文字列にしてください。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    const responseText = response.choices[0]?.message?.content || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        player1_reason: String(parsed.player1_reason || ""),
        player2_reason: String(parsed.player2_reason || ""),
      };
    }
  } catch (e) {
    console.error("Summary generation error:", e);
  }

  return { player1_reason: "", player2_reason: "" };
}

async function updateUserStats(
  player1Id: string,
  player2Id: string,
  winnerId: string
) {
  const loserId = winnerId === player1Id ? player2Id : player1Id;

  const { data: winner } = await supabase
    .from("users")
    .select("wins, debate_count")
    .eq("id", winnerId)
    .single();
  if (winner) {
    await supabase
      .from("users")
      .update({ wins: winner.wins + 1, debate_count: winner.debate_count + 1 })
      .eq("id", winnerId);
  }

  const { data: loser } = await supabase
    .from("users")
    .select("losses, debate_count")
    .eq("id", loserId)
    .single();
  if (loser) {
    await supabase
      .from("users")
      .update({
        losses: loser.losses + 1,
        debate_count: loser.debate_count + 1,
      })
      .eq("id", loserId);
  }
}
