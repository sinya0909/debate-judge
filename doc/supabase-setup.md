# Supabase セットアップ手順書

## 1. プロジェクト作成

1. [Supabase](https://supabase.com/) でプロジェクトを作成
2. プロジェクト設定から以下を取得：
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

## 2. 初期スキーマ作成

SQL Editor で `doc/schema.sql` の内容を実行。

## 3. 認証設定

### Authentication → Providers
- Email を有効化（デフォルトで有効）

### Authentication → URL Configuration
- Site URL: `https://debate-judge.vercel.app`
- Redirect URLs に追加:
  - `https://debate-judge.vercel.app/**`
  - `http://localhost:3000/**`（開発用）

## 4. マイグレーション履歴

新規セットアップ時は不要。既存環境のアップデート時に実行。

### 2024-XX-XX: 優勢度スコア追加

```sql
-- 優勢度カラム追加
ALTER TABLE debates ADD COLUMN IF NOT EXISTS advantage INT DEFAULT 0;

-- 終了時総評カラム追加
ALTER TABLE debates ADD COLUMN IF NOT EXISTS final_summary JSONB;
```

## 5. 定期クリーンアップ設定（30日で自動削除）

### 5-1. pg_cron拡張を有効化

Database → Extensions → `pg_cron` を検索して有効化

### 5-2. クリーンアップ関数を作成

```sql
CREATE OR REPLACE FUNCTION cleanup_old_debates()
RETURNS void AS $$
BEGIN
  DELETE FROM debates
  WHERE status = 'finished'
    AND finished_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
```

### 5-3. cronジョブをスケジュール

```sql
-- 毎日午前3時（UTC）に実行
SELECT cron.schedule(
  'cleanup-old-debates',
  '0 3 * * *',
  'SELECT cleanup_old_debates()'
);
```

### cronジョブの確認・削除

```sql
-- ジョブ一覧
SELECT * FROM cron.job;

-- ジョブ削除
SELECT cron.unschedule('cleanup-old-debates');
```

## 6. 環境変数

### Vercel

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=sk-...
```

### ローカル開発 (.env.local)

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=sk-...
```

## 7. RLS（Row Level Security）

`schema.sql` に含まれているが、主要なポリシー：

| テーブル | 操作 | ポリシー |
|---------|------|---------|
| users | SELECT | 全員閲覧可 |
| users | INSERT/UPDATE | 自分のデータのみ |
| debates | SELECT | 全員閲覧可 |
| debates | INSERT | 認証済みユーザー |
| debates | UPDATE | 参加者のみ |
| messages | SELECT | 全員閲覧可 |
| messages | INSERT | 自分のメッセージのみ |

## 8. Realtime

`schema.sql` に含まれているが、以下のテーブルがリアルタイム有効：

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE debates;
```

## トラブルシューティング

### RLSでブロックされる

API Routeでは `SUPABASE_SERVICE_ROLE_KEY` を使用してRLSをバイパス。
クライアントサイドでは `NEXT_PUBLIC_SUPABASE_ANON_KEY` を使用。

### Realtimeが動作しない

1. Supabase Dashboard → Database → Replication で対象テーブルが有効か確認
2. RLSポリシーでSELECTが許可されているか確認
