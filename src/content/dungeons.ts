// src/content/dungeons.ts — the dungeon registry (P3).
//
// S2 seeded it with makeDungeonEnemy's level-gated pool growth (src/game/parts/
// p03-findOpenTile.js). S8 adds the rest of "Dungeon 2.0": the themed floor sets
// (DUNGEON_THEMES + the dungeonTheme depth index, p03), the floor modifiers (FLOOR_MODS +
// rollFloorMod's weight ladder, p06), and the Key-Vault spawn knobs (p03).
//
// PURE DATA + two RNG-FREE helpers. The Math.random() draws stay in-part: rollFloorMod keeps
// its `level < 2` guard and its single draw, then calls pickFloorMod(r) to map the result;
// generateDungeon keeps its vault draw and reads vault.minLevel/vault.odds. So the draw
// count/order is byte-identical to the old inline chains (the S2 pick(r,table) discipline).
//
// makeDungeonEnemy walks poolGrowth in row order and appends every kind whose depth gate has
// opened (`level >= minLevel`) — identical to the old inline `if (level >= 3) … if (level >= 4) …`.
import type { DungeonRegistry, DungeonTheme, FloorMod, FloorModKey } from './types';

// Dungeon 2.0 — themed floor sets cycle by depth, each with its own palette, enemy pool, and hazard flavor.
const THEMES: readonly DungeonTheme[] = [
  {
    key: 'catacombs',
    name: 'The Catacombs',
    floor: '#2a2832',
    floor2: '#322f3c',
    wall: '#4a4452',
    wall2: '#3a3542',
    wall3: '#544e5e',
    pit: '#1a1820',
    pit2: '#0a080e',
    pitKind: 'pit',
    pool: ['skeleton', 'skeleton', 'bat', 'slime', 'archer'],
    accent: '#9a90b0',
  },
  {
    key: 'caverns',
    name: 'Sunken Caverns',
    floor: '#2c2a22',
    floor2: '#37322a',
    wall: '#52483a',
    wall2: '#3e3528',
    wall3: '#60543e',
    pit: '#15120b',
    pit2: '#080603',
    pitKind: 'pit',
    pool: ['charger', 'slime', 'bat', 'charger', 'skeleton'],
    accent: '#c0a060',
  },
  {
    key: 'inferno',
    name: 'The Inferno',
    floor: '#3a201a',
    floor2: '#46241a',
    wall: '#5a3024',
    wall2: '#42201a',
    wall3: '#6e382a',
    pit: '#7a2210',
    pit2: '#ff5a14',
    pitKind: 'lava',
    pool: ['charger', 'skeleton', 'mage', 'charger', 'charger'],
    accent: '#ff7838',
  },
  {
    key: 'abyss',
    name: 'The Abyss',
    floor: '#1e1a2e',
    floor2: '#262038',
    wall: '#3a2e54',
    wall2: '#2a2240',
    wall3: '#463a64',
    pit: '#0a0814',
    pit2: '#000000',
    pitKind: 'void',
    pool: ['mage', 'archer', 'mage', 'skeleton', 'healer'],
    accent: '#b070ff',
  },
];

// Floor modifiers — each descent past depth 1 may roll a twist, so the grind stays fresh (v2.29.0).
const FLOOR_MODS: Record<FloorModKey, FloorMod> = {
  gilded: { icon: '👑', name: 'Gilded Floor', desc: 'the very walls glitter — riches abound' },
  swarming: { icon: '🐀', name: 'Swarming Floor', desc: 'a horde stirs — many foes, but frail' },
  cursed: { icon: '☠', name: 'Cursed Floor', desc: 'mighty foes guard a richer prize' },
  vault: { icon: '🏦', name: 'Treasure Vault', desc: 'a hoard beyond counting' },
};

export const DUNGEONS: DungeonRegistry = {
  poolGrowth: [
    { minLevel: 3, add: 'archer' },
    { minLevel: 4, add: 'healer' },
  ],
  themes: THEMES,
  // dungeonTheme(level) — VERBATIM: DUNGEON_THEMES[Math.floor((level - 1) / 3) % DUNGEON_THEMES.length].
  theme(level: number): DungeonTheme {
    return THEMES[Math.floor((level - 1) / 3) % THEMES.length];
  },
  floorMods: FLOOR_MODS,
  // Key Vault (p03): appears from depth 2 with 40% odds; the draw itself stays in generateDungeon.
  vault: { minLevel: 2, odds: 0.4 },
  // The rollFloorMod weight ladder (p06), RNG-free: rollFloorMod keeps `if (level < 2) return null`
  // and the single Math.random() draw, then maps r here. Strict `<` — a threshold belongs to the
  // NEXT band. Byte-identical to the old inline `if (r < 0.55) … if (r < 0.685) …` chain.
  pickFloorMod(r: number): FloorModKey | null {
    if (r < 0.55) return null;
    if (r < 0.685) return 'gilded';
    if (r < 0.82) return 'swarming';
    if (r < 0.955) return 'cursed';
    return 'vault';
  },
  // #121 — the Sunken Citadel: drowned black-glass halls, a distinct palette from the four delve
  // themes. setupCitadelFloor forces floorMod null (a 'swarming' floor of lvl-90 elites is a wipe).
  citadel: {
    key: 'citadel',
    name: 'the Sunken Citadel',
    floor: '#12202a',
    floor2: '#162834',
    wall: '#20404e',
    wall2: '#182f3a',
    wall3: '#2a5464',
    pit: '#08131a',
    pit2: '#03080c',
    pitKind: 'void',
    pool: ['skeleton', 'charger', 'mage', 'archer', 'healer'],
    accent: '#7fe0d0',
  },
  // Index BY FLOOR: 1→60, 2→75, 3→90 (trash ramp), 4→200 (the Drowned Archivist's room). Flat levels.
  citadelLevels: [0, 60, 75, 90, 200],
};
