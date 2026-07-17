'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// camp-seeker-verify.js — FIX 1 (camp in dungeons/rifts, no shared-clock skip) + FIX 2 (Seeker Bolt:
// LOS-gated soft in-flight bend, not an aimbot). Drives the REAL game headlessly (load-game) + an MP World.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game.js');
const { World } = require(REPO + '/server/world.js');   // requiring world.js runs G.startGame()
const S = G.state;
const TILE = G.TILE;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };
const approx = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clearKeys = () => { for (const k in G.keys) delete G.keys[k]; };

// A fully controlled walkable dungeon arena (D_FLOOR=10 floor, D_WALL=11 solid border) for exact LOS control.
function buildArena(w, h) { const F = G.T.D_FLOOR, Wl = G.T.D_WALL; const grid = []; for (let y = 0; y < h; y++) { const row = []; for (let x = 0; x < w; x++) row.push((x === 0 || y === 0 || x === w - 1 || y === h - 1) ? Wl : F); grid.push(row); } G.maps.dungeon = grid; return grid; }
function foeAt(px, py) { const e = G.makeWildEnemy(2, 2) || {}; e.x = px; e.y = py; e.w = e.w || 24; e.h = e.h || 24; e.hp = e.maxHp = 1e7; e.def = 0; e.isBoss = false; e.stunT = 0; e.hitFlash = 0; e.xp = 0; e.gold = 0; e._markN = 0; e._markBy = undefined; return e; }
function equipMagic(lvl) { const p = S.player; S.inventory.weapons.forEach(w => w.equipped = false); const w = { name: 'T-staff', atk: 30, style: 'magic', rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true }; S.inventory.weapons.push(w); G.recalcStats(); p._lastStyle = 'magic'; p.prof.magic.lvl = lvl; }

buildArena(60, 40);

// ============================================================================
// FIX 1 — CAMP IN DUNGEONS (SP)
// ============================================================================
out.push('=== FIX 1 — camp in dungeons (SP) ===');
(function campDungeon() {
  const p = S.player; S.map = 'dungeon'; S.enemies = []; clearKeys();
  p.camping = false; p.campHealLeft = 0; p.x = 20 * TILE; p.y = 20 * TILE; p.hp = 40; p.maxHp = 200; p.energy = 10; p.maxEnergy = 100; p.chillT = 30;
  // v2.56.5: make the hero GENUINELY unrested first. The old setup camped on a fresh world where
  // curDay()===lastRestDay===1, so "lastRestDay unchanged" was TRIVIALLY true and this block passed
  // with EITHER behavior — which is exactly why it never caught the dungeon-camp Exhausted bug.
  S.time = 6 * 21600 + Math.floor(21600 * 0.45); p.lastRestDay = 1;   // day 7, last rested day 1 → Exhausted (P2/S7: lastRestDay lives ON the player)
  const t0 = S.time, rest0 = p.lastRestDay;
  ok('dungeon: precondition — hero IS Exhausted before camping', G.isExhausted() === true, 'daysSinceRest=' + (G.curDay() - p.lastRestDay));
  G.doCamp();
  ok('dungeon: doCamp sets camping=true', p.camping === true);
  ok('dungeon: campHealLeft > 0 (~35% maxHp)', p.campHealLeft > 0 && approx(p.campHealLeft, Math.round(p.maxHp * 0.35), 1), 'campHealLeft=' + p.campHealLeft);
  ok('dungeon: state.time UNCHANGED (no shared-clock skip)', S.time === t0, 't0=' + t0 + ' now=' + S.time);
  ok('dungeon: lastRestDay RECORDED as today → CLEARS Exhausted', p.lastRestDay === G.curDay() && p.lastRestDay !== rest0 && G.isExhausted() === false, 'rest0=' + rest0 + ' now=' + p.lastRestDay + ' curDay=' + G.curDay() + ' exhausted=' + G.isExhausted());
  ok('dungeon: energy restored + chill cleared', p.energy === p.maxEnergy && p.chillT === 0, 'energy=' + p.energy + ' chill=' + p.chillT);
  // heal over time via tickCampRest inside updatePlayer
  const hp0 = p.hp; let threw = null; try { for (let i = 0; i < 240; i++) G.updatePlayer(); } catch (e) { threw = String(e); }
  ok('dungeon: updatePlayer heals over time (tickCampRest underground)', threw === null && p.hp > hp0, threw || ('hp ' + hp0 + '→' + p.hp));
})();

out.push('\n=== FIX 1 — dungeon camp refuses near foes ===');
(function campRefuse() {
  const p = S.player; S.map = 'dungeon'; clearKeys();
  p.camping = false; p.campHealLeft = 0; p.x = 20 * TILE; p.y = 20 * TILE; p.hp = 40; p.maxHp = 200;
  const foe = foeAt(p.x + 150, p.y);   // 150px < 210px danger radius
  S.enemies = [foe];
  const t0 = S.time; G.doCamp();
  ok('dungeon: refuses to camp with a foe within 210px', p.camping === false, 'camping=' + p.camping);
  ok('dungeon: refused camp leaves the clock untouched', S.time === t0);
  // foe just outside 210 → allowed
  foe.x = p.x + 260; foe.y = p.y; S.enemies = [foe]; p.camping = false;
  G.doCamp();
  ok('dungeon: camps when the foe is beyond 210px', p.camping === true);
  S.enemies = [];
})();

out.push('\n=== FIX 1 — overworld camp UNCHANGED (time-skip + lastRestDay) ===');
(function campOverworld() {
  const p = S.player; S.map = 'overworld';
  // put the hero on open overworld ground with no foes near
  const m = G.maps.overworld, Hh = m.length, Ww = m[0].length, solid = (tx, ty) => G.SOLID.has(G.getTile('overworld', tx, ty));
  let spot = null; for (let ty = Math.floor(Hh / 2); ty < Hh - 3 && !spot; ty++) for (let tx = 6; tx < Ww - 6; tx++) { if (!solid(tx, ty) && !solid(tx + 1, ty) && !solid(tx, ty + 1)) { spot = { x: tx * TILE, y: ty * TILE }; break; } }
  p.x = spot.x; p.y = spot.y; p.camping = false; p.campHealLeft = 0; p.hp = 40; p.maxHp = 200; S.enemies = []; clearKeys();
  const t0 = S.time, day0 = G.curDay();
  G.doCamp();
  ok('overworld: doCamp still FAST-FORWARDS the clock', S.time > t0, 't0=' + t0 + ' now=' + S.time);
  ok('overworld: doCamp still sets lastRestDay = the (skipped) day', p.lastRestDay === G.curDay(), 'lastRestDay=' + p.lastRestDay + ' curDay=' + G.curDay());
  ok('overworld: camping=true + campHealLeft set', p.camping === true && p.campHealLeft > 0);
})();

// ============================================================================
// FIX 1 (MP) — the world.js doCamp RPC handler recognizes a DUNGEON camp
// ============================================================================
out.push('\n=== FIX 1 (MP) — world.js doCamp handler ===');
(function mpCamp() {
  S.enemies = []; S.projectiles = []; S.allies = []; S.pickups = []; S.companions = [];
  const w = new World();
  const A = w.addPlayer('A', 'Ava');
  // --- DUNGEON camp via the real RPC path ---
  // v2.56.5: A must be GENUINELY unrested, or "rest recorded" is vacuous. The overworld block above
  // already camped this hero to day 8, so without this reset A.lastRestDay would ALREADY equal curDay().
  S.time = 6 * 21600 + Math.floor(21600 * 0.45); A.lastRestDay = 1;   // day 7, last rested day 1 → Exhausted
  S.player = A; S.inventory = A.inventory; S.map = 'dungeon'; S.enemies = [];
  A.camping = false; A.campHealLeft = 0; A.hp = 30; A.maxHp = 200; A.energy = 5; A.maxEnergy = 100; A._exWas = true; A.x = 20 * TILE; A.y = 20 * TILE;
  const t0 = S.time, aRest0 = A.lastRestDay;
  let threw = null; try { w._runRpc({ rpc: 'doCamp', args: [] }, A); } catch (e) { threw = String(e && e.stack || e); }
  ok('MP dungeon: _runRpc doCamp runs without throwing', threw === null, threw || 'clean');
  ok('MP dungeon: handler recognizes the camp (camping flag) → camping=true', A.camping === true);
  ok('MP dungeon: world clock NEVER jumps (S.time unchanged)', S.time === t0, 't0=' + t0 + ' now=' + S.time);
  ok('MP dungeon: rest RECORDED on the hero (P2/S7: doCamp writes state.player.lastRestDay — the RPC runs under the hero pin; clears Exhausted)', A.lastRestDay === G.curDay() && A.lastRestDay !== aRest0, 'p=' + A.lastRestDay + ' curDay=' + G.curDay() + ' was=' + aRest0);
  ok('MP dungeon: personal fatigue flag cleared (energy restored)', A._exWas === false && A.energy === A.maxEnergy, '_exWas=' + A._exWas + ' energy=' + A.energy);
  // --- OVERWORLD camp via the real RPC path (regression: clock restored, lastRestDay = un-skipped day) ---
  S.map = 'overworld'; S.enemies = [];
  const m = G.maps.overworld, Hh = m.length, Ww = m[0].length, solid = (tx, ty) => G.SOLID.has(G.getTile('overworld', tx, ty));
  let spot = null; for (let ty = Math.floor(Hh / 2); ty < Hh - 3 && !spot; ty++) for (let tx = 6; tx < Ww - 6; tx++) { if (!solid(tx, ty) && !solid(tx + 1, ty) && !solid(tx, ty + 1)) { spot = { x: tx * TILE, y: ty * TILE }; break; } }
  A.x = spot.x; A.y = spot.y; A.camping = false; A.campHealLeft = 0; A.hp = 30;
  const t1 = S.time, expectDay = G.curDay();   // the un-skipped day
  let threw2 = null; try { w._runRpc({ rpc: 'doCamp', args: [] }, A); } catch (e) { threw2 = String(e && e.stack || e); }
  ok('MP overworld: _runRpc doCamp runs without throwing', threw2 === null, threw2 || 'clean');
  ok('MP overworld: world clock is RESTORED to t0 (the nap never jumps the shared day)', S.time === t1, 't1=' + t1 + ' now=' + S.time);
  ok('MP overworld: lastRestDay recomputed against the UN-skipped clock (on the hero)', A.lastRestDay === expectDay, 'lastRestDay=' + A.lastRestDay + ' expect=' + expectDay);
  ok('MP overworld: camping=true', A.camping === true);
})();

// ============================================================================
// FIX 2 — SEEKER BOLT: LOS-gated soft in-flight bend (SP)
// ============================================================================
out.push('\n=== FIX 2 — Seeker Bolt (SP) ===');
(function seeker() {
  const p = S.player; S.map = 'dungeon'; clearKeys();
  p.map = 'dungeon';   // P2/S16: the MP block above put a roster hero on state.players, and updateProjectiles is world-scoped now (the parked-shots rule lives IN the sim) — an acting hero not tagged into the probed world would leave these bolts parked instead of stepped
  p.camping = false; p.campHealLeft = 0; p.x = 20 * TILE; p.y = 20 * TILE; p.w = 22; p.h = 22;
  p.energy = 1000; p.maxEnergy = 1000; p.heat = 0;
  const cast = () => { S.projectiles = []; p.attackCooldown = 0; p.energy = 1000; p.dir = 'right'; clearKeys(); G.tryAttack(); return S.projectiles[0]; };

  // ---- (1) clear LOS: seek target set, but the bolt still FIRES ALONG AIM (east), not snapped to the SE foe ----
  equipMagic(10);   // hasPerk('magic',0): MASTERY_LVLS[0]=10
  const seFoe = foeAt(p.x + 4 * TILE, p.y + 4 * TILE);   // south-east, ~181px, clear LOS
  S.enemies = [seFoe];
  let pr = cast();
  ok('perk + clear LOS: bolt gets a seek target (the SE foe)', !!pr && pr.seek === seFoe, pr ? ('seek=' + (pr.seek === seFoe)) : 'no bolt');
  ok('aim UNCHANGED: bolt fires due-east (vy~0, vx>0) — NOT snapped at the 45° foe', !!pr && pr.vx > 0 && approx(pr.vy, 0, 1e-6), pr ? ('vx=' + pr.vx.toFixed(2) + ' vy=' + pr.vy.toFixed(2)) : 'n/a');

  // ---- (2) in-flight bend toward a due-NORTH foe: angle-to-target shrinks, per-frame turn is CAPPED, speed preserved ----
  equipMagic(10);
  const nFoe = foeAt(p.x, p.y - 6 * TILE);   // due north, 192px
  S.enemies = [nFoe];
  pr = cast();
  ok('perk: north foe selected as seek target', !!pr && pr.seek === nFoe);
  const spd0 = Math.hypot(pr.vx, pr.vy);
  const diffs = [], deltas = []; let speedDrift = 0, prevAng = Math.atan2(pr.vy, pr.vx);
  for (let i = 0; i < 14; i++) {
    G.updateProjectiles();
    if (!S.projectiles.length) break;
    const q = S.projectiles[0];
    const velAng = Math.atan2(q.vy, q.vx);
    deltas.push(Math.abs(norm(velAng - prevAng))); prevAng = velAng;
    diffs.push(Math.abs(norm(Math.atan2((nFoe.y + nFoe.h / 2) - q.y, (nFoe.x + nFoe.w / 2) - q.x) - velAng)));
    speedDrift = Math.max(speedDrift, Math.abs(Math.hypot(q.vx, q.vy) - spd0));
  }
  ok('bend: angle-to-target DECREASES over flight (curves toward the foe)', diffs.length > 3 && diffs[diffs.length - 1] < diffs[0] - 0.15, 'diff ' + diffs[0].toFixed(3) + '→' + diffs[diffs.length - 1].toFixed(3));
  ok('bend is CAPPED: no per-frame turn exceeds ~0.12 rad (not an instant lock)', Math.max(...deltas) <= 0.12 + 1e-6, 'maxTurn/frame=' + Math.max(...deltas).toFixed(4));
  ok('bend PRESERVES speed (renormalized)', speedDrift < 1e-3, 'maxSpeedDrift=' + speedDrift.toExponential(2));

  // ---- (3) a foe directly BEHIND you (180° off-axis) can be MISSED: after 1 frame the bolt is still ~east ----
  equipMagic(10);
  const backFoe = foeAt(p.x - 5 * TILE, p.y);   // due west, behind an east aim
  S.enemies = [backFoe];
  pr = cast();
  const preAng = Math.atan2(pr.vy, pr.vx);
  G.updateProjectiles();
  const q3 = S.projectiles[0];
  ok('180°-off foe: bolt does NOT snap around — 1-frame turn ≤ cap (still ~east, missable)', !!q3 && Math.abs(norm(Math.atan2(q3.vy, q3.vx) - preAng)) <= 0.12 + 1e-6 && q3.vx > 0, q3 ? ('turn=' + Math.abs(norm(Math.atan2(q3.vy, q3.vx) - preAng)).toFixed(4) + ' vx=' + q3.vx.toFixed(2)) : 'n/a');

  // ---- (4) WALL between you and the (nearer) foe blocks target SELECTION; a farther CLEAR foe is chosen instead ----
  equipMagic(10);
  const arena = G.maps.dungeon; const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
  const savedTile = arena[pty][ptx + 2]; arena[pty][ptx + 2] = G.T.D_WALL;   // wall 2 tiles east
  const walledNear = foeAt(p.x + 3 * TILE, p.y);           // nearer (96px) but behind the wall
  const openFar = foeAt(p.x, p.y - 5 * TILE);              // farther (160px) but clear LOS (north)
  S.enemies = [walledNear, openFar];
  pr = cast();
  ok('wall blocks the nearer foe: seek picks the farther CLEAR-LOS foe (not the walled one)', !!pr && pr.seek === openFar, pr ? ('seek=openFar? ' + (pr.seek === openFar) + ' walled? ' + (pr.seek === walledNear)) : 'n/a');
  // only the walled foe present → NO seek target at all (walls block selection)
  S.enemies = [walledNear];
  pr = cast();
  ok('only-walled foe: NO seek target (bolt flies straight where aimed)', !!pr && pr.seek === null, pr ? ('seek=' + pr.seek) : 'n/a');
  arena[pty][ptx + 2] = savedTile;   // restore the arena

  // ---- (5) in-flight LOS LOSS: a wall dropped across the bolt→target line drops the seek on the throttled recheck ----
  equipMagic(10);
  const losFoe = foeAt(p.x + 8 * TILE, p.y); S.enemies = [losFoe];
  pr = cast();
  ok('setup: clear-LOS bolt is seeking', !!pr && pr.seek === losFoe);
  pr.vx = 1; pr.vy = 0; pr.life = 60;   // creep east (stay on floor) with life%6===0 so the LOS recheck fires
  arena[pty][ptx + 4] = G.T.D_WALL;     // wall now sits between the bolt and the target
  G.updateProjectiles();
  ok('in-flight: seek DROPPED when a wall breaks LOS (throttled recheck), bolt survives on its floor tile', S.projectiles.length && S.projectiles[0].seek === null, S.projectiles.length ? ('seek=' + S.projectiles[0].seek) : 'bolt gone');
  arena[pty][ptx + 4] = G.T.D_FLOOR;

  // ---- (6) NO PERK: fires exactly at dirVec, never seeks ----
  equipMagic(9);   // below MASTERY_LVLS[0]=10
  const anyFoe = foeAt(p.x + 3 * TILE, p.y + 3 * TILE); S.enemies = [anyFoe];
  pr = cast();
  ok('no perk (prof 9): NO seek target', !!pr && pr.seek === null, pr ? ('seek=' + pr.seek) : 'n/a');
  ok('no perk: bolt fires exactly along aim (east)', !!pr && pr.vx > 0 && approx(pr.vy, 0, 1e-6), pr ? ('vx=' + pr.vx.toFixed(2) + ' vy=' + pr.vy.toFixed(2)) : 'n/a');

  // ---- (7) perk + NO enemy in range/LOS: no seek, straight ----
  equipMagic(10); S.enemies = [];
  pr = cast();
  ok('perk but no foe: NO seek target (straight shot)', !!pr && pr.seek === null);
  p.map = 'overworld';   // restore the roster tag for the MP block below (its partyIn roster is overworld-scoped)
})();

// ============================================================================
// FIX 2 (MP) — pr.seek OBJECT ref never serializes onto the wire
// ============================================================================
out.push('\n=== FIX 2 (MP) — pr.seek never serializes ===');
(function mpSeek() {
  S.enemies = []; S.projectiles = []; S.allies = []; S.pickups = []; S.companions = [];
  const w = new World();
  const B = w.addPlayer('B', 'Bo');
  S.map = 'overworld';
  // give B a magic staff + the Seeker perk, stand a foe just off B's aim with clear LOS on open ground
  const m = G.maps.overworld, Hh = m.length, Ww = m[0].length, solid = (tx, ty) => G.SOLID.has(G.getTile('overworld', tx, ty));
  let spot = null; for (let ty = Math.floor(Hh / 2); ty < Hh - 3 && !spot; ty++) for (let tx = 8; tx < Ww - 8; tx++) { let good = true; for (let dx = -1; dx <= 4 && good; dx++) for (let dy = -1; dy <= 4; dy++) if (solid(tx + dx, ty + dy)) { good = false; break; } if (good) spot = { x: tx * TILE, y: ty * TILE }; }
  B.x = spot.x; B.y = spot.y;
  B.inventory.weapons.forEach(x => x.equipped = false); B.inventory.weapons.push({ name: 'MP-staff', atk: 30, style: 'magic', rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true });
  B.prof.magic.lvl = 12; B.energy = 1000; B.maxEnergy = 1000; B._lastStyle = 'magic';
  const foe = foeAt(B.x + 2 * TILE, B.y + TILE); S.enemies = [foe];
  let threw = null, everSeeking = false;
  try {
    for (let i = 0; i < 12; i++) {
      foe.x = B.x + 2 * TILE; foe.y = B.y + TILE; foe.hp = foe.maxHp = 1e7; foe.stunT = 0;
      B.held = {}; B.dir = 'right'; B.actions.push('attack'); w.tick();
      if (S.projectiles.some(pr => pr.seek && typeof pr.seek === 'object')) everSeeking = true;
    }
  } catch (e) { threw = String(e && e.stack || e); }
  ok('MP: 12 magic-combat ticks (Seeker perk), no throw', threw === null, threw || 'clean');
  ok('MP: at least one server-side bolt actually carried a pr.seek OBJECT ref', everSeeking === true);
  const snap = w.snapshotFor('B');
  const projs = snap.proj || [];
  ok('MP: the wire snapshot includes the in-flight bolt(s)', projs.length > 0, 'proj=' + projs.length);
  ok('MP: NO projectile on the wire carries an OBJECT-typed seek (packScalar drops it)', projs.every(pr => pr.seek == null || typeof pr.seek !== 'object'), 'objects=' + projs.filter(pr => pr.seek && typeof pr.seek === 'object').length);
})();

console.log(out.join('\n'));
console.log('\n' + (fail === 0 ? '  ✅ ' : '  ❌ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
