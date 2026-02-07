import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import { loadPrompt } from '@/lib/prompts/loader'

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
    .join('\n') || '（発言なし）'

  const player2Args = messages
    .filter((m) => m.user_id === player2Id)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join('\n') || '（発言なし）'

  const prompt = loadPrompt('summary', { theme, player1Args, player2Args })

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
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
