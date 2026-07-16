'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// ranged-verify.js — the RANGED rework (Ricochet fix / visible Marks / Deadeye feedback / late burst).
// Drives the REAL game headlessly (server-spike/load-game) then an MP World, like style-verify.js.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server-spike/load-game.js');
const { World } = require(REPO + '/server/world.js');   // requiring world.js runs G.startGame()
const S = G.state;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };
const approx = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.001 : tol);
const TILE = G.TILE;
function foeAt(px, py) { const e = G.makeWildEnemy(Math.floor(px / TILE), Math.floor(py / TILE)) || {}; e.x = px; e.y = py; e.w = e.w || 24; e.h = e.h || 24; e.hp = e.maxHp = 1e7; e.def = 0; e.isBoss = false; e.stunT = 0; e.hitFlash = 0; e._markN = 0; e._markBy = undefined; e.xp = 0; e.gold = 0; return e; }
function equipStyle(style) { const p = S.player; S.inventory.weapons.forEach(w => w.equipped = false); const w = { name: 'T-' + style, atk: 30, style, rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true }; S.inventory.weapons.push(w); G.recalcStats(); p._lastStyle = style; }
let _rnd = Math.random; const stubRnd = (v) => { Math.random = () => v; }; const unstub = () => { Math.random = _rnd; };
function openField() { const m = G.maps.overworld, H = m.length, W = m[0].length, solid = (tx, ty) => G.SOLID.has(G.getTile('overworld', tx, ty)); for (let ty = Math.floor(H / 2); ty < H - 3; ty++) for (let tx = 6; tx < W - 16; tx++) { let good = true; for (let dy = 0; dy <= 1 && good; dy++) for (let dx = -1; dx <= 13; dx++) if (solid(tx + dx, ty + dy)) { good = false; break; } if (good) return { x: tx * TILE, y: ty * TILE }; } return { x: 100 * TILE, y: 100 * TILE }; }
const FIELD = openField();

// ============================================================================
// FIX A — RICOCHET (root cause: 5.3-tile radius too tight → silent no-op)
// ============================================================================
out.push('=== FIX A — Ricochet ===');
(function ricochet() {
  const p = S.player; equipStyle('ranged'); p.crit = 0; p.berserk = 0; p.momentum = 0; p.hp = p.maxHp = 500;
  p.x = FIELD.x; p.y = FIELD.y; p.w = p.w || 22; p.h = p.h || 22;
  stubRnd(0);
  // A bounce fires iff, after the arrow hits A (0-vel arrow spawned on A's open tile), a rico:true arrow now exists.
  const bounceFires = (A) => { S.projectiles = []; G.addProjectile(A.x + A.w / 2, A.y + A.h / 2, 0, 0, 40, { friendly: true, kind: 'arrow', style: 'ranged', element: null, ownerRef: p, pierce: 0, r: 5, life: 90 }); G.updateProjectiles(); return S.projectiles.some(pr => pr.rico); };
  const A = foeAt(FIELD.x, FIELD.y);
  const B6 = foeAt(FIELD.x + 6 * TILE, FIELD.y);   // 6 tiles east: beyond the OLD 5.3-tile (170px) cap that silently no-op'd, still within the 7-tile cap
  p.prof.ranged.lvl = 10;   // Ricochet unlocked (MASTERY_LVLS[0]=10)
  S.enemies = [A, B6];
  ok('bounce FIRES for a 2nd foe at 6 tiles (old 170px cap silently failed here)', bounceFires(A) === true);
  S.enemies = [A];
  ok('bounce cleanly NO-OPs when there is no valid 2nd foe', bounceFires(A) === false);
  const Bfar = foeAt(FIELD.x + 6 * TILE, FIELD.y);   // in range, but perk not yet earned
  p.prof.ranged.lvl = 9; S.enemies = [A, Bfar];
  ok('no bounce below the Ricochet unlock (ranged prof 9 < 10)', bounceFires(A) === false);
  p.prof.ranged.lvl = 10; S.enemies = [A, Bfar];
  const bounced = bounceFires(A); const rico = S.projectiles.find(pr => pr.rico);
  ok('the bounce arrow carries rico:true, 60% dmg, and the shooter as ownerRef', bounced && rico && rico.rico === true && rico.ownerRef === p && approx(rico.dmg, Math.round(40 * 0.6), 1), rico ? ('dmg=' + rico.dmg + ' owner=' + (rico.ownerRef === p)) : 'no rico arrow');
  // reach: 6.5spd * 50life = 325px. It must COVER the 7-tile (224px) search cap so a bounce actually
  // ARRIVES, and must stay BOUNDED so it cannot cross a room. (Updated for v2.56.3: this assertion
  // used to demand reach >= 12*TILE, encoding v2.53.1's 12-tile search + 520px flight — that pairing
  // is the regression we just removed, so the old bound now asserts the bug. The INTENT is unchanged:
  // the bounce must reach whatever the search can pick, and no further.)
  ok('bounce arrow reach covers the 7-tile search radius but cannot cross a room', rico && rico.life * 6.5 >= 7 * TILE && rico.life * 6.5 <= 11 * TILE, rico ? ('reach=' + (rico.life * 6.5) + 'px vs search=' + (7 * TILE) + 'px, room-cap=' + (11 * TILE) + 'px') : 'n/a');
  unstub();
})();

// ============================================================================
// FIX (regression) — Marks stack + marker-only bonus dmg UNCHANGED
// ============================================================================
out.push('\n=== Marks: stack + marker-only bonus (unchanged) ===');
(function marks() {
  const p = S.player; equipStyle('ranged'); p.crit = 0; p.berserk = 0; p.momentum = 0; p.prof.ranged.lvl = 1;
  const bx = FIELD.x, by = FIELD.y; p.x = bx; p.y = by;
  stubRnd(0);
  const mx = bx + 5 * TILE, my = by;
  const e = foeAt(mx, my); S.enemies = [e];
  const shoot = (owner, dmg) => { e.x = mx; e.y = my; e.hp = 1e7; G.addProjectile(mx + e.w / 2, my + e.h / 2, 0, 0, dmg, { friendly: true, kind: 'arrow', style: 'ranged', element: null, ownerRef: owner, pierce: 0, r: 5, life: 90 }); const h0 = e.hp; G.updateProjectiles(); return h0 - e.hp; };
  const d1 = shoot(p, 40), m1 = e._markN, d2 = shoot(p, 40), m2 = e._markN, d3 = shoot(p, 40), m3 = e._markN, d4 = shoot(p, 40), m4 = e._markN;
  ok('marks stack 1→2→3 and cap at 3', m1 === 1 && m2 === 2 && m3 === 3 && m4 === 3, [m1, m2, m3, m4].join(','));
  ok('1st hit no bonus; later hits +15%/stack', d1 === 40 && approx(d2, 46) && approx(d3, 52) && approx(d4, 58), [d1, d2, d3, d4].join(','));
  const Bpl = { x: bx, y: by, w: p.w, h: p.h, crit: 0, berserk: 0, momentum: 0, hp: 100, maxHp: 100, atk: 1, exec: 0, lifesteal: 0, prof: { melee: { lvl: 1 }, ranged: { lvl: 1 }, magic: { lvl: 1 } }, _lastMarkN: 0, _markShowT: 0 };
  const dB = shoot(Bpl, 40);
  ok('another shooter gets NO bonus & reseeds ownership to itself', dB === 40 && e._markBy === Bpl && e._markN === 1, 'dmgB=' + dB + ' ownerIsB=' + (e._markBy === Bpl));
  unstub();
})();

// ============================================================================
// FIX C — DEADEYE: +0.30 crit >8 tiles still applies (feedback added, math intact)
// ============================================================================
out.push('\n=== FIX C — Deadeye range crit ===');
(function deadeye() {
  const p = S.player; equipStyle('ranged'); p.crit = 0; p.berserk = 0; p.momentum = 0; p.prof.ranged.lvl = 1;
  const bx = FIELD.x, by = FIELD.y; p.x = bx; p.y = by;
  stubRnd(0.2);   // base crit 0 → 0.2<0 false; Deadeye +0.30 → 0.2<0.30 true
  const e = foeAt(bx + 4 * TILE, by); e.def = 0;
  const shootFrom = (ex, ey) => { e.x = ex; e.y = ey; e.hp = 1e7; e._markN = 0; e._markBy = undefined; S.enemies = [e]; G.addProjectile(ex + e.w / 2, ey + e.h / 2, 0, 0, 40, { friendly: true, kind: 'arrow', style: 'ranged', element: null, ownerRef: p, pierce: 0, r: 5, life: 90 }); const h0 = e.hp; G.updateProjectiles(); return h0 - e.hp; };
  const dFar = shootFrom(bx + 9 * TILE, by);   // ~9 tiles from shooter → Deadeye
  const dNear = shootFrom(bx + 4 * TILE, by);  // ~4 tiles → no Deadeye
  ok('far (>8t) shot crits (~2x), mid-range does not — feedback add did not change the math', approx(dFar, dNear * 2, 2) && dFar > dNear, 'far=' + dFar + ' near=' + dNear);
  let threw = null; try { stubRnd(0); shootFrom(bx + 9 * TILE, by); } catch (ex) { threw = String(ex); }   // exercise the DEADEYE! callout/burst/tone path headlessly
  ok('the Deadeye feedback path runs headless without throwing', threw === null, threw || 'clean');
  unstub();
})();

// ============================================================================
// FIX D — marked-kill: EARLY single transfer (<24) vs LATE Deadeye BURST (>=24)
// ============================================================================
out.push('\n=== FIX D — kill-chain gated at ranged 24 ===');
(function killchain() {
  const p = S.player; equipStyle('ranged'); p.crit = 0; p.atk = 30;
  const cx = FIELD.x + 5 * TILE, cy = FIELD.y;
  const mkCorpse = (markN) => { const c = foeAt(cx, cy); c._markN = markN; c._markBy = p; c.hp = 1; return c; };
  const nb = (dx, dy) => { const n = foeAt(cx + dx, cy + dy); n.hp = n.maxHp = 1e7; n._markN = 0; n._markBy = undefined; return n; };

  // EARLY (prof 23): ONE mark to the nearest foe, NO area damage
  p.prof.ranged.lvl = 23;
  let near = nb(1.5 * TILE, 0), far = nb(0, 3 * TILE), c = mkCorpse(3);
  S.enemies = [c, near, far]; G.killEnemy(c);
  ok('EARLY (23): marked kill deals NO area damage', near.hp === 1e7 && far.hp === 1e7, 'near=' + near.hp + ' far=' + far.hp);
  const earlyMarks = (near._markN >= 1 ? 1 : 0) + (far._markN >= 1 ? 1 : 0);
  ok('EARLY (23): transfers exactly ONE mark, to the nearest foe', earlyMarks === 1 && near._markN >= 1 && near._markBy === p, 'markedCount=' + earlyMarks + ' nearOwned=' + (near._markBy === p));

  // LATE (prof 24 = Double Nock capstone): Deadeye BURST — AoE + mark spread to MANY
  p.prof.ranged.lvl = 24;
  let n1 = nb(1.5 * TILE, 0), n2 = nb(0, 3 * TILE), c2 = mkCorpse(3);
  S.enemies = [c2, n1, n2]; G.killEnemy(c2);
  ok('LATE (24): burst damages MULTIPLE nearby foes', n1.hp < 1e7 && n2.hp < 1e7, 'n1=' + (1e7 - n1.hp) + ' n2=' + (1e7 - n2.hp));
  ok('LATE (24): burst spreads a Mark to EVERY nearby foe (not just one)', n1._markN >= 1 && n2._markN >= 1 && n1._markBy === p && n2._markBy === p, 'n1mk=' + n1._markN + ' n2mk=' + n2._markN);

  // AoE scales with the kill's Mark stacks
  const burstToNeighbor = (markN) => { p.prof.ranged.lvl = 24; const n = nb(1.5 * TILE, 0), cc = mkCorpse(markN); S.enemies = [cc, n]; G.killEnemy(cc); return 1e7 - n.hp; };
  const b1 = burstToNeighbor(1), b3 = burstToNeighbor(3);
  ok('LATE burst AoE scales with the kill\'s Mark stacks (3 > 1)', b3 > b1 && b1 > 0, 'dmg@1mk=' + b1 + ' dmg@3mk=' + b3);

  // chain reaction: a burst that kills a marked neighbor re-detonates through the pack
  p.prof.ranged.lvl = 24;
  const chainCorpse = mkCorpse(3); const weak1 = nb(1.5 * TILE, 0); weak1.hp = weak1.maxHp = 2; weak1._markN = 2; weak1._markBy = p; const weak2 = nb(1.5 * TILE, 1.2 * TILE); weak2.hp = weak2.maxHp = 2; weak2._markN = 1; weak2._markBy = p;
  S.enemies = [chainCorpse, weak1, weak2]; G.killEnemy(chainCorpse);
  ok('LATE burst chain-reacts: fragile marked neighbors die & drop out of the roster', S.enemies.indexOf(weak1) < 0 && S.enemies.indexOf(weak2) < 0, 'w1in=' + (S.enemies.indexOf(weak1) >= 0) + ' w2in=' + (S.enemies.indexOf(weak2) >= 0));
})();

// ============================================================================
// FIX B (MP) — snapshot carries _markN + _markById; the OBJECT ref never rides
// ============================================================================
out.push('\n=== FIX B — MP mark serialization ===');
(function mpMarks() {
  S.enemies = []; S.projectiles = []; S.allies = []; S.pickups = [];
  const w = new World();
  const A = w.addPlayer('A', 'Ava'), B = w.addPlayer('B', 'Bo');
  B.x = A.x + 420; B.y = A.y;
  B.inventory.weapons.forEach(x => x.equipped = false); B.inventory.weapons.push({ name: 'MP-Bow', atk: 30, style: 'ranged', rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true });
  B.prof.ranged.lvl = 24;   // late-game ranged killer
  const fB = foeAt(B.x, B.y + 55); S.enemies.push(fB);
  let threw = null;
  try {
    for (let i = 0; i < 120; i++) { fB.x = B.x; fB.y = B.y + 45; fB.hp = fB.maxHp = 1e7; fB.stunT = 0; B.held = {}; B.dir = 'down'; B.actions.push('attack'); w.tick(); if (S.enemies.indexOf(fB) < 0) break; }
  } catch (e) { threw = String(e && e.stack || e); }
  ok('MP: 120 ranged-combat ticks (prof-24 killer), no throw', threw === null, threw || 'clean');
  const sB = w.snapshotFor('B'), sA = w.snapshotFor('A');
  const marked = (sB.enemies || []).find(e => (e._markN | 0) > 0);
  ok('MP: a marked enemy exists in B\'s snapshot with _markN (number)', !!marked && typeof marked._markN === 'number' && marked._markN > 0, marked ? ('_markN=' + marked._markN) : 'none marked');
  ok('MP: that enemy carries _markById === owner id ("B")', !!marked && marked._markById === 'B', marked ? ('_markById=' + marked._markById) : 'n/a');
  ok('MP: the _markBy OBJECT ref NEVER serializes (any snapshot)', (sB.enemies || []).every(e => e._markBy === undefined) && (sA.enemies || []).every(e => e._markBy === undefined), 'clean');
  // drawEnemy "mine" test: B owns the mark (id match), A does NOT
  ok('MP: mark reads as B\'s own (id match) but NOT A\'s', !!marked && marked._markById === 'B' && marked._markById !== 'A', marked ? ('owner=' + marked._markById) : 'n/a');

  // Server-side BURST proof: killEnemy with a World player (B, prof 24) as marker → AoE + multi-spread + credits B
  const cx = B.x, cy = B.y - 120;
  const corpse = foeAt(cx, cy); corpse._markN = 3; corpse._markBy = B; corpse.hp = 1; corpse.xp = 25; corpse.gold = 10;
  const nA = foeAt(cx + 1.5 * TILE, cy); nA.hp = nA.maxHp = 1e7; const nB2 = foeAt(cx, cy + 2.5 * TILE); nB2.hp = nB2.maxHp = 1e7;
  const _sp = S.player, gold0 = B.gold, xp0 = B.xp, lvl0 = B.level; S.player = B; S.enemies = [corpse, nA, nB2];
  let bthrew = null; try { G.killEnemy(corpse); } catch (e) { bthrew = String(e && e.stack || e); }
  S.player = _sp;
  ok('MP: server-side burst (marker=World player B) runs, damages+marks neighbors', bthrew === null && nA.hp < 1e7 && nB2.hp < 1e7 && nA._markBy === B && nB2._markBy === B, bthrew || ('nA=' + (1e7 - nA.hp) + ' nB=' + (1e7 - nB2.hp)));
  // credit check must be level-up-aware: a big burst chain can grant enough XP to level up, which WRAPS B.xp downward (xp -= xpNext) — that's still XP gained. Gold is monotonic, so it's the reliable credit signal.
  ok('MP: the burst kill credits the killer (B gains XP+gold)', B.gold > gold0 && (B.level > lvl0 || B.xp > xp0), 'xp ' + xp0 + '→' + B.xp + ' gold ' + gold0 + '→' + B.gold + ' lvl ' + lvl0 + '→' + B.level);
})();

console.log(out.join('\n'));
console.log('\n' + (fail === 0 ? '  ✅ ' : '  ❌ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
