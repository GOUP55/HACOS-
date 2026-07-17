// HACOS × HMC 予約管理画面のHTML生成（スタッフ用・純粋関数）
// reservation-routes.js の GET /api/admin/reservations から呼ばれる
// （認証必須。非APIパスに配線しないこと。理由はreservation-routes.js側のコメント参照）。
// 依存なし（テストしやすいようDB・Honoに触らない）。

// LINEの表示名・メッセージ等ユーザー入力は必ずこれを通す（XSS対策）
function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// ISO日時 → JSTの「7/6 21:34」形式
function fmtJst(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + 9 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function categoryBadge(category) {
  const map = {
    '回数券': ['🎫', '#7b1fa2'],
    '体験': ['🌱', '#00796b'],
    'TACOS': ['🌮', '#e65100'],
    '会員': ['✅', '#2e7d32'],
    'ビジター': ['👤', '#1565c0'],
    '相談': ['💬', '#616161'],
  };
  const [icon, color] = map[category] || ['・', '#616161'];
  return `<span class="cat" style="color:${color};border-color:${color}44;">${icon} ${esc(category)}</span>`;
}

// 朝RUNの回答値。LIFFは 'join'/'skip'/'decide' を保存する
// （旧データに日本語表記が残っている可能性があるため両方を受ける）
const RUN_JOIN = ['join', '参加したい'];
const RUN_DECIDE = ['decide', '当日決める'];

// bento列（「セッションID:メニュー名」のカンマ結合）から、指定セッション分の
// メニュー名だけを取り出す。集計行と個人行の両方で使う共用パーサ。
// 複数日程の同時予約では全予約行に同じ文字列が入るため、必ずセッションで絞る。
// 想定外の形式は握りつぶさず「形式不明(...)」ラベルにして見えるようにする。
// 既知の限界: コロンなしのエントリはどの日程か特定できないため、複数日程
// 同時予約の場合は各日程のカードに重複計上される（通常のLIFF経由では発生しない。
// ラベルで「形式不明」と出るので、見つけたらDBのbento列を直接確認すること）
function bentoItemsFor(sessionId, bentoStr) {
  const names = [];
  for (const entry of String(bentoStr || '').split(',')) {
    const e = entry.trim();
    if (!e) continue; // NULL・空文字＝お弁当なし
    const i = e.indexOf(':');
    const [sid, name] = i === -1 ? [sessionId, `形式不明(${e})`] : [e.slice(0, i), e.slice(i + 1)];
    if (sid !== sessionId) continue;
    names.push(name);
  }
  return names;
}

// 旧データのtacos列（回答文字列）を含めたTACOS参加判定
function isTacos(r) {
  return r.category === 'TACOS' || (r.tacos && r.tacos !== '参加しない');
}

// 日程ごとの集計行（KITCHEN向け）: お弁当×個数・朝RUN人数・TACOS人数
function aggLine(s) {
  const bentoCount = new Map();
  let run = 0, runDecide = 0, tacos = 0;
  for (const r of s.reservations) {
    if (RUN_JOIN.includes(r.morning_run)) run++;
    else if (RUN_DECIDE.includes(r.morning_run)) runDecide++;
    if (isTacos(r)) tacos++;
    for (const name of bentoItemsFor(s.id, r.bento)) {
      bentoCount.set(name, (bentoCount.get(name) || 0) + 1);
    }
  }
  const parts = [];
  if (bentoCount.size) parts.push([...bentoCount].map(([n, c]) => `🍱 ${esc(n)}×${c}`).join('、'));
  if (run || runDecide) parts.push(`🏃 朝RUN ${run}名${runDecide ? `（＋当日決め${runDecide}）` : ''}`);
  if (tacos) parts.push(`🌮 TACOS ${tacos}名`);
  return parts.length ? `<div class="agg">${parts.join(' ／ ')}</div>` : '';
}

// キャンセル者の行: 名前（取り消し線）＋キャンセル日時。旧データはcancelled_atがNULL→「日時不明」
function cancelledLine(s) {
  const people = s.cancelled_people || [];
  if (!people.length) {
    // 後方互換: 件数しか渡ってこない場合は従来表示
    return s.cancelled ? `<div class="cancelled-note">キャンセル ${s.cancelled}件</div>` : '';
  }
  const items = people.map(p =>
    `<s>${esc(p.display_name || '(名前なし)')}</s>（${p.cancelled_at ? esc(fmtJst(p.cancelled_at)) : '日時不明'}）`
  ).join('、');
  return `<div class="cancelled-note">キャンセル ${people.length}名: ${items}</div>`;
}

function sessionCard(s, manage = false) {
  const total = s.capacity + (s.extra_slots ?? 0);
  const isFull = s.booked >= total;
  const badgeClass = isFull ? 'full' : (s.booked >= s.capacity ? 'extra' : 'ok');
  const rows = s.reservations.map(r => {
    // 個人行の弁当表示（KITCHENが「誰の分か」まで分かるように）。
    // 集計行と同じ共用パーサを使うため、合計は必ず集計（🍱×N）と一致する
    const bentoBadges = bentoItemsFor(s.id, r.bento)
      .map(n => `<span class="meta">🍱 ${esc(n)}</span>`).join('');
    // 区分がTACOSの行はカテゴリバッジに🌮が出るので、旧tacos列由来のときだけ追加表示
    const tacosBadge = (r.category !== 'TACOS' && isTacos(r)) ? '<span class="meta">🌮 TACOS</span>' : '';
    return `
    <li class="person">
      <div class="person-main">
        <span class="name">${esc(r.display_name || '(名前なし)')}</span>
        ${categoryBadge(r.category)}
        ${r.trainer ? `<span class="meta">担当: ${esc(r.trainer)}</span>` : ''}
        ${RUN_JOIN.includes(r.morning_run) ? '<span class="meta">🏃朝RUN</span>' : ''}
        ${RUN_DECIDE.includes(r.morning_run) ? '<span class="meta">🏃朝RUN(当日決め)</span>' : ''}
        ${bentoBadges}
        ${tacosBadge}
      </div>
      ${r.message ? `<div class="msg">💬 ${esc(r.message)}</div>` : ''}
      <div class="ts">${esc(fmtJst(r.created_at))} 予約</div>
    </li>`;
  }).join('');

  return `
  <div class="card">
    <div class="card-head">
      <div>
        <div class="date">${esc(s.display_date)}</div>
        <div class="title">${esc(s.title)}${s.time_label ? `<span class="time"> ／ ${esc(s.time_label)}</span>` : ''}</div>
      </div>
      <div class="count ${badgeClass}">${s.booked}<span class="cap">/${s.capacity}${s.extra_slots ? `+${s.extra_slots}` : ''}</span></div>
    </div>
    ${s.is_open === 0 ? '<div class="closed-badge">⏸ 受付停止中（フォームに表示されません）</div>' : ''}
    ${aggLine(s)}
    ${cancelledLine(s)}
    ${rows ? `<ul class="people">${rows}</ul>` : '<p class="empty">予約はまだありません</p>'}
    ${manage ? `
    <div class="manage-row">
      <button type="button" class="btn-mini" data-session-edit="${esc(s.id)}">✏️ 編集</button>
      <button type="button" class="btn-mini" data-session-toggle="${esc(s.id)}" data-closed="${s.is_open === 0 ? '0' : '1'}">${s.is_open === 0 ? '▶️ 受付再開' : '⏸ 受付締切'}</button>
      <button type="button" class="btn-mini danger" data-session-delete="${esc(s.id)}">🗑 削除</button>
    </div>` : ''}
  </div>`;
}

function renderAdminReservations({ todayJst, sessions, trials }) {
  const upcoming = sessions.filter(s => s.date >= todayJst);
  const past = sessions.filter(s => s.date < todayJst).reverse(); // 新しい順
  const totalUpcoming = upcoming.reduce((n, s) => n + s.booked, 0);

  // 編集フォームのプリフィル用データ。<script>内に埋め込むため<をエスケープ
  // （タイトル等に</script>が含まれてもスクリプトが壊れない）
  const adminSessionsJson = JSON.stringify(upcoming.map(s => ({
    id: s.id, date: s.date, title: s.title, trainers: s.trainers, food: s.food,
    note: s.note, morning_run: s.morning_run, capacity: s.capacity,
    is_open: s.is_open, bento_json: s.bento_json,
  }))).replace(/</g, '\\u003c');

  const trialRows = trials.map(t => `
    <li class="person">
      <div class="person-main">
        <span class="name">${esc(t.display_name || '(名前なし)')}</span>
        <span class="meta">希望: ${esc(t.trainer)}</span>
      </div>
      <div class="msg">第1希望 ${esc(t.preferred_date)}（${esc(t.preferred_time)}）${t.alt_note ? ` ／ 第2希望・要望: ${esc(t.alt_note)}` : ''}</div>
      <div class="ts">${esc(fmtJst(t.created_at))} 受付</div>
      ${t.id ? `
      <div class="trial-actions">
        <button type="button" class="btn-trial confirm" data-trial-id="${esc(t.id)}" data-trial-action="confirm" data-trial-name="${esc(t.display_name || '(名前なし)')}">✅ 確定にする</button>
        <button type="button" class="btn-trial decline" data-trial-id="${esc(t.id)}" data-trial-action="decline" data-trial-name="${esc(t.display_name || '(名前なし)')}">✖ 不成立にする</button>
      </div>` : ''}
    </li>`).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>HACOS 予約管理</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, 'Hiragino Sans', 'Yu Gothic', sans-serif; background: #f5f5f5; color: #1a1a1a; padding-bottom: 40px; -webkit-font-smoothing: antialiased; }
.header { background: #3D5A3E; color: #fff; padding: 18px 16px; position: sticky; top: 0; z-index: 5; }
.header h1 { font-size: 16px; font-weight: 700; }
.header .sub { font-size: 12px; opacity: .85; margin-top: 3px; }
.wrap { padding: 12px; display: flex; flex-direction: column; gap: 12px; max-width: 640px; margin: 0 auto; }
.section-label { font-size: 13px; font-weight: 700; color: #3D5A3E; margin: 6px 2px 0; }
.card { background: #fff; border-radius: 12px; padding: 14px; }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.date { font-size: 17px; font-weight: 800; color: #3D5A3E; }
.title { font-size: 12px; color: #666; margin-top: 2px; }
.time { color: #C8833A; font-weight: 600; }
.count { font-size: 22px; font-weight: 800; white-space: nowrap; }
.count .cap { font-size: 12px; font-weight: 600; color: #999; }
.count.ok { color: #2e7d32; }
.count.extra { color: #f57c00; }
.count.full { color: #e53935; }
.cancelled-note { font-size: 11px; color: #b85c38; margin-top: 6px; line-height: 1.7; }
.cancelled-note s { opacity: .75; }
.agg { font-size: 12px; font-weight: 600; color: #3D5A3E; background: #f0f4f0; border-radius: 8px; padding: 7px 10px; margin-top: 8px; line-height: 1.8; }
.people { list-style: none; margin-top: 10px; border-top: 1px solid #eee; }
.person { padding: 9px 2px; border-bottom: 1px solid #eee; }
.person-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.name { font-size: 14px; font-weight: 700; }
.cat { font-size: 11px; font-weight: 700; border: 1px solid; border-radius: 5px; padding: 1px 6px; }
.meta { font-size: 11px; color: #666; }
.msg { font-size: 12px; color: #444; margin-top: 4px; line-height: 1.5; }
.ts { font-size: 10px; color: #aaa; margin-top: 3px; }
.empty { font-size: 12px; color: #999; margin-top: 8px; }
details { background: #fff; border-radius: 12px; padding: 12px 14px; }
summary { font-size: 13px; font-weight: 700; color: #666; cursor: pointer; }
details .card { padding: 12px 0 0; }
.total { font-size: 12px; color: #666; margin: 0 2px; }
.closed-badge { font-size: 11px; font-weight: 700; color: #f57c00; background: #fff3e0; border-radius: 6px; padding: 4px 8px; margin-top: 8px; display: inline-block; }
.manage-row { display: flex; gap: 8px; margin-top: 10px; border-top: 1px dashed #eee; padding-top: 10px; }
.btn-mini { flex: 1; border: 1.5px solid #ccc; background: #fff; color: #555; border-radius: 8px; padding: 8px 6px; font-size: 11px; font-weight: 700; cursor: pointer; }
.btn-mini.danger { color: #b85c38; border-color: #b85c3866; }
.btn-mini:disabled { opacity: .5; cursor: default; }
.form-grid { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.form-grid label { font-size: 12px; font-weight: 700; }
.form-grid input, .form-grid textarea { width: 100%; border: 1.5px solid #e0e0e0; border-radius: 8px; padding: 10px; font-size: 14px; font-family: inherit; margin-top: 4px; }
.form-grid .hint { font-size: 11px; color: #999; margin-top: 3px; font-weight: 400; }
.form-actions { display: flex; gap: 8px; margin-top: 4px; }
.btn-submit-session { flex: 2; background: #3D5A3E; color: #fff; border: none; border-radius: 10px; padding: 13px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-reset-session { flex: 1; background: #fff; color: #666; border: 1.5px solid #ccc; border-radius: 10px; padding: 13px; font-size: 13px; font-weight: 700; cursor: pointer; }
.trial-actions { display: flex; gap: 8px; margin-top: 8px; }
.btn-trial { flex: 1; border-radius: 8px; padding: 9px 10px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1.5px solid; background: #fff; }
.btn-trial.confirm { color: #2e7d32; border-color: #2e7d32; }
.btn-trial.decline { color: #b85c38; border-color: #b85c38; }
.btn-trial:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
<div class="header">
  <h1>HACOS 予約管理</h1>
  <div class="sub">今日: ${esc(todayJst)}（JST）／ このページはスタッフ専用です</div>
</div>
<div class="wrap">
  <div class="section-label">📅 今後の開催（予約合計 ${totalUpcoming}名）</div>
  ${upcoming.length ? upcoming.map(s => sessionCard(s, true)).join('') : '<div class="card"><p class="empty">今後の開催日程がありません（下の「開催日の管理」から追加できます）</p></div>'}

  <details id="session-manage">
    <summary>🛠 開催日の管理（新規追加・編集）</summary>
    <form id="session-form" class="form-grid">
      <input type="hidden" id="sf-edit-id" value="">
      <label>開催日 <span class="hint" id="sf-date-hint">新規追加のみ。既存日程の日付は変更できません（削除→新規で対応）</span>
        <input type="date" id="sf-date" required></label>
      <label>クラス名（必須）
        <input type="text" id="sf-title" maxlength="100" placeholder="例: ピラティス" required></label>
      <label>担当
        <input type="text" id="sf-trainers" maxlength="100" placeholder="例: ちひろ, ふみや（KITCHEN）"></label>
      <label>お弁当・朝ごはんの紹介
        <input type="text" id="sf-food" maxlength="200" placeholder="例: ビーフストロガノフ"></label>
      <label>お弁当の選択肢 <span class="hint">1行に1つ「メニュー名:価格」。価格未定は価格なしで（例: カオマンガイ:1300）</span>
        <textarea id="sf-bento" rows="2" placeholder="カオマンガイ:1300"></textarea></label>
      <label><input type="checkbox" id="sf-run" style="width:auto;margin-right:6px;">朝RUNあり（6:30〜）</label>
      <label>定員 <span class="hint">1〜99。お休みにしたい日は定員ではなく「受付締切」を使う</span>
        <input type="number" id="sf-capacity" min="1" max="99" value="10"></label>
      <label>備考（日程カードに表示）
        <input type="text" id="sf-note" maxlength="300" placeholder="例: 朝RUN 6:30〜あり"></label>
      <div class="form-actions">
        <button type="submit" class="btn-submit-session" id="sf-submit">この日程を追加する</button>
        <button type="button" class="btn-reset-session" id="sf-reset">クリア</button>
      </div>
    </form>
  </details>

  <div class="section-label">🌱 体験パーソナル リクエスト（確定待ち）</div>
  ${trialRows ? `<div class="card"><ul class="people" style="border-top:none;margin-top:0;">${trialRows}</ul></div>` : '<div class="card"><p class="empty">確定待ちのリクエストはありません</p></div>'}

  ${past.length ? `<details><summary>🗂 過去30日の開催（${past.length}件）</summary>${past.map(s => sessionCard(s)).join('')}</details>` : ''}
</div>
<script>
// 体験リクエストの確定/不成立。cookie認証のPOSTはハーネスのミドルウェアが
// X-CSRF-Token ヘッダと lh_csrf cookie の一致を検証するため、ヘッダを必ず付ける。
function readCookie(name) {
  const row = document.cookie.split('; ').find(r => r.startsWith(name + '='));
  return row ? row.slice(name.length + 1) : '';
}
async function getCsrfToken() {
  let token = readCookie('lh_csrf');
  if (!token) {
    // cookieに無い場合は /api/auth/session がcsrfTokenを返し、cookieも再発行される
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) token = (await res.json()).csrfToken || '';
    } catch {}
  }
  return token;
}
document.querySelectorAll('[data-trial-action]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const { trialId, trialAction, trialName } = btn.dataset;
    const label = trialAction === 'confirm' ? '確定' : '不成立';
    if (!confirm(trialName + ' さんの体験リクエストを「' + label + '」にしますか？\\n（お客様への連絡は自動送信されません。別途スタッフからお願いします）')) return;

    const row = btn.closest('.trial-actions');
    row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    btn.textContent = '処理中...';

    try {
      const res = await fetch('/api/admin/trials/' + encodeURIComponent(trialId) + '/' + trialAction, {
        method: 'POST',
        headers: { 'X-CSRF-Token': await getCsrfToken() },
      });
      if (res.ok) { location.reload(); return; }
      if (res.status === 409) { alert('このリクエストはすでに処理済みです。最新の状態に更新します。'); location.reload(); return; }
      if (res.status === 401 || res.status === 403) {
        alert('ログインの有効期限が切れている可能性があります。/admin-login からログインし直してください。');
      } else {
        alert('処理に失敗しました。時間をおいてもう一度お試しください。');
      }
    } catch {
      alert('通信エラーが発生しました。もう一度お試しください。');
    }
    row.querySelectorAll('button').forEach(b => { b.disabled = false; });
    btn.textContent = trialAction === 'confirm' ? '✅ 確定にする' : '✖ 不成立にする';
  });
});

// ── 開催日の管理（新規追加・編集・締切/再開・削除） ──
const ADMIN_SESSIONS = ${adminSessionsJson};

async function postAdmin(path, payload) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await getCsrfToken() },
    body: JSON.stringify(payload ?? {}),
  });
}
function adminError(res) {
  if (res.status === 401 || res.status === 403) {
    alert('ログインの有効期限が切れている可能性があります。/admin-login からログインし直してください。');
  } else {
    alert('処理に失敗しました。時間をおいてもう一度お試しください。');
  }
}

// 「メニュー名:価格」の行 → [{name, price}]。数値でない末尾は名前の一部とみなす
function parseBentoLines(text) {
  const items = [];
  for (const raw of text.split('\\n')) {
    const line = raw.trim();
    if (!line) continue;
    let name = line, price = null;
    const i = line.lastIndexOf(':');
    if (i > 0) {
      const p = line.slice(i + 1).trim();
      if (p !== '' && !Number.isNaN(Number(p))) { name = line.slice(0, i).trim(); price = Number(p); }
    }
    if (!name) return null;
    if (name.length > 50) return null; // サーバー側で黙って切り詰めず、入力時点で知らせる
    items.push({ name, price });
  }
  return items;
}

const sf = (id) => document.getElementById(id);
const DATE_HINT_DEFAULT = '新規追加のみ。既存日程の日付は変更できません（削除→新規で対応）';
function resetSessionForm() {
  sf('sf-edit-id').value = '';
  sf('session-form').reset();
  sf('sf-capacity').value = '10';
  sf('sf-date').disabled = false;
  sf('sf-date-hint').textContent = DATE_HINT_DEFAULT;
  sf('sf-submit').textContent = 'この日程を追加する';
}
sf('sf-reset').addEventListener('click', resetSessionForm);

// リロード後も「開催日の管理」パネルを開いたままにする（複数日程の連続登録用）
if (location.hash === '#session-manage') {
  const manage = document.getElementById('session-manage');
  manage.open = true;
  manage.scrollIntoView();
}
function reloadKeepingPanel() {
  location.hash = 'session-manage';
  location.reload();
}

document.querySelectorAll('[data-session-edit]').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = ADMIN_SESSIONS.find(x => x.id === btn.dataset.sessionEdit);
    if (!s) return;
    sf('sf-edit-id').value = s.id;
    sf('sf-date').value = s.date;
    sf('sf-date').disabled = true; // 日付＝IDは変更不可
    // 編集中であることを明示（クリアを押し忘れて別日程のつもりで上書きする事故の防止）
    sf('sf-date-hint').textContent = '✏️ 編集中: この内容で ' + s.date + ' の日程を更新します。新規追加は先に「クリア」を押してください';
    sf('sf-title').value = s.title || '';
    sf('sf-trainers').value = s.trainers || '';
    sf('sf-food').value = s.food || '';
    sf('sf-note').value = s.note || '';
    sf('sf-run').checked = s.morning_run === 1;
    sf('sf-capacity').value = s.capacity;
    let bentoLines = '';
    try {
      bentoLines = (JSON.parse(s.bento_json || '[]'))
        .map(b => b.price != null ? b.name + ':' + b.price : b.name).join('\\n');
    } catch {}
    sf('sf-bento').value = bentoLines;
    sf('sf-submit').textContent = 'この日程を更新する';
    const manage = document.getElementById('session-manage');
    manage.open = true;
    manage.scrollIntoView({ behavior: 'smooth' });
  });
});

sf('session-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const bento = parseBentoLines(sf('sf-bento').value);
  if (bento === null) { alert('お弁当の入力形式を確認してください（1行に1つ「メニュー名:価格」・メニュー名は50文字まで）'); return; }
  const payload = {
    title: sf('sf-title').value.trim(),
    trainers: sf('sf-trainers').value.trim(),
    food: sf('sf-food').value.trim(),
    note: sf('sf-note').value.trim(),
    morning_run: sf('sf-run').checked,
    capacity: Number(sf('sf-capacity').value || 10),
    bento,
  };
  const editId = sf('sf-edit-id').value;
  const btn = sf('sf-submit');
  btn.disabled = true;
  try {
    let res;
    if (editId) {
      res = await postAdmin('/api/admin/sessions/' + encodeURIComponent(editId), payload);
    } else {
      payload.date = sf('sf-date').value;
      res = await postAdmin('/api/admin/sessions', payload);
    }
    if (res.ok) { reloadKeepingPanel(); return; }
    const err = (await res.json().catch(() => ({}))).error;
    if (err === 'session_exists') alert('この日付の日程はすでに登録されています。編集ボタンから変更してください。');
    else if (err === 'invalid_date') alert('開催日を選択してください。');
    else if (err === 'title_required') alert('クラス名を入力してください。');
    else if (err === 'invalid_bento') alert('お弁当の入力内容を確認してください。');
    else if (err === 'session_not_found') { alert('この日程は既に削除されています。画面を更新します。'); location.reload(); return; }
    else adminError(res);
  } catch { alert('通信エラーが発生しました。もう一度お試しください。'); }
  btn.disabled = false;
});

document.querySelectorAll('[data-session-toggle]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.sessionToggle;
    const isClosed = btn.dataset.closed === '0';
    const msg = isClosed
      ? 'この日程の受付を再開しますか？（予約フォームに再び表示されます）'
      : 'この日程の受付を締め切りますか？（予約フォームに表示されなくなります。既存の予約はそのまま残ります）';
    if (!confirm(msg)) return;
    btn.disabled = true;
    try {
      const res = await postAdmin('/api/admin/sessions/' + encodeURIComponent(id), { closed: !isClosed });
      if (res.ok) { location.reload(); return; }
      adminError(res);
    } catch { alert('通信エラーが発生しました。もう一度お試しください。'); }
    btn.disabled = false;
  });
});

document.querySelectorAll('[data-session-delete]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.sessionDelete;
    if (!confirm('この日程を削除しますか？（取り消せません。予約が1件でもある日程は削除できません）')) return;
    btn.disabled = true;
    try {
      const res = await postAdmin('/api/admin/sessions/' + encodeURIComponent(id) + '/delete');
      if (res.ok) { location.reload(); return; }
      if (res.status === 409) { alert('この日程には予約（キャンセル履歴含む）があるため削除できません。受付締切をお使いください。'); }
      else if (res.status === 404) { alert('この日程は既に削除されています。画面を更新します。'); location.reload(); return; }
      else adminError(res);
    } catch { alert('通信エラーが発生しました。もう一度お試しください。'); }
    btn.disabled = false;
  });
});
</script>
</body>
</html>`;
}

export { renderAdminReservations };
