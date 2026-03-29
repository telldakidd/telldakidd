/* ===== ARIA Fleet Admin — admin.js ===== */

// ── State ──────────────────────────────────────────────────
let PIN = '';
let phones = [], agents = [], kbs = [];
let onlinePhones = new Set();
let ws = null, wsReconnectTimer = null;

// ── Auth ───────────────────────────────────────────────────
document.getElementById('pinInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});
document.getElementById('pinSubmit').addEventListener('click', login);

async function login() {
  const pin = document.getElementById('pinInput').value.trim();
  if (!pin) return;
  // Test by fetching stats with this PIN
  const res = await fetch('/api/stats', { headers: { 'x-admin-pin': pin } });
  if (!res.ok) {
    document.getElementById('loginErr').textContent = 'Incorrect PIN';
    return;
  }
  PIN = pin;
  sessionStorage.setItem('fleet_pin', pin);
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  initApp();
}

// Restore session
(async () => {
  const saved = sessionStorage.getItem('fleet_pin');
  if (!saved) return;
  const res = await fetch('/api/stats', { headers: { 'x-admin-pin': saved } });
  if (res.ok) {
    PIN = saved;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    initApp();
  }
})();

// ── API Helpers ────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': PIN },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── WebSocket ──────────────────────────────────────────────
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', role: 'admin', pin: PIN }));
    clearTimeout(wsReconnectTimer);
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'auth_ok') {
      setWsStatus(true);
    }
    if (msg.type === 'phone_status') {
      onlinePhones = new Set(msg.online);
      updateOnlineUI();
    }
  };

  ws.onclose = () => {
    setWsStatus(false);
    wsReconnectTimer = setTimeout(connectWs, 4000);
  };
  ws.onerror = () => ws.close();

  // Keepalive
  setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' })); }, 25000);
}

function setWsStatus(connected) {
  const el = document.getElementById('wsStatus');
  el.className = `ws-status ${connected ? 'connected' : ''}`;
  el.innerHTML = `<span class="dot"></span> ${connected ? 'Connected' : 'Reconnecting…'}`;
}

// ── Tabs ───────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    closeSidebar();
    if (btn.dataset.tab === 'push') renderPushForm();
    if (btn.dataset.tab === 'settings') loadSettingsTab();
  });
});

// Mobile sidebar
const sidebar = document.getElementById('sidebar');
document.getElementById('menuToggle').addEventListener('click', () => sidebar.classList.toggle('open'));
function closeSidebar() { sidebar.classList.remove('open'); }

// ── Init ───────────────────────────────────────────────────
async function initApp() {
  connectWs();
  await Promise.all([loadStats(), loadPhones(), loadAgents(), loadKbs()]);
  renderOverview();
  renderPhonesTable();
  renderAgentsGrid();
  renderKbGrid();
  loadSettingsTab();
  setPhoneUrlTemplate();
}

// ── Stats ──────────────────────────────────────────────────
async function loadStats() {
  const data = await api('GET', '/api/stats');
  document.getElementById('statPhones').textContent  = data.phones;
  document.getElementById('statOnline').textContent  = data.online;
  document.getElementById('statAgents').textContent  = data.agents;
  document.getElementById('statKb').textContent      = data.knowledge;
  document.getElementById('statMsgs').textContent    = data.messages;
  document.getElementById('phoneBadge').textContent  = data.phones;
  document.getElementById('agentBadge').textContent  = data.agents;
  document.getElementById('kbBadge').textContent     = data.knowledge;
}

document.getElementById('refreshStats').addEventListener('click', () => { loadStats(); loadPhones().then(() => { renderOverview(); renderPhonesTable(); }); });

// ── Phones ─────────────────────────────────────────────────
async function loadPhones() {
  phones = await api('GET', '/api/phones');
  onlinePhones = new Set(phones.filter(p => p.online).map(p => p.id));
}

function renderOverview() {
  const grid = document.getElementById('overviewPhones');
  grid.innerHTML = phones.length === 0
    ? '<p style="color:var(--text3);font-size:0.875rem;">No phones yet — add some in the Phones tab.</p>'
    : phones.map(p => `
      <div class="phone-status-card" onclick="openPhoneDetail('${p.id}')">
        <span class="phone-dot ${onlinePhones.has(p.id) ? 'online' : ''}"></span>
        <div>
          <div class="phone-card-name">${esc(p.name)}</div>
          <div class="phone-card-cust">${esc(p.customer) || 'No customer set'}</div>
        </div>
      </div>`).join('');
}

function renderPhonesTable() {
  document.getElementById('phonesTbody').innerHTML = phones.map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.customer) || '—'}</td>
      <td class="passcode-cell">${esc(p.passcode)}</td>
      <td>
        <span class="online-chip ${onlinePhones.has(p.id) ? 'online' : ''}">
          <span class="dot"></span>
          ${onlinePhones.has(p.id) ? 'Online' : 'Offline'}
        </span>
      </td>
      <td>
        <div class="action-btns">
          <button class="btn-sm" onclick="openPhoneDetail('${p.id}')">View</button>
          <button class="btn-sm" onclick="editPhone('${p.id}')">Edit</button>
          <button class="btn-sm" onclick="deletePhone('${p.id}')">Delete</button>
        </div>
      </td>
    </tr>`).join('');
}

function updateOnlineUI() {
  document.querySelectorAll('.phone-dot').forEach(dot => {
    const id = dot.closest('[data-phone-id]')?.dataset.phoneId;
    if (id) dot.classList.toggle('online', onlinePhones.has(id));
  });
  document.getElementById('statOnline').textContent = onlinePhones.size;
}

// Add Phone
document.getElementById('addPhoneBtn').addEventListener('click', () => {
  document.getElementById('phoneModalTitle').textContent = 'Add Phone';
  document.getElementById('phoneMId').value = '';
  document.getElementById('phoneMName').value = '';
  document.getElementById('phoneMCustomer').value = '';
  document.getElementById('phoneMPasscode').value = '0000';
  document.getElementById('phoneMNotes').value = '';
  showModal('phoneModal');
});

function editPhone(id) {
  const p = phones.find(x => x.id === id);
  if (!p) return;
  document.getElementById('phoneModalTitle').textContent = 'Edit Phone';
  document.getElementById('phoneMId').value       = p.id;
  document.getElementById('phoneMName').value     = p.name;
  document.getElementById('phoneMCustomer').value = p.customer;
  document.getElementById('phoneMPasscode').value = p.passcode;
  document.getElementById('phoneMNotes').value    = p.notes;
  showModal('phoneModal');
}

document.getElementById('savePhoneBtn').addEventListener('click', async () => {
  const id   = document.getElementById('phoneMId').value;
  const body = {
    name:     document.getElementById('phoneMName').value.trim(),
    customer: document.getElementById('phoneMCustomer').value.trim(),
    passcode: document.getElementById('phoneMPasscode').value.trim() || '0000',
    notes:    document.getElementById('phoneMNotes').value.trim(),
  };
  if (!body.name) return alert('Name is required');
  try {
    if (id) {
      await api('PUT', `/api/phones/${id}`, body);
      toast('Phone updated');
    } else {
      await api('POST', '/api/phones', body);
      toast('Phone added');
    }
    hideModal('phoneModal');
    await loadPhones();
    renderPhonesTable();
    renderOverview();
    loadStats();
  } catch (e) { toast(e.message, 'error'); }
});

async function deletePhone(id) {
  if (!confirm('Delete this phone? All its history will be lost.')) return;
  await api('DELETE', `/api/phones/${id}`);
  toast('Phone deleted');
  await loadPhones();
  renderPhonesTable();
  renderOverview();
  loadStats();
}

// Phone detail
async function openPhoneDetail(id) {
  const p = phones.find(x => x.id === id);
  if (!p) return;
  document.getElementById('phoneDetailTitle').textContent = `${p.name}${p.customer ? ` — ${p.customer}` : ''}`;

  const baseUrl = `${location.protocol}//${location.host}/phone?id=${id}`;
  document.getElementById('phoneDetailUrl').textContent = baseUrl;

  // Assignments
  const assign = await api('GET', `/api/assignments/${id}`);
  document.getElementById('detailAgents').innerHTML = assign.agents.length
    ? assign.agents.map(a => `<span class="tag">${a.icon} ${esc(a.name)}</span>`).join('')
    : '<span style="color:var(--text3);font-size:0.82rem;">None assigned</span>';
  document.getElementById('detailKbs').innerHTML = assign.knowledge.length
    ? assign.knowledge.map(k => `<span class="tag">📚 ${esc(k.name)}</span>`).join('')
    : '<span style="color:var(--text3);font-size:0.82rem;">None assigned</span>';

  // History
  const history = await api('GET', `/api/history/${id}`);
  const hEl = document.getElementById('historyMessages');
  if (history.length === 0) {
    hEl.innerHTML = '<div class="hist-empty">No conversation history yet</div>';
  } else {
    hEl.innerHTML = history.map(m => `
      <div class="hist-msg ${m.role}">
        <div class="hist-avatar">${m.role === 'user' ? 'U' : (m.agent_icon || 'A')}</div>
        <div class="hist-bubble">${esc(m.content).replace(/\n/g, '<br>')}</div>
      </div>`).join('');
    hEl.scrollTop = hEl.scrollHeight;
  }

  document.getElementById('clearHistoryBtn').onclick = async () => {
    if (!confirm('Clear all history for this phone?')) return;
    await api('DELETE', `/api/history/${id}`);
    hEl.innerHTML = '<div class="hist-empty">No conversation history yet</div>';
    toast('History cleared');
    loadStats();
  };

  showModal('phoneDetailModal');
}

// ── Agents ─────────────────────────────────────────────────
async function loadAgents() {
  agents = await api('GET', '/api/agents');
}

function renderAgentsGrid() {
  document.getElementById('agentsGrid').innerHTML = agents.length === 0
    ? '<p style="color:var(--text3);">No agents yet — create your first AI agent.</p>'
    : agents.map(a => `
      <div class="item-card">
        <div class="item-card-header">
          <div class="item-icon">${a.icon || '🤖'}</div>
          <div>
            <h3>${esc(a.name)}</h3>
            <p>${esc(a.description) || 'No description'}</p>
          </div>
        </div>
        <div><span class="model-chip">${modelShort(a.model)}</span></div>
        <div class="item-card-footer">
          <button class="btn-sm" onclick="editAgent('${a.id}')">Edit</button>
          <button class="btn-sm" onclick="deleteAgent('${a.id}')">Delete</button>
        </div>
      </div>`).join('');
}

function modelShort(m) {
  if (m.includes('haiku'))  return 'Haiku';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('opus'))   return 'Opus';
  return m;
}

document.getElementById('addAgentBtn').addEventListener('click', () => {
  document.getElementById('agentModalTitle').textContent = 'Create Agent';
  document.getElementById('agentMId').value      = '';
  document.getElementById('agentMIcon').value    = '🤖';
  document.getElementById('agentMName').value    = '';
  document.getElementById('agentMDesc').value    = '';
  document.getElementById('agentMModel').value   = 'claude-sonnet-4-6';
  document.getElementById('agentMPrompt').value  = '';
  showModal('agentModal');
});

function editAgent(id) {
  const a = agents.find(x => x.id === id);
  if (!a) return;
  document.getElementById('agentModalTitle').textContent = 'Edit Agent';
  document.getElementById('agentMId').value      = a.id;
  document.getElementById('agentMIcon').value    = a.icon;
  document.getElementById('agentMName').value    = a.name;
  document.getElementById('agentMDesc').value    = a.description;
  document.getElementById('agentMModel').value   = a.model;
  document.getElementById('agentMPrompt').value  = a.system_prompt;
  showModal('agentModal');
}

document.getElementById('saveAgentBtn').addEventListener('click', async () => {
  const id   = document.getElementById('agentMId').value;
  const body = {
    icon:          document.getElementById('agentMIcon').value.trim() || '🤖',
    name:          document.getElementById('agentMName').value.trim(),
    description:   document.getElementById('agentMDesc').value.trim(),
    model:         document.getElementById('agentMModel').value,
    system_prompt: document.getElementById('agentMPrompt').value.trim(),
  };
  if (!body.name) return alert('Name is required');
  try {
    if (id) {
      await api('PUT', `/api/agents/${id}`, body);
      toast('Agent updated — pushed to assigned phones');
    } else {
      await api('POST', '/api/agents', body);
      toast('Agent created');
    }
    hideModal('agentModal');
    await loadAgents();
    renderAgentsGrid();
    loadStats();
  } catch (e) { toast(e.message, 'error'); }
});

async function deleteAgent(id) {
  if (!confirm('Delete this agent?')) return;
  await api('DELETE', `/api/agents/${id}`);
  toast('Agent deleted');
  await loadAgents();
  renderAgentsGrid();
  loadStats();
}

// ── Knowledge Bases ────────────────────────────────────────
async function loadKbs() {
  kbs = await api('GET', '/api/knowledge');
}

function renderKbGrid() {
  document.getElementById('kbGrid').innerHTML = kbs.length === 0
    ? '<p style="color:var(--text3);">No knowledge bases yet — add product info, FAQs, policies, etc.</p>'
    : kbs.map(k => `
      <div class="item-card">
        <div class="item-card-header">
          <div class="item-icon">📚</div>
          <div>
            <h3>${esc(k.name)}</h3>
            <p style="font-size:0.75rem;color:var(--text3);">Added ${new Date(k.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        <div class="item-card-footer">
          <button class="btn-sm" onclick="editKb('${k.id}')">Edit</button>
          <button class="btn-sm" onclick="deleteKb('${k.id}')">Delete</button>
        </div>
      </div>`).join('');
}

document.getElementById('addKbBtn').addEventListener('click', () => {
  document.getElementById('kbModalTitle').textContent = 'Add Knowledge Base';
  document.getElementById('kbMId').value      = '';
  document.getElementById('kbMName').value    = '';
  document.getElementById('kbMContent').value = '';
  showModal('kbModal');
});

async function editKb(id) {
  const kb = await api('GET', `/api/knowledge/${id}`);
  document.getElementById('kbModalTitle').textContent = 'Edit Knowledge Base';
  document.getElementById('kbMId').value      = kb.id;
  document.getElementById('kbMName').value    = kb.name;
  document.getElementById('kbMContent').value = kb.content;
  showModal('kbModal');
}

document.getElementById('saveKbBtn').addEventListener('click', async () => {
  const id   = document.getElementById('kbMId').value;
  const body = {
    name:    document.getElementById('kbMName').value.trim(),
    content: document.getElementById('kbMContent').value.trim(),
  };
  if (!body.name) return alert('Name is required');
  try {
    if (id) {
      await api('PUT', `/api/knowledge/${id}`, body);
      toast('Knowledge base updated — pushed to assigned phones');
    } else {
      await api('POST', '/api/knowledge', body);
      toast('Knowledge base created');
    }
    hideModal('kbModal');
    await loadKbs();
    renderKbGrid();
    loadStats();
  } catch (e) { toast(e.message, 'error'); }
});

async function deleteKb(id) {
  if (!confirm('Delete this knowledge base?')) return;
  await api('DELETE', `/api/knowledge/${id}`);
  toast('Knowledge base deleted');
  await loadKbs();
  renderKbGrid();
  loadStats();
}

// ── Push Tab ───────────────────────────────────────────────
function renderPushForm() {
  // Phones
  const phoneList = document.getElementById('pushPhoneList');
  phoneList.innerHTML = phones.map(p => `
    <label class="check-label">
      <input type="checkbox" name="push-phone" value="${p.id}" />
      ${esc(p.name)}${p.customer ? ` — ${esc(p.customer)}` : ''}
    </label>`).join('');

  // Agents
  const agentList = document.getElementById('pushAgentList');
  agentList.innerHTML = agents.length === 0
    ? '<p style="color:var(--text3);font-size:0.82rem;padding:8px">No agents created yet</p>'
    : agents.map(a => `
      <label class="check-label">
        <input type="checkbox" name="push-agent" value="${a.id}" />
        ${a.icon} ${esc(a.name)}
      </label>`).join('');

  // KBs
  const kbList = document.getElementById('pushKbList');
  kbList.innerHTML = kbs.length === 0
    ? '<p style="color:var(--text3);font-size:0.82rem;padding:8px">No knowledge bases yet</p>'
    : kbs.map(k => `
      <label class="check-label">
        <input type="checkbox" name="push-kb" value="${k.id}" />
        📚 ${esc(k.name)}
      </label>`).join('');
}

const pushAllChk = document.getElementById('pushAll');
pushAllChk.addEventListener('change', () => {
  document.querySelectorAll('[name="push-phone"]').forEach(c => c.disabled = pushAllChk.checked);
});

document.getElementById('doPushBtn').addEventListener('click', async () => {
  const pushAll = pushAllChk.checked;
  const phoneIds = pushAll ? ['all'] : [...document.querySelectorAll('[name="push-phone"]:checked')].map(c => c.value);
  const agentIds = [...document.querySelectorAll('[name="push-agent"]:checked')].map(c => c.value);
  const kbIds    = [...document.querySelectorAll('[name="push-kb"]:checked')].map(c => c.value);
  const mode     = document.querySelector('[name="pushMode"]:checked').value;

  if (phoneIds.length === 0) return toast('Select at least one phone', 'error');

  try {
    const res = await api('POST', '/api/assign', { phoneIds, agentIds, kbIds, mode });
    const result = document.getElementById('pushResult');
    result.textContent = `✓ Pushed to ${res.updated} phone${res.updated !== 1 ? 's' : ''}!`;
    setTimeout(() => result.textContent = '', 4000);
    toast(`Pushed to ${res.updated} phone${res.updated !== 1 ? 's' : ''}`);
  } catch (e) { toast(e.message, 'error'); }
});

// ── Settings Tab ───────────────────────────────────────────
async function loadSettingsTab() {
  try {
    const data = await api('GET', '/api/settings');
    const statusEl = document.getElementById('apiKeyStatus');
    if (data.hasApiKey) {
      statusEl.className = 'status-badge ok';
      statusEl.textContent = '✓ API key is set';
    } else {
      statusEl.className = 'status-badge err';
      statusEl.textContent = '✗ No API key — add one to enable AI';
    }
  } catch {}
}

document.getElementById('saveApiKey').addEventListener('click', async () => {
  const key = document.getElementById('settingsApiKey').value.trim();
  if (!key) return;
  try {
    await api('POST', '/api/settings', { apiKey: key });
    document.getElementById('settingsApiKey').value = '';
    toast('API key saved');
    loadSettingsTab();
  } catch (e) { toast(e.message, 'error'); }
});

function setPhoneUrlTemplate() {
  const base = `${location.protocol}//${location.host}/phone?id=PHONE_ID`;
  document.getElementById('phoneUrlTemplate').textContent = base;
}

// ── Modal helpers ──────────────────────────────────────────
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => hideModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

// ── Toast ──────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── Escape HTML ────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
