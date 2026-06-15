export const runtime = 'edge';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { NextRequest, NextResponse } from 'next/server';
import { verifySignature } from '@/lib/verify-signature';
import { notifyStaff } from '@/lib/line-notify';
import type { Env, LineHarnessWebhookPayload, BookingStatus } from '@/types';

const NOTIFY_EVENTS = new Set([
  'booking.requested',
  'booking.confirmed',
  'booking.rejected',
  'booking.cancelled',
  'booking.expired',
]);

export async function POST(req: NextRequest) {
  const env = getRequestContext().env as Env;

  const signature = req.headers.get('x-webhook-signature') ?? '';
  const rawBody = await req.text();

  if (env.LINE_HARNESS_WEBHOOK_SECRET) {
    const valid = await verifySignature(env.LINE_HARNESS_WEBHOOK_SECRET, rawBody, signature);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let payload: LineHarnessWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { event, data } = payload;
  if (!event || !data?.id) {
    return NextResponse.json({ error: 'Missing event or data' }, { status: 400 });
  }

  // D1 に予約を upsert
  await env.DB.prepare(
    `INSERT INTO bookings (
      id, line_account_id, friend_id, staff_id, menu_id,
      menu_name, staff_name, customer_name,
      starts_at, ends_at, status, customer_note, price_at_booking,
      raw_payload, received_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      menu_name = COALESCE(excluded.menu_name, bookings.menu_name),
      staff_name = COALESCE(excluded.staff_name, bookings.staff_name),
      customer_name = COALESCE(excluded.customer_name, bookings.customer_name),
      raw_payload = excluded.raw_payload,
      updated_at = datetime('now')`,
  )
    .bind(
      data.id,
      data.line_account_id,
      data.friend_id ?? null,
      data.staff_id ?? null,
      data.menu_id ?? null,
      data.menu_name ?? null,
      data.staff_name ?? null,
      data.customer_name ?? null,
      data.starts_at,
      data.ends_at ?? null,
      data.status as BookingStatus,
      data.customer_note ?? null,
      data.price_at_booking ?? null,
      rawBody,
    )
    .run();

  // スタッフへの LINE 通知
  if (NOTIFY_EVENTS.has(event)) {
    const staffIds = (env.LINE_STAFF_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (staffIds.length > 0 && env.LINE_CHANNEL_ACCESS_TOKEN) {
      // fire-and-forget（通知失敗で予約処理をロールバックしない）
      notifyStaff(env.LINE_CHANNEL_ACCESS_TOKEN, staffIds, event, data).catch((err) =>
        console.error('LINE notify error:', err),
      );
    }
  }

  return NextResponse.json({ ok: true });
}
