# 回数券対応の本番デプロイ指示書（LINE Harness側セッション用）

> ✅ **2026-07-06 本番反映完了**（オーナー確認済み）。このファイルは記録として残す。
> 今後フォームを変更するときは、デプロイ前に `line-reservation/tests/` の
> 自動テストを回すこと（実行方法は同フォルダの README.md）。

> **使い方**: この下の「📋 貼り付け用プロンプト」を、LINE Harness（apps/worker）を
> デプロイした別のClaudeセッションにそのまま貼り付ける。

---

## 📋 貼り付け用プロンプト（ここからコピー）

HACOSのLINE予約フォームに「回数券」対応を本番反映してください。
変更済みソースは GitHub `goup55/HACOS-` の main にあります（`line-reservation/` 配下）。

**変更内容（3点）**
1. `liff/reserve.html`: 参加区分に「回数券（月まとめ買い）¥2,000／回」を追加。回数券選択時に「今月の開催日をまとめて選択」ボタンと注意書き（繰り越し不可・月途中は残り回数分）を表示。今月・満席以外のセッションだけを一括選択する
2. `src/reservation-routes.js`: 回数券関連の変更は3点 —
   - `GET /api/liff/sessions` の返却に `date: s.date` を追加（月判定に必要な純追加）
   - スタッフ通知の先頭行を `category==='回数券'` のとき `🎫 新規予約【回数券】` に
     （isExtra=追加枠・trainer=担当の既存分岐は残したまま回数券を優先）
   - キャンセル通知も同様に `❌ 予約キャンセル【🎫回数券】` に
3. ⚠️ mainには回数券の後にマージされた変更も含まれる（PR #17: JST日付・キャッシュ・
   TACOS説明のバグ修正、PR #18: 体験パーソナルのリクエスト型独立・TACOS参加区分）。
   本番が7/4以前の状態なら diff にこれらが含まれるのが正常。その場合はデプロイ前に
   D1マイグレーションを各1回実行すること（適用済みかは trial_requests テーブルの有無で判別）:
   - `wrangler d1 execute line-harness --file=line-reservation/migrations/2026-07-06-tacos-note-and-fixes.sql --remote`
   - `wrangler d1 execute line-harness --file=line-reservation/migrations/2026-07-06-trial-requests.sql --remote`

**手順（2026-07-02と同じルート・READMEの訂正事項を厳守）**
1. mainから最新の `line-reservation/liff/reserve.html` を取得し、KVへ:
   `wrangler kv key put --binding=STATIC_KV "liff/reserve.html" --path=<取得したreserve.html> --remote`
2. mainの `line-reservation/src/reservation-routes.js` の内容で apps/worker 側の同ファイルを置換
   （diffを確認し、上記3行＋reserve.html側の `setupKaisukenHelper();` 呼び出し以外の差分が無いこと）
3. デプロイは **`apps/worker` で `pnpm run deploy`**。
   ⚠️ `npx wrangler deploy` 単体は使わない（ビルドが飛び古いコードが出る事故が実際に発生済み）

**動作確認（必ずLINEアプリ内のLIFFで。ブラウザは管理者Cookieで素通りするため確認にならない）**
- [ ] 参加区分に「回数券（月まとめ買い）」が表示される
- [ ] 回数券を選ぶと「今月の開催日をまとめて選択」ボタンが出る
- [ ] ボタンで今月の開催日のみ選択される（満席・来月分は選ばれない）
- [ ] 回数券で予約→スタッフLINEに「🎫 新規予約【回数券】」で届く
- [ ] 既存の体験/会員/ビジター/相談の予約が今まで通り動く

問題があれば、KVに旧reserve.htmlを戻し、routes置換前のコードで `pnpm run deploy` すれば元に戻ります。

## （ここまでコピー）

---

## このファイルの背景（HACOS-リポジトリ側の記録）

- 実装・テスト完了: 2026-07-05（LIFFスタブ＋モックでPlaywright 3項目合格）
- 再検証: 2026-07-06（main `e0957de` をLIFFスタブ＋モックAPIでPlaywright 10項目合格。
  回数券選択肢・まとめ選択ボタン・今月のみ選択・満席/来月除外・既存区分の切替を確認）
- 対応コミット: `74cc49a`（フォーム・API・通知）、`2dfe634`ほか（LP料金表記）
- LP側の回数券表記（料金カード）は本リポジトリの main マージで公開される（GitHub Pages）
- 本番Workerへの反映は本指示書の手順でのみ行う（このリポジトリからは自動反映されない）
