// HACOS × HMC スタッフ用ログインページのHTML生成（純粋関数）
// reservation-routes.js の GET /admin-login から呼ばれる。
//
// なぜこのページが必要か:
//   管理SPA(pages.dev)とWorker(workers.dev)はクロスサイトのため、SPAでログインして
//   発行されたcookieはChromeのサードパーティcookie保護により、管理画面URLの
//   アドレスバー直打ち（ファーストパーティ）には送信されない。
//   Workerと同一オリジンのこのページから POST /api/auth/login すれば、cookieが
//   ファーストパーティとして保存され、以後 /api/admin/reservations の直打ちが通る。
//
// このページ自体は認証なしで表示されてよい（APIキー入力欄だけで個人情報を含まない）。
// APIキーそのものをHTMLに埋め込むことは絶対にしないこと。

export function renderAdminLogin() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>HACOS スタッフログイン</title>
<style>
:root { --green: #06C755; --green-light: #f0fff4; --gray: #666; --border: #e0e0e0; --bg: #f5f5f5; --red: #e53935; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, 'Hiragino Sans', 'Yu Gothic', sans-serif; background: var(--bg); color: #1a1a1a;
  min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
.card { background: white; border-radius: 12px; padding: 28px 20px; width: 100%; max-width: 400px; }
h1 { font-size: 17px; font-weight: 700; }
.sub { font-size: 12px; color: var(--gray); margin-top: 4px; line-height: 1.6; }
label { display: block; font-size: 13px; font-weight: 700; margin: 18px 0 6px; }
input { width: 100%; border: 1.5px solid var(--border); border-radius: 9px; padding: 12px; font-size: 14px; outline: none; }
input:focus { border-color: var(--green); }
button { width: 100%; background: var(--green); color: white; border: none; border-radius: 12px;
  padding: 14px; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 14px; }
button:disabled { opacity: .6; cursor: default; }
.error { background: #fff0f0; color: var(--red); border-radius: 9px; padding: 11px 12px; font-size: 13px;
  text-align: center; margin-top: 12px; display: none; }
.note { font-size: 11px; color: var(--gray); margin-top: 14px; line-height: 1.7; }
</style>
</head>
<body>
<div class="card">
  <h1>HACOS スタッフログイン</h1>
  <p class="sub">予約管理画面を開くためのログインです。<br>スタッフ用APIキーを入力してください。</p>
  <form id="login-form">
    <label for="apikey">APIキー</label>
    <input type="password" id="apikey" autocomplete="current-password" placeholder="スタッフ用APIキー" required>
    <button type="submit" id="btn">ログインして予約管理を開く</button>
    <div class="error" id="err"></div>
  </form>
  <p class="note">ログインは7日間有効です。期限が切れたらこのページからもう一度ログインしてください。</p>
</div>
<script>
// すでにログイン済み（cookie有効）ならフォームを飛ばして管理画面へ
fetch('/api/auth/session').then(res => {
  if (res.ok) location.href = '/api/admin/reservations';
}).catch(() => {});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn');
  const err = document.getElementById('err');
  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'ログイン中...';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: document.getElementById('apikey').value.trim() }),
    });
    if (res.ok) {
      location.href = '/api/admin/reservations';
      return;
    }
    err.textContent = res.status === 401
      ? 'APIキーが違います。確認してもう一度お試しください。'
      : 'ログインに失敗しました。時間をおいてもう一度お試しください。';
    err.style.display = 'block';
  } catch {
    err.textContent = '通信エラーが発生しました。もう一度お試しください。';
    err.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = 'ログインして予約管理を開く';
});
</script>
</body>
</html>`;
}
