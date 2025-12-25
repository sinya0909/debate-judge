'use client'

import { useState } from 'react'
import { supabase } from '@/services/supabase'

type AuthMode = 'login' | 'signup'

export function Auth() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
      })
      if (error) {
        setMessage(`エラー: ${error.message}`)
      } else {
        setMessage('確認メールを送信しました。メールを確認してください。')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) {
        setMessage(`エラー: ${error.message}`)
      }
    }

    setLoading(false)
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="flex mb-6 border-b border-zinc-200 dark:border-zinc-700">
        <button
          className={`flex-1 py-2 text-center ${
            mode === 'login'
              ? 'border-b-2 border-black dark:border-white font-semibold'
              : 'text-zinc-500'
          }`}
          onClick={() => setMode('login')}
        >
          ログイン
        </button>
        <button
          className={`flex-1 py-2 text-center ${
            mode === 'signup'
              ? 'border-b-2 border-black dark:border-white font-semibold'
              : 'text-zinc-500'
          }`}
          onClick={() => setMode('signup')}
        >
          新規登録
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="email"
          placeholder="メールアドレス"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
        />
        <input
          type="password"
          placeholder="パスワード（6文字以上）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
        />
        <button
          type="submit"
          disabled={loading}
          className="py-3 bg-black dark:bg-white text-white dark:text-black rounded-lg font-semibold hover:opacity-80 disabled:opacity-50"
        >
          {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '新規登録'}
        </button>
      </form>

      {message && (
        <p className="mt-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
          {message}
        </p>
      )}
    </div>
  )
}
