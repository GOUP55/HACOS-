CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  friend_id TEXT,
  staff_id TEXT,
  menu_id TEXT,
  menu_name TEXT,
  staff_name TEXT,
  customer_name TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  customer_note TEXT,
  price_at_booking INTEGER,
  raw_payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_starts_at ON bookings(starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_received_at ON bookings(received_at);

CREATE TABLE IF NOT EXISTS menus_cache (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  duration_minutes INTEGER,
  buffer_after_minutes INTEGER,
  base_price INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  raw_data TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
