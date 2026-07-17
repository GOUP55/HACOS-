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
check('ルート実装に no such column フォールバックが3箇所ある（キャンセル・再予約・体験判定）',
  fallbackCount >= 3, `検出: ${fallbackCount}箇所`);

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

// ── 4. 体験リクエストの確定/不成立（第2弾） ──
// 4-1. decided_at/decided_by列のないDBでは 'no such column' → フォールバックで判定は成立
const trialOld = new DatabaseSync(':memory:');
trialOld.exec(`CREATE TABLE trial_requests (
  id TEXT PRIMARY KEY, line_user_id TEXT, display_name TEXT, trainer TEXT,
  preferred_date TEXT, preferred_time TEXT, alt_note TEXT, ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);`);
trialOld.exec(`INSERT INTO trial_requests (id, status, created_at) VALUES ('t1','pending','x');`);
let trialErr = '';
try {
  trialOld.exec(`UPDATE trial_requests SET status='confirmed', decided_at='z', decided_by='env-owner'
                 WHERE id='t1' AND status='pending'`);
} catch (e) { trialErr = e.message; }
check('未適用DB: decided_at付きUPDATEが失敗し、エラーに no such column を含む',
  trialErr.includes('no such column'), trialErr);
trialOld.exec(`UPDATE trial_requests SET status='confirmed' WHERE id='t1' AND status='pending'`);
check('未適用DB: フォールバックSQLで体験の確定が成立する',
  trialOld.prepare(`SELECT status FROM trial_requests WHERE id='t1'`).get().status === 'confirmed');

// 4-2. pendingガード: 処理済みIDへの再操作は変化0行（＝API側で409になる）
const guard = trialOld.prepare(`UPDATE trial_requests SET status='declined' WHERE id='t1' AND status='pending'`).run();
check('pendingガード: 処理済みIDへの再UPDATEは変化0行', guard.changes === 0);
check('pendingガード: 先の判定（confirmed）が上書きされない',
  trialOld.prepare(`SELECT status FROM trial_requests WHERE id='t1'`).get().status === 'confirmed');

// 4-2b. 顧客の取消も同じガード: スタッフ確定後に着弾した取消は0行（確定を上書きしない）
const custCancel = trialOld.prepare(`UPDATE trial_requests SET status='cancelled' WHERE id='t1' AND status='pending'`).run();
check('顧客取消ガード: スタッフ確定後の取消は変化0行（確定が上書きされない）',
  custCancel.changes === 0 &&
  trialOld.prepare(`SELECT status FROM trial_requests WHERE id='t1'`).get().status === 'confirmed');

// 4-3. 適用済みDB（schema.sql）では操作ログが記録される
const trialNew = new DatabaseSync(':memory:');
trialNew.exec(read('../schema.sql'));
trialNew.exec(`INSERT INTO trial_requests (id, line_user_id, status, created_at) VALUES ('t1','u1','pending','x');`);
trialNew.exec(`UPDATE trial_requests SET status='declined', decided_at='2026-07-16T09:00:00Z', decided_by='env-owner'
               WHERE id='t1' AND status='pending'`);
const decided = trialNew.prepare(`SELECT status, decided_at, decided_by FROM trial_requests WHERE id='t1'`).get();
check('適用済みDB: 判定と操作ログ（decided_at/decided_by）が記録される',
  decided.status === 'declined' && decided.decided_at === '2026-07-16T09:00:00Z' && decided.decided_by === 'env-owner');

// 4-4. migrationファイルが旧スキーマに適用できる
trialOld.exec(read('../migrations/mig-2026-07-16-trial-decision.sql'));
const trialCols = trialOld.prepare(`SELECT name FROM pragma_table_info('trial_requests')`).all().map(r => r.name);
check('trial-decision migrationで decided_at/decided_by 列が追加される',
  trialCols.includes('decided_at') && trialCols.includes('decided_by'));

// 3-1. migrationファイル自体が旧スキーマに適用できる
const mig = new DatabaseSync(':memory:');
mig.exec(`CREATE TABLE reservations (id TEXT PRIMARY KEY, status TEXT, created_at TEXT);`);
mig.exec(read('../migrations/mig-2026-07-15-cancelled-at.sql'));
const cols = mig.prepare(`SELECT name FROM pragma_table_info('reservations')`).all().map(r => r.name);
check('migrationファイルの適用で cancelled_at 列が追加される', cols.includes('cancelled_at'));

const fail = results.filter(r => !r).length;
console.log(`\n合計: ${results.length}項目中 ${results.length - fail}件 合格`);
process.exit(fail ? 1 : 0);
