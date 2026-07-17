'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// style-verify.js — Pillar 1 (Style Identity: Momentum / Quarry Marks / Heat)
// Drives the REAL game headlessly (server/load-game) then an MP World.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game.js');
const { World } = require(REPO + '/server/world.js');   // requiring world.js runs G.startGame() (boots the overworld)
const S = G.state;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };
const approx = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.001 : tol);

const TILE = G.TILE;
const AURA_MIN = 40;   // mirrors the game's HEAT_AURA_MIN (not in load-game CAPTURE, so hardcoded here)
function foeAt(px, py) { const e = G.makeWildEnemy(Math.floor(px / TILE), Math.floor(py / TILE)) || {}; e.x = px; e.y = py; e.w = e.w || 24; e.h = e.h || 24; e.hp = e.maxHp = 1e7; e.def = 0; e.isBoss = false; e.stunT = 0; e.hitFlash = 0; e._markN = 0; return e; }   // no _markBy: real enemies leave it undefined until a player object marks them
const freshProf = () => ({ melee: { lvl: 1, xp: 0, next: 12 }, ranged: { lvl: 1, xp: 0, next: 12 }, magic: { lvl: 1, xp: 0, next: 12 } });
// SP keeps the inventory at state.inventory (NOT state.player.inventory); equippedWeapon() reads it.
function equipStyle(style, pattern) { const p = S.player; S.inventory.weapons.forEach(w => w.equipped = false); const w = { name: 'T-' + style, atk: 30, style, rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true }; if (pattern) w.pattern = pattern; S.inventory.weapons.push(w); G.recalcStats(); p._lastStyle = style; }
let _rnd = Math.random; const stubRnd = (v) => { Math.random = () => v; }; const unstub = () => { Math.random = _rnd; };
// Zero-velocity test projectiles die instantly on a SOLID spawn tile — the overworld is random per boot, so fixed
// coords are flaky. Find a 13-wide × 2-tall block of open tiles once and base every projectile test there.
function openField() { const m = G.maps.overworld, H = m.length, W = m[0].length, solid = (tx, ty) => G.SOLID.has(G.getTile('overworld', tx, ty)); for (let ty = Math.floor(H / 2); ty < H - 3; ty++) for (let tx = 6; tx < W - 14; tx++) { let good = true; for (let dy = 0; dy <= 1 && good; dy++) for (let dx = -1; dx <= 11; dx++) if (solid(tx + dx, ty + dy)) { good = false; break; } if (good) return { x: tx * TILE, y: ty * TILE }; } return { x: 100 * TILE, y: 100 * TILE }; }
const FIELD = openField();

// ============================================================================
// MELEE — MOMENTUM
// ============================================================================
out.push('=== Melee — Momentum ===');
(function melee() {
  const p = S.player; p._lastStyle = 'melee'; p.crit = 0; p.evasion = 0; p.dodge = 0; p.invuln = 0;
  p.hp = p.maxHp = 500; p.x = FIELD.x; p.y = FIELD.y; p.dir = 'down';
  stubRnd(0);
  S.enemies = [foeAt(p.x, p.y + 18)]; p.momentum = 0; p._momoDecay = 0;
  p.attackCooldown = 0; G.tryAttack();
  ok('a connecting swing builds 1 pip', p.momentum === 1, 'momentum=' + p.momentum);
  for (let i = 0; i < 10; i++) { p.attackCooldown = 0; S.enemies[0].x = p.x; S.enemies[0].y = p.y + 18; S.enemies[0].hp = 1e7; G.tryAttack(); }
  ok('Momentum caps at 5 (not 6+)', p.momentum === 5, 'momentum=' + p.momentum);
  p.dodge = 0; p.invuln = 0; G.playerTakeDamage(3);
  ok('taking a hit drops 2 pips (5 -> 3)', p.momentum === 3, 'momentum=' + p.momentum);
  p._momoDecay = 0; S.enemies = []; const before = p.momentum;
  for (let i = 0; i < 149; i++) G.updatePlayer();
  const mid = p.momentum; G.updatePlayer();
  ok('idle Momentum decays exactly 1 pip at ~150 frames', mid === before && p.momentum === before - 1, 'before=' + before + ' @149=' + mid + ' @150=' + p.momentum);
  const mkDash = (mom) => { const e = foeAt(p.x, p.y); S.enemies = [e]; p.momentum = mom; p._momoDecay = 0; p.dodge = 6; p.dvx = 0; p.dvy = 0; p.dodgeHits = []; const hp0 = e.hp; G.updatePlayer(); return hp0 - e.hp; };
  const d0 = mkDash(0), d5 = mkDash(5);
  ok('full-Momentum dash-strike hits harder than a 0-pip roll', d5 > d0 && d0 > 0, 'dmg@0pip=' + d0 + ' dmg@5pip=' + d5);
  // RIPOSTE: guaranteed crit once (momentum pinned at 5 so both hits share one damage multiplier)
  p.momentum = 5; p.crit = 0; p.riposteT = 120;
  const e2 = foeAt(p.x, p.y + 18); S.enemies = [e2]; p.attackCooldown = 0; const h0 = e2.hp; G.tryAttack(); const dCrit = h0 - e2.hp;
  ok('riposte window consumed after the hit', p.riposteT === 0, 'riposteT=' + p.riposteT);
  e2.x = p.x; e2.y = p.y + 18; e2.hp = 1e7; p.momentum = 5; p.attackCooldown = 0; const h1 = e2.hp; G.tryAttack(); const dNorm = h1 - e2.hp;
  ok('riposte hit is a guaranteed crit (~2x the next normal hit)', approx(dCrit, dNorm * 2, 2), 'ripDmg=' + dCrit + ' normDmg=' + dNorm);
  unstub();
})();

// ============================================================================
// RANGED — QUARRY MARKS + Deadeye + point-blank
// ============================================================================
out.push('\n=== Ranged — Quarry Marks / Deadeye / point-blank ===');
(function ranged() {
  const p = S.player; equipStyle('ranged'); p.crit = 0; p.berserk = 0; p.momentum = 0; p.hp = p.maxHp = 500;
  const bx = FIELD.x, by = FIELD.y; p.x = bx; p.y = by; p.w = p.w || 22; p.h = p.h || 22;
  stubRnd(0);
  const shootAt = (owner, ex, ey, dmg) => { const e = S.enemies[0]; e.x = ex; e.y = ey; e.hp = 1e7; G.addProjectile(ex + e.w / 2, ey + e.h / 2, 0, 0, dmg, { friendly: true, kind: 'arrow', style: 'ranged', element: null, ownerRef: owner, pierce: 0, r: 5, life: 90 }); const h0 = e.hp; G.updateProjectiles(); return h0 - e.hp; };
  const mx = bx + 5 * TILE, my = by;   // ~5 tiles east: not deadeye (>8t), not point-blank (<1.5t)
  const e = foeAt(mx, my); S.enemies = [e];
  const d1 = shootAt(p, mx, my, 40), m1 = e._markN;
  const d2 = shootAt(p, mx, my, 40), m2 = e._markN;
  const d3 = shootAt(p, mx, my, 40), m3 = e._markN;
  const d4 = shootAt(p, mx, my, 40), m4 = e._markN;
  ok('marks stack 1->2->3 and CAP at 3', m1 === 1 && m2 === 2 && m3 === 3 && m4 === 3, [m1, m2, m3, m4].join(','));
  ok('1st hit no bonus; later hits scale with stacks (+15%/stack)', d1 === 40 && approx(d2, 46) && approx(d3, 52) && approx(d4, 58), 'dmg=' + [d1, d2, d3, d4].join(','));
  ok('marker HUD mirror tracks the stack (_lastMarkN=3)', p._lastMarkN === 3, '_lastMarkN=' + p._lastMarkN);
  const B = { x: bx, y: by, w: p.w, h: p.h, crit: 0, berserk: 0, momentum: 0, hp: 100, maxHp: 100, atk: 1, exec: 0, lifesteal: 0, prof: freshProf(), _lastMarkN: 0, _markShowT: 0 };
  const dB = shootAt(B, mx, my, 40);
  ok('another shooter gets NO mark bonus & reseeds ownership', dB === 40 && e._markBy === B && e._markN === 1, 'dmgB=' + dB + ' markN=' + e._markN + ' ownerIsB=' + (e._markBy === B));
  const victim = foeAt(mx, my); victim._markN = 3; victim._markBy = p; const neighbor = foeAt(mx + 20, my); neighbor._markN = 0;
  S.enemies = [victim, neighbor]; G.killEnemy(victim);
  ok('a marked kill transfers a Mark to the nearest foe', (neighbor._markN | 0) >= 1 && neighbor._markBy === p, 'neighbor._markN=' + neighbor._markN + ' ownerIsP=' + (neighbor._markBy === p));
  unstub();
  stubRnd(0.2);   // base crit 0 -> 0.2<0 false; Deadeye adds +0.30 -> 0.2<0.30 true
  const eF = foeAt(bx + 9 * TILE, by), eN = foeAt(bx + 4 * TILE, by);
  S.enemies = [eF]; const dFar = shootAt(p, bx + 9 * TILE, by, 40);
  S.enemies = [eN]; const dNear = shootAt(p, bx + 4 * TILE, by, 40);
  ok('Deadeye: far shot crits (~2x), mid-range shot does not', approx(dFar, dNear * 2, 2) && dFar > dNear, 'far=' + dFar + ' near=' + dNear);
  unstub();
  stubRnd(0);
  p.x = bx; p.y = by; const px0 = p.x, py0 = p.y; S.enemies = [foeAt(bx + TILE, by)];
  shootAt(p, bx + TILE, by, 40);
  ok('point-blank shot knocks the shooter back a step', Math.hypot(p.x - px0, p.y - py0) > 2, 'moved=' + Math.round(Math.hypot(p.x - px0, p.y - py0)) + 'px');
  unstub();
})();

// ============================================================================
// MAGIC — HEAT AURA (passive elemental "don't-touch-me" field; no vent, no overload)
// ============================================================================
out.push('\n=== Magic — Heat aura ===');
(function magic() {
  const p = S.player; equipStyle('magic'); p.energy = p.maxEnergy = 1e6; p.crit = 0; p.momentum = 0; p.berserk = 0;
  p.x = FIELD.x; p.y = FIELD.y; p.hp = p.maxHp = 500; p.dir = 'down';
  stubRnd(0);
  const eq = S.inventory.weapons.find(w => w.equipped);   // atk 30 test staff
  const AMIN = AURA_MIN;   // aura threshold (40)

  // --- NON-elemental staff: casting builds NO Heat (plain staff = no aura) ---
  delete eq.element; delete eq.pattern; p.heat = 0; p.attackCooldown = 0; G.tryAttack();
  ok('a NON-elemental staff builds NO Heat', p.heat === 0, 'heat=' + p.heat);

  // --- elemental staff BUILDS Heat, scaled by pattern AND weapon power (atk30 → powMul 2.5) ---
  eq.element = 'fire';
  const buildOnce = (pat) => { if (pat) eq.pattern = pat; else delete eq.pattern; p.heat = 0; p.attackCooldown = 0; G.tryAttack(); return p.heat; };
  const hSingle = buildOnce(null), hTwin = buildOnce('twin'), hFan = buildOnce('trifan'), hLance = buildOnce('lance');
  ok('an elemental staff BUILDS Heat per cast', hSingle > 0, 'single heat=' + hSingle);
  ok('per-cast build = base×powMul (atk30→×2.5): lance 7.5, single 12.5, twin 20, trifan 27.5', approx(hLance, 7.5, .01) && approx(hSingle, 12.5, .01) && approx(hTwin, 20, .01) && approx(hFan, 27.5, .01), 'lance=' + hLance + ' single=' + hSingle + ' twin=' + hTwin + ' trifan=' + hFan);
  ok('pattern ordering preserved (fan hottest, lance coolest)', hFan > hTwin && hTwin > hSingle && hSingle > hLance, [hLance, hSingle, hTwin, hFan].join('<'));
  const powHeat = (atk) => { eq.atk = atk; delete eq.pattern; p.heat = 0; p.attackCooldown = 0; G.tryAttack(); return p.heat; };
  const weakH = powHeat(4), strongH = powHeat(40); eq.atk = 30;
  ok('a STRONGER staff heats faster than a weak one (same single cast)', strongH > weakH, 'atk4=' + weakH + ' atk40=' + strongH);

  // --- decay: Heat falls when you stop casting ---
  eq.element = 'fire'; delete eq.pattern; p.heat = 80; p._heatCool = 0; p._lastStyle = 'magic'; S.enemies = [];
  const hDec0 = p.heat; for (let i = 0; i < 20; i++) G.updatePlayer();
  ok('Heat DECAYS when you stop casting', p.heat < hDec0, 'heat ' + hDec0 + '->' + p.heat.toFixed(1));

  // --- AURA damage: drives the REAL per-frame path (updatePlayer→updateStyleResources→updateHeatAura). ---
  // _auraCd=0 forces the throttled scan to fire THIS frame; equipped fire staff + Heat≥threshold gate it on.
  const auraTick = (heat, setup) => { const e = foeAt(p.x + 30, p.y + 10); e.burnT = 0; e.hp = e.maxHp = 1e7; if (setup) setup(e); S.enemies = [e]; p.heat = heat; p._auraCd = 0; p._lastStyle = 'magic'; const hp0 = e.hp; G.updatePlayer(); return { dealt: hp0 - e.hp, burnT: e.burnT }; };
  eq.element = 'fire'; eq.atk = 30; p.crit = 0;
  const aLow = auraTick(45), aHigh = auraTick(100);
  ok('Heat≥threshold: aura damages a nearby foe AND applies the element (burn)', aLow.dealt > 0 && aLow.burnT > 0, 'dealt=' + aLow.dealt + ' burnT=' + aLow.burnT);
  ok('aura radius/strength SCALE with Heat (hotter → harder tick + longer burn)', aHigh.dealt >= aLow.dealt && aHigh.burnT >= aLow.burnT && aHigh.dealt > 0, 'lowDealt=' + aLow.dealt + ' hiDealt=' + aHigh.dealt + ' lowBurn=' + aLow.burnT + ' hiBurn=' + aHigh.burnT);
  const below = auraTick(30);
  ok('NO aura below the threshold (Heat 30 → foe untouched)', below.dealt === 0 && below.burnT === 0, 'dealt=' + below.dealt + ' burnT=' + below.burnT);
  const warded = auraTick(100, (e) => { e.afxWard = 1; e.wardT = 60; e._afxN = 1; });
  ok('aura respects afxHit — a WARDED elite takes ZERO aura damage', warded.dealt === 0, 'dealt=' + warded.dealt);
  // non-elemental staff NEVER auras, even pegged at 100
  const plain = (() => { const e = foeAt(p.x + 30, p.y + 10); e.burnT = 0; e.hp = e.maxHp = 1e7; S.enemies = [e]; delete eq.element; p.heat = 100; p._auraCd = 0; p._lastStyle = 'magic'; const hp0 = e.hp; G.updatePlayer(); return { dealt: hp0 - e.hp, burnT: e.burnT }; })();
  ok('a NON-elemental staff NEVER auras (even at max Heat)', plain.dealt === 0 && plain.burnT === 0, 'dealt=' + plain.dealt + ' burnT=' + plain.burnT);
  eq.element = 'fire';

  // --- THROTTLE: a tick fires, the very next frame does NOT re-scan ---
  const eT = foeAt(p.x + 30, p.y + 10); eT.hp = eT.maxHp = 1e7; S.enemies = [eT]; p.heat = 100; p._auraCd = 0; p._lastStyle = 'magic';
  G.updatePlayer(); const t1 = eT.maxHp - eT.hp; const midHp = eT.hp;
  G.updatePlayer(); const sameNext = eT.hp === midHp;
  ok('aura scan is THROTTLED (tick fires, next frame does not re-scan)', t1 > 0 && sameNext, 'tick1=' + t1 + ' nextFrameUnchanged=' + sameNext);

  // --- the pulsate/aura flag rides me.* (_auraEl set only when an elemental staff is past threshold) ---
  eq.element = 'frost'; p.heat = 60; p._lastStyle = 'magic'; S.enemies = []; G.updatePlayer();
  ok('_auraEl rides the player (frost staff past threshold → _auraEl="frost")', p._auraEl === 'frost', '_auraEl=' + p._auraEl);
  p.heat = 20; G.updatePlayer();
  ok('_auraEl clears below threshold', p._auraEl === 0, '_auraEl=' + p._auraEl);

  // --- FIRST-TIME TIP: first cast crossing the aura threshold sets seenHeatTip once (element-aware) ---
  // P2/S5: the flag lives on the PLAYER now (per-hero teach) — was state.seenHeatTip.
  p.seenHeatTip = false; eq.element = 'fire'; eq.atk = 30; delete eq.pattern; p.heat = 32; p.attackCooldown = 0; p._lastStyle = 'magic';
  G.tryAttack();   // 32 + 12.5 = 44.5 ≥ 40 → crosses the aura threshold
  ok('first cast crossing the aura threshold sets the CASTER\'s seenHeatTip (element-aware teach)', p.seenHeatTip === true && p.heat >= AMIN, 'seenHeatTip=' + p.seenHeatTip + ' heat=' + p.heat.toFixed(1));
  unstub();
})();

// ============================================================================
// Style-swap reset + save/load defaults
// ============================================================================
out.push('\n=== Style-swap reset + save/load defaults ===');
(function swapAndSave() {
  const p = S.player;
  equipStyle('melee'); p.momentum = 5; p.riposteT = 60;
  equipStyle('ranged'); p._lastStyle = 'melee'; G.updatePlayer();
  ok('swapping melee→ranged resets Momentum & riposte', p.momentum === 0 && p.riposteT === 0, 'momentum=' + p.momentum + ' riposteT=' + p.riposteT);
  equipStyle('magic'); S.inventory.weapons.find(w => w.equipped).element = 'fire'; p.heat = 88; equipStyle('melee'); p._lastStyle = 'magic'; G.updatePlayer();
  ok('swapping magic→melee resets Heat', p.heat === 0, 'heat=' + p.heat);
  equipStyle('melee'); p.momentum = 5; p.heat = 99; p.riposteT = 60; p._auraEl = 'fire'; p._auraCd = 5; p._lastMarkN = 3; p._markShowT = 100;
  p.seenHeatTip = true;
  const snap = G.snapshot();
  const leaks = ['momentum', 'heat', 'riposteT', '_auraEl', '_lastMarkN'].some(k => k in snap.player);
  ok('snapshot() does NOT persist transient style fields (whitelist)', !leaks, 'leaked=' + leaks);
  ok('snapshot() DOES persist seenHeatTip — in the PLAYER slice (P2/S5)', snap.player.seenHeatTip === true && snap.seenHeatTip === undefined, 'snap.player.seenHeatTip=' + snap.player.seenHeatTip + ' root=' + snap.seenHeatTip);
  p.momentum = 2; p.heat = 50; G.applySnapshot(snap);
  ok('load defaults ALL style resources to 0/off', p.momentum === 0 && p.heat === 0 && p.riposteT === 0 && p._auraEl === 0 && p._auraCd === 0 && p._lastMarkN === 0, 'm=' + p.momentum + ' h=' + p.heat + ' rip=' + p.riposteT + ' auraEl=' + p._auraEl + ' auraCd=' + p._auraCd + ' mark=' + p._lastMarkN);
  ok('load restores seenHeatTip=true from the save', p.seenHeatTip === true, 'seenHeatTip=' + p.seenHeatTip);
  // pre-S5 save shape: the flag at the ROOT — must restore losslessly through the fallback read
  const preMove = JSON.parse(JSON.stringify(snap)); delete preMove.player.seenHeatTip; preMove.seenHeatTip = true; G.applySnapshot(preMove);
  ok('pre-move saves (root seenHeatTip) restore LOSSLESSLY onto the player', p.seenHeatTip === true, 'seenHeatTip=' + p.seenHeatTip);
  const oldSnap = JSON.parse(JSON.stringify(snap)); delete oldSnap.player.seenHeatTip; delete oldSnap.seenHeatTip; G.applySnapshot(oldSnap);
  ok('old saves (missing seenHeatTip everywhere) default it to false → tip still shows once', p.seenHeatTip === false, 'seenHeatTip=' + p.seenHeatTip);
})();

// ============================================================================
// MP PATH (World) — every style's fields ride me.* every snapshot; the aura runs
// server-side per player; teammate auraEl rides lightPlayer; tick stays fast.
// Runs LAST (World clones fresh templates; headless mutations above don't leak in).
// ============================================================================
out.push('\n=== MP path (World) ===');
(function mp() {
  S.enemies = []; S.projectiles = []; S.allies = []; S.pickups = [];   // clear headless leftovers
  const w = new World();
  const A = w.addPlayer('A', 'Ava'), B = w.addPlayer('B', 'Bo'), C = w.addPlayer('C', 'Cy');
  B.x = A.x + 500; B.y = A.y; C.x = A.x - 500; C.y = A.y;
  B.inventory.weapons.forEach(x => x.equipped = false); B.inventory.weapons.push({ name: 'MP-Bow', atk: 28, style: 'ranged', rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true });
  C.inventory.weapons.forEach(x => x.equipped = false); C.inventory.weapons.push({ name: 'MP-Staff', atk: 28, style: 'magic', element: 'fire', pattern: 'trifan', rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true });   // ELEMENTAL fire staff → builds Heat → auras
  const fA = foeAt(A.x, A.y + 20), fB = foeAt(B.x, B.y + 55), fC = foeAt(C.x + 22, C.y + 12); S.enemies.push(fA, fB, fC);
  for (let i = 0; i < 25; i++) w.tick();
  const perfWarm = w.perf();
  let fieldMisses = 0, threw = null, markByLeak = false;
  const mx = { A_mom: 0, C_heat: 0, B_mark: 0, C_auraEl: 0 };
  const fCstart = fC.hp;
  try {
    for (let i = 0; i < 200; i++) {
      fA.x = A.x; fA.y = A.y + 20; fA.hp = fA.maxHp = 1e7; fA.stunT = 0;
      fB.x = B.x; fB.y = B.y + 50; fB.hp = fB.maxHp = 1e7; fB.stunT = 0;
      fC.x = C.x + 22; fC.y = C.y + 12; fC.stunT = 0;   // held near C; hp NOT reset → accumulates aura damage
      A.held = {}; B.held = {}; C.held = {}; A.dir = 'down'; B.dir = 'down'; C.energy = C.maxEnergy = 1e6;
      A.actions.push('attack'); B.actions.push('attack'); C.actions.push('attack');
      w.tick();
      const sA = w.snapshotFor('A'), sB = w.snapshotFor('B'), sC = w.snapshotFor('C');
      mx.A_mom = Math.max(mx.A_mom, sA.me.momentum | 0); mx.C_heat = Math.max(mx.C_heat, sC.me.heat || 0); mx.B_mark = Math.max(mx.B_mark, sB.me._lastMarkN | 0);
      const cInA = (sA.players || []).find(pl => pl.id === 'C'); if (cInA && cInA.auraEl === 'fire') mx.C_auraEl = 1;   // teammate sees C's aura element via lightPlayer
      for (const s of [sA, sB, sC]) { if (['momentum', 'heat', '_lastMarkN', 'riposteT'].some(k => typeof s.me[k] !== 'number')) fieldMisses++; if (!(s.enemies || []).every(e => e._markBy === undefined)) markByLeak = true; }
    }
  } catch (e) { threw = String(e && e.stack || e); }
  const perfLoad = w.perf();
  ok('MP 200 combat ticks, no throw', threw === null, threw || 'clean');
  ok('me.{momentum,heat,_lastMarkN,riposteT} present in EVERY snapshot (600 sampled)', fieldMisses === 0, 'misses=' + fieldMisses);
  ok('A (melee) built Momentum on the wire', mx.A_mom > 0, 'peak momentum=' + mx.A_mom);
  ok('C (magic) built Heat on the wire', mx.C_heat > 0, 'peak heat=' + mx.C_heat);
  ok('C (magic) crossed the aura threshold', mx.C_heat >= AURA_MIN, 'peak heat=' + mx.C_heat + ' (threshold ' + AURA_MIN + ')');
  ok('C\'s aura element rides lightPlayer → a teammate sees auraEl="fire"', mx.C_auraEl === 1, 'sawAuraEl=' + mx.C_auraEl);
  ok('the aura DAMAGES a foe server-side, per player (foe near C lost HP)', fC.hp < fCstart, 'fC hp ' + fCstart + '->' + Math.round(fC.hp));
  // P2/S5: the heat teach is PER-HERO — C's first threshold cast set C's OWN flag; the melee/ranged
  // heroes (who never heated) must still be owed their tip. Pre-fold this was one shared
  // state.seenHeatTip: the first caster in the room silenced the teach for every other mage.
  ok('heat teach is PER-HERO: C tripped his own seenHeatTip, A/B still untipped', C.seenHeatTip === true && A.seenHeatTip !== true && B.seenHeatTip !== true,
    JSON.stringify({ A: !!A.seenHeatTip, B: !!B.seenHeatTip, C: !!C.seenHeatTip }));
  { const sC2 = w.snapshotFor('C'), sA2 = w.snapshotFor('A');
    ok('seenHeatTip rides me.* (per-hero on the wire, no adopt line needed)', sC2.me.seenHeatTip === true && sA2.me.seenHeatTip === false,
      'C.me=' + sC2.me.seenHeatTip + ' A.me=' + sA2.me.seenHeatTip); }
  ok('B (ranged) built Quarry Marks on the wire', mx.B_mark > 0, 'peak _lastMarkN=' + mx.B_mark);
  ok('enemy _markBy (player ref) NEVER serializes into any snapshot', markByLeak === false, 'leak=' + markByLeak);
  ok('tick stayed fast under combat load (tickMsAvg < 6ms)', perfLoad.tickMsAvg < 6, 'warmAvg=' + perfWarm.tickMsAvg + 'ms loadAvg=' + perfLoad.tickMsAvg + 'ms');
  out.push('  PERF  warmup tickMsAvg=' + perfWarm.tickMsAvg + 'ms | 200-tick combat tickMsAvg=' + perfLoad.tickMsAvg + 'ms tickMsMax=' + perfLoad.tickMsMax + 'ms snapMsAvg=' + perfLoad.snapMsAvg + 'ms | players=' + perfLoad.players + ' enemies=' + perfLoad.enemies);
})();

console.log(out.join('\n'));
console.log('\n' + (fail === 0 ? '  ✅ ' : '  ❌ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
