/* ============================================================
   HACOS セッション管理アプリ — メインロジック
============================================================ */

// ── Firebase 初期化 ──────────────────────────────────────────
const IS_CONFIGURED = (
  typeof FIREBASE_CONFIG !== 'undefined' &&
  FIREBASE_CONFIG.apiKey !== 'FILL_IN'
);

let db = null;
if (IS_CONFIGURED) {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();
}

// ── ユーティリティ ────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function fmtDate(d) {
  if (!d) return '-';
  return String(d).replace(/-/g, '/');
}

function initials(name) {
  if (!name) return '?';
  return name.charAt(0);
}

const root = document.getElementById('view-root');
function render(html) { root.innerHTML = html; }
function loading() {
  render(`<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`);
}

let activeChart = null;
function destroyChart() {
  if (activeChart) { activeChart.destroy(); activeChart = null; }
}

// ── DB レイヤー ───────────────────────────────────────────────
const DB = {
  async getClients() {
    const snap = await db.collection('clients').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async getClient(id) {
    const doc = await db.collection('clients').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },
  async createClient(data) {
    return db.collection('clients').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  },
  async updateClient(id, data) {
    return db.collection('clients').doc(id).update(data);
  },
  async deleteClient(id) {
    const [sessions, measures] = await Promise.all([
      db.collection('sessions').where('clientId', '==', id).get(),
      db.collection('measurements').where('clientId', '==', id).get()
    ]);
    const batch = db.batch();
    [...sessions.docs, ...measures.docs].forEach(d => batch.delete(d.ref));
    batch.delete(db.collection('clients').doc(id));
    return batch.commit();
  },

  async getSessions(clientId) {
    const snap = await db.collection('sessions')
      .where('clientId', '==', clientId)
      .orderBy('date', 'desc')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async getSession(id) {
    const doc = await db.collection('sessions').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },
  async saveSession(data, id = null) {
    if (id) return db.collection('sessions').doc(id).set(data, { merge: true });
    return db.collection('sessions').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  },
  async deleteSession(id) {
    return db.collection('sessions').doc(id).delete();
  },

  async getMeasurements(clientId) {
    const snap = await db.collection('measurements')
      .where('clientId', '==', clientId)
      .orderBy('date', 'desc')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async saveMeasurement(data) {
    return db.collection('measurements').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  },
  async deleteMeasurement(id) {
    return db.collection('measurements').doc(id).delete();
  }
};

// ── ルーター ──────────────────────────────────────────────────
const routes = {};
function on(pattern, fn) { routes[pattern] = fn; }

function route() {
  destroyChart();
  const hash = (window.location.hash || '#/').slice(1);

  if (hash === '/' || hash === '') return routes['/']?.();

  const m = (pat) => hash.match(pat);

  if (hash === '/client/new')                      return routes['/client/new']?.();
  if (m(/^\/client\/([^/]+)\/session\/new$/))      return routes['/client/:id/session/new']?.(m(/^\/client\/([^/]+)\/session\/new$/)[1]);
  if (m(/^\/client\/([^/]+)\/session\/([^/]+)$/))  {
    const [, cid, sid] = m(/^\/client\/([^/]+)\/session\/([^/]+)$/);
    return routes['/client/:id/session/:sid']?.(cid, sid);
  }
  if (m(/^\/client\/([^/]+)\/measure$/))           return routes['/client/:id/measure']?.(m(/^\/client\/([^/]+)\/measure$/)[1]);
  if (m(/^\/client\/([^/]+)$/))                    return routes['/client/:id']?.(m(/^\/client\/([^/]+)$/)[1]);

  render('<div class="error-msg">ページが見つかりません</div>');
}

function go(path) { window.location.hash = path; }

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

// ── グローバルに公開する関数（HTML onclick から呼ぶ） ─────────
window.go = go;
window.filterClients = filterClients;
window.submitNewClient = submitNewClient;
window.submitSession = submitSession;
window.submitMeasurement = submitMeasurement;
window.confirmDeleteClient = confirmDeleteClient;
window.confirmDeleteSession = confirmDeleteSession;
window.confirmDeleteMeasurement = confirmDeleteMeasurement;

// ============================================================
// VIEW: セットアップ
// ============================================================
function viewSetup() {
  render(`
    <div class="setup-view">
      <div class="setup-card">
        <div class="setup-logo">HACOS</div>
        <p class="setup-subtitle">パーソナルセッション管理システム</p>
        <p style="font-size:14px;color:#666;margin-bottom:24px;">
          初回のみ <strong>firebase-config.js</strong> にFirebaseの設定を入力してください。
        </p>
        <div class="setup-steps">
          <div class="setup-step">
            <div class="step-num">1</div>
            <div class="step-body">
              <strong>Firebaseプロジェクト作成</strong>
              <p>console.firebase.google.com にアクセス →「プロジェクトを追加」</p>
            </div>
          </div>
          <div class="setup-step">
            <div class="step-num">2</div>
            <div class="step-body">
              <strong>Firestore を有効化</strong>
              <p>左メニュー「Firestore Database」→「データベースの作成」→「テストモード」→ ロケーション: <strong>asia-northeast1（東京）</strong></p>
            </div>
          </div>
          <div class="setup-step">
            <div class="step-num">3</div>
            <div class="step-body">
              <strong>ウェブアプリを追加</strong>
              <p>「プロジェクトの設定（⚙）」→「マイアプリ」→「アプリを追加（&lt;/&gt;）」→ firebaseConfig をコピー</p>
            </div>
          </div>
          <div class="setup-step">
            <div class="step-num">4</div>
            <div class="step-body">
              <strong>firebase-config.js に貼り付け</strong>
              <p>FILL_IN の部分をそれぞれの値に書き換えて保存 → ページをリロード</p>
            </div>
          </div>
        </div>
        <div class="setup-note">
          💡 設定後は同じURLをトレーナー全員で共有するだけで使えます。データはリアルタイムで同期されます。
        </div>
      </div>
    </div>
  `);
}

// ============================================================
// VIEW: クライアント一覧
// ============================================================
let _allClients = [];

async function viewClientList() {
  if (!IS_CONFIGURED) { viewSetup(); return; }
  loading();
  try {
    _allClients = await DB.getClients();
    renderClientList(_allClients);
  } catch (e) {
    render(`<div class="error-msg">データの読み込みに失敗しました。<br><small>${esc(e.message)}</small></div>`);
  }
}

function renderClientList(clients) {
  render(`
    <div>
      <div class="view-top">
        <h1>クライアント一覧</h1>
        <button class="btn btn-primary" onclick="go('/client/new')">＋ 新規追加</button>
      </div>
      <div class="search-wrap">
        <input type="text" placeholder="名前で検索..." oninput="filterClients(this.value)">
      </div>
      <div class="client-grid" id="client-grid">
        ${clientListHTML(clients)}
      </div>
    </div>
  `);
}

function clientListHTML(clients) {
  if (!clients.length) return '<p class="empty-msg">クライアントがまだ登録されていません</p>';
  return clients.map(c => `
    <div class="client-card" onclick="go('/client/${esc(c.id)}')">
      <div class="client-avatar">${esc(initials(c.name))}</div>
      <div class="client-card-body">
        <div class="client-card-name">${esc(c.name)}</div>
        <div class="client-card-meta">
          ${c.course ? `<span>${esc(c.course)}</span>` : ''}
          ${c.height ? `<span>身長 ${c.height}cm</span>` : ''}
          ${c.birthDate ? `<span>${fmtDate(c.birthDate)}生</span>` : ''}
        </div>
      </div>
      <div class="client-card-arrow">›</div>
    </div>
  `).join('');
}

function filterClients(q) {
  const filtered = q.trim()
    ? _allClients.filter(c => c.name.toLowerCase().includes(q.toLowerCase()))
    : _allClients;
  const grid = document.getElementById('client-grid');
  if (grid) grid.innerHTML = clientListHTML(filtered);
}

// ============================================================
// VIEW: クライアント詳細
// ============================================================
async function viewClientDetail(clientId) {
  loading();
  try {
    const [client, sessions, measurements] = await Promise.all([
      DB.getClient(clientId),
      DB.getSessions(clientId),
      DB.getMeasurements(clientId)
    ]);
    if (!client) { render('<div class="error-msg">クライアントが見つかりません</div>'); return; }

    render(`
      <div>
        <div class="back-row">
          <button class="btn-back" onclick="go('/')">← 一覧へ戻る</button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-outline" onclick="go('/client/${esc(clientId)}/edit-stub')" style="display:none"></button>
            <button class="btn btn-sm btn-danger" onclick="confirmDeleteClient('${esc(clientId)}', '${esc(client.name)}')">削除</button>
          </div>
        </div>

        <div class="profile-card">
          <div class="profile-name">${esc(client.name)}</div>
          <div class="profile-meta-row">
            ${client.birthDate ? `<span>生年月日: ${fmtDate(client.birthDate)}</span>` : ''}
            ${client.height ? `<span>身長: ${client.height}cm</span>` : ''}
            ${client.course ? `<span>コース: ${esc(client.course)}</span>` : ''}
          </div>
          <div class="profile-actions">
            <button class="btn btn-amber" onclick="go('/client/${esc(clientId)}/session/new')">＋ セッション記録</button>
            <button class="btn btn-outline" style="border-color:var(--cream);color:var(--cream)" onclick="go('/client/${esc(clientId)}/measure')">＋ 2週間計測</button>
          </div>
        </div>

        ${sessions.length > 0 ? `
          <div class="chart-card">
            <h2>体組成の推移</h2>
            <div class="chart-wrap"><canvas id="body-chart"></canvas></div>
          </div>
        ` : ''}

        <div class="section-head">
          <h2>セッション履歴 <span style="color:var(--gray);font-size:13px;font-weight:400">(${sessions.length}回)</span></h2>
        </div>
        <div class="session-list">
          ${sessions.length === 0
            ? '<p class="empty-msg">セッションがまだありません</p>'
            : sessions.map(s => sessionItemHTML(s, clientId)).join('')
          }
        </div>

        ${measurements.length > 0 ? `
          <div class="section-head">
            <h2>2週間変化記録 <span style="color:var(--gray);font-size:13px;font-weight:400">(${measurements.length}回)</span></h2>
          </div>
          <div class="measure-list">
            ${measurements.map(m => measureItemHTML(m)).join('')}
          </div>
        ` : ''}
      </div>
    `);

    if (sessions.length > 0) drawBodyChart(sessions);

  } catch (e) {
    render(`<div class="error-msg">読み込みエラー: ${esc(e.message)}</div>`);
  }
}

function sessionItemHTML(s, clientId) {
  const exs = (s.exercises || []).filter(e => e.name);
  return `
    <div class="session-item" onclick="go('/client/${esc(clientId)}/session/${esc(s.id)}')">
      <div class="session-item-header">
        <span class="session-date-badge">${fmtDate(s.date)}</span>
        ${s.sessionNumber ? `<span class="session-num-badge">#${esc(s.sessionNumber)}</span>` : ''}
        ${s.trainer ? `<span class="session-trainer-badge">担当: ${esc(s.trainer)}</span>` : ''}
      </div>
      <div class="session-body-stats">
        ${s.bodyWeight ? `<span class="stat-chip">体重 ${s.bodyWeight}kg</span>` : ''}
        ${s.bodyFat ? `<span class="stat-chip">体脂肪 ${s.bodyFat}%</span>` : ''}
        ${s.skeletalMuscle ? `<span class="stat-chip">骨格筋 ${s.skeletalMuscle}kg</span>` : ''}
        ${s.visceralFat ? `<span class="stat-chip">内脂肪 ${s.visceralFat}</span>` : ''}
      </div>
      ${exs.length > 0 ? `
        <div class="session-exercises-preview">
          ${exs.slice(0,3).map(e => `${esc(e.name)} ${e.weight||''}kg×${e.reps||''}rep×${e.sets||''}set`).join(' ／ ')}
          ${exs.length > 3 ? ` ほか${exs.length-3}種目` : ''}
        </div>
      ` : ''}
      ${s.nextSuggestion ? `<div class="session-suggestion-preview">☆ ${esc(s.nextSuggestion)}</div>` : ''}
    </div>
  `;
}

function measureItemHTML(m) {
  return `
    <div class="measure-item">
      <div class="measure-item-date">${fmtDate(m.date)}</div>
      <div class="measure-vals-row">
        ${m.waist       ? `<span class="measure-chip">ウエスト <span>${m.waist}cm</span></span>` : ''}
        ${m.hip         ? `<span class="measure-chip">ヒップ <span>${m.hip}cm</span></span>` : ''}
        ${m.kneeAbove15 ? `<span class="measure-chip">膝上15cm <span>${m.kneeAbove15}cm</span></span>` : ''}
        ${m.upperArm    ? `<span class="measure-chip">二の腕 <span>${m.upperArm}cm</span></span>` : ''}
      </div>
      ${m.dietNotes ? `<div class="measure-diet">${esc(m.dietNotes)}</div>` : ''}
      <div style="text-align:right;margin-top:6px">
        <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();confirmDeleteMeasurement('${esc(m.id)}','${esc(m.clientId)}')">削除</button>
      </div>
    </div>
  `;
}

function drawBodyChart(sessions) {
  const canvas = document.getElementById('body-chart');
  if (!canvas) return;
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map(s => fmtDate(s.date));
  activeChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '体重 (kg)',   data: sorted.map(s => s.bodyWeight   ?? null), borderColor: '#3D5A3E', backgroundColor: 'rgba(61,90,62,0.08)',   tension: 0.3, spanGaps: true, pointRadius: 4 },
        { label: '体脂肪 (%)',  data: sorted.map(s => s.bodyFat      ?? null), borderColor: '#C8833A', backgroundColor: 'rgba(200,131,58,0.08)', tension: 0.3, spanGaps: true, pointRadius: 4 },
        { label: '骨格筋 (kg)', data: sorted.map(s => s.skeletalMuscle ?? null), borderColor: '#B85C38', backgroundColor: 'rgba(184,92,56,0.08)',  tension: 0.3, spanGaps: true, pointRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: { y: { beginAtZero: false, ticks: { font: { size: 11 } } }, x: { ticks: { font: { size: 10 }, maxRotation: 45 } } }
    }
  });
}

// ============================================================
// VIEW: 新規クライアント登録
// ============================================================
function viewNewClient() {
  render(`
    <div class="form-view">
      <div class="back-row">
        <button class="btn-back" onclick="go('/')">← 一覧へ戻る</button>
      </div>
      <h1>新規クライアント登録</h1>
      <form onsubmit="submitNewClient(event)">
        <div class="form-section">
          <div class="form-group">
            <label>名前 <span class="req">*</span></label>
            <input type="text" name="name" required placeholder="例: 田中花子">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>生年月日</label>
              <input type="date" name="birthDate">
            </div>
            <div class="form-group">
              <label>身長 (cm)</label>
              <input type="number" name="height" step="0.1" placeholder="158">
            </div>
          </div>
          <div class="form-group">
            <label>コース</label>
            <input type="text" name="course" placeholder="例: ダイエット3ヶ月コース">
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-lg">登録する</button>
        </div>
      </form>
    </div>
  `);
}

async function submitNewClient(e) {
  e.preventDefault();
  const f = e.target;
  const btn = e.submitter;
  btn.disabled = true; btn.textContent = '登録中...';
  try {
    const ref = await DB.createClient({
      name:      f.name.value.trim(),
      birthDate: f.birthDate.value || null,
      height:    parseFloat(f.height.value) || null,
      course:    f.course.value.trim() || null
    });
    go(`/client/${ref.id}`);
  } catch (err) {
    alert('登録に失敗しました: ' + err.message);
    btn.disabled = false; btn.textContent = '登録する';
  }
}

// ============================================================
// VIEW: セッション記録フォーム（新規 & 編集）
// ============================================================
const EXERCISE_LABELS = ['①','②','③','④','⑤','⑥'];

async function viewSessionForm(clientId, sessionId = null) {
  loading();
  try {
    const [client, session] = await Promise.all([
      DB.getClient(clientId),
      sessionId ? DB.getSession(sessionId) : Promise.resolve(null)
    ]);
    if (!client) { render('<div class="error-msg">クライアントが見つかりません</div>'); return; }

    const s = session || {};
    const isEdit = !!sessionId;

    const exerciseRows = EXERCISE_LABELS.map((lbl, i) => {
      const ex = (s.exercises || [])[i] || {};
      return `
        <div class="exercise-row">
          <div class="exercise-row-label">種目 ${lbl}</div>
          <div class="exercise-row-fields">
            <div class="ex-field-wrap">
              <label>種目名</label>
              <input type="text" name="ex_name_${i}" value="${esc(ex.name || '')}" placeholder="例: スクワット">
            </div>
            <div class="ex-field-wrap">
              <label>重量(kg)</label>
              <input type="number" name="ex_weight_${i}" value="${ex.weight != null ? ex.weight : ''}" step="0.5" min="0" placeholder="30">
            </div>
            <div class="ex-field-wrap">
              <label>回数</label>
              <input type="number" name="ex_reps_${i}" value="${ex.reps != null ? ex.reps : ''}" min="0" placeholder="12">
            </div>
            <div class="ex-field-wrap">
              <label>セット</label>
              <input type="number" name="ex_sets_${i}" value="${ex.sets != null ? ex.sets : ''}" min="0" placeholder="3">
            </div>
          </div>
        </div>
      `;
    });

    render(`
      <div class="form-view">
        <div class="back-row">
          <button class="btn-back" onclick="go('/client/${esc(clientId)}')">← ${esc(client.name)}</button>
          ${isEdit ? `<button class="btn btn-sm btn-danger" onclick="confirmDeleteSession('${esc(sessionId)}','${esc(clientId)}')">削除</button>` : ''}
        </div>
        <h1>${isEdit ? 'セッション編集' : 'セッション記録'}</h1>

        <form onsubmit="submitSession(event,'${esc(clientId)}','${esc(sessionId || '')}')">

          <!-- 基本情報 -->
          <div class="form-section">
            <div class="form-section-title">基本情報</div>
            <div class="form-row">
              <div class="form-group">
                <label>日付 <span class="req">*</span></label>
                <input type="date" name="date" value="${esc(s.date || today())}" required>
              </div>
              <div class="form-group">
                <label>セッション #</label>
                <input type="text" name="sessionNumber" value="${esc(s.sessionNumber || '')}" placeholder="例: 5">
              </div>
            </div>
            <div class="form-group">
              <label>担当トレーナー</label>
              <input type="text" name="trainer" value="${esc(s.trainer || '')}" placeholder="例: 山田">
            </div>
          </div>

          <!-- 体組成 -->
          <div class="form-section">
            <div class="form-section-title">体組成</div>
            <div class="form-row form-row-4">
              <div class="form-group">
                <label>体重 (kg)</label>
                <input type="number" name="bodyWeight" value="${s.bodyWeight != null ? s.bodyWeight : ''}" step="0.1" placeholder="58.5">
              </div>
              <div class="form-group">
                <label>体脂肪 (%)</label>
                <input type="number" name="bodyFat" value="${s.bodyFat != null ? s.bodyFat : ''}" step="0.1" placeholder="28.5">
              </div>
              <div class="form-group">
                <label>内脂肪</label>
                <input type="number" name="visceralFat" value="${s.visceralFat != null ? s.visceralFat : ''}" step="0.1" placeholder="8">
              </div>
              <div class="form-group">
                <label>骨格筋 (kg)</label>
                <input type="number" name="skeletalMuscle" value="${s.skeletalMuscle != null ? s.skeletalMuscle : ''}" step="0.1" placeholder="25.3">
              </div>
            </div>
          </div>

          <!-- フェーズ評価 -->
          <div class="form-section">
            <div class="form-section-title">フェーズ評価</div>
            <div class="phase-grid">
              ${[
                ['al', 'AL', 'リアアライメント'],
                ['ca', 'CA', 'コアアクティベート'],
                ['ig', 'IG', 'インテグレーション'],
                ['pa', 'PA', 'パワー']
              ].map(([key, abbr, full]) => `
                <div class="form-group">
                  <label class="phase-label-text">
                    <span class="phase-abbr">${abbr}</span>
                    <span class="phase-fullname">${full}</span>
                  </label>
                  <input type="text" name="${key}" value="${esc(s[key] || '')}" placeholder="評価・メモ">
                </div>
              `).join('')}
            </div>
          </div>

          <!-- 話した内容 -->
          <div class="form-section">
            <div class="form-section-title">話した内容・伝達事項</div>
            <div class="form-group" style="margin-bottom:0">
              <textarea name="communicationNotes" rows="4" placeholder="セッション中に話した内容、クライアントの状態、気づきなど...">${esc(s.communicationNotes || '')}</textarea>
            </div>
          </div>

          <!-- STR トレーニング -->
          <div class="form-section">
            <div class="form-section-title">STR トレーニング（ストレングス）</div>
            <div class="exercise-list">
              ${exerciseRows.join('')}
            </div>
          </div>

          <!-- 次回提案 -->
          <div class="form-section">
            <div class="form-section-title">次回までの提案 ☆</div>
            <div class="form-group" style="margin-bottom:0">
              <textarea name="nextSuggestion" rows="3" placeholder="次回セッションまでにやってほしいこと、意識してほしいこと...">${esc(s.nextSuggestion || '')}</textarea>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-lg">${isEdit ? '更新する' : '記録する'}</button>
          </div>
        </form>
      </div>
    `);
  } catch (e) {
    render(`<div class="error-msg">読み込みエラー: ${esc(e.message)}</div>`);
  }
}

async function submitSession(e, clientId, sessionId) {
  e.preventDefault();
  const f = e.target;
  const btn = e.submitter;
  btn.disabled = true;
  btn.textContent = '保存中...';

  const exercises = EXERCISE_LABELS.map((_, i) => ({
    name:   f[`ex_name_${i}`]?.value.trim()        || '',
    weight: parseFloat(f[`ex_weight_${i}`]?.value) || null,
    reps:   parseInt(f[`ex_reps_${i}`]?.value)     || null,
    sets:   parseInt(f[`ex_sets_${i}`]?.value)      || null
  })).filter(ex => ex.name);

  const data = {
    clientId,
    date:               f.date.value,
    sessionNumber:      f.sessionNumber.value.trim() || null,
    trainer:            f.trainer.value.trim()       || null,
    bodyWeight:         parseFloat(f.bodyWeight.value)    || null,
    bodyFat:            parseFloat(f.bodyFat.value)       || null,
    visceralFat:        parseFloat(f.visceralFat.value)   || null,
    skeletalMuscle:     parseFloat(f.skeletalMuscle.value)|| null,
    al:                 f.al.value.trim() || null,
    ca:                 f.ca.value.trim() || null,
    ig:                 f.ig.value.trim() || null,
    pa:                 f.pa.value.trim() || null,
    communicationNotes: f.communicationNotes.value.trim() || null,
    nextSuggestion:     f.nextSuggestion.value.trim()     || null,
    exercises
  };

  try {
    await DB.saveSession(data, sessionId || null);
    go(`/client/${clientId}`);
  } catch (err) {
    alert('保存に失敗しました: ' + err.message);
    btn.disabled = false;
    btn.textContent = sessionId ? '更新する' : '記録する';
  }
}

// ============================================================
// VIEW: セッション詳細（読み取り専用）
// ============================================================
async function viewSessionDetail(clientId, sessionId) {
  loading();
  try {
    const [client, session] = await Promise.all([
      DB.getClient(clientId),
      DB.getSession(sessionId)
    ]);
    if (!session) { render('<div class="error-msg">セッションが見つかりません</div>'); return; }

    const exs = (session.exercises || []).filter(e => e.name);

    render(`
      <div>
        <div class="back-row">
          <button class="btn-back" onclick="go('/client/${esc(clientId)}')">← ${esc(client?.name || '戻る')}</button>
          <button class="btn btn-sm btn-outline" onclick="go('/client/${esc(clientId)}/session/${esc(sessionId)}/edit')">編集</button>
        </div>

        <div class="session-detail-header">
          <div class="session-detail-title">
            ${fmtDate(session.date)}
            ${session.sessionNumber ? `<span style="font-size:14px;background:rgba(255,255,255,0.2);border-radius:20px;padding:2px 12px;margin-left:8px">#${esc(session.sessionNumber)}</span>` : ''}
          </div>
          <div class="session-detail-meta">担当: ${esc(session.trainer || '-')}</div>
        </div>

        <!-- 体組成 -->
        <div class="detail-card">
          <h3>体組成</h3>
          <div class="detail-grid-4">
            ${[
              ['体重',   session.bodyWeight,    'kg'],
              ['体脂肪', session.bodyFat,       '%'],
              ['内脂肪', session.visceralFat,   ''],
              ['骨格筋', session.skeletalMuscle,'kg']
            ].map(([label, val, unit]) => `
              <div class="detail-val">
                <div class="dv-label">${label}</div>
                <div class="dv-num">${val ?? '-'}<span class="dv-unit">${val != null ? unit : ''}</span></div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- フェーズ評価 -->
        <div class="detail-card">
          <h3>フェーズ評価</h3>
          <div class="detail-grid-4">
            ${[
              ['AL', 'リアアライメント', session.al],
              ['CA', 'コアアクティベート', session.ca],
              ['IG', 'インテグレーション', session.ig],
              ['PA', 'パワー', session.pa]
            ].map(([abbr, full, val]) => `
              <div class="detail-val">
                <div class="dv-label"><span class="phase-abbr" style="font-size:11px">${abbr}</span> <span style="font-size:9px;color:var(--gray)">${full}</span></div>
                <div class="dv-num" style="font-size:14px">${esc(val || '-')}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- STR -->
        ${exs.length > 0 ? `
          <div class="detail-card">
            <h3>STR トレーニング</h3>
            <table class="exercise-detail-table">
              <thead>
                <tr><th>種目</th><th>重量(kg)</th><th>回数</th><th>セット</th></tr>
              </thead>
              <tbody>
                ${exs.map(ex => `
                  <tr>
                    <td>${esc(ex.name)}</td>
                    <td>${ex.weight ?? '-'}</td>
                    <td>${ex.reps ?? '-'}</td>
                    <td>${ex.sets ?? '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}

        <!-- 話した内容 -->
        ${session.communicationNotes ? `
          <div class="detail-card">
            <h3>話した内容・伝達事項</h3>
            <p class="detail-text">${esc(session.communicationNotes)}</p>
          </div>
        ` : ''}

        <!-- 次回提案 -->
        ${session.nextSuggestion ? `
          <div class="suggestion-card">
            <h3>次回までの提案 ☆</h3>
            <p class="detail-text">${esc(session.nextSuggestion)}</p>
          </div>
        ` : ''}

        <div class="form-actions">
          <button class="btn btn-outline" onclick="go('/client/${esc(clientId)}/session/${esc(sessionId)}/edit')">このセッションを編集</button>
          <button class="btn btn-danger" onclick="confirmDeleteSession('${esc(sessionId)}','${esc(clientId)}')">削除</button>
        </div>
      </div>
    `);
  } catch (err) {
    render(`<div class="error-msg">読み込みエラー: ${esc(err.message)}</div>`);
  }
}

// ============================================================
// VIEW: 2週間変化記録フォーム
// ============================================================
async function viewMeasurementForm(clientId) {
  loading();
  try {
    const client = await DB.getClient(clientId);
    if (!client) { render('<div class="error-msg">クライアントが見つかりません</div>'); return; }

    render(`
      <div class="form-view">
        <div class="back-row">
          <button class="btn-back" onclick="go('/client/${esc(clientId)}')">← ${esc(client.name)}</button>
        </div>
        <h1>2週間変化記録</h1>
        <form onsubmit="submitMeasurement(event,'${esc(clientId)}')">
          <div class="form-section">
            <div class="form-group">
              <label>日付 <span class="req">*</span></label>
              <input type="date" name="date" value="${today()}" required>
            </div>
          </div>
          <div class="form-section">
            <div class="form-section-title">測定値 (cm)</div>
            <div class="form-row form-row-4">
              <div class="form-group">
                <label>ウエスト</label>
                <input type="number" name="waist" step="0.1" placeholder="72">
              </div>
              <div class="form-group">
                <label>ヒップ</label>
                <input type="number" name="hip" step="0.1" placeholder="88">
              </div>
              <div class="form-group">
                <label>膝上15cm</label>
                <input type="number" name="kneeAbove15" step="0.1" placeholder="45">
              </div>
              <div class="form-group">
                <label>二の腕</label>
                <input type="number" name="upperArm" step="0.1" placeholder="28">
              </div>
            </div>
          </div>
          <div class="form-section">
            <div class="form-section-title">2週間の変化と食事内容</div>
            <div class="form-group" style="margin-bottom:0">
              <textarea name="dietNotes" rows="5" placeholder="食事内容、体の変化、気づいたことなど..."></textarea>
            </div>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-lg">記録する</button>
          </div>
        </form>
      </div>
    `);
  } catch (err) {
    render(`<div class="error-msg">読み込みエラー: ${esc(err.message)}</div>`);
  }
}

async function submitMeasurement(e, clientId) {
  e.preventDefault();
  const f = e.target;
  const btn = e.submitter;
  btn.disabled = true; btn.textContent = '保存中...';
  try {
    await DB.saveMeasurement({
      clientId,
      date:        f.date.value,
      waist:       parseFloat(f.waist.value)       || null,
      hip:         parseFloat(f.hip.value)         || null,
      kneeAbove15: parseFloat(f.kneeAbove15.value) || null,
      upperArm:    parseFloat(f.upperArm.value)    || null,
      dietNotes:   f.dietNotes.value.trim()        || null
    });
    go(`/client/${clientId}`);
  } catch (err) {
    alert('保存に失敗しました: ' + err.message);
    btn.disabled = false; btn.textContent = '記録する';
  }
}

// ============================================================
// 削除確認
// ============================================================
async function confirmDeleteClient(id, name) {
  if (!confirm(`「${name}」を削除しますか？\nセッション履歴・計測記録もすべて削除されます。`)) return;
  try {
    await DB.deleteClient(id);
    go('/');
  } catch (err) { alert('削除に失敗しました: ' + err.message); }
}

async function confirmDeleteSession(sessionId, clientId) {
  if (!confirm('このセッションを削除しますか？')) return;
  try {
    await DB.deleteSession(sessionId);
    go(`/client/${clientId}`);
  } catch (err) { alert('削除に失敗しました: ' + err.message); }
}

async function confirmDeleteMeasurement(measureId, clientId) {
  if (!confirm('この計測記録を削除しますか？')) return;
  try {
    await DB.deleteMeasurement(measureId);
    viewClientDetail(clientId);
  } catch (err) { alert('削除に失敗しました: ' + err.message); }
}

// ============================================================
// ルーター登録
// ============================================================
on('/',                              viewClientList);
on('/client/new',                    viewNewClient);
on('/client/:id',                    viewClientDetail);
on('/client/:id/session/new',        (cid) => viewSessionForm(cid));
on('/client/:id/session/:sid',       (cid, sid) => {
  // /edit サフィックスがある場合は編集フォーム
  const hash = window.location.hash;
  if (hash.endsWith('/edit')) {
    viewSessionForm(cid, sid);
  } else {
    viewSessionDetail(cid, sid);
  }
});
on('/client/:id/measure',            viewMeasurementForm);
