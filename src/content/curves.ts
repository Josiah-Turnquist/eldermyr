// src/content/curves.ts — the scaling-curve registry (P3/S11; v3.1.0 level-driven rebuild).
//
// v3.1.0 — THE MAP SETS THE DANGER, NOT YOUR XP BAR. Rank-and-file enemies (wild overworld,
// regular dungeon minions + floor bosses, Citadel guards) now carry a real integer `level` and
// derive hp/atk/def from it through ONE curve — player level no longer touches enemy stats,
// type selection, or rewards. Two level SOURCES: owLevel(distFactor) for the overworld (danger
// rises with distance from home) and dungeonLevel(depth) underground (danger rises with depth);
// rifts reuse dungeonLevel (rift depth IS dungeon depth). The unified stat curve takes each
// kind's BASE stat (enemies.ts) and the level, and returns the final value — Math.round lives
// INSIDE these fns now (the value is the whole point; nothing downstream re-rounds a factor).
// Rewards ride the ENEMY's level (frontier still pays — now tile-driven, not player-driven).
// The old player-scaled wildStat/wildXp/wildGold/dungeonStat/dungeonBossStat are DELETED, and
// with them the biome ×1.3/×1.6 stat bump (biome still selects TYPE + applies frost/lava on-hit).
// ascMul stays: ascension (a NG+ knob, not player level) multiplies the final dungeon hp/atk.
//
// Content can't read state, so ascension/df/level/base arrive as args. Pure fns, ONE source —
// the battery evaluates these directly (content-purity 5z4/5z5), golden/mp prove them live.
import type { CurveRegistry } from './types';

// The ascension multiplier — the dungeon NG+ knob (NOT player level). Multiplies the final
// dungeon-enemy hp/atk (applied at the factory call site). ONE source: CURVES.ascMul below.
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
  // ── LEVEL SOURCES ────────────────────────────────────────────────────────────────────────
  // Overworld enemy level from distFactor (linear 0..1). Home (df 0) is L1 and STAYS L1 forever;
  // the deep frontier is L~75. Anchors: .10→L3, .30→L13, .58→L34, .90→L64, 1.0→L75.
  owLevel(df: number): number {
    return 1 + Math.round(Math.pow(df, 1.5) * 74);
  },
  // Dungeon (and rift) enemy level from depth. floor1→L5, 10→L32, 20→L62.
  dungeonLevel(depth: number): number {
    return 2 + depth * 3;
  },
  // ── THE UNIFIED RANK-AND-FILE STAT CURVE ─────────────────────────────────────────────────
  // Each takes the KIND's base stat + the enemy's level, returns the final (rounded) value.
  // def is additive (a flat pool grows slowly with level — the damage path is atk−def with a
  // hard Math.max(1,…) floor, so def never makes a foe unkillable, it just makes armor matter).
  // v3.2.2 — the rank-and-file per-level scaling DOUBLED (hp 0.35→0.70, atk 0.18→0.36) so distance
  // and depth bite harder: L1 is unchanged (base), but the climb above base grows twice as fast.
  // def (0.22) is deliberately LEFT as-is — doubling armor too would make high-level foes tedious
  // sponges (the damage path is atk−def, hard-floored at 1). Rewards (xp/gold slopes below) also
  // unchanged. Apex uniques (dragon/kraken/pinnacle/hunts/Archivist) are bespoke, so untouched.
  hpForLevel(base: number, L: number): number {
    return Math.round(base * (1 + (L - 1) * 0.7));
  },
  atkForLevel(base: number, L: number): number {
    return Math.round(base * (1 + (L - 1) * 0.36));
  },
  defForLevel(base: number, L: number): number {
    return base + Math.round((L - 1) * 0.22);
  },
  // Rewards ride the ENEMY's level: XP the full 0.26 slope, gold a gentler 0.10 (gold has other
  // faucets — tribute, trade, bounties, loot-sale). Dungeon layers dungeonXpMul/dungeonGoldMul ON TOP.
  xpForEnemyLevel(baseXp: number, L: number): number {
    return Math.round(baseXp * (1 + (L - 1) * 0.26));
  },
  goldForEnemyLevel(baseGold: number, L: number): number {
    return Math.round(baseGold * (1 + (L - 1) * 0.1));
  },
  ascMul,
  // The dungeon grind premium (+40% XP / +25% gold over the surface).
  dungeonXpMul: 1.4,
  dungeonGoldMul: 1.25,
};
