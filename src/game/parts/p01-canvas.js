const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const TILE = 32;
__g.VIEW_W = canvas.width;
__g.VIEW_H = canvas.height;
__g.ZOOM = 1;
__g.lightCanvas = null;
__g.lightCtx = null;
// Fill the whole window. The game draws with vector ops, so it stays crisp at any zoom/DPI.
// We preserve ~15 tiles of vertical framing (the original feel) and let the width fill the screen.
function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth,
    h = window.innerHeight;
  __g.ZOOM = clamp(h / 480, 1, 3);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  if (!__g.lightCanvas) {
    __g.lightCanvas = document.createElement('canvas');
    __g.lightCtx = __g.lightCanvas.getContext('2d');
  }
  __g.lightCanvas.width = canvas.width;
  __g.lightCanvas.height = canvas.height;
  __g.VIEW_W = w / __g.ZOOM;
  __g.VIEW_H = h / __g.ZOOM;
  ctx.setTransform(__g.ZOOM * dpr, 0, 0, __g.ZOOM * dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

const T = {
  GRASS: 0,
  TREE: 1,
  WATER: 2,
  MOUNTAIN: 3,
  PATH: 4,
  SAND: 5,
  HOUSE: 6,
  DUNGEON_ENTRANCE: 7,
  FLOWER: 8,
  BRIDGE: 9,
  D_FLOOR: 10,
  D_WALL: 11,
  D_PIT: 12,
  D_EXIT: 13,
  D_DOOR: 14,
  D_TORCH: 15,
  D_DESCEND: 16,
};
const SOLID = new Set([T.TREE, T.WATER, T.MOUNTAIN, T.HOUSE, T.D_WALL, T.D_PIT]);
const OW_W = 347,
  OW_H = 291;
// Concentric difficulty rings, measured outward from the realm's heart (distFactor: 0=home, 1=corner).
// The Vale is a safe lowland to learn in; the Marches escalate; the Frontier is deadly. Warlords stalk
// only the mid-outer lands (>= WL_MIN_DF) — the Heartland and home town are sanctuary by design.
const RING_SAFE = 0.3,
  RING_MID = 0.58,
  WL_MIN_DF = 0.42;
// A wild enemy lured more than LEASH_MARGIN (in distFactor) inward of where it spawned loses the trail and
// falls back — so the harder outer layers stay accessible, but their enemies never follow you into the easy ones.
const LEASH_MARGIN = 0.18;
const maps = { overworld: null, dungeon: null };
__g.townZones = [];
const SAVE_KEY = 'eldermyr_save_v2';
// Persistence: prefer the Claude host's window.storage; fall back to localStorage so the game
// auto-saves in a normal browser too (window.storage only exists inside the Claude artifact host).
const SaveStore = {
  async set(key, val) {
    if (typeof window.storage !== 'undefined') {
      try {
        await window.storage.set(key, val, false);
        return true;
      } catch (e) {}
    }
    try {
      localStorage.setItem(key, val);
      return true;
    } catch (e) {
      return false;
    }
  },
  async get(key) {
    if (typeof window.storage !== 'undefined') {
      try {
        const r = await window.storage.get(key);
        if (r && r.value != null) return r.value;
      } catch (e) {}
    }
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  },
  async remove(key) {
    if (typeof window.storage !== 'undefined') {
      try {
        await window.storage.delete(key);
      } catch (e) {}
    }
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  },
};
__g.autosaveStarted = false;

const RARITIES = [
  { id: 'common', name: 'Common', color: '#c8c8d0', mult: 1.0, dur: 50 },
  { id: 'uncommon', name: 'Uncommon', color: '#70e060', mult: 1.18, dur: 65 },
  { id: 'rare', name: 'Rare', color: '#5090ff', mult: 1.4, dur: 85 },
  { id: 'epic', name: 'Epic', color: '#c060ff', mult: 1.7, dur: 110 },
  { id: 'legendary', name: 'Legendary', color: '#f0a020', mult: 2.05, dur: 150 },
];
function rarityName(i) {
  return (RARITIES[i] || RARITIES[0]).name;
}
function rarityColor(i) {
  return (RARITIES[i] || RARITIES[0]).color;
}
const STYLE_NAMES = {
  melee: ['Dagger', 'Sword', 'Blade', 'Greatsword'],
  ranged: ['Sling', 'Shortbow', 'Longbow', 'Warbow'],
  magic: ['Wand', 'Staff', 'Rod', 'Scepter'],
};
const ARMOR_NAMES = ['Tunic', 'Mail', 'Plate', 'Aegis'];
const RAR_PREFIX = ['Worn', 'Fine', 'Runed', 'Ancient', 'Mythic'];

let state = {
  scene: 'title',
  map: 'overworld',
  player: {
    x: 22 * TILE,
    y: 15 * TILE,
    w: 22,
    h: 22,
    speed: 1.6,
    atkHaste: 0,
    dir: 'down',
    hp: 30,
    maxHp: 30,
    xp: 0,
    xpNext: 32,
    level: 1,
    atk: 6,
    def: 2,
    gold: 0,
    energy: 100,
    maxEnergy: 100,
    skillPoints: 0,
    bonusAtk: 0,
    bonusDef: 0,
    stamina: 100,
    maxStamina: 100,
    dodge: 0,
    dodgeCd: 0,
    dvx: 0,
    dvy: 0,
    bonusCrit: 0,
    bonusLifesteal: 0,
    bonusBerserk: 0,
    bonusEvasion: 0,
    crit: 0,
    lifesteal: 0,
    berserk: 0,
    bonusExec: 0,
    bonusFort: 0,
    bonusFont: 0,
    exec: 0,
    fort: 0,
    blessType: null,
    blessT: 0,
    blessDR: 0,
    foodBuff: null,
    foodT: 0,
    camping: false,
    campHealLeft: 0,
    campTick: 0,
    prof: {
      melee: { lvl: 1, xp: 0, next: 12 },
      ranged: { lvl: 1, xp: 0, next: 12 },
      magic: { lvl: 1, xp: 0, next: 12 },
    },
    abilities: { whirlwind: false, focus: false, ultimate: false, dominate: false, summon: false },
    abilityCd: { whirlwind: 0, focus: 0, ultimate: 0, summon: 0, dominate: 0 },
    whirl: 0,
    ultT: 0,
    attackCooldown: 0,
    attacking: 0,
    invuln: 0,
    moving: false,
    animFrame: 0,
    animTimer: 0,
    // Style-identity resources (Pillar 1) — all default 0/off; reset on weapon-style swap & on load
    momentum: 0,
    riposteT: 0,
    _momoDecay: 0, // MELEE: pips (0-5), riposte-crit window, idle-decay counter
    heat: 0,
    _heatCool: 0,
    _auraCd: 0,
    _auraEl: 0, // MAGIC: heat 0-100 (elemental staves only), passive-cool delay, aura-scan throttle counter, teammate-visible aura element
    _lastMarkN: 0,
    _markShowT: 0, // RANGED: HUD mirror of last target's mark stack (+ show timer)
    _lastStyle: null, // last equipped weapon-style (swap-reset seam)
    // PERSONAL MILESTONES — "have I been there / did I get it?", i.e. per-HERO progress, NOT world facts.
    // They live on the PLAYER (state.flags keeps only the world facts: krakenDead/legionBroken) because
    // that is the cheapest durable per-player carrier: snapshot()'s player whitelist persists them, and in
    // MP they ride `me` into every client with no adopt line (the Pillar-1 rule). As shared state.flags
    // they were incoherent by construction — one hero's first delve cleared the wayfinder for the whole
    // party, and nothing ever persisted them, so a room reboot re-sent a level-45 hero to the Sunken Dungeon.
    enteredDungeon: false,
    gotKey: false,
    enteredFrozen: false,
    // PER-HERO TOWN EMPOWERMENT + TEACHING (P2/S5) — moved off state.X onto the player, the same
    // Pillar-1 carrier as the milestones above: snapshot()'s player whitelist persists them, MP's
    // characterOf saves them via snap.player, and they ride `me` with no adopt line. tonics =
    // Health-Tonic upgrades bought (prices scale on it); sharpenLevel = legacy smith sharpening
    // (vestigial — Temper replaced the mechanic, but old saves still carry it); seenHeatTip =
    // one-time element-aware "your staff is heating up → aura" teaching tip (per-hero now: one
    // caster's tip no longer suppresses every other mage's).
    tonics: 0,
    sharpenLevel: 0,
    seenHeatTip: false,
    // PER-HERO BOAT + GUIDE PREF (P2/S6) — same Pillar-1 carrier again. hasBoat = Shipwright
    // purchase (was a SHARED root key: in co-op one hero's 250 g bought the whole room a boat,
    // and it was never saved — every reboot repossessed it; on the player it persists via
    // snapshot()'s whitelist/characterOf and rides `me` with no adopt line). wayfind = the [O]
    // objective-guide toggle (per-hero preference; in MP the client re-stamps its own local
    // value after each snapshot adopt, so the server copy is only the SP-save default).
    hasBoat: false,
    wayfind: true,
    // PER-HERO TOWN ECONOMY + FATIGUE (P2/S7) — same Pillar-1 carrier again, retiring four
    // PP_KEYS (they were already per-player in MP via the swap; now the game itself reads the
    // player). shopPurchased = shop items this hero bought (dedupe list); cargo = this hero's
    // trade hold; fishCd = personal fishing cooldown (never saved — resets on load, as always);
    // lastRestDay = the day this hero last rested (isExhausted() reads ONLY this; it rides the
    // save via snapshot()'s whitelist, so in MP a reconnect no longer hands out a free rest).
    shopPurchased: [],
    cargo: { furs: 0, grain: 0, spice: 0, ore: 0 },
    fishCd: 0,
    lastRestDay: 1,
  },
  inventory: {
    weapons: [
      {
        name: 'Rusty Sword',
        atk: 3,
        style: 'melee',
        rarity: 0,
        reqLevel: 1,
        reqProf: 1,
        dur: 50,
        durMax: 50,
        equipped: true,
      },
    ],
    armor: [{ name: 'Cloth Tunic', def: 0, rarity: 0, reqLevel: 1, dur: 50, durMax: 50, equipped: true }],
    items: [{ name: 'Potion', qty: 2 }],
    keys: 0,
  },
  enemies: [],
  npcs: [],
  pickups: [],
  projectiles: [],
  owSave: null,
  dungeonLevel: 0,
  maxDepth: 0,
  dungeonEntrance: { tx: 168, ty: 196 },
  spawnTimer: 120,
  maxWildEnemies: 46,
  // (tonics/sharpenLevel moved onto state.player — P2/S5; shopPurchased likewise — P2/S7)
  visitedTowns: [],
  shrines: [],
  pois: [],
  holdings: [],
  companions: [],
  loreFound: [],
  bounty: null,
  factions: { vigil: 0, wilds: 0, dread: 0 },
  allies: [],
  // (hasBoat/wayfind moved onto state.player — P2/S6, see the player literal above)
  sailing: false,
  ingredients: { herb: 0, berry: 0, mushroom: 0, fish: 0 },
  // (fishCd/cargo moved onto state.player — P2/S7, see the player literal above)
  activeShopTown: -1,
  quests: {
    main: { name: 'Slay the Mountain Kraken', done: false, started: false, hidden: true },
    talk: { name: 'Speak to the Elder', done: false },
    key: { name: 'Find the Dungeon Key', done: false, hidden: true },
    slay: { name: 'Slay 5 monsters', done: false, count: 0, target: 5 },
    frozen: { name: 'Plunder the Frozen Cache', done: false, hidden: true },
    dragon: { name: 'Tame the Emberwyrm (Lv 20)', done: false, hidden: true },
    legion: { started: false, stage: 'none', camps: 0, sealstones: 0, villages: 0, seatRegion: -1 },
  },
  flags: { krakenDead: false, legionBroken: false }, // WORLD facts only — true for the whole realm (one Kraken, one Legion host), so in MP they stay SHARED and must never become per-player. The personal milestones (enteredDungeon/gotKey/enteredFrozen) moved onto state.player: see the note there. legionBroken used to be undeclared (completeLegionQuest conjured it) — declared here so it round-trips the save like krakenDead.
  camera: { x: 0, y: 0 },
  time: 6480,
  // (lastRestDay moved onto state.player — P2/S7, see the player literal above)
  weather: 'clear',
  weatherTimer: 1800,
  fires: [],
  events: [],
  eventTimer: 2400,
  // (seenHeatTip moved onto state.player — P2/S5, see the player literal above)
  nemesis: { alive: false, level: 0, name: '', title: '', kills: 0 },
  ascension: 0,
  won: false,
  dragon: { tamed: false, mounted: false },
};
let keys = {};
__g.currentDialogue = null;
__g.interactCd = 0; // brief grace after closing a talk/shop so mashing [E] can't instantly reopen it

// ================= AUDIO (procedural — no asset files) =================
const MUSIC = {
  overworld: {
    wave: 'triangle',
    tempo: 430,
    notes: [523, 659, 784, 659, 587, 698, 880, 698, 440, 523, 659, 523, 494, 587, 740, 587],
    bass: [131, 147, 110, 123],
  },
  marches: {
    wave: 'triangle',
    tempo: 480,
    notes: [440, 523, 659, 523, 494, 587, 698, 587, 392, 494, 587, 494, 440, 523, 622, 523],
    bass: [110, 98, 87, 110],
  },
  frontier: {
    wave: 'sawtooth',
    tempo: 580,
    notes: [220, 0, 262, 0, 233, 0, 220, 0, 196, 0, 233, 0, 175, 0, 196, 0],
    bass: [55, 49, 58, 44],
  },
  danger: {
    wave: 'sawtooth',
    tempo: 300,
    notes: [330, 330, 392, 330, 311, 311, 370, 311, 330, 330, 392, 440, 311, 294, 311, 370],
    bass: [82, 82, 73, 73],
  },
  dungeon: {
    wave: 'sine',
    tempo: 540,
    notes: [330, 0, 392, 0, 294, 0, 349, 0, 262, 0, 311, 0, 247, 0, 294, 0],
    bass: [82, 73, 87, 65],
  },
};
const Sound = {
  ctx: null,
  master: null,
  musicGain: null,
  muted: false,
  musicTimer: null,
  musicName: null,
  step: 0,
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.12;
      this.musicGain.connect(this.master);
    } catch (e) {
      this.ctx = null;
    }
  },
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'square', vol = 0.3, opt = {}) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + (opt.when || 0);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opt.slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.slideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (opt.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(opt.dest || this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  },
  noise(dur, vol = 0.3, opt = {}) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + (opt.when || 0);
    const n = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let last = src;
    if (opt.filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = opt.filter;
      f.frequency.value = opt.freq || 1000;
      src.connect(f);
      last = f;
    }
    last.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.03);
  },
  swing() {
    this.noise(0.06, 0.1, { filter: 'highpass', freq: 1400 });
  },
  hit() {
    this.noise(0.07, 0.22, { filter: 'highpass', freq: 900 });
    this.tone(190, 0.08, 'square', 0.16, { slideTo: 90 });
  },
  shoot() {
    this.tone(680, 0.1, 'square', 0.12, { slideTo: 280 });
    this.noise(0.04, 0.06, { filter: 'highpass', freq: 2000 });
  },
  cast() {
    this.tone(440, 0.16, 'triangle', 0.14, { slideTo: 900 });
    this.tone(660, 0.12, 'sine', 0.08, { when: 0.02 });
  },
  hurt() {
    this.tone(170, 0.2, 'sawtooth', 0.22, { slideTo: 70 });
    this.noise(0.12, 0.16, { filter: 'lowpass', freq: 500 });
  },
  enemyDie() {
    this.tone(300, 0.18, 'square', 0.15, { slideTo: 80 });
    this.noise(0.12, 0.12, { filter: 'lowpass', freq: 900 });
  },
  gold() {
    this.tone(1318, 0.07, 'square', 0.12);
    this.tone(1976, 0.09, 'square', 0.12, { when: 0.05 });
  },
  item() {
    this.tone(784, 0.1, 'triangle', 0.13);
    this.tone(1046, 0.13, 'triangle', 0.12, { when: 0.05 });
  },
  jingle() {
    [784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.14, { when: i * 0.07 }));
  },
  levelup() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.18, 'square', 0.15, { when: i * 0.08 }));
  },
  boss() {
    this.tone(196, 0.5, 'sawtooth', 0.2, { slideTo: 60 });
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.3, 'square', 0.14, { when: 0.2 + i * 0.12 }));
  },
  heal() {
    this.tone(440, 0.25, 'sine', 0.16, { slideTo: 680 });
    this.tone(550, 0.2, 'sine', 0.1, { when: 0.06 });
  },
  whirl() {
    this.noise(0.32, 0.16, { filter: 'bandpass', freq: 700 });
    this.tone(300, 0.3, 'sawtooth', 0.08, { slideTo: 600 });
  },
  click() {
    this.tone(620, 0.04, 'square', 0.1);
  },
  blip() {
    this.tone(440, 0.05, 'square', 0.06);
  },
  error() {
    this.tone(180, 0.14, 'square', 0.16, { slideTo: 120 });
  },
  descend() {
    this.tone(140, 0.5, 'sine', 0.2, { slideTo: 55 });
    this.noise(0.4, 0.08, { filter: 'lowpass', freq: 300 });
  },
  gameover() {
    this.stopMusic();
    [330, 294, 247, 196, 147].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.18, { when: i * 0.18 }));
  },
  startMusic(name) {
    if (!this.ctx) return;
    if (this.musicName === name && this.musicTimer) return;
    this.stopMusic();
    const M = MUSIC[name];
    if (!M) return;
    this.musicName = name;
    this.step = 0;
    const beat = M.tempo / 1000;
    const tick = () => {
      const i = this.step % M.notes.length;
      const f = M.notes[i];
      if (f) this.tone(f, beat * 0.9, M.wave, 0.45, { dest: this.musicGain });
      if (i % 4 === 0) {
        const b = M.bass[((this.step / 4) | 0) % M.bass.length];
        if (b) this.tone(b, beat * 3.6, 'sine', 0.55, { dest: this.musicGain });
      }
      this.step++;
    };
    tick();
    this.musicTimer = setInterval(tick, M.tempo);
  },
  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicName = null;
  },
  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('eldermyr_muted', this.muted ? '1' : '0');
    } catch (e) {}
    if (!this.muted) {
      this.resume();
      this.click();
    }
    updateAudioIndicator();
  },
};
function updateAudioIndicator() {
  const el = document.getElementById('audio-ind');
  if (el) el.textContent = Sound.muted ? '🔇 [M] muted' : '🔊 [M] sound on';
}

// ================= JUICE: particles, screen shake, hurt flash =================
let particles = [];
__g.shake = 0;
__g.hurtFlash = 0;
let shockwaves = [];
function addShake(a) {
  __g.shake = Math.min(16, __g.shake + a);
}
function pushShock(s) {
  if (shockwaves.length >= 12) shockwaves.shift();
  shockwaves.push(s);
} // bounded (≤12; pruned every frame in updateParticles) expanding-ring/flash overlay for the Ultimate nova — a handful of STROKE/gradient draws per frame, NOT particles, so it can never grow RAM
function spawnBurst(x, y, count, opt = {}) {
  for (let i = 0; i < count; i++) {
    if (particles.length >= 260) particles.shift();
    const a =
      (opt.ang !== undefined ? opt.ang : Math.random() * 6.28) + (Math.random() - 0.5) * (opt.spread || 6.28);
    const sp = (opt.speed || 1.6) * (0.4 + Math.random() * 0.9);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - (opt.up || 0),
      life: 1,
      decay: opt.decay || 0.045,
      color: opt.color || '#ffffff',
      size: opt.size || 3,
      grav: opt.grav || 0,
    });
  }
}
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.grav;
    p.vx *= 0.9;
    p.vy *= 0.9;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = arcs.length - 1; i >= 0; i--) {
    arcs[i].life -= 0.12;
    if (arcs[i].life <= 0) arcs.splice(i, 1);
  }
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    if (s.delay > 0) {
      s.delay--;
      continue;
    }
    s.r += (s.maxR - s.r) * 0.16;
    s.life -= s.decay;
    if (s.life <= 0) shockwaves.splice(i, 1);
  }
  if (__g.hurtFlash > 0) __g.hurtFlash = Math.max(0, __g.hurtFlash - 0.04);
}
function drawParticles(camX, camY) {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = p.color;
    const s = Math.max(1, p.size * p.life);
    ctx.fillRect(p.x - camX - s / 2, p.y - camY - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}
function applyShake() {
  if (__g.shake > 0.1) {
    state.camera.x += (Math.random() * 2 - 1) * __g.shake;
    state.camera.y += (Math.random() * 2 - 1) * __g.shake;
    __g.shake *= 0.85;
  } else __g.shake = 0;
}
// Ultimate NOVA — an EXPLOSIVE, element-colored shockwave for the [Z] Ultimate. Scales with `power` (~1.0 rank1 → ~2.4 max):
// a bigger/brighter central FLASH, MORE + larger expanding shock RINGS (1 → 3), a CAPPED radial particle burst (≤~40 rank1 → ≤~70 max,
// faster/farther with power), and stronger SHAKE. Every overlay is bounded — particles by spawnBurst's 260 cap, rings by pushShock's 12 cap —
// so casting cannot grow RAM. `opt.col`/`opt.rgb` tint a NON-elemental nova (steel for melee, gold for ranged); an elemental weapon always wins.
function ultimateNova(cx, cy, element, power, opt) {
  power = Math.max(1, Math.min(2.6, power || 1));
  opt = opt || {};
  const col = element ? elemColor(element) : opt.col || '#b070ff';
  const rgb = element ? elemRgb(element) : opt.rgb || '176,112,255';
  pushShock({
    x: cx,
    y: cy,
    r: 16 * power,
    maxR: 80 + 70 * power,
    life: 1,
    decay: 0.07,
    color: rgb,
    flash: true,
    delay: 0,
  }); // bright central flash — bigger & longer with power
  const rings = Math.min(3, 1 + Math.floor((power - 1) / 0.55)); // 1 ring @rank1 → 2 @mid → 3 @max
  for (let i = 0; i < rings; i++)
    pushShock({
      x: cx,
      y: cy,
      r: 8 + i * 8,
      maxR: 150 + 90 * power - i * 24,
      life: 1,
      decay: 0.03 + 0.006 * power,
      color: rgb,
      width: 3 + 2 * power,
      delay: i * 4,
    }); // staggered concentric shock rings; footprint (≥240px) exceeds the 120px damage radius so the blast reads
  const total = Math.min(70, Math.round(38 + 22 * (power - 1))); // CAPPED particle spend: ~38 @rank1 → ~69 @max, never >70 (power scales within the ceiling)
  const embers = Math.round(total * 0.3),
    sp = 2.3 + 1.3 * power;
  spawnBurst(cx, cy, total - embers, { color: col, speed: sp, decay: 0.04, size: 3 });
  spawnBurst(cx, cy, embers, { color: '#ffffff', speed: sp * 1.5, decay: 0.06, size: 2 }); // colored body + brighter/faster white embers
  addShake(5 + 4 * power);
}
