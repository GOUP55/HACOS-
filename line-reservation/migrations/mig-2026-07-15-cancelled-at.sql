-- 2026-07-15: キャンセル日時の記録列を追加（管理画面のキャンセル可視化・第1弾）
-- 本番D1に1回だけ実行する。既存列の変更・削除はなし（追加のみ）。
-- 既存のcancelled行は cancelled_at が NULL のまま → 管理画面では「日時不明」と表示される。
-- ※Workerデプロイの前にこのマイグレーションを適用すること
--   （コード側はmigration未適用でもキャンセル処理が落ちないフォールバック付きだが、
--     その間のキャンセル日時は記録されない）

ALTER TABLE reservations ADD COLUMN cancelled_at TEXT;
