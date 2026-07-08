---
description: LINE予約システム（line-reservation/）の状態と設定を点検する
argument-hint: [気になる点があれば（例: 予約枠の設定を確認して）]
---

LINE予約システムの点検です。**コードの変更・本番反映はしない**（本番反映はデプロイの手＝Harnessセッションの担当。SESSION_ROLES.md 参照）。

確認したいこと: $ARGUMENTS

手順:
1. SESSION_ROLES.md の連絡板と LINE_HARNESS_HANDOFF.md / DEPLOY_KAISUKEN.md を読み、予約システムの現在の運用状態を把握する
2. line-reservation/（liff / src / schema.sql）を読み、実装されている機能・予約枠・料金まわりの設定を確認する
3. 料金・回数券の値が BUSINESS_RULES.md と一致しているか突合する
4. 指定の確認事項があればそれに答える

報告フォーマット:
- **今の予約システムでできること**: 箇条書き
- **設定値**: 予約枠・料金・通知先など主要な値
- **気になる点**: 正本との食い違い・未実装・申し送り事項（なければ「なし」）

修正が必要なものが見つかっても、このセッションでは直さず「どのセッションに何を依頼すべきか」を提示する。
