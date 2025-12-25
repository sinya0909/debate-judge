import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// サーバーサイド用Supabaseクライアント（service_roleキーでRLSをバイパス）
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type EvaluationResult = {
  logic_score: number
  reasoning: string
  issues: string[]
}

export async function POST(request: NextRequest) {
  try {
    const { messageId, debateId, userId, content, theme, previousMessages } = await request.json()

    // AI評価を取得
    const evaluation = await evaluateMessage(content, theme, previousMessages)

    // メッセージにAI評価を保存
    const { error: updateError } = await supabase
      .from('messages')
      .update({ ai_evaluation: evaluation })
      .eq('id', messageId)

    if (updateError) {
      console.error('Failed to update message:', updateError)
      return NextResponse.json({ error: 'Failed to save evaluation' }, { status: 500 })
    }

    // スコアを更新
    await updateScores(debateId, userId, evaluation.logic_score)

    // 終了条件チェック
    await checkEndCondition(debateId)

    return NextResponse.json({ evaluation })
  } catch (error) {
    console.error('Evaluation error:', error)
    return NextResponse.json({ error: 'Evaluation failed' }, { status: 500 })
  }
}

async function evaluateMessage(
  content: string,
  theme: string,
  previousMessages: { content: string; isPlayer1: boolean }[]
): Promise<EvaluationResult> {
  const conversationContext = previousMessages
    .map((m, i) => `${m.isPlayer1 ? 'Player1' : 'Player2'}: ${m.content}`)
    .join('\n')

  const prompt = `あなたは討論の審判です。以下の討論テーマと会話の流れを踏まえて、最新の発言を評価してください。

【討論テーマ】
${theme}

【これまでの会話】
${conversationContext || '（最初の発言）'}

【評価対象の発言】
${content}

以下の基準で評価し、JSON形式で回答してください：

1. logic_score: -3から+3の整数
   - +3: 非常に論理的で説得力のある主張、具体的根拠あり、反論を成功させた
   - +2: 論理的な主張、根拠の提示あり
   - +1: やや論理的、基本的な主張
   - 0: 中立的、単なる質問
   - -1: やや論理に問題あり、根拠不足
   - -2: 論理の飛躍、矛盾あり、負けを認める発言
   - -3: 人格攻撃、論点逸脱、重大な論理破綻、降参・ギブアップ

重要：「負けだ」「正しい」「認める」など相手の主張を認める発言は-2以下で評価すること。

2. reasoning: 評価理由（50文字以内）

3. issues: 問題点の配列（あれば）

回答はJSON形式のみで：
{"logic_score": 数値, "reasoning": "理由", "issues": ["問題1", "問題2"]}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'あなたは公平な討論審判です。JSON形式でのみ回答してください。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 200,
  })

  const responseText = response.choices[0]?.message?.content || ''

  try {
    // JSONを抽出（マークダウンコードブロックを除去）
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (e) {
    console.error('Failed to parse AI response:', responseText)
  }

  // パース失敗時のデフォルト
  return {
    logic_score: 0,
    reasoning: '評価できませんでした',
    issues: [],
  }
}

async function updateScores(debateId: string, userId: string, score: number) {
  const { data: debate } = await supabase
    .from('debates')
    .select('player1_id, player2_id, player1_score, player2_score')
    .eq('id', debateId)
    .single()

  if (!debate) return

  const isPlayer1 = userId === debate.player1_id
  const newScore = isPlayer1
    ? { player1_score: debate.player1_score + score }
    : { player2_score: debate.player2_score + score }

  await supabase.from('debates').update(newScore).eq('id', debateId)
}

async function checkEndCondition(debateId: string) {
  const { data: debate } = await supabase
    .from('debates')
    .select('*')
    .eq('id', debateId)
    .single()

  if (!debate || debate.status !== 'active') return

  const settings = debate.settings as { point_diff: number; time_limit: number; max_comments: number }
  const scoreDiff = Math.abs(debate.player1_score - debate.player2_score)

  // ポイント差による終了
  if (scoreDiff >= settings.point_diff) {
    const winnerId = debate.player1_score > debate.player2_score
      ? debate.player1_id
      : debate.player2_id

    await supabase
      .from('debates')
      .update({
        status: 'finished',
        winner_id: winnerId,
        finished_at: new Date().toISOString(),
      })
      .eq('id', debateId)

    // ユーザー統計を更新
    await updateUserStats(debate.player1_id, debate.player2_id, winnerId)
  }

  // コメント数による終了
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('debate_id', debateId)

  if (count && count >= settings.max_comments * 2) {
    const winnerId = debate.player1_score > debate.player2_score
      ? debate.player1_id
      : debate.player1_score < debate.player2_score
        ? debate.player2_id
        : null // 引き分け

    await supabase
      .from('debates')
      .update({
        status: 'finished',
        winner_id: winnerId,
        finished_at: new Date().toISOString(),
      })
      .eq('id', debateId)

    if (winnerId) {
      await updateUserStats(debate.player1_id, debate.player2_id, winnerId)
    }
  }
}

async function updateUserStats(player1Id: string, player2Id: string, winnerId: string) {
  const loserId = winnerId === player1Id ? player2Id : player1Id

  // 勝者の統計更新
  await supabase.rpc('increment_wins', { user_id: winnerId }).catch(() => {
    // RPC未定義の場合は直接更新
    supabase
      .from('users')
      .update({ wins: supabase.rpc('increment', { x: 1 }) })
      .eq('id', winnerId)
  })

  // 簡易的に直接更新
  const { data: winner } = await supabase.from('users').select('wins, debate_count').eq('id', winnerId).single()
  if (winner) {
    await supabase.from('users').update({
      wins: winner.wins + 1,
      debate_count: winner.debate_count + 1,
    }).eq('id', winnerId)
  }

  const { data: loser } = await supabase.from('users').select('losses, debate_count').eq('id', loserId).single()
  if (loser) {
    await supabase.from('users').update({
      losses: loser.losses + 1,
      debate_count: loser.debate_count + 1,
    }).eq('id', loserId)
  }
}
