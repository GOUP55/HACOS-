-- 2026-07-16: 体験リクエストの確定/不成立の操作ログ列を追加（改善第2弾）
-- 本番D1に1回だけ実行する。既存列の変更・削除はなし（追加のみ）。
-- decided_by にはauthMiddlewareが渡すスタッフID（共有キー運用中は 'env-owner'）が入る。
-- スタッフ個別キー発行後は自然に個人が特定できるログになる。
-- ※Workerデプロイ前に適用すること（コード側は未適用でも落ちないフォールバック付きだが、
--   その間の操作ログは記録されない）

ALTER TABLE trial_requests ADD COLUMN decided_at TEXT;
ALTER TABLE trial_requests ADD COLUMN decided_by TEXT;
