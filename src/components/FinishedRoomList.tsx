'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import type { Debate } from '@/lib/types'

type Props = {
  onView: (debateId: string) => void
}

type DebateWithPlayers = Debate & {
  player1: { display_name: string } | null
  player2: { display_name: string } | null
}

export function FinishedRoomList({ onView }: Props) {
  const [rooms, setRooms] = useState<DebateWithPlayers[]>([])
  const [loading, setLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)

  const fetchRooms = async () => {
    const { data, error } = await supabase
      .from('debates')
      .select(`
        *,
        player1:users!debates_player1_id_fkey(display_name),
        player2:users!debates_player2_id_fkey(display_name)
      `)
      .eq('status', 'finished')
      .order('finished_at', { ascending: false })
      .limit(20)

    if (!error && data) {
      setRooms(data as DebateWithPlayers[])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (isOpen) {
      fetchRooms()
    }
  }, [isOpen])

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center text-left"
      >
        <span className="text-lg font-semibold text-black dark:text-white">
          終了した討論
        </span>
        <span className="text-zinc-500">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="mt-4">
          {loading ? (
            <p className="text-zinc-500 text-center py-4">読み込み中...</p>
          ) : rooms.length === 0 ? (
            <p className="text-zinc-500 text-center py-4">終了した討論はありません</p>
          ) : (
            <div className="space-y-3">
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className="p-4 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-black dark:text-white truncate">
                        {room.theme}
                      </h3>
                      <p className="text-sm text-zinc-500 mt-1">
                        {room.player1?.display_name ?? '不明'} vs {room.player2?.display_name ?? '不明'}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-0.5 text-xs rounded bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                          終了
                        </span>
                        {room.winner_id ? (
                          <span className="text-xs text-zinc-500">
                            勝者: {room.winner_id === room.player1_id ? room.player1?.display_name : room.player2?.display_name}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-500">引き分け</span>
                        )}
                        <span className="text-xs text-zinc-400">
                          {formatDate(room.finished_at)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => onView(room.id)}
                      className="px-4 py-2 bg-zinc-600 text-white rounded-lg text-sm font-semibold hover:bg-zinc-700"
                    >
                      閲覧
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
