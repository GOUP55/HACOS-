// 管理画面（/api/admin/reservations）のHTML生成テスト
// renderAdminReservations にモックデータを渡し、表示内容と安全性を検証する
import { renderAdminReservations } from '../src/admin-page.js';
import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const html = renderAdminReservations({
  todayJst: '2026-07-07',
  sessions: [
    { id: '2026-07-05', date: '2026-07-05', display_date: '7/5（日）', title: 'セルフマッサージ', time_label: null,
      capacity: 10, extra_slots: 3, booked: 2, cancelled: 1,
      reservations: [
        { display_name: '過去の参加者', category: '会員', trainer: null, morning_run: '参加したい', message: null, created_at: '2026-07-01T03:00:00Z' },
        { display_name: 'ふたりめ', category: 'ビジター', trainer: null, morning_run: null, message: null, created_at: '2026-07-02T03:00:00Z' },
      ] },
    { id: '2026-07-12', date: '2026-07-12', display_date: '7/12（日）', title: 'LEAN BODY TRAINING', time_label: null,
      capacity: 10, extra_slots: 3, booked: 3, cancelled: 0,
      reservations: [
        { display_name: 'テスト太郎', category: '回数券', trainer: null, morning_run: '参加したい', message: '初参加です', created_at: '2026-07-06T12:34:00Z' },
        { display_name: '<script>alert(1)</script>', category: '会員', trainer: null, morning_run: null, message: null, created_at: '2026-07-06T13:00:00Z' },
        { display_name: '花子', category: 'TACOS', trainer: null, morning_run: null, message: null, created_at: '2026-07-06T14:00:00Z' },
      ] },
    { id: '2026-07-19-tacos', date: '2026-07-19', display_date: '7/19（日）午後', title: 'TACOS Party（午後の部）', time_label: '12:00〜21:00',
      capacity: 10, extra_slots: 3, booked: 13, cancelled: 0,
      reservations: Array.from({ length: 13 }, (_, i) => (
        { display_name: `ゲスト${i + 1}`, category: 'TACOS', trainer: null, morning_run: null, message: null, created_at: '2026-07-06T10:00:00Z' }
      )) },
  ],
  trials: [
    { display_name: '体験希望さん', trainer: 'GO', preferred_date: '2026-07-15', preferred_time: '午前', alt_note: '夕方でも可', created_at: '2026-07-06T09:00:00Z' },
  ],
});

// ── 内容の検証 ──
check('今後の開催に予約者名が表示される', html.includes('テスト太郎'));
check('区分バッジ（🎫 回数券）が出る', html.includes('🎫 回数券'));
check('メッセージ・朝RUN・予約日時が出る',
  html.includes('初参加です') && html.includes('🏃朝RUN') && html.includes('7/6 21:34 予約'));
check('満席のセッションは 13/10+3 の赤表示になる',
  html.includes('class="count full"') && html.includes('>13<span class="cap">/10+3</span>'));
check('開催時間（time_label）が表示される', html.includes('12:00〜21:00'));
check('体験パーソナルの確定待ちが表示される',
  html.includes('体験希望さん') && html.includes('第1希望 2026-07-15（午前）') && html.includes('夕方でも可'));
check('過去の開催は「過去30日」に折りたたまれる',
  html.includes('過去30日の開催（1件）') && html.includes('過去の参加者'));
check('キャンセル件数が表示される', html.includes('キャンセル 1件'));
check('XSS対策: 表示名のscriptタグが無害化される',
  !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
check('検索エンジン除外（noindex）が入っている', html.includes('name="robots" content="noindex"'));

// ── 認証ガード: 管理画面ルートのパス検証 ──
// ハーネスのauthMiddlewareは「/api/ で始まらないパスは認証スキップ」のため、
// 管理画面を /admin/... のような非APIパスに配線すると個人情報が認証なしで公開される。
// 誰かがうっかり旧パスに戻すのをテストで止める。
const routesSrc = readFileSync(path.join(__dirname, '../src/reservation-routes.js'), 'utf8');
check('管理画面ルートが /api/admin/reservations（認証必須パス）にある',
  /\.get\(\s*'\/api\/admin\/reservations'/.test(routesSrc));
check('非APIの旧パス /admin/reservations にルートが存在しない（認証素通し防止）',
  !/\.(get|post|all)\(\s*'\/admin\//.test(routesSrc));
check('管理画面ルートが公開許可リストの /api/liff/ 配下に置かれていない',
  !/\.get\(\s*'\/api\/liff\/[^']*admin/.test(routesSrc));

// ── 見た目のスクリーンショット ──
const htmlPath = path.join(__dirname, 'admin-preview.html');
writeFileSync(htmlPath, html);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 1500 } });
await page.goto('file://' + htmlPath);
await page.screenshot({ path: path.join(__dirname, 'admin-ui.png'), fullPage: true });
await browser.close();

const fail = results.filter(r => !r.ok).length;
console.log(`\n合計: ${results.length}項目中 ${results.length - fail}件 合格`);
process.exit(fail ? 1 : 0);
