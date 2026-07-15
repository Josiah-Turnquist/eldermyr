/*
 * server/index.js — local authoritative multiplayer server (bare WebSocket).
 * =============================================================================
 * Wraps the transport-agnostic World (server/world.js) in a WebSocket server so
 * you can play locally with no cloud accounts. Colyseus/Fly wrap the SAME World
 * later for deployment — this proves the loop end-to-end first.
 *
 *   node server/index.js         → ws://localhost:2567
 *   open http://localhost:8137/client/mp.html  in two tabs.
 *
 * NOTE: load-game.js stubs the *global* setInterval (to muzzle the game's
 * autosave/floatDamage timers), so we take a pristine timer from node:timers
 * for our own 20Hz tick.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
// load-game.js stubs the GLOBAL setInterval AND clearInterval to no-ops (to muzzle the
// game's own timers). We need the REAL ones for our loop — importing setInterval alone
// wasn't enough: stopSim()'s clearInterval was hitting the stubbed global no-op, so the
// sim never actually paused and every "resume" leaked another broadcast loop. Import both.
// setTimeout/clearTimeout are stubbed the same way — pull the real ones here too (the
// auth-deadline reaper below needs a timer that actually fires, not the loader's `() => 0`).
const { setInterval, clearInterval, setTimeout, clearTimeout } = require('node:timers');
const { World } = require('./world');
const db = require('./db');   // persistent heroes (no-ops to ephemeral if no DATABASE_URL)
const releases = require('./releases');   // ordered (newest-first) changelog data for the /release page

const PORT = Number(process.env.PORT) || 8138;   // Railway injects PORT in prod
// The sim runs at a fixed HZ (the accumulator keeps it real-time-accurate regardless
// of timer jitter). 60 = the game's design speed; single-player (frame-based) runs at
// the display refresh, so a 120Hz monitor plays at 2x. 80 is a chosen middle ground —
// a touch faster than design without the frantic 2x. Client-side smoothing (below)
// handles the choppiness from snapshots arriving unevenly on a high-fps display.
// Last-resort safety net: a stray throw in a timer/handler must NEVER take the whole
// room down (that reads to players as "everyone randomly lost connection"). Log and stay up.
process.on('uncaughtException', (e) => { console.error('[uncaught]', e && e.stack || e); });
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e && (e.stack || e.message) || e); });

const HZ = Number(process.env.HZ) || 80;
// Disconnect a player who hasn't done anything meaningful for this long — a backstop so
// an AFK/backgrounded tab can't keep the sim (and the bill) running, and so an away player
// isn't left standing in danger for long. The client pauses itself at the same mark; this
// catches anything it misses. Their hero is saved on disconnect. Heartbeat granularity 15s.
// The world NEVER pauses while anyone is connected (it's multiplayer). The only cost
// guards are: the sim stops when the server is EMPTY (nobody online — invisible), and an
// ABANDONED tab is disconnected after IDLE_MS so it can't stream to itself all night.
const IDLE_MS = Number(process.env.IDLE_MS) || 5 * 60 * 1000;
// A socket can connect and then never send `auth` (dead client, port scanner, hung DB round-trip).
// The heartbeat's ping/idle logic only reaps AUTHED flows, so such a socket would sit forever —
// terminate any connection still unauthed this long after it opened.
const AUTH_DEADLINE_MS = Number(process.env.AUTH_DEADLINE_MS) || 10000;
const ROOT = path.join(__dirname, '..');

// Serve the MP client + the game HTML it fetches, so the whole experience is one
// self-contained origin (friends just open the service URL). WebSockets attach to
// this same HTTP server, so client + game + realtime all share one port.
const STATIC = {
  '/': ['client/mp.html', 'text/html; charset=utf-8'],
  '/mp': ['client/mp.html', 'text/html; charset=utf-8'],
  '/mp.html': ['client/mp.html', 'text/html; charset=utf-8'],
  '/eldermyr-rpg.html': ['eldermyr-rpg.html', 'text/html; charset=utf-8'],
};

// Minimal HTML escaper for the server-rendered changelog (release text is author-controlled,
// but escaping keeps the page correct if a stray < or & ever lands in a note).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- /health dashboard (STATIC page) -----------------------------------------
// A self-contained human view of the sim: it fetches /health.json every ~3s and
// paints live cards. No external fonts/CDN/JS — everything is inline so the page
// works offline of any network but this server. Tick time is color-coded against
// the ~12.5ms @ 80Hz budget so lag jumps out (green <2 / amber 2–6 / red >6 ms).
const HEALTH_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eldermyr · Server Health</title>
<style>
:root{
  --bg:#130e09;--panel:#20180f;--panel2:#271d12;--line:#3c2d1d;
  --ink:#efe3ce;--dim:#a08e73;--faint:#6c5e49;
  --ember:#ff8a3c;--gold:#e8a94a;--good:#5ec97a;--warn:#e8a94a;--bad:#ff5a4d;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;color:var(--ink);padding:24px 16px 46px;
  background:radial-gradient(1100px 560px at 50% -8%,#2c1e10 0%,#150f09 58%,var(--bg) 100%);
  font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:840px;margin:0 auto}
header{display:flex;align-items:center;gap:12px 14px;flex-wrap:wrap;margin-bottom:22px}
h1{margin:0;font-size:19px;font-weight:650;letter-spacing:.2px}
h1 b{color:var(--ember);font-weight:650}
.sub{color:var(--dim);font:600 11px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase}
.spacer{flex:1 1 auto}
.status{display:inline-flex;align-items:center;gap:8px;font:700 12px/1 var(--mono);letter-spacing:.08em;
  text-transform:uppercase;color:var(--dim);background:var(--panel);border:1px solid var(--line);
  padding:8px 12px;border-radius:999px}
.status .dot{width:9px;height:9px;border-radius:50%;background:var(--faint);transition:.3s}
.status.on{color:var(--ink)} .status.on .dot{background:var(--good);box-shadow:0 0 11px 1px rgba(94,201,122,.6)}
.status.off{color:var(--bad);border-color:#5a2a24} .status.off .dot{background:var(--bad)}
a.link{color:var(--gold);text-decoration:none;font:600 13px/1 var(--mono);
  border:1px solid var(--line);background:var(--panel);padding:9px 13px;border-radius:9px;white-space:nowrap}
a.link:hover{border-color:var(--gold)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:13px}
.card{position:relative;overflow:hidden;background:linear-gradient(180deg,var(--panel2),var(--panel));
  border:1px solid var(--line);border-radius:13px;padding:15px 16px}
.card .k{font:700 11px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
.card .v{margin-top:10px;font:700 31px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--ink)}
.card .v .u{font-size:14px;color:var(--dim);font-weight:600;margin-left:3px}
.card .s{margin-top:9px;font:600 12px/1.35 var(--mono);color:var(--faint);font-variant-numeric:tabular-nums}
.hero{grid-column:1/-1}
.hero .v{font-size:46px}
.meter{height:7px;border-radius:5px;background:#2b2015;margin-top:14px;overflow:hidden}
.meter i{display:block;height:100%;width:0;border-radius:5px;transition:width .45s ease,background .3s}
.budget{margin-top:8px;font:600 11px/1 var(--mono);color:var(--faint);letter-spacing:.03em}
.good{color:var(--good)} .warn{color:var(--warn)} .bad{color:var(--bad)}
.mgood{background:linear-gradient(90deg,#357a49,var(--good))}
.mwarn{background:linear-gradient(90deg,#8a6a25,var(--warn))}
.mbad{background:linear-gradient(90deg,#8a2f28,var(--bad))}
.section{margin-top:22px}
.section .h{font:700 11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin:0 2px 11px}
.ents{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:11px}
.ent{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:12px 8px;text-align:center}
.ent .n{font:700 22px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--gold)}
.ent .l{margin-top:6px;font:700 10px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
footer{margin-top:24px;text-align:center;color:var(--faint);
  font:600 12px/1.5 var(--mono);font-variant-numeric:tabular-nums;letter-spacing:.03em}
body.stale .card,body.stale .ent{opacity:.5;transition:opacity .3s}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1><b>Realms of Eldermyr</b> — Server Health</h1>
      <div class="sub">live sim dashboard</div>
    </div>
    <div class="spacer"></div>
    <div id="status" class="status"><span class="dot"></span><span id="status-t">connecting</span></div>
    <a class="link" href="/">Enter the realm →</a>
  </header>

  <div class="grid">
    <div class="card hero">
      <div class="k">Tick time — sim step</div>
      <div class="v"><span id="tick">–</span><span class="u">ms avg</span></div>
      <div class="meter"><i id="tick-bar"></i></div>
      <div class="budget">peak <span id="tickmax">–</span> ms · budget ~12.5 ms · 80 Hz</div>
    </div>

    <div class="card">
      <div class="k">Snapshot build</div>
      <div class="v"><span id="snap">–</span><span class="u">ms</span></div>
      <div class="s">state sent to clients</div>
    </div>
    <div class="card">
      <div class="k">Players online</div>
      <div class="v" id="players">–</div>
      <div class="s" id="players-sub">–</div>
    </div>
    <div class="card">
      <div class="k">Memory</div>
      <div class="v"><span id="rss">–</span><span class="u">MB</span></div>
      <div class="s">resident set size</div>
    </div>
    <div class="card">
      <div class="k">Uptime</div>
      <div class="v" id="uptime" style="font-size:25px">–</div>
      <div class="s"><span id="ticks">–</span> sim ticks</div>
    </div>
  </div>

  <div class="section">
    <div class="h">Entities in the world</div>
    <div class="ents">
      <div class="ent"><div class="n" id="e-enemies">–</div><div class="l">Enemies</div></div>
      <div class="ent"><div class="n" id="e-allies">–</div><div class="l">Allies</div></div>
      <div class="ent"><div class="n" id="e-proj">–</div><div class="l">Projectiles</div></div>
      <div class="ent"><div class="n" id="e-part">–</div><div class="l">Particles</div></div>
      <div class="ent"><div class="n" id="e-pick">–</div><div class="l">Pickups</div></div>
    </div>
  </div>

  <footer id="foot">awaiting first reading…</footer>
</div>

<script>
(function(){
  var $=function(id){ return document.getElementById(id); };
  var lastOk=0;
  function fmt(n,d){ n=Number(n); if(!isFinite(n)) return '–'; return n.toFixed(d==null?0:d); }
  function tickCls(v){ return v<2 ? 'good' : (v<=6 ? 'warn' : 'bad'); }
  function human(s){ s=Math.max(0,Math.floor(Number(s)||0));
    var d=Math.floor(s/86400); s-=d*86400; var h=Math.floor(s/3600); s-=h*3600; var m=Math.floor(s/60); s-=m*60;
    if(d) return d+'d '+h+'h '+m+'m'; if(h) return h+'h '+m+'m'; if(m) return m+'m '+s+'s'; return s+'s'; }
  function setStatus(cls,txt){ $('status').className='status '+cls; $('status-t').textContent=txt; }
  function paint(d){
    document.body.classList.remove('stale');
    var t=Number(d.tickMsAvg)||0, cls=tickCls(t);
    var te=$('tick'); te.textContent=fmt(t,2); te.className=cls;
    var bar=$('tick-bar'); bar.style.width=Math.min(100,(t/12.5)*100)+'%';
    bar.className=(cls==='good'?'mgood':cls==='warn'?'mwarn':'mbad');
    $('tickmax').textContent=fmt(d.tickMsMax,2);
    $('snap').textContent=fmt(d.snapMsAvg,2);
    var pl=Number(d.players)||0;
    $('players').textContent=pl;
    $('players-sub').textContent = pl>0 ? 'adventurers afield' : 'world idle';
    $('rss').textContent=fmt(d.rssMB,0);
    $('uptime').textContent=human(d.uptime);
    $('ticks').textContent=fmt(d.ticks,0);
    $('e-enemies').textContent=fmt(d.enemies,0);
    $('e-allies').textContent=fmt(d.allies,0);
    $('e-proj').textContent=fmt(d.projectiles,0);
    $('e-part').textContent=fmt(d.particles,0);
    $('e-pick').textContent=fmt(d.pickups,0);
    setStatus(pl>0?'on':'', pl>0 ? ('online · '+pl) : 'idle');
    lastOk=Date.now();
  }
  function poll(){
    fetch('/health.json',{cache:'no-store'})
      .then(function(r){ return r.json(); })
      .then(paint)
      .catch(function(){ document.body.classList.add('stale'); setStatus('off','offline'); });
  }
  function ago(){
    if(!lastOk) return;
    var s=Math.round((Date.now()-lastOk)/1000);
    $('foot').textContent='refreshed '+s+'s ago · auto-updates every 3s · tick peak resets each poll';
  }
  poll(); setInterval(poll,3000); setInterval(ago,1000);
})();
</script>
</body>
</html>`;

// --- /release changelog (SERVER-RENDERED from releases.js) --------------------
// Server-rendered so it needs no client JS and works with scripts disabled. Same
// Eldermyr theme as the dashboard. Rebuilt once at boot from the static data.
function renderReleases(list) {
  const items = (list || []).map((r) => {
    const notes = (r.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
    const date = r.date ? `<time>${esc(r.date)}</time>` : '';
    return `<article class="rel">
      <div class="rel-head"><span class="ver">${esc(r.version)}</span><h2>${esc(r.title)}</h2>${date}</div>
      <ul>${notes}</ul>
    </article>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eldermyr · Release Notes</title>
<style>
:root{
  --bg:#130e09;--panel:#20180f;--panel2:#271d12;--line:#3c2d1d;
  --ink:#efe3ce;--dim:#a08e73;--faint:#6c5e49;
  --ember:#ff8a3c;--gold:#e8a94a;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;color:var(--ink);padding:24px 16px 56px;
  background:radial-gradient(1100px 560px at 50% -8%,#2c1e10 0%,#150f09 58%,var(--bg) 100%);
  font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto}
header{display:flex;align-items:center;gap:12px 14px;flex-wrap:wrap;margin-bottom:8px}
h1{margin:0;font-size:19px;font-weight:650;letter-spacing:.2px}
h1 b{color:var(--ember);font-weight:650}
.spacer{flex:1 1 auto}
a.link{color:var(--gold);text-decoration:none;font:600 13px/1 var(--mono);
  border:1px solid var(--line);background:var(--panel);padding:9px 13px;border-radius:9px;white-space:nowrap}
a.link:hover{border-color:var(--gold)}
.intro{color:var(--dim);font:600 12px/1.5 var(--mono);letter-spacing:.05em;text-transform:uppercase;margin:0 2px 20px}
.rel{border:1px solid var(--line);border-radius:13px;padding:16px 18px;margin-bottom:14px;
  background:linear-gradient(180deg,var(--panel2),var(--panel))}
.rel-head{display:flex;align-items:baseline;gap:11px;flex-wrap:wrap;margin-bottom:11px}
.ver{font:700 12px/1 var(--mono);letter-spacing:.02em;color:#180f07;white-space:nowrap;
  background:linear-gradient(180deg,var(--gold),var(--ember));padding:5px 9px;border-radius:7px}
.rel-head h2{margin:0;font-size:17px;font-weight:650;color:var(--ink);flex:1 1 auto}
.rel-head time{font:600 12px/1 var(--mono);color:var(--faint)}
.rel ul{margin:0;padding-left:19px}
.rel li{margin:6px 0;color:var(--dim)}
.rel li::marker{color:var(--ember)}
footer{margin-top:26px;text-align:center;color:var(--faint);font:600 12px/1.5 var(--mono);letter-spacing:.03em}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1><b>Realms of Eldermyr</b> — Release Notes</h1>
    <div class="spacer"></div>
    <a class="link" href="/">Enter the realm →</a>
  </header>
  <p class="intro">The chronicle of the realm — newest first</p>
  ${items}
  <footer>Onward, adventurer. · <a class="link" href="/health" style="padding:6px 10px">server health →</a></footer>
</div>
</body>
</html>`;
}
const RELEASES_HTML = renderReleases(releases);   // static data → build the page once at boot

const httpServer = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  const get = req.method === 'GET' || req.method === 'HEAD';
  if (get && u === '/health.json') {   // machine-readable perf probe (curl / deploy checks): the EXACT legacy payload — world timers + RSS(MB) + uptime as JSON
    try {
      const body = JSON.stringify(Object.assign(
        { ok: true, uptime: +process.uptime().toFixed(1), rssMB: Math.round(process.memoryUsage().rss / 1048576) },
        world.perf()));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(body);
    } catch (_e) { res.writeHead(200); res.end('ok'); }
    return;
  }
  if (get && u === '/health') {   // human dashboard: fetches /health.json and auto-refreshes (~3s)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HEALTH_HTML); return;
  }
  if (get && (u === '/release' || u === '/releases')) {   // public changelog, server-rendered from releases.js
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(RELEASES_HTML); return;
  }
  const hit = STATIC[u];
  if (hit) {
    try { res.writeHead(200, { 'content-type': hit[1] }); res.end(fs.readFileSync(path.join(ROOT, hit[0]))); return; }
    catch (_e) { res.writeHead(500); res.end('read error'); return; }
  }
  res.writeHead(404); res.end('not found');
});

const world = new World();
// maxPayload caps a single inbound frame at 64KB — ws defaults to ~100MiB, so without this one
// hostile socket could balloon memory with a giant frame. Real client messages are tiny JSON;
// ws answers an over-cap frame with close code 1009 and tears that socket down (others unaffected).
const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 });   // share the HTTP server's port
let seq = 0;
// Session token = the dedup key for takeover (below). Persistent heroes use their DB token;
// ephemeral heroes get one we mint here, so silent-drop RECONNECT works with no DB too (and is
// locally testable). We reuse whatever eph token the client presents so it stays stable per browser.
const isEph = (t) => typeof t === 'string' && t.startsWith('eph_');
function ephToken() { return 'eph_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }

// Turn an auth message into an account (or null → ephemeral hero), then the caller spawns it.
//   { token }         → auto-login this browser's saved hero
//   { recoveryCode }  → reclaim a hero on a new device (returns its token)
//   { name }          → create a brand-new hero (only if a DB is configured)
async function resolveAccount(m) {
  try {
    if (m.token) { const a = await db.loadByToken(m.token); if (a) return { acct: a, isNew: false }; }
    if (m.recoveryCode) { const a = await db.loadByRecovery(m.recoveryCode); if (a) return { acct: a, isNew: false, viaCode: true }; }
    if (db.enabled) { const a = await db.createAccount(m.name); if (a) return { acct: a, isNew: true }; }
  } catch (e) {
    // A THROW is a LIVE-DB failure (Neon hiccup) — NOT "no such account" (a genuine miss returns
    // null from db.js, no throw). Flag it so the caller refuses instead of silently handing a valid
    // token a fresh ephemeral hero (which reads as "I lost my character") and overwriting nothing.
    console.error('[auth] error:', e && e.message);
    return { acct: null, isNew: false, dbError: true };
  }
  return { acct: null, isNew: false };   // genuinely unknown token / no DB configured → play ephemerally
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.authed = false;
  ws.lastActive = Date.now();   // for idle-kick
  // Auth deadline: reap a socket that connects but never authenticates (heartbeat below only
  // guards authed flows). Cleared the instant auth succeeds; also cleared on close. Real timer
  // (node:timers import) — the loader stubs the global setTimeout to `() => 0`, which never fires.
  ws._authTimer = setTimeout(() => { if (!ws.authed) { try { ws.terminate(); } catch (_e) {} } }, AUTH_DEADLINE_MS);
  ws.on('pong', () => { ws.isAlive = true; });   // client answered our ping → still alive
  ws.on('message', async (data) => {
    let m; try { m = JSON.parse(data); } catch (_e) { return; }
    // ---- handshake: the FIRST message must be `auth`; the world spawns the hero only after ----
    if (!ws.authed) {
      if (m.type !== 'auth' || ws.authing) return;
      ws.authing = true;
      const { acct, isNew, viaCode, dbError } = await resolveAccount(m);
      if (ws.readyState !== 1) return;               // client vanished during the DB round-trip
      if (dbError) {                                 // transient storage failure on a (possibly valid) token:
        // refuse rather than spawn a fresh hero — that would look like a lost character and (worse)
        // its later save could overwrite the real one. Tell the client to retry; touch nothing.
        try { ws.send(JSON.stringify({ type: 'err', msg: 'Server storage is unavailable — try again in a moment.' })); } catch (_e) {}
        try { ws.close(); } catch (_e) {}
        return;
      }
      ws.token = acct ? acct.token : (isEph(m.token) ? m.token : ephToken());   // dedup key for takeover
      // SESSION TAKEOVER (fixes duplicate-hero + stale-overwrite on silent reconnect): if a live
      // socket already owns this token — a wifi-blip reconnect, or two auths racing the same token —
      // supersede it and ADOPT its in-world player. The live hero is fresher than any DB row, so we
      // do NOT reload from the DB and do NOT spawn a second one. Idempotent under a race: whoever
      // finishes auth LAST owns the pid; every earlier socket is superseded + terminated and its
      // close skips save+remove (guarded below) — exactly one owner, no double-save, no phantom.
      let adopt = null;
      for (const c of wss.clients) {
        if (c === ws || !c.authed || c._superseded || c.token !== ws.token) continue;
        adopt = c.pid; c._superseded = true;
        try { c.send(JSON.stringify({ type: 'superseded' })); } catch (_e) {}   // tell the old tab to STOP auto-reconnecting → ends two-tab reconnect ping-pong
        try { c.terminate(); } catch (_e) {}
      }
      if (adopt) { ws.pid = adopt; const ap = world.players.get(adopt); if (ap) ap._qSeen = 0; }   // take over the existing live player (no addPlayer, no DB load). Rewind _qSeen: the adopted player is caught up to _qN, but the PAGE taking over is brand new and holds nothing — so force the next snapshot to re-carry quests. (welcome's questPayload below is the primary cure; this is the belt-and-braces, mirroring resendMap's flag rewind.)
      else { ws.pid = 'p' + (++seq); world.addPlayer(ws.pid, ((acct ? acct.name : m.name) || 'Hero').toString().slice(0, 18) || 'Hero', acct && acct.character); }
      ws.authed = true;
      if (ws._authTimer) { clearTimeout(ws._authTimer); ws._authTimer = null; }   // authed in time → cancel the reaper
      const p = world.players.get(ws.pid);
      ws.send(JSON.stringify({
        type: 'welcome', id: ws.pid, name: (p && p.name) || 'Hero', hz: HZ, map: world.mapPayload(),
        legion: world.legionPayload(),                          // the SERVER's Dread Legion roster: the client never generates its own (its genLegion would bake every member at the level-1 default → the "Lv 1" phantom). Sent here as well as on change so a TAKEOVER — which adopts the live pid and its already-caught-up _lgSeen — still seeds a brand-new page.
        ...(world.questPayload(ws.pid) || {}),                  // this hero's quest box (quests/bounty/loreFound/maxDepth) — the SAME hazard the `legion:` line above documents and cures, and it bit harder: a takeover adopts the live pid with its already-caught-up _qSeen, so NO later snapshot would carry quests and the box sat on the game's intro defaults forever ("Speak to the Elder" at level 45). Spread flat so the payload lands where the client's adoptQuests() already reads it.
        token: ws.token || undefined,                          // browser stores this to auto-login next time
        recoveryCode: (isNew && acct) ? acct.recovery : undefined,   // shown ONCE, on new-hero creation
        reclaimed: viaCode || undefined,                       // logged in via a recovery code
        persistent: db.enabled,                                // false → tell the player saves are off
      }));
      console.log(`+ ${ws.pid} (${(p && p.name) || 'Hero'}) ${adopt ? '[takeover]' : (acct ? (isNew ? '[new]' : '[loaded]') : '[ephemeral]')}  (${world.list.length} online)`);
      startSim();                                            // wake the sim on the first join
      return;
    }
    // ---- authed traffic ----
    // Idle-kick activity clock: ANY authed message that carries intent refreshes it — every
    // non-'input' message (chat/ping/shop/interact/skin/rename/needmap) AND any 'input' bearing
    // movement or queued actions/RPCs (menu buys, abilities…). So a player working a menu or
    // chatting is never kicked. The ONE thing that does NOT count is the bare no-op input the
    // client streams at ~60Hz while standing still or paneled — counting that would make the
    // idle-kick unreachable (this client never self-pauses), so an abandoned tab could never drain.
    const bareInput = m.type === 'input' && !(m.held && Object.values(m.held).some(Boolean)) && !(m.actions && m.actions.length);
    if (!bareInput) ws.lastActive = Date.now();
    if (m.type === 'input') world.setInput(ws.pid, m);
    else if (m.type === 'shop') { const data = world.shopPayloadFor(ws.pid); if (data) { try { ws.send(JSON.stringify({ type: 'shopData', data })); } catch (_e) {} } }
    else if (m.type === 'interact' && typeof m.npcId === 'string') {   // co-op [E] on an NPC → dialogue / panel / instant result
      const res = world.resolveInteract(ws.pid, m.npcId);
      if (res) { try { ws.send(JSON.stringify({ type: 'interactResult', res })); } catch (_e) {} }
    }
    else if (m.type === 'chat' && typeof m.text === 'string') {
      const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 200);
      const now = Date.now();
      if (text && !(ws.lastChat && now - ws.lastChat < 400)) {       // non-empty + not spammy
        ws.lastChat = now;
        const p = world.players.get(ws.pid);
        const payload = JSON.stringify({ type: 'chat', name: (p && p.name) || 'Hero', text });
        for (const c of wss.clients) { if (c.readyState === 1 && c.pid) { try { c.send(payload); } catch (_e) {} } }
      }
    }
    else if (m.type === 'skin' && Number.isFinite(m.skin)) { world.setSkin(ws.pid, m.skin); }   // hero look picker
    else if (m.type === 'ping') {                                    // co-op rally marker → relay to everyone
      const now = Date.now();
      if (!(ws.lastPing && now - ws.lastPing < 600)) {               // ~1.6/s anti-spam
        ws.lastPing = now;
        const p = world.players.get(ws.pid);
        if (p) {
          const kind = (m.kind === 'downed' || m.kind === 'danger') ? m.kind : 'alert';
          const payload = JSON.stringify({ type: 'ping', name: p.name || 'Hero', x: Math.round(p.x + p.w / 2), y: Math.round(p.y + p.h / 2), kind });
          for (const c of wss.clients) { if (c.readyState === 1 && c.pid) { try { c.send(payload); } catch (_e) {} } }
        }
      }
    }
    else if (m.type === 'rename' && ws.token && m.name) {
      try {
        const nm = await db.renameAccount(ws.token, m.name);
        const p = world.players.get(ws.pid);
        if (nm && p) { p.name = nm; ws.send(JSON.stringify({ type: 'renamed', name: nm })); }
      } catch (e) { console.error('[rename]', e && e.message); }
    }
    else if (m.type === 'needmap') {   // client is in a dungeon but never got the tile grid (the one-shot dgTiles was lost) → re-send it
      if (typeof world.resendMap === 'function') world.resendMap(ws.pid);
      else { const p = world.players.get && world.players.get(ws.pid); if (p) p._sentDgN = (p._mapSwitchN || 0) - 1; }   // fallback: unstick _sentDgN so the next snapshot re-emits dgTiles
    }
  });
  ws.on('close', async () => {
    if (ws._authTimer) { clearTimeout(ws._authTimer); ws._authTimer = null; }   // socket gone → the unauthed-reaper is moot
    if (!ws.pid || ws._superseded) return;   // superseded → a newer socket adopted this player; skip BOTH save and remove
    const ch = ws.token ? world.characterOf(ws.pid) : null;   // capture BEFORE removing
    world.removePlayer(ws.pid);
    console.log(`- ${ws.pid} left  (${world.list.length} online)`);
    if (!world.list.length) stopSim();                        // last one out → sim idles, world costs nothing
    if (ws.token && ch) { const tok = ws.token; await serialSave(tok, () => db.saveCharacter(tok, ch)); }   // #5: through the per-token chain so a racing autosave can't land AFTER this final state
  });
  ws.on('error', () => {});
});

// Serialize saves per token: the autosave loop and an on-close save can otherwise race the SAME
// account (close captures final state → autosave writes → close commits, its write landing last
// but out of order). Chain each token's saves so they commit strictly in call order; drop the
// token once its chain drains, so the Map can't grow. `doSave` is the actual write thunk.
const saveChains = new Map();   // token -> tail Promise of that token's save queue
function serialSave(token, doSave) {
  const chain = (saveChains.get(token) || Promise.resolve()).then(doSave).catch((e) => console.error('[save]', e && e.message));
  saveChains.set(token, chain);
  chain.finally(() => { if (saveChains.get(token) === chain) saveChains.delete(token); });   // last link out → forget the token
  return chain;
}

// Periodic autosave: a clean close saves a hero, but a server crash / hard kill wouldn't.
// Snapshot every persistent hero every 30s so progress survives the unexpected.
setInterval(async () => {
  if (!db.enabled) return;
  for (const ws of wss.clients) {
    if (ws.readyState !== 1 || !ws.token || !ws.pid || ws._superseded) continue;   // superseded → the new socket owns saves
    const ch = world.characterOf(ws.pid);
    if (ch) { const tok = ws.token; await serialSave(tok, () => db.saveCharacter(tok, ch)); }   // #5: same per-token chain the close-save uses
  }
}, 30000);

// Fixed-timestep loop: advance the sim to match REAL elapsed time, so game speed is
// independent of timer precision / CPU load. A plain setInterval(16ms) drifts under
// load on a shared container, and "one tick per fire" then runs in slow-motion. The
// accumulator steps the sim as many times as real time demands (capped), so speed
// stays correct even when the timer fires late.
const STEP_MS = 1000 / HZ;
const BCAST_MS = 15;                             // ~60Hz broadcast, decoupled from the sim rate
let acc = 0, lastT = Date.now(), lastBcast = 0, simTimer = null;
function broadcast() {
  for (const ws of wss.clients) {
    if (ws.readyState !== 1 || !ws.pid) continue;
    let snap;
    try { snap = world.snapshotFor(ws.pid); }               // one bad snapshot must NOT crash the whole room
    catch (e) { console.error('snapshotFor error for', ws.pid, e && e.message); continue; }
    if (snap) { try { ws.send(JSON.stringify({ type: 'state', snap })); } catch (_e) {} }
  }
}
function simStep() {
  const now = Date.now();
  let dt = now - lastT; lastT = now;
  if (dt > 250) dt = STEP_MS;                    // stalled — don't fast-forward a huge gap
  acc += dt;
  let steps = 0;
  while (acc >= STEP_MS && steps < 16) {         // catch up to real time (cap avoids spiral)
    try { world.tick(); } catch (e) { console.error('tick error:', e && e.message); }
    acc -= STEP_MS; steps++;
  }
  if (acc > STEP_MS * 16) acc = 0;
  if (now - lastBcast >= BCAST_MS) { lastBcast = now; broadcast(); }
}
// The sim runs ONLY while someone is connected. An empty world burns nothing — which
// (with idle-kick below draining AFK tabs) is what stops "left it open overnight" from
// billing a full simulation for hours. startSim on the first join, stopSim when empty.
function startSim() { if (simTimer) return; acc = 0; lastT = Date.now(); lastBcast = 0; simTimer = setInterval(simStep, 4); console.log('▶ sim running'); }
function stopSim() { if (!simTimer) return; clearInterval(simTimer); simTimer = null; console.log('⏸ sim paused (no active players)'); }

// Heartbeat: reap connections that died WITHOUT a clean close (network drop,
// laptop sleep, backgrounded tab). No TCP close = no removePlayer, so without
// this a dead connection lingers as a phantom "online" player forever. ping()
// every 15s; if a client missed the previous ping, terminate it (which fires
// 'close' → removePlayer). Also what lets a scaled-to-zero host know the last
// real player has actually left.
setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }   // no pong since last cycle → dead
    if (ws.authed && now - (ws.lastActive || now) > IDLE_MS) { // AFK too long → free the server
      console.log(`⏱ ${ws.pid} idle-kicked after ${Math.round((now - ws.lastActive) / 60000)}m`);
      try { ws.send(JSON.stringify({ type: 'idle-disconnect' })); } catch (_e) {}
      ws.close();                                             // graceful → flushes the notice → 'close' saves + drops
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (_e) {}
  }
}, 15000);

db.init().catch((e) => console.error('[db] init failed (heroes ephemeral this run):', e && e.message));

httpServer.listen(PORT, () => {
  console.log(`Eldermyr MP server — http+ws on :${PORT}  @ ${HZ}Hz  (heroes: ${db.enabled ? 'persistent' : 'ephemeral'})`);
  console.log(`Play locally: http://localhost:${PORT}/   (in prod: the service URL)`);
});
