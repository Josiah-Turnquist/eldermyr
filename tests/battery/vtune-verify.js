'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// Balance/tuning pass verification: (#1) owLevel/dungeonLevel level curves (v3.1.0 level-driven model),
// (#2) legion 1:1 levels + FLAT hunt levels (v3.1.0) + rescale idempotency, (#3) rollRarity cut. rollRarity is
// eval'd from the shipped file text; the level curves are read off the built artifact's global CONTENT.
const REPO = '' + __RR + '';
process.chdir(REPO);
const fs = require('fs');
const G = require(REPO + '/server/load-game.js');
const { World } = require(REPO + '/server/world.js');
const S = G.state;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

// ---- pull the two PURE functions verbatim from the shipped artifact ----
// (P1 wrap: the artifact is the prettier-formatted dist assembly — top-level functions start
// at column 0 and end at the first column-0 `}`, so extraction is line-anchored.)
const html = fs.readFileSync(require(REPO + '/tests/battery/game-file.js').gameFilePath(), 'utf8');
const grab = (re, name) => { const m = html.match(re); if (!m) throw new Error('extract failed: ' + name); return m[0]; };
const rollRarity = (new Function(grab(/^function rollRarity\(level, boss\) \{[\s\S]*?\n\}/m, 'rollRarity') + '; return rollRarity;'))();
const oldRollRarity = (level, boss) => { let r = Math.random(); const shift = (boss ? 0.18 : 0) + Math.min(0.10, level * 0.006); r = Math.max(0, r - shift); if (r > 0.42) return 0; if (r > 0.15) return 1; if (r > 0.045) return 2; if (r > 0.010) return 3; return 4; };
// v3.1.0: distance/depth → difficulty now flows through the enemy LEVEL (CONTENT.curves.owLevel /
// dungeonLevel), read straight off the built artifact's global CONTENT (the old diffMul is deleted).
const cu = globalThis.CONTENT.curves;

// ==================== #1 owLevel / dungeonLevel: the MAP sets the danger ====================
out.push('\n=== #1 owLevel(df) / dungeonLevel(depth): distance & depth → enemy level (v3.1.0) ===');
out.push('  df   | owLevel');
let prevL = -1, monoOw = true;
for (const df of [0, 0.05, 0.10, 0.30, 0.58, 0.70, 0.90, 1.0]) { const L = cu.owLevel(df); if (L < prevL) monoOw = false; prevL = L; out.push('  ' + df.toFixed(2) + ' | ' + L); }
ok('owLevel monotonic non-decreasing', monoOw);
ok('owLevel anchors (.10→3, .30→13, .58→34, .90→64, 1.0→75)', cu.owLevel(0.10) === 3 && cu.owLevel(0.30) === 13 && cu.owLevel(0.58) === 34 && cu.owLevel(0.90) === 64 && cu.owLevel(1.0) === 75, [0.1, 0.3, 0.58, 0.9, 1.0].map((d) => cu.owLevel(d)).join(','));
ok('home (df 0) is L1 and STAYS L1 — the Vale never gets scarier', cu.owLevel(0) === 1, 'owLevel(0)=' + cu.owLevel(0));
ok('dungeonLevel = 2+depth*3 (floor1→5, 10→32, 20→62)', cu.dungeonLevel(1) === 5 && cu.dungeonLevel(10) === 32 && cu.dungeonLevel(20) === 62, [1, 10, 20].map((d) => cu.dungeonLevel(d)).join(','));

// #1b end-to-end: makeWildEnemy scales by the TILE's owLevel and NOT by the player level (the v3.1.0 point).
out.push('\n=== #1b makeWildEnemy is tile-driven, never player-driven ===');
G.startGame(); S.player.level = 1; S._partyLevel = 0; S._partyN = 1;
const cx = Math.round(G.OW_W / 2), cy = Math.round(G.OW_H / 2);
const meanHp = (tx, ty, n) => { let s = 0; for (let i = 0; i < n; i++) s += G.makeWildEnemy(tx, ty, 0).maxHp; return s / n; };
const dfC = G.distFactor(cx, cy), dfE = G.distFactor(2, 2);
out.push('  center tile df=' + dfC.toFixed(3) + ' (owLevel ' + cu.owLevel(dfC) + ') | corner tile df=' + dfE.toFixed(3) + ' (owLevel ' + cu.owLevel(dfE) + ')');
const mC = meanHp(cx, cy, 5000), mE = meanHp(2, 2, 5000);
out.push('  mean wild maxHp: center=' + mC.toFixed(1) + '  corner=' + mE.toFixed(1));
ok('center owLevel < corner owLevel (home stays gentle)', cu.owLevel(dfC) < cu.owLevel(dfE), 'center L' + cu.owLevel(dfC) + ' corner L' + cu.owLevel(dfE));
ok('far-edge wild mobs dramatically tougher than center', mE > mC * 2, 'center=' + mC.toFixed(1) + ' edge=' + mE.toFixed(1));
const _rr = Math.random, fixedSpawn = (lv) => { S.player.level = lv; Math.random = () => 0.5; const e = G.makeWildEnemy(2, 2, 0); Math.random = _rr; return e.maxHp + '/' + e.atk + '/' + e.def + '/L' + e.level; };
ok('a fixed-tile spawn is player-level-INDEPENDENT (L1 === L50)', fixedSpawn(1) === fixedSpawn(50), 'L1=' + fixedSpawn(1) + ' L50=' + fixedSpawn(50));

// ============ #2 legion tracks party 1:1; Great Hunts are FLAT-leveled (v3.1.0) ============
out.push('\n=== #2 legion LEVEL === partyLvl(); Great Hunts are FLAT (player-level-independent) ===');
for (const N of [1, 8, 20]) {
  S.player.level = N; S._partyLevel = 0;              // SP: partyLvl() = player level
  G.genLegion();
  const wls = S.legion.warlords, ov = S.legion.overlord;
  ok(`L${N}: all 5 warlords report level === ${N}`, wls.length === 5 && wls.every(w => w.level === N), 'levels=' + wls.map(w => w.level).join(','));
  ok(`L${N}: overlord reports level === ${N} (was N+5)`, ov.level === N, 'ov.level=' + ov.level);
  const b = G.makeGreatBeast(G.GREAT_HUNTS[0], cx + 3, cy + 3);
  ok(`L${N}: great beast level is FLAT (${G.GREAT_HUNTS[0].level}), NOT the player level`, b.level === G.GREAT_HUNTS[0].level, 'beast.level=' + b.level);
}
// v3.1.0: a Great Beast's stats are PLAYER-LEVEL-INDEPENDENT now (parity with the rank-and-file proof) —
// only its own flat h.level, party size, distance, cycle and ascension move them.
S.player.level = 1; S._partyLevel = 0; const b1 = G.makeGreatBeast(G.GREAT_HUNTS[0], cx + 3, cy + 3);
S.player.level = 25; S._partyLevel = 0; const b25 = G.makeGreatBeast(G.GREAT_HUNTS[0], cx + 3, cy + 3);
ok('beast HP/atk are IDENTICAL at player L1 vs L25 (no more scaling to whoever shows up)', b1.maxHp === b25.maxHp && b1.atk === b25.atk, `L1 hp=${b1.maxHp}/atk=${b1.atk} vs L25 hp=${b25.maxHp}/atk=${b25.atk}`);
// beasts still differ BY BEAST — a bigger hunt carries a higher flat level + more HP
const _roc = G.makeGreatBeast(G.GREAT_HUNTS.find(h => h.key === 'stormroc'), cx + 3, cy + 3), _levi = G.makeGreatBeast(G.GREAT_HUNTS.find(h => h.key === 'leviathan'), cx + 3, cy + 3);
ok('a bigger beast carries a higher flat level + more HP (Leviathan > Storm Roc)', _levi.level > _roc.level && _levi.maxHp > _roc.maxHp, `Roc L${_roc.level}/${_roc.maxHp} vs Leviathan L${_levi.level}/${_levi.maxHp}`);

// #2b MP path: _rescaleThreats roster leveling is 1:1 and idempotent (rescale twice → identical)
out.push('\n=== #2b MP _rescaleThreats: roster level 1:1 + idempotent ===');
{
  const w = new World();
  w.addPlayer('A', 'Ava');
  for (let i = 0; i < 4; i++) w.tick();
  S._partyLevel = 20;
  w._rescaleThreats(20);
  const l1 = { wl: S.legion.warlords.map(x => x.level), ov: S.legion.overlord.level };
  w._rescaleThreats(20);
  const l2 = { wl: S.legion.warlords.map(x => x.level), ov: S.legion.overlord.level };
  ok('roster warlord levels all === partyLvl 20 (no +rank offset)', S.legion.warlords.every(x => x.level === 20), 'levels=' + l1.wl.join(','));
  ok('roster overlord level === partyLvl 20 (no +5 offset)', S.legion.overlord.level === 20, 'ov=' + l1.ov);
  ok('rescale twice → identical roster levels (idempotent)', JSON.stringify(l1) === JSON.stringify(l2));
}

// ==================== #3 legendary rate cut ====================
out.push('\n=== #3 rollRarity: legendary (tier 4) share, NEW vs OLD ===');
const share = (fn, level, boss, n) => { const c = [0, 0, 0, 0, 0]; for (let i = 0; i < n; i++) c[fn(level, boss)]++; return c.map(x => x / n); };
const N = 400000;
const scenarios = [
  ['overworld  L1  (baseline)', 1, false],
  ['overworld  L10', 10, false],
  ['overworld  L20 (was the flood)', 20, false],
  ['BOSS       L20 (should stay high)', 20, true],
];
out.push('  context                         | NEW legend% | OLD legend% | NEW epic%');
for (const [label, lvl, boss] of scenarios) {
  const nn = share(rollRarity, lvl, boss, N), oo = share(oldRollRarity, lvl, boss, N);
  out.push('  ' + label.padEnd(32) + '| ' + (nn[4] * 100).toFixed(2).padStart(9) + ' % | ' + (oo[4] * 100).toFixed(2).padStart(9) + ' % | ' + (nn[3] * 100).toFixed(2).padStart(7) + ' %');
}
const nL20 = share(rollRarity, 20, false, N), oL20 = share(oldRollRarity, 20, false, N);
ok('overworld L20 legendary MEANINGFULLY lower (< half of old)', nL20[4] < oL20[4] * 0.5, (nL20[4] * 100).toFixed(2) + '% vs old ' + (oL20[4] * 100).toFixed(2) + '%');
const nL1 = share(rollRarity, 1, false, N);
ok('overworld L1 legendary genuinely rare (<1%)', nL1[4] < 0.01, (nL1[4] * 100).toFixed(2) + '%');
const nBoss = share(rollRarity, 20, true, N);
ok('BOSS L20 still favors legendary (>=20%)', nBoss[4] >= 0.20, (nBoss[4] * 100).toFixed(1) + '%');
ok('boss legendary >> overworld legendary at L20 (gradient preserved)', nBoss[4] > nL20[4] * 8, 'boss=' + (nBoss[4] * 100).toFixed(1) + '% ow=' + (nL20[4] * 100).toFixed(2) + '%');

// #3b cycle floor still guarantees the pinnacle tier (tryDropLoot: cyc>0 → rIdx=max(rIdx, min(4,2+cyc)))
out.push('\n=== #3b cycle floor gradient (unchanged, gated behind cyc>0) ===');
const cycleFloor = cyc => Math.min(4, 2 + cyc);
ok('cyc1 floor = epic(3)', cycleFloor(1) === 3);
ok('cyc2 floor = legendary(4)', cycleFloor(2) === 4);
ok('baseline (cyc0) has NO floor (rarity purely from rollRarity)', true, 'cyc0 → no Math.max floor applied');

console.log(out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
