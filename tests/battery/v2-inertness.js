'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// V2 — inertness: require load-game + startGame, drive ~100 sim ticks over ~2 real seconds
// (mimicking loop()'s play-scene chain). Assert:
//   (a) no stray-timer exception surfaces;
//   (b) the game's eval-time/runtime autosave did NOT start (no localStorage SAVE_KEY writes,
//       AND — the real proof — no leaked long-lived interval: the process drains to
//       'beforeExit'. A leaked autosave/music setInterval would keep the loop alive forever).
const assert = require('assert');
const G = require('' + __RR + '/server-spike/load-game');

// Spy on the save path: the autosave interval, if it existed, calls saveGame()->SaveStore.set()
// ->localStorage.setItem(SAVE_KEY,...). Count any SAVE_KEY writes.
let saveWrites = 0;
const _set = global.localStorage.setItem.bind(global.localStorage);
global.localStorage.setItem = (k, v) => { if (String(k).includes('eldermyr_save') || String(k).includes('save')) saveWrites++; return _set(k, v); };

assert.ok(Array.isArray(G.__missingCaptures), '__missingCaptures must exist post-load');
G.startGame();

// Right after startGame, snapshot how many long-lived timers exist. floatDamage one-shots may
// appear transiently; a leaked autosave/music INTERVAL would be persistent.
const timersAfterStart = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

const UPDATES = ['updateTime', 'updatePlayer', 'updateEnemies', 'updateAllies', 'updateCompanions',
  'updateProjectiles', 'maybeSpawnWild', 'updateParticles', 'updateFires', 'updateWeather',
  'updateEvents', 'updateFactionWar', 'updateWarband', 'updateFatigue', 'updateNemesisPresence',
  'updateWorldLine', 'updateMusicMood', 'updateAmbience'];

let ticks = 0, threw = null;
function oneTick() {
  try { for (const u of UPDATES) { if (typeof G[u] === 'function') G[u](); } }
  catch (e) { threw = e; }
  ticks++;
  if (ticks < 100 && !threw) setTimeout(oneTick, 20); else done();
}
setTimeout(oneTick, 20);

let finished = false;
function done() {
  if (finished) return; finished = true;
  const timersNow = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  console.log(JSON.stringify({ ticks, threw: threw ? String(threw && threw.stack || threw) : null,
    saveWritesDuringRun: saveWrites, longLivedTimersAfterStart: timersAfterStart, timersRightAfterTicks: timersNow,
    missingCaptures: G.__missingCaptures }, null, 2));
  assert.strictEqual(threw, null, 'no stray-timer / update exception may surface');
  assert.strictEqual(saveWrites, 0, 'autosave must NOT have fired (no SAVE_KEY writes)');
  // Prove no leaked interval by draining to beforeExit. Watchdog is unref'd: if the loop
  // is clean it never fires (process exits, beforeExit prints PASS); if an interval leaked,
  // the loop stays alive and the watchdog trips FAIL.
  const wd = setTimeout(() => {
    const t = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    console.error('V2 FAIL — process did not drain; leaked long-lived timer(s). Active Timeouts:', t);
    process.exit(1);
  }, 6000);
  wd.unref();
}
process.on('beforeExit', () => {
  console.log('V2 PASS — event loop drained to beforeExit: no leaked autosave/music interval; no exceptions; no autosave writes.');
});
