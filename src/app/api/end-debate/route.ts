import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { endDebate } from '@/lib/debate-service'
import { AI_USER_ID } from '@/lib/constants'

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

    const diff = (debate.player1_score || 0) - (debate.player2_score || 0)
    const settings = debate.settings as { is_ai_match?: boolean }
    const excludeIds = settings.is_ai_match ? [AI_USER_ID] : []
    const winnerId = await endDebate(debateId, debate, excludeIds)

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
