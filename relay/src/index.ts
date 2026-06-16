interface Env {
  DB: D1Database;
  LINE_HARNESS_WEBHOOK_URL: string;
  LINE_CHANNEL_SECRET: string;
}

interface LineSource {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}

interface LineEvent {
  type: string;
  mode?: string;
  timestamp: number;
  source: LineSource;
  webhookEventId?: string;
  deliveryContext?: { isRedelivery: boolean };
  replyToken?: string;
  [key: string]: unknown;
}

interface LineWebhookBody {
  destination: string;
  events: LineEvent[];
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifyLineSignature(secret: string, body: string, signature: string): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, body);
  // タイミング攻撃対策
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

async function sendToHarness(
  url: string,
  secret: string,
  destination: string,
  events: LineEvent[],
): Promise<void> {
  const body = JSON.stringify({ destination, events });
  const signature = await hmacSha256Hex(secret, body);
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-line-signature': signature,
    },
    body,
  });
}

async function isRegisteredFriend(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM friends WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first<{ id: string }>();
  return row !== null;
}

function buildSyntheticFollowEvent(original: LineEvent): LineEvent {
  return {
    type: 'follow',
    mode: original.mode ?? 'active',
    timestamp: original.timestamp,
    source: original.source,
    webhookEventId: `synthetic-${Date.now()}-${original.source.userId}`,
    deliveryContext: { isRedelivery: false },
    replyToken: '00000000000000000000000000000000',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get('x-line-signature') ?? '';

    // 1. LINE の署名検証
    const valid = await verifyLineSignature(env.LINE_CHANNEL_SECRET, rawBody, signature);
    if (!valid) {
      console.error('Invalid LINE signature');
      return new Response('Unauthorized', { status: 401 });
    }

    let body: LineWebhookBody;
    try {
      body = JSON.parse(rawBody) as LineWebhookBody;
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const { destination, events } = body;

    // 2. 未登録ユーザーからの message/postback イベントを検出 → follow を先送り
    for (const event of events) {
      const isUserEvent = event.source?.type === 'user' && event.source.userId;
      const needsCheck = ['message', 'postback', 'beacon'].includes(event.type);

      if (isUserEvent && needsCheck) {
        const userId = event.source.userId!;
        const registered = await isRegisteredFriend(env.DB, userId);

        if (!registered) {
          console.log(`Unknown user ${userId}, sending synthetic follow event`);
          const followEvent = buildSyntheticFollowEvent(event);
          // 合成 follow イベントを先に Harness へ送信（登録させる）
          await sendToHarness(
            env.LINE_HARNESS_WEBHOOK_URL,
            env.LINE_CHANNEL_SECRET,
            destination,
            [followEvent],
          );
        }
      }
    }

    // 3. 元のイベントをそのまま Harness へ転送（元の署名はそのまま）
    await fetch(env.LINE_HARNESS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': signature,
      },
      body: rawBody,
    });

    return new Response('OK', { status: 200 });
  },
};
