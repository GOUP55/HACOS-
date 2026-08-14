---
description: 予約・売上・LINE登録などの数字を集計してレポートにする（実数のみ・推測なし）
argument-hint: [知りたい数字・期間（例: 今月の朝活の参加人数と売上）]
---

`hacos-analyst` エージェントを使って、数字のレポートを作ってください。

知りたいこと: $ARGUMENTS

渡す指示:
- データ元は `ops/OPS_INPUT.md` とこの依頼のなかで渡された実数**だけ**
- `REVENUE_SIMULATION.md` `PROFIT_10M_ROADMAP.md` などの数字は**仮定**。実績として使わない
- 料金は `BUSINESS_RULES.md` を正本にして金額を計算する
- 未取得の数字は「未取得」と書き、取り方（管理画面のどこを見るか）を添える
- `ops/reports/YYYY-MM-DD-numbers.md` に保存する

チャットには、サマリ3行＋実績表＋未取得リストだけを返す。
