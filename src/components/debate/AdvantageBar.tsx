'use client'

type Props = {
  player1Score: number
  player2Score: number
  variant?: 'default' | 'result'
}

export function AdvantageBar({ player1Score, player2Score, variant = 'default' }: Props) {
  const isResult = variant === 'result'
  const advantage = player1Score - player2Score

  // 非線形スケーリング: sqrt で小差でも境界が動く
  const absAdv = Math.abs(advantage)
  const offset = Math.sqrt(absAdv / 10) * 50
  const p1Pct = 50 + (advantage > 0 ? offset : advantage < 0 ? -offset : 0)

  const p1Color = isResult ? 'bg-blue-300' : 'bg-blue-500'
  const p2Color = isResult ? 'bg-red-300' : 'bg-red-500'
  const centerLine = isResult ? 'bg-white/80' : 'bg-white'

  const scoreClass = 'text-sm font-bold tabular-nums min-w-[2ch] text-center'
  const p1ScoreClass = isResult ? scoreClass : `${scoreClass} text-blue-600`
  const p2ScoreClass = isResult ? scoreClass : `${scoreClass} text-red-600`

  return (
    <div className="flex items-center gap-2">
      <span className={p1ScoreClass}>{player1Score}</span>
      <div className="flex-1 h-4 rounded-full overflow-hidden relative">
        <div
          className={`absolute top-0 left-0 h-full ${p1Color} transition-all duration-300`}
          style={{ width: `${p1Pct}%` }}
        />
        <div
          className={`absolute top-0 right-0 h-full ${p2Color} transition-all duration-300`}
          style={{ width: `${100 - p1Pct}%` }}
        />
        <div
          className={`absolute top-0 w-0.5 h-full ${centerLine} -translate-x-1/2 transition-all duration-300`}
          style={{ left: `${p1Pct}%` }}
        />
      </div>
      <span className={p2ScoreClass}>{player2Score}</span>
    </div>
  )
}
