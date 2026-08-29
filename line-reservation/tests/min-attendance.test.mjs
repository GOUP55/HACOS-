// 最少催行（朝活クラス4名未満で中止）のサーバー側テスト。実SQLite＝D1と同じエンジン。
//
// なぜ要るか: 中止の判定・連絡・受付停止はすべて cron の sendReminders() の中で起きる。
// 予約フォームのテストでは一切通らない経路なので、ここで実際に関数を動かして確かめる。
// LINEへの送信は fetch を差し替えて捕まえる（本番のLINE APIは叩かない）。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, p), 'utf8');

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const src = read('../src/reservation-routes.js');

// ── 0. ソース側の不変条件 ───────────────────────────────────────────
check('最少催行が4名（3名以下で中止）', /const MIN_ATTENDANCE = 4;/.test(src));
check('中止の判定に「朝RUNのみ」を数えない除外がある',
  /category !== '朝RUNのみ'/.test(src));
check('中止した日はリマインドを送らない（continue がある）',
  /cancelSessionForLowAttendance[\s\S]{0,200}continue/.test(src));

// ── D1互換のうすいアダプタ（node:sqlite を D1 の顔にする）──────────
function d1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let params = [];
      const api = {
        bind(...args) { params = args; return api; },
        all() { return { results: stmt.all(...params) }; },
        first() { return stmt.get(...params) ?? null; },
        run() { const r = stmt.run(...params); return { meta: { changes: r.changes } }; },
      };
      return api;
    },
  };
}

// sendReminders は「明日」を UTC 日付で見る。同じ計算で日付を作る
const t = new Date();
t.setDate(t.getDate() + 1);
const TOMORROW = t.toISOString().split('T')[0];

// src/ をそのまま import すると hono が見つからない。
// nodeは「読み込むファイルの位置」から node_modules を探すため、src/ の隣には無いから。
// tests/node_modules の下（.gitignore 済み）に src をコピーしてから読み込む。
// コピーなので中身は本物のままで、テスト対象がズレることはない。
const stage = path.join(__dirname, 'node_modules', '.hacos-src');
mkdirSync(stage, { recursive: true });
for (const f of readdirSync(path.join(__dirname, '..', 'src'))) {
  copyFileSync(path.join(__dirname, '..', 'src', f), path.join(stage, f));
}
const { sendReminders } = await import(pathToFileURL(path.join(stage, 'reservation-routes.js')).href);

// 1シナリオ＝DB作り直し。sendReminders を1回流して、送られたメッセージを集める
async function run({ classMembers, runOnly = 0, special = false, capacity = 10 }) {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../schema.sql'));
  const sessionId = special ? `${TOMORROW}-obosan` : TOMORROW;
  db.prepare(`
    INSERT INTO sessions
      (id, date, display_date, title, food, trainers, morning_run, capacity, is_open, bento_json, has_tacos, note)
    VALUES (?,?,?,?,NULL,NULL,1,?,1,NULL,0,NULL)
  `).run(sessionId, TOMORROW, '9/6（日）', special ? 'お坊さんといっしょ' : 'テスト回', capacity);

  let seq = 0;
  const add = (category) => {
    seq++;
    db.prepare(`
      INSERT INTO reservations
        (id, session_id, line_user_id, display_name, category,
         morning_run, bento, tacos, trainer, message, ref, status, created_at)
      VALUES (?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,'confirmed',?)
    `).run(`r${seq}`, sessionId, `U${seq}`, `テスト${seq}`, category, new Date().toISOString());
  };
  for (let i = 0; i < classMembers; i++) add(special ? '瞑想' : '都度');
  for (let i = 0; i < runOnly; i++) add('朝RUNのみ');

  // LINE送信を捕まえる
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opt) => {
    const body = JSON.parse(opt.body);
    sent.push({ to: body.to, text: body.messages[0].text });
    return { ok: true, json: async () => ({}) };
  };
  try {
    await sendReminders({ DB: d1(db), STAFF_USER_IDS: 'STAFF1', CHANNEL_ACCESS_TOKEN: 'x' });
  } finally {
    globalThis.fetch = realFetch;
  }

  // 月末案内（🗓）はこのテストの対象外なので除く
  const msgs = sent.filter(m => !m.text.startsWith('🗓'));
  return {
    cancelMsgs: msgs.filter(m => m.text.includes('お休みとさせていただきます')),
    // 中止の文面にも「お待ちしています」が入るので、リマインドは冒頭で見分ける
    remindMsgs: msgs.filter(m => m.text.startsWith('🌅 明日')),
    staffMsgs: msgs.filter(m => m.to === 'STAFF1'),
    isOpen: db.prepare(`SELECT is_open FROM sessions WHERE id = ?`).get(sessionId).is_open,
    confirmed: db.prepare(
      `SELECT COUNT(*) AS n FROM reservations WHERE session_id = ? AND status = 'confirmed'`
    ).get(sessionId).n,
  };
}

// ── 1. 境界: 3名で中止・4名で開催 ──────────────────────────────────
{
  const r = await run({ classMembers: 3 });
  check('クラス3名 → 中止の連絡が3名に届く', r.cancelMsgs.length === 3, `${r.cancelMsgs.length}通`);
  check('クラス3名 → リマインドは送らない', r.remindMsgs.length === 0, `${r.remindMsgs.length}通`);
  check('クラス3名 → その日の受付が閉じる（is_open=0）', r.isOpen === 0);
  check('クラス3名 → 予約が全てキャンセルになる', r.confirmed === 0, `残${r.confirmed}件`);
}
{
  const r = await run({ classMembers: 4 });
  check('クラス4名 → 開催。リマインドが4名に届く', r.remindMsgs.length === 4, `${r.remindMsgs.length}通`);
  check('クラス4名 → 中止の連絡は送らない', r.cancelMsgs.length === 0);
  check('クラス4名 → 受付は開いたまま（is_open=1）', r.isOpen === 1);
  check('クラス4名 → 予約はconfirmedのまま', r.confirmed === 4, `${r.confirmed}件`);
}

// ── 2. 「朝RUNのみ」は人数に数えないが、中止には巻き込まれる ────────
{
  const r = await run({ classMembers: 3, runOnly: 2 });
  check('クラス3名＋朝RUNのみ2名 → 合計5名でも中止（朝RUNは数えない）',
    r.cancelMsgs.length === 5, `${r.cancelMsgs.length}通`);
  check('朝RUNのみの方にも中止の連絡が届く', r.cancelMsgs.length === 5);
  check('中止の文面に朝RUNもお休みと書かれている',
    r.cancelMsgs.every(m => m.text.includes('朝RUN（6:30〜）も、あわせてお休みです。')));
  check('クラス3名＋朝RUNのみ2名 → 予約5件すべてキャンセル', r.confirmed === 0);
}
{
  const r = await run({ classMembers: 4, runOnly: 3 });
  check('クラス4名＋朝RUNのみ3名 → 開催。7名全員にリマインド',
    r.remindMsgs.length === 7, `${r.remindMsgs.length}通`);
}

// ── 3. 特別枠（瞑想・TACOS等）は最少催行の対象外 ───────────────────
{
  const r = await run({ classMembers: 1, special: true });
  check('特別枠は1名でも中止しない', r.cancelMsgs.length === 0);
  check('特別枠にはリマインドが届く', r.remindMsgs.length === 1);
  check('特別枠の受付は閉じない', r.isOpen === 1);
}

// ── 4. 予約0件の日 ────────────────────────────────────────────────
{
  const r = await run({ classMembers: 0 });
  check('予約0件の日も受付を閉じる（前夜の駆け込み予約を防ぐ）', r.isOpen === 0);
  check('予約0件なら参加者への連絡は送らない', r.cancelMsgs.length === 0);
}

// ── 5. スタッフ通知 ───────────────────────────────────────────────
{
  const r = await run({ classMembers: 2, runOnly: 1 });
  const staff = r.staffMsgs.find(m => m.text.includes('中止'));
  check('スタッフに中止の通知が届く', !!staff);
  check('スタッフ通知にクラス人数が出る', !!staff && staff.text.includes('クラス 2名'), staff?.text);
  check('スタッフ通知に朝RUNのみの人数が出る', !!staff && staff.text.includes('朝RUNのみ 1名'));
}

const ok = results.filter(Boolean).length;
console.log(`\n合計: ${results.length}項目中 ${ok}件 合格`);
if (ok !== results.length) process.exit(1);
