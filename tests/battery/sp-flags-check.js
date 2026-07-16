'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/*
 * sp-flags-check.js — the SINGLE-PLAYER half of the personal-milestones split.
 *
 * SP has one hero, so "personal vs world" is a distinction without a difference there — but the
 * SAVE SHAPE changed (v5 kept the milestones in state.flags; v6 keeps them on state.player), and
 * an SP save must still load. A v5 save literally holds each value, so that migration is LOSSLESS
 * — which is what stops an existing SP hero's dungeon door re-locking (tryEnterDungeon's gate is
 * `keys>0 || enteredDungeon`) and the wayfinder re-pointing.
 *
 * Also asserts the ONE behaviour change to SP is a no-op: currentObjective's new `maxDepth>0`
 * clause can never fire in SP, because enterDungeon() is reachable ONLY through tryEnterDungeon(),
 * which sets the milestone first — so maxDepth>0 implies enteredDungeon in every SP save.
 */
const fs = require('fs');
const path = require('path');
const REPO = process.env.EM_REPO || __RR;
const G = require(path.join(REPO, 'server-spike', 'load-game.js'));
const S = G.state;

let pass = 0, fail = 0;
const ok = (n, c, info) => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${info !== undefined ? '  [' + info + ']' : ''}`); };

// ---------------------------------------------------------------- 1. v6 round-trip
S.player.enteredDungeon = true; S.player.gotKey = true; S.player.enteredFrozen = true;
S.flags.krakenDead = true; S.flags.legionBroken = true;
const v6 = JSON.parse(JSON.stringify(G.snapshot()));
ok('v6 snapshot: version bumped', v6.v === 6, 'v=' + v6.v);
ok('v6 snapshot: milestones ride the PLAYER slice', v6.player.enteredDungeon === true && v6.player.gotKey === true && v6.player.enteredFrozen === true,
  JSON.stringify({ d: v6.player.enteredDungeon, k: v6.player.gotKey, f: v6.player.enteredFrozen }));
ok('v6 snapshot: flags carry the WORLD facts only', v6.flags.krakenDead === true && v6.flags.legionBroken === true
  && v6.flags.enteredDungeon === undefined && v6.flags.gotKey === undefined && v6.flags.enteredFrozen === undefined, JSON.stringify(v6.flags));

// wipe, then load it back
S.player.enteredDungeon = false; S.player.gotKey = false; S.player.enteredFrozen = false; S.flags = { krakenDead: false, legionBroken: false };
G.applySnapshot(JSON.parse(JSON.stringify(v6)));
ok('v6 round-trip: milestones survive save→load', S.player.enteredDungeon === true && S.player.gotKey === true && S.player.enteredFrozen === true,
  JSON.stringify({ d: S.player.enteredDungeon, k: S.player.gotKey, f: S.player.enteredFrozen }));
ok('v6 round-trip: world facts survive save→load', S.flags.krakenDead === true && S.flags.legionBroken === true, JSON.stringify(S.flags));

// ---------------------------------------------------------------- 2. THE v5 → v6 MIGRATION
// Forge exactly what the PREVIOUS release wrote: milestones inside flags, none on the player.
const v5 = JSON.parse(JSON.stringify(v6));
v5.v = 5;
delete v5.player.enteredDungeon; delete v5.player.gotKey; delete v5.player.enteredFrozen;
v5.flags = { enteredDungeon: true, gotKey: true, enteredFrozen: true, krakenDead: true };   // note: v5 never declared legionBroken
S.player.enteredDungeon = false; S.player.gotKey = false; S.player.enteredFrozen = false; S.flags = { krakenDead: false, legionBroken: false };
G.applySnapshot(v5);
ok('v5→v6: enteredDungeon migrates LOSSLESSLY off the old flags (dungeon door stays unlocked)', S.player.enteredDungeon === true, 'enteredDungeon=' + S.player.enteredDungeon);
ok('v5→v6: gotKey migrates', S.player.gotKey === true, 'gotKey=' + S.player.gotKey);
ok('v5→v6: enteredFrozen migrates (no re-reveal of the Frozen Cache line)', S.player.enteredFrozen === true, 'enteredFrozen=' + S.player.enteredFrozen);
ok('v5→v6: krakenDead survives', S.flags.krakenDead === true, 'krakenDead=' + S.flags.krakenDead);
ok('v5→v6: an undeclared legionBroken normalises to false (not undefined)', S.flags.legionBroken === false, 'legionBroken=' + JSON.stringify(S.flags.legionBroken));
ok('v5→v6: the stale personal keys do NOT linger on state.flags', S.flags.enteredDungeon === undefined && S.flags.gotKey === undefined, JSON.stringify(S.flags));

// a v5 save from a hero who had NOT delved must stay not-delved (migration must not over-claim)
const v5fresh = JSON.parse(JSON.stringify(v5));
v5fresh.flags = { enteredDungeon: false, gotKey: false, enteredFrozen: false, krakenDead: false };
G.applySnapshot(v5fresh);
ok('v5→v6: a hero who had NOT entered stays not-entered', S.player.enteredDungeon === false && S.player.enteredFrozen === false,
  JSON.stringify({ d: S.player.enteredDungeon, f: S.player.enteredFrozen }));

// a corrupt/absent flags object must not throw
const vNoFlags = JSON.parse(JSON.stringify(v6)); delete vNoFlags.flags;
let threw = false;
try { G.applySnapshot(vNoFlags); } catch (e) { threw = true; }
ok('a save with NO flags object at all still loads', !threw && S.flags && S.flags.krakenDead === false, threw ? 'THREW' : JSON.stringify(S.flags));

// ---------------------------------------------------------------- 2b. THE pre-S5 → S5 RELOCATION
// P2/S5 moved tonics/sharpenLevel/seenHeatTip from state.X into the player slice. A pre-move save
// holds them at the ROOT; the load must read them back off it LOSSLESSLY (same doctrine as v5→v6:
// field-keyed fallback, no version gate) — or every migrated hero's tonic price resets to 50.
const preS5 = JSON.parse(JSON.stringify(v6));
delete preS5.player.tonics; delete preS5.player.sharpenLevel; delete preS5.player.seenHeatTip;
preS5.tonics = 3; preS5.sharpenLevel = 2; preS5.seenHeatTip = true;                 // the old root spots
S.player.tonics = 0; S.player.sharpenLevel = 0; S.player.seenHeatTip = false;
G.applySnapshot(preS5);
ok('pre-S5 save: root tonics/sharpenLevel/seenHeatTip land LOSSLESSLY on the player',
  S.player.tonics === 3 && S.player.sharpenLevel === 2 && S.player.seenHeatTip === true,
  JSON.stringify({ t: S.player.tonics, s: S.player.sharpenLevel, tip: S.player.seenHeatTip }));
// …and the S5 shape round-trips: the keys ride the player slice, never the root
S.player.tonics = 4; S.player.seenHeatTip = true;
const s5 = JSON.parse(JSON.stringify(G.snapshot()));
ok('S5 snapshot: tonics/sharpenLevel/seenHeatTip ride the PLAYER slice, root is clean',
  s5.player.tonics === 4 && s5.player.seenHeatTip === true && s5.tonics === undefined && s5.sharpenLevel === undefined && s5.seenHeatTip === undefined,
  JSON.stringify({ p: { t: s5.player.tonics, tip: s5.player.seenHeatTip }, root: { t: s5.tonics, tip: s5.seenHeatTip } }));
S.player.tonics = 1;
G.applySnapshot(s5);
ok('S5 round-trip: player-slice values survive save→load', S.player.tonics === 4 && S.player.seenHeatTip === true,
  JSON.stringify({ t: S.player.tonics, tip: S.player.seenHeatTip }));

// ---------------------------------------------------------------- 2c. THE pre-S6 → S6 RELOCATION
// P2/S6 moved hasBoat + wayfind from state.X into the player slice. Same doctrine as 2b:
// a pre-move save holds them at the ROOT; the load must read them back LOSSLESSLY (field-keyed
// fallback, no version gate) — or a returning captain loses his 250 g boat and a switched-off
// guide arrow pops back on.
const preS6 = JSON.parse(JSON.stringify(G.snapshot()));
delete preS6.player.hasBoat; delete preS6.player.wayfind;
preS6.hasBoat = true; preS6.wayfind = false;                    // the old root spots
S.player.hasBoat = false; S.player.wayfind = true;
G.applySnapshot(preS6);
ok('pre-S6 save: root hasBoat/wayfind land LOSSLESSLY on the player',
  S.player.hasBoat === true && S.player.wayfind === false,
  JSON.stringify({ boat: S.player.hasBoat, wf: S.player.wayfind }));
// …and a save missing them EVERYWHERE (truly old) takes the safe defaults: no boat, guide ON
const preBoat = JSON.parse(JSON.stringify(preS6));
delete preBoat.hasBoat; delete preBoat.wayfind;
G.applySnapshot(preBoat);
ok('a save with NO boat/guide keys anywhere defaults to hasBoat=false, wayfind=true',
  S.player.hasBoat === false && S.player.wayfind === true,
  JSON.stringify({ boat: S.player.hasBoat, wf: S.player.wayfind }));
// …and the S6 shape round-trips: the keys ride the player slice, never the root
S.player.hasBoat = true; S.player.wayfind = false;
const s6 = JSON.parse(JSON.stringify(G.snapshot()));
ok('S6 snapshot: hasBoat/wayfind ride the PLAYER slice, root is clean',
  s6.player.hasBoat === true && s6.player.wayfind === false && s6.hasBoat === undefined && s6.wayfind === undefined,
  JSON.stringify({ p: { boat: s6.player.hasBoat, wf: s6.player.wayfind }, root: { boat: s6.hasBoat, wf: s6.wayfind } }));
S.player.hasBoat = false; S.player.wayfind = true;
G.applySnapshot(s6);
ok('S6 round-trip: boat + guide pref survive save→load', S.player.hasBoat === true && S.player.wayfind === false,
  JSON.stringify({ boat: S.player.hasBoat, wf: S.player.wayfind }));

// ---------------------------------------------------------------- 2d. THE pre-S7 → S7 RELOCATION
// P2/S7 moved shopPurchased/cargo/lastRestDay from state.X into the player slice (and fishCd onto
// the player WITHOUT ever being saved — a load always resets it to 0, exactly as before). Same
// doctrine as 2b/2c: a pre-move save holds them at the ROOT; the load reads them back LOSSLESSLY —
// or a migrated hero re-buys owned shop stock, loses his trade hold, and load-screen rest resets.
const preS7 = JSON.parse(JSON.stringify(G.snapshot()));
delete preS7.player.shopPurchased; delete preS7.player.cargo; delete preS7.player.lastRestDay;
preS7.shopPurchased = ['old_axe']; preS7.cargo = { furs: 0, grain: 5, spice: 0, ore: 1 }; preS7.lastRestDay = 6;   // the old root spots
S.player.shopPurchased = []; S.player.cargo = { furs: 9, grain: 9, spice: 9, ore: 9 }; S.player.lastRestDay = 2; S.player.fishCd = 77;
G.applySnapshot(preS7);
ok('pre-S7 save: root shopPurchased/cargo/lastRestDay land LOSSLESSLY on the player (fishCd resets 0)',
  S.player.shopPurchased.length === 1 && S.player.shopPurchased[0] === 'old_axe'
  && S.player.cargo.grain === 5 && S.player.cargo.ore === 1 && S.player.lastRestDay === 6 && S.player.fishCd === 0,
  JSON.stringify({ sp: S.player.shopPurchased, cargo: S.player.cargo, rest: S.player.lastRestDay, cd: S.player.fishCd }));
// …and a save missing them EVERYWHERE (truly old) takes the safe defaults: nothing owned, empty hold, day-1 rest
const preShop = JSON.parse(JSON.stringify(preS7));
delete preShop.shopPurchased; delete preShop.cargo; delete preShop.lastRestDay;
G.applySnapshot(preShop);
ok('a save with NO shop/cargo/rest keys anywhere defaults to []/empty hold/lastRestDay 1',
  S.player.shopPurchased.length === 0 && S.player.cargo.furs === 0 && S.player.cargo.grain === 0 && S.player.lastRestDay === 1,
  JSON.stringify({ sp: S.player.shopPurchased, cargo: S.player.cargo, rest: S.player.lastRestDay }));
// …and the S7 shape round-trips: the keys ride the player slice, never the root; fishCd is in NEITHER
S.player.shopPurchased = ['new_bow']; S.player.cargo.spice = 2; S.player.lastRestDay = 4; S.player.fishCd = 33;
const s7 = JSON.parse(JSON.stringify(G.snapshot()));
ok('S7 snapshot: shopPurchased/cargo/lastRestDay ride the PLAYER slice, root is clean, fishCd saved NOWHERE',
  s7.player.shopPurchased[0] === 'new_bow' && s7.player.cargo.spice === 2 && s7.player.lastRestDay === 4
  && s7.shopPurchased === undefined && s7.cargo === undefined && s7.lastRestDay === undefined
  && s7.fishCd === undefined && s7.player.fishCd === undefined,
  JSON.stringify({ p: { sp: s7.player.shopPurchased, spice: s7.player.cargo.spice, rest: s7.player.lastRestDay }, root: { sp: s7.shopPurchased, rest: s7.lastRestDay } }));
S.player.shopPurchased = []; S.player.lastRestDay = 1;
G.applySnapshot(s7);
ok('S7 round-trip: purchases/hold/rest-day survive save→load (fishCd back to 0)',
  S.player.shopPurchased[0] === 'new_bow' && S.player.cargo.spice === 2 && S.player.lastRestDay === 4 && S.player.fishCd === 0,
  JSON.stringify({ sp: S.player.shopPurchased, spice: S.player.cargo.spice, rest: S.player.lastRestDay, cd: S.player.fishCd }));

// ---------------------------------------------------------------- 2e. THE pre-S8 → S8 RELOCATION
// P2/S8 moved the forage pantry (ingredients) from state.X into the player slice — the LAST
// key of MP's characterOf shop slice. Same doctrine as 2b/2c/2d: a pre-move save holds it at
// the ROOT; the load reads it back LOSSLESSLY — or a migrated hero's foraged pantry empties.
const preS8 = JSON.parse(JSON.stringify(G.snapshot()));
delete preS8.player.ingredients;
preS8.ingredients = { herb: 5, berry: 2, mushroom: 0, fish: 3 };   // the old root spot
S.player.ingredients = { herb: 9, berry: 9, mushroom: 9, fish: 9 };
G.applySnapshot(preS8);
ok('pre-S8 save: root ingredients land LOSSLESSLY on the player',
  S.player.ingredients.herb === 5 && S.player.ingredients.berry === 2 && S.player.ingredients.mushroom === 0 && S.player.ingredients.fish === 3,
  JSON.stringify(S.player.ingredients));
// …and a save missing them EVERYWHERE (truly old) takes the safe default: an empty pantry
const prePantry = JSON.parse(JSON.stringify(preS8));
delete prePantry.ingredients;
G.applySnapshot(prePantry);
ok('a save with NO pantry anywhere defaults to the empty pantry',
  S.player.ingredients.herb === 0 && S.player.ingredients.berry === 0 && S.player.ingredients.mushroom === 0 && S.player.ingredients.fish === 0,
  JSON.stringify(S.player.ingredients));
// …and the S8 shape round-trips: the key rides the player slice, never the root
S.player.ingredients = { herb: 1, berry: 0, mushroom: 2, fish: 0 };
const s8 = JSON.parse(JSON.stringify(G.snapshot()));
ok('S8 snapshot: ingredients ride the PLAYER slice, root is clean',
  s8.player.ingredients.herb === 1 && s8.player.ingredients.mushroom === 2 && s8.ingredients === undefined,
  JSON.stringify({ p: s8.player.ingredients, root: s8.ingredients }));
S.player.ingredients = { herb: 0, berry: 0, mushroom: 0, fish: 0 };
G.applySnapshot(s8);
ok('S8 round-trip: the pantry survives save→load',
  S.player.ingredients.herb === 1 && S.player.ingredients.mushroom === 2 && S.player.ingredients.fish === 0,
  JSON.stringify(S.player.ingredients));

// ---------------------------------------------------------------- 2f. THE pre-S9 → S9 RELOCATION
// P2/S9 moved the per-hero travel list (visitedTowns) from state.X into the player slice, and the
// shop SESSION (activeShopTown/activeStock/activeShopName) onto the player WITHOUT ever being
// saved — a load always resets the town to -1, exactly as before. Same doctrine as 2b-2e: a
// pre-move save holds the list at the ROOT; the load reads it back LOSSLESSLY — or a migrated
// hero's fast-travel destinations all vanish.
const preS9 = JSON.parse(JSON.stringify(G.snapshot()));
delete preS9.player.visitedTowns;
preS9.visitedTowns = [0, 2, 4];                                 // the old root spot
S.player.visitedTowns = [9]; S.player.activeShopTown = 5;       // stale session values a load must clear
G.applySnapshot(preS9);
ok('pre-S9 save: root visitedTowns lands LOSSLESSLY on the player (shop session resets to -1)',
  S.player.visitedTowns.length === 3 && S.player.visitedTowns[0] === 0 && S.player.visitedTowns[1] === 2 && S.player.visitedTowns[2] === 4
  && S.player.activeShopTown === -1,
  JSON.stringify({ vt: S.player.visitedTowns, town: S.player.activeShopTown }));
// …and a save missing it EVERYWHERE (truly old) takes the safe default: no towns discovered
const preTravel = JSON.parse(JSON.stringify(preS9));
delete preTravel.visitedTowns;
S.player.visitedTowns = [7];
G.applySnapshot(preTravel);
ok('a save with NO travel list anywhere defaults to []',
  Array.isArray(S.player.visitedTowns) && S.player.visitedTowns.length === 0, JSON.stringify(S.player.visitedTowns));
// …and the S9 shape round-trips: the list rides the player slice, never the root; the session in NEITHER
S.player.visitedTowns = [1, 3]; S.player.activeShopTown = 4; S.player.activeShopName = 'Ghost'; S.player.activeStock = { weapons: [], armor: [] };
const s9 = JSON.parse(JSON.stringify(G.snapshot()));
ok('S9 snapshot: visitedTowns rides the PLAYER slice, root is clean, the shop session saved NOWHERE',
  s9.player.visitedTowns.length === 2 && s9.player.visitedTowns[1] === 3 && s9.visitedTowns === undefined
  && s9.activeShopTown === undefined && s9.player.activeShopTown === undefined
  && s9.player.activeStock === undefined && s9.player.activeShopName === undefined,
  JSON.stringify({ p: s9.player.visitedTowns, root: s9.visitedTowns, town: s9.player.activeShopTown }));
S.player.visitedTowns = []; S.player.activeShopTown = 2;
G.applySnapshot(s9);
ok('S9 round-trip: the travel list survives save→load (session back to closed)',
  S.player.visitedTowns.length === 2 && S.player.visitedTowns[0] === 1 && S.player.activeShopTown === -1,
  JSON.stringify({ vt: S.player.visitedTowns, town: S.player.activeShopTown }));

// ---------------------------------------------------------------- 2g. THE pre-S10 → S10 RELOCATION
// P2/S10 moved the steed (dragon) from state.X into the player slice, and sailing onto the player
// WITHOUT ever being saved — a load always makes landfall, exactly as before. Same doctrine as
// 2b-2f: a pre-move save holds dragon at the ROOT (mounted saved live); the load reads it back
// LOSSLESSLY and re-GROUNDS it, exactly like the old root read — or a migrated rider's tamed
// Emberwyrm goes feral.
const preS10 = JSON.parse(JSON.stringify(G.snapshot()));
delete preS10.player.dragon;
preS10.dragon = { tamed: true, mounted: true };                 // the old root spot
S.player.dragon = { tamed: false, mounted: false }; S.player.sailing = true;   // stale session values a load must clear
G.applySnapshot(preS10);
ok('pre-S10 save: root dragon lands LOSSLESSLY on the player, GROUNDED (sailing resets false)',
  S.player.dragon.tamed === true && S.player.dragon.mounted === false && S.player.sailing === false,
  JSON.stringify({ dragon: S.player.dragon, sail: S.player.sailing }));
// …and a save missing it EVERYWHERE (truly old) takes the safe default: untamed, grounded
const preDragon = JSON.parse(JSON.stringify(preS10));
delete preDragon.dragon;
S.player.dragon = { tamed: true, mounted: true };
G.applySnapshot(preDragon);
ok('a save with NO dragon anywhere defaults to untamed + grounded',
  S.player.dragon.tamed === false && S.player.dragon.mounted === false,
  JSON.stringify(S.player.dragon));
// …and the S10 shape round-trips: dragon rides the player slice, never the root; sailing in NEITHER
S.player.dragon = { tamed: true, mounted: true }; S.player.sailing = true;
const s10 = JSON.parse(JSON.stringify(G.snapshot()));
ok('S10 snapshot: dragon rides the PLAYER slice (mounted as-saved), root is clean, sailing saved NOWHERE',
  s10.player.dragon.tamed === true && s10.player.dragon.mounted === true && s10.dragon === undefined
  && s10.sailing === undefined && s10.player.sailing === undefined,
  JSON.stringify({ p: s10.player.dragon, root: s10.dragon, sail: s10.player.sailing }));
S.player.dragon = { tamed: false, mounted: false };
G.applySnapshot(s10);
ok('S10 round-trip: the tamed steed survives save→load GROUNDED, on foot',
  S.player.dragon.tamed === true && S.player.dragon.mounted === false && S.player.sailing === false,
  JSON.stringify({ dragon: S.player.dragon, sail: S.player.sailing }));

// ---------------------------------------------------------------- 2h. THE pre-S11 → S11 RELOCATION
// P2/S11 moved factions (reputation ledger) + loreFound (read Realm-stones) from state.X into the
// player slice. Same doctrine as 2b-2g: a pre-move save holds both at the ROOT; the load reads
// them back LOSSLESSLY — or every migrated hero's standings zero out and every stone re-pays XP.
const preS11 = JSON.parse(JSON.stringify(G.snapshot()));
delete preS11.player.factions; delete preS11.player.loreFound;
preS11.factions = { vigil: 31, wilds: -22, dread: 46 };         // the old root spots
preS11.loreFound = [0, 3, 8];
S.player.factions = { vigil: 0, wilds: 0, dread: 0 }; S.player.loreFound = [];   // stale session values a load must replace
G.applySnapshot(preS11);
ok('pre-S11 save: root factions/loreFound land LOSSLESSLY on the player',
  S.player.factions.vigil === 31 && S.player.factions.wilds === -22 && S.player.factions.dread === 46
  && JSON.stringify(S.player.loreFound) === '[0,3,8]',
  JSON.stringify({ fac: S.player.factions, lore: S.player.loreFound }));
// …and a save missing them EVERYWHERE (truly old) takes the safe defaults: zero ledger, no stones
const preRep = JSON.parse(JSON.stringify(preS11));
delete preRep.factions; delete preRep.loreFound;
S.player.factions = { vigil: 9, wilds: 9, dread: 9 }; S.player.loreFound = [7];
G.applySnapshot(preRep);
ok('a save with NO factions/loreFound anywhere defaults to the zero ledger + no stones',
  S.player.factions.vigil === 0 && S.player.factions.wilds === 0 && S.player.factions.dread === 0
  && Array.isArray(S.player.loreFound) && S.player.loreFound.length === 0,
  JSON.stringify({ fac: S.player.factions, lore: S.player.loreFound }));
// …and the S11 shape round-trips: both ride the player slice, never the root
S.player.factions = { vigil: 12, wilds: -4, dread: 30 }; S.player.loreFound = [1, 6];
const s11 = JSON.parse(JSON.stringify(G.snapshot()));
ok('S11 snapshot: factions/loreFound ride the PLAYER slice, root is clean',
  s11.player.factions.vigil === 12 && s11.player.factions.dread === 30 && JSON.stringify(s11.player.loreFound) === '[1,6]'
  && s11.factions === undefined && s11.loreFound === undefined,
  JSON.stringify({ p: { fac: s11.player.factions, lore: s11.player.loreFound }, rootF: s11.factions, rootL: s11.loreFound }));
S.player.factions = { vigil: 0, wilds: 0, dread: 0 }; S.player.loreFound = [];
G.applySnapshot(s11);
ok('S11 round-trip: standings + read stones survive save→load',
  S.player.factions.vigil === 12 && S.player.factions.wilds === -4 && S.player.factions.dread === 30
  && JSON.stringify(S.player.loreFound) === '[1,6]',
  JSON.stringify({ fac: S.player.factions, lore: S.player.loreFound }));

// ---------------------------------------------------------------- 2i. THE pre-S12 → S12 RELOCATION
// P2/S12 moved maxDepth (the deepest-depth record) + bounty (the accepted Bounty-Board contract)
// from state.X into the player slice — the last two PP keys before quests. Same doctrine as
// 2b-2h: a pre-move save holds both at the ROOT; the load reads them back LOSSLESSLY — or every
// migrated hero forgets his depth (depth bounties re-scale to Depth 3, Delver's Insight re-pays)
// and loses his live contract.
const preS12 = JSON.parse(JSON.stringify(G.snapshot()));
delete preS12.player.maxDepth; delete preS12.player.bounty;
preS12.maxDepth = 23;                                           // the old root spots
preS12.bounty = { type: 'depth', target: 26, progress: 23, reward: 950, loot: true, desc: 'Delve to dungeon Depth 26' };
S.player.maxDepth = 0; S.player.bounty = null;                  // stale session values a load must replace
G.applySnapshot(preS12);
ok('pre-S12 save: root maxDepth/bounty land LOSSLESSLY on the player',
  S.player.maxDepth === 23 && S.player.bounty && S.player.bounty.target === 26 && S.player.bounty.reward === 950,
  JSON.stringify({ d: S.player.maxDepth, b: S.player.bounty && S.player.bounty.desc }));
// …and the S12 shape round-trips: both ride the player slice, never the root
S.player.maxDepth = 31; S.player.bounty = { type: 'cull', target: 40, progress: 4, reward: 800, desc: 'Cull the wilds: slay 40 foes' };
const s12 = JSON.parse(JSON.stringify(G.snapshot()));
ok('S12 snapshot: maxDepth/bounty ride the PLAYER slice, root is clean',
  s12.player.maxDepth === 31 && s12.player.bounty && s12.player.bounty.target === 40
  && s12.maxDepth === undefined && s12.bounty === undefined,
  JSON.stringify({ p: { d: s12.player.maxDepth, b: s12.player.bounty && s12.player.bounty.type }, rootD: s12.maxDepth, rootB: s12.bounty }));
S.player.maxDepth = 0; S.player.bounty = null;
G.applySnapshot(s12);
ok('S12 round-trip: the depth record + the accepted contract survive save→load',
  S.player.maxDepth === 31 && S.player.bounty && S.player.bounty.progress === 4 && S.player.bounty.reward === 800,
  JSON.stringify({ d: S.player.maxDepth, b: S.player.bounty }));

// ---------------------------------------------------------------- 3. the SP no-op proof
// The game artifact (P1 wrap: prettier-formatted dist assembly; EM_REPO may still point at a
// pre-wrap checkout, so fall back to its monolith).
const gamePath = process.env.GAME_HTML || process.env.ELDERMYR_GAME_FILE ||
  [path.join(REPO, 'dist', 'eldermyr.html'), path.join(REPO, 'eldermyr-rpg.html')].find((p) => fs.existsSync(p));
if (!gamePath) throw new Error('sp-flags-check: no game artifact in ' + REPO + ' — run `npm run build` there first');
const game = fs.readFileSync(gamePath, 'utf8');
// call sites only: skip the `function enterDungeon() {` declaration and the build-generated
// namespace's `get enterDungeon() {` accessor. (tryEnterDungeon can't match — capital E.)
const calls = (game.match(/(?<!function )(?<!get )\benterDungeon\(\)/g) || []).length;
const insideTry = /state\.player\.enteredDungeon = true;\s*\}\s*enterDungeon\(\);/.test(game);
ok('currentObjective\'s new maxDepth clause is a no-op in SP: enterDungeon() has exactly ONE call site…', calls === 1, 'callSites=' + calls);
ok('…and it is inside tryEnterDungeon, AFTER the milestone is set (so maxDepth>0 ⇒ enteredDungeon)', insideTry);
ok('the wayfinder gate reads the PLAYER milestone, not the shared flags', /!state\.player\.enteredDungeon && !\(state\.player\.maxDepth > 0\)/.test(game));   // P2/S12: the depth clause reads the player too
ok('no personal milestone is left on state.flags anywhere in the game file',
  !/state\.flags\.(enteredDungeon|gotKey|enteredFrozen)/.test(game));
ok('the WORLD facts are still on the shared state.flags',
  /state\.flags\.krakenDead\s*=\s*true/.test(game) && /state\.flags\.legionBroken\s*=\s*true/.test(game) && /if\s*\(state\.flags\.legionBroken\)/.test(game));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
