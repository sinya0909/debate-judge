import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type DebateForEnd = {
  theme: string
  player1_id: string
  player2_id: string
  player1_score: number
  player2_score: number
}

/**
 * スコア差から勝者を判定。差が0.5以下なら引き分け(null)
 */
export function determineWinner(
  player1Id: string,
  player2Id: string,
  player1Score: number,
  player2Score: number
): string | null {
  const diff = (player1Score || 0) - (player2Score || 0)
  if (diff > 0.5) return player1Id
  if (diff < -0.5) return player2Id
  return null
}

/**
 * 討論スキル評価の総評を生成
 */
export async function generateSummary(
  theme: string,
  messages: { content: string; user_id: string }[],
  player1Id: string,
  player2Id: string
): Promise<{ player1_reason: string; player2_reason: string }> {
  const player1Args = messages
    .filter((m) => m.user_id === player1Id)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join('\n')

  const player2Args = messages
    .filter((m) => m.user_id === player2Id)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join('\n')

  const prompt = `あなたは討論の審判です。各プレイヤーの討論者としてのパフォーマンスを評価してください。
議論内容の要約ではなく、論理構造の妥当性（推論の接続・誤謬の有無）・相手の論理的欠陥を突く力・反論の構造的正確さの観点で評価してください。根拠や事例の有無ではなく、論理の質を評価してください。

【討論テーマ】
${theme}

【Player1の議論】
${player1Args || '（発言なし）'}

【Player2の議論】
${player2Args || '（発言なし）'}

各プレイヤーへの評価を簡潔に述べてください（各50文字以内の文字列で）。

JSON形式で回答：
{"player1_reason": "Player1への評価（文字列）", "player2_reason": "Player2への評価（文字列）"}`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            '討論の審判です。議論内容の要約ではなく、各プレイヤーの論理構造の妥当性と相手の誤謬を突く力を評価してください。根拠・事例の有無は評価基準に含めないこと。JSON形式でのみ回答し、値は必ず文字列にしてください。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 300,
    })

    const responseText = response.choices[0]?.message?.content || ''
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        player1_reason: String(parsed.player1_reason || ''),
        player2_reason: String(parsed.player2_reason || ''),
      }
    }
  } catch (e) {
    console.error('Summary generation error:', e)
  }

  return { player1_reason: '', player2_reason: '' }
}

/**
 * ユーザー統計を更新。引き分け時は両者のdebate_countを増加。
 * excludeIds に含まれるユーザーは統計更新をスキップ（AI等）
 */
export async function updateUserStats(
  player1Id: string,
  player2Id: string,
  winnerId: string | null,
  excludeIds: string[] = []
) {
  const players = [player1Id, player2Id].filter(
    (id) => !excludeIds.includes(id)
  )

  if (winnerId) {
    for (const playerId of players) {
      const isWinner = playerId === winnerId
      const { data } = await supabase
        .from('users')
        .select('wins, losses, debate_count')
        .eq('id', playerId)
        .single()

      if (data) {
        await supabase
          .from('users')
          .update({
            wins: data.wins + (isWinner ? 1 : 0),
            losses: data.losses + (isWinner ? 0 : 1),
            debate_count: data.debate_count + 1,
          })
          .eq('id', playerId)
      }
    }
  } else {
    // 引き分け: 両者の debate_count を増加
    for (const playerId of players) {
      const { data } = await supabase
        .from('users')
        .select('debate_count')
        .eq('id', playerId)
        .single()

      if (data) {
        await supabase
          .from('users')
          .update({ debate_count: data.debate_count + 1 })
          .eq('id', playerId)
      }
    }
  }
}

/**
 * 討論を終了する（総評生成→勝者判定→DB更新→統計更新）
 * excludeStatsIds: 統計更新から除外するユーザーID
 */
export async function endDebate(
  debateId: string,
  debate: DebateForEnd,
  excludeStatsIds: string[] = []
) {
  const { data: messages } = await supabase
    .from('messages')
    .select('content, user_id')
    .eq('debate_id', debateId)
    .order('created_at', { ascending: true })

  let summary = { player1_reason: '', player2_reason: '' }

  if (messages && messages.length >= 2) {
    summary = await generateSummary(
      debate.theme,
      messages,
      debate.player1_id,
      debate.player2_id
    )
  }

  const winnerId = determineWinner(
    debate.player1_id,
    debate.player2_id,
    debate.player1_score,
    debate.player2_score
  )

  const { error: updateError } = await supabase
    .from('debates')
    .update({
      status: 'finished',
      winner_id: winnerId,
      final_summary: summary,
      finished_at: new Date().toISOString(),
    })
    .eq('id', debateId)

  if (updateError) {
    console.error('Failed to update debate:', updateError)
    await supabase
      .from('debates')
      .update({
        status: 'finished',
        winner_id: winnerId,
        finished_at: new Date().toISOString(),
      })
      .eq('id', debateId)
  }

  await updateUserStats(
    debate.player1_id,
    debate.player2_id,
    winnerId,
    excludeStatsIds
  )

  return winnerId
}
