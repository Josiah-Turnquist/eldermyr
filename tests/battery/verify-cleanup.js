'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// Verification for the final MP cleanup wave (server/world.js items 1-4, 6-8, 11).
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
B.x = A.x + 220; B.y = A.y + 220;

// ---------- ITEM 1: _rescaleThreats — cached-base, idempotent warlord scaling ----------
{
  const savedEnemies = S.enemies;
  const mkWL = () => ({ x: 100, y: 100, w: 24, h: 24, maxHp: 100, hp: 100, atk: 10, def: 5, warlordRef: { level: 1, rank: 0 } });
  const E1 = mkWL(); S.enemies = [E1];
  w._rescaleThreats(10);
  const s1 = { maxHp: E1.maxHp, atk: E1.atk, hp: E1.hp };
  w._rescaleThreats(10);                       // OLD code compounded here (×10 again → 10000)
  const s2 = { maxHp: E1.maxHp, atk: E1.atk, hp: E1.hp };
  ok('ITEM1 twice @10 → identical maxHp (no compounding)', s1.maxHp === s2.maxHp, s1.maxHp + ' vs ' + s2.maxHp);
  ok('ITEM1 twice @10 → identical atk', s1.atk === s2.atk, s1.atk + ' vs ' + s2.atk);
  ok('ITEM1 twice @10 → identical hp', s1.hp === s2.hp, s1.hp + ' vs ' + s2.hp);
  ok('ITEM1 bounded (base×10=1000, not 10000)', E1.maxHp === 1000, 'maxHp=' + E1.maxHp);
  const E2 = mkWL(); S.enemies = [E2]; w._rescaleThreats(5); w._rescaleThreats(10); w._rescaleThreats(10);
  const E3 = mkWL(); S.enemies = [E3]; w._rescaleThreats(10);
  ok('ITEM1 escalate 5→10→10 == direct→10 (maxHp)', E2.maxHp === E3.maxHp, E2.maxHp + ' vs ' + E3.maxHp);
  ok('ITEM1 escalate 5→10→10 == direct→10 (atk)', E2.atk === E3.atk, E2.atk + ' vs ' + E3.atk);
  S.enemies = savedEnemies;
}

// ---------- ITEM 2: shared-phase log attribution (broadcast to all, no player owner) ----------
{
  w.snapshotFor('A'); w.snapshotFor('B');       // advance _feedSeen past startup noise
  const realUW = G.updateWeather;
  G.updateWeather = () => { global.__onLog('the shared snows fall over the realm', 'lore'); };  // a non-epic world line, emitted DURING the shared phase
  w.tick();
  G.updateWeather = realUW;
  const fa = w.snapshotFor('A'), fb = w.snapshotFor('B');
  const has = (snap, re) => !!(snap.feed && snap.feed.some((f) => re.test(f.m)));
  ok('ITEM2 shared line reaches A', has(fa, /shared snows/), JSON.stringify(fa.feed || []));
  ok('ITEM2 shared line reaches B (was players[0]-only)', has(fb, /shared snows/), JSON.stringify(fb.feed || []));
  const entry = w.feed.find((e) => /shared snows/.test(e.m));
  ok('ITEM2 shared entry is broadcast (bc=true)', !!entry && entry.bc === true);
  ok('ITEM2 shared entry has no player owner (id=null)', !!entry && entry.id == null);
  ok('ITEM2 shared entry has no name prefix (world event)', !!entry && entry.nm === '');
  // NEGATIVE: a per-player non-epic line stays personal (not blanket-broadcast)
  w.snapshotFor('A'); w.snapshotFor('B');
  let fired = false; const realUP = G.updatePlayer;
  G.updatePlayer = function () { if (!fired && S.player && S.player.id === 'A') { fired = true; global.__onLog('a private whisper only Ava hears', 'lore'); } return realUP.apply(this, arguments); };
  w.tick();
  G.updatePlayer = realUP;
  const pa = w.snapshotFor('A'), pb = w.snapshotFor('B');
  ok('ITEM2 personal line reaches owner A', has(pa, /private whisper/));
  ok('ITEM2 personal line NOT broadcast to B', !has(pb, /private whisper/));
}

// ---------- ITEM 3: per-player winter snow-tile chill (every hero, not just players[0]) ----------
// (P2/S3) The world.js per-rotation chill REPLICA is gone: updateWeather itself now loops the
// world-scoped party (partyIn), so the REAL updateWeather must chill BOTH heroes in one shared-phase
// pass. (The old form stubbed updateWeather out to isolate the replica; that stub would now silence
// the only chill source and assert nothing.)
{
  const realUT = G.updateTime;
  G.updateTime = () => {};                       // freeze S.time on a 150-multiple so the chill gate fires this tick
  const savedWeather = S.weather, savedTimer = S.weatherTimer, savedTime = S.time, savedEnemies = S.enemies, savedProj = S.projectiles;
  const aPos = { x: A.x, y: A.y }, bPos = { x: B.x, y: B.y };
  S.weather = 'snow'; S.weatherTimer = 99999; S.time = 300; S.enemies = []; S.projectiles = [];   // weatherTimer high: a mid-test reroll could flip snow off before the chill line
  A.x = 40 * TILE; A.y = 5 * TILE; A.chillT = 0; A.held = {}; A.downed = false; A.camping = false; A.hp = A.maxHp;
  B.x = 120 * TILE; B.y = 5 * TILE; B.chillT = 0; B.held = {}; B.downed = false; B.camping = false; B.hp = B.maxHp;
  ok('ITEM3 both heroes on the frozen band', 5 <= (208 * 0.17), 'ty=5');
  w.tick();
  ok('ITEM3 player A (players[0]) chilled by updateWeather itself', A.chillT === 75, 'A.chillT=' + A.chillT);
  ok('ITEM3 player B (players[1]) chilled too (partyIn fold)', B.chillT === 75, 'B.chillT=' + B.chillT);
  G.updateTime = realUT; S.weather = savedWeather; S.weatherTimer = savedTimer; S.time = savedTime; S.enemies = savedEnemies; S.projectiles = savedProj;
  A.x = aPos.x; A.y = aPos.y; B.x = bPos.x; B.y = bPos.y; A.chillT = 0; B.chillT = 0;
}

// ---------- ITEM 4: setInput action-queue cap ----------
{
  A.actions.length = 0;
  w.setInput('A', { actions: new Array(500).fill('attack') });
  ok('ITEM4 queue capped to 16 after setInput(500)', A.actions.length === 16, 'len=' + A.actions.length);
  let threw = null; try { w.tick(); } catch (e) { threw = String(e && e.message); }
  ok('ITEM4 next tick sane (no throw, queue drained)', threw === null && A.actions.length === 0 && Number.isFinite(A.x), 'threw=' + threw + ' len=' + A.actions.length);
}

// ---------- ITEM 6: safeClone skips dodgeHits (live enemy refs) ----------
{
  const fakeEnemy = { x: 1, y: 2, name: 'foe' }; fakeEnemy.self = fakeEnemy;   // cyclic live ref
  A.dodgeHits = [fakeEnemy, fakeEnemy];
  let snap = null, threw = null;
  try { snap = w.snapshotFor('A'); } catch (e) { threw = String(e && e.message); }
  ok('ITEM6 snapshot with populated dodgeHits does not throw', threw === null, 'threw=' + threw);
  ok('ITEM6 snap.me has NO dodgeHits', !!snap && snap.me && snap.me.dodgeHits === undefined);
  delete A.dodgeHits;
}

// ---------- ITEM 8: floorMod rides the dungeon snapshot ----------
{
  A.map = 'overworld'; B.map = 'overworld'; w.sharedDg = null; w.dgSpawn = null;
  A.downed = false; A.hp = A.maxHp; A.def = 99999; A.actions.length = 0;
  for (let i = 0; i < 6; i++) w.tick();
  const de = S.dungeonEntrance;
  A.inventory.keys = 3;
  A.x = de.tx * TILE + 4; A.y = (de.ty + 1) * TILE + 4;
  A.actions.push('interact');
  w.tick();
  const entered = A.map === 'dungeon' && !!w.sharedDg;
  ok('ITEM8 setup: A entered the shared dungeon', entered, 'A.map=' + A.map);
  if (entered) {
    w.sharedDg.floorMod = 'gilded';             // stamp a modifier on the live instance
    const snap = w.snapshotFor('A');
    ok('ITEM8 dungeon snapshot carries floorMod', !!snap && snap.floorMod === 'gilded', 'floorMod=' + (snap && snap.floorMod));
    const snapB = w.snapshotFor('B');
    ok('ITEM8 overworld snapshot omits floorMod', !!snapB && snapB.floorMod === undefined, 'B.floorMod=' + (snapB && snapB.floorMod));
  }
}

// ---------- ITEM 11: perf() instrumentation ----------
{
  const before = w._ticks;
  for (let i = 0; i < 200; i++) w.tick();
  w.snapshotFor('A'); w.snapshotFor('B');
  const p = w.perf();
  ok('PERF tickMsAvg > 0', p.tickMsAvg > 0, 'tickMsAvg=' + p.tickMsAvg);
  ok('PERF snapMsAvg > 0', p.snapMsAvg > 0, 'snapMsAvg=' + p.snapMsAvg);
  ok('PERF ticks advanced ~200', p.ticks >= before + 200, 'ticks=' + p.ticks);
  ok('PERF players matches reality', p.players === S.players.length, p.players + '==' + S.players.length);
  ok('PERF enemies matches reality', p.enemies === S.enemies.length, p.enemies + '==' + S.enemies.length);
  ok('PERF pickups matches reality', p.pickups === (S.pickups || []).length, p.pickups + '==' + (S.pickups || []).length);
  const fields = ['tickMsAvg', 'tickMsMax', 'snapMsAvg', 'ticks', 'enemies', 'allies', 'projectiles', 'particles', 'pickups', 'players', 'feedLen'];
  ok('PERF all fields present', fields.every((k) => k in p), Object.keys(p).join(','));
  const p2 = w.perf();   // no ticks between reads → rolling max reset to 0
  ok('PERF rolling tickMsMax resets on read', p2.tickMsMax === 0, 'second-read=' + p2.tickMsMax);
  out.push('  perf() sample: ' + JSON.stringify(p));
}

console.log(out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
