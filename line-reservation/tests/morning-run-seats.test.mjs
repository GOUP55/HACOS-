// 「朝RUNのみ」が朝活クラスの席を消費しないことのサーバー側テスト（実SQLite＝D1と同エンジン）。
//
// なぜ要るか: morning-run.test.mjs は予約フォーム（reserve.html）の見た目と送信内容しか見ていない。
// 席の増減はサーバーのSQLで決まるため、フォームのテストが全部通っても
// 「朝RUNのみで予約したら残席が減る」は素通りする（2026-08-15に実際に4箇所素通りした）。
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

// reservation-routes.js の EXTRA_SLOTS と同じ値。ズレたら下の検査で落ちる
const EXTRA_SLOTS = 3;

const src = read('../src/reservation-routes.js');

// ── 0. ソース側の不変条件 ───────────────────────────────────────────
// 定員を数えるSQLには必ず「朝RUNのみ」の除外が要る。
// 将来この除外を落としても気づけるよう、SQL本文の近くに書かれているかを検査する。
{
  const lines = src.split('\n');
  const offenders = [];
  lines.forEach((line, i) => {
    const countsCapacity = /capacity \+ \$\{EXTRA_SLOTS\}|AS booked/.test(line);
    if (!countsCapacity) return;
    // 同じSQL文の中に除外句があるか（前後7行を1文とみなす）
    const window = lines.slice(Math.max(0, i - 7), i + 8).join('\n');
    if (!window.includes('朝RUNのみ')) offenders.push(`${i + 1}行目: ${line.trim()}`);
  });
  check('定員を数えるSQLすべてに「朝RUNのみ」の除外がある', offenders.length === 0,
    offenders.join(' / '));
}

check(`EXTRA_SLOTS がテストと同じ ${EXTRA_SLOTS}`,
  new RegExp(`const EXTRA_SLOTS = ${EXTRA_SLOTS};`).test(src));

// ── 1. 実SQLでの席の増減 ──────────────────────────────────────────
const db = new DatabaseSync(':memory:');
db.exec(read('../schema.sql'));

db.prepare(`
  INSERT INTO sessions
    (id, date, display_date, title, food, trainers, morning_run, capacity, is_open, bento_json, has_tacos, note)
  VALUES ('2026-09-06','2026-09-06','9/6（日）','テスト回',NULL,NULL,1,10,1,NULL,0,NULL)
`).run();

let seq = 0;
// 本番と同じINSERT（席を取るかどうかを ? = 0 で切り替える形）
const insert = (category) => db.prepare(`
  INSERT INTO reservations
    (id, session_id, line_user_id, display_name, category,
     morning_run, bento, tacos, trainer, message, ref, status, created_at)
  SELECT ?, s.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?
  FROM sessions s
  WHERE s.id = ? AND s.is_open = 1
    AND (? = 0 OR
         (SELECT COUNT(*) FROM reservations r
          WHERE r.session_id = s.id AND r.status = 'confirmed'
            AND r.category != '朝RUNのみ') < s.capacity + ${EXTRA_SLOTS})
`).run(
  `r${++seq}`, `u${seq}`, `テスト${seq}`, category,
  null, null, null, null, null, null, 'now',
  '2026-09-06',
  category === '朝RUNのみ' ? 0 : 1,
);

// お客様に見える残席（GET /api/liff/sessions と同じ集計）
const booked = () => db.prepare(`
  SELECT COUNT(CASE WHEN r.status = 'confirmed'
         AND r.category != '朝RUNのみ' THEN 1 END) AS booked
  FROM sessions s LEFT JOIN reservations r ON r.session_id = s.id
  WHERE s.id = '2026-09-06' GROUP BY s.id
`).get().booked;

check('予約ゼロなら booked=0', booked() === 0);

insert('都度');
check('通常の予約は booked が1増える', booked() === 1);

const before = booked();
insert('朝RUNのみ');
insert('朝RUNのみ');
insert('朝RUNのみ');
check('★「朝RUNのみ」を3件入れても booked は増えない（残席が減らない）',
  booked() === before, `booked=${booked()}`);

check('朝RUNのみの予約自体はちゃんと保存されている',
  db.prepare(`SELECT COUNT(*) AS n FROM reservations
              WHERE category = '朝RUNのみ' AND status = 'confirmed'`).get().n === 3);

// ── 2. 満席のとき ────────────────────────────────────────────────
// 定員10＋追加枠3＝13。すでに通常1件あるので、あと12件で満席
for (let i = 0; i < 12; i++) insert('都度');
check(`通常の予約が ${10 + EXTRA_SLOTS} 件で満席になる`, booked() === 10 + EXTRA_SLOTS);

check('満席のあと通常の予約は入らない（0行）', insert('都度').changes === 0);
check('★満席でも「朝RUNのみ」は受け付ける（席を取らないため）',
  insert('朝RUNのみ').changes === 1);
check('朝RUNのみを足しても booked は満席のまま増えない', booked() === 10 + EXTRA_SLOTS);

// ── 3. キャンセル後の再有効化 ────────────────────────────────────
// 満席の日でも、朝RUNのみの人は予約し直せる（席を取らないため）
db.prepare(`UPDATE reservations SET status = 'cancelled', cancelled_at = 'now'
            WHERE category = '朝RUNのみ' AND id = 'r2'`).run();

const reactivate = (id, takesSeat) => db.prepare(`
  UPDATE reservations
  SET status = 'confirmed', cancelled_at = NULL, created_at = 'now2'
  WHERE id = ? AND status = 'cancelled'
    AND (? = 0 OR
         (SELECT COUNT(*) FROM reservations r2
          WHERE r2.session_id = '2026-09-06' AND r2.status = 'confirmed'
            AND r2.category != '朝RUNのみ') <
         (SELECT capacity + ${EXTRA_SLOTS} FROM sessions WHERE id = '2026-09-06'))
`).run(id, takesSeat);

check('★満席でも朝RUNのみは予約し直せる', reactivate('r2', 0).changes === 1);

// 通常区分の人は、空いた席が他の人で埋まっていれば戻せない
db.prepare(`UPDATE reservations SET status = 'cancelled', cancelled_at = 'now'
            WHERE id = 'r1'`).run();
check('通常区分がキャンセルすると1席あく', booked() === 10 + EXTRA_SLOTS - 1);
insert('都度'); // あいた席を別の人が取る＝また満席
check('あいた席は別の人が取れる', booked() === 10 + EXTRA_SLOTS);
check('満席のあいだ通常区分は予約し直せない（0行）', reactivate('r1', 1).changes === 0);

// 1席あければ戻せる
db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = 'r5'`).run();
check('1席あけば通常区分も予約し直せる', reactivate('r1', 1).changes === 1);

// ── 4. 朝RUNの無い日に「朝RUNのみ」は使えない ──────────────────────
db.prepare(`
  INSERT INTO sessions
    (id, date, display_date, title, food, trainers, morning_run, capacity, is_open, bento_json, has_tacos, note)
  VALUES ('2026-09-13','2026-09-13','9/13（日）','朝RUNなしの回',NULL,NULL,0,10,1,NULL,0,NULL)
`).run();
check('朝RUNなしの日は morning_run=0 で判別できる（サーバーが弾く条件）',
  db.prepare(`SELECT morning_run FROM sessions WHERE id='2026-09-13'`).get().morning_run === 0);

const fail = results.filter(r => !r).length;
console.log(`\n合計: ${results.length}項目中 ${results.length - fail}件 合格`);
process.exit(fail ? 1 : 0);
