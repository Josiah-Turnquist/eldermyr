'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// V4b — ephemeral boot of server/index.js on a high port, connect one ws client, assert we
// get a welcome (+map) and a stream of state snapshots with authoritative movement, then kill.
// Proves the timer restore didn't break the ws layer or the broadcast/sim loop end-to-end.
const { spawn } = require('child_process');
const path = require('path');
const REPO = '' + __RR + '';
const PORT = 8791;

const srv = spawn(process.execPath, [path.join(REPO, 'server', 'index.js')], {
  cwd: REPO, env: { ...process.env, PORT: String(PORT), DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let booted = false, serverLog = '';
srv.stdout.on('data', (d) => { serverLog += d; if (!booted && /http\+ws on/.test(String(d))) { booted = true; connect(); } });
srv.stderr.on('data', (d) => { serverLog += d; });

function fail(msg) {
  console.error('V4b FAIL —', msg);
  console.error('--- server log ---\n' + serverLog);
  try { srv.kill('SIGKILL'); } catch (_e) {}
  process.exit(1);
}
const bootWatch = setTimeout(() => { if (!booted) fail('server did not boot within 8s'); }, 8000);

function connect() {
  clearTimeout(bootWatch);
  const ws = new WebSocket('ws://localhost:' + PORT);
  let welcome = false, mapKb = 0, states = 0, myId = null;
  const xs = [];
  ws.onopen = () => { ws.send(JSON.stringify({ type: 'auth', name: 'Tester' })); };
  ws.onerror = (e) => fail('ws error: ' + ((e && e.message) || e));
  ws.onmessage = async (ev) => {
    let data = ev.data; if (typeof data !== 'string') data = String(data);
    let m; try { m = JSON.parse(data); } catch (_e) { return; }
    if (m.type === 'welcome') {
      welcome = true; myId = m.id; mapKb = +(Buffer.byteLength(data) / 1024).toFixed(1);
      setInterval(() => { try { ws.send(JSON.stringify({ type: 'input', held: { d: true } })); } catch (_e) {} }, 50);
    } else if (m.type === 'state' && m.snap) {
      states++;
      const me = m.snap.players.find((p) => p.id === myId);
      if (me) xs.push(me.x);
    }
  };
  setTimeout(() => {
    const movedEast = xs.length > 1 && (xs[xs.length - 1] - xs[0]) > 5;
    const ok = welcome && states > 5 && movedEast;
    console.log(JSON.stringify({ booted, welcome, mapKb, statesReceived: states,
      xStart: xs[0], xEnd: xs[xs.length - 1], movedEast, persistentLine: /heroes: ephemeral/.test(serverLog) }, null, 2));
    try { ws.close(); } catch (_e) {}
    setTimeout(() => {
      try { srv.kill('SIGTERM'); } catch (_e) {}
      if (ok) { console.log('\nV4b PASS — index.js booted; ws welcome+map; ' + states + ' snapshots; authoritative movement over the wire.'); process.exit(0); }
      else fail('did not observe welcome + snapshots + movement');
    }, 300);
  }, 2000);
}
