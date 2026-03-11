// ============================================================
//  IR Counter — Node.js HTTP Server
//  Deploy to Railway: https://railway.app
//  POST /event  ← receives data from ESP32
//  GET  /       ← serves the live dashboard
//  GET  /data   ← returns JSON snapshot for dashboard polling
// ============================================================

const http = require("http");
const PORT = process.env.PORT || 80;

// In-memory store
let state = {
  count: 0,
  events: [],        // last 200 events
  hourly: {}         // { "YYYY-MM-DD HH": { entries, exits } }
};

// ── Helpers ──────────────────────────────────────────────────
function timestamp() {
  return new Date().toISOString();
}

function hourKey(iso) {
  return iso.slice(0, 13); // "2025-06-01T14"
}

function addEvent(type, count) {
  const ts = timestamp();
  state.count = count;

  state.events.unshift({ type, count, ts });
  if (state.events.length > 200) state.events.pop();

  const hk = hourKey(ts);
  if (!state.hourly[hk]) state.hourly[hk] = { entries: 0, exits: 0 };
  if (type === "entry") state.hourly[hk].entries++;
  else                  state.hourly[hk].exits++;

  // Keep only last 48 hours
  const keys = Object.keys(state.hourly).sort();
  while (keys.length > 48) {
    delete state.hourly[keys.shift()];
  }
}

// ── Request Router ────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // ── POST /event — from ESP32
  if (req.method === "POST" && req.url === "/event") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { type, count } = JSON.parse(body);
        if ((type === "entry" || type === "exit") && typeof count === "number") {
          addEvent(type, count);
          console.log(`[${timestamp()}] ${type.toUpperCase()} — count: ${count}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400); res.end("Bad payload");
        }
      } catch {
        res.writeHead(400); res.end("Invalid JSON");
      }
    });
    return;
  }

  // ── GET /data — polled by dashboard every 3s
  if (req.method === "GET" && req.url === "/data") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(state));
    return;
  }

  // ── GET / — serve dashboard HTML
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(DASHBOARD_HTML);
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ── Dashboard HTML (self-contained) ──────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IR Counter</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0a0a;
    --surface: #111111;
    --border: #222;
    --accent: #00ff88;
    --accent2: #ff4d6d;
    --muted: #444;
    --text: #e8e8e8;
    --subtext: #666;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'DM Mono', monospace;
    min-height: 100vh;
    padding: 2rem;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 1.5rem;
    margin-bottom: 2.5rem;
    border-bottom: 1px solid var(--border);
    padding-bottom: 1.5rem;
  }

  header h1 {
    font-family: 'Bebas Neue', sans-serif;
    font-size: clamp(2.5rem, 6vw, 4rem);
    letter-spacing: 0.06em;
    color: var(--accent);
    line-height: 1;
  }

  header .subtitle {
    font-size: 0.7rem;
    color: var(--subtext);
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .live-dot {
    width: 8px; height: 8px;
    background: var(--accent);
    border-radius: 50%;
    display: inline-block;
    margin-right: 6px;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.7); }
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1.5rem;
    position: relative;
    overflow: hidden;
  }

  .card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: var(--accent);
    opacity: 0.5;
  }

  .card.exit-card::before { background: var(--accent2); }

  .card-label {
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--subtext);
    margin-bottom: 0.75rem;
  }

  .card-value {
    font-family: 'Bebas Neue', sans-serif;
    font-size: clamp(3rem, 8vw, 5.5rem);
    line-height: 1;
    color: var(--accent);
  }

  .card.exit-card .card-value { color: var(--accent2); }

  .card-sub {
    font-size: 0.65rem;
    color: var(--subtext);
    margin-top: 0.5rem;
    letter-spacing: 0.1em;
  }

  /* Bar chart */
  .chart-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .chart-title {
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--subtext);
    margin-bottom: 1.25rem;
  }

  .bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 100px;
    overflow: hidden;
  }

  .bar-group {
    flex: 1;
    display: flex;
    gap: 1px;
    align-items: flex-end;
    min-width: 0;
  }

  .bar {
    flex: 1;
    border-radius: 2px 2px 0 0;
    transition: height 0.4s ease;
    min-height: 2px;
  }
  .bar.entry { background: var(--accent); opacity: 0.85; }
  .bar.exit  { background: var(--accent2); opacity: 0.85; }

  .chart-labels {
    display: flex;
    gap: 3px;
    margin-top: 6px;
  }
  .chart-label {
    flex: 1;
    font-size: 0.5rem;
    color: var(--muted);
    text-align: center;
    overflow: hidden;
    white-space: nowrap;
  }

  /* Event log */
  .log-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1.5rem;
  }

  .log-title {
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--subtext);
    margin-bottom: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .log-list {
    list-style: none;
    max-height: 320px;
    overflow-y: auto;
  }
  .log-list::-webkit-scrollbar { width: 3px; }
  .log-list::-webkit-scrollbar-track { background: transparent; }
  .log-list::-webkit-scrollbar-thumb { background: var(--border); }

  .log-item {
    display: grid;
    grid-template-columns: 60px 1fr auto auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.7rem;
    animation: fadeIn 0.3s ease;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; } }

  .log-item:last-child { border-bottom: none; }

  .log-badge {
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    padding: 2px 6px;
    border-radius: 2px;
    text-align: center;
    font-weight: 500;
  }
  .log-badge.entry { color: var(--accent); border: 1px solid var(--accent); }
  .log-badge.exit  { color: var(--accent2); border: 1px solid var(--accent2); }

  .log-time { color: var(--subtext); font-size: 0.6rem; }
  .log-count { color: var(--text); }
  .log-arrow { color: var(--subtext); }

  .no-data { color: var(--subtext); font-size: 0.7rem; text-align: center; padding: 2rem 0; }

  .footer {
    margin-top: 1.5rem;
    font-size: 0.6rem;
    color: var(--muted);
    letter-spacing: 0.1em;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>

<header>
  <div>
    <h1>IR COUNTER</h1>
    <div class="subtitle"><span class="live-dot"></span>Live stream — cellular</div>
  </div>
</header>

<div class="grid">
  <div class="card">
    <div class="card-label">People Inside</div>
    <div class="card-value" id="count">—</div>
    <div class="card-sub">current occupancy</div>
  </div>
  <div class="card">
    <div class="card-label">Total Entries</div>
    <div class="card-value" id="entries">—</div>
    <div class="card-sub">since server start</div>
  </div>
  <div class="card exit-card">
    <div class="card-label">Total Exits</div>
    <div class="card-value" id="exits">—</div>
    <div class="card-sub">since server start</div>
  </div>
</div>

<div class="chart-card">
  <div class="chart-title">Hourly Traffic — last 24 hours &nbsp; <span style="color:var(--accent)">■</span> entries &nbsp; <span style="color:var(--accent2)">■</span> exits</div>
  <div class="bars" id="bars"></div>
  <div class="chart-labels" id="chart-labels"></div>
</div>

<div class="log-card">
  <div class="log-title">
    <span>Event Log</span>
    <span id="log-count-label" style="color:var(--subtext)"></span>
  </div>
  <ul class="log-list" id="log"></ul>
</div>

<div class="footer">
  <span>IR BREAK-BEAM SYSTEM</span>
  <span id="last-updated">—</span>
</div>

<script>
  let totalEntries = 0, totalExits = 0;

  function fmt(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function renderChart(hourly) {
    const now = new Date();
    const slots = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now - i * 3600000);
      const key = d.toISOString().slice(0, 13);
      const label = d.getHours().toString().padStart(2, '0');
      slots.push({ key, label, ...(hourly[key] || { entries: 0, exits: 0 }) });
    }

    const maxVal = Math.max(1, ...slots.map(s => Math.max(s.entries, s.exits)));
    const barsEl = document.getElementById('bars');
    const labelsEl = document.getElementById('chart-labels');

    barsEl.innerHTML = slots.map(s => \`
      <div class="bar-group">
        <div class="bar entry" style="height:\${(s.entries / maxVal) * 90}px" title="\${s.label}:00 — \${s.entries} entries"></div>
        <div class="bar exit"  style="height:\${(s.exits  / maxVal) * 90}px" title="\${s.label}:00 — \${s.exits} exits"></div>
      </div>
    \`).join('');

    labelsEl.innerHTML = slots.map(s =>
      \`<div class="chart-label">\${s.label}</div>\`
    ).join('');
  }

  function renderLog(events) {
    const logEl = document.getElementById('log');
    if (!events.length) {
      logEl.innerHTML = '<li class="no-data">No events yet — waiting for sensor data</li>';
      return;
    }
    document.getElementById('log-count-label').textContent = events.length + ' events';
    logEl.innerHTML = events.slice(0, 60).map(e => \`
      <li class="log-item">
        <span class="log-badge \${e.type}">\${e.type.toUpperCase()}</span>
        <span class="log-time">\${fmt(e.ts)}</span>
        <span class="log-arrow">→</span>
        <span class="log-count">\${e.count} inside</span>
      </li>
    \`).join('');
  }

  async function poll() {
    try {
      const res = await fetch('/data');
      const data = await res.json();

      document.getElementById('count').textContent = data.count;

      // Tally totals from events
      totalEntries = data.events.filter(e => e.type === 'entry').length;
      totalExits   = data.events.filter(e => e.type === 'exit').length;
      document.getElementById('entries').textContent = totalEntries;
      document.getElementById('exits').textContent   = totalExits;

      renderChart(data.hourly);
      renderLog(data.events);

      document.getElementById('last-updated').textContent =
        'updated ' + new Date().toLocaleTimeString();
    } catch(e) {
      document.getElementById('last-updated').textContent = 'connection error — retrying...';
    }
  }

  poll();
  setInterval(poll, 3000);
</script>
</body>
</html>`;
