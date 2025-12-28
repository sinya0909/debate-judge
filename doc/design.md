# debate-judge 設計ドキュメント

## 概要

AI判定による1v1討論プラットフォーム。
討論自体をコンテンツとして楽しめるサービスを目指す。

---

## ページ構成

```
/                 トップ（議論閲覧 + 対戦導線）
/play/ai          AI対戦
/play/random      ランダムマッチ
/custom           フレンド対戦（部屋作成・共有）
/archive          議論閲覧一覧
/archive/[id]     議論詳細（読み取り専用）
/debate/[id]      対戦ページ（既存）
/user/[id]        プロフィール
/settings         プロフィール編集
```

---

## ヘッダーナビ

```
┌─────────────────────────────────┐
│ ロゴ   [対戦] [観戦] [👤]       │
└─────────────────────────────────┘
```

- 対戦 → `/play/random`（デフォルト）
- 観戦 → `/archive`
- 👤 → ログイン済み: `/user/[自分]` / 未ログイン: 認証モーダル

---

## トップページ（/）

```
┌─────────────────────────────────┐
│ ヘッダー                        │
├─────────────────────────────────┤
│ 🔥 注目の討論（終了済み）        │
│ └─ 議論カード...                │
│ [もっと見る → /archive]         │
├─────────────────────────────────┤
│ 🎮 今すぐ対戦                   │
│ [AI対戦] [ランダムマッチ]       │
└─────────────────────────────────┘
```

### 将来追加
- 🔴 対戦中（ライブ観戦）セクション

---

## 対戦システム

### 対戦モード

| モード | 説明 | 議題 |
|--------|------|------|
| AI対戦 | 1人で即開始、AIが対戦相手 | 運営が用意 |
| ランダムマッチ | 他ユーザーとマッチング | 運営が用意 |
| フレンド対戦 | 部屋作成→リンク共有 | カスタム可 |

### 議題の構造

```typescript
interface Theme {
  id: string;
  theme: string;        // 「朝食はパン派 vs ご飯派」
  position_a: string;   // 「パン派」
  position_b: string;   // 「ご飯派」
  created_at: string;
  is_daily: boolean;    // デイリーお題フラグ
}
```

### マッチングフロー

```
1. 議題を選択
2. 立場を選択（position_a or position_b）
3. 反対の立場のユーザーとマッチング

┌─────────────────────────────────┐
│ 今日のお題                      │
│ 「朝食はパン派 vs ご飯派」      │
│                                 │
│ あなたの立場を選択：            │
│ [🍞 パン派] [🍚 ご飯派]         │
│                                 │
│ 待機中: パン派 3人 / ご飯派 1人 │
└─────────────────────────────────┘
```

### AI対戦の場合
- ユーザーが選んだ立場の反対をAIが担当
- 常にマッチング成立（待ち時間なし）

---

## 観戦機能（/archive）

### 公開時の機能

| 機能 | 説明 |
|------|------|
| 議論一覧 | 終了した討論の一覧表示 |
| 議論詳細 | 討論内容を読み取り専用で表示 |
| いいね | 単純カウント |
| 勝敗投票 | 「どちらが勝ちだと思う？」 |
| SNSシェア | X共有ボタン + リンクコピー |

### 議論詳細ページ

```
┌─────────────────────────────────┐
│ 「朝食はパン派 vs ご飯派」       │
│                                 │
│ 🤖 AI判定: パン派の勝利         │
│                                 │
│ みんなの投票:                   │
│ パン派 ████████░░ 78%           │
│ ご飯派 ██░░░░░░░░ 22%           │
│                                 │
│ [パン派に投票] [ご飯派に投票]   │
│                                 │
│ [♡ いいね 123]                  │
│ [𝕏 シェア] [🔗 リンクコピー]    │
├─────────────────────────────────┤
│ 討論内容...                     │
└─────────────────────────────────┘
```

### シェア時のテキスト例

```
「朝食はパン派 vs ご飯派」

🤖 AI判定: パン派の勝利
👥 みんなの投票: パン派 78% vs ご飯派 22%

あなたはどっち派？
https://debate-judge.vercel.app/archive/xxx
```

### 将来追加
- コメント機能
- ライブ観戦（対戦中の討論を見る）

---

## ユーザー機能

### プロフィール（/user/[id]）

| 項目 | 公開時 | 将来 |
|------|--------|------|
| 表示名 | ◎ | - |
| 勝率・戦績 | ◎ | - |
| アイコン | - | ◎ |
| AI弱み強み評価 | - | ◎（課金候補） |

### 設定（/settings）

- 表示名変更

---

## OGP設定

シェア時のプレビュー表示に必要。

- 静的OGP（サイト共通）: 公開時に実装
- 動的OGP（議題ごと）: 将来追加

---

## 優先度

### 公開時に実装

1. ヘッダーナビ
2. AI対戦
3. ランダムマッチ（立場選択 + マッチング）
4. フレンド対戦（現状の改修）
5. 議論閲覧（一覧・詳細）
6. いいね・勝敗投票
7. SNSシェア + OGP
8. プロフィール・設定

### 後回し

- リファクタリング
- アイコン機能
- AI弱み強み評価
- 課金機能
- ライブ観戦
- コメント機能
- 動的OGP

---

## DB変更（予定）

### themes テーブル（新規）

```sql
CREATE TABLE themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme TEXT NOT NULL,
  position_a TEXT NOT NULL,
  position_b TEXT NOT NULL,
  is_daily BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### debates テーブル変更

```sql
ALTER TABLE debates ADD COLUMN theme_id UUID REFERENCES themes(id);
ALTER TABLE debates ADD COLUMN player1_position TEXT; -- 'a' or 'b'
ALTER TABLE debates ADD COLUMN player2_position TEXT;
ALTER TABLE debates ADD COLUMN likes_count INT DEFAULT 0;
ALTER TABLE debates ADD COLUMN votes_a INT DEFAULT 0;
ALTER TABLE debates ADD COLUMN votes_b INT DEFAULT 0;
```

### matchmaking_queue テーブル（新規）

```sql
CREATE TABLE matchmaking_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  theme_id UUID REFERENCES themes(id),
  position TEXT NOT NULL, -- 'a' or 'b'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 備考

- 議題は運営が用意（デイリーお題）
- フレンド対戦のみカスタム議題可
- 課金設計はユーザー獲得後に検討
