// src/content/tables.ts — the small-tables sweep (P3/S10).
//
// The display/flavor DATA tables that were scattered across p03/p04/p05/p08/p09/p10/p11/p13/p14/p15:
// seasons, foods, blessings, trade goods, status blurbs, regions/lore, POI kinds, hold sites, warlord/
// nemesis naming, and ability knobs. All PURE DATA (no hooks, no RNG, no state reads) — the game keeps
// a positional alias at each old declaration line, so every UI/log/minimap/AI-naming reader is
// untouched. None of these symbols is captured by the server or client (all in-game display).
//
// NOT here: the steed's colour/level (already in apex.ts from S5 — ONE source; the drawSteed HOOK is
// the deferred H-half). The warlord STAT curve + strength EFFECTS stay in makeWarlordEnemy — only its
// NAMING/label tables move (WL_STRENGTHS/WL_WEAKNESS are description strings, not effect logic).
import type {
  AbilityTables,
  Blessing,
  FoodTables,
  HoldSite,
  NemesisTables,
  PoiKind,
  RegionTables,
  SeasonTables,
  TablesRegistry,
  TradeGood,
  WarlordTables,
} from './types';

// ---- seasons (p14) — SEASONS/SEASON_TINT/SEASON_ICON, parallel by season index 0-3 ----------------
const SEASONS: SeasonTables = {
  names: ['Spring', 'Summer', 'Autumn', 'Winter'],
  tint: [
    'rgba(130,205,130,0.06)',
    'rgba(255,224,130,0.05)',
    'rgba(222,140,48,0.12)',
    'rgba(180,212,255,0.14)',
  ],
  icon: ['🌱', '☀', '🍂', '❄'],
};

// ---- quiet life (p14 ingredients/recipes/labels + p09 forage sell prices) ------------------------
const FOODS: FoodTables = {
  ingredients: {
    herb: { name: 'Herb', color: '#7ad06a', icon: '🌿' },
    berry: { name: 'Berries', color: '#d04a6a', icon: '🫐' },
    mushroom: { name: 'Mushroom', color: '#c89a6a', icon: '🍄' },
    fish: { name: 'Fish', color: '#8ac0e0', icon: '🐟' },
  },
  recipes: {
    stew: {
      name: 'Hearty Stew',
      need: { fish: 1, herb: 1 },
      buff: 'hearty',
      dur: 10800,
      desc: 'steady health regen',
    },
    tart: { name: 'Berry Tart', need: { berry: 2 }, buff: 'energized', dur: 10800, desc: 'faster energy' },
    roast: {
      name: "Forager's Roast",
      need: { mushroom: 1, herb: 1 },
      buff: 'swift',
      dur: 10800,
      desc: 'fleeter of foot',
    },
    feast: {
      name: "Traveler's Feast",
      need: { fish: 1, berry: 1, mushroom: 1, herb: 1 },
      buff: 'wellfed',
      dur: 14400,
      desc: '+power, +defense & regen',
    },
  },
  labels: { hearty: 'Hearty', energized: 'Energized', swift: 'Swift', wellfed: 'Well Fed' },
  forageValue: { herb: 8, berry: 7, mushroom: 9, fish: 12 },
};

// ---- shrine blessings (p10) ----------------------------------------------------------------------
const BLESS: Record<string, Blessing> = {
  might: { name: 'Might', color: '#ff8050', desc: '+40% damage' },
  ward: { name: 'Ward', color: '#70b0ff', desc: '−40% damage taken' },
  haste: { name: 'Haste', color: '#90e060', desc: 'faster attacks & movement' },
  renewal: { name: 'Renewal', color: '#90ffb0', desc: 'regenerate health' },
};

// ---- trade goods (p09) ---------------------------------------------------------------------------
const TRADE: Record<string, TradeGood> = {
  furs: { name: 'Furs', base: 40, icon: '🦊' },
  grain: { name: 'Grain', base: 14, icon: '🌾' },
  spice: { name: 'Spice', base: 60, icon: '🧂' },
  ore: { name: 'Ore', base: 34, icon: '⛏' },
};

// ---- status blurbs (p15) — the character-sheet hover text --------------------------------------
const STATUS: Record<string, string> = {
  Exhausted:
    'Worn out from too long without rest — −22% attack and half move speed. Sleep in a town or make camp [C] to recover.',
  Chilled: 'Struck by frost — your movement is slowed for a few seconds.',
  Flying: 'Riding your dragon — faster, tougher, and able to soar over mountains and water.',
};

// ---- regions (p15 names + p05 subs/lore), parallel by region index 0-8 ----------------------------
const REGIONS: RegionTables = {
  names: [
    'the Northwest Reaches',
    'the Northern Wastes',
    'the Northeast Range',
    'the Western Marches',
    'the Heartlands',
    'the Eastern Wilds',
    'the Southern Bogs',
    'the Southlands',
    'the Emberwaste Frontier',
  ],
  subs: [
    'wolf-haunted hills where the realm frays',
    'frozen barrens — the cold keeps its dead',
    'storm-scoured peaks of the far north',
    'contested marches west of the Vale',
    'the green heart of the realm — safe hearths',
    'wild woods where the roads grow thin',
    'mists and black water — few return',
    'open steppes ruled by fang and claw',
    "ash and ember — the Legion's cradle",
  ],
  lore: [
    'Beyond the western peaks a drowned god stirs. Only wings may cross; only fools may knock.',
    "The Frost Titan's heart never thawed. The snows are its slow breathing.",
    'The Storm Roc nests where lightning is born, not where it strikes.',
    'Hawthorn, Iron, Moss — three banners fell in one night. Raise them again.',
    'Eldermyr stands because the Vale forgets slowly and forgives slower.',
    'The wilds keep tally. Every beast slain is a debt the forest remembers.',
    'The Sundered Sea did not sunder itself. Ask the Leviathan what it fled.',
    'Sealstones sleep in ruined keeps — wards of an older war, waiting.',
    'The Emberwyrm is not the fire’s master. It is the fire’s prisoner.',
  ],
};

// ---- frontier POI kinds (p03) --------------------------------------------------------------------
const POI: Record<string, PoiKind> = {
  camp: { name: 'Legion War-Camp', mark: '#ff5040' },
  keep: { name: 'Ruined Keep', mark: '#c8b8ff' },
  village: { name: 'Razed Village', mark: '#f0c060' },
};

// ---- fixed outpost sites (p04) — state.holdings is BUILT from this (fresh objects), never aliased --
const HOLDS: readonly HoldSite[] = [
  { tx: 106, ty: 84, name: 'Hawthorn Vale' },
  { tx: 269, ty: 112, name: 'Ironford' },
  { tx: 154, ty: 246, name: 'Mossbridge' },
];

// ---- warlord/nemesis naming (p15/p13) — effects stay in makeWarlordEnemy; these are LABELS ---------
const WARLORD: WarlordTables = {
  first: [
    'Grukk',
    'Sythe',
    'Karzul',
    'Vexa',
    'Mordrek',
    'Threx',
    'Bral',
    'Ghorza',
    'Uzgar',
    'Nazru',
    'Skarn',
    'Yrra',
    'Drog',
    'Hexa',
    'Volk',
    'Murg',
    'Zradd',
    'Olga',
  ],
  epithet: [
    'the Render',
    'Blackmaw',
    'Ironjaw',
    'the Cruel',
    'Skullsplitter',
    'Gravecaller',
    'the Flayer',
    'Bonechewer',
    'the Vile',
    'Doomspeaker',
    'the Wretched',
    'Ashtongue',
    'the Maimer',
    'Grimscar',
    'the Defiler',
  ],
  ranks: ['Grunt', 'Captain', 'Warlord', 'Overlord'],
  strengths: {
    ironhide: 'Ironhide — shrugs off blows',
    fireborn: 'Fireborn — immune to fire',
    frostbound: 'Frostbound — cannot be frozen',
    frenzied: 'Frenzied — fast and ferocious',
    regenerator: 'Regenerator — wounds knit shut',
    swarmlord: 'Swarmlord — fights with a retinue',
  },
  weakness: {
    poison: 'Dreads poison',
    ranged: 'Fears the bow',
    crit: 'Bleeds easily (crits hit hard)',
    stagger: 'Loses nerve when staggered',
    fire: 'Flammable',
  },
};

const NEMESIS: NemesisTables = {
  names: [
    'Grukk the Render',
    'Sythe Blackmaw',
    'Karzul Ironjaw',
    'Vexa the Cruel',
    'Mordrek Skullsplitter',
    'Threx Gravecaller',
  ],
  titles: ['the Hunter', 'the Relentless', 'the Vengeful', 'the Terror', 'Bane of Eldermyr'],
};

// ---- ability knobs (p08 rank caps + p11 heat-aura threshold/throttle) -----------------------------
const ABILITIES: AbilityTables = {
  rankMax: { whirlwind: 5, focus: 5, ultimate: 5, summon: 4, dominate: 1 },
  heatAuraMin: 40,
  heatAuraTicks: 16,
};

export const TABLES: TablesRegistry = {
  seasons: SEASONS,
  foods: FOODS,
  bless: BLESS,
  trade: TRADE,
  status: STATUS,
  regions: REGIONS,
  poi: POI,
  holds: HOLDS,
  warlord: WARLORD,
  nemesis: NEMESIS,
  abilities: ABILITIES,
};
