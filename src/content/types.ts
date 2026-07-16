// src/content/types.ts — shared entry-shape interfaces for the content registries (P3).
//
// Strict TS from day one (REBUILD.md owner decision). Entry data = plain values; hooks
// (added by later slices) are pure functions of their args — they can never lexically
// reach game globals because these are real ES modules, so the acting-context discipline
// is type-enforced at compile time. Purity rule (REBUILD.md, amended P3/S1): content
// never references the DOM, audio, storage, or the live sim — draw hooks receive their
// 2D drawing surface via a DrawView argument (lands with the S3 render slice).
//
// Later slices add draw hooks on EnemyKind (S3), Special (S4), ApexBoss (S5), gear/affix/
// dungeon/companion/table/curve shapes (S6-S11) here — one interface per content type.

/** The four damage elements (p17's table, migrated in P3/S1). */
export type ElementKey = 'fire' | 'frost' | 'poison' | 'shock';

export interface ElementDef {
  /** Display name ("Fire") — also reaches sim state via genWeapon's " of Fire" naming. */
  readonly name: string;
  /** Bolt / floatie / UI hex color. */
  readonly color: string;
  /** "r,g,b" triplet for rgba() aura glows (Heat pulsate). */
  readonly rgb: string;
  /** One-glyph tag rendered next to the name in item/shop HTML. */
  readonly tag: string;
}

/** The eight base enemy kinds (p03 makeEnemy's table, migrated in P3/S2). The other three
 * drawEnemy keys (boss/dragon/kraken) keep their own factories and join this registry as
 * draw-hook entries in S3 (which also adds the then-required `draw`/`faces` fields). */
export type EnemyKindKey =
  | 'slime'
  | 'bat'
  | 'skeleton'
  | 'mage'
  | 'charger'
  | 'archer'
  | 'healer'
  | 'serpent';

/** The freshly-built enemy instance an `init` hook receives — exactly the fields the p03
 * per-type blocks touch. Hooks mutate the INSTANCE only, never registry rows (plan risk #3:
 * the content-purity canary deep-equals live CONTENT against a fresh chunk re-eval). */
export interface EnemyInst {
  caster: boolean;
  castCd: number;
  attackCd: number;
  archer?: boolean;
  charger?: boolean;
  chargeCd?: number;
  chargeState?: number;
  chargeT?: number;
  dvx?: number;
  dvy?: number;
  healer?: boolean;
  healCd?: number;
  aquatic?: boolean;
}

export interface EnemyKind {
  readonly name: string;
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly speed: number;
  readonly xp: number;
  readonly gold: number;
  /** Body hex color (S3 draw hooks derive their shading from it). */
  readonly color: string;
  /** Square body size in px — makeEnemy maps it to w/h and the tile-centering offset. */
  readonly size: number;
  /** Per-kind seeding, verbatim from p03's type blocks. RNG rule (plan §1.2): only the
   * Math.random() draws the migrated block already made, same count, same order. */
  init?(e: EnemyInst): void;
}

/** One ordered row of a wild-spawn threshold chain: the first row with `r < t` wins.
 * These are the monolith's EXACT ternary-chain constants relocated (p03:353-376) — the
 * walk reproduces the old comparisons bit-for-bit, which is what lets S2 hold the golden
 * hashes. (True normalized per-kind weights would re-map the r-space — that shape change
 * is a conscious re-record for a feature slice, not a migration.) */
export interface WildSpawnRow {
  readonly t: number;
  readonly kind: EnemyKindKey;
}
export interface WildSpawnTable {
  readonly rows: readonly WildSpawnRow[];
  /** The chain's trailing branch — picked when no row's threshold exceeds r. */
  readonly rest: EnemyKindKey;
}

/** Level-gated dungeon pool growth (p03:392-397 → dungeons.ts, P3/S2): at trash-spawn
 * time every knob with `level >= minLevel` appends its kind to the theme pool, in row
 * order — archer joins at depth 3, healer at depth 4. */
export interface DungeonPoolGrowth {
  readonly minLevel: number;
  readonly add: EnemyKindKey;
}
