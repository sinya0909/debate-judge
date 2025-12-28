'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/services/supabase'
import { Auth } from '@/components/Auth'
import { CreateRoom } from '@/components/CreateRoom'
import { RoomList } from '@/components/RoomList'
import { FinishedRoomList } from '@/components/FinishedRoomList'
import type { User } from '@supabase/supabase-js'

export default function Home() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  const handleRoomCreated = (debateId: string) => {
    router.push(`/debate/${debateId}`)
  }

  const handleJoinOrEnter = (debateId: string) => {
    router.push(`/debate/${debateId}`)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
        <p className="text-zinc-500">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-4">
      <div className="max-w-2xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-black dark:text-white">
            AI討論ジャッジ
          </h1>
          {user && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-zinc-500">{user.email}</span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                ログアウト
              </button>
            </div>
          )}
        </header>

        {user ? (
          <main className="space-y-8">
            <section className="bg-white dark:bg-zinc-900 rounded-xl p-6 shadow-lg">
              <h2 className="text-lg font-semibold mb-4 text-black dark:text-white">
                新しい討論ルームを作成
              </h2>
              <CreateRoom userId={user.id} onCreated={handleRoomCreated} />
            </section>

            <section className="bg-white dark:bg-zinc-900 rounded-xl p-6 shadow-lg">
              <h2 className="text-lg font-semibold mb-4 text-black dark:text-white">
                討論ルーム一覧
              </h2>
              <RoomList
                userId={user.id}
                refreshKey={refreshKey}
                onJoin={handleJoinOrEnter}
                onEnter={handleJoinOrEnter}
              />
            </section>

            <section className="bg-white dark:bg-zinc-900 rounded-xl p-6 shadow-lg">
              <FinishedRoomList onView={handleJoinOrEnter} />
            </section>
          </main>
        ) : (
          <main className="max-w-md mx-auto">
            <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 shadow-lg">
              <Auth />
            </div>
          </main>
        )}
      </div>
    </div>
  )
}
