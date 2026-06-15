export const runtime = 'edge';

import { getRequestContext } from '@cloudflare/next-on-pages';
import type { BookingRow, MenuCacheRow, Env } from '@/types';

const STATUS_LABELS: Record<string, string> = {
  requested: '⏳ リクエスト',
  confirmed: '✅ 確定',
  rejected: '❌ 拒否',
  cancelled: '🚫 キャンセル',
  expired: '⏰ 期限切れ',
  completed: '🏁 完了',
  no_show: '👻 ノーショー',
};

const STATUS_COLORS: Record<string, string> = {
  requested: '#f59e0b',
  confirmed: '#10b981',
  rejected: '#ef4444',
  cancelled: '#6b7280',
  expired: '#9ca3af',
  completed: '#3b82f6',
  no_show: '#8b5cf6',
};

function formatJst(isoStr: string | null): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminPage() {
  const env = getRequestContext().env as Env;

  const [bookingsResult, menusResult] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM bookings ORDER BY received_at DESC LIMIT 100`,
    ).all<BookingRow>(),
    env.DB.prepare(
      `SELECT * FROM menus_cache WHERE is_active = 1 ORDER BY name ASC`,
    ).all<MenuCacheRow>(),
  ]);

  const bookings = bookingsResult.results;
  const menus = menusResult.results;

  const statusCounts = bookings.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* ヘッダー */}
      <header style={{
        background: '#00b900',
        color: '#fff',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700 }}>HACOS 予約管理</h1>
          <p style={{ fontSize: '13px', opacity: 0.85 }}>LINE Harness 連携ダッシュボード</p>
        </div>
        <form action="/api/menus" method="POST">
          <button type="submit" style={{
            background: '#fff',
            color: '#00b900',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '14px',
          }}>
            🔄 メニュー同期
          </button>
        </form>
      </header>

      <main style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        {/* サマリーカード */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          {Object.entries(STATUS_LABELS).map(([status, label]) => (
            <div key={status} style={{
              background: '#fff',
              borderRadius: '10px',
              padding: '16px',
              borderLeft: `4px solid ${STATUS_COLORS[status] ?? '#ccc'}`,
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: STATUS_COLORS[status] }}>
                {statusCounts[status] ?? 0}
              </div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px' }}>
          {/* 予約一覧 */}
          <section>
            <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
              📋 予約一覧（直近100件）
            </h2>
            <div style={{ background: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              {bookings.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#999' }}>
                  予約データがありません。<br />LINE Harness の Webhook OUT を設定してください。
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #eee' }}>
                      <th style={th}>状態</th>
                      <th style={th}>顧客</th>
                      <th style={th}>メニュー</th>
                      <th style={th}>担当</th>
                      <th style={th}>日時</th>
                      <th style={th}>料金</th>
                      <th style={th}>受信日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b, i) => (
                      <tr key={b.id} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={td}>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: STATUS_COLORS[b.status] ?? '#333',
                            background: `${STATUS_COLORS[b.status]}18`,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            whiteSpace: 'nowrap',
                          }}>
                            {STATUS_LABELS[b.status] ?? b.status}
                          </span>
                        </td>
                        <td style={td}>{b.customer_name ?? '—'}</td>
                        <td style={td}>{b.menu_name ?? '—'}</td>
                        <td style={td}>{b.staff_name ?? '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatJst(b.starts_at)}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {b.price_at_booking != null ? `¥${b.price_at_booking.toLocaleString()}` : '—'}
                        </td>
                        <td style={{ ...td, fontSize: '11px', color: '#999', whiteSpace: 'nowrap' }}>
                          {formatJst(b.received_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* メニューリスト */}
          <aside>
            <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
              📌 メニュー一覧
            </h2>
            <div style={{ background: '#fff', borderRadius: '10px', padding: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              {menus.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
                  「メニュー同期」ボタンで<br />LINE Harness から取得してください
                </div>
              ) : (
                menus.map((m) => (
                  <div key={m.id} style={{
                    padding: '12px',
                    borderBottom: '1px solid #f0f0f0',
                  }}>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{m.name}</div>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '4px', display: 'flex', gap: '12px' }}>
                      {m.duration_minutes && <span>⏱ {m.duration_minutes}分</span>}
                      {m.base_price != null && <span>💴 ¥{m.base_price.toLocaleString()}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Webhook 設定ガイド */}
            <div style={{
              marginTop: '20px',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '10px',
              padding: '16px',
              fontSize: '12px',
              color: '#92400e',
            }}>
              <div style={{ fontWeight: 700, marginBottom: '8px' }}>🔗 Webhook 設定</div>
              <div>LINE Harness 管理画面 → Webhook OUT に以下を登録してください：</div>
              <div style={{
                marginTop: '8px',
                background: '#fff',
                padding: '8px',
                borderRadius: '6px',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}>
                POST /api/webhooks/line-harness
              </div>
              <div style={{ marginTop: '8px' }}>イベント: booking.*</div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: '12px',
  fontWeight: 600,
  color: '#666',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: '13px',
};
