import type { LHMenu } from '@/types';

export async function fetchMenus(apiUrl: string, adminToken: string): Promise<LHMenu[]> {
  const res = await fetch(`${apiUrl}/api/booking/admin/menus`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`LINE Harness menu fetch failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json<{ data: LHMenu[] } | LHMenu[]>();
  return Array.isArray(json) ? json : json.data;
}
