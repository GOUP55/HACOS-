/**
 * HMC スケジュール自動同期スクリプト
 *
 * ▶ セットアップ手順
 * 1. スプレッドシートに「スケジュール」シートを作成（下記フォーマット）
 *    A列: 日付表示（例: 7/5（日））
 *    B列: フィットネス内容
 *    C列: 食メニュー（例: ビビン麺と本格キンパ）
 *    D列: トレーナー（カンマ区切り 例: GO, みどり（KITCHEN））
 *    E列: 備考（例: 🏃 朝RUN 6:30〜あり）
 *    F列: 開催フラグ（TRUE=開催 / FALSE=休み）
 *    ※ 1行目はヘッダー行
 *
 * 2. このスクリプトをApps Scriptに追加して保存
 *
 * 3. トリガーを追加
 *    関数: onScheduleEdit
 *    イベント: スプレッドシートから → 編集時
 *
 * 4. フォームの「参加希望日程」の質問タイトルが
 *    DATE_QUESTION_KEYWORD に含まれるか確認する
 */

const FORM_ID = '1f4iV9T_oQFJ1uh8tSXPMb3aQZWgXtaBsYPBGiKB1LVU';
const SCHEDULE_SHEET_NAME = 'スケジュール';
const DATE_QUESTION_KEYWORD = '日程';
const HTML_OUTPUT_SHEET_NAME = 'LP HTML出力';

// ── スプレッドシート編集時に自動実行 ──
function onScheduleEdit(e) {
  if (!e) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SCHEDULE_SHEET_NAME) return;
  syncFormChoices();
}

// ── フォームの日程選択肢を更新 ──
function syncFormChoices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌「スケジュール」シートが見つかりません');
    return;
  }

  const rows = sheet.getDataRange().getValues().slice(1); // ヘッダー除外
  const choices = rows
    .filter(r => r[0] && String(r[5]).toUpperCase() !== 'FALSE' && r[5] !== '×' && r[5] !== false)
    .map(r => {
      const date = r[0];
      const fitness = r[1];
      return `${date} ／ ${fitness}`;
    });

  if (choices.length === 0) {
    Logger.log('⚠️ 開催予定の日程がありません');
    return;
  }

  const form = FormApp.openById(FORM_ID);
  const items = form.getItems();

  let updated = false;
  for (const item of items) {
    if (!item.getTitle().includes(DATE_QUESTION_KEYWORD)) continue;

    const type = item.getType();
    if (type === FormApp.ItemType.LIST) {
      item.asListItem().setChoiceValues(choices);
      updated = true;
    } else if (type === FormApp.ItemType.MULTIPLE_CHOICE) {
      item.asMultipleChoiceItem().setChoiceValues(choices);
      updated = true;
    } else if (type === FormApp.ItemType.CHECKBOX) {
      item.asCheckboxItem().setChoiceValues(choices);
      updated = true;
    }

    if (updated) break;
  }

  if (updated) {
    Logger.log(`✅ フォームの日程選択を更新しました（${choices.length}件）`);
    choices.forEach(c => Logger.log(`  · ${c}`));
  } else {
    Logger.log(`❌「${DATE_QUESTION_KEYWORD}」を含む選択肢の質問が見つかりません`);
  }
}

// ── LP スケジュールHTML を生成してシートに出力 ──
function generateScheduleHTML() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌「スケジュール」シートが見つかりません');
    return;
  }

  const rows = sheet.getDataRange().getValues().slice(1);
  let html = '';

  for (const r of rows) {
    const [dateStr, fitness, food, trainerStr, note, isOpen] = r;
    if (!dateStr) continue;

    const isClosed = String(isOpen).toUpperCase() === 'FALSE' || isOpen === '×' || isOpen === false;

    if (isClosed) {
      html += `
    <!-- ${dateStr} お休み -->
    <div class="program-card closed">
      <div class="program-date-box">
        <p class="program-day-num">${parseDayNum(dateStr)}</p>
        <p class="program-day-week">Sun</p>
      </div>
      <div class="program-info">
        <p class="closed-label">🙏 本日はお休みです</p>
        ${note ? `<p class="program-note" style="margin-top:6px;">${note}</p>` : ''}
      </div>
    </div>
`;
      continue;
    }

    const trainers = trainerStr
      ? String(trainerStr).split(',').map(t =>
          `<span class="trainer-chip">${t.trim()}</span>`
        ).join('\n          ')
      : '';

    html += `
    <!-- ${dateStr} -->
    <div class="program-card">
      <div class="program-date-box">
        <p class="program-day-num">${parseDayNum(dateStr)}</p>
        <p class="program-day-week">Sun</p>
      </div>
      <div class="program-info">
        <p class="program-fitness">${fitness}</p>
        ${food ? `<p class="program-food">🍱 ${food}</p>` : ''}
        <div class="program-trainers">
          ${trainers}
        </div>
        ${note ? `<p class="program-note">${note}</p>` : ''}
      </div>
    </div>
`;
  }

  // 出力シートに書き込み
  let outSheet = ss.getSheetByName(HTML_OUTPUT_SHEET_NAME);
  if (!outSheet) {
    outSheet = ss.insertSheet(HTML_OUTPUT_SHEET_NAME);
  }
  outSheet.clearContents();
  outSheet.getRange('A1').setValue(html);
  outSheet.getRange('A1').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  outSheet.setColumnWidth(1, 800);

  Logger.log('✅ LP HTMLを「' + HTML_OUTPUT_SHEET_NAME + '」シートに出力しました');
  SpreadsheetApp.getUi().alert(
    '✅ LP HTML生成完了\n\n「' + HTML_OUTPUT_SHEET_NAME + '」シートのA1セルの内容を\nhacos-hmc-lp.html の<div class="program-list">～</div>の中身と差し替えてください。'
  );
}

// 日付文字列から日だけ取り出す（例: "7/5（日）" → "5"）
function parseDayNum(dateStr) {
  const m = String(dateStr).match(/\/(\d+)/);
  return m ? m[1] : dateStr;
}

// ── メニューをスプレッドシートに追加 ──
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🗓 HMCスケジュール')
    .addItem('フォーム日程を今すぐ同期', 'syncFormChoices')
    .addItem('LP HTML を生成', 'generateScheduleHTML')
    .addToUi();
}
