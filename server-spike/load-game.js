/*
 * load-game.js — reusable HEADLESS LOADER for the Eldermyr sim.
 * -----------------------------------------------------------------------------
 * Stubs the whole browser environment, then loads the REAL game code straight
 * out of ../eldermyr-rpg.html (extracts the single <script>, appends an epilogue
 * capturing the lexical symbols) and returns them. The spikes AND the eventual
 * Colyseus server all import this — one source of truth for "run the sim in Node".
 *
 *   const G = require('./load-game');   // { state, keys, maps, startGame, update*, ... }
 */
'use strict';
const fs = require('fs');
const path = require('path');
const noop = () => {};

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
  // Neutralize timers (autosave/floatDamage cleanup) — gameplay cooldowns are frame-based.
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
  'liberateHolding', 'clearPOI',   // server reconciles outpost/POI liberation across combat partitions
  'projParams', 'canDominate', 'dominate',   // combat-depth arc: proj speed + elite domination (tests)
  'makeGreatBeast', 'makeWildEnemy', 'distFactor',   // world-scaling tests (#2/#16)
  'enterDungeon', 'setupDungeonFloor',   // ephemeral deep-dungeon rifts (#14)
  'loadOverworld', 'saveOverworld',   // to UNDO a dungeon entry (it flips the SHARED map + freezes everyone else)
  'curDay', 'isExhausted',   // per-player fatigue (MP rework: personal rest, no time skip)
  'distFactor', 'regionOf', 'rectDist', 'stepToward',
  'doDodge', 'drinkPotion', 'toggleMount',   // discrete actions the server routes per-player
  // menu action RPCs (run per-player on the server; client overrides these to route here)
  'equipWeapon', 'equipArmor', 'sellItem', 'sellAllJunk', 'spendPoint', 'unlockAbility',
  'buyPotion', 'buyTonic', 'buySharpen', 'buyWeapon', 'buyArmor', 'buyGood', 'sellGood', 'sellIngredient',   // Merchant shop
  'reforgeWeapon', 'fuseWeapon', 'repairItem', 'repairAll',   // blacksmith
  'useWhirlwind', 'useFocus', 'castSpell', 'useUltimate', 'useSummon', 'toggleBoat', 'doCamp',
  'projHitsRect', 'playerTakeDamage',   // so the server can land enemy projectiles/fire on non-first players
  'projParams',                         // testing: assert the pierce rules (magic pierces 1, arrows never)
  'drawPlayer',                         // testing: smoke every archetype render path (ghost ctx absorbs draws, exceptions surface)
  // NPC interactions (co-op [E] resolver): dialogue lines, instant actions, and panel-action RPCs
  'elderLines', 'openBounty', 'buyBoat', 'cook',
  'recruitCompanion', 'armCompanion', 'unarmCompanion', 'garrisonCompanion', 'recallCompanion', 'dismissCompanion',
];

function loadGame() {
  if (global.__game) return global.__game;
  installBrowserStubs();
  const htmlPath = path.join(__dirname, '..', 'eldermyr-rpg.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const a = html.indexOf('<script>'); const b = html.indexOf('</script>', a);
  if (a < 0 || b < 0) throw new Error('Could not locate <script> block in eldermyr-rpg.html');
  let code = html.slice(a + '<script>'.length, b);
  // Route the game's own log() through an overridable hook so the server can capture
  // every in-world message (kills, drops, fishing, quests…) and stream it to MP clients.
  // Reassigning the LEXICAL `log` binding here is the only way — game code calls bare log().
  code += '\n;try{ var __rawLog = log; log = function(m,c){ try{ if(globalThis.__onLog) globalThis.__onLog(m,c); }catch(_e){} }; }catch(_e){}\n';
  code += '\n;globalThis.__game = {};\n' +
    CAPTURE.map((n) => `try{ globalThis.__game[${JSON.stringify(n)}] = ${n}; }catch(_e){}`).join('\n');
  // eslint-disable-next-line no-eval
  eval(code);
  return global.__game;
}

module.exports = loadGame();
