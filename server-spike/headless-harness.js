/*
 * headless-harness.js — SERVER-AUTHORITATIVE FEASIBILITY SPIKE
 * -----------------------------------------------------------------------------
 * Question this answers: can Eldermyr's *simulation* run under Node with no
 * browser, so an authoritative server can own the world in RAM and tick it?
 *
 * Strategy: stub the entire browser environment (DOM, <canvas>/2d ctx, Web
 * Audio, localStorage, rAF, timers), then load the REAL game code straight out
 * of ../eldermyr-rpg.html (so this always tests the live game, never a copy),
 * boot it with startGame(), and drive the sim block from the game's own loop()
 * (eldermyr-rpg.html:1848) for thousands of ticks — including a real combat
 * scenario through killEnemy(), the most DOM-welded hot path.
 *
 * Touches nothing in the shipping game. Run: node server-spike/headless-harness.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. BROWSER ENVIRONMENT STUBS
// ============================================================================
const noop = () => {};

// A recursive, callable Proxy: any property read returns another ghost (so deep
// chains like a.b.c.d() never throw), calling it returns a ghost, and any write
// is silently accepted. This absorbs the ~1200 ctx.* draw calls and the Web
// Audio graph without us hand-listing every method.
function ghost() {
  const f = function () { return ghost(); };
  return new Proxy(f, {
    get(t, p) {
      // A few reads must yield primitives so arithmetic/branches behave:
      if (p === 'value' || p === 'width' || p === 'height' || p === 'length' ||
          p === 'currentTime' || p === 'offsetWidth' || p === 'offsetHeight' ||
          p === 'clientWidth' || p === 'clientHeight' || p === 'sampleRate') return 0;
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;            // don't look thenable
      return ghost();
    },
    set() { return true; },
    apply() { return ghost(); },
  });
}

const RECT = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, x: 0, y: 0 };

function fakeCtx() {
  const real = {
    canvas: { width: 1280, height: 720 },
    measureText: () => ({ width: 8 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({}),
  };
  return new Proxy(real, { get(t, p) { return p in t ? t[p] : ghost(); }, set() { return true; } });
}

function fakeEl(tag) {
  const real = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, dataset: {}, className: '', id: '', textContent: '', innerHTML: '', value: '',
    width: 1280, height: 720,
    getContext: () => fakeCtx(),
    getBoundingClientRect: () => RECT,
    addEventListener: noop, removeEventListener: noop,
    appendChild: (c) => c, removeChild: noop, remove: noop, insertBefore: (c) => c,
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    querySelector: () => fakeEl(), querySelectorAll: () => [],
    focus: noop, blur: noop, click: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    getContextAttributes: () => ({}),
  };
  return new Proxy(real, {
    get(t, p) { return p in t ? t[p] : ghost(); },
    set(t, p, v) { t[p] = v; return true; },
  });
}

// Some globals (navigator, performance, location) are read-only getters in
// Node 22 — assign via a helper that falls back to defineProperty.
function setG(name, val) {
  try { global[name] = val; if (global[name] === val) return; } catch (_e) {}
  try { Object.defineProperty(global, name, { value: val, writable: true, configurable: true }); } catch (_e) {}
}

setG('window', global);                    // window.X resolves to a global X
setG('self', global);
setG('location', { href: 'http://localhost/', reload: noop });
global.devicePixelRatio = 1;
global.innerWidth = 1280; global.innerHeight = 720;
global.addEventListener = noop; global.removeEventListener = noop;
global.requestAnimationFrame = () => 0;    // no-op: the game's loop() won't self-recur
global.cancelAnimationFrame = noop;
setG('AudioContext', function () { return audioCtx(); });
setG('webkitAudioContext', global.AudioContext);

function audioCtx() {
  return {
    currentTime: 0, sampleRate: 44100, state: 'running', destination: ghost(),
    createGain: ghost, createOscillator: ghost, createBiquadFilter: ghost,
    createBufferSource: ghost, createBuffer: () => ghost(), createDynamicsCompressor: ghost,
    createStereoPanner: ghost, createConvolver: ghost, createWaveShaper: ghost, createDelay: ghost,
    resume: () => Promise.resolve(), suspend: () => Promise.resolve(), close: () => Promise.resolve(),
    decodeAudioData: () => Promise.resolve(ghost()),
  };
}

const _ls = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; }, clear: () => { for (const k in _ls) delete _ls[k]; },
};
global.indexedDB = undefined;              // SaveStore should degrade via its try/catch

global.document = {
  getElementById: () => fakeEl('div'),
  createElement: (t) => fakeEl(t),
  createElementNS: (ns, t) => fakeEl(t),
  querySelector: () => fakeEl(), querySelectorAll: () => [],
  addEventListener: noop, removeEventListener: noop,
  body: fakeEl('body'), documentElement: fakeEl('html'), head: fakeEl('head'),
  hidden: false, visibilityState: 'visible',
};

// Neutralize timers so autosave intervals / floatDamage cleanups can't keep the
// process alive or fire mid-measurement. Gameplay cooldowns are frame-based, not
// timer-based, so this does not affect the sim.
global.setInterval = () => 0; global.clearInterval = noop;
global.setTimeout = () => 0; global.clearTimeout = noop;

// ============================================================================
// 2. LOAD THE REAL GAME CODE (extract <script> from the HTML)
// ============================================================================
// P1 wrap: the monolith is deleted — default to the built artifact (same env chain as load-game.js).
const htmlPath = path.resolve(process.env.GAME_HTML || process.env.ELDERMYR_GAME_FILE || path.join(__dirname, '..', 'dist', 'eldermyr.html'));
const html = fs.readFileSync(htmlPath, 'utf8');
const a = html.indexOf('<script>');
const b = html.indexOf('</script>', a);
if (a < 0 || b < 0) { console.error('Could not find <script> block'); process.exit(1); }
let code = html.slice(a + '<script>'.length, b);

// Epilogue: capture the lexical const/let/function symbols we need to drive the
// sim. Runs at the top level of the same program, so it can see them directly.
const NEED = [
  'state', 'keys', 'maps', 'startGame', 'loop',
  // sim block (eldermyr-rpg.html:1848)
  'updateTime', 'updatePlayer', 'updateEnemies', 'updateAllies', 'updateCompanions',
  'updateProjectiles', 'maybeSpawnWild', 'updateParticles', 'updateFires', 'updateWeather',
  'updateEvents', 'updateFactionWar', 'updateWarband', 'updateFatigue', 'updateNemesisPresence',
  'updateWorldLine', 'updateMusicMood', 'updateAmbience',
  // combat scenario helpers
  'tryAttack', 'killEnemy', 'addProjectile', 'makeWildEnemy', 'spawnPackAround', 'gainXP', 'TILE',
];
code += '\n;globalThis.__game = {};\n' +
  NEED.map((n) => `try{ globalThis.__game[${JSON.stringify(n)}] = ${n}; }catch(_e){}`).join('\n');

// eslint-disable-next-line no-eval
try { eval(code); } catch (e) {
  console.error('\n❌ FAILED while loading/evaluating game definitions:');
  console.error(e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : e);
  process.exit(2);
}
const G = global.__game;

// ============================================================================
// 3. DRIVE IT
// ============================================================================
const report = { load: 'ok', captured: {}, boot: {}, sim: {}, combat: {}, perf: {}, errors: [] };
for (const n of NEED) report.captured[n] = typeof G[n];

function must(name, fn) {
  try { fn(); return true; }
  catch (e) { report.errors.push({ where: name, msg: String(e && e.message || e), stack: (e && e.stack || '').split('\n').slice(1, 4).join(' | ') }); return false; }
}

// --- boot the world ---
must('startGame', () => G.startGame());
report.boot = {
  scene: G.state && G.state.scene,
  overworldBuilt: !!(G.maps && G.maps.overworld && G.maps.overworld.length),
  mapDims: G.maps && G.maps.overworld ? `${G.maps.overworld[0].length}x${G.maps.overworld.length}` : null,
  enemies: G.state ? G.state.enemies.length : null,
  playerLvl: G.state ? G.state.player.level : null,
  playerXY: G.state ? [Math.round(G.state.player.x), Math.round(G.state.player.y)] : null,
};

// --- SIM-ONLY tick (faithful copy of loop()'s sim block; NO render) ---
function simTick() {
  G.updateTime(); G.updatePlayer(); G.updateEnemies(); G.updateAllies(); G.updateCompanions();
  G.updateProjectiles(); G.maybeSpawnWild(); G.updateParticles(); G.updateFires(); G.updateWeather();
  G.updateEvents(); G.updateFactionWar(); G.updateWarband(); G.updateFatigue();
  G.updateNemesisPresence(); G.updateWorldLine(); G.updateMusicMood(); G.updateAmbience();
}

// Walk the player around (drive input the way the real key handler would).
const p0 = G.state ? [G.state.player.x, G.state.player.y] : [0, 0];
let firstErr = null, okTicks = 0;
const N = 3000;
for (let i = 0; i < N; i++) {
  // steer: right for a while, then down, then diagonally — exercises movement/collision/region logic
  G.keys['d'] = i % 400 < 250; G.keys['s'] = i % 400 >= 200;
  G.keys['w'] = false; G.keys['a'] = false;
  try { simTick(); okTicks++; }
  catch (e) { firstErr = { tick: i, msg: String(e && e.message || e), stack: (e && e.stack || '').split('\n').slice(1, 5).join(' | ') }; break; }
}
report.sim = {
  ticksRequested: N, ticksOk: okTicks, firstError: firstErr,
  playerMoved: G.state ? (Math.abs(G.state.player.x - p0[0]) + Math.abs(G.state.player.y - p0[1]) > 1) : false,
  playerXYfinite: G.state ? (Number.isFinite(G.state.player.x) && Number.isFinite(G.state.player.y)) : false,
  timeAdvanced: G.state ? G.state.time : null,
  enemiesAlive: G.state ? G.state.enemies.length : null,
};

// --- COMBAT scenario: exercise killEnemy() (the most DOM-welded path) ---
must('combat-setup', () => {
  const p = G.state.player; p.level = 10; if (G.gainXP) {} // keep level modest
  // spawn a handful of foes right on top of the player
  if (typeof G.spawnPackAround === 'function') {
    G.spawnPackAround(p.x, p.y, 6, 999);
  } else if (typeof G.makeWildEnemy === 'function') {
    for (let k = 0; k < 6; k++) G.state.enemies.push(G.makeWildEnemy(Math.floor(p.x / (G.TILE || 32)) + 1, Math.floor(p.y / (G.TILE || 32))));
  }
});
const beforeGold = G.state ? G.state.player.gold : 0;
const beforeXp = G.state ? (G.state.player.xp + G.state.player.level * 1000) : 0;
const enemiesBefore = G.state ? G.state.enemies.length : 0;
// force-kill some enemies straight through killEnemy() — loot, xp, gold, faction, quest, DOM float text, sound
let killed = 0, killErr = null;
if (G.state && typeof G.killEnemy === 'function') {
  const victims = G.state.enemies.slice(0, Math.min(4, G.state.enemies.length));
  for (const v of victims) {
    try { v.hp = 0; G.killEnemy(v); killed++; }
    catch (e) { killErr = { msg: String(e && e.message || e), stack: (e && e.stack || '').split('\n').slice(1, 5).join(' | ') }; break; }
  }
}
// also run the player's own attack + several more sim ticks with foes present
must('tryAttack', () => { if (typeof G.tryAttack === 'function') { G.keys[' '] = true; G.tryAttack(); } });
let combatTicksOk = 0, combatErr = null;
for (let i = 0; i < 500; i++) { try { simTick(); combatTicksOk++; } catch (e) { combatErr = { tick: i, msg: String(e && e.message || e) }; break; } }
report.combat = {
  enemiesSpawned: enemiesBefore, killedViaKillEnemy: killed, killError: killErr,
  goldChanged: G.state ? (G.state.player.gold - beforeGold) : 0,
  xpChanged: G.state ? ((G.state.player.xp + G.state.player.level * 1000) - beforeXp) : 0,
  combatTicksOk, combatError: combatErr,
};

// --- PERF: how fast can a server tick the sim? ---
if (!firstErr) {
  const M = 5000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < M; i++) { G.keys['d'] = i % 2 === 0; simTick(); }
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  report.perf = {
    ticks: M, totalMs: +ms.toFixed(1), perTickMs: +(ms / M).toFixed(4),
    theoreticalHz: Math.round(1000 / (ms / M)),
    note: 'single world instance, single core, no networking',
  };
}

// ============================================================================
// 4. VERDICT
// ============================================================================
const bootedIntoPlay = report.boot.scene === 'play' && report.boot.overworldBuilt;
const simRanClean = report.sim.ticksOk === N && report.sim.playerXYfinite && report.sim.playerMoved;
const combatClean = !report.combat.killError && !report.combat.combatError && report.combat.killedViaKillEnemy > 0;
const verdict = report.load === 'ok' && bootedIntoPlay && simRanClean && combatClean;

console.log('\n' + '='.repeat(74));
console.log('  ELDERMYR — HEADLESS SIM FEASIBILITY SPIKE');
console.log('='.repeat(74));
console.log(JSON.stringify(report, null, 2));
console.log('\n' + '-'.repeat(74));
console.log(verdict
  ? '  ✅ GREEN — the sim boots, ticks 3000×, fights, and kills all headless.'
  : '  ⚠  NOT FULLY GREEN — see errors/first-error above.');
console.log('  Sim perf: ' + (report.perf.theoreticalHz ? report.perf.theoreticalHz + ' Hz/core (' + report.perf.perTickMs + ' ms/tick)' : 'n/a'));
console.log('-'.repeat(74) + '\n');
process.exit(verdict ? 0 : 3);
