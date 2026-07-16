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
 * drawEnemy keys (EnemyArtKey below) keep their own factories and joined the registry as
 * draw-hook-only entries in P3/S3. */
export type EnemyKindKey =
  | 'slime'
  | 'bat'
  | 'skeleton'
  | 'mage'
  | 'charger'
  | 'archer'
  | 'healer'
  | 'serpent';

/** drawEnemy keys with factory-owned stats: they carry ONLY art in this registry until
 * the S5 apex slice moves their factories' scaling into apex.ts. */
export type EnemyArtKey = 'dragon' | 'kraken' | 'boss';

/** A gradient handed back by DrawView's surface — structural, so content never needs the
 * DOM lib (the chunk is compiled platform-neutral and the purity rule bans ambient DOM). */
export interface DrawGradient {
  addColorStop(offset: number, color: string): void;
}

/** The 2D drawing surface a draw hook receives — the exact method/property subset the
 * migrated p20 art uses, structurally typed (never the DOM type: content code must stay
 * lib-independent, and a hook reaching for anything outside this contract is a type
 * error, which is the render-purity discipline in compile-time form). */
export interface Draw2D {
  fillStyle: string | DrawGradient;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  font: string;
  textAlign: string;
  save(): void;
  restore(): void;
  clip(): void;
  beginPath(): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  fillText(text: string, x: number, y: number): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): DrawGradient;
}

/** What drawEnemy hands every draw hook (P3/S3; REBUILD.md purity amendment: hooks get
 * their surface as an ARGUMENT — never ambient globals, which module scope + the
 * content-purity token grep enforce). One object, re-stamped per call by the in-part
 * dispatch — hooks must not retain it across calls.
 * `g2d` is deliberately NOT named after the game's ambient context so the purity grep
 * keeps its teeth. `shade`/`rgbOf` are the game's memoised tint helpers (p20). */
export interface DrawView {
  readonly g2d: Draw2D;
  /** Screen-space top-left of the creature (world x/y minus camera). */
  readonly sx: number;
  readonly sy: number;
  /** Hit-flash / telegraph white-out phase — precomputed by the in-part prelude and
   * stamped VERBATIM (its `|| (e.tele && …)` short-circuit hands `null` for a tele-less
   * foe, never coerced — hooks read truthiness only). */
  readonly flash: boolean | null;
  /** shade(hex, amt, mul?): additive amt, multiplicative mul (darkens saturated hues). */
  shade(hex: string, amt: number, mul?: number): string;
  /** rgbOf(hex): "r,g,b" triplet for rgba() glows with a live alpha. */
  rgbOf(hex: string): string;
}

/** The read-only view of an enemy instance a draw hook receives — the exact field set
 * the 11 migrated branches read. readonly: draw hooks PAINT, they never write sim state
 * (the other half of the purity rule, type-enforced). Per-kind fields are optional here;
 * a hook that owns the kind may assert them (e.g. the charger's `e.dvx!`). */
export interface EnemyDrawn {
  readonly w: number;
  readonly h: number;
  readonly color: string;
  readonly wobble: number;
  /** Charger wind-up/run state machine (init hook seeds it). */
  readonly chargeState?: number;
  readonly dvx?: number;
  /** Cosmetic facing bit — set by updateEnemies ONLY for kinds with `faces: true`. */
  readonly _faceL?: number;
  /** Wild Emberwyrm ready to tame (the [E] TAME label). */
  readonly subdued?: boolean;
}

/** Art contract every drawEnemy key must satisfy. `draw` is MANDATORY: a kind without a
 * draw hook is a compile error, not an invisible enemy (the DESIGN-doc silent-failure
 * class this registry dissolves). */
export interface EnemyArt {
  /** Paint the creature. Verbatim p20 art: everything through `v.g2d` in screen space. */
  draw(v: DrawView, e: EnemyDrawn): void;
  /** This kind has an unambiguous head/tail — updateEnemies tracks `_faceL` for it (the
   * derived FACING map in enemies.ts), and its draw hook mirrors about its own centre. */
  readonly faces?: boolean;
}

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

export interface EnemyKind extends EnemyArt {
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
