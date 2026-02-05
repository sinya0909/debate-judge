# AI討論ジャッジ

人間同士の討論をAIがリアルタイムで判定するチャットアプリ。

## 概要

- **コンセプト**: 1対1の討論をAIが公平に評価
- **判定方式**: 各発言の質と討論全体の優勢度をリアルタイム評価
- **勝敗決定**: 時間切れまたは規定コメント数到達時に総合評価で判定

## 現在の実装仕様

### スコアリング

| 種類 | 範囲 | 説明 |
|------|------|------|
| 発言スコア | -2〜+2 | 個別メッセージの質を評価 |
| 優勢度 | -10〜+10 | 討論全体での優勢劣勢（毎回全メッセージを再評価） |

- **正の値**: Player1 優勢
- **負の値**: Player2 優勢

### 勝敗判定

```
最終スコア = 優勢度 + (発言スコア差 / 5)

 最終スコア > +0.5  → Player1 勝利
 最終スコア < -0.5  → Player2 勝利
-0.5 ≦ 最終スコア ≦ +0.5 → 引き分け
```

### 終了条件

討論は以下のいずれかで終了：

1. **時間切れ**: 10分（デフォルト）
2. **コメント数上限**: 各プレイヤー30回

### AI評価基準

- 論理の一貫性
- 根拠の妥当性
- 反論の的確さ
- 論点からの逸脱
- 矛盾の有無

### データ保持

- 終了した討論は30日後に自動削除
- トップページで過去の討論を閲覧可能

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フレームワーク | Next.js 16 (App Router) |
| 言語 | TypeScript |
| データベース | Supabase (PostgreSQL) |
| 認証 | Supabase Auth |
| リアルタイム | Supabase Realtime |
| AI | OpenAI GPT-4o-mini |
| ホスティング | Vercel |

## プロジェクト構成

```
debate-judge/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── evaluate/        AI評価API
│   │   │   └── end-debate/      討論終了API
│   │   ├── debate/[id]/         討論ページ
│   │   └── page.tsx             トップページ
│   ├── components/
│   │   ├── Auth.tsx             認証コンポーネント
│   │   ├── CreateRoom.tsx       ルーム作成
│   │   ├── RoomList.tsx         アクティブルーム一覧
│   │   └── FinishedRoomList.tsx 終了済み討論一覧
│   ├── lib/
│   │   └── types.ts             型定義
│   └── services/
│       └── supabase.ts          Supabaseクライアント
├── doc/
│   ├── schema.sql               DBスキーマ
│   ├── supabase-setup.md        セットアップ手順
│   └── design.md                将来の拡張計画
└── README.md
```

## セットアップ

詳細は [`doc/supabase-setup.md`](./doc/supabase-setup.md) を参照。

### 1. 環境変数

`.env.local` に以下を設定：

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=sk-...
```

### 2. Supabase

1. プロジェクト作成
2. `doc/schema.sql` を実行
3. 認証設定（Email有効化）
4. pg_cron設定（30日自動削除）

### 3. ローカル開発

```bash
npm install
npm run dev
```

### 4. デプロイ

```bash
vercel --prod
```

## 主要機能

### トップページ (`/`)

- 新規討論ルーム作成
- アクティブなルーム一覧
- 終了済み討論の閲覧（折りたたみ式）

### 討論ページ (`/debate/[id]`)

- リアルタイムチャット
- 各発言へのAI評価表示
- 優勢度バー（Player1 vs Player2）
- スコアボード
- タイマー表示
- 終了時の総評

### 観戦機能

- 参加者以外も観戦可能
- 終了した討論の閲覧

## データベース

### 主要テーブル

- `users`: ユーザー情報（認証・戦績）
- `debates`: 討論ルーム（テーマ・スコア・状態）
- `messages`: メッセージ履歴（内容・AI評価）

詳細は [`doc/schema.sql`](./doc/schema.sql) 参照。

## 今後の拡張

詳細は [`doc/design.md`](./doc/design.md) 参照。

- ランダムマッチング
- AI対戦
- 立場選択（賛成 vs 反対）
- いいね・勝敗投票
- SNSシェア
- ランク戦

## ライセンス

MIT
