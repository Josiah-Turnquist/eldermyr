#!/usr/bin/env node
/*
 * harness.mjs — golden-master determinism harness for the game artifact
 * (default: dist/eldermyr.html — the single source since the P1 wrap).
 * ============================================================================
 * WHY: the rebuild splits the single-file game into modules. This harness
 * records state-hash trajectories from the pre-split engine; every refactor
 * step must reproduce them byte-for-byte. It is the regression oracle.
 *
 * HOW (worker mode, `run`): BEFORE the game is loaded we (1) replace Math.random
 * with a seeded mulberry32 and (2) freeze the wall clock to a fixed epoch that
 * ticks 16.666 ms/frame. Then we load the game EXACTLY like server/world.js does
 * — through server/load-game.js — and drive the captured update functions
 * (the body of the game's own loop()) by hand, injecting scripted per-tick input.
 * Every 100 ticks we sha256 a stable serialization of the sim state.
 *
 * HOW (orchestrator: `record` / `check` / `prove`): the loaded game is a PROCESS
 * SINGLETON (load-game caches on global.__game; world state is module-global), so
 * every (scenario, seed) run gets its OWN child process — `node harness.mjs run
 * <scenario> <seed>`. Same-process reloads would share state and are invalid.
 *
 * HOW (2-player `world` kind — rebuild P2/S2): a scenario with kind:'world'
 * makes the worker seed + freeze exactly as above but then require
 * server/world.js (which boots the game through the same loader), addPlayer
 * A/B, script each hero's held keys/actions per tick (self-test style,
 * world.js's own bottom block), and drive w.tick(). The hash root is still
 * {state, maps} — the World's room fields (feed/_errAt/perf EMAs) live on
 * `this`, off-state, and are deliberately outside the oracle. These baselines
 * (oracle-mp.json) freeze the ORCHESTRATION machinery the P2 ladder rewrote;
 * through the ladder they were re-recorded consciously per slice, while
 * oracle.json stayed byte-untouched. At P2 close (plan §7 S16) BOTH oracles
 * were re-recorded in one PAIRED operation as the serializer's REMAP overlay
 * was deleted: same engine state, old view reproduced the old oracles first,
 * then the native player-keyed shape was recorded. Post-P2, both oracles hash
 * the NATIVE shape; any future re-record is a conscious behavior change.
 *
 * Usage:
 *   node harness.mjs run <scenario> <seed> [--perturb speed|damage|hunt]  (worker, both kinds)
 *   node harness.mjs record [--out oracle.json]                       (write 1p oracle)
 *   node harness.mjs check  [--oracle oracle.json]                    (verify tree, 1p)
 *   node harness.mjs prove                                            (1p proofs a/b/c)
 *   node harness.mjs mp-record [--out oracle-mp.json]                 (write 2p oracle)
 *   node harness.mjs mp-check  [--oracle oracle-mp.json]              (verify tree, 2p)
 *   node harness.mjs mp-prove                                         (2p proofs a/b/c)
 */
'use strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { mulberry32, seedFrom } from './prng.mjs';
import { hashState } from './serialize.mjs';
import { SCENARIOS, SCENARIO_IDS, MP_SCENARIOS, MP_SCENARIO_IDS } from './scenarios/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = fileURLToPath(import.meta.url);
const LOAD_GAME = path.resolve(__dirname, '../../server/load-game.js');
const WORLD_JS = path.resolve(__dirname, '../../server/world.js');
const ORACLE = path.resolve(__dirname, 'oracle.json');
const ORACLE_MP = path.resolve(__dirname, 'oracle-mp.json');
const RESULT_TAG = '__GOLDEN_RESULT__';

// Canonical seeds recorded into the oracle. Two per scenario so seed-variance is
// provable straight from the oracle. PRIMARY is the one the proofs use.
const SEED_PRIMARY = 1337;
const SEED_ALT = 98765;
const SAMPLE_EVERY = 100; // hash cadence (ticks)
const FIXED_EPOCH = 1_700_000_000_000; // frozen wall clock (ms)
const FRAME_MS = 1000 / 60; // 16.666… ms/tick

// ---------------------------------------------------------------------------
// clock: freeze Date.now / performance.now to a fixed epoch that advances one
// frame per tick. VERIFIED: every Date.now() in the game is render-only (draw*,
// minimap, banners) and no sim update reads it — but we freeze it anyway so the
// oracle stays valid even if a refactor moves a clock read into the sim path.
// (grep found 0 performance.now / new Date; they are stubbed defensively.)
// ---------------------------------------------------------------------------
let _clockMs = FIXED_EPOCH;
function installClock() {
  Date.now = () => Math.floor(_clockMs);
  const OrigDate = Date;
  // new Date() with no args -> the frozen epoch; explicit args pass through.
  const FrozenDate = new Proxy(OrigDate, {
    construct(target, args) { return args.length ? new target(...args) : new target(Math.floor(_clockMs)); },
    apply() { return new OrigDate(Math.floor(_clockMs)).toString(); },
  });
  globalThis.Date = FrozenDate;
  if (globalThis.performance) globalThis.performance.now = () => _clockMs - FIXED_EPOCH;
}
function advanceClock() { _clockMs += FRAME_MS; }

// ---------------------------------------------------------------------------
// stepSim: the body of the game's own loop() update block, in order. Rendering
// (updateCamera/renderWorld/…) and the uncapturable `hitStop` frame-freeze are
// omitted: the golden master drives the SIM, and the oracle is defined by THIS
// call order (a refactor must reproduce it, not real-time play).
// ---------------------------------------------------------------------------
const UPDATE_ORDER = [
  'updateTime', 'updatePlayer', 'updateEnemies', 'updateAllies', 'updateCompanions',
  'updateProjectiles', 'maybeSpawnWild', 'maybePinnacleBosses', 'updateParticles',
  'updateFires', 'updateWeather', 'updateEvents', 'updateFactionWar', 'updateWarband',
  'updateFatigue', 'updateNemesisPresence', 'updateWorldLine', 'updateMusicMood', 'updateAmbience',
];
function stepSim(G) {
  if (G.state.scene !== 'play') return; // mirror loop()'s scene gate
  for (const fn of UPDATE_ORDER) {
    const f = G[fn];
    if (typeof f === 'function') f();
  }
}

// The hash root: the whole sim state PLUS the tile grids (worldgen output +
// dungeon floors live in G.maps, not G.state). A pure module split changes
// neither, so including maps adds worldgen/floor-gen regression coverage with
// no false-positive risk.
function hashRoot(G) {
  return hashState({ state: G.state, maps: G.maps });
}

// Negative-control perturbations — runtime monkey-patching ONLY, and NECESSARILY
// through the shared `state` reference, never by wrapping a captured function.
// (Verified: wrapping G.afxHit does NOT intercept the game's internal
// `e.hp -= afxHit(e,dmg)` — game code calls it by LEXICAL name, the codebase's
// documented capture gotcha. So a fn-wrap control is dead; state is the seam.)
//   speed  — scale player.speed ×1.01 (a base stat recalcStats never rewrites):
//            biases every movement frame -> position -> targeting. Propagates to
//            WORLD state even at 1% (the enemy roster the hero reaches differs).
//            This is the spec's literal example.
//   damage — scale the equipped weapon's atk, then re-derive via the captured
//            recalcStats (a pure fn of shared state, so calling it directly is
//            fine). FINDING: melee near the safe spawn Vale is coarse-grained —
//            a small buff (×1.5) diverges the hash only via the stored atk (the
//            player/inventory slice), the enemy roster reconverging by t=3000; a
//            large buff shifts kill timing enough to also diverge the WORLD. We
//            use ×8 so the control demonstrates deep propagation, not just that
//            a constant is hashed (speed already covers the tiny-nudge case).
//   hunt   — the day-rollover control: scale the GREAT_HUNTS table's base hp/atk
//            via the captured TABLE OBJECT (mutating the shared object DOES reach
//            the game's lexical reads; only reassignment is dead). The table is
//            OUTSIDE the hash root {state, maps}, so clean/perturbed runs stay
//            byte-identical until onNewDay→maybeRespawnHunts consumes it at the
//            first day boundary — a divergence can ONLY have flowed through the
//            boundary path, which is exactly what it is meant to prove.
function applyPerturb(G, kind) {
  if (kind === 'speed') {
    G.state.player.speed *= 1.01;
  } else if (kind === 'damage') {
    const w = G.equippedWeapon ? G.equippedWeapon() : (G.state.inventory.weapons.find((x) => x.equipped));
    if (!w) throw new Error('no equipped weapon to perturb');
    w.atk = (w.atk || 0) * 8;
    try { G.recalcStats(); } catch (_e) {}
  } else if (kind === 'hunt') {
    if (!Array.isArray(G.GREAT_HUNTS) || !G.GREAT_HUNTS.length) throw new Error('GREAT_HUNTS not captured');
    for (const h of G.GREAT_HUNTS) { h.hp = Math.round(h.hp * 1.5); h.atk = Math.round(h.atk * 1.5); }
  } else {
    throw new Error('unknown perturb: ' + kind);
  }
}

// World-rig negative controls (2p). Same seam rule as applyPerturb: mutate
// SHARED STATE the game/World read live, never wrap a captured function.
//   speed — scale hero A's speed ×1.01 (post-addPlayer, pre-setup): biases A's
//           every movement frame -> positions -> enemy partition -> world.
//           The spec's literal example, applied to ONE hero of two.
//   hunt  — identical to the 1p control (GREAT_HUNTS table object, OUTSIDE the
//           hash root): invisible until onNewDay→maybeRespawnHunts consumes it
//           at the day boundary. mp-day-rollover's setup removes every Great
//           Beast BEFORE tick 1, which also keeps the World's _rescaleThreats
//           pass off the table — so a divergence can only be the boundary path.
function applyWorldPerturb(G, players, kind) {
  if (kind === 'speed') { players[0].speed *= 1.01; return; }
  if (kind === 'hunt') { applyPerturb(G, 'hunt'); return; }
  throw new Error('unknown world perturb: ' + kind);
}

// A tiny gameplay-meaningful summary, so proofs can show a perturbation
// PROPAGATED into the simulation (different kills/level/gold), not merely that a
// constant is hashed.
function summarize(G) {
  const S = G.state, p = S.player;
  let ehp = 0; for (const e of S.enemies) ehp += (e.hp || 0);
  return {
    level: p.level, hp: Math.round(p.hp), gold: p.gold, xp: p.xp,
    px: Math.round(p.x), py: Math.round(p.y),
    kills: (((p.quests || S.quests) || {}).slay || {}).count | 0,   // player-first since P2/S13 (root fallback keeps this summary honest on pre-move engines)
    maxDepth: (p.maxDepth !== undefined ? p.maxDepth : S.maxDepth) | 0, map: S.map, enemies: S.enemies.length, // player-first since P2/S12 (root fallback keeps this summary honest on pre-move engines)
    enemyHp: Math.round(ehp), scene: S.scene,
    day: (typeof G.curDay === 'function') ? G.curDay() : null,
    huntCycle: S.huntCycle | 0, beasts: S.enemies.filter((e) => e && e.isGreatBeast).length,
  };
}

// ---------------------------------------------------------------------------
// WORKER: seed, load, run one scenario, emit the hash trajectory. Runs in its
// own process (see orchestrator). Everything before require(LOAD_GAME) is the
// pre-load neutralization the spec demands.
// ---------------------------------------------------------------------------
function runScenarioInProcess(scenarioId, seedRaw, opts = {}) {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) throw new Error('unknown scenario: ' + scenarioId);
  const seed = seedFrom(seedRaw);

  // (1) seed RNG and (2) freeze the clock — BEFORE any game code is evaluated.
  Math.random = mulberry32(seed);
  installClock();

  // (3) load the game headlessly, the same path server/world.js uses.
  const require = createRequire(import.meta.url);
  const G = require(LOAD_GAME);

  // (4) boot the world (worldgen runs here, under the seeded RNG).
  G.startGame();

  // (5) optional negative-control perturbation (post-load, captured refs only).
  if (opts.perturb) applyPerturb(G, opts.perturb);

  // (6) drive the scenario.
  if (scenario.setup) scenario.setup(G);
  const N = scenario.ticks;
  const hashes = [hashRoot(G)]; // sample at ticksRun = 0 (post-worldgen initial)
  for (let t = 0; t < N; t++) {
    if (G.state.scene === 'play' && scenario.preTick) scenario.preTick(G, t);
    stepSim(G);
    if (G.state.scene === 'play' && scenario.postTick) scenario.postTick(G, t);
    advanceClock();
    if ((t + 1) % SAMPLE_EVERY === 0) hashes.push(hashRoot(G));
  }

  const distinct = new Set(hashes).size;
  return {
    scenario: scenarioId, seed, ticks: N, sampleEvery: SAMPLE_EVERY,
    perturb: opts.perturb || null, hashes, distinct, summary: summarize(G),
    finalScene: G.state.scene, missingCaptures: (G.__missingCaptures || []),
  };
}

// Per-hero flavor of summarize() for the world rig (propagation must be
// visible PER PLAYER: kills read each hero's own quest slice, not S.quests).
function summarizeWorld(G, players) {
  const S = G.state;
  let ehp = 0; for (const e of S.enemies) ehp += (e.hp || 0);
  return {
    players: players.map((p) => ({
      id: p.id, level: p.level, hp: Math.round(p.hp), gold: p.gold, xp: p.xp,
      px: Math.round(p.x), py: Math.round(p.y),
      kills: (p.quests && p.quests.slay && p.quests.slay.count) | 0, downed: !!p.downed,
    })),
    enemies: S.enemies.length, enemyHp: Math.round(ehp), scene: S.scene,
    day: (typeof G.curDay === 'function') ? G.curDay() : null,
    huntCycle: S.huntCycle | 0, beasts: S.enemies.filter((e) => e && e.isGreatBeast).length,
  };
}

// ---------------------------------------------------------------------------
// WORKER (kind 'world', rebuild P2/S2): seed + freeze, then require
// server/world.js — its module body loads the game headlessly AND runs
// startGame() (worldgen draws from the seeded stream), so the pre-load
// neutralization must come first, exactly like the 1p worker. The scenario
// scripts p.held/p.actions (the self-test idiom); the World consumes them.
// ---------------------------------------------------------------------------
function runWorldScenarioInProcess(scenarioId, seedRaw, opts = {}) {
  const scenario = MP_SCENARIOS[scenarioId];
  if (!scenario) throw new Error('unknown world scenario: ' + scenarioId);
  const seed = seedFrom(seedRaw);

  // (0) pin HZ before world.js is evaluated: it sizes the downed/revive frame
  // constants from process.env.HZ (default 80). An ambient HZ override would
  // silently skew p.bleedSecs-class values and fork the oracle.
  process.env.HZ = '80';

  // (1) seed RNG and (2) freeze the clock — BEFORE any game/server code runs.
  Math.random = mulberry32(seed);
  installClock();

  // (3) load the World (which loads the game through the same loader; the
  // require cache makes G below the exact module instance world.js uses).
  const require = createRequire(import.meta.url);
  const { World } = require(WORLD_JS);
  const G = require(LOAD_GAME);

  // (4) boot the room and join the scripted party, in JOIN ORDER (the
  // determinism contract: converted loops iterate state.players in this order).
  const w = new World();
  const players = scenario.players.map((d) => w.addPlayer(d.id, d.name));

  // (5) optional negative-control perturbation (post-join, shared-state seam).
  if (opts.perturb) applyWorldPerturb(G, players, opts.perturb);

  // (6) drive the scenario through the World's own authoritative tick.
  const ctx = { G, w, players };
  if (scenario.setup) scenario.setup(ctx);
  const N = scenario.ticks;
  const hashes = [hashRoot(G)]; // sample at ticksRun = 0 (post-join initial)
  for (let t = 0; t < N; t++) {
    if (scenario.preTick) scenario.preTick(ctx, t);
    w.tick();
    if (scenario.postTick) scenario.postTick(ctx, t);
    advanceClock();
    if ((t + 1) % SAMPLE_EVERY === 0) hashes.push(hashRoot(G));
  }

  const distinct = new Set(hashes).size;
  return {
    scenario: scenarioId, seed, ticks: N, sampleEvery: SAMPLE_EVERY,
    perturb: opts.perturb || null, hashes, distinct, summary: summarizeWorld(G, players),
    finalScene: G.state.scene, missingCaptures: (G.__missingCaptures || []),
  };
}

// ---------------------------------------------------------------------------
// ORCHESTRATOR helpers: spawn a fresh child per run, parse its tagged result.
// ---------------------------------------------------------------------------
function spawnRun(scenarioId, seed, opts = {}) {
  const args = [HARNESS, 'run', scenarioId, String(seed)];
  if (opts.perturb) args.push('--perturb', opts.perturb);
  const t0 = Date.now();
  // env: explicit inherit so ELDERMYR_GAME_FILE (and the CWD it resolves against)
  // reaches every child — the child's load-game.js is what actually honors it.
  const res = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env });
  const ms = Date.now() - t0;
  if (res.status !== 0) {
    throw new Error(`child failed (${scenarioId}/${seed}) status=${res.status}\nSTDERR:\n${res.stderr}\nSTDOUT:\n${res.stdout}`);
  }
  const line = res.stdout.split('\n').find((l) => l.startsWith(RESULT_TAG));
  if (!line) throw new Error(`no result from child (${scenarioId}/${seed})\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`);
  const out = JSON.parse(line.slice(RESULT_TAG.length));
  out._ms = ms;
  return out;
}

function firstDivergence(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { sampleIndex: i, tick: i * SAMPLE_EVERY };
  }
  return null;
}

// ---------------------------------------------------------------------------
// COMMANDS
// ---------------------------------------------------------------------------
function cmdRecord(outPath, ids = SCENARIO_IDS, reg = SCENARIOS, note = 'state-hash trajectories; see README.md') {
  // Provenance is the GAME VERSION the oracle was recorded from (not a wall-clock
  // stamp — that would make the file non-deterministic across identical re-records).
  const oracle = { _meta: { game: gameVersion(), sampleEvery: SAMPLE_EVERY, ticks: reg[ids[0]].ticks, seeds: { primary: SEED_PRIMARY, alt: SEED_ALT }, note }, scenarios: {} };
  for (const id of ids) {
    oracle.scenarios[id] = {};
    for (const seed of [SEED_PRIMARY, SEED_ALT]) {
      const r = spawnRun(id, seed);
      oracle.scenarios[id][seed] = r.hashes;
      console.log(`recorded ${id} seed=${seed}: ${r.hashes.length} samples, ${r.distinct} distinct, finalScene=${r.finalScene}, ${r._ms}ms`);
    }
  }
  fs.writeFileSync(outPath, JSON.stringify(oracle, null, 2) + '\n');
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\nwrote ${outPath} (${kb} KB)`);
}

function cmdCheck(oraclePath) {
  const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
  let failures = 0, checks = 0;
  for (const id of Object.keys(oracle.scenarios)) {
    for (const seed of Object.keys(oracle.scenarios[id])) {
      checks++;
      const expected = oracle.scenarios[id][seed];
      const r = spawnRun(id, Number(seed));
      const div = firstDivergence(expected, r.hashes);
      if (div) {
        failures++;
        console.log(`FAIL ${id} seed=${seed}: FIRST divergence at tick ${div.tick} (sample ${div.sampleIndex})`);
        console.log(`     expected ${expected[div.sampleIndex]}`);
        console.log(`     actual   ${r.hashes[div.sampleIndex]}`);
      } else {
        console.log(`ok   ${id} seed=${seed}: ${r.hashes.length} samples identical (${r._ms}ms)`);
      }
    }
  }
  console.log(`\n${checks - failures}/${checks} trajectories reproduced.`);
  if (failures) { console.log('DIVERGENCE — the tree no longer matches the oracle. If this is an intentional balance change, re-record consciously (see README).'); process.exit(1); }
}

function cmdProve() {
  console.log('=== GOLDEN-MASTER ACCEPTANCE PROOFS ===\n');
  let allGood = true;

  // (a) Determinism across SEPARATE OS processes.
  console.log('(a) DETERMINISM — two separate child processes, same seed, byte-identical streams:');
  for (const id of SCENARIO_IDS) {
    const r1 = spawnRun(id, SEED_PRIMARY);
    const r2 = spawnRun(id, SEED_PRIMARY);
    const identical = r1.hashes.length === r2.hashes.length && r1.hashes.every((h, i) => h === r2.hashes[i]);
    allGood = allGood && identical;
    console.log(`    ${identical ? 'PASS' : 'FAIL'} ${id}: ${r1.hashes.length} samples, ${r1.distinct} distinct, procs ${r1._ms}ms/${r2._ms}ms ${identical ? '(identical)' : '(DIVERGED)'}`);
    if (!identical) { const d = firstDivergence(r1.hashes, r2.hashes); console.log(`         first diff at tick ${d.tick}`); }
  }

  // (b) Sensitivity — negative control: perturb a gameplay constant at runtime.
  console.log('\n(b) SENSITIVITY — perturb a gameplay constant post-load (via captured state), expect fast divergence + gameplay propagation:');
  {
    const id = 'overworld-combat';
    const clean = spawnRun(id, SEED_PRIMARY);
    for (const kind of ['speed', 'damage']) {
      const dirty = spawnRun(id, SEED_PRIMARY, { perturb: kind });
      const div = firstDivergence(clean.hashes, dirty.hashes);
      // Propagation: it must NOT be a lone sample-0 byte flip that re-converges —
      // every later sample must differ too (the change cascades through the sim).
      const cascades = clean.hashes.every((h, i) => h !== dirty.hashes[i]);
      const ok = !!div && div.tick <= 800 && cascades;
      allGood = allGood && ok;
      const c = clean.summary, d = dirty.summary;
      console.log(`    ${ok ? 'PASS' : 'FAIL'} ${id} +${kind}: first divergence tick ${div ? div.tick : 'NEVER'}, cascades=${cascades} (all ${clean.hashes.length} samples differ)`);
      console.log(`         propagation → clean{pos ${c.px},${c.py} hp ${c.hp} enemies ${c.enemies}@${c.enemyHp}hp} vs ${kind}{pos ${d.px},${d.py} hp ${d.hp} enemies ${d.enemies}@${d.enemyHp}hp}`);
    }
  }
  // (b2) onNewDay-path control: the GREAT_HUNTS table sits OUTSIDE the hash root,
  // so its perturbation is INVISIBLE until onNewDay→maybeRespawnHunts consumes it
  // at the day-1→2 boundary (during tick 699). Pre-boundary samples must be
  // IDENTICAL and the first divergent sample must be EXACTLY tick 700 — that pins
  // the divergence to the boundary path and nothing else.
  {
    const id = 'day-rollover';
    const clean = spawnRun(id, SEED_PRIMARY);
    const dirty = spawnRun(id, SEED_PRIMARY, { perturb: 'hunt' });
    const div = firstDivergence(clean.hashes, dirty.hashes);
    const ok = !!div && div.tick === 700;
    allGood = allGood && ok;
    const c = clean.summary, d = dirty.summary;
    console.log(`    ${ok ? 'PASS' : 'FAIL'} ${id} +hunt (GREAT_HUNTS hp/atk ×1.5 — table is outside the hash root): first divergence tick ${div ? div.tick : 'NEVER'} (expected exactly 700: onNewDay fires during tick 699; samples 0–6 pre-boundary ${div && div.tick >= 700 ? 'identical' : 'DIFFER — leak!'})`);
    console.log(`         boundary did real work → day ${c.day} (2 crossings), huntCycle ${c.huntCycle}, ${c.beasts} beasts respawned; world enemyHp clean ${c.enemyHp} vs perturbed ${d.enemyHp}`);
  }

  // (c) Seed variance.
  console.log('\n(c) SEED VARIANCE — a different seed yields a different trajectory:');
  for (const id of SCENARIO_IDS) {
    const a = spawnRun(id, SEED_PRIMARY);
    const b = spawnRun(id, SEED_ALT);
    const div = firstDivergence(a.hashes, b.hashes);
    const ok = !!div;
    allGood = allGood && ok;
    console.log(`    ${ok ? 'PASS' : 'FAIL'} ${id}: seeds ${SEED_PRIMARY} vs ${SEED_ALT} ${div ? 'differ from tick ' + div.tick : 'IDENTICAL — seeding is not taking effect!'}`);
  }

  console.log('\n' + (allGood ? 'ALL PROOFS PASS ✅' : 'SOME PROOFS FAILED ❌'));
  process.exit(allGood ? 0 : 1);
}

// 2-player (world-kind) acceptance proofs — rebuild P2/S2. Mirrors cmdProve:
// (a) cross-process determinism, (b) sensitivity via the speed perturb on hero
// A (the plan's named control) + the day-boundary 'hunt' control on the
// rollover analogue (pins divergence to EXACTLY tick 700, the SP b2 pattern),
// (c) seed variance. (b) is the "perturb-fails" gate: a baseline that a real
// value change cannot move would be worse than none.
function cmdMpProve() {
  console.log('=== MP (2-PLAYER WORLD) GOLDEN PROOFS ===\n');
  let allGood = true;

  console.log('(a) DETERMINISM — two separate child processes, same seed, byte-identical streams:');
  for (const id of MP_SCENARIO_IDS) {
    const r1 = spawnRun(id, SEED_PRIMARY);
    const r2 = spawnRun(id, SEED_PRIMARY);
    const identical = r1.hashes.length === r2.hashes.length && r1.hashes.every((h, i) => h === r2.hashes[i]);
    allGood = allGood && identical;
    console.log(`    ${identical ? 'PASS' : 'FAIL'} ${id}: ${r1.hashes.length} samples, ${r1.distinct} distinct, procs ${r1._ms}ms/${r2._ms}ms ${identical ? '(identical)' : '(DIVERGED)'}`);
    if (!identical) { const d = firstDivergence(r1.hashes, r2.hashes); console.log(`         first diff at tick ${d.tick}`); }
  }

  console.log('\n(b) SENSITIVITY — perturb hero A\'s speed ×1.01 post-join, expect fast divergence + per-hero propagation:');
  for (const id of MP_SCENARIO_IDS) {
    const clean = spawnRun(id, SEED_PRIMARY);
    const dirty = spawnRun(id, SEED_PRIMARY, { perturb: 'speed' });
    const div = firstDivergence(clean.hashes, dirty.hashes);
    // A.speed is inside the hash root → sample 0 must already differ, and the
    // bias must CASCADE (every later sample differs too — the change reaches
    // positions, buckets, the world; it cannot re-converge).
    const cascades = clean.hashes.every((h, i) => h !== dirty.hashes[i]);
    const ok = !!div && div.tick <= 800 && cascades;
    allGood = allGood && ok;
    const cA = clean.summary.players[0], dA = dirty.summary.players[0];
    const cB = clean.summary.players[1], dB = dirty.summary.players[1];
    console.log(`    ${ok ? 'PASS' : 'FAIL'} ${id} +speed(A): first divergence tick ${div ? div.tick : 'NEVER'}, cascades=${cascades} (all ${clean.hashes.length} samples differ)`);
    console.log(`         propagation → A clean{pos ${cA.px},${cA.py} xp ${cA.xp} kills ${cA.kills}} vs dirty{pos ${dA.px},${dA.py} xp ${dA.xp} kills ${dA.kills}}; B clean{pos ${cB.px},${cB.py}} vs dirty{pos ${dB.px},${dB.py}}`);
  }
  // (b2) boundary-path control on the rollover analogue: the GREAT_HUNTS table
  // sits OUTSIDE the hash root and (with the beasts removed in setup) nothing
  // reads it before onNewDay→maybeRespawnHunts at the day-1→2 crossing during
  // tick 699 — so pre-boundary samples must be IDENTICAL and the first
  // divergent sample must be EXACTLY tick 700.
  {
    const id = 'mp-day-rollover';
    const clean = spawnRun(id, SEED_PRIMARY);
    const dirty = spawnRun(id, SEED_PRIMARY, { perturb: 'hunt' });
    const div = firstDivergence(clean.hashes, dirty.hashes);
    const ok = !!div && div.tick === 700;
    allGood = allGood && ok;
    const c = clean.summary, d = dirty.summary;
    console.log(`    ${ok ? 'PASS' : 'FAIL'} ${id} +hunt (table outside the hash root): first divergence tick ${div ? div.tick : 'NEVER'} (expected exactly 700; samples 0–6 pre-boundary ${div && div.tick >= 700 ? 'identical' : 'DIFFER — leak!'})`);
    console.log(`         boundary did real work → day ${c.day}, huntCycle ${c.huntCycle}, ${c.beasts} beasts respawned; world enemyHp clean ${c.enemyHp} vs perturbed ${d.enemyHp}`);
  }

  console.log('\n(c) SEED VARIANCE — a different seed yields a different trajectory:');
  for (const id of MP_SCENARIO_IDS) {
    const a = spawnRun(id, SEED_PRIMARY);
    const b = spawnRun(id, SEED_ALT);
    const div = firstDivergence(a.hashes, b.hashes);
    const ok = !!div;
    allGood = allGood && ok;
    console.log(`    ${ok ? 'PASS' : 'FAIL'} ${id}: seeds ${SEED_PRIMARY} vs ${SEED_ALT} ${div ? 'differ from tick ' + div.tick : 'IDENTICAL — seeding is not taking effect!'}`);
  }

  console.log('\n' + (allGood ? 'ALL MP PROOFS PASS ✅' : 'SOME MP PROOFS FAILED ❌'));
  process.exit(allGood ? 0 : 1);
}

// The game file under test. ELDERMYR_GAME_FILE (absolute, or relative to the CWD —
// the SAME semantics as server/load-game.js's override) points the whole
// harness at another artifact. Default (P1 wrap): the built dist/eldermyr.html,
// repo-root-resolved — the single source; the frozen monolith is deleted (v2-final tag).
// The actual game LOAD honors the same chain inside load-game.js (in each child
// process — the env rides spawnRun's inherited environment); this resolver is for the
// harness's own direct read (version stamp).
function gameFilePath() {
  return process.env.ELDERMYR_GAME_FILE
    ? path.resolve(process.env.ELDERMYR_GAME_FILE)
    : path.resolve(__dirname, '../../dist/eldermyr.html');
}

function gameVersion() {
  try {
    const html = fs.readFileSync(gameFilePath(), 'utf8');
    const m = html.match(/GAME_VERSION\s*=\s*'([^']+)'/);
    return m ? m[1] : 'unknown';
  } catch (_e) { return 'unknown'; }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'run') {
    const [scenarioId, seed] = rest;
    const pIdx = rest.indexOf('--perturb');
    const opts = pIdx >= 0 ? { perturb: rest[pIdx + 1] } : {};
    const result = MP_SCENARIOS[scenarioId]
      ? runWorldScenarioInProcess(scenarioId, Number(seed), opts)   // kind 'world' (2p) — rebuild P2/S2
      : runScenarioInProcess(scenarioId, Number(seed), opts);
    process.stdout.write(RESULT_TAG + JSON.stringify(result) + '\n');
    return;
  }
  if (cmd === 'record') {
    const oIdx = rest.indexOf('--out');
    cmdRecord(oIdx >= 0 ? path.resolve(rest[oIdx + 1]) : ORACLE);
    return;
  }
  if (cmd === 'check') {
    const oIdx = rest.indexOf('--oracle');
    cmdCheck(oIdx >= 0 ? path.resolve(rest[oIdx + 1]) : ORACLE);
    return;
  }
  if (cmd === 'prove') { cmdProve(); return; }
  if (cmd === 'mp-record') {
    const oIdx = rest.indexOf('--out');
    cmdRecord(oIdx >= 0 ? path.resolve(rest[oIdx + 1]) : ORACLE_MP, MP_SCENARIO_IDS, MP_SCENARIOS,
      '2-player world-kind state-hash trajectories (server/world.js tick); re-recorded consciously per P2 slice — see README.md');
    return;
  }
  if (cmd === 'mp-check') {
    const oIdx = rest.indexOf('--oracle');
    cmdCheck(oIdx >= 0 ? path.resolve(rest[oIdx + 1]) : ORACLE_MP);   // cmdCheck iterates the oracle file's own keys — reused as-is
    return;
  }
  if (cmd === 'mp-prove') { cmdMpProve(); return; }
  console.log('usage: node harness.mjs <run|record|check|prove|mp-record|mp-check|mp-prove> ...');
  console.log('  1p scenarios:', SCENARIO_IDS.join(', '));
  console.log('  2p scenarios:', MP_SCENARIO_IDS.join(', '));
  process.exit(2);
}

main();
