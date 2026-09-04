# セッション役割表（全Claudeセッション必読・作業前にここを見る）

> 2026-07-06制定。複数セッションが同じファイルを同時に触り、マージ競合が実際に発生したため
> （PR #21、2秒差の衝突）、以後は下記の担当分けを厳守する。
> **迷ったら作業せず、ユーザーに「どのセッションの担当ですか？」と確認する。**

## 役割分担

| セッション | 呼び名 | 担当（やること） | やらないこと |
|---|---|---|---|
| 🏛 **企画・設計セッション** | 「司令塔」 | LP全般（`hacos-hmc-lp.html` / `premium.html` / `guide.html` / `index.html`）、料金・回数券・キャンペーンの**設計と判断**、`line-reservation/` の**コード変更**、mainへの公開（ユーザー承認後） | 本番Worker/D1/KVへの反映（デプロイ） |
| 🔧 **Harnessセッション** | 「デプロイの手」 | LINE予約の**本番反映のみ**：mainからファイルを取得→KV反映→Worker更新→`pnpm run deploy`→migrations適用→LINE実機確認 | リポジトリのコードを**書き換えない**（mainにあるものをそのまま反映するだけ。直したい点があれば連絡板に書いてユーザー経由で司令塔へ） |
| 🆕 **その他・新規セッション** | — | 開始時に本ファイルと `NEXT_CHAT_HANDOFF.md` を読む。上2つの担当領域には**触らない**。依頼が担当領域とかぶる場合は、その旨をユーザーに伝えて誘導する | LP・line-reservationの変更、mainへのマージ |

## 全セッション共通ルール
1. **作業開始時**：`git fetch origin main && git log origin/main --oneline -5` で最新を確認し、下の連絡板を見る
2. **PRを作る直前**：もう一度 `git fetch` してmainが進んでいないか確認（2秒差の衝突の教訓）
3. **mainへのマージはユーザー承認後のみ**（全セッション共通・例外なし）
4. 大きめの作業を始めるときは連絡板に1行追記してコミット、終わったらその行を消す

## 📋 連絡板（作業中のセッションが書く）

| 日付 | セッション | 触っているファイル | 状態 |
|---|---|---|---|
| （例）7/6 | 司令塔 | hacos-hmc-lp.html（回数券） | 完了・消してOK |

| 7/17 | 司令塔（Journey募集・集客）→次チャットへ引き継ぎ | NEXT_CHAT_HANDOFF.md「🏢」節参照。最優先=STORES商品URLが届いたらretreat.htmlのSTORESボタン差し替え→公開 | 引き継ぎ済み |
| 7/15 | →デプロイの手 or オーナーへ依頼 | LINE自動応答に「法人」キーワード→ `https://goup55.github.io/HACOS-/corp.html` を返すルール追加（「ガイド」ルールと同じ仕組み） | 依頼中 |
| 7/28 | 司令塔（瞑想イベント） | line-reservation（reserve.html／reservation-routes.js／admin-page.js／migrations/2026-07-28-obosan-session.sql） | main反映済み（PR #59）。Harnessの本番反映（Worker＋migration適用）が必要 |
| 7/28 | 司令塔（PR #60） | hacos-hmc-lp.html・index.html・retreat.html・premium.html・line-reservation | 8月お弁当確定・予約ボタン・Journey第2期差し替え・ハコさんティザー・瞑想スニペット貼り込み。**mainマージ済み** |
| 8/1 | 司令塔→**アパレル新チャットへ引き継ぎ** | `SPEES_APPAREL_HANDOFF.md`・images/spees/（ロゴ・企画ボード5点） | 引き継ぎ済み。新チャットは同ファイルを起点に。担当宣言をここに書くこと |
| 8/15 | 司令塔（商品体系リニューアル）→ **完了・次チャットへ引き継ぎ** | LP各種・`tokushoho.html`・`BUSINESS_RULES.md`・`line-reservation/` | **PR #64〜#72 すべてmainマージ済み**。本番サイト・LINE予約フォームとも新体系で稼働中。QA2周・テスト104項目合格。retreat.htmlのデザインも刷新済み。**残るは実機での動作確認と3名への案内**。詳細は NEXT_CHAT_HANDOFF.md 冒頭 |
| 8/15 | デプロイの手 → **完了** | line-reservation 全体 | **2026-08-15 本番反映済み**（Version ID `13902208-be19-441d-a67e-b3eff992a89c`）。記録: `DEPLOY_20260815_RECORD.md`。⚠️ **LINEアプリ内での動作確認はこれから**（記録ファイルのチェックリストを埋める） |
| 8/15 | 司令塔（実機確認の準備・9月日程） | `line-reservation/src/`・`tests/`・`migrations/2026-09-sessions.sql` | **席の数え方のバグを修正**（「朝RUNのみ」が定員を消費していた箇所が4つ）。サーバー側テスト16項目を新設・全120項目合格。⚠️ **実機確認の前に再デプロイが必要**（手順: `DEPLOY_20260815_RECORD.md` 冒頭）。**9月日程のSQLはそのまま流せる状態**（`migrations/2026-09-sessions.sql`・2026-08-15に共有LINEで受領した内容を反映。お弁当は4日とも注文可（みどり担当の9/13・9/27は2品から選べる形）。**9月は4回とも確定**）。**LPの9月カード4枚も作成済み**（`HMC_SEPTEMBER_CLASS_PLAN.md` に共有文面・告知文）。**PR #74 でmainマージ済み**。→ 🔧 **デプロイの手へ: 8/29の `DEPLOY_20260829.md` に統合済み**（Worker再デプロイ＋9月日程のD1投入をまとめて実行する。SEATFIX単体の実行は不要）。**ジャーニー1期生3名が確定**（みどり／小出さん／大谷さん・9月開始・火19:00セミパ／金19:30グルパー）→ 🔴 **予約フォームに「ジャーニー参加者」区分がなく、9/6の朝活で¥2,000を誤請求する。要対応** |
| 8/29 | 司令塔（LINE予約・体験の日程変更） | `line-reservation/src/`（admin-page・reservation-routes）・`schema.sql`・`migrations/2026-08-29-trial-reschedule.sql`・`tests/` | **体験パーソナル／7日間お試しの「希望日をスタッフが管理画面で変更できる」機能を実装**（`📅 希望日を変更`）。テスト149項目合格。**PR #85 でmainマージ済み。** → 🔧 **デプロイの手へ: `DEPLOY_20260829.md` を実行**（8/15の積み残し＝席の数え方の修正・9月日程のD1投入と、今回のmigration＋Worker再デプロイを1回にまとめた指示書）。🔴 **9月日程の期限は8/30お昼12時** |
| 9/4 | デプロイの手 → **次チャットへ引き継ぎ** | `line-reservation/migrations/2026-09-sessions.sql`（データのみ） | 🔴 **9月の日程がD1未登録なら予約フォームが空**（8/30正午を過ぎたため）。次の開催は9/6（日）。**オーナーのPCが壊れておりスマホのみ**のため、管理画面「🛠 開催日の管理」から手入力する。手順は `HANDOFF_20260904_SEPTEMBER_SCHEDULE.md`。⚠️ 10月ぶんの期限は **9/27正午** |
<!-- ここに作業中の行を追加。完了したら行ごと削除 -->

## 現在の全体像（どこで何が動いているか）
- **本番サイト**：GitHub Pages（mainマージで自動公開）→ `goup55.github.io/HACOS-/`
- **LINE予約**：Cloudflare Worker（LINE Harness）→ mainのコードとは**自動連動しない**。Harnessセッションの手動反映が必要
- 詳細な現状・未反映タスクは `NEXT_CHAT_HANDOFF.md` と `LINE_HARNESS_HANDOFF.md` を参照
