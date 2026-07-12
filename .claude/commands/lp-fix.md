---
description: LPの修正・レイアウト調整・セクション追加を hacos-frontend に実装させる
argument-hint: [直したい箇所・追加したい内容]
---

LPの実装作業です。hacos-frontend サブエージェントに以下を実装させてください。

依頼内容: $ARGUMENTS

前提としてエージェントに伝えること:
- メインLPの編集対象は `hacos-hmc-lp.html`。`index.html` は直接編集禁止（変更後に `python3 build_index.py` を実行）
- モバイルファースト（基準幅390px）で崩れないこと
- 配色は既存のブランド変数（--cream / --forest / --amber / --rust / --dark）を使う
- 画像は長辺1200px・JPEG q82。base64化しない

実装後の流れ:
1. ビルドを実行して index.html を更新
2. 変更点を「どこを・どう変えたか」の形で報告
3. 大きめの変更なら hacos-qa のレビューを提案する
