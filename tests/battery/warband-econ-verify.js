'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// Verification: #115 (F2) WARBAND ECONOMY — 3 tiers × 3 classes, ~10× hire per tier, per-HERO daily
// gold upkeep charged in onNewDayHero, and UNPAID = the warband STAYS + FOLLOWS but REFUSES TO FIGHT
// (no chase, no swing) until paid. Boots World like server/index.js (no DB) and drives the REAL day
// boundary (updateTime → onNewDay → per-hero actAs → companionUpkeep). tiers[0] (T1) is byte-identical
// to pre-F2 (guarded here + by content-purity §5x/§5y + the untouched oracles). The refusal-gate assert
// (F1) is SEEN FAILING by deleting `&& !c.unpaid` in p05 updateCompanionsFor: the unpaid comp then
// fights and F1 flips to FAIL.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game');
const { World } = require(REPO + '/server/world');
const C = globalThis.CONTENT.companions;
const S = G.state;
const TILE = G.TILE || 32;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

// ============ A. registry tier tables (hire ~10×/tier · upkeep ladder · statMul ladder) ============
const kt = C.classes.knight.tiers, rt = C.classes.ranger.tiers, mt = C.classes.mage.tiers;
ok('A1 knight tiers: hire 200/2000/20000', kt[0].hire === 200 && kt[1].hire === 2000 && kt[2].hire === 20000, kt.map((t) => t.hire).join('/'));
ok('A2 ranger tiers: hire 200/2000/20000', rt[0].hire === 200 && rt[1].hire === 2000 && rt[2].hire === 20000, rt.map((t) => t.hire).join('/'));
ok('A3 mage tiers: hire 240/2400/24000 (~10× per tier)', mt[0].hire === 240 && mt[1].hire === 2400 && mt[2].hire === 24000, mt.map((t) => t.hire).join('/'));
ok('A4 upkeep ladder 10/60/300 across every class', [kt, rt, mt].every((ts) => ts[0].upkeep === 10 && ts[1].upkeep === 60 && ts[2].upkeep === 300), kt.map((t) => t.upkeep).join('/'));
ok('A5 statMul ladder 1/2/4 across every class', [kt, rt, mt].every((ts) => ts[0].statMul === 1 && ts[1].statMul === 2 && ts[2].statMul === 4), kt.map((t) => t.statMul).join('/'));
ok('A6 top-level class.hire === tiers[0].hire (T1 shorthand kept)', C.classes.knight.hire === kt[0].hire && C.classes.mage.hire === mt[0].hire);

// ============ B. T1 stats byte-identical to pre-F2 (existing saves carry no tier → T1) ============
const j = (o) => JSON.stringify(o);
ok('B1 statsFor tier-0 knight L1 === 120/11/6 (pre-F2)', j(C.statsFor('knight', 1, 0)) === j({ maxHp: 120, atk: 11, def: 6 }), j(C.statsFor('knight', 1, 0)));
ok('B2 statsFor tier-0 knight L10 === 271/25/10 (pre-F2)', j(C.statsFor('knight', 10, 0)) === j({ maxHp: 271, atk: 25, def: 10 }), j(C.statsFor('knight', 10, 0)));
ok('B3 statsFor tier-0 mage L1 === 64/13/1 (pre-F2)', j(C.statsFor('mage', 1, 0)) === j({ maxHp: 64, atk: 13, def: 1 }), j(C.statsFor('mage', 1, 0)));
ok('B4 tier-LESS call (no 3rd arg) === tier 0 — an old save with no c.tier scales as T1', j(C.statsFor('knight', 10)) === j(C.statsFor('knight', 10, 0)), j(C.statsFor('knight', 10)));
ok('B5 T2 doubles / T3 quadruples the mult stats (def is tier-independent)', C.statsFor('knight', 1, 1).maxHp === 240 && C.statsFor('knight', 1, 2).maxHp === 480 && C.statsFor('knight', 1, 2).def === 6, j(C.statsFor('knight', 1, 2)));

// ---- world rig ----
const w = new World();
const A = w.addPlayer('A', 'Ava'), B = w.addPlayer('B', 'Bo');
B.x = A.x + 600; B.y = A.y + 600;                       // far apart: separate buckets
for (let i = 0; i < 8; i++) w.tick();
let _cseq = 0;
function giveComp(p, cls, tier, opts) {
  const c = {
    name: 'Comp' + (++_cseq), cls, tier: tier | 0, level: 5, alive: true, maxHp: 300, hp: 300, atk: 60, def: 5,
    weapon: null, postedAt: null, x: p.x - 20, y: p.y + 16, w: 22, h: 22, attackCd: 0, hurtCd: 0,
    wobble: 0, color: '#ccc', ownerId: p.id, map: 'overworld',
  };
  if (opts) Object.assign(c, opts);
  (S.companions || (S.companions = [])).push(c);
  return c;
}
const DAY = 21600;
function crossDay() { const d0 = G.curDay(); S.time = DAY * d0 - 2; let t = 0; while (G.curDay() < d0 + 1 && t < 40) { w.tick(); t++; } return G.curDay(); }

// ============ C. recruit via the RPC action path stamps tier + ownerId, costs the tier's hire ============
S.companions = []; A.gold = 50000;
A.actions.push({ rpc: 'recruitCompanion', args: ['ranger', 2] });   // exactly what mp.html's window.recruitCompanion forwards
w.tick();
{
  const c = (S.companions || []).find((x) => x.ownerId === 'A');
  ok('C1 RPC hire made a T3 ranger, owned by A', !!c && c.cls === 'ranger' && c.tier === 2 && c.ownerId === 'A', c && ('tier=' + c.tier + ' owner=' + c.ownerId));
  ok('C2 T3 ranger cost 20000 (50000→30000)', A.gold === 30000, 'gold=' + A.gold);
  ok('C3 T3 stats = statsFor(ranger, lvl, 2), ×4 the T1 mult (baseHp 78→312 @L1)', !!c && c.maxHp === C.statsFor('ranger', c.level, 2).maxHp && c.atk === C.statsFor('ranger', c.level, 2).atk && c.maxHp === 312, c && ('hp=' + c.maxHp + ' atk=' + c.atk + ' L' + c.level));
}

// ============ D. daily upkeep is PER-HEAD and PER-OWNER (A's bill never drains B) ============
S.companions = []; A.gold = 10000; B.gold = 10000;
giveComp(A, 'knight', 0);   // upkeep 10
giveComp(A, 'ranger', 1);   // upkeep 60
giveComp(B, 'mage', 0);     // upkeep 10
{
  const gA0 = A.gold, gB0 = B.gold;
  crossDay();
  ok('D1 A charged 70 = his heads 10+60 (T1 knight + T2 ranger)', A.gold === gA0 - 70, 'ΔA=' + (A.gold - gA0));
  ok('D2 B charged 10 = his ONE head (T1 mage) — A’s bill never touched B', B.gold === gB0 - 10, 'ΔB=' + (B.gold - gB0));
  ok('D3 nobody unpaid (both could afford it)', !(S.companions || []).some((c) => c.unpaid));
}

// ============ E. can't afford the bill → the whole warband flips UNPAID, gold NOT deducted ============
S.companions = []; A.gold = 5;
const eComp = giveComp(A, 'knight', 1);   // T2 upkeep 60 > 5 gold
{
  const g0 = A.gold;
  crossDay();
  ok('E1 short of the bill → gold is NOT deducted (all-or-nothing)', A.gold === g0, 'gold=' + A.gold);
  ok('E2 the hero’s companion flips unpaid=1', eComp.unpaid === 1, 'unpaid=' + eComp.unpaid);
}

// ============ F. UNPAID = refuses to fight (adjacent foe takes ZERO damage) → then PAID resumes ============
S.companions = []; S.enemies.length = 0;
const fComp = giveComp(A, 'knight', 0, { unpaid: 1, x: A.x + 40, y: A.y });   // melee, adjacent-ready, UNPAID
let foe = null; for (let k = 0; k < 14 && !foe; k++) foe = G.makeWildEnemy(Math.floor(A.x / TILE) + 1 + k, Math.floor(A.y / TILE));
foe.hp = foe.maxHp = 999999; foe.holdKey = undefined; foe.raidTown = undefined;
foe.x = fComp.x + 26; foe.y = fComp.y; S.enemies.push(foe);
{
  const hp0 = foe.hp;
  for (let i = 0; i < 140; i++) w.tick();
  // F1 is the SEEN-FAILING assert: delete `&& !c.unpaid` in updateCompanionsFor and the unpaid comp swings → foe.hp drops → this FAILS.
  ok('F1 an UNPAID companion refuses to fight — adjacent foe takes ZERO damage', foe.hp === hp0, 'foe.hp ' + hp0 + '→' + Math.round(foe.hp));
  ok('F2 the refusing companion is still PRESENT and alive (it stays + follows, it doesn’t leave)', fComp.alive && (S.companions || []).includes(fComp));
  // now PAY it off → it resumes fighting the same foe
  fComp.unpaid = 0; fComp.x = foe.x - 26; fComp.y = foe.y; fComp.attackCd = 0;
  const hp1 = foe.hp;
  for (let i = 0; i < 140; i++) w.tick();
  ok('F3 PAID (unpaid cleared) → the same companion fights again (foe now takes damage)', foe.hp < hp1, 'foe.hp ' + Math.round(hp1) + '→' + Math.round(foe.hp));
}

// ============ G. paying the bill in full next day clears unpaid (and deducts) ============
S.companions = []; S.enemies.length = 0; A.gold = 10000;
const gComp = giveComp(A, 'knight', 1, { unpaid: 1 });   // T2, currently unpaid, but A can afford 60 now
{
  const g0 = A.gold;
  crossDay();
  ok('G1 paid in full next day-tick → unpaid cleared', !gComp.unpaid, 'unpaid=' + gComp.unpaid);
  ok('G2 …and the 60g bill was deducted', A.gold === g0 - 60, 'Δ=' + (A.gold - g0));
}

// ============ H. tier + unpaid ride the wire (snapshot) so clients render them ============
S.companions = []; S.enemies.length = 0;
const hComp = giveComp(A, 'ranger', 2, { unpaid: 1 });
{
  const snap = w.snapshotFor('A');
  const sc = (snap.comps || []).find((c) => c._cid === hComp._cid) || (snap.comps || [])[0];
  ok('H1 snapshot carries the companion tier (client shows T3)', sc && sc.tier === 2, sc && ('tier=' + sc.tier));
  ok('H2 snapshot carries the unpaid flag (client shows "won’t fight")', sc && sc.unpaid === 1, sc && ('unpaid=' + sc.unpaid));
}

console.log('\n' + out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
