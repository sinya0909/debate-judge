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

    // 勝者判定: スコア差で決定
    const diff = (debate.player1_score || 0) - (debate.player2_score || 0)
    let winnerId = null
    if (diff > 0.5) {
      winnerId = debate.player1_id
    } else if (diff < -0.5) {
      winnerId = debate.player2_id
    }

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
      diff,
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
  const player1Args = messages
    .filter((m) => m.user_id === player1Id)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join('\n')

  const player2Args = messages
    .filter((m) => m.user_id === player2Id)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join('\n')

  const prompt = `あなたは討論の審判です。各プレイヤーの討論者としてのパフォーマンスを評価してください。
議論内容の要約ではなく、論証の巧みさ・具体例の使い方・反論の的確さなど、討論スキルの観点で評価してください。

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
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '討論の審判です。議論内容の要約ではなく、討論者としてのスキルを評価してください。JSON形式でのみ回答し、値は必ず文字列にしてください。' },
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
