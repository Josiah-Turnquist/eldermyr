'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// V1 — after requiring load-game, the REAL global timers must be back:
//   setTimeout(fn,50) fires (pre-fix it returned 0 and never fired), handle clearable;
//   setInterval fires repeatedly and is clearable; rAF stays stubbed.
const assert = require('assert');
require('' + __RR + '/server-spike/load-game');

const out = { handleType: typeof setTimeout(() => {}, 9999), setTimeoutFired: false, canceledFired: false,
  intervalFires: 0, intervalCleared: false, rafReturns: global.requestAnimationFrame() };

// handle must be a real Timeout object, not the stub's number 0
assert.strictEqual(out.handleType, 'object', 'setTimeout must return a real Timeout handle (stub returned number 0)');
assert.strictEqual(out.rafReturns, 0, 'requestAnimationFrame must remain stubbed (returns 0)');

// clearTimeout must actually cancel
const hCancel = setTimeout(() => { out.canceledFired = true; }, 40);
assert.strictEqual(typeof hCancel, 'object', 'setTimeout handle should be object');
clearTimeout(hCancel);

setTimeout(() => {
  out.setTimeoutFired = true;
  let n = 0;
  const iv = setInterval(() => {
    n++;
    if (n >= 3) { clearInterval(iv); out.intervalFires = n; out.intervalCleared = true; setTimeout(finish, 80); }
  }, 15);
  assert.strictEqual(typeof iv, 'object', 'setInterval must return a real handle');
}, 50);

function finish() {
  console.log(JSON.stringify(out, null, 2));
  assert.ok(out.setTimeoutFired, 'setTimeout must FIRE');
  assert.ok(out.intervalFires >= 3, 'setInterval must fire repeatedly');
  assert.ok(out.intervalCleared, 'setInterval must be clearable');
  assert.ok(out.canceledFired === false, 'clearTimeout must cancel a pending timeout');
  console.log('\nV1 PASS — real setTimeout/setInterval fire + clear; clearTimeout cancels; rAF still stubbed.');
  process.exit(0);
}
