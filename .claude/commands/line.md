---
description: LINE配信メッセージの文面を hacos-copywriter に作らせる
argument-hint: [配信の目的（例: 体験会の告知、リマインド）]
---

LINE配信メッセージの作成依頼です。hacos-copywriter サブエージェントに以下を作らせてください。

目的: $ARGUMENTS

前提としてエージェントに伝えること:
- LINE_MESSAGE_SEQUENCE.md と PREMIUM_LAUNCH_LINE.md を読み、既存の配信トーン・シーケンスとの整合を取る
- 料金・締切・定員は BUSINESS_RULES.md を確認してから書く
- スマホで読みやすい長さ（1通500文字以内目安、改行と絵文字は控えめに既存トーンへ合わせる）
- CTAは1通につき1つ。リンクは LINE `https://lin.ee/TsRy6I9` か予約導線のどちらかに絞る
- 押し売りしない。迷い・リスクを感じる文面ほど短く

出力: 文面案を2パターン、配信タイミングの提案を1行添える。**配信・送信は絶対にしない**。文面を作るだけ。
