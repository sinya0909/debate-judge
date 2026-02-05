'use client'

import { useState } from 'react'
import { supabase } from '@/services/supabase'
import { AI_USER_ID } from '@/lib/constants'

type Props = {
  userId: string
  onCreated: (debateId: string) => void
}

export function CreateRoom({ userId, onCreated }: Props) {
  const [theme, setTheme] = useState('')
  const [loading, setLoading] = useState(false)
  const [isAiMatch, setIsAiMatch] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!theme.trim()) return

    setLoading(true)

    const insertData = isAiMatch
      ? {
          theme: theme.trim(),
          player1_id: userId,
          player2_id: AI_USER_ID,
          status: 'active' as const,
          settings: {
            point_diff: 10,
            time_limit: 10 * 60,
            max_comments: 30,
            is_ai_match: true,
          },
        }
      : {
          theme: theme.trim(),
          player1_id: userId,
        }

    const { data, error } = await supabase
      .from('debates')
      .insert(insertData)
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
    <form onSubmit={handleCreate} className="flex gap-2 items-center">
      <input
        type="text"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        placeholder="討論テーマを入力..."
        className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 whitespace-nowrap cursor-pointer">
        <input
          type="checkbox"
          checked={isAiMatch}
          onChange={(e) => setIsAiMatch(e.target.checked)}
          className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600"
        />
        AI対戦
      </label>
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
