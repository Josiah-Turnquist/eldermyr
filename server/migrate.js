/*
 * server/migrate.js — the PURE character-save importer (rebuild S1; rebuild/p2-plan.md §6).
 * =============================================================================
 * One function: migrateCharacter(oldBlob) → { blob, fromVersion, toVersion }.
 * It normalizes ANY historical `accounts.character` JSONB row (v1/v2/v3) to the
 * current schema (v4) so the World APPLIES saves but never migrates them.
 *
 * This is an EXTRACTION of world.js _loadCharacter's inline chains (the v1→v2
 * questline synthesis and the v2→v3 personal-milestone synthesis), verbatim in
 * behavior — tests/battery/migrate-roundtrip.js holds a frozen copy of the old
 * inline logic and asserts equality. It is NOT a redesign: fields the old chain
 * never synthesized (skin/shop/dragon/companions on a v1 row) stay absent, and
 * the apply-path defaults in world.js handle them exactly as before.
 *
 * PURITY CONTRACT (hard): no I/O, no globals, no Date/random. The input blob is
 * never mutated; the returned blob shares no references with it (deep clone).
 * The ONE world coupling the old chain had — a legacy veteran flips the ROOM's
 * shared main-quest to started (old world.js:642, applied after aliasing) — is
 * represented here purely (the blob's OWN main copy gets started=true) and
 * re-applied to the live shared object by _loadCharacter, never by this module.
 *
 * Schema history (the `v` stamps written by characterOf over time):
 *   v1  {v:1, name, level, player, inventory}            — later also skin/shop/companions
 *   v2  + quests / maxDepth / bounty / dragon            (v2.57.0)
 *   v3  player slice gains enteredDungeon/gotKey/enteredFrozen  (v2.58.1)
 *   v4  v3 shape + `schemaVersion: 4` (this module's output; characterOf stamps
 *       it on every save going forward — `v: 3` is kept alongside so a rolled-
 *       back server still reads the row identically: the old chains were
 *       field-keyed, never version-keyed). Reader rule: schemaVersion ?? v ?? 1.
 *   Later P2 slices fold shop/quests/maxDepth/bounty/dragon INTO the player
 *   slice as those keys move onto p (plan §6 mapping) — each adds its default
 *   here in the same slice. The v4 stamp does NOT change per fold: readers stay
 *   FIELD-keyed throughout (a row is defined by what it carries).
 *     · S5: shop.tonics/shop.sharpenLevel → player.tonics/player.sharpenLevel
 *       (defaults 0/0); player.seenHeatTip default false (no historical source —
 *       the aura teach re-shows once per hero, intended).
 *
 * Version detection stays FIELD-keyed exactly like the old chains (a row that
 * lies about its `v` migrates by what it actually carries): `quests` missing ⇒
 * the v1 synthesis runs; `player.enteredDungeon` missing ⇒ the v3 synthesis
 * runs. fromVersion in the return is the row's own stamp, for reporting.
 */
'use strict';

const SCHEMA_VERSION = 4;

// The fresh-boot quest box. world.js's live QUEST_TEMPLATE is structuredClone(S.quests)
// after startGame(); that is byte-for-byte this literal (the boot never mutates
// state.quests — verified, and DRIFT-GUARDED: tests/battery/migrate-roundtrip.js boots the
// real game and asserts deep-equality, so a release that adds/renames a quest key fails
// the battery until this literal is updated in step). A pure module can't read the live
// game, which is the point: migration must not depend on a booted world.
const QUEST_TEMPLATE = {
  main: { name: 'Slay the Mountain Kraken', done: false, started: false, hidden: true },
  talk: { name: 'Speak to the Elder', done: false },
  key: { name: 'Find the Dungeon Key', done: false, hidden: true },
  slay: { name: 'Slay 5 monsters', done: false, count: 0, target: 5 },
  frozen: { name: 'Plunder the Frozen Cache', done: false, hidden: true },
  dragon: { name: 'Tame the Emberwyrm (Lv 20)', done: false, hidden: true },
  legion: { started: false, stage: 'none', camps: 0, sealstones: 0, villages: 0, seatRegion: -1 },
};

function clone(o) { return structuredClone(o); }

function migrateCharacter(oldBlob) {
  const c = (oldBlob && typeof oldBlob === 'object') ? oldBlob : null;
  const fromVersion = c ? (c.schemaVersion ?? c.v ?? 1) : 1;
  const out = c ? clone(c) : {};   // never mutate the input; never alias into it

  // ---- questline (v1 → v2) — extracted verbatim from _loadCharacter ------------------
  // Merged OVER the template, so a quest key added in a later release still exists on an
  // older row (mirrors applySnapshot's `if(!state.quests.frozen)` fill, for every key).
  const q = clone(QUEST_TEMPLATE);
  const legacy = !(c && c.quests);                 // a v1 row: no questline was ever saved
  if (!legacy) Object.assign(q, clone(c.quests));
  let mDepth = (c && Number.isFinite(c.maxDepth)) ? Math.max(0, c.maxDepth | 0) : 0;
  let bnty = (c && c.bounty) ? clone(c.bounty) : null;
  // The old chain read `p.level` / `p.inventory.keys` AFTER the apply-assign; those are
  // exactly the row's own values (every real row carries player+inventory — characterOf
  // has emitted both since v1 and returns null when snapshot fails). A row missing them
  // reads 0 here vs the template's 1/0 there — decision-identical (the only thresholds
  // are lvl>1 and lvl>=20, and template keys is 0).
  const lvl = ((c && c.player && c.player.level) | 0);
  const keys = ((c && c.inventory && c.inventory.keys) | 0);
  if (legacy) {
    // v1 rows carry no quests/maxDepth at all. Without this the load would hand EVERY
    // existing character a fresh template, i.e. re-show the intro to every hero exactly
    // once. Synthesize the intro from the durable per-player progress the row DOES carry.
    const veteran = lvl > 1;                       // you cannot reach level 2 without having done the intro
    q.talk.done = veteran;
    q.key.hidden = !veteran;                       // the Elder is what reveals it
    q.key.done = keys > 0;                         // (updateQuests also falls back to a non-empty bag)
    if (veteran) { q.slay.done = true; q.slay.count = q.slay.target; }
    if (lvl >= 20) q.dragon.hidden = false;        // gainXP reveals this at 20 and would never re-fire
    // maxDepth has NO durable source on a v1 row → 0. Cosmetic and self-healing: the
    // "Deepest depth: N" line is simply absent until their next descend. bounty likewise
    // starts clean (rollBounty reads maxDepth, so a stale one can't mis-scale a new one).
    mDepth = 0; bnty = null;
    // A returning veteran has met the Elder → the Kraken hunt is on. Recorded on the
    // blob's OWN main copy (pure); _loadCharacter re-applies it to the room's SHARED
    // main after aliasing (the old post-alias line-642 side effect).
    if (veteran) q.main.started = true;
  }

  // ---- personal milestones (v2 → v3) — chained AFTER the questline block above -------
  // Pre-v3 rows carry no milestones (they lived in the never-saved shared state.flags).
  // Keyed on FIELD PRESENCE, not on the version stamp: a v1 and a v2 row both lack it.
  // (The old chain also ran this for a blob with NO player slice, stamping the fresh
  // template player directly; no real row is playerless — see `lvl` note above — so here
  // a playerless blob simply keeps the template defaults, all false.)
  if (out.player && out.player.enteredDungeon === undefined) {
    // Two independent sources, because neither covers every row on its own:
    //  · mDepth > 0 — proof, but only a v2+ row can carry it (v1 migration zeroed it).
    //  · keys >= 2 — proof within a world: the overworld places exactly ONE key pickup;
    //    every other key drops from a DUNGEON boss. False positives cost one wayfinder
    //    hint; neither source can produce a false NEGATIVE, the direction that matters.
    out.player.enteredDungeon = mDepth > 0 || keys >= 2;
    out.player.gotKey = keys > 0 || !!(q.key && q.key.done);
    // enteredFrozen has NO durable source. Default FALSE — the safe direction: a wrongly-
    // false flag re-plays one lore line (idempotent) and self-heals on the next snow step.
    out.player.enteredFrozen = false;
  }

  // ---- S5 fold: town-empowerment keys move onto the player (plan §6 v4 mapping) --------
  // player-first (a post-S5 row already carries them there), else the old shop slice, else
  // the fresh defaults. The shop copies are DELETED from the output (a MOVE, not a dual-
  // write) so the blob has one owner per value; idempotent because pass 2 finds them on
  // player and no longer on shop. Guarded on out.player like the milestone block above
  // (every real row has a player slice — see the `lvl` note).
  if (out.player) {
    const sh = (c && c.shop) || null;
    if (out.player.tonics === undefined) out.player.tonics = (sh ? sh.tonics : 0) | 0;
    if (out.player.sharpenLevel === undefined) out.player.sharpenLevel = (sh ? sh.sharpenLevel : 0) | 0;
    if (out.player.seenHeatTip === undefined) out.player.seenHeatTip = false;
    if (out.shop) { delete out.shop.tonics; delete out.shop.sharpenLevel; }
  }

  out.quests = q;
  out.maxDepth = mDepth;
  out.bounty = bnty;
  out.schemaVersion = SCHEMA_VERSION;
  return { blob: out, fromVersion, toVersion: SCHEMA_VERSION };
}

module.exports = { migrateCharacter, SCHEMA_VERSION, QUEST_TEMPLATE };
