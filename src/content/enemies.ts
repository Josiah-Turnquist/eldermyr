// src/content/enemies.ts — the enemy-kind registry (P3/S2; verbatim from the monolith's
// makeEnemy base table + per-type init blocks, src/game/parts/p03-findOpenTile.js:201-318,
// and the makeWildEnemy ring/biome type tables, p03:353-376).
//
// Adding a wild-spawnable enemy = one entry in ENEMIES (+ its key in EnemyKindKey,
// types.ts) plus its threshold row(s) in WILD_SPAWN.tables below — one file. The game
// reads kinds through CONTENT.enemies[type] (makeEnemy) and the spawn tables through
// CONTENT.wildSpawn (makeWildEnemy); the ring/level BRANCHING and the scaling curves stay
// in-part (curves migrate in S11). S3 adds the draw hooks (`draw`/`faces`) to these same
// entries; boss/dragon/kraken join then.
//
// init hooks: pure functions of the instance they receive — they seed behavior fields and
// make EXACTLY the Math.random() draws the inline blocks made (same count, same order; the
// golden harness seeds Math.random globally, so hook draws ride the same stream).
import type { EnemyInst, EnemyKind, EnemyKindKey, WildSpawnTable } from './types';

export const ENEMIES: Record<EnemyKindKey, EnemyKind> = {
  slime: { name: 'Slime', hp: 11, atk: 4, def: 0, speed: 0.7, xp: 8, gold: 5, color: '#60d060', size: 20 },
  bat: { name: 'Cave Bat', hp: 8, atk: 5, def: 0, speed: 1.5, xp: 10, gold: 6, color: '#a060d0', size: 18 },
  skeleton: { name: 'Skeleton', hp: 20, atk: 7, def: 2, speed: 1.05, xp: 18, gold: 12, color: '#e0e0d0', size: 22 },
  mage: {
    name: 'Dark Caster',
    hp: 15,
    atk: 6,
    def: 1,
    speed: 0.9,
    xp: 18,
    gold: 16,
    color: '#60a0ff',
    size: 22,
    init(e: EnemyInst) {
      e.caster = true;
      e.castCd = 60 + Math.floor(Math.random() * 40);
    },
  },
  charger: {
    name: 'Dire Hound',
    hp: 17,
    atk: 7,
    def: 1,
    speed: 1.0,
    xp: 16,
    gold: 12,
    color: '#e08040',
    size: 22,
    init(e: EnemyInst) {
      e.charger = true;
      e.chargeCd = 70 + Math.floor(Math.random() * 60);
      e.chargeState = 0;
      e.chargeT = 0;
      e.dvx = 0;
      e.dvy = 0;
    },
  },
  archer: {
    name: 'Bone Archer',
    hp: 13,
    atk: 6,
    def: 1,
    speed: 0.95,
    xp: 16,
    gold: 14,
    color: '#9aa860',
    size: 20,
    init(e: EnemyInst) {
      e.archer = true;
      e.attackCd = 30 + Math.floor(Math.random() * 40);
    },
  },
  healer: {
    name: 'Acolyte',
    hp: 15,
    atk: 3,
    def: 1,
    speed: 0.9,
    xp: 22,
    gold: 20,
    color: '#60e0a0',
    size: 20,
    init(e: EnemyInst) {
      e.healer = true;
      e.healCd = 90 + Math.floor(Math.random() * 60);
    },
  },
  serpent: {
    name: 'Sea Serpent',
    hp: 26,
    atk: 9,
    def: 2,
    speed: 1.15,
    xp: 24,
    gold: 18,
    color: '#2aa0a0',
    size: 26,
    init(e: EnemyInst) {
      e.aquatic = true;
    },
  },
};

/** Wild-spawn type tables per ring/biome (p03:353-376 verbatim). Enemy TYPE is gated by
 * ring, not just player level: the Vale stays gentle even for veterans, the Frontier is
 * brutal at any level. makeWildEnemy keeps the ring/level branch (it reads RING_SAFE/
 * RING_MID and the party level) and hands `pick` the ONE r it already drew. */
export const WILD_SPAWN: {
  readonly tables: {
    /** biome === 2 (Cinderlands). */
    readonly lava: WildSpawnTable;
    /** biome === 1 (Frozen Wastes). */
    readonly frozen: WildSpawnTable;
    /** df < RING_SAFE — easy lowland, no chargers. */
    readonly vale: WildSpawnTable;
    /** df >= RING_MID — hardest, widest variety (ranged archers + healers appear here). */
    readonly frontier: WildSpawnTable;
    /** mid ring, party level < 3. */
    readonly midEarly: WildSpawnTable;
    /** mid ring, party level < 6. */
    readonly midCore: WildSpawnTable;
    /** mid ring, party level 6+. */
    readonly midLate: WildSpawnTable;
  };
  pick(r: number, table: WildSpawnTable): EnemyKindKey;
} = {
  tables: {
    lava: {
      rows: [
        { t: 0.3, kind: 'charger' },
        { t: 0.6, kind: 'skeleton' },
        { t: 0.85, kind: 'mage' },
      ],
      rest: 'bat',
    },
    frozen: {
      rows: [
        { t: 0.34, kind: 'skeleton' },
        { t: 0.62, kind: 'charger' },
        { t: 0.86, kind: 'mage' },
      ],
      rest: 'bat',
    },
    vale: {
      rows: [
        { t: 0.55, kind: 'slime' },
        { t: 0.9, kind: 'bat' },
      ],
      rest: 'skeleton',
    },
    frontier: {
      rows: [
        { t: 0.14, kind: 'slime' },
        { t: 0.34, kind: 'skeleton' },
        { t: 0.56, kind: 'charger' },
        { t: 0.7, kind: 'archer' },
        { t: 0.82, kind: 'mage' },
        { t: 0.92, kind: 'healer' },
      ],
      rest: 'bat',
    },
    midEarly: {
      rows: [
        { t: 0.5, kind: 'slime' },
        { t: 0.88, kind: 'bat' },
      ],
      rest: 'skeleton',
    },
    midCore: {
      rows: [
        { t: 0.38, kind: 'slime' },
        { t: 0.68, kind: 'bat' },
        { t: 0.9, kind: 'skeleton' },
      ],
      rest: 'charger',
    },
    midLate: {
      rows: [
        { t: 0.28, kind: 'slime' },
        { t: 0.52, kind: 'bat' },
        { t: 0.78, kind: 'skeleton' },
      ],
      rest: 'charger',
    },
  },
  // The old ternary chain, as a walk: first `r < t` row wins, else the trailing branch.
  // Same constants, same strict-< comparisons, same order — bit-identical selection.
  pick(r, table) {
    for (const row of table.rows) if (r < row.t) return row.kind;
    return table.rest;
  },
};
