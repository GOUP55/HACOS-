-- 2026-07-06: セッションごとの開催時間ラベルを追加
-- 背景: 確認メッセージ・前日リマインド・完了画面が「AM7:30〜10:00」固定のため、
-- 午後開催のTACOS Party予約者にも朝の時間が案内されてしまう。
-- time_label が NULL の場合はコード側で従来どおり「AM7:30〜10:00」を使う。
-- 本番D1に1回だけ実行する。

ALTER TABLE sessions ADD COLUMN time_label TEXT;

UPDATE sessions SET time_label = '12:00〜21:00' WHERE id = '2026-07-19-tacos';
