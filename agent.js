/* ===== ARIA Face-to-Face Agent — agent.js ===== */

// ── State ──────────────────────────────────────────────────
const state = {
  apiKey:       sessionStorage.getItem('aria_api_key') || '',
  model:        sessionStorage.getItem('aria_model') || 'claude-sonnet-4-6',
  autoSpeak:    sessionStorage.getItem('aria_autospeak') !== 'false',
  systemPrompt: sessionStorage.getItem('aria_sysprompt') || '',
  voiceName:    sessionStorage.getItem('aria_voice') || '',
  agentState:   'idle',       // idle | listening | thinking | speaking
  messages:     [],           // conversation history
  isSpeaking:   false,
  isListening:  false,
  recognition:  null,
  synth:        window.speechSynthesis || null,
  voices:       [],
};

// Default system prompt
const DEFAULT_SYSTEM = `You are ARIA (AI Research & Intelligence Agent), NexusAI's expert AI assistant. You are helpful, knowledgeable, and concise.
You assist users with:
- Questions about NexusAI's AI services (strategy, custom models, integrations, agentic systems, MLOps, AI governance)
- General AI concepts, machine learning, and industry trends
- Exploring how AI can transform their specific business

Keep responses conversational and concise (2-4 paragraphs max for voice, slightly longer for complex topics). Be friendly and professional.`;

// ── DOM refs ───────────────────────────────────────────────
const avatarContainer = document.getElementById('avatarContainer');
const statusDot       = document.getElementById('statusDot');
const statusText      = document.getElementById('statusText');
const chatMessages    = document.getElementById('chatMessages');
const chatInput       = document.getElementById('chatInput');
const sendBtn         = document.getElementById('sendBtn');
const micBtn          = document.getElementById('micBtn');
const micLabel        = document.getElementById('micLabel');
const waveform        = document.getElementById('waveform');
const typingIndicator = document.getElementById('typingIndicator');
const hintText        = document.getElementById('hintText');
const apiBanner       = document.getElementById('apiBanner');
const modalOverlay    = document.getElementById('modalOverlay');
const apiKeyInput     = document.getElementById('apiKeyInput');
const modelSelect     = document.getElementById('modelSelect');
const voiceSelect     = document.getElementById('voiceSelect');
const autoSpeak       = document.getElementById('autoSpeak');
const syspromptToggle = document.getElementById('systemPromptToggle');
const syspromptGroup  = document.getElementById('systemPromptGroup');
const syspromptInput  = document.getElementById('systemPromptInput');
const faceCanvas      = document.getElementById('faceCanvas');

// ── Face Canvas Animation ──────────────────────────────────
const faceCtx = faceCanvas.getContext('2d');
let faceTime     = 0;
let mouthOpen    = 0;
let targetMouth  = 0;
let blinkTimer   = 180;
let blinkVal     = 1;
let scanLine     = 0;

function drawFace() {
  const W  = faceCanvas.width;
  const H  = faceCanvas.height;
  const cx = W / 2;
  const cy = H / 2;
  const R  = W * 0.46;

  faceCtx.clearRect(0, 0, W, H);

  // Face base gradient
  const baseGrad = faceCtx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, R * 0.05, cx, cy, R);
  baseGrad.addColorStop(0, '#312e81');
  baseGrad.addColorStop(0.55, '#1e1b4b');
  baseGrad.addColorStop(1, '#09070f');
  faceCtx.beginPath();
  faceCtx.arc(cx, cy, R, 0, Math.PI * 2);
  faceCtx.fillStyle = baseGrad;
  faceCtx.fill();

  // Face glow ring
  const s = state.agentState;
  let glowColor = 'rgba(99,102,241,';
  if (s === 'listening') glowColor = 'rgba(6,182,212,';
  if (s === 'thinking')  glowColor = 'rgba(251,191,36,';
  if (s === 'speaking')  glowColor = 'rgba(167,139,250,';
  const glowAlpha = 0.5 + 0.4 * Math.sin(faceTime * 0.04);
  faceCtx.beginPath();
  faceCtx.arc(cx, cy, R, 0, Math.PI * 2);
  faceCtx.strokeStyle = `${glowColor}${glowAlpha})`;
  faceCtx.lineWidth = 2.5;
  faceCtx.stroke();

  // Scan lines (grid) — subtle
  faceCtx.save();
  faceCtx.beginPath();
  faceCtx.arc(cx, cy, R - 1, 0, Math.PI * 2);
  faceCtx.clip();
  faceCtx.strokeStyle = 'rgba(99,102,241,0.04)';
  faceCtx.lineWidth = 1;
  for (let y = 0; y < H; y += 8) {
    faceCtx.beginPath();
    faceCtx.moveTo(0, y);
    faceCtx.lineTo(W, y);
    faceCtx.stroke();
  }
  faceCtx.restore();

  // Forehead indicator light
  const lightPulse = 0.6 + 0.4 * Math.sin(faceTime * 0.08);
  faceCtx.beginPath();
  faceCtx.arc(cx, cy - R * 0.68, R * 0.04, 0, Math.PI * 2);
  faceCtx.fillStyle = `${glowColor}${lightPulse})`;
  faceCtx.fill();

  // Eyes
  drawEyes(cx, cy, R);

  // Mouth
  drawMouth(cx, cy, R);

  // Thinking overlay
  if (s === 'thinking') drawThinkingRing(cx, cy, R);

  // Update animations
  faceTime++;
  updateFaceAnimations();
  requestAnimationFrame(drawFace);
}

function drawEyes(cx, cy, R) {
  const eyeY  = cy - R * 0.15;
  const eyeSp = R * 0.32;
  const eyeR  = R * 0.13;
  const s     = state.agentState;

  for (const side of [-1, 1]) {
    const ex = cx + side * eyeSp;

    // Outer glow
    const outerGrad = faceCtx.createRadialGradient(ex, eyeY, 0, ex, eyeY, eyeR * 2);
    let glowA = s === 'listening' ? 0.25 : s === 'speaking' ? 0.2 : 0.12;
    const glowC = s === 'listening' ? '6,182,212' : '99,102,241';
    outerGrad.addColorStop(0, `rgba(${glowC},${glowA})`);
    outerGrad.addColorStop(1, 'transparent');
    faceCtx.beginPath();
    faceCtx.arc(ex, eyeY, eyeR * 2, 0, Math.PI * 2);
    faceCtx.fillStyle = outerGrad;
    faceCtx.fill();

    // Eye socket
    faceCtx.beginPath();
    faceCtx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
    faceCtx.fillStyle = '#07050f';
    faceCtx.fill();
    faceCtx.strokeStyle = 'rgba(99,102,241,0.3)';
    faceCtx.lineWidth = 1;
    faceCtx.stroke();

    // Iris — blink via vertical scale
    const openH = eyeR * 0.8 * blinkVal;
    if (openH > 1) {
      faceCtx.save();
      faceCtx.translate(ex, eyeY);
      faceCtx.scale(1, blinkVal);
      const irisGrad = faceCtx.createRadialGradient(-eyeR * 0.2, -eyeR * 0.2, 0, 0, 0, eyeR * 0.8);
      const bright = s === 'speaking' ? 1 : s === 'listening' ? 0.95 : 0.8;
      irisGrad.addColorStop(0,   `rgba(167,139,250,${bright})`);
      irisGrad.addColorStop(0.5, `rgba(99,102,241,${bright})`);
      irisGrad.addColorStop(1,   `rgba(55,48,163,${bright})`);
      faceCtx.beginPath();
      faceCtx.arc(0, 0, eyeR * 0.8, 0, Math.PI * 2);
      faceCtx.fillStyle = irisGrad;
      faceCtx.fill();
      faceCtx.restore();

      // Pupil + gaze drift (thinking = wander, speaking = center focus)
      let gx = 0, gy = 0;
      if (s === 'thinking') {
        gx = Math.sin(faceTime * 0.025 + side * 1.5) * eyeR * 0.22;
        gy = Math.cos(faceTime * 0.018) * eyeR * 0.18;
      }
      faceCtx.beginPath();
      faceCtx.arc(ex + gx, eyeY + gy * blinkVal, eyeR * 0.22, 0, Math.PI * 2);
      faceCtx.fillStyle = '#090714';
      faceCtx.fill();

      // Specular dot
      faceCtx.beginPath();
      faceCtx.arc(ex + gx - eyeR * 0.18, eyeY + gy * blinkVal - eyeR * 0.2, eyeR * 0.1, 0, Math.PI * 2);
      faceCtx.fillStyle = 'rgba(255,255,255,0.7)';
      faceCtx.fill();
    }

    // Listening scan line
    if (s === 'listening') {
      const scanY = eyeY - eyeR * 0.7 + ((faceTime * 2) % (eyeR * 1.4));
      faceCtx.save();
      faceCtx.beginPath();
      faceCtx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
      faceCtx.clip();
      faceCtx.fillStyle = 'rgba(6,182,212,0.35)';
      faceCtx.fillRect(ex - eyeR, scanY, eyeR * 2, 1.5);
      faceCtx.restore();
    }
  }
}

function drawMouth(cx, cy, R) {
  const mY  = cy + R * 0.32;
  const mW  = R * 0.48;
  const s   = state.agentState;

  if (s === 'speaking') {
    // Animated open/close mouth
    const openH = mouthOpen * R * 0.22;
    const lipColor = 'rgba(99,102,241,0.9)';

    // Fill
    if (openH > 1) {
      faceCtx.beginPath();
      faceCtx.moveTo(cx - mW, mY);
      faceCtx.bezierCurveTo(cx - mW * 0.5, mY - openH * 0.15, cx + mW * 0.5, mY - openH * 0.15, cx + mW, mY);
      faceCtx.bezierCurveTo(cx + mW * 0.5, mY + openH, cx - mW * 0.5, mY + openH, cx - mW, mY);
      faceCtx.fillStyle = '#090714';
      faceCtx.fill();

      // Interior glow
      faceCtx.beginPath();
      faceCtx.moveTo(cx - mW * 0.8, mY + openH * 0.2);
      faceCtx.lineTo(cx + mW * 0.8, mY + openH * 0.2);
      faceCtx.strokeStyle = 'rgba(129,140,248,0.4)';
      faceCtx.lineWidth = 1;
      faceCtx.stroke();
    }

    // Outline
    faceCtx.beginPath();
    faceCtx.moveTo(cx - mW, mY);
    faceCtx.bezierCurveTo(cx - mW * 0.5, mY - openH * 0.15, cx + mW * 0.5, mY - openH * 0.15, cx + mW, mY);
    faceCtx.strokeStyle = lipColor;
    faceCtx.lineWidth = 2;
    faceCtx.lineCap = 'round';
    faceCtx.stroke();

  } else if (s === 'listening') {
    // Slight eager smile
    faceCtx.beginPath();
    faceCtx.moveTo(cx - mW * 0.7, mY);
    faceCtx.quadraticCurveTo(cx, mY + R * 0.1, cx + mW * 0.7, mY);
    faceCtx.strokeStyle = 'rgba(6,182,212,0.9)';
    faceCtx.lineWidth = 2;
    faceCtx.lineCap = 'round';
    faceCtx.stroke();

  } else {
    // Neutral / thinking: gentle smile
    faceCtx.beginPath();
    faceCtx.moveTo(cx - mW * 0.55, mY);
    faceCtx.quadraticCurveTo(cx, mY + R * 0.07, cx + mW * 0.55, mY);
    faceCtx.strokeStyle = 'rgba(99,102,241,0.6)';
    faceCtx.lineWidth = 2;
    faceCtx.lineCap = 'round';
    faceCtx.stroke();
  }
}

function drawThinkingRing(cx, cy, R) {
  const angle = (faceTime * 0.06) % (Math.PI * 2);
  const ringR  = R + 6;
  const arcLen = Math.PI * 1.3;

  // Rotating arc
  faceCtx.beginPath();
  faceCtx.arc(cx, cy, ringR, angle, angle + arcLen);
  faceCtx.strokeStyle = 'rgba(251,191,36,0.7)';
  faceCtx.lineWidth = 3;
  faceCtx.lineCap = 'round';
  faceCtx.stroke();

  // Leading dot
  const ldx = cx + Math.cos(angle + arcLen) * ringR;
  const ldy = cy + Math.sin(angle + arcLen) * ringR;
  faceCtx.beginPath();
  faceCtx.arc(ldx, ldy, 3.5, 0, Math.PI * 2);
  faceCtx.fillStyle = 'rgba(251,191,36,1)';
  faceCtx.fill();
}

function updateFaceAnimations() {
  // Mouth
  if (state.agentState === 'speaking') {
    if (faceTime % 5 === 0) targetMouth = Math.random();
    mouthOpen += (targetMouth - mouthOpen) * 0.25;
  } else {
    mouthOpen += (0 - mouthOpen) * 0.12;
  }

  // Blink
  blinkTimer--;
  if (blinkTimer <= 0) {
    blinkTimer = 160 + Math.random() * 120;
  }
  const blinkDur = 8;
  const rem = blinkTimer;
  if (rem < blinkDur) {
    blinkVal = rem < blinkDur / 2
      ? rem / (blinkDur / 2)
      : 1 - (rem - blinkDur / 2) / (blinkDur / 2);
    blinkVal = Math.max(0.05, blinkVal);
  } else {
    blinkVal = 1;
  }
}

// ── Agent State Management ─────────────────────────────────
function setAgentState(s) {
  state.agentState = s;
  const labels = { idle: 'Ready', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' };
  statusText.textContent = labels[s] || s;

  statusDot.className = `status-dot ${s}`;
  avatarContainer.className = `avatar-container ${s}`;

  // Waveform
  if (s === 'listening' || s === 'speaking') {
    waveform.classList.add('active');
  } else {
    waveform.classList.remove('active');
  }

  // Mic button
  micBtn.classList.toggle('listening', s === 'listening');
  micLabel.textContent = s === 'listening' ? 'Listening…' : 'Click to Speak';
}

// ── Speech Recognition ─────────────────────────────────────
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.classList.add('disabled');
    micBtn.title = 'Speech recognition not supported in this browser';
    return;
  }

  const recog = new SpeechRecognition();
  recog.continuous = false;
  recog.interimResults = false;
  recog.lang = 'en-US';

  recog.onstart = () => {
    state.isListening = true;
    setAgentState('listening');
  };

  recog.onresult = (e) => {
    const transcript = e.results[0][0].transcript.trim();
    if (transcript) {
      chatInput.value = transcript;
      sendMessage(transcript);
    }
  };

  recog.onerror = (e) => {
    console.warn('Speech recognition error:', e.error);
    state.isListening = false;
    setAgentState('idle');
    if (e.error === 'not-allowed') {
      micBtn.classList.add('disabled');
      micBtn.title = 'Microphone access denied';
    }
  };

  recog.onend = () => {
    state.isListening = false;
    if (state.agentState === 'listening') setAgentState('idle');
  };

  state.recognition = recog;
}

// ── Text-to-Speech ─────────────────────────────────────────
function populateVoices() {
  if (!state.synth) return;
  const load = () => {
    state.voices = state.synth.getVoices().filter(v => v.lang.startsWith('en'));
    voiceSelect.innerHTML = '<option value="">System Default</option>';
    state.voices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.name === state.voiceName) opt.selected = true;
      voiceSelect.appendChild(opt);
    });
  };
  load();
  state.synth.onvoiceschanged = load;
}

function speak(text) {
  if (!state.synth || !state.autoSpeak) return Promise.resolve();
  state.synth.cancel();

  return new Promise((resolve) => {
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate  = 1.05;
    utt.pitch = 1.0;
    utt.volume = 1;

    if (state.voiceName) {
      const v = state.voices.find(v => v.name === state.voiceName);
      if (v) utt.voice = v;
    }

    utt.onstart = () => {
      state.isSpeaking = true;
      setAgentState('speaking');
    };

    utt.onend = utt.onerror = () => {
      state.isSpeaking = false;
      setAgentState('idle');
      resolve();
    };

    state.synth.speak(utt);
  });
}

// ── Chat UI Helpers ────────────────────────────────────────
function appendMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `message message--${role === 'user' ? 'user' : 'ai'}`;

  const avatar = document.createElement('div');
  avatar.className = 'message__avatar';
  avatar.textContent = role === 'user' ? 'U' : 'A';

  const bubble = document.createElement('div');
  bubble.className = 'message__bubble';

  // Convert markdown-lite: **bold**, newlines
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  bubble.innerHTML = `<p>${html}</p>`;

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  chatMessages.appendChild(wrap);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return wrap;
}

function showTyping(show) {
  typingIndicator.style.display = show ? 'flex' : 'none';
  if (show) chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── API Call ───────────────────────────────────────────────
async function callClaude(userMessage) {
  // Add to history
  state.messages.push({ role: 'user', content: userMessage });

  if (!state.apiKey) {
    // Demo mode
    return getDemoResponse(userMessage);
  }

  const systemPrompt = state.systemPrompt || DEFAULT_SYSTEM;

  const body = {
    model: state.model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: state.messages.map(m => ({ role: m.role, content: m.content })),
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':            'application/json',
      'x-api-key':               state.apiKey,
      'anthropic-version':       '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

// Demo mode responses (no API key)
const demoResponses = [
  "Hi! I'm running in **demo mode** right now — add your Anthropic API key in settings (⚙️) to unlock full AI conversations. I can discuss AI strategy, custom model development, system integrations, and much more!",
  "In demo mode, I can't give you real AI responses. Once you add an API key, I'll be powered by Claude and can have deep, context-aware conversations about AI and your business needs.",
  "Great question! To get a full answer, set your API key via the ⚙️ settings button. NexusAI specializes in turning AI strategy into production-ready systems — I'd love to tell you more once you're connected.",
];
let demoIdx = 0;
function getDemoResponse(msg) {
  const r = demoResponses[demoIdx % demoResponses.length];
  demoIdx++;
  return r;
}

// ── Send Message Flow ──────────────────────────────────────
async function sendMessage(text) {
  text = text.trim();
  if (!text) return;

  chatInput.value = '';
  sendBtn.disabled = true;

  appendMessage('user', text);
  showTyping(true);
  setAgentState('thinking');

  // Stop any ongoing speech
  if (state.synth) state.synth.cancel();

  try {
    const reply = await callClaude(text);
    state.messages.push({ role: 'assistant', content: reply });
    showTyping(false);
    appendMessage('assistant', reply);
    await speak(reply);
  } catch (err) {
    showTyping(false);
    const errMsg = `I encountered an error: ${err.message}. Please check your API key in settings.`;
    appendMessage('assistant', errMsg);
    setAgentState('idle');
  }

  setAgentState('idle');
  sendBtn.disabled = !chatInput.value.trim();
}

// ── Settings Modal ─────────────────────────────────────────
function openSettings() {
  apiKeyInput.value     = state.apiKey;
  modelSelect.value     = state.model;
  autoSpeak.checked     = state.autoSpeak;
  voiceSelect.value     = state.voiceName;
  syspromptInput.value  = state.systemPrompt;
  syspromptGroup.style.display = state.systemPrompt ? 'flex' : 'none';
  syspromptToggle.checked = !!state.systemPrompt;
  modalOverlay.classList.add('open');
}

function closeSettings() {
  modalOverlay.classList.remove('open');
}

function saveSettings() {
  state.apiKey      = apiKeyInput.value.trim();
  state.model       = modelSelect.value;
  state.autoSpeak   = autoSpeak.checked;
  state.voiceName   = voiceSelect.value;
  state.systemPrompt = syspromptToggle.checked ? syspromptInput.value.trim() : '';

  sessionStorage.setItem('aria_api_key',   state.apiKey);
  sessionStorage.setItem('aria_model',     state.model);
  sessionStorage.setItem('aria_autospeak', state.autoSpeak);
  sessionStorage.setItem('aria_voice',     state.voiceName);
  sessionStorage.setItem('aria_sysprompt', state.systemPrompt);

  updateBannerAndHint();
  closeSettings();
}

function updateBannerAndHint() {
  if (state.apiKey) {
    apiBanner.classList.add('hidden');
    hintText.textContent = `Using ${state.model} · Voice ${state.autoSpeak ? 'on' : 'off'}`;
  } else {
    apiBanner.classList.remove('hidden');
    hintText.textContent = 'Enter your Anthropic API key in settings (⚙️) to enable AI responses';
  }
}

// ── Event Listeners ────────────────────────────────────────
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('bannerSettings').addEventListener('click', () => { apiBanner.classList.add('hidden'); openSettings(); });
document.getElementById('bannerClose').addEventListener('click', () => apiBanner.classList.add('hidden'));
document.getElementById('modalClose').addEventListener('click', closeSettings);
document.getElementById('cancelSettings').addEventListener('click', closeSettings);
document.getElementById('saveSettings').addEventListener('click', saveSettings);

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeSettings();
});

document.getElementById('toggleKey').addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

syspromptToggle.addEventListener('change', () => {
  syspromptGroup.style.display = syspromptToggle.checked ? 'flex' : 'none';
});

chatInput.addEventListener('input', () => {
  sendBtn.disabled = !chatInput.value.trim();
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && chatInput.value.trim()) {
    sendMessage(chatInput.value);
  }
});

sendBtn.addEventListener('click', () => {
  if (chatInput.value.trim()) sendMessage(chatInput.value);
});

micBtn.addEventListener('click', () => {
  if (micBtn.classList.contains('disabled')) return;
  if (!state.recognition) return;

  if (state.isListening) {
    state.recognition.stop();
  } else {
    if (state.isSpeaking && state.synth) state.synth.cancel();
    try {
      state.recognition.start();
    } catch (e) {
      console.warn('Recognition start error:', e);
    }
  }
});

document.getElementById('clearBtn').addEventListener('click', () => {
  state.messages = [];
  chatMessages.innerHTML = '';
  appendMessage('assistant', "Conversation cleared! How can I help you?");
});

// ── Init ───────────────────────────────────────────────────
initSpeechRecognition();
populateVoices();
updateBannerAndHint();
requestAnimationFrame(drawFace);
setAgentState('idle');
