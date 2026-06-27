# HACOS × HMC LP — 作業引き継ぎ（ハンドオフ）

## 🌐 プロジェクト概要
- **サイト**: https://goup55.github.io/HACOS-
- **GitHub**: goup55/hacos- → `main` ブランチ → Netlify自動デプロイ
- **作業ディレクトリ**: /home/user/HACOS-/
- **業態**: 観音寺の日曜朝活コミュニティ「HACOS × HMC（Healthy Morning Club）」。毎週日曜AM7:30開催。動く×食べる×つながる。集客主軸はLINE・Instagram。

## 📁 ファイル構成
| ファイル | 役割 |
|---------|------|
| `hacos-hmc-lp.html` | **編集する元ファイル**（約49KB、画像はパス参照 `images/xxx.jpg`） |
| `index.html` | **デプロイ版**（build_index.pyで生成。画像がbase64埋め込みで約12MB） |
| `build_index.py` | hacos-hmc-lp.html → index.html 変換。画像をbase64化、動画(mp4等)はパス参照のまま残す |
| `images/` | 画像・動画素材（約21MB） |
| `slack-notification.gs` | 【設定済】GASスクリプト：フォーム回答→Slack #予約通知 へ自動通知 |
| `schedule-sync.gs` | 【設定済】GASスクリプト：スプレッドシート「スケジュール」シート編集→フォーム選択肢自動更新＋LP HTML生成 |

### ビルド & デプロイ手順
```bash
python3 build_index.py   # index.html を再生成
git add -A && git commit -m "..." && git push -u origin main   # Netlify自動デプロイ
```

## ✅ 完了済みの作業
1. 写真・画像の差し替え（ヒーローロゴ、各柱、トレーナー写真、食事写真）
2. トレーナーカード「みどり」追加、つながる柱に動画（hacos-connect.mp4）
3. Googleフォーム埋め込み（予約セクション）
4. **Slack連携**：フォーム回答が #予約通知 に自動投稿（GAS + Webhook、動作確認済）
5. **スケジュール自動連携**：schedule-sync.gs でシート編集→フォーム選択肢更新（設定済）
6. **LINE動線**：パーソナル相談・お弁当注文ボタンを追加、全LINE URLを `https://lin.ee/TsRy6I9` に統一
7. **TACOS Party画像**＋**7/5メニュー詳細**（サラダビビンそば&発酵彩りキンパ、写真・栄養情報・LINE注文リンク付き）

---

## 🎯 残タスク：構造改善 TOP3（このチャットで実装する）

> 推奨実装順：**② → ① → ③**（②が最も手軽で即効、③が速度激変）

### ① セクション順序の再設計（申込率に直結）
**問題**: 予約フォームが上から6番目にあり、料金・トレーナー・食事・FAQを見る前に「申し込んで」と出てくる。信頼構築と不安解消の前にCTAが来ている。

**現状の順序**:
```
Hero → 3本柱 → スケジュール → 【予約フォーム】 → セミパーソナル
→ パーソナル → トレーナー → 食事 → 料金 → プレミアム → 流れ → FAQ → 最終CTA
```
**改善後の順序**:
```
Hero → 3本柱 → トレーナー → 食事 → スケジュール → 料金 → 流れ → FAQ
→ 【予約フォーム】 → 最終CTA
```
- フォームは「納得した後」の位置へ移動
- CTA交通整理：「運動の体験＝フォーム / 食事・相談＝LINE」と役割明確化（現状フォーム7箇所・LINE4箇所がバラバラ）
- プレミアム¥300,000コースはFAQの後など「本気層だけが辿り着く位置」へ移すと、体験導線で引かれにくい

### ② OGP・メタタグの追加（拡散力 / 現状ゼロ）
**問題**: `<head>` に description も OGPタグも無い。LINE/Instagramでシェアしてもサムネ・タイトルが出ない。

**実装**: `hacos-hmc-lp.html` の `<head>`（`<title>`の後あたり）に追加：
```html
<meta name="description" content="観音寺の日曜朝活コミュニティ。動く×食べる×つながる。毎週日曜AM7:30、HACOSで。初回体験¥3,500。">
<meta property="og:title" content="HACOS × HMC — Healthy Morning Club">
<meta property="og:description" content="観音寺から始まる、もうひとつの朝活。毎週日曜AM7:30。">
<meta property="og:image" content="https://goup55.github.io/HACOS-/images/ogp.jpg">
<meta property="og:url" content="https://goup55.github.io/HACOS-/">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
```
- **要確認**: OGP用画像 `images/ogp.jpg`（推奨1200×630px）を用意する必要あり。無ければ既存のヒーロー画像で代用可。
- 余裕があればローカルSEO用の構造化データ（LocalBusiness schema）も追加 → 「観音寺 朝活」検索に強くなる。

### ③ 画像のbase64脱却（表示速度 / モバイル離脱）
**問題**: `index.html` が約12MB（画像が全部base64埋め込み）。モバイル初速が遅くキャッシュも効かない。12MBの動画autoplayも通信量を圧迫。

**実装**:
- `build_index.py` を「画像もパス参照のまま残す」方式に変更（base64化をやめる）。`images/` をそのままNetlifyにデプロイ。
  - 現状 build_index.py は mp4等のみ skip。これを全画像 skip（＝実質コピーのみ、もしくは index.html を廃止して hacos-hmc-lp.html を直接デプロイ）に。
  - → HTMLが12MB → 約50KBに激減
- 全 `<img>` に `loading="lazy"` を付与
- つながる柱の `<video autoplay>` → サムネイル＋タップ再生に変更検討
- **注意**: Netlifyの公開対象ファイル名を確認（現状 index.html を公開している想定）。方式変更時はデプロイ設定との整合に注意。

---

## ⚠️ 注意・ゴッチャ
- LP本体は `hacos-hmc-lp.html` を編集 → `build_index.py` で `index.html` 生成、の2段構え。**index.htmlを直接編集しない**こと。
- ③を実装するとこの2段構えが変わる可能性あり。その場合デプロイ対象ファイルの整理が必要。
- 画像追加時はサイズに注意（base64の間は特に）。Pillowで圧縮可（web用：長辺1080px・JPEG quality 82前後）。
- LINE公式URL: `https://lin.ee/TsRy6I9` ／ 予約フォーム: `https://forms.gle/dpJWZtafUfZWXnvC7`
- Slack通知チャンネル: #予約通知（ワークスペース hmc-u2x4568）
