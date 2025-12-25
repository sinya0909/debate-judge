'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import type { Debate } from '@/lib/types'

type Props = {
  userId: string
  refreshKey: number
  onJoin: (debateId: string) => void
  onEnter: (debateId: string) => void
}

type DebateWithPlayer = Debate & {
  player1: { display_name: string } | null
}

export function RoomList({ userId, refreshKey, onJoin, onEnter }: Props) {
  const [rooms, setRooms] = useState<DebateWithPlayer[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRooms = async () => {
    const { data, error } = await supabase
      .from('debates')
      .select(`
        *,
        player1:users!debates_player1_id_fkey(display_name)
      `)
      .in('status', ['waiting', 'active'])
      .order('created_at', { ascending: false })

    if (!error && data) {
      setRooms(data as DebateWithPlayer[])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchRooms()
  }, [refreshKey])

  const handleJoin = async (debateId: string) => {
    const { error } = await supabase
      .from('debates')
      .update({ player2_id: userId, status: 'active' })
      .eq('id', debateId)

    if (error) {
      alert('エラー: ' + error.message)
    } else {
      onJoin(debateId)
    }
  }

  if (loading) {
    return <p className="text-zinc-500 text-center py-4">読み込み中...</p>
  }

  if (rooms.length === 0) {
    return <p className="text-zinc-500 text-center py-4">待機中のルームはありません</p>
  }

  return (
    <div className="space-y-3">
      {rooms.map((room) => {
        const isPlayer1 = room.player1_id === userId
        const isPlayer2 = room.player2_id === userId
        const isParticipant = isPlayer1 || isPlayer2
        const canJoin = room.status === 'waiting' && !isPlayer1

        return (
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
                  作成者: {room.player1?.display_name ?? '不明'}
                  {isPlayer1 && ' (あなた)'}
                </p>
                <span
                  className={`inline-block mt-2 px-2 py-0.5 text-xs rounded ${
                    room.status === 'waiting'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  }`}
                >
                  {room.status === 'waiting' ? '対戦相手待ち' : '討論中'}
                </span>
              </div>
              <div>
                {canJoin && (
                  <button
                    onClick={() => handleJoin(room.id)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700"
                  >
                    参加
                  </button>
                )}
                {isParticipant && room.status === 'active' && (
                  <button
                    onClick={() => onEnter(room.id)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
                  >
                    入室
                  </button>
                )}
                {isPlayer1 && room.status === 'waiting' && (
                  <button
                    onClick={() => onEnter(room.id)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
                  >
                    入室
                  </button>
                )}
                {!isParticipant && room.status === 'active' && (
                  <button
                    onClick={() => onEnter(room.id)}
                    className="px-4 py-2 bg-zinc-600 text-white rounded-lg text-sm font-semibold hover:bg-zinc-700"
                  >
                    観戦
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
