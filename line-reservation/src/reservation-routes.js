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

// 定員(capacity=通常10)を超えた場合に受け付ける「追加枠」の数。
// 通常枠が埋まると、この数だけ追加で予約を受け付ける（合計 capacity + EXTRA_SLOTS まで）。
const EXTRA_SLOTS = 3;

// ── LIFF 予約フォームページを配信 ──
reservationRoutes.get('/liff/reserve', async (c) => {
  const liffId = c.env.LIFF_ID || '';
  // reserve.html は Worker の Assets / KV に置くか、
  // 文字列として import して c.html() で返す
  // 例: import reserveHtml from '../liff/reserve.html?raw';
  // ここでは KV から取得するパターンを示す
  const html = await c.env.STATIC_KV?.get('liff/reserve.html')
    ?? '<h1>予約フォームが見つかりません</h1>';
  // LINEアプリ内ブラウザ・中間キャッシュが古いHTMLを表示し続けるのを防ぐ
  // （KV更新後にデプロイしても画面が切り替わらない不具合の対策）
  c.header('Cache-Control', 'no-store, must-revalidate');
  return c.html(html.replace("'__LIFF_ID__'", `'${liffId}'`));
});

// ── GET /api/sessions ── 開催予定＋残枠 ──
reservationRoutes.get('/api/liff/sessions', async (c) => {
  // Workerの内部時刻はUTC。ビジネスはJST(UTC+9)基準のため、日付はJSTで計算する。
  // さらに「当日の朝クラスが終わった後も一日中表示され続ける」のを防ぐため、
  // JST正午(12:00)を過ぎたらその日のセッションもクローズ扱いにする。
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const todayJst = nowJst.toISOString().split('T')[0];
  let cutoffDate = todayJst;
  if (nowJst.getUTCHours() >= 12) {
    const tomorrow = new Date(nowJst);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    cutoffDate = tomorrow.toISOString().split('T')[0];
  }

  const { results } = await c.env.DB.prepare(`
    SELECT s.*,
      COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) AS booked
    FROM sessions s
    LEFT JOIN reservations r ON r.session_id = s.id
    WHERE s.is_open = 1 AND s.date >= ?
    GROUP BY s.id
    ORDER BY s.date
  `).bind(cutoffDate).all();

  const sessions = results.map(s => ({
    id: s.id,
    date: s.date,
    display_date: s.display_date,
    title: s.title,
    food: s.food,
    trainers: s.trainers,
    morning_run: s.morning_run === 1,
    capacity: s.capacity,
    // 通常枠の残り（0未満は0）
    base_remaining: Math.max(0, s.capacity - s.booked),
    // 追加枠まで含めた予約可能な残り総数。これが0で「満席」
    remaining: Math.max(0, s.capacity + EXTRA_SLOTS - s.booked),
    extra_slots: EXTRA_SLOTS,
    tacos: s.has_tacos === 1,
    bento: s.bento_json ? JSON.parse(s.bento_json) : [],
    note: s.note,
    // 開催時間の表示。NULLなら既定（AM7:30〜10:00）扱い。migration未適用のDBでも undefined→null で安全
    time_label: s.time_label || null,
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
  const { session_ids, category, morning_run, bento, message, ref, trainer } = body;

  if (!Array.isArray(session_ids) || session_ids.length === 0 || !category) {
    return c.json({ error: 'missing_fields' }, 400);
  }
  if (category === '体験' && !trainer) {
    return c.json({ error: 'trainer_required' }, 400);
  }

  const reservations = [];
  // 満席などで予約できなかった日程。途中でreturnせず最後まで処理して、
  // 「一部は予約成立・一部は満席」を正しくクライアントへ返す
  // （以前は最初の満席で即409を返していたため、先に成立した予約が
  //   ユーザーに「全部失敗した」ように見えるバグがあった）。
  const failed = [];

  for (const sessionId of session_ids) {
    // 2. 残枠チェック（定員＋追加枠を超えたら満席）
    const session = await c.env.DB.prepare(`
      SELECT s.*,
        (s.capacity + ${EXTRA_SLOTS} - COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END)) AS remaining
      FROM sessions s
      LEFT JOIN reservations r ON r.session_id = s.id
      WHERE s.id = ? AND s.is_open = 1
      GROUP BY s.id
    `).bind(sessionId).first();

    if (!session) { failed.push({ session_id: sessionId, error: 'session_not_found' }); continue; }
    if (session.remaining <= 0) { failed.push({ session_id: sessionId, error: 'full' }); continue; }

    // 3. 予約 INSERT（UNIQUE 制約で二重予約を自動防止）
    // 残枠チェックとINSERTを1本のSQLにまとめ、同時申込みでの定員オーバーを防ぐ。
    // 手順2のチェックだけだと「数える→書き込む」の間に他の人が書き込めてしまう。
    const reservationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // 予約済み確認・満席チェック後の通知（新規予約・再有効化で共通利用）
    const notifyNewReservation = async (resObj) => {
      const counted = await c.env.DB.prepare(`
        SELECT
          (capacity + ${EXTRA_SLOTS} - (SELECT COUNT(*) FROM reservations
                WHERE session_id = ? AND status = 'confirmed')) AS remaining,
          (capacity - (SELECT COUNT(*) FROM reservations
                WHERE session_id = ? AND status = 'confirmed')) AS base_remaining
        FROM sessions WHERE id = ?
      `).bind(sessionId, sessionId, sessionId).first();
      const remain = Math.max(0, counted?.remaining ?? 0);
      const isExtra = (counted?.base_remaining ?? 1) <= 0;
      c.executionCtx.waitUntil(
        sendNotifications(userId, displayName, session, resObj, remain, isExtra, c.env)
      );
    };

    let inserted;
    try {
      inserted = await c.env.DB.prepare(`
        INSERT INTO reservations
          (id, session_id, line_user_id, display_name, category,
           morning_run, bento, tacos, trainer, message, ref, status, created_at)
        SELECT ?, s.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?
        FROM sessions s
        WHERE s.id = ? AND s.is_open = 1
          AND (SELECT COUNT(*) FROM reservations r
               WHERE r.session_id = s.id AND r.status = 'confirmed') < s.capacity + ${EXTRA_SLOTS}
      `).bind(
        reservationId, userId, displayName, category,
        morning_run || null,
        Array.isArray(bento) && bento.length ? bento.join(',') : null,
        null, // tacos: TACOS Partyは別枠セッション化したため今後は使用しない
        trainer || null,
        message || null,
        ref || null,
        createdAt,
        sessionId
      ).run();
    } catch (e) {
      if (!e.message?.includes('UNIQUE')) throw e;

      // UNIQUE(session_id, line_user_id) に抵触＝この人はこのセッションを予約済み（confirmed）か
      // 過去にキャンセル済み（cancelled）。cancelledのまま放置すると、一度キャンセルした人が
      // 同じセッションを二度と予約し直せなくなる（別セッションIDでのUNIQUE制約に永久に阻まれる）
      // バグになるため、cancelledだった場合は同じ行を再有効化する。
      const existing = await c.env.DB.prepare(
        `SELECT * FROM reservations WHERE session_id = ? AND line_user_id = ?`
      ).bind(sessionId, userId).first();

      if (!existing) throw e;

      if (existing.status === 'confirmed') {
        // 冪等：すでに予約済みなので既存レコードを返す
        reservations.push(existing);
        continue;
      }

      // cancelledだった予約を再有効化。status='cancelled'かつ残枠ありの間だけ
      // 更新が通るガードで、同時リクエストによる二重再有効化・定員オーバーを防ぐ。
      const reactivated = await c.env.DB.prepare(`
        UPDATE reservations
        SET status = 'confirmed', display_name = ?, category = ?, morning_run = ?,
            bento = ?, trainer = ?, message = ?, ref = ?, created_at = ?
        WHERE id = ? AND status = 'cancelled'
          AND (SELECT COUNT(*) FROM reservations r2
               WHERE r2.session_id = ? AND r2.status = 'confirmed') <
              (SELECT capacity + ${EXTRA_SLOTS} FROM sessions WHERE id = ?)
      `).bind(
        displayName, category, morning_run || null,
        Array.isArray(bento) && bento.length ? bento.join(',') : null,
        trainer || null, message || null, ref || null, createdAt,
        existing.id, sessionId, sessionId
      ).run();

      if (!reactivated.meta || reactivated.meta.changes === 0) {
        // 別リクエストが先に再有効化済み、またはその間に満席になった
        const refreshed = await c.env.DB.prepare(
          `SELECT * FROM reservations WHERE id = ?`
        ).bind(existing.id).first();
        if (refreshed?.status === 'confirmed') { reservations.push(refreshed); continue; }
        failed.push({ session_id: sessionId, error: 'full' });
        continue;
      }

      const reactivatedRes = {
        id: existing.id, session_id: sessionId, category,
        display_name: displayName, trainer: trainer || null,
      };
      reservations.push(reactivatedRes);
      await notifyNewReservation(reactivatedRes);
      continue;
    }

    // 書き込めなかった＝この瞬間に満席になった（セッションの存在は手順2で確認済み）
    if (!inserted.meta || inserted.meta.changes === 0) {
      failed.push({ session_id: sessionId, error: 'full' });
      continue;
    }

    const newRes = {
      id: reservationId, session_id: sessionId, category,
      display_name: displayName, trainer: trainer || null,
    };
    reservations.push(newRes);

    // 4. Push通知（非同期・失敗しても予約は通す）
    await notifyNewReservation(newRes);
  }

  // 1件も成立しなかった場合のみエラー扱い（error/session_id は旧クライアント互換のため残す）
  if (reservations.length === 0 && failed.length > 0) {
    const status = failed.some(f => f.error === 'full') ? 409 : 404;
    return c.json({ error: failed[0].error, session_id: failed[0].session_id, failed }, status);
  }

  return c.json({ ok: true, reservations, failed });
});

// ── GET /api/liff/my-reservations ── 自分の予約一覧 ──
// 注意: LIFF（一般ユーザー）から呼ぶAPIは必ず /api/liff/ 配下に置くこと。
// それ以外のパスは管理者認証ミドルウェアに弾かれて401になる。
reservationRoutes.get('/api/liff/my-reservations', async (c) => {
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

  // 体験パーソナルの確定待ちリクエストも返す（テーブル未作成でも予約一覧は返す）
  let trialRequests = [];
  try {
    const trials = await c.env.DB.prepare(`
      SELECT id, trainer, preferred_date, preferred_time, alt_note, status, created_at
      FROM trial_requests
      WHERE line_user_id = ? AND status = 'pending'
      ORDER BY created_at DESC
    `).bind(userId).all();
    trialRequests = trials.results;
  } catch (e) {
    // trial_requests テーブル未作成時は空配列のまま
  }

  return c.json({ reservations: results, trial_requests: trialRequests });
});

// ── POST /api/liff/trial-request ── 体験パーソナルの日時リクエスト（確定待ち） ──
// 日曜クラスと違い担当の空きが分からないため即confirmedにはせず、pendingで受け付ける。
// 担当が空きを確認して別途日時確定の連絡をする運用。
reservationRoutes.post('/api/liff/trial-request', async (c) => {
  const idToken = (c.req.header('Authorization') || '').replace('Bearer ', '');
  if (!idToken) return c.json({ error: 'unauthorized' }, 401);

  let userId, displayName;
  try {
    ({ userId, displayName } = await verifyIdToken(idToken, c.env));
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const { trainer, preferred_date, preferred_time, alt_note, ref } = await c.req.json();
  if (!trainer || !preferred_date || !preferred_time) {
    return c.json({ error: 'missing_fields' }, 400);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO trial_requests
      (id, line_user_id, display_name, trainer, preferred_date, preferred_time, alt_note, ref, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).bind(
    id, userId, displayName, trainer, preferred_date, preferred_time,
    alt_note || null, ref || null, createdAt
  ).run();

  c.executionCtx.waitUntil(
    sendTrialNotifications(userId, displayName, { trainer, preferred_date, preferred_time, alt_note }, c.env)
  );

  return c.json({ ok: true, id });
});

// ── POST /api/liff/trial-request/:id/cancel ── 体験リクエストの取消 ──
reservationRoutes.post('/api/liff/trial-request/:id/cancel', async (c) => {
  const idToken = (c.req.header('Authorization') || '').replace('Bearer ', '');
  if (!idToken) return c.json({ error: 'unauthorized' }, 401);

  let userId, displayName;
  try {
    ({ userId, displayName } = await verifyIdToken(idToken, c.env));
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const reqId = c.req.param('id');
  const tr = await c.env.DB.prepare(
    `SELECT * FROM trial_requests WHERE id = ? AND line_user_id = ? AND status = 'pending'`
  ).bind(reqId, userId).first();

  if (!tr) return c.json({ error: 'not_found' }, 404);

  await c.env.DB.prepare(
    `UPDATE trial_requests SET status = 'cancelled' WHERE id = ?`
  ).bind(reqId).run();

  c.executionCtx.waitUntil(
    sendTrialCancelNotifications(userId, displayName, tr, c.env)
  );

  return c.json({ ok: true });
});

// ── POST /api/liff/reservations/:id/cancel ── キャンセル ──
reservationRoutes.post('/api/liff/reservations/:id/cancel', async (c) => {
  const idToken = (c.req.header('Authorization') || '').replace('Bearer ', '');
  if (!idToken) return c.json({ error: 'unauthorized' }, 401);

  let userId, displayName;
  try {
    ({ userId, displayName } = await verifyIdToken(idToken, c.env));
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const reservationId = c.req.param('id');
  const reservation = await c.env.DB.prepare(`
    SELECT r.*, s.display_date, s.title
    FROM reservations r
    JOIN sessions s ON s.id = r.session_id
    WHERE r.id = ? AND r.line_user_id = ? AND r.status = 'confirmed'
  `).bind(reservationId, userId).first();

  if (!reservation) return c.json({ error: 'not_found' }, 404);

  await c.env.DB.prepare(
    `UPDATE reservations SET status = 'cancelled' WHERE id = ?`
  ).bind(reservationId).run();

  // 本人への確認＋スタッフ通知（失敗してもキャンセル自体は成立させる）
  c.executionCtx.waitUntil(
    sendCancelNotifications(userId, displayName, reservation, c.env)
  );

  return c.json({ ok: true });
});

// ── Cron: 前日リマインド ──
// wrangler.toml: crons = ["0 9 * * *"]  (JST 18:00)
// scheduled(event, env, ctx) { ctx.waitUntil(sendReminders(env)); }
export async function sendReminders(env) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // s.* で取得することで、time_label列のmigration未適用DBでもSQLエラーにならない
  const { results } = await env.DB.prepare(`
    SELECT r.line_user_id, s.*
    FROM reservations r
    JOIN sessions s ON s.id = r.session_id
    WHERE s.date = ? AND r.status = 'confirmed'
  `).bind(tomorrowStr).all();

  for (const r of results) {
    // 特別枠（例: TACOS Party）は朝クラスの定型文（AM7:30・朝RUN）を使わない
    const isSpecial = r.id !== r.date;
    const lines = isSpecial
      ? [
          `🌅 明日 ${r.display_date}「${r.title}」${r.time_label ? `（${r.time_label}）` : ''}、HMCでお待ちしています！`,
          'お気をつけてお越しください。',
        ]
      : [
          `🌅 明日 ${r.display_date} AM7:30、HMCでお待ちしています！`,
          r.morning_run ? '朝RUNは6:30〜。お気をつけてお越しください。' : 'お気をつけてお越しください。',
        ];
    await pushToUser(r.line_user_id, [{ type: 'text', text: lines.join('\n') }], env);
  }
}

async function sendNotifications(userId, displayName, session, reservation, remaining, isExtra, env) {
  // 開催時間はセッション個別のtime_labelを優先（未設定なら朝クラス既定）。
  // id !== date は特別枠（例: 2026-07-19-tacos）＝朝クラスではないので、
  // 「動きやすい服装で」「日曜の朝」の定型文を使わない。
  const timeLabel = session.time_label || 'AM7:30〜10:00';
  const isSpecial = session.id !== session.date;

  // 本人への確認メッセージ
  const userText = [
    '✅ ご予約ありがとうございます！',
    '',
    '▼ ご予約内容',
    `${session.display_date} ${session.title}`,
    `${timeLabel} / 観音寺 HACOS`,
    `区分：${reservation.category}`,
    ...(reservation.trainer ? [`担当：${reservation.trainer}`] : []),
    '',
    ...(isSpecial
      ? ['当日のご来場をお待ちしています🌅']
      : ['動きやすい服装でお越しください。', '日曜の朝、お待ちしています🌅']),
    '変更・キャンセルは、予約フォームを開くと画面上部の「あなたの予約」からいつでも行えます。',
  ].join('\n');

  await pushToUser(userId, [{ type: 'text', text: userText }], env);

  // スタッフ通知
  const staffText = [
    reservation.category === '回数券'
      ? (isExtra ? '🎫 新規予約【回数券・追加枠】' : '🎫 新規予約【回数券】')
      : (isExtra ? '🆕 新規予約（追加枠）' : '🆕 新規予約'),
    `${session.display_date} ／ ${reservation.category}`,
    ...(reservation.trainer ? [`担当：${reservation.trainer}`] : []),
    `お名前(LINE)：${displayName}`,
    `残枠：${remaining}${isExtra ? '（追加枠）' : ''}`,
  ].join('\n');

  const staffIds = (env.STAFF_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const staffId of staffIds) {
    await pushToUser(staffId, [{ type: 'text', text: staffText }], env);
  }
}

async function sendCancelNotifications(userId, displayName, reservation, env) {
  const userText = [
    '✅ キャンセルを受け付けました。',
    '',
    '▼ キャンセルした予約',
    `${reservation.display_date} ${reservation.title}`,
    '',
    'またのご参加をお待ちしています🌅',
  ].join('\n');

  await pushToUser(userId, [{ type: 'text', text: userText }], env);

  const staffText = [
    reservation.category === '回数券' ? '❌ 予約キャンセル【🎫回数券】' : '❌ 予約キャンセル',
    `${reservation.display_date} ／ ${reservation.category}`,
    ...(reservation.trainer ? [`担当：${reservation.trainer}`] : []),
    `お名前(LINE)：${displayName}`,
  ].join('\n');

  const staffIds = (env.STAFF_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const staffId of staffIds) {
    await pushToUser(staffId, [{ type: 'text', text: staffText }], env);
  }
}

async function sendTrialNotifications(userId, displayName, t, env) {
  const when = `${t.preferred_date} ${t.preferred_time || ''}`.trim();

  const userText = [
    '🌟 体験パーソナルのリクエストを受け付けました！',
    '',
    'まだ予約は確定していません。担当が空き状況を確認し、日時確定のご連絡をLINEでお送りします。少々お待ちください🙏',
    '',
    '▼ ご希望内容',
    `担当：${t.trainer}`,
    `第1希望：${when}`,
    ...(t.alt_note ? [`ご要望：${t.alt_note}`] : []),
  ].join('\n');
  await pushToUser(userId, [{ type: 'text', text: userText }], env);

  const staffText = [
    '🌟 体験パーソナル【リクエスト・要日時確定】',
    `担当希望：${t.trainer}`,
    `第1希望：${when}`,
    ...(t.alt_note ? [`ご要望：${t.alt_note}`] : []),
    `お名前(LINE)：${displayName}`,
    '※空き確認のうえ日時確定の連絡をお願いします',
  ].join('\n');
  const staffIds = (env.STAFF_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const staffId of staffIds) {
    await pushToUser(staffId, [{ type: 'text', text: staffText }], env);
  }
}

async function sendTrialCancelNotifications(userId, displayName, tr, env) {
  const when = `${tr.preferred_date} ${tr.preferred_time || ''}`.trim();

  await pushToUser(userId, [{ type: 'text', text: [
    '❌ 体験パーソナルのリクエストを取り消しました。',
    'またのご利用をお待ちしています🌅',
  ].join('\n') }], env);

  const staffText = [
    '❌ 体験パーソナル リクエスト取消',
    `担当希望：${tr.trainer}`,
    `第1希望：${when}`,
    `お名前(LINE)：${displayName}`,
  ].join('\n');
  const staffIds = (env.STAFF_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const staffId of staffIds) {
    await pushToUser(staffId, [{ type: 'text', text: staffText }], env);
  }
}

export { reservationRoutes };
