-- 2026-07-17: 管理操作ログテーブルを追加（改善第3弾: 開催日の登録・編集）
-- 本番D1に1回だけ実行する。既存テーブルへの変更はなし（新規テーブルのみ）。
-- 開催日の作成・編集・締切/再開・削除を「誰が・いつ・何を」の形で記録する。
-- staff_id は authMiddleware のスタッフID（共有キー運用中は 'env-owner'）。
-- ※コード側はテーブル未作成でも操作自体は成立する（ログだけスキップ）

CREATE TABLE IF NOT EXISTS admin_ops_log (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT,
  action      TEXT NOT NULL,   -- session_create / session_update / session_delete
  target_id   TEXT,            -- 対象のセッションID等
  detail      TEXT,            -- 変更内容のJSON（最大500文字に切り詰め）
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_log_created ON admin_ops_log(created_at);
