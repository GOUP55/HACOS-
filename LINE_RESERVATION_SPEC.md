# HACOS × HMC｜LINE予約フォーム 設計書（LINEハーネス連携 / LIFF）

既存の **LINEハーネス**（`line-harness.hacos.workers.dev` / Cloudflare Worker）に
予約機能を追加し、**「友だち追加 → 予約 → 確認 → リマインド」をLINE内で完結**させる。
Googleフォーム＋GASを置き換える本命構成。

> このドキュメントは実装者（ハーネス開発者）向けの仕様書です。
> ハーネス内部（DB種別・ルーティング・既存テーブル）は未確認のため、
> §10「前提・要確認」を最初に擦り合わせてください。

---

## 1. ゴール / 非ゴール

**ゴール**
- LINEログイン済みの状態で予約（氏名・連絡先の手入力ゼロ＝userId/表示名を自動取得）
- 予約完了で **本人のLINEに確認メッセージ** ＋ **スタッフに通知**
- **定員10名/回** の残枠管理（オーバーブッキング防止）
- 開催日程は**スケジュールを単一の真実源（source of truth）**から取得し、手修正を排除
- 流入計測（`?ref=` 由来）を予約まで紐づけ

**非ゴール（初期）**
- 決済（弁当・TACOSは「予約意思の収集」まで。集金は当日 or 別途）
- 会員ステータスの厳密判定（自己申告でOK）

---

## 2. 全体構成

```
[LINEアプリ/ブラウザ]
   │  LP「予約する」/ リッチメニュー
   ▼
[LIFF 予約フォーム]  ← ハーネスが配信(静的HTML+JS)
   │  liff.init → getProfile()/getIDToken()
   ▼
[Worker API]  (line-harness.hacos.workers.dev)
   ├─ GET  /api/sessions          開催回＋残枠
   ├─ POST /api/reservations      予約作成（IDトークン検証→定員チェック→保存）
   ├─ GET  /api/my-reservations   自分の予約一覧
   └─ POST /api/reservations/:id/cancel  キャンセル
   │
   ├─ D1/KV(予約・セッション保存)  ← 既存 friends テーブルと連携
   └─ Messaging API(Push: 本人確認 + スタッフ通知 + 前日リマインド)
```

技術前提：Cloudflare Workers（既存）。保存は **D1（推奨, リレーショナル＝定員集計が容易）**。
スケジュール配信のため Worker の **Cron Triggers** でリマインド送信。

---

## 3. ユーザーフロー

1. LP/リッチメニューの「予約する」→ **LIFF URL** を開く
2. `liff.init()` → 未ログインなら `liff.login()` → `liff.getProfile()` で `userId`/`displayName` 取得
3. `GET /api/sessions` で開催回（日付・内容・**残枠**）を表示
4. 入力：参加希望日（複数可）／参加区分／朝RUN／弁当／TACOS／メッセージ
5. 送信時に `liff.getIDToken()` を付けて `POST /api/reservations`
6. Worker：IDトークン検証 → 定員チェック → 予約保存 → **本人へ確認Push＋スタッフ通知** → 200
7. 完了画面表示 → `liff.closeWindow()`（LINE内の場合）

---

## 4. LIFF 設定（LINE Developers）

- 対象は **LINEハーネスと同一チャネル**（friends と userId を一致させるため）
- LIFFアプリを1つ追加
  - エンドポイントURL：`https://line-harness.hacos.workers.dev/liff/reserve`
  - サイズ：`Full`
  - `scope`：`profile`, `openid`（IDトークン検証に `openid` 必須）
  - ボットリンク機能：`On (Aggressive)`（フォーム経由でも友だち追加を促進）
- 取得する `LIFF_ID` を Worker env に設定（§9）

LP側リンクの差し替え（実装後）：
`https://line-harness.hacos.workers.dev/auth/line?ref=lp`
→ `https://liff.line.me/{LIFF_ID}?ref=lp`（未ログインなら自動でログイン→友だち追加）

---

## 5. 画面・入力項目（LIFF）

§ 既存Googleフォーム7月版（`GOOGLE_FORM_RESERVATION_JULY.md`）と項目を揃える。
氏名・連絡先・LINE名は **自動取得のため画面から削除**。

| 項目 | UI | 必須 | 備考 |
|---|---|---|---|
| 参加希望日 | カード選択（複数可） | ○ | `/api/sessions` から動的生成。残枠0は「満席」で選択不可 |
| 参加区分 | ラジオ | ○ | はじめての体験¥3,500 / 会員¥2,000 / ビジター¥3,000 / 相談したい |
| 朝RUN(6:30〜) | ラジオ | − | 開催日(7/5・7/19)のみ表示。参加/しない/当日決める |
| お弁当 | チェック（複数可） | − | セッションのmenuから生成。¥は表示のみ |
| TACOS Party(7/19) | ラジオ | − | 参加費(タコス込み)¥3,000。7/19選択時のみ表示 |
| メッセージ | テキスト | − | 不安・質問など |

**ヘッダー文：**
```
HACOS × HMC ご予約
毎週日曜 AM7:30〜 / 観音寺 HACOS
LINEログイン済みなので、お名前の入力は不要です😊
```

---

## 6. データモデル（D1 想定）

```sql
-- 開催回（スケジュールの真実源）
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,         -- 例 '2026-07-05'
  date          TEXT NOT NULL,            -- 'YYYY-MM-DD'
  display_date  TEXT NOT NULL,            -- '7/5（日）'
  title         TEXT NOT NULL,            -- 'セルフマッサージ＆ストレッチ'
  food          TEXT,                     -- 'サラダビビンそば & 発酵彩りキンパ'
  trainers      TEXT,                     -- 'GO, みどり（KITCHEN）'
  morning_run   INTEGER DEFAULT 0,        -- 朝RUN有無 1/0
  capacity      INTEGER NOT NULL DEFAULT 10,
  is_open       INTEGER NOT NULL DEFAULT 1,-- 開催1/休み0
  note          TEXT
);

-- 予約
CREATE TABLE reservations (
  id            TEXT PRIMARY KEY,         -- uuid
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  line_user_id  TEXT NOT NULL,            -- friends.user_id と一致
  display_name  TEXT,
  category      TEXT NOT NULL,            -- 体験/会員/ビジター/相談
  morning_run   TEXT,                     -- join/skip/decide
  bento         TEXT,                     -- カンマ区切り（選択メニュー）
  tacos         TEXT,                     -- join/maybe/no
  message       TEXT,
  ref           TEXT,                     -- 流入元(?ref=)
  status        TEXT NOT NULL DEFAULT 'confirmed', -- confirmed/cancelled
  created_at    TEXT NOT NULL,
  UNIQUE(session_id, line_user_id)        -- 同一回の二重予約防止
);

CREATE INDEX idx_res_session ON reservations(session_id, status);
```

- **残枠** = `capacity - COUNT(status='confirmed')`。
- `sessions` は §11 のJSONをseedするか、管理用に既存スプレッドシートから同期（schedule-sync.gsの発展）。

---

## 7. API 仕様

すべて JSON。CORSはLIFFオリジン（同一Worker配信なら不要）。

### GET /api/sessions
開催予定（`is_open=1` かつ `date >= today`）を残枠付きで返す。
```json
{ "sessions": [
  { "id":"2026-07-05","display_date":"7/5（日）","title":"セルフマッサージ＆ストレッチ",
    "food":"サラダビビンそば & 発酵彩りキンパ","morning_run":true,
    "capacity":10,"remaining":4,"bento":[{"name":"サラダビビンそば","price":null},
    {"name":"発酵彩りキンパ","price":900}],"tacos":false }
]}
```

### POST /api/reservations
ヘッダ `Authorization: Bearer {IDトークン}`。Body：
```json
{ "session_ids":["2026-07-05"], "category":"体験", "morning_run":"join",
  "bento":["発酵彩りキンパ"], "tacos":"no", "message":"", "ref":"lp" }
```
処理：
1. **IDトークン検証**：`POST https://api.line.me/oauth2/v2.1/verify`（`id_token`,`client_id=LINE_LOGIN_CHANNEL_ID`）→ `sub`=userId, `name` 取得。**Body内のuserIdは信用せずトークンから取得**。
2. 各 `session_id` で `is_open` と **残枠>0** をトランザクション内で確認（D1 batch）。満席なら `409 {error:"full",session_id}`。
3. `reservations` へ INSERT（`UNIQUE` 衝突＝二重予約は `200` 冪等扱い or `409 already`）。
4. **本人へ確認Push**（§8）＋**スタッフ通知**（既存パターン流用）。
5. 返却：`{ ok:true, reservations:[...] }`

### GET /api/my-reservations
IDトークンの userId の `confirmed` 予約一覧。

### POST /api/reservations/:id/cancel
本人のみ可（トークンの userId と一致）。`status='cancelled'`。残枠が回復。

冪等性：クライアントは `Idempotency-Key` ヘッダ（uuid）を付与、二重送信を吸収。

---

## 8. LINEメッセージ（Messaging API）

**予約確認（本人へ・Flex推奨／最低でもtext）**
```
✅ ご予約ありがとうございます！

▼ ご予約内容
7/5（日）セルフマッサージ＆ストレッチ
AM7:30〜10:00 / 観音寺 HACOS
区分：はじめての体験（¥3,500）
朝RUN：参加（6:30〜）
お弁当：発酵彩りキンパ ¥900

動きやすい服装でお越しください。
日曜の朝、お待ちしています🌅
変更・キャンセルはこのトークから「キャンセル」と送ってください。
```

**スタッフ通知**（friends/STAFF_USER_IDS へ push。`line-notification.gs` のLINE版と同等）
```
🆕 新規予約
7/5（日）／ 体験
お名前(LINE)：観音寺 花子
朝RUN:参加 / 弁当:キンパ / TACOS:- 
残枠：3
```

**前日リマインド**（Cron Triggers：毎日 18:00 JST に翌日分を抽出して push）
```
🌅 明日 7/5（日）AM7:30、HMCでお待ちしています！
朝RUNは6:30〜。お気をつけてお越しください。
```

---

## 9. 環境変数（wrangler secret / vars）

| 変数 | 用途 |
|---|---|
| `LINE_LOGIN_CHANNEL_ID` | IDトークン検証の `client_id` |
| `LIFF_ID` | LIFF URL生成 / フロント埋め込み |
| `CHANNEL_ACCESS_TOKEN` | Push送信（既存ハーネスと共用） |
| `STAFF_USER_IDS` | スタッフ通知先（カンマ区切り） |
| `DB`（D1 binding） | 予約・セッション保存 |

> トークン類は**コード直書き禁止**。`wrangler secret put` で登録。

---

## 10. 前提・要確認（実装前に擦り合わせ）

1. ハーネスの**保存基盤**は何か（D1 / KV / 外部DB）。本書はD1前提。
2. `friends` テーブルのスキーマ（`user_id` 列名・型）。予約と突合するため。
3. ハーネスの**フレームワーク/ルーター**（Hono等）と既存ルート構成。
4. **LINEログインチャネル**のID（IDトークン検証に必要）。Messagingチャネルと同一か。
5. リッチメニュー運用の有無（予約導線をメニューに置くか）。

---

## 11. 7月シードデータ（sessions）

```json
[
 {"id":"2026-07-05","date":"2026-07-05","display_date":"7/5（日）",
  "title":"セルフマッサージ＆ストレッチ","food":"サラダビビンそば & 発酵彩りキンパ",
  "trainers":"GO, みどり（KITCHEN）","morning_run":1,"capacity":10,"is_open":1,
  "note":"朝RUN 6:30〜あり"},
 {"id":"2026-07-12","date":"2026-07-12","display_date":"7/12（日）",
  "title":"LEAN BODY TRAINING〜燃やして締める60分〜","food":"カオマンガイ",
  "trainers":"片山めぐみ, ふみや（KITCHEN）","morning_run":0,"capacity":10,"is_open":1,
  "note":"朝RUNなし"},
 {"id":"2026-07-19","date":"2026-07-19","display_date":"7/19（日）",
  "title":"ピラティス","food":"ビーフストロガノフ",
  "trainers":"ちひろ, ふみや（KITCHEN）","morning_run":1,"capacity":10,"is_open":1,
  "note":"朝RUN 6:30〜あり ／ 午後 TACOS Party 12:00〜21:00（参加費¥3,000）"},
 {"id":"2026-07-26","date":"2026-07-26","display_date":"7/26（日）",
  "title":"お休み","food":null,"trainers":null,"morning_run":0,"capacity":0,"is_open":0,
  "note":"スタッフ不在のためクローズ"}
]
```

---

## 12. 実装フェーズ（推奨）

- **Phase 1（最小で公開）**：`sessions` 表示／予約INSERT／IDトークン検証／本人確認Push／スタッフ通知。定員チェックあり。
- **Phase 2**：残枠リアルタイム表示／キャンセル／前日リマインド（Cron）。
- **Phase 3**：弁当・TACOS詳細、my-reservations画面、refを予約に保存して効果測定。
- **共存**：移行期はGoogleフォームを残し、LP主CTAをLIFFに。安定後にフォーム停止。

## 13. セキュリティ/運用メモ
- 予約系は**必ずサーバ側でIDトークン検証**。クライアント送信のuserIdは信用しない。
- 定員チェックは**トランザクション内**でCOUNT→INSERT（D1 batch / `UNIQUE`制約併用）。
- 二重送信は `Idempotency-Key` ＋ `UNIQUE(session_id,line_user_id)` で吸収。
- 個人情報（予約・メッセージ）はチャネル運用ポリシーに準拠。退会時の扱いを定義。

---

*作成：2026年7月 ／ 参照：GOOGLE_FORM_RESERVATION_JULY.md・schedule-sync.gs・line-notification.gs*
