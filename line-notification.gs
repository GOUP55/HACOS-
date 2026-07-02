/**
 * ⚠️【2026-07-02 方針決定：このスクリプトは予備扱い・セットアップ不要】
 *
 * 予約のLINE通知は「LINE予約フォーム（LIFF）」側に一本化しました。
 * LINE予約フォームは予約者本人＋スタッフへのPush通知を自前で行うため
 * （line-reservation/src/reservation-routes.js 実装済み・動作確認済み）、
 * このGASを設定すると通知が二重に届く原因になります。
 * Googleフォーム予約を続ける場合の予備としてファイルだけ残しています。
 * Googleフォーム予約を廃止する際は、このファイルごと削除してかまいません。
 *
 * ─────────────────────────────────────────────
 *
 * HMC 予約フォーム → LINE 通知スクリプト
 *
 * このスクリプトは、Googleフォームに予約や問い合わせが送信されたとき、
 * その内容をスタッフのLINEへ自動でPush通知します（LINE Messaging API を使用）。
 * 既存の Slack 通知（slack-notification.gs）の LINE 版です。
 * Slack版とは別ファイルとして追加してOKで、両方のトリガーを設定すれば
 * Slack と LINE の両方に通知が飛びます。
 *
 * ============================================================
 * ▶ セットアップ手順（はじめての人でも大丈夫です。順番にやってね）
 * ============================================================
 *
 * 【手順1】このスクリプトを貼る場所
 *   1. フォームの回答が集まっているスプレッドシートを開く
 *   2. 画面上の「拡張機能」→「Apps Script」を開く
 *   3. （Slack版とは別の）新しいファイルを追加して、このファイルの中身を全部コピペして保存
 *      ※ Slack版の onFormSubmit はそのまま残してOK。関数名が違うので衝突しません。
 *
 * 【手順2】LINE_CHANNEL_ACCESS_TOKEN（チャネルアクセストークン）を入手して貼る
 *   - これは LINE 公式アカウントを操作するための「合言葉」です。
 *   - LINE Harness と同じ LINE 公式アカウントのチャネルを使う前提なので、
 *     すでに LINE Harness の管理画面（または LINE Developers コンソールの
 *     対象チャネル → Messaging API 設定 → 「チャネルアクセストークン（長期）」）に
 *     設定済みのトークンを、そのままコピーして下の定数に貼り付けます。
 *   - トークンは秘密の情報です。他人に教えたり、公開リポジトリに直書きしたままに
 *     しないよう注意してください。
 *
 * 【手順3】STAFF_USER_IDS（スタッフのLINE userId）を入手して貼る
 *   - userId は「Uから始まる長い文字列」で、LINEのユーザーを表すIDです。
 *     （LINEアプリで表示される「ID（@〜）」とは別物なので注意）
 *   - 取得方法：
 *       1. 通知を受け取りたいスタッフが、その LINE 公式アカウントを「友だち追加」する
 *       2. スタッフがその公式アカウントに何かメッセージを1通送る
 *       3. すると LINE Harness の friends テーブルの user_id 列に、そのスタッフの
 *          userId が記録されます（または Webhook のログにも残ります）。そこからコピー。
 *   - 複数のスタッフに送りたいときは、配列にカンマ区切りで並べてください。
 *
 * 【手順4】トリガーを設定する（フォーム送信時に自動実行されるようにする）
 *   1. Apps Script の左メニュー「トリガー」（時計のアイコン）を開く
 *   2. 右下「トリガーを追加」をクリック
 *   3. 実行する関数を選択 → onFormSubmitLineNotify
 *   4. イベントのソースを選択 → スプレッドシートから
 *   5. イベントの種類を選択 → フォーム送信時
 *   6. 保存（初回は Google の承認画面が出るので許可してください）
 *   ※ Slack版のトリガーはそのまま残しておけば、Slack と LINE の両方に届きます。
 */

// ▼ 手順2で入手したチャネルアクセストークンをここに貼り付け（プレースホルダ）
const LINE_CHANNEL_ACCESS_TOKEN = 'ここにチャネルアクセストークンを貼り付け';

// ▼ 手順3で入手したスタッフの userId を配列で指定（複数可・プレースホルダ）
//    例: ['Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'Uyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy']
const STAFF_USER_IDS = ['Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'];

// LINE Messaging API の push エンドポイント
const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

// LINEのテキストメッセージ1通の上限はおよそ5000文字。超えそうなら切り詰める。
const LINE_TEXT_MAX_LENGTH = 5000;

/**
 * フォーム送信時に呼ばれるメイン関数。
 * 予約内容を読みやすいテキストにして、各スタッフのLINEへPush通知します。
 */
function onFormSubmitLineNotify(e) {
  const responses = e.namedValues;
  const timestamp = e.values[0];

  // 各項目を「・質問: 回答」の形で組み立てる
  const lines = [];
  for (const [question, answer] of Object.entries(responses)) {
    if (question === 'タイムスタンプ') continue; // タイムスタンプはスキップ
    const ans = Array.isArray(answer) ? answer[0] : answer;
    if (ans && ans.trim() !== '') {          // 空欄はスキップ
      lines.push(`・${question}: ${ans}`);
    }
  }

  // 見出し + 各項目 + 受付日時
  let message =
    '📋 HMC 新しい予約申込が届きました\n\n' +
    lines.join('\n') +
    `\n\n受付日時: ${timestamp}`;

  // 長すぎる場合は安全のため切り詰める
  if (message.length > LINE_TEXT_MAX_LENGTH) {
    const suffix = '\n…（以下省略）';
    message = message.substring(0, LINE_TEXT_MAX_LENGTH - suffix.length) + suffix;
  }

  // スタッフ1人ずつにPush送信
  for (const userId of STAFF_USER_IDS) {
    sendLinePush(userId, message);
  }
}

/**
 * 指定した userId に、テキストメッセージを1通Push送信します。
 */
function sendLinePush(userId, text) {
  const payload = {
    to: userId,
    messages: [
      { type: 'text', text: text }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true, // エラーでも例外を投げず、レスポンスを確認できるようにする
  };

  const res = UrlFetchApp.fetch(LINE_PUSH_ENDPOINT, options);
  Logger.log(`LINE push to ${userId}: ${res.getResponseCode()} ${res.getContentText()}`);
}
