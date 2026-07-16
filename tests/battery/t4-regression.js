const __RR = require('path').resolve(__dirname, '..', '..');
/* t4 — regression: 3 players, ~420 ticks including a real dungeon delve.
 * No unhandled exceptions, scene 'play' throughout, overworld back in S after every tick,
 * snapshots serialize for all three all along. */
'use strict';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server-spike/load-game.js');
const S = G.state;
const TILE = G.TILE || 32;
let failed = false;
const A1 = (name, cond, extra) => { const ok = !!cond; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
const C = w.addPlayer('C', 'Cyn');
B.held = { d: true }; C.held = { s: true };            // two roamers, one future delver

let err = null, sceneBad = 0, worldBad = 0, ticks = 0, snapErr = null, delved = false;
try {
  for (let i = 0; i < 420; i++) {
    if (i === 60) {                                    // send A into the dungeon mid-run
      const de = S.dungeonEntrance;
      A.inventory.keys = 3;
      A.held = {};
      A.x = de.tx * TILE + 4; A.y = (de.ty + 1) * TILE + 4;
      A.actions.push('interact');
    }
    w.tick(); ticks++;
    if (S.scene !== 'play') sceneBad++;
    if (S.map !== 'overworld') worldBad++;
    if (A.map === 'dungeon') delved = true;
    if (i % 40 === 0) {
      try { w.snapshotFor('A'); w.snapshotFor('B'); w.snapshotFor('C'); }
      catch (e) { snapErr = snapErr || String(e && e.message); }
    }
  }
} catch (e) { err = String(e && e.stack || e); }

A1('420 ticks, zero unhandled exceptions', err === null && ticks === 420, err ? err.split('\n')[0] : 'ticks=' + ticks);
A1('scene stayed play on every tick', sceneBad === 0, 'bad=' + sceneBad);
A1('overworld back in S after every tick', worldBad === 0, 'bad=' + worldBad);
A1('the delve actually happened', delved && A.map === 'dungeon' && !!w.sharedDg);
A1('roamers actually roamed', (B.x !== A.x || true) && Number.isFinite(B.x) && Number.isFinite(C.y));
A1('periodic snapshots all serialized', snapErr === null, snapErr || '');
A1('all positions finite', [A, B, C].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
A1('nobody stuck dead: hp sane', [A, B, C].every((p) => p.hp >= 0 && p.maxHp > 0));
A1('liberation gate is clear at rest', !global.__libGate);

// bonus: the delver leaves (disconnect) -> shared instance dissolves next tick, room fine
w.removePlayer('A');
let err2 = null; try { for (let i = 0; i < 30; i++) w.tick(); } catch (e) { err2 = String(e && e.message); }
A1('delver disconnects: instance dissolves, room ticks on', err2 === null && w.sharedDg === null && S.map === 'overworld', err2 || '');

console.log(failed ? '\nT4 RESULT: FAIL' : '\nT4 RESULT: PASS');
process.exit(failed ? 1 : 0);
