# 本番反映の実行手順書（2026-08-15・商品体系リニューアル）

> **これは「オーナーがWindowsのコマンドプロンプトで1行ずつ実行する」ための手順書です。**
> 指示書（`DEPLOY_20260815_PRICING.md`）の内容を、そのまま貼れるコマンドに落としたものです。
>
> ⚠️ **なぜAIが直接デプロイしないのか**
> LINE予約の本番はオーナーPC（`C:\Users\n9-f\.line-harness`）とCloudflareにあり、
> このClaudeセッションからは触れません（`LINE_HARNESS_HANDOFF.md` の「最重要の前提」のとおり）。
> このセッションが持っているのは `GOUP55/HACOS-` リポジトリだけです。
> そのため「反映内容の検証」と「実行コマンドの用意」までを行い、実行はオーナーが行います。

## このセッションで確認済みのこと（2026-08-15）

- 反映対象は main の `line-reservation/` 配下。**PR #64・#65・#66 の3本ぶんがすべて入っている**
  （main先頭 `31252be`）
- PR #67（トレーナー確定）は `line-reservation/` を**触っていない**ので、今回の反映範囲は変わらない
- main のコードで自動テストを実行 → **104項目すべて合格**
  （内訳: admin-page 39／cancel-fallback 14／sessions-admin 11／obosan-event 12／morning-run 28）
- 下に出てくるダウンロードURLは全て実際に到達確認済み（HTTP 200）

---

## 事前準備（1回だけ）

コマンドプロンプトを開いて、次の1行を貼ってEnter。以降のコマンドはすべてこの場所で実行します。

```
cd C:\Users\n9-f\.line-harness\apps\worker
```

---

## STEP 1: いまの状態をバックアップ（切り戻し用）

1行ずつ貼ってEnter。

```
copy src\reservation-routes.js src\reservation-routes.js.bak
```

```
copy src\admin-page.js src\admin-page.js.bak
```

---

## STEP 2: D1マイグレーションの適用（Workerデプロイより先に行う）

### 2-1. 今回の新規ぶん（必須）

```
curl -L -o mig-trial-kind.sql https://raw.githubusercontent.com/GOUP55/HACOS-/main/line-reservation/migrations/2026-08-15-trial-kind.sql
```

```
npx wrangler d1 execute line-harness --file=mig-trial-kind.sql --remote
```

> 「本当に実行しますか」と聞かれたら `y` を入れてEnter。
> **`duplicate column name: kind` というエラーが出たら「すでに適用済み」という意味なので、
> そのまま次に進んでOK**です。

### 2-2. 過去ぶんで未適用かもしれないもの（3本・確認してから）

まず、適用済みかどうかを見ます。1行ずつ貼ってEnter。

```
npx wrangler d1 execute line-harness --remote --command "SELECT id, morning_run FROM sessions WHERE date LIKE '2026-08%' ORDER BY date"
```

**見かた**

- 8/2・8/9・8/16・8/23・8/30 の5行が出て `morning_run` が全部 `1` → 8月日程は適用済み。2-3へ
- 行が出ない／5行そろっていない → **未適用**。下の2本目を実行してください
  （⚠️ これが入っていないと「朝RUNのみ」を選んでも対象日が出ません）

```
curl -L -o mig-2026-08-sessions.sql https://raw.githubusercontent.com/GOUP55/HACOS-/main/line-reservation/migrations/2026-08-sessions.sql
```

```
npx wrangler d1 execute line-harness --file=mig-2026-08-sessions.sql --remote
```

### 2-3. 8/29（土）の瞑想イベント（開催が近いので最優先で確認）

```
npx wrangler d1 execute line-harness --remote --command "SELECT id, title FROM sessions WHERE id = '2026-08-29-obosan'"
```

1行出れば適用済み。**何も出なければ未適用**なので、次の2行を実行してください。

```
curl -L -o mig-obosan.sql https://raw.githubusercontent.com/GOUP55/HACOS-/main/line-reservation/migrations/2026-07-28-obosan-session.sql
```

```
npx wrangler d1 execute line-harness --file=mig-obosan.sql --remote
```

### 2-4. 8/16と8/30のお弁当入れ替え

```
npx wrangler d1 execute line-harness --remote --command "SELECT id, food FROM sessions WHERE id IN ('2026-08-16','2026-08-30')"
```

両方とも `わっぱ弁当…` になっていれば、入れ替えは**まだ**です。次の2行を実行してください。
（すでに 8/16=わっぱ弁当 / 8/30=サラダボウル のように分かれていれば適用済み・不要）

```
curl -L -o mig-bento-swap.sql https://raw.githubusercontent.com/GOUP55/HACOS-/main/line-reservation/migrations/2026-08-bento-swap-0816-0830.sql
```

```
npx wrangler d1 execute line-harness --file=mig-bento-swap.sql --remote
```

---

## STEP 3: 予約フォーム（reserve.html）をKVに反映

```
curl -L -o reserve.html https://raw.githubusercontent.com/GOUP55/HACOS-/main/line-reservation/liff/reserve.html
```

```
npx wrangler kv key put --binding=STATIC_KV "liff/reserve.html" --path=reserve.html --remote
```

---

## STEP 4: Worker側の2ファイルを差し替え

```
curl -L -o src\reservation-routes.js https://raw.githubusercontent.com/GOUP55/HACOS-/main/line-reservation/src/reservation-routes.js
```

```
curl -L -o src\admin-page.js https://raw.githubusercontent.com/GOUP55/HACOS-/main/line-reservation/src/admin-page.js
```

---

## STEP 5: デプロイ

```
pnpm run deploy
```

> ⚠️ **`npx wrangler deploy` 単体は使わないでください。**
> ビルドが飛んで古いコードが出る事故が実際に起きています。必ず `pnpm run deploy` です。

---

## STEP 6: 動作確認

**必ずLINEアプリの中から予約フォームを開いて確認してください。**
パソコンのブラウザで開くと管理者ログインのCookieで素通りしてしまい、確認になりません。

フォーム: `https://liff.line.me/2010528512-LJhoz7MP`

### 参加区分まわり

- [ ] 「回数券（月まとめ買い）」が**消えている**
- [ ] 「今月の開催日をまとめて選択」ボタンが**消えている**
- [ ] 「朝RUNのみ（6:30〜）参加費¥0」が出る
- [ ] 「ご利用中の方 ¥2,000」「都度 ¥3,000」「HMC会員」「セミパ会員」が出る
- [ ] 朝RUN開催日を選ぶと朝RUNの質問が出る／「朝RUNのみ」を選ぶとその質問が消える

### いちばん大事な確認

- [ ] **「朝RUNのみ」で予約しても、その日の残席が減らない**
      やり方: 予約前の残席をメモ → 朝RUNのみで予約 → フォームを開き直して残席が同じことを見る

### 通知・完了画面

- [ ] 「朝RUNのみ」で予約するとスタッフLINEに「🏃 新規予約【朝RUNのみ・¥0】」で届く
- [ ] 「HMC会員」で予約すると、完了メッセージに「当日のお支払いはありません」が入る
- [ ] 既存の 体験／相談／TACOS／瞑想 の予約が今までどおり動く

### 7日間お試し

- [ ] フォーム上部の「お試し・体験を申し込む →」に**「お申し込みの種類」**が出て、
      「体験パーソナル ¥3,500」と「フィットネスジャーニー 7日間お試し ¥9,000」を選べる
- [ ] 7日間お試しで申し込むと、スタッフLINEに「🚩 ジャーニー7日間お試し【リクエスト・要日時確定】」で届く
- [ ] LPの「7日間お試しを申し込む」ボタン（`?apply=trial7` 付き）から来ると、
      フォームが開いて種別まで選ばれている

### 管理画面

`https://line-harness-admin-8b17f520.pages.dev` の `/admin/reservations`

- [ ] 新しい区分のバッジが出る（🏃 ✅ 👤 🌅 💪）
- [ ] 過去の予約（会員／ビジター／回数券）のバッジも今までどおり表示される
- [ ] リクエスト一覧に種別のバッジ（🚩 ／ 🌱）が出る

---

## 切り戻し（うまくいかなかったとき）

`apps\worker` で、上から順に1行ずつ。

```
curl -L -o reserve-old.html https://raw.githubusercontent.com/GOUP55/HACOS-/ae08c23/line-reservation/liff/reserve.html
```

```
npx wrangler kv key put --binding=STATIC_KV "liff/reserve.html" --path=reserve-old.html --remote
```

```
copy src\reservation-routes.js.bak src\reservation-routes.js
```

```
copy src\admin-page.js.bak src\admin-page.js
```

```
pnpm run deploy
```

STEP 1のバックアップが無い場合は、代わりに次の2行で旧コードを取り直せます。

```
curl -L -o src\reservation-routes.js https://raw.githubusercontent.com/GOUP55/HACOS-/ae08c23/line-reservation/src/reservation-routes.js
```

```
curl -L -o src\admin-page.js https://raw.githubusercontent.com/GOUP55/HACOS-/ae08c23/line-reservation/src/admin-page.js
```

**データベースは触らないので、切り戻しでお客様の予約データが消えることはありません。**
（`kind` 列が増えたままになりますが、旧コードは使わないだけで害はありません）

---

## 反映が終わったら

1. `DEPLOY_20260815_PRICING.md` の冒頭に「✅ YYYY-MM-DD 本番反映完了」を追記
2. `SESSION_ROLES.md` の連絡板から、8/15「デプロイの手へ」の行を削除

---

## 別件で気づいたこと（今回の反映とは別のタスク）

**9月の日程がまだD1に入っていません。**
`migrations/2026-08-sessions.sql` は8/30までです。予約フォームは「当月最後の開催日の正午」を
過ぎると空になる作りなので、**8/30の正午より前に9月ぶんを入れる必要があります**。
やり方は `line-reservation/MONTHLY.md`（テンプレートをコピーして日付とメニューを埋め、
D1に1回流すだけ。Workerのデプロイは不要）。

これは司令塔セッション側で9月の日程・クラス名・お弁当が確定してからの作業です。
