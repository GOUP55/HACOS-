// キャンセル/再予約のcancelled_atフォールバックの統合テスト（実SQLite使用）
// reservation-routes.js は「migration未適用のDBでは 'no such column' エラーを検知して
// 列なしのSQLに切り替える」設計。この前提（エラーメッセージの文字列・フォールバックSQLの
// 成立）を、実際のSQLiteエンジン（D1と同じ）で検証する。
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

// ── 1. ルート実装が期待どおりのフォールバック条件を持っているか ──
const routesSrc = read('../src/reservation-routes.js');
const fallbackCount = (routesSrc.match(/no such column/g) || []).length;
check('ルート実装に no such column フォールバックが2箇所ある（キャンセル・再予約）',
  fallbackCount >= 2, `検出: ${fallbackCount}箇所`);

// ── 2. migration未適用DB（cancelled_at列なし）での挙動 ──
const old = new DatabaseSync(':memory:');
old.exec(`CREATE TABLE reservations (
  id TEXT PRIMARY KEY, session_id TEXT, line_user_id TEXT, display_name TEXT,
  category TEXT, trainer TEXT, morning_run TEXT, bento TEXT, tacos TEXT,
  message TEXT, ref TEXT, status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL,
  UNIQUE(session_id, line_user_id));`);
old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, capacity INTEGER DEFAULT 10);`);
old.exec(`INSERT INTO sessions VALUES ('2026-07-19', 10);`);
old.exec(`INSERT INTO reservations (id, session_id, line_user_id, category, status, created_at)
          VALUES ('r1','2026-07-19','u1','会員','confirmed','x');`);

// 2-1. cancelled_at付きUPDATEは失敗し、エラー文言がフォールバック条件に一致する
let oldErr = '';
try {
  old.exec(`UPDATE reservations SET status='cancelled', cancelled_at='z' WHERE id='r1'`);
} catch (e) { oldErr = e.message; }
check('未適用DB: cancelled_at付きUPDATEが失敗し、エラーに no such column を含む',
  oldErr.includes('no such column'), oldErr);

// 2-2. フォールバックSQL（列なし）でキャンセル自体は成立する
old.exec(`UPDATE reservations SET status='cancelled' WHERE id='r1'`);
check('未適用DB: フォールバックSQLでキャンセルが成立する',
  old.prepare(`SELECT status FROM reservations WHERE id='r1'`).get().status === 'cancelled');

// 2-3. 再予約側もフォールバック（列なし版）が成立する
old.exec(`UPDATE reservations SET status='confirmed', display_name='u', category='会員',
  morning_run=NULL, bento=NULL, trainer=NULL, message=NULL, ref=NULL, created_at='y'
  WHERE id='r1' AND status='cancelled'
  AND (SELECT COUNT(*) FROM reservations r2 WHERE r2.session_id='2026-07-19' AND r2.status='confirmed') <
      (SELECT capacity + 3 FROM sessions WHERE id='2026-07-19')`);
check('未適用DB: 再予約のフォールバックSQLが成立する',
  old.prepare(`SELECT status FROM reservations WHERE id='r1'`).get().status === 'confirmed');

// ── 3. migration適用後の挙動（schema.sql＋mig-2026-07-15） ──
const nu = new DatabaseSync(':memory:');
nu.exec(read('../schema.sql'));
nu.exec(`INSERT INTO reservations (id, session_id, line_user_id, category, status, created_at)
         VALUES ('r1','2026-07-19','u1','会員','confirmed','x');`);
nu.exec(`UPDATE reservations SET status='cancelled', cancelled_at='2026-07-15T12:00:00Z' WHERE id='r1'`);
const afterCancel = nu.prepare(`SELECT status, cancelled_at FROM reservations WHERE id='r1'`).get();
check('適用済みDB: キャンセルで cancelled_at が記録される',
  afterCancel.status === 'cancelled' && afterCancel.cancelled_at === '2026-07-15T12:00:00Z');

nu.exec(`UPDATE reservations SET status='confirmed', cancelled_at=NULL, display_name='u', category='会員',
  morning_run=NULL, bento=NULL, trainer=NULL, message=NULL, ref=NULL, created_at='y'
  WHERE id='r1' AND status='cancelled'`);
const afterReact = nu.prepare(`SELECT status, cancelled_at FROM reservations WHERE id='r1'`).get();
check('適用済みDB: 再予約で cancelled_at がクリアされる',
  afterReact.status === 'confirmed' && afterReact.cancelled_at === null);

// 3-1. migrationファイル自体が旧スキーマに適用できる
const mig = new DatabaseSync(':memory:');
mig.exec(`CREATE TABLE reservations (id TEXT PRIMARY KEY, status TEXT, created_at TEXT);`);
mig.exec(read('../migrations/mig-2026-07-15-cancelled-at.sql'));
const cols = mig.prepare(`SELECT name FROM pragma_table_info('reservations')`).all().map(r => r.name);
check('migrationファイルの適用で cancelled_at 列が追加される', cols.includes('cancelled_at'));

const fail = results.filter(r => !r).length;
console.log(`\n合計: ${results.length}項目中 ${results.length - fail}件 合格`);
process.exit(fail ? 1 : 0);
