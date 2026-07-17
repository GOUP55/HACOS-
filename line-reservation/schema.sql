-- HACOS × HMC 予約システム D1 スキーマ
-- Cloudflare D1 (SQLite) / wrangler d1 execute <DB_NAME> --file=schema.sql

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  display_date  TEXT NOT NULL,
  title         TEXT NOT NULL,
  food          TEXT,
  trainers      TEXT,
  morning_run   INTEGER DEFAULT 0,
  capacity      INTEGER NOT NULL DEFAULT 10,
  is_open       INTEGER NOT NULL DEFAULT 1,
  bento_json    TEXT,
  has_tacos     INTEGER DEFAULT 0,
  note          TEXT,
  time_label    TEXT              -- 開催時間の表示（NULLなら既定の AM7:30〜10:00）
);

CREATE TABLE IF NOT EXISTS reservations (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  line_user_id  TEXT NOT NULL,
  display_name  TEXT,
  category      TEXT NOT NULL,
  trainer       TEXT,
  morning_run   TEXT,
  bento         TEXT,
  tacos         TEXT,
  message       TEXT,
  ref           TEXT,
  status        TEXT NOT NULL DEFAULT 'confirmed',
  created_at    TEXT NOT NULL,
  cancelled_at  TEXT,              -- キャンセル日時（confirmed中はNULL。再予約で再びNULLに戻る）
  UNIQUE(session_id, line_user_id)
);

CREATE INDEX IF NOT EXISTS idx_res_session ON reservations(session_id, status);

-- 体験パーソナルの日時リクエスト（日曜クラスと別枠。担当の空き確認後に日時確定する運用）
CREATE TABLE IF NOT EXISTS trial_requests (
  id             TEXT PRIMARY KEY,
  line_user_id   TEXT NOT NULL,
  display_name   TEXT,
  trainer        TEXT,
  preferred_date TEXT,   -- 第1希望日 (YYYY-MM-DD)
  preferred_time TEXT,   -- 希望時間帯（午前/昼/午後/夜）
  alt_note       TEXT,   -- 第2希望・ご要望（自由記述）
  ref            TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending / confirmed(確定) / declined(不成立) / cancelled(顧客自身の取消)
  created_at     TEXT NOT NULL,
  decided_at     TEXT,   -- スタッフが確定/不成立にした日時
  decided_by     TEXT    -- 操作したスタッフID（共有キー運用中は 'env-owner'）
);

CREATE INDEX IF NOT EXISTS idx_trial_user ON trial_requests(line_user_id, status);

-- 7月シードデータ
INSERT OR IGNORE INTO sessions VALUES
  ('2026-07-05','2026-07-05','7/5（日）','セルフマッサージ＆ストレッチ',
   'サラダビビンそば & 発酵彩りキンパ','GO, みどり（KITCHEN）',1,10,1,
   '[{"name":"サラダビビンそば","price":null},{"name":"発酵彩りキンパ","price":900}]',
   0,'朝RUN 6:30〜あり',NULL),
  ('2026-07-12','2026-07-12','7/12（日）','LEAN BODY TRAINING〜燃やして締める60分〜',
   'カオマンガイ','片山めぐみ, ふみや（KITCHEN）',0,10,1,
   '[{"name":"カオマンガイ","price":1300}]',
   0,'朝RUNなし',NULL),
  ('2026-07-19','2026-07-19','7/19（日）','ピラティス',
   'ビーフストロガノフ','ちひろ, ふみや（KITCHEN）',1,10,1,
   '[{"name":"ビーフストロガノフ","price":1300}]',
   0,'朝RUN 6:30〜あり',NULL),
  ('2026-07-19-tacos','2026-07-19','7/19（日）午後','TACOS Party（午後の部）',
   NULL,NULL,0,10,1,NULL,
   0,'12:00〜21:00 ／ 参加費 ¥3,000（タコス食べ放題） ／ ドリンク・その他フードは別料金 ／ サウナ × コーヒー（ピラティスとは別枠・単独参加OK）','12:00〜21:00'),
  ('2026-07-26','2026-07-26','7/26（日）','お休み',
   NULL,NULL,0,0,0,NULL,0,'スタッフ不在のためクローズ',NULL);
