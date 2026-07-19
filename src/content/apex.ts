// src/content/apex.ts — the apex-boss registry (P3/S5).
//
// The world-boss DATA, moved VERBATIM out of the game parts: the four Great Hunts
// (GREAT_HUNTS, p22:165-275), the two pinnacle fights (PINNACLE_BOSSES, p22:468-501), and the
// dragon/pinnacle tuning constants (DRAGON_LEVEL/DRAGON_COLOR p22:110/115, PIN_LEVEL p22:392,
// PIN_ARENA_START/MIN/SHRINK/LEASH p22:382-385). This is the plan's #10 fusion split — spawn
// data here, scaling curves in the factories — done the mission's way: the parts keep a
// positional alias at each old declaration line (`const GREAT_HUNTS = CONTENT.apex.hunts;`),
// so every consumer, the CAPTURE'd namespace (GREAT_HUNTS/PINNACLE_BOSSES are grabbed by the
// server, read by world.js as G.GREAT_HUNTS) and the RNG draw order are untouched — the
// factories consume the same values at the same program position, hashes hold byte-for-byte.
//
// The scaling FACTORIES (makeGreatBeast/makePinnacleBoss/makeWildDragon/makeKraken), the lair
// resolver, the ordered-add builder, the drop rollers (RNG — the golden hunt tripwire) and the
// respawn machinery stay in-part reading these rows; extracting THOSE into stats/lair/drops
// hooks is the higher-risk follow-up (it threads state/partyN/partyLvl/distFactor through ctx
// bags and the drop rollers ride the hunt-perturb control) — deferred, not done here.
//
// Adding a Great Hunt or a pinnacle that reuses the existing formula = one row here. Plain
// data, no hooks, no RNG. NOT frozen (the registry rule) — the tripwire is the oracles +
// content-purity's canary; the reward is JSON-deep-copied before use and `e.specials =
// h.specials` shares the array read-only exactly as the monolith did.
import type { ApexHunt, ApexMini, ApexPinnacle, ApexRegistry } from './types';

// The Great Hunts — legendary roaming world-beasts (verbatim GREAT_HUNTS rows).
const HUNTS: readonly ApexHunt[] = [
  {
    key: 'frosttitan',
    level: 60,
    name: 'The Frost Titan',
    color: '#bfe9ff',
    element: 'frost',
    where: 'the Frozen Wastes (far north)',
    lair: { tx: 174, ty: 17 },
    hp: 900,
    atk: 26,
    def: 9,
    xp: 900,
    gold: 900,
    specials: ['slam', 'nova', 'charge'],
    reward: {
      weapon: {
        name: 'Titan’s Maul',
        atk: 30,
        style: 'melee',
        cd: 24,
        rarity: 4,
        element: 'frost',
        affixes: [
          { t: 'crit', v: 3, label: '+15% Crit' },
          { t: 'berserk', v: 1, label: 'Berserker' },
        ],
      },
    },
  },
  {
    key: 'stormroc',
    level: 55,
    name: 'The Storm Roc',
    color: '#ffe24a',
    element: 'shock',
    where: 'the high wilds (northeast)',
    lair: { tx: 269, ty: 84 },
    hp: 820,
    atk: 24,
    def: 7,
    xp: 850,
    gold: 850,
    specials: ['charge', 'nova', 'summon'],
    reward: {
      weapon: {
        name: 'Stormcaller Bow',
        atk: 26,
        style: 'ranged',
        cd: 24,
        rarity: 4,
        element: 'shock',
        affixes: [
          { t: 'crit', v: 3, label: '+15% Crit' },
          { t: 'lifesteal', v: 2, label: '+2% Lifesteal' },
        ],
      },
    },
  },
  {
    key: 'emberhorn',
    level: 65,
    name: 'Emberhorn the Scorched',
    color: '#ff7838',
    element: 'fire',
    where: 'the Emberwaste (far southeast)',
    lair: { tx: 269, ty: 241 },
    hp: 1000,
    atk: 30,
    def: 10,
    xp: 1000,
    gold: 1000,
    specials: ['slam', 'charge', 'nova'],
    reward: {
      armor: {
        name: 'Scaled Aegis of Cinders',
        def: 24,
        rarity: 4,
        affixes: [
          { t: 'evasion', v: 3, label: '+9% Evade' },
          { t: 'lifesteal', v: 2, label: '+2% Lifesteal' },
        ],
      },
    },
  },
  {
    key: 'leviathan',
    level: 70,
    name: 'The Tide Leviathan',
    color: '#2ad0c0',
    element: 'frost',
    island: true,
    where: 'an isle in the Sundered Sea (sail to reach it)',
    lair: { tx: 104, ty: 199 },
    hp: 1100,
    atk: 28,
    def: 9,
    xp: 1100,
    gold: 1200,
    specials: ['slam', 'nova', 'summon', 'charge'],
    reward: {
      weapon: {
        name: 'Leviathan’s Trident',
        atk: 32,
        style: 'magic',
        rarity: 4,
        element: 'frost',
        affixes: [
          { t: 'crit', v: 2, label: '+10% Crit' },
          { t: 'lifesteal', v: 3, label: '+3% Lifesteal' },
        ],
      },
    },
  },
];

// The two pinnacle apex fights (verbatim PINNACLE_BOSSES rows).
const PINNACLES: readonly ApexPinnacle[] = [
  {
    key: 'drownedking',
    name: 'The Drowned King',
    color: '#2f7fb0',
    type: 'kraken',
    island: true,
    where: 'a shipwreck in the Sundered Sea',
    hp: 2600,
    atk: 44,
    def: 14,
    xp: 3200,
    gold: 3400,
    night: false,
    specials: ['pullunder', 'raiseadds', 'nova', 'charge'],
    drops: { style: 'ranged', styleUniq: 'leviathanspine', universalUniq: 'tidecalleraegis' },
  },
  {
    key: 'paleshepherd',
    name: 'The Pale Shepherd',
    color: '#d6e6f2',
    type: 'boss',
    island: false,
    where: 'the Frozen Wastes, by night',
    hp: 2400,
    atk: 46,
    def: 13,
    xp: 3000,
    gold: 3200,
    night: true,
    specials: ['raiseadds', 'nova', 'charge'],
    drops: { style: 'summon', styleUniq: 'shepherdsbell', universalUniq: 'gravewoolcloak' },
  },
];

// The 5 fixed MINI-BOSSES (S2 — presence + persistence + reward; signature mechanics are S3–S5).
// DATA only: makeMiniBoss curve-levels a makeBoss base (90/12/4) to `level` with NO party/ascension
// terms (the owner's tough-but-soloable rule — a 4-stack legitimately melts them; the pinnacles stay
// the party test). resolveMiniLair runs a DETERMINISTIC spiral from `lair` (zero RNG — keeps the
// oracle re-record surgical). `where` is the kill/spawn log flavor. `signatureDrop` is a fixed named
// legendary (the hunt-trophy ApexReward shape — a plain affixed weapon/armor, NOT a p.u* unique, so
// no recalcStats seam) that each present hero rolls ~5% for on every kill, straight to their own bag.
// Coords VERIFIED against live worldgen (probe: all five resolve at ring 0 — non-solid, reachable,
// correct region, ≥36 tiles from the nearest apex anchor — on both golden seeds 1337/98765).
const MINIS: readonly ApexMini[] = [
  {
    key: 'hierophant',
    level: 25,
    name: 'The Hierophant',
    color: '#ffd86a',
    where: 'the ruined shrine of the Western Marches',
    lair: { tx: 70, ty: 150 },
    signatureDrop: {
      weapon: {
        name: 'Hierophant’s Sunstave',
        atk: 20,
        style: 'magic',
        rarity: 4,
        element: 'fire',
        affixes: [
          { t: 'crit', v: 2, label: '+10% Crit' },
          { t: 'lifesteal', v: 2, label: '+2% Lifesteal' },
        ],
      },
    },
  },
  {
    key: 'broodmother',
    level: 40,
    name: 'The Broodmother',
    color: '#8fbf5a',
    where: 'the dark wood of the Eastern Wilds',
    lair: { tx: 312, ty: 158 },
    signatureDrop: {
      weapon: {
        name: 'Broodsilk Recurve',
        atk: 22,
        style: 'ranged',
        cd: 24,
        rarity: 4,
        element: 'poison',
        affixes: [
          { t: 'crit', v: 3, label: '+15% Crit' },
          { t: 'lifesteal', v: 1, label: '+1% Lifesteal' },
        ],
      },
    },
  },
  {
    key: 'emberkeg',
    level: 45,
    name: 'The Emberkeg',
    color: '#ff7838',
    where: 'the cinder crater of the Emberwaste',
    lair: { tx: 305, ty: 238 },
    signatureDrop: {
      armor: {
        name: 'Kegheart Cinderplate',
        def: 20,
        rarity: 4,
        affixes: [
          { t: 'evasion', v: 3, label: '+9% Evade' },
          { t: 'lifesteal', v: 1, label: '+1% Lifesteal' },
        ],
      },
    },
  },
  {
    key: 'hexbinder',
    level: 55,
    name: 'The Hexbinder',
    color: '#9d7bff',
    where: 'the frozen strip of the Northern Wastes',
    lair: { tx: 128, ty: 24 },
    signatureDrop: {
      weapon: {
        name: 'Hexbinder’s Icon',
        atk: 28,
        style: 'magic',
        rarity: 4,
        element: 'frost',
        affixes: [
          { t: 'lifesteal', v: 3, label: '+3% Lifesteal' },
          { t: 'crit', v: 2, label: '+10% Crit' },
        ],
      },
    },
  },
  {
    key: 'colossus',
    level: 60,
    name: 'The Colossus',
    color: '#c86038',
    where: 'the war-camp ruin of the Northeast Range',
    lair: { tx: 300, ty: 40 },
    signatureDrop: {
      weapon: {
        name: 'Warcamp Crusher',
        atk: 30,
        style: 'melee',
        cd: 26,
        rarity: 4,
        affixes: [
          { t: 'berserk', v: 1, label: 'Berserker' },
          { t: 'crit', v: 2, label: '+10% Crit' },
        ],
      },
    },
  },
];

export const APEX: ApexRegistry = {
  hunts: HUNTS,
  pinnacles: PINNACLES,
  minis: MINIS,
  // #123 — The Mountain Kraken, the TRUE finale. FLAT base HP well above the pinnacle tier
  // (the Drowned King as actually fought ≈ 9,500; this sits at 48k), no partyLvl term — makeKraken
  // multiplies party-size/ascension/cycle on top and stamps `level` (drawn, rides packEnemy).
  // atk is level-90-curve gentle (the 45% damage floor makes it lethal without one-shotting).
  // respawnDays reuses the pinnacle respawn-day/cycle pattern (killEnemy schedules, maybeRespawnKraken
  // revives harder & richer). Retune here, retune the finale.
  kraken: { hp: 48000, atk: 130, def: 14, xp: 12000, gold: 12000, level: 90, respawnDays: 4 },
  // #121 — The Drowned Archivist, the level-200 Sunken Citadel boss. FLAT stats (the validated
  // §0.4 player-power math: LVL_HP(200)≈237k, atk 260, def 46 — a ~3.6-min ceiling-player fight that
  // deletes a careless one in ~2.3 slams). stances re-point e.specials → three fighting styles with
  // no AI rewrite (updateBoss already picks uniformly from e.specials). Retune the fight here.
  archivist: {
    key: 'archivist',
    name: 'The Drowned Archivist',
    color: '#7fe0d0',
    level: 200,
    hp: 240000,
    atk: 260,
    def: 46,
    xp: 24000,
    gold: 18000,
    stances: {
      blade: ['charge', 'leap', 'slam'], // melee pressure — chases, closes, punishes
      storm: ['nova', 'castvolley', 'leap'], // ranged zoning — fills the room with bolts
      grave: ['raisecourt', 'pullunder', 'slam'], // adds + control
    },
  },
  // The Emberwyrm's flat rung + the ONE source of its colour (makeWildDragon + drawPlayer's
  // mounted steed both derive every tone from this — recolour here, recolour both).
  dragonLevel: 30,
  dragonColor: '#e85020',
  // The pinnacle bosses are a FIXED RUNG (PIN_LEVEL) — they don't bow to whoever shows up.
  pinLevel: 75,
  // Shrinking-arena hazard knobs.
  pinArenaStart: 360,
  pinArenaMin: 100,
  pinArenaShrink: 0.05,
  pinLeash: 980,
};
