// 開催日の登録・編集・削除（第3弾）のSQL挙動テスト（実SQLite＝D1と同エンジン）
// reservation-routes.js が使うSQLパターンの安全性を検証する。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, p), 'utf8');

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const db = new DatabaseSync(':memory:');
db.exec(read('../schema.sql'));

// ── 1. 新規登録: INSERT OR IGNORE で同時登録でも二重作成されない ──
const ins = (id) => db.prepare(`
  INSERT OR IGNORE INTO sessions
    (id, date, display_date, title, food, trainers, morning_run, capacity, is_open, bento_json, has_tacos, note)
  VALUES (?, ?, ?, ?, NULL, NULL, 0, 10, 1, NULL, 0, NULL)
`).run(id, id, '8/2（日）', 'ピラティス');
check('新規登録が成立する', ins('2026-08-02').changes === 1);
check('同じ日付の二重登録は変化0行（409になる）', ins('2026-08-02').changes === 0);

// ── 2. 更新: 存在しないIDは変化0行（404になる） ──
const upd = db.prepare(`UPDATE sessions SET title = ?, is_open = ? WHERE id = ?`);
check('既存日程の更新が成立する', upd.run('ヨガ', 0, '2026-08-02').changes === 1);
check('存在しないIDの更新は変化0行', upd.run('x', 1, '2026-08-99').changes === 0);
check('締切（is_open=0）が予約フォームのクエリから除外される',
  db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE is_open = 1 AND id = '2026-08-02'`).get().n === 0);

// ── 3. 削除: 予約（キャンセル済み含む）が1件でもあれば拒否 ──
db.prepare(`INSERT INTO reservations (id, session_id, line_user_id, category, status, created_at)
            VALUES ('r1','2026-08-02','u1','会員','cancelled','x')`).run();
const delGuarded = db.prepare(`
  DELETE FROM sessions
  WHERE id = ? AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.session_id = sessions.id)
`);
check('キャンセル済みでも予約履歴があれば削除は変化0行（409になる）',
  delGuarded.run('2026-08-02').changes === 0);
check('日程自体は残っている',
  db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE id = '2026-08-02'`).get().n === 1);
db.prepare(`DELETE FROM reservations WHERE id = 'r1'`).run();
check('予約履歴が無くなれば削除できる', delGuarded.run('2026-08-02').changes === 1);

// ── 4. 体験リクエストの希望日変更（スタッフが管理画面で書き換える） ──
db.prepare(`INSERT INTO trial_requests (id, line_user_id, display_name, trainer, preferred_date, preferred_time, alt_note, status, created_at)
            VALUES ('t1','u1','明日香','お任せ','2026-08-25','午前（9:00〜12:00）','8月27日午前中','pending','x')`).run();
db.prepare(`INSERT INTO trial_requests (id, line_user_id, display_name, trainer, preferred_date, preferred_time, status, created_at)
            VALUES ('t2','u2','確定済み','GO','2026-08-20','夜（18:00〜21:00）','confirmed','x')`).run();
const resched = db.prepare(`
  UPDATE trial_requests SET preferred_date = ?, preferred_time = ?, updated_at = ?, updated_by = ?
  WHERE id = ? AND status = 'pending'
`);
check('確定待ちの希望日を書き換えられる',
  resched.run('2026-09-03', '午後（15:00〜18:00）', '2026-08-29T12:00:00Z', 'env-owner', 't1').changes === 1);
const t1 = db.prepare(`SELECT * FROM trial_requests WHERE id='t1'`).get();
check('希望日と時間帯が新しい値になる',
  t1.preferred_date === '2026-09-03' && t1.preferred_time === '午後（15:00〜18:00）');
check('第2希望・ご要望（お客様の記録）は残る', t1.alt_note === '8月27日午前中');
check('いつ・誰が変更したかが残る',
  t1.updated_at === '2026-08-29T12:00:00Z' && t1.updated_by === 'env-owner');
check('確定済みのリクエストは書き換えられない（変化0行＝409になる）',
  resched.run('2026-09-03', '午前（9:00〜12:00）', 'x', 'env-owner', 't2').changes === 0);
check('存在しないIDの変更は変化0行（404になる）',
  resched.run('2026-09-03', '午前（9:00〜12:00）', 'x', 'env-owner', 'no-such-id').changes === 0);

// migrationファイルが「列がまだ無いDB」に適用できる
const oldTrials = new DatabaseSync(':memory:');
oldTrials.exec(`CREATE TABLE trial_requests (
  id TEXT PRIMARY KEY, line_user_id TEXT NOT NULL, display_name TEXT, trainer TEXT,
  preferred_date TEXT, preferred_time TEXT, alt_note TEXT, ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL)`);
oldTrials.exec(read('../migrations/2026-08-29-trial-reschedule.sql'));
const cols = oldTrials.prepare(`PRAGMA table_info(trial_requests)`).all().map(r => r.name);
check('reschedule migrationで updated_at / updated_by が追加される',
  cols.includes('updated_at') && cols.includes('updated_by'));
check('migration適用前のDBでも「日付と時間帯だけ」のUPDATEは通る（コード側フォールバック）', (() => {
  const bare2 = new DatabaseSync(':memory:');
  bare2.exec(`CREATE TABLE trial_requests (id TEXT PRIMARY KEY, preferred_date TEXT, preferred_time TEXT, status TEXT)`);
  bare2.prepare(`INSERT INTO trial_requests VALUES ('t','2026-08-25','午前','pending')`).run();
  return bare2.prepare(`UPDATE trial_requests SET preferred_date = ?, preferred_time = ? WHERE id = ? AND status = 'pending'`)
    .run('2026-09-03', '午後', 't').changes === 1;
})());

// ── 5. 操作ログ ──
db.prepare(`INSERT INTO admin_ops_log (id, staff_id, action, target_id, detail, created_at)
            VALUES ('l1','env-owner','session_create','2026-08-02','{}','x')`).run();
check('admin_ops_log に staff_id 付きで記録できる',
  db.prepare(`SELECT staff_id FROM admin_ops_log WHERE id='l1'`).get().staff_id === 'env-owner');

// migrationファイルがテーブル未作成のDBに適用できる
const bare = new DatabaseSync(':memory:');
bare.exec(read('../migrations/mig-2026-07-17-admin-ops-log.sql'));
const tables = bare.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
check('admin-ops-log migrationでテーブルが作成される', tables.includes('admin_ops_log'));
check('migrationは再実行しても壊れない（IF NOT EXISTS）', (() => {
  try { bare.exec(read('../migrations/mig-2026-07-17-admin-ops-log.sql')); return true; } catch { return false; }
})());

const fail = results.filter(r => !r).length;
console.log(`\n合計: ${results.length}項目中 ${results.length - fail}件 合格`);
process.exit(fail ? 1 : 0);
