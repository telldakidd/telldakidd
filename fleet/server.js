/**
 * ARIA Fleet Server
 * Central hub for managing 25 AI-powered phones from one admin device.
 *
 * Routes:
 *   GET  /admin        → admin dashboard
 *   GET  /phone        → customer phone UI
 *   /api/*             → REST API
 *   ws://HOST/ws       → WebSocket (real-time push)
 */

const express  = require('express');
const http     = require('http');
const path     = require('path');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');
const { v4: uuid } = require('uuid');

// ── Config ─────────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const DB_PATH    = process.env.DB_PATH || path.join(__dirname, 'fleet.db');
const ADMIN_PIN  = process.env.ADMIN_PIN || '1234';

// ── Database ───────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  PRAGMA journal_mode=WAL;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS phones (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    customer    TEXT DEFAULT '',
    passcode    TEXT DEFAULT '0000',
    notes       TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT DEFAULT '',
    system_prompt TEXT DEFAULT '',
    model         TEXT DEFAULT 'claude-haiku-4-5-20251001',
    icon          TEXT DEFAULT '🤖',
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS knowledge_bases (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    content    TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS phone_agents (
    phone_id TEXT,
    agent_id TEXT,
    PRIMARY KEY (phone_id, agent_id)
  );

  CREATE TABLE IF NOT EXISTS phone_knowledge (
    phone_id TEXT,
    kb_id    TEXT,
    PRIMARY KEY (phone_id, kb_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    phone_id   TEXT,
    agent_id   TEXT,
    role       TEXT,
    content    TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Helper: get a setting value
function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ── Express App ────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve admin/phone entry points
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));
app.get('/phone', (req, res) => res.sendFile(path.join(__dirname, 'public', 'phone', 'index.html')));

// ── Middleware: simple auth check ──────────────────────────
function requireAdmin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.query.pin;
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requirePhone(req, res, next) {
  const { phoneId, passcode } = req.body;
  if (!phoneId) return res.status(401).json({ error: 'Missing phoneId' });
  const phone = db.prepare('SELECT * FROM phones WHERE id = ?').get(phoneId);
  if (!phone) return res.status(404).json({ error: 'Phone not found' });
  if (phone.passcode && phone.passcode !== passcode) return res.status(401).json({ error: 'Wrong passcode' });
  req.phone = phone;
  next();
}

// ── API: Settings ──────────────────────────────────────────
app.get('/api/settings', requireAdmin, (req, res) => {
  res.json({
    apiKey: getSetting('anthropic_api_key') ? '••••••••' : '',
    adminPin: ADMIN_PIN,
    hasApiKey: !!getSetting('anthropic_api_key'),
  });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const { apiKey } = req.body;
  if (apiKey && apiKey !== '••••••••') setSetting('anthropic_api_key', apiKey.trim());
  res.json({ ok: true });
});

// ── API: Phones ────────────────────────────────────────────
app.get('/api/phones', requireAdmin, (req, res) => {
  const phones = db.prepare('SELECT * FROM phones ORDER BY name').all();
  // annotate with online status
  const online = [...wsClients.values()].map(c => c.phoneId).filter(Boolean);
  res.json(phones.map(p => ({ ...p, online: online.includes(p.id) })));
});

app.post('/api/phones', requireAdmin, (req, res) => {
  const { name, customer, passcode, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuid();
  db.prepare('INSERT INTO phones (id, name, customer, passcode, notes) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, customer || '', passcode || '0000', notes || '');
  res.json({ id, name, customer, passcode, notes });
});

app.put('/api/phones/:id', requireAdmin, (req, res) => {
  const { name, customer, passcode, notes } = req.body;
  db.prepare('UPDATE phones SET name=?, customer=?, passcode=?, notes=? WHERE id=?')
    .run(name, customer, passcode, notes, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/phones/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM phones WHERE id = ?').run(id);
  db.prepare('DELETE FROM phone_agents WHERE phone_id = ?').run(id);
  db.prepare('DELETE FROM phone_knowledge WHERE phone_id = ?').run(id);
  db.prepare('DELETE FROM messages WHERE phone_id = ?').run(id);
  res.json({ ok: true });
});

// ── API: Agents ────────────────────────────────────────────
app.get('/api/agents', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM agents ORDER BY name').all());
});

app.post('/api/agents', requireAdmin, (req, res) => {
  const { name, description, system_prompt, model, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuid();
  db.prepare('INSERT INTO agents (id, name, description, system_prompt, model, icon) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, description || '', system_prompt || '', model || 'claude-haiku-4-5-20251001', icon || '🤖');
  res.json({ id, name, description, system_prompt, model, icon });
});

app.put('/api/agents/:id', requireAdmin, (req, res) => {
  const { name, description, system_prompt, model, icon } = req.body;
  db.prepare('UPDATE agents SET name=?, description=?, system_prompt=?, model=?, icon=? WHERE id=?')
    .run(name, description, system_prompt, model, icon, req.params.id);
  // Push config update to all phones that have this agent
  const phones = db.prepare('SELECT phone_id FROM phone_agents WHERE agent_id = ?').all(req.params.id);
  phones.forEach(row => pushConfigUpdate(row.phone_id));
  res.json({ ok: true });
});

app.delete('/api/agents/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM phone_agents WHERE agent_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── API: Knowledge Bases ───────────────────────────────────
app.get('/api/knowledge', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, created_at FROM knowledge_bases ORDER BY name').all());
});

app.get('/api/knowledge/:id', requireAdmin, (req, res) => {
  const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(req.params.id);
  if (!kb) return res.status(404).json({ error: 'Not found' });
  res.json(kb);
});

app.post('/api/knowledge', requireAdmin, (req, res) => {
  const { name, content } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuid();
  db.prepare('INSERT INTO knowledge_bases (id, name, content) VALUES (?, ?, ?)').run(id, name, content || '');
  res.json({ id, name });
});

app.put('/api/knowledge/:id', requireAdmin, (req, res) => {
  const { name, content } = req.body;
  db.prepare('UPDATE knowledge_bases SET name=?, content=? WHERE id=?').run(name, content, req.params.id);
  // Push config update to phones that have this KB
  const phones = db.prepare('SELECT phone_id FROM phone_knowledge WHERE kb_id = ?').all(req.params.id);
  phones.forEach(row => pushConfigUpdate(row.phone_id));
  res.json({ ok: true });
});

app.delete('/api/knowledge/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM phone_knowledge WHERE kb_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── API: Assignments (push agents + KBs to phones) ─────────
app.get('/api/assignments/:phoneId', requireAdmin, (req, res) => {
  const pid = req.params.phoneId;
  const agents = db.prepare(`
    SELECT a.* FROM agents a
    JOIN phone_agents pa ON pa.agent_id = a.id
    WHERE pa.phone_id = ?
  `).all(pid);
  const knowledge = db.prepare(`
    SELECT kb.id, kb.name FROM knowledge_bases kb
    JOIN phone_knowledge pk ON pk.kb_id = kb.id
    WHERE pk.phone_id = ?
  `).all(pid);
  res.json({ agents, knowledge });
});

app.post('/api/assign', requireAdmin, (req, res) => {
  // { phoneIds: ['all' | id...], agentIds: [...], kbIds: [...], mode: 'set'|'add' }
  const { phoneIds, agentIds = [], kbIds = [], mode = 'set' } = req.body;

  let targets = phoneIds;
  if (!targets || targets.includes('all')) {
    targets = db.prepare('SELECT id FROM phones').all().map(p => p.id);
  }

  const insertAgent = db.prepare('INSERT OR IGNORE INTO phone_agents (phone_id, agent_id) VALUES (?, ?)');
  const insertKb    = db.prepare('INSERT OR IGNORE INTO phone_knowledge (phone_id, kb_id) VALUES (?, ?)');

  db.transaction(() => {
    for (const pid of targets) {
      if (mode === 'set') {
        db.prepare('DELETE FROM phone_agents WHERE phone_id = ?').run(pid);
        db.prepare('DELETE FROM phone_knowledge WHERE phone_id = ?').run(pid);
      }
      agentIds.forEach(aid => insertAgent.run(pid, aid));
      kbIds.forEach(kid => insertKb.run(pid, kid));
    }
  })();

  targets.forEach(pid => pushConfigUpdate(pid));
  res.json({ ok: true, updated: targets.length });
});

app.delete('/api/assign/:phoneId/agent/:agentId', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM phone_agents WHERE phone_id = ? AND agent_id = ?')
    .run(req.params.phoneId, req.params.agentId);
  pushConfigUpdate(req.params.phoneId);
  res.json({ ok: true });
});

app.delete('/api/assign/:phoneId/kb/:kbId', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM phone_knowledge WHERE phone_id = ? AND kb_id = ?')
    .run(req.params.phoneId, req.params.kbId);
  pushConfigUpdate(req.params.phoneId);
  res.json({ ok: true });
});

// ── API: Phone config (called by customer phone on load) ───
app.post('/api/phone/config', (req, res) => {
  const { phoneId, passcode } = req.body;
  const phone = db.prepare('SELECT * FROM phones WHERE id = ?').get(phoneId);
  if (!phone) return res.status(404).json({ error: 'Phone not found' });
  if (phone.passcode && phone.passcode !== passcode) return res.status(401).json({ error: 'Wrong passcode' });

  const agents = db.prepare(`
    SELECT a.* FROM agents a
    JOIN phone_agents pa ON pa.agent_id = a.id
    WHERE pa.phone_id = ?
    ORDER BY a.name
  `).all(phoneId);

  res.json({ phone, agents });
});

// ── API: Chat ──────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { phoneId, passcode, agentId, message, history = [] } = req.body;

  // Auth
  const phone = db.prepare('SELECT * FROM phones WHERE id = ?').get(phoneId);
  if (!phone) return res.status(404).json({ error: 'Phone not found' });
  if (phone.passcode && phone.passcode !== passcode) return res.status(401).json({ error: 'Unauthorized' });

  // Get agent
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Verify this phone has access to this agent
  const hasAccess = db.prepare('SELECT 1 FROM phone_agents WHERE phone_id = ? AND agent_id = ?').get(phoneId, agentId);
  if (!hasAccess) return res.status(403).json({ error: 'Agent not assigned to this phone' });

  // Get knowledge bases
  const kbs = db.prepare(`
    SELECT kb.name, kb.content FROM knowledge_bases kb
    JOIN phone_knowledge pk ON pk.kb_id = kb.id
    JOIN phone_agents pa ON pa.phone_id = pk.phone_id
    WHERE pk.phone_id = ? AND pa.agent_id = ?
  `).all(phoneId, agentId);

  const apiKey = getSetting('anthropic_api_key');
  if (!apiKey) return res.status(503).json({ error: 'No API key configured. Ask your admin to set it up.' });

  // Build system prompt
  let systemPrompt = agent.system_prompt || `You are ${agent.name}, a helpful AI assistant.`;
  if (kbs.length > 0) {
    systemPrompt += '\n\n--- Knowledge Base ---\n';
    kbs.forEach(kb => {
      systemPrompt += `\n## ${kb.name}\n${kb.content}\n`;
    });
    systemPrompt += '\n--- End Knowledge Base ---\nUse the above knowledge to answer questions accurately.';
  }

  // Build message history
  const messages = [
    ...history.slice(-20).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // Call Anthropic API
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      agent.model || 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system:     systemPrompt,
        messages,
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || `API error ${apiRes.status}` });
    }

    const data   = await apiRes.json();
    const reply  = data.content[0].text;

    // Persist to history
    const saveMsg = db.prepare('INSERT INTO messages (id, phone_id, agent_id, role, content) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => {
      saveMsg.run(uuid(), phoneId, agentId, 'user', message);
      saveMsg.run(uuid(), phoneId, agentId, 'assistant', reply);
    })();

    res.json({ reply });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── API: Admin phone history view ──────────────────────────
app.get('/api/history/:phoneId', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, a.name as agent_name, a.icon as agent_icon
    FROM messages m
    LEFT JOIN agents a ON a.id = m.agent_id
    WHERE m.phone_id = ?
    ORDER BY m.created_at DESC
    LIMIT 200
  `).all(req.params.phoneId);
  res.json(rows.reverse());
});

app.delete('/api/history/:phoneId', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM messages WHERE phone_id = ?').run(req.params.phoneId);
  res.json({ ok: true });
});

// ── API: Stats ─────────────────────────────────────────────
app.get('/api/stats', requireAdmin, (req, res) => {
  const online = [...wsClients.values()].filter(c => c.phoneId).length;
  res.json({
    phones:     db.prepare('SELECT COUNT(*) as n FROM phones').get().n,
    agents:     db.prepare('SELECT COUNT(*) as n FROM agents').get().n,
    knowledge:  db.prepare('SELECT COUNT(*) as n FROM knowledge_bases').get().n,
    messages:   db.prepare('SELECT COUNT(*) as n FROM messages').get().n,
    online,
  });
});

// ── HTTP Server ────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket Server ───────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

// Map: ws → { role, phoneId }
const wsClients = new Map();

wss.on('connection', (ws) => {
  wsClients.set(ws, { role: null, phoneId: null });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'auth') {
      if (msg.role === 'admin' && msg.pin === ADMIN_PIN) {
        wsClients.set(ws, { role: 'admin', phoneId: null });
        ws.send(JSON.stringify({ type: 'auth_ok', role: 'admin' }));
        broadcastStatusToAdmin();
      } else if (msg.role === 'phone') {
        const phone = db.prepare('SELECT * FROM phones WHERE id = ?').get(msg.phoneId);
        if (phone && phone.passcode === msg.passcode) {
          wsClients.set(ws, { role: 'phone', phoneId: msg.phoneId });
          ws.send(JSON.stringify({ type: 'auth_ok', role: 'phone' }));
          broadcastStatusToAdmin();
        } else {
          ws.send(JSON.stringify({ type: 'auth_fail' }));
        }
      }
    }

    if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    broadcastStatusToAdmin();
  });

  ws.on('error', () => wsClients.delete(ws));
});

// Push updated config to a specific phone's connected WebSocket
function pushConfigUpdate(phoneId) {
  const agents = db.prepare(`
    SELECT a.* FROM agents a
    JOIN phone_agents pa ON pa.agent_id = a.id
    WHERE pa.phone_id = ?
    ORDER BY a.name
  `).all(phoneId);

  const payload = JSON.stringify({ type: 'config_update', agents });

  for (const [ws, info] of wsClients) {
    if (info.phoneId === phoneId && ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

// Broadcast online phone list to all admin connections
function broadcastStatusToAdmin() {
  const onlinePhoneIds = [...wsClients.values()].map(c => c.phoneId).filter(Boolean);
  const payload = JSON.stringify({ type: 'phone_status', online: onlinePhoneIds });
  for (const [ws, info] of wsClients) {
    if (info.role === 'admin' && ws.readyState === 1) ws.send(payload);
  }
}

// ── Start ──────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  ARIA Fleet Server running on port ${PORT}`);
  console.log(`  Admin dashboard : http://localhost:${PORT}/admin`);
  console.log(`  Phone UI        : http://localhost:${PORT}/phone?id=PHONE_ID`);
  console.log(`  Admin PIN       : ${ADMIN_PIN}`);
  console.log(`  API key set     : ${!!getSetting('anthropic_api_key')}\n`);
});
