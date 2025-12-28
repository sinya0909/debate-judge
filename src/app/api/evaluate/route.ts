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
  statement_score: number; // 発言スコア -2〜+2
  advantage: number; // 優勢度 -10〜+10 (正: Player1優勢、負: Player2優勢)
  reasoning: string;
};

export async function POST(request: NextRequest) {
  try {
    const { messageId, debateId, userId, content, theme, previousMessages } =
      await request.json();

    // 現在のメッセージを含めた全発言リストを作成
    const { data: debate } = await supabase
      .from("debates")
      .select("player1_id, player2_id, player1_score, player2_score")
      .eq("id", debateId)
      .single();

    if (!debate) {
      return NextResponse.json({ error: "Debate not found" }, { status: 404 });
    }

    const isPlayer1 = userId === debate.player1_id;
    const allMessages = [
      ...previousMessages,
      { content, isPlayer1 }
    ];

    // AI評価を取得（全発言を見て優勢度も判定）
    const evaluation = await evaluateMessage(content, theme, allMessages, isPlayer1);

    // メッセージにAI評価を保存
    await supabase
      .from("messages")
      .update({ ai_evaluation: evaluation })
      .eq("id", messageId);

    // 発言スコアを累積
    const newScore = isPlayer1
      ? { player1_score: debate.player1_score + evaluation.statement_score }
      : { player2_score: debate.player2_score + evaluation.statement_score };

    // 優勢度も更新
    await supabase
      .from("debates")
      .update({ ...newScore, advantage: evaluation.advantage })
      .eq("id", debateId);

    // 終了条件チェック
    await checkEndCondition(debateId);

    return NextResponse.json({ evaluation });
  } catch (error) {
    console.error("Evaluation error:", error);
    return NextResponse.json({ error: "Evaluation failed" }, { status: 500 });
  }
}

async function evaluateMessage(
  content: string,
  theme: string,
  allMessages: { content: string; isPlayer1: boolean }[],
  isCurrentPlayer1: boolean
): Promise<EvaluationResult> {
  const conversationContext = allMessages
    .map((m) => `${m.isPlayer1 ? "Player1" : "Player2"}: ${m.content}`)
    .join("\n");

  const currentPlayer = isCurrentPlayer1 ? "Player1" : "Player2";

  const prompt = `あなたは討論の審判です。討論全体を見て、最新の発言を評価し、現時点での優勢度を判定してください。

【討論テーマ】
${theme}

【討論全体】
${conversationContext}

【評価対象】
最新の発言者: ${currentPlayer}
最新の発言: 「${content}」

## 2つの評価を行ってください

### 1. 発言スコア (statement_score): -2〜+2
この発言単体の質を評価：
- +2: 相手の主張を的確に論破、具体的根拠あり
- +1: 論理的な主張・反論
- 0: 普通の発言、質問
- -1: 根拠不足、関連が薄い
- -2: 論点ずらし、質問無視、負けを認める

### 2. 優勢度 (advantage): -10〜+10
討論全体を通して、現時点でどちらが優勢かを判定：
- +10: Player1が圧倒的優勢（論破済み）
- +5: Player1がやや優勢
- 0: 互角
- -5: Player2がやや優勢
- -10: Player2が圧倒的優勢

優勢度の判断基準：
- 一貫性: 主張が矛盾なく一貫しているか
- 論理構成: 論理的に整理された主張か
- 反論の成功: 相手の主張を崩せているか
- 主導権: 議論をリードしているか

【重要】
- 他者の事例引用（「〇〇は敗北した」等）は論拠として評価
- 相手の一部を認めつつ反論は建設的（減点しない）

JSON形式のみで回答：
{"statement_score": 数値, "advantage": 数値, "reasoning": "50文字以内の評価理由"}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "討論の審判です。発言評価と優勢度判定を行います。JSON形式でのみ回答してください。",
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
        statement_score: Math.max(-2, Math.min(2, Math.round(parsed.statement_score || 0))),
        advantage: Math.max(-10, Math.min(10, Math.round(parsed.advantage || 0))),
        reasoning: parsed.reasoning || "",
      };
    }
  } catch (e) {
    console.error("Failed to parse AI response:", e);
  }

  return {
    statement_score: 0,
    advantage: 0,
    reasoning: "評価できませんでした",
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

  // コメント数による終了のみ（10点差終了は廃止）
  const { count } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("debate_id", debateId);

  if (count && count >= settings.max_comments * 2) {
    await endDebate(debateId, debate);
  }
}

async function endDebate(debateId: string, debate: {
  theme: string;
  player1_id: string;
  player2_id: string;
  player1_score: number;
  player2_score: number;
  advantage?: number;
}) {
  // 全メッセージを取得して総評を作成
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

  // 最終スコア = 優勢度 + (発言スコア差 / 5)
  const advantage = debate.advantage || 0;
  const scoreDiff = debate.player1_score - debate.player2_score;
  const finalScore = advantage + (scoreDiff / 5);

  // 勝者判定
  let winnerId = null;
  if (finalScore > 0.5) {
    winnerId = debate.player1_id;
  } else if (finalScore < -0.5) {
    winnerId = debate.player2_id;
  }
  // -0.5〜0.5は引き分け

  // 討論を終了
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

  // ユーザー統計を更新
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
  const conversation = messages
    .map((m) => {
      const player = m.user_id === player1Id ? "Player1" : "Player2";
      return `${player}: ${m.content}`;
    })
    .join("\n");

  const prompt = `あなたは討論の審判です。以下の討論全体を総評してください。

【討論テーマ】
${theme}

【討論内容】
${conversation}

各プレイヤーの総評を簡潔に述べてください（各50文字以内）：
- 良かった点
- 改善点

JSON形式で回答：
{"player1_reason": "Player1の総評", "player2_reason": "Player2の総評"}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "討論の総評を行う審判です。JSON形式でのみ回答してください。" },
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
        player1_reason: parsed.player1_reason || "",
        player2_reason: parsed.player2_reason || "",
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
      .update({ losses: loser.losses + 1, debate_count: loser.debate_count + 1 })
      .eq("id", loserId);
  }
}
