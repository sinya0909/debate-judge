import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

    // 勝者判定
    let winnerId = null
    if (debate.player1_score > debate.player2_score) {
      winnerId = debate.player1_id
    } else if (debate.player2_score > debate.player1_score) {
      winnerId = debate.player2_id
    }
    // 同点なら引き分け（winnerId = null）

    // 討論を終了
    await supabase
      .from('debates')
      .update({
        status: 'finished',
        winner_id: winnerId,
        finished_at: new Date().toISOString(),
      })
      .eq('id', debateId)

    // ユーザー統計を更新（引き分け以外）
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
    })
  } catch (error) {
    console.error('End debate error:', error)
    return NextResponse.json({ error: 'Failed to end debate' }, { status: 500 })
  }
}
