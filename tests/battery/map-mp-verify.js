'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// map-mp-verify.js — MP room boots on the enlarged map; 300 ticks (spawn/kill) clean; mapPayload dims 347x291.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game.js');
const { World } = require(REPO + '/server/world.js');   // requiring world.js runs G.startGame()
const S = G.state, TILE = G.TILE;

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; fails.push(n + (x != null ? ' [' + x + ']' : '')); } console.log((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '   [' + x + ']' : '')); };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
ok('two players joined in bounds', A.x >= 0 && A.y >= 0 && A.x < 347 * TILE && A.y < 291 * TILE && B.x >= 0 && B.x < 347 * TILE, (A.x / TILE).toFixed(0) + ',' + (A.y / TILE).toFixed(0));

A.held = { d: true }; B.held = { s: true };
// 300 ticks with combat: keep giving A a foe and attacking (spawn/kill churn)
let err = null, ticks = 0;
try {
  for (let i = 0; i < 300; i++) {
    if (i % 40 === 0) { const foe = G.makeWildEnemy(Math.floor(A.x / TILE) + 1, Math.floor(A.y / TILE)); if (foe) { foe.x = A.x + 18; foe.y = A.y; S.enemies.push(foe); } }
    A.actions.push('attack');
    w.tick(); ticks++;
  }
} catch (e) { err = String(e && e.stack || e); }
ok('300 sim ticks (spawn/kill) ran with no throw', !err && ticks === 300, err || ('ticks=' + ticks));
ok('both players finite after ticks', Number.isFinite(A.x) && Number.isFinite(A.y) && Number.isFinite(B.x) && Number.isFinite(B.y));

const mp = w.mapPayload();
ok('mapPayload w === 347', mp.w === 347, mp.w);
ok('mapPayload h === 291', mp.h === 291, mp.h);
ok('mapPayload tiles rows === 291', mp.tiles.length === 291, mp.tiles.length);
ok('mapPayload tiles cols === 347', mp.tiles[0].length === 347, mp.tiles[0].length);

// snapshots serialize for both after the churn
let snapErr = null;
try { JSON.stringify(w.snapshotFor('A')); JSON.stringify(w.snapshotFor('B')); } catch (e) { snapErr = String(e); }
ok('snapshots serialize for both players', !snapErr, snapErr);

console.log('\n==== map-mp-verify: ' + pass + ' passed, ' + fail + ' failed ====');
if (fail) { console.log('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }
process.exit(0);
