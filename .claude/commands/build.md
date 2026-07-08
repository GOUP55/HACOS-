---
description: メインLPをビルドして index.html を更新し、整合を確認する
allowed-tools: Bash(python3 build_index.py), Bash(git diff:*), Bash(git status), Read, Grep
---

メインLPのビルドを実行してください。

手順:
1. `python3 build_index.py` を実行する
2. `git status` と `git diff --stat` で index.html の変化を確認する
3. hacos-hmc-lp.html と index.html の内容が一致しているか（ビルド漏れがないか）を確認する
4. 結果を1〜3行で報告する。エラーが出たらエラー内容をそのまま見せて、原因の推測を1行添える

`index.html` を手で編集することは絶対にしないでください。
