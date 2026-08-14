// 「朝RUNのみ」区分（参加費¥0・7:30のクラスには出ない）のテスト。
// あわせて、廃止した回数券がフォームから消えていることも確認する。
// モックサーバー内蔵・Playwright。実行方法は README.md 参照
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, '..', 'liff', 'reserve.html');
const PORT = 8793;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const FIXED_NOW = new Date('2026-08-14T09:00:00+09:00');

// 朝RUNあり（6:30〜）の日曜クラス
const runSession = {
  id: '2026-08-16', date: '2026-08-16', display_date: '8/16（日）', title: '朝ヨガ',
  food: '', note: '', morning_run: 1, remaining: 5, base_remaining: 5, trainers: null,
};
// 朝RUNなしの日
const noRunSession = {
  id: '2026-08-23', date: '2026-08-23', display_date: '8/23（日）', title: '体幹トレ',
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

  currentSessions = [runSession, noRunSession];
  await page.goto(`http://127.0.0.1:${PORT}/liff/reserve`);
  await page.waitForSelector('#app', { state: 'visible', timeout: 10000 });

  // ── 廃止した回数券が残っていないこと ──
  const bodyHtml = await page.content();
  check('回数券の参加区分が無い', !bodyHtml.includes('回数券'));
  check('「今月の開催日をまとめて選択」ボタンが無い',
    (await page.locator('#select-month-btn').count()) === 0);

  // ── 新しい参加区分が出ていること ──
  check('「朝RUNのみ」区分がある',
    (await page.locator('input[name="category"][value="朝RUNのみ"]').count()) === 1);
  check('「ご利用中の方」区分がある（旧「会員」から改称）',
    (await page.locator('input[name="category"][value="ご利用中の方"]').count()) === 1);
  check('「都度」区分がある（旧「ビジター」から改称）',
    (await page.locator('input[name="category"][value="都度"]').count()) === 1);
  check('月額プラン2種（HMC会員・セミパ会員）の区分がある',
    (await page.locator('input[name="category"][value="HMC会員"]').count()) === 1 &&
    (await page.locator('input[name="category"][value="セミパ会員"]').count()) === 1);
  const runLabel = await page.locator('input[name="category"][value="朝RUNのみ"]')
    .locator('xpath=..').textContent();
  check('「朝RUNのみ」に参加費¥0と明記がある', runLabel.includes('¥0'));

  // ── 朝RUNのみを選ぶと、朝RUN参加の質問は聞かずに「参加する」で確定する ──
  const runCard = page.locator(`#sessions-list [data-id="${runSession.id}"]`);
  await runCard.click();
  check('朝RUN開催日を選ぶと朝RUNの質問が出る',
    await page.locator('#morning-run-section').isVisible());

  await page.locator('input[name="category"][value="朝RUNのみ"]').check();
  check('朝RUNのみを選ぶと朝RUNの質問が隠れる',
    !(await page.locator('#morning-run-section').isVisible()));
  check('朝RUNのみを選ぶと morning_run が自動で「参加する」になる',
    await page.locator('input[name="morning_run"][value="join"]').isChecked());

  // ── ガード: 朝RUNの無い日に「朝RUNのみ」は使えない ──
  const noRunCard = page.locator(`#sessions-list [data-id="${noRunSession.id}"]`);
  await noRunCard.click(); // 朝RUNなしの日も追加で選ぶ
  await page.locator('#btn-submit').click();
  check('ガード: 朝RUN非開催日を含めて送信するとエラーになり送信されない',
    (await page.locator('#form-error').isVisible()) && lastPostBody === null);

  // ── 正常系: 朝RUN開催日のみで送信 ──
  await noRunCard.click(); // 朝RUNなしの日を外す
  await page.locator('#btn-submit').click();
  await page.waitForSelector('#complete', { state: 'visible', timeout: 10000 });

  check('送信ボディ: category=朝RUNのみ・morning_run=join',
    lastPostBody?.category === '朝RUNのみ' && lastPostBody?.morning_run === 'join');
  check('送信ボディ: 対象は朝RUN開催日だけ',
    JSON.stringify(lastPostBody?.session_ids) === JSON.stringify([runSession.id]));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n合計: ${results.length}項目中 ${results.length - failed}件 合格`);
  process.exit(failed ? 1 : 0);
})();
