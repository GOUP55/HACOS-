# HACOS × HMC LINE予約フォーム 実装ガイド（2026-07-02 改訂版）

既存の LINE Harness（`line-harness.hacos.workers.dev`）に追加したファイル群。

> ✅ **このフォルダの内容は 2026-07-02 時点で本番のWorkerに反映・デプロイ済みで、
> 実機での予約完了まで動作確認済み。** 以下は「何をどう設定したか」の記録と、
> 別環境にもう一度セットアップする場合の正しい手順。

## ⚠️ 旧版READMEからの重要な訂正

| 項目 | 旧版（誤り・危険） | 正（動作確認済み） |
|---|---|---|
| APIパス | `/api/sessions` `/api/reservations` | **`/api/liff/sessions` `/api/liff/reservations`** |
| D1データベース | 新規に `hacos-reservations` を作成 | **既存の `line-harness` DB をそのまま使う**（新規作成は不要） |
| LIFF HTML配信 | `[assets]` 追加でも可、と案内 | **KV（STATIC_KV）方式のみ使用**。`[assets]` はハーネス本体の配信と衝突する恐れがあるため使わない |
| index への組み込み | `export default {...}` を丸ごと追加 | **既存の `apps/worker/src/index.ts` に3行だけ追記**（丸ごと置き換えは既存機能を壊す） |
| デプロイ | `npx wrangler deploy` | **`apps\worker` で `pnpm run deploy`**（`npx wrangler deploy` 単体はビルドを飛ばすため変更が反映されない事故が実際に起きた） |

### なぜ `/api/liff/` パスなのか（401エラーの原因と対策）

ハーネス本体は `app.use('*', authMiddleware)` で**すべてのパスに管理者認証**をかけている。
`/api/sessions` のような一般パスだと、LIFF（一般ユーザーのLINEアプリ）からのアクセスが
**401 Unauthorized** で弾かれる。認証ミドルウェア
（`apps/worker/src/middleware/auth.ts`）の公開パス許可リストに **`/api/liff/`（前方一致）** が
含まれているため、予約APIはこのプレフィックス配下に置く必要がある。

※ブラウザで直接開くと管理画面のログインCookieで通ってしまうので、このバグはブラウザ確認では
気づけない。**動作確認は必ずLINEアプリ内のLIFFで行うこと。**

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

## セットアップ手順（実際に行った正しい手順）

### 1. D1 テーブル作成（既存DBに追加）

新しいDBは作らない。既存の `line-harness` DB に `sessions` / `reservations` テーブルを追加する。

```bash
wrangler d1 execute line-harness --file=line-reservation/schema.sql --remote
```

### 2. wrangler.toml に追記（apps/worker/wrangler.toml）

D1バインディングは既存のものをそのまま使う。追加するのはKVとcronのみ。

```toml
[[kv_namespaces]]
binding = "STATIC_KV"
id = "b86324891c924346b20e6639035bc13f"

[triggers]
crons = ["0 9 * * *"]   # UTC 9:00 = JST 18:00 に前日リマインド送信
```

### 3. Secrets 登録（コードに直書き厳禁）

```bash
wrangler secret put CHANNEL_ACCESS_TOKEN   # Messaging API チャネルアクセストークン
wrangler secret put LINE_LOGIN_CHANNEL_ID  # ハコスラインログイン の Channel ID（2010528512）
wrangler secret put STAFF_USER_IDS         # スタッフの LINE userId（カンマ区切り）
wrangler secret put LIFF_ID                # LIFF ID（2010528512-LJhoz7MP）
```

### 4. ハーネスの `apps/worker/src/index.ts` に3箇所だけ追記

既存の `export default` や `scheduled` を**置き換えない**こと。

```typescript
// (1) ファイル上部の import 群に追加
import { reservationRoutes, sendReminders } from './reservation-routes.js';

// (2) 他の app.route(...) の並びに追加
app.route('/', reservationRoutes);

// (3) 既存の scheduled() 内の cron 分岐に追加
//     event.cron === "0 9 * * *" のときに sendReminders(env) を呼ぶ
```

### 5. LIFF HTML を KV に格納

```bash
wrangler kv key put --binding=STATIC_KV "liff/reserve.html" --path=line-reservation/liff/reserve.html --remote
```

### 6. デプロイ

```bash
cd apps\worker
pnpm run deploy
```

**注意：`npx wrangler deploy` 単体は使わない**（ビルドが走らず古いコードのままデプロイされる）。

### 7. LIFF ID の注入

`reserve.html` の `'__LIFF_ID__'` を実際の LIFF ID に置換する処理が
`reservation-routes.js` の `/liff/reserve` ルートに含まれている（手作業での置換は不要）。

## 動作確認チェックリスト

- [x] `wrangler d1 execute line-harness ... --remote` でテーブル作成
- [x] `GET /api/liff/sessions` が sessions を返す
- [x] LIFF URL（`https://liff.line.me/2010528512-LJhoz7MP`）をLINEで開くとフォームが表示される
- [x] 予約送信後に本人のLINEに確認メッセージが届く
- [x] スタッフのLINEに通知が届く（現在は GO 本人のみ登録）
- [ ] 満席時に「満席」表示・予約不可になる（未検証）

## 環境変数一覧

| 変数名 | 取得場所 |
|---|---|
| `CHANNEL_ACCESS_TOKEN` | LINE Developers > 公式パーソナルジムGOroom > Messaging API設定 |
| `LINE_LOGIN_CHANNEL_ID` | LINE Developers > ハコスラインログイン > チャネル基本設定 > Channel ID |
| `STAFF_USER_IDS` | ハーネスの friends テーブル（友だち登録済みスタッフがメッセージを送ると line_user_id が入る） |
| `LIFF_ID` | LINE Developers > ハコスラインログイン > LIFF タブ |

## 通知の方針（2026-07-02 決定）

予約通知は **LINE予約フォーム（このシステム）に一本化**する。
リポジトリ直下の `line-notification.gs`（Googleフォーム予約用のGAS通知）は
**未設定のまま予備扱い**とし、新たにセットアップしない。
Googleフォーム予約を廃止する場合は `line-notification.gs` ごと削除してよい。
