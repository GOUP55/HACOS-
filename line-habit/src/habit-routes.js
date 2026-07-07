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

  const { results } = await c.env.DB.prepare(`
    SELECT log_date, moved, ate_well, note
    FROM habit_logs
    WHERE line_user_id = ? AND log_date >= ?
    ORDER BY log_date
  `).bind(userId, jstDate(27)).all();

  return c.json({ today: jstDate(0), logs: results });
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
    crypto.randomUUID(), userId, displayName, logDate,
    moved, ateWell, note || null, now, now
  ).run();

  return c.json({ ok: true });
});

// ── Cron: 週間ダイジェスト（スタッフ向け） ──
// 既存の毎日cron（UTC 9:00 = JST 18:00）から毎日呼ばれる前提で、
// JSTの月曜だけ「先週月曜〜日曜」の集計をスタッフに送る。
export async function sendWeeklyHabitDigest(env) {
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  if (nowJst.getUTCDay() !== 1) return; // JSTの月曜のみ

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

  if (!results.length) return; // 記録ゼロの週は送らない

  // メモは別クエリでまとめて取り、ユーザーごとに連結（週の様子への返信のネタにする）
  const { results: noteRows } = await env.DB.prepare(`
    SELECT line_user_id, log_date, note
    FROM habit_logs
    WHERE log_date BETWEEN ? AND ? AND note IS NOT NULL AND note != ''
    ORDER BY log_date
  `).bind(since, until).all();
  const notesByUser = {};
  for (const n of noteRows) {
    (notesByUser[n.line_user_id] ??= []).push(n.note);
  }

  const fmt = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const lines = [
    `📊 今週の習慣記録（${fmt(since)}〜${fmt(until)}）`,
    '一人ひとりに「見てるよ」のひとことを返してあげてください🌱',
    '',
  ];
  for (const r of results) {
    lines.push(`● ${r.name || '(名前未取得)'}：記録${r.log_days}日／🏃${r.moved_days}日・🥗${r.ate_days}日`);
    const notes = (notesByUser[r.line_user_id] || []).join(' ／ ');
    if (notes) lines.push(`　💬 ${notes.length > 120 ? notes.slice(0, 120) + '…' : notes}`);
  }

  const staffIds = (env.STAFF_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const staffId of staffIds) {
    await pushToUser(staffId, [{ type: 'text', text: lines.join('\n') }], env);
  }
}

export { habitRoutes };
