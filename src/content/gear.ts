// src/content/gear.ts — the gear registry (P3/S6).
//
// The loot / shop / mastery DATA, moved VERBATIM out of the game parts (byte-exact, extracted
// from the literals): rarity + naming tables (RARITIES/STYLE_NAMES/ARMOR_NAMES/RAR_PREFIX,
// p01), style-mastery perks (MASTERY/MASTERY_LVLS, p02), the pattern weapons (PATTERN_WEAPONS,
// p02), the fixed shop stock (SHOP_NAMES/SHOP_WEAPONS p08, SHOP_ARMOR p09), the pinnacle-chase
// uniques (UNIQUES, p22), the generator's style/element pools, and rollAffixes' offense/defense
// pool definitions (as a pure helper — the RNG pick stays in the part).
//
// All class-P: the parts keep a POSITIONAL ALIAS at each old declaration line
// (`const RARITIES = CONTENT.gear.rarities;` etc.) and the loot factories (genWeapon/genArmor/
// makeUnique/genShopStock/rollAffixes/rollPatternWeapon) consume these rows unchanged — same
// values, same RNG draw order, golden-identical. None of these symbols are CAPTURE'd or read
// externally, so the aliases are pure in-part convenience.
//
// Adding a shop item / unique / pattern weapon / mastery perk = one row here. NOT frozen (the
// registry rule) — the tripwire is the oracles + content-purity's canary; rollPatternWeapon
// and dropGreatBeastReward JSON-deep-copy their rows before use, and affixPool builds a fresh
// array each call exactly as the inline pools did.
import type {
  AffixSpec,
  GearRegistry,
  PatternWeapon,
  Rarity,
  ShopArmor,
  ShopNameRow,
  ShopWeapon,
  Unique,
  WeaponStyle,
} from './types';

const rarities: readonly Rarity[] = [
  { id: 'common', name: 'Common', color: '#c8c8d0', mult: 1.0, dur: 50 },
  { id: 'uncommon', name: 'Uncommon', color: '#70e060', mult: 1.18, dur: 65 },
  { id: 'rare', name: 'Rare', color: '#5090ff', mult: 1.4, dur: 85 },
  { id: 'epic', name: 'Epic', color: '#c060ff', mult: 1.7, dur: 110 },
  { id: 'legendary', name: 'Legendary', color: '#f0a020', mult: 2.05, dur: 150 },
];

const styleNames: Record<WeaponStyle, readonly string[]> = {
  melee: ['Dagger', 'Sword', 'Blade', 'Greatsword'],
  ranged: ['Sling', 'Shortbow', 'Longbow', 'Warbow'],
  magic: ['Wand', 'Staff', 'Rod', 'Scepter'],
};

const armorNames: readonly string[] = ['Tunic', 'Mail', 'Plate', 'Aegis'];

const rarPrefix: readonly string[] = ['Worn', 'Fine', 'Runed', 'Ancient', 'Mythic'];

const mastery: Record<WeaponStyle, readonly (readonly string[])[]> = {
  melee: [
    ['Cleave', 'wider, longer swings'],
    ['Momentum', 'melee kills refund 14 stamina'],
    ["Executioner's Edge", '+25% melee damage vs foes below 30% HP'],
  ],
  ranged: [
    ['Ricochet', 'arrows bounce to a second target (60% dmg)'],
    ['Steady Draw', 'faster arrows, +1 pierce'],
    [
      'Double Nock',
      '12% free 2nd arrow — and marked KILLS erupt in a Deadeye burst: AoE (scales with Marks) that spreads Marks to nearby foes',
    ],
  ],
  magic: [
    ['Seeker Bolt', 'your casts bend toward the nearest foe — one true bolt'],
    ['Attunement', 'spells cost 20% less'],
    ['Overload', 'bolts splash 40% damage around the mark'],
  ],
};

const masteryLvls: readonly number[] = [10, 18, 24];

const patternWeapons: readonly PatternWeapon[] = [
  {
    name: 'Twinfang Rod',
    atk: 24,
    style: 'magic',
    rarity: 4,
    element: 'shock',
    pattern: 'twin',
    reqLevel: 16,
    reqProf: 12,
    affixes: [{ t: 'crit', v: 2, label: '+10% Crit' }],
  },
  {
    name: 'Prismscatter Staff',
    atk: 22,
    style: 'magic',
    rarity: 4,
    element: 'fire',
    pattern: 'trifan',
    reqLevel: 16,
    reqProf: 12,
    affixes: [{ t: 'lifesteal', v: 2, label: '+2% Lifesteal' }],
  },
  {
    name: 'Voidpiercer Rod',
    atk: 28,
    style: 'magic',
    rarity: 4,
    element: 'frost',
    pattern: 'lance',
    reqLevel: 18,
    reqProf: 14,
    affixes: [{ t: 'crit', v: 3, label: '+15% Crit' }],
  },
];

const shopNames: Record<number, ShopNameRow> = {
  0: { melee: 'Steel Blade', ranged: 'Yew Bow', magic: 'Oak Staff', mail: 'Chainmail', plate: 'Plate Armor' },
  1: {
    melee: 'Frostforged Blade',
    ranged: 'Glacial Bow',
    magic: 'Rime Staff',
    mail: 'Rimemail',
    plate: 'Glacial Plate',
  },
  2: {
    melee: 'Emberforged Blade',
    ranged: 'Magma Bow',
    magic: 'Cinder Staff',
    mail: 'Embermail',
    plate: 'Magma Plate',
  },
};

const shopWeapons: readonly ShopWeapon[] = [
  {
    id: 'throwing_knives',
    name: 'Throwing Knives',
    style: 'ranged',
    atk: 5,
    cd: 16,
    cost: 60,
    rarity: 0,
    reqLevel: 1,
    reqProf: 1,
  },
  {
    id: 'steel_sword',
    name: 'Steel Sword',
    style: 'melee',
    atk: 8,
    cd: 22,
    cost: 80,
    rarity: 0,
    reqLevel: 2,
    reqProf: 2,
  },
  {
    id: 'hunters_bow',
    name: "Hunter's Bow",
    style: 'ranged',
    atk: 8,
    cd: 26,
    cost: 110,
    rarity: 0,
    reqLevel: 2,
    reqProf: 2,
  },
  {
    id: 'apprentice_staff',
    name: 'Apprentice Staff',
    style: 'magic',
    atk: 8,
    cost: 110,
    rarity: 0,
    reqLevel: 2,
    reqProf: 2,
  },
  {
    id: 'knight_blade',
    name: 'Knight Blade',
    style: 'melee',
    atk: 12,
    cd: 22,
    cost: 200,
    rarity: 1,
    reqLevel: 5,
    reqProf: 4,
  },
  {
    id: 'longbow',
    name: 'Longbow',
    style: 'ranged',
    atk: 14,
    cd: 26,
    cost: 280,
    rarity: 1,
    reqLevel: 5,
    reqProf: 4,
  },
  {
    id: 'sorcerer_staff',
    name: "Sorcerer's Staff",
    style: 'magic',
    atk: 14,
    cost: 280,
    rarity: 1,
    reqLevel: 5,
    reqProf: 4,
  },
  {
    id: 'runed_greatsword',
    name: 'Runed Greatsword',
    style: 'melee',
    atk: 18,
    cd: 22,
    cost: 420,
    rarity: 2,
    reqLevel: 8,
    reqProf: 6,
  },
  {
    id: 'archmage_staff',
    name: 'Archmage Staff',
    style: 'magic',
    atk: 20,
    cost: 520,
    rarity: 2,
    reqLevel: 8,
    reqProf: 6,
  },
  {
    id: 'flameblade',
    name: 'Flameblade',
    style: 'melee',
    atk: 11,
    cd: 22,
    cost: 240,
    rarity: 1,
    reqLevel: 5,
    reqProf: 4,
    element: 'fire',
  },
  {
    id: 'frostbow',
    name: 'Frostbow',
    style: 'ranged',
    atk: 11,
    cd: 26,
    cost: 260,
    rarity: 1,
    reqLevel: 5,
    reqProf: 4,
    element: 'frost',
  },
  {
    id: 'venom_staff',
    name: 'Venom Staff',
    style: 'magic',
    atk: 12,
    cost: 280,
    rarity: 1,
    reqLevel: 5,
    reqProf: 4,
    element: 'poison',
  },
  {
    id: 'storm_rod',
    name: 'Storm Rod',
    style: 'magic',
    atk: 14,
    cost: 340,
    rarity: 2,
    reqLevel: 7,
    reqProf: 5,
    element: 'shock',
  },
];

const shopArmor: readonly ShopArmor[] = [
  { id: 'chain_mail', name: 'Chain Mail', def: 5, cost: 90, rarity: 0, reqLevel: 2 },
  { id: 'plate_armor', name: 'Plate Armor', def: 8, cost: 220, rarity: 1, reqLevel: 5 },
  { id: 'guardian_plate', name: 'Guardian Plate', def: 13, cost: 460, rarity: 2, reqLevel: 8 },
];

const uniques: Record<string, Unique> = {
  leviathanspine: {
    slot: 'weapon',
    style: 'ranged',
    element: 'frost',
    name: 'Leviathan Spine',
    atkMul: 1.2,
    cd: 24,
    uniqDesc: 'Every 3rd hit on a Marked target looses a free frost lance.',
  },
  tidecalleraegis: {
    slot: 'armor',
    name: "Tidecaller's Aegis",
    defMul: 1.22,
    uniqDesc: 'A perfect dodge releases a frost nova.',
  },
  shepherdsbell: {
    slot: 'weapon',
    style: 'magic',
    element: 'frost',
    name: "Shepherd's Bell",
    atkMul: 1.1,
    uniqDesc: '+1 thrall cap; your thralls detonate when they expire.',
  },
  gravewoolcloak: {
    slot: 'armor',
    name: 'Gravewool Cloak',
    defMul: 1.15,
    uniqDesc: 'Stand still ~1.5s to cloak until you act.',
  },
  // #121 — the five Sunken Citadel relics (per-player hidden 1% from the Drowned Archivist). Each is a
  // build-CHANGING effect read from a recalcStats-derived p.u* scalar in combat — never a gear-read
  // (the v2.56 iron rule: MP combat may not swap S.inventory, so a live equippedWeapon() could hit the
  // wrong bag). makeUnique builds them at legendary tier with no changes.
  sunderking: {
    slot: 'weapon',
    style: 'melee',
    name: "Sunderking's Edge",
    atkMul: 1.25,
    cd: 22,
    uniqDesc: 'At 5 Momentum your riposte never closes — every hit a guaranteed crit. Bleed a pip and it shuts.',
  },
  hundredfold: {
    slot: 'weapon',
    style: 'ranged',
    name: 'The Hundredfold Quiver',
    atkMul: 1.22,
    cd: 24,
    uniqDesc: "A Marked target's death hurls ALL its Marks to the nearest foe and refunds your shot.",
  },
  chainbreaker: {
    slot: 'weapon',
    style: 'magic',
    element: 'fire',
    name: 'Chainbreaker Coil',
    atkMul: 1.2,
    uniqDesc: 'Your Heat never falls below the aura threshold, and aura strikes chain to 2 more foes.',
  },
  namelessaegis: {
    slot: 'armor',
    name: 'Aegis of the Nameless',
    defMul: 1.25,
    uniqDesc: 'A blow that would kill you leaves you at 1 HP instead. Once per Citadel floor.',
  },
  emberheart: {
    slot: 'armor',
    name: 'Emberheart Locket',
    defMul: 1.18,
    uniqDesc: 'Each kill grants +25% damage for ~2s, stacking to 3 (+75%).',
  },
};

// genWeapon's selection pools (the "gen name pools"): a style is picked from genStyles, an
// element from genElements. Explicit arrays (NOT derived from CONTENT.elements) so the RNG
// index maps to the exact old order.
const genStyles: readonly WeaponStyle[] = ['melee', 'ranged', 'magic'];
const genElements: readonly string[] = ['fire', 'frost', 'poison', 'shock'];

// rollAffixes' offense/defense pool DEFINITIONS (was the inline arrays, p02:203-212). Pure —
// values/labels scale with rIdx, but there is NO Math.random() here; the pick + the second-affix
// roll stay in rollAffixes, so the draw order is byte-identical. Fresh array each call.
function affixPool(rIdx: number, isWeapon: boolean): AffixSpec[] {
  const offense: AffixSpec[] = [
    { t: 'crit', v: rIdx - 1, label: `+${(rIdx - 1) * 5}% Crit` },
    { t: 'lifesteal', v: Math.max(1, rIdx - 1), label: `+${Math.max(1, rIdx - 1)}% Lifesteal` },
    { t: 'berserk', v: 1, label: 'Berserker' },
  ];
  const defense: AffixSpec[] = [
    { t: 'evasion', v: rIdx - 1, label: `+${(rIdx - 1) * 3}% Evade` },
    { t: 'lifesteal', v: 1, label: '+1% Lifesteal' },
    { t: 'crit', v: 1, label: '+5% Crit' },
  ];
  return isWeapon ? offense : defense;
}

export const GEAR: GearRegistry = {
  rarities,
  styleNames,
  armorNames,
  rarPrefix,
  mastery,
  masteryLvls,
  patternWeapons,
  shopNames,
  shopWeapons,
  shopArmor,
  uniques,
  genStyles,
  genElements,
  affixPool,
};
