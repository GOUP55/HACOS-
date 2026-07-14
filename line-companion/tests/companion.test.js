// コンパニオンWorkerモジュールの自動テスト（ネットワーク不要・fetchはモック）
// 実行方法: line-companion/tests で  node companion.test.js
import {
  checkUrgent,
  isBetaUser,
  parseModelOutput,
  handleCompanionEvent,
} from '../src/companion-routes.js';
import { COMPANION_SYSTEM_PROMPT } from '../src/companion-prompt.js';
import assert from 'node:assert';

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}
async function okAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

// ── 1. 即転送キーワード（安全層1）──
ok('緊急: 希死念慮を検知する', () => {
  assert.equal(checkUrgent('もう消えたいです').category, '希死念慮');
  assert.equal(checkUrgent('死にたい').category, '希死念慮');
});
ok('緊急: 胸痛・服薬・妊娠・嘔吐・絶食・けがを検知する', () => {
  assert.equal(checkUrgent('運動中に胸が痛くなった').category, '胸痛・しびれ');
  assert.equal(checkUrgent('血圧の薬を飲んでいます').category, '服薬・持病');
  assert.equal(checkUrgent('妊娠がわかりました').category, '妊娠・産後');
  assert.equal(checkUrgent('食べた後に吐いてしまいます').category, '摂食不安・嘔吐');
  assert.equal(checkUrgent('3日間の断食をします').category, '極端な絶食');
  assert.equal(checkUrgent('足をひねってしまいました').category, 'けが');
});
ok('緊急: QAで見つかった表現ゆれも検知する', () => {
  assert.equal(checkUrgent('死のうと思う').category, '希死念慮');
  assert.equal(checkUrgent('死んだほうがましだと思う').category, '希死念慮');
  assert.equal(checkUrgent('もう楽になりたい').category, '希死念慮');
  assert.equal(checkUrgent('足を捻ってしまいました').category, 'けが');
  assert.equal(checkUrgent('足が痺れます').category, '胸痛・しびれ');
  assert.equal(checkUrgent('嘔吐してしまいました').category, '摂食不安・嘔吐');
  assert.equal(checkUrgent('食べた後、戻してしまいます').category, '摂食不安・嘔吐');
  assert.equal(checkUrgent('胸が締め付けられるように痛いです').category, '胸痛・しびれ');
});
ok('通常メッセージは誤検知しない', () => {
  assert.equal(checkUrgent('今日のお昼はコンビニ弁当でした'), null);
  assert.equal(checkUrgent('筋肉痛がひどいです'), null); // 筋肉痛はAI側（Q30）が対応
  assert.equal(checkUrgent('野菜炒めと玄米にしました'), null);
  assert.equal(checkUrgent('モチベーションが続きません'), null);
  assert.equal(checkUrgent('体重が戻ってしまいました'), null); // 「戻してしま」と区別
});
ok('断食: HACOS案内の範囲は通常会話、危険ラインだけ緊急', () => {
  assert.equal(checkUrgent('プチ断食を試しています'), null);
  assert.equal(checkUrgent('16時間断食やってます'), null);
  assert.equal(checkUrgent('3日間の断食をしようと思います').category, '極端な絶食');
  assert.equal(checkUrgent('断食を5日やります').category, '極端な絶食');
  assert.equal(checkUrgent('今日から絶食します').category, '極端な絶食');
});
ok('緊急固定文: 電話番号は環境変数がある時だけ入る', () => {
  const rule = checkUrgent('消えたい');
  const without = rule.reply({});
  const with_ = rule.reply({ CRISIS_HOTLINE_TEXT: 'よりそいホットライン 0120-XXX-XXX' });
  assert.ok(!without.includes('ホットライン'));
  assert.ok(with_.includes('よりそいホットライン'));
});

// ── 2. β会員フィルタ ──
ok('βフィルタ: 登録IDだけ通す・未設定なら全員拒否', () => {
  const env = { COMPANION_BETA_IDS: 'U001, U002' };
  assert.equal(isBetaUser('U001', env), true);
  assert.equal(isBetaUser('U999', env), false);
  assert.equal(isBetaUser('U001', {}), false);
});

// ── 3. モデル出力のパース（壊れたJSONでも会員にエラーを見せない）──
ok('パース: 正常JSON', () => {
  const r = parseModelOutput('{"reply":"いいですね🌿","escalate":false,"topic":"食事報告"}');
  assert.equal(r.reply, 'いいですね🌿');
  assert.equal(r.escalate, false);
  assert.equal(r.topic, '食事報告');
});
ok('パース: 前後にゴミがあるJSONも拾う', () => {
  const r = parseModelOutput('了解です。{"reply":"おつかれさま🌿","escalate":true,"topic":"弱音"}');
  assert.equal(r.reply, 'おつかれさま🌿');
  assert.equal(r.escalate, true);
});
ok('パース: JSONでない出力は全文をreplyとして扱う', () => {
  const r = parseModelOutput('こんにちは、今日もいい一日を🌿');
  assert.equal(r.reply, 'こんにちは、今日もいい一日を🌿');
  assert.equal(r.escalate, false);
});

// ── 4. システムプロンプト（人格の正本が反映されているか）──
ok('プロンプト: 安全ルールと問答が焼き込まれている', () => {
  assert.ok(COMPANION_SYSTEM_PROMPT.includes('絶対ルール'));
  assert.ok(COMPANION_SYSTEM_PROMPT.includes('Q52')); // QA指摘で追加した過食嘔吐
  assert.ok(COMPANION_SYSTEM_PROMPT.includes('効果を断定しない'));
  assert.ok(COMPANION_SYSTEM_PROMPT.includes('"escalate"') || COMPANION_SYSTEM_PROMPT.includes('escalate'));
  assert.ok(!COMPANION_SYSTEM_PROMPT.includes('未決事項')); // §9（運用メモ）は含めない
});
ok('プロンプト: 未置換プレースホルダが会員向け文面に混ざらない', () => {
  assert.ok(COMPANION_SYSTEM_PROMPT.includes('ハコさん')); // ボット名確定済み
  assert.ok(!COMPANION_SYSTEM_PROMPT.includes('【ボット名】'));
  assert.ok(!COMPANION_SYSTEM_PROMPT.includes('電話番号はGOが'));
  assert.ok(COMPANION_SYSTEM_PROMPT.includes('出力に【】を絶対に含めない'));
});

// ── 5. イベント処理の結合テスト（fetch/D1をモック）──
function mockEnv(calls) {
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { calls.d1.push({ sql, args }); return {}; },
            async all() { calls.d1.push({ sql, args }); return { results: [] }; },
          };
        },
        async all() { calls.d1.push({ sql }); return { results: [] }; },
      };
    },
  };
  return {
    DB: db,
    COMPANION_BETA_IDS: 'Ubeta01',
    STAFF_USER_IDS: 'Ustaff01',
    CHANNEL_ACCESS_TOKEN: 'dummy',
    ANTHROPIC_API_KEY: 'dummy',
  };
}
function mockFetch(calls, claudeText) {
  globalThis.fetch = async (url, opts) => {
    calls.fetch.push({ url, body: JSON.parse(opts.body) });
    if (String(url).includes('api.anthropic.com')) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: claudeText }] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
}
const event = (text, userId = 'Ubeta01') => ({
  type: 'message',
  replyToken: 'rtoken',
  source: { userId },
  message: { type: 'text', text },
});

await okAsync('結合: 非β会員は処理しない（既存の自動応答に流す）', async () => {
  const calls = { fetch: [], d1: [] };
  mockFetch(calls, '');
  const handled = await handleCompanionEvent(event('こんにちは', 'Uother'), mockEnv(calls));
  assert.equal(handled, false);
  assert.equal(calls.fetch.length, 0);
});

await okAsync('結合: 通常メッセージ→Claude呼び出し→返信→ログ2件', async () => {
  const calls = { fetch: [], d1: [] };
  mockFetch(calls, '{"reply":"いい報告ですね🌿","escalate":false,"topic":"食事報告"}');
  const handled = await handleCompanionEvent(event('お昼は野菜炒めでした'), mockEnv(calls));
  assert.equal(handled, true);
  const urls = calls.fetch.map((c) => String(c.url));
  assert.ok(urls.some((u) => u.includes('api.anthropic.com')));
  assert.ok(urls.some((u) => u.includes('/message/reply')));
  assert.ok(!urls.some((u) => u.includes('/message/push'))); // escalate=falseなら通知しない
  const inserts = calls.d1.filter((c) => c.sql.startsWith('INSERT'));
  assert.equal(inserts.length, 2); // user + assistant
});

await okAsync('結合: 緊急キーワード→AIを呼ばず固定文＋スタッフ即時通知', async () => {
  const calls = { fetch: [], d1: [] };
  mockFetch(calls, '');
  const handled = await handleCompanionEvent(event('もう消えたいです'), mockEnv(calls));
  assert.equal(handled, true);
  const urls = calls.fetch.map((c) => String(c.url));
  assert.ok(!urls.some((u) => u.includes('api.anthropic.com'))); // AIを通さない
  assert.ok(urls.some((u) => u.includes('/message/reply')));
  assert.ok(urls.some((u) => u.includes('/message/push'))); // 即時通知
  const push = calls.fetch.find((c) => String(c.url).includes('/message/push'));
  assert.ok(push.body.messages[0].text.includes('緊急'));
});

await okAsync('結合: モデルがescalate=trueならスタッフに通知', async () => {
  const calls = { fetch: [], d1: [] };
  mockFetch(calls, '{"reply":"率直にどうぞ🌿","escalate":true,"topic":"弱音"}');
  await handleCompanionEvent(event('正直やめようか迷っています'), mockEnv(calls));
  const urls = calls.fetch.map((c) => String(c.url));
  assert.ok(urls.some((u) => u.includes('/message/push')));
});

await okAsync('結合: 緊急時、LINE返信が失敗してもスタッフ通知だけは必ず飛ぶ', async () => {
  const calls = { fetch: [], d1: [] };
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/message/reply')) throw new Error('network down');
    calls.fetch.push({ url, body: JSON.parse(opts.body) });
    return new Response('{}', { status: 200 });
  };
  const handled = await handleCompanionEvent(event('もう消えたいです'), mockEnv(calls));
  assert.equal(handled, true);
  assert.ok(calls.fetch.some((c) => String(c.url).includes('/message/push'))); // 通知は生きている
});

await okAsync('結合: API障害時は固定文で返しスタッフに通知（会員にエラーを見せない）', async () => {
  const calls = { fetch: [], d1: [] };
  globalThis.fetch = async (url, opts) => {
    calls.fetch.push({ url, body: JSON.parse(opts.body) });
    if (String(url).includes('api.anthropic.com')) return new Response('overloaded', { status: 529 });
    return new Response('{}', { status: 200 });
  };
  const handled = await handleCompanionEvent(event('今日は玄米にしました'), mockEnv(calls));
  assert.equal(handled, true);
  const reply = calls.fetch.find((c) => String(c.url).includes('/message/reply'));
  assert.ok(reply.body.messages[0].text.includes('スタッフからお返事'));
  assert.ok(calls.fetch.some((c) => String(c.url).includes('/message/push')));
});

console.log(`\n${passed}件のテストに合格${process.exitCode ? '（失敗あり）' : ''}`);
