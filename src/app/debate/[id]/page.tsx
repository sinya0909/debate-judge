'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useDebate } from '@/hooks/useDebate'
import { Scoreboard } from '@/components/debate/Scoreboard'
import { MessageList } from '@/components/debate/MessageList'
import { MessageInput } from '@/components/debate/MessageInput'
import { DebateResult } from '@/components/debate/DebateResult'

export default function DebatePage() {
  const params = useParams()
  const router = useRouter()
  const debateId = params.id as string

  const {
    user,
    debate,
    messages,
    newMessage,
    setNewMessage,
    loading,
    sending,
    remainingTime,
    handleSendMessage,
  } = useDebate(debateId)

  // 未認証時リダイレクト
  useEffect(() => {
    if (!loading && !user) router.push('/')
  }, [loading, user, router])

  // データ取得失敗時リダイレクト
  useEffect(() => {
    if (!loading && user && !debate) {
      alert('ルームが見つかりません')
      router.push('/')
    }
  }, [loading, user, debate, router])

  if (loading || !debate || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
        <p className="text-zinc-500">読み込み中...</p>
      </div>
    )
  }

  const isPlayer1 = debate.player1_id === user.id
  const isPlayer2 = debate.player2_id === user.id
  const isParticipant = isPlayer1 || isPlayer2

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-black">
      {/* ヘッダー */}
      <header className="flex-shrink-0 p-4 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center">
            <button
              onClick={() => router.push('/')}
              className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              ← 戻る
            </button>
            <span
              className={`px-3 py-1 text-sm rounded-full ${
                debate.status === 'waiting'
                  ? 'bg-yellow-100 text-yellow-800'
                  : debate.status === 'active'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-zinc-100 text-zinc-800'
              }`}
            >
              {debate.status === 'waiting'
                ? '対戦相手待ち'
                : debate.status === 'active'
                ? '討論中'
                : '終了'}
            </span>
          </div>
          <h1 className="text-xl font-bold mt-2 text-black dark:text-white">
            {debate.theme}
          </h1>
        </div>
      </header>

      <Scoreboard debate={debate} currentUserId={user.id} remainingTime={remainingTime} />
      <MessageList messages={messages} currentUserId={user.id} player1Id={debate.player1_id} />

      {isParticipant && debate.status === 'active' && (
        <MessageInput
          value={newMessage}
          onChange={setNewMessage}
          onSubmit={handleSendMessage}
          sending={sending}
        />
      )}

      {debate.status === 'waiting' && (
        <div className="flex-shrink-0 p-4 bg-yellow-50 dark:bg-yellow-900/20 text-center">
          <p className="text-yellow-800 dark:text-yellow-200">
            対戦相手を待っています...
          </p>
        </div>
      )}

      {!isParticipant && debate.status === 'active' && (
        <div className="flex-shrink-0 p-4 bg-zinc-100 dark:bg-zinc-800 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">観戦中</p>
        </div>
      )}

      {debate.status === 'finished' && (
        <DebateResult debate={debate} onBack={() => router.push('/')} />
      )}
    </div>
  )
}
