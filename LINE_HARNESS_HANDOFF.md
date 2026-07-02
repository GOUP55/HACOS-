# LINE Harness × HACOS 引き継ぎ資料（2026-07-02 更新版）

前チャットの引き継ぎ（`claude/line-harness-lp-integration-qyhlfe` ブランチ版）を受けて、
本ブランチ（`claude/line-harness-handoff-setup-fvlsao`）でタスク①②③を実施した後の最新状態。

## 🔑 最重要の前提（読み飛ばし厳禁）

- **Claude（このAI）はユーザーのPC・Cloudflare Workerに直接アクセスできない。**
  すべてのコード変更は「①Claudeがこのリポジトリにファイルをpush → ②ユーザーがWindowsのコマンドプロンプトで
  `curl` でダウンロード → ③ `wrangler`/`pnpm` コマンドで反映」という手順を毎回踏む。
- **ユーザーは非エンジニア（中学生でも分かるレベルの説明が必要）。** コマンドは1行ずつ、
  「これをコピー→貼り付け→Enter」の粒度で指示すること。複数行を一度に貼るとコマンドが連結して失敗する
  （実例あり）。
- Windows / コマンドプロンプト / VS Code を使用。ブラウザはLINE Developers操作用。

## 📍 システム構成

| 項目 | 値 |
|---|---|
| LINE Harness OSS | Shudesu/line-harness-oss（TypeScript, pnpm monorepo, Hono） |
| Worker本体 | https://line-harness.hacos.workers.dev |
| 管理画面 | https://line-harness-admin-8b17f520.pages.dev |
| ローカルharnessリポジトリ | `C:\Users\n9-f\.line-harness`（worker本体は `apps\worker`） |
| D1 DB名/ID | `line-harness` / `fd389273-1236-4683-aa43-913e845c640c` |
| Cloudflare account_id | `565760fb9989f1a1a1ee55ad2ae9ffbb` |
| KV namespace | `STATIC_KV` / `b86324891c924346b20e6639035bc13f`（`liff/reserve.html` を配信） |
| LIFF ID（正） | `2010528512-LJhoz7MP`（HACOS予約フォーム） |
| LINE Loginチャンネル | ハコスラインログイン / Channel ID `2010528512` |
| デプロイコマンド（正） | `apps\worker` で `pnpm run deploy`（**`npx wrangler deploy` 単体はビルドを飛ばすのでNG**） |

### GitHub（このLPリポジトリ）
- リポジトリ: `GOUP55/HACOS-`
- 本番: https://hmclife.netlify.app （Netlify、`main`ブランチ自動デプロイ）
- 予約API・LIFFの正式版コード置き場: **`line-reservation/` フォルダ（本ブランチで整理済み）**

## ✅ タスク①②③の実施状況（本ブランチ、2026-07-02）

### ① 修正の正式化 → 完了
- `debug-reservation-routes.js` の中身を `line-reservation/src/reservation-routes.js` に反映
  （`/api/liff/sessions`・`/api/liff/reservations` の公開パス版）
- `debug-reserve.html` の中身を `line-reservation/liff/reserve.html` に反映
- `line-reservation/README.md` を全面改訂（誤った `/api/sessions` パス・新規D1作成・
  `[assets]`・`export default` 丸ごと追加・`npx wrangler deploy` を訂正）
- 旧ブランチ `claude/line-harness-lp-integration-qyhlfe`（debug-*ファイル入り）と
  `claude/hacos-lp-improvements-kd5q2t`（古い401版）は、本ブランチのマージ後に削除してよい
- **Workerへの再反映は不要**（修正版は既にデプロイ・動作確認済み。今回はリポジトリ整理のみ）

### ② 予約フォームへの動線 → LP側完了・リッチメニューは手動作業待ち
- LP（`hacos-hmc-lp.html`）の予約セクション（#reservation）に
  「LINEで予約する」ボタンを追加。リンク先: `https://liff.line.me/2010528512-LJhoz7MP?ref=lp`
  （`reserve.html` は `?ref=` を sessionStorage に保存するので流入計測可能）
- Googleフォームは「LINEを使っていない方向け」として併存（置き換えは未実施・ユーザー判断待ち）
- リッチメニューへの予約ボタン設置は LINE Official Account Manager での手動作業（コード不可）。
  手順はチャットで案内済み／必要なら再案内

### ③ 通知の重複整理 → 方針決定・反映済み
- **LINE予約フォーム（LIFF）経由の通知に一本化**（予約者本人＋STAFF_USER_IDSへPush、動作確認済み）
- `line-notification.gs`（Googleフォーム用GAS通知）はファイル冒頭に
  「予備扱い・セットアップ不要・設定すると通知が二重になる」旨の警告を追記。設定はしない

## 🗂️ 残タスク・要フォロー事項

- [ ] 本ブランチを main にマージするか（PR作成）→ **ユーザーに確認**。マージするとLPの
      「LINEで予約する」ボタンが本番（Netlify）に出る
- [ ] リッチメニューに予約ボタン設置（LINE Official Account Manager、手動）
- [ ] `STAFF_USER_IDS` に GO 本人以外のスタッフIDを追加
      （友だち登録済みスタッフがメッセージを送る → friends テーブルから line_user_id を取得
      → `wrangler secret put STAFF_USER_IDS` でカンマ区切り再登録）
- [ ] 重複LIFFアプリ `2010528512-KCh8WkEP` の削除（LINE Developers、手動）
- [ ] LIFFの「友だち追加オプション」の最終状態確認（推奨: On/Aggressive）
- [ ] リッチメニュー500エラーの再検証（再デプロイで直っている可能性あり、未テスト）
- [ ] 満席時の「満席」表示・予約不可の動作確認（未検証）
- [ ] 旧ブランチ2本（qyhlfe / kd5q2t）の削除（本ブランチのマージ後）
