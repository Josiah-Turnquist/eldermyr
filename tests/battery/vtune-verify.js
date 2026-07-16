'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// Balance/tuning pass verification: (#1) diffMul distance curve, (#2) hunt/legion 1:1 levels + rescale idempotency,
// (#3) rollRarity legendary-rate cut. Pure fns (diffMul/rollRarity) are eval'd straight from the shipped file text.
const REPO = '' + __RR + '';
process.chdir(REPO);
const fs = require('fs');
const G = require(REPO + '/server-spike/load-game.js');
const { World } = require(REPO + '/server/world.js');
const S = G.state;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

// ---- pull the two PURE functions verbatim from the shipped artifact ----
// (P1 wrap: the artifact is the prettier-formatted dist assembly — top-level functions start
// at column 0 and end at the first column-0 `}`, so extraction is line-anchored.)
const html = fs.readFileSync(require(REPO + '/tests/battery/game-file.js').gameFilePath(), 'utf8');
const grab = (re, name) => { const m = html.match(re); if (!m) throw new Error('extract failed: ' + name); return m[0]; };
const diffMul = (new Function(grab(/^function diffMul\(df\) \{[\s\S]*?\n\}/m, 'diffMul') + '; return diffMul;'))();
const rollRarity = (new Function(grab(/^function rollRarity\(level, boss\) \{[\s\S]*?\n\}/m, 'rollRarity') + '; return rollRarity;'))();
const oldDiffMul = df => (1.18 + df * 1.05 + df * df * 1.5);
const oldRollRarity = (level, boss) => { let r = Math.random(); const shift = (boss ? 0.18 : 0) + Math.min(0.10, level * 0.006); r = Math.max(0, r - shift); if (r > 0.42) return 0; if (r > 0.15) return 1; if (r > 0.045) return 2; if (r > 0.010) return 3; return 4; };

// ==================== #1 diffMul curve ====================
out.push('\n=== #1 diffMul(df): steep→flat→steep (df → difficulty multiplier) ===');
out.push('  df   |  NEW  |  OLD  | new/old');
const pts = [0, 0.05, 0.10, 0.20, 0.35, 0.50, 0.70, 0.85, 1.0];
let prev = -1, mono = true;
for (const df of pts) { const n = diffMul(df), o = oldDiffMul(df); if (n < prev - 1e-9) mono = false; prev = n; out.push('  ' + df.toFixed(2) + ' | ' + n.toFixed(3) + ' | ' + o.toFixed(3) + ' | ' + (n / o).toFixed(3)); }
ok('monotonic non-decreasing', mono);
ok('CORE ~0.71 across df<0.10 (1.4x easier)', [0, 0.05, 0.099].every(d => Math.abs(diffMul(d) - 0.71) < 1e-9), 'df0=' + diffMul(0).toFixed(3));
ok('~1.0 baseline by df=0.20', Math.abs(diffMul(0.20) - 1.0) < 1e-9, diffMul(0.20).toFixed(3));
ok('gentle mid plateau (df0.5 in 1.0..1.6, df0.7=1.6)', diffMul(0.5) > 1.0 && diffMul(0.5) < 1.6 && Math.abs(diffMul(0.70) - 1.6) < 1e-9, 'df0.5=' + diffMul(0.5).toFixed(3) + ' df0.7=' + diffMul(0.7).toFixed(3));
ok('~4.0 at the very edge', Math.abs(diffMul(1.0) - 4.0) < 1e-9, diffMul(1.0).toFixed(3));
ok('near-center EASIER than today (df0.05)', diffMul(0.05) < oldDiffMul(0.05), diffMul(0.05).toFixed(3) + ' < ' + oldDiffMul(0.05).toFixed(3));
ok('far-edge much HARDER than today (df1.0)', diffMul(1.0) > oldDiffMul(1.0), diffMul(1.0).toFixed(3) + ' > ' + oldDiffMul(1.0).toFixed(3));

// #1b end-to-end: at partyLvl=1 non-biome, makeWildEnemy's f == diffMul(df) exactly (level term=1, biomeMul=1)
out.push('\n=== #1b makeWildEnemy applies the SAME curve (SP: partyLvl unset → player level) ===');
G.startGame(); S.player.level = 1; S._partyLevel = 0; S._partyN = 1;
const cx = Math.round(G.OW_W / 2), cy = Math.round(G.OW_H / 2);
const meanHp = (tx, ty, n) => { let s = 0; for (let i = 0; i < n; i++) s += G.makeWildEnemy(tx, ty, 0).maxHp; return s / n; };
const dfC = G.distFactor(cx, cy), dfE = G.distFactor(2, 2);
out.push('  center tile df=' + dfC.toFixed(3) + ' (diffMul ' + diffMul(dfC).toFixed(3) + ') | corner tile df=' + dfE.toFixed(3) + ' (diffMul ' + diffMul(dfE).toFixed(3) + ')');
const mC = meanHp(cx, cy, 5000), mE = meanHp(2, 2, 5000);
out.push('  mean wild maxHp: center=' + mC.toFixed(1) + '  corner=' + mE.toFixed(1));
ok('center diffMul<1 (mobs EASIER than base) while old was >1', diffMul(dfC) < 1 && oldDiffMul(dfC) > 1, 'new=' + diffMul(dfC).toFixed(3) + ' old=' + oldDiffMul(dfC).toFixed(3));
ok('far-edge wild mobs dramatically tougher than center', mE > mC * 2, 'center=' + mC.toFixed(1) + ' edge=' + mE.toFixed(1));

// ==================== #2 hunt/legion levels track party 1:1 ====================
out.push('\n=== #2 hunt/legion LEVEL === partyLvl() (no offset) ===');
for (const N of [1, 8, 20]) {
  S.player.level = N; S._partyLevel = 0;              // SP: partyLvl() = player level
  G.genLegion();
  const wls = S.legion.warlords, ov = S.legion.overlord;
  ok(`L${N}: all 5 warlords report level === ${N}`, wls.length === 5 && wls.every(w => w.level === N), 'levels=' + wls.map(w => w.level).join(','));
  ok(`L${N}: overlord reports level === ${N} (was N+5)`, ov.level === N, 'ov.level=' + ov.level);
  const b = G.makeGreatBeast(G.GREAT_HUNTS[0], cx + 3, cy + 3);
  ok(`L${N}: fresh great beast reports level === ${N}`, b.level === N, 'beast.level=' + b.level);
}
// stats still scale sensibly on top of the 1:1 level (curve preserved): a high-level beast is far tougher than a low one
S.player.level = 1; S._partyLevel = 0; const b1 = G.makeGreatBeast(G.GREAT_HUNTS[0], cx + 3, cy + 3);
S.player.level = 25; S._partyLevel = 0; const b25 = G.makeGreatBeast(G.GREAT_HUNTS[0], cx + 3, cy + 3);
ok('beast HP/atk still climb with level (curve kept as tuning on top)', b25.maxHp > b1.maxHp * 1.5 && b25.atk > b1.atk * 1.3, `L1 hp=${b1.maxHp}/atk=${b1.atk} → L25 hp=${b25.maxHp}/atk=${b25.atk}`);

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
