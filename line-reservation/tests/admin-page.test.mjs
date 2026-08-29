// 管理画面（/api/admin/reservations）とログインページ（/admin-login）のHTML生成テスト
// renderAdminReservations にモックデータを渡し、表示内容と安全性を検証する
import { renderAdminReservations } from '../src/admin-page.js';
import { renderAdminLogin } from '../src/admin-login-page.js';
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
      // bentoは「セッションID:メニュー名」のカンマ結合。複数日程の同時予約を再現
      // （2026-07-12のぶんはこのカードでは数えられないことを検証する）
      reservations: [
        { display_name: '過去の参加者', category: '会員', trainer: null, morning_run: '参加したい',
          bento: '2026-07-05:サラダビビンそば,2026-07-12:カオマンガイ', tacos: null, message: null, created_at: '2026-07-01T03:00:00Z' },
        { display_name: 'ふたりめ', category: 'ビジター', trainer: null, morning_run: null,
          bento: null, tacos: null, message: null, created_at: '2026-07-02T03:00:00Z' },
      ],
      cancelled_people: [
        { display_name: 'やめた花子', cancelled_at: null }, // 旧データ（migration前）→ 日時不明
      ] },
    { id: '2026-07-12', date: '2026-07-12', display_date: '7/12（日）', title: 'LEAN BODY TRAINING', time_label: null,
      is_open: 0, note: '<b>タグ入り備考</b>',
      capacity: 10, extra_slots: 3, booked: 3, cancelled: 1,
      reservations: [
        { display_name: 'テスト太郎', category: '回数券', trainer: null, morning_run: 'join',
          bento: '2026-07-12:カオマンガイ', tacos: null, message: '初参加です', created_at: '2026-07-06T12:34:00Z' },
        { display_name: '<script>alert(1)</script>', category: '会員', trainer: null, morning_run: 'decide',
          bento: '2026-07-12:カオマンガイ', tacos: null, message: null, created_at: '2026-07-06T13:00:00Z' },
        { display_name: '花子', category: 'TACOS', trainer: null, morning_run: null,
          bento: null, tacos: null, message: null, created_at: '2026-07-06T14:00:00Z' },
      ],
      cancelled_people: [
        { display_name: 'とりけし次郎', cancelled_at: '2026-07-06T12:03:00Z' }, // JST 7/6 21:03
      ] },
    // 1日に2品を並べる回（2026-09の みどり担当日で初めて使う形）。
    // 品目ごとに個数が分かれて出ないと、シェフが仕込む数を読み違える
    { id: '2026-07-26', date: '2026-07-26', display_date: '7/26（日）', title: 'わっぱ弁当2種の日', time_label: null,
      capacity: 10, extra_slots: 3, booked: 3, cancelled: 0,
      reservations: [
        { display_name: 'おむすび希望', category: '都度', trainer: null, morning_run: null,
          bento: '2026-07-26:新米おむすびわっぱ弁当', tacos: null, message: null, created_at: '2026-07-20T03:00:00Z' },
        { display_name: 'さんま希望', category: '都度', trainer: null, morning_run: null,
          bento: '2026-07-26:さんまの炊き込みわっぱ弁当', tacos: null, message: null, created_at: '2026-07-20T04:00:00Z' },
        { display_name: '両方たのむ人', category: '都度', trainer: null, morning_run: null,
          bento: '2026-07-26:新米おむすびわっぱ弁当,2026-07-26:さんまの炊き込みわっぱ弁当',
          tacos: null, message: null, created_at: '2026-07-20T05:00:00Z' },
      ] },
    { id: '2026-07-19-tacos', date: '2026-07-19', display_date: '7/19（日）午後', title: 'TACOS Party（午後の部）', time_label: '12:00〜21:00',
      capacity: 10, extra_slots: 3, booked: 13, cancelled: 0,
      reservations: Array.from({ length: 13 }, (_, i) => (
        { display_name: `ゲスト${i + 1}`, category: 'TACOS', trainer: null, morning_run: null, message: null, created_at: '2026-07-06T10:00:00Z' }
      )) },
  ],
  trials: [
    { id: 'trial-1', display_name: '体験希望さん', trainer: 'GO', preferred_date: '2026-07-15', preferred_time: '午前', alt_note: '夕方でも可', created_at: '2026-07-06T09:00:00Z' },
    // 第1希望日が過ぎてしまい、スタッフが希望日を書き換えたあとの行
    { id: 'trial-2', display_name: '日程変更さん', trainer: 'お任せ', preferred_date: '2026-07-20', preferred_time: '午後（15:00〜18:00）',
      alt_note: null, kind: 'journey_trial7', created_at: '2026-07-01T09:00:00Z', updated_at: '2026-07-07T02:15:00Z', updated_by: 'env-owner' },
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

// ── 第1弾: キャンセル可視化＋集計行 ──
check('キャンセル者が名前（取り消し線）＋日時つきで表示される',
  html.includes('キャンセル 1名') && html.includes('<s>とりけし次郎</s>（7/6 21:03）'));
check('cancelled_atがNULLの旧データは「日時不明」と表示される',
  html.includes('<s>やめた花子</s>（日時不明）'));
check('お弁当の集計が日程ごとに出る（他日程ぶんは混ざらない）',
  html.includes('🍱 サラダビビンそば×1') && html.includes('🍱 カオマンガイ×2') && !html.includes('カオマンガイ×3'));
check('1日に2品ある回は、品目ごとに個数が分かれて出る',
  html.includes('🍱 新米おむすびわっぱ弁当×2') && html.includes('🍱 さんまの炊き込みわっぱ弁当×2'));
check('1人が2品たのんだ場合も両方数えられる',
  html.includes('両方たのむ人'));

check('朝RUNの集計（join＋当日決め）が出る',
  html.includes('🏃 朝RUN 1名（＋当日決め1）'));
check('TACOSの人数集計が出る', html.includes('🌮 TACOS 13名'));
check('朝RUNバッジがjoin値で表示される（従来は日本語比較で常に非表示のバグ）',
  html.includes('🏃朝RUN'));
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

// ── 第2弾: 体験リクエストの確定/不成立 ──
check('体験リクエストに確定/不成立ボタンが出る（idつき）',
  html.includes('data-trial-id="trial-1"') && html.includes('✅ 確定にする') && html.includes('✖ 不成立にする'));
check('画面JSがX-CSRF-Tokenヘッダを付けてPOSTする',
  html.includes("'X-CSRF-Token'") && html.includes('/api/admin/trials/'));
check('確認ダイアログで自動送信されないことを明示する',
  html.includes('お客様への連絡は自動送信されません'));
check('confirm/declineルートが /api/admin/ 配下（認証必須）にある',
  /\.post\(\s*'\/api\/admin\/trials\/:id\/confirm'/.test(routesSrc) &&
  /\.post\(\s*'\/api\/admin\/trials\/:id\/decline'/.test(routesSrc));
check('二重処理防止: UPDATEに AND status = \'pending\' ガードがある',
  /UPDATE trial_requests SET[\s\S]*?WHERE id = \? AND status = 'pending'/.test(routesSrc));

// ── 第4弾: 体験リクエストの希望日変更（スタッフが管理画面で書き換える） ──
// 「変更済み」の印は編集ボタンより前に出るため、行の先頭（<li>）から切り出す
const trialRow = (id) => {
  const li = html.split('<li class="person">').find(c => c.includes('data-trial-form="' + id + '"')) || '';
  return li.split('</li>')[0];
};
check('確定待ちの行に「希望日を変更」ボタンと変更フォームが出る',
  html.includes('data-trial-edit="trial-1"') && html.includes('📅 希望日を変更') &&
  html.includes('data-trial-form="trial-1"'));
check('変更フォームに現在の希望日がプリフィルされる',
  trialRow('trial-1').includes('type="date" value="2026-07-15"'));
check('時間帯は4区分から選ぶ（LIFFの選択肢と同じ）',
  ['午前（9:00〜12:00）', '昼（12:00〜15:00）', '午後（15:00〜18:00）', '夜（18:00〜21:00）']
    .every(t => trialRow('trial-1').includes('<option value="' + t + '"')));
check('4区分に無い既存の時間帯も選択肢に残る（日付だけ直すつもりで時間帯が変わらない）',
  trialRow('trial-1').includes('<option value="午前" selected>'));
check('4区分の値はそのまま選択状態になる（重複して増えない）',
  trialRow('trial-2').includes('<option value="午後（15:00〜18:00）" selected>') &&
  (trialRow('trial-2').match(/<option value="午後（15:00〜18:00）"/g) || []).length === 1);
check('変更フォームは初期状態では閉じている（誤操作防止）',
  /<form class="trial-edit" hidden/.test(html));
check('自動送信されないことをフォーム内にも明示する',
  html.includes('連絡は自動送信されないので、変更後にLINEでお伝えください'));
check('スタッフが変更済みの行にはその印と日時が出る',
  trialRow('trial-2').includes('✏️ 7/7 11:15 スタッフが希望日を変更') &&
  !trialRow('trial-1').includes('スタッフが希望日を変更'));
check('希望日変更ルートが /api/admin/ 配下（認証必須）にある',
  /\.post\(\s*'\/api\/admin\/trials\/:id'/.test(routesSrc));
check('希望日変更も確定済みには効かない（UPDATEに pending ガード）',
  /UPDATE trial_requests SET preferred_date = \?, preferred_time = \?[\s\S]*?WHERE id = \? AND status = 'pending'/.test(routesSrc));
check('第2希望・ご要望（お客様の記録）は書き換え対象に入っていない',
  !/UPDATE trial_requests SET[^;]*alt_note = \?/.test(routesSrc));
check('日程変更が操作ログに残る（変更前後つき）',
  /logAdminOp\(c, 'trial_reschedule'/.test(routesSrc));

// ── 第3弾: 開催日の登録・編集 ──
check('開催日管理フォームが出る（日付・クラス名・定員・お弁当）',
  html.includes('id="session-form"') && html.includes('id="sf-date"') &&
  html.includes('id="sf-capacity"') && html.includes('id="sf-bento"'));
check('今後の開催カードにだけ編集/締切/削除ボタンが出る（過去カードには出ない）',
  // 件数だけを数えると日程を1つ足すたびに落ちるので、どの日程に出ているかで見る。
  // 今日は 2026-07-07。7/5 は過去、7/12・7/19・7/26 が今後
  ['2026-07-12', '2026-07-19-tacos', '2026-07-26'].every(id => html.includes(`data-session-edit="${id}"`)) &&
  !html.includes('data-session-edit="2026-07-05"') &&
  (html.match(/data-session-edit="/g) || []).length === 3);
check('受付停止中の日程にバッジと「受付再開」が出る',
  html.includes('受付停止中') && html.includes('▶️ 受付再開'));
check('編集用データがscript安全にJSON埋め込みされる（<が\\u003cにエスケープ）',
  html.includes('const ADMIN_SESSIONS') && html.includes('\\u003cb>タグ入り備考'));
check('sessionsルートが /api/admin/ 配下（認証必須）にある',
  /\.post\(\s*'\/api\/admin\/sessions'/.test(routesSrc) &&
  /\.post\(\s*'\/api\/admin\/sessions\/:id'/.test(routesSrc) &&
  /\.post\(\s*'\/api\/admin\/sessions\/:id\/delete'/.test(routesSrc));
check('削除は予約が1件でもあれば拒否（DELETE自体にNOT EXISTSガード）',
  /DELETE FROM sessions[\s\S]*?NOT EXISTS \(SELECT 1 FROM reservations/.test(routesSrc));
check('更新はホワイトリスト方式で日付(id)を変更できない',
  !/sets\.push\('date/.test(routesSrc) && !/sets\.push\('id/.test(routesSrc));

// ── 小改善: 弁当を個人行にも表示（オーナー要望） ──
const rowOf = (name) => (html.match(new RegExp(name + '[\\s\\S]*?</li>')) || [''])[0];
check('個人行に本人の弁当が出る（他の日程の弁当は混ざらない）',
  rowOf('過去の参加者').includes('🍱 サラダビビンそば') && !rowOf('過去の参加者').includes('カオマンガイ'));
check('個人行の弁当の合計が集計行（🍱×N）と一致する',
  (html.match(/🍱 カオマンガイ<\/span>/g) || []).length === 2 && html.includes('🍱 カオマンガイ×2'));
check('弁当なしの人の行に🍱が出ない',
  !rowOf('ふたりめ').includes('🍱'));

// ── ログインページ（/admin-login）の検証 ──
// このページは意図的に無認証（APIキー入力欄のみ・個人情報なし）。
const loginHtml = renderAdminLogin();
check('ログインページ: /admin-login ルートが配線されている',
  /\.get\(\s*'\/admin-login'/.test(routesSrc));
check('ログインページ: 既存の /api/auth/login にPOSTする（apiKey項目）',
  loginHtml.includes("fetch('/api/auth/login'") && loginHtml.includes('apiKey'));
check('ログインページ: 成功時に管理画面へ遷移する',
  loginHtml.includes("location.href = '/api/admin/reservations'"));
check('ログインページ: 入力はパスワード型（キーが画面に見えない）',
  loginHtml.includes('type="password"'));
check('ログインページ: APIキーやcookie値がHTMLに埋め込まれていない',
  !/lh_admin_session=|Bearer\s+[A-Za-z0-9]/.test(loginHtml));
check('ログインページ: noindexが入っている',
  loginHtml.includes('name="robots" content="noindex"'));

// ── 見た目のスクリーンショット ──
const htmlPath = path.join(__dirname, 'admin-preview.html');
writeFileSync(htmlPath, html);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 1500 } });
await page.goto('file://' + htmlPath);
await page.screenshot({ path: path.join(__dirname, 'admin-ui.png'), fullPage: true });

// ── 実ブラウザでの動作確認: 希望日の変更フォーム ──
// HTMLの文字列検査だけでは通ってしまう不具合（.trial-edit の display 指定が
// [hidden] に勝って開きっぱなしになる／画面JSの文法エラーでボタンが無反応）をここで止める。
// confirm・fetch・location.reload を差し替えられないため、記録は sessionStorage に残して
// リロードをまたいで確認する。
const trialPage = await browser.newPage({ viewport: { width: 390, height: 900 } });
let pageError = '';
trialPage.on('pageerror', (e) => { pageError = e.message; });
await trialPage.addInitScript(() => {
  const log = (k, v) => sessionStorage.setItem(k, v);
  window.confirm = (m) => { log('confirm', m); return true; };
  window.alert = (m) => { log('alert', m); };
  const orig = window.fetch;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u === '/api/auth/session') return new Response('{"csrfToken":"tok123"}', { status: 200 });
    if (u.startsWith('/api/admin/')) {
      log('post', JSON.stringify({ url: u, body: opts?.body, csrf: opts?.headers?.['X-CSRF-Token'] }));
      return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return orig(url, opts);
  };
});
await trialPage.goto('file://' + htmlPath);
check('画面JSに文法エラーがない（ボタンが無反応にならない）', pageError === '', pageError);

const editForm = trialPage.locator('[data-trial-form="trial-1"]');
check('変更フォームは閉じた状態で表示される', await editForm.isHidden());
await trialPage.click('[data-trial-edit="trial-1"]');
check('「希望日を変更」を押すとフォームが開く', await editForm.isVisible());
await trialPage.click('[data-trial-edit-cancel]');
check('「やめる」で閉じる', await editForm.isHidden());

await trialPage.click('[data-trial-edit="trial-1"]');
await trialPage.fill('[data-trial-form="trial-1"] input[type=date]', '2026-09-03');
await trialPage.selectOption('[data-trial-form="trial-1"] select', '午後（15:00〜18:00）');
await trialPage.click('[data-trial-form="trial-1"] button[type=submit]');
await trialPage.waitForTimeout(500);
const sent = await trialPage.evaluate(() => ({
  confirm: sessionStorage.getItem('confirm'),
  post: JSON.parse(sessionStorage.getItem('post') || 'null'),
  alert: sessionStorage.getItem('alert'),
}));
check('確認ダイアログに変更後の日時と「自動送信されません」が出る',
  !!sent.confirm && sent.confirm.includes('2026-09-03（午後（15:00〜18:00））') &&
  sent.confirm.includes('自動送信されません'), sent.confirm || '(出なかった)');
check('変更内容がCSRFトークン付きで /api/admin/trials/:id にPOSTされる',
  !!sent.post && sent.post.url === '/api/admin/trials/trial-1' && sent.post.csrf === 'tok123' &&
  sent.post.body === JSON.stringify({ preferred_date: '2026-09-03', preferred_time: '午後（15:00〜18:00）' }),
  JSON.stringify(sent.post));
check('エラーダイアログは出ない', sent.alert === null, sent.alert || '');
await trialPage.close();
await browser.close();

const fail = results.filter(r => !r.ok).length;
console.log(`\n合計: ${results.length}項目中 ${results.length - fail}件 合格`);
process.exit(fail ? 1 : 0);
