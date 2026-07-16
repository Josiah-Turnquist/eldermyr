'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/*
 * flags-pp-verify.js — the assertions for the PERSONAL-MILESTONES fix (state.flags split).
 *
 * The bug (owner's 4th report of this class): the WAYFINDER (currentObjective → [O] arrow +
 * edge marker + minimap pulse) keeps sending a level-45 hero to the Sunken Dungeon he has
 * cleared many times, because it gates on `state.flags.enteredDungeon` — SHARED world state
 * that is NEVER persisted. Railway scale-to-zero → flags reset → the arrow returns forever.
 * In co-op it is worse: ONE hero entering clears the pointer for EVERYONE.
 *
 * NON-VACUITY IS THE WHOLE POINT (v2.54.1 shipped green and failed live):
 *  1. EVERY TEST RUNS IN ITS OWN PROCESS. `const S = G.state` is a module singleton, so a
 *     same-process `new World()` REUSES S — T1 (cold boot) would PASS on broken code.
 *  2. The verdict comes from the game's OWN currentObjective(), fed a REAL snapshotFor()
 *     payload through the REAL client adopt path (objclient.js) — not a formula mirror.
 *  3. The hero gets his milestones through REAL code paths only (walk onto the key pickup →
 *     checkPickups; stand at the entrance → [E] → tryInteract → tryEnterDungeon).
 *
 * Usage:  node flags-pp-verify.js            (orchestrator — spawns each test fresh)
 *         node flags-pp-verify.js --t=<id>   (one test, prints a JSON result line)
 */
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const HERE = __dirname;
const REPO = process.env.EM_REPO || __RR;   // EM_REPO → run this same battery against a PRE-FIX copy of the tree (non-vacuity proof)
const SAVE = path.join(HERE, '_flags_save.json');
const SELF = __filename;

function boot() {
  const G = require(path.join(REPO, 'server-spike', 'load-game.js'));
  const { World } = require(path.join(REPO, 'server', 'world.js'));
  return { G, World, S: G.state, TILE: G.TILE || 32 };
}

/** Where does this player's personal milestone live? (pre-fix: nowhere but the shared flags) */
function milestones(S, p) {
  return {
    enteredDungeon: p.enteredDungeon !== undefined ? p.enteredDungeon : (S.flags && S.flags.enteredDungeon),
    gotKey: p.gotKey !== undefined ? p.gotKey : (S.flags && S.flags.gotKey),
    enteredFrozen: p.enteredFrozen !== undefined ? p.enteredFrozen : (S.flags && S.flags.enteredFrozen),
    onPlayer: p.enteredDungeon !== undefined,
  };
}

/**
 * Drive a hero to "the Elder is done, I hold the key, I have delved" — REAL PATHS ONLY.
 *   talk  → world.resolveInteract('elder')      (talk.done, key.hidden=false, main.started)
 *   key   → walk onto the world key pickup      (checkPickups → keys+=1, gotKey, quests.key.done)
 *   delve → stand at state.dungeonEntrance, [E] (tryInteract → tryEnterDungeon → enterDungeon)
 * Entry is KEY-GATED (inventory.keys>0) and PROXIMITY-based on a T.DUNGEON_ENTRANCE tile.
 */
function makeDelver(w, G, S, id, name, opts) {
  opts = opts || {};
  const TILE = G.TILE || 32;
  const p = w.addPlayer(id, name);
  const elder = (S.npcs || []).find((n) => n.id === 'elder');
  p.x = elder.x; p.y = elder.y;
  w.resolveInteract(id, 'elder');
  if (!p.quests && !S.quests.talk.done) throw new Error('setup: the Elder did not take');

  // REAL: collect a world key (checkPickups runs inside updatePlayer's per-player phase).
  // setupOverworld places exactly ONE, so for a SECOND hero we re-add a deep copy of the real
  // makePickup() object — which is what a room reboot does anyway (the world regenerates, key
  // and all). The code under test (checkPickups) still runs for real.
  let pk = (S.pickups || []).find((x) => x.kind === 'key' && !x.collected);
  if (!pk) {
    if (!makeDelver._keyProto) throw new Error('setup: no key pickup in the world');
    pk = JSON.parse(JSON.stringify(makeDelver._keyProto));
    S.pickups.push(pk);
  } else if (!makeDelver._keyProto) makeDelver._keyProto = JSON.parse(JSON.stringify(pk));
  p.x = pk.x; p.y = pk.y;
  w.tick();
  if (!(p.inventory.keys > 0)) throw new Error('setup: the key pickup did not take');

  if (!opts.noDelve) {
    // REAL: walk to the dungeon entrance and press [E]
    const de = S.dungeonEntrance;
    p.x = de.tx * TILE; p.y = de.ty * TILE;
    p.actions.push('interact');
    w.tick();
    if (p.map !== 'dungeon') throw new Error('setup: the dungeon entry did not take — setup is broken, not the code under test');
    p.map = 'overworld'; w.sharedDg = null; w.dgSpawn = null; S.map = 'overworld';   // surface again
    p.x = elder.x; p.y = elder.y;
  }
  if (opts.level) p.level = opts.level;
  if (opts.keys) p.inventory.keys = opts.keys;
  return p;
}

/** The quest slice as the server holds it for p (per-player post-v2.57.0, shared before). */
const questSrc = (S, p) => (p.quests ? p.quests : S.quests);

const TESTS = {
  // ---------------------------------------------------------------- T1a: persist (setup)
  '1a': () => {
    const { G, World, S } = boot();
    const w = new World();
    const p = makeDelver(w, G, S, 'P1', 'Owner', { level: 45, keys: 16 });
    const ch = w.characterOf('P1');
    fs.writeFileSync(SAVE, JSON.stringify(ch));
    const ms = milestones(S, p);
    return {
      name: 'T1a cold-boot: a real delve, then persist via the REAL characterOf() (setup)',
      pass: !!ch && ms.enteredDungeon === true,
      info: {
        pid: process.pid, rowVersion: ch && ch.v,
        serverSaysEnteredDungeon: ms.enteredDungeon, milestonesLiveOnPlayer: ms.onPlayer,
        rowCarriesMilestone: !!(ch && ch.player && ch.player.enteredDungeon !== undefined),
        rowPlayerKeysWithMilestones: ch && ch.player ? Object.keys(ch.player).filter((k) => /entered|gotKey/i.test(k)).join(',') || '(none)' : '?',
        rowHasFlags: !!(ch && ch.flags),
      },
    };
  },

  // ---------------------------------------------------------------- T1b: THE COLD BOOT
  // A genuinely fresh node process = a Railway scale-to-zero / room cold-boot. A same-process
  // `new World()` would reuse the module-singleton S (which still holds the entered flag) and
  // would PASS on today's broken code — that is exactly how v2.54.1 shipped green.
  '1b': () => {
    const { G, World, S } = boot();
    const { clientObjective, isDungeonObjective, RECONCILE_SRC, RECONCILE_SRC_OK } = require(path.join(HERE, 'objclient.js'));
    const saved = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
    const w = new World();
    const p = w.addPlayer('P1', 'Owner', saved);
    for (let i = 0; i < 5; i++) w.tick();
    const snap = w.snapshotFor('P1');
    const o = clientObjective(snap);
    const ms = milestones(S, p);
    return {
      name: 'T1 COLD BOOT (fresh process) — a hero who has delved must NOT be re-sent to the Sunken Dungeon',
      pass: RECONCILE_SRC_OK && !isDungeonObjective(o),
      info: {
        pid: process.pid, objective: o ? o.label : null,
        sharedFlagAfterReboot: S.flags && S.flags.enteredDungeon, playerMilestoneAfterLoad: ms.enteredDungeon,
        snapMeCarriesMilestone: !!(snap.me && snap.me.enteredDungeon !== undefined), snapMeMilestone: snap.me && snap.me.enteredDungeon,
        keyQuestDone: questSrc(S, p).key.done, maxDepth: p.maxDepth, clientSrcAsserts: RECONCILE_SRC,
      },
    };
  },

  // ---------------------------------------------------------------- T1c: WARM ROOM (no reboot at all)
  // Stronger than the cold boot, and the real reason the owner sees this "forever": state.flags is a
  // state.X field that has NEVER been on the wire, and the MP client never runs tryEnterDungeon itself
  // (it only pushes an 'interact' ACTION — the server resolves it). So the client's own
  // flags.enteredDungeon is false on every page load, in a warm room, seconds after a real delve.
  '1c': () => {
    const { G, World, S } = boot();
    const { clientObjective, isDungeonObjective } = require(path.join(HERE, 'objclient.js'));
    const w = new World();
    const p = makeDelver(w, G, S, 'P1', 'Owner', { level: 45, keys: 16 });
    for (let i = 0; i < 5; i++) w.tick();
    const o = clientObjective(w.snapshotFor('P1'));
    return {
      name: 'T1c WARM ROOM — the client must learn the hero has delved (no reboot involved)',
      pass: !isDungeonObjective(o),
      info: {
        objective: o ? o.label : null,
        serverKnows: milestones(S, p).enteredDungeon, sharedFlagOnServer: S.flags && S.flags.enteredDungeon,
        milestoneOnTheWire: (() => { const s = w.snapshotFor('P1'); return s.me && s.me.enteredDungeon !== undefined ? s.me.enteredDungeon : 'ABSENT from snap.me'; })(),
      },
    };
  },

  // ---------------------------------------------------------------- T2: CO-OP
  '2': () => {
    const { G, World, S } = boot();
    const { clientObjective, isDungeonObjective } = require(path.join(HERE, 'objclient.js'));
    const w = new World();
    const A = makeDelver(w, G, S, 'A', 'Delver');                       // has entered
    const B = makeDelver(w, G, S, 'B', 'Newcomer', { noDelve: true });  // has the key, never entered
    for (let i = 0; i < 40; i++) w.tick();
    const oA = clientObjective(w.snapshotFor('A'));
    const oB = clientObjective(w.snapshotFor('B'));
    return {
      name: 'T2 CO-OP — A entering must not clear the pointer for B (and B must still be guided)',
      pass: !isDungeonObjective(oA) && isDungeonObjective(oB),
      info: {
        aObjective: oA ? oA.label : null, bObjective: oB ? oB.label : null,
        aMilestone: milestones(S, A).enteredDungeon, bMilestone: milestones(S, B).enteredDungeon,
        sharedFlag: S.flags && S.flags.enteredDungeon,
        aKeyDone: questSrc(S, A).key.done, bKeyDone: questSrc(S, B).key.done,
      },
    };
  },

  // ---------------------------------------------------------------- T3a: MIGRATION (v2-shaped row)
  '3a': () => {
    const { G, World, S } = boot();
    const { clientObjective, isDungeonObjective } = require(path.join(HERE, 'objclient.js'));
    const w = new World();
    const seed = makeDelver(w, G, S, 'SEED', 'Seed');
    const row = JSON.parse(JSON.stringify(w.characterOf('SEED')));
    w.removePlayer('SEED');
    // ---- forge a row saved by the PREVIOUS release: v2, no milestone fields at all ----
    row.v = 2;
    delete row.player.enteredDungeon; delete row.player.gotKey; delete row.player.enteredFrozen;
    delete row.flags;
    row.player.level = 45; row.inventory.keys = 16; row.maxDepth = 45;
    const p = w.addPlayer('P1', 'Owner', row);
    for (let i = 0; i < 5; i++) w.tick();
    const o = clientObjective(w.snapshotFor('P1'));
    return {
      name: 'T3a MIGRATION (v2 row: level 45 / 16 keys / maxDepth 45, no saved flags) — no Sunken Dungeon',
      pass: !isDungeonObjective(o),
      info: { objective: o ? o.label : null, migratedMilestone: milestones(S, p).enteredDungeon, level: p.level, keys: p.inventory.keys, maxDepth: p.maxDepth },
    };
  },

  // ---------------------------------------------------------------- T3b: MIGRATION (the owner's REAL row)
  // v2.57.0 is NOT yet released (the working tree is uncommitted), so EVERY row in the live DB is
  // v1: no quests, no maxDepth. The v1→v2 migration defaults maxDepth to 0 — so `maxDepth > 0`
  // is NOT available as a synthesis source for the owner's actual character. This is the case
  // that matters, and the one a lazy migration silently misses.
  '3b': () => {
    const { G, World, S } = boot();
    const { clientObjective, isDungeonObjective } = require(path.join(HERE, 'objclient.js'));
    const w = new World();
    const seed = makeDelver(w, G, S, 'SEED', 'Seed');
    const row = JSON.parse(JSON.stringify(w.characterOf('SEED')));
    w.removePlayer('SEED');
    // ---- forge the owner's ACTUAL live row: v1 — no quests, no maxDepth, no milestones ----
    row.v = 1;
    delete row.player.enteredDungeon; delete row.player.gotKey; delete row.player.enteredFrozen;
    delete row.flags; delete row.quests; delete row.maxDepth; delete row.bounty;
    row.player.level = 45; row.inventory.keys = 16;
    const p = w.addPlayer('P1', 'Owner', row);
    for (let i = 0; i < 5; i++) w.tick();
    const o = clientObjective(w.snapshotFor('P1'));
    return {
      name: 'T3b MIGRATION (the owner\'s REAL v1 row: level 45 / 16 keys / NO maxDepth) — no Sunken Dungeon',
      pass: !isDungeonObjective(o),
      info: {
        objective: o ? o.label : null, migratedMilestone: milestones(S, p).enteredDungeon,
        level: p.level, keys: p.inventory.keys, maxDepthAfterV1Migration: p.maxDepth,
        keyQuestDone: questSrc(S, p).key.done, gotKey: milestones(S, p).gotKey, enteredFrozen: milestones(S, p).enteredFrozen,
      },
    };
  },

  // ---------------------------------------------------------------- T4: WORLD FACTS STAY SHARED
  // A guard, not a repro: it passes before AND after by design. It is what catches the WRONG fix
  // (blanket-converting `flags` to a PP_KEY), which would mean a partner's Kraken kill does not
  // count for you. Reads the flag the way the game's own systems read it: through the PP swap.
  '4': () => {
    const { G, World, S } = boot();
    const w = new World();
    const A = w.addPlayer('A', 'Hunter');
    const B = w.addPlayer('B', 'Partner');
    for (let i = 0; i < 3; i++) w.tick();
    const kraken = (S.enemies || []).find((e) => e.isFinalBoss || e.isKraken);
    if (!kraken) throw new Error('setup: no Kraken in the world');
    // B lands the kill (the game credits state.player at kill time)
    S.player = B; S.inventory = B.inventory;
    if (w.swapInPP) w.swapInPP(B);
    G.killEnemy(kraken);
    // …now read the fact as EACH hero's rotation slice sees it
    const read = (p) => { S.player = p; S.inventory = p.inventory; return { shared: S.flags && S.flags.krakenDead, own: p.flags ? p.flags.krakenDead : undefined }; };
    const rB = read(B), rA = read(A);
    // …and the source-level half: both world facts must still be SHARED state.flags, and `flags`
    // must never appear in PP_KEYS. (completeLegionQuest is not captured, so legionBroken is
    // asserted at its real read/write sites instead of by driving it.)
    const gamePath = process.env.GAME_HTML || process.env.ELDERMYR_GAME_FILE ||
      [path.join(REPO, 'dist', 'eldermyr.html'), path.join(REPO, 'eldermyr-rpg.html')].find((p) => fs.existsSync(p));
    const game = fs.readFileSync(gamePath, 'utf8');
    const wsrc = fs.readFileSync(path.join(REPO, 'server', 'world.js'), 'utf8');
    const legionSetShared = /state\.flags\.legionBroken\s*=\s*true/.test(game);
    const legionReadShared = /if\s*\(state\.flags\.legionBroken\)/.test(game);
    const krakenSetShared = /state\.flags\.krakenDead\s*=\s*true/.test(game);
    const ppKeys = (wsrc.match(/const PP_KEYS = \[[^\]]*\]/) || [''])[0];
    const flagsNotPP = !/'flags'/.test(ppKeys);
    return {
      name: 'T4 WORLD FACTS stay shared — a partner\'s Kraken kill must count for everyone',
      pass: rA.shared === true && rB.shared === true && legionSetShared && legionReadShared && krakenSetShared && flagsNotPP,
      info: {
        killedBy: 'B', krakenDeadForA: rA.shared, krakenDeadForB: rB.shared,
        perPlayerFlagsObject: rA.own !== undefined ? 'PRESENT (blanket PP conversion!)' : 'absent (correct)',
        krakenDeadStillOnSharedFlags: krakenSetShared, legionBrokenStillOnSharedFlags: legionSetShared && legionReadShared,
        flagsAbsentFromPPKEYS: flagsNotPP,
      },
    };
  },

  // ---------------------------------------------------------------- T5: ROUND-TRIP through the rotation
  // The scalar trap: `lastRestDay` and `maxDepth` both cost a release by not reaching `p`.
  // A milestone must survive a full tick rotation WITH another hero swapping in, and must
  // still be on the row characterOf() writes.
  '5': () => {
    const { G, World, S } = boot();
    const w = new World();
    const A = makeDelver(w, G, S, 'A', 'Delver');
    const B = makeDelver(w, G, S, 'B', 'Newcomer', { noDelve: true });
    const afterEntry = milestones(S, A).enteredDungeon;
    for (let i = 0; i < 60; i++) w.tick();                 // B's slice swaps in and out ~60 times
    const afterRotation = milestones(S, A).enteredDungeon;
    const bAfterRotation = milestones(S, B).enteredDungeon;
    const ch = w.characterOf('A');
    const chB = w.characterOf('B');
    const onRow = !!(ch && ch.player && ch.player.enteredDungeon);
    const onRowB = !!(chB && chB.player && chB.player.enteredDungeon);
    return {
      name: 'T5 ROUND-TRIP — the milestone survives the rotation and lands on the saved row (scalar-writeback trap)',
      pass: afterEntry === true && afterRotation === true && bAfterRotation !== true && onRow === true && onRowB === false,
      info: {
        aAfterEntry: afterEntry, aAfterRotation: afterRotation, bAfterRotation: bAfterRotation,
        aOnSavedRow: onRow, bOnSavedRow: onRowB, rowVersion: ch && ch.v,
        aGotKeyOnRow: !!(ch && ch.player && ch.player.gotKey),
      },
    };
  },
  // ---------------------------------------------------------------- T6: the FROZEN crossing
  // enteredFrozen moved to the player too, so each hero now gets their OWN first crossing (before,
  // the first hero to cross consumed the lore line + tone for everybody). The shared, ALIASED
  // quests.frozen must still unhide for the whole room — there is one Cache in the world — and the
  // re-reveal must stay idempotent. ARCHITECTURE documented this quest as keying off the SHARED
  // flag, which is exactly the invariant this fix changes; T6 pins the new intent.
  '6': () => {
    const { G, World, S, TILE } = boot();
    const w = new World();
    const A = w.addPlayer('A', 'Wanderer');
    const B = w.addPlayer('B', 'Homebody');
    for (let i = 0; i < 2; i++) w.tick();
    const qA = questSrc(S, A), qB = questSrc(S, B);
    const hiddenBefore = !!(qA.frozen && qA.frozen.hidden);
    const aliased = qA.frozen === qB.frozen;                 // the v2.57.0 world-quest alias
    A.x = 123 * TILE; A.y = 2 * TILE;                        // biomeMap row 2 is frozen for every column
    w.tick();
    const ms = milestones(S, A), msB = milestones(S, B);
    const ch = w.characterOf('A');
    return {
      name: 'T6 FROZEN crossing — a personal milestone, but the shared Cache quest still reveals for all',
      pass: hiddenBefore && aliased && ms.enteredFrozen === true && msB.enteredFrozen !== true
        && qA.frozen.hidden === false && qB.frozen.hidden === false
        && !!(ch && ch.player && ch.player.enteredFrozen === true),
      info: {
        cacheQuestHiddenBeforeCrossing: hiddenBefore, frozenQuestStillAliased: aliased,
        aCrossed: ms.enteredFrozen, bDidNotCross: msB.enteredFrozen,
        sharedCacheQuestRevealedForA: qA.frozen.hidden === false, sharedCacheQuestRevealedForB: qB.frozen.hidden === false,
        aEnteredFrozenOnSavedRow: !!(ch && ch.player && ch.player.enteredFrozen),
      },
    };
  },
};

// ---------------------------------------------------------------- orchestrator
const arg = process.argv.find((a) => a.startsWith('--t='));
if (arg) {
  const id = arg.slice(4);
  let r;
  try { r = TESTS[id](); } catch (e) { r = { name: 'T' + id, pass: false, info: { threw: e.message, stack: (e.stack || '').split('\n').slice(0, 4) } }; }
  process.stdout.write('\n__RESULT__' + JSON.stringify(r) + '\n');
  process.exit(0);
}

const order = ['1a', '1b', '1c', '2', '3a', '3b', '4', '5', '6'];
let fails = 0;
console.log('=== flags-pp-verify — personal milestones (enteredDungeon/gotKey/enteredFrozen) ===');
console.log('    each test runs in its OWN process (S is a module singleton — same-process reuse is vacuous)\n');
for (const id of order) {
  const out = cp.execFileSync(process.execPath, [SELF, '--t=' + id], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const line = out.split('\n').find((l) => l.startsWith('__RESULT__'));
  if (!line) { console.log(`✗ T${id}: no result line\n${out.slice(-800)}`); fails++; continue; }
  const r = JSON.parse(line.slice('__RESULT__'.length));
  if (!r.pass) fails++;
  console.log(`${r.pass ? '✓' : '✗'} ${r.name}`);
  for (const k in r.info) console.log(`      ${k}: ${JSON.stringify(r.info[k])}`);
  console.log('');
}
console.log(fails ? `${fails} FAILING` : 'ALL GREEN');
process.exit(fails ? 1 : 0);
