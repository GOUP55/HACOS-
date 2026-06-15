// Cloudflare D1 binding の型拡張
interface CloudflareEnv {
  DB: D1Database;
  LINE_HARNESS_API_URL: string;
  LINE_HARNESS_ADMIN_TOKEN: string;
  LINE_HARNESS_WEBHOOK_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_STAFF_USER_IDS: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
}
