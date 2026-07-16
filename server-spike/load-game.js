/*
 * load-game.js — reusable HEADLESS LOADER for the Eldermyr sim.
 * -----------------------------------------------------------------------------
 * Stubs the whole browser environment, then loads the REAL game code straight
 * out of the built artifact ../dist/eldermyr.html (extracts the single <script>,
 * appends an epilogue capturing the symbols) and returns them. The spikes AND the
 * server all import this — one source of truth for "run the sim in Node".
 *
 *   const G = require('./load-game');   // { state, keys, maps, startGame, update*, ... }
 */
'use strict';
const fs = require('fs');
const path = require('path');
const noop = () => {};

// The REAL timers, resolved from node:timers (the canonical Node implementations, which
// are NOT affected by the global-timer stubbing installBrowserStubs() does below). We
// restore these onto `global` right after the game code is eval'd, so the stubs live ONLY
// for the duration of game-code evaluation. Without this, any library that resolves the
// GLOBAL timers at CALL time AFTER boot — the pg pool's connection/idle/lifetime/read
// timeouts, ws's close safety timer — silently binds to the no-op stubs (a hung query
// never times out → the pool exhausts; a wedged socket never force-closes). NOTE:
// requestAnimationFrame is deliberately NOT restored — the server drives ticks by hand,
// so a live rAF loop would double-drive the sim.
const REAL_TIMERS = require('node:timers');

// Recursive callable Proxy — absorbs ctx.*/Web-Audio chains without throwing.
function ghost() {
  const f = function () { return ghost(); };
  return new Proxy(f, {
    get(t, p) {
      if (p === 'value' || p === 'width' || p === 'height' || p === 'length' ||
          p === 'currentTime' || p === 'offsetWidth' || p === 'offsetHeight' ||
          p === 'clientWidth' || p === 'clientHeight' || p === 'sampleRate') return 0;
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      return ghost();
    },
    set() { return true; }, apply() { return ghost(); },
  });
}
const RECT = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, x: 0, y: 0 };
function fakeCtx() {
  const real = {
    canvas: { width: 1280, height: 720 }, measureText: () => ({ width: 8 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }), createPattern: () => ({}),
  };
  return new Proxy(real, { get(t, p) { return p in t ? t[p] : ghost(); }, set() { return true; } });
}
function fakeEl(tag) {
  const real = {
    tagName: String(tag || 'div').toUpperCase(), style: {}, dataset: {}, className: '',
    id: '', textContent: '', innerHTML: '', value: '', width: 1280, height: 720,
    getContext: () => fakeCtx(), getBoundingClientRect: () => RECT,
    addEventListener: noop, removeEventListener: noop, appendChild: (c) => c,
    removeChild: noop, remove: noop, insertBefore: (c) => c, setAttribute: noop,
    getAttribute: () => null, removeAttribute: noop, querySelector: () => fakeEl(),
    querySelectorAll: () => [], focus: noop, blur: noop, click: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  };
  return new Proxy(real, { get(t, p) { return p in t ? t[p] : ghost(); }, set(t, p, v) { t[p] = v; return true; } });
}
function audioCtx() {
  return {
    currentTime: 0, sampleRate: 44100, state: 'running', destination: ghost(),
    createGain: ghost, createOscillator: ghost, createBiquadFilter: ghost, createBufferSource: ghost,
    createBuffer: () => ghost(), createDynamicsCompressor: ghost, createStereoPanner: ghost,
    createConvolver: ghost, createWaveShaper: ghost, createDelay: ghost,
    resume: () => Promise.resolve(), suspend: () => Promise.resolve(), close: () => Promise.resolve(),
    decodeAudioData: () => Promise.resolve(ghost()),
  };
}
function setG(name, val) {
  try { global[name] = val; if (global[name] === val) return; } catch (_e) {}
  try { Object.defineProperty(global, name, { value: val, writable: true, configurable: true }); } catch (_e) {}
}

function installBrowserStubs() {
  setG('window', global); setG('self', global);
  setG('location', { href: 'http://localhost/', reload: noop });
  global.devicePixelRatio = 1; global.innerWidth = 1280; global.innerHeight = 720;
  global.addEventListener = noop; global.removeEventListener = noop;
  global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = noop;
  setG('AudioContext', function () { return audioCtx(); });
  setG('webkitAudioContext', global.AudioContext);
  const _ls = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null),
    setItem: (k, v) => { _ls[k] = String(v); }, removeItem: (k) => { delete _ls[k]; },
    clear: () => { for (const k in _ls) delete _ls[k]; },
  };
  global.indexedDB = undefined;
  global.document = {
    getElementById: () => fakeEl('div'), createElement: (t) => fakeEl(t),
    createElementNS: (ns, t) => fakeEl(t), querySelector: () => fakeEl(), querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop, body: fakeEl('body'),
    documentElement: fakeEl('html'), head: fakeEl('head'), hidden: false, visibilityState: 'visible',
  };
  // Stub the timers ONLY for the span of game-code eval (loadGame() restores the real ones
  // immediately after) — this muzzles the game's eval-time timer registrations without
  // permanently breaking pg/ws, which bind the GLOBAL timers at call time. rAF stays stubbed
  // permanently (set above): the server drives ticks manually, so a live rAF would double-drive.
  global.setInterval = () => 0; global.clearInterval = noop;
  global.setTimeout = () => 0; global.clearTimeout = noop;
}

// Symbols the spikes / server need handles to (const/let/fn are lexical, not global).
const CAPTURE = [
  'state', 'keys', 'maps', 'TILE', 'OW_W', 'OW_H',
  'T', 'SOLID', 'getTile', 'GREAT_HUNTS',   // tile enum + solids + lairs (server unstick pass / boss wander-home)
  'startGame', 'startLoaded', 'loop', 'snapshot', 'applySnapshot', 'saveGame',
  'updateTime', 'updatePlayer', 'updateEnemies', 'updateAllies', 'updateCompanions',
  'updateProjectiles', 'maybeSpawnWild', 'updateParticles', 'updateFires', 'updateWeather',
  'updateEvents', 'updateFactionWar', 'updateWarband', 'updateFatigue', 'updateNemesisPresence',
  'updateWorldLine', 'updateMusicMood', 'updateAmbience', 'updateTime',
  'tryAttack', 'tryInteract', 'killEnemy', 'addProjectile', 'makeWildEnemy', 'spawnPackAround',
  'gainXP', 'recalcStats', 'normItem', 'equippedWeapon', 'setupOverworld', 'genLegion', 'initHoldings',
  'liberateHolding', 'clearPOI', 'liberateTown',   // server reconciles outpost/POI/siege liberation across combat partitions
  'projParams', 'canDominate', 'dominate',   // combat-depth arc: proj speed + elite domination (tests)
  'makeElite', 'rollEliteAffixes', 'afxHit', 'enemyStrike', 'statusDamage', 'tryDropLoot',   // elite affixes (Pillar 3): spawn/drive/verify affixed elites headlessly
  'makeGreatBeast', 'makeWildEnemy', 'distFactor',   // world-scaling tests (#2/#16)
  'maybePinnacleBosses', 'PINNACLE_BOSSES', 'makePinnacleBoss', 'dropPinnacleReward',   // Pillar 2 pinnacle bosses: the room drives maybePinnacleBosses() from the shared phase; the table/generator/reward are captured for tests + future rescale

  'enterDungeon', 'setupDungeonFloor',   // ephemeral deep-dungeon rifts (#14)
  'loadOverworld', 'saveOverworld',   // to UNDO a dungeon entry (it flips the SHARED map + freezes everyone else)
  'curDay', 'isExhausted',   // per-player fatigue (MP rework: personal rest, no time skip)
  'distFactor', 'regionOf', 'rectDist', 'stepToward',
  'doDodge', 'drinkPotion', 'toggleMount',   // discrete actions the server routes per-player
  // menu action RPCs (run per-player on the server; client overrides these to route here)
  'equipWeapon', 'equipArmor', 'sellItem', 'sellAllJunk', 'spendPoint', 'unlockAbility',
  'buyPotion', 'buyTonic', 'buyWeapon', 'buyArmor', 'buyGood', 'sellGood', 'sellIngredient',   // Merchant shop
  'reforgeWeapon', 'fuseWeapon', 'repairItem', 'repairAll', 'temperWeapon',   // blacksmith
  'useWhirlwind', 'useFocus', 'castSpell', 'useUltimate', 'useSummon', 'toggleBoat', 'doCamp',
  'projHitsRect', 'playerTakeDamage', 'afxVampHeal',   // so the server can land enemy projectiles/fire on non-first players (+ vampiric elites heal off those hits too)
  'projParams',                         // testing: assert the pierce rules (magic pierces 1, arrows never)
  'drawPlayer',                         // testing: smoke every archetype render path (ghost ctx absorbs draws, exceptions surface)
  // NPC interactions (co-op [E] resolver): dialogue lines, instant actions, and panel-action RPCs
  'elderLines', 'openBounty', 'buyBoat', 'cook',
  'aliasSharedQuests',   // P2/S13: the sim's room-shared quest seam — world.js re-attaches main/frozen/legion through it on every join/load
  'actAs',   // P2/S14: THE acting-context seam (plan §1's runAs) — world.js runs every RPC/interact handler under actAs(p, …), which pins ONLY state.player/state.inventory and restores both in a finally

  'recruitCompanion', 'armCompanion', 'unarmCompanion', 'garrisonCompanion', 'recallCompanion', 'dismissCompanion',
];

function loadGame() {
  if (global.__game) return global.__game;
  installBrowserStubs();
  // The artifact under load. Overrides: GAME_HTML (suite-internal, e.g. a patched throwaway
  // copy) beats ELDERMYR_GAME_FILE (ambient, e.g. CI aiming everything at another build).
  // Default (P1 wrap): the BUILT artifact dist/eldermyr.html, repo-root-resolved — the single
  // source; the frozen monolith is deleted (it lives in the v2-final tag). Single line —
  // tests/battery/flat-loader.js and tests/battery/facing-verify.js anchor on it textually.
  const htmlPath = path.resolve(process.env.GAME_HTML || process.env.ELDERMYR_GAME_FILE || path.join(__dirname, '..', 'dist', 'eldermyr.html'));
  if (!fs.existsSync(htmlPath)) {
    throw new Error('[load-game] game artifact not found: ' + htmlPath +
      (process.env.GAME_HTML || process.env.ELDERMYR_GAME_FILE ? '' : ' — run `npm run build` first (dist/eldermyr.html is the single source since the P1 wrap)'));
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const a = html.indexOf('<script>'); const b = html.indexOf('</script>', a);
  if (a < 0 || b < 0) throw new Error('Could not locate <script> block in ' + htmlPath);
  let code = html.slice(a + '<script>'.length, b);
  // Route the game's own log() through an overridable hook so the server can capture
  // every in-world message (kills, drops, fishing, quests…) and stream it to MP clients.
  // Reassigning the LEXICAL `log` binding here is the only way — game code calls bare log().
  code += '\n;try{ var __rawLog = log; log = function(m,c){ try{ if(globalThis.__onLog) globalThis.__onLog(m,c); }catch(_e){} }; }catch(_e){}\n';
  // MP: the server owns co-op death (downed/bleed-out/revive in server/world.js). When
  // __onGameOver is set, gameOver() routes there instead of the SP path — otherwise every
  // knockdown fires scene='dead' + nemesisGrows (+2 warlord levels, +1 rank) + recordRun.
  code += '\n;try{ var __rawGameOver = gameOver; gameOver = function(){ if(globalThis.__onGameOver){ try{ globalThis.__onGameOver(); }catch(_e){} return; } return __rawGameOver.apply(this, arguments); }; }catch(_e){}\n';
  // (P2/S15) The __libGate wrappers around liberateHolding/clearPOI/liberateTown lived here and
  // are RETIRED: the game's own updateEnemies partitions foes internally now with state.enemies
  // kept the FULL world roster, so killEnemy's inline "no guardians left?" checks are correct in
  // MP — no gate needed. (world.js's _seen sweeps remain, as reconciliation for kill-less removals.)
  // Dual-path (P1d): the rebuilt artifact (dist/eldermyr.html) ends by defining
  // globalThis.Eldermyr — the EXPLICIT, build-verified namespace of every CAPTURE/NAMES
  // symbol (generated by scripts/build.mjs, which FAILS the build on a name with no
  // binding). Prefer it when present — its getters read the live lexical bindings — and
  // fall back to bare lexical capture on the frozen monolith (no namespace). Names absent
  // from the namespace (e.g. test-only extras patched in by tests/battery/flat-loader.js)
  // still capture lexically on both paths.
  code += '\n;globalThis.__game = {};\n' +
    CAPTURE.map((n) => `try{ globalThis.__game[${JSON.stringify(n)}] = (globalThis.Eldermyr && (${JSON.stringify(n)} in globalThis.Eldermyr)) ? globalThis.Eldermyr[${JSON.stringify(n)}] : ${n}; }catch(_e){}`).join('\n');
  // townZones is REASSIGNED inside generateOverworld() (which runs on startGame, AFTER this
  // capture) — a direct capture would be the stale boot-time []. Expose a live getter instead.
  // Dual-path (P1c): in the rebuilt artifact (dist/eldermyr.html) every rebindable module-level
  // let — townZones included — lives as a slot on the globals holder `globalThis.__g`, not as a
  // lexical binding; the frozen monolith still declares the lexical let. Prefer the holder when
  // it exists, else fall back to the lexical name (which only evaluates on the monolith path).
  code += '\n;try{ globalThis.__game.getTownZones = function(){ if (globalThis.__g && ("townZones" in globalThis.__g)) return globalThis.__g.townZones; return townZones; }; }catch(_e){}\n';
  // Headless timer hygiene (runs INSIDE the eval, so it touches the game's own lexical
  // bindings). Once we restore the real global timers below, the game's two REPEATING
  // timers would fire forever and keep the Node event loop alive. Neutralize them at the
  // source — they are the only setInterval users in the game, and both are runtime-registered
  // (from startGame/startLoaded, which the server calls), NOT eval-time:
  //   • autosave interval — the server has its own DB autosave (server/index.js); the game's
  //     localStorage autosave is meaningless headless. Pre-set its already-started latch so
  //     ensureAutosave() early-returns and never schedules the 60s interval.
  //   • music-sequencer interval — no audio on a headless server. Replace the method that
  //     creates it (Sound.startMusic) with a no-op; stopMusic then no-ops too.
  // The game's one-shot setTimeouts (floatDamage cleanup → el.remove(), region banner + saved
  // toast → style writes) are harmless against the ghost DOM and are left intact — they fire
  // once and self-clear.
  // Dual-path (P1c): on the rebuilt artifact `autosaveStarted` is a globals-holder slot, so the
  // bare lexical latch throws (caught) and the holder line is the one that latches; on the
  // monolith the lexical latch works and the holder line no-ops (no globalThis.__g).
  code += '\n;try{ autosaveStarted = true; }catch(_e){}\n';
  code += '\n;try{ if (globalThis.__g && ("autosaveStarted" in globalThis.__g)) globalThis.__g.autosaveStarted = true; }catch(_e){}\n';
  code += '\n;try{ Sound.startMusic = function(){}; }catch(_e){}\n';
  // eslint-disable-next-line no-eval
  eval(code);
  // Game code is fully evaluated — restore the REAL global timers so everything loaded/used
  // from here on (the pg pool, the ws server) gets working timers instead of the boot stubs.
  // rAF stays stubbed (see installBrowserStubs) — manual tick driving.
  global.setInterval = REAL_TIMERS.setInterval;
  global.clearInterval = REAL_TIMERS.clearInterval;
  global.setTimeout = REAL_TIMERS.setTimeout;
  global.clearTimeout = REAL_TIMERS.clearTimeout;
  // Capture-drift guard: a CAPTURE name that no longer exists in the game silently captures
  // `undefined`, quietly disabling a server subsystem (this class of bug has bitten before).
  // Surface it — warn ONCE, never throw (a removed symbol may be intentional).
  const missingCaptures = [...new Set(CAPTURE)].filter((n) => global.__game[n] === undefined);
  global.__game.__missingCaptures = missingCaptures;
  if (missingCaptures.length) {
    console.warn('[load-game] ' + missingCaptures.length + ' CAPTURE symbol(s) missing/undefined: ' + missingCaptures.join(', '));
  }
  return global.__game;
}

module.exports = loadGame();
