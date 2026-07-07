-- HACOS × HMC 習慣トラッキング D1 スキーマ
-- 既存の line-harness DB に追加する（予約システムと同じDB）:
--   wrangler d1 execute line-harness --file=line-habit/schema.sql --remote

-- 1日1行。同じ日を保存し直すと上書き（UPSERT）される
CREATE TABLE IF NOT EXISTS habit_logs (
  id            TEXT PRIMARY KEY,
  line_user_id  TEXT NOT NULL,
  display_name  TEXT,
  log_date      TEXT NOT NULL,              -- 記録対象日 (JST, YYYY-MM-DD)
  moved         INTEGER NOT NULL DEFAULT 0, -- 運動した=1
  ate_well      INTEGER NOT NULL DEFAULT 0, -- 食べ方に気をつけた=1
  note          TEXT,                       -- ひとことメモ（スタッフにも共有される旨をUIに明記）
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(line_user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_habit_user_date ON habit_logs(line_user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_habit_date ON habit_logs(log_date);
