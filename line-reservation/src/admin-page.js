// HACOS × HMC 予約管理画面のHTML生成（スタッフ用・純粋関数）
// reservation-routes.js の GET /admin/reservations から呼ばれる。
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

function sessionCard(s) {
  const total = s.capacity + (s.extra_slots ?? 0);
  const isFull = s.booked >= total;
  const badgeClass = isFull ? 'full' : (s.booked >= s.capacity ? 'extra' : 'ok');
  const rows = s.reservations.map(r => `
    <li class="person">
      <div class="person-main">
        <span class="name">${esc(r.display_name || '(名前なし)')}</span>
        ${categoryBadge(r.category)}
        ${r.trainer ? `<span class="meta">担当: ${esc(r.trainer)}</span>` : ''}
        ${r.morning_run === '参加したい' ? '<span class="meta">🏃朝RUN</span>' : ''}
      </div>
      ${r.message ? `<div class="msg">💬 ${esc(r.message)}</div>` : ''}
      <div class="ts">${esc(fmtJst(r.created_at))} 予約</div>
    </li>`).join('');

  return `
  <div class="card">
    <div class="card-head">
      <div>
        <div class="date">${esc(s.display_date)}</div>
        <div class="title">${esc(s.title)}${s.time_label ? `<span class="time"> ／ ${esc(s.time_label)}</span>` : ''}</div>
      </div>
      <div class="count ${badgeClass}">${s.booked}<span class="cap">/${s.capacity}${s.extra_slots ? `+${s.extra_slots}` : ''}</span></div>
    </div>
    ${s.cancelled ? `<div class="cancelled-note">キャンセル ${s.cancelled}件</div>` : ''}
    ${rows ? `<ul class="people">${rows}</ul>` : '<p class="empty">予約はまだありません</p>'}
  </div>`;
}

function renderAdminReservations({ todayJst, sessions, trials }) {
  const upcoming = sessions.filter(s => s.date >= todayJst);
  const past = sessions.filter(s => s.date < todayJst).reverse(); // 新しい順
  const totalUpcoming = upcoming.reduce((n, s) => n + s.booked, 0);

  const trialRows = trials.map(t => `
    <li class="person">
      <div class="person-main">
        <span class="name">${esc(t.display_name || '(名前なし)')}</span>
        <span class="meta">希望: ${esc(t.trainer)}</span>
      </div>
      <div class="msg">第1希望 ${esc(t.preferred_date)}（${esc(t.preferred_time)}）${t.alt_note ? ` ／ 第2希望・要望: ${esc(t.alt_note)}` : ''}</div>
      <div class="ts">${esc(fmtJst(t.created_at))} 受付</div>
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
.cancelled-note { font-size: 11px; color: #b85c38; margin-top: 4px; }
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
</style>
</head>
<body>
<div class="header">
  <h1>HACOS 予約管理</h1>
  <div class="sub">今日: ${esc(todayJst)}（JST）／ このページはスタッフ専用です</div>
</div>
<div class="wrap">
  <div class="section-label">📅 今後の開催（予約合計 ${totalUpcoming}名）</div>
  ${upcoming.length ? upcoming.map(sessionCard).join('') : '<div class="card"><p class="empty">今後の開催日程がありません（翌月の日程追加を忘れていませんか？ MONTHLY.md参照）</p></div>'}

  <div class="section-label">🌱 体験パーソナル リクエスト（確定待ち）</div>
  ${trialRows ? `<div class="card"><ul class="people" style="border-top:none;margin-top:0;">${trialRows}</ul></div>` : '<div class="card"><p class="empty">確定待ちのリクエストはありません</p></div>'}

  ${past.length ? `<details><summary>🗂 過去30日の開催（${past.length}件）</summary>${past.map(sessionCard).join('')}</details>` : ''}
</div>
</body>
</html>`;
}

export { renderAdminReservations };
