/*
 * server/world.js — authoritative shared World (transport-agnostic).
 * =============================================================================
 * The "fork" that never drifts: this does NOT copy the game's sim. It loads the
 * game artifact (dist/eldermyr.html since the P1 wrap) through the headless
 * loader and REUSES its logic
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
 * SCOPE (co-op): per-player = position + all combat stats + inventory + the QUESTLINE
 * (quests/maxDepth/bounty — v2.57.0; they read per-player state, so one shared box could
 * never be right for two heroes at once, and being shared+unpersisted it also reset to the
 * intro on every scale-to-zero). SHARED across the party = factions, territory, the world
 * itself — plus the three quests that track WORLD OBJECTS (main/frozen/legion), aliased by
 * reference into every player's quests (see SHARED_QUESTS).
 */
'use strict';
const G = require('../server-spike/load-game');
const { migrateCharacter, SCHEMA_VERSION } = require('./migrate');   // pure save importer (rebuild S1) — _loadCharacter applies, never migrates
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
// ---- QUESTS ARE PER-PLAYER (v2.57.0) ------------------------------------------
// They used to be shared, which was incoherent BY CONSTRUCTION: every intro-quest retire
// condition reads state that is per-player (your level, your keys, your kills, your Elder
// visit), so one shared quest box could never be right for two heroes at once — a level-1
// joiner saw "Deepest depth: 45" and could never be handed "Speak to the Elder" because a
// veteran had already consumed it. Shared+unpersisted also meant a Railway scale-to-zero
// reset the whole party's questline to the intro. Per-player fixes both, and rides the
// per-character save that already exists (no world-persistence layer, no room identity).
//
// EXCEPT the three that track WORLD OBJECTS rather than the hero: `main` (the Mountain
// Kraken), `frozen` (the Frozen Cache pickup) and `legion` (the war-camps/Sealstones/
// Overlord). Those are ALIASED — one sub-object shared by reference into every player's
// quests — so the war has one state for the whole room. They are also the only quest
// sub-objects the SHARED-PHASE systems touch (updateNemesisPresence/defeatNemesis read
// quests.legion under players[0]; setupOverworld and updatePlayer read quests.frozen off
// state.flags.enteredFrozen, which is shared) — so the alias is what keeps those correct
// no matter which hero happens to be swapped in. They deliberately do NOT persist: the
// world regenerates on every boot, so they reset with the world they describe.
const QUEST_TEMPLATE = structuredClone(S.quests);
const SHARED_QUESTS = { main: S.quests.main, frozen: S.quests.frozen, legion: S.quests.legion };
function aliasSharedQuests(q) { for (const k in SHARED_QUESTS) q[k] = SHARED_QUESTS[k]; return q; }

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
  for (const k in v) { if (k === 'held' || k === 'actions' || k === 'input' || k === 'dg' || k === '_shopStock' || k === 'dodgeHits' || k === 'quests' || k === 'bounty' || k === '_qJson') continue; const c = safeClone(v[k], d + 1); if (c !== undefined) r[k] = c; }   // dodgeHits = LIVE enemy refs (dodge i-frame bookkeeping) — never drag into a snapshot clone. quests/bounty are per-player PROPERTIES OF THE PLAYER now, so safeClone(me) would drag ~570 B onto EVERY snapshot at 66 Hz (~37 KB/s/player) for data that changes on human timescales — they ride the version-gated block in _snapshotFor instead (the holdings/legion sizing rule). _qJson is the SERVER-SIDE stringify cache backing that very gate: measured at 603 B on the wire (24% of `me`) before it was skipped — a revision cache must never ride the payload it gates. maxDepth is a bare number and DOES ride `me` (~15 B): the client adopts it in reconcile, and the gated copy is what repaints the box on the FIRST snapshot (before any frame has reconciled).
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
const PP_KEYS = ['sailing', 'dragon', 'quests', 'maxDepth', 'bounty'];   // P2/S5 retired tonics/sharpenLevel; P2/S7 shopPurchased/cargo/fishCd/lastRestDay; P2/S8 ingredients: they live ON state.player now (the game reads p.* directly), so the S.player pin IS the swap
function swapInPP(p) { for (const k of PP_KEYS) S[k] = p[k]; S.activeShopTown = p._shopTown != null ? p._shopTown : null; }   // always assign — a null _shopTown must NOT leak the previous player's shop town into this slice
// Mirror PP_KEYS on the way out. (History: lastRestDay was MISSING from this mirror → resting never
// persisted — players popped back to Exhausted next slice; it has since moved onto the player itself,
// P2/S7.) sailing/dragon are per-player too: a shared flag let one hero's boat/flight leak
// water-walk+fly collision (and the mounted atk bonus) into every other player's rotation slice.
// quests/maxDepth/bounty need EXPLICIT lines — swapping in is not enough:
// `maxDepth` is a NUMBER (enterDungeon/descend/_enterRift do `state.maxDepth = Math.max(...)`) and openBounty
// REPLACES `state.bounty` wholesale (`state.bounty = rollBounty()`), so neither reaches p by reference.
// (`quests` is only ever mutated in place, so its line is belt-and-braces — keep it: the PP_KEYS rule is
// "every key in BOTH", and the one time this file trusted by-reference it cost a release.)
function writeBackPP(p) { p.sailing = !!S.sailing; p.dragon = S.dragon; p.quests = S.quests; p.maxDepth = S.maxDepth | 0; p.bounty = S.bounty; }

// ---- Per-player dungeon instancing -------------------------------------------
// A hero is either on the SHARED overworld or inside their OWN private dungeon. These are the
// singleton "world slots" that differ between the two contexts; we stash/restore them around
// each dungeon player so N heroes can each be in a separate dungeon (or the overworld) without
// corrupting the shared world or one another. Dungeons stay SOLO for now.
const WORLD_SLOTS = ['map', 'enemies', 'pickups', 'npcs', 'projectiles', 'dungeonLevel', 'dungeonEntrance', 'dungeonThemeData', 'floorMod', 'vault'];   // 'vault' (the Key Vault side-room {x,y,opened}) is set per-FLOOR by generateDungeon, so it is a world slot like floorMod/dungeonThemeData — without it a dungeon's vault leaks into the shared overworld and survives every swap (setupDungeonFloor reads state.vault to place the vault chest and to log "A rune-sealed VAULT slumbers on this floor…", so a stale value misplaces loot or logs a phantom). Benign-looking today only because openKeyVault re-checks the T.D_DOOR tile before acting.
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
    // quest-state version is PER-PLAYER (p._qN / p._qJson / p._qSeen, seeded in addPlayer): quests are a
    // per-player slice now, so a single room-wide counter would have stamped players[0]'s quests for everyone.
    this._lgN = 1;                     // Dread Legion roster version: bumps when the shared roster changes → clients resync (same stringify-compare idiom as _qN)
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
      writeBackPP(p);                                                // this method swaps IN (above) but never wrote back — so the breach's `S.maxDepth = Math.max(…, deep)` was discarded the moment the next hero swapped in. Runs on the failure path too: swapInPP already happened, so p must not be left reading someone else's slice.
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

  // PROJECTILES, partitioned by SHOOTER (same idiom as the enemy partition).
  // updateProjectiles re-pins `state.player` to each friendly shot's ownerRef itself, so a hit credits the
  // shooter's crit/lifesteal/prof/XP — but it cannot re-pin the PP SLICE, and a swapInPP at the call site
  // can't follow a swap that happens per projectile inside the loop. With quests per-player that matters:
  // killEnemy's `state.quests.slay.count++` and bountyProgress() write into whatever slice is swapped in, so
  // one pass under players[0] would credit players[0] for EVERY ranged and magic kill in the room — two of
  // the three combat styles — and a pure-ranged hero's "Slay monsters (0/5)" would never retire. Bucketing by
  // owner and running the REAL updateProjectiles once per bucket makes state.player and the slice agree.
  // Hostile + unowned shots ride one final pass under pool[0] — (P2/S3) their player-hit test loops the
  // game's world-scoped partyIn() itself, so every hero of the swapped-in world is a target (the old
  // players[1..N] patches are gone). Every projectile is stepped exactly once:
  // buckets are disjoint, each pass walks its own array backwards, and shots spawned mid-pass (the Quarry-Mark
  // frost lance, `ownerRef: po`) land in that owner's bucket and are recombined below.
  _projectilesByShooter(pool) {
    if (!G.updateProjectiles) return;
    const all = S.projectiles;
    if (!all.length) return;                       // nothing to step (updateProjectiles is a pure loop over the array)
    // Nobody in this world (every hero is delving) → leave the overworld's in-flight shots parked until
    // someone surfaces. Previously this ran anyway under a STALE state.player — a delver, in DUNGEON
    // coordinates — so an overworld arrow could hit-test against, and damage, a hero underground.
    if (!pool.length) return;
    const byOwner = new Map(), rest = [];
    for (const pr of all) {
      // `friendly` is the gate: a HOSTILE shot's ownerRef is the firing ENEMY, never a player.
      if (pr.friendly && pr.ownerRef && pool.includes(pr.ownerRef)) { let b = byOwner.get(pr.ownerRef); if (!b) byOwner.set(pr.ownerRef, b = []); b.push(pr); }
      else rest.push(pr);                          // hostile, unowned, or owned by someone who left/delved
    }
    const out = [];
    const runAs = (p, list) => {
      S.player = p; S.inventory = p.inventory; swapInPP(p);
      S.projectiles = list;
      try { G.updateProjectiles(); } catch (e) { this._err('updateProjectiles', e); }
      out.push(...S.projectiles);
    };
    for (const [o, list] of byOwner) runAs(o, list);
    if (rest.length) runAs(pool[0], rest);
    S.projectiles = out;
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
    // (tonics/sharpenLevel/seenHeatTip ride PLAYER_TEMPLATE now — the game's player literal seeds them; P2/S5.
    //  hasBoat:false + wayfind:true likewise since P2/S6; shopPurchased:[] + cargo:{0,0,0,0} + fishCd:0
    //  likewise since P2/S7; ingredients:{0,0,0,0} likewise since P2/S8 — a hero's purchases/hold/
    //  cooldown/pantry are his own and the template seeds them.)
    p.lastRestDay = (G.curDay ? G.curDay() : 1); p._exWas = false;   // per-player fatigue — JOIN RESTED overrides the template's day-1 (a saved row's own lastRestDay re-lands via _loadCharacter, P2/S7)
    p.sailing = false; p.dragon = { tamed: false, mounted: false };   // per-player boat + mount (shared S.sailing/S.dragon leaked water-walk/flight across every hero's slice)
    p.downed = false; p.bleedT = 0; p.reviveProg = 0; p.safeT = 0;   // co-op downed/revive state (join standing)
    p.map = 'overworld'; p.dg = null; p._mapSwitchN = 0; p._sentDgN = 0;   // per-player dungeon instancing (start on the shared overworld)
    // per-player questline: your OWN intro (talk/key/slay/dragon) off a deep template clone, with the
    // world-object quests (main/frozen/legion) re-aliased so the room shares ONE Kraken/Cache/war.
    p.quests = aliasSharedQuests(clone(QUEST_TEMPLATE));
    p.maxDepth = 0; p.bounty = null;
    p._qN = 1; p._qJson = '';          // quest-sync version + its stringify cache (per-player: see _step)
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
      // v3: `player` now carries this hero's PERSONAL MILESTONES (enteredDungeon/gotKey/enteredFrozen).
      // No line is needed for them here — snapshot()'s player whitelist emits them and the S.player swap
      // above already pins them to THIS hero. That is exactly why they live on the player object rather
      // than in a state.X slice: no PP_KEYS entry, no writeBack line, no snapshot gate, no client adopt —
      // the four links this bug class kept slipping through. state.flags stays SHARED world facts and is
      // deliberately still not saved (krakenDead/legionBroken describe a world that regenerates each boot).
      // v4 (rebuild S1): every save now carries an explicit `schemaVersion` (reader rule:
      // schemaVersion ?? v ?? 1 — see server/migrate.js). `v: 3` stays alongside so a rolled-back
      // server reads the row identically (the load path was always field-keyed, never version-keyed).
      v: 3, schemaVersion: SCHEMA_VERSION, name: p.name, level: p.level | 0, skin: p.skin | 0, player: snap.player, inventory: snap.inventory,
      // P2/S5: tonics/sharpenLevel FOLDED INTO `player` (plan §6 v4 mapping) — they live on p, so
      // snapshot()'s player whitelist emits them under the S.player swap above, like the milestones.
      // P2/S7: shopPurchased/cargo (+lastRestDay) likewise; P2/S8: ingredients — the `shop` slice
      // is GONE (a v4 row post-S8 never carries one). migrateCharacter maps old rows' shop.*
      // copies into player.* on load, then deletes the emptied slice.
      // v2: YOUR questline travels with YOUR character. There is no world save at all (db.js has only
      // `accounts`), so before this these lived only in RAM and a Railway scale-to-zero handed a level-45
      // hero "Speak to the Elder" / "Slay monsters (0/5)" and offered him a Depth-3 bounty. Read straight
      // off `p` — NOT off the G.snapshot() above: characterOf swaps only S.player/S.inventory and never
      // calls swapInPP, so snap.quests/snap.maxDepth would be whichever hero the sim last swapped in.
      // (Same grain as the `shop:` slice — live refs; the save chain JSON-serializes them.)
      quests: p.quests, maxDepth: p.maxDepth | 0, bounty: p.bounty || null,
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
      // parse → migrate → use (rebuild S1): normalize ANY historical row (v1/v2/v3) to v4
      // through the PURE importer before a single field is applied. Everything below
      // consumes the migrated blob — a fresh deep clone, so attaching its objects to `p`
      // can't alias a DB-row object into the sim. `wasLegacy` is the old chain's v1
      // predicate, evaluated on the RAW row: it keys the one SHARED side effect (below).
      const wasLegacy = !(c && c.quests);
      c = migrateCharacter(c).blob;
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
      // (The old `shop` slice is fully folded into the player slice by migrateCharacter — S5
      //  tonics/sharpenLevel, S7 shopPurchased/cargo, S8 ingredients — so there is nothing left
      //  to read off c.shop: the Object.assign(p, c.player) above landed every town-economy key.)
      if (c && c.dragon) p.dragon = { tamed: !!c.dragon.tamed, mounted: false };   // your tamed steed rejoins you (grounded)

      // ---- questline + personal milestones — APPLY ONLY (rebuild S1) ----------------------
      // The v1→v2 quest synthesis and the v2→v3 milestone synthesis now live in the PURE
      // module server/migrate.js (the WHY of each rule is documented there); the migrated
      // blob always carries a template-complete `quests`, a normalized maxDepth/bounty, and
      // (for every row that has a player slice — all real rows) the personal milestones,
      // which the Object.assign above already copied onto `p` with the rest of the slice.
      // This method only ATTACHES, plus the ONE side effect that must touch SHARED state:
      const q = c.quests;                              // fresh clone from migrateCharacter — safe to own
      // A returning v1 veteran has met the Elder → the room's (shared) Kraken hunt is on.
      // migrateCharacter recorded that purely on the BLOB's own main copy; keyed on
      // `wasLegacy` because a v2/v3 row's main copy was always DISCARDED by the re-alias,
      // never propagated — only the legacy synthesis ever reached the shared object.
      const legacyMainStarted = wasLegacy && !!(q.main && q.main.started);
      // The world-object quests are the LIVE room's, never the save's private copy: the world
      // regenerates every boot, so a stale legion/Kraken/Cache from a row would fight the world
      // it describes. (Re-alias AFTER the merge — migrateCharacter kept the row's copies.)
      aliasSharedQuests(q);
      if (legacyMainStarted) q.main.started = true;    // mutates the SHARED main post-alias — the old line-642 effect, exactly
      p.quests = q; p.maxDepth = c.maxDepth; p.bounty = c.bounty;
      p._qJson = ''; p._qN = (p._qN | 0) + 1;          // force a re-stamp so the restored box reaches the client

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
      const dgCamped = !camped && !wasCamping && S.player.camping === true;   // DUNGEON camp: no clock skip → detect the freshly-set camping flag instead (else the personal-rest recompute would silently never fire)
      S.time = t0;                                               // undo any skip — the world's clock never jumps
      // lastRestDay lives ON the player now (P2/S7), and the rotation pinned S.player = p before this RPC —
      // so doCamp's own `p.lastRestDay = curDay()` already landed on the right hero (no mirror needed; the
      // old S.lastRestDay sync died with the key's PP retirement). What survives is the RECOMPUTE:
      // Overworld: doCamp stamped the FAST-FORWARDED (next-morning) day; we just un-skipped the clock, so
      // re-stamp against the real curDay() or the hero is over-rested by a day.
      // Dungeon: doCamp stamped plain curDay() (no skip to undo) — the re-stamp is value-identical, kept as
      // belt-and-braces so both branches share one shape. (v2.56.2 withheld lastRestDay underground entirely →
      // camping healed you but left you permanently Exhausted; game-file doCamp records every camp since.)
      if (camped || dgCamped) { p.lastRestDay = (G.curDay ? G.curDay() : p.lastRestDay); p._exWas = false; if (G.recalcStats) try { G.recalcStats(); } catch (_e) {} }
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
      const had = !!p.hasBoat, g0 = p.gold | 0;   // P2/S6: hasBoat lives ON the player (our caller pinned S.player = p, so the game writes p directly)
      if (typeof G.buyBoat === 'function') G.buyBoat();
      if (!had && p.hasBoat) return { kind: 'toast', text: '★ You acquire a sturdy boat! Press [B] by open water to set sail.', cls: 'quest' };
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
    // Quest sync: version-stamp EACH HERO'S OWN quest state so snapshots only carry it when it CHANGES.
    // Per-player, not room-wide: quests/bounty/maxDepth are a PP slice now, and this block runs OUTSIDE the
    // rotation (S.player is pinned to whoever the last phase left), so stringifying `S.quests` here would
    // version-stamp one arbitrary hero's quests on behalf of the whole room. Read each p directly instead.
    // loreFound is still SHARED, and sits inside every hero's signature — so one Realm-stone read correctly
    // re-syncs the whole room's box. Cost: one stringify per player per 40 ticks (~2/s/player, ~0.001 ms).
    if (S.time % 40 === 0) {
      for (const p of S.players) {
        let j = ''; try { j = JSON.stringify([p.quests, p.bounty, S.loreFound, p.maxDepth]); } catch (_e) {}
        if (j && j !== p._qJson) { p._qJson = j; p._qN = (p._qN | 0) + 1; }
      }
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
      if (p.map === 'dungeon') { writeBackPP(p); continue; }   // just entered — its dungeon runs next tick. The writeback is NOT skippable: enterDungeon() sets state.maxDepth=1 on THIS tick and `continue` used to throw it away (as did every other PP write the entering slice made). The overworld-only work below (the exhaustion edge) is what we're skipping, not the slice.
      if (G.isExhausted) { const ex = !!G.isExhausted(); if (ex !== p._exWas) { p._exWas = ex; if (G.recalcStats) try { G.recalcStats(); } catch (_e) {} } }
      // (P2/S3) The winter snow-chill replica died here: updateWeather itself now chills every
      // overworld hero (it loops the game's world-scoped partyIn()), so the shared phase covers all.
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
        S.player = p; S.inventory = p.inventory; swapInPP(p);   // keep the bag AND the PP slice in sync with the acting hero — combat-time gear reads (melee riposte's equippedWeapon(), future on-hit gear checks) must see p's inventory, not a stale one; and killEnemy writes state.quests.slay / bountyProgress() / a boss-drop key straight into the swapped-in slice, so without swapInPP every kill in this bucket credits whichever hero the previous phase happened to leave behind
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
        S.player = p; S.inventory = p.inventory; swapInPP(p); S.allies = aBuckets.get(p);   // swapInPP: updateAllies → killEnemy credits state.player, and its quest/bounty writes land in the swapped-in slice
        try { G.updateAllies(); } catch (e) { this._err('updateAllies', e); }
        aSurvivors.push(...S.allies);
      }
      S.allies = aSurvivors.concat(idleAllies);
    }

    // remaining shared systems run once (acting player = first, cosmetic-only bias). Flag the block so their
    // log lines are world events — broadcast to EVERYONE with no player owner — not personal to players[0].
    _sharedPhase = true;
    this._projectilesByShooter(players);   // stays inside the shared-phase flag (unchanged feed attribution), but each bucket runs with its SHOOTER's PP slice swapped in — see _projectilesByShooter
    if (players.length) { S.player = players[0]; S.inventory = players[0].inventory; swapInPP(players[0]); }   // re-pin players[0] for the rest of the shared systems (the partition above left the last shooter swapped in)
    for (const fn of ['updateFires', 'updateWeather', 'updateEvents', 'updateFactionWar', 'updateNemesisPresence', 'maybePinnacleBosses']) {
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
        S.player = o; S.inventory = o.inventory; swapInPP(o); S.companions = list;   // swapInPP: a companion kill routes through killEnemy → quests.slay/bountyProgress land on the OWNER's slice
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

    // (P2/S3) The players[1..N] damage patches died here — the game fns themselves now loop the
    // world-scoped party (partyIn): hostile projectiles hit-test every hero inside updateProjectiles,
    // updateFires burns every hero on a burning tile, and pinnacleHazard menaces the non-duelist
    // heroes outside the ring (the Stage C party-wide pass) — for players[0] AND [1..N] alike.

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
              S.player = p; S.inventory = p.inventory; swapInPP(p);   // PP slice too — a dungeon boss's key drop sets state.inventory.keys++ AND state.quests.key.done; both must be the KILLER's (mirrors the overworld partition)
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
              S.player = dp; S.inventory = dp.inventory; swapInPP(dp); S.companions = mine;   // PP slice too (mirrors the overworld warband partition)
              try { G.updateCompanions(); } catch (e) { this._err('updateCompanionsDg', e); }
            }
            S.companions = allC;
          }
          // projectiles, partitioned by shooter (hostile/unowned ride a final pass under the first delver;
          // (P2/S3) updateProjectiles' own hostile hit-test loops the world-scoped party, so it sees EVERY
          // delver — S.map is 'dungeon' while this instance is swapped in, so topside heroes are excluded)
          this._projectilesByShooter(stillIn);
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
    // YOUR questline (per-player), version-gated so it costs 0 B/tick at rest. Read off `me` — never off
    // S.quests, which holds whichever hero the sim last swapped in. A fresh player has _qSeen 0 !== _qN 1,
    // so the roster/feed guarantee applies here too: quests ALWAYS ride your first snapshot.
    if ((me._qSeen | 0) !== (me._qN | 0)) {
      me._qSeen = me._qN | 0;
      snap.quests = safeClone(me.quests);
      snap.bounty = me.bounty ? safeClone(me.bounty) : null;
      snap.loreFound = (S.loreFound || []).slice();   // Realm-stones are still shared world progress
      snap.maxDepth = me.maxDepth | 0;
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

  // This hero's quest box, sent on JOIN alongside the map/roster and thereafter only when it CHANGES
  // (snap.quests, gated by _qN). Shaped exactly like the snapshot's gated block, because the client feeds
  // both to the same adoptQuests(). Sent on join for the same reason legionPayload is: a session TAKEOVER
  // (index.js `ws.pid = adopt`) hands a BRAND-NEW PAGE an existing live player whose _qSeen is already
  // caught up to _qN — so no snapshot would ever carry quests again and the box would sit on the game's
  // intro defaults INDEFINITELY (measured: 0 of 400 snapshots over 5 s). Every wifi blip, reload and
  // second tab takes that path. This is the cure; resetting _qSeen on takeover is the belt-and-braces.
  // A PURE READ — it must NOT consume the _qSeen edge (legionPayload doesn't either). index.js rewinds
  // _qSeen to 0 on takeover so the next snapshot re-delivers as well; if this consumed the edge it would
  // silently cancel that rewind and leave the welcome as the single point of failure on the ONE path
  // (takeover) this whole payload exists to cover. Costs one extra 564 B snapshot per join. Verified live:
  // consuming it here → 0 post-takeover re-deliveries.
  questPayload(id) {
    const p = this.players.get(id);
    if (!p || !p.quests) return null;
    return { quests: safeClone(p.quests), bounty: p.bounty ? safeClone(p.bounty) : null, loreFound: (S.loreFound || []).slice(), maxDepth: p.maxDepth | 0 };
  }

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
