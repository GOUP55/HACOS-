-- 2026-08-29: 体験リクエストの「希望日をスタッフが書き換えた」記録を残すための列。
-- 管理画面の「📅 希望日を変更」から更新したときに、いつ・誰がを記録する
-- （decided_at / decided_by と同じ考え方）。
--
-- 本番D1に1回だけ実行する。既存列の変更・削除はなし（追加のみ）。
-- 既存行は NULL のまま＝「お客様が出したままの希望日」として扱う。
-- ※ 未適用でも日程変更の機能自体は動く（コード側にフォールバックあり）。
--   その間は管理画面の「✏️ スタッフが変更」表示だけが出ない。
-- ※ ALTER TABLE ADD COLUMN は再実行できない（2回目は duplicate column name で失敗する）。
--   適用済みかどうかは PRAGMA table_info(trial_requests); で確認する。

ALTER TABLE trial_requests ADD COLUMN updated_at TEXT;
ALTER TABLE trial_requests ADD COLUMN updated_by TEXT;
