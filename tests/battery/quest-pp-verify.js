'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/*
 * quest-pp-verify.js — the 6 assertions for the per-player-quests fix.
 * Consolidates probe-{save,cold,bounty,takeover,coop}.js from the prior investigation.
 *
 * NON-VACUITY IS THE WHOLE POINT. Every test here was run against the PRE-FIX tree and
 * OBSERVED TO FAIL. Two structural rules keep them honest:
 *
 *  1. EVERY TEST RUNS IN ITS OWN PROCESS. `server/world.js` does G.startGame() at require
 *     time and `const S = G.state` is a module singleton — a second `new World()` in the
 *     same process REUSES S. T1 (cold boot) is meaningless without a real second process,
 *     and T2/T4/T6 would silently contaminate each other through S.players.
 *  2. The client half is the REAL shipped code, not a mirror: qclient.js evals
 *     client/mp.html's own adoptQuests() and eldermyr-rpg.html's own updateQuests(), and
 *     records what actually lands in #quest-list.
 *
 * Usage:  node quest-pp-verify.js            (orchestrator — spawns each test fresh)
 *         node quest-pp-verify.js --t=<id>   (one test, prints a JSON result line)
 */
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const HERE = __dirname;
const REPO = __RR;
const SAVE = path.join(HERE, '_qpp_save.json');
const SELF = __filename;

// ---------------------------------------------------------------- helpers (child side)
function boot() {
  const G = require(path.join(REPO, 'server-spike', 'load-game.js'));
  const { World } = require(path.join(REPO, 'server', 'world.js'));
  return { G, World, S: G.state, TILE: G.TILE || 32 };
}
const has = (lines, re) => lines.some((l) => re.test(l));
const ELDER = /Speak to the Elder/, SLAY = /Slay monsters/, KEYQ = /Find the Dungeon Key/, D45 = /Deepest depth: 45/;

/**
 * Drive a hero to the owner's reported state (level 45, Depth 45, 16 keys, intro long done)
 * through REAL code paths ONLY — no poking at state.
 *
 * NB the delve goes through world.js's own _enterRift, i.e. the actual server code the owner's
 * depth-45 hero used. The earlier probes wrote `S.maxDepth = 45` by hand, which was a faithful
 * simulation only while maxDepth was a shared global; once it is per-player, poking S proves
 * nothing (and would quietly make T1/T2/T4 assert against a value no real path ever produced).
 */
function makeVeteran(w, G, S, id, name) {
  const p = w.addPlayer(id, name);
  const elder = (S.npcs || []).find((n) => n.id === 'elder');
  p.x = elder.x; p.y = elder.y;
  w.resolveInteract(id, 'elder');                    // REAL: talk.done / main.started / key.hidden=false
  S.player = p; S.inventory = p.inventory;
  for (let i = 0; i < 6; i++) {                      // REAL: killEnemy → quests.slay.count++ → slay.done
    const e = G.makeWildEnemy(Math.floor(p.x / (G.TILE || 32)) + 1, Math.floor(p.y / (G.TILE || 32)));
    if (!e) break;
    S.enemies.push(e); G.killEnemy(e);
  }
  // REAL deep delve: plant a rift under him and queue the breach action the client sends.
  // world.js _enterRift → G.enterDungeon() → state.maxDepth = Math.max(_, deep) → writeBackPP.
  p.inventory.keys = 1;
  w.rift = { x: p.x, y: p.y, deep: 45, expires: S.time + 2400, n: 1, party: false };
  p.actions.push('enterRift');
  w.tick();
  if (p.map !== 'dungeon') throw new Error('makeVeteran: the rift breach did not take — setup is broken, not the code under test');
  p.map = 'overworld'; w.sharedDg = null; w.dgSpawn = null; S.map = 'overworld';   // surface again (dissolve the instance)
  p.level = 45; p.inventory.keys = 16;
  return p;
}
/** Whatever the server holds for p, pushed onto p the way the fix does (or left shared pre-fix). */
function questSrc(S, p) { return p.quests ? p.quests : S.quests; }

// ---------------------------------------------------------------- the tests
const TESTS = {
  // T1a — warm room: build the hero, persist through the REAL characterOf(). Writes _qpp_save.json.
  '1a': () => {
    const { G, World, S } = boot();
    const w = new World();
    const p = makeVeteran(w, G, S, 'P1', 'Owner');
    const ch = w.characterOf('P1');
    fs.writeFileSync(SAVE, JSON.stringify(ch));
    return {
      name: 'T1a cold-boot: persist (setup)',
      pass: !!ch,
      info: {
        savedKeys: Object.keys(ch).join(','), v: ch.v,
        savedQuests: (ch.player && ch.player.quests) ? 'present (player slice — P2/S13)' : 'MISSING',
        savedMaxDepth: (ch.player && ch.player.maxDepth) === undefined ? 'MISSING' : ch.player.maxDepth,
        serverHeld: { talkDone: questSrc(S, p).talk.done, slay: questSrc(S, p).slay, maxDepth: p.maxDepth !== undefined ? p.maxDepth : S.maxDepth },
      },
    };
  },

  // T1b — THE COLD BOOT. A genuinely fresh node process (Railway scale-to-zero → new container).
  // A same-process `new World()` would reuse the module-singleton S and PASS on broken code.
  '1b': () => {
    const { G, World, S } = boot();
    const { clientReceive } = require(path.join(HERE, 'qclient.js'));
    const saved = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
    const w = new World();
    const p = w.addPlayer('P1', 'Owner', saved);
    for (let i = 0; i < 5; i++) w.tick();
    const snap = w.snapshotFor('P1');
    const box = clientReceive(snap, { bag: p.inventory }).painted;
    return {
      name: 'T1 cold boot (fresh process) — a level-45/16-key hero must not re-see the intro',
      pass: !has(box, ELDER) && !has(box, SLAY) && has(box, D45),
      info: { pid: process.pid, level: p.level, keys: p.inventory.keys, snapCarriedQuests: !!snap.quests, snapMaxDepth: snap.maxDepth, box },
    };
  },

  // T2 — TAKEOVER in a WARM room (no cold boot needed). index.js `ws.pid = adopt` reuses the LIVE
  // pid and its already-caught-up _qSeen, while the PAGE is brand new. welcome must seed the payload
  // (it already does exactly this for `legion`, and says so at the call site).
  '2': () => {
    const { G, World, S } = boot();
    const { clientReceive } = require(path.join(HERE, 'qclient.js'));
    const w = new World();
    const p = makeVeteran(w, G, S, 'P1', 'Owner');
    for (let i = 0; i < 200; i++) { w.tick(); w.snapshotFor('P1'); }   // let the S.time%40 stamp settle & the tab catch up
    const qn = p._qN != null ? p._qN : w._qN;
    const caughtUp = (p._qSeen | 0) === (qn | 0);
    let carried = 0;
    for (let i = 0; i < 400; i++) { w.tick(); const s = w.snapshotFor('P1'); if (s.quests) carried++; }

    // the cure, mirroring legionPayload(): a payload builder the welcome can call.
    const payload = typeof w.questPayload === 'function' ? w.questPayload('P1') : null;
    const idx = fs.readFileSync(path.join(REPO, 'server', 'index.js'), 'utf8');
    const wi = idx.indexOf("type: 'welcome'");
    const welcome = wi < 0 ? '' : idx.slice(wi, idx.indexOf('}));', wi));
    const welcomeSeeds = /questPayload/.test(welcome);
    // belt-and-braces: takeover resets _qSeen so the next snapshot re-delivers too
    const resetsSeen = /_qSeen\s*=\s*0/.test(idx);
    p._qSeen = 0;
    const reseeded = !!w.snapshotFor('P1').quests;
    const box = payload ? clientReceive(payload, { bag: p.inventory }).painted : ['<no questPayload()>'];
    // the client must actually consume it from the welcome message
    const mp = fs.readFileSync(path.join(REPO, 'client', 'mp.html'), 'utf8');
    const wh = mp.indexOf("m.type === 'welcome'");
    const clientAdopts = wh > 0 && /adoptQuests\(m\)/.test(mp.slice(wh, wh + 1800));
    return {
      name: 'T2 takeover/reconnect — welcome must seed quests (warm room, no reboot)',
      pass: !!payload && welcomeSeeds && clientAdopts && resetsSeen && reseeded && !has(box, ELDER) && !has(box, SLAY) && has(box, D45),
      info: { caughtUp, snapshotsCarryingQuestsOver400Ticks: carried, hasQuestPayloadFn: !!payload, welcomeSeeds, clientAdoptsOnWelcome: clientAdopts, takeoverResetsQSeen: resetsSeen, reseededAfterQSeenReset: reseeded, box },
    };
  },

  // T3 — FIRST PAINT. adoptQuests runs in ws.onmessage; state.inventory is only assigned in the
  // frame-loop reconcile. The first snapshot ALWAYS carries quests (_qSeen=0), and onmessage
  // provably precedes the first reconcile → the first paint uses the DEFAULT keys=0 bag.
  '3': () => {
    const { G, World, S } = boot();
    const { clientReceive } = require(path.join(HERE, 'qclient.js'));
    const w = new World();
    const p = makeVeteran(w, G, S, 'P1', 'Owner');   // key.hidden=false (Elder), key.done=false, 16 keys in the bag
    const q = questSrc(S, p);
    const snap = w.snapshotFor('P1');
    const r = clientReceive(snap);                   // NO bag override → the game's default inventory (keys:0)
    return {
      name: 'T3 first paint — a 16-key hero must not paint "Find the Dungeon Key"',
      pass: !has(r.painted, KEYQ),
      info: {
        keyHidden: q.key.hidden, keyDone: q.key.done, bagKeysOnServer: p.inventory.keys,
        snapHasMeInventory: !!(snap.me && snap.me.inventory), snapMeKeys: snap.me && snap.me.inventory && snap.me.inventory.keys,
        keysSeenByRendererAtPaint: r.state.inventory && r.state.inventory.keys, adoptErrors: r.errors, box: r.painted,
      },
    };
  },

  // T4 — CO-OP DIVERGENCE. A veteran and a newbie in one warm room must not share a quest box.
  '4': () => {
    const { G, World, S } = boot();
    const { clientReceive } = require(path.join(HERE, 'qclient.js'));
    const w = new World();
    const vet = makeVeteran(w, G, S, 'VET', 'Veteran');
    const noob = w.addPlayer('NOOB', 'Newbie');
    for (let i = 0; i < 80; i++) w.tick();           // let the per-player _qN stamps settle
    const sVet = w.snapshotFor('VET'), sNoob = w.snapshotFor('NOOB');
    const vBox = clientReceive(sVet, { bag: vet.inventory }).painted;
    const nBox = clientReceive(sNoob, { bag: noob.inventory }).painted;
    const byValue = JSON.stringify(sVet.quests) !== JSON.stringify(sNoob.quests);
    const byRef = !!(vet.quests && noob.quests && vet.quests !== noob.quests);
    const subByRef = !!(vet.quests && noob.quests && vet.quests.talk !== noob.quests.talk);   // catches a SHALLOW template clone
    const sharedMain = !!(vet.quests && noob.quests && vet.quests.main === noob.quests.main);
    const sharedLegion = !!(vet.quests && noob.quests && vet.quests.legion === noob.quests.legion);
    const sharedFrozen = !!(vet.quests && noob.quests && vet.quests.frozen === noob.quests.frozen);
    return {
      name: 'T4 co-op — the vet and the newbie must diverge (and still share the world quests)',
      pass: byValue && byRef && subByRef && sharedMain && sharedLegion && sharedFrozen
        && has(nBox, ELDER) && !has(vBox, ELDER) && sVet.maxDepth === 45 && sNoob.maxDepth === 0,
      info: {
        questsDifferByValue: byValue, questsDifferByRef: byRef, subObjectsDifferByRef: subByRef,
        mainAliased: sharedMain, legionAliased: sharedLegion, frozenAliased: sharedFrozen,
        vetMaxDepth: sVet.maxDepth, noobMaxDepth: sNoob.maxDepth, vetBox: vBox, noobBox: nBox,
      },
    };
  },

  // T5 — MIGRATION. Every EXISTING row is v:1 with no quests/maxDepth. Without a migration the
  // load hands them a fresh template → every existing character re-sees the intro exactly once
  // more, i.e. the fix ships the bug. A PP-quests fix WITHOUT the migration passes T1–T4 and
  // fails ONLY here.
  '5': () => {
    const { G, World, S } = boot();
    const { clientReceive } = require(path.join(HERE, 'qclient.js'));
    const w = new World();
    const tmp = w.addPlayer('TMP', 'Tmp');
    tmp.level = 45; tmp.inventory.keys = 16;
    const row = w.characterOf('TMP');                // a REAL row off the REAL save path…
    delete row.quests; delete row.bounty; delete row.maxDepth; row.v = 1;   // …forced back to the v:1 shape on disk today
    if (row.player) { delete row.player.quests; delete row.player.bounty; delete row.player.maxDepth; }   // P2/S13/S12: a modern row carries them IN the player slice — a faithful v1 row has them NOWHERE
    delete row.schemaVersion;
    w.removePlayer('TMP');
    const p = w.addPlayer('P1', 'Owner', row);
    const snap = w.snapshotFor('P1');
    const box = clientReceive(snap, { bag: p.inventory }).painted;
    const q = questSrc(S, p);
    return {
      name: 'T5 migration — an existing v:1 row (level 45, 16 keys) must not re-see the intro',
      pass: !has(box, ELDER) && !has(box, SLAY) && !has(box, KEYQ),
      info: { rowV: row.v, rowHasQuests: 'quests' in row, loadedLevel: p.level, loadedKeys: p.inventory.keys, synthesized: { talk: q.talk, key: q.key, slay: q.slay, mainStarted: q.main.started }, box },
    };
  },

  // T6 — PP WRITEBACK HOLES. maxDepth is written by enterDungeon (=1) and by _enterRift's own
  // deep-breach (=deep). Both writes land on S and must survive back onto p.
  //   • the per-player loop's `if (p.map === 'dungeon') continue;` skips writeBackPP on the very
  //     tick the hero enters → discards enterDungeon()'s maxDepth=1.
  //   • _enterRift swaps IN (swapInPP) but its finally never writes back → discards the breach.
  '6': () => {
    const { G, World, S, TILE } = boot();
    const w = new World();
    const p = w.addPlayer('P1', 'Owner');
    // (a) dungeon entry through the REAL path: stand on the entrance, queue [E].
    const de = S.dungeonEntrance;
    p.x = de.tx * TILE; p.y = de.ty * TILE; p.inventory.keys = 4;
    p.actions.push('interact');
    w.tick();
    const afterEnter = { pMap: p.map, pMaxDepth: p.maxDepth, sMaxDepth: S.maxDepth };
    // leave the dungeon so the rift path is reachable (a rift needs a surface hero + no live delve)
    p.map = 'overworld'; w.sharedDg = null; w.dgSpawn = null;
    for (let i = 0; i < 3; i++) w.tick();
    // (b) rift breach through the REAL path: plant a rift under him, queue the breach action.
    w.rift = { x: p.x, y: p.y, deep: 9, expires: S.time + 2400, n: 1, party: false };
    p.inventory.keys = 4;
    p.actions.push('enterRift');
    w.tick();
    const afterRift = { pMap: p.map, pMaxDepth: p.maxDepth, sMaxDepth: S.maxDepth };
    return {
      name: 'T6 writeback holes — p.maxDepth must rise on dungeon entry AND on a rift breach',
      pass: afterEnter.pMaxDepth === 1 && afterRift.pMaxDepth === 9,
      info: { afterEnter, afterRift, note: 'pre-fix p.maxDepth is undefined (maxDepth is shared, not per-player)' },
    };
  },
  // T7 — the OTHER half of D1, in a fresh process: rollBounty() reads state.maxDepth, so a cold-booted
  // Depth-45 hero was offered "Delve to dungeon Depth 3". Uses the REAL Bounty Board path
  // (resolveInteract → _doInstant → openBounty), which is what swaps his slice in.
  '7': () => {
    const { G, World, S, TILE } = boot();
    const saved = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
    const w = new World();
    const p = w.addPlayer('P1', 'Owner', saved);         // level 45 / Depth 45 / 16 keys, room freshly booted
    const board = (S.npcs || []).find((n) => n.id === 'bounty');
    if (!board) return { name: 'T7 depth bounty', pass: false, info: { noBountyNpc: true } };
    p.x = board.x; p.y = board.y;
    // read the offer from wherever the build under test actually keeps it (p.bounty once it is a PP
    // key; S.bounty while it was shared) — so the PRE-FIX run reports the real symptom rather than
    // failing silently on a field that does not exist yet.
    const bSrc = () => (p.bounty !== undefined ? p.bounty : S.bounty);
    const bClear = () => { if (p.bounty !== undefined) p.bounty = null; S.bounty = null; };
    const seen = new Set();
    for (let i = 0; i < 60; i++) {                       // rollBounty is random — sample until a depth one lands
      bClear();
      w.resolveInteract('P1', 'bounty');
      const b = bSrc();
      if (b) seen.add(b.desc);
    }
    const depthOffers = [...seen].filter((d) => /Delve to dungeon Depth/.test(d));
    const nums = depthOffers.map((d) => parseInt(d.match(/Depth (\d+)/)[1], 10));
    return {
      name: 'T7 depth bounty scales to the RESTORED depth (D1), not Depth 3',
      pass: p.maxDepth === 45 && nums.length > 0 && nums.every((n) => n === 48),
      info: { loadedMaxDepth: p.maxDepth, restoredDepthSeenByRollBounty: S.maxDepth, depthOffers, allOffers: [...seen] },
    };
  },
};

// ---------------------------------------------------------------- child entry
const argT = (process.argv.find((a) => a.startsWith('--t=')) || '').slice(4);
if (argT) {
  let r;
  try { r = TESTS[argT](); } catch (e) { r = { name: 'T' + argT, pass: false, info: { threw: String((e && e.stack) || e) } }; }
  process.stdout.write('\n__RESULT__' + JSON.stringify(r) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------- orchestrator
function run(t) {
  const out = cp.execFileSync(process.execPath, [SELF, '--t=' + t], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  const m = out.match(/__RESULT__(.*)/);
  if (!m) throw new Error('test ' + t + ' produced no result:\n' + out);
  return JSON.parse(m[1]);
}
const order = ['1a', '1b', '2', '3', '4', '5', '6', '7'];
const results = [];
for (const t of order) {
  let r; try { r = run(t); } catch (e) { r = { name: 'T' + t, pass: false, info: { spawnFailed: String(e.message).slice(0, 800) } }; }
  results.push(r);
  console.log(`\n${r.pass ? '  ✅ PASS' : '  ❌ FAIL'}  ${r.name}`);
  console.log('        ' + JSON.stringify(r.info, null, 2).split('\n').join('\n        '));
}
const scored = results.filter((r) => !/setup/.test(r.name));
const green = scored.every((r) => r.pass);
console.log('\n=== quest-pp-verify ===  ' + scored.filter((r) => r.pass).length + '/' + scored.length + ' passing');
console.log(green ? '  ✅ ALL GREEN\n' : '  ❌ FAILURES ABOVE\n');
process.exit(green ? 0 : 1);
