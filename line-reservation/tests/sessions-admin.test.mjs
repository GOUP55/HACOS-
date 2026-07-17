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

// ── 4. 操作ログ ──
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
