# 本番反映の記録（2026-08-15・商品体系リニューアル）

指示書: `DEPLOY_20260815_PRICING.md` ／ 対象PR: #64・#65・#66

## 結果：デプロイ完了

```
Uploaded line-harness (7.92 sec)
Deployed line-harness triggers (1.27 sec)
  https://line-harness.hacos.workers.dev
Current Version ID: 13902208-be19-441d-a67e-b3eff992a89c
```

バインディングはすべて認識済み（`STATIC_KV` / `DB`=line-harness / `IMAGES` / `ASSETS`）。
cronは `*/5 * * * *`・`0 */6 * * *`・`0 9 * * *` の3本。

⚠️ **これは「デプロイが通った」記録です。LINEアプリ内での動作確認は別途。** 下の「確認の結果」を埋めること。

## 実施した内容

| 手順 | 結果 |
|---|---|
| マイグレーション (1) `2026-07-28-obosan-session.sql` | **すでに適用済み**だった（`2026-08-29-obosan` が存在） |
| マイグレーション (2) `2026-08-sessions.sql` | **すでに適用済み**だった（8月のsessionsが6件） |
| マイグレーション (3) `2026-08-15-trial-kind.sql` | **今回適用**（`Rows written: 1`） |
| KV `liff/reserve.html` | 差し替え済み（41,031バイト） |
| `src/reservation-routes.js` | 差し替え済み |
| `src/admin-page.js` | 差し替え済み |
| `pnpm run deploy` | 成功 |

## 途中で詰まった点（次回のために）

1. **`wrangler` が見つからない**
   PC全体ではなくプロジェクト内にしか無いため、**`npx wrangler`** で呼ぶ必要がある。
   かつ `wrangler.toml` のある **`apps\worker` の中で**実行する。
   → 指示書と `line-reservation/README.md` を修正済み（PR #69）

2. **`[code: 7403] The given account is not valid or is not authorized`**
   権限エラーに見えるが**一時的な失敗**。同じコマンドを打ち直したら通った。
   `npx wrangler whoami` でアカウントID `565760fb...` と `d1 (write)` 権限があることを確認済み。
   → 指示書の「うまくいかないとき」に追記済み（PR #70）

3. **`指定されたファイルが見つかりません。`**
   指示書の `<reservation-routes.jsのパス>` という説明用の目印を、そのまま貼ってしまった。
   非エンジニア向けの手順に置き換え作業を残していたのが原因。
   → `curl -o src\reservation-routes.js ...` のようにそのまま貼れる形へ修正済み（PR #70）

## 確認の結果（LINEアプリ内のLIFFで・埋めること）

- [ ] 「回数券」の区分と「今月の開催日をまとめて選択」ボタンが消えている
- [ ] 参加区分に「朝RUNのみ（6:30〜）参加費¥0」が出る
- [ ] **「朝RUNのみ」で予約しても、その日の残席が減らない**（← 今回いちばん壊れやすい箇所）
- [ ] 「朝RUNのみ」の予約でスタッフLINEに「🏃 新規予約【朝RUNのみ・¥0】」が届く
- [ ] 「お試し・体験を申し込む →」に「お申し込みの種類」が出て、体験パーソナル¥3,500 と 7日間お試し¥9,000 を選べる
- [ ] 7日間お試しを選ぶと見出しが変わり、担当の「必須」が外れる
- [ ] 既存の 体験／相談／TACOS／瞑想 の予約が今までどおり動く
- [ ] 管理画面 `/admin/reservations` のバッジ（🏃 ✅ 👤 🌅 💪 ／ リクエストは 🚩 と 🌱）

## 切り戻し

KVに旧 `reserve.html` を戻し、差し替え前の `src/reservation-routes.js` と `src/admin-page.js` で
`pnpm run deploy`。DBは触らないのでデータは壊れない。
