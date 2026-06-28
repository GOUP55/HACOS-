# HACOS × HMC LINE予約フォーム 実装ガイド

既存の LINE Harness（`line-harness.hacos.workers.dev`）に追加するファイル群。

## ファイル構成

```
line-reservation/
├── schema.sql              # D1 テーブル定義 + 7月シードデータ
├── liff/
│   └── reserve.html        # LIFF 予約フォーム（LINEアプリ内で表示）
└── src/
    ├── reservation-routes.js  # Hono ルートハンドラ（ハーネスに追加）
    └── line-utils.js          # LINE API ヘルパー（トークン検証・Push送信）
```

## セットアップ手順

### 1. D1 データベース作成・マイグレーション

```bash
wrangler d1 create hacos-reservations
# 表示された database_id を wrangler.toml に記載

wrangler d1 execute hacos-reservations --file=line-reservation/schema.sql --remote
```

### 2. wrangler.toml に追記

```toml
[[d1_databases]]
binding = "DB"
database_name = "hacos-reservations"
database_id = "<YOUR_D1_ID>"

[triggers]
crons = ["0 9 * * *"]   # JST 18:00 に前日リマインド送信
```

### 3. Secrets 登録（コードに直書き厳禁）

```bash
wrangler secret put CHANNEL_ACCESS_TOKEN   # Messaging API チャネルアクセストークン
wrangler secret put LINE_LOGIN_CHANNEL_ID  # ハコスラインログイン の Channel ID
wrangler secret put STAFF_USER_IDS         # スタッフの LINE userId（カンマ区切り）
wrangler secret put LIFF_ID               # LINE Developers で作成した LIFF ID
```

### 4. ハーネスの src/index.js に追加

```javascript
import { reservationRoutes, sendReminders } from './reservation-routes.js';

// ルートに追加
app.route('/', reservationRoutes);

// Cron ハンドラに追加
export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },
};
```

### 5. LIFF HTML を配信する方法（2択）

**方法A: Cloudflare Workers Static Assets**
```toml
[assets]
directory = "./line-reservation/liff"
```
→ `/liff/reserve.html` が自動配信される

**方法B: KV に格納**
```bash
wrangler kv key put --binding=STATIC_KV "liff/reserve.html" --path=line-reservation/liff/reserve.html
```

### 6. LIFF ID の注入

`reserve.html` の `'__LIFF_ID__'` を実際の LIFF ID に置換する処理が
`reservation-routes.js` の `/liff/reserve` ルートに含まれています。

## 動作確認チェックリスト

- [ ] `wrangler d1 execute ... --remote` でテーブル作成
- [ ] `GET /api/sessions` が sessions を返す
- [ ] LIFF URL（`https://liff.line.me/{LIFF_ID}`）をLINEで開くとフォームが表示される
- [ ] 予約送信後に本人のLINEに確認メッセージが届く
- [ ] スタッフのLINEに通知が届く
- [ ] 満席時に「満席」表示・予約不可になる

## 環境変数一覧

| 変数名 | 取得場所 |
|---|---|
| `CHANNEL_ACCESS_TOKEN` | LINE Developers > 公式パーソナルジムGOroom > Messaging API設定 |
| `LINE_LOGIN_CHANNEL_ID` | LINE Developers > ハコスラインログイン > チャネル基本設定 > Channel ID |
| `STAFF_USER_IDS` | LINE公式アカウント管理画面 or ハーネスの friends テーブル |
| `LIFF_ID` | LINE Developers > ハコスラインログイン > LIFF タブ |
