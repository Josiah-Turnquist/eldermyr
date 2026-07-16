'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// V5 — direct proof of the pg half of the bug/fix. Mimic prod require order (load-game first,
// which restores the real global timers; THEN pg). Point a pool at a blackhole IP (192.0.2.1,
// RFC5737 TEST-NET-1 — connects hang, nothing responds) with a short connectionTimeoutMillis.
// pg/lib/client.js sets `connectionTimeoutHandle = setTimeout(...)`. If that resolves the REAL
// global setTimeout, connect() rejects with "timeout expired" at ~the deadline. With the boot
// stub (pre-fix), that setTimeout is a no-op → the connect would hang indefinitely.
const assert = require('assert');
require('' + __RR + '/server-spike/load-game'); // restores real timers
const { Pool } = require('' + __RR + '/node_modules/pg');

const pool = new Pool({ host: '192.0.2.1', port: 5432, user: 'x', password: 'x', database: 'x',
  connectionTimeoutMillis: 700, max: 1 });
pool.on('error', () => {});

const t0 = Date.now();
const hang = setTimeout(() => { console.error('V5 FAIL — connect() hung > 4s; connectionTimeout setTimeout is a no-op stub'); process.exit(1); }, 4000);

pool.connect()
  .then((c) => { clearTimeout(hang); c.release(); console.error('V5 FAIL — unexpectedly connected to blackhole'); process.exit(1); })
  .catch((e) => {
    clearTimeout(hang);
    const dt = Date.now() - t0;
    console.log(JSON.stringify({ dt_ms: dt, message: e && e.message }, null, 2));
    assert.ok(/timeout/i.test(e && e.message || ''), 'must reject via connection TIMEOUT (proves global setTimeout is real, not the stub)');
    assert.ok(dt < 3000, 'the timeout must fire promptly (~700ms), not hang');
    console.log('\nV5 PASS — pg connection-timeout timer fires (real global setTimeout restored). Pre-fix this would hang.');
    pool.end().finally(() => process.exit(0));
  });
