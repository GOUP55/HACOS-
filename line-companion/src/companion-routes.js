// HACOSコンパニオン（S級① Phase 1）— LINE寄り添いAIのWorkerモジュール
// 人格の正本: drafts/companion-persona.md → build_companion_prompt.py → companion-prompt.js
// 統合方法: ハーネスのwebhook処理に handleCompanionEvent() を1行差し込む（README参照）

import { COMPANION_SYSTEM_PROMPT } from './companion-prompt.js';

// ── 安全層1: 即転送キーワード（AIを通さない・§8の固定文で返す・スタッフ即時通知）──
// 誤検知は「人間に繋がる」側に倒れるため許容する設計。
const URGENT_RULES = [
  {
    category: '希死念慮',
    re: /死にたい|死のう|死んだほうが|死んだ方が|消えたい|消えてしまいたい|いなくなりたい|自殺|楽になりたい/,
    reply: (env) =>
      '話してくれてありがとうございます。あなたのことがとても心配です。今すぐGOに共有します。ひとりにしません。' +
      (env.CRISIS_HOTLINE_TEXT ? `\nつらさが強いときは、こちらにも繋がれます：${env.CRISIS_HOTLINE_TEXT}` : '') +
      '\n夜でも遠慮なく、ここに言葉を置いていってください。',
  },
  {
    category: '胸痛・しびれ',
    re: /胸が痛|胸の痛|胸が苦し|胸が締め付け|しびれ|痺れ/,
    reply: () =>
      '教えてくれてありがとうございます。胸の痛みやしびれは私では判断できないので、まず医療機関に相談してください。GOにも今すぐ共有します。無理は絶対にしないでくださいね。',
  },
  {
    category: '服薬・持病',
    re: /薬を飲んで|服薬|持病|通院中/,
    reply: () =>
      '大切なご質問なので、私からはお答えできません。かかりつけの先生に確認していただけますか🌿 その内容をGOに共有してもらえたら、無理のない形を一緒に考えます。',
  },
  {
    category: '妊娠・産後',
    re: /妊娠|産後/,
    reply: () =>
      'まずは体を大切に🌿 運動については必ず主治医に確認してください。GOにも共有して、今後のことはゆっくり相談しましょう。',
  },
  {
    category: '摂食不安・嘔吐',
    re: /食べるのが怖|食べたら太る気がして|吐いて|吐いた|吐きそう|嘔吐|戻してしま/,
    reply: () =>
      '打ち明けてくれてありがとうございます。それは体と心からの大事なサインかもしれません。GOにすぐ共有しますね。責めることは何もないので、安心してください🌿',
  },
  {
    category: '極端な絶食',
    // 16時間断食・プチ断食はHACOSが案内する範囲（2026-07-08 GO決定）なので通常会話へ。
    // 危険ライン＝絶食・「何も食べない」・日数のつく断食（3日断食 等）だけ緊急扱い
    re: /絶食|何も食べない|何も食べてない|[0-9０-９]+日[^、。]{0,4}断食|断食[^、。]{0,4}[0-9０-９]+日/,
    reply: () =>
      '止めさせてください。長時間の絶食は体に危険が及ぶことがあり、リバウンドも起きやすい方法です。やる前にGOと話しましょう。すぐ共有しますね🌿',
  },
  {
    category: 'けが',
    re: /ひねっ|捻っ|捻挫|骨折|けがを|怪我|痛めて|痛めた/,
    reply: () =>
      'それは痛かったですね。腫れや痛みが強いなら、まず受診してください。予約のことは気にしなくて大丈夫、こちらで調整します🌿 お大事に。',
  },
  {
    category: '深刻な落ち込み',
    re: /何もかも嫌|全部嫌になり|生きて(る|いる)意味/,
    reply: () =>
      'つらい中で送ってくれてありがとうございます。あなたのことが心配です。GOにすぐ共有します。よければ近いうちに直接お話ししませんか。ひとりにはしませんから🌿',
  },
];

export function checkUrgent(text) {
  for (const rule of URGENT_RULES) {
    if (rule.re.test(text)) return rule;
  }
  return null;
}

// ── β会員フィルタ（COMPANION_BETA_IDS: カンマ区切りのline_user_id）──
export function isBetaUser(userId, env) {
  if (!env.COMPANION_BETA_IDS) return false;
  return env.COMPANION_BETA_IDS.split(',').map((s) => s.trim()).filter(Boolean).includes(userId);
}

// ── LINE API ──
async function replyToLine(replyToken, text, env) {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
    if (!res.ok) console.error('companion reply failed:', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e) {
    console.error('companion reply exception:', e?.message);
    return false;
  }
}

async function notifyStaff(text, env) {
  const ids = (env.STAFF_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const to of ids) {
    try {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
      });
      if (!res.ok) console.error('companion staff push failed:', res.status);
    } catch (e) {
      // 1人への送信失敗で残りのスタッフへの通知を止めない
      console.error('companion staff push exception:', e?.message);
    }
  }
}

// ── D1ログ（GOレビューと会話文脈の両方に使う）──
async function logMessage(env, userId, role, message, { topic = null, urgent = 0, escalated = 0 } = {}) {
  await env.DB.prepare(
    'INSERT INTO companion_logs (line_user_id, role, message, topic, urgent, escalated) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId, role, message, topic, urgent, escalated).run();
}

async function getRecentHistory(env, userId, limit = 6) {
  const { results } = await env.DB.prepare(
    "SELECT role, message FROM companion_logs WHERE line_user_id = ? AND role IN ('user','assistant') ORDER BY id DESC LIMIT ?"
  ).bind(userId, limit).all();
  const rows = (results || []).reverse().map((r) => ({
    role: r.role === 'assistant' ? 'assistant' : 'user',
    content: r.message,
  }));
  // Anthropic APIの制約（userで開始・user/assistant厳密交互）に合わせて正規化:
  // 先頭のassistantを落とし、同じroleの連続は結合する（連投時の競合対策）
  const norm = [];
  for (const m of rows) {
    if (norm.length === 0 && m.role === 'assistant') continue;
    const last = norm[norm.length - 1];
    if (last && last.role === m.role) last.content += '\n' + m.content;
    else norm.push({ ...m });
  }
  return norm;
}

// ── Claude API 呼び出し ──
// 返答はJSON {"reply": "...", "escalate": true/false, "topic": "食事報告"} を指示。
// パース失敗時は全文をreplyとして扱う（会員に生JSONやエラーを見せない）。
export function parseModelOutput(raw) {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no json');
    const obj = JSON.parse(m[0]);
    if (typeof obj.reply !== 'string' || !obj.reply.trim()) throw new Error('no reply');
    return { reply: obj.reply.trim(), escalate: !!obj.escalate, topic: obj.topic || null };
  } catch {
    return { reply: raw.trim(), escalate: false, topic: null };
  }
}

async function callClaude(userText, history, env) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.COMPANION_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: [{ type: 'text', text: COMPANION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [...history, { role: 'user', content: userText }],
      }),
    });
    if (!res.ok) {
      console.error('companion claude api failed:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    const raw = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return parseModelOutput(raw);
  } catch (e) {
    // fetch自体の失敗（ネットワーク断など）もHTTPエラーと同じ経路（固定文フォールバック）に合流させる
    console.error('companion claude api exception:', e?.message);
    return null;
  }
}

// APIやパースに失敗したときの固定文（会員に技術的エラーを見せない）
const FALLBACK_REPLY =
  'メッセージ、ちゃんと受け取りました🌿 いま少し確認したいことがあるので、あらためてスタッフからお返事しますね。';

// ── 本体: webhookイベント処理 ──
// 戻り値 true = コンパニオンが処理した（ハーネスの通常自動応答をスキップしてよい）
// 戻り値 false = 対象外（既存の自動応答ルールにそのまま流す）
export async function handleCompanionEvent(event, env) {
  if (event?.type !== 'message' || event?.message?.type !== 'text') return false;
  const userId = event?.source?.userId;
  if (!userId || !isBetaUser(userId, env)) return false;

  const text = event.message.text;

  // 安全層1: 即転送（AIを通さない・稼働時間に関係なく即時通知）
  // 【最重要】スタッフ通知を最初に発射する。返信やログが失敗しても通知だけは必ず飛ばす
  const urgent = checkUrgent(text);
  if (urgent) {
    const notifyP = notifyStaff(
      `⚠️ コンパニオン緊急【${urgent.category}】\n会員ID末尾: …${userId.slice(-6)}\n本文: ${text}\n（固定文で応答済み。至急ご確認ください）`,
      env
    ).catch((e) => console.error('companion urgent notify failed:', e?.message));
    try {
      const reply = urgent.reply(env);
      await logMessage(env, userId, 'user', text, { topic: urgent.category, urgent: 1, escalated: 1 });
      await replyToLine(event.replyToken, reply, env);
      await logMessage(env, userId, 'assistant', reply, { topic: urgent.category, urgent: 1, escalated: 1 });
    } catch (e) {
      console.error('companion urgent path failed (notify still sent):', e?.message);
    }
    await notifyP;
    return true;
  }

  // 通常応答: 直近の文脈つきでClaudeへ
  try {
    const history = await getRecentHistory(env, userId);
    const out = await callClaude(text, history, env);

    if (!out) {
      await logMessage(env, userId, 'user', text, { topic: 'api_error' });
      await replyToLine(event.replyToken, FALLBACK_REPLY, env);
      await logMessage(env, userId, 'assistant', FALLBACK_REPLY, { topic: 'api_error', escalated: 1 });
      await notifyStaff(`🤖 コンパニオンAPIエラー: 会員…${userId.slice(-6)} への返信が固定文になりました。ログを確認してください。`, env);
      return true;
    }

    // escalate時はuser行にもフラグを付ける（GOが escalated=1 で発端の発言まで辿れるように）
    await logMessage(env, userId, 'user', text, { escalated: out.escalate ? 1 : 0 });
    await replyToLine(event.replyToken, out.reply, env);
    await logMessage(env, userId, 'assistant', out.reply, { topic: out.topic, escalated: out.escalate ? 1 : 0 });

    // 安全層2: モデル自己申告のエスカレーション
    if (out.escalate) {
      await notifyStaff(`🔔 コンパニオン相談あり【${out.topic || '分類なし'}】\n会員ID末尾: …${userId.slice(-6)}\n本文: ${text}\n返答: ${out.reply}`, env);
    }
    return true;
  } catch (e) {
    // 予期しない失敗でも会員を無応答にせず、スタッフに知らせる
    console.error('companion handler failed:', e?.message);
    try { await replyToLine(event.replyToken, FALLBACK_REPLY, env); } catch {}
    try { await notifyStaff(`🤖 コンパニオン内部エラー: 会員…${userId.slice(-6)}。ログを確認してください。`, env); } catch {}
    return true;
  }
}

// ── 日次ダイジェスト（既存のscheduledハンドラから1行で呼ぶ・JST18時の既存cronに相乗り）──
export async function sendCompanionDigest(env) {
  const { results } = await env.DB.prepare(
    "SELECT role, urgent, escalated, COUNT(*) AS n FROM companion_logs WHERE created_at >= datetime('now', '-1 day') GROUP BY role, urgent, escalated"
  ).all();
  const rows = results || [];
  if (rows.length === 0) return; // 会話ゼロの日は送らない
  const userMsgs = rows.filter((r) => r.role === 'user').reduce((a, r) => a + r.n, 0);
  const urgentN = rows.filter((r) => r.urgent === 1 && r.role === 'user').reduce((a, r) => a + r.n, 0);
  const escalatedN = rows.filter((r) => r.escalated === 1 && r.urgent === 0 && r.role === 'assistant').reduce((a, r) => a + r.n, 0);
  await notifyStaff(
    `🌿 コンパニオン日次レポート\n直近24時間の会員メッセージ: ${userMsgs}件\n緊急転送: ${urgentN}件 ／ 相談エスカレーション: ${escalatedN}件\n（全文ログはD1のcompanion_logsで確認できます）`,
    env
  );
}

// ── 動作確認用の最小ルート（/api/liff/ 配下＝認証不要パス）──
export function registerCompanionRoutes(app) {
  app.get('/api/liff/companion/health', (c) =>
    c.json({ ok: true, feature: 'hacos-companion', phase: 'beta' })
  );
}
