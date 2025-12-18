// 討論終了条件のデフォルト値
export const DEFAULT_SETTINGS = {
  POINT_DIFF: 10,
  TIME_LIMIT: 10 * 60, // 10分（秒）
  MAX_COMMENTS: 30,
} as const

// 討論ステータス
export const DEBATE_STATUS = {
  WAITING: 'waiting',
  ACTIVE: 'active',
  FINISHED: 'finished',
} as const
