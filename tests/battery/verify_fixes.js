'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// Verification for the per-player-state fixes in server/world.js (+ client adopt shapes).
// Mimics how server/index.js boots the World; no DB.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server-spike/load-game');   // same module instance world.js uses (require cache)
const { World } = require(REPO + '/server/world');
const S = G.state;
const TILE = G.TILE || 32;

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra) { (cond ? pass++ : fail++); results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra != null ? '  [' + extra + ']' : '')); }

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');

// ---------------------------------------------------------------------------
// FIX 1 — lastRestDay persists (writeBackPP was omitting it → back to Exhausted)
// ---------------------------------------------------------------------------
{
  A.lastRestDay = 1;
  // emulate a rest during A's slice: a monkey-patched updatePlayer bumps S.lastRestDay while S.player===A.
  // Only writeBackPP (the fix) carries that back onto A. B must be untouched.
  const origUP = G.updatePlayer;
  let restedTo = null;
  G.updatePlayer = function () { if (S.player === A) { S.lastRestDay = (G.curDay ? G.curDay() : 1) + 3; restedTo = S.lastRestDay; } return origUP.apply(this, arguments); };
  w.tick();
  G.updatePlayer = origUP;
  ok('FIX1 lastRestDay persisted after writeBackPP', A.lastRestDay === restedTo && restedTo != null, 'A.lastRestDay=' + A.lastRestDay + ' expected=' + restedTo);
  ok('FIX1 B.lastRestDay untouched by A rest', B.lastRestDay !== restedTo, 'B.lastRestDay=' + B.lastRestDay);
}
// camp path: doCamp RPC records the rest on the acting hero.
{
  S.enemies.length = 0;                       // camp refuses with foes within 210px
  A.map = 'overworld'; A.lastRestDay = 1; A._exWas = true;
  A.actions.push({ rpc: 'doCamp', args: [] });
  w.tick();
  ok('FIX1 camp path set A.lastRestDay to curDay', A.lastRestDay === (G.curDay ? G.curDay() : 1) && A._exWas === false, 'A.lastRestDay=' + A.lastRestDay + ' curDay=' + G.curDay());
}

// ---------------------------------------------------------------------------
// FIX 2 — sailing / dragon are PER-PLAYER (no leak across slices) + reach the client
// ---------------------------------------------------------------------------
{
  A.sailing = true; A.dragon.mounted = true;
  B.sailing = false; B.dragon.mounted = false;
  const seenSail = {}, seenMount = {};
  const origUP = G.updatePlayer;
  G.updatePlayer = function () { if (S.player) { seenSail[S.player.id] = S.sailing; seenMount[S.player.id] = !!(S.dragon && S.dragon.mounted); } return origUP.apply(this, arguments); };
  w.tick();
  G.updatePlayer = origUP;
  ok("FIX2 A's slice sees S.sailing=true", seenSail.A === true, 'seenSail.A=' + seenSail.A);
  ok("FIX2 B's slice does NOT inherit sailing (no water-walk leak)", seenSail.B === false, 'seenSail.B=' + seenSail.B);
  ok("FIX2 A's slice sees S.dragon.mounted=true", seenMount.A === true, 'seenMount.A=' + seenMount.A);
  ok("FIX2 B's slice does NOT inherit flight (no fly-collision leak)", seenMount.B === false, 'seenMount.B=' + seenMount.B);
  ok('FIX2 sailing persisted on A after tick', A.sailing === true, 'A.sailing=' + A.sailing);
  ok('FIX2 mounted persisted on A after tick', A.dragon.mounted === true, 'A.dragon.mounted=' + A.dragon.mounted);

  const snapA = JSON.parse(JSON.stringify(w.snapshotFor('A')));
  const snapB = JSON.parse(JSON.stringify(w.snapshotFor('B')));
  ok('FIX2 snapA.me.sailing === true (serialized)', snapA.me.sailing === true, 'got ' + snapA.me.sailing);
  ok('FIX2 snapA.me.dragon.mounted === true (serialized)', snapA.me.dragon && snapA.me.dragon.mounted === true, 'got ' + JSON.stringify(snapA.me.dragon));
  ok('FIX2 snapB.me.sailing falsy', !snapB.me.sailing, 'got ' + snapB.me.sailing);
  ok('FIX2 snapB.me.dragon.mounted falsy', !(snapB.me.dragon && snapB.me.dragon.mounted), 'got ' + JSON.stringify(snapB.me.dragon));
  const aInB = (snapB.players || []).find((p) => p.id === 'A');
  ok("FIX2 B's snapshot of A carries sailing flag (remote sprite)", aInB && aInB.sailing === true, aInB ? 'sailing=' + aInB.sailing : 'A missing');
  ok("FIX2 B's snapshot of A carries mounted flag (remote sprite)", aInB && aInB.mounted === true, aInB ? 'mounted=' + aInB.mounted : 'A missing');

  // save/load: tamed Emberwyrm persists; mounted restored grounded.
  A.dragon.tamed = true; A.dragon.mounted = true;
  const ch = w.characterOf('A');
  ok('FIX2 characterOf saves dragon.tamed', ch && ch.dragon && ch.dragon.tamed === true, 'ch.dragon=' + JSON.stringify(ch && ch.dragon));
  const C = w.addPlayer('C', 'Cid', ch);
  ok('FIX2 loaded hero restores dragon.tamed', C.dragon.tamed === true, 'C.dragon=' + JSON.stringify(C.dragon));
  ok('FIX2 loaded hero grounded (mounted=false)', C.dragon.mounted === false, 'C.dragon.mounted=' + C.dragon.mounted);
  w.removePlayer('C');
  A.sailing = false; A.dragon.mounted = false;
}

// ---------------------------------------------------------------------------
// FIX 3 — allies: partitioned, updateAllies runs, move/fight/expire + serialize
// ---------------------------------------------------------------------------
{
  S.enemies.length = 0; S.allies = [];
  B.x = A.x + 4000; B.y = A.y + 4000;         // B far away so it neither owns nor sees A's ally yet
  const ally = { x: A.x + 300, y: A.y, w: 22, h: 22, ally: true, _owner: 'A', name: 'Thrall', rank: 0, hp: 90, maxHp: 90, atk: 12, def: 2, color: '#74b0ff', attackCd: 0, life: 2100, wobble: 0 };
  const badName = { x: A.x + 40, y: A.y + 40, w: 22, h: 22, ally: true, _owner: 'A', name: 42, rank: 0, hp: 50, maxHp: 50, atk: 5, def: 1, color: '#9a70ff', attackCd: 0, life: 2100, wobble: 0 };
  S.allies.push(ally, badName);
  const x0 = ally.x, y0 = ally.y;
  for (let i = 0; i < 60; i++) w.tick();
  const moved = Math.abs(ally.x - x0) + Math.abs(ally.y - y0);
  ok('FIX3 ally MOVES toward its owner (updateAllies ran)', moved > 5, 'delta=' + moved.toFixed(1));
  ok('FIX3 non-string ally name coerced server-side', typeof badName.name === 'string', 'name=' + JSON.stringify(badName.name));
  const snapA = JSON.parse(JSON.stringify(w.snapshotFor('A')));
  ok('FIX3 ally appears in owner A snapshot', (snapA.allies || []).length >= 1, 'allies=' + (snapA.allies || []).length);
  const packed = (snapA.allies || [])[0];
  ok('FIX3 packed ally has string name (drawAlly-safe)', packed && typeof packed.name === 'string', packed ? 'name=' + JSON.stringify(packed.name) : 'none');
  ok('FIX3 packed ally carries draw fields', packed && ['x', 'y', 'w', 'h', 'color', 'hp', 'maxHp'].every((k) => packed[k] != null), packed ? JSON.stringify(Object.keys(packed)) : 'none');
  B.x = A.x + 100; B.y = A.y;
  const snapB = JSON.parse(JSON.stringify(w.snapshotFor('B')));
  ok('FIX3 nearby player B also sees the ally', (snapB.allies || []).length >= 1, 'allies=' + (snapB.allies || []).length);

  const before = S.allies.length;
  for (const a of S.allies) a.life = 1;
  w.tick();
  ok('FIX3 expired allies pruned (no leak)', S.allies.length < before && S.allies.length === 0, 'before=' + before + ' after=' + S.allies.length);
}

// ---------------------------------------------------------------------------
// FIX 5 — dungeon-grid attach is transactional; resendMap re-sends for a delver
// ---------------------------------------------------------------------------
{
  S.allies = []; S.enemies.length = 0;
  A.map = 'overworld';
  A.x = S.dungeonEntrance.tx * TILE; A.y = S.dungeonEntrance.ty * TILE;   // the sole overworld dungeon entrance tile (read from state — robust to map resize)
  A.inventory.keys = (A.inventory.keys | 0) + 1;
  A.actions.push('interact');
  w.tick();
  ok('FIX5 setup: A entered the shared dungeon', A.map === 'dungeon' && !!w.sharedDg, 'A.map=' + A.map + ' sharedDg=' + !!w.sharedDg);

  const savedMd = w.sharedDg ? w.sharedDg.md : null;
  const sentBefore = A._sentDgN | 0, switchN = A._mapSwitchN | 0;
  if (w.sharedDg) w.sharedDg.md = null;
  const snapNoGrid = w.snapshotFor('A');
  ok('FIX5 no grid available → dgTiles NOT sent', !snapNoGrid.dgTiles, snapNoGrid.dgTiles ? 'present' : 'absent');
  ok('FIX5 flag left UNCONSUMED for retry (transactional)', (A._sentDgN | 0) === sentBefore && sentBefore !== switchN, '_sentDgN=' + A._sentDgN + ' _mapSwitchN=' + A._mapSwitchN);

  if (w.sharedDg) w.sharedDg.md = savedMd;
  const snapGrid = w.snapshotFor('A');
  ok('FIX5 grid restored → dgTiles now sent', !!snapGrid.dgTiles, snapGrid.dgTiles ? 'present' : 'absent');
  ok('FIX5 edge consumed after successful attach', (A._sentDgN | 0) === (A._mapSwitchN | 0), '_sentDgN=' + A._sentDgN + ' _mapSwitchN=' + A._mapSwitchN);

  const snapSteady = w.snapshotFor('A');
  ok('FIX5 steady state sends no dgTiles', !snapSteady.dgTiles, snapSteady.dgTiles ? 'present' : 'absent');

  w.resendMap('A');
  const snapResend = w.snapshotFor('A');
  ok('FIX5 resendMap re-attaches the grid for a delver', !!snapResend.dgTiles, snapResend.dgTiles ? 'present' : 'absent');
  ok('FIX5 resendMap re-consumes cleanly', (A._sentDgN | 0) === (A._mapSwitchN | 0), '_sentDgN=' + A._sentDgN);
}

// ---------------------------------------------------------------------------
// REGRESSION — 3 players, 300 ticks incl. a live dungeon delve, zero exceptions
// ---------------------------------------------------------------------------
{
  const D = w.addPlayer('D', 'Dax');           // A is in the dungeon; B & D roam the overworld
  D.x = 116 * TILE; D.y = 97 * TILE;
  B.x = 118 * TILE; B.y = 99 * TILE;
  S.allies.push({ x: B.x + 80, y: B.y, w: 22, h: 22, ally: true, _owner: 'B', name: 'Bound Brute', rank: 0, hp: 120, maxHp: 120, atk: 10, def: 2, color: '#9a70ff', attackCd: 0, life: 5000, wobble: 0 });
  try { const foe = G.makeWildEnemy(Math.floor(B.x / TILE) + 2, Math.floor(B.y / TILE)); if (foe) { foe.x = B.x + 90; foe.y = B.y; S.enemies.push(foe); } } catch (_e) {}
  let err = null, ticks = 0, sawDungeon = false;
  for (let i = 0; i < 300; i++) {
    if (i % 40 === 20) B.actions.push('attack');
    try { w.tick(); ticks++; } catch (e) { err = String(e && e.stack || e); break; }
    if (w.sharedDg) sawDungeon = true;
    try { for (const id of ['A', 'B', 'D']) { const p = w.players.get(id); if (p) JSON.parse(JSON.stringify(w.snapshotFor(id))); } } catch (e) { err = 'snapshot: ' + String(e && e.stack || e); break; }
  }
  ok('REGRESSION 300 ticks, zero exceptions', ticks === 300 && !err, 'ticks=' + ticks + (err ? ' err=' + err : ''));
  ok('REGRESSION a dungeon instance was live during the run', sawDungeon, 'sawDungeon=' + sawDungeon);
  ok('REGRESSION all positions finite', [A, B, D].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), '');
}

console.log('\n=== per-player-state fix verification ===');
for (const r of results) console.log('  ' + r);
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
