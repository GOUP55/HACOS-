---
description: 料金・締切・定員・日付が BUSINESS_RULES.md と一致しているか全ファイルを突合する
argument-hint: [重点的に見たい項目があれば（省略可）]
---

数値・事実の整合チェックです。hacos-ops サブエージェントに以下を実行させてください。

追加の指定: $ARGUMENTS

手順:
1. BUSINESS_RULES.md を読み、正本となる料金・締切・定員・回数券などの決定事項を一覧にする
2. HTML（index.html / hacos-hmc-lp.html / premium.html / guide.html / tokushoho.html）と主要な *.md、line-reservation/ 内から金額・日付・定員の記載を全て抽出する
3. 正本と食い違う箇所を「ファイル名:行番号 / 記載内容 / 正しい値」の表で報告する
4. このコマンドでは修正はしない。食い違いゼロならその旨を1行で報告する

注意: ドキュメント同士が食い違う場合は BUSINESS_RULES.md が勝つ。BUSINESS_RULES.md に無い項目は「正本未定義」として別枠で報告する。
