// 最少催行（朝活クラス3名未満で中止＝2名以下で中止）のサーバー側テスト。実SQLite＝D1と同じエンジン。
//
// ご連絡は2段階:
//   18:00 sendReminders()  … 3名未満なら「未定・今夜中にご予約を」。まだ中止しない
//   21:00 sendFinalCall()  … もう一度数えて、開催か中止かを確定する
//
// なぜ要るか: 中止の判定・連絡・受付停止はすべて cron の中で起きる。
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
check('最少催行が3名（2名以下で中止）', /const MIN_ATTENDANCE = 3;/.test(src));
check('中止の判定に「朝RUNのみ」を数えない除外がある',
  /category !== '朝RUNのみ'/.test(src));
check('18時は中止を確定させず「未定」を送る',
  /sendPendingNotice\(session, rows, classCount, env\);\s*\n\s*continue;/.test(src));
check('21時の確定連絡（sendFinalCall）がある', /export async function sendFinalCall\(env\)/.test(src));
check('21時も特別枠は最少催行の対象外', /if \(session\.id !== session\.date\) continue;/.test(src));

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
const { sendReminders, sendFinalCall } = await import(pathToFileURL(path.join(stage, 'reservation-routes.js')).href);

// 1シナリオ＝DB作り直し。sendReminders を1回流して、送られたメッセージを集める
async function run({ classMembers, runOnly = 0, special = false, capacity = 10,
                    finalCall = false, lateJoiners = 0, bentoOrders = 0 }) {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../schema.sql'));
  db.exec(read('../migrations/2026-08-16-pending-notice.sql'));
  const sessionId = special ? `${TOMORROW}-obosan` : TOMORROW;
  db.prepare(`
    INSERT INTO sessions
      (id, date, display_date, title, food, trainers, morning_run, capacity, is_open, bento_json, has_tacos, note)
    VALUES (?,?,?,?,NULL,NULL,1,?,1,NULL,0,NULL)
  `).run(sessionId, TOMORROW, '9/6（日）', special ? 'お坊さんといっしょ' : 'テスト回', capacity);

  let seq = 0;
  const add = (category, bento = null) => {
    seq++;
    db.prepare(`
      INSERT INTO reservations
        (id, session_id, line_user_id, display_name, category,
         morning_run, bento, tacos, trainer, message, ref, status, created_at)
      VALUES (?,?,?,?,?,NULL,?,NULL,NULL,NULL,NULL,'confirmed',?)
    `).run(`r${seq}`, sessionId, `U${seq}`, `テスト${seq}`, category, bento, new Date().toISOString());
  };
  for (let i = 0; i < classMembers; i++) add(special ? '瞑想' : '都度', i < bentoOrders ? 'わっぱ弁当' : null);
  for (let i = 0; i < runOnly; i++) add('朝RUNのみ');

  // LINE送信を捕まえる
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opt) => {
    const body = JSON.parse(opt.body);
    sent.push({ to: body.to, text: body.messages[0].text });
    return { ok: true, json: async () => ({}) };
  };
  const env = { DB: d1(db), STAFF_USER_IDS: 'STAFF1', CHANNEL_ACCESS_TOKEN: 'x' };
  try {
    await sendReminders(env);
    if (lateJoiners) for (let i = 0; i < lateJoiners; i++) add('都度');  // 18時以降のご予約
    if (finalCall) await sendFinalCall(env);
  } finally {
    globalThis.fetch = realFetch;
  }

  // 月末案内（🗓）はこのテストの対象外なので除く
  // 月末案内（🗓）とスタッフ宛はこのテストの対象外
  const msgs = sent.filter(m => !m.text.startsWith('🗓') && m.to !== 'STAFF1');
  return {
    // 文面は先頭の記号で見分ける（🌅通常リマインド／⏳未定／✅開催確定／😢中止）。
    // 本文には「お休み」「お待ちしています」が複数の文面に出てくるため、本文では判定しない
    cancelMsgs: msgs.filter(m => m.text.startsWith('😢')),
    pendingMsgs: msgs.filter(m => m.text.startsWith('⏳')),
    confirmMsgs: msgs.filter(m => m.text.startsWith('✅')),
    remindMsgs: msgs.filter(m => m.text.startsWith('🌅')),
    staffMsgs: sent.filter(m => m.to === 'STAFF1'),  // msgs はスタッフ宛を除いてあるので sent から取る
    isOpen: db.prepare(`SELECT is_open FROM sessions WHERE id = ?`).get(sessionId).is_open,
    confirmed: db.prepare(
      `SELECT COUNT(*) AS n FROM reservations WHERE session_id = ? AND status = 'confirmed'`
    ).get(sessionId).n,
  };
}

// ── 1. 18時：4名未満は「未定」。まだ中止しない ──────────────────
{
  const r = await run({ classMembers: 2 });
  check('18時・クラス2名 → 「未定」のご連絡が2名に届く', r.pendingMsgs.length === 2, `${r.pendingMsgs.length}通`);
  check('18時・クラス2名 → まだ中止しない', r.cancelMsgs.length === 0);
  check('18時・クラス2名 → 受付は開いたまま（今夜の予約を受けるため）', r.isOpen === 1);
  check('18時・クラス2名 → 予約はconfirmedのまま', r.confirmed === 2, `${r.confirmed}件`);
  check('18時・クラス2名 → リマインドは送らない', r.remindMsgs.length === 0);
}
{
  const r = await run({ classMembers: 3 });
  check('18時・クラス3名 → 開催。通常のリマインドが3名に届く', r.remindMsgs.length === 3, `${r.remindMsgs.length}通`);
  check('18時・クラス3名 → 「未定」は送らない', r.pendingMsgs.length === 0);
  check('18時・クラス3名 → 受付は開いたまま', r.isOpen === 1);
}

// ── 2. 21時：確定 ─────────────────────────────────────────────
{
  const r = await run({ classMembers: 2, finalCall: true });
  check('21時・2名のまま → 中止の連絡が2名に届く', r.cancelMsgs.length === 2, `${r.cancelMsgs.length}通`);
  check('21時・2名のまま → 受付が閉じる', r.isOpen === 0);
  check('21時・2名のまま → 予約が全てキャンセルになる', r.confirmed === 0, `残${r.confirmed}件`);
}
{
  // 18時に2名 →「未定」→ 夜に1名増えて3名 → 21時に開催確定
  const r = await run({ classMembers: 2, lateJoiners: 1, finalCall: true });
  check('18時以降に3人目が入ると開催できる（受付を閉じていないため）', r.confirmed === 3, `${r.confirmed}件`);
  check('21時・3名に届いた → 開催確定のご連絡が3名に届く', r.confirmMsgs.length === 3, `${r.confirmMsgs.length}通`);
  check('21時・3名に届いた → 中止の連絡は送らない', r.cancelMsgs.length === 0);
  check('21時・3名に届いた → 受付は開いたまま', r.isOpen === 1);
}
{
  // 18時の時点で3名 → 通常リマインド済み。21時に二重で送らない
  const r = await run({ classMembers: 3, finalCall: true });
  check('18時に3名あった日は、21時に二重のご連絡をしない', r.confirmMsgs.length === 0, `${r.confirmMsgs.length}通`);
  check('18時に3名あった日は21時も開催のまま', r.isOpen === 1 && r.confirmed === 3);
}

// ── 3. 「朝RUNのみ」は人数に数えないが、中止には巻き込まれる ────────
{
  const r = await run({ classMembers: 2, runOnly: 3, finalCall: true });
  check('クラス2名＋朝RUNのみ3名 → 合計5名でも中止（朝RUNは数えない）',
    r.cancelMsgs.length === 5, `${r.cancelMsgs.length}通`);
  check('中止の文面に朝RUNもお休みと書かれている',
    r.cancelMsgs.every(m => m.text.includes('朝RUN（6:30〜）も、あわせてお休みです。')));
  check('クラス2名＋朝RUNのみ3名 → 予約5件すべてキャンセル', r.confirmed === 0);
}
{
  const r = await run({ classMembers: 3, runOnly: 4 });
  check('クラス3名＋朝RUNのみ4名 → 開催。7名全員にリマインド',
    r.remindMsgs.length === 7, `${r.remindMsgs.length}通`);
}

// ── 4. 特別枠（瞑想・TACOS等）は最少催行の対象外 ───────────────────
{
  const r = await run({ classMembers: 1, special: true, finalCall: true });
  check('特別枠は1名でも中止しない', r.cancelMsgs.length === 0);
  check('特別枠に「未定」は送らない', r.pendingMsgs.length === 0);
  check('特別枠にはリマインドが届く', r.remindMsgs.length === 1);
  check('特別枠の受付は閉じない', r.isOpen === 1);
}

// ── 5. 予約0件の日 ────────────────────────────────────────────────
{
  const r = await run({ classMembers: 0, finalCall: true });
  check('予約0件の日も21時に受付を閉じる（前夜の駆け込み予約を防ぐ）', r.isOpen === 0);
  check('予約0件なら参加者への連絡は送らない', r.cancelMsgs.length === 0);
}

// ── 5b. お弁当（中止でもHACOSが買い取ってお渡しする）────────────────
{
  // クラス2名（うち1名がお弁当を注文）→ 中止。お弁当は渡す
  const r = await run({ classMembers: 2, bentoOrders: 1, finalCall: true });
  check('お弁当を頼んでいても、3名未満なら中止になる', r.cancelMsgs.length === 2, `${r.cancelMsgs.length}通`);
  const withBento = r.cancelMsgs.filter(m => m.text.includes('HACOSでお受け取りいただけます'));
  check('お弁当を注文した方にだけ、受け取りの案内が入る', withBento.length === 1, `${withBento.length}通`);
  check('注文していない方の文面には受け取りの案内が入らない',
    r.cancelMsgs.filter(m => !m.text.includes('HACOSでお受け取り')).length === 1);
  const staff = r.staffMsgs.find(m => m.text.includes('中止'));
  check('スタッフ通知に買い取るお弁当の数が出る', !!staff && staff.text.includes('🍱 お弁当 1件'), staff?.text);
}

// ── 6. スタッフ通知 ───────────────────────────────────────────────
{
  const r = await run({ classMembers: 1, runOnly: 1, finalCall: true });
  const staff = r.staffMsgs.find(m => m.text.includes('中止'));
  check('スタッフに中止の通知が届く', !!staff);
  check('スタッフ通知にクラス人数が出る', !!staff && staff.text.includes('クラス 1名'));
  check('スタッフ通知に朝RUNのみの人数が出る', !!staff && staff.text.includes('朝RUNのみ 1名'));
  check('18時の時点でもスタッフに「21時に確定」の予告が届く',
    r.staffMsgs.some(m => m.text.includes('21時に確定')));
}

const ok = results.filter(Boolean).length;
console.log(`\n合計: ${results.length}項目中 ${ok}件 合格`);
if (ok !== results.length) process.exit(1);
