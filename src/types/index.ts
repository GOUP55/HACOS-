export type BookingStatus =
  | 'requested'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'completed'
  | 'no_show';

export interface BookingRow {
  id: string;
  line_account_id: string;
  friend_id: string | null;
  staff_id: string | null;
  menu_id: string | null;
  menu_name: string | null;
  staff_name: string | null;
  customer_name: string | null;
  starts_at: string;
  ends_at: string | null;
  status: BookingStatus;
  customer_note: string | null;
  price_at_booking: number | null;
  raw_payload: string;
  received_at: string;
  updated_at: string;
}

export interface MenuCacheRow {
  id: string;
  name: string;
  duration_minutes: number | null;
  buffer_after_minutes: number | null;
  base_price: number | null;
  is_active: number;
  raw_data: string;
  synced_at: string;
}

// LINE Harness webhook out payload
export interface LineHarnessWebhookPayload {
  event: string;
  account_id: string;
  data: BookingWebhookData;
}

export interface BookingWebhookData {
  id: string;
  line_account_id: string;
  friend_id: string | null;
  staff_id: string | null;
  menu_id: string | null;
  starts_at: string;
  ends_at: string | null;
  block_ends_at: string | null;
  status: BookingStatus;
  customer_note: string | null;
  price_at_booking: number | null;
  requested_at: string | null;
  decided_at: string | null;
  // 解決済み名称（LINE Harnessが付加する場合）
  menu_name?: string | null;
  staff_name?: string | null;
  customer_name?: string | null;
}

// LINE Harness Admin API レスポンス
export interface LHMenu {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_after_minutes: number;
  base_price: number;
  is_active: boolean;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export type Env = {
  DB: D1Database;
  LINE_HARNESS_API_URL: string;
  LINE_HARNESS_ADMIN_TOKEN: string;
  LINE_HARNESS_WEBHOOK_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_STAFF_USER_IDS: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
};
