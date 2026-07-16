'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// combat-nerf-verify.js — the v2.56.3 combat nerfs. Drives the REAL game headlessly
// (server-spike/load-game.js + server/world.js), the proven ranged-verify.js recipe.
//
//   FIX 1  Ricochet collateral: search 12 tiles -> 7, bounce flight life 80 -> 50 (520px -> 325px)
//   FIX 2  Heat aura: tick damage HALVED, max radius 130px -> 96px
//   FIX 3  Heat aura must NEVER ignite tiles (applyElementOnHit opt.noIgnite) -> the caster
//          can no longer set himself on fire. Direct fire CASTS must still ignite.
//   FIX 4  Lifesteal 2.5%/point -> 1%/point (DERIVED in recalcStats; saves store the point count)
//
// NON-VACUOUS BY CONSTRUCTION: run this BEFORE the edit and the FIX-tagged assertions must FAIL
// and the measurements must show the old numbers. Run AFTER and they must pass with new numbers.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server-spike/load-game.js');
const { World } = require(REPO + '/server/world.js'); // requiring world.js runs G.startGame()
const S = G.state, TILE = G.TILE;

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };
const say = (s) => out.push(s);
const _rnd = Math.random;
const stubRnd = (v) => { Math.random = () => v; };
const unstub = () => { Math.random = _rnd; };

const solid = (tx, ty) => G.SOLID.has(G.getTile('overworld', tx, ty));
const burnable = (tx, ty) => { const t = G.getTile('overworld', tx, ty); return t === G.T.GRASS || t === G.T.FLOWER || t === G.T.PATH; };
// find a horizontal run of `len` tiles (plus 1 tile of margin above/below) where every tile passes `test`
function findRow(len, test) {
  const m = G.maps.overworld, H = m.length, W = m[0].length;
  for (let ty = 8; ty < H - 8; ty++) for (let tx = 8; tx < W - len - 10; tx++) {
    let good = true;
    for (let dx = -1; dx <= len && good; dx++) for (let dy = -1; dy <= 1 && good; dy++) if (!test(tx + dx, ty + dy)) { good = false; }
    if (good) return { tx, ty, x: tx * TILE, y: ty * TILE };
  }
  return null;
}
function equipStyle(style, element) {
  const p = S.player;
  S.inventory.weapons.forEach(w => w.equipped = false);
  const w = { name: 'T-' + style, atk: 30, style, element: element || null, rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true };
  S.inventory.weapons.push(w);
  G.recalcStats(); p._lastStyle = style;
  return w;
}
function foeAt(px, py, hp) {
  const e = G.makeWildEnemy(Math.floor(px / TILE), Math.floor(py / TILE)) || {};
  e.x = px; e.y = py; e.w = e.w || 24; e.h = e.h || 24;
  e.hp = e.maxHp = hp; e.def = 0; e.isBoss = false; e.stunT = 0; e.hitFlash = 0;
  e._markN = 0; e._markBy = undefined; e.xp = 0; e.gold = 0;
  e.fireImmune = false; e.frostImmune = false; e._afxN = 0;
  return e;
}
// a clean hero: nothing that could silently swallow damage (evasion/invuln/fort) or add collateral
function cleanHero(p) {
  p.crit = 0; p.berserk = 0; p.momentum = 0; p.evasion = 0; p.bonusEvasion = 0; p.fort = 0; p.bonusFort = 0;
  p.exec = 0; p.bonusExec = 0; p.invuln = 0; p.dodge = 0; p.blessT = 0; p.blessDR = 0; p.foodT = 0;
  p.uFrostNova = 0; p.uLance = 0; p.uBell = 0; p.uCloak = 0; p.camping = false; p.hp = p.maxHp = 500;
}

// ============================================================================
// FIX 1 — RICOCHET: how far from the struck foe does an un-aimed bystander die?
// ============================================================================
say('=== FIX 1 — Ricochet collateral reach ===');
const FIELD = findRow(20, (tx, ty) => !solid(tx, ty));
say('  open test field: tile (' + (FIELD ? FIELD.tx + ',' + FIELD.ty : 'NOT FOUND') + ') — 20 tiles of open ground');
let reach = { hitDists: [], maxHit: 0, ricoLife: 0, ricoReachPx: 0 };
(function ricochetReach() {
  const p = S.player; equipStyle('ranged', 'frost'); cleanHero(p);
  // prof 10 = Ricochet (MASTERY_LVLS[0]) ONLY. Deliberately NOT 24+: the tier-2 marked-kill
  // Deadeye burst is a SECOND area effect and would contaminate this measurement.
  p.prof.ranged = { lvl: 10, xp: 0 };
  p.x = FIELD.x; p.y = FIELD.y - 3 * TILE; p.w = p.w || 22; p.h = p.h || 22;
  stubRnd(0);
  for (let d = 1; d <= 16; d++) {
    // A = the foe I AIMED at. hp 1 -> it dies to the arrow, which is the real in-game case:
    // the bounce spawns inside A's rect, so it only ever flies free once A's corpse is spliced out.
    const A = foeAt(FIELD.x, FIELD.y, 1);
    const B = foeAt(FIELD.x + d * TILE, FIELD.y, 1e7); // the BYSTANDER: never aimed at, d tiles from A
    S.enemies = [A, B]; S.projectiles = [];
    const bHp0 = B.hp;
    G.addProjectile(A.x + A.w / 2, A.y + A.h / 2, 0, 0, 40, { friendly: true, kind: 'arrow', style: 'ranged', element: 'frost', ownerRef: p, pierce: 0, r: 5, life: 90 });
    let ricoSeen = null;
    for (let t = 0; t < 300 && S.projectiles.length; t++) {
      G.updateProjectiles(); S.time++;
      const r = S.projectiles.find(pr => pr.rico); if (r && !ricoSeen) ricoSeen = { life: r.life, spd: Math.hypot(r.vx, r.vy) };
    }
    const took = bHp0 - B.hp;
    if (took > 0) { reach.hitDists.push(d); reach.maxHit = Math.max(reach.maxHit, d); }
    if (ricoSeen && !reach.ricoLife) { reach.ricoLife = ricoSeen.life; reach.ricoReachPx = Math.round(ricoSeen.life * ricoSeen.spd); }
    say('   bystander ' + String(d).padStart(2) + ' tiles from the foe I shot: ' + (took > 0 ? 'TOOK ' + took + ' dmg  <-- collateral' : 'untouched'));
  }
  unstub();
  say('  --> furthest un-aimed bystander damaged: ' + reach.maxHit + ' tiles from the struck foe');
  say('  --> bounce arrow: life ' + reach.ricoLife + ' x ~6.5spd = ~' + reach.ricoReachPx + 'px of flight (' + (reach.ricoReachPx / TILE).toFixed(1) + ' tiles)');
})();
ok('[FIX 1] ricochet collateral stops at <= 7 tiles from the struck foe (was 12)', reach.maxHit > 0 && reach.maxHit <= 7, 'furthest collateral = ' + reach.maxHit + ' tiles');
ok('[FIX 1] ricochet still bounces to a NEARBY foe (regression: must not no-op again)', reach.hitDists.includes(1) && reach.hitDists.includes(5), 'hit at tiles: ' + reach.hitDists.join(','));
ok('[FIX 1] bounce flight cannot cross a room (<= 11 tiles of travel)', reach.ricoReachPx > 0 && reach.ricoReachPx <= 11 * TILE, reach.ricoReachPx + 'px vs ' + 11 * TILE + 'px');
ok('[FIX 1] bounce flight still REACHES the 7-tile search radius', reach.ricoReachPx >= 7 * TILE, reach.ricoReachPx + 'px vs ' + 7 * TILE + 'px');

// OBSERVATION (not a fix): the ranged tier-2 capstone (prof >= 24) marked-kill Deadeye burst.
say('\n--- observation: ranged prof >= 24 capstone burst (NOT part of this change) ---');
(function capstoneObserve() {
  const p = S.player; equipStyle('ranged', 'frost'); cleanHero(p);
  p.prof.ranged = { lvl: 24, xp: 0 }; p.atk = 40;
  stubRnd(0);
  const A = foeAt(FIELD.x, FIELD.y, 1);
  A._markBy = p; A._markN = 3;                        // a fully-marked foe about to die
  const ring = []; for (let d = 1; d <= 8; d++) ring.push({ d, e: foeAt(FIELD.x + d * TILE, FIELD.y, 1e7) });
  S.enemies = [A].concat(ring.map(r => r.e));
  const hp0 = new Map(S.enemies.map(e => [e, e.hp]));
  try { G.killEnemy(A); } catch (e) { say('  killEnemy threw: ' + e.message); }
  const hurt = ring.filter(r => hp0.get(r.e) - r.e.hp > 0);
  say('  a 3-mark kill at ranged prof 24 splashed ' + hurt.length + ' bystanders, out to ' + (hurt.length ? Math.max(...hurt.map(r => r.d)) : 0) + ' tiles (radius 70+26*marks = up to 148px)');
  say('  NOTE: that burst re-enters killEnemy for any foe it kills AND re-marks survivors -> it can cascade.');
  unstub();
})();

// ============================================================================
// FIX 2 — HEAT AURA: damage halved, field shrunk
// ============================================================================
say('\n=== FIX 2 — Heat aura damage + radius ===');
const aura = { dmgAtFull: 0, radiusMax: 0, radiusMin: 0, atk: 0 };
(function auraShape() {
  const p = S.player; equipStyle('magic', 'fire'); cleanHero(p);
  p.prof.magic = { lvl: 1, xp: 0 };
  p.x = FIELD.x; p.y = FIELD.y;
  p.heat = 100; p._lastStyle = 'magic'; p._heatCool = 999; // hot = 1.0 (full)
  G.recalcStats(); aura.atk = p.atk;
  stubRnd(0.99); // never roll a bonus effect
  // Probe the RADIUS empirically: a lone foe at distance r either ticks or does not.
  const auraHits = (px) => {
    const e = foeAt(FIELD.x + px, FIELD.y, 1e7); e.w = 2; e.h = 2; // a point-sized foe = exact radius probe
    e.x = p.x + p.w / 2 + px - 1; e.y = p.y + p.h / 2 - 1;
    S.enemies = [e]; const hp0 = e.hp;
    p._auraCd = 0; p.heat = 100; p._heatCool = 999;
    G.updatePlayer(); // the REAL seam: updatePlayer -> updateStyleResources -> updateHeatAura
    return { hit: hp0 - e.hp > 0, dmg: hp0 - e.hp };
  };
  let lo = 0, hi = 400; // binary-search the aura edge at full heat
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (auraHits(mid).hit) lo = mid; else hi = mid; }
  aura.radiusMax = Math.round(lo);
  const at0 = auraHits(1); aura.dmgAtFull = at0.dmg;
  // and at the aura threshold (heat 40 -> hot = 0)
  p.heat = 40; let lo2 = 0, hi2 = 400;
  const auraHits40 = (px) => { const r = (() => { const e = foeAt(FIELD.x + px, FIELD.y, 1e7); e.w = 2; e.h = 2; e.x = p.x + p.w / 2 + px - 1; e.y = p.y + p.h / 2 - 1; S.enemies = [e]; const hp0 = e.hp; p._auraCd = 0; p.heat = 40; p._heatCool = 999; G.updatePlayer(); return hp0 - e.hp > 0; })(); return r; };
  for (let i = 0; i < 24; i++) { const mid = (lo2 + hi2) / 2; if (auraHits40(mid)) lo2 = mid; else hi2 = mid; }
  aura.radiusMin = Math.round(lo2);
  unstub();
  const oldRaw = (1 + aura.atk * 0.12) * (0.5 + 1); // the pre-nerf formula at hot=1
  say('  player atk = ' + aura.atk);
  say('  aura tick damage at FULL heat: ' + aura.dmgAtFull + '   (pre-nerf formula gives ' + Math.max(1, Math.round(oldRaw)) + ')');
  say('  aura radius at FULL heat: ~' + aura.radiusMax + 'px = ' + (aura.radiusMax / TILE).toFixed(1) + ' tiles radius / ' + (aura.radiusMax * 2 / TILE).toFixed(1) + ' tiles ACROSS');
  say('  aura radius at the heat-40 threshold: ~' + aura.radiusMin + 'px = ' + (aura.radiusMin * 2 / TILE).toFixed(1) + ' tiles across');
  ok('[FIX 2] aura tick damage is exactly HALF the old formula', aura.dmgAtFull === Math.max(1, Math.round(oldRaw * 0.5)), aura.dmgAtFull + ' vs old ' + Math.max(1, Math.round(oldRaw)) + ' -> want ' + Math.max(1, Math.round(oldRaw * 0.5)));
  ok('[FIX 2] aura max radius shrunk to ~96px (was 130px)', Math.abs(aura.radiusMax - 96) <= 4, '~' + aura.radiusMax + 'px');
  ok('[FIX 2] aura still SCALES with heat (threshold field stays ~48px)', Math.abs(aura.radiusMin - 48) <= 4 && aura.radiusMax > aura.radiusMin, 'heat40=~' + aura.radiusMin + 'px -> heat100=~' + aura.radiusMax + 'px');
})();

// ============================================================================
// FIX 3 — the aura must never set its own caster on fire
// ============================================================================
say('\n=== FIX 3 — aura self-immolation (the acceptance test) ===');
// A tile only catches if it is burnable, non-solid AND outside a frozen biome — igniteTile's
// isFrozenTile/biomeMap gate is NOT captured, so we cannot test it directly. Instead PROBE each
// geometric candidate with a real direct fire CAST (projImpact -> igniteTile). The first row that
// actually lights is our test ground, and that probe IS the positive control for "a direct cast
// still ignites". Without this control the aura's "0 fires" result would be VACUOUS — the first
// run of this file found tile (8,8), frozen tundra, where nothing ever ignites and the aura test
// passed while testing nothing.
function findIgnitable() {
  const m = G.maps.overworld, H = m.length, W = m[0].length;
  const p = S.player; const cands = [];
  for (let ty = Math.floor(H / 2); ty < H - 10 && cands.length < 400; ty++) {
    for (let tx = 10; tx < W - 12 && cands.length < 400; tx++) {
      let good = true;
      for (let dx = -1; dx <= 6 && good; dx++) for (let dy = -1; dy <= 1 && good; dy++) if (!burnable(tx + dx, ty + dy) || solid(tx + dx, ty + dy)) good = false;
      if (good) { cands.push({ tx, ty, x: tx * TILE, y: ty * TILE }); tx += 8; }
    }
  }
  for (const c of cands) {
    S.map = 'overworld'; S.fires.length = 0; S.enemies = []; S.projectiles = [];
    G.addProjectile(c.x + 16, c.y + 16, 0, 0, 20, { friendly: true, kind: 'bolt', style: 'magic', element: 'fire', ownerRef: p, life: 1, r: 6 });
    G.updateProjectiles();
    const lit = S.fires.length; S.fires.length = 0;
    if (lit > 0) return { row: c, castLit: lit, tried: cands.length };
  }
  return { row: null, castLit: 0, tried: cands.length };
}
const IGN = findIgnitable();
say('  probed ' + IGN.tried + ' burnable rows; ground that a direct fire CAST actually lights: ' + (IGN.row ? 'tile (' + IGN.row.tx + ',' + IGN.row.ty + ')' : 'NONE FOUND'));
ok('[FIX 3] a direct fire CAST still ignites (POSITIVE CONTROL — unchanged behaviour)', IGN.castLit > 0, IGN.castLit + ' tile(s) lit by one cast');
(function selfBurn() {
  const p = S.player;
  const GRASS = IGN.row;
  if (!GRASS) { ok('[FIX 3] ignitable field found (else every result below is vacuous)', false); return; }
  S.map = 'overworld';
  equipStyle('magic', 'fire'); cleanHero(p);
  p.prof.magic = { lvl: 1, xp: 0 };
  p.x = GRASS.x; p.y = GRASS.y;
  p.heat = 100; p._lastStyle = 'magic'; p._heatCool = 99999;
  S.fires.length = 0; S.projectiles = [];
  // A foe in CONTACT with the caster — exactly what a chasing melee foe does. The aura ignites
  // the tile it stands on, which is the caster's own tile.
  const e = foeAt(GRASS.x, GRASS.y, 1e7);
  e.x = p.x; e.y = p.y;
  S.enemies = [e];
  stubRnd(0); // adversarial: 0 < 0.5+0.4*hot -> the ignite roll ALWAYS fires if it is reachable at all
  const hp0 = p.hp;
  for (let t = 0; t < 240; t++) {
    p.heat = 100; p._heatCool = 99999;          // hold the aura live
    e.x = p.x; e.y = p.y; e.hp = 1e7;           // the foe stays in contact
    G.updatePlayer();                            // -> updateStyleResources -> updateHeatAura -> applyElementOnHit
    G.updateFires();                             // -> playerTakeDamage(3) for anyone standing in fire
    S.time++;
  }
  const lost = hp0 - p.hp;
  unstub();
  say('  240 ticks radiating a FIRE aura with a foe in contact, standing on grass:');
  say('    tiles set alight by the aura: ' + S.fires.length);
  say('    HP the caster lost to his OWN aura: ' + lost);
  ok('[FIX 3] the aura ignites ZERO tiles (on ground a cast provably lights)', S.fires.length === 0, S.fires.length + ' fires');
  ok('[FIX 3] the caster takes ZERO self-damage from his own field', lost === 0, 'lost ' + lost + ' hp');
})();
// the burning foe must not spread fire back onto the caster either (the SECONDARY aura path:
// applyElementOnHit sets e.burnT -> tickEnemyStatus rolls igniteTile at 3.5%/frame while it burns)
(function auraBurnDoesNotSpread() {
  const p = S.player;
  const GRASS = IGN.row; if (!GRASS) return;
  S.map = 'overworld'; S.fires.length = 0; S.projectiles = [];
  equipStyle('magic', 'fire'); cleanHero(p);
  p.x = GRASS.x; p.y = GRASS.y; p.heat = 100; p._lastStyle = 'magic'; p._heatCool = 99999;
  const e = foeAt(GRASS.x, GRASS.y, 1e7); e.x = p.x; e.y = p.y; S.enemies = [e];
  stubRnd(0);
  p._auraCd = 0; G.updatePlayer();               // aura ticks -> applies burn to the foe
  const burned = e.burnT > 0;
  for (let t = 0; t < 120; t++) { e.hp = 1e7; try { G.updateEnemies && G.updateEnemies(); } catch (_e) {} S.time++; }
  unstub();
  say('  aura-applied burn on a foe: burnT=' + (e.burnT | 0) + ' (aura still burns foes: ' + burned + '); fires spread from that burn: ' + S.fires.length);
  ok('[FIX 3] the aura STILL burns foes (the nerf must not disarm it)', burned, 'burnT=' + (e.burnT | 0));
  ok('[FIX 3] an aura-applied burn does not spread fire back onto the caster', S.fires.length === 0, S.fires.length + ' fires');
  say('    (_burnNoSpread on the aura-burned foe = ' + e._burnNoSpread + ')');
  ok('[FIX 3] the aura tags its burn _burnNoSpread=1', e._burnNoSpread === 1, 'flag=' + e._burnNoSpread);
  S.fires.length = 0;
})();
// ...and a DIRECT cast on that same foe must re-arm the spread (the flag is not a one-way latch),
// while a foe that only ever met direct fire must never grow the field at all (packScalar sweeps
// every scalar onto the wire — a new per-enemy field would cost bytes x 66Hz x players forever).
(function flagClearsOnDirectCast() {
  const p = S.player;
  const GRASS = IGN.row; if (!GRASS) return;
  S.map = 'overworld'; S.fires.length = 0; S.projectiles = [];
  equipStyle('magic', 'fire'); cleanHero(p);
  p.x = GRASS.x; p.y = GRASS.y; p.heat = 100; p._lastStyle = 'magic'; p._heatCool = 99999;
  const e = foeAt(GRASS.x, GRASS.y, 1e7); e.x = p.x; e.y = p.y; S.enemies = [e];
  stubRnd(0);
  p._auraCd = 0; G.updatePlayer();                       // aura burn -> flag set
  const afterAura = e._burnNoSpread;
  // a direct fire bolt into the same foe (no opt) -> must clear the flag
  G.addProjectile(e.x + e.w / 2, e.y + e.h / 2, 0.1, 0, 20, { friendly: true, kind: 'bolt', style: 'magic', element: 'fire', ownerRef: p, life: 5, r: 6, pierce: 0 });
  for (let t = 0; t < 3 && S.projectiles.length; t++) G.updateProjectiles();
  const afterCast = e._burnNoSpread;
  // a virgin foe that only ever met a direct cast must not carry the field at all
  S.fires.length = 0; S.projectiles = [];
  const v = foeAt(GRASS.x + 2 * TILE, GRASS.y, 1e7); S.enemies = [v];
  G.addProjectile(v.x + v.w / 2, v.y + v.h / 2, 0.1, 0, 20, { friendly: true, kind: 'bolt', style: 'magic', element: 'fire', ownerRef: p, life: 5, r: 6, pierce: 0 });
  for (let t = 0; t < 3 && S.projectiles.length; t++) G.updateProjectiles();
  unstub();
  say('  aura-burned foe: flag ' + afterAura + ' -> after a DIRECT cast on it: ' + afterCast + ' | cast-only foe carries the field: ' + ('_burnNoSpread' in v));
  ok('[FIX 3] a direct cast on an aura-burned foe re-arms fire spread (not a one-way latch)', afterAura === 1 && afterCast === 0, afterAura + ' -> ' + afterCast);
  ok('[FIX 3] a cast-only foe never grows the _burnNoSpread field (no new bytes on the wire)', !('_burnNoSpread' in v), 'burnT=' + (v.burnT | 0) + ' field present=' + ('_burnNoSpread' in v));
  S.fires.length = 0;
})();

// ============================================================================
// FIX 4 — LIFESTEAL: 1% per point, derived, and existing characters self-correct
// ============================================================================
say('\n=== FIX 4 — Lifesteal 1%/point ===');
(function lifesteal() {
  const p = S.player;
  S.inventory.weapons.forEach(w => w.equipped = false);
  S.inventory.armor.forEach(a => a.equipped = false);
  const w = { name: 'Plain', atk: 10, style: 'melee', rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true };
  S.inventory.weapons.push(w);
  for (const n of [0, 1, 5, 10, 15]) {
    p.bonusLifesteal = n; G.recalcStats();
    ok('[FIX 4] ' + String(n).padStart(2) + ' point(s) -> ' + String(Math.round(p.lifesteal * 1000) / 10).padStart(4) + '% lifesteal (want ' + n + '%)', Math.abs(p.lifesteal - n * 0.01) < 1e-9, 'p.lifesteal=' + p.lifesteal);
  }
  // affix points count in the same pool
  p.bonusLifesteal = 5; w.affixes = [{ t: 'lifesteal', v: 3, label: 'x' }]; G.recalcStats();
  ok('[FIX 4] 5 skill points + a v:3 affix -> 8%', Math.abs(p.lifesteal - 0.08) < 1e-9, 'p.lifesteal=' + p.lifesteal);
  w.affixes = null;
  // THE OWNER'S CHARACTER: 12 points read 30% under the old 2.5%/point coefficient (it was CAPPED).
  p.bonusLifesteal = 12; G.recalcStats();
  const nowPct = Math.round(p.lifesteal * 1000) / 10;
  ok('[FIX 4] the existing "30% lifesteal" character (12 pts) now reads 12%', Math.abs(p.lifesteal - 0.12) < 1e-9, 'was 30% (capped) -> now ' + nowPct + '%');
  // ...and it self-corrects through the REAL save/load path (no migration: saves store the POINT count)
  const snap = G.snapshot();
  ok('[FIX 4] the save stores the POINT count, not the % (=> no migration needed)', snap.player.bonusLifesteal === 12 && snap.player.lifesteal === undefined, 'bonusLifesteal=' + snap.player.bonusLifesteal + ' lifesteal=' + snap.player.lifesteal);
  p.lifesteal = 0.30; // pretend a stale 30% is live in memory
  G.applySnapshot(snap);
  ok('[FIX 4] loading that save recomputes lifesteal to 12% (stale 30% is gone)', Math.abs(S.player.lifesteal - 0.12) < 1e-9, 'after load: ' + Math.round(S.player.lifesteal * 1000) / 10 + '%');
  // max reachable
  p.bonusLifesteal = 15; // the lifedrain skill cap (spendPoint refuses past 15)
  const bw = { name: 'Max', atk: 10, style: 'melee', rarity: 4, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true, affixes: [{ t: 'lifesteal', v: 3, label: 'x' }] };
  S.inventory.weapons.forEach(x => x.equipped = false); S.inventory.weapons.push(bw);
  const ba = { name: 'MaxA', def: 10, rarity: 4, equipped: true, dur: 1e6, durMax: 1e6, affixes: [{ t: 'lifesteal', v: 3, label: 'x' }] };
  S.inventory.armor.forEach(x => x.equipped = false); S.inventory.armor.push(ba);
  G.recalcStats();
  say('  MAX reachable: 15 skill pts (the lifedrain cap) + v:3 weapon affix + v:3 armor affix = ' + Math.round(p.lifesteal * 1000) / 10 + '%');
  say('  (the 30% cap in recalcStats is now a pure backstop — no legal build can reach it)');
  ok('[FIX 4] the 30% cap no longer binds a real build', p.lifesteal < 0.30, Math.round(p.lifesteal * 1000) / 10 + '%');
})();

// MP: the real persistence path must not re-inject a stale 30%. characterOf() saves via the
// game's snapshot() (point count only) and _loadCharacter() Object.assigns it then recalcStats().
// If that ever changed to persist the DERIVED %, an existing hero would be stranded at 30% forever.
say('\n=== FIX 4 (MP) — the room persists POINTS, not the % ===');
(function mpRoundTrip() {
  const w = new World();
  const a = w.addPlayer('LSA', 'Ava');
  a.bonusLifesteal = 12;                       // the owner's character: 12 pts == 30% under the old coefficient
  const pp = S.player, pi = S.inventory;
  S.player = a; S.inventory = a.inventory; G.recalcStats(); S.player = pp; S.inventory = pi;
  const ch = w.characterOf('LSA');
  ok('[FIX 4/MP] characterOf saves bonusLifesteal (points) and NOT the derived %', !!ch && ch.player.bonusLifesteal === 12 && ch.player.lifesteal === undefined, ch ? ('bonusLifesteal=' + ch.player.bonusLifesteal + ' lifesteal=' + ch.player.lifesteal) : 'no character');
  // a hero rejoining from the DB with that saved character
  const w2 = new World();
  const b = w2.addPlayer('LSB', 'Bo', ch);
  ok('[FIX 4/MP] a rejoining hero recomputes to 12% (no migration needed, nothing re-injects 30%)', Math.abs((b.lifesteal || 0) - 0.12) < 1e-9, 'rejoined at ' + Math.round((b.lifesteal || 0) * 1000) / 10 + '% (points=' + b.bonusLifesteal + ')');
})();

// ============================================================================
console.log(out.join('\n'));
console.log('\n' + (fail ? 'FAILED' : 'ALL GREEN') + ' — pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
