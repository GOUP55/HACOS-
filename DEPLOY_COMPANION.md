# コンパニオンβ デプロイ手順書（Harnessセッション／オーナー向け・1行ずつ）

> 対象: `line-companion/` 一式を本番Worker（line-harness.hacos.workers.dev）に反映する。
> 前提: `DEPLOY_KAISUKEN.md` と同じ環境（Windows・コマンドプロンプト・`C:\Users\n9-f\.line-harness`）。
> **⚠️ 実施前の条件2つ**: ① GOが `drafts/companion-persona.md` の赤入れを済ませていること
> ② Anthropic APIキーを用意していること（console.anthropic.com → API Keys。クレジットは$5で十分始められる）

## §1 ファイルを本番リポジトリに置く

コマンドプロンプトで（1行ずつコピー→Enter）:

```
cd C:\Users\n9-f\.line-harness\apps\worker\src
mkdir companion
cd companion
curl -O https://raw.githubusercontent.com/GOUP55/HACOS-/main/line-companion/src/companion-routes.js
curl -O https://raw.githubusercontent.com/GOUP55/HACOS-/main/line-companion/src/companion-prompt.js
```

※ **本番反映は必ずmainマージ後（＝QA・ユーザー承認済みのコード）にのみ行う**（SESSION_ROLES.mdの全セッション共通ルール。ブランチ段階のコードを本番に入れない）。

## §2 D1テーブルを作る（1回だけ）

```
cd C:\Users\n9-f\.line-harness\apps\worker
curl -o companion-tables.sql https://raw.githubusercontent.com/GOUP55/HACOS-/main/line-companion/migrations/2026-07-08-companion-tables.sql
npx wrangler d1 execute line-harness --remote --file=companion-tables.sql
```

「Executed」と出ればOK。

## §3 シークレット（秘密の設定値）を登録する

1行ずつ実行。実行すると入力待ちになるので、値を貼ってEnter:

```
npx wrangler secret put ANTHROPIC_API_KEY
```
→ Anthropicのキー（sk-ant-…）を貼る

```
npx wrangler secret put COMPANION_BETA_IDS
```
→ β対象5名の line_user_id をカンマ区切りで貼る（IDは friends テーブル or スタッフ通知の履歴から取得）

任意（GOが公式サイトで電話番号を確認してから）:
```
npx wrangler secret put CRISIS_HOTLINE_TEXT
```
→ 例: `よりそいホットライン 0120-XXX-XXX（24時間・無料）` ※必ず公式サイトの現物を確認して貼る

## §4 Workerに組み込む（ここだけ既存ファイルを触る）

`apps\worker\src\index.ts` をVS Codeで開き、次の2行を追加:

```ts
import { handleCompanionEvent, sendCompanionDigest, registerCompanionRoutes } from './companion/companion-routes.js';
registerCompanionRoutes(app);   // 他の app.get(...) が並んでいる場所の近くに
```

次に **webhookでメッセージイベントを処理している場所**を探す。VS Codeの検索（Ctrl+Shift+F）で `apps\worker\src` を対象に「`events`」「`message.type`」「`webhook`」のどれかを検索すると見つかる（自動応答ルールを評価している関数の近く）。自信がなければ、そのファイルの中身をClaudeセッションに貼って「どこに入れる？」と聞く。見つけたら、自動応答の判定より**前**に1行:

```ts
if (await handleCompanionEvent(event, env)) continue; // β会員はコンパニオンが応答
```
（ループでなければ `continue` を `return`/`早期スキップ` に合わせる）

任意・日次レポート: 既存の `scheduled` ハンドラ（JST18時の前日リマインドがある場所）に1行:

```ts
await sendCompanionDigest(env);
```

## §5 デプロイと動作確認

```
cd C:\Users\n9-f\.line-harness\apps\worker
pnpm run deploy
```

確認（3段階）:
1. ブラウザで `https://line-harness.hacos.workers.dev/api/liff/companion/health` → `{"ok":true,...}` が出る
2. **β登録した自分のLINE**から「今日のお昼はコンビニ弁当でした」→ 🌿トーンの返事が来る
3. 同じく「テストです。断食しようと思います」→ 固定文の返事＋**スタッフLINEに⚠️緊急通知**が届く
   （テスト後、スタッフLINEに「今のはテスト」と一言残すこと）

β以外のLINEアカウントから送って、**従来どおりの自動応答（「ガイド」等）が壊れていないこと**も確認。

## §6 切り戻し（何かおかしい時）

`index.ts` に足した行（§4の2〜4行）を削除して `pnpm run deploy`。これだけで完全に元に戻る（テーブルとシークレットは残っても無害）。

## 運用メモ

- **β版はテキストのみ対応**（写真は従来の動作のまま）。β会員への案内文に「いまはテキストのメッセージだけ見られます。写真対応は準備中です」と一言入れる
- **週1回、ログの安全レビュー**: 下のコマンドで直近の会話を見て、「危険な相談なのに緊急扱いされていない発言」がないか確認する。見つけたらキーワード（companion-routes.jsのURGENT_RULES）への追加を司令塔セッションに依頼する
- 全ログ確認: `npx wrangler d1 execute line-harness --remote --command="SELECT created_at, line_user_id, role, substr(message,1,50), topic, urgent FROM companion_logs ORDER BY id DESC LIMIT 30"`
- 人格の更新: リポジトリ側で persona → 生成スクリプト → §1のcurlで companion-prompt.js を再取得 → `pnpm run deploy`
- API残高: console.anthropic.com の Usage で確認。β5名なら月数百円規模の見込み（実測して判断）
