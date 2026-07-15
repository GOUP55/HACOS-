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
├── migrations/             # 本番D1向けの差分SQL（各1回だけ実行）
├── liff/
│   └── reserve.html        # LIFF 予約フォーム（LINEアプリ内で表示）
├── src/
│   ├── reservation-routes.js  # Hono ルートハンドラ（ハーネスに追加）
│   └── line-utils.js          # LINE API ヘルパー（トークン検証・Push送信）
└── tests/                  # フォームUIの自動テスト（モック環境・本番に触らない）
```

## 毎月の日程追加

**翌月の日程を入れないと、当月最後の開催日の正午以降フォームが空になる。**
やり方は `MONTHLY.md`（月次運用ガイド）を参照。テンプレートをコピーして
`【 】`を埋め、D1に1回流すだけ（Workerのデプロイは不要）。

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
- [x] 満席時に予約不可になる（2026-07-06 ロジック検証済み。SQLiteで定員+追加枠ちょうどで締まることを確認）
- [ ] 満席時の「満席」表示の実機での見た目確認（次回満席発生時に確認する）

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

## 2026-07-06 の本番反映

回数券対応（PR #16）＋バグ修正（PR #17）＋体験パーソナルのリクエスト型独立（PR #18）を
LINE Harness側セッションから本番Workerに反映済み（手順と記録は `DEPLOY_KAISUKEN.md`）。
以後、`reserve.html` を変更したときはデプロイ前に `tests/` の自動テストを実行すること。

## 2026-07-04 の変更（マイグレーション必須）

本番のD1に既にテーブルが存在するため、以下の変更は `schema.sql` の再実行だけでは
反映されない。**`migrations/2026-07-04-trainer-and-tacos-session.sql` を1回だけ実行すること。**

```bash
wrangler d1 execute line-harness --file=line-reservation/migrations/2026-07-04-trainer-and-tacos-session.sql --remote
```

### 変更内容

- **体験パーソナルの担当トレーナー選択を追加**：参加区分で「体験パーソナル」を選ぶと、
  担当（GO／片山めぐみ／ちひろ／黒田陽子／お任せ）を選べるようになった。
  `reservations` テーブルに `trainer TEXT` 列を追加。
- **参加区分の並び順・表示名を変更**：「はじめての体験」→「体験パーソナル」に正式名称化し、
  リストの最後尾に移動（会員・ビジター・相談 → 体験パーソナルの順）。
- **TACOS Party を7/19ピラティスから独立した別枠セッションに変更**：
  従来は7/19ピラティスを選ぶと追加質問として表示していたが、分かりにくいため
  `2026-07-19-tacos` という独立したセッション（`7/19（日）午後 TACOS Party`）として
  参加希望日の一覧に表示するようにした。ピラティスとは別に単独参加もできる。
  旧来の「参加したい／興味あり／参加しない」という質問形式は廃止。
- **キャンセル後に同じ日程を予約し直せなくなるバグを修正**：`reservations` テーブルは
  `UNIQUE(session_id, line_user_id)` 制約があるため、一度キャンセルした予約は
  cancelled状態のまま同じ行が残り、再予約しようとすると制約違反で弾かれ、
  かつエラーハンドラがそれを「既に予約済み」と誤認してサイレントに成功扱いにしていた
  （実際には予約されていない）。cancelled行を再有効化するよう修正済み。

## マイグレーション一覧（本番D1に各1回だけ実行・上から順に）

適用済みかどうかが不明な場合も、いずれも再実行で壊れない書き方
（IF NOT EXISTS / INSERT OR IGNORE / UPDATE）だが、**ALTER TABLEを含む2本
（07-04と07-06-time-label）は2回目の実行で「duplicate column」エラーになる**。
エラーが出たら適用済みということなので無視してよい。

| ファイル | 内容 |
|---|---|
| `2026-07-04-trainer-and-tacos-session.sql` | reservations.trainer列追加、TACOS Party別枠化 |
| `2026-07-06-trial-requests.sql` | trial_requestsテーブル追加（**未適用だと体験パーソナル申込が500になる**） |
| `2026-07-06-tacos-note-and-fixes.sql` | TACOS Partyの案内文更新 |
| `2026-07-06-time-label.sql` | sessions.time_label列追加（開催時間のセッション個別表示） |
| `mig-2026-07-15-cancelled-at.sql` | reservations.cancelled_at列追加（キャンセル日時の記録。**Workerデプロイ前に適用**） |

```bash
wrangler d1 execute line-harness --file=line-reservation/migrations/<ファイル名> --remote
```

## 2026-07-06 の変更（品質改善・マイグレーション必須）

**`migrations/2026-07-06-time-label.sql` を本番D1に1回だけ実行すること。**
また、Worker（reservation-routes.js）とKVのHTML（reserve.html）は**必ずセットで**デプロイすること
（APIのレスポンス形式が変わったため、片方だけ更新すると一部満席時の表示が崩れる）。

```bash
wrangler d1 execute line-harness --file=line-reservation/migrations/2026-07-06-time-label.sql --remote
wrangler kv key put --binding=STATIC_KV "liff/reserve.html" --path=line-reservation/liff/reserve.html --remote
# その後 apps\worker で pnpm run deploy
```

### 修正内容

- **一部満席時に成立した予約が「失敗した」ように見えるバグを修正**：複数日程を同時予約して
  途中の日程が満席だった場合、従来は最初の満席で即エラーを返していたため、先に成立した予約が
  あるのに画面は「満席のため予約できませんでした」だけを表示していた（ユーザーは全滅と誤解し、
  実際には予約とLINE通知が発生している）。全日程を処理して成立分と満席分を分けて返し、
  完了画面で「※◯◯は満席のため予約できませんでした」と明示するよう変更。
- **TACOS Party（午後開催）にも朝クラスの時間が案内されるバグを修正**：確認メッセージ・
  前日リマインド・完了画面が「AM7:30〜10:00」「動きやすい服装で」固定だったため、
  12:00〜21:00開催のTACOS Party予約者に誤った時間が届いていた。`sessions.time_label` 列を
  追加し、セッションごとの開催時間を表示するようにした（NULLなら従来どおり朝クラス表記）。
- **回数券の「今月まとめて選択」がTACOS Partyまで選択するバグを修正**：回数券は朝クラス
  専用のため、特別枠（id が日付と一致しないセッション）を除外。さらにサーバー側でも
  「回数券×特別枠」の組み合わせを拒否するガードを追加（UIをすり抜けても成立しない）。
- **予約できなかった理由の出し分けを追加**：満席／受付終了／回数券対象外を別々の文言で表示。
- **満席エラーに内部ID（`2026-07-19-tacos` 等）が表示される問題を修正**：日付＋クラス名で表示。
- **朝RUN開催日の案内文を実データから自動生成**：「7/5・7/19」のハードコードを廃止
  （月替わりで文言が古くなるのを防止）。
- **満席直後の再表示を改善**：満席エラー時に日程一覧を自動で取り直し、最新の残席を表示。
- **DB由来文字列のHTMLエスケープを追加**（セッション名・お弁当名など。スタッフ入力でも事故防止）。

### 検証済み（SQLite実行で確認）

- schema.sql 単発での新規構築、旧スキーマ＋マイグレーション4本の順次適用、の両経路が成功
- 満席ガード：定員1＋追加枠3のセッションに6件連続INSERTで、4件目まで成立・5件目以降が拒否される

## 予約管理画面（スタッフ用・認証必須）

予約一覧・体験リクエストの確定待ちをブラウザで見られるスタッフ専用画面。
会員のLINE表示名・メッセージを含むため**必ず認証付きのパスで運用する**。

- URL: `https://line-harness.hacos.workers.dev/api/admin/reservations`
- **開き方（2026-07-15更新）**: `https://line-harness.hacos.workers.dev/admin-login` を開き、
  スタッフ用APIキーでログイン → 自動で予約管理画面に移動する。ログインは7日間有効。
  スタッフにはこの `/admin-login` のURLをブックマークしてもらう
- なぜ専用ログインページが要るか: 管理SPA（pages.dev）とWorker（workers.dev）は
  ドメインが別のため、SPAでログインしたcookieはChromeの保護により管理画面URLの
  直打ちには使われない。Worker同一ドメインの `/admin-login` でログインすれば
  cookieがファーストパーティ扱いになり、直打ちで開けるようになる
- **パスを `/admin/...` のような非APIパスに変えてはいけない**。ハーネスの認証は
  「/api/ で始まらないパスは静的アセット扱いで素通し」のため、非APIパスに置くと
  個人情報が認証なしで公開される。`tests/admin-page.test.mjs` にこのパス規約を守る
  ガードテストがあり、旧パスに戻すとテストが落ちる

## 2026-07-15 の変更（改善第1弾: キャンセル可視化＋KITCHEN向け集計）

**`migrations/mig-2026-07-15-cancelled-at.sql` を本番D1に1回だけ実行してから、Workerをデプロイすること。**
（コード側はmigration未適用でもキャンセル処理が落ちないフォールバック付きだが、その間の日時は記録されない）
LIFF（reserve.html）は無変更のため**KV更新は不要**。

- **キャンセル者の表示**: 各日程カードに「キャンセル N名: 名前（7/14 21:03）」を取り消し線付きで表示。
  キャンセル時に `cancelled_at` を記録し、再予約時はクリア。既存データ（列追加前）は「日時不明」表示
- **お弁当・朝RUN・TACOSの集計行**（KITCHEN向け）: 日程ごとに
  「🍱 メニュー×個数 ／ 🏃 朝RUN N名（＋当日決めM） ／ 🌮 TACOS N名」を表示。
  お弁当は複数日程の同時予約でも該当日程ぶんだけを数える。想定外の形式は「形式不明(...)」として可視化
- **既存バグ修正**: 予約者行の🏃朝RUNバッジが日本語値（'参加したい'）と比較していて、
  LIFFの実保存値（'join'）では一度も表示されていなかった。join/decide両対応に修正
