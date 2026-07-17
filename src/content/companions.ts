// src/content/companions.ts — the warband registry (P3/S9).
//
// COMP_CLASSES/COMP_NAMES/COMP_CAP/compStatsFor (src/game/parts/p04-drawPOI.js) → DATA + the
// level-scaling formula. p04 keeps positional aliases at the old declaration lines (COMP_CLASSES is
// read by p04/p05/p07, COMP_NAMES by p04, COMP_CAP by p04/p05, compStatsFor by p04), so no call site
// changes and nothing external captures these symbols (world.js only mentions COMP_CAP in a comment).
//
// #115 (F2) — the warband economy. Each class now carries THREE promotion tiers (tiers[0] = T1 =
// today's numbers EXACTLY; statMul 1 → byte-identical at tier 0, `x*1===x`). Per tier:
//   statMul — multiplicative stat scale (maxHp/atk); ladder 1 / 2 / 4
//   hire    — recruit cost, ~10× per tier off the class's base (owner knob)
//   upkeep  — daily gold PER HEAD, charged per-hero in onNewDayHero (unpaid → stay but refuse to fight)
// The stat/upkeep ladders are shared across classes; only the hire base differs (knight/ranger 200,
// mage 240). tiers[0].hire duplicates the class's top-level `hire` (kept for external readers).
import type { CompanionClass, CompanionRegistry, CompanionStats, CompanionTier } from './types';

const STAT_MUL = [1, 2, 4]; // T1/T2/T3 stat scale (owner-tunable)
const UPKEEP = [10, 60, 300]; // T1/T2/T3 gold/day per head (owner-tunable)
// Build a class's 3 tiers: hire = base ×10^tier; stat/upkeep from the shared ladders.
function tiersFor(hireBase: number): CompanionTier[] {
  return [0, 1, 2].map((i) => ({ statMul: STAT_MUL[i], hire: hireBase * Math.pow(10, i), upkeep: UPKEEP[i] }));
}

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
    tiers: tiersFor(200),
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
    tiers: tiersFor(200),
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
    tiers: tiersFor(240),
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
