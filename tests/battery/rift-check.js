'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// ITEM 5: _enterRift must restore ALL world slots on any failure path (mirror the dungeon phase),
// and the interact-join path must restore full slots. Fresh process → clean shared S.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server-spike/load-game');
const { World } = require(REPO + '/server/world');
const S = G.state;
const TILE = G.TILE || 32;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
B.x = A.x + 260; B.y = A.y + 260;
for (const p of [A, B]) { p.def = 999999; p.maxHp = 999999; p.hp = 999999; }
for (let i = 0; i < 8; i++) w.tick();

// ===== HAPPY PATH: solo rift opens → breach → overworld restored, dungeon captured =====
{
  const owEnemies = S.enemies, owNpcs = S.npcs, owMd = G.maps.dungeon;
  A.map = 'overworld'; A.inventory.keys = 2;
  w.rift = { x: A.x, y: A.y, deep: 5, party: false, expires: S.time + 2400, n: 1 };
  w.sharedDg = null; w.dgSpawn = null;
  const keys0 = A.inventory.keys;
  w._enterRift(A);
  ok('HAPPY solo breach → A in dungeon', A.map === 'dungeon', 'A.map=' + A.map);
  ok('HAPPY shared dungeon instance captured', !!w.sharedDg && !!w.dgSpawn);
  ok('HAPPY dungeon floor is the deep one', (w.sharedDg && w.sharedDg.dungeonLevel) === 5, 'lvl=' + (w.sharedDg && w.sharedDg.dungeonLevel));
  ok('HAPPY overworld restored in S (map)', S.map === 'overworld');
  ok('HAPPY overworld restored by IDENTITY (enemies/npcs)', S.enemies === owEnemies && S.npcs === owNpcs);
  ok('HAPPY maps.dungeon restored for topside', G.maps.dungeon === owMd);
  ok('HAPPY solo rift closed on breach', w.rift === null);
  ok('HAPPY one key spent', A.inventory.keys === keys0 - 1, 'keys ' + keys0 + '→' + A.inventory.keys);
  // room keeps ticking; B stays topside, both worlds sane
  let err = null; try { for (let i = 0; i < 20; i++) { w.tick(); if (S.map !== 'overworld') throw new Error('left swapped @' + i); } } catch (e) { err = String(e.message); }
  ok('HAPPY 20 follow-up ticks clean (overworld in S each tick)', err === null, err || '');
  ok('HAPPY B still topside', B.map === 'overworld');
  // reset A back topside for the next case
  A.map = 'overworld'; A.dg = null; w.sharedDg = null; w.dgSpawn = null;
  for (let i = 0; i < 4; i++) w.tick();
}

// ===== THROW SAFETY: setupDungeonFloor throws AFTER slots swapped, BEFORE map flip =====
{
  const owEnemies = S.enemies, owNpcs = S.npcs, owPickups = S.pickups, owMd = G.maps.dungeon;
  A.map = 'overworld'; A.inventory.keys = 3; const keys0 = A.inventory.keys;
  w.rift = { x: A.x, y: A.y, deep: 6, party: false, expires: S.time + 2400, n: 2 };
  w.sharedDg = null; w.dgSpawn = null;
  const realSetup = G.setupDungeonFloor;
  G.setupDungeonFloor = () => { throw new Error('injected-setup-boom'); };
  let threw = null;
  try { w._enterRift(A); } catch (e) { threw = String(e.message); }   // _enterRift catches internally via _err; must NOT propagate
  G.setupDungeonFloor = realSetup;
  ok('THROW _enterRift swallowed the failure (no propagation)', threw === null, 'threw=' + threw);
  ok('THROW A stayed on the overworld (no half-entry)', A.map === 'overworld', 'A.map=' + A.map);
  ok('THROW no dungeon instance captured', !w.sharedDg && !w.dgSpawn);
  ok('THROW S.map is overworld (no mixed slots)', S.map === 'overworld', 'S.map=' + S.map);
  ok('THROW overworld enemies restored by IDENTITY (no dungeon fragments)', S.enemies === owEnemies, 'sameEnemies=' + (S.enemies === owEnemies));
  ok('THROW overworld npcs/pickups restored by IDENTITY', S.npcs === owNpcs && S.pickups === owPickups);
  ok('THROW maps.dungeon restored', G.maps.dungeon === owMd);
  ok('THROW key NOT consumed on a failed breach', A.inventory.keys === keys0, 'keys=' + A.inventory.keys);
  ok('THROW rift NOT closed (retryable)', !!w.rift);
  // the room must still be alive & sane
  let err = null; try { for (let i = 0; i < 20; i++) { w.tick(); if (S.map !== 'overworld') throw new Error('left swapped @' + i); } } catch (e) { err = String(e.message); }
  ok('THROW 20 follow-up ticks clean', err === null, err || '');
  ok('THROW snapshots still serialize for both', !!w.snapshotFor('A') && !!w.snapshotFor('B'));
}

console.log(out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
