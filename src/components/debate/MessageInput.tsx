'use client'

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  sending: boolean
}

export function MessageInput({ value, onChange, onSubmit, sending }: Props) {
  return (
    <div className="flex-shrink-0 p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700">
      <form onSubmit={onSubmit} className="max-w-4xl mx-auto flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="メッセージを入力..."
          className="flex-1 px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={sending || !value.trim()}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {sending ? '送信中...' : '送信'}
        </button>
      </form>
    </div>
  )
}
