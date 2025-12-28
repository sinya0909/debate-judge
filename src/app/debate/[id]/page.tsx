'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/services/supabase'
import type { User } from '@supabase/supabase-js'
import type { Debate, Message } from '@/lib/types'

type DebateWithPlayers = Debate & {
  player1: { display_name: string } | null
  player2: { display_name: string } | null
}

type MessageWithUser = Message & {
  user: { display_name: string } | null
}

export default function DebatePage() {
  const params = useParams()
  const router = useRouter()
  const debateId = params.id as string

  const [user, setUser] = useState<User | null>(null)
  const [debate, setDebate] = useState<DebateWithPlayers | null>(null)
  const [messages, setMessages] = useState<MessageWithUser[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [remainingTime, setRemainingTime] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 認証状態の取得
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.push('/')
        return
      }
      setUser(session.user)
    })
  }, [router])

  // 討論データの取得とリアルタイム監視
  useEffect(() => {
    if (!user) return

    const fetchDebate = async () => {
      const { data, error } = await supabase
        .from('debates')
        .select(`
          *,
          player1:users!debates_player1_id_fkey(display_name),
          player2:users!debates_player2_id_fkey(display_name)
        `)
        .eq('id', debateId)
        .single()

      if (error || !data) {
        alert('ルームが見つかりません')
        router.push('/')
        return
      }

      setDebate(data as DebateWithPlayers)
      setLoading(false)
    }

    fetchDebate()

    // debatesテーブルの変更をリアルタイム監視
    const channel = supabase
      .channel(`debate-info-${debateId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'debates',
          filter: `id=eq.${debateId}`,
        },
        () => {
          fetchDebate()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, debateId, router])

  // メッセージの取得とリアルタイム購読
  useEffect(() => {
    if (!debate) return

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('messages')
        .select(`
          *,
          user:users!messages_user_id_fkey(display_name)
        `)
        .eq('debate_id', debateId)
        .order('created_at', { ascending: true })

      if (data) {
        setMessages(data as MessageWithUser[])
      }
    }

    fetchMessages()

    // リアルタイム購読
    const channel = supabase
      .channel(`debate-messages-${debateId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `debate_id=eq.${debateId}`,
        },
        async (payload) => {
          // 新しいメッセージを取得（ユーザー情報含む）
          const { data } = await supabase
            .from('messages')
            .select(`*, user:users!messages_user_id_fkey(display_name)`)
            .eq('id', payload.new.id)
            .single()

          if (data) {
            setMessages((prev) => [...prev, data as MessageWithUser])
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `debate_id=eq.${debateId}`,
        },
        async (payload) => {
          // AI評価が更新されたらメッセージを更新
          const { data } = await supabase
            .from('messages')
            .select(`*, user:users!messages_user_id_fkey(display_name)`)
            .eq('id', payload.new.id)
            .single()

          if (data) {
            setMessages((prev) =>
              prev.map((m) => (m.id === data.id ? (data as MessageWithUser) : m))
            )
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [debate, debateId])

  // 自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // タイマー
  useEffect(() => {
    if (!debate || debate.status !== 'active') return

    const settings = debate.settings as { time_limit: number }
    const startTime = new Date(debate.created_at).getTime()
    const endTime = startTime + settings.time_limit * 1000
    let endCalled = false

    const updateTimer = () => {
      const now = Date.now()
      const remaining = Math.max(0, Math.floor((endTime - now) / 1000))
      setRemainingTime(remaining)

      if (remaining <= 0 && !endCalled) {
        endCalled = true
        // 時間切れ - 終了処理
        fetch('/api/end-debate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ debateId, reason: 'time_limit' }),
        }).catch(console.error)
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)

    return () => clearInterval(interval)
  }, [debate, debateId])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !user || sending || !debate) return

    setSending(true)
    const content = newMessage.trim()

    // メッセージを保存
    const { data: insertedMessage, error } = await supabase
      .from('messages')
      .insert({
        debate_id: debateId,
        user_id: user.id,
        content,
      })
      .select('id')
      .single()

    if (error) {
      alert('送信エラー: ' + error.message)
      setSending(false)
      return
    }

    setNewMessage('')

    // AI評価をバックグラウンドで取得
    const previousMessages = messages.map((m) => ({
      content: m.content,
      isPlayer1: m.user_id === debate.player1_id,
    }))

    fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId: insertedMessage.id,
        debateId,
        userId: user.id,
        content,
        theme: debate.theme,
        previousMessages,
      }),
    }).catch((err) => console.error('AI評価エラー:', err))

    setSending(false)
  }

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

      {/* スコアボード */}
      <div className="flex-shrink-0 p-4 bg-zinc-100 dark:bg-zinc-800">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center">
            <div className="text-center flex-1">
              <p className="text-sm text-zinc-500">Player 1</p>
              <p className="font-semibold text-black dark:text-white">
                {debate.player1?.display_name ?? '---'}
                {isPlayer1 && ' (あなた)'}
              </p>
              <p className="text-lg text-zinc-600 dark:text-zinc-400">発言: {debate.player1_score}</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-zinc-400">VS</div>
              {remainingTime !== null && debate.status === 'active' && (
                <div className={`text-lg font-mono mt-1 ${remainingTime <= 60 ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-400'}`}>
                  {Math.floor(remainingTime / 60)}:{(remainingTime % 60).toString().padStart(2, '0')}
                </div>
              )}
            </div>
            <div className="text-center flex-1">
              <p className="text-sm text-zinc-500">Player 2</p>
              <p className="font-semibold text-black dark:text-white">
                {debate.player2?.display_name ?? '待機中...'}
                {isPlayer2 && ' (あなた)'}
              </p>
              <p className="text-lg text-zinc-600 dark:text-zinc-400">発言: {debate.player2_score}</p>
            </div>
          </div>
          {/* 優勢度バー */}
          {debate.status === 'active' && (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-blue-600 w-16 text-right">P1優勢</span>
                <div className="flex-1 h-4 bg-zinc-300 dark:bg-zinc-600 rounded-full overflow-hidden relative">
                  <div
                    className="absolute top-0 h-full bg-blue-500 transition-all duration-300"
                    style={{
                      left: '50%',
                      width: `${Math.max(0, (debate.advantage || 0)) * 5}%`,
                      maxWidth: '50%'
                    }}
                  />
                  <div
                    className="absolute top-0 h-full bg-red-500 transition-all duration-300"
                    style={{
                      right: '50%',
                      width: `${Math.max(0, -(debate.advantage || 0)) * 5}%`,
                      maxWidth: '50%'
                    }}
                  />
                  <div className="absolute top-0 left-1/2 w-0.5 h-full bg-zinc-400 -translate-x-1/2" />
                </div>
                <span className="text-xs text-red-600 w-16">P2優勢</span>
              </div>
              <p className="text-center text-xs text-zinc-500 mt-1">
                優勢度: {(debate.advantage || 0) > 0 ? '+' : ''}{debate.advantage || 0}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 ? (
            <p className="text-center text-zinc-500 py-8">
              まだメッセージはありません。討論を始めましょう！
            </p>
          ) : (
            messages.map((msg) => {
              const isMine = msg.user_id === user.id
              const isP1 = msg.user_id === debate.player1_id

              return (
                <div
                  key={msg.id}
                  className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg p-3 ${
                      isMine
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-zinc-800 text-black dark:text-white'
                    }`}
                  >
                    <p className={`text-xs mb-1 ${isMine ? 'text-blue-200' : 'text-zinc-500'}`}>
                      {msg.user?.display_name} ({isP1 ? 'P1' : 'P2'})
                    </p>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.ai_evaluation && (
                      <div className="mt-2 pt-2 border-t border-white/20 text-xs">
                        <p>発言: {msg.ai_evaluation.statement_score > 0 ? '+' : ''}{msg.ai_evaluation.statement_score}</p>
                        <p>{msg.ai_evaluation.reasoning}</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 入力エリア */}
      {isParticipant && debate.status === 'active' && (
        <div className="flex-shrink-0 p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700">
          <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="メッセージを入力..."
              className="flex-1 px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={sending || !newMessage.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? '送信中...' : '送信'}
            </button>
          </form>
        </div>
      )}

      {/* 待機中メッセージ */}
      {debate.status === 'waiting' && (
        <div className="flex-shrink-0 p-4 bg-yellow-50 dark:bg-yellow-900/20 text-center">
          <p className="text-yellow-800 dark:text-yellow-200">
            対戦相手を待っています...
          </p>
        </div>
      )}

      {/* 観戦モード */}
      {!isParticipant && debate.status === 'active' && (
        <div className="flex-shrink-0 p-4 bg-zinc-100 dark:bg-zinc-800 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">
            観戦中
          </p>
        </div>
      )}

      {/* 終了画面 */}
      {debate.status === 'finished' && (
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

            {/* 優勢度バー（終了時） */}
            <div className="bg-white/10 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs w-16 text-right">P1優勢</span>
                <div className="flex-1 h-4 bg-white/20 rounded-full overflow-hidden relative">
                  <div
                    className="absolute top-0 h-full bg-blue-300 transition-all duration-300"
                    style={{
                      left: '50%',
                      width: `${Math.max(0, (debate.advantage || 0)) * 5}%`,
                      maxWidth: '50%'
                    }}
                  />
                  <div
                    className="absolute top-0 h-full bg-red-300 transition-all duration-300"
                    style={{
                      right: '50%',
                      width: `${Math.max(0, -(debate.advantage || 0)) * 5}%`,
                      maxWidth: '50%'
                    }}
                  />
                  <div className="absolute top-0 left-1/2 w-0.5 h-full bg-white/50 -translate-x-1/2" />
                </div>
                <span className="text-xs w-16">P2優勢</span>
              </div>
              <div className="grid grid-cols-3 text-center text-sm">
                <div>
                  <p className="text-blue-200">{debate.player1?.display_name}</p>
                  <p>発言: {debate.player1_score}</p>
                </div>
                <div>
                  <p className="text-white/60">優勢度</p>
                  <p className="text-xl font-bold">{(debate.advantage || 0) > 0 ? '+' : ''}{debate.advantage || 0}</p>
                </div>
                <div>
                  <p className="text-red-200">{debate.player2?.display_name}</p>
                  <p>発言: {debate.player2_score}</p>
                </div>
              </div>
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
                    <p className="text-sm text-white/80">
                      {debate.final_summary.player1_reason}
                    </p>
                  </div>
                  <div className="bg-white/10 rounded p-3">
                    <p className="font-semibold text-red-200 mb-2">
                      {debate.player2?.display_name}
                    </p>
                    <p className="text-sm text-white/80">
                      {debate.final_summary.player2_reason}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="text-center">
              <button
                onClick={() => router.push('/')}
                className="px-6 py-2 bg-white text-blue-600 rounded-lg font-semibold hover:bg-zinc-100"
              >
                トップに戻る
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
