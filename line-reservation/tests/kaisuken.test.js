// 回数券UIの自動テスト（モックサーバー内蔵・Playwright）
// 実行方法は同じフォルダの README.md を参照
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const HTML_PATH = path.join(__dirname, '..', 'liff', 'reserve.html');
const PORT = 8788;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

// ブラウザ内の「今日」をこの日時に固定する（月末でもテストが不安定にならない）
const FIXED_NOW = new Date('2026-07-07T09:00:00+09:00');

// モックデータ: 今月×2（うち1つ満席）、今月の特別枠×1（回数券対象外）、来月×1
// 通常の朝クラスは id === date。特別枠（TACOS Party等）は id にサフィックスが付く
const sessions = [
  { id: '2026-07-12', date: '2026-07-12', display_date: '今月A', title: '朝ヨガ', food: '', note: '', morning_run: 0, remaining: 5, base_remaining: 5, trainers: null },
  { id: '2026-07-19', date: '2026-07-19', display_date: '今月満席', title: 'ピラティス', food: '', note: '', morning_run: 0, remaining: 0, base_remaining: 0, trainers: null },
  { id: '2026-07-26', date: '2026-07-26', display_date: '今月B', title: 'サーキット', food: '', note: '', morning_run: 0, remaining: 2, base_remaining: 2, trainers: null },
  { id: '2026-07-19-tacos', date: '2026-07-19', display_date: '今月特別枠', title: 'TACOS Party', food: '', note: '', morning_run: 0, remaining: 5, base_remaining: 5, trainers: null },
  { id: '2026-08-16', date: '2026-08-16', display_date: '来月', title: '朝ヨガ', food: '', note: '', morning_run: 0, remaining: 5, base_remaining: 5, trainers: null },
];

// ── 本物のWorkerの代わりをするモックサーバー ──
function startMockServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/liff/reserve') {
      let html = fs.readFileSync(HTML_PATH, 'utf8');
      html = html.replace("'__LIFF_ID__'", "'TEST-LIFF-ID'");
      // LINEアプリ外でも動くよう、LIFF SDKをスタブに差し替える
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
      res.end(JSON.stringify({ sessions }));
    } else if (url === '/api/liff/my-reservations') {
      res.writeHead(404); res.end();
    } else {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

// ── テスト本体 ──
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

  await page.goto(`http://127.0.0.1:${PORT}/liff/reserve`);
  await page.waitForSelector('#app', { state: 'visible', timeout: 10000 });

  const radio = page.locator('input[name="category"][value="回数券"]');
  check('参加区分に「回数券」の選択肢がある', await radio.count() === 1);
  const labelText = await radio.locator('xpath=..').textContent();
  check('料金表記「¥2,000／回」がある', labelText.includes('¥2,000／回'));

  const section = page.locator('#kaisuken-section');
  check('最初は「まとめ選択」ボタンが隠れている', !(await section.isVisible()));

  await page.locator('input[name="category"][value="会員"]').check();
  check('「会員」を選んでもボタンは出ない', !(await section.isVisible()));

  await radio.check();
  check('「回数券」を選ぶとボタンが表示される', await section.isVisible());
  const noteText = await section.textContent();
  check('注意書き（繰り越し不可・月途中）がある',
    noteText.includes('繰り越し不可') && noteText.includes('残りの開催回数'));

  await page.locator('#select-month-btn').click();
  const selected = await page.$$eval('#sessions-list .session-card.selected',
    els => els.map(e => e.dataset.id).sort());
  check('今月の空き朝クラスだけが一括選択される',
    JSON.stringify(selected) === JSON.stringify(['2026-07-12', '2026-07-26']),
    `選択された: ${selected.join(', ') || 'なし'}`);
  check('満席・来月分・特別枠（TACOS等）は選ばれない',
    !selected.includes('2026-07-19') && !selected.includes('2026-08-16')
    && !selected.includes('2026-07-19-tacos'));

  const btn = page.locator('#select-month-btn');
  check('ボタンが「✓ 選択しました」表示に変わる',
    (await btn.textContent()).includes('✓') && (await btn.isDisabled()));

  await page.locator('input[name="category"][value="ビジター"]').check();
  check('「ビジター」に戻すとボタンが消える（既存フロー維持）', !(await section.isVisible()));

  // 確認用スクリーンショット（回数券選択状態）
  await radio.check();
  await page.screenshot({ path: path.join(__dirname, 'kaisuken-ui.png') });

  await browser.close();
  server.close();
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n合計: ${results.length}項目中 ${results.length - fail}件 合格`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(2); });
