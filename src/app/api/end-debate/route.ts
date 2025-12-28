import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: NextRequest) {
  try {
    const { debateId, reason } = await request.json()

    const { data: debate } = await supabase
      .from('debates')
      .select('*')
      .eq('id', debateId)
      .single()

    if (!debate || debate.status !== 'active') {
      return NextResponse.json({ error: 'Invalid debate' }, { status: 400 })
    }

    // 全メッセージを取得して総評を作成
    const { data: messages } = await supabase
      .from('messages')
      .select('content, user_id')
      .eq('debate_id', debateId)
      .order('created_at', { ascending: true })

    let summary = {
      player1_reason: '',
      player2_reason: '',
    }

    if (messages && messages.length >= 2) {
      summary = await generateSummary(
        debate.theme,
        messages,
        debate.player1_id,
        debate.player2_id
      )
    }

    // 最終スコア = 優勢度 + (発言スコア差 / 5)
    const advantage = debate.advantage || 0
    const scoreDiff = debate.player1_score - debate.player2_score
    const finalScore = advantage + (scoreDiff / 5)

    // 勝者判定
    let winnerId = null
    if (finalScore > 0.5) {
      winnerId = debate.player1_id
    } else if (finalScore < -0.5) {
      winnerId = debate.player2_id
    }
    // -0.5〜0.5は引き分け

    // 討論を終了
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

    // ユーザー統計を更新
    if (winnerId) {
      const loserId = winnerId === debate.player1_id ? debate.player2_id : debate.player1_id

      const { data: winner } = await supabase
        .from('users')
        .select('wins, debate_count')
        .eq('id', winnerId)
        .single()

      if (winner) {
        await supabase.from('users').update({
          wins: winner.wins + 1,
          debate_count: winner.debate_count + 1,
        }).eq('id', winnerId)
      }

      const { data: loser } = await supabase
        .from('users')
        .select('losses, debate_count')
        .eq('id', loserId)
        .single()

      if (loser) {
        await supabase.from('users').update({
          losses: loser.losses + 1,
          debate_count: loser.debate_count + 1,
        }).eq('id', loserId)
      }
    } else {
      // 引き分けの場合、両者の debate_count を増やす
      for (const playerId of [debate.player1_id, debate.player2_id]) {
        const { data: player } = await supabase
          .from('users')
          .select('debate_count')
          .eq('id', playerId)
          .single()

        if (player) {
          await supabase.from('users').update({
            debate_count: player.debate_count + 1,
          }).eq('id', playerId)
        }
      }
    }

    return NextResponse.json({
      success: true,
      winnerId,
      reason,
      finalScore,
    })
  } catch (error) {
    console.error('End debate error:', error)
    return NextResponse.json({ error: 'Failed to end debate' }, { status: 500 })
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
      const player = m.user_id === player1Id ? 'Player1' : 'Player2'
      return `${player}: ${m.content}`
    })
    .join('\n')

  const prompt = `あなたは討論の審判です。以下の討論全体を総評してください。

【討論テーマ】
${theme}

【討論内容】
${conversation}

各プレイヤーの総評を簡潔に述べてください（各50文字以内）：
- 良かった点
- 改善点

JSON形式で回答：
{"player1_reason": "Player1の総評", "player2_reason": "Player2の総評"}`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '討論の総評を行う審判です。JSON形式でのみ回答してください。' },
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
        player1_reason: parsed.player1_reason || '',
        player2_reason: parsed.player2_reason || '',
      }
    }
  } catch (e) {
    console.error('Summary generation error:', e)
  }

  return { player1_reason: '', player2_reason: '' }
}
