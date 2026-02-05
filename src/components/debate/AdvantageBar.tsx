'use client'

type Props = {
  advantage: number
  variant?: 'default' | 'result'
}

export function AdvantageBar({ advantage, variant = 'default' }: Props) {
  const isResult = variant === 'result'

  const barBg = isResult ? 'bg-white/20' : 'bg-zinc-300 dark:bg-zinc-600'
  const p1Color = isResult ? 'bg-blue-300' : 'bg-blue-500'
  const p2Color = isResult ? 'bg-red-300' : 'bg-red-500'
  const centerLine = isResult ? 'bg-white/50' : 'bg-zinc-400'
  const p1Label = isResult ? 'text-xs w-16 text-right' : 'text-xs text-blue-600 w-16 text-right'
  const p2Label = isResult ? 'text-xs w-16' : 'text-xs text-red-600 w-16'

  return (
    <div className="flex items-center gap-2">
      <span className={p1Label}>P1優勢</span>
      <div className={`flex-1 h-4 ${barBg} rounded-full overflow-hidden relative`}>
        <div
          className={`absolute top-0 h-full ${p1Color} transition-all duration-300`}
          style={{
            left: '50%',
            width: `${Math.max(0, advantage) * 5}%`,
            maxWidth: '50%',
          }}
        />
        <div
          className={`absolute top-0 h-full ${p2Color} transition-all duration-300`}
          style={{
            right: '50%',
            width: `${Math.max(0, -advantage) * 5}%`,
            maxWidth: '50%',
          }}
        />
        <div className={`absolute top-0 left-1/2 w-0.5 h-full ${centerLine} -translate-x-1/2`} />
      </div>
      <span className={p2Label}>P2優勢</span>
    </div>
  )
}
