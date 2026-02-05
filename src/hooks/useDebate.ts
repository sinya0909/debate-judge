'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import type { User } from '@supabase/supabase-js'
import type { DebateWithPlayers, MessageWithUser } from '@/lib/types'

export function useDebate(debateId: string) {
  const [user, setUser] = useState<User | null>(null)
  const [debate, setDebate] = useState<DebateWithPlayers | null>(null)
  const [messages, setMessages] = useState<MessageWithUser[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [remainingTime, setRemainingTime] = useState<number | null>(null)

  // 認証状態の取得
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (!session?.user) setLoading(false)
    })
  }, [])

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
        setDebate(null)
        setLoading(false)
        return
      }

      setDebate(data as DebateWithPlayers)
      setLoading(false)
    }

    fetchDebate()

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
  }, [user, debateId])

  // メッセージの取得とリアルタイム購読
  // debate が存在するかどうかのboolだけを依存に使い、
  // debate内部の値(advantage等)更新で再実行されないようにする
  const hasDebate = !!debate

  useEffect(() => {
    if (!hasDebate) return

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
          const { data } = await supabase
            .from('messages')
            .select(`*, user:users!messages_user_id_fkey(display_name)`)
            .eq('id', payload.new.id)
            .single()

          if (data) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === data.id)) return prev
              return [...prev, data as MessageWithUser]
            })
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
  }, [hasDebate, debateId])

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

  // メッセージ送信
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !user || sending || !debate) return

    setSending(true)
    const content = newMessage.trim()

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

  return {
    user,
    debate,
    messages,
    newMessage,
    setNewMessage,
    loading,
    sending,
    remainingTime,
    handleSendMessage,
  }
}
