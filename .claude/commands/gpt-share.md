---
description: ChatGPTへ渡す共有パック（gpt-share/）を今の状態に更新する
argument-hint: [更新したい範囲（省略時は全体）]
---

ChatGPTに前提を引き継ぐための共有パック `gpt-share/` を、いまのリポジトリの状態に合わせて更新します。

追加の指定: $ARGUMENTS

手順:
1. `gpt-share/README.md` を読み、パックの構成と役割を把握する
2. `BUSINESS_RULES.md` を読み、`gpt-share/2_BUSINESS_BRIEF.md` の価格表・商品・体制と突き合わせる。
   食い違いがあれば BUSINESS_RULES.md 側に合わせて直す
3. `NEXT_CHAT_HANDOFF.md`・`SESSION_ROLES.md` の連絡板・`git log --oneline -15` を読み、
   `gpt-share/3_CURRENT_STATE.md` を**今日の日付で書き直す**（現在地・期限・未反映・未決定）
4. `CLAUDE.md` の「厳守」と `BUSINESS_RULES.md` の「表現の厳守」に変更があれば
   `gpt-share/4_BRAND_VOICE.md` に反映する
5. 最後に検算する: `gpt-share/` に出てくる金額をすべて抽出し、
   BUSINESS_RULES.md に存在しない金額がないか確認する。1件でもあれば報告する

注意:
- `gpt-share/` は**正本ではない**。数字が食い違ったら常に BUSINESS_RULES.md が勝つ
- お客様の実名・APIキー・管理画面URLは書かない（外部AIに渡す前提のファイルのため）
- 更新後、ユーザーに「ChatGPT側のファイルも差し替えが必要」と一行伝える
