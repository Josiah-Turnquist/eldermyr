#!/usr/bin/env node
// Realms of Eldermyr — verification battery runner.
//
//   node tests/run-battery.mjs            run every suite
//   node tests/run-battery.mjs style uniq …   run only suites whose name matches an arg
//
// Each suite under tests/battery/ is a standalone Node script that drives the REAL game
// (server-spike/load-game.js + server/world.js) or the MP server headlessly, prints PASS/FAIL
// per assertion, and exits nonzero on any failure. This runner spawns each as a child process
// (per-suite 180s timeout), retries the known-flaky ones once, prints a summary table, and
// exits nonzero if any suite still fails after its retry.
//
// See tests/battery/MANIFEST.md for what each suite guards and why others were dropped.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BATTERY = join(HERE, 'battery');
const PER_SUITE_TIMEOUT_MS = 180_000;

// Order is cosmetic; grouped by system for readability. Deps (objclient/qclient/qrender/
// flat-loader) are NOT listed — they are required BY suites, never run directly.
const SUITES = [
  // load-and-orchestrate + server-boot invariants (ARCHITECTURE.md)
  'v1-timers', 'v2-inertness', 'v3-missing-captures', 'v4b-fullstack', 'v5-pg-timeout',
  // combat / style-identity / loot
  'style-verify', 'affix-verify', 'ranged-verify', 'combat-nerf-verify', 'uniques-verify', 'vtune-verify',
  // abilities / ultimate / dominate / balance fixes
  'verify-overlord-dominate', 'verify_fixes', 'verify-cleanup',
  // quests + personal-milestone flags (per-player) + the save-schema importer (rebuild S1)
  'quest-verify', 'quest-pp-verify', 'flags-pp-verify', 'sp-flags-check', 'migrate-roundtrip',
  // world systems: rifts, warband, camps, legion, dungeon vaults
  'rift-check', 'warband-delve', 'camp-seeker-verify', 'camp-exhaust-verify', 'fatigue-mp-verify', 'legion-mp-verify', 'vault-slot-verify',
  // pinnacle / great-beasts (v52)
  'pinnacle-verify', 'mp-pinnacle-verify', 'v52-verify', 'v52-beast-verify',
  // flat apex levels, directional facing, enlarged overworld
  'flat-levels-verify', 'facing-verify', 'facing-noregress', 'facing-mp-verify', 'map-enlarge-verify', 'map-mp-verify',
  // liberation/restore regression tiers
  't1-knockdown', 't2-liberation', 't3-restore', 't4-regression',
  // the hazards fold (rebuild P2/S3): hazard fns loop the world-scoped party themselves
  'hazards-mp-verify',
  // the onNewDay World/Hero split (rebuild P2/S4, #116): per-head tribute, party-level captains, party dragon gate
  'newday-mp-verify',
  // the enemy partition internalized (rebuild P2/S15): updateEnemies buckets by nearest hero in-sim,
  // full-roster state.enemies (inline liberation correct, __libGate retired), killer-credit discipline
  'enemies-mp-verify',
  // the projectile partition internalized (rebuild P2/S16): updateProjectiles buckets by shooter in-sim
  // (first-shot order, per-bucket owner pins incl. INVENTORY, parked-shots rule, bucket-order recombine)
  'projectiles-mp-verify',
];

// Documented pre-existing flakes (see MANIFEST.md) — retried ONCE before counting as a failure.
//   ranged-verify   ~1/12  (projectile spread RNG)
//   pinnacle-verify ~1/12  ("boss drifts home" positional race)
//   style-verify    ~7%    (Quarry Marks accrual timing)
const FLAKY = new Set(['ranged-verify', 'pinnacle-verify', 'style-verify', 'v4b-fullstack']);   // v4b: real server + wall-clock windows (boot deadline, 20 Hz rate band, ephemeral port) — timing-sensitive on a loaded machine, deterministic in substance

const argv = process.argv.slice(2);
const selected = argv.length ? SUITES.filter((s) => argv.some((a) => s.includes(a))) : SUITES;
if (!selected.length) { console.error('No suites match:', argv.join(' ')); process.exit(2); }

function runOnce(name) {
  const file = join(BATTERY, name + '.js');
  if (!existsSync(file)) return { ok: false, secs: 0, why: 'MISSING SCRIPT', tail: '' };
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [file], {
    cwd: BATTERY, timeout: PER_SUITE_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1 << 28,
  });
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const out = (r.stdout || '') + (r.stderr || '');
  let ok = r.status === 0 && !r.signal && !r.error;
  let why = '';
  if (r.error && r.error.code === 'ETIMEDOUT') why = `TIMEOUT >${PER_SUITE_TIMEOUT_MS / 1000}s`;
  else if (r.signal) why = 'killed by ' + r.signal;
  else if (r.error) why = String(r.error.message).split('\n')[0];
  else if (!ok) why = 'exit ' + r.status;
  const lines = out.trimEnd().split('\n');
  const tail = lines.slice(-24).join('\n');
  return { ok, secs, why, tail };
}

console.log(`\nEldermyr battery — ${selected.length} suite(s), per-suite timeout ${PER_SUITE_TIMEOUT_MS / 1000}s\n`);
const results = [];
const wallT0 = process.hrtime.bigint();
for (const name of selected) {
  process.stdout.write(`  running ${name} … `);
  let res = runOnce(name);
  let retried = false;
  if (!res.ok && FLAKY.has(name)) {
    retried = true;
    process.stdout.write(`FAIL (${res.secs.toFixed(1)}s) — flaky, retrying once … `);
    const r2 = runOnce(name);
    res = { ...r2, secs: res.secs + r2.secs };
  }
  console.log(res.ok ? `ok (${res.secs.toFixed(1)}s${retried ? ', on retry' : ''})` : `FAIL — ${res.why}`);
  if (!res.ok) console.log('    ┌ last output:\n' + res.tail.split('\n').map((l) => '    │ ' + l).join('\n') + '\n    └');
  results.push({ name, ...res, retried });
}
const wallSecs = Number(process.hrtime.bigint() - wallT0) / 1e9;

// Tidy the transient saves the per-player orchestrators write into tests/battery/.
for (const f of ['_flags_save.json', '_qpp_save.json']) {
  const p = join(BATTERY, f);
  if (existsSync(p)) try { unlinkSync(p); } catch { /* best effort */ }
}

const nameW = Math.max(...results.map((r) => r.name.length), 5);
const bar = '─'.repeat(nameW + 22);
console.log('\n' + bar);
console.log(`${'suite'.padEnd(nameW)}  ${'result'.padEnd(10)}  seconds`);
console.log(bar);
for (const r of results) {
  const verdict = r.ok ? (r.retried ? 'PASS (retry)' : 'PASS') : 'FAIL';
  console.log(`${r.name.padEnd(nameW)}  ${verdict.padEnd(10)}  ${r.secs.toFixed(1).padStart(6)}`);
}
console.log(bar);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed in ${wallSecs.toFixed(1)}s wall` +
  (failed.length ? `  —  FAILED: ${failed.map((r) => r.name).join(', ')}` : ''));
console.log(bar + '\n');
process.exit(failed.length ? 1 : 0);
