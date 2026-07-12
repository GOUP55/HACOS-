# 次チャット 引き継ぎ（2026-07-07 時点・特商法ページ公開後）

> 原則：**このファイルよりコード・gitログが正**。作業前に `git log --oneline -15` で最新化を確認。
> **⚠️ まず `SESSION_ROLES.md` を読むこと。** セッションごとの担当分け（司令塔／デプロイの手）と連絡板がある。担当外の領域は触らない。

## 🌐 現状（ライブ）
- **公開先：GitHub Pages（無料）** … `https://goup55.github.io/HACOS-/`
  - プレミアムLP：`.../premium.html` ／ 無料ガイド：`.../guide.html`（プレミアムLPの2段CTA用リード獲得ページ）
  - `main` を更新すると **自動で再公開**（pages build & deployment）
- **Netlify(`hmclife.netlify.app`) はクレジット切れで停止＝使わない**（本番HTMLに参照なし・削除推奨／放置可）
- LINE予約：LINE Harness（Cloudflare Worker）で稼働中 → 詳細は `LINE_HARNESS_HANDOFF.md`
- リポジトリは **public**。開発はブランチ→PR→mainマージ（ユーザー承認後）

## ✅ 完了済み
### 〜6月（基盤）
- 構造改善TOP3 完了：**OGP/メタタグ実装済み**・**セクション順序の再設計済み**（予約フォームは納得後の下部へ）・**base64脱却済み**（`build_index.py` はパス参照方式・index.html約70KB）
- LocalBusiness構造化データ、プレミアムLP（第1期生・¥300,000・締切7/31・定員3名・特典=掲載協力で卒業生継続優待20%OFF/3ヶ月）
- 実績ギャラリー（result-w-front.jpg はぼかし済み）、LINE連携（浮くボタン＋QR＋LIFF予約）
- チーム7体（`.claude/agents/`）＋品質ループ（`TEAM_WORKFLOW.md`）

### 7月（直近の変更・PR#15〜18）
- **GA4 有効化済み**：測定ID `G-4CK1EXGHYV` が3ページ（index/premium/guide）の`<head>`で発火中
  ※ **Meta Pixel はまだコメントのまま**（広告開始時にIDを入れて有効化）
- **回数券制度**（PR#16）：LP料金Step2を「会員¥2,000／回数券¥2,000（月まとめ買い・繰越不可）／ビジター¥3,000」に整理。LINE予約フォームにも回数券選択肢＋一括選択＋通知【回数券】対応（Playwrightテスト合格）
- **予約フォームのバグ3件修正**（PR#17）：JST日付・キャッシュ・TACOS説明未表示
- **体験パーソナルをリクエスト型に独立**（PR#18）：`trial_requests` テーブル新設。TACOS Party参加区分・別枠セッション化も対応
- guide.html公開＋プレミアムLPに2段CTA、LINEテンプレの締切を7/31に統一

### 7/6〜7/7（リードマグネット導線の完成と収益設計）
- **メインLPに無料ガイド導線**（声セクション後の帯＋最終CTAサブリンク）を公開済み
- **GA4本実装済み**：3ページ全CTAに位置別イベント（`data-ga-event`/`data-ga-loc`）、カウンセリング系クリックで `generate_lead` 同時送信、guide.htmlに90%読了計測。**オーナー作業残: GA4管理画面で generate_lead を主要イベントに指定**
- **LINE自動応答が開通**（Harness自動返信ルール・「ガイド」でガイドURLが返る。ユーザー実機確認済み）
- **ガイド告知**: LINE一斉配信（予約済み）＋IG告知画像2枚納品済み（feed/story、Meta Business Suiteで予約投稿する運用）
- **収益設計TOP5の実行資料**: `drafts/premium-close-messages.md`（第1期クロージング文面4種）／`CHALLENGE_21DAY_PLAN.md`／`PREMIUM_2ND_LAUNCH_PLAN.md`／`BENTO_SUBSCRIPTION_PLAN.md`／`MEMBERS_PLAN.md`
- **統合決定（7/7）**: 旧「通い放題」構想は「HACOSメンバーズ」に統合（BUSINESS_RULES.md・MEMBERS_PLAN.md反映済み）
- **自動リマインド仕込み済み**: 7/14朝・7/24朝に**司令塔セッション**（このファイルを書いたセッション）へ引き上げ配信①②のリマインドが自動着火する。新チャットで重複対応しないこと
- お客様の声: 1件目取得済み（`drafts/voices-raw.md`・**掲載許可は未確認**）。2〜3件たまったらpremium.htmlの声セクション実装（CSSは実装済み・本文HTML未実装）

### 7/7（特商法ページ＋CRO総点検・PR#23/#25マージ済み）
- **特商法・返金規定ページ公開済み**：`tokushoho.html` 新規（3ページのフッターからリンク）。事業者情報（INNOVATION／代表 合田将幸／観音寺市高屋町743-1。電話番号は非掲載＝請求時開示・2026-07-09オーナー決定）・支払方法（現金/振込/カード、プレミアム分割可、カード手数料の顧客負担記載はナシ）を記載
- **キャンセル規定（オーナー決定・確定）**：体験・朝活とも「当日連絡含めキャンセル料なし、無断キャンセルのみ全額」。プレミアムは開始前全額返金→14日以内全額返金（premium.htmlの「14日間満足保証」と整合）→以降は月割¥100,000/月で精算
- 残る「※準備中」は通い放題プラン価格の1件のみ（HACOSメンバーズ統合との整合を要確認）
- **誤配信リスクを解消**：配信文面`PREMIUM_LAUNCH_LINE.md`に残っていた旧締切7/15を11箇所→7/31に修正。「お席はまだございます」「残りわずか」等の検証不能な在庫表現を事実表記に修正（メインLP含む計4箇所）
- **逆算配信カレンダー**新規：`PREMIUM_LAUNCH_CALENDAR.md`（7/7〜7/31・19配信・実績数値の掲載許可はオーナー確認済み）
- モバイル最下部でLINE固定ボタンが特商法リンクに重なる不具合を修正（フッター表示中はフェードアウト）
- hacos-qa品質ループ2周・高/中ゼロ判定済み

## ⚠️ 最重要（7/8更新: デプロイ状況の整理）
- **反映済み（7/6・オーナー確認済み）**: 回数券・PR#17/18のバグ修正・migrations 3本（記録: `DEPLOY_KAISUKEN.md`）
- **未反映**: PR #19以降の品質修正（reserve.html / reservation-routes.js / migrations 2本）
  → **指示書 `DEPLOY_20260708.md` の貼り付け用プロンプトを「デプロイの手」セッションに渡す**（連絡板に依頼中の行あり）
- **任意・別作業**: 習慣トラッキングLIFF新設（`line-habit/README.md`。LINE Developersでの手作業を含む）

## ⚙️ 作業ルール（厳守）
- `index.html` は直接編集しない → `hacos-hmc-lp.html` を編集 → `python3 build_index.py` で生成
- 画像はパス参照のまま（base64化しない）。最適化＝長辺1200/JPEG q82前後、`loading="lazy"`
- 事実・数値・実績は捏造しない（実績は提供素材のみ＋「効果には個人差/掲載許可」注記）
- 公開(main反映)前にQA（`hacos-qa`）。表示確認は Playwright(Chromium `/opt/pw-browsers/chromium`)
- ※この環境はネットワーク制限で本番URLに直接アクセス不可。配信確認はユーザー or Pages workflow状態で
- Claudeは本番Worker/D1に直接触れない（push→ユーザーがcurl→wrangler反映の3段階）

## 📌 次やること（おすすめ順）
1. **PR #19以降の本番反映**（指示書 `DEPLOY_20260708.md` をデプロイの手セッションへ。回数券分は7/6反映済み）
2. **第1期クロージング実行**：引き上げ配信①7/14・②7/24（文面: `drafts/premium-close-messages.md`。※司令塔セッションに自動リマインド仕込み済み・重複対応しない）。カウンセリング発生時は24hフォロー文面を使用
3. **GA4で generate_lead を主要イベントに指定**（ユーザー作業・5分）＋配信後の数字レビュー（ガイド閲覧→カウンセリングCVR）
4. **お客様の声の掲載許可確認→2〜3件たまったらpremium.htmlの声セクション実装**
5. **8月準備**: 21日チャレンジの価格・決済方法のオーナー決定→販売開始（`CHALLENGE_21DAY_PLAN.md`）／第2期ローンチ始動（`PREMIUM_2ND_LAUNCH_PLAN.md`）
6. **Meta Pixel 有効化**（IDが来たら3ページのコメント解除→build→公開）
7. **tokushoho.html の通い放題プラン価格を確定**（HACOSメンバーズ統合後の正式価格が決まり次第、「※準備中」を置き換え）
8. 任意：Instagramプロフィールリンク差し替え確認、顔出し実績画像のぼかし(result-w-front2/result-vispiral/result-m-37kg)、Netlify削除、重複LIFF削除・STAFF_USER_IDS追加・満席表示検証（→ `LINE_HARNESS_HANDOFF.md` 残タスク）

## 🔑 定数
- LINE公式: `https://lin.ee/TsRy6I9` ／ 体験予約フォーム(Google): `https://forms.gle/dpJWZtafUfZWXnvC7`
- LINE予約(LIFF): `https://liff.line.me/2010528512-LJhoz7MP?ref=lp`
- Instagram: `https://www.instagram.com/hmc.day/` ／ 物販: `https://hacos.base.shop`
- LINE Harness: `https://line-harness.hacos.workers.dev` ／ GA4: `G-4CK1EXGHYV`
