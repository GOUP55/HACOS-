-- 2026-08: 8月の日曜HMC日程（クラス名・メニューはオーナー＋トレーナー確定版・2026-07-25受領）
-- 本番D1に1回実行する。INSERT OR IGNORE＋UPDATEのため、
-- 未適用のDBでも・旧版（7/20版のWORKOUT等）適用済みのDBでも、
-- このファイルを1回流せば確定内容になる（再実行しても壊れない）。
-- 朝RUNは毎週あり（担当: GO）。
-- わっぱ弁当の日（8/2・16・30）は内容未定のためbento_jsonはNULL。
-- 決まり次第、管理画面の「🛠 開催日の管理」の編集から追加できる（SQLは不要）。
-- 夜のクラス（水木のウェルネスジャーニー等）は相談ベース運用のため
-- この予約システムには登録しない。
-- 値の並び: id, date, display_date, title, food, trainers, morning_run,
--           capacity, is_open, bento_json, has_tacos, note, time_label

INSERT OR IGNORE INTO sessions VALUES
  ('2026-08-02','2026-08-02','8/2（日）','はじめてのワークアウト＆巻き肩改善',
   'わっぱ弁当（内容は決まり次第お知らせ）','GO, みどり（KITCHEN）',1,10,1,NULL,0,'朝RUN 6:30〜あり',NULL),
  ('2026-08-09','2026-08-09','8/9（日）','柔軟性を高める股関節ピラティス',
   '鶏もも肉のトマトビネガー煮込み（ジャスミンライス付き）','ちひろ, ふみや（KITCHEN）',1,10,1,
   '[{"name":"鶏もも肉のトマトビネガー煮込み（ジャスミンライス付き）","price":null}]',0,'朝RUN 6:30〜あり',NULL),
  ('2026-08-16','2026-08-16','8/16（日）','ヒップアップ',
   'わっぱ弁当（内容は決まり次第お知らせ）','片山めぐみ, みどり（KITCHEN）',1,10,1,NULL,0,'朝RUN 6:30〜あり',NULL),
  ('2026-08-23','2026-08-23','8/23（日）','はじめてのマシンワークアウト＆腰痛改善',
   'カルニタスライス（豚肩ロース）','GO, ふみや（KITCHEN）',1,10,1,
   '[{"name":"カルニタスライス（豚肩ロース）","price":null}]',0,'朝RUN 6:30〜あり',NULL),
  ('2026-08-30','2026-08-30','8/30（日）','はじめてのマシンワークアウト＆全身リセット',
   'わっぱ弁当（内容は決まり次第お知らせ）','GO, みどり（KITCHEN）',1,10,1,NULL,0,'朝RUN 6:30〜あり',NULL);

-- 旧版（2026-07-20作成のSQL）を適用済みのDBではINSERT OR IGNOREが効かないため、
-- 確定内容へUPDATEで揃える（未適用のDBでは上のINSERTで最初から確定版が入り、無害）。
UPDATE sessions SET
  title = 'はじめてのワークアウト＆巻き肩改善',
  food = 'わっぱ弁当（内容は決まり次第お知らせ）',
  trainers = 'GO, みどり（KITCHEN）'
WHERE id = '2026-08-02';

UPDATE sessions SET
  title = '柔軟性を高める股関節ピラティス',
  food = '鶏もも肉のトマトビネガー煮込み（ジャスミンライス付き）',
  trainers = 'ちひろ, ふみや（KITCHEN）',
  bento_json = '[{"name":"鶏もも肉のトマトビネガー煮込み（ジャスミンライス付き）","price":null}]'
WHERE id = '2026-08-09';

UPDATE sessions SET
  title = 'ヒップアップ',
  food = 'わっぱ弁当（内容は決まり次第お知らせ）',
  trainers = '片山めぐみ, みどり（KITCHEN）'
WHERE id = '2026-08-16';

UPDATE sessions SET
  title = 'はじめてのマシンワークアウト＆腰痛改善',
  food = 'カルニタスライス（豚肩ロース）',
  trainers = 'GO, ふみや（KITCHEN）',
  bento_json = '[{"name":"カルニタスライス（豚肩ロース）","price":null}]'
WHERE id = '2026-08-23';

UPDATE sessions SET
  title = 'はじめてのマシンワークアウト＆全身リセット',
  food = 'わっぱ弁当（内容は決まり次第お知らせ）',
  trainers = 'GO, みどり（KITCHEN）'
WHERE id = '2026-08-30';
