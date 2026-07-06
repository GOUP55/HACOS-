# 次チャット 引き継ぎ（2026-07-06 時点）

> 原則：**このファイルよりコード・gitログが正**。作業前に `git log --oneline -15` で最新化を確認。

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

## ⚠️ 最重要の未確認事項
**上記のLINE予約側の変更（回数券・バグ修正・trial_requests）は、このリポジトリのmainには入っているが、
本番Worker/D1への反映は別セッションの手動作業**（手順書：`DEPLOY_KAISUKEN.md`、migrations 3本：`line-reservation/migrations/`）。
**反映済みかどうかはユーザーに確認すること。未反映ならそれが最優先タスク。**

## ⚙️ 作業ルール（厳守）
- `index.html` は直接編集しない → `hacos-hmc-lp.html` を編集 → `python3 build_index.py` で生成
- 画像はパス参照のまま（base64化しない）。最適化＝長辺1200/JPEG q82前後、`loading="lazy"`
- 事実・数値・実績は捏造しない（実績は提供素材のみ＋「効果には個人差/掲載許可」注記）
- 公開(main反映)前にQA（`hacos-qa`）。表示確認は Playwright(Chromium `/opt/pw-browsers/chromium`)
- ※この環境はネットワーク制限で本番URLに直接アクセス不可。配信確認はユーザー or Pages workflow状態で
- Claudeは本番Worker/D1に直接触れない（push→ユーザーがcurl→wrangler反映の3段階）

## 📌 次やること（おすすめ順）
1. **本番Worker/D1への反映状況をユーザーに確認**（`DEPLOY_KAISUKEN.md` の手順＋migrations適用。未反映なら最優先）
2. **第1期生ローンチ配信**：`PREMIUM_LAUNCH_LINE.md`（締切7/31＝残り約3週間）
3. **Instagramプロフィールのリンク**を `https://goup55.github.io/HACOS-/` に差し替え（ユーザー作業・実施済みか要確認）
4. **Meta Pixel 有効化**（IDが来たら3ページのコメント解除→build→公開）
5. 任意：他の顔出し実績画像のぼかし(result-w-front2/result-vispiral/result-m-37kg)、特商法/返金規定ページ、Netlify削除、重複LIFF削除・STAFF_USER_IDS追加・満席表示検証（→ `LINE_HARNESS_HANDOFF.md` 残タスク）

## 🔑 定数
- LINE公式: `https://lin.ee/TsRy6I9` ／ 体験予約フォーム(Google): `https://forms.gle/dpJWZtafUfZWXnvC7`
- LINE予約(LIFF): `https://liff.line.me/2010528512-LJhoz7MP?ref=lp`
- Instagram: `https://www.instagram.com/hmc.day/` ／ 物販: `https://hacos.base.shop`
- LINE Harness: `https://line-harness.hacos.workers.dev` ／ GA4: `G-4CK1EXGHYV`
