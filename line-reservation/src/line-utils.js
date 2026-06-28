// LINE API ユーティリティ

export async function verifyIdToken(idToken, env) {
  const params = new URLSearchParams({
    id_token: idToken,
    client_id: env.LINE_LOGIN_CHANNEL_ID,
  });
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`IDトークン検証失敗: ${err.error_description || res.status}`);
  }
  const data = await res.json();
  return { userId: data.sub, displayName: data.name };
}

export async function pushToUser(to, messages, env) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('LINE push failed:', JSON.stringify(err));
  }
}
