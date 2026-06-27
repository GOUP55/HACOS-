# 次チャット 引き継ぎ（2026-06-27 時点・簡潔版）

## 🌐 現状（ライブ）
- **公開先：GitHub Pages（無料）** … `https://goup55.github.io/HACOS-/`
  - プレミアムLP：`https://goup55.github.io/HACOS-/premium.html`
  - `main` を更新すると **自動で再公開**（pages build & deployment）
- **Netlify(`hmclife.netlify.app`) はクレジット切れで停止＝使わない**（削除推奨／放置可）
- リポジトリは **public**。開発は `main` 直結（PR→squash/merge で反映）

## ✅ 完了済み
- 構造改善TOP3（OGP/順序/画像base64脱却）・お食事メニュー(7/12,7/19)・弁当¥1,300〜1,500
- **プレミアムLP**（第1期生・¥300,000・募集7/15・定員3名・特典=掲載協力で卒業生継続優待20%OFF/3ヶ月）
- メインLPに**実績ギャラリー**（顔出しの一部はぼかし済み：result-w-front.jpg）
- **LINE連携**：浮く友だち追加ボタン＋公式LINEセクション＋QR、予約フォーム→LINE通知GAS
  - LINEボタンの遷移先＝`https://line-harness.hacos.workers.dev/auth/line?ref=lp`（別途稼働中）
- 役割分担チーム`.claude/agents/`(6体)＋品質ループ`TEAM_WORKFLOW.md`
- ローンチ資料：`PREMIUM_LAUNCH_LINE.md`(LINE/IG文面・全リンク新URL済) / `PREMIUM_LAUNCH_PLAN.md`(集客×計測)

## ⚙️ 作業ルール（厳守）
- `index.html` は直接編集しない → `hacos-hmc-lp.html` を編集 → `python3 build_index.py` で生成
- 画像はパス参照のまま（base64化しない）。最適化＝長辺1200/JPEG q82前後、`loading="lazy"`
- 事実・数値・実績は捏造しない（実績は提供素材のみ＋「効果には個人差/掲載許可」注記）
- 計測タグ(GA4/Meta Pixel)は両LPの`<head>`にコメントで設置済み＝**IDが来たら有効化**
- 公開(main反映)前にQA（`hacos-qa`）。表示確認は Playwright(Chromium `/opt/pw-browsers/chromium`,
  `require('/opt/node22/lib/node_modules/playwright')`)。スクラッチ画像はコミット前に削除
- ※この環境はネットワーク制限で本番URLに直接アクセス不可。配信確認はユーザー or Pages workflow状態で

## 📌 次やること（おすすめ順）
1. **Instagramプロフィールのリンク**を `https://goup55.github.io/HACOS-/` に差し替え（ユーザー作業）
2. **第1期生ローンチ配信**：`PREMIUM_LAUNCH_LINE.md`（募集開始6/27→締切7/15）
3. **GA4/Meta Pixel 有効化**（測定IDをもらったら、両LPの<head>テンプレを解除しID差込→build→公開）
4. 任意：他の顔出し実績画像のぼかし(result-w-front2/result-vispiral/result-m-37kg)、特商法/返金規定ページ、Netlify削除

## 🔑 定数
- LINE公式: `https://lin.ee/TsRy6I9` ／ 体験予約フォーム: `https://forms.gle/dpJWZtafUfZWXnvC7`
- Instagram: `https://www.instagram.com/hmc.day/` ／ 物販: `https://hacos.base.shop`
- LINE Harness: `https://line-harness.hacos.workers.dev`
