-- 2026-07-06: 体験パーソナルを「日時リクエスト型」に独立させるための新テーブル
-- 本番D1に1回だけ実行する。既存データには影響しない（新規テーブル追加のみ）。

CREATE TABLE IF NOT EXISTS trial_requests (
  id             TEXT PRIMARY KEY,
  line_user_id   TEXT NOT NULL,
  display_name   TEXT,
  trainer        TEXT,
  preferred_date TEXT,
  preferred_time TEXT,
  alt_note       TEXT,
  ref            TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trial_user ON trial_requests(line_user_id, status);
