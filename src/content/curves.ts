// src/content/curves.ts — the scaling-curve registry (P3/S11).
//
// The level/distance FORMULAS from xpForLevel (p12) and the makeWildEnemy/makeDungeonEnemy/
// makeDungeonBoss stat+reward factors (p03). EXTRACTION ONLY — identical math, identical operator
// order, identical rounding. Math.round stays at the CALL SITE (the factory); only the raw FACTOR
// expression lives here, so the float result and both oracles are BYTE-UNTOUCHED (proven by golden/mp,
// which spawn+level every trajectory). Content can't read state, so ascension/df/level ride in as args;
// the RNG draws (type roll, pool pick) stay in the factories.
//
// #113 (F1) LANDED here: the overworld reward split into wildXp/wildGold, each gaining a level term
// (XP the full 0.26 stat slope, gold a gentler 0.10) — a DESIGNED oracle re-record (the ONE tuning
// change this slice makes; everything else stays byte-frozen). Formulas-as-data, ONE source (the
// rebuild-from-generator rule) — the battery evaluates these fns directly, never a mirror.
import type { CurveRegistry } from './types';

// The ascension multiplier — shared by dungeon enemies (inside dungeonStat) and the dungeon boss's
// `asc` local. ONE source: CURVES.ascMul below is this same function reference.
function ascMul(ascension: number): number {
  return 1 + ascension * 0.2;
}

export const CURVES: CurveRegistry = {
  // p12 VERBATIM: base 22, ×1.58 +6 per level, then the early front-load surcharge (+45% at L1 → 0 by L7+).
  xpForLevel(L: number): number {
    let base = 22;
    for (let i = 2; i <= L; i++) base = Math.floor(base * 1.58) + 6;
    return Math.round(base * (1 + Math.max(0, (0.45 * (7 - L)) / 6)));
  },
  // makeWildEnemy `f` — the diffMul(df) result rides in as `diff` (diffMul stays in-part).
  wildStat(lvl: number, biomeMul: number, diff: number): number {
    return (1 + (lvl - 1) * 0.26) * biomeMul * diff;
  },
  // makeWildEnemy reward factors — #113/F1 (DESIGNED re-record): the overworld reward curve gained a
  // LEVEL term. Before, wild rewards scaled ONLY by biome+distance `biomeMul*(1+df+df²*1.3)` with NO
  // level term, so a level-30 hero fighting a stat-scaled (spongier) Frontier foe was paid the SAME
  // as a level-1 hero — high-level overworld play stopped rewarding. Now XP scales the FULL wild-STAT
  // level slope (0.26, parity with wildStat above) and gold a GENTLER 0.10 slope (gold has other
  // faucets: tribute, trade, bounties, loot-sale — so its curve stays flatter). The two slopes are
  // owner-tunable knobs; `lvl` = partyLvl() at spawn, threaded in from makeWildEnemy. At level 1 both
  // terms are ×1, so the L1 reward is byte-identical to the pre-F1 curve (the divergence starts at L2).
  wildXp(biomeMul: number, df: number, lvl: number): number {
    return biomeMul * (1 + df * 1.0 + df * df * 1.3) * (1 + (lvl - 1) * 0.26);
  },
  wildGold(biomeMul: number, df: number, lvl: number): number {
    return biomeMul * (1 + df * 1.0 + df * df * 1.3) * (1 + (lvl - 1) * 0.1);
  },
  ascMul,
  // makeDungeonEnemy `f`.
  dungeonStat(level: number, ascension: number): number {
    return (1 + (level - 1) * 0.4) * ascMul(ascension);
  },
  // The dungeon grind premium (+40% XP / +25% gold).
  dungeonXpMul: 1.4,
  dungeonGoldMul: 1.25,
  // makeDungeonBoss `f` — `asc` = ascMul(ascension) is computed in-part (reused for its atk); base stat
  // literals (90/12+level*2.2/4+level/100/200) stay in the factory.
  dungeonBossStat(level: number, asc: number): number {
    return (1 + (level - 1) * 0.55) * asc;
  },
};
