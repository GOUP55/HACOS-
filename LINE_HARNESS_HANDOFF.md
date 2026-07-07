# LINE Harness × HACOS 引き継ぎ資料（2026-07-06 更新版）

2026-07-02版（タスク①②③完了）を基点に、7/4〜7/6の変更（回数券・バグ修正・体験リクエスト型）を反映した最新状態。

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
- 本番LP: **GitHub Pages** https://goup55.github.io/HACOS-/（Netlifyはクレジット切れで停止・使わない）
- 予約API・LIFFの正式版コード置き場: **`line-reservation/` フォルダ**（liff / src / schema.sql / migrations）

## ✅ 2026-07-02時点で完了（詳細は git 履歴参照）
- ① debug版の修正を `line-reservation/` に正式反映＋README全面改訂（Worker反映済み・動作確認済み）
- ② LP予約セクションに「LINEで予約する」ボタン（`https://liff.line.me/2010528512-LJhoz7MP?ref=lp`）。
  Googleフォームは「LINEを使っていない方向け」として併存
- ③ 通知はLIFF経由に一本化。`line-notification.gs`（Googleフォーム用GAS）は予備扱い（設定すると二重通知）

## 🆕 2026-07-04〜06 の変更（このリポジトリのmainには反映済み）

| 変更 | 内容 | 関連 |
|---|---|---|
| 回数券対応 | reserve.htmlに「回数券（月まとめ買い）¥2,000／回」区分＋今月一括選択ボタン。routes側は3行（sessions返却に`date`追加・通知に【回数券】表示）。Playwrightテスト3項目合格(7/5) | PR#16 / `DEPLOY_KAISUKEN.md` |
| バグ3件修正 | JST日付ずれ・キャッシュで古いフォーム表示・TACOS説明未表示 | PR#17 |
| 体験リクエスト型 | 体験パーソナルを日時リクエスト型に独立（`trial_requests`テーブル新設）。トレーナー選択・TACOS Party別枠セッション化 | PR#18 / migrations |

### 本番反映に必要なもの（⚠️ 反映済みかは未確認 → ユーザーに確認すること）
1. **Workerコード＋KV**: `DEPLOY_KAISUKEN.md` の貼り付け用プロンプトの手順
   （KVへ reserve.html を put → routes置換 → `pnpm run deploy`。LINEアプリ内LIFFで動作確認）
2. **D1 migrations（各1回だけ実行）**: `line-reservation/migrations/`
   - `2026-07-04-trainer-and-tacos-session.sql`（trainer列追加・TACOS別枠セッション）
   - `2026-07-06-trial-requests.sql`（体験リクエストのテーブル新設）
   - `2026-07-06-tacos-note-and-fixes.sql`（TACOS案内文の更新のみ）
3. 切り戻し: KVに旧reserve.htmlを戻し、旧routesで `pnpm run deploy`

## 🗂️ 残タスク・要フォロー事項

- [ ] **上記「本番反映」の実施状況をユーザーに確認**（未反映なら最優先）
- [ ] リッチメニューに予約ボタン設置（LINE Official Account Manager、手動）
- [ ] `STAFF_USER_IDS` に GO 本人以外のスタッフIDを追加
      （友だち登録済みスタッフがメッセージを送る → friends テーブルから line_user_id を取得
      → `wrangler secret put STAFF_USER_IDS` でカンマ区切り再登録）
- [ ] 重複LIFFアプリ `2010528512-KCh8WkEP` の削除（LINE Developers、手動）
- [ ] LIFFの「友だち追加オプション」の最終状態確認（推奨: On/Aggressive）
- [ ] リッチメニュー500エラーの再検証（再デプロイで直っている可能性あり、未テスト）
- [ ] 満席時の「満席」表示・予約不可の動作確認（未検証）
- [x] 旧ブランチ整理・mainマージ（PR#16〜18で反映済み）
