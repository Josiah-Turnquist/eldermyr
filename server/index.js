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
const { setInterval } = require('node:timers');
const { World } = require('./world');

const PORT = Number(process.env.PORT) || 8138;   // Railway injects PORT in prod
// 60Hz: Eldermyr's sim is frame-based, tuned for 60fps. Ticking slower runs the
// WHOLE game (movement, cooldowns, enemy AI, day/night) in slow motion. The sim
// is ~0.05ms/tick so 60Hz is cheap; this makes the server match single-player speed.
const HZ = Number(process.env.HZ) || 60;
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

wss.on('connection', (ws) => {
  const id = 'p' + (++seq);
  const p = world.addPlayer(id, 'Hero ' + seq);
  ws.pid = id;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });   // client answered our ping → still alive
  ws.send(JSON.stringify({ type: 'welcome', id, name: p.name, map: world.mapPayload() }));
  console.log(`+ ${id} joined  (${world.list.length} online)`);
  ws.on('message', (data) => {
    try { const m = JSON.parse(data); if (m.type === 'input') world.setInput(id, m); } catch (_e) {}
  });
  ws.on('close', () => { world.removePlayer(id); console.log(`- ${id} left  (${world.list.length} online)`); });
  ws.on('error', () => {});
});

setInterval(() => {
  try { world.tick(); } catch (e) { console.error('tick error:', e && e.message); }
  for (const ws of wss.clients) {
    if (ws.readyState !== 1 || !ws.pid) continue;
    const snap = world.snapshotFor(ws.pid);
    if (snap) { try { ws.send(JSON.stringify({ type: 'state', snap })); } catch (_e) {} }
  }
}, Math.round(1000 / HZ));

// Heartbeat: reap connections that died WITHOUT a clean close (network drop,
// laptop sleep, backgrounded tab). No TCP close = no removePlayer, so without
// this a dead connection lingers as a phantom "online" player forever. ping()
// every 15s; if a client missed the previous ping, terminate it (which fires
// 'close' → removePlayer). Also what lets a scaled-to-zero host know the last
// real player has actually left.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }   // no pong since last cycle → dead
    ws.isAlive = false;
    try { ws.ping(); } catch (_e) {}
  }
}, 15000);

httpServer.listen(PORT, () => {
  console.log(`Eldermyr MP server — http+ws on :${PORT}  @ ${HZ}Hz`);
  console.log(`Play locally: http://localhost:${PORT}/   (in prod: the service URL)`);
});
