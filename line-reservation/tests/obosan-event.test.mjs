// 特別イベント区分の条件表示テスト（お坊さんといっしょ／TACOS）
// モックサーバー内蔵・Playwright。実行方法は README.md 参照
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, '..', 'liff', 'reserve.html');
const PORT = 8791;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const FIXED_NOW = new Date('2026-08-01T09:00:00+09:00');

// シナリオごとに差し替えるモックデータ
const obosanSession = {
  id: '2026-08-29-obosan', date: '2026-08-29', display_date: '8/29（土）夕方',
  title: 'お坊さんといっしょ。初めての瞑想と写経体験',
  food: '', note: '参加費¥3,000（写経用紙代込み）', morning_run: 0,
  remaining: 10, base_remaining: 10, trainers: null, time_label: '17:00〜19:00',
};
const morningSession = {
  id: '2026-08-16', date: '2026-08-16', display_date: '8/16', title: '朝ヨガ',
  food: '', note: '', morning_run: 0, remaining: 5, base_remaining: 5, trainers: null,
};
let currentSessions = [];
let lastPostBody = null;

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
    } else if (url === '/api/liff/reservations' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        lastPostBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          reservations: lastPostBody.session_ids.map(id => ({ session_id: id })),
          failed: [],
        }));
      });
    } else {
      res.writeHead(404); res.end();
    }
  });
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const server = await startMockServer();
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.clock.setFixedTime(FIXED_NOW);
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  // ── シナリオ1: 朝クラスのみ（特別イベントなし） ──
  currentSessions = [morningSession];
  await page.goto(`http://127.0.0.1:${PORT}/liff/reserve`);
  await page.waitForSelector('#app', { state: 'visible', timeout: 10000 });

  check('イベントなし: 瞑想区分が表示されない', !(await page.locator('#cat-obosan').isVisible()));
  check('イベントなし: TACOS区分が表示されない', !(await page.locator('#cat-tacos').isVisible()));

  // ── シナリオ2: 瞑想イベントが受付中 ──
  currentSessions = [morningSession, obosanSession];
  await page.goto(`http://127.0.0.1:${PORT}/liff/reserve`);
  await page.waitForSelector('#app', { state: 'visible', timeout: 10000 });

  const obosanLabel = page.locator('#cat-obosan');
  check('瞑想イベントあり: 瞑想区分が表示される', await obosanLabel.isVisible());
  const labelText = await obosanLabel.textContent();
  check('瞑想区分に料金「¥3,000・写経用紙代込み」がある', labelText.includes('¥3,000・写経用紙代込み'));
  check('瞑想区分にキャンセル注意（前日以降・用紙代¥1,000）がある',
    labelText.includes('前日以降') && labelText.includes('¥1,000'));
  check('TACOSセッションが無ければTACOS区分は出ない', !(await page.locator('#cat-tacos').isVisible()));

  const card = page.locator(`#sessions-list [data-id="${obosanSession.id}"]`);
  check('イベントカードに開催時間タグ「17:00〜19:00」が出る',
    (await card.textContent()).includes('17:00〜19:00'));

  // ── シナリオ3: 瞑想イベントを選んで予約送信 ──
  await card.click();
  await page.locator('input[name="category"][value="瞑想"]').check();
  await page.locator('#btn-submit').click();
  await page.waitForSelector('#complete', { state: 'visible', timeout: 10000 });

  check('送信ボディ: category=瞑想・対象セッションIDが入る',
    lastPostBody?.category === '瞑想' &&
    JSON.stringify(lastPostBody?.session_ids) === JSON.stringify(['2026-08-29-obosan']));
  const completeText = await page.locator('#complete').textContent();
  check('完了画面: 特別枠の文言（当日のご来場）と開催時間が出る',
    completeText.includes('当日のご来場') && completeText.includes('17:00〜19:00'));
  check('完了画面: 朝クラスの定型文（動きやすい服装）が出ない',
    !completeText.includes('動きやすい服装'));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n合計: ${results.length}項目中 ${results.length - failed}件 合格`);
  process.exit(failed ? 1 : 0);
})();
