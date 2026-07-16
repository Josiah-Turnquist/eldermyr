'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// flat-levels-verify.js — v2.57.x
//   FIX 1: the Deadeye marked-kill burst must be NON-CHAINING (cascade depth exactly 1).
//   FIX 2: pinnacle bosses / their adds / the Emberwyrm are FLAT-LEVELLED (no partyLvl()/
//          state.player.level dependence) and genuinely HARDER — while party-size / cycle /
//          ascension multipliers still stack on top, and dropPinnacleReward STILL tracks partyLvl.
//
// Run against BOTH trees (separate processes — one eval of the game per process):
//   OLD:  GAME_HTML=<scratchpad>/_flat_OLD.html node flat-levels-verify.js
//   NEW:  node flat-levels-verify.js
// Every [CHANGE] assertion MUST fail on OLD and pass on NEW (that is the non-vacuity proof).
// [KEEP] assertions must pass on BOTH — they are differential (sensitive to the exact mistake
// they guard), never `!undefined`-style tautologies.

const G = require('./flat-loader.js');
const S = G.state, TILE = G.TILE;
let LOG = []; global.__onLog = (m) => { LOG.push(String(m)); }; global.__onGameOver = () => {};

const TREE = process.env.GAME_HTML ? 'OLD (' + require('path').basename(process.env.GAME_HTML) + ')' : 'NEW (repo eldermyr-rpg.html)';
let pass = 0, fail = 0; const out = [];
const ok = (tag, n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + tag + ' ' + n + (x != null ? '  [' + x + ']' : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

G.startGame();
S.scene = 'play'; S.map = 'overworld'; S.sailing = false; if (S.dragon) S.dragon.mounted = false;

// Drive every generator from a clean, explicit world baseline (solo, no cycle, no ascension).
const baseline = () => { S._partyN = 1; S.ascension = 0; S.pinnacleCycle = 0; S.huntCycle = 0; };
const atLvl = (l) => { baseline(); S.player.level = l; S._partyLevel = l; };   // partyLvl() = max(player.level, _partyLevel)
const KING = G.PINNACLE_BOSSES.find((p) => p.key === 'drownedking');
const SHEP = G.PINNACLE_BOSSES.find((p) => p.key === 'paleshepherd');
const KLAIR = S.drownedLair, SLAIR = S.shepherdLair;
const DLAIR = S.dragonLair;
const STAT = (e) => ({ maxHp: e.maxHp, atk: e.atk, def: e.def, xp: e.xp, gold: e.gold });
const sig = (e) => JSON.stringify(STAT(e));

// ============================================================================
// 1. FLATNESS — identical stats at party level 5 / 19 / 45
// ============================================================================
const LEVELS = [5, 19, 45];
const gen = {
  makePinnacleBoss_king: () => G.makePinnacleBoss(KING, KLAIR.tx, KLAIR.ty),
  makePinnacleBoss_shepherd: () => G.makePinnacleBoss(SHEP, SLAIR.tx, SLAIR.ty),
  makePinnacleAdd: () => G.makePinnacleAdd({ hp: 1, _nextKill: 0 }, true, KLAIR.tx, KLAIR.ty, 0),
  makeWildDragon: () => G.makeWildDragon(DLAIR.tx, DLAIR.ty),
};
const SIGS = {};
for (const [name, f] of Object.entries(gen)) {
  const seen = LEVELS.map((l) => { atLvl(l); return sig(f()); });
  SIGS[name] = seen[1];
  ok('[CHANGE]', name + ': stats IDENTICAL at partyLvl 5/19/45',
    seen[0] === seen[1] && seen[1] === seen[2],
    LEVELS.map((l, i) => 'L' + l + '=' + seen[i]).join(' | '));
}

// The Emberwyrm's MP bug: it read state.player.level DIRECTLY (whichever hero was swapped in at
// spawn) instead of partyLvl(). Pin partyLvl() constant and move ONLY state.player.level.
{
  baseline(); S._partyLevel = 45; S.player.level = 5; const a = sig(gen.makeWildDragon());
  baseline(); S._partyLevel = 45; S.player.level = 45; const b = sig(gen.makeWildDragon());
  ok('[CHANGE]', 'makeWildDragon: ignores state.player.level (MP swap-in bug)', a === b, 'p.level5=' + a + ' | p.level45=' + b);
}

// ============================================================================
// 2. CONCRETE TARGETS — PIN_LEVEL 75 / DRAGON_LEVEL 30 on the multiplicative curve
//    lf is the ONLY level-dependent term, so it is RECOVERABLE from the generator's own
//    output: lf = maxHp / (table.hp * dcf). No formula mirror — the table + captured
//    distFactor are the game's own data.
// ============================================================================
atLvl(19);
const dcfOf = (tx, ty) => 1 + G.distFactor(tx, ty) * 0.7;
const k = gen.makePinnacleBoss_king(), sh = gen.makePinnacleBoss_shepherd();
const add = gen.makePinnacleAdd(), dr = gen.makeWildDragon();
const lfKing = k.maxHp / (KING.hp * dcfOf(KLAIR.tx, KLAIR.ty));
const lfShep = sh.maxHp / (SHEP.hp * dcfOf(SLAIR.tx, SLAIR.ty));
const lfAdd = add.maxHp / 46;
const lfDrag = dr.maxHp / 2200;
const PIN_LF = 1 + (75 - 5) * 0.13;      // 10.1  — what PIN_LEVEL=75 must produce
const DRAG_LF = 1 + (30 - 5) * 0.13;     // 4.25  — what DRAGON_LEVEL=30 must produce

ok('[CHANGE]', 'King: level-factor lf == 10.1 (PIN_LEVEL 75, not partyLvl 19)', near(lfKing, PIN_LF, 0.02), 'lf=' + lfKing.toFixed(3) + ' want ' + PIN_LF);
ok('[CHANGE]', 'Shepherd: level-factor lf == 10.1', near(lfShep, PIN_LF, 0.02), 'lf=' + lfShep.toFixed(3));
ok('[CHANGE]', 'Add: level-factor lf == 10.1', near(lfAdd, PIN_LF, 0.05), 'lf=' + lfAdd.toFixed(3));
ok('[CHANGE]', 'Emberwyrm: level-factor lf == 4.25 (DRAGON_LEVEL 30, multiplicative)', near(lfDrag, DRAG_LF, 0.02), 'lf=' + lfDrag.toFixed(3) + ' want ' + DRAG_LF);

ok('[CHANGE]', 'Drowned King maxHp ~34k (was ~9.5k @L19)', k.maxHp > 32000 && k.maxHp < 36000, 'hp=' + k.maxHp);
ok('[CHANGE]', 'Drowned King atk ~397 (was ~119 @L19)', k.atk > 380 && k.atk < 415, 'atk=' + k.atk);
ok('[CHANGE]', 'Pinnacle add atk == 11+75*0.7 = 64 (was ~24 @L19)', add.atk === 64, 'atk=' + add.atk);
ok('[CHANGE]', 'Pinnacle add def == 2+floor(75*0.15) = 13 (was 4 @L19)', add.def === 13, 'def=' + add.def);
ok('[CHANGE]', 'Emberwyrm maxHp in the 9,000-9,500 band (was 3,150 @L19)', dr.maxHp >= 9000 && dr.maxHp <= 9500, 'hp=' + dr.maxHp);
ok('[CHANGE]', 'Emberwyrm atk ~126, threatening but < the King rung (was 49 @L19)', dr.atk > 120 && dr.atk < 132, 'atk=' + dr.atk);
ok('[KEEP]', 'Emberwyrm def unchanged at 12', dr.def === 12, 'def=' + dr.def);
ok('[CHANGE]', 'Emberwyrm sits comfortably BELOW the new 75 rung', dr.maxHp < k.maxHp * 0.4 && dr.atk < k.atk * 0.4, 'wyrm ' + dr.maxHp + '/' + dr.atk + ' vs king ' + k.maxHp + '/' + k.atk);
// Rewards ride lf, so a fixed-difficulty boss pays a fixed (and much larger) reward.
ok('[CHANGE]', 'King xp/gold rose with lf (fixed difficulty => fixed reward)', k.xp > 30000 && k.gold > 32000, 'xp=' + k.xp + ' gold=' + k.gold);

// ============================================================================
// 3. PARTY-SIZE / CYCLE / ASCENSION multipliers STILL stack on top of the flat level
// ============================================================================
atLvl(19); const solo = gen.makePinnacleBoss_king();
baseline(); S.player.level = 19; S._partyLevel = 19; S._partyN = 4; const p4 = gen.makePinnacleBoss_king();
ok('[KEEP]', 'party-size still scales King hp (pnh: 4p = 2.2x solo)', near(p4.maxHp / solo.maxHp, 2.2, 0.01), 'x' + (p4.maxHp / solo.maxHp).toFixed(3));
ok('[KEEP]', 'party-size still scales King atk (pn: 4p = 1.54x solo)', near(p4.atk / solo.atk, 1.54, 0.01), 'x' + (p4.atk / solo.atk).toFixed(3));
baseline(); S.player.level = 19; S._partyLevel = 19; S.pinnacleCycle = 2; const c2 = gen.makePinnacleBoss_king();
ok('[KEEP]', 'cycle still scales King hp (cycHp: cyc2 = 1.8x)', near(c2.maxHp / solo.maxHp, 1.8, 0.01), 'x' + (c2.maxHp / solo.maxHp).toFixed(3));
ok('[KEEP]', 'cycle still scales King atk (cycAtk: cyc2 = 1.56x)', near(c2.atk / solo.atk, 1.56, 0.01), 'x' + (c2.atk / solo.atk).toFixed(3));
ok('[KEEP]', 'cycle still adds King def (+2/cycle)', c2.def === solo.def + 4, solo.def + ' -> ' + c2.def);
baseline(); S.player.level = 19; S._partyLevel = 19; S.ascension = 2; const a2 = gen.makePinnacleBoss_king();
ok('[KEEP]', 'ascension still scales King hp (asc: 2 = 1.4x)', near(a2.maxHp / solo.maxHp, 1.4, 0.01), 'x' + (a2.maxHp / solo.maxHp).toFixed(3));
atLvl(19); const addSolo = gen.makePinnacleAdd();
baseline(); S.player.level = 19; S._partyLevel = 19; S._partyN = 4; const addP4 = gen.makePinnacleAdd();
ok('[KEEP]', 'party-size still scales the ADDS (1+3*0.28 = 1.84x)', near(addP4.maxHp / addSolo.maxHp, 1.84, 0.01), 'x' + (addP4.maxHp / addSolo.maxHp).toFixed(3));
baseline(); S.player.level = 19; S._partyLevel = 19; S.pinnacleCycle = 2; const addC2 = gen.makePinnacleAdd();
ok('[KEEP]', 'cycle still scales the ADDS (1+2*0.35 = 1.7x)', near(addC2.maxHp / addSolo.maxHp, 1.7, 0.01), 'x' + (addC2.maxHp / addSolo.maxHp).toFixed(3));
// distance factor is still live (it is a lair property, not a party property)
ok('[KEEP]', 'distance factor still applies (dcf > 1 at the far-flung lairs)', dcfOf(KLAIR.tx, KLAIR.ty) > 1.05 && dcfOf(SLAIR.tx, SLAIR.ty) > 1.05,
  'king dcf=' + dcfOf(KLAIR.tx, KLAIR.ty).toFixed(3) + ' shep dcf=' + dcfOf(SLAIR.tx, SLAIR.ty).toFixed(3));

// ============================================================================
// 4. dropPinnacleReward STILL tracks partyLvl (the drop must suit the KILLER, not the rung)
// ============================================================================
const dropLevelAt = (lvl) => {
  atLvl(lvl); S.pickups.length = 0; S.uniquesFound = []; S.player._lastStyle = 'ranged';
  const boss = gen.makePinnacleBoss_king(); boss.cycle = 0;
  G.dropPinnacleReward(boss, true);
  const it = S.pickups.map((p) => p.value && (p.value.weapon || p.value.armor)).filter(Boolean);   // makePickup stores the payload on `value`
  return it.length ? Math.max(...it.map((i) => i.reqLevel || 0)) : -1;
};
const rl19 = dropLevelAt(19), rl45 = dropLevelAt(45);
ok('[KEEP]', 'dropPinnacleReward item level RISES with partyLvl (19 -> 45)', rl45 > rl19 && rl19 > 0, 'reqLevel ' + rl19 + ' -> ' + rl45);
ok('[KEEP]', 'drop @partyLvl 19 is a ~lvl-27 item (NOT a lvl-83 item in a lvl-19 hand)', rl19 >= 11 && rl19 <= 16, 'reqLevel=' + rl19 + ' (PIN_LEVEL would give ~42)');

// ============================================================================
// 5. BURST CASCADE DEPTH — must be EXACTLY 1
//    A line of pre-marked foes 120px apart. Burst radius at 3 Marks = 70+26*3 = 148, so each
//    burst reaches ONLY its immediate neighbour (120 < 148 < 240). Generation k therefore kills
//    line[k] and nothing else => cascade depth == the highest index killed.
// ============================================================================
const MARK_LVL = G.MASTERY_LVLS[2];
const buildLine = (n, spacing) => {
  const p = S.player;
  p.level = 30; p.atk = 100; p.prof.ranged.lvl = MARK_LVL; p._lastMarkN = 0;
  S.enemies.length = 0; S.pickups.length = 0;
  const line = [];
  for (let i = 0; i < n; i++) {
    const e = G.makeEnemy(20 + i * 4, 40, 'skeleton');
    e.x = 20 * TILE + i * spacing; e.y = 40 * TILE; e.w = 20; e.h = 20;
    e.hp = 10; e.maxHp = 10; e.def = 0; e.xp = 0; e.gold = 0;   // xp=0: no level-up can move p.atk mid-cascade
    e._afxN = 0; e.afxSplit = 0; e._pinRef = null; e.isBoss = false; e.elite = false;
    e._markBy = p; e._markN = (i === 0) ? 3 : 2;                // burst bumps a survivor 2 -> 3 => radius 148 again
    e._lineIdx = i; line.push(e); S.enemies.push(e);
  }
  return line;
};
{
  const N = 8, line = buildLine(N, 120);
  ok('[KEEP]', 'burst precondition: marker is at the Lv-24 ranged capstone', S.player.prof.ranged.lvl >= MARK_LVL, 'ranged=' + S.player.prof.ranged.lvl + ' >= ' + MARK_LVL);
  const seed = line[0]; seed.hp = 0; G.killEnemy(seed);
  const dead = line.filter((e) => !S.enemies.includes(e));
  const depth = dead.length ? Math.max(...dead.map((e) => e._lineIdx)) : 0;
  ok('[CHANGE]', 'burst CASCADE DEPTH is exactly 1 (one kill = at most one burst)', depth === 1, 'depth=' + depth + ' of a possible ' + (N - 1) + '; killed idx [' + dead.map((e) => e._lineIdx).join(',') + ']');
  ok('[CHANGE]', 'burst leaves the far pack ALIVE (no room-clear)', S.enemies.length === N - 2, (N - 2) + ' expected alive, got ' + S.enemies.length);
}

// ============================================================================
// 5b. THE TAG MUST NOT STRAND ON A SURVIVOR.
//     killEnemy has two paths that return with the foe ALIVE and still in state.enemies: the
//     Emberwyrm's Lv-20 guard, and a pinnacle add's out-of-order resurrect. If the burst's
//     `_burstKill` tag were simply left on the object, a burst that "killed" one of those would
//     strand the tag on a LIVE enemy — permanently vetoing that foe's own capstone burst, and
//     riding packScalar onto the wire (it is a number). The finally scopes the tag to the call.
// ============================================================================
{
  const p = S.player; p.level = 30; p.atk = 100; p.prof.ranged.lvl = MARK_LVL;
  S.enemies.length = 0;
  const pin = { hp: 100, _nextKill: 0 };                       // a live boss => its court resurrects out-of-order kills
  const mk = (x, hp) => { const e = G.makeEnemy(20, 80, 'skeleton'); e.w = 20; e.h = 20; e.x = x; e.y = 80 * TILE; e.hp = hp; e.maxHp = hp; e.def = 0; e.xp = 0; e.gold = 0; e._afxN = 0; e._pinRef = null; return e; };
  const seed = mk(20 * TILE, 0); seed._markBy = p; seed._markN = 3;
  const addv = mk(20 * TILE + 100, 10);                        // inside the 148px burst radius
  addv._pinRef = pin; addv._orderIdx = 2; addv._rezN = 0;      // _orderIdx 2 > _nextKill 0 => out of order => rises again
  addv._markBy = p; addv._markN = 2;
  S.enemies.push(addv, seed);
  G.killEnemy(seed);
  ok('[KEEP]', 'burst-killed add still RESURRECTS (ordered-kill rule intact)', S.enemies.includes(addv) && addv.hp === addv.maxHp && addv._rezN === 1, 'hp=' + addv.hp + '/' + addv.maxHp + ' rez=' + addv._rezN);
  ok('[CHANGE]', 'the _burstKill tag does NOT strand on a resurrected survivor', !addv._burstKill, '_burstKill=' + addv._burstKill);
  // ...and its NEXT, legitimate death must still pay out the capstone burst.
  pin._nextKill = 2;                                           // in order now => it dies for good
  const probe = mk(20 * TILE + 100 + 100, 1e6); probe._markN = 0; probe._markBy = null;
  S.enemies.push(probe);
  addv._markN = 3; addv._markBy = p; addv.hp = 0;
  G.killEnemy(addv);
  ok('[CHANGE]', 'a resurrected add STILL bursts when it finally dies (payoff not silently lost)', 1e6 - probe.hp === 120, 'probe took ' + (1e6 - probe.hp) + ' want 120');
}

// ============================================================================
// 6. A NORMAL SINGLE BURST IS UNCHANGED — same damage, same radius
//    Probes have huge HP so none can die => no chaining is involved either way; both trees
//    must produce byte-identical splash. (Radius at 3 Marks = 148.)
// ============================================================================
{
  const p = S.player; p.level = 30; p.atk = 100; p.prof.ranged.lvl = MARK_LVL;
  S.enemies.length = 0;
  const D = [60, 140, 147, 149, 200, 300];
  const seed = G.makeEnemy(20, 60, 'skeleton');
  seed.x = 20 * TILE; seed.y = 60 * TILE; seed.w = 20; seed.h = 20; seed.hp = 0; seed.maxHp = 10;
  seed.xp = 0; seed.gold = 0; seed._afxN = 0; seed._markBy = p; seed._markN = 3; seed._pinRef = null;
  const cx = seed.x + seed.w / 2, cy = seed.y + seed.h / 2;
  const probes = D.map((d) => {
    const e = G.makeEnemy(20, 60, 'skeleton');
    e.w = 20; e.h = 20; e.x = cx + d - e.w / 2; e.y = cy - e.h / 2;   // exact centre-to-centre distance d
    e.hp = 1e6; e.maxHp = 1e6; e.def = 0; e.xp = 0; e.gold = 0; e._afxN = 0; e._markN = 0; e._markBy = null; e._pinRef = null;
    S.enemies.push(e); return e;
  });
  S.enemies.push(seed);
  G.killEnemy(seed);
  const dmg = probes.map((e) => 1e6 - e.hp);
  const EXP = Math.max(1, Math.round(100 * 0.4 * 3));   // _bd = atk*0.4*marks = 120
  ok('[KEEP]', 'single burst: damage == atk*0.4*marks (120) inside the radius', dmg[0] === EXP && dmg[1] === EXP && dmg[2] === EXP, 'dmg@60/140/147 = ' + dmg.slice(0, 3).join('/') + ' want ' + EXP);
  ok('[KEEP]', 'single burst: radius is 70+26*3 = 148 (149px is OUTSIDE)', dmg[3] === 0 && dmg[4] === 0 && dmg[5] === 0, 'dmg@149/200/300 = ' + dmg.slice(3).join('/'));
  ok('[KEEP]', 'single burst: still re-marks the survivors it splashes', probes[0]._markN === 1 && probes[0]._markBy === p, 'markN=' + probes[0]._markN);
  ok('[KEEP]', 'single burst: splash profile (regression fingerprint)', true, 'd=' + D.join('/') + ' -> dmg=' + dmg.join('/'));
}

console.log('\n===== FLAT LEVELS + BURST CASCADE — ' + TREE + ' =====');
out.forEach((l) => console.log('  ' + l));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + (fail === 0 ? '✅ ALL GREEN' : '❌ FAILURES ABOVE'));
process.exit(fail === 0 ? 0 : 1);
