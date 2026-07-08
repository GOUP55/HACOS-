---
description: プロジェクトの現在地（公開済み/作業中/未公開の差分）を非エンジニア向けに報告する
allowed-tools: Bash(git:*), Read, Grep, Glob
---

プロジェクトの現在地を報告してください。記憶ではなく、必ず git とファイルの実体を確認してから書くこと。

確認すること:
1. `git branch --show-current` と `git status` で今いるブランチと未コミットの変更
2. `git log --oneline -10` で直近の作業内容
3. `git fetch origin main` の後、`git log origin/main..HEAD --oneline` で「mainに未反映（＝未公開）の作業」を確認
4. SESSION_ROLES.md の連絡板に未処理の申し送りがないか
5. NEXT_CHAT_HANDOFF.md / HANDOFF.md に残タスクがないか

報告フォーマット（専門用語を使わず、この3見出しで）:
- **公開済み**: 今インターネットに出ているものの状態
- **作業中・未公開**: 出来ているがまだ公開していないもの
- **次にやること**: 私の判断・承認が必要なものを先頭に
