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
import { renderAdminReservations } from './admin-page.js';
import { renderAdminLogin } from './admin-login-page.js';

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

// ── スタッフ用ログインページ ──
// 意図的に非/api/パス（＝認証なしで表示）。APIキー入力欄だけの画面で個人情報を含まない。
// 管理SPA(pages.dev)とWorkerはクロスサイトでcookieが直打ちアクセスに乗らないため、
// Worker同一オリジンのここでログインしてcookieをファーストパーティ化する入口
// （詳細は admin-login-page.js 冒頭のコメント参照）。
reservationRoutes.get('/admin-login', (c) => {
  c.header('Cache-Control', 'no-store, must-revalidate');
  return c.html(renderAdminLogin());
});

// ── 管理画面：予約一覧（スタッフ用） ──
// ⚠️ パスは必ず /api/ 配下に置くこと。ハーネスのauthMiddlewareは
// 「/api/ で始まらないパスは静的アセット扱いで認証スキップ」するため、
// /admin/reservations のような非APIパスに置くと会員の個人情報が認証なしで公開される。
// /api/admin/ 配下なら authMiddleware が自動適用され、スタッフのBearerキー
// またはログインセッションcookie（lh_admin_session）が必須になる。
// （/api/liff/ だけは公開許可リストなので、そこにも置かないこと）
// ブラウザで開くときは先に /api/auth/login でログインしてから。
reservationRoutes.get('/api/admin/reservations', async (c) => {
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const todayJst = nowJst.toISOString().split('T')[0];
  // 過去30日ぶんまで表示（それより古い履歴はD1に残っているが画面には出さない）
  const fromDate = new Date(nowJst.getTime() - 30 * 86400000).toISOString().split('T')[0];

  // capacity > 0 のフィルタは置かない。定員0の行（SQL運用の「お休み」等）が
  // 管理画面から完全に見えなくなり、UIから復旧・確認できなくなるため。
  // お客様向けフォームは is_open=1 で絞っているのでここで全件見えても影響しない
  const { results: sessions } = await c.env.DB.prepare(`
    SELECT s.*,
      COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) AS booked,
      COUNT(CASE WHEN r.status = 'cancelled' THEN 1 END) AS cancelled
    FROM sessions s
    LEFT JOIN reservations r ON r.session_id = s.id
    WHERE s.date >= ?
    GROUP BY s.id
    ORDER BY s.date
  `).bind(fromDate).all();

  const { results: people } = await c.env.DB.prepare(`
    SELECT r.session_id, r.display_name, r.category, r.trainer, r.morning_run,
           r.bento, r.tacos, r.message, r.created_at
    FROM reservations r JOIN sessions s ON s.id = r.session_id
    WHERE s.date >= ? AND r.status = 'confirmed'
    ORDER BY s.date, r.created_at
  `).bind(fromDate).all();

  // キャンセル者一覧（r.* で取得することで cancelled_at 列のmigration未適用でも落ちない）
  const { results: cancelledPeople } = await c.env.DB.prepare(`
    SELECT r.*
    FROM reservations r JOIN sessions s ON s.id = r.session_id
    WHERE s.date >= ? AND r.status = 'cancelled'
    ORDER BY s.date, r.created_at
  `).bind(fromDate).all();

  const { results: trials } = await c.env.DB.prepare(`
    SELECT id, display_name, trainer, preferred_date, preferred_time, alt_note, created_at
    FROM trial_requests WHERE status = 'pending' ORDER BY created_at
  `).all().catch(() => ({ results: [] })); // trial_requests未作成のDBでも落ちない

  const byId = new Map(sessions.map(s => [s.id, { ...s, extra_slots: EXTRA_SLOTS, reservations: [], cancelled_people: [] }]));
  for (const p of people) byId.get(p.session_id)?.reservations.push(p);
  for (const p of cancelledPeople) byId.get(p.session_id)?.cancelled_people.push(p);

  c.header('Cache-Control', 'no-store, must-revalidate');
  return c.html(renderAdminReservations({
    todayJst,
    sessions: [...byId.values()],
    trials,
  }));
});

// ── 管理: 体験リクエストの確定/不成立（スタッフ用・認証必須） ──
// /api/admin/ 配下なのでauthMiddlewareが自動適用される。cookie認証のPOSTは
// ミドルウェアが X-CSRF-Token と lh_csrf cookie の一致を検証する（ルート側の実装は不要）。
// DB記録のみで、顧客への自動送信はしない（連絡はスタッフ手動のまま）。
async function decideTrial(c, newStatus) {
  // authMiddlewareが c.set('staff', {id, name, role}) 済み。
  // 共有キー（環境変数API_KEY）運用中は id='env-owner' が入る（個別キー発行後に個人特定可能になる）
  const staff = c.get('staff');
  const trialId = c.req.param('id');
  const decidedAt = new Date().toISOString();
  const decidedBy = staff?.id || null;

  // d1_trials.cjs（ハーネス側リポジトリのopsスクリプト。本リポジトリには無い）と
  // 同じく AND status='pending' をUPDATE自体に入れて、
  // 二重押下・処理済みIDへの再操作をDBレベルで防ぐ（変化0行なら409）。
  // decided_at/decided_by 列のmigration未適用DBでは列なし版にフォールバック
  let res;
  try {
    res = await c.env.DB.prepare(`
      UPDATE trial_requests SET status = ?, decided_at = ?, decided_by = ?
      WHERE id = ? AND status = 'pending'
    `).bind(newStatus, decidedAt, decidedBy, trialId).run();
  } catch (e) {
    if (!e.message?.includes('no such column')) throw e;
    res = await c.env.DB.prepare(`
      UPDATE trial_requests SET status = ? WHERE id = ? AND status = 'pending'
    `).bind(newStatus, trialId).run();
  }

  if (!res.meta || res.meta.changes === 0) {
    const existing = await c.env.DB.prepare(
      `SELECT status FROM trial_requests WHERE id = ?`
    ).bind(trialId).first();
    if (!existing) return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'already_decided', status: existing.status }, 409);
  }

  return c.json({ ok: true, id: trialId, status: newStatus });
}

reservationRoutes.post('/api/admin/trials/:id/confirm', (c) => decideTrial(c, 'confirmed'));
reservationRoutes.post('/api/admin/trials/:id/decline', (c) => decideTrial(c, 'declined'));

// ── 管理: 開催日の登録・編集・削除（スタッフ用・認証必須） ──
// 月末の来月分登録をスマホで完結させるための機能。d1_sessions.cjs（ハーネス側リポジトリの
// opsスクリプト。本リポジトリには無い）の add/set/remove の規則に合わせた実装。CSRFはミドルウェアが自動検証。

// 管理操作ログ。テーブル未作成でも操作自体は成立させる（ログだけスキップ）
async function logAdminOp(c, action, targetId, detail) {
  try {
    await c.env.DB.prepare(`
      INSERT INTO admin_ops_log (id, staff_id, action, target_id, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), c.get('staff')?.id || null, action, targetId,
      JSON.stringify(detail).slice(0, 500), new Date().toISOString()
    ).run();
  } catch (e) {
    console.error('admin_ops_log insert failed:', e.message);
  }
}

// 'YYYY-MM-DD' → '8/2（日）'。不正な日付はnull
function toDisplayDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateStr) return null;
  const youbi = '日月火水木金土'[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${youbi}）`;
}

// bento: [{name, price}] の形だけを受け付けて bento_json 文字列にする。不正はnull（エラー）
function toBentoJson(bento) {
  if (bento == null || (Array.isArray(bento) && bento.length === 0)) return { ok: true, json: null };
  if (!Array.isArray(bento) || bento.length > 10) return { ok: false };
  const items = [];
  for (const b of bento) {
    const name = String(b?.name || '').trim().slice(0, 50);
    if (!name) return { ok: false };
    const price = b.price == null || b.price === '' ? null : Number(b.price);
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100000)) return { ok: false };
    items.push({ name, price });
  }
  return { ok: true, json: JSON.stringify(items) };
}

// 新規登録。idは日付と同じ（朝クラス用。TACOS等の特別枠はSQLで運用）
reservationRoutes.post('/api/admin/sessions', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_body' }, 400); }

  const date = String(body.date || '');
  const displayDate = toDisplayDate(date);
  const title = String(body.title || '').trim().slice(0, 100);
  if (!displayDate) return c.json({ error: 'invalid_date' }, 400);
  if (!title) return c.json({ error: 'title_required' }, 400);

  const capacity = body.capacity == null ? 10 : Number(body.capacity);
  // 定員は1以上。0はis_open(受付締切)と役割が重複し、誤入力すると扱いに困るため拒否
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 99) {
    return c.json({ error: 'invalid_capacity' }, 400);
  }
  const bento = toBentoJson(body.bento);
  if (!bento.ok) return c.json({ error: 'invalid_bento' }, 400);

  // INSERT OR IGNORE + 変化0行判定で、同時登録でも二重作成しない
  const inserted = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO sessions
      (id, date, display_date, title, food, trainers, morning_run, capacity, is_open, bento_json, has_tacos, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?)
  `).bind(
    date, date, displayDate, title,
    String(body.food || '').trim().slice(0, 200) || null,
    String(body.trainers || '').trim().slice(0, 100) || null,
    body.morning_run ? 1 : 0,
    capacity, bento.json,
    String(body.note || '').trim().slice(0, 300) || null
  ).run();

  if (!inserted.meta || inserted.meta.changes === 0) {
    return c.json({ error: 'session_exists', session_id: date }, 409);
  }

  await logAdminOp(c, 'session_create', date, { title, capacity, morning_run: !!body.morning_run });
  return c.json({ ok: true, id: date });
});

// 更新（締切/再開を含む）。日付＝IDは変更不可（変えたい場合は削除→新規登録）
reservationRoutes.post('/api/admin/sessions/:id', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_body' }, 400); }
  const sessionId = c.req.param('id');

  // 許可フィールドだけをSETに積む（ホワイトリスト方式）
  const sets = [];
  const binds = [];
  if (body.title !== undefined) {
    const title = String(body.title || '').trim().slice(0, 100);
    if (!title) return c.json({ error: 'title_required' }, 400);
    sets.push('title = ?'); binds.push(title);
  }
  if (body.trainers !== undefined) { sets.push('trainers = ?'); binds.push(String(body.trainers || '').trim().slice(0, 100) || null); }
  if (body.food !== undefined) { sets.push('food = ?'); binds.push(String(body.food || '').trim().slice(0, 200) || null); }
  if (body.note !== undefined) { sets.push('note = ?'); binds.push(String(body.note || '').trim().slice(0, 300) || null); }
  if (body.morning_run !== undefined) { sets.push('morning_run = ?'); binds.push(body.morning_run ? 1 : 0); }
  if (body.closed !== undefined) { sets.push('is_open = ?'); binds.push(body.closed ? 0 : 1); }
  if (body.capacity !== undefined) {
    const capacity = Number(body.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 99) return c.json({ error: 'invalid_capacity' }, 400);
    sets.push('capacity = ?'); binds.push(capacity);
  }
  if (body.bento !== undefined) {
    const bento = toBentoJson(body.bento);
    if (!bento.ok) return c.json({ error: 'invalid_bento' }, 400);
    sets.push('bento_json = ?'); binds.push(bento.json);
  }
  if (!sets.length) return c.json({ error: 'no_fields' }, 400);

  const updated = await c.env.DB.prepare(
    `UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...binds, sessionId).run();

  if (!updated.meta || updated.meta.changes === 0) {
    return c.json({ error: 'session_not_found' }, 404);
  }

  await logAdminOp(c, 'session_update', sessionId, body);
  return c.json({ ok: true, id: sessionId });
});

// 削除。予約（キャンセル済み含む履歴）が1件でもあれば拒否（d1_sessions.cjs removeと同じ規則）
reservationRoutes.post('/api/admin/sessions/:id/delete', async (c) => {
  const sessionId = c.req.param('id');

  // DELETE自体に「予約が0件のときだけ」の条件を入れ、確認と削除の間の割り込み予約でも安全にする
  const deleted = await c.env.DB.prepare(`
    DELETE FROM sessions
    WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.session_id = sessions.id)
  `).bind(sessionId).run();

  if (!deleted.meta || deleted.meta.changes === 0) {
    const exists = await c.env.DB.prepare(`SELECT id FROM sessions WHERE id = ?`).bind(sessionId).first();
    if (!exists) return c.json({ error: 'session_not_found' }, 404);
    return c.json({ error: 'has_reservations' }, 409);
  }

  await logAdminOp(c, 'session_delete', sessionId, {});
  return c.json({ ok: true, id: sessionId });
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

  // API直叩きで同一IDが重複していても1回だけ処理する（UI経由ではSetなので起きない）
  for (const sessionId of [...new Set(session_ids)]) {
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
    // 回数券は朝クラス専用。特別枠（TACOS Party等、idが日付と異なるセッション）は
    // 料金体系が違うため、UIをすり抜けてもサーバー側で拒否する
    if (category === '回数券' && session.id !== session.date) {
      failed.push({ session_id: sessionId, error: 'not_kaisuken' });
      continue;
    }
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
      // cancelled_at はクリアする（migration未適用のDBでは列なし版にフォールバック）
      const reactivateSql = (withCancelledAt) => `
        UPDATE reservations
        SET status = 'confirmed', ${withCancelledAt ? 'cancelled_at = NULL,' : ''}
            display_name = ?, category = ?, morning_run = ?,
            bento = ?, trainer = ?, message = ?, ref = ?, created_at = ?
        WHERE id = ? AND status = 'cancelled'
          AND (SELECT COUNT(*) FROM reservations r2
               WHERE r2.session_id = ? AND r2.status = 'confirmed') <
              (SELECT capacity + ${EXTRA_SLOTS} FROM sessions WHERE id = ?)
      `;
      const reactivateBinds = [
        displayName, category, morning_run || null,
        Array.isArray(bento) && bento.length ? bento.join(',') : null,
        trainer || null, message || null, ref || null, createdAt,
        existing.id, sessionId, sessionId,
      ];
      let reactivated;
      try {
        reactivated = await c.env.DB.prepare(reactivateSql(true)).bind(...reactivateBinds).run();
      } catch (e) {
        if (!e.message?.includes('no such column')) throw e;
        reactivated = await c.env.DB.prepare(reactivateSql(false)).bind(...reactivateBinds).run();
      }

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

  // 1件も成立しなかった場合のみエラー扱い（error/session_id は旧クライアント互換のため残す）。
  // トップレベルのerrorとHTTPステータスは必ず同じ要素から導出する
  // （failed全体からstatusを決めると、error='session_not_found'なのに409のような不整合が起きる）
  if (reservations.length === 0 && failed.length > 0) {
    const primary = failed.find(f => f.error === 'full') || failed[0];
    const status = primary.error === 'session_not_found' ? 404 : 409;
    return c.json({ error: primary.error, session_id: primary.session_id, failed }, status);
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

  // UPDATE自体にも status='pending' ガードを入れる。SELECTの直後にスタッフが
  // 確定/不成立にした場合、無条件UPDATEだとその判定を黙って cancelled で上書きしてしまう
  const updated = await c.env.DB.prepare(
    `UPDATE trial_requests SET status = 'cancelled' WHERE id = ? AND status = 'pending'`
  ).bind(reqId).run();
  if (!updated.meta || updated.meta.changes === 0) {
    // その一瞬でスタッフが確定/不成立にした（顧客画面からは既に消えているはずの稀ケース）
    return c.json({ error: 'already_decided' }, 409);
  }

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

  // キャンセル日時も記録する（管理画面の「名前（7/14 21:03）」表示用）。
  // cancelled_at列のmigration未適用でもキャンセル自体は成立させる。
  // UPDATEに status='confirmed' ガードを入れ、SELECT後に状態が変わっていた場合
  // （二重タップ・再予約との競合）に古いリクエストが状態を上書きするのを防ぐ
  let cancelUpdated;
  try {
    cancelUpdated = await c.env.DB.prepare(
      `UPDATE reservations SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'confirmed'`
    ).bind(new Date().toISOString(), reservationId).run();
  } catch (e) {
    if (!e.message?.includes('no such column')) throw e;
    cancelUpdated = await c.env.DB.prepare(
      `UPDATE reservations SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'`
    ).bind(reservationId).run();
  }
  if (!cancelUpdated.meta || cancelUpdated.meta.changes === 0) {
    // 二重タップ等で既にcancelled済みなら冪等に成功扱い（通知は重複させない）
    const now = await c.env.DB.prepare(
      `SELECT status FROM reservations WHERE id = ?`
    ).bind(reservationId).first();
    if (now?.status === 'cancelled') return c.json({ ok: true });
    return c.json({ error: 'conflict' }, 409);
  }

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

  // s.* で取得することで、time_label列のmigration未適用DBでもSQLエラーにならない。
  // session_id/session_dateはs.*の後に明示エイリアスで付け直す
  // （素のs.id/s.dateのままだと、行オブジェクトのidが「セッションのid」であることが
  //   コード上読み取れず、将来の列追加で静かに壊れるため）
  const { results } = await env.DB.prepare(`
    SELECT r.line_user_id, s.*, s.id AS session_id, s.date AS session_date
    FROM reservations r
    JOIN sessions s ON s.id = r.session_id
    WHERE s.date = ? AND r.status = 'confirmed'
  `).bind(tomorrowStr).all();

  for (const row of results) {
    // 特別枠（例: TACOS Party）は朝クラスの定型文（AM7:30・朝RUN）を使わない
    const isSpecial = row.session_id !== row.session_date;
    const lines = isSpecial
      ? [
          `🌅 明日 ${row.display_date}「${row.title}」${row.time_label ? `（${row.time_label}）` : ''}、HMCでお待ちしています！`,
          'お気をつけてお越しください。',
        ]
      : [
          `🌅 明日 ${row.display_date} AM7:30、HMCでお待ちしています！`,
          row.morning_run ? '朝RUNは6:30〜。お気をつけてお越しください。' : 'お気をつけてお越しください。',
        ];
    await pushToUser(row.line_user_id, [{ type: 'text', text: lines.join('\n') }], env);
  }

  // ── 月末：来月の開催日案内＋回数券の再購入リマインド ──
  // 毎日呼ばれるが、JSTで「今日が月の最終日」のときだけ送信する
  const nowJst2 = new Date(Date.now() + 9 * 3600 * 1000);
  const tomorrowJst = new Date(nowJst2);
  tomorrowJst.setUTCDate(tomorrowJst.getUTCDate() + 1);
  if (tomorrowJst.toISOString().slice(8, 10) === '01') {
    const thisMonth = nowJst2.toISOString().slice(0, 7);
    const nextMonth = tomorrowJst.toISOString().slice(0, 7);
    const next = await env.DB.prepare(
      `SELECT id, date, display_date, title FROM sessions WHERE is_open = 1 AND date LIKE ? ORDER BY date`
    ).bind(nextMonth + '%').all();
    if (next.results?.length) {
      const users = await env.DB.prepare(
        `SELECT DISTINCT r.line_user_id FROM reservations r
         JOIN sessions s ON s.id = r.session_id
         WHERE r.status = 'confirmed' AND s.date LIKE ?`
      ).bind(thisMonth + '%').all();
      // 回数券の回数・金額は朝クラス（id = date）だけで数える。
      // 特別枠（TACOS Party等）は回数券の対象外のため金額計算に含めない
      const n = next.results.filter(s => s.id === s.date).length;
      const text = [
        '🗓 来月のHMC開催日が決まりました！',
        ...next.results.map(s => `・${s.display_date} ${s.title}`),
        '',
        ...(n > 0 ? [
          `回数券（¥2,000×${n}回=¥${(2000 * n).toLocaleString()}）は月まとめ買いがお得です。`,
          'お支払いは初回参加日に現金でお願いします（繰り越しはできません）。',
          '',
        ] : []),
        'ご予約はこちら👇',
        'https://liff.line.me/2010528512-LJhoz7MP',
      ].join('\n');
      for (const u of users.results || []) {
        await pushToUser(u.line_user_id, [{ type: 'text', text }], env);
      }
    }
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
    ...(reservation.category === '回数券' ? ['回数券のお支払い：初回参加日に現金でまとめてお願いします。'] : []),
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
