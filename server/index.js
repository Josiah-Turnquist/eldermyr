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
const { setInterval, clearInterval } = require('node:timers');
const { World } = require('./world');
const db = require('./db');   // persistent heroes (no-ops to ephemeral if no DATABASE_URL)

const PORT = Number(process.env.PORT) || 8138;   // Railway injects PORT in prod
// The sim runs at a fixed HZ (the accumulator keeps it real-time-accurate regardless
// of timer jitter). 60 = the game's design speed; single-player (frame-based) runs at
// the display refresh, so a 120Hz monitor plays at 2x. 80 is a chosen middle ground —
// a touch faster than design without the frantic 2x. Client-side smoothing (below)
// handles the choppiness from snapshots arriving unevenly on a high-fps display.
const HZ = Number(process.env.HZ) || 80;
// Disconnect a player who hasn't done anything meaningful for this long — a backstop so
// an AFK/backgrounded tab can't keep the sim (and the bill) running, and so an away player
// isn't left standing in danger for long. The client pauses itself at the same mark; this
// catches anything it misses. Their hero is saved on disconnect. Heartbeat granularity 15s.
// The world NEVER pauses while anyone is connected (it's multiplayer). The only cost
// guards are: the sim stops when the server is EMPTY (nobody online — invisible), and an
// ABANDONED tab is disconnected after IDLE_MS so it can't stream to itself all night.
const IDLE_MS = Number(process.env.IDLE_MS) || 5 * 60 * 1000;
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
const httpServer = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/health') { res.writeHead(200); res.end('ok'); return; }
  const hit = STATIC[u];
  if (hit) {
    try { res.writeHead(200, { 'content-type': hit[1] }); res.end(fs.readFileSync(path.join(ROOT, hit[0]))); return; }
    catch (_e) { res.writeHead(500); res.end('read error'); return; }
  }
  res.writeHead(404); res.end('not found');
});

const world = new World();
const wss = new WebSocketServer({ server: httpServer });   // share the HTTP server's port
let seq = 0;

// Turn an auth message into an account (or null → ephemeral hero), then the caller spawns it.
//   { token }         → auto-login this browser's saved hero
//   { recoveryCode }  → reclaim a hero on a new device (returns its token)
//   { name }          → create a brand-new hero (only if a DB is configured)
async function resolveAccount(m) {
  try {
    if (m.token) { const a = await db.loadByToken(m.token); if (a) return { acct: a, isNew: false }; }
    if (m.recoveryCode) { const a = await db.loadByRecovery(m.recoveryCode); if (a) return { acct: a, isNew: false, viaCode: true }; }
    if (db.enabled) { const a = await db.createAccount(m.name); if (a) return { acct: a, isNew: true }; }
  } catch (e) { console.error('[auth] error:', e && e.message); }
  return { acct: null, isNew: false };   // no DB (or DB error) → play ephemerally
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.authed = false;
  ws.lastActive = Date.now();   // for idle-kick
  ws.on('pong', () => { ws.isAlive = true; });   // client answered our ping → still alive
  ws.on('message', async (data) => {
    let m; try { m = JSON.parse(data); } catch (_e) { return; }
    // ---- handshake: the FIRST message must be `auth`; the world spawns the hero only after ----
    if (!ws.authed) {
      if (m.type !== 'auth' || ws.authing) return;
      ws.authing = true;
      const { acct, isNew, viaCode } = await resolveAccount(m);
      if (ws.readyState !== 1) return;               // client vanished during the DB round-trip
      const id = 'p' + (++seq);
      const name = ((acct ? acct.name : m.name) || 'Hero').toString().slice(0, 18) || 'Hero';
      world.addPlayer(id, name, acct && acct.character);
      ws.pid = id;
      ws.token = acct ? acct.token : null;           // null = ephemeral; set = we persist this hero
      ws.authed = true;
      ws.send(JSON.stringify({
        type: 'welcome', id, name, hz: HZ, map: world.mapPayload(),
        token: ws.token || undefined,                          // browser stores this to auto-login next time
        recoveryCode: (isNew && acct) ? acct.recovery : undefined,   // shown ONCE, on new-hero creation
        reclaimed: viaCode || undefined,                       // logged in via a recovery code
        persistent: db.enabled,                                // false → tell the player saves are off
      }));
      console.log(`+ ${id} (${name}) ${acct ? (isNew ? '[new]' : '[loaded]') : '[ephemeral]'}  (${world.list.length} online)`);
      startSim();                                            // wake the sim on the first join
      return;
    }
    // ---- authed traffic ----
    // Activity clock (for the abandoned-tab disconnect only): a bare "not moving, no
    // actions" input doesn't count as active, so a truly abandoned tab eventually times out.
    if (m.type !== 'input' || (m.held && Object.values(m.held).some(Boolean)) || (m.actions && m.actions.length)) ws.lastActive = Date.now();
    if (m.type === 'input') world.setInput(ws.pid, m);
    else if (m.type === 'shop') { const data = world.shopPayloadFor(ws.pid); if (data) { try { ws.send(JSON.stringify({ type: 'shopData', data })); } catch (_e) {} } }
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
  });
  ws.on('close', async () => {
    if (!ws.pid) return;
    const ch = ws.token ? world.characterOf(ws.pid) : null;   // capture BEFORE removing
    world.removePlayer(ws.pid);
    console.log(`- ${ws.pid} left  (${world.list.length} online)`);
    if (!world.list.length) stopSim();                        // last one out → sim idles, world costs nothing
    if (ws.token && ch) { try { await db.saveCharacter(ws.token, ch); } catch (e) { console.error('[save] on close:', e && e.message); } }
  });
  ws.on('error', () => {});
});

// Periodic autosave: a clean close saves a hero, but a server crash / hard kill wouldn't.
// Snapshot every persistent hero every 30s so progress survives the unexpected.
setInterval(async () => {
  if (!db.enabled) return;
  for (const ws of wss.clients) {
    if (ws.readyState !== 1 || !ws.token || !ws.pid) continue;
    const ch = world.characterOf(ws.pid);
    if (ch) { try { await db.saveCharacter(ws.token, ch); } catch (_e) {} }
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
    const snap = world.snapshotFor(ws.pid);
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
