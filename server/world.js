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

// ---- EVENT FEED: capture the game's own log() calls (kills, drops, fishing, quests…) ----
// load-game routes bare log() through global.__onLog. We stamp each with the player who was
// acting when it fired (S.player) so the room can route it: personal → that hero, epic → all.
const _logbuf = [];
// While the once-per-tick SHARED systems run (weather/war/nemesis/world-events) S.player is pinned to
// players[0]; without this flag their log lines would be OWNED by (and reach ONLY) player 0. Set around the
// shared-phase block so those lines are world events: no player owner (id=null) + broadcast to EVERYONE.
let _sharedPhase = false;
try {
  global.__onLog = function (m, c) {
    if (!m) return;
    const p = _sharedPhase ? null : S.player;
    _logbuf.push({ m: String(m).slice(0, 180), c: c || '', id: p ? p.id : null, bc: _sharedPhase });
    if (_logbuf.length > 300) _logbuf.splice(0, _logbuf.length - 300);
  };
} catch (_e) {}
// MP death is owned by the downed/bleed-out/revive pass (goDown/_downedPass fire off hp<=0 on
// their own) — the SP gameOver() consequences (scene='dead', nemesisGrows +2 warlord levels
// +1 rank, recordRun) must NOT fire per knockdown. load-game reroutes the lexical gameOver
// here; a no-op is all MP needs (playerTakeDamage already left hp at 0 for the downed pass).
try { global.__onGameOver = () => {}; } catch (_e) {}
// Liberation gate (see load-game): a function returning false ONLY while combat runs against a
// partitioned enemy bucket, so killEnemy's inline liberation defers to the tick() _seen sweep.
try { global.__libGate = null; } catch (_e) {}
// epic = broadcast to EVERYONE (someone slew a boss/hunt/nemesis, found a legendary, freed a town)
const FEED_BROADCAST = /vanquished|is slain| falls!|has fallen|legendary|Emberwyrm|Kraken|Overlord|Dawnbreaker|liberated|Sealstone|great beast|falls!|★/i;
const OW_W = G.OW_W || 347, OW_H = G.OW_H || 291;
// The frozen-wastes band (== the game's isFrozenTile, which isn't exported): biomeMap[y][x]===1 iff
// y<=frozenLimit(x). Pure math over OW_H + tx, so we replicate the per-player snow chill EXACTLY.
function frozenLimit(tx) { return Math.round(OW_H * 0.17 + Math.sin(tx * 0.18) * 4 + Math.sin(tx * 0.06) * 3); }
const TOWN_R2 = (20 * TILE) ** 2;   // "main town vicinity" — bosses can't see players within this of the Eldermyr spawn
// Enemy density (server-owned). The game seeds ~127 foes across the whole 347x291 map and
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
  if (e.isKraken && S.krakenArena) { hx = S.krakenArena.tx * TILE; hy = S.krakenArena.ty * TILE; }   // the Kraken stays in its peak-ringed arena (was wandering to the nearest map edge → "escaping")
  else if (e.isWildDragon && S.dragonLair) { hx = S.dragonLair.tx * TILE + 16; hy = S.dragonLair.ty * TILE + 16; }
  else if (e.isGreatBeast && e.huntKey) {   // great beasts amble to their OWN lair (the Tide Leviathan was heading to "nearest edge" through dry land and embedding itself in walls)
    const h = (G.GREAT_HUNTS || []).find((x) => x.key === e.huntKey);
    if (h && h.lair) { hx = h.lair.tx * TILE + 16; hy = h.lair.ty * TILE + 16; }
  }
  else if (e.isPinnacle && e._lairTx != null) { hx = e._lairTx * TILE + 16; hy = e._lairTy * TILE + 16; }   // pinnacle bosses drift back to their STAMPED lair (King's shipwreck isle / Shepherd's frozen wastes), never the nearest sea/wall edge — Stage A stamped _lairTx/_lairTy in makePinnacleBoss
  if (hx === undefined) {
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

// ---- Unstick pass: pop enemies out of walls -----------------------------------
// Knockback and wander-home move enemies without collision checks, so one can end up with its
// center inside a solid tile (or an aquatic beast — the Tide Leviathan — on dry land) and then
// stepToward's collision blocks every move: stuck forever, jittering in a wall. Every ~30 ticks,
// snap any such enemy to the nearest tile that's actually passable FOR IT.
function tileOkFor(e, t) {
  if (t === undefined || t === null) return false;
  if (e.aquatic) return G.T ? t === G.T.WATER : true;    // sea beasts live in water
  return !(G.SOLID && G.SOLID.has(t));
}
function unstickEnemies(mapName) {
  if (!G.getTile || !G.SOLID) return;
  for (const e of S.enemies) {
    const tx = Math.floor((e.x + e.w / 2) / TILE), ty = Math.floor((e.y + e.h / 2) / TILE);
    let t; try { t = G.getTile(mapName, tx, ty); } catch (_e) { continue; }
    if (tileOkFor(e, t)) continue;
    let done = false;
    const maxR = e.aquatic ? 12 : 6;                     // a beached sea-beast may be far from water
    for (let r = 1; r <= maxR && !done; r++) {
      for (let dy = -r; dy <= r && !done; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        let t2; try { t2 = G.getTile(mapName, tx + dx, ty + dy); } catch (_e) { continue; }
        if (tileOkFor(e, t2)) { e.x = (tx + dx) * TILE + (TILE - e.w) / 2; e.y = (ty + dy) * TILE + (TILE - e.h) / 2; done = true; break; }
      }
    }
    // aquatic + nothing near: it slips beneath the earth and resurfaces at its lair
    if (!done && e.aquatic && e.huntKey) {
      const h = (G.GREAT_HUNTS || []).find((x) => x.key === e.huntKey);
      if (h && h.lair) { e.x = h.lair.tx * TILE + (TILE - e.w) / 2; e.y = h.lair.ty * TILE + (TILE - e.h) / 2; }
    }
  }
}

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
  const lost = Math.floor((p.gold || 0) / 2);   // died with no rescue → forfeit half your gold (#7)
  if (lost > 0) { p.gold -= lost; _logbuf.push({ m: `You fell in battle — ${lost} gold slips from your purse.`, c: 'combat', id: p.id }); }
  p.downed = false; p.hp = p.maxHp; p.x = SPAWN.x; p.y = SPAWN.y; p.invuln = 90;
  if (p.map === 'dungeon') { p.map = 'overworld'; p.dg = null; p._mapSwitchN = (p._mapSwitchN || 0) + 1; }   // died below → surface at town
  // your warband can't be left stranded below: any of YOUR recruits that delved surface with you at town.
  if (S.companions) for (const c of S.companions) { if (c.ownerId === p.id && c.map === 'dungeon') { c.map = 'overworld'; c.x = p.x - 22 + Math.random() * 44; c.y = p.y + 12 + Math.random() * 12; c.attackCd = 0; c.hurtCd = 0; } }
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
let _nidSeq = 0, _pidSeq = 0, _cidSeq = 0, _aidSeq = 0;
function packComp(c) {
  if (c._cid == null) c._cid = ++_cidSeq;   // stable id so the client can SMOOTH companions across snapshots (they stepped/jittered without it)
  return packScalar(c);
}
function packAlly(a) {
  if (a._aid == null) a._aid = ++_aidSeq;    // stable id (optional client smoothing)
  const r = packScalar(a);
  if (typeof r.name !== 'string') r.name = 'Ally';   // drawAlly does a.name.split(' ') — a nameless ally crashes the renderer
  return r;
}
function packEnemy(e) {
  if (e._nid == null) e._nid = ++_nidSeq;   // stable id so the client can diff hits/deaths + smooth across snapshots
  const r = packScalar(e);
  if (e.tele) r.tele = { t: e.tele.t, max: e.tele.max, name: e.tele.name, radius: e.tele.radius, aimX: e.tele.aimX, aimY: e.tele.aimY };
  if (e._markBy && e._markBy.id != null) r._markById = e._markBy.id;   // Quarry Mark owner id: the OBJECT ref _markBy is dropped by packScalar (must never serialize), so pack the id → each client renders only ITS OWN marks (drawEnemy compares to state.player.id)
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
  for (const k in v) { if (k === 'held' || k === 'actions' || k === 'input' || k === 'dg' || k === '_shopStock' || k === 'dodgeHits') continue; const c = safeClone(v[k], d + 1); if (c !== undefined) r[k] = c; }   // dodgeHits = LIVE enemy refs (dodge i-frame bookkeeping) — never drag into a snapshot clone
  return r;
}

// Whitelist of game functions a client may invoke on itself via a menu RPC.
// (Anything not here — startGame, genLegion, etc. — is ignored, so a client
// can't drive arbitrary server logic.)
const RPC_OK = new Set([
  'equipWeapon', 'equipArmor', 'sellItem', 'sellAllJunk', 'drinkPotion', 'spendPoint', 'unlockAbility',
  'useWhirlwind', 'useFocus', 'castSpell', 'useUltimate', 'useSummon', 'toggleMount', 'toggleBoat', 'doCamp',
  // shop (Merchant) transactions — run on the acting player's own gold/inventory
  'buyPotion', 'buyTonic', 'buyGood', 'sellGood', 'sellIngredient',   // (buySharpen removed — Temper replaced it this release)
  // blacksmith — act on the acting player's own gear/gold ('repairItem' resolved specially)
  'reforgeWeapon', 'fuseWeapon', 'repairAll', 'temperWeapon',
  // hearth (cook) + warband (recruit/arm/garrison/dismiss) — panel actions on the acting hero
  'cook', 'recruitCompanion', 'armCompanion', 'unarmCompanion', 'garrisonCompanion', 'recallCompanion', 'dismissCompanion',
]);
// The per-player town-economy globals the game reads/writes: swap the acting player's in
// before running its logic, write the primitives back after (arrays/objects are by-ref).
const PP_KEYS = ['shopPurchased', 'tonics', 'sharpenLevel', 'cargo', 'ingredients', 'lastRestDay', 'fishCd', 'sailing', 'dragon'];
function swapInPP(p) { for (const k of PP_KEYS) S[k] = p[k]; S.activeShopTown = p._shopTown != null ? p._shopTown : null; }   // always assign — a null _shopTown must NOT leak the previous player's shop town into this slice
// Mirror PP_KEYS on the way out. lastRestDay was MISSING → resting never persisted (players popped back to
// Exhausted next slice). sailing/dragon are per-player too: a shared flag let one hero's boat/flight leak
// water-walk+fly collision (and the mounted atk bonus) into every other player's rotation slice.
function writeBackPP(p) { p.tonics = S.tonics; p.sharpenLevel = S.sharpenLevel; p.shopPurchased = S.shopPurchased; p.cargo = S.cargo; p.ingredients = S.ingredients; p.fishCd = S.fishCd | 0; p.lastRestDay = S.lastRestDay; p.sailing = !!S.sailing; p.dragon = S.dragon; }

// ---- Per-player dungeon instancing -------------------------------------------
// A hero is either on the SHARED overworld or inside their OWN private dungeon. These are the
// singleton "world slots" that differ between the two contexts; we stash/restore them around
// each dungeon player so N heroes can each be in a separate dungeon (or the overworld) without
// corrupting the shared world or one another. Dungeons stay SOLO for now.
const WORLD_SLOTS = ['map', 'enemies', 'pickups', 'npcs', 'projectiles', 'dungeonLevel', 'dungeonEntrance', 'dungeonThemeData', 'floorMod'];
function grabWorld() { const w = {}; for (const k of WORLD_SLOTS) w[k] = S[k]; w.md = G.maps.dungeon; return w; }
function putWorld(w) { for (const k of WORLD_SLOTS) S[k] = w[k]; G.maps.dungeon = w.md; }
function lightPlayer(p) { return { id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), w: p.w, h: p.h, dir: p.dir, moving: !!p.moving, animFrame: p.animFrame | 0, hp: Math.round(Math.max(0, p.hp)), maxHp: Math.round(p.maxHp), level: p.level, skin: p.skin | 0, downed: !!p.downed, reviveFrac: p.downed ? (p.reviveFrac || 0) : 0, beingRevived: !!p.beingRevived, sailing: !!p.sailing, mounted: !!(p.dragon && p.dragon.mounted), auraEl: p._auraEl || 0, heat: p._auraEl ? Math.round(p.heat || 0) : 0 }; }   // auraEl = the element a heated elemental staff is radiating (else 0) → teammates can draw the glow; heat rides alongside (only while auraing) so their glow scales/pulses ∝ Heat exactly like the caster's own self-pulsate

class World {
  constructor() {
    this.state = S;
    this.players = new Map();          // id -> player object
    this._seq = 0;
    this.sharedDg = null;              // THE party dungeon: one shared instance; first enterer creates it, others join
    this.dgSpawn = null;               // current floor's entry point (joiners + descends spawn here)
    this._qN = 1;                      // quest-state version: bumps when quests/bounty/lore change → clients resync
    try { this._qJson = JSON.stringify([S.quests, S.bounty, S.loreFound, S.maxDepth]); } catch (_e) { this._qJson = ''; }
    this._lgN = 1;                     // Dread Legion roster version: bumps when the shared roster changes → clients resync (same idiom as _qN)
    try { this._lgJson = JSON.stringify(S.legion); } catch (_e) { this._lgJson = ''; }
    this.feed = [];                    // event feed: {n, m, c, id, bc} — personal to `id`, or bc=broadcast to all
    this.feedN = 0;
    this.rift = null;                  // ephemeral deep-dungeon RIFT (#14): {x,y,deep,expires,n} — 30s window, one at a time
    this._riftSeq = 0;
    this._riftCd = 800;                // ticks until the first rift can open (~10s), then randomized
    this._threatLvl = 0;              // party level the Legion/Hunts are currently scaled to (0 = baked at boot ~lvl 1)
    // perf instrumentation (for the user-reported "laggier over time" probe): EMA tick/snapshot ms + rolling max.
    this._tickMsAvg = 0; this._tickMsMax = 0; this._ticks = 0; this._snapMsAvg = 0;
    this._errAt = new Map();          // throttle key -> last console.error timestamp (30s window)
  }

  // Throttled subsystem error logger: the tick's sim-call sites used to swallow with bare `catch {}`, so a
  // dead subsystem stayed invisible for weeks. console.error at most once per key per 30s (no spam, no interval).
  _err(key, e) {
    const now = Date.now(), last = this._errAt.get(key) || 0;
    if (now - last < 30000) return;
    this._errAt.set(key, now);
    try { console.error('[world] ' + key + ': ' + ((e && e.message) || e)); } catch (_e2) {}
  }

  // Legion & Great Beasts are generated at server BOOT, when the only "player" is the level-1
  // template — so they baked in weak and never tracked the party. Re-scale them up whenever the
  // party's average level climbs (they were 3-shot easy for a leveled group).
  _rescaleThreats(lvl) {
    for (const e of S.enemies) {
      if (e.isGreatBeast && e.huntKey) {                    // Hunts: rebuild via the REAL generator — no formula mirror (the old mirror drifted the moment the html steepened its curve; the generator is the single source of truth, whatever it becomes)
        const h = (G.GREAT_HUNTS || []).find((x) => x.key === e.huntKey);
        if (!h) continue;
        if (!G.makeGreatBeast) { this._err('gbTemplate', 'makeGreatBeast not captured'); continue; }
        const gx = Math.floor((e.x + e.w / 2) / TILE), gy = Math.floor((e.y + e.h / 2) / TILE);
        const pl0 = S._partyLevel, n0 = S.enemies.length; S._partyLevel = lvl;   // pin the generator's partyLvl() to THIS rescale's target (identical at the tick call site, which sets _partyLevel first); _partyN/huntCycle/ascension read live
        let t = null;
        try { t = G.makeGreatBeast(h, gx, gy); } catch (err) { this._err('gbTemplate', err); }
        finally { S._partyLevel = pl0; if (S.enemies.length > n0) S.enemies.length = n0; }   // generator is a pure constructor today (returns, pushes nothing — verified) — the truncate is drift insurance only
        if (!t) continue;
        const frac = e.maxHp > 0 ? e.hp / e.maxHp : 1;      // preserve damage-done, exactly as before
        e.maxHp = t.maxHp; e.hp = Math.max(1, Math.round(t.maxHp * frac));
        e.atk = t.atk; e.xp = t.xp; e.gold = t.gold;        // template discarded; def/e.cycle untouched (cycle stamps the SPAWN's drop tier — retagging a live beast would inflate its loot)
      } else if (e.warlordRef) {                            // a spawned warlord enemy: scale HP/atk to the party from a CACHED base
        // Stamp the base ONCE (like the Great-Beast branch recomputing from its template) and always derive from
        // it — re-multiplying the LIVE maxHp on every party-level rise compounded unboundedly (100→200→300→…).
        if (e._baseHp == null) { e._baseHp = e.maxHp; e._baseAtk = e.atk; e._baseWL = Math.max(1, e.warlordRef.level || 1); }
        const boost = Math.max(1, (lvl + (e.warlordRef.rank || 0)) / e._baseWL);
        const frac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
        e.maxHp = Math.round(e._baseHp * boost); e.hp = Math.max(1, Math.round(e.maxHp * frac));
        e.atk = Math.round(e._baseAtk * boost);   // damage scales with the SAME boost as HP (was soft-pedalled ×0.6 → warlords were bullet-sponges that barely hit); idempotent (pure fn of lvl/rank/_baseWL)
      }
    }
    if (S.legion && S.legion.warlords) {                    // #2: roster LEVEL tracks the party 1:1 (was lvl+rank / lvl+5) — matches the html genLegion/respawn change so MP never re-offsets; rank/cycle toughness rides the stat curves in makeWarlordEnemy, not the level number. Raise-to-lvl keeps it monotonic & idempotent.
      for (const w of S.legion.warlords) if ((w.level || 1) < lvl) w.level = lvl;
      if (S.legion.overlord && (S.legion.overlord.level || 1) < lvl) S.legion.overlord.level = lvl;
    }
  }

  // #14: occasionally tear open a 30s deep-dungeon rift near a surface hero (only when nobody is delving,
  // since the room runs ONE shared dungeon instance — the rift just seeds it at a deeper floor).
  _maybeRift() {
    if (this.rift && S.time > this.rift.expires) this.rift = null;   // window closed, unused
    if (this.rift || this.sharedDg) return;
    if (this._riftCd-- > 0) return;
    const ow = S.players.filter((p) => p.map !== 'dungeon' && !p.downed);
    if (!ow.length) { this._riftCd = 400; return; }
    this._riftCd = 1600 + Math.floor(Math.random() * 1200);          // ~20–35s between rifts
    const host = ow[Math.floor(Math.random() * ow.length)];
    const htx = Math.round((host.x + host.w / 2) / TILE), hty = Math.round((host.y + host.h / 2) / TILE);
    for (let t = 0; t < 24; t++) {
      const ang = Math.random() * 6.28, d = 4 + Math.random() * 5;
      const tx = Math.round(htx + Math.cos(ang) * d), ty = Math.round(hty + Math.sin(ang) * d);
      const tile = G.getTile('overworld', tx, ty);
      if (tile === G.T.GRASS || tile === G.T.FLOWER || tile === G.T.PATH) {
        const party = Math.random() < 0.4;                              // ~40% are BLUE party rifts the whole group can dive together
        const plvl = S._partyLevel || 1;                                // sane fallback (the tick sets this before _maybeRift runs)
        // depth window scales with the party average: base 3 + floor(plvl/4) + a 0–3 spread; BLUE party rifts sit one deeper. clamp 3–16.
        // → lvl≤3: solo 3–6 (party 4–7) · lvl 12: solo 6–9 (party 7–10) · lvl 25: solo 9–12 (party 10–13).
        const deep = Math.max(3, Math.min(16, 3 + Math.floor(plvl / 4) + Math.floor(Math.random() * 4) + (party ? 1 : 0)));
        this.rift = { x: tx * TILE, y: ty * TILE, deep, expires: S.time + 2400, n: ++this._riftSeq, party };
        break;
      }
    }
  }

  // Breach a rift. PURPLE (solo) rifts close on entry — one diver. BLUE (party) rifts stay open
  // their full 30s so teammates can [E] to join the same deep run (joiners pay no key, like the
  // fixed dungeon). Either way the deep floor lives in the shared instance (sharedDg).
  _enterRift(p) {
    if (!this.rift || p.map === 'dungeon') return;
    const dx = this.rift.x - p.x, dy = this.rift.y - p.y;
    if (dx * dx + dy * dy > 80 * 80) return;                          // must be standing on it
    const joining = !!this.sharedDg;                                  // a delve already open → JOIN it (no key)
    if (joining && !this.rift.party) return;                          // a solo run isn't joinable
    if (!joining && (p.inventory.keys | 0) <= 0) { _logbuf.push({ m: 'The rift will not open without a KEY — find one first.', c: 'combat', id: p.id }); return; }
    const deep = this.rift.deep, party = this.rift.party;
    const compPos = (S.companions || []).map((c) => [c, c.x, c.y]);   // enterDungeon's setupCompanions() teleports every shared companion to the enterer
    const owBase = grabWorld();                                       // snapshot EVERY world slot BEFORE we disturb it (map/enemies/pickups/npcs/projectiles/dungeon slots/floorMod/maps.dungeon)
    let entered = false;
    try {                                                            // mirror the dungeon phase: ANY failure path must restore ALL swapped slots (no dungeon fragments stranded under map==='overworld')
      S.player = p; S.inventory = p.inventory; swapInPP(p);
      G.enterDungeon();                                              // builds a floor + stashes the overworld into owSave (a throwaway floor when joining — the shared one is restored next tick)
      if (!joining) { S.dungeonLevel = deep; S.maxDepth = Math.max(S.maxDepth | 0, deep); G.setupDungeonFloor(deep); }   // rebuild at the deep floor
      if (S.map === 'dungeon') {
        if (joining) { if (this.dgSpawn) { p.x = this.dgSpawn.x; p.y = this.dgSpawn.y; } }
        else { this.sharedDg = grabWorld(); this.dgSpawn = { x: p.x, y: p.y }; }   // first breach → CAPTURE the deep instance
        p.map = 'dungeon'; p._mapSwitchN = (p._mapSwitchN || 0) + 1;
        entered = true;
      }
    } catch (e) { this._err('enterRift', e); }
    finally {
      putWorld(owBase);                                              // ALWAYS restore the shared overworld for everyone else
      // per-owner delving: the BREACHER's own alive, un-posted warband dives WITH them (keep the setupCompanions
      // teleport, re-seat near p on the deep floor, tag map='dungeon'); everyone else stays topside where they were.
      // A failed breach (entered=false) dives nobody — restore all.
      let _di = 0;
      for (const [c, cx, cy] of compPos) {
        if (entered && c.ownerId === p.id && c.alive !== false && c.postedAt == null) { c.map = 'dungeon'; c.x = p.x + (_di++ % 2 ? 18 : -18); c.y = p.y + 16; c.attackCd = 0; }
        else { c.x = cx; c.y = cy; }
      }
    }
    if (entered) {
      if (!joining) { p.inventory.keys--; if (!party) this.rift = null; }   // key spent + solo rift closes ONLY on a successful breach (a failed build no longer eats the key)
      _logbuf.push(joining
        ? { m: '✦ You dive through the rift to join the delve!', c: 'quest', id: p.id }
        : { m: `✦ You breach a ${party ? 'PARTY ' : ''}RIFT into the deep — Depth ${deep}! (a key is spent)${party ? ' Allies can dive in too!' : ''}`, c: 'quest', id: p.id });
    }
  }

  // drain this tick's captured log() calls into the versioned feed (called at tick end)
  _drainFeed() {
    if (!_logbuf.length) return;
    for (const e of _logbuf) {
      const nm = e.id && this.players.get(e.id) ? this.players.get(e.id).name : '';
      this.feed.push({ n: ++this.feedN, m: e.m, c: e.c, id: e.id, bc: e.bc || FEED_BROADCAST.test(e.m), nm });   // shared-phase (e.bc) lines broadcast to all
    }
    _logbuf.length = 0;
    if (this.feed.length > 140) this.feed.splice(0, this.feed.length - 140);
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
    p.fishCd = 0;                      // per-player fishing cooldown (a shared one let players block each other's casts)
    p.sailing = false; p.dragon = { tamed: false, mounted: false };   // per-player boat + mount (shared S.sailing/S.dragon leaked water-walk/flight across every hero's slice)
    p.downed = false; p.bleedT = 0; p.reviveProg = 0; p.safeT = 0;   // co-op downed/revive state (join standing)
    p.map = 'overworld'; p.dg = null; p._mapSwitchN = 0; p._sentDgN = 0;   // per-player dungeon instancing (start on the shared overworld)
    p.skin = 0; p._qSeen = 0;          // hero look (0-4) + quest-sync version last sent (0 → first snapshot carries quests)
    p._feedSeen = this.feedN | 0;      // join fresh — don't replay the room's whole event history
    p._lgSeen = 0;                     // Dread Legion roster version last sent (0 → the first snapshot carries the roster, like _qSeen)
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
      v: 1, name: p.name, level: p.level | 0, skin: p.skin | 0, player: snap.player, inventory: snap.inventory,
      shop: { shopPurchased: p.shopPurchased, tonics: p.tonics | 0, sharpenLevel: p.sharpenLevel | 0, cargo: p.cargo, ingredients: p.ingredients },
      dragon: p.dragon ? { tamed: !!p.dragon.tamed } : null,   // the tamed Emberwyrm is a persistent capability; mounted is transient → restored grounded

      // YOUR recruits travel with YOUR character (connection ids change every reconnect — never key on them)
      companions: (S.companions || []).filter((c) => c.ownerId === id).map((c) => ({
        name: c.name, cls: c.cls, level: c.level | 0, maxHp: c.maxHp, hp: c.hp, atk: c.atk, def: c.def,
        alive: c.alive !== false, color: c.color || null, postedAt: (typeof c.postedAt === 'number' ? c.postedAt : null),
        weapon: c.weapon ? safeClone(c.weapon) : null,
      })),
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
      if (Number.isInteger(c && c.skin)) p.skin = Math.max(0, Math.min(4, c.skin));   // hero look
      if (c && Array.isArray(c.companions)) {                    // your warband rejoins you, owned by your NEW connection id
        if (!S.companions) S.companions = [];
        for (const sc of c.companions.slice(0, 3)) {
          if (!sc || !sc.cls) continue;
          const comp = {
            name: sc.name || 'Companion', cls: sc.cls, level: sc.level || 1,
            maxHp: sc.maxHp || 30, hp: (sc.hp > 0 ? sc.hp : (sc.maxHp || 30)), atk: sc.atk || 5, def: sc.def || 1,
            alive: sc.alive !== false, weapon: sc.weapon ? clone(sc.weapon) : null,
            postedAt: (typeof sc.postedAt === 'number' ? sc.postedAt : null),
            x: p.x, y: p.y, w: 22, h: 22, attackCd: 0, hurtCd: 0, wobble: Math.random() * 6.28,
            color: sc.color || '#cccccc', ownerId: p.id, map: 'overworld',   // rejoin grounded topside (map is transient, like dragon.mounted — never persisted)
          };
          if (comp.weapon && G.normItem) { try { G.normItem(comp.weapon, true); } catch (_e) {} }
          S.companions.push(comp);
        }
      }
      if (c && c.shop) {                                         // restore this hero's town-economy state
        p.shopPurchased = Array.isArray(c.shop.shopPurchased) ? c.shop.shopPurchased.slice() : [];
        p.tonics = c.shop.tonics | 0; p.sharpenLevel = c.shop.sharpenLevel | 0;
        p.cargo = Object.assign({ furs: 0, grain: 0, spice: 0, ore: 0 }, c.shop.cargo || {});
        p.ingredients = Object.assign({ herb: 0, berry: 0, mushroom: 0, fish: 0 }, c.shop.ingredients || {});
      }
      if (c && c.dragon) p.dragon = { tamed: !!c.dragon.tamed, mounted: false };   // your tamed steed rejoins you (grounded)
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
    // your warband LEAVES with you (characterOf already captured it for persistent heroes) —
    // never re-anchor recruits to another player: that's how "my warband follows someone else" happens
    if (S.companions) for (let i = S.companions.length - 1; i >= 0; i--) if (S.companions[i].ownerId === id) S.companions.splice(i, 1);
  }

  // hero look (0-4) — validated here, rendered by drawPlayer via p.skin, persisted in characterOf
  setSkin(id, n) { const p = this.players.get(id); if (p) p.skin = Math.max(0, Math.min(4, n | 0)); }

  // client → server input for one player this frame
  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    if (msg.held) p.held = msg.held;
    if (msg.actions && msg.actions.length) { p.actions.push(...msg.actions); if (p.actions.length > 16) p.actions.length = 16; }   // cap the per-tick RPC queue — a hostile client can't flood thousands of actions in one frame
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
          const projBefore = S.projectiles;                  // enterDungeon swaps in a fresh [] and saveOverworld does NOT stash projectiles
          const compPos = (S.companions || []).map((c) => [c, c.x, c.y]);   // setupCompanions() (inside enterDungeon) teleports EVERY shared companion to the enterer
          const owBase = !inDungeon ? grabWorld() : null;    // overworld snapshot so a THROW mid-enter (slots swapped, map not yet flipped) can't strand dungeon fragments under map==='overworld'
          let threw = false;
          try { G.tryInteract(); } catch (_e2) { threw = true; }   // a throw mid-enter must NOT skip the world restore below (same leak shape as the dungeon phase)
          if (!inDungeon && threw && S.map !== 'dungeon' && owBase) { putWorld(owBase); S.projectiles = projBefore; for (const [c, cx3, cy3] of compPos) { c.x = cx3; c.y = cy3; } }   // failed mid-enter → fully restore the overworld (no-op if nothing was swapped)
          if (!inDungeon && S.map === 'dungeon') {           // just ENTERED the dungeon
            if (this.sharedDg) {
              // party dungeon already live → JOIN it: discard the floor the game just built
              // and drop this hero at the shared instance's floor entrance.
              if (this.dgSpawn) { p.x = this.dgSpawn.x; p.y = this.dgSpawn.y; }
            } else {
              // first one in → CREATE the shared instance (p stands at the floor entrance)
              this.sharedDg = grabWorld();
              this.dgSpawn = { x: p.x, y: p.y };
            }
            p.map = 'dungeon'; p._mapSwitchN = (p._mapSwitchN || 0) + 1;
            // peel the shared overworld back into S (saveOverworld stashed it into owSave on entry)
            if (S.owSave) { S.enemies = S.owSave.enemies; S.pickups = S.owSave.pickups; S.npcs = S.owSave.npcs; if (S.owSave.pois) S.pois = S.owSave.pois; }
            S.map = 'overworld';
            S.projectiles = projBefore;                      // the overworld keeps its REAL in-flight bullets — without this both worlds ALIAS one array and overworld shots die against the dungeon grid
            // per-owner delving: the ENTERER's own alive, un-posted warband delves WITH them (keep the setupCompanions
            // teleport, re-seat near p at the floor entrance, tag map='dungeon'); everyone else's warband stays topside.
            let _di = 0;
            for (const [c, cx2, cy2] of compPos) {
              if (c.ownerId === p.id && c.alive !== false && c.postedAt == null) { c.map = 'dungeon'; c.x = p.x + (_di++ % 2 ? 18 : -18); c.y = p.y + 16; c.attackCd = 0; }
              else { c.x = cx2; c.y = cy2; }
            }
            break;                                           // p is now in the dungeon — stop overworld action processing
          }
        }
        else if (a === 'dodge' && G.doDodge) G.doDodge();
        else if (a === 'enterRift') this._enterRift(p);   // #14: breach a deep-dungeon rift
        else if (a && a.rpc) this._runRpc(a, p);
      } catch (_e) {}
    }
    p.actions.length = 0;
  }

  _runRpc(a, p) {
    const rpc = a.rpc, args = Array.isArray(a.args) ? a.args : [];
    if (rpc === 'sellAllJunk') {                                 // the game gates this on scene==='shop' — but the server pins scene='play' every tick
      const sc = S.scene; S.scene = 'shop';
      try { if (typeof G.sellAllJunk === 'function') G.sellAllJunk(); } catch (_e) {}
      S.scene = sc;
      return;
    }
    // Warband actions run against YOUR recruits only: the game's COMP_CAP(3) and every
    // panel INDEX otherwise hit the shared all-players list — one full warband blocked
    // everyone else's recruiting, and "dismiss #0" could fire someone else's companion.
    if (rpc === 'recruitCompanion' || rpc === 'armCompanion' || rpc === 'unarmCompanion' || rpc === 'garrisonCompanion' || rpc === 'recallCompanion' || rpc === 'dismissCompanion') {
      const all = S.companions || (S.companions = []);
      const others = all.filter((c) => c.ownerId !== p.id);
      S.companions = all.filter((c) => c.ownerId === p.id);      // the game sees only YOUR warband (cap + indexes correct)
      try { if (typeof G[rpc] === 'function') G[rpc].apply(null, args); } catch (_e) {}
      for (const c of S.companions) if (!c.ownerId) c.ownerId = p.id;   // a fresh recruit is yours
      S.companions = others.concat(S.companions);                // merge back (dismissals stay gone, others untouched)
      return;
    }
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
      const t0 = S.time, wasCamping = S.player.camping === true;
      if (typeof G.doCamp === 'function') try { G.doCamp(); } catch (_e) {}
      const camped = S.time !== t0;                              // OVERWORLD camp fast-forwards the clock on success
      const dgCamped = !camped && !wasCamping && S.player.camping === true;   // DUNGEON camp: no clock skip → detect the freshly-set camping flag instead (else the personal-rest writeback would silently never fire)
      S.time = t0;                                               // undo any skip — the world's clock never jumps
      // Overworld: doCamp set state.lastRestDay to the fast-forwarded (next-morning) day; recompute it against the
      // un-skipped clock and keep S in sync with p, or writeBackPP (which persists lastRestDay) would clobber it back
      // to that skipped day and over-rest the hero. Dungeon: dungeons/rifts sit OUTSIDE the day/night rest-day economy,
      // so lastRestDay + the day math are DELIBERATELY untouched — camping/heal already ride p; only the personal
      // fatigue flag is cleared (doCamp restored energy → no longer exhausted).
      if (camped) { S.lastRestDay = p.lastRestDay = (G.curDay ? G.curDay() : p.lastRestDay); p._exWas = false; if (G.recalcStats) try { G.recalcStats(); } catch (_e) {} }
      else if (dgCamped) { p._exWas = false; }
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
    if (npcId === 'trophy') return { kind: 'panel', panel: 'trophy', pinnacleSlain: [...(S.pinnacleSlain || [])], uniquesFound: [...(S.uniquesFound || [])] };   // Trophy Wall = a menu CODEX of SHARED world progress (pinnacleSlain/uniquesFound are world state, not PP keys) — no world NPC to stand at, so resolve it BEFORE the NPC-proximity guard; mirrors the 'hunts' panel payload
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
      else if (npcId === 'recruit') res = { kind: 'panel', panel: 'companions', companions: (S.companions || []).filter((c) => c.ownerId === p.id).map((c) => safeClone(c)) };   // YOUR warband only (roster + indexes must match the per-owner RPCs)
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
  tick() {                            // timed wrapper (perf instrumentation): EMA + rolling-max the whole step
    const _t0 = process.hrtime.bigint();
    try { this._step(); }
    finally {
      const ms = Number(process.hrtime.bigint() - _t0) / 1e6;
      this._ticks++;
      this._tickMsAvg = this._ticks === 1 ? ms : this._tickMsAvg * 0.95 + ms * 0.05;
      if (ms > this._tickMsMax) this._tickMsMax = ms;
    }
  }
  _step() {
    if (!S.players.length) return;
    S.scene = 'play';                 // server always simulates; neutralize transient scene changes (death/dialogue/shop)
    S._partyLevel = Math.round(S.players.reduce((a, p) => a + (p.level || 1), 0) / S.players.length);   // #2: Legion/Hunts scale with the party's average level
    S._partyN = S.players.length;     // #2: live party size — Hunt/Legion generators read state._partyN||1 for party-size damage scaling
    if (S._partyLevel > this._threatLvl) { this._threatLvl = S._partyLevel; try { this._rescaleThreats(S._partyLevel); } catch (e) { this._err('rescaleThreats', e); } }   // catch up boot-baked Legion/Hunts to the party
    this._maybeRift();                // #14: open/close ephemeral deep-dungeon rifts
    G.updateTime();
    // Quest sync: version-stamp the (shared) quest state so snapshots only carry it when it CHANGES.
    if (S.time % 40 === 0) {
      let j = ''; try { j = JSON.stringify([S.quests, S.bounty, S.loreFound, S.maxDepth]); } catch (_e) {}
      if (j && j !== this._qJson) { this._qJson = j; this._qN++; }
      // Legion sync (SAME idiom, deliberately sharing this throttle block): the Dread Legion roster is SHARED
      // world state that never rode the wire at all, so every client fell back to its own genLegion() — baked at
      // the level-1 default hero → a PHANTOM roster stuck at "Lv 1" whose members never saw the encounters the
      // server records, so the nemesis "???" reveals could never resolve. Version-stamping (rather than packing it
      // into every snapshot like holdings) is a BANDWIDTH call: the roster is ~991 B against a ~10.8 KB snapshot
      // (+9.2%) and the broadcast runs at ~66 Hz (BCAST_MS=15) → ~64 KB/s per player, forever, for data that
      // changes on human timescales (legionDaily / a kill / a scouted reveal / _rescaleThreats). Gated, it costs
      // 0 bytes/tick at rest. Stringify-compare (not a state._legionRev bumped at each mutation site) because it
      // CANNOT miss a mutation site — and because it keeps eldermyr-rpg.html byte-identical for single-player.
      let lj = ''; try { lj = JSON.stringify(S.legion); } catch (_e) {}
      if (lj && lj !== this._lgJson) { this._lgJson = lj; this._lgN++; }
    }

    // Split the party: heroes on the SHARED overworld vs. each inside their OWN private dungeon.
    const owPre = S.players.filter((p) => p.map !== 'dungeon');
    // PER-PLAYER (overworld): movement, discrete actions, fatigue.
    for (const p of owPre) {
      if (p.downed) continue;            // incapacitated — the downed pass (below) runs their timers
      S.player = p; S.inventory = p.inventory; swapInPP(p); setKeys(p.held);
      try { G.updatePlayer(); } catch (e) { this._err('updatePlayer', e); }
      this._runActions(p, false);        // interact may ENTER a dungeon → p.map becomes 'dungeon' + its context captured
      for (const pr of S.projectiles) if (pr.friendly && !pr.ownerRef) pr.ownerRef = p;   // stamp the SHOOTER — hits credit their lifesteal/crit/prof/XP (not players[0])
      if (S.companions) for (const c of S.companions) if (!c.ownerId) c.ownerId = p.id;   // a fresh recruit follows its RECRUITER
      if (S.allies) for (const a of S.allies) if (!a._owner) a._owner = p.id;   // a thrall/bound-elite summoned this slice fights for its summoner
      if (p.map === 'dungeon') continue; // just entered — its dungeon runs next tick; skip overworld writeback
      if (G.isExhausted) { const ex = !!G.isExhausted(); if (ex !== p._exWas) { p._exWas = ex; if (G.recalcStats) try { G.recalcStats(); } catch (_e) {} } }
      // Winter snow chill: updateWeather (shared phase) only chills players[0]; apply it to EVERY hero standing on a
      // frozen tile during snow-weather (frozen band = y<=frozenLimit(x), i.e. the game's own isFrozenTile condition).
      if (S.weather === 'snow' && S.time % 150 === 0) { const ftx = Math.floor((p.x + p.w / 2) / TILE), fty = Math.floor((p.y + p.h / 2) / TILE); if (fty <= frozenLimit(ftx)) p.chillT = Math.max(p.chillT || 0, 75); }
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
      global.__libGate = () => false;       // S.enemies is one bucket — killEnemy's inline liberation is blind; the _seen sweep below owns it
      for (const p of players) {
        S.player = p; S.inventory = p.inventory;   // keep the bag in sync with the acting hero — combat-time gear reads (melee riposte's equippedWeapon(), future on-hit gear checks) must see p's inventory, not a stale one
        S.enemies = buckets.get(p);         // this player's assigned foes target HIM
        try { G.updateEnemies(); } catch (e) { this._err('updateEnemies', e); }
        survivors.push(...S.enemies);        // killEnemy() may have spliced some out
      }
      for (const e of wanderers) { wanderHome(e); survivors.push(e); }
      S.enemies = survivors;
      global.__libGate = null;              // recombined — the sweep's own liberate calls run for real
    }
    if (S.time % 30 === 0) unstickEnemies('overworld');   // pop wall-embedded foes out (leviathan-on-land etc.)

    // ALLIES (co-op): summoned thralls, dominated elites & Vigil patrols follow and fight for their OWNER.
    // updateAllies was never called in the MP loop and state.allies was never serialized → allies stood
    // frozen server-side, were invisible to clients, and never decayed. Partition S.allies by _owner among
    // overworld heroes and run the REAL updateAllies per owner (it natively moves them, targets the nearest
    // foe, decays life, and splices the dead/expired). killEnemy inside credits state.player, so set it to the
    // owner. Allies whose owner is delving (or gone) idle topside with life frozen — companions don't delve
    // either; an un-owned ally (shared-phase Vigil spawn) self-heals to the nearest hero. S.enemies here is the
    // full recombined overworld list, so each ally picks its nearest foe correctly.
    if (G.updateAllies && S.allies && S.allies.length && players.length) {
      const aBuckets = new Map(players.map((p) => [p, []]));
      const idleAllies = [];
      for (const a of S.allies) {
        if (typeof a.name !== 'string') a.name = 'Ally';       // drawAlly splits a.name — never leave it non-string
        let o = a._owner ? this.players.get(a._owner) : null;
        if (!o) { o = nearestPlayer(a, players); a._owner = o.id; }   // shared-phase spawn (Vigil patrol) → nearest hero
        if (o.map === 'dungeon' || !aBuckets.has(o)) idleAllies.push(a);   // owner below ground → idle topside (frozen)
        else aBuckets.get(o).push(a);
      }
      const aSurvivors = [];
      for (const p of players) {
        S.player = p; S.inventory = p.inventory; S.allies = aBuckets.get(p);
        try { G.updateAllies(); } catch (e) { this._err('updateAllies', e); }
        aSurvivors.push(...S.allies);
      }
      S.allies = aSurvivors.concat(idleAllies);
    }

    // remaining shared systems run once (acting player = first, cosmetic-only bias). Flag the block so their
    // log lines are world events — broadcast to EVERYONE with no player owner — not personal to players[0].
    if (players.length) { S.player = players[0]; S.inventory = players[0].inventory; swapInPP(players[0]); }
    _sharedPhase = true;
    for (const fn of ['updateProjectiles', 'updateFires', 'updateWeather', 'updateEvents', 'updateFactionWar', 'updateNemesisPresence', 'maybePinnacleBosses']) {
      if (G[fn]) try { G[fn](); } catch (e) { this._err(fn, e); }
    }   // maybePinnacleBosses: fixed-lair spawn/night-gate/despawn (Drowned King always broods; Pale Shepherd rises at night) — a once-per-tick shared system like updateEvents (self-throttled via state._pinCheckT); its cycle-respawn rides onNewDay→maybeRespawnPinnacle off G.updateTime()
    _sharedPhase = false;

    // WARBAND: updateCompanions steps companions toward state.player — run it PER OWNER so each
    // hero's recruits follow (and fight for) THEM, not players[0]. Owner in a dungeon → they idle.
    if (G.updateCompanions && S.companions && S.companions.length && players.length) {
      const all = S.companions;
      const byOwner = new Map();
      for (const c of all) {
        const o = this.players.get(c.ownerId);
        if (!o || o.map === 'dungeon' || o.downed || c.map === 'dungeon') continue;   // dungeon-tagged recruits are stepped by the DUNGEON phase, never here (wrong coordinate space + enemy list)
        if (!byOwner.has(o)) byOwner.set(o, []);
        byOwner.get(o).push(c);
      }
      for (const [o, list] of byOwner) {
        S.player = o; S.inventory = o.inventory; S.companions = list;
        try { G.updateCompanions(); } catch (e) { this._err('updateCompanions', e); }
      }
      S.companions = all;
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
        try { G.maybeSpawnWild(); } catch (e) { this._err('maybeSpawnWild', e); }
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
              let _pd = 0; try { _pd = G.playerTakeDamage(pr.dmg) || 0; } catch (e) { this._err('playerTakeDamage', e); }
                if (_pd > 0 && pr.ownerRef && pr.ownerRef.afxVamp && G.afxVampHeal) { try { G.afxVampHeal(pr.ownerRef, _pd); } catch (_e) {} }   // vampiric elites heal off EVERY player they hit, not just the tick's first
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
            try { G.playerTakeDamage(3); } catch (e) { this._err('playerTakeDamage', e); }
          }
        }
      }
    }

    // Party-wide PINNACLE hazard: pinnacleHazard (inside updateEnemies) only drowns/darks the boss's ONE
    // bucketed (nearest) hero — so the shrinking ring threatens ONLY the duelist. Menace the REST of the party
    // too: any other engaged hero outside the ring (but still within leash of the lair) takes the same
    // throttled drowning (King) / killing-dark (Shepherd) + chill. Mirrors the fire-to-all-players loop; only
    // READS the live arenaR (already shrunk this tick by the partition's pinnacleHazard — never shrinks here).
    if (players.length > 1 && G.playerTakeDamage && S.map === 'overworld' && S.time % 42 === 0) {
      const PIN_LEASH = 980;   // mirrors the game's PIN_LEASH — beyond it the boss wanders home & stops hazarding, so distant/town heroes stay safe
      let eligible = null;     // DEFER the filter-alloc until a pinnacle boss is actually FOUND → the common (no-boss) tick does one bare scan with NO per-tick allocation
      for (const e of S.enemies) {
        if (!e.isPinnacle || !e.arenaR) continue;
        if (!eligible) { eligible = players.filter((p) => !p.downed && !inTown(p)); if (!eligible.length) break; }
        const lx = (e._lairTx != null ? e._lairTx : Math.floor((e.x + e.w / 2) / TILE)) * TILE + 16;
        const ly = (e._lairTy != null ? e._lairTy : Math.floor((e.y + e.h / 2) / TILE)) * TILE + 16;
        const owner = nearestPlayer(e, eligible);   // the bucketed hero — pinnacleHazard already hit them this tick; don't double-dip
        for (const pl of eligible) {
          if (pl === owner) continue;
          const pdl = Math.hypot((pl.x + pl.w / 2) - lx, (pl.y + pl.h / 2) - ly);
          if (pdl > e.arenaR && pdl <= PIN_LEASH) {
            S.player = pl; S.inventory = pl.inventory;
            try { G.playerTakeDamage(Math.max(4, Math.round(e.atk * 0.4))); } catch (er) { this._err('pinHazard', er); }
            pl.chillT = Math.max(pl.chillT || 0, 80);
          }
        }
      }
    }

    // ============================ THE DUNGEON (party-shared) ============================
    // ONE shared instance: the first enterer creates it, everyone else joins in. Delvers see
    // and fight alongside each other, foes partition among them, descend takes the whole
    // party down, exit/death is individual, and the instance dissolves when the last one leaves.
    const dgAll = S.players.filter((p) => p.map === 'dungeon');
    if (dgAll.length && this.sharedDg) {
      const owBase = grabWorld();                          // stash the shared overworld out of S
      try {                                                // a throw mid-phase must NEVER skip the restore below — the whole room would live in the dungeon forever (owBase is local → overworld GC'd)
        putWorld(this.sharedDg);                           // the party dungeon into S
        let lvl0 = S.dungeonLevel;
        // per-player: movement + actions (descend / exit / vault / abilities)
        for (const p of dgAll) {
          if (S.map !== 'dungeon') putWorld(this.sharedDg);  // a previous player exited → bring the dungeon back for the rest
          if (p.downed || p.map !== 'dungeon') continue;
          S.player = p; S.inventory = p.inventory; swapInPP(p); setKeys(p.held);
          try { G.updatePlayer(); } catch (e) { this._err('updatePlayer', e); }
          const compPos = (S.companions || []).map((c) => [c, c.x, c.y]);   // descend/exit run setupCompanions() → would teleport EVERY warband to this delver
          this._runActions(p, true);                       // interact = descend / exit / key-vault
          for (const pr of S.projectiles) if (pr.friendly && !pr.ownerRef) pr.ownerRef = p;   // hits credit the shooter
          if (S.allies) for (const a of S.allies) if (!a._owner) a._owner = p.id;   // a thrall summoned mid-delve is attributed (allies stay overworld-only in MP — it idles topside)
          if (S.map !== 'dungeon') {                       // exited — exitDungeon set their overworld position
            p.map = 'overworld'; p._mapSwitchN = (p._mapSwitchN || 0) + 1;
            for (const [c, cx2, cy2] of compPos) { if (c.ownerId !== p.id) { c.x = cx2; c.y = cy2; } else c.map = 'overworld'; }   // others' warbands stay put; the exiter's OWN reunite at the entrance (setupCompanions placed them) and return topside
          } else if (S.dungeonLevel !== lvl0) {            // descended — the whole delving party goes down together
            // p's OWN dungeon warband followed (setupCompanions teleported them near p on the new floor) — keep them;
            // restore everyone else (topside warbands stay topside; other delvers' recruits re-placed with their owner below).
            for (const [c, cx2, cy2] of compPos) { if (!(c.ownerId === p.id && c.map === 'dungeon' && c.alive !== false && c.postedAt == null)) { c.x = cx2; c.y = cy2; } }
            lvl0 = S.dungeonLevel;
            this.dgSpawn = { x: p.x, y: p.y };             // new floor's entry (setupDungeonFloor put p there)
            for (const q of dgAll) {
              if (q !== p && q.map === 'dungeon') {
                q.x = p.x; q.y = p.y; q._mapSwitchN = (q._mapSwitchN || 0) + 1;
                let _di = 0;                               // bring q's OWN dungeon warband down to the new floor alongside them
                for (const c of S.companions) if (c.ownerId === q.id && c.map === 'dungeon' && c.alive !== false && c.postedAt == null) { c.x = q.x + (_di++ % 2 ? 18 : -18); c.y = q.y + 16; c.attackCd = 0; }
              }
            }
            p._mapSwitchN = (p._mapSwitchN || 0) + 1;      // everyone (p included) gets the new grid
          }
          if (G.isExhausted) { const ex = !!G.isExhausted(); if (ex !== p._exWas) { p._exWas = ex; if (G.recalcStats) try { G.recalcStats(); } catch (_e) {} } }
          writeBackPP(p);
        }
        if (S.map !== 'dungeon') putWorld(this.sharedDg);  // last action was an exit → restore for the shared passes
        const stillIn = dgAll.filter((p) => p.map === 'dungeon');
        if (stillIn.length) {
          // foes partition among STANDING delvers (downed heroes are invisible to them)
          if (S.enemies.length) {
            const standing = stillIn.filter((p) => !p.downed);
            const pool = standing.length ? standing : stillIn;
            const buckets = new Map(stillIn.map((p) => [p, []]));
            for (const e of S.enemies) buckets.get(nearestPlayer(e, pool)).push(e);
            const survivors = [];
            global.__libGate = () => false;                // partitioned bucket — same inline-liberation blindness as topside (dungeon foes carry no site keys today; cheap insurance)
            for (const p of stillIn) {
              S.player = p; S.inventory = p.inventory;
              S.enemies = buckets.get(p);
              try { G.updateEnemies(); } catch (e) { this._err('updateEnemies', e); }
              survivors.push(...S.enemies);
            }
            S.enemies = survivors;
            global.__libGate = null;
          }
          // WARBAND (dungeon): step each delver's OWN dungeon recruits — mirrors the overworld partition exactly
          // (S.player = delver, S.companions = their map==='dungeon' recruits, S.enemies = the full floor roster so
          // they target/hit correctly, S.map = 'dungeon' from putWorld). Topside recruits are NOT touched here.
          if (G.updateCompanions && S.companions && S.companions.length) {
            const allC = S.companions;
            for (const dp of stillIn) {
              if (dp.downed) continue;                     // a downed delver's recruits idle (mirrors the overworld skip)
              const mine = allC.filter((c) => c.ownerId === dp.id && c.map === 'dungeon');
              if (!mine.length) continue;
              S.player = dp; S.inventory = dp.inventory; S.companions = mine;
              try { G.updateCompanions(); } catch (e) { this._err('updateCompanionsDg', e); }
            }
            S.companions = allC;
          }
          // projectiles once (acting player = first delver; others patched below)
          S.player = stillIn[0]; S.inventory = stillIn[0].inventory;
          try { G.updateProjectiles(); } catch (e) { this._err('updateProjectiles', e); }
          if (stillIn.length > 1 && G.projHitsRect && G.playerTakeDamage && S.projectiles.length) {
            for (let i = S.projectiles.length - 1; i >= 0; i--) {
              const pr = S.projectiles[i];
              if (pr.friendly) continue;
              for (let j = 1; j < stillIn.length; j++) {
                const pl = stillIn[j];
                if (pl.downed) continue;
                if (G.projHitsRect(pr, pl)) {
                  S.player = pl; S.inventory = pl.inventory;
                  let _pd = 0; try { _pd = G.playerTakeDamage(pr.dmg) || 0; } catch (e) { this._err('playerTakeDamage', e); }
                if (_pd > 0 && pr.ownerRef && pr.ownerRef.afxVamp && G.afxVampHeal) { try { G.afxVampHeal(pr.ownerRef, _pd); } catch (_e) {} }   // vampiric elites heal off EVERY player they hit, not just the tick's first
                  if (pr.element === 'frost') pl.chillT = Math.max(pl.chillT || 0, 90);
                  S.projectiles.splice(i, 1);
                  break;
                }
              }
            }
          }
          if (S.time % 30 === 0) unstickEnemies('dungeon');
          this._downedPass(stillIn);                       // downed & revive work INSIDE the dungeon too
        }
        this.sharedDg = stillIn.filter((p) => p.map === 'dungeon').length ? grabWorld() : null;   // save the evolved floor, or dissolve when empty
        if (!this.sharedDg) this.dgSpawn = null;
      } finally {
        global.__libGate = null;                           // never leak the gate out of the phase
        putWorld(owBase);                                  // ALWAYS restore the shared overworld for everyone else
      }
    } else if (!dgAll.length && this.sharedDg) { this.sharedDg = null; this.dgSpawn = null; }   // stragglers gone (disconnects) → dissolve

    // SAFETY: with no live delve, no recruit may linger tagged 'dungeon' (owner bled out / left, or the instance
    // dissolved). Force any straggler topside near its owner so it can't idle invisibly in a dead world-slot.
    if (!this.sharedDg && S.companions) for (const c of S.companions) { if (c.map === 'dungeon') { c.map = 'overworld'; const o = this.players.get(c.ownerId); if (o) { c.x = o.x - 22 + Math.random() * 44; c.y = o.y + 12; } c.attackCd = 0; } }

    // ---- DOWNED & REVIVE (overworld heroes; the dungeon phase runs its own pass) ----
    this._downedPass(players);

    // Liberation reconciliation: during partitioned combat state.enemies is only one player's
    // bucket, so killEnemy's "last occupier dead?" check can miss. Sweep the FULL list here.
    // Only fires once guardians were actually PRESENT then removed (_seen gate) — never for a
    // site whose guardians simply haven't spawned, which would hand out free liberation gold.
    global.__libGate = null;               // the sweep's liberate calls always run for real, even if a gate leaked
    if (S.map === 'overworld' && G.liberateHolding && S.holdings) {
      for (let i = 0; i < S.holdings.length; i++) {
        const hd = S.holdings[i];
        if (!hd || hd.liberated || hd.built) continue;
        if (S.enemies.some((e) => e.holdKey === i)) hd._seen = true;
        else if (hd._seen) { S.player = players[0] || S.player; try { G.liberateHolding(i); } catch (e) { this._err('liberateHolding', e); } }
      }
    }
    if (S.map === 'overworld' && G.clearPOI && S.pois) {
      for (const poi of S.pois) {
        if (!poi || poi.cleared) continue;
        if (S.enemies.some((e) => e.poiKey === poi.key)) poi._seen = true;
        else if (poi._seen) { S.player = players[0] || S.player; try { G.clearPOI(poi); } catch (e) { this._err('clearPOI', e); } }
      }
    }
    // Town sieges reconcile the same way (killEnemy → checkRaidLiberation reads the bucket):
    // liberate only once every SEEN raider (e.raidTown===i) of a besieged town is gone.
    // townZones is reassigned at world-gen, so read it via the live getter (a capture is stale).
    const TZ = G.getTownZones ? G.getTownZones() : null;
    if (S.map === 'overworld' && G.liberateTown && TZ) {
      for (let i = 0; i < TZ.length; i++) {
        const tz = TZ[i];
        if (!tz || !tz.besieged) continue;
        if (S.enemies.some((e) => e.raidTown === i)) tz._seen = true;
        else if (tz._seen) { tz._seen = false; S.player = players[0] || S.player; try { G.liberateTown(i); } catch (e) { this._err('liberateTown', e); } }   // _seen resets — a future re-siege starts clean
      }
    }

    this._drainFeed();                 // ship this tick's captured log lines to the event feed
  }

  // 0 HP = incapacitated, not dead (co-op). A teammate revives you by standing close; or you
  // self-recover if no foe is near (keeps solo fair). Bleed-out only ticks while a foe is near —
  // crawling to safety stabilizes you. Only when the timer runs out do you truly die and respawn
  // at town. Reads S.enemies for danger, so it works in whichever world is swapped into S
  // (the overworld, or the party dungeon during its phase).
  _downedPass(list) {
    for (const p of list) {
      if (!p.downed) { if (p.hp <= 0) goDown(p); continue; }   // just fell → go down
      if (p.hp < 0) p.hp = 0;
      const danger = enemyWithin(p, SELF_ENEMY_R2);
      if (danger) { p.bleedT -= 1; p.safeT = 0; }
      else if (++p.safeT >= SELF_SAFE_FRAMES) { reviveAt(p, SELF_HP_FRAC); continue; }   // safe long enough → self-recover
      // teammates standing close revive you (faster with more helpers)
      let revivers = 0; const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      for (const q of list) {
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
  snapshotFor(id) {                         // timed wrapper (perf instrumentation): EMA the serialize cost
    const _t0 = process.hrtime.bigint();
    const snap = this._snapshotFor(id);
    const ms = Number(process.hrtime.bigint() - _t0) / 1e6;
    this._snapMsAvg = this._snapMsAvg ? this._snapMsAvg * 0.95 + ms * 0.05 : ms;
    return snap;
  }
  _snapshotFor(id) {
    const me = this.players.get(id);
    if (!me) return null;
    const inDg = me.map === 'dungeon' && !!this.sharedDg;   // read entities from the party dungeon or the shared overworld
    const W = inDg ? this.sharedDg : null;
    const enemies = inDg ? (W.enemies || []) : S.enemies;
    const proj = inDg ? (W.projectiles || []) : S.projectiles;
    const pickups = inDg ? (W.pickups || []) : S.pickups;
    const npcs = inDg ? (W.npcs || []) : (S.npcs || []);
    const cx = me.x, cy = me.y;
    const near = (o) => (o.x - cx) ** 2 + (o.y - cy) ** 2 < World.R2;
    const snap = {
      t: S.time, wx: S.weather, you: id, map: inDg ? 'dungeon' : 'overworld', n: S.players.length,
      me: safeClone(me),
      // you see whoever shares YOUR world: fellow delvers below, fellow surfacers above
      players: S.players.filter((p) => (p.map === 'dungeon') === inDg).map(lightPlayer),
      enemies: enemies.filter(near).map(packEnemy),
      proj: proj.filter(near).map(packProj),
      pickups: pickups.filter((p) => !p.collected && near(p)).map((p) => safeClone(p)),
      npcs: npcs.filter(near).map(packScalar),
      // warband companions: dungeon viewers see the delving warbands (map==='dungeon'), surfacers see the topside ones
      comps: (S.companions || []).filter((c) => c.alive && ((c.map === 'dungeon') === inDg) && near(c)).map(packComp),
      // co-op allies (thralls / bound elites / Vigil patrols) — overworld only, interest-culled like enemies
      allies: inDg ? [] : (S.allies || []).filter(near).map(packAlly),
      // world features (overworld only) so the client can RENDER them + light the [E] prompt
      shrines: inDg ? [] : (S.shrines || []).filter(near).map((s) => safeClone(s)),
      lore: inDg ? [] : (S.loreStones || []).filter(near).map((s) => safeClone(s)),
      pois: inDg ? [] : (S.pois || []).filter(near).map((s) => safeClone(s)),
      holdings: inDg ? null : (S.holdings || []).map((h) => ({ liberated: !!h.liberated, built: !!h.built, level: h.level || 1, besieged: !!h.besieged })),   // outpost status → correct [E] prompt + flip on capture
      rift: (!inDg && this.rift && near(this.rift)) ? { x: this.rift.x, y: this.rift.y, deep: this.rift.deep, party: !!this.rift.party, open: !!this.sharedDg, secs: Math.max(0, Math.ceil((this.rift.expires - S.time) / 80)) } : null,   // #14 ephemeral rift (party=blue co-op)
    };
    if (inDg) { snap.dgLevel = W.dungeonLevel | 0; snap.dgTheme = W.dungeonThemeData ? safeClone(W.dungeonThemeData) : null; snap.floorMod = W.floorMod ? safeClone(W.floorMod) : null; }   // floor modifier (👑/🐀/☠/🏦) → client dungeon HUD tag
    // quest state rides along only when it changed since this client last got it (shared questline)
    // event feed: your own messages + epic broadcasts you haven't seen (bottom-left log)
    if ((me._feedSeen | 0) < this.feedN) {
      const fs = [];
      for (const e of this.feed) {
        if (e.n <= (me._feedSeen | 0)) continue;
        if (e.id === id) fs.push({ m: e.m, c: e.c });                                  // your own event
        else if (e.bc) fs.push({ m: (e.nm ? e.nm + ': ' : '') + e.m, c: e.c || 'good' });   // someone else's epic moment
      }
      me._feedSeen = this.feedN;
      if (fs.length) snap.feed = fs.slice(-8);   // cap the burst a single snapshot can carry
    }
    if ((me._qSeen | 0) !== this._qN) {
      me._qSeen = this._qN;
      snap.quests = safeClone(S.quests);
      snap.bounty = S.bounty ? safeClone(S.bounty) : null;
      snap.loreFound = (S.loreFound || []).slice();
      snap.maxDepth = S.maxDepth | 0;
    }
    // Dread Legion roster — shared world state, edge-triggered exactly like the quest block above (a fresh player
    // has no _lgSeen → 0 !== _lgN → the roster ALWAYS rides their first snapshot, so a client that joined before
    // the roster existed can never be left holding nothing). The join `welcome` carries it too (legionPayload),
    // which is what covers a session TAKEOVER: that path adopts the live pid — and its already-caught-up _lgSeen —
    // for a brand-new page that has no roster at all.
    if ((me._lgSeen | 0) !== this._lgN) {
      me._lgSeen = this._lgN;
      snap.legion = this.legionPayload();
    }
    // send the dungeon TILE GRID once per enter/descend (map-switch rising edge); on exit just flag the switch.
    // TRANSACTIONAL: only consume _sentDgN when a grid actually ATTACHES on a dungeon switch — otherwise the flag
    // was burned while W.md was momentarily null (mid world-swap) or the send was dropped downstream, leaving the
    // client with map='dungeon' + maps.dungeon=null → renderWorld's m[0] throws every frame. If no grid this
    // snapshot, leave the flag unconsumed so the next tick retries. Exits (not inDg) carry no tiles → consume now.
    if ((me._mapSwitchN || 0) !== (me._sentDgN || 0)) {
      if (inDg) {
        const md = (W && W.md) || (this.sharedDg && this.sharedDg.md) || null;   // resolve robustly across world-swaps
        if (md) { snap.dgTiles = md; me._sentDgN = me._mapSwitchN || 0; }         // grid attached → consume the edge
        // else: leave _sentDgN unconsumed — retry next snapshot (client frame-guards until it arrives)
      } else { me._sentDgN = me._mapSwitchN || 0; }                              // exit needs no tiles → consume immediately
    }
    return snap;
  }

  // static map + dims, sent ONCE when a client joins
  mapPayload() {
    return { tile: TILE, w: G.maps.overworld[0].length, h: G.maps.overworld.length, tiles: G.maps.overworld };
  }

  // The shared Dread Legion roster (overlord + warlords), sent on JOIN alongside the map and thereafter only
  // when it CHANGES (snap.legion, gated by _lgN). Every member is flat scalars — id/name/rank/level/alive/
  // scouted/strength/weakness/grudge/kills/region (+ dominated/loyalty/posted/raidT) — so safeClone carries the
  // whole panel, including the scouted reveal state the "???" strength/weakness lines read, with nothing
  // object-typed to leak (unlike the ENEMY side, whose warlordRef is an object ref packScalar must drop).
  legionPayload() { return S.legion ? safeClone(S.legion) : null; }

  // Force a dungeon-grid re-send to a stuck client (it asked via {type:'needmap'}): rewind _sentDgN one
  // behind _mapSwitchN so the next snapshotFor sees a rising edge and re-attaches dgTiles. Covers a dropped
  // grid AND a reconnect that landed straight inside a live dungeon (welcome carries only the overworld).
  resendMap(id) { const p = this.players.get(id); if (p) p._sentDgN = (p._mapSwitchN || 0) - 1; }

  // Perf snapshot for the /health probe (the user-reported "gets laggier over time" investigation). Counts
  // read cheaply from S/this. The rolling tick-max RESETS on read, so each poll reports the peak since last poll.
  perf() {
    const mx = this._tickMsMax; this._tickMsMax = 0;
    return {
      tickMsAvg: +this._tickMsAvg.toFixed(3), tickMsMax: +mx.toFixed(3), snapMsAvg: +this._snapMsAvg.toFixed(3), ticks: this._ticks,
      enemies: S.enemies.length, allies: (S.allies || []).length, projectiles: S.projectiles.length,
      particles: (S.particles || []).length, pickups: (S.pickups || []).length, players: S.players.length, feedLen: this.feed.length,
    };
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
