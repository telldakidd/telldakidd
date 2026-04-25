/* ============================================================
   MT5 Bot Dashboard
   Frontend logic + simulated live data feed.
   To wire to a real MT5 backend, replace `feed` calls with
   WebSocket / fetch to your bridge (e.g. Python MetaTrader5
   library exposed over FastAPI / WebSocket).
   ============================================================ */

const SYMBOLS = [
  { s: 'EURUSD', digits: 5, pip: 0.0001, price: 1.08542 },
  { s: 'GBPUSD', digits: 5, pip: 0.0001, price: 1.26318 },
  { s: 'USDJPY', digits: 3, pip: 0.01,   price: 154.281 },
  { s: 'XAUUSD', digits: 2, pip: 0.1,    price: 2378.45 },
  { s: 'BTCUSD', digits: 2, pip: 1,      price: 67241.30 },
  { s: 'US30',   digits: 1, pip: 1,      price: 39521.4 },
];

const fmt = {
  money: v => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  signed: v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  num: (v, d=2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }),
  price: (v, digits) => v.toFixed(digits),
  time: ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  date: ts => {
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
};

/* -------- State -------- */
const state = {
  account: { number: 5839172, server: 'ICMarketsSC-Demo', currency: 'USD', leverage: 500 },
  startBalance: 10000,
  balance: 10000,
  history: [],          // closed trades
  positions: [],        // open trades
  equityCurve: [],      // [{t, equity}]
  botRunning: true,
  startedAt: Date.now(),
  range: '1H',
};

/* -------- Symbol price simulation -------- */
function tickPrices() {
  for (const sym of SYMBOLS) {
    const vol = sym.pip * (sym.s === 'BTCUSD' ? 30 : sym.s === 'XAUUSD' ? 8 : sym.s === 'US30' ? 6 : 4);
    sym.price += (Math.random() - 0.5) * vol;
    sym.price = Math.max(0.0001, sym.price);
  }
}

function symFor(s) { return SYMBOLS.find(x => x.s === s); }

/* -------- Trade lifecycle -------- */
let nextTicket = 102837461;

function pipValuePerLot(sym) {
  // approximate USD pip value per 1.0 lot
  switch (sym.s) {
    case 'USDJPY': return 6.5;
    case 'XAUUSD': return 10;
    case 'BTCUSD': return 1;
    case 'US30':   return 1;
    default:       return 10;
  }
}

function openPosition() {
  const sym = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const type = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const lots = +(Math.random() * 0.9 + 0.1).toFixed(2);
  const open = sym.price;
  const slDist = sym.pip * (20 + Math.random() * 30);
  const tpDist = sym.pip * (30 + Math.random() * 60);
  state.positions.push({
    ticket: ++nextTicket,
    symbol: sym.s,
    type,
    lots,
    open,
    sl: type === 'BUY' ? open - slDist : open + slDist,
    tp: type === 'BUY' ? open + tpDist : open - tpDist,
    swap: 0,
    commission: -lots * 3.5,
    openedAt: Date.now(),
  });
}

function pnlOf(p) {
  const sym = symFor(p.symbol);
  const diff = (p.type === 'BUY' ? sym.price - p.open : p.open - sym.price);
  const pips = diff / sym.pip;
  return pips * pipValuePerLot(sym) * p.lots + p.swap + p.commission;
}

function pipsOf(p, closePrice) {
  const sym = symFor(p.symbol);
  const diff = (p.type === 'BUY' ? closePrice - p.open : p.open - closePrice);
  return diff / sym.pip;
}

function closePosition(p, reason='Manual') {
  const sym = symFor(p.symbol);
  const closePrice = sym.price;
  const pnl = pnlOf(p);
  state.balance += pnl;
  state.history.unshift({
    ticket: p.ticket,
    symbol: p.symbol,
    type: p.type,
    lots: p.lots,
    open: p.open,
    close: closePrice,
    pips: pipsOf(p, closePrice),
    commission: p.commission,
    swap: p.swap,
    pnl,
    closedAt: Date.now(),
    openedAt: p.openedAt,
    reason,
  });
  state.positions = state.positions.filter(x => x !== p);
  if (state.history.length > 200) state.history.length = 200;
}

/* -------- Account math -------- */
function getEquity() {
  return state.balance + state.positions.reduce((s, p) => s + pnlOf(p), 0);
}

function getMarginUsed() {
  // simplistic: lots * contract / leverage in USD-ish terms
  return state.positions.reduce((s, p) => {
    const sym = symFor(p.symbol);
    let contract = 100000;
    if (sym.s === 'XAUUSD') contract = 100;
    if (sym.s === 'BTCUSD') contract = 1;
    if (sym.s === 'US30')   contract = 1;
    return s + (p.lots * contract * p.open) / state.account.leverage;
  }, 0);
}

/* -------- Seed history with some realistic prior trades -------- */
function seed() {
  const now = Date.now();
  for (let i = 0; i < 18; i++) {
    const sym = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const type = Math.random() > 0.45 ? 'BUY' : 'SELL';
    const lots = +(Math.random() * 0.8 + 0.1).toFixed(2);
    const open = sym.price * (1 + (Math.random() - 0.5) * 0.005);
    const close = open * (1 + (Math.random() - 0.45) * 0.004);
    const pips = (type === 'BUY' ? close - open : open - close) / sym.pip;
    const pnl = pips * pipValuePerLot(sym) * lots - lots * 3.5;
    const closedAt = now - (i + 1) * (1000 * 60 * (15 + Math.random() * 90));
    state.history.push({
      ticket: ++nextTicket,
      symbol: sym.s,
      type, lots, open, close, pips,
      commission: -lots * 3.5,
      swap: 0,
      pnl,
      closedAt,
      openedAt: closedAt - 1000 * 60 * 30,
      reason: pnl > 0 ? 'TP' : 'SL',
    });
    state.balance += pnl;
  }
  state.history.sort((a, b) => b.closedAt - a.closedAt);

  // open 2-3 starting positions
  const n = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) openPosition();

  // seed equity curve with last 60 minutes
  const eq = getEquity();
  for (let i = 60; i >= 0; i--) {
    state.equityCurve.push({ t: now - i * 60_000, equity: eq * (1 + (Math.random() - 0.5) * 0.003) });
  }
  state.equityCurve.push({ t: now, equity: eq });
}

/* -------- Render: KPIs -------- */
function flash(el, positive) {
  el.classList.remove('flash-pos', 'flash-neg');
  void el.offsetWidth;
  el.classList.add(positive ? 'flash-pos' : 'flash-neg');
}

function setText(id, text, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.textContent !== text) {
    el.textContent = text;
    if (opts.flash !== undefined) flash(el, opts.flash);
  }
  if (opts.cls) {
    el.classList.remove('pos', 'neg');
    if (opts.cls !== 'none') el.classList.add(opts.cls);
  }
}

function renderKPIs() {
  const eq = getEquity();
  const margin = getMarginUsed();
  const free = eq - margin;
  const level = margin > 0 ? (eq / margin) * 100 : 0;
  const floating = state.positions.reduce((s, p) => s + pnlOf(p), 0);

  // Today's net
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayNet = state.history
    .filter(h => h.closedAt >= todayStart.getTime())
    .reduce((s, h) => s + h.pnl, 0);

  setText('kpiBalance', fmt.money(state.balance));
  setText('kpiBalanceDelta', `Start: ${fmt.money(state.startBalance)} · ${state.balance >= state.startBalance ? '+' : ''}${(((state.balance - state.startBalance) / state.startBalance) * 100).toFixed(2)}%`);

  setText('kpiEquity', fmt.money(eq), { cls: eq >= state.balance ? 'pos' : 'neg' });
  setText('kpiEquityDelta', `${eq >= state.balance ? '▲' : '▼'} ${fmt.signed(eq - state.balance)}`);
  document.getElementById('kpiEquityDelta').className = 'kpi__delta ' + (eq >= state.balance ? 'pos' : 'neg');

  setText('kpiPnl', fmt.signed(floating), { cls: floating >= 0 ? 'pos' : 'neg' });
  setText('kpiPnlDelta', `${state.positions.length} open position${state.positions.length === 1 ? '' : 's'}`);

  setText('kpiMargin', fmt.money(margin));
  const marginPct = margin > 0 ? Math.min(100, (margin / eq) * 100) : 0;
  const bar = document.getElementById('marginBar');
  bar.style.width = marginPct + '%';
  bar.classList.remove('warn', 'danger');
  if (marginPct > 70) bar.classList.add('danger');
  else if (marginPct > 40) bar.classList.add('warn');
  setText('marginLevel', `Level: ${level > 0 ? level.toFixed(1) + '%' : '—'}`);

  setText('kpiFree', fmt.money(free));
  setText('kpiToday', fmt.signed(todayNet), { cls: todayNet >= 0 ? 'pos' : 'neg' });
  setText('kpiTodayDelta', `${state.history.filter(h => h.closedAt >= todayStart.getTime()).length} closed today`);

  setText('posPnl', fmt.signed(floating));
  document.getElementById('posPnl').className = floating >= 0 ? 'pos' : 'neg';
  setText('posCount', String(state.positions.length));
}

/* -------- Render: Bot stats -------- */
function renderStats() {
  const closed = state.history;
  const wins = closed.filter(h => h.pnl > 0);
  const losses = closed.filter(h => h.pnl <= 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const best = closed.reduce((m, h) => h.pnl > m ? h.pnl : m, 0);
  const worst = closed.reduce((m, h) => h.pnl < m ? h.pnl : m, 0);
  const avg = closed.length ? closed.reduce((s, h) => s + h.pnl, 0) / closed.length : 0;
  const grossWin = wins.reduce((s, h) => s + h.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, h) => s + h.pnl, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  // crude DD from equity curve
  let peak = -Infinity, maxDD = 0;
  for (const p of state.equityCurve) {
    peak = Math.max(peak, p.equity);
    maxDD = Math.max(maxDD, peak - p.equity);
  }

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayCount = closed.filter(h => h.closedAt >= todayStart.getTime()).length;

  setText('statWinRate', winRate.toFixed(1) + '%');
  setText('statTrades', String(todayCount));
  setText('statBest', fmt.signed(best));
  setText('statWorst', fmt.signed(worst));
  setText('statAvg', fmt.signed(avg));
  setText('statPF', pf.toFixed(2));
  setText('statDD', fmt.signed(-maxDD));

  const up = Date.now() - state.startedAt;
  const h = Math.floor(up / 3.6e6), m = Math.floor((up % 3.6e6) / 6e4), s = Math.floor((up % 6e4) / 1000);
  setText('statUptime', `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
}

/* -------- Render: Positions -------- */
function renderPositions() {
  const tbody = document.getElementById('positionsBody');
  if (!state.positions.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty">No open positions. Bot is waiting for a signal.</td></tr>';
    return;
  }
  tbody.innerHTML = state.positions.map(p => {
    const sym = symFor(p.symbol);
    const pnl = pnlOf(p);
    const pnlCls = pnl >= 0 ? 'pos' : 'neg';
    return `
      <tr data-ticket="${p.ticket}">
        <td>${p.ticket}</td>
        <td><span class="symbol">${p.symbol}</span></td>
        <td><span class="tag tag-${p.type === 'BUY' ? 'buy' : 'sell'}">${p.type}</span></td>
        <td>${p.lots.toFixed(2)}</td>
        <td>${fmt.price(p.open, sym.digits)}</td>
        <td>${fmt.price(sym.price, sym.digits)}</td>
        <td>${fmt.price(p.sl, sym.digits)}</td>
        <td>${fmt.price(p.tp, sym.digits)}</td>
        <td>${p.swap.toFixed(2)}</td>
        <td class="${pnlCls}">${fmt.signed(pnl)}</td>
        <td>${fmt.time(p.openedAt)}</td>
        <td><button class="btn btn--close" data-close="${p.ticket}">Close</button></td>
      </tr>
    `;
  }).join('');
}

/* -------- Render: History -------- */
function renderHistory() {
  const tbody = document.getElementById('historyBody');
  const filter = document.getElementById('historyFilter').value;
  const search = document.getElementById('historySearch').value.toUpperCase();

  let rows = state.history;
  if (filter === 'win') rows = rows.filter(h => h.pnl > 0);
  if (filter === 'loss') rows = rows.filter(h => h.pnl <= 0);
  if (search) rows = rows.filter(h => h.symbol.includes(search));

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty">No trades match filter.</td></tr>';
  } else {
    tbody.innerHTML = rows.map(h => {
      const sym = symFor(h.symbol);
      const cls = h.pnl >= 0 ? 'pos' : 'neg';
      return `
        <tr>
          <td>${fmt.date(h.closedAt)}</td>
          <td>${h.ticket}</td>
          <td><span class="symbol">${h.symbol}</span></td>
          <td><span class="tag tag-${h.type === 'BUY' ? 'buy' : 'sell'}">${h.type}</span></td>
          <td>${h.lots.toFixed(2)}</td>
          <td>${fmt.price(h.open, sym.digits)}</td>
          <td>${fmt.price(h.close, sym.digits)}</td>
          <td class="${cls}">${h.pips >= 0 ? '+' : ''}${h.pips.toFixed(1)}</td>
          <td>${h.commission.toFixed(2)}</td>
          <td>${h.swap.toFixed(2)}</td>
          <td class="${cls}"><b>${fmt.signed(h.pnl)}</b></td>
        </tr>
      `;
    }).join('');
  }

  setText('historyCount', `${rows.length} trade${rows.length === 1 ? '' : 's'}`);
  const total = rows.reduce((s, h) => s + h.pnl, 0);
  setText('historyTotal', fmt.signed(total));
  document.getElementById('historyTotal').className = total >= 0 ? 'pos' : 'neg';
}

/* -------- Equity chart (canvas) -------- */
function rangeMs(r) {
  return { '1H': 3600_000, '1D': 86_400_000, '1W': 7 * 86_400_000, '1M': 30 * 86_400_000 }[r] || 3600_000;
}

function drawChart() {
  const canvas = document.getElementById('equityChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);

  const since = Date.now() - rangeMs(state.range);
  const points = state.equityCurve.filter(p => p.t >= since);
  if (points.length < 2) return;

  const xs = points.map(p => p.t);
  const ys = points.map(p => p.equity);
  const minX = xs[0], maxX = xs[xs.length - 1];
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const padY = (maxY - minY) * 0.15 || 10;

  const padL = 56, padR = 12, padT = 12, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const sx = t => padL + ((t - minX) / Math.max(1, maxX - minX)) * plotW;
  const sy = v => padT + plotH - ((v - (minY - padY)) / Math.max(1, (maxY + padY) - (minY - padY))) * plotH;

  // grid + y labels
  ctx.strokeStyle = '#232b3b';
  ctx.fillStyle = '#5b6478';
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = padT + (plotH * i) / gridLines;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    const val = (maxY + padY) - ((maxY + padY) - (minY - padY)) * (i / gridLines);
    ctx.fillText('$' + val.toFixed(0), 6, y + 3);
  }

  // x labels
  const ticks = 4;
  ctx.textAlign = 'center';
  for (let i = 0; i <= ticks; i++) {
    const t = minX + ((maxX - minX) * i) / ticks;
    const x = sx(t);
    const d = new Date(t);
    let label;
    if (state.range === '1H' || state.range === '1D')
      label = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    else
      label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    ctx.fillText(label, x, H - 8);
  }
  ctx.textAlign = 'start';

  // area gradient
  const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
  const lastUp = points[points.length - 1].equity >= points[0].equity;
  const color = lastUp ? '#22c98a' : '#ff4d6d';
  grad.addColorStop(0, lastUp ? 'rgba(34,201,138,0.30)' : 'rgba(255,77,109,0.30)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.beginPath();
  ctx.moveTo(sx(points[0].t), H - padB);
  for (const p of points) ctx.lineTo(sx(p.t), sy(p.equity));
  ctx.lineTo(sx(points[points.length - 1].t), H - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = sx(points[i].t), y = sy(points[i].equity);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // last point dot
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(sx(last.t), sy(last.equity), 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#0b0e14';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* -------- Bot loop -------- */
function tick() {
  tickPrices();

  if (state.botRunning) {
    // chance to open a new position when below threshold
    if (state.positions.length < 5 && Math.random() < 0.06) openPosition();

    // chance to close a position
    if (state.positions.length > 0 && Math.random() < 0.05) {
      const idx = Math.floor(Math.random() * state.positions.length);
      closePosition(state.positions[idx], 'Bot');
    }

    // SL/TP triggers
    for (const p of [...state.positions]) {
      const sym = symFor(p.symbol);
      if (p.type === 'BUY') {
        if (sym.price <= p.sl) closePosition(p, 'SL');
        else if (sym.price >= p.tp) closePosition(p, 'TP');
      } else {
        if (sym.price >= p.sl) closePosition(p, 'SL');
        else if (sym.price <= p.tp) closePosition(p, 'TP');
      }
    }
  }

  state.equityCurve.push({ t: Date.now(), equity: getEquity() });
  // keep curve bounded
  const cutoff = Date.now() - 31 * 86_400_000;
  state.equityCurve = state.equityCurve.filter(p => p.t >= cutoff);

  renderAll();
}

function renderAll() {
  renderKPIs();
  renderStats();
  renderPositions();
  renderHistory();
  drawChart();
}

/* -------- UI events -------- */
function bindUI() {
  document.getElementById('botToggle').addEventListener('click', () => {
    state.botRunning = !state.botRunning;
    const dot = document.getElementById('botDot');
    const stt = document.getElementById('botState');
    document.getElementById('botToggle').textContent = state.botRunning ? 'Pause Bot' : 'Resume Bot';
    if (state.botRunning) {
      dot.classList.remove('paused');
      stt.classList.remove('paused');
      stt.textContent = 'Running';
    } else {
      dot.classList.add('paused');
      stt.classList.add('paused');
      stt.textContent = 'Paused';
    }
  });

  document.getElementById('closeAll').addEventListener('click', () => {
    if (!state.positions.length) return;
    if (!confirm(`Close ${state.positions.length} open position${state.positions.length === 1 ? '' : 's'}?`)) return;
    for (const p of [...state.positions]) closePosition(p, 'Manual');
    renderAll();
  });

  document.getElementById('positionsBody').addEventListener('click', e => {
    const t = e.target.closest('[data-close]');
    if (!t) return;
    const ticket = +t.dataset.close;
    const p = state.positions.find(x => x.ticket === ticket);
    if (p) { closePosition(p, 'Manual'); renderAll(); }
  });

  document.getElementById('rangeTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    document.querySelectorAll('#rangeTabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.range = b.dataset.range;
    drawChart();
  });

  document.getElementById('historySearch').addEventListener('input', renderHistory);
  document.getElementById('historyFilter').addEventListener('change', renderHistory);

  // sidebar nav active state on scroll
  const links = document.querySelectorAll('.sidebar__nav a[href^="#"]');
  links.forEach(l => l.addEventListener('click', () => {
    links.forEach(x => x.classList.remove('active'));
    l.classList.add('active');
  }));

  window.addEventListener('resize', drawChart);
}

function tickClock() {
  const d = new Date();
  setText('clock', d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  setText('accountInfo', `#${state.account.number} · ${state.account.server} · ${state.account.currency} · 1:${state.account.leverage}`);
}

/* -------- Init -------- */
document.addEventListener('DOMContentLoaded', () => {
  seed();
  bindUI();
  renderAll();
  setInterval(tick, 1500);
  setInterval(tickClock, 1000);
  tickClock();
});
