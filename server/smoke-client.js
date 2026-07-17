/*
 * server/smoke-client.js — headless end-to-end check of the network loop.
 * Connects, expects a welcome (+map) and a stream of state snapshots, drives
 * "walk east" input, and asserts the server-authoritative position actually
 * moves back over the wire. Run the server first, then: node server/smoke-client.js
 */
'use strict';
const PORT = Number(process.env.PORT) || 8138;
const ws = new WebSocket('ws://localhost:' + PORT);   // Node 22+ global WebSocket
let welcome = false, states = 0, myId = null, mapKb = 0;
const xs = [];

ws.onopen = () => {};
ws.onerror = (e) => { console.error('ws error:', (e && e.message) || e); };
ws.onmessage = async (ev) => {
  // our server sends TEXT frames (→ string); if we ever get binary (wrong server
  // on this port), normalize instead of throwing a cryptic JSON error.
  let data = ev.data;
  if (typeof data !== 'string') data = (data && typeof data.text === 'function') ? await data.text() : String(data);
  const m = JSON.parse(data);
  if (m.type === 'welcome') {
    welcome = true; myId = m.id; mapKb = +(Buffer.byteLength(ev.data) / 1024).toFixed(1);
    setInterval(() => { try { ws.send(JSON.stringify({ type: 'input', held: { d: true }, actions: ['attack'] })); } catch (_e) {} }, 50);
  } else if (m.type === 'state' && m.snap) {
    states++;
    const me = m.snap.players.find((p) => p.id === myId);
    if (me) xs.push(me.x);
  }
};

setTimeout(() => {
  const movedEast = xs.length > 1 && (xs[xs.length - 1] - xs[0]) > 10;
  const ok = welcome && states > 5 && movedEast;
  console.log(JSON.stringify({ welcome, mapKb, statesReceived: states, xStart: xs[0], xEnd: xs[xs.length - 1], movedEast }, null, 2));
  console.log(ok ? '\n  ✅ Network loop OK — join, map, snapshots, authoritative movement over the wire.\n'
                 : '\n  ⚠  Network loop issue — is the server running on ' + PORT + '?\n');
  try { ws.close(); } catch (_e) {}
  process.exit(ok ? 0 : 1);
}, 1700);
