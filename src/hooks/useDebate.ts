import { useState } from 'react'
import type { Message, AIEvaluation } from '@/lib/types'

export function useDebate(debateId: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [player1Score, setPlayer1Score] = useState(0)
  const [player2Score, setPlayer2Score] = useState(0)
  const [isFinished, setIsFinished] = useState(false)

  const sendMessage = async (content: string, userId: string) => {
    // TODO: メッセージ送信・AI評価取得
  }

  return {
    messages,
    player1Score,
    player2Score,
    isFinished,
    sendMessage,
  }
}
