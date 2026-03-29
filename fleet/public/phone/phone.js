/* ===== ARIA Phone UI — phone.js ===== */

// ── Bootstrap ──────────────────────────────────────────────
const params   = new URLSearchParams(location.search);
const PHONE_ID = params.get('id') || '';
let passcode   = sessionStorage.getItem(`aria_pass_${PHONE_ID}`) || '';
let phoneData  = null;
let agents     = [];
let activeAgent = null;
let history    = [];     // [{role, content}]
let ws         = null;

if (!PHONE_ID) showError('No phone ID in URL. Contact your administrator.');
else if (passcode) tryLogin(passcode);
else showPasscodeScreen();

// ── Passcode Screen ────────────────────────────────────────
function showPasscodeScreen() {
  document.getElementById('passcodeScreen').classList.remove('hidden');
}

let passBuf = '';
document.querySelectorAll('.num-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const n = btn.dataset.n;
    if (n === 'clear') {
      passBuf = passBuf.slice(0, -1);
    } else if (n === 'ok') {
      if (passBuf) tryLogin(passBuf);
    } else {
      if (passBuf.length < 8) passBuf += n;
    }
    renderDots();
  });
});

function renderDots() {
  const dots = document.querySelectorAll('.passcode-dots span');
  dots.forEach((d, i) => {
    d.className = i < passBuf.length ? 'filled' : '';
  });
}

async function tryLogin(code) {
  try {
    const res = await fetch('/api/phone/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneId: PHONE_ID, passcode: code }),
    });

    if (res.status === 401) {
      showPasscodeError('Wrong passcode');
      passBuf = '';
      renderDots();
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showError(err.error || 'Failed to connect');
      return;
    }

    const data = await res.json();
    passcode = code;
    sessionStorage.setItem(`aria_pass_${PHONE_ID}`, code);
    phoneData = data.phone;
    agents    = data.agents;

    document.getElementById('passcodeScreen').classList.add('hidden');
    bootApp();

  } catch (e) {
    showPasscodeError('Connection error — check network');
    passBuf = '';
    renderDots();
  }
}

function showPasscodeError(msg) {
  const dots = document.querySelectorAll('.passcode-dots span');
  dots.forEach(d => d.className = 'error');
  document.getElementById('passcodeErr').textContent = msg;
  setTimeout(() => {
    dots.forEach(d => d.className = '');
    document.getElementById('passcodeErr').textContent = '';
  }, 1200);
}

// ── Boot App ───────────────────────────────────────────────
function bootApp() {
  document.getElementById('phoneNameLabel').textContent = phoneData.name;
  connectWs();
  showAgentSelect();
}

// ── WebSocket ──────────────────────────────────────────────
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', role: 'phone', phoneId: PHONE_ID, passcode }));
    setOnlineDot(true);
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'config_update') {
      agents = msg.agents;
      renderAgentList();
      if (activeAgent) {
        const updated = agents.find(a => a.id === activeAgent.id);
        if (updated) {
          activeAgent = updated;
          updateChatHeader();
        }
      }
    }
  };

  ws.onclose = () => {
    setOnlineDot(false);
    setTimeout(connectWs, 5000);
  };
  ws.onerror = () => ws.close();

  setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' })); }, 25000);
}

function setOnlineDot(on) {
  document.querySelectorAll('.online-dot').forEach(d => {
    d.classList.toggle('connected', on);
  });
}

// ── Agent Select ───────────────────────────────────────────
function showAgentSelect() {
  document.getElementById('agentSelectScreen').classList.remove('hidden');
  document.getElementById('chatScreen').classList.add('hidden');
  renderAgentList();
}

function renderAgentList() {
  const list = document.getElementById('agentList');
  if (agents.length === 0) {
    list.innerHTML = `
      <div class="no-agents">
        <div class="hex">⬡</div>
        <p>No assistants available yet.<br>Check back soon!</p>
      </div>`;
    return;
  }
  list.innerHTML = agents.map(a => `
    <div class="agent-card" data-id="${a.id}">
      <div class="agent-emoji">${a.icon || '🤖'}</div>
      <div class="agent-card-text">
        <div class="agent-card-name">${esc(a.name)}</div>
        ${a.description ? `<div class="agent-card-desc">${esc(a.description)}</div>` : ''}
      </div>
      <div class="agent-card-arrow">›</div>
    </div>`).join('');

  list.querySelectorAll('.agent-card').forEach(card => {
    card.addEventListener('click', () => openChat(card.dataset.id));
  });
}

// ── Chat ───────────────────────────────────────────────────
function openChat(agentId) {
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;
  activeAgent = agent;
  history = [];

  document.getElementById('agentSelectScreen').classList.add('hidden');
  document.getElementById('chatScreen').classList.remove('hidden');

  updateChatHeader();
  clearMessages();
  appendMsg('ai', `Hi! I'm **${agent.name}**. ${agent.description || 'How can I help you today?'}`);
}

function updateChatHeader() {
  document.getElementById('chatAgentIcon').textContent  = activeAgent.icon || '🤖';
  document.getElementById('chatAgentName').textContent  = activeAgent.name;
  document.getElementById('chatAgentStatus').textContent = 'Ready';
}

document.getElementById('backBtn').addEventListener('click', showAgentSelect);

document.getElementById('clearChatBtn').addEventListener('click', () => {
  history = [];
  clearMessages();
  appendMsg('ai', `Starting fresh! How can I help?`);
});

// Send
document.getElementById('msgInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
document.getElementById('sendBtn').addEventListener('click', sendMessage);

async function sendMessage() {
  const input = document.getElementById('msgInput');
  const text  = input.value.trim();
  if (!text || !activeAgent) return;
  input.value = '';

  appendMsg('user', text);
  setStatus('Thinking…');
  showTyping(true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneId: PHONE_ID,
        passcode,
        agentId: activeAgent.id,
        message: text,
        history,
      }),
    });

    showTyping(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      appendMsg('ai', `Sorry, I ran into an issue: ${err.error || 'Unknown error'}`);
      setStatus('Error');
      return;
    }

    const data = await res.json();
    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: data.reply });
    // Keep last 20 turns
    if (history.length > 40) history = history.slice(-40);

    appendMsg('ai', data.reply);
    setStatus('Ready');

    // TTS
    if (window.speechSynthesis) speak(data.reply);

  } catch (e) {
    showTyping(false);
    appendMsg('ai', 'Connection error. Please try again.');
    setStatus('Offline');
  }
}

// ── Voice Input ────────────────────────────────────────────
const micBtn = document.getElementById('micBtn');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = (e) => {
    const t = e.results[0][0].transcript.trim();
    if (t) {
      document.getElementById('msgInput').value = t;
      sendMessage();
    }
    micBtn.classList.remove('listening');
  };
  recognition.onerror = () => micBtn.classList.remove('listening');
  recognition.onend   = () => micBtn.classList.remove('listening');

  micBtn.addEventListener('click', () => {
    if (micBtn.classList.contains('listening')) {
      recognition.stop();
    } else {
      recognition.start();
      micBtn.classList.add('listening');
    }
  });
} else {
  micBtn.style.opacity = '0.4';
  micBtn.style.cursor  = 'not-allowed';
}

// ── TTS ────────────────────────────────────────────────────
function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text.replace(/\*\*(.*?)\*\*/g, '$1'));
  utt.rate = 1.05;
  utt.onstart = () => setStatus('Speaking…');
  utt.onend   = () => setStatus('Ready');
  window.speechSynthesis.speak(utt);
}

// ── UI Helpers ─────────────────────────────────────────────
function appendMsg(role, text) {
  const msgs = document.getElementById('chatMessages');
  const div  = document.createElement('div');
  div.className = `msg ${role}`;

  const av   = document.createElement('div');
  av.className = 'msg-av';
  av.textContent = role === 'user' ? 'You' : (activeAgent?.icon || 'A');

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  // Light markdown
  const html = esc(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  bubble.innerHTML = `<p>${html}</p>`;

  div.appendChild(av);
  div.appendChild(bubble);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function clearMessages() {
  document.getElementById('chatMessages').innerHTML = '';
}

function showTyping(show) {
  document.getElementById('typingWrap').style.display = show ? 'flex' : 'none';
  if (show) document.getElementById('chatMessages').scrollTop = 9999;
}

function setStatus(s) {
  document.getElementById('chatAgentStatus').textContent = s;
}

function showError(msg) {
  document.getElementById('passcodeScreen').classList.add('hidden');
  document.getElementById('agentSelectScreen').classList.add('hidden');
  document.getElementById('chatScreen').classList.add('hidden');
  document.getElementById('errorMsg').textContent = msg;
  document.getElementById('errorScreen').classList.remove('hidden');
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
