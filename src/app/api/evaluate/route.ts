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

type FallacyEntry = {
  message: number;
  player: string;
  type: string;
  reason: string;
  penalty: number;
};

type EvaluationResult = {
  player1_score: number;
  player2_score: number;
  latest_feedback: string;
  p1_fallacies: FallacyEntry[];
  p2_fallacies: FallacyEntry[];
  p1_merits: string[];
  p2_merits: string[];
  // 旧互換
  p1_contradictions: string;
  p2_contradictions: string;
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
- 相手の論理構造の欠陥（飛躍・暗黙の前提・誤謬）を突く
- 前提から結論への論理的接続を明示する
- 感情的にならず論理的に

反論のみを出力してください（前置きや説明は不要）：`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "あなたは討論の参加者です。相手の主張の論理構造の欠陥を突き、自身の推論の論理的接続を明示して反論してください。",
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

/**
 * 加点ルールの点数マップ
 */
const MERIT_POINTS: Record<string, number> = {
  "相手の誤謬を正確に指摘": 2,
  "帰謬法・背理法による有効な反論": 2,
  "前提の妥当性への正当な疑義": 1,
  "相手の暗黙の前提を顕在化して攻撃": 1,
  "論理的接続が明確で飛躍がない推論": 1,
};

/**
 * Pass 2: コードによる機械的スコア算出
 * AIの判断は一切入らない
 */
function calculateScore(
  fallacies: FallacyEntry[],
  merits: string[]
): number {
  const BASE = 5;
  const penaltyTotal = fallacies.reduce((sum, f) => sum + Math.abs(f.penalty), 0);
  const meritTotal = merits.reduce((sum, m) => {
    // 加点理由文字列からマッチする項目を探す
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
async function evaluateDebate(
  theme: string,
  allMessages: { content: string; isPlayer1: boolean }[]
): Promise<EvaluationResult> {
  const dialogue = allMessages
    .map((m, i) => `${i + 1}. [${m.isPlayer1 ? "Player1" : "Player2"}] ${m.content}`)
    .join("\n");

  // Pass 1: AIに検出のみを依頼（スコア算出はさせない）
  const prompt = `あなたは討論の審判です。以下の討論を読み、詭弁と加点要素を検出してください。
スコアの算出は不要です。検出のみ行ってください。

【討論テーマ】
${theme}

【討論の流れ】
${dialogue || "（まだ発言なし）"}

■ 詭弁の検出
各発言について「誰が」「何番の発言で」「どの詭弁を犯したか」を特定してください。

帰属ルール（厳守）：
- 詭弁を犯した側のplayerフィールドにその人物を記入すること
- 「Xの主張はYだ」と歪曲した場合、歪曲した側が藁人形論法の犯人
- 相手の論理を問い返す行為（帰謬法）は詭弁ではない。「あなたの論理に従うとこうなるが？」は正当な論理操作
- 「必要条件ではない」と「不要」は異なる主張。混同して攻撃した場合、混同した側が藁人形論法

詭弁の種類：
致命的（penalty: -5）：藁人形論法（主張の歪曲・スコープ不当拡大縮小・論点すり替え）、人身攻撃、自己矛盾
重度（penalty: -3）：循環論法、誤った二項対立、多義語の誤用、早まった一般化、権威・多数派・伝統への訴え
軽度（penalty: -2）：論点への未応答・回避、ゴールポストの移動、特殊弁護

■ 加点要素の検出
以下に該当するものを各プレイヤーについて列挙：
- 相手の誤謬を正確に指摘
- 帰謬法・背理法による有効な反論
- 前提の妥当性への正当な疑義
- 相手の暗黙の前提を顕在化して攻撃
- 論理的接続が明確で飛躍がない推論

根拠・事例の有無は加点にも減点にも含めないこと。

■ 出力（JSON形式のみ、スコアは不要）：
{
  "p1_fallacies": [{"message": 発言番号, "player": "Player1", "type": "詭弁名", "reason": "理由", "penalty": -数値}],
  "p2_fallacies": [{"message": 発言番号, "player": "Player2", "type": "詭弁名", "reason": "理由", "penalty": -数値}],
  "p1_merits": ["加点理由"],
  "p2_merits": ["加点理由"],
  "latest_feedback": "最新発言へのフィードバック（30文字以内）"
}`;

  console.log("\n====== PASS 1: DETECTION PROMPT ======");
  console.log(prompt);
  console.log("======================================\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "討論の審判です。あなたの仕事は詭弁と加点要素の検出のみです。スコアは算出しないでください。JSON形式でのみ回答。帰属先に細心の注意を払うこと：帰謬法（相手の論理を使って矛盾を導く操作）は詭弁ではなく正当な論理操作です。根拠の有無は一切評価に含めないでください。",
        },
        { role: "user", content: prompt },
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

      const p1Fallacies: FallacyEntry[] = Array.isArray(parsed.p1_fallacies) ? parsed.p1_fallacies : [];
      const p2Fallacies: FallacyEntry[] = Array.isArray(parsed.p2_fallacies) ? parsed.p2_fallacies : [];
      const p1Merits: string[] = Array.isArray(parsed.p1_merits) ? parsed.p1_merits : [];
      const p2Merits: string[] = Array.isArray(parsed.p2_merits) ? parsed.p2_merits : [];

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
