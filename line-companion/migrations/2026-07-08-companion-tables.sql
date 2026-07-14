-- HACOSコンパニオン Phase 1（β）用テーブル。既存の line-harness DB に1回だけ実行する。
-- 実行例: wrangler d1 execute line-harness --remote --file=line-companion/migrations/2026-07-08-companion-tables.sql

CREATE TABLE IF NOT EXISTS companion_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id  TEXT NOT NULL,
  role          TEXT NOT NULL,              -- 'user' | 'assistant'
  message       TEXT NOT NULL,
  topic         TEXT,                       -- 食事報告/弱音/質問/復帰/その他/緊急カテゴリ名
  urgent        INTEGER NOT NULL DEFAULT 0, -- 1 = 安全層1（即転送キーワード）該当
  escalated     INTEGER NOT NULL DEFAULT 0, -- 1 = スタッフ通知済み
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_companion_logs_user ON companion_logs(line_user_id, id);
CREATE INDEX IF NOT EXISTS idx_companion_logs_created ON companion_logs(created_at);
