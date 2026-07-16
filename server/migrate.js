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
 *     · S6: player.hasBoat default false (NO historical source — boats were shared
 *       root state and never persisted at all, so every reboot repossessed them;
 *       a 250 g re-buy is the honest floor) + player.wayfind default true (the [O]
 *       guide pref; client-local in MP, so the save copy is only the SP default).
 *     · S7: shop.shopPurchased/shop.cargo → player.shopPurchased/player.cargo
 *       (defaults []/zero-hold, cargo normalized to the full goods shape exactly
 *       like the old apply-side Object.assign). lastRestDay gets NO default on
 *       purpose: an old row never carried it, and absent means addPlayer's
 *       join-rested stamp stands — a synthesized day-1 would make every veteran
 *       join Exhausted on a server past day 3. fishCd is never persisted at all.
 *     · S8: shop.ingredients → player.ingredients (normalized to the full pantry
 *       shape exactly like the old apply-side Object.assign). That was the LAST
 *       shop key: the emptied slice is DELETED from the output — characterOf
 *       stopped emitting `shop` in S8, so a migrated old row and a fresh v4 save
 *       of the same hero now carry the identical shape.
 *     · S9: player.visitedTowns default [] (NO historical source — it was a shared
 *       root key outside characterOf entirely, wiped on every reboot; the list
 *       self-heals as the hero re-enters towns). The shop session (activeShopTown/
 *       activeStock/activeShopName) is never persisted at all — no default here.
 *     · S10: top-level dragon.tamed → player.dragon = {tamed, mounted:false}
 *       (mounted is transient — a row never dictates flight; the apply path
 *       re-grounds it anyway). A v1 row never carried a dragon anywhere and gets
 *       NO synthesized default (the apply-side template {tamed:false,mounted:false}
 *       stands, exactly like lastRestDay). sailing is never persisted at all.
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
    // ---- S6: boat + guide pref (plan §3 #4/#6) — pre-move rows never carried either anywhere
    // (hasBoat was shared-and-never-saved; wayfind was an SP root key outside characterOf), so
    // there is nothing to fold: defaults only, pass-through when a v4 row already has them.
    if (out.player.hasBoat === undefined) out.player.hasBoat = false;
    if (out.player.wayfind === undefined) out.player.wayfind = true;
    // ---- S7 fold: shop.shopPurchased/shop.cargo move onto the player (same MOVE semantics as
    // the S5 fold — one owner per value, shop copies deleted, idempotent via player-first).
    // cargo is normalized to the full goods shape, mirroring the old apply-side
    // `Object.assign({furs:0,…}, c.shop.cargo || {})` so a row from before a goods type existed
    // still loads whole. lastRestDay: deliberately NO default (see the schema-history note —
    // absent means addPlayer's join-rested stamp stands). fishCd is never persisted at all.
    if (out.player.shopPurchased === undefined) out.player.shopPurchased = Array.isArray(sh && sh.shopPurchased) ? clone(sh.shopPurchased) : [];
    if (out.player.cargo === undefined) out.player.cargo = Object.assign({ furs: 0, grain: 0, spice: 0, ore: 0 }, (sh && sh.cargo) || {});
    if (out.shop) { delete out.shop.shopPurchased; delete out.shop.cargo; }
    // ---- S8 fold: shop.ingredients moves onto the player (same MOVE semantics; pantry
    // normalized to the full ingredient set, mirroring the old apply-side
    // `Object.assign({herb:0,…}, c.shop.ingredients || {})`). The shop slice is now empty on
    // every historical row (S5+S7+S8 folded all five keys it ever carried) — delete it when it
    // is, so the output matches what characterOf writes post-S8; an unknown key would keep it
    // (conservative: never drop data this module doesn't understand).
    if (out.player.ingredients === undefined) out.player.ingredients = Object.assign({ herb: 0, berry: 0, mushroom: 0, fish: 0 }, (sh && sh.ingredients) || {});
    if (out.shop) { delete out.shop.ingredients; if (!Object.keys(out.shop).length) delete out.shop; }
    // ---- S9: the per-hero travel list (plan §3 #1) — pre-move rows never carried it anywhere
    // (a shared root key outside characterOf), so there is nothing to fold: default [] only,
    // pass-through when a v4 row already has it. Deliberately NOT the fresh-join [spawn town]:
    // the pure module can't know the world's towns, and an empty list self-heals on the next
    // town visit. The shop session is never persisted, so it is never synthesized either.
    if (out.player.visitedTowns === undefined) out.player.visitedTowns = [];
    // ---- S10 fold: the steed moves onto the player (same MOVE semantics as the shop folds —
    // player-first, one owner per value, top-level copy deleted; idempotent because pass 2
    // finds it on player and no top-level copy). mounted is normalized to false: it is
    // transient (the apply path re-grounds it regardless), so the fold never trusts a row's
    // flight. A row with no dragon anywhere (v1) synthesizes NOTHING — the apply-side
    // template default stands. sailing is never persisted, so it is never synthesized either.
    if (out.player.dragon === undefined && c && c.dragon) out.player.dragon = { tamed: !!c.dragon.tamed, mounted: false };
    delete out.dragon;
  }

  out.quests = q;
  out.maxDepth = mDepth;
  out.bounty = bnty;
  out.schemaVersion = SCHEMA_VERSION;
  return { blob: out, fromVersion, toVersion: SCHEMA_VERSION };
}

module.exports = { migrateCharacter, SCHEMA_VERSION, QUEST_TEMPLATE };
