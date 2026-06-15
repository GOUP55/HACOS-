import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HACOS 管理',
  description: 'LINE Harness 予約管理ダッシュボード',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
