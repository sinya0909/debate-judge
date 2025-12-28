// ユーザー
export type User = {
  id: string
  display_name: string
  wins: number
  losses: number
  total_score: number
  debate_count: number
  tendency: UserTendency | null
  created_at: string
}

export type UserTendency = {
  favorite_themes: string[]
  average_score: number
  common_tactics: string[]
  weaknesses: string[]
}

// 討論ルーム
export type Debate = {
  id: string
  theme: string
  player1_id: string
  player2_id: string
  winner_id: string | null
  player1_score: number
  player2_score: number
  advantage: number // 優勢度 -10〜+10 (正: Player1優勢)
  status: 'waiting' | 'active' | 'finished'
  settings: DebateSettings
  ai_summary: DebateSummary | null
  final_summary: FinalSummary | null
  created_at: string
  finished_at: string | null
}

// 終了時の総評
export type FinalSummary = {
  player1_reason: string
  player2_reason: string
}

export type DebateSettings = {
  point_diff: number
  time_limit: number
  max_comments: number
}

// メッセージ
export type Message = {
  id: string
  debate_id: string
  user_id: string
  content: string
  ai_evaluation: AIEvaluation | null
  created_at: string
}

// AI評価
export type AIEvaluation = {
  statement_score: number // 発言スコア -2〜+2
  advantage: number // 優勢度 -10〜+10
  reasoning: string
}

// AI総評
export type DebateSummary = {
  winner: string
  decisive_moment: string
  debate_quality: number
  player1_review: PlayerReview
  player2_review: PlayerReview
}

export type PlayerReview = {
  strengths: string[]
  weaknesses: string[]
  advice: string
}
