-- ============================================================
-- 月次セッション登録テンプレート
-- 使い方：
--   1. このファイルをコピーして「2026-08-sessions.sql」のような名前にする
--      （またはClaudeに「8月の日程はこれ」と日付・内容を伝えれば作成します）
--   2. 下の例を月の開催日ぶんコピーして書き換える
--   3. PCで実行：
--      cd C:\Users\n9-f\.line-harness\apps\worker
--      npx wrangler d1 execute line-harness --file=<このファイル> --remote
--
-- 各項目の意味（VALUESの並び順どおり）:
--   id           … 'YYYY-MM-DD'（同日2枠目は '2026-08-16-tacos' のように接尾辞を付ける）
--   date         … 'YYYY-MM-DD'（並び順・月判定に使う。idと同じ日付でよい）
--   display_date … '8/2（日）' のような表示用
--   title        … クラス名
--   food         … 食事名（無ければ NULL）
--   trainers     … 担当（例 'GO, みどり（KITCHEN）'。無ければ NULL）
--   morning_run  … 朝RUNあり=1 / なし=0
--   capacity     … 定員（通常10。お休み回は0）
--   is_open      … 予約受付する=1 / お休み=0
--   bento_json   … お弁当の選択肢。例 '[{"name":"カオマンガイ","price":1300}]'
--                  （価格未定は "price":null。無ければ NULL）
--   has_tacos    … TACOS選択肢を出す=1 / 出さない=0
--   note         … カードに出る補足文（例 '朝RUN 6:30〜あり'。無ければ NULL）
--
-- INSERT OR IGNORE なので、同じidを2回実行しても重複しません（安全）。
-- 登録済みの回の内容を変えたいときは UPDATE が必要です（Claudeに相談）。
-- ============================================================

INSERT OR IGNORE INTO sessions VALUES
  ('2026-08-02','2026-08-02','8/2（日）','クラス名をここに',
   '食事名をここに','担当者をここに',1,10,1,
   '[{"name":"食事名をここに","price":1300}]',
   0,'朝RUN 6:30〜あり'),
  ('2026-08-09','2026-08-09','8/9（日）','クラス名をここに',
   '食事名をここに','担当者をここに',0,10,1,
   '[{"name":"食事名をここに","price":1300}]',
   0,'朝RUNなし');

-- 確認用（実行後に本番の8月分を一覧表示したいときは、下の行を単独で実行）:
-- npx wrangler d1 execute line-harness --command "SELECT id, display_date, title, capacity, is_open FROM sessions WHERE date LIKE '2026-08%' ORDER BY date" --remote
