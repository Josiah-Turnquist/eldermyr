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

// ============================================================================================
// Boss specials (P3/S4). One entry per special in specials.ts carries all three of the
// telegraph triad the DESIGN doc's silent-failure #1 warned about: `wind` (the windup
// length startBossSpecial reads), `exec` (the effect execBossSpecial fires when the
// telegraph completes), and MANDATORY-in-spirit `drawTele` (the telegraph the p20 dispatch
// paints) — so adding a boss special = one entry here, and a special with no draw branch is
// a missing property, not an invisible one-shot.
//
// The exec branches are SIM logic (they mutate the world, spawn foes, deal damage, play
// audio), so — like the S3 draw hooks — they can never lexically reach the game's ambient
// `state`/`Sound`/factory globals (module scope + the content-purity token grep forbid it).
// They receive everything through a curated SpecialActView ARGUMENT whose member NAMES avoid
// the banned tokens (audio is `sfx`, the roster is `enemies`, etc.); the migrated bodies are
// otherwise VERBATIM (the S3 "verbatim hook move" discipline — only `Sound.`→`sfx.` and
// `state.X`→the destructured `X` change, same op order, same Math.random() draws).

/** The six boss-special keys — the execBossSpecial branch set (p17) and the p20 telegraph
 * chain. bossSpecials picks a subset onto `e.specials`; updateBoss draws one at random. */
export type SpecialKey = 'slam' | 'charge' | 'nova' | 'summon' | 'pullunder' | 'raiseadds';

/** The live telegraph on a winding-up boss (startBossSpecial seeds it; drawTele reads it). */
export interface SpecialTele {
  readonly name: string;
  readonly t: number;
  readonly max: number;
  readonly radius: number;
  readonly aimX: number;
  readonly aimY: number;
}

/** The read-only view of a boss a drawTele hook paints — the exact fields the p20 telegraph
 * branches read. readonly: telegraphs PAINT, they never write sim state (the S3 rule). */
export interface SpecialDrawn {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly wobble: number;
  readonly tele: SpecialTele;
}

/** A spawned add / summoned foe (makeDungeonEnemy / makePinnacleAdd output). The exact field
 * set raiseadds' ordered-court check and its spawn-burst read — the real enemy objects carry
 * far more; this is the structural minimum the exec branch touches. */
export interface SpecialSpawn {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  hp: number;
  _pinRef?: unknown;
}

/** The mutable boss instance an exec hook receives. Only the fields the six branches read or
 * write — `dash`/`_nextKill` are written (charge sets the lunge, raiseadds resets the kill
 * cursor); the rest are read. */
export interface BossActor {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly atk: number;
  readonly wobble: number;
  readonly pinKey?: string;
  readonly tele: SpecialTele | null;
  dash: { vx: number; vy: number; t: number } | null;
  _nextKill?: number;
}

/** The mutable player view pullunder touches: it deepens the chill and floats a "DRAGGED
 * UNDER" tag at the hero. `chillT` is written; x/y/w are read for the float position. */
export interface SpecialPlayer {
  chillT: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

interface ToneOpts {
  readonly slideTo?: number;
}
interface NoiseOpts {
  readonly filter?: string;
  readonly freq?: number;
}
/** The audio surface the exec branches use (the game's `Sound` object, handed in under a
 * non-banned name so the purity grep keeps its teeth). */
export interface SpecialSfx {
  tone(freq: number, dur: number, wave: string, vol: number, opts?: ToneOpts): void;
  noise(dur: number, vol: number, opts?: NoiseOpts): void;
  swing(): void;
  cast(): void;
}
interface ProjectileOpts {
  readonly color?: string;
  readonly r?: number;
  readonly life?: number;
  readonly element?: string;
  readonly ownerRef?: unknown;
}
interface BurstOpts {
  readonly color?: string;
  readonly speed?: number;
  readonly decay?: number;
}

/** Everything an exec hook needs from the sim, curated at the p17 dispatch site and passed
 * in — no ambient globals, no banned tokens. Member NAMES are deliberately off the grep list
 * (`sfx` not `Sound`, `enemies`/`player` not `state.*`). Snapshot primitives (`map`,
 * `dungeonLevel`) are read at dispatch time; `enemies`/`player` are the live references so
 * pushes/writes land on the real world exactly as the inline branch did. */
export interface SpecialActView {
  /** Player centre at the moment the special fires (was pcx/pcy). */
  readonly px: number;
  readonly py: number;
  readonly map: string;
  readonly dungeonLevel: number;
  readonly enemies: SpecialSpawn[];
  readonly player: SpecialPlayer;
  readonly sfx: SpecialSfx;
  readonly TILE: number;
  readonly OW_W: number;
  readonly OW_H: number;
  readonly T: { readonly WATER: number };
  addShake(n: number): void;
  playerTakeDamage(n: number): void;
  spawnRing(x: number, y: number, color: string): void;
  spawnBurst(x: number, y: number, n: number, opts: BurstOpts): void;
  addProjectile(x: number, y: number, vx: number, vy: number, dmg: number, opts: ProjectileOpts): void;
  findOpenTile(map: string, tx: number, ty: number): { tx: number; ty: number };
  makeDungeonEnemy(tx: number, ty: number, lvl: number): SpecialSpawn;
  makePinnacleAdd(boss: BossActor, isKing: boolean, tx: number, ty: number, i: number): SpecialSpawn;
  getTile(layer: string, tx: number, ty: number): number;
  floatDamage(x: number, y: number, text: string, color: string): void;
  log(msg: string, cls: string): void;
}

/** One boss special: the windup length, the effect, and the telegraph. `drawTele` is the
 * property the DESIGN doc's silent-failure #1 makes structural — a new special without it is
 * a visibly missing telegraph at author time, not an invisible in-game one-shot. */
export interface Special {
  /** Windup ticks before the effect fires (startBossSpecial reads it; p17's old `{…}[name]`
   * table). */
  readonly wind: number;
  /** The effect, fired by execBossSpecial when the telegraph completes. Verbatim p17 branch,
   * ambient surface threaded through the SpecialActView arg. */
  exec(e: BossActor, a: SpecialActView): void;
  /** The telegraph, painted by the p20 dispatch each frame while `e.tele` is live. Verbatim
   * p20 branch through `v.g2d` (the S3 DrawView surface). */
  drawTele(v: DrawView, e: SpecialDrawn): void;
}

/** bossSpecials' pick table (p17:378 roster fn → data): the base roster every boss gets, the
 * colour-keyed extra (the red nemesis leans into `charge`, everyone else `nova`), and the
 * level gate that adds `summon`. The BRANCHING stays in the p17 wrapper (the S2 precedent);
 * only the constants live here. */
export interface BossRoster {
  readonly base: readonly SpecialKey[];
  readonly redColor: string;
  readonly redAdd: SpecialKey;
  readonly elseAdd: SpecialKey;
  readonly summonLevel: number;
  readonly summonAdd: SpecialKey;
}

// ============================================================================================
// Apex bosses (P3/S5) — the world-boss DATA: the four Great Hunts, the two pinnacle fights,
// and the dragon/pinnacle tuning constants. This is the #10 fusion split — the SPAWN DATA
// (base hp/atk/def/xp/gold, lair, colour, specials roster, reward/drop descriptors, the flat
// levels + arena/leash knobs) moves into the registry; the SCALING FACTORIES that consume it
// (makeGreatBeast/makePinnacleBoss/makeWildDragon/makeKraken + the pinnacle add/drop/hazard/
// respawn machinery) stay in-part and read the data through positional aliases at their old
// declaration lines (`const GREAT_HUNTS = CONTENT.apex.hunts;` — plan §1.3's worked form,
// the mission's stated method: verbatim data, same RNG draw order, factories consume it). So
// adding a new hunt or pinnacle (reusing the existing formula) = one row here; a genuinely new
// scaling formula is the only thing that still touches a part. Plain data, no hooks, no RNG.
// Deliberately NOT frozen (the registry-wide rule) — the mutation tripwire is the oracles +
// content-purity's canary; `e.specials = h.specials` shares the array by reference exactly as
// the monolith always did (read-only downstream), and `reward` is JSON-deep-copied before use.

/** One elite-affix roll baked into a Great Hunt's fixed trophy (the reward weapon/armor). */
export interface ApexAffix {
  readonly t: string;
  readonly v: number;
  readonly label: string;
}
export interface ApexRewardWeapon {
  readonly name: string;
  readonly atk: number;
  readonly style: string;
  readonly cd?: number;
  readonly rarity: number;
  readonly element?: string;
  readonly affixes: readonly ApexAffix[];
}
export interface ApexRewardArmor {
  readonly name: string;
  readonly def: number;
  readonly rarity: number;
  readonly affixes: readonly ApexAffix[];
}
/** A Great Hunt's one-time fixed trophy (dropGreatBeastReward JSON-deep-copies it). */
export interface ApexReward {
  readonly weapon?: ApexRewardWeapon;
  readonly armor?: ApexRewardArmor;
}

/** A Great Hunt world-beast row (was GREAT_HUNTS[*], p22). makeGreatBeast reads hp/atk/def/
 * xp/gold/specials + scales them; setupOverworld/maybeRespawnHunts read lair/key; the shop and
 * Hunt Master read name/where. */
export interface ApexHunt {
  readonly key: string;
  readonly name: string;
  readonly color: string;
  readonly element: string;
  readonly where: string;
  readonly island?: boolean;
  readonly lair: { readonly tx: number; readonly ty: number };
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly xp: number;
  readonly gold: number;
  readonly specials: readonly string[];
  readonly reward: ApexReward;
}

/** The unique-drop descriptor for a pinnacle boss (dropPinnacleReward → makeUnique keys). */
export interface ApexPinnacleDrops {
  readonly style: string;
  readonly styleUniq: string;
  readonly universalUniq: string;
}
/** A pinnacle apex-fight row (was PINNACLE_BOSSES[*], p22). makePinnacleBoss reads hp/atk/def/
 * xp/gold/specials/type/color + scales; pinnacleLair keys off `key`; drops feeds makeUnique. */
export interface ApexPinnacle {
  readonly key: string;
  readonly name: string;
  readonly color: string;
  readonly type: string;
  readonly island: boolean;
  readonly where: string;
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly xp: number;
  readonly gold: number;
  readonly night: boolean;
  readonly specials: readonly string[];
  readonly drops: ApexPinnacleDrops;
}

/** The apex registry: the two ordered tables (arrays — the aliases GREAT_HUNTS/PINNACLE_BOSSES
 * keep .find/.length/for-of semantics) plus the flat-level and arena/leash tuning constants
 * the pinnacle factory + hazard read. */
export interface ApexRegistry {
  readonly hunts: readonly ApexHunt[];
  readonly pinnacles: readonly ApexPinnacle[];
  /** The Emberwyrm's flat rung + its one colour source (makeWildDragon + drawPlayer's steed). */
  readonly dragonLevel: number;
  readonly dragonColor: string;
  /** The pinnacle bosses' flat level (makePinnacleBoss + makePinnacleAdd). */
  readonly pinLevel: number;
  /** Shrinking-arena hazard knobs (makePinnacleBoss seeds arenaR; pinnacleHazard drives it). */
  readonly pinArenaStart: number;
  readonly pinArenaMin: number;
  readonly pinArenaShrink: number;
  readonly pinLeash: number;
}

// ============================================================================================
// Gear (P3/S6) — the loot/shop/mastery DATA: rarity + naming tables, the fixed shop stock,
// the pinnacle-chase uniques, the pattern weapons, the style-mastery perks, and the generator
// pools. All class-P — the parts keep positional aliases (`const RARITIES = CONTENT.gear.
// rarities;`) and the loot factories (genWeapon/genArmor/makeUnique/genShopStock/rollAffixes/
// rollPatternWeapon) consume these unchanged, same RNG draw order. Plain data + one pure
// helper (affixPool, no RNG). None of these symbols are CAPTURE'd or read externally.

/** A weapon style — the key of STYLE_NAMES / MASTERY / the generator's style pool. */
export type WeaponStyle = 'melee' | 'ranged' | 'magic';

/** One rarity tier (RARITIES[*], p01): drives item stat multiplier + base durability + colour. */
export interface Rarity {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly mult: number;
  readonly dur: number;
}

/** A baked affix on a fixed item — {type, magnitude, display label} (pattern weapons, the
 * rollAffixes pools, and structurally the same as an apex reward's affix). */
export interface AffixSpec {
  readonly t: string;
  readonly v: number;
  readonly label: string;
}

/** A super-rare multi-bolt magic weapon (PATTERN_WEAPONS[*], p02) — rollPatternWeapon
 * JSON-deep-copies it, so the row is never mutated. */
export interface PatternWeapon {
  readonly name: string;
  readonly atk: number;
  readonly style: string;
  readonly rarity: number;
  readonly element: string;
  readonly pattern: string;
  readonly reqLevel: number;
  readonly reqProf: number;
  readonly affixes: readonly AffixSpec[];
}

/** A biome's shop display-name row (SHOP_NAMES[biome], p08). */
export interface ShopNameRow {
  readonly melee: string;
  readonly ranged: string;
  readonly magic: string;
  readonly mail: string;
  readonly plate: string;
}

/** A fixed shop weapon (SHOP_WEAPONS[*], p08). cd on melee/ranged only; element on the
 * elemental variants only. */
export interface ShopWeapon {
  readonly id: string;
  readonly name: string;
  readonly style: string;
  readonly atk: number;
  readonly cost: number;
  readonly rarity: number;
  readonly reqLevel: number;
  readonly reqProf: number;
  readonly cd?: number;
  readonly element?: string;
}

/** A fixed shop armor (SHOP_ARMOR[*], p09). */
export interface ShopArmor {
  readonly id: string;
  readonly name: string;
  readonly def: number;
  readonly cost: number;
  readonly rarity: number;
  readonly reqLevel: number;
}

/** A pinnacle-chase unique relic (UNIQUES[key], p22). makeUnique reads slot/style/element/
 * atkMul/defMul/cd/name/uniqDesc and shapes a real weapon/armor object. */
export interface Unique {
  readonly slot: string;
  readonly name: string;
  readonly uniqDesc: string;
  readonly style?: string;
  readonly element?: string;
  readonly atkMul?: number;
  readonly defMul?: number;
  readonly cd?: number;
}

/** The gear registry: loot/shop/mastery tables + generator pools + the pure affix-pool
 * helper (rollAffixes' offense/defense definitions; the RNG pick stays in the part). */
export interface GearRegistry {
  readonly rarities: readonly Rarity[];
  readonly styleNames: Record<WeaponStyle, readonly string[]>;
  readonly armorNames: readonly string[];
  readonly rarPrefix: readonly string[];
  /** Per-style [perk name, description] pairs, tiers unlocked at masteryLvls. */
  readonly mastery: Record<WeaponStyle, readonly (readonly string[])[]>;
  readonly masteryLvls: readonly number[];
  readonly patternWeapons: readonly PatternWeapon[];
  readonly shopNames: Record<number, ShopNameRow>;
  readonly shopWeapons: readonly ShopWeapon[];
  readonly shopArmor: readonly ShopArmor[];
  readonly uniques: Record<string, Unique>;
  /** genWeapon's style-selection pool + element-selection pool (the generator's "name pools"). */
  readonly genStyles: readonly WeaponStyle[];
  readonly genElements: readonly string[];
  /** rollAffixes' offense/defense pool DEFINITIONS (rIdx-scaled values/labels; NO RNG — the
   * pick stays in rollAffixes). Fresh array each call, exactly as the inline pools were. */
  affixPool(rIdx: number, isWeapon: boolean): AffixSpec[];
}

// ============================================================================================
// Elite affixes (P3/S7) — the "variety at zero art cost" enemy affixes (AFX_DEFS/AFX_KEYS,
// p18). Each affix is DATA (its scalar flag, HUD label, name prefix) plus an OPTIONAL `apply`
// hook — the per-key seeding rollEliteAffixes ran inline (shielded stamps a shield pool off
// maxHp, warded arms its ward window; vampiric/splitting seed nothing). The apply hook is
// pure: it mutates ONLY the enemy instance it is handed (no state/Sound/RNG — the affix pick
// stays in rollEliteAffixes, the HIT behaviour stays in the hot-path afxHit). AFX_DEFS/AFX_KEYS
// keep positional aliases in p18; rollEliteAffixes calls `d.apply(e)` in place of the old
// `if (key === 'shielded') … else if (key === 'warded') …`.

/** The enemy fields an affix `apply` hook seeds. maxHp is read (shield pool = 25% of it); the
 * rest are written. Elite-affix state is all SCALARS (MP packScalar drops arrays/objects), so
 * an affixed elite rides snapshots to clients with zero extra wiring. */
export interface AffixTarget {
  readonly maxHp: number;
  shieldMax: number;
  shieldHp: number;
  shieldRegenT: number;
  wardT: number;
  wardCd: number;
}

/** One elite affix (AFX_DEFS[key], p18). `flag` is the scalar the enemy carries (afxShield/
 * afxVamp/afxSplit/afxWard — the hot-path afxHit/afxVampHeal/afxSplitDeath read it); `label`
 * is the HUD tag; `pre` is the name prefix. `apply` seeds the per-key state (shielded/warded);
 * an affix with none simply omits it (vampiric/splitting), exactly as the old branch-less path. */
export interface EliteAffix {
  readonly flag: string;
  readonly label: string;
  readonly pre: string;
  apply?(e: AffixTarget): void;
}

/** The elite-affix registry: the key→def map (rollEliteAffixes reads AFX_DEFS[key]) + the
 * ordered key pool it splices from (AFX_KEYS — the RNG indexes it, so the order is the
 * contract). */
export interface AffixRegistry {
  readonly defs: Record<string, EliteAffix>;
  readonly keys: readonly string[];
}
