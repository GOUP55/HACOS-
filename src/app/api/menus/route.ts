export const runtime = 'edge';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { NextResponse } from 'next/server';
import { fetchMenus } from '@/lib/line-harness';
import type { Env, LHMenu } from '@/types';

// LINE Harness からメニューを同期してキャッシュに保存
export async function POST() {
  const env = getRequestContext().env as Env;

  const menus = await fetchMenus(env.LINE_HARNESS_API_URL, env.LINE_HARNESS_ADMIN_TOKEN);

  const stmt = env.DB.prepare(
    `INSERT INTO menus_cache (id, name, duration_minutes, buffer_after_minutes, base_price, is_active, raw_data, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       duration_minutes = excluded.duration_minutes,
       buffer_after_minutes = excluded.buffer_after_minutes,
       base_price = excluded.base_price,
       is_active = excluded.is_active,
       raw_data = excluded.raw_data,
       synced_at = datetime('now')`,
  );

  await env.DB.batch(
    menus.map((m: LHMenu) =>
      stmt.bind(
        m.id,
        m.name,
        m.duration_minutes ?? null,
        m.buffer_after_minutes ?? null,
        m.base_price ?? null,
        m.is_active ? 1 : 0,
        JSON.stringify(m),
      ),
    ),
  );

  return NextResponse.json({ synced: menus.length });
}

// キャッシュ済みメニュー一覧を返す
export async function GET() {
  const env = getRequestContext().env as Env;

  const result = await env.DB.prepare(
    `SELECT * FROM menus_cache WHERE is_active = 1 ORDER BY name ASC`,
  ).all();

  return NextResponse.json({ menus: result.results });
}
