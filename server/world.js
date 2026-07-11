/*
 * server/world.js — authoritative shared World (transport-agnostic).
 * =============================================================================
 * The "fork" that never drifts: this does NOT copy the game's sim. It loads the
 * UNTOUCHED eldermyr-rpg.html through the headless loader and REUSES its logic
 * (killEnemy, combat math, world-gen, items, spawns...). The only thing this
 * file owns is ORCHESTRATION of N players over that single-player sim:
 *
 *   - rotation model : per tick, for each player set the acting player + input,
 *                      run the per-player functions (movement, attack, fatigue).
 *   - enemy partition: split enemies by nearest player and run the REAL
 *                      updateEnemies once per partition, so each enemy targets
 *                      its nearest player with ZERO change to the game code.
 *   - shared world   : projectiles / spawns / weather / nemesis run once.
 *   - serialize      : per-player, interest-culled snapshot (map sent once).
 *
 * SCOPE (co-op MVP): per-player = position + all combat stats + inventory.
 * SHARED across the party = quests, factions, territory, the world itself.
 * (Full per-player independence of those is a later, additive pass.)
 */
'use strict';
const G = require('../server-spike/load-game');
const TILE = G.TILE || 32;

// ---- boot the shared world once, capture spawn + templates for joiners ----
G.startGame();
const S = G.state;
S.players = [];
const SPAWN = { x: S.player.x, y: S.player.y };
const OW_W = G.OW_W || 248, OW_H = G.OW_H || 208;
const TOWN_R2 = (20 * TILE) ** 2;   // "main town vicinity" — bosses can't see players within this of the Eldermyr spawn
// Enemy density (server-owned). The game seeds ~127 foes across the whole 248x208 map and
// caps at 46 — so the map-wide count sits ABOVE the cap and maybeSpawnWild never fires near
// you; you just roam a thin, static seed. Instead we drive spawning by LOCAL density: keep
// ~LOCAL_TARGET foes within LOCAL_R of EACH player, refilling every SPAWN_EVERY ticks if the
// vicinity is sparse. A generous global ceiling is just a runaway safety. maybeSpawnWild's
// own ring logic still applies, so the frontier fills with packs (dense) and the Vale with
// singles (calm) — difficulty geography for free.
const SPAWN_EVERY = 55, LOCAL_R2 = (34 * TILE) ** 2;   // 34t ≈ maybeSpawnWild's spawn ring, so the count is accurate
// Target vicinity population scales with the danger ring (distFactor 0→1): the safe inner
// Vale stays calm, the frontier crawls — spatial density variation, not a flat number.
const LOCAL_TARGET_MIN = 13, LOCAL_TARGET_MAX = 30;
function localTarget(p) {
  let df = 0.5;
  try { df = G.distFactor((p.x + p.w / 2) / TILE, (p.y + p.h / 2) / TILE); } catch (_e) {}
  df = Math.max(0, Math.min(1, df));
  return LOCAL_TARGET_MIN + Math.round((LOCAL_TARGET_MAX - LOCAL_TARGET_MIN) * df);
}
const SPAWN_CAP_BASE = 150, SPAWN_CAP_PER = 80;
function nearEnemyCount(p) {
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2; let n = 0;
  for (const e of S.enemies) { if ((e.x + e.w / 2 - cx) ** 2 + (e.y + e.h / 2 - cy) ** 2 < LOCAL_R2) n++; }
  return n;
}
const PLAYER_TEMPLATE = structuredClone(S.player);
const INV_TEMPLATE = structuredClone(S.inventory);

function clone(o) { return structuredClone(o); }
function setKeys(held) { for (const k in G.keys) delete G.keys[k]; if (held) Object.assign(G.keys, held); }
function nearestPlayer(e, players) {
  const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
  let best = players[0], bd = Infinity;
  for (const P of players) { const d = (P.x + P.w / 2 - ex) ** 2 + (P.y + P.h / 2 - ey) ** 2; if (d < bd) { bd = d; best = P; } }
  return best;
}
// Is this player inside the main-town vicinity? (bosses treat them as invisible.)
function inTown(p) { const cx = p.x + p.w / 2, cy = p.y + p.h / 2; return (cx - SPAWN.x) ** 2 + (cy - SPAWN.y) ** 2 < TOWN_R2; }
// A boss with no valid target ambles toward home (dragon → its lair; others → nearest map edge),
// dropping any wind-up so it can't attack while leaving.
function wanderHome(e) {
  e.tele = null; e.dash = null; e.windup = 0; e.chargeState = 0;
  const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
  let hx, hy;
  if (e.isWildDragon && S.dragonLair) { hx = S.dragonLair.tx * TILE + 16; hy = S.dragonLair.ty * TILE + 16; }
  else {
    const W = OW_W * TILE, H = OW_H * TILE, dl = ecx, dr = W - ecx, dt = ecy, db = H - ecy, m = Math.min(dl, dr, dt, db);
    hx = m === dl ? 0 : (m === dr ? W : ecx);
    hy = m === dt ? 0 : (m === db ? H : ecy);
  }
  const d = Math.hypot(hx - ecx, hy - ecy);
  if (d > 8) {
    const sp = (e.speed || 1.2) * 1.4;
    e.x += (hx - ecx) / d * sp; e.y += (hy - ecy) / d * sp;   // move freely so terrain can't trap a leaving boss
  }
}
function isBoss(e) { return !!(e.isBoss || e.isNemesis || e.isGreatBeast || e.isWildDragon); }

// ---- Downed & revive (co-op) -------------------------------------------------
// A hero at 0 HP isn't dead — they're DOWNED (incapacitated, bleeding out). A
// teammate revives them by standing close; or they self-recover if no foe is near
// (which also keeps SOLO play fair — crawl somewhere safe and you stabilize).
// Times are in TICKS (the sim runs at ~HZ/s). Foes ignore the downed and go for
// the living, so a party actually gets a window to reach a fallen ally.
const HZ_EST = Number(process.env.HZ) || 80;
const BLEED_FRAMES = Math.round(12 * HZ_EST);       // ~12s bleeding out — but ONLY while a foe is near
const REVIVE_FRAMES = Math.round(2.5 * HZ_EST);     // ~2.5s of a teammate standing close to revive you
const SELF_SAFE_FRAMES = Math.round(5 * HZ_EST);    // ~5s with no foe near → you self-recover (solo-friendly)
const REVIVE_R2 = (2.6 * TILE) ** 2;                // how close a reviver must stand
const SELF_ENEMY_R2 = (7 * TILE) ** 2;              // "a foe is near" radius (pauses bleed AND blocks self-rescue)
const REVIVE_HP_FRAC = 0.5, SELF_HP_FRAC = 0.25;    // revived-by-ally is stronger than crawled-to-safety
function enemyWithin(p, r2) {
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  for (const e of S.enemies) { if ((e.x + e.w / 2 - cx) ** 2 + (e.y + e.h / 2 - cy) ** 2 < r2) return true; }
  return false;
}
function goDown(p) {
  p.downed = true; p.hp = 0; p.bleedT = BLEED_FRAMES; p.reviveProg = 0; p.safeT = 0;
  p.invuln = 0; p.attacking = 0; p.whirl = 0; p.ultT = 0; p.dodge = 0;
  p.burnT = 0; p.poisonT = 0; p.chillT = 0; p.stunT = 0; p.dead = false;
  p.bleedFrac = 1; p.reviveFrac = 0; p.beingRevived = false; p.stabilizing = false; p.bleedSecs = Math.ceil(BLEED_FRAMES / HZ_EST);
}
function reviveAt(p, frac) {
  p.downed = false; p.hp = Math.max(1, Math.round(p.maxHp * frac)); p.invuln = 120;
  p.bleedT = 0; p.reviveProg = 0; p.safeT = 0;
  p.bleedFrac = 0; p.reviveFrac = 0; p.beingRevived = false; p.stabilizing = false;
}
function respawnAt(p) {
  p.downed = false; p.hp = p.maxHp; p.x = SPAWN.x; p.y = SPAWN.y; p.invuln = 90;
  if (p.map === 'dungeon') { p.map = 'overworld'; p.dg = null; p._mapSwitchN = (p._mapSwitchN || 0) + 1; }   // died below → surface at town
  p.chillT = 0; p.burnT = 0; p.poisonT = 0; p.dead = false;
  p.bleedT = 0; p.reviveProg = 0; p.safeT = 0; p.bleedFrac = 0; p.reviveFrac = 0; p.beingRevived = false; p.stabilizing = false;
  p._respawned = (p._respawned || 0) + 1;
}

// ---- serialization helpers (feed the real game renderer) ----
// scalar-only copy: safe against circular refs (e.g. enemy.warlordRef), keeps
// every primitive field the draw functions read (type, color, wobble, status…).
function packScalar(o) {
  const r = {};
  for (const k in o) { const v = o[k], t = typeof v; if (v === null || t === 'number' || t === 'string' || t === 'boolean') r[k] = v; }
  return r;
}
let _nidSeq = 0, _pidSeq = 0;
function packEnemy(e) {
  if (e._nid == null) e._nid = ++_nidSeq;   // stable id so the client can diff hits/deaths + smooth across snapshots
  const r = packScalar(e);
  if (e.tele) r.tele = { t: e.tele.t, max: e.tele.max, name: e.tele.name, radius: e.tele.radius, aimX: e.tele.aimX, aimY: e.tele.aimY };
  return r;
}
function packProj(pr) {
  if (pr._pid == null) pr._pid = ++_pidSeq;   // stable id so the client can smooth fast projectiles
  return packScalar(pr);
}
// depth-bounded deep clone for the requesting player + pickups (need nested prof/
// inventory/value); the depth cap also defuses any accidental cycle.
function safeClone(v, d) {
  d = d || 0;
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean') return v;
  if (t !== 'object' || d > 6) return undefined;
  if (Array.isArray(v)) return v.map((x) => { const c = safeClone(x, d + 1); return c === undefined ? null : c; });
  const r = {};
  for (const k in v) { if (k === 'held' || k === 'actions' || k === 'input' || k === 'dg' || k === '_shopStock') continue; const c = safeClone(v[k], d + 1); if (c !== undefined) r[k] = c; }
  return r;
}

// Whitelist of game functions a client may invoke on itself via a menu RPC.
// (Anything not here — startGame, genLegion, etc. — is ignored, so a client
// can't drive arbitrary server logic.)
const RPC_OK = new Set([
  'equipWeapon', 'equipArmor', 'sellItem', 'sellAllJunk', 'drinkPotion', 'spendPoint', 'unlockAbility',
  'useWhirlwind', 'useFocus', 'castSpell', 'useUltimate', 'useSummon', 'toggleMount', 'toggleBoat', 'doCamp',
  // shop (Merchant) transactions — run on the acting player's own gold/inventory
  'buyPotion', 'buyTonic', 'buySharpen', 'buyGood', 'sellGood', 'sellIngredient',
  // blacksmith — act on the acting player's own gear/gold ('repairItem' resolved specially)
  'reforgeWeapon', 'fuseWeapon', 'repairAll',
  // hearth (cook) + warband (recruit/arm/garrison/dismiss) — panel actions on the acting hero
  'cook', 'recruitCompanion', 'armCompanion', 'unarmCompanion', 'garrisonCompanion', 'recallCompanion', 'dismissCompanion',
]);
// The per-player town-economy globals the game reads/writes: swap the acting player's in
// before running its logic, write the primitives back after (arrays/objects are by-ref).
const PP_KEYS = ['shopPurchased', 'tonics', 'sharpenLevel', 'cargo', 'ingredients', 'lastRestDay'];
function swapInPP(p) { for (const k of PP_KEYS) S[k] = p[k]; if (p._shopTown != null) S.activeShopTown = p._shopTown; }
function writeBackPP(p) { p.tonics = S.tonics; p.sharpenLevel = S.sharpenLevel; p.shopPurchased = S.shopPurchased; p.cargo = S.cargo; p.ingredients = S.ingredients; }

// ---- Per-player dungeon instancing -------------------------------------------
// A hero is either on the SHARED overworld or inside their OWN private dungeon. These are the
// singleton "world slots" that differ between the two contexts; we stash/restore them around
// each dungeon player so N heroes can each be in a separate dungeon (or the overworld) without
// corrupting the shared world or one another. Dungeons stay SOLO for now.
const WORLD_SLOTS = ['map', 'enemies', 'pickups', 'npcs', 'projectiles', 'dungeonLevel', 'dungeonEntrance', 'dungeonThemeData', 'floorMod'];
function grabWorld() { const w = {}; for (const k of WORLD_SLOTS) w[k] = S[k]; w.md = G.maps.dungeon; return w; }
function putWorld(w) { for (const k of WORLD_SLOTS) S[k] = w[k]; G.maps.dungeon = w.md; }
function lightPlayer(p) { return { id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), w: p.w, h: p.h, dir: p.dir, moving: !!p.moving, animFrame: p.animFrame | 0, hp: Math.round(Math.max(0, p.hp)), maxHp: Math.round(p.maxHp), level: p.level, downed: !!p.downed, reviveFrac: p.downed ? (p.reviveFrac || 0) : 0, beingRevived: !!p.beingRevived }; }

class World {
  constructor() {
    this.state = S;
    this.players = new Map();          // id -> player object
    this._seq = 0;
  }

  get list() { return S.players; }

  addPlayer(id, name, character) {
    const p = clone(PLAYER_TEMPLATE);
    p.id = id;
    p.name = name || ('Hero-' + (++this._seq));
    p.x = SPAWN.x + (Math.floor((this._seq) / 4) * TILE);   // fan out a little so they don't stack
    p.y = SPAWN.y + ((this._seq % 4) * TILE);
    this._seq++;
    p.hp = p.maxHp;
    p.inventory = clone(INV_TEMPLATE);
    p.held = {}; p.actions = [];
    // per-player town-economy state — each hero shops, empowers and trades independently
    p.shopPurchased = []; p.tonics = 0; p.sharpenLevel = 0;
    p.cargo = { furs: 0, grain: 0, spice: 0, ore: 0 };
    p.ingredients = { herb: 0, berry: 0, mushroom: 0, fish: 0 };
    p.lastRestDay = (G.curDay ? G.curDay() : 1); p._exWas = false;   // per-player fatigue (join rested)
    p.downed = false; p.bleedT = 0; p.reviveProg = 0; p.safeT = 0;   // co-op downed/revive state (join standing)
    p.map = 'overworld'; p.dg = null; p._mapSwitchN = 0; p._sentDgN = 0;   // per-player dungeon instancing (start on the shared overworld)
    S.players.push(p);
    this.players.set(id, p);
    if (character) this._loadCharacter(p, character);   // restore a saved hero (stats + inventory only)
    return p;
  }

  // Produce the SAVEABLE per-player character: the game's own snapshot(), but ONLY the
  // player-stat + inventory slices (the shared world — map, legion, holdings, factions —
  // is never per-player). Swap this player into the singleton slots so snapshot() reads it.
  characterOf(id) {
    const p = this.players.get(id);
    if (!p) return null;
    const pp = S.player, pi = S.inventory;
    S.player = p; S.inventory = p.inventory;
    let snap = null;
    try { snap = G.snapshot(); } catch (_e) {}
    S.player = pp; S.inventory = pi;
    if (!snap) return null;
    return {
      v: 1, name: p.name, level: p.level | 0, player: snap.player, inventory: snap.inventory,
      shop: { shopPurchased: p.shopPurchased, tonics: p.tonics | 0, sharpenLevel: p.sharpenLevel | 0, cargo: p.cargo, ingredients: p.ingredients },
    };
  }

  // Restore a saved character onto a fresh player WITHOUT disturbing shared world state.
  // snapshot().player has no x/y (verified), so restoring stats can't teleport anyone;
  // we still re-pin id/name/io and recompute derived stats for this player only.
  _loadCharacter(p, c) {
    try {
      if (c && c.player) {
        const io = { id: p.id, name: p.name, x: p.x, y: p.y, w: p.w, h: p.h, held: p.held, actions: p.actions };
        Object.assign(p, c.player);
        Object.assign(p, io);                                   // re-pin position + identity + input
        p.prof = c.player.prof ? clone(c.player.prof) : p.prof;
        p.abilities = { whirlwind: false, focus: false, ultimate: false, dominate: false, summon: false, ...(c.player.abilities || {}) };
        p.abilityCd = { whirlwind: 0, focus: 0, ultimate: 0, summon: 0 };
        p.invuln = 0; p.attacking = 0; p.whirl = 0; p.ultT = 0; p.attackCooldown = 0; p.dir = 'down';
      }
      if (c && c.inventory) {
        p.inventory = clone(c.inventory);
        if (G.normItem) {
          (p.inventory.weapons || []).forEach((w) => { try { G.normItem(w, true); } catch (_e) {} });
          (p.inventory.armor || []).forEach((a) => { try { G.normItem(a, false); } catch (_e) {} });
        }
      }
      if (c && c.shop) {                                         // restore this hero's town-economy state
        p.shopPurchased = Array.isArray(c.shop.shopPurchased) ? c.shop.shopPurchased.slice() : [];
        p.tonics = c.shop.tonics | 0; p.sharpenLevel = c.shop.sharpenLevel | 0;
        p.cargo = Object.assign({ furs: 0, grain: 0, spice: 0, ore: 0 }, c.shop.cargo || {});
        p.ingredients = Object.assign({ herb: 0, berry: 0, mushroom: 0, fish: 0 }, c.shop.ingredients || {});
      }
      const pp = S.player, pi = S.inventory;                    // recompute atk/def from gear+bonuses for THIS player
      S.player = p; S.inventory = p.inventory;
      if (G.recalcStats) try { G.recalcStats(); } catch (_e) {}
      S.player = pp; S.inventory = pi;
      if (!(p.maxHp > 0)) p.maxHp = PLAYER_TEMPLATE.maxHp;
      if (!(p.hp > 0) || p.hp > p.maxHp) p.hp = p.maxHp;        // never load in dead / over-cap
    } catch (_e) { /* corrupt save → keep the fresh character */ }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    const i = S.players.indexOf(p);
    if (i >= 0) S.players.splice(i, 1);
    this.players.delete(id);
  }

  // client → server input for one player this frame
  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    if (msg.held) p.held = msg.held;
    if (msg.actions && msg.actions.length) p.actions.push(...msg.actions);
    if (msg.dir) p.dir = msg.dir;
  }

  // Run one menu/shop RPC for player p (already swapped into the singleton slots).
  // Item-taking calls carry an identifier the client can't turn into a server object,
  // so we resolve those here: shop buys against the player's open stock, sells against
  // the player's own inventory (verified by name to guard against a stale index).
  // Process a player's queued discrete actions (attack/dodge/interact/rpc). `inDungeon` picks how
  // [E] resolves: on the overworld it may ENTER a dungeon (which we capture into p.dg and then peel
  // the shared overworld back into S); inside a dungeon it's descend/exit/key-vault (handled by the
  // game against the swapped-in dungeon context).
  _runActions(p, inDungeon) {
    if (!p.actions.length) return;
    for (const a of p.actions) {
      try {
        if (a === 'attack' && G.tryAttack) { G.keys[' '] = true; G.tryAttack(); }
        else if (a === 'interact' && G.tryInteract) {
          G.tryInteract();
          if (!inDungeon && S.map === 'dungeon') {           // just ENTERED a dungeon
            p.dg = grabWorld();                              // capture the freshly-built private dungeon
            p.map = 'dungeon'; p._mapSwitchN = (p._mapSwitchN || 0) + 1;
            // peel the shared overworld back into S (saveOverworld stashed it into owSave on entry)
            if (S.owSave) { S.enemies = S.owSave.enemies; S.pickups = S.owSave.pickups; S.npcs = S.owSave.npcs; if (S.owSave.pois) S.pois = S.owSave.pois; }
            S.map = 'overworld';
            break;                                           // p is now in a dungeon — stop overworld action processing
          }
        }
        else if (a === 'dodge' && G.doDodge) G.doDodge();
        else if (a && a.rpc) this._runRpc(a, p);
      } catch (_e) {}
    }
    p.actions.length = 0;
  }

  _runRpc(a, p) {
    const rpc = a.rpc, args = Array.isArray(a.args) ? a.args : [];
    if (rpc === 'buyWeapon' || rpc === 'buyArmor') {
      const stock = p._shopStock; if (!stock) return;
      const list = rpc === 'buyWeapon' ? stock.weapons : stock.armor;
      const it = (list || []).find((x) => x && x.id === args[0]);
      if (it && typeof G[rpc] === 'function') G[rpc](it);
      return;
    }
    if (rpc === 'sellItem') {
      const idx = args[0], kind = args[1], nm = args[2];
      const arr = kind === 'weapon' ? p.inventory.weapons : (kind === 'armor' ? p.inventory.armor : null);
      const it = arr && arr[idx];
      if (it && it.name === nm && typeof G.sellItem === 'function') G.sellItem(it, kind);
      return;
    }
    if (rpc === 'repairItem') {                                  // blacksmith: resolve the damaged item by slot
      const kind = args[0], idx = args[1], nm = args[2];
      const arr = kind === 'weapon' ? p.inventory.weapons : (kind === 'armor' ? p.inventory.armor : null);
      const it = arr && arr[idx];
      if (it && it.name === nm && typeof G.repairItem === 'function') G.repairItem(it);
      return;
    }
    if (rpc === 'doCamp') {                                       // MP camp: personal rest, NO shared-clock skip
      const t0 = S.time;
      if (typeof G.doCamp === 'function') try { G.doCamp(); } catch (_e) {}
      const camped = S.time !== t0;                              // doCamp fast-forwards time only on success
      S.time = t0;                                               // undo it — the world's clock never jumps
      if (camped) { p.lastRestDay = G.curDay ? G.curDay() : p.lastRestDay; p._exWas = false; if (G.recalcStats) try { G.recalcStats(); } catch (_e) {} }
      return;
    }
    if (RPC_OK.has(rpc) && typeof G[rpc] === 'function') G[rpc].apply(null, args);
  }

  // Nearest shop the player is standing at → its stock + this hero's purchase history.
  // Also stashes the stock on the player so buy RPCs can resolve item ids against it.
  shopPayloadFor(id) {
    const p = this.players.get(id); if (!p) return null;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    let npc = null, bd = Infinity;
    for (const n of (S.npcs || [])) { if (n.id !== 'shop') continue; const d = (n.x - cx) ** 2 + (n.y - cy) ** 2; if (d < bd) { bd = d; npc = n; } }
    if (!npc || bd > (110 * 110)) return null;                 // must actually be at a shop
    const key = npc.shopTown && npc.shopTown.key;
    const ti = (key && /^t\d+$/.test(key)) ? parseInt(key.slice(1)) : -1;
    p._shopStock = npc.stock || { weapons: [], armor: [] };
    p._shopTown = ti;
    return { name: (npc.shopTown && npc.shopTown.name) || 'Shop', town: ti, stock: p._shopStock, purchased: (p.shopPurchased || []).slice() };
  }

  // Co-op [E] on an NPC: resolve what to show/do for the acting hero near NPC `npcId`.
  // Returns a descriptor the client acts on — open a panel (it has the game's own render fns;
  // we just hand it the data), show dialogue (lines resolved here), or toast an instant result.
  // (shop/smith keep their own dedicated messages; this covers everyone else.)
  resolveInteract(id, npcId) {
    const p = this.players.get(id); if (!p) return null;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    let npc = null, bd = Infinity;
    for (const n of (S.npcs || [])) { if (n.id !== npcId) continue; const d = (n.x - cx) ** 2 + (n.y - cy) ** 2; if (d < bd) { bd = d; npc = n; } }
    if (!npc || bd > (130 * 130)) return null;                 // must actually be standing at that NPC
    const pp = S.player, pi = S.inventory;
    S.player = p; S.inventory = p.inventory; swapInPP(p);       // act as this hero
    let res = null;
    try {
      if (npcId === 'hearth') res = { kind: 'panel', panel: 'cook' };                                   // client already has ingredients (snap.me)
      else if (npcId === 'hunts') res = { kind: 'panel', panel: 'hunts', huntsSlain: (S.huntsSlain || []).slice() };
      else if (npcId === 'recruit') res = { kind: 'panel', panel: 'companions', companions: (S.companions || []).map((c) => safeClone(c)) };
      else if (npcId === 'bounty') res = this._doInstant(p, 'openBounty');
      else if (npcId === 'shipwright') res = this._doInstant(p, 'buyBoat');
      else {                                                    // elder / guard / any talker → dialogue
        const lines = (npcId === 'elder' && typeof G.elderLines === 'function') ? G.elderLines() : (Array.isArray(npc.lines) ? npc.lines.slice() : ['…']);
        if (npcId === 'elder' && S.quests) {                   // the elder advances the (shared) questline
          if (S.quests.talk) S.quests.talk.done = true;
          if (S.quests.main) S.quests.main.started = true;
          if (S.quests.key) S.quests.key.hidden = false;
          if (S.quests.legion && !S.quests.legion.started) { S.quests.legion.started = true; S.quests.legion.stage = 'camps'; }
        }
        res = { kind: 'dialogue', speaker: npc.name || '', lines: Array.isArray(lines) ? lines : ['…'] };
      }
    } catch (_e) {}
    writeBackPP(p); S.player = pp; S.inventory = pi;
    return res;
  }

  // Instant NPC action (bounty/boat): run the game fn for p, compose feedback from state deltas
  // (the game's log() only writes to the DOM, so we can't read its text server-side).
  _doInstant(p, fn) {
    if (fn === 'openBounty') {
      const b0 = S.bounty ? { desc: S.bounty.desc, target: S.bounty.target, progress: S.bounty.progress, done: S.bounty.progress >= S.bounty.target } : null;
      const g0 = p.gold | 0;
      if (typeof G.openBounty === 'function') G.openBounty();
      const b = S.bounty, dg = (p.gold | 0) - g0;
      let text;
      if (!b0) text = b ? `Bounty accepted — ${b.desc}. Reward: ${b.reward} gold${b.sp ? ' + a skill point' : ''}${b.loot ? ' + rare loot' : ''}.` : 'No bounty available right now.';
      else if (b0.done) text = `Bounty complete!${dg > 0 ? ' +' + dg + ' gold' : ''} — a new one awaits.`;
      else text = `Bounty in progress — ${b0.desc} (${Math.min(b0.progress, b0.target)}/${b0.target}). Return when it's done.`;
      return { kind: 'toast', text, cls: 'quest' };
    }
    if (fn === 'buyBoat') {
      const had = !!S.hasBoat, g0 = p.gold | 0;
      if (typeof G.buyBoat === 'function') G.buyBoat();
      if (!had && S.hasBoat) return { kind: 'toast', text: '★ You acquire a sturdy boat! Press [B] by open water to set sail.', cls: 'quest' };
      if (had) return { kind: 'toast', text: 'You already own a boat. Press [B] beside open water to sail.', cls: 'lore' };
      return { kind: 'toast', text: `A boat costs 250 gold — return when you can pay (you have ${g0}).`, cls: 'combat' };
    }
    return null;
  }

  // ---- the authoritative tick ----
  tick() {
    if (!S.players.length) return;
    S.scene = 'play';                 // server always simulates; neutralize transient scene changes (death/dialogue/shop)
    G.updateTime();

    // Split the party: heroes on the SHARED overworld vs. each inside their OWN private dungeon.
    const owPre = S.players.filter((p) => p.map !== 'dungeon');
    // PER-PLAYER (overworld): movement, discrete actions, fatigue.
    for (const p of owPre) {
      if (p.downed) continue;            // incapacitated — the downed pass (below) runs their timers
      S.player = p; S.inventory = p.inventory; swapInPP(p); setKeys(p.held);
      try { G.updatePlayer(); } catch (_e) {}
      this._runActions(p, false);        // interact may ENTER a dungeon → p.map becomes 'dungeon' + its context captured
      if (p.map === 'dungeon') continue; // just entered — its dungeon runs next tick; skip overworld writeback
      if (G.isExhausted) { const ex = !!G.isExhausted(); if (ex !== p._exWas) { p._exWas = ex; if (G.recalcStats) try { G.recalcStats(); } catch (_e) {} } }
      writeBackPP(p);
    }

    // SHARED WORLD — overworld heroes only (dungeon delvers run in their own phase below)
    const players = S.players.filter((p) => p.map !== 'dungeon');
    if (players.length && S.enemies.length) {
      // Main-town safety: on the overworld, BOSSES can't see players in the town vicinity —
      // they target only players who are OUT of town, and wander home if nobody is.
      const overworld = S.map === 'overworld';
      // Foes ignore DOWNED heroes and go for the living — that's what gives a party the
      // window to reach a fallen ally. (Everyone downed → foes still mill on them so the
      // team wipe resolves via bleed-out instead of freezing the sim.)
      const standing = players.filter((p) => !p.downed);
      const normalPool = standing.length ? standing : players;
      const bossPool = overworld ? standing.filter((p) => !inTown(p)) : standing;
      const buckets = new Map(players.map((p) => [p, []]));
      const wanderers = [];
      for (const e of S.enemies) {
        if (overworld && isBoss(e)) {
          if (bossPool.length) buckets.get(nearestPlayer(e, bossPool)).push(e);
          else wanderers.push(e);           // no valid target (all in town / all downed) → amble home
        } else {
          buckets.get(nearestPlayer(e, normalPool)).push(e);
        }
      }
      const survivors = [];
      for (const p of players) {
        S.player = p;
        S.enemies = buckets.get(p);         // this player's assigned foes target HIM
        try { G.updateEnemies(); } catch (_e) {}
        survivors.push(...S.enemies);        // killEnemy() may have spliced some out
      }
      for (const e of wanderers) { wanderHome(e); survivors.push(e); }
      S.enemies = survivors;
    }

    // remaining shared systems run once (acting player = first, cosmetic-only bias)
    if (players.length) { S.player = players[0]; S.inventory = players[0].inventory; swapInPP(players[0]); }
    for (const fn of ['updateProjectiles', 'updateFires', 'updateWeather', 'updateEvents', 'updateFactionWar', 'updateNemesisPresence']) {
      if (G[fn]) try { G[fn](); } catch (_e) {}
    }

    // MP SPAWNING (replaces the single player-1 maybeSpawnWild call): feed EVERY player's
    // vicinity on its own cadence, and scale the density cap with the party + the huge map.
    // Reuses the game's ring/biome/pack logic, so difficulty still reads distFactor — the
    // safe Vale stays sparse, the frontier crawls (hotspots "for free" via the rings).
    if (S.map === 'overworld' && G.maybeSpawnWild) {
      S.maxWildEnemies = SPAWN_CAP_BASE + SPAWN_CAP_PER * players.length;   // global safety ceiling only
      for (const p of players) {
        if (p.downed) continue;          // don't spawn foes onto a fallen hero (it would block self-recovery)
        p._spawnT = (p._spawnT == null) ? (Math.abs((p.x * 3 + p.y * 7) | 0) % SPAWN_EVERY) : p._spawnT - 1;   // staggered
        if (p._spawnT > 0) continue;
        p._spawnT = SPAWN_EVERY;
        if (nearEnemyCount(p) >= localTarget(p)) continue;   // area already at its ring's target density
        S.player = p; S.inventory = p.inventory; swapInPP(p);
        S.spawnTimer = 0;                                  // force a spawn around THIS player now
        try { G.maybeSpawnWild(); } catch (_e) {}
      }
    }

    // The shared systems above only damage players[0]. Melee is already per-partition,
    // but enemy PROJECTILES and FIRE check only state.player — so make them hurt the
    // OTHER players too (players[1..N]; index 0 was handled by updateProjectiles/Fires).
    if (players.length > 1) {
      if (G.projHitsRect && G.playerTakeDamage && S.projectiles.length) {
        for (let i = S.projectiles.length - 1; i >= 0; i--) {
          const pr = S.projectiles[i];
          if (pr.friendly) continue;
          for (let j = 1; j < players.length; j++) {
            const pl = players[j];
            if (pl.downed) continue;      // already down — bleed-out governs, don't pile on
            if (G.projHitsRect(pr, pl)) {
              S.player = pl; S.inventory = pl.inventory;
              try { G.playerTakeDamage(pr.dmg); } catch (_e) {}
              if (pr.element === 'frost') pl.chillT = Math.max(pl.chillT || 0, 90);
              S.projectiles.splice(i, 1);
              break;
            }
          }
        }
      }
      if (G.playerTakeDamage && S.fires && S.fires.length && S.map === 'overworld' && S.time % 18 === 0) {
        for (const f of S.fires) for (let j = 1; j < players.length; j++) {
          const pl = players[j];
          if (pl.downed) continue;
          if (Math.floor((pl.x + pl.w / 2) / TILE) === f.tx && Math.floor((pl.y + pl.h / 2) / TILE) === f.ty) {
            S.player = pl; S.inventory = pl.inventory;
            try { G.playerTakeDamage(3); } catch (_e) {}
          }
        }
      }
    }

    // ============================ DUNGEONS (per-player, private) ============================
    // Each dungeon delver runs in their OWN instance: stash the shared overworld, swap the hero's
    // dungeon world into S, run their movement + their foes + their projectiles, save it back.
    const dg = S.players.filter((p) => p.map === 'dungeon' && p.dg);
    if (dg.length) {
      const owBase = grabWorld();                          // stash the shared overworld out of S
      for (const p of dg) {
        putWorld(p.dg);                                    // this hero's private dungeon into S
        S.player = p; S.inventory = p.inventory; swapInPP(p); setKeys(p.held);
        if (!p.downed) {
          try { G.updatePlayer(); } catch (_e) {}
          this._runActions(p, true);                       // interact = descend / exit / key-vault
          if (p.map === 'dungeon' && S.map === 'dungeon') {
            if (S.enemies.length) { try { G.updateEnemies(); } catch (_e) {} }   // solo partition: foes target this hero
            try { G.updateProjectiles(); } catch (_e) {}
          }
          if (G.isExhausted) { const ex = !!G.isExhausted(); if (ex !== p._exWas) { p._exWas = ex; if (G.recalcStats) try { G.recalcStats(); } catch (_e) {} } }
          writeBackPP(p);
        }
        if (S.map !== 'dungeon') { p.map = 'overworld'; p.dg = null; p._mapSwitchN = (p._mapSwitchN || 0) + 1; }   // exitDungeon → surface (it set our overworld pos)
        else if (p.hp <= 0) { respawnAt(p); p.dg = null; }                                                        // died below → respawnAt surfaces us at town
        else { const lvl0 = p.dg.dungeonLevel; p.dg = grabWorld(); if (p.dg.dungeonLevel !== lvl0) p._mapSwitchN = (p._mapSwitchN || 0) + 1; }   // save evolved dungeon; descended → resend grid
      }
      putWorld(owBase);                                    // restore the shared overworld for everyone else
    }

    // ---- DOWNED & REVIVE ----------------------------------------------------
    // 0 HP = incapacitated, not dead (co-op). A teammate revives you by standing
    // close; or you self-recover if no foe is near (keeps solo fair). Bleed-out
    // only ticks while a foe is near — so crawling to safety stabilizes you. Only
    // when the bleed timer runs out do you truly die and respawn at town.
    // (Overworld heroes only; a solo dungeon death boots you straight to town above.)
    for (const p of players) {
      if (!p.downed) { if (p.hp <= 0) goDown(p); continue; }   // just fell → go down
      if (p.hp < 0) p.hp = 0;
      const danger = enemyWithin(p, SELF_ENEMY_R2);
      if (danger) { p.bleedT -= 1; p.safeT = 0; }
      else if (++p.safeT >= SELF_SAFE_FRAMES) { reviveAt(p, SELF_HP_FRAC); continue; }   // safe long enough → self-recover
      // teammates standing close revive you (faster with more helpers)
      let revivers = 0; const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      for (const q of players) {
        if (q === p || q.downed) continue;
        if ((q.x + q.w / 2 - cx) ** 2 + (q.y + q.h / 2 - cy) ** 2 < REVIVE_R2) revivers++;
      }
      if (revivers > 0) { p.reviveProg = Math.min(REVIVE_FRAMES, p.reviveProg + revivers); if (p.reviveProg >= REVIVE_FRAMES) { reviveAt(p, REVIVE_HP_FRAC); continue; } }
      else p.reviveProg = Math.max(0, p.reviveProg - 2);       // no one near → progress slips back
      // display fields for the client (it has no server constants)
      p.beingRevived = revivers > 0; p.stabilizing = !danger;
      p.reviveFrac = p.reviveProg / REVIVE_FRAMES;
      p.bleedFrac = Math.max(0, p.bleedT / BLEED_FRAMES);
      p.bleedSecs = Math.max(0, Math.ceil(p.bleedT / HZ_EST));
      if (p.bleedT <= 0) respawnAt(p);                          // bled out → real death, respawn at town
    }
  }

  // ---- serialize: per-player, interest-culled (map is sent once on join) ----
  // Sends full-fidelity entities so the REAL game renderer can draw them: the
  // requesting player in full (stats/inventory for HUD + sprite), other players
  // lightly, and nearby enemies/pickups/projectiles/npcs with every field their
  // draw functions read.
  static R2 = (46 * (G.TILE || 32)) ** 2;   // interest radius (a bit past the viewport), squared
  snapshotFor(id) {
    const me = this.players.get(id);
    if (!me) return null;
    const inDg = me.map === 'dungeon' && !!me.dg;        // read entities from the hero's private dungeon or the shared overworld
    const enemies = inDg ? (me.dg.enemies || []) : S.enemies;
    const proj = inDg ? (me.dg.projectiles || []) : S.projectiles;
    const pickups = inDg ? (me.dg.pickups || []) : S.pickups;
    const npcs = inDg ? (me.dg.npcs || []) : (S.npcs || []);
    const cx = me.x, cy = me.y;
    const near = (o) => (o.x - cx) ** 2 + (o.y - cy) ** 2 < World.R2;
    const snap = {
      t: S.time, wx: S.weather, you: id, map: inDg ? 'dungeon' : 'overworld',
      me: safeClone(me),
      // dungeons are solo → no other players; on the overworld, exclude anyone off in a dungeon
      players: inDg ? [] : S.players.filter((p) => p.map !== 'dungeon').map(lightPlayer),
      enemies: enemies.filter(near).map(packEnemy),
      proj: proj.filter(near).map(packProj),
      pickups: pickups.filter((p) => !p.collected && near(p)).map((p) => safeClone(p)),
      npcs: npcs.filter(near).map(packScalar),
      // world features (overworld only) so the client can RENDER them + light the [E] prompt
      shrines: inDg ? [] : (S.shrines || []).filter(near).map((s) => safeClone(s)),
      lore: inDg ? [] : (S.loreStones || []).filter(near).map((s) => safeClone(s)),
      pois: inDg ? [] : (S.pois || []).filter(near).map((s) => safeClone(s)),
    };
    if (inDg) { snap.dgLevel = me.dg.dungeonLevel | 0; snap.dgTheme = me.dg.dungeonThemeData ? safeClone(me.dg.dungeonThemeData) : null; }
    // send the dungeon TILE GRID once per enter/descend (map-switch rising edge); on exit just flag the switch
    if ((me._mapSwitchN || 0) !== (me._sentDgN || 0)) { me._sentDgN = me._mapSwitchN || 0; if (inDg && me.dg.md) snap.dgTiles = me.dg.md; }
    return snap;
  }

  // static map + dims, sent ONCE when a client joins
  mapPayload() {
    return { tile: TILE, w: G.maps.overworld[0].length, h: G.maps.overworld.length, tiles: G.maps.overworld };
  }
}

module.exports = { World };

// --------------------------------------------------------------------------
// self-test: `node server/world.js`  — join 2, drive input, tick, serialize.
// --------------------------------------------------------------------------
if (require.main === module) {
  const w = new World();
  const A = w.addPlayer('A', 'Ava');
  const B = w.addPlayer('B', 'Bo');
  A.held = { d: true }; B.held = { s: true };
  const a0 = [A.x, A.y], b0 = [B.x, B.y];
  let ok = 0, err = null;
  for (let i = 0; i < 1200; i++) { try { w.tick(); ok++; } catch (e) { err = String(e && e.stack || e); break; } }
  // combat: give A a foe and an attack action
  const foe = G.makeWildEnemy(Math.floor(A.x / TILE) + 1, Math.floor(A.y / TILE));
  if (foe) { foe.x = A.x + 20; foe.y = A.y; S.enemies.push(foe); }
  const aGold0 = A.gold;
  for (let i = 0; i < 60; i++) { A.actions.push('attack'); w.tick(); }
  const snap = w.snapshotFor('A');
  const map = w.mapPayload();
  const out = {
    ticksOk: ok, firstError: err,
    A_moved_east: A.x - a0[0] > 40, B_moved_south: B.y - b0[1] > 40,
    bothFinite: [A.x, A.y, B.x, B.y].every(Number.isFinite),
    playersInWorld: w.list.length,
    A_attacked_gainedGoldOrKilled: (A.gold - aGold0) >= 0,
    snapshot: { players: snap.players.length, enemiesNear: snap.enemies.length, kb: +(Buffer.byteLength(JSON.stringify(snap)) / 1024).toFixed(2) },
    mapPayloadKb: +(Buffer.byteLength(JSON.stringify(map)) / 1024).toFixed(1),
    leaveWorks: (() => { w.removePlayer('B'); return w.list.length === 1; })(),
  };
  const green = out.ticksOk === 1200 && out.A_moved_east && out.B_moved_south && out.bothFinite && out.leaveWorks;
  console.log('\n=== server/world.js self-test ===');
  console.log(JSON.stringify(out, null, 2));
  console.log(green ? '\n  ✅ World core OK — N players tick, fight, serialize, join/leave.\n' : '\n  ⚠  World core issue — see above.\n');
  process.exit(green ? 0 : 1);
}
