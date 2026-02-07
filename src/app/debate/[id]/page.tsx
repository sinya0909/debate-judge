'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useDebate } from '@/hooks/useDebate'
import { Scoreboard } from '@/components/debate/Scoreboard'
import { MessageList } from '@/components/debate/MessageList'
import { MessageInput } from '@/components/debate/MessageInput'
import type { DebateWithPlayers } from '@/lib/types'

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
      <MessageList
        messages={messages}
        currentUserId={user.id}
        player1Id={debate.player1_id}
        footer={debate.status === 'finished' ? <DebateSummaryFooter debate={debate} /> : undefined}
      />

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
        <div className="flex-shrink-0 p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700 text-center">
          <button
            onClick={() => router.push('/')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
          >
            トップに戻る
          </button>
        </div>
      )}
    </div>
  )
}

function DebateSummaryFooter({ debate }: { debate: DebateWithPlayers }) {
  if (!debate.final_summary) return null

  return (
    <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg p-4">
      <p className="font-bold mb-3 text-center">総評</p>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white/10 rounded p-3">
          <p className="font-semibold text-blue-200 mb-2">
            {debate.player1?.display_name}
          </p>
          <p className="text-sm text-white/80 whitespace-pre-wrap">
            {debate.final_summary.player1_reason}
          </p>
        </div>
        <div className="bg-white/10 rounded p-3">
          <p className="font-semibold text-red-200 mb-2">
            {debate.player2?.display_name}
          </p>
          <p className="text-sm text-white/80 whitespace-pre-wrap">
            {debate.final_summary.player2_reason}
          </p>
        </div>
      </div>
    </div>
  )
}
