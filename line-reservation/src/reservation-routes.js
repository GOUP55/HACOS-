// HACOS × HMC 予約ルート（Hono）
// 既存ハーネスの src/index.js に追加する:
//   import { reservationRoutes, sendReminders, sendFinalCall } from './reservation-routes.js';
//   app.route('/', reservationRoutes);
// wrangler.toml に追加:
//   [[d1_databases]]
//   binding = "DB"
//   database_name = "<YOUR_D1_NAME>"
//   database_id = "<YOUR_D1_ID>"
//   [triggers]
//   crons = ["0 9 * * *", "0 12 * * *"]   // 18:00 JST と 21:00 JST (UTC+9)
//   scheduled() の分岐:
//     "0 9 * * *"  -> sendReminders(env)  … 前日18時のご連絡
//     "0 12 * * *" -> sendFinalCall(env)  … 前日21時の確定連絡

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
  // booked は「7:30の朝活クラスに出る人数」＝定員10名に対する数。
  // 「朝RUNのみ」は席を使わないので除外する（含めると 11/10 のような表示になる）。
  // 朝RUNのみの方は下の people に含まれ、カードには🏃バッジ付きで並ぶ
  const { results: sessions } = await c.env.DB.prepare(`
    SELECT s.*,
      COUNT(CASE WHEN r.status = 'confirmed'
            AND r.category != '朝RUNのみ' THEN 1 END) AS booked,
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

  // kind列は 2026-08-15-trial-kind.sql、updated_at/updated_by列は 2026-08-29-trial-reschedule.sql で
  // 追加する。migration未適用のDBでも落ちないよう、キャンセル者一覧と同じく * で取る（列の増減に強い）
  const { results: trials } = await c.env.DB.prepare(`
    SELECT * FROM trial_requests WHERE status = 'pending' ORDER BY created_at
  `).all().catch(() => ({ results: [] }));

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

// ── 管理: 体験リクエストの希望日変更（スタッフ用・認証必須） ──
// 「第1希望日が過ぎてしまった」「LINEのやりとりで別日に決まった」ときに、確定/不成立の前に
// 希望日と時間帯だけを書き換える。第2希望・ご要望（alt_note）はお客様が書いた記録なので変更しない。
// 確定/不成立と同じく、お客様への連絡は自動送信しない（スタッフが別途LINEで連絡する運用）。
// 変更するとLIFFの「予約中」表示も新しい日付に変わるため、連絡なしで直すと混乱する点に注意。
reservationRoutes.post('/api/admin/trials/:id', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_body' }, 400); }
  const trialId = c.req.param('id');

  // toDisplayDate は下の「開催日の管理」節で定義（関数宣言なので巻き上げられる）。
  // ここでは 'YYYY-MM-DD' として実在する日付かの判定にだけ使う（2026-02-31 等を弾く）
  const preferredDate = String(body.preferred_date || '');
  if (!toDisplayDate(preferredDate)) return c.json({ error: 'invalid_date' }, 400);
  const preferredTime = String(body.preferred_time || '').trim().slice(0, 50);
  if (!preferredTime) return c.json({ error: 'time_required' }, 400);

  // 変更前の値は操作ログ用（「誰がいつ何日から何日へ動かしたか」を残す）
  const before = await c.env.DB.prepare(
    `SELECT preferred_date, preferred_time, status FROM trial_requests WHERE id = ?`
  ).bind(trialId).first();
  if (!before) return c.json({ error: 'not_found' }, 404);
  if (before.status !== 'pending') return c.json({ error: 'already_decided', status: before.status }, 409);

  // updated_at / updated_by 列は 2026-08-29-trial-reschedule.sql で追加する。
  // 未適用の本番でも日程変更自体は成立させる（記録だけ落ちる）
  const updatedAt = new Date().toISOString();
  const updatedBy = c.get('staff')?.id || null;
  let res;
  try {
    res = await c.env.DB.prepare(`
      UPDATE trial_requests SET preferred_date = ?, preferred_time = ?, updated_at = ?, updated_by = ?
      WHERE id = ? AND status = 'pending'
    `).bind(preferredDate, preferredTime, updatedAt, updatedBy, trialId).run();
  } catch (e) {
    if (!e.message?.includes('no such column')) throw e;
    res = await c.env.DB.prepare(`
      UPDATE trial_requests SET preferred_date = ?, preferred_time = ?
      WHERE id = ? AND status = 'pending'
    `).bind(preferredDate, preferredTime, trialId).run();
  }

  // SELECTとUPDATEの間にスタッフが確定/不成立にした場合はここで止まる
  if (!res.meta || res.meta.changes === 0) {
    const existing = await c.env.DB.prepare(
      `SELECT status FROM trial_requests WHERE id = ?`
    ).bind(trialId).first();
    if (!existing) return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'already_decided', status: existing.status }, 409);
  }

  await logAdminOp(c, 'trial_reschedule', trialId, {
    from: { date: before.preferred_date, time: before.preferred_time },
    to: { date: preferredDate, time: preferredTime },
  });
  return c.json({ ok: true, id: trialId, preferred_date: preferredDate, preferred_time: preferredTime });
});

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
  // ただし特別枠（id ≠ date。瞑想イベント等、夕方開催がある）は正午カットオフの対象外とし、
  // 開催日いっぱいまで表示する（正午で消えると当日昼〜開催前の予約導線が塞がるため）。
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const todayJst = nowJst.toISOString().split('T')[0];
  let cutoffDate = todayJst;
  if (nowJst.getUTCHours() >= 12) {
    const tomorrow = new Date(nowJst);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    cutoffDate = tomorrow.toISOString().split('T')[0];
  }

  // 「朝RUNのみ」（6:30〜・参加費¥0）は7:30の朝活クラスに出ないため、定員10名を消費しない。
  // お客様に見える残席の計算からも必ず除外する（除外を外すと、朝RUNだけの申込みで
  // クラスの残席が減って見える）。
  const { results } = await c.env.DB.prepare(`
    SELECT s.*,
      COUNT(CASE WHEN r.status = 'confirmed'
            AND r.category != '朝RUNのみ' THEN 1 END) AS booked
    FROM sessions s
    LEFT JOIN reservations r ON r.session_id = s.id
    WHERE s.is_open = 1 AND (s.date >= ?1 OR (s.date = ?2 AND s.id <> s.date))
    GROUP BY s.id
    ORDER BY s.date
  `).bind(cutoffDate, todayJst).all();

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

  // 「朝RUNのみ」はクラスの席を取らない区分。満席でも受け付ける（＝定員ガードを通さない）。
  // 1 なら席を取る＝定員ガードあり、0 なら席を取らない＝ガードなし。
  const takesSeat = category === '朝RUNのみ' ? 0 : 1;

  const reservations = [];
  // 満席などで予約できなかった日程。途中でreturnせず最後まで処理して、
  // 「一部は予約成立・一部は満席」を正しくクライアントへ返す
  // （以前は最初の満席で即409を返していたため、先に成立した予約が
  //   ユーザーに「全部失敗した」ように見えるバグがあった）。
  const failed = [];

  // API直叩きで同一IDが重複していても1回だけ処理する（UI経由ではSetなので起きない）
  for (const sessionId of [...new Set(session_ids)]) {
    // 2. 残枠チェック（定員＋追加枠を超えたら満席）
    // 「朝RUNのみ」（6:30〜・参加費¥0）は7:30の朝活クラスに出ないため、
    // クラスの定員10名を消費しない。残枠の計算からも除外する
    const session = await c.env.DB.prepare(`
      SELECT s.*,
        (s.capacity + ${EXTRA_SLOTS} - COUNT(CASE WHEN r.status = 'confirmed'
              AND r.category != '朝RUNのみ' THEN 1 END)) AS remaining
      FROM sessions s
      LEFT JOIN reservations r ON r.session_id = s.id
      WHERE s.id = ? AND s.is_open = 1
      GROUP BY s.id
    `).bind(sessionId).first();

    if (!session) { failed.push({ session_id: sessionId, error: 'session_not_found' }); continue; }
    // 「朝RUNのみ」は朝RUNを開催する日にしか使えない。定員を消費しない区分なので、
    // UIをすり抜けて別の日に付けられると席の計算が狂う
    if (category === '朝RUNのみ' && !session.morning_run) {
      failed.push({ session_id: sessionId, error: 'no_morning_run' });
      continue;
    }
    // 朝RUNのみはクラスの席を取らないため、満席でも受け付ける
    if (category !== '朝RUNのみ' && session.remaining <= 0) {
      failed.push({ session_id: sessionId, error: 'full' });
      continue;
    }

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
                WHERE session_id = ? AND status = 'confirmed' AND category != '朝RUNのみ')) AS remaining,
          (capacity - (SELECT COUNT(*) FROM reservations
                WHERE session_id = ? AND status = 'confirmed' AND category != '朝RUNのみ')) AS base_remaining
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
          AND (? = 0 OR
               (SELECT COUNT(*) FROM reservations r
                WHERE r.session_id = s.id AND r.status = 'confirmed'
                  AND r.category != '朝RUNのみ') < s.capacity + ${EXTRA_SLOTS})
      `).bind(
        reservationId, userId, displayName, category,
        morning_run || null,
        Array.isArray(bento) && bento.length ? bento.join(',') : null,
        null, // tacos: TACOS Partyは別枠セッション化したため今後は使用しない
        trainer || null,
        message || null,
        ref || null,
        createdAt,
        sessionId,
        takesSeat
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
          AND (? = 0 OR
               (SELECT COUNT(*) FROM reservations r2
                WHERE r2.session_id = ? AND r2.status = 'confirmed'
                  AND r2.category != '朝RUNのみ') <
               (SELECT capacity + ${EXTRA_SLOTS} FROM sessions WHERE id = ?))
      `;
      const reactivateBinds = [
        displayName, category, morning_run || null,
        Array.isArray(bento) && bento.length ? bento.join(',') : null,
        trainer || null, message || null, ref || null, createdAt,
        existing.id, takesSeat, sessionId, sessionId,
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

  const { kind, trainer, preferred_date, preferred_time, alt_note, ref } = await c.req.json();
  if (!trainer || !preferred_date || !preferred_time) {
    return c.json({ error: 'missing_fields' }, 400);
  }
  // 種別は2つだけ。知らない値が来たら体験パーソナル扱いにする
  const reqKind = kind === 'journey_trial7' ? 'journey_trial7' : 'trial_personal';

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  // kind列は 2026-08-15-trial-kind.sql で追加する。
  // migration未適用の本番でも申込が落ちないよう、失敗したらkind無しで入れ直す
  try {
    await c.env.DB.prepare(`
      INSERT INTO trial_requests
        (id, line_user_id, display_name, trainer, preferred_date, preferred_time, alt_note, ref, status, created_at, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      id, userId, displayName, trainer, preferred_date, preferred_time,
      alt_note || null, ref || null, createdAt, reqKind
    ).run();
  } catch {
    await c.env.DB.prepare(`
      INSERT INTO trial_requests
        (id, line_user_id, display_name, trainer, preferred_date, preferred_time, alt_note, ref, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      id, userId, displayName, trainer, preferred_date, preferred_time,
      alt_note || null, ref || null, createdAt
    ).run();
  }

  c.executionCtx.waitUntil(
    sendTrialNotifications(userId, displayName, { kind: reqKind, trainer, preferred_date, preferred_time, alt_note }, c.env)
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

// 最少催行人数（朝活クラス）。参加者が3名に満たない日は中止する（＝2名以下で中止）。
// 2026-09-04 オーナー確定。お弁当とトレーナー謝礼の兼ね合いで4名も検討したが3名に決めた。
// 「朝RUNのみ」（6:30〜・¥0）は7:30のクラスに出ないため、この人数には数えない。
// 中止のときは朝RUNもHACOSの主催としてはお休みになるため、連絡はその日の予約者全員に送る
// （走ること自体は止めない。集まって走るのは自由・2026-09-04 オーナー決定）。
// お弁当を注文している方がいても、人数が足りなければ中止する（お弁当は中止を止める理由にしない。
// 2026-09-04 オーナー決定。中止時のお弁当はHACOSが買い取り、ご注文の方へお渡しする）。
const MIN_ATTENDANCE = 3;

// HACOSのオープンチャット「HMC」。参加者どうしが朝RUNのお誘い・試食会・ゆる募で
// 自由に声をかけあう場所。オープンチャットなので、電話番号やLINEのアカウントは
// お互いに見えない（初めての方でも入りやすい形にするため、通常のグループLINEではなくこちら）
const OPENCHAT_URL = 'https://line.me/ti/g2/hBcvkajEaSHvsVoqGX3SZJZZBbL7ZJsJwePWug?utm_source=invitation&utm_medium=link_copy&utm_campaign=default';
const OPENCHAT_LINES = [
  '',
  '💬 HACOSのみんなの部屋（オープンチャット「HMC」）',
  '朝RUNのお誘いや試食会など、参加される方どうしで声をかけあう場所です。',
  OPENCHAT_URL,
];

// ── Cron: 前日18時のご連絡（リマインド／人数が足りない日は「未定」のお知らせ）──
// wrangler.toml: crons = ["0 9 * * *"]  (JST 18:00)
// scheduled(event, env, ctx) { ctx.waitUntil(sendReminders(env)); }
//
// ご連絡は2段階（2026-09-04 オーナー決定）。
//   18:00 … 4名に満たない日は「まだ未定・今夜中にご予約を」とお伝えする
//   21:00 … sendFinalCall() でもう一度数え、開催か中止かを確定してご連絡する
// 18時に中止を確定させてしまうと、その日の夜に4人目が予約したくても受付が閉じており、
// 開催できたはずの日を落とすことになるため、確定を21時まで待つ。
export async function sendReminders(env) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // 予約が0件の日も中止対象にしたいので、先にセッションを取ってから予約をぶら下げる。
  // （予約とJOINして回すだけだと、0件の日はループに現れず受付が開いたまま残る）
  const { results: sessionsTomorrow } = await env.DB.prepare(
    `SELECT * FROM sessions WHERE date = ? AND is_open = 1`
  ).bind(tomorrowStr).all();

  // s.* で取得することで、time_label列のmigration未適用DBでもSQLエラーにならない。
  // session_id/session_dateはs.*の後に明示エイリアスで付け直す
  // （素のs.id/s.dateのままだと、行オブジェクトのidが「セッションのid」であることが
  //   コード上読み取れず、将来の列追加で静かに壊れるため）
  const { results } = await env.DB.prepare(`
    SELECT r.id AS reservation_id, r.line_user_id, r.display_name, r.category, r.bento,
           s.*, s.id AS session_id, s.date AS session_date
    FROM reservations r
    JOIN sessions s ON s.id = r.session_id
    WHERE s.date = ? AND r.status = 'confirmed'
  `).bind(tomorrowStr).all();

  const bySession = new Map();
  for (const row of results) {
    if (!bySession.has(row.session_id)) bySession.set(row.session_id, []);
    bySession.get(row.session_id).push(row);
  }

  for (const session of sessionsTomorrow || []) {
    const rows = bySession.get(session.id) || [];

    // 特別枠（TACOS Party・瞑想など）は朝活クラスとは催行の基準が違う。
    // 最少催行の判定にはかけず、これまでどおりリマインドだけ送る
    const isSpecial = session.id !== session.date;

    if (!isSpecial) {
      // 7:30のクラスに出る人数。「朝RUNのみ」は数えない
      const classCount = rows.filter(r => r.category !== '朝RUNのみ').length;
      if (classCount < MIN_ATTENDANCE) {
        // ここでは中止を確定させない。まだ今夜のご予約で4名に届く可能性があるため、
        // 「未定です・今夜中にご予約ください」とだけお伝えして、21時に確定する
        await sendPendingNotice(session, rows, classCount, env);
        continue; // 「未定」とお伝えした日に「お待ちしています」を送ると矛盾する
      }
    }

    for (const row of rows) {
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
  }

  // ── 月末：来月の開催日案内 ──
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
      // 朝クラス（id = date）の開催回数。特別枠（TACOS Party等）は数えない
      const n = next.results.filter(s => s.id === s.date).length;
      const text = [
        '🗓 来月のHMC開催日が決まりました！',
        ...next.results.map(s => `・${s.display_date} ${s.title}`),
        '',
        ...(n >= 3 ? [
          `来月は朝活クラスが${n}回あります。`,
          `毎週来られる方は、HMC会員（月額¥6,000・受け放題）がお得です（都度¥3,000×${n}回＝¥${(3000 * n).toLocaleString()}）。`,
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

// 前日18時：まだ4名に届いていない日のご連絡。
// 中止は確定させず、今夜のご予約で届く可能性を残す。
async function sendPendingNotice(session, rows, classCount, env) {
  // 21時の「開催します」は、ここで未定とお伝えした日にだけ送る。
  // 印がないと、18時の時点で4名以上あった日にも21時に二重で送ってしまう。
  // pending_notified_at列は 2026-09-04-pending-notice.sql で追加する。
  // 未適用でも中止の判定は動くよう、列が無いときは黙って先へ進める
  try {
    await env.DB.prepare(`UPDATE sessions SET pending_notified_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), session.id).run();
  } catch (e) {
    if (!e.message?.includes('no such column')) throw e;
  }

  const userText = [
    `⏳ 明日 ${session.display_date} の朝活クラスについてのご連絡です。`,
    '',
    `いまのところ、ご参加は${classCount}名です。`,
    `${MIN_ATTENDANCE}名に満たない場合はお休みとさせていただきます。`,
    '',
    'ご参加を迷っている方は、今夜のうちにご予約ください。',
    '開催するかどうかは、**今夜21時**にあらためてご連絡します。',
  ].join('\n').replace(/\*\*/g, '');

  for (const row of rows) {
    await pushToUser(row.line_user_id, [{ type: 'text', text: userText }], env);
  }

  const staffText = [
    '⏳ 最少催行に未達【21時に確定します】',
    `${session.display_date} ${session.title}`,
    `クラス ${classCount}名（最少催行${MIN_ATTENDANCE}名）`,
    rows.length ? `予約${rows.length}件の方へ「未定」のご連絡を送りました。` : '予約はまだ0件です。',
  ].join('\n');
  const staffIds = (env.STAFF_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const staffId of staffIds) {
    await pushToUser(staffId, [{ type: 'text', text: staffText }], env);
  }
}

// ── Cron: 前日21時の確定連絡 ──
// wrangler.toml: crons に "0 12 * * *" を追加（JST 21:00）
// scheduled(event, env, ctx) の cron 分岐から ctx.waitUntil(sendFinalCall(env)) を呼ぶ
//
// 18時に「未定」とお伝えした日を、ここで開催か中止かに決める。
// 18時に4名以上あってその後キャンセルで割った日も、ここで拾って中止にする。
export async function sendFinalCall(env) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const { results: sessionsTomorrow } = await env.DB.prepare(
    `SELECT * FROM sessions WHERE date = ? AND is_open = 1`
  ).bind(tomorrowStr).all();

  const { results } = await env.DB.prepare(`
    SELECT r.id AS reservation_id, r.line_user_id, r.display_name, r.category, r.bento,
           s.*, s.id AS session_id, s.date AS session_date
    FROM reservations r
    JOIN sessions s ON s.id = r.session_id
    WHERE s.date = ? AND r.status = 'confirmed'
  `).bind(tomorrowStr).all();

  const bySession = new Map();
  for (const row of results) {
    if (!bySession.has(row.session_id)) bySession.set(row.session_id, []);
    bySession.get(row.session_id).push(row);
  }

  for (const session of sessionsTomorrow || []) {
    // 特別枠（TACOS・瞑想など）は最少催行の対象外
    if (session.id !== session.date) continue;

    const rows = bySession.get(session.id) || [];
    const classCount = rows.filter(r => r.category !== '朝RUNのみ').length;

    if (classCount < MIN_ATTENDANCE) {
      await cancelSessionForLowAttendance(session, rows, classCount, env);
      continue;
    }

    // 18時に「未定」とお伝えした日だけ、開催のご連絡をする。
    // 列が無い（migration未適用）ときは送らない。二重送信になるより、
    // 送らないほうが害が小さいため
    const notifiedAt = session.pending_notified_at;
    if (!notifiedAt) continue;

    await env.DB.prepare(`UPDATE sessions SET pending_notified_at = NULL WHERE id = ?`)
      .bind(session.id).run();

    const userText = [
      `✅ 明日 ${session.display_date} の朝活クラスは、予定どおり開催します！`,
      '',
      `ご参加は${classCount}名です。AM7:30、HMCでお待ちしています。`,
      ...(session.morning_run ? ['朝RUNは6:30〜です。'] : []),
      '',
      '動きやすい服装でお越しください🌅',
      ...OPENCHAT_LINES,
    ].join('\n');
    for (const row of rows) {
      await pushToUser(row.line_user_id, [{ type: 'text', text: userText }], env);
    }

    const staffIds = (env.STAFF_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const staffText = [
      '✅ 開催確定【21時の判定】',
      `${session.display_date} ${session.title}`,
      `クラス ${classCount}名`,
    ].join('\n');
    for (const staffId of staffIds) {
      await pushToUser(staffId, [{ type: 'text', text: staffText }], env);
    }
  }
}

// 最少催行に届かなかった日を中止する。
// DBを先に確定させてから通知する（通知が失敗しても中止そのものは成立させる）。
async function cancelSessionForLowAttendance(session, rows, classCount, env) {
  const runOnlyCount = rows.filter(r => r.category === '朝RUNのみ').length;

  // その日の受付を閉じる。閉じないと、この連絡のあとに予約が入って
  // 「中止と伝えた日に予約できてしまう」状態になる
  await env.DB.prepare(`UPDATE sessions SET is_open = 0 WHERE id = ?`).bind(session.id).run();

  // 予約をまとめてキャンセルにする。
  // cancelled_at列のmigration未適用DBでも中止は成立させる（キャンセル導線と同じ2段構え）
  const cancelledAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      `UPDATE reservations SET status = 'cancelled', cancelled_at = ?
       WHERE session_id = ? AND status = 'confirmed'`
    ).bind(cancelledAt, session.id).run();
  } catch (e) {
    if (!e.message?.includes('no such column')) throw e;
    await env.DB.prepare(
      `UPDATE reservations SET status = 'cancelled'
       WHERE session_id = ? AND status = 'confirmed'`
    ).bind(session.id).run();
  }

  // 予約者へのご連絡。「朝RUNのみ」の方にも送る（朝RUNもあわせてお休みになるため）。
  // お弁当をご注文の方には、お渡しできる旨を添える（中止でもHACOSが買い取ってお渡しする。
  // 2026-09-04 オーナー決定）。注文の有無で文面が変わるので、お一人ずつ組み立てる
  const baseLines = [
    `😢 明日 ${session.display_date} の朝活クラスは、お休みとさせていただきます。`,
    '',
    `ご参加予定の方が${MIN_ATTENDANCE}名に満たなかったためです。`,
    ...(session.morning_run
      ? ['', '朝RUN（6:30〜）は、スタッフがつかないためHACOSの主催としてはお休みです。',
         '集まって走っていただくのは大丈夫ですので、ご参加の方どうしでお声かけください。']
      : []),
  ];

  for (const row of rows) {
    const lines = [...baseLines];
    if (row.bento) {
      lines.push('', 'ご注文のお弁当はご用意しています。HACOSでお受け取りいただけます。',
        'お弁当代は通常どおりのお支払いです。');
    }
    lines.push('', '前日のご連絡になり、申し訳ありません。', 'またのご参加をお待ちしています🌅');
    await pushToUser(row.line_user_id, [{ type: 'text', text: lines.join('\n') }], env);
  }

  const staffText = [
    '⚠️ 中止【最少催行に未達】',
    `${session.display_date} ${session.title}`,
    `クラス ${classCount}名（最少催行${MIN_ATTENDANCE}名）${runOnlyCount ? ` ／ 朝RUNのみ ${runOnlyCount}名` : ''}`,
    `予約${rows.length}件をキャンセルにし、受付を閉じました。`,
    ...(rows.filter(r => r.bento).length
      ? [`🍱 お弁当 ${rows.filter(r => r.bento).length}件は買い取り。HACOSでお渡しします`]
      : []),
    ...(rows.length ? ['', '▼ ご連絡した方', ...rows.map(r => `・${r.display_name || '(名前なし)'}（${r.category}）`)] : []),
  ].join('\n');

  const staffIds = (env.STAFF_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const staffId of staffIds) {
    await pushToUser(staffId, [{ type: 'text', text: staffText }], env);
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
    ...(reservation.category === '朝RUNのみ' ? ['朝RUN（6:30〜）のみのご参加です。参加費はかかりません。'] : []),
    ...(['HMC会員', 'セミパ会員'].includes(reservation.category) ? ['月額プランにご加入中のため、当日のお支払いはありません。'] : []),
    ...(reservation.category === '瞑想' ? ['※写経用紙を人数分お取り寄せするため、開催前日以降のキャンセルは用紙代¥1,000をいただきます。'] : []),
    ...(reservation.trainer ? [`担当：${reservation.trainer}`] : []),
    '',
    ...(isSpecial
      ? ['当日のご来場をお待ちしています🌅']
      : ['動きやすい服装でお越しください。', '日曜の朝、お待ちしています🌅']),
    '変更・キャンセルは、予約フォームを開くと画面上部の「あなたの予約」からいつでも行えます。',
    ...OPENCHAT_LINES,
  ].join('\n');

  await pushToUser(userId, [{ type: 'text', text: userText }], env);

  // スタッフ通知
  const staffText = [
    reservation.category === '朝RUNのみ'
      ? '🏃 新規予約【朝RUNのみ・¥0】'
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
    reservation.category === '朝RUNのみ' ? '❌ 予約キャンセル【🏃朝RUNのみ】' : '❌ 予約キャンセル',
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
  const isJourney7 = t.kind === 'journey_trial7';

  const userText = [
    isJourney7
      ? '🌟 フィットネスジャーニー 7日間お試しのリクエストを受け付けました！'
      : '🌟 体験パーソナルのリクエストを受け付けました！',
    '',
    'まだ予約は確定していません。担当が空き状況を確認し、日時確定のご連絡をLINEでお送りします。少々お待ちください🙏',
    '',
    '▼ ご希望内容',
    ...(isJourney7 ? ['内容：セミパーソナル1回＋グループパーソナル1回＋日曜の朝活1回（¥9,000）'] : []),
    `担当：${t.trainer}`,
    `第1希望：${when}`,
    ...(t.alt_note ? [`ご要望：${t.alt_note}`] : []),
    ...(isJourney7
      ? ['', 'そのまま2ヶ月のフィットネスジャーニーへお進みの場合、この¥9,000は参加費に充当します。']
      : []),
  ].join('\n');
  await pushToUser(userId, [{ type: 'text', text: userText }], env);

  const staffText = [
    isJourney7
      ? '🚩 ジャーニー7日間お試し【リクエスト・要日時確定】'
      : '🌟 体験パーソナル【リクエスト・要日時確定】',
    ...(isJourney7 ? ['¥9,000／セミパ1＋グルパー1＋朝活1。2ヶ月へ進む場合は参加費に充当'] : []),
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
