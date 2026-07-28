import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = '/home/user/HACOS-/line-reservation/liff/reserve.html';
const PORT = 8795;
const CHROMIUM = '/opt/pw-browsers/chromium';

const obosanSession = {
  id: '2026-08-29-obosan', date: '2026-08-29', display_date: '8/29（土）夕方',
  title: 'お坊さんといっしょ。初めての瞑想と写経体験',
  food: '', note: '参加費¥3,000（写経用紙代込み）／ストレッチ30分→瞑想30分→写経60分／講師：宗林寺・岡田隆弘僧正／持ち物不要・楽な服装で／写経は途中で帰ってもOK ※開催前日以降のキャンセルは用紙代¥1,000をいただきます', morning_run: 0,
  remaining: 10, base_remaining: 10, trainers: null, time_label: '17:00〜19:00',
};
const morningSession = {
  id: '2026-08-16', date: '2026-08-16', display_date: '8/16', title: '朝ヨガ',
  food: 'カオマンガイ', note: '', morning_run: 1, remaining: 5, base_remaining: 5, trainers: null,
};
let currentSessions = [morningSession, obosanSession];

function startMockServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/liff/reserve') {
      let html = fs.readFileSync(HTML_PATH, 'utf8');
      html = html.replace("'__LIFF_ID__'", "'TEST-LIFF-ID'");
      html = html.replace(
        /<script charset="utf-8" src="https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js"><\/script>/,
        '<script>window.liff = { init: async () => {}, isLoggedIn: () => true, ' +
        'getProfile: async () => ({ userId: "U-test", displayName: "テスト太郎" }), ' +
        'getIDToken: async () => "test-token", closeWindow: () => {} };</script>'
      );
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else if (url === '/api/liff/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions: currentSessions }));
    } else if (url === '/api/liff/reservations' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reservations: [] }));
    } else {
      res.writeHead(404); res.end();
    }
  });
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

(async () => {
  const server = await startMockServer();
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/liff/reserve`);
  await page.waitForSelector('#app', { state: 'visible', timeout: 10000 });
  await page.screenshot({ path: '/tmp/claude-0/-home-user-HACOS-/a3c43dc8-1a00-57a0-bbb0-327b8f721ee8/scratchpad/full.png', fullPage: true });

  // scroll to category section for close-up
  await page.locator('#cat-obosan').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/claude-0/-home-user-HACOS-/a3c43dc8-1a00-57a0-bbb0-327b8f721ee8/scratchpad/category.png' });

  // check horizontal overflow
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log('Horizontal overflow:', overflow, 'scrollWidth vs clientWidth');
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const cw = await page.evaluate(() => document.documentElement.clientWidth);
  console.log('scrollWidth', sw, 'clientWidth', cw);

  console.log('Console/page errors:', JSON.stringify(errors));

  await browser.close();
  server.close();
})();
