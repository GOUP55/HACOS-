import type { BookingWebhookData } from '@/types';

const LINE_API_URL = 'https://api.line.me/v2/bot/message/push';

function formatDateTime(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildMessage(event: string, data: BookingWebhookData): string {
  const menuName = data.menu_name ?? `メニューID: ${data.menu_id ?? '不明'}`;
  const staffName = data.staff_name ?? `スタッフID: ${data.staff_id ?? '未定'}`;
  const customerName = data.customer_name ?? `顧客ID: ${data.friend_id ?? '不明'}`;
  const dateTime = data.starts_at ? formatDateTime(data.starts_at) : '日時未定';
  const price = data.price_at_booking != null ? `¥${data.price_at_booking.toLocaleString()}` : '未設定';

  const eventLabels: Record<string, string> = {
    'booking.requested': '📋 新しい予約リクエスト',
    'booking.confirmed': '✅ 予約が確定しました',
    'booking.rejected': '❌ 予約を拒否しました',
    'booking.cancelled': '🚫 予約がキャンセルされました',
    'booking.expired': '⏰ 予約リクエストが期限切れになりました',
  };

  const header = eventLabels[event] ?? `📣 予約イベント: ${event}`;

  const lines = [
    header,
    '─────────────',
    `👤 顧客: ${customerName}`,
    `📌 メニュー: ${menuName}`,
    `👩‍💼 担当: ${staffName}`,
    `🗓 日時: ${dateTime}`,
    `💴 料金: ${price}`,
  ];

  if (data.customer_note) {
    lines.push(`📝 備考: ${data.customer_note}`);
  }

  lines.push('─────────────');
  lines.push(`予約ID: ${data.id}`);

  return lines.join('\n');
}

export async function notifyStaff(
  channelAccessToken: string,
  staffUserIds: string[],
  event: string,
  data: BookingWebhookData,
): Promise<void> {
  const text = buildMessage(event, data);

  await Promise.all(
    staffUserIds.map((userId) =>
      fetch(LINE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: [{ type: 'text', text }],
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          console.error(`LINE push failed for ${userId}: ${res.status} ${body}`);
        }
      }),
    ),
  );
}
