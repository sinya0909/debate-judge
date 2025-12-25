'use client'

import { useState } from 'react'
import { supabase } from '@/services/supabase'

type Props = {
  userId: string
  onCreated: (debateId: string) => void
}

export function CreateRoom({ userId, onCreated }: Props) {
  const [theme, setTheme] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!theme.trim()) return

    setLoading(true)
    const { data, error } = await supabase
      .from('debates')
      .insert({
        theme: theme.trim(),
        player1_id: userId,
      })
      .select('id')
      .single()

    if (error) {
      alert('エラー: ' + error.message)
    } else {
      setTheme('')
      onCreated(data.id)
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleCreate} className="flex gap-2">
      <input
        type="text"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        placeholder="討論テーマを入力..."
        className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        disabled={loading || !theme.trim()}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? '作成中...' : '作成'}
      </button>
    </form>
  )
}
