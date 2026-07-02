// HACOS × HMC 予約ルート（Hono）
// 既存ハーネスの src/index.js に追加する:
//   import { reservationRoutes, sendReminders } from './reservation-routes.js';
//   app.route('/', reservationRoutes);
// wrangler.toml に追加:
//   [[d1_databases]]
//   binding = "DB"
//   database_name = "<YOUR_D1_NAME>"
//   database_id = "<YOUR_D1_ID>"
//   [triggers]
//   crons = ["0 9 * * *"]   // 毎日 18:00 JST (UTC+9)

import { Hono } from 'hono';
import { verifyIdToken, pushToUser } from './line-utils.js';

const reservationRoutes = new Hono();

// ── LIFF 予約フォームページを配信 ──
reservationRoutes.get('/liff/reserve', async (c) => {
  const liffId = c.env.LIFF_ID || '';
  // reserve.html は Worker の Assets / KV に置くか、
  // 文字列として import して c.html() で返す
  // 例: import reserveHtml from '../liff/reserve.html?raw';
  // ここでは KV から取得するパターンを示す
  const html = await c.env.STATIC_KV?.get('liff/reserve.html')
    ?? '<h1>予約フォームが見つかりません</h1>';
  return c.html(html.replace("'__LIFF_ID__'", `'${liffId}'`));
});

// ── GET /api/sessions ── 開催予定＋残枠 ──
reservationRoutes.get('/api/liff/sessions', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  const { results } = await c.env.DB.prepare(`
    SELECT s.*,
      (s.capacity - COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END)) AS remaining
    FROM sessions s
    LEFT JOIN reservations r ON r.session_id = s.id
    WHERE s.is_open = 1 AND s.date >= ?
    GROUP BY s.id
    ORDER BY s.date
  `).bind(today).all();

  const sessions = results.map(s => ({
    id: s.id,
    display_date: s.display_date,
    title: s.title,
    food: s.food,
    trainers: s.trainers,
    morning_run: s.morning_run === 1,
    capacity: s.capacity,
    remaining: Math.max(0, s.remaining),
    tacos: s.has_tacos === 1,
    bento: s.bento_json ? JSON.parse(s.bento_json) : [],
    note: s.note,
  }));

  return c.json({ sessions });
});

// ── POST /api/reservations ── 予約作成 ──
reservationRoutes.post('/api/liff/reservations', async (c) => {
  // 1. IDトークン検証（クライアント送信の userId は信用しない）
  const idToken = (c.req.header('Authorization') || '').replace('Bearer ', '');
  if (!idToken) return c.json({ error: 'unauthorized' }, 401);

  let userId, displayName;
  try {
    ({ userId, displayName } = await verifyIdToken(idToken, c.env));
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const body = await c.req.json();
  const { session_ids, category, morning_run, bento, tacos, message, ref } = body;

  if (!Array.isArray(session_ids) || session_ids.length === 0 || !category) {
    return c.json({ error: 'missing_fields' }, 400);
  }

  const reservations = [];

  for (const sessionId of session_ids) {
    // 2. 残枠チェック（定員オーバー防止）
    const session = await c.env.DB.prepare(`
      SELECT s.*,
        (s.capacity - COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END)) AS remaining
      FROM sessions s
      LEFT JOIN reservations r ON r.session_id = s.id
      WHERE s.id = ? AND s.is_open = 1
      GROUP BY s.id
    `).bind(sessionId).first();

    if (!session) return c.json({ error: 'session_not_found', session_id: sessionId }, 404);
    if (session.remaining <= 0) return c.json({ error: 'full', session_id: sessionId }, 409);

    // 3. 予約 INSERT（UNIQUE 制約で二重予約を自動防止）
    const reservationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await c.env.DB.prepare(`
        INSERT INTO reservations
          (id, session_id, line_user_id, display_name, category,
           morning_run, bento, tacos, message, ref, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
      `).bind(
        reservationId, sessionId, userId, displayName, category,
        morning_run || null,
        Array.isArray(bento) && bento.length ? bento.join(',') : null,
        tacos || null,
        message || null,
        ref || null,
        createdAt
      ).run();
    } catch (e) {
      if (e.message?.includes('UNIQUE')) {
        // 冪等：すでに予約済みなので既存レコードを返す
        const existing = await c.env.DB.prepare(
          `SELECT * FROM reservations WHERE session_id = ? AND line_user_id = ?`
        ).bind(sessionId, userId).first();
        if (existing) { reservations.push(existing); continue; }
      }
      throw e;
    }

    const newRes = { id: reservationId, session_id: sessionId, category, display_name: displayName };
    reservations.push(newRes);

    // 4. Push通知（非同期・失敗しても予約は通す）
    c.executionCtx.waitUntil(
      sendNotifications(userId, displayName, session, newRes, c.env)
    );
  }

  return c.json({ ok: true, reservations });
});

// ── GET /api/my-reservations ── 自分の予約一覧 ──
reservationRoutes.get('/api/my-reservations', async (c) => {
  const idToken = (c.req.header('Authorization') || '').replace('Bearer ', '');
  if (!idToken) return c.json({ error: 'unauthorized' }, 401);

  let userId;
  try {
    ({ userId } = await verifyIdToken(idToken, c.env));
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT r.*, s.display_date, s.title, s.date
    FROM reservations r
    JOIN sessions s ON s.id = r.session_id
    WHERE r.line_user_id = ? AND r.status = 'confirmed'
    ORDER BY s.date
  `).bind(userId).all();

  return c.json({ reservations: results });
});

// ── POST /api/reservations/:id/cancel ── キャンセル ──
reservationRoutes.post('/api/reservations/:id/cancel', async (c) => {
  const idToken = (c.req.header('Authorization') || '').replace('Bearer ', '');
  if (!idToken) return c.json({ error: 'unauthorized' }, 401);

  let userId;
  try {
    ({ userId } = await verifyIdToken(idToken, c.env));
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const reservationId = c.req.param('id');
  const reservation = await c.env.DB.prepare(
    `SELECT * FROM reservations WHERE id = ? AND line_user_id = ? AND status = 'confirmed'`
  ).bind(reservationId, userId).first();

  if (!reservation) return c.json({ error: 'not_found' }, 404);

  await c.env.DB.prepare(
    `UPDATE reservations SET status = 'cancelled' WHERE id = ?`
  ).bind(reservationId).run();

  return c.json({ ok: true });
});

// ── Cron: 前日リマインド ──
// wrangler.toml: crons = ["0 9 * * *"]  (JST 18:00)
// scheduled(event, env, ctx) { ctx.waitUntil(sendReminders(env)); }
export async function sendReminders(env) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const { results } = await env.DB.prepare(`
    SELECT r.line_user_id, s.display_date, s.title, s.morning_run
    FROM reservations r
    JOIN sessions s ON s.id = r.session_id
    WHERE s.date = ? AND r.status = 'confirmed'
  `).bind(tomorrowStr).all();

  for (const r of results) {
    const lines = [
      `🌅 明日 ${r.display_date} AM7:30、HMCでお待ちしています！`,
      r.morning_run ? '朝RUNは6:30〜。お気をつけてお越しください。' : 'お気をつけてお越しください。',
    ];
    await pushToUser(r.line_user_id, [{ type: 'text', text: lines.join('\n') }], env);
  }
}

async function sendNotifications(userId, displayName, session, reservation, env) {
  // 本人への確認メッセージ
  const userText = [
    '✅ ご予約ありがとうございます！',
    '',
    '▼ ご予約内容',
    `${session.display_date} ${session.title}`,
    'AM7:30〜10:00 / 観音寺 HACOS',
    `区分：${reservation.category}`,
    '',
    '動きやすい服装でお越しください。',
    '日曜の朝、お待ちしています🌅',
    '変更・キャンセルはこのトークから「キャンセル」と送ってください。',
  ].join('\n');

  await pushToUser(userId, [{ type: 'text', text: userText }], env);

  // スタッフ通知
  const remaining = Math.max(0, session.remaining - 1);
  const staffText = [
    '🆕 新規予約',
    `${session.display_date} ／ ${reservation.category}`,
    `お名前(LINE)：${displayName}`,
    `残枠：${remaining}`,
  ].join('\n');

  const staffIds = (env.STAFF_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const staffId of staffIds) {
    await pushToUser(staffId, [{ type: 'text', text: staffText }], env);
  }
}

export { reservationRoutes };
