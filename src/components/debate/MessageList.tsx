'use client'

import { useEffect, useRef } from 'react'
import type { MessageWithUser } from '@/lib/types'

type Props = {
  messages: MessageWithUser[]
  currentUserId: string
  player1Id: string
}

export function MessageList({ messages, currentUserId, player1Id }: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        {messages.length === 0 ? (
          <p className="text-center text-zinc-500 py-8">
            まだメッセージはありません。討論を始めましょう！
          </p>
        ) : (
          messages.map((msg) => {
            const isMine = msg.user_id === currentUserId
            const isP1 = msg.user_id === player1Id

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
  )
}
