// src/content/index.ts — content registry root (P3).
//
// Imports every registry, builds ONE object, and exposes it explicitly (greppable, no
// esbuild globalName) for the classic-script game program: scripts/build.mjs compiles
// this entry to a single non-minified IIFE chunk and prepends it to the parts concat,
// so every part sees CONTENT at load time. Parts consume via positional lexical aliases
// (`const ELEMENTS = CONTENT.elements;` at the original declaration line) or direct
// CONTENT.<registry> lookups at dispatch sites. Module era (post-P3): the chunk step is
// deleted and these imports go direct — the registries themselves don't change.
//
// Deliberately NOT frozen: sloppy-mode writes to frozen objects fail silently — the
// exact failure class this codebase refuses. The mutation tripwire is the golden oracles
// plus the content-purity battery canary (live CONTENT deep-equals a fresh re-eval of
// the chunk after a headless run).
import { ELEMENTS } from './elements';
import { ENEMIES, FACE_DZ, FACING, WILD_SPAWN } from './enemies';
import { DUNGEONS } from './dungeons';
import { BOSS_ROSTER, SPECIALS } from './specials';
import { APEX } from './apex';
import { GEAR } from './gear';
import { AFFIXES } from './affixes';
import { COMPANIONS } from './companions';
import { TABLES } from './tables';
import { CURVES } from './curves';

const CONTENT = {
  elements: ELEMENTS,
  // P3/S2: CONTENT.enemies stays the bare kind→entry map so dispatch sites can do
  // CONTENT.enemies[e.type] (plan §1.3); the wild-spawn tables ride a sibling key.
  // P3/S3: entries carry the draw hooks; facing/faceDz feed the p20 positional aliases
  // (FACING derived from the entries' `faces` flags — the one-source rule).
  enemies: ENEMIES,
  wildSpawn: WILD_SPAWN,
  dungeons: DUNGEONS,
  facing: FACING,
  faceDz: FACE_DZ,
  // P3/S4: CONTENT.specials is the bare name→entry map so the dispatch sites resolve
  // CONTENT.specials[name] (startBossSpecial `.wind`, execBossSpecial `.exec`, the p20
  // telegraph `.drawTele`); bossSpecials' pick table rides a sibling key.
  specials: SPECIALS,
  specialRoster: BOSS_ROSTER,
  // P3/S5: the apex-boss DATA (Great Hunts + pinnacles + dragon/pin tuning). The p22
  // factories keep positional aliases (`const GREAT_HUNTS = CONTENT.apex.hunts;` etc.) and
  // consume these rows unchanged — spawn data here, scaling curves in the factory.
  apex: APEX,
  // P3/S6: the gear DATA (rarity/name tables, shop stock, uniques, pattern weapons, mastery,
  // gen pools + the affixPool helper). The p01/p02/p08/p09/p22 loot factories keep positional
  // aliases (`const RARITIES = CONTENT.gear.rarities;` etc.) and consume them unchanged.
  gear: GEAR,
  // P3/S7: the elite-affix DATA + per-key apply hooks (AFX_DEFS/AFX_KEYS, p18). p18 keeps
  // positional aliases; rollEliteAffixes calls defs[key].apply(e) for the per-key seeding,
  // afxHit (the hot path) stays in-part.
  affixes: AFFIXES,
  // P3/S9: the warband DATA + the level-scaling formula (COMP_CLASSES/COMP_NAMES/COMP_CAP/
  // compStatsFor, p04). p04 keeps positional aliases; statsFor is tiers-ready (tier 0 = today).
  companions: COMPANIONS,
  // P3/S10: the small-tables sweep — seasons/foods/bless/trade/status/regions/poi/holds/warlord/
  // nemesis/ability-knobs (p03/p04/p05/p08/p09/p10/p11/p13/p14/p15). Pure display DATA; each part
  // keeps a positional alias. The steed's colour/level are in apex (S5); the drawSteed hook is deferred.
  tables: TABLES,
  // P3/S11: the level/distance SCALING FORMULAS (xpForLevel p12 + wild/dungeon stat+reward factors p03).
  // Extraction only — Math.round stays at the factory call sites; F1 re-tunes wildReward (#113) later.
  curves: CURVES,
};

export type Content = typeof CONTENT;

(globalThis as { CONTENT?: Content }).CONTENT = CONTENT;
