'use client'

import type { DebateWithPlayers } from '@/lib/types'
import { AdvantageBar } from './AdvantageBar'

type Props = {
  debate: DebateWithPlayers
  currentUserId: string
  remainingTime: number | null
}

export function Scoreboard({ debate, currentUserId, remainingTime }: Props) {
  const isPlayer1 = debate.player1_id === currentUserId
  const isPlayer2 = debate.player2_id === currentUserId

  return (
    <div className="flex-shrink-0 p-4 bg-zinc-100 dark:bg-zinc-800">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center">
          <div className="text-center flex-1">
            <p className="text-sm text-zinc-500">Player 1</p>
            <p className="font-semibold text-black dark:text-white">
              {debate.player1?.display_name ?? '---'}
              {isPlayer1 && ' (あなた)'}
            </p>
            <p className="text-lg text-zinc-600 dark:text-zinc-400">{debate.player1_score}/10</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-zinc-400">VS</div>
            {remainingTime !== null && debate.status === 'active' && (
              <div className={`text-lg font-mono mt-1 ${remainingTime <= 60 ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-400'}`}>
                {Math.floor(remainingTime / 60)}:{(remainingTime % 60).toString().padStart(2, '0')}
              </div>
            )}
          </div>
          <div className="text-center flex-1">
            <p className="text-sm text-zinc-500">Player 2</p>
            <p className="font-semibold text-black dark:text-white">
              {debate.player2?.display_name ?? '待機中...'}
              {isPlayer2 && ' (あなた)'}
            </p>
            <p className="text-lg text-zinc-600 dark:text-zinc-400">{debate.player2_score}/10</p>
          </div>
        </div>
        {debate.status === 'active' && (
          <div className="mt-3">
            <AdvantageBar advantage={debate.advantage || 0} />
            <p className="text-center text-xs text-zinc-500 mt-1">
              優勢度: {(debate.advantage || 0) > 0 ? '+' : ''}{debate.advantage || 0}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
