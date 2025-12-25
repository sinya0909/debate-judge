-- AI討論ジャッジ DBスキーマ
-- Supabase PostgreSQL

-- ユーザー（Supabase Authと連携）
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  total_score INT DEFAULT 0,
  debate_count INT DEFAULT 0,
  tendency JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 討論ルーム
CREATE TABLE debates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme TEXT NOT NULL,
  player1_id UUID REFERENCES users(id),
  player2_id UUID REFERENCES users(id),
  winner_id UUID REFERENCES users(id),
  player1_score INT DEFAULT 0,
  player2_score INT DEFAULT 0,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished')),
  settings JSONB DEFAULT '{"point_diff": 10, "time_limit": 600, "max_comments": 30}',
  ai_summary JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- メッセージ履歴
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debate_id UUID REFERENCES debates(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  content TEXT NOT NULL,
  ai_evaluation JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- RLS (Row Level Security)
-- =====================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE debates ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 読み取りポリシー（全員閲覧可）
CREATE POLICY "Users are viewable by everyone" ON users FOR SELECT USING (true);
CREATE POLICY "Debates are viewable by everyone" ON debates FOR SELECT USING (true);
CREATE POLICY "Messages are viewable by everyone" ON messages FOR SELECT USING (true);

-- 書き込みポリシー
CREATE POLICY "Users can insert own data" ON users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own data" ON users FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Authenticated users can create debates" ON debates FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Players can update their debate" ON debates FOR UPDATE USING (
  auth.uid() = player1_id
  OR auth.uid() = player2_id
  OR (status = 'waiting' AND player2_id IS NULL)
);

CREATE POLICY "Authenticated users can send messages" ON messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =====================
-- トリガー
-- =====================

-- 新規ユーザー登録時に自動でusersテーブルにレコード作成
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================
-- Realtime
-- =====================

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE debates;
