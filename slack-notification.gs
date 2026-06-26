/**
 * HMC 予約フォーム → Slack 通知スクリプト
 *
 * ▶ セットアップ手順
 * 1. Slack Incoming Webhook を作成
 *    https://api.slack.com/messaging/webhooks
 *    「Create an App」→「Incoming Webhooks」→「Add New Webhook to Workspace」
 *    → 投稿先チャンネルを選択 → WebhookURLをコピー
 *
 * 2. スプレッドシートを開く → 拡張機能 → Apps Script
 *    このファイルの内容を貼り付けて保存
 *
 * 3. SLACK_WEBHOOK_URL を書き換える（↓）
 *
 * 4. トリガーを設定
 *    左メニュー「トリガー」→「トリガーを追加」
 *    関数: onFormSubmit
 *    イベント: スプレッドシートから → フォーム送信時
 */

const SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/XXXXX/XXXXX/XXXXXXXXXXXXX'; // ← ここを変更

function onFormSubmit(e) {
  const responses = e.namedValues;
  const timestamp  = e.values[0];

  // Slackメッセージ組み立て
  const fields = [];
  for (const [question, answer] of Object.entries(responses)) {
    if (question === 'タイムスタンプ') continue;
    const ans = Array.isArray(answer) ? answer[0] : answer;
    if (ans && ans.trim() !== '') {
      fields.push({ title: question, value: ans, short: false });
    }
  }

  const payload = {
    username: 'HMC予約Bot',
    icon_emoji: ':calendar:',
    attachments: [
      {
        color: '#C8833A',
        pretext: '*📋 HMC 新しい予約申込が届きました！*',
        fields: fields,
        footer: `受付日時: ${timestamp}`,
        footer_icon: 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico',
      }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const res = UrlFetchApp.fetch(SLACK_WEBHOOK_URL, options);
  Logger.log(`Slack response: ${res.getResponseCode()} ${res.getContentText()}`);
}
