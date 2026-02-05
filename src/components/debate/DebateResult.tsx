'use client'

import type { DebateWithPlayers } from '@/lib/types'
import { AdvantageBar } from './AdvantageBar'

type Props = {
  debate: DebateWithPlayers
  onBack: () => void
}

function formatReason(reason: unknown): string {
  if (typeof reason === 'string') return reason
  if (reason && typeof reason === 'object') {
    return Object.entries(reason)
      .map(([key, val]) => `${key}: ${val}`)
      .join('\n')
  }
  return ''
}

export function DebateResult({ debate, onBack }: Props) {
  const advantage = debate.advantage || 0

  return (
    <div className="flex-shrink-0 p-6 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
      <div className="max-w-2xl mx-auto">
        <p className="text-lg font-bold mb-2 text-center">討論終了</p>
        {debate.winner_id ? (
          <div className="text-center mb-4">
            <p className="text-3xl font-bold mb-2">
              {debate.winner_id === debate.player1_id
                ? debate.player1?.display_name
                : debate.player2?.display_name}
              の勝利！
            </p>
          </div>
        ) : (
          <p className="text-2xl font-bold text-center mb-4">引き分け</p>
        )}

        {/* スコアバー */}
        <div className="bg-white/10 rounded-lg p-4 mb-4">
          <div className="flex items-center text-sm mb-2">
            <span className="flex-1 text-blue-200">{debate.player1?.display_name}</span>
            <span className="text-white/60 text-xs">スコア差 {advantage > 0 ? '+' : ''}{advantage}</span>
            <span className="flex-1 text-red-200 text-right">{debate.player2?.display_name}</span>
          </div>
          <AdvantageBar
            player1Score={debate.player1_score || 0}
            player2Score={debate.player2_score || 0}
            variant="result"
          />
        </div>

        {/* 総評 */}
        {debate.final_summary && (
          <div className="bg-white/10 rounded-lg p-4 mb-4">
            <p className="font-bold mb-3 text-center">総評</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/10 rounded p-3">
                <p className="font-semibold text-blue-200 mb-2">
                  {debate.player1?.display_name}
                </p>
                <p className="text-sm text-white/80 whitespace-pre-wrap">
                  {formatReason(debate.final_summary.player1_reason)}
                </p>
              </div>
              <div className="bg-white/10 rounded p-3">
                <p className="font-semibold text-red-200 mb-2">
                  {debate.player2?.display_name}
                </p>
                <p className="text-sm text-white/80 whitespace-pre-wrap">
                  {formatReason(debate.final_summary.player2_reason)}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="text-center">
          <button
            onClick={onBack}
            className="px-6 py-2 bg-white text-blue-600 rounded-lg font-semibold hover:bg-zinc-100"
          >
            トップに戻る
          </button>
        </div>
      </div>
    </div>
  )
}
