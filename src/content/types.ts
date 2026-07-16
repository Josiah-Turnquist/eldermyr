// src/content/types.ts — shared entry-shape interfaces for the content registries (P3).
//
// Strict TS from day one (REBUILD.md owner decision). Entry data = plain values; hooks
// (added by later slices) are pure functions of their args — they can never lexically
// reach game globals because these are real ES modules, so the acting-context discipline
// is type-enforced at compile time. Purity rule (REBUILD.md, amended P3/S1): content
// never references the DOM, audio, storage, or the live sim — draw hooks receive their
// 2D drawing surface via a DrawView argument (lands with the S3 render slice).
//
// Later slices add EnemyKind (S2/S3), Special (S4), ApexBoss (S5), gear/affix/dungeon/
// companion/table/curve shapes (S6-S11) here — one interface per content type.

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
