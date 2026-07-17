// src/content/companions.ts — the warband registry (P3/S9).
//
// COMP_CLASSES/COMP_NAMES/COMP_CAP/compStatsFor (src/game/parts/p04-drawPOI.js) → DATA + the
// level-scaling formula. p04 keeps positional aliases at the old declaration lines (COMP_CLASSES is
// read by p04/p05/p07, COMP_NAMES by p04, COMP_CAP by p04/p05, compStatsFor by p04), so no call site
// changes and nothing external captures these symbols (world.js only mentions COMP_CAP in a comment).
//
// Tiers-ready for #115 (warband economy, F2): `statsFor` takes a `tier` param (default 0) and each
// class carries a `tiers` array whose tiers[0] is T1 = today's numbers EXACTLY (statMul 1). Byte-
// identical at tier 0: `x * 1 === x` for every finite double, so `Math.round(baseHp * f * 1)` equals
// the old `Math.round(baseHp * f)` to the bit. F2 adds tiers[1]/tiers[2] + hire/upkeep — one row each.
import type { CompanionClass, CompanionRegistry, CompanionStats } from './types';

const T1 = [{ statMul: 1 }] as const; // the sole tier today — T1 identity (#115/F2 appends T2/T3)

const CLASSES: Record<string, CompanionClass> = {
  knight: {
    name: 'Knight',
    color: '#cdd0e6',
    baseHp: 120,
    baseAtk: 11,
    baseDef: 6,
    range: 42,
    melee: true,
    speed: 1.5,
    hire: 200,
    icon: '⚔',
    desc: 'Stalwart melee — wades in and soaks blows.',
    tiers: T1,
  },
  ranger: {
    name: 'Ranger',
    color: '#9bd56a',
    baseHp: 78,
    baseAtk: 10,
    baseDef: 2,
    range: 250,
    melee: false,
    speed: 1.6,
    hire: 200,
    icon: '➶',
    desc: 'Looses arrows from range; keeps her distance.',
    tiers: T1,
  },
  mage: {
    name: 'Mage',
    color: '#b886ff',
    baseHp: 64,
    baseAtk: 13,
    baseDef: 1,
    range: 220,
    melee: false,
    speed: 1.4,
    hire: 240,
    icon: '✦',
    desc: 'Hurls piercing arcane bolts; fragile.',
    tiers: T1,
  },
};

const NAMES: readonly string[] = [
  'Sera',
  'Brom',
  'Kael',
  'Lyra',
  'Dorn',
  'Wren',
  'Talia',
  'Garrick',
  'Mira',
  'Osric',
  'Fenn',
  'Isolde',
  'Rurik',
  'Esme',
  'Joss',
  'Nadia',
];

export const COMPANIONS: CompanionRegistry = {
  classes: CLASSES,
  names: NAMES,
  cap: 3,
  // compStatsFor(cls, level) VERBATIM at tier 0. `f` is the shared level ramp; `mul` = tiers[tier].statMul
  // (1 today, so `baseHp * f * 1` === `baseHp * f`). def is the additive ramp, tier-independent for now.
  statsFor(cls: string, level: number, tier = 0): CompanionStats {
    const C = CLASSES[cls] || CLASSES.knight;
    const f = 1 + (level - 1) * 0.14;
    const mul = C.tiers[tier].statMul;
    return {
      maxHp: Math.round(C.baseHp * f * mul),
      atk: Math.round(C.baseAtk * f * mul),
      def: Math.round(C.baseDef + (level - 1) * 0.4),
    };
  },
};
