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

// ---------------------------------------------------------------- 3. the SP no-op proof
const game = fs.readFileSync(path.join(REPO, 'eldermyr-rpg.html'), 'utf8');
// call sites only: skip the `function enterDungeon(){` declaration. (tryEnterDungeon can't match —
// it spells the name with a capital E.)
const calls = (game.match(/(?<!function )\benterDungeon\(\)/g) || []).length;
const insideTry = /state\.player\.enteredDungeon=true; \} enterDungeon\(\);/.test(game);
ok('currentObjective\'s new maxDepth clause is a no-op in SP: enterDungeon() has exactly ONE call site…', calls === 1, 'callSites=' + calls);
ok('…and it is inside tryEnterDungeon, AFTER the milestone is set (so maxDepth>0 ⇒ enteredDungeon)', insideTry);
ok('the wayfinder gate reads the PLAYER milestone, not the shared flags', /!state\.player\.enteredDungeon&&!\(state\.maxDepth>0\)/.test(game));
ok('no personal milestone is left on state.flags anywhere in the game file',
  !/state\.flags\.(enteredDungeon|gotKey|enteredFrozen)/.test(game));
ok('the WORLD facts are still on the shared state.flags',
  /state\.flags\.krakenDead=true/.test(game) && /state\.flags\.legionBroken=true/.test(game) && /if\(state\.flags\.legionBroken\)/.test(game));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
