// src/content/dungeons.ts — the dungeon registry (P3/S2 seeds it with makeDungeonEnemy's
// level-gated pool growth, src/game/parts/p03-findOpenTile.js:392-397; S8 migrates
// DUNGEON_THEMES, floor mods and vault knobs into this same file).
//
// makeDungeonEnemy walks poolGrowth in row order and appends every kind whose depth gate
// has opened (`level >= minLevel`) to the theme's trash pool — identical result to the old
// inline `if (level >= 3) … if (level >= 4) …` pair. Giving a kind an earlier/later
// dungeon debut = editing one row here.
import type { DungeonPoolGrowth } from './types';

export const DUNGEONS: { readonly poolGrowth: readonly DungeonPoolGrowth[] } = {
  poolGrowth: [
    { minLevel: 3, add: 'archer' },
    { minLevel: 4, add: 'healer' },
  ],
};
