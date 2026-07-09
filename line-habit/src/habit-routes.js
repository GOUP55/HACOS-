// HACOS × HMC 習慣トラッキングルート（Hono）
// 予約システムと同じハーネスに追加する。apps/worker/src/index.ts への追記:
//   import { habitRoutes, sendWeeklyHabitDigest } from './habit-routes.js';
//   app.route('/', habitRoutes);
//   // 既存の scheduled() の cron "0 9 * * *" 分岐に sendWeeklyHabitDigest(env) を追加
//   // （毎日呼んでよい。関数側で「JST月曜のみ送信」を判定する）
//
// 注意: LIFF（一般ユーザー）から呼ぶAPIは必ず /api/liff/ 配下に置くこと。
// それ以外のパスは管理者認証ミドルウェアに弾かれて401になる（予約システムのREADME参照）。

import { Hono } from 'hono';
import { verifyIdToken, pushToUser } from './line-utils.js';

const habitRoutes = new Hono();

// 記録できる日数の上限（今日と昨日のみ。遠い過去の書き換えは習慣化の意味が薄れるため）
const EDITABLE_DAYS = 2;
// メモの最大文字数
const NOTE_MAX = 500;

// JSTの日付文字列 (YYYY-MM-DD)。n日前を指定できる
const jstDate = (daysAgo = 0) =>
  new Date(Date.now() + 9 * 3600 * 1000 - daysAgo * 86400 * 1000).toISOString().slice(0, 10);

// ── LIFF 習慣記録ページを配信 ──
habitRoutes.get('/liff/habit', async (c) => {
  const liffId = c.env.HABIT_LIFF_ID || '';
  const html = await c.env.STATIC_KV?.get('liff/habit.html')
    ?? '<h1>記録ページが見つかりません</h1>';
  c.header('Cache-Control', 'no-store, must-revalidate');
  return c.html(html.replace("'__HABIT_LIFF_ID__'", `'${liffId}'`));
});

// ── GET /api/liff/habit/summary ── 自分の直近28日の記録 ──
habitRoutes.get('/api/liff/habit/summary', async (c) => {
  const idToken = (c.req.header('Authorization') || '').replace('Bearer ', '');
  if (!idToken) return c.json({ error: 'unauthorized' }, 401);

  let userId;
  try {
    ({ userId } = await verifyIdToken(idToken, c.env));
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  // 取得範囲は「直近28日」と「今月1日」の早い方から。
  // 直近28日固定だと31日ある月の月末に月初の記録が窓から落ち、
  // 「今月の記録」統計が実際より少なく表示されるため
  const today = jstDate(0);
  const monthStart = today.slice(0, 8) + '01';
  const windowStart = monthStart < jstDate(27) ? monthStart : jstDate(27);

  const { results } = await c.env.DB.prepare(`
    SELECT log_date, moved, ate_well, note
    FROM habit_logs
    WHERE line_user_id = ? AND log_date >= ?
    ORDER BY log_date
  `).bind(userId, windowStart).all();

  // 連続記録はサーバー側で全期間から計算する（クライアントに渡す窓が
  // 28日程度しかないため、28日以上続いている人ほど過小表示になるのを防ぐ）。
  // 400日を超える連続は400でカンスト（十分長いので実用上問題ない）
  const { results: dateRows } = await c.env.DB.prepare(`
    SELECT log_date FROM habit_logs
    WHERE line_user_id = ?
    ORDER BY log_date DESC LIMIT 400
  `).bind(userId).all();
  const dates = new Set(dateRows.map(r => r.log_date));
  // 今日まだつけていなくても、昨日までの連続は途切れていない扱い
  let streak = 0;
  for (let i = dates.has(today) ? 0 : 1; dates.has(jstDate(i)); i++) streak++;

  return c.json({ today, streak, logs: results });
});

// ── POST /api/liff/habit/log ── 今日/昨日の記録を保存（同じ日は上書き） ──
habitRoutes.post('/api/liff/habit/log', async (c) => {
  const idToken = (c.req.header('Authorization') || '').replace('Bearer ', '');
  if (!idToken) return c.json({ error: 'unauthorized' }, 401);

  let userId, displayName;
  try {
    ({ userId, displayName } = await verifyIdToken(idToken, c.env));
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const logDate = String(body.log_date || '');
  const allowedDates = Array.from({ length: EDITABLE_DAYS }, (_, i) => jstDate(i));
  if (!allowedDates.includes(logDate)) {
    return c.json({ error: 'date_not_editable', allowed: allowedDates }, 400);
  }

  const moved = body.moved ? 1 : 0;
  const ateWell = body.ate_well ? 1 : 0;
  const note = String(body.note || '').trim().slice(0, NOTE_MAX);

  // 何もない記録は保存しない（空タップの連打で「記録した気になる」のを防ぐ）
  if (!moved && !ateWell && !note) {
    return c.json({ error: 'empty_log' }, 400);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO habit_logs
      (id, line_user_id, display_name, log_date, moved, ate_well, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(line_user_id, log_date) DO UPDATE SET
      display_name = excluded.display_name,
      moved        = excluded.moved,
      ate_well     = excluded.ate_well,
      note         = excluded.note,
      updated_at   = excluded.updated_at
  `).bind(
    crypto.randomUUID(), userId, displayName || null, logDate,
    moved, ateWell, note || null, now, now
  ).run();

  return c.json({ ok: true });
});

// ── Cron: スタッフ向け通知（毎日呼ばれる入口） ──
// 既存の毎日cron（UTC 9:00 = JST 18:00）から毎日呼ばれる前提。
// ・毎日: 「記録が2日止まった人」の当日限り通知（下のsendLapseAlerts）
// ・JST月曜のみ: 先週月曜〜日曜の週間ダイジェスト
// 関数名は歴史的経緯でWeeklyのままだが、index.ts側の呼び出しを変えずに
// 日次処理を追加できるよう、この関数を日次の入口として使っている。
// ※会員本人への自動送信は絶対にしない（通知先はSTAFF_USER_IDSのみ。HACOSの運用ルール）
export async function sendWeeklyHabitDigest(env) {
  await sendLapseAlerts(env); // 毎日実行（対象者がいる日だけ送信される）

  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  if (nowJst.getUTCDay() !== 1) return; // 週間ダイジェストはJSTの月曜のみ

  const since = jstDate(7); // 先週月曜
  const until = jstDate(1); // 先週日曜

  const { results } = await env.DB.prepare(`
    SELECT line_user_id,
           MAX(display_name)                AS name,
           SUM(moved)                       AS moved_days,
           SUM(ate_well)                    AS ate_days,
           COUNT(*)                         AS log_days
    FROM habit_logs
    WHERE log_date BETWEEN ? AND ?
    GROUP BY line_user_id
    ORDER BY log_days DESC, name
  `).bind(since, until).all();

  // 「先週は記録ゼロだが、その前の28日間には記録があった」＝記録が止まった人。
  // 声かけが一番必要な人ほど集計から消えて見えなくなるのを防ぐ
  const { results: lapsed } = await env.DB.prepare(`
    SELECT line_user_id, MAX(display_name) AS name
    FROM habit_logs
    WHERE log_date >= ? AND log_date < ?
      AND line_user_id NOT IN (
        SELECT line_user_id FROM habit_logs WHERE log_date BETWEEN ? AND ?
      )
    GROUP BY line_user_id
    ORDER BY name
  `).bind(jstDate(35), since, since, until).all();

  if (!results.length && !lapsed.length) return; // 対象が誰もいない週は送らない

  // メモは別クエリでまとめて取り、ユーザーごとに連結（週の様子への返信のネタにする）
  const { results: noteRows } = await env.DB.prepare(`
    SELECT line_user_id, log_date, note
    FROM habit_logs
    WHERE log_date BETWEEN ? AND ? AND note IS NOT NULL AND note != ''
    ORDER BY log_date
  `).bind(since, until).all();
  const notesByUser = {};
  for (const n of noteRows) {
    // メモ内の改行は潰す。改行入りのメモで他ユーザーの集計行を装う
    // 「なりすまし表示」をダイジェスト上でできなくするため
    (notesByUser[n.line_user_id] ??= []).push(String(n.note).replace(/\s+/g, ' '));
  }

  const fmt = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const lines = [
    `📊 今週の習慣記録（${fmt(since)}〜${fmt(until)}）`,
    '一人ひとりに「見てるよ」のひとことを返してあげてください🌱',
    '',
  ];
  if (results.length) {
    for (const r of results) {
      lines.push(`● ${r.name || '(名前未取得)'}：記録${r.log_days}日／🏃${r.moved_days}日・🥗${r.ate_days}日`);
      const notes = (notesByUser[r.line_user_id] || []).join(' ／ ');
      if (notes) lines.push(`　💬 ${notes.length > 120 ? notes.slice(0, 120) + '…' : notes}`);
    }
  } else {
    lines.push('（先週の記録はありませんでした）');
  }

  // 記録が止まった人（声かけ候補）
  if (lapsed.length) {
    lines.push('');
    lines.push(`⚠️ 先週は記録なし（声かけ候補）：${lapsed.map(l => l.name || '(名前未取得)').join('、')}`);
  }

  await pushToStaff(lines.join('\n'), env);
}

// ── 毎日: 記録が止まった人の当日限り通知 ──
// 「一昨日まで3日以上続けていた人が、昨日・一昨日と2日連続で空白になった」その日だけ
// スタッフに知らせる。判定条件そのものが特定の1日しか成立しない形
// （3日前に記録あり・昨日と一昨日が空白）なので、空白が続いても翌日以降は
// 条件から外れ、同じ人への再送は状態管理なしで自然に起きない。
// 今日すでに記録した人（自力で復帰済み）は対象外。
async function sendLapseAlerts(env) {
  const { results } = await env.DB.prepare(`
    SELECT line_user_id, log_date, display_name
    FROM habit_logs
    WHERE log_date >= ?
    ORDER BY log_date
  `).bind(jstDate(5)).all();
  if (!results.length) return;

  const byUser = {};
  for (const r of results) {
    const u = (byUser[r.line_user_id] ??= { dates: new Set(), name: null });
    u.dates.add(r.log_date);
    if (r.display_name) u.name = r.display_name; // 日付順なので最後の名前が残る
  }

  const targets = [];
  for (const [, u] of Object.entries(byUser)) {
    const has = (i) => u.dates.has(jstDate(i));
    // 空白: 今日(まだ)・昨日・一昨日 ／ 直前に3日以上の連続: 3・4・5日前
    if (!has(0) && !has(1) && !has(2) && has(3) && has(4) && has(5)) {
      targets.push(u.name || '(名前未取得)');
    }
  }
  if (!targets.length) return;

  const text = [
    ...targets.map(name => `🌱 ${name}さんの記録が2日止まっています。ひとことどうぞ`),
    '（本人への自動送信はしていません。声かけはスタッフから）',
  ].join('\n');
  await pushToStaff(text, env);
}

// スタッフ全員へ送る共通処理。通知先はSTAFF_USER_IDSのみ（会員本人には送らない）
async function pushToStaff(text, env) {
  const staffIds = (env.STAFF_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const staffId of staffIds) {
    await pushToUser(staffId, [{ type: 'text', text }], env);
  }
}

export { habitRoutes };
