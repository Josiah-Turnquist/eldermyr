'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/*
 * migrate-roundtrip.js — the save-schema safety floor (rebuild S1; rebuild/p2-plan.md §6).
 *
 * Guards the PURE importer server/migrate.js, extracted from world.js _loadCharacter's
 * inline v1→v2→v3 chains. Three layers:
 *
 *  1. PURE:  synthetic v1/v2/v3 fixtures (shapes taken from the real historical
 *     characterOf emissions — git d0260af / 056cf71 / a077eba / b190799) run through BOTH
 *     the module AND a frozen verbatim copy of the old inline chains; outputs must match,
 *     and ALSO match hand-derived literals (so a transcription slip in the frozen copy
 *     can't silently agree with a module bug). Plus idempotence + purity (input never
 *     mutated, output shares no refs).
 *  2. REMAP: unit proof for the golden-hash overlay scaffolding in
 *     tests/golden/serialize.mjs — the table ships EMPTY, a populated entry round-trips
 *     (moved-shape view byte-equals the old shape, $ref dedup preserved), absent paths
 *     no-op, the view never mutates the root.
 *  3. WORLD: boots the real game once — drift-guards migrate.js's QUEST_TEMPLATE literal
 *     against the live booted state.quests (a release that adds a quest key fails HERE),
 *     asserts characterOf stamps schemaVersion 4, loads era-downgraded REAL saves through
 *     addPlayer (shared-quest aliasing intact, legacy veteran flips the ROOM's main,
 *     v3 milestones pass through UNtouched), and round-trips characterOf → migrate.
 *
 * Optional: MIGRATE_DUMP=<path from scripts/db-dump.mjs> additionally runs every real
 * blob through the importer (no-throw, version monotonicity, idempotence).
 *
 * Vacuity: SEEN FAILING against a perturbed migrate.js (`q.talk.done = veteran` inverted
 * to `false`) — 5 assertions failed, spanning all three detection layers (old-chain
 * oracle, hand-derived literals, real-world load):
 *   FAIL v1-early: quests match the old inline chain  [$.talk.done (false vs true)]
 * (2026-07-15, S1.)
 * S5 vacuity: SEEN FAILING (10 asserts) against a scratch repo with the migrate S5-fold
 * block deleted + characterOf's shop slice reverted + REMAP emptied — all 7 layer-1 fold
 * asserts, the REMAP-table pin, the characterOf v4 emission, and the real-path v1 load
 * (A.tonics came back 0, the exact cutover regression the mapping prevents). (2026-07-16.)
 * S6 vacuity: SEEN FAILING (11 asserts) against a pre-S6 scratch tree (HEAD copies of
 * migrate.js/serialize.mjs/world.js/dist) — all 7 layer-1 default asserts, the REMAP pin,
 * the characterOf S6 emission, the real-path v1 defaults, and boat-survives-reboot
 * (E.hasBoat came back undefined: the exact evaporation the move fixes). (2026-07-16.)
 * S7 vacuity: SEEN FAILING (11 asserts) against a pre-S7 git worktree (HEAD 76326c6 + its own
 * dist build) — all 7 layer-1 fold asserts, the REMAP pin, the characterOf S7 emission, the
 * real-path v1 fold, and rest-day-survives-reboot (E.lastRestDay came back 1, not 9: the exact
 * free-rest-per-reconnect the move fixes). (2026-07-16.)
 * S8 vacuity: SEEN FAILING (11 asserts) against a pre-S8 git worktree (HEAD c55e3bf + its own
 * dist build) — all 7 layer-1 fold asserts, the REMAP pin, the characterOf S8 emission (the row
 * still carried a shop slice), the real-path v1 fold (A.ingredients came back all-zero: the
 * exact pantry wipe the mapping prevents), and pantry-survives-reboot. (2026-07-16.)
 * S9 vacuity: SEEN FAILING (11 asserts) against a pre-S9 git worktree (HEAD 9f3b396 + its own
 * dist build) — all 7 layer-1 default asserts, the REMAP pin (10 ≠ 14 entries), the characterOf
 * S9 emission, the real-path v1 default, and travel-list-survives-reboot (E.visitedTowns came
 * back undefined: the exact reboot wipe the move fixes). (2026-07-16.)
 * S10 vacuity: SEEN FAILING (6 asserts here) against a pre-S10 git worktree (HEAD 2cc18b7 + its
 * own dist build) — the 2 layer-1 fold asserts with a top-level dragon (v2-depths/v3-full: the
 * old blob kept it), the REMAP pin (14 ≠ 16 entries), the characterOf S10 emission (the row
 * still carried top-level dragon, no player.dragon), the real-path v2 fold, and
 * steed-survives-reboot (characterOf('E') still emitted a top-level dragon). Same run:
 * sp-flags-check §2g 2 asserts + crash, verify_fixes FIX2 2 asserts (root ghosts existed;
 * characterOf shape), facing-mp-verify 1 (drawOthers temp-hero probe) — 11 total. (2026-07-16.)
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const REPO = process.env.EM_REPO || __RR;
const { migrateCharacter, SCHEMA_VERSION, QUEST_TEMPLATE } = require(path.join(REPO, 'server', 'migrate.js'));

let pass = 0, fail = 0;
const ok = (n, c, info) => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${info !== undefined ? '  [' + info + ']' : ''}`); };
const clone = (o) => structuredClone(o);

// first-difference deep compare (JSON-safe data): returns null when equal, else a path string
function diff(a, b, at = '$') {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${at} (${typeof a} vs ${typeof b})`;
  if (a === null || b === null || typeof a !== 'object') return `${at} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${at} (array-ness)`;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join(',') !== kb.join(',')) return `${at} keys (${ka} vs ${kb})`;
  for (const k of ka) { const d = diff(a[k], b[k], `${at}.${k}`); if (d) return d; }
  return null;
}
const deepEq = (a, b) => diff(a, b) === null;

// ---------------------------------------------------------------------------
// THE ORACLE — the old inline chains, frozen VERBATIM from server/world.js @ c40a019
// (pre-extraction, lines 616-672). Two world couplings replaced for a pure, comparable run:
//   · the live QUEST_TEMPLATE → the module's literal (drift-guarded in layer 3);
//   · aliasSharedQuests(q)    → IDENTITY. Aliasing swaps the room's LIVE objects in at
//     apply time and is not part of the blob; the pre-alias VALUES are what the blob must
//     carry. Old line 642 ran AFTER the alias (mutating the SHARED main) — under identity
//     it lands on q.main, which is exactly the blob-side meaning; the world-side re-apply
//     is asserted in layer 3.
// The old chain read p.level / p.inventory.keys AFTER the apply-assign; mkOldP reproduces
// that player: template defaults (level 1, keys 0 — asserted against the real boot in
// layer 3) overlaid by the row's own slices.
// ---------------------------------------------------------------------------
function mkOldP(c) {
  const p = { level: 1, inventory: { keys: 0 } };
  if (c && c.player) Object.assign(p, clone(c.player));
  if (c && c.inventory) p.inventory = clone(c.inventory);
  return p;
}
function oldInlineChains(c) {
  const p = mkOldP(c);
  // ---- questline (v2) ---- [verbatim]
  const q = clone(QUEST_TEMPLATE);
  const legacy = !(c && c.quests);                 // a v1 row: no questline was ever saved
  if (!legacy) Object.assign(q, clone(c.quests));
  let mDepth = (c && Number.isFinite(c.maxDepth)) ? Math.max(0, c.maxDepth | 0) : 0;
  let bnty = (c && c.bounty) ? clone(c.bounty) : null;
  if (legacy) {
    const lvl = p.level | 0, keys = (p.inventory && p.inventory.keys) | 0;
    const veteran = lvl > 1;
    q.talk.done = veteran;
    q.key.hidden = !veteran;
    q.key.done = keys > 0;
    if (veteran) { q.slay.done = true; q.slay.count = q.slay.target; }
    if (lvl >= 20) q.dragon.hidden = false;
    mDepth = 0; bnty = null;
  }
  /* aliasSharedQuests(q) — identity here (see header) */
  if (legacy && (p.level | 0) > 1) q.main.started = true;
  // ---- personal milestones (v3) ---- [verbatim; else-branch = the row's own values ride Object.assign]
  const ms = {};
  if (!c || !c.player || c.player.enteredDungeon === undefined) {
    const keys = (p.inventory && p.inventory.keys) | 0;
    ms.enteredDungeon = mDepth > 0 || keys >= 2;
    ms.gotKey = keys > 0 || !!(q.key && q.key.done);
    ms.enteredFrozen = false;
  } else {
    ms.enteredDungeon = c.player.enteredDungeon; ms.gotKey = c.player.gotKey; ms.enteredFrozen = c.player.enteredFrozen;
  }
  return { quests: q, maxDepth: mDepth, bounty: bnty, milestones: ms };
}

// ---------------------------------------------------------------------------
// LAYER 1 — pure fixtures (shapes: the real historical characterOf emissions)
// ---------------------------------------------------------------------------
const mkPlayer = (over) => ({
  hp: 96, maxHp: 100, xp: 40, xpNext: 120, level: 1, gold: 25, speed: 2.4, atkHaste: 0,
  energy: 50, maxEnergy: 50, skillPoints: 0, bonusAtk: 0, bonusDef: 0, bonusCrit: 0,
  bonusLifesteal: 0, bonusBerserk: 0, bonusEvasion: 0, bonusExec: 0, bonusFort: 0, bonusFont: 0,
  foodBuff: null, foodT: 0,
  abilities: { whirlwind: false, focus: false, ultimate: false, dominate: false, summon: false },
  abilityRank: {}, prof: { melee: { level: 2, xp: 10 }, ranged: { level: 1, xp: 0 }, magic: { level: 1, xp: 0 } },
  ...over,
});
const mkInv = (keys) => ({
  weapons: [{ name: 'Rusty Sword', atk: 3, style: 'melee', rarity: 0, reqLevel: 1, reqProf: 1, dur: 50, durMax: 50, equipped: true }],
  armor: [{ name: 'Cloth Tunic', def: 0, rarity: 0, reqLevel: 1, dur: 50, durMax: 50, equipped: true }],
  items: [{ name: 'Potion', qty: 2 }], keys,
});
const mkShop = () => ({ shopPurchased: ['potion'], tonics: 2, sharpenLevel: 1, cargo: { furs: 1, grain: 0, spice: 0, ore: 0 }, ingredients: { herb: 3, berry: 0, mushroom: 1, fish: 0 } });
const mkComp = () => [{ name: 'Seri', cls: 'ranger', level: 4, maxHp: 44, hp: 30, atk: 9, def: 2, alive: true, color: '#8fc7ff', postedAt: null, weapon: null }];

// FIXTURES — field sets mirror what each era's characterOf actually wrote:
const FIXTURES = {
  // v1 earliest (d0260af): {v:1, name, level, player, inventory} — veteran WITH dungeon keys
  'v1-early': { v: 1, name: 'Old Vet', level: 12, player: mkPlayer({ level: 12, gold: 300 }), inventory: mkInv(3) },
  // v1 late (056cf71): + skin/shop/companions — level 25, NO keys (the documented "v1 has no
  // durable depth source" hole: enteredDungeon must come out false)
  'v1-late': { v: 1, name: 'Keyless', level: 25, skin: 2, player: mkPlayer({ level: 25 }), inventory: mkInv(0), shop: mkShop(), companions: mkComp() },
  // v1 fresh hero: non-veteran → intro must NOT be skipped
  'v1-fresh': { v: 1, name: 'Newbie', level: 1, player: mkPlayer({}), inventory: mkInv(0) },
  // v2 (a077eba): + quests/maxDepth/bounty/dragon. Era-plausible edges: the row predates the
  // `dragon` quest key (template must fill it), maxDepth is fractional (|0), key.done set.
  'v2-depths': {
    v: 2, name: 'Delver', level: 30, skin: 1, player: mkPlayer({ level: 30 }), inventory: mkInv(0), shop: mkShop(),
    quests: {
      main: { name: 'Slay the Mountain Kraken', done: false, started: false, hidden: false },
      talk: { name: 'Speak to the Elder', done: true },
      key: { name: 'Find the Dungeon Key', done: true, hidden: false },
      slay: { name: 'Slay 5 monsters', done: true, count: 5, target: 5 },
      frozen: { name: 'Plunder the Frozen Cache', done: false, hidden: true },
      legion: { started: true, stage: 'camps', camps: 1, sealstones: 0, villages: 0, seatRegion: 3 },
    },
    maxDepth: 7.9, bounty: { kind: 'slay', depth: 3, target: 4, count: 1, gold: 120 }, dragon: { tamed: true }, companions: mkComp(),
  },
  // v2 hostile edges: string maxDepth (Number.isFinite("9") is FALSE → 0), falsy bounty
  'v2-edge': { v: 2, name: 'Edge', level: 5, player: mkPlayer({ level: 5 }), inventory: mkInv(1), quests: { talk: { name: 'Speak to the Elder', done: true } }, maxDepth: '9', bounty: 0 },
  // v2 negative maxDepth (Math.max(0, -3|0) → 0)
  'v2-neg': { v: 2, name: 'Neg', level: 5, player: mkPlayer({ level: 5 }), inventory: mkInv(0), quests: { talk: { name: 'Speak to the Elder', done: true } }, maxDepth: -3, bounty: null },
  // v3 (b190799): milestones IN the player slice — values a re-run of the synthesis would
  // NOT produce (keys 9 / depth 12 would say true/true/false) → proves pass-through
  'v3-full': {
    v: 3, name: 'Modern', level: 40, skin: 4,
    player: mkPlayer({ level: 40, enteredDungeon: false, gotKey: false, enteredFrozen: true }),
    inventory: mkInv(9), shop: mkShop(),
    quests: clone(QUEST_TEMPLATE), maxDepth: 12, bounty: null, dragon: { tamed: false }, companions: [],
  },
};

console.log('--- layer 1: pure fixtures vs the frozen old chains ---');
for (const [name, fx] of Object.entries(FIXTURES)) {
  const before = JSON.stringify(fx);
  const m = migrateCharacter(fx);
  const old = oldInlineChains(fx);
  ok(`${name}: quests match the old inline chain`, deepEq(m.blob.quests, old.quests), diff(m.blob.quests, old.quests) || 'equal');
  ok(`${name}: maxDepth/bounty match`, m.blob.maxDepth === old.maxDepth && deepEq(m.blob.bounty, old.bounty),
    `depth ${m.blob.maxDepth}=${old.maxDepth} bounty ${JSON.stringify(m.blob.bounty)}=${JSON.stringify(old.bounty)}`);
  ok(`${name}: milestones match`, m.blob.player.enteredDungeon === old.milestones.enteredDungeon
    && m.blob.player.gotKey === old.milestones.gotKey && m.blob.player.enteredFrozen === old.milestones.enteredFrozen,
    JSON.stringify({ got: { d: m.blob.player.enteredDungeon, k: m.blob.player.gotKey, f: m.blob.player.enteredFrozen }, old: old.milestones }));
  ok(`${name}: stamped schemaVersion ${SCHEMA_VERSION}, honest fromVersion`, m.blob.schemaVersion === 4 && m.toVersion === 4 && m.fromVersion === (fx.schemaVersion ?? fx.v ?? 1), `from=${m.fromVersion}`);
  { // S5 fold: shop.tonics/sharpenLevel → player.* (defaults 0/0 when the era had no shop); seenHeatTip defaults false; shop copies GONE (a move)
    const sh = fx.shop || null;
    ok(`${name}: S5 fold — empowerment keys land on player, shop copies removed`,
      m.blob.player.tonics === ((sh ? sh.tonics : 0) | 0) && m.blob.player.sharpenLevel === ((sh ? sh.sharpenLevel : 0) | 0)
      && m.blob.player.seenHeatTip === false
      && (!m.blob.shop || (m.blob.shop.tonics === undefined && m.blob.shop.sharpenLevel === undefined)),
      JSON.stringify({ t: m.blob.player.tonics, s: m.blob.player.sharpenLevel, tip: m.blob.player.seenHeatTip, shop: m.blob.shop && Object.keys(m.blob.shop) }));
  }
  // S6 defaults: pre-move rows carried hasBoat/wayfind NOWHERE (shared root, never saved) —
  // the importer must supply player.hasBoat:false (250 g re-buy, documented) + player.wayfind:true.
  ok(`${name}: S6 defaults — player.hasBoat false, player.wayfind true`,
    m.blob.player.hasBoat === false && m.blob.player.wayfind === true,
    JSON.stringify({ boat: m.blob.player.hasBoat, wf: m.blob.player.wayfind }));
  { // S7 fold: shop.shopPurchased/cargo → player.* (MOVE — shop copies gone; cargo normalized to the
    // full goods shape like the old apply-side Object.assign; fresh clones, never row refs).
    // lastRestDay must stay ABSENT: no default, so addPlayer's join-rested stamp survives the load.
    const sh = fx.shop || null;
    const expSP = sh && Array.isArray(sh.shopPurchased) ? sh.shopPurchased : [];
    const expCargo = Object.assign({ furs: 0, grain: 0, spice: 0, ore: 0 }, (sh && sh.cargo) || {});
    ok(`${name}: S7 fold — shopPurchased/cargo land on player (shop copies removed), lastRestDay NOT synthesized`,
      deepEq(m.blob.player.shopPurchased, expSP) && deepEq(m.blob.player.cargo, expCargo)
      && m.blob.player.lastRestDay === undefined
      && (!sh || !sh.shopPurchased || m.blob.player.shopPurchased !== sh.shopPurchased)
      && (!sh || !sh.cargo || m.blob.player.cargo !== sh.cargo)
      && (!m.blob.shop || (m.blob.shop.shopPurchased === undefined && m.blob.shop.cargo === undefined)),
      JSON.stringify({ sp: m.blob.player.shopPurchased, cargo: m.blob.player.cargo, rest: m.blob.player.lastRestDay, shop: m.blob.shop && Object.keys(m.blob.shop) }));
  }
  { // S8 fold: shop.ingredients → player.ingredients (MOVE — the LAST shop key: the emptied slice
    // must be deleted outright so migrate(old row) matches what characterOf writes post-S8;
    // pantry normalized to the full ingredient set like the old apply-side Object.assign, and a
    // fresh clone, never the row's ref).
    const sh = fx.shop || null;
    const expIng = Object.assign({ herb: 0, berry: 0, mushroom: 0, fish: 0 }, (sh && sh.ingredients) || {});
    ok(`${name}: S8 fold — ingredients land on player (normalized), the emptied shop slice is GONE`,
      deepEq(m.blob.player.ingredients, expIng)
      && (!sh || !sh.ingredients || m.blob.player.ingredients !== sh.ingredients)
      && m.blob.shop === undefined,
      JSON.stringify({ ing: m.blob.player.ingredients, shop: m.blob.shop && Object.keys(m.blob.shop) }));
  }
  // S9 default: player.visitedTowns [] — pre-move rows carried it NOWHERE (a shared root key
  // outside characterOf, wiped every reboot), so there is nothing to fold; it self-heals on the
  // next town visit. The shop SESSION is never persisted → never synthesized either.
  ok(`${name}: S9 default — visitedTowns [] on player, shop session NOT synthesized`,
    deepEq(m.blob.player.visitedTowns, []) && m.blob.player.activeShopTown === undefined
    && m.blob.player.activeStock === undefined && m.blob.player.activeShopName === undefined,
    JSON.stringify({ vt: m.blob.player.visitedTowns, town: m.blob.player.activeShopTown }));
  { // S10 fold: top-level dragon.tamed → player.dragon {tamed, mounted:false} (MOVE — the
    // top-level copy deleted, mounted normalized false: transient, a row never dictates flight;
    // fresh object, never the row's ref). A row with NO dragon anywhere (v1) synthesizes
    // NOTHING — the apply-side template default stands, like lastRestDay. sailing is never
    // persisted → never synthesized either.
    const hadDragon = !!fx.dragon;
    ok(`${name}: S10 fold — dragon ${hadDragon ? 'lands on player GROUNDED' : 'stays absent (v1: apply-side default stands)'}, top-level copy gone, sailing NOT synthesized`,
      m.blob.dragon === undefined && m.blob.player.sailing === undefined
      && (hadDragon
        ? (deepEq(m.blob.player.dragon, { tamed: !!fx.dragon.tamed, mounted: false }) && m.blob.player.dragon !== fx.dragon)
        : m.blob.player.dragon === undefined),
      JSON.stringify({ pd: m.blob.player.dragon, top: m.blob.dragon, sail: m.blob.player.sailing }));
  }
  // S11 defaults: pre-move rows carried factions/loreFound NOWHERE (shared root keys outside
  // characterOf, never persisted — every reboot wiped the room's standings and discoveries), so
  // there is nothing to fold: the importer must supply the zero ledger + the empty stone list.
  ok(`${name}: S11 defaults — player.factions zero ledger, player.loreFound []`,
    deepEq(m.blob.player.factions, { vigil: 0, wilds: 0, dread: 0 }) && deepEq(m.blob.player.loreFound, []),
    JSON.stringify({ fac: m.blob.player.factions, lore: m.blob.player.loreFound }));
  ok(`${name}: PURE — input blob untouched`, JSON.stringify(fx) === before);
  ok(`${name}: output shares NO refs with input`, m.blob !== fx && m.blob.player !== fx.player && m.blob.inventory !== fx.inventory
    && (!fx.quests || m.blob.quests !== fx.quests) && (typeof fx.bounty !== 'object' || !fx.bounty || m.blob.bounty !== fx.bounty)
    && m.blob.player.abilities !== fx.player.abilities);
  const m2 = migrateCharacter(m.blob);
  ok(`${name}: IDEMPOTENT (v4 in → deep-equal v4 out, fromVersion 4)`, deepEq(m2.blob, m.blob) && m2.fromVersion === 4, diff(m2.blob, m.blob) || 'stable');
  const m3 = migrateCharacter(fx);
  ok(`${name}: deterministic (same input twice → same output)`, deepEq(m3.blob, m.blob));
}

// hand-derived literals — belt and braces against a transcription slip in the oracle copy.
// Derivations cite the OLD chain (world.js @ c40a019):
//   v1-early: lvl 12>1 → veteran (talk.done, key.hidden=false, slay 5/5 done, main.started);
//             keys 3 → key.done; lvl<20 → dragon stays hidden; mDepth/bnty forced 0/null;
//             milestones: keys 3≥2 → enteredDungeon, keys>0 → gotKey, frozen always false.
{
  const b = migrateCharacter(FIXTURES['v1-early']).blob, q = b.quests;
  ok('v1-early literals', q.talk.done === true && q.key.hidden === false && q.key.done === true
    && q.slay.done === true && q.slay.count === 5 && q.dragon.hidden === true && q.main.started === true
    && b.maxDepth === 0 && b.bounty === null
    && b.player.enteredDungeon === true && b.player.gotKey === true && b.player.enteredFrozen === false, JSON.stringify(q.slay));
}
//   v1-late: lvl 25 → veteran + dragon revealed (≥20); keys 0 → key.done false, and the v1
//            depth hole: enteredDungeon FALSE (no keys, migration zeroed depth), gotKey false.
{
  const b = migrateCharacter(FIXTURES['v1-late']).blob, q = b.quests;
  ok('v1-late literals', q.talk.done === true && q.key.hidden === false && q.key.done === false
    && q.dragon.hidden === false && q.main.started === true
    && b.player.enteredDungeon === false && b.player.gotKey === false && b.player.enteredFrozen === false,
    JSON.stringify({ dragon: q.dragon.hidden, d: b.player.enteredDungeon }));
}
//   v1-fresh: lvl 1 → NOT veteran: whole intro intact (talk undone, key still hidden,
//             slay 0/5, main NOT started), all milestones false.
{
  const b = migrateCharacter(FIXTURES['v1-fresh']).blob, q = b.quests;
  ok('v1-fresh literals', q.talk.done === false && q.key.hidden === true && q.key.done === false
    && q.slay.done === false && q.slay.count === 0 && q.main.started === false
    && b.player.enteredDungeon === false && b.player.gotKey === false && b.player.enteredFrozen === false, JSON.stringify(q.talk));
}
//   v2-depths: NOT legacy → row quests kept (slay 5/5, legion stage 'camps'), missing
//              `dragon` key template-filled; main NOT flipped despite level 30 (the legacy
//              flip must never fire for v2+); maxDepth 7.9|0=7; bounty kept; milestones
//              synthesized: depth 7>0 → enteredDungeon, key.done → gotKey.
{
  const b = migrateCharacter(FIXTURES['v2-depths']).blob, q = b.quests;
  ok('v2-depths literals', q.slay.count === 5 && q.legion.stage === 'camps' && q.legion.seatRegion === 3
    && deepEq(q.dragon, QUEST_TEMPLATE.dragon) && q.main.started === false
    && b.maxDepth === 7 && b.bounty.gold === 120
    && b.player.enteredDungeon === true && b.player.gotKey === true && b.player.enteredFrozen === false,
    JSON.stringify({ dragon: q.dragon, depth: b.maxDepth }));
}
//   v2-edge/v2-neg: Number.isFinite('9') is false → 0; Math.max(0,-3)=0; bounty 0 → null.
{
  const e = migrateCharacter(FIXTURES['v2-edge']).blob, n = migrateCharacter(FIXTURES['v2-neg']).blob;
  ok('v2 hostile maxDepth/bounty edges', e.maxDepth === 0 && e.bounty === null && n.maxDepth === 0 && n.bounty === null,
    `edge=${e.maxDepth} neg=${n.maxDepth}`);
  ok('v2-edge: missing quest keys template-filled', deepEq(e.quests.slay, QUEST_TEMPLATE.slay) && e.quests.talk.done === true);
}
//   v3-full: milestones pass through UNTOUCHED (false/false/true) even though keys 9 /
//            depth 12 would synthesize true/true/false — migration must not re-run.
{
  const b = migrateCharacter(FIXTURES['v3-full']).blob;
  ok('v3-full literals: milestones pass through, NOT re-synthesized',
    b.player.enteredDungeon === false && b.player.gotKey === false && b.player.enteredFrozen === true
    && b.maxDepth === 12 && b.schemaVersion === 4 && b.v === 3,
    JSON.stringify({ d: b.player.enteredDungeon, k: b.player.gotKey, f: b.player.enteredFrozen }));
}

(async () => {
  // -------------------------------------------------------------------------
  // LAYER 2 — REMAP overlay unit proof (tests/golden/serialize.mjs scaffolding)
  // -------------------------------------------------------------------------
  console.log('\n--- layer 2: golden REMAP scaffolding ---');
  const { hashState, stableSerialize, REMAP } = await import(pathToFileURL(path.join(REPO, 'tests', 'golden', 'serialize.mjs')).href);
  // The table is no longer empty: each P2 per-key slice adds its relocations. Pin the EXACT
  // expected entries so an accidental add/remove/reorder fails loudly here.
  const LADDER_REMAP = [
    ['state.player.tonics', 'state.tonics'],                 // S5
    ['state.player.sharpenLevel', 'state.sharpenLevel'],     // S5
    ['state.player.seenHeatTip', 'state.seenHeatTip'],       // S5
    ['state.player.hasBoat', 'state.hasBoat'],               // S6
    ['state.player.wayfind', 'state.wayfind'],               // S6
    ['state.player.fishCd', 'state.fishCd'],                 // S7
    ['state.player.lastRestDay', 'state.lastRestDay'],       // S7
    ['state.player.cargo', 'state.cargo'],                   // S7
    ['state.player.shopPurchased', 'state.shopPurchased'],   // S7
    ['state.player.ingredients', 'state.ingredients'],       // S8
    ['state.player.visitedTowns', 'state.visitedTowns'],       // S9
    ['state.player.activeShopTown', 'state.activeShopTown'],   // S9
    ['state.player.activeStock', 'state.activeStock'],         // S9 (exists only while a shop session is open)
    ['state.player.activeShopName', 'state.activeShopName'],   // S9 (likewise)
    ['state.player.sailing', 'state.sailing'],                 // S10
    ['state.player.dragon', 'state.dragon'],                   // S10
    ['state.player.factions', 'state.factions'],               // S11
    ['state.player.loreFound', 'state.loreFound'],             // S11
  ];
  ok('REMAP table = exactly the shipped ladder relocations (S5+S6+S7+S8+S9+S10+S11)', Array.isArray(REMAP) && REMAP.length === LADDER_REMAP.length
    && LADDER_REMAP.every(([f, t], i) => REMAP[i] && REMAP[i].from === f && REMAP[i].to === t), JSON.stringify(REMAP));
  const entry = [{ from: 'state.player.quests', to: 'state.quests' }];
  const movedShape = { state: { player: { level: 5, quests: { slay: { count: 3 } } }, enemies: [] }, maps: { ow: [1, 2] } };
  const oldShape = { state: { player: { level: 5 }, quests: { slay: { count: 3 } }, enemies: [] }, maps: { ow: [1, 2] } };
  ok('empty/none remap take the untouched path; table entries NO-OP where the moved keys are absent', hashState(movedShape, []) === hashState(movedShape, null)
    && hashState(movedShape) === hashState(movedShape, [])   // default = REMAP: every S5 from-path is absent on this toy shape → inert
    && stableSerialize(movedShape) === stableSerialize(movedShape, REMAP));
  ok('a remap entry ROUND-TRIPS (moved shape hashes as the old shape)', hashState(movedShape, entry) === hashState(oldShape), hashState(movedShape, entry).slice(0, 12));
  ok('…and the entry is what does it (native hashes differ)', hashState(movedShape) !== hashState(oldShape));
  {
    const pNew = { level: 5, quests: { slay: { count: 3 } } };
    const rootNew = { state: { enemies: [{ _markBy: pNew }], player: pNew }, maps: {} };
    const pOld = { level: 5 };
    const rootOld = { state: { enemies: [{ _markBy: pOld }], player: pOld, quests: { slay: { count: 3 } } }, maps: {} };
    ok('$ref dedup preserved under the view (enemy._markBy → player)', hashState(rootNew, entry) === hashState(rootOld));
    const before = JSON.stringify(rootNew);
    hashState(rootNew, entry);
    ok('the view never mutates the root', JSON.stringify(rootNew) === before);
  }
  ok('absent from-path no-ops (hash = native shape)', hashState(oldShape, entry) === hashState(oldShape));

  // -------------------------------------------------------------------------
  // LAYER 3 — the real world: drift guard, characterOf stamp, apply, round-trip
  // -------------------------------------------------------------------------
  console.log('\n--- layer 3: real world apply + round-trip ---');
  const G = require(path.join(REPO, 'server-spike', 'load-game.js'));
  const { World } = require(path.join(REPO, 'server', 'world.js'));
  const S = G.state;
  // DRIFT GUARD — must run before any fixture load (a legacy-veteran load mutates the
  // SHARED main below, by design). If a release changes the quest box, update the literal
  // in server/migrate.js in the same change.
  ok('DRIFT GUARD: migrate.js QUEST_TEMPLATE === booted state.quests', deepEq(QUEST_TEMPLATE, structuredClone(S.quests)),
    diff(QUEST_TEMPLATE, structuredClone(S.quests)) || 'in sync');

  const w = new World();
  const F = w.addPlayer('F', 'Fresh');
  ok('booted defaults the old chain leaned on (level 1, 0 keys)', F.level === 1 && (F.inventory.keys | 0) === 0, `lvl=${F.level} keys=${F.inventory.keys}`);
  const chF = w.characterOf('F');
  ok('characterOf stamps schemaVersion 4 (v:3 kept for rollback)', chF.schemaVersion === 4 && chF.v === 3, `sv=${chF.schemaVersion} v=${chF.v}`);
  ok('the stamped save JSON round-trips losslessly (jsonb-safe)', deepEq(JSON.parse(JSON.stringify(chF)), chF));

  // era-downgrade a REAL modern save into honest v1/v2/v3 rows
  F.level = 45; F.gold = 777; F.inventory.keys = 16;
  F.tonics = 2; F.sharpenLevel = 1; F.seenHeatTip = true;   // S5: exercise the fold through the REAL emission + load path
  F.hasBoat = true; F.wayfind = false;                      // S6: boat + guide pref must ride the emission too
  F.shopPurchased = ['s7_blade']; F.cargo = { furs: 2, grain: 0, spice: 1, ore: 0 }; F.lastRestDay = 5;   // S7: town economy + rest day must ride it too
  F.ingredients = { herb: 4, berry: 1, mushroom: 0, fish: 2 };   // S8: the forage pantry must ride the emission too
  F.visitedTowns = [0, 3];                                       // S9: the travel list must ride the emission too
  F.activeShopTown = 2; F.activeShopName = 'Test'; F.activeStock = { weapons: [], armor: [] };   // S9: an OPEN shop session must NOT be persisted
  F.dragon = { tamed: true, mounted: true }; F.sailing = true;   // S10: the steed must ride the emission (mounted as-saved; every load re-grounds); an active sail must NOT be persisted
  F.factions = { vigil: 33, wilds: -8, dread: 21 }; F.loreFound = [1, 4];   // S11: earned standings + read stones must ride the emission too
  const modern = JSON.parse(JSON.stringify(w.characterOf('F')));
  ok('characterOf (v4): tonics/sharpenLevel/seenHeatTip ride the PLAYER slice, shop no longer carries them (S5 fold; the slice itself is gone since S8)',
    modern.player.tonics === 2 && modern.player.sharpenLevel === 1 && modern.player.seenHeatTip === true
    && (modern.shop === undefined || (modern.shop.tonics === undefined && modern.shop.sharpenLevel === undefined)),
    JSON.stringify({ p: { t: modern.player.tonics, s: modern.player.sharpenLevel, tip: modern.player.seenHeatTip }, shop: modern.shop && Object.keys(modern.shop) }));
  ok('characterOf (v4): hasBoat/wayfind ride the PLAYER slice, nothing at the root (S6)',
    modern.player.hasBoat === true && modern.player.wayfind === false
    && modern.hasBoat === undefined && modern.wayfind === undefined,
    JSON.stringify({ boat: modern.player.hasBoat, wf: modern.player.wayfind }));
  ok('characterOf (v4): shopPurchased/cargo/lastRestDay ride the PLAYER slice (S7); ingredients too, and the shop slice is GONE (S8)',
    deepEq(modern.player.shopPurchased, ['s7_blade']) && modern.player.cargo.furs === 2 && modern.player.cargo.spice === 1
    && modern.player.lastRestDay === 5 && modern.player.fishCd === undefined
    && deepEq(modern.player.ingredients, { herb: 4, berry: 1, mushroom: 0, fish: 2 }) && modern.shop === undefined,
    JSON.stringify({ sp: modern.player.shopPurchased, cargo: modern.player.cargo, rest: modern.player.lastRestDay, ing: modern.player.ingredients, shop: modern.shop }));
  ok('characterOf (v4): visitedTowns rides the PLAYER slice, nothing at the root; the OPEN shop session is saved NOWHERE (S9)',
    deepEq(modern.player.visitedTowns, [0, 3]) && modern.visitedTowns === undefined
    && modern.player.activeShopTown === undefined && modern.player.activeStock === undefined && modern.player.activeShopName === undefined
    && modern.activeShopTown === undefined,
    JSON.stringify({ vt: modern.player.visitedTowns, town: modern.player.activeShopTown }));
  ok('characterOf (v4): the steed rides the PLAYER slice, NO top-level dragon; sailing saved NOWHERE (S10)',
    modern.player.dragon && modern.player.dragon.tamed === true && modern.dragon === undefined
    && modern.player.sailing === undefined && modern.sailing === undefined,
    JSON.stringify({ pd: modern.player.dragon, top: modern.dragon, sail: modern.player.sailing }));
  ok('characterOf (v4): factions/loreFound ride the PLAYER slice, nothing at the root (S11 — pre-S11 neither was saved ANYWHERE: reboots wiped every standing and discovery)',
    deepEq(modern.player.factions, { vigil: 33, wilds: -8, dread: 21 }) && deepEq(modern.player.loreFound, [1, 4])
    && modern.factions === undefined && modern.loreFound === undefined,
    JSON.stringify({ fac: modern.player.factions, lore: modern.player.loreFound }));
  // pre-S5 eras carried tonics/sharpenLevel in the SHOP slice and had no seenHeatTip anywhere;
  // pre-S6 eras carried hasBoat/wayfind NOWHERE (shared root keys, outside characterOf entirely);
  // pre-S7 eras carried shopPurchased/cargo in the SHOP slice and lastRestDay NOWHERE (a root key
  // that characterOf never saved — every reconnect joined rested);
  // pre-S8 eras carried ingredients in the SHOP slice (its last surviving key);
  // pre-S9 eras carried visitedTowns NOWHERE (a shared root key outside characterOf entirely);
  // pre-S10 eras carried the steed as TOP-LEVEL dragon:{tamed} (v2+; a v1 row had none) and
  // sailing NOWHERE (a shared root key, never saved);
  // pre-S11 eras carried factions/loreFound NOWHERE (shared root keys, outside characterOf):
  const shopify = (r) => { r.shop = Object.assign({}, r.shop, { tonics: r.player.tonics | 0, sharpenLevel: r.player.sharpenLevel | 0, shopPurchased: (r.player.shopPurchased || []).slice(), cargo: Object.assign({}, r.player.cargo || {}), ingredients: Object.assign({}, r.player.ingredients || {}) }); delete r.player.tonics; delete r.player.sharpenLevel; delete r.player.seenHeatTip; delete r.player.hasBoat; delete r.player.wayfind; delete r.player.shopPurchased; delete r.player.cargo; delete r.player.lastRestDay; delete r.player.ingredients; delete r.player.visitedTowns; r.dragon = { tamed: !!(r.player.dragon && r.player.dragon.tamed) }; delete r.player.dragon; delete r.player.sailing; delete r.player.factions; delete r.player.loreFound; };
  const asV1 = (m) => { const r = clone(m); delete r.schemaVersion; delete r.quests; delete r.maxDepth; delete r.bounty; r.v = 1; delete r.player.enteredDungeon; delete r.player.gotKey; delete r.player.enteredFrozen; shopify(r); delete r.dragon; return r; };
  const asV2 = (m) => { const r = clone(m); delete r.schemaVersion; r.v = 2; delete r.player.enteredDungeon; delete r.player.gotKey; delete r.player.enteredFrozen; r.maxDepth = 7; shopify(r); return r; };
  const asV3 = (m) => { const r = clone(m); delete r.schemaVersion; r.v = 3; shopify(r); return r; };

  // v1 veteran (level 45, 16 keys): intro synthesized done, milestones from keys, and the
  // ROOM's shared main quest flips to started (the old post-alias line-642 side effect)
  ok('pre-condition: the shared main quest is NOT yet started', S.quests.main.started === false);
  const A = w.addPlayer('A', 'VetA', asV1(modern));
  ok('v1 load: intro synthesized as done', A.quests.talk.done === true && A.quests.key.done === true && A.quests.slay.done === true && A.quests.key.hidden === false);
  ok('v1 load: dragon quest revealed at level 45', A.quests.dragon.hidden === false);
  ok('v1 load: depth/bounty start clean', A.maxDepth === 0 && A.bounty === null);
  ok('v1 load: milestones synthesized from 16 keys', A.enteredDungeon === true && A.gotKey === true && A.enteredFrozen === false);
  ok('v1 load: stats/inventory landed', A.level === 45 && A.gold === 777 && (A.inventory.keys | 0) === 16);
  ok('v1 load: shop.tonics/sharpenLevel FOLD onto the hero; the heat teach re-arms (S5 mapping through the real path)',
    A.tonics === 2 && A.sharpenLevel === 1 && A.seenHeatTip === false,
    JSON.stringify({ t: A.tonics, s: A.sharpenLevel, tip: A.seenHeatTip }));
  ok('v1 load: S6 defaults land through the real path (no boat to restore, guide ON)',
    A.hasBoat === false && A.wayfind === true, JSON.stringify({ boat: A.hasBoat, wf: A.wayfind }));
  ok('v1 load: shop.shopPurchased/cargo FOLD onto the hero; join-rested stands (no lastRestDay in an old row — S7 mapping through the real path)',
    deepEq(A.shopPurchased, ['s7_blade']) && A.cargo.furs === 2 && A.cargo.spice === 1
    && A.lastRestDay === (G.curDay ? G.curDay() : 1) && (A.fishCd | 0) === 0,
    JSON.stringify({ sp: A.shopPurchased, cargo: A.cargo, rest: A.lastRestDay, curDay: G.curDay ? G.curDay() : 1 }));
  ok('v1 load: shop.ingredients FOLDS onto the hero (S8 mapping through the real path)',
    !!A.ingredients && A.ingredients.herb === 4 && A.ingredients.berry === 1 && A.ingredients.mushroom === 0 && A.ingredients.fish === 2,
    JSON.stringify({ ing: A.ingredients }));
  ok('v1 load: S9 default lands through the real path — an old row\'s travel list starts [] (re-earned per visit), the join session stays closed',
    deepEq(A.visitedTowns, []) && A.activeShopTown === -1 && A.activeStock === undefined,
    JSON.stringify({ vt: A.visitedTowns, town: A.activeShopTown }));
  ok('v1 load: S10 through the real path — no steed to restore (untamed, grounded), on foot',
    A.dragon && A.dragon.tamed === false && A.dragon.mounted === false && A.sailing === false,
    JSON.stringify({ dragon: A.dragon, sail: A.sailing }));
  ok('v1 load: S11 defaults through the real path — zero ledger, no stones read (old rows carried neither anywhere; the reset is the documented floor)',
    deepEq(A.factions, { vigil: 0, wilds: 0, dread: 0 }) && deepEq(A.loreFound, []),
    JSON.stringify({ fac: A.factions, lore: A.loreFound }));
  ok('v1 veteran flipped the SHARED main (line-642 semantics)', S.quests.main.started === true && A.quests.main.started === true);
  const B = w.addPlayer('B', 'FreshB');
  ok('shared-quest ALIASING intact: one main/frozen/legion object per room',
    A.quests.main === B.quests.main && A.quests.frozen === B.quests.frozen && A.quests.legion === B.quests.legion && A.quests !== B.quests);

  // v2: personal quest values survive, milestones synthesized from maxDepth
  const v2row = asV2(modern); v2row.quests = JSON.parse(JSON.stringify(A.quests)); v2row.quests.slay.count = 5; delete v2row.quests.dragon;
  const C = w.addPlayer('C', 'DelverC', v2row);
  ok('v2 load: row quest values kept + missing key template-filled', C.quests.slay.count === 5 && deepEq(structuredClone(C.quests.dragon), QUEST_TEMPLATE.dragon), JSON.stringify(structuredClone(C.quests.dragon)));
  ok('v2 load: milestones synthesized from maxDepth 7', C.enteredDungeon === true && C.maxDepth === 7);
  ok('v2 load: the old TOP-LEVEL dragon:{tamed} FOLDS onto the hero GROUNDED (S10 mapping through the real path)',
    C.dragon && C.dragon.tamed === true && C.dragon.mounted === false && C.sailing === false,
    JSON.stringify({ dragon: C.dragon, sail: C.sailing }));

  // v3: milestones pass through UNTOUCHED (values synthesis would never produce)
  const v3row = asV3(modern); v3row.player.enteredDungeon = false; v3row.player.gotKey = false; v3row.player.enteredFrozen = true;
  const D = w.addPlayer('D', 'ModernD', v3row);
  ok('v3 load: milestones NOT re-synthesized (16 keys would say true/true/false)',
    D.enteredDungeon === false && D.gotKey === false && D.enteredFrozen === true,
    JSON.stringify({ d: D.enteredDungeon, k: D.gotKey, f: D.enteredFrozen }));

  // round-trip: today's save → migrate is a no-op; and it LOADS back equal
  A.hasBoat = true; A.wayfind = false;   // S6: a boat owner's row must round-trip (THE evaporation fix — pre-S6, reboots repossessed every boat)
  A.shopPurchased = ['s7_rt']; A.cargo.ore = 4; A.lastRestDay = 9;   // S7: purchases/hold/rest-day must round-trip too (pre-S7, lastRestDay reset to join-rested on every reconnect)
  A.ingredients.fish = 7;   // S8: the pantry must round-trip via the player slice now that the shop slice is gone
  A.visitedTowns = [0, 2, 5];   // S9: the travel list must round-trip (pre-S9 it was shared+unpersisted — every reboot wiped the room's discoveries)
  A.dragon.tamed = true; A.dragon.mounted = true; A.sailing = true;   // S10: a tamed steed must round-trip (GROUNDED — mounted/sailing are sessions)
  A.factions = { vigil: 44, wilds: -12, dread: 9 }; A.loreFound = [2, 5];   // S11: standings + read stones must round-trip (pre-S11 both were shared+unpersisted — every reboot reset the room)
  const rowA = JSON.parse(JSON.stringify(w.characterOf('A')));
  const mA = migrateCharacter(rowA);
  ok('round-trip: migrating a fresh v4 save is a NO-OP (fromVersion 4)', mA.fromVersion === 4 && deepEq(mA.blob, rowA), diff(mA.blob, rowA) || 'no-op');
  const E = w.addPlayer('E', 'TwinE', mA.blob);
  ok('round-trip: the migrated save loads back equal (stats/quests/inventory/empowerment)',
    E.level === A.level && E.gold === A.gold && (E.inventory.keys | 0) === (A.inventory.keys | 0)
    && E.quests.slay.count === A.quests.slay.count && E.enteredDungeon === A.enteredDungeon && E.maxDepth === A.maxDepth
    && E.tonics === A.tonics && E.sharpenLevel === A.sharpenLevel && E.seenHeatTip === A.seenHeatTip);
  ok('round-trip: the boat SURVIVES the reboot (S6 — hasBoat/wayfind restore off the player slice)',
    E.hasBoat === true && E.wayfind === false, JSON.stringify({ boat: E.hasBoat, wf: E.wayfind }));
  ok('round-trip: purchases/hold/rest-day SURVIVE the reboot (S7 — a v4 row\'s own lastRestDay overrides join-rested; no more free rest per reconnect)',
    deepEq(E.shopPurchased, ['s7_rt']) && E.cargo.ore === 4 && E.lastRestDay === 9,
    JSON.stringify({ sp: E.shopPurchased, ore: E.cargo.ore, rest: E.lastRestDay }));
  ok('round-trip: the pantry SURVIVES the reboot off the PLAYER slice (S8 — no shop slice left to carry it)',
    E.ingredients.fish === 7 && E.ingredients.herb === 4 && JSON.parse(JSON.stringify(w.characterOf('E'))).shop === undefined,
    JSON.stringify({ ing: E.ingredients }));
  ok('round-trip: the travel list SURVIVES the reboot (S9 — pre-S9 a scale-to-zero wiped every fast-travel destination)',
    deepEq(E.visitedTowns, [0, 2, 5]), JSON.stringify({ vt: E.visitedTowns }));
  ok('round-trip: the tamed steed SURVIVES the reboot GROUNDED, on foot (S10 — via the player slice, no top-level dragon left)',
    E.dragon && E.dragon.tamed === true && E.dragon.mounted === false && E.sailing === false
    && JSON.parse(JSON.stringify(w.characterOf('E'))).dragon === undefined,
    JSON.stringify({ dragon: E.dragon, sail: E.sailing }));
  ok('round-trip: standings + read stones SURVIVE the reboot (S11 — via the player slice; pre-S11 a scale-to-zero reset every reputation and discovery)',
    deepEq(E.factions, { vigil: 44, wilds: -12, dread: 9 }) && deepEq(E.loreFound, [2, 5]) && E.factions !== A.factions && E.loreFound !== A.loreFound,
    JSON.stringify({ fac: E.factions, lore: E.loreFound }));

  // -------------------------------------------------------------------------
  // OPTIONAL — MIGRATE_DUMP=<path>: every real blob through the importer
  // -------------------------------------------------------------------------
  if (process.env.MIGRATE_DUMP) {
    console.log('\n--- optional: real dump sweep ---');
    const raw = JSON.parse(fs.readFileSync(process.env.MIGRATE_DUMP, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.rows || [];
    let n = 0, bad = 0; const hist = {};
    for (const r of rows) {
      const c = r && typeof r === 'object' && 'character' in r ? r.character : r;
      if (!c) continue;
      n++;
      try {
        const m = migrateCharacter(c);
        hist[m.fromVersion] = (hist[m.fromVersion] || 0) + 1;
        const again = migrateCharacter(m.blob);
        if (!(m.toVersion === 4 && m.fromVersion <= 4 && again.fromVersion === 4 && deepEq(again.blob, m.blob))) bad++;
      } catch (e) { bad++; console.log('  THROW on row:', e && e.message); }
    }
    ok(`dump sweep: ${n} blob(s) migrate cleanly (no-throw, monotone → 4, idempotent)`, n > 0 && bad === 0, `fromVersion histogram ${JSON.stringify(hist)}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR:', e && e.stack || e); process.exit(1); });
