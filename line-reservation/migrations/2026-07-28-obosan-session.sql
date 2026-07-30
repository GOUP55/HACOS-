-- 2026-07-28: 「お坊さんといっしょ。初めての瞑想と写経体験」初回（8/29）を特別枠セッションとして登録
-- 既に稼働中の本番D1（line-harness）に対して1回だけ実行する。
-- 特別枠（id ≠ date）のため、回数券の対象外・朝クラス定型文の非使用は既存ロジックが自動で効く。
-- 企画の正本: MEDITATION_PROGRAM_PLAN.md / BUSINESS_RULES.md

INSERT OR IGNORE INTO sessions
  (id, date, display_date, title, food, trainers, morning_run, capacity, is_open, bento_json, has_tacos, note, time_label)
VALUES
  ('2026-08-29-obosan', '2026-08-29', '8/29（土）夕方',
   'お坊さんといっしょ。初めての瞑想と写経体験',
   NULL, NULL, 0, 10, 1, NULL, 0,
   '参加費¥3,000（写経用紙代込み）／ストレッチ30分→瞑想30分→写経60分／講師：宗林寺・岡田隆弘僧正／持ち物不要・楽な服装で／写経は途中で帰ってもOK ※開催前日以降のキャンセルは用紙代¥1,000をいただきます',
   '17:00〜19:00');
