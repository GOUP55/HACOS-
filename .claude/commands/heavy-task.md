---
description: 大きめのタスクをチーム品質ループ（制作→build→QA→修正）で完遂する
argument-hint: [やってほしいことを自由に書く]
---

以下の依頼を、TEAM_WORKFLOW.md の品質ループで完遂してください。

依頼内容: $ARGUMENTS

進め方:
1. まず TEAM_WORKFLOW.md と BUSINESS_RULES.md を読み、hacos-director の視点で要件・成功条件・対象ファイルを整理して私に1〜3行で提示する
2. 制作を担当エージェントに割り振る（文章= hacos-copywriter / 実装= hacos-frontend / 画像= hacos-designer / 集客= hacos-growth / 定型= hacos-ops）
3. メインLPを変更した場合は `python3 build_index.py` を実行する
4. hacos-qa にレビューさせ、重大度「高」「中」がゼロになるまで修正→再レビューを繰り返す
5. 完了したら「何をどう変えたか」「QAの最終結果」「残タスク」を非エンジニア向けの言葉で報告する

厳守:
- `index.html` は直接編集しない（`hacos-hmc-lp.html` を編集してビルド）
- 料金・締切・定員は BUSINESS_RULES.md が正本。記憶で書かない
- main への push・外部送信はしない（私の承認が必要な操作は止めて確認する）
