/*
 * server/world.js — authoritative shared World (transport-agnostic).
 * =============================================================================
 * The "fork" that never drifts: this does NOT copy the game's sim. It loads the
 * game artifact (dist/eldermyr.html since the P1 wrap) through the headless
 * loader and REUSES its logic
 * (killEnemy, combat math, world-gen, items, spawns...). The only thing this
 * file owns is ORCHESTRATION of N players over that single-player sim:
 *
 *   - movement       : ONE G.updatePlayer() call per world phase — the game loops
 *                      the world-scoped standing party itself (P2 fold; per-hero
 *                      pin + held-keys stamp, JOIN order). world.js keeps only the
 *                      per-hero ACTION loop (attack/dodge/interact/RPC — the
 *                      world-slot choreography that cannot live in-sim).
 *   - fatigue        : ONE G.updateFatigue() call per world phase — the game loops
 *                      the world-scoped party itself (P2; town rest / vigil regen /
 *                      markTownVisited / Exhausted edge+drain, per hero, downed spared).
 *   - enemy combat   : ONE G.updateEnemies() call per world — the game itself
 *                      partitions foes by nearest hero and pins each hero for
 *                      their bucket (P2/S15; state.enemies stays the full roster,
 *                      so killEnemy's inline liberation checks see the whole world).
 *   - projectiles    : ONE G.updateProjectiles() call per world — the game itself
 *                      buckets shots by shooter and pins each owner for their
 *                      bucket (P2/S16; parked-shots rule included).
 *   - shared world   : spawns / weather / nemesis run once.
 *   - serialize      : per-player, interest-culled snapshot (map sent once).
 *
 * SCOPE (co-op): per-player = position + all combat stats + inventory + the QUESTLINE
 * (quests/maxDepth/bounty — v2.57.0; they read per-player state, so one shared box could
 * never be right for two heroes at once, and being shared+unpersisted it also reset to the
 * intro on every scale-to-zero) + reputation/lore (factions/loreFound — P2/S11, same
 * argument). Since P2/S13 every one of those keys lives ON the player object, so the
 * S.player/S.inventory pin IS the whole per-player swap — the old PP_KEYS swap/write-back
 * machinery is DELETED (P2/S14; RPC/interact paths run under the game's own actAs).
 * SHARED across the party = territory, the world itself — plus the three quests
 * that track WORLD OBJECTS (main/frozen/legion), aliased by reference into every player's
 * quests through the game's own aliasSharedQuests (see the QUESTS block below).
 */
'use strict';
const G = require('./load-game');
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
// v3.2.2 FIX 1 — per-broadcast enemy DEATH-FX buffer (module-level like _logbuf, installed at load
// before any World exists; OFF the hashed sim state so no golden baseline moves). killEnemy →
// global.__onEnemyDeath pushes here; _snapshotFor AOI-filters into snap.deaths; broadcast() clears it
// once per cycle via World.clearDeaths. See the __onEnemyDeath install below the __onGameOver line.
const _deathbuf = [];
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
// v3.2.2 FIX 1 — authoritative enemy DEATH-FX events. The sim's killEnemy calls this on every REAL
// kill (past its Emberwyrm / pinnacle-rise early-returns); a leash-despawn or AOI-cull calls it NOT,
// so the client's death burst can never fire on a foe that merely wandered off or left view — the
// exact ambiguity the old client hp-gate could not resolve. We buffer a lightweight element-themed
// record (mirrors the client's enemyMem death-flavor fields) and stamp the death's world so a dungeon
// kill reaches only fellow delvers and a surface kill only surfacers. _snapshotFor AOI-filters this
// into snap.deaths; broadcast() clears it once per cycle. OFF-state (module-level array), so it does
// not touch the {state, maps} golden root; the golden harness never installs this hook regardless.
try {
  global.__onEnemyDeath = function (e, cx, cy) {
    if (!e) return;
    _deathbuf.push({
      x: Math.round(cx), y: Math.round(cy),
      map: S.map === 'dungeon' ? 'dungeon' : 'overworld',
      col: e.color, type: e.type,
      burn: (e.burnT | 0) > 0 || !!e.lava,
      frost: (e.chillT | 0) > 0 || !!e.frost,
      big: !!(e.isBoss || e.isNemesis || e.isWildDragon),
      hunt: !!e.isGreatBeast,
    });
    if (_deathbuf.length > 200) _deathbuf.splice(0, _deathbuf.length - 200);   // hard cap: a between-broadcast pack wipe can't grow this unbounded
  };
} catch (_e) {}
// (P2/S15) The __libGate liberation gate lived here and is RETIRED: the game's own updateEnemies
// partitions foes internally now with state.enemies kept the FULL world roster, so killEnemy's
// inline "no guardians left?" checks are correct again — no gate, no load-game wrapper. The _seen
// sweeps below REMAIN as reconciliation for guardian removals that bypass killEnemy (leash despawn).
// epic = broadcast to EVERYONE (someone slew a boss/hunt/nemesis, found a legendary, freed a town)
const FEED_BROADCAST = /vanquished|is slain| falls!|has fallen|legendary|Emberwyrm|Kraken|Overlord|Dawnbreaker|liberated|Sealstone|great beast|falls!|★/i;
// (P2 fold) The density-driven spawn pass (LOCAL vicinity targets, staggered per-hero cadence,
// party-scaled ceiling) lived here and moved INTO the game's own maybeSpawnWild — see the
// dispatcher beside the body (p18); world.js makes ONE call per tick below.
const PLAYER_TEMPLATE = structuredClone(S.player);
const INV_TEMPLATE = structuredClone(S.inventory);
// ---- QUESTS ARE PER-PLAYER (v2.57.0), ON the player (P2/S13) -------------------
// They used to be shared, which was incoherent BY CONSTRUCTION: every intro-quest retire
// condition reads state that is per-player (your level, your keys, your kills, your Elder
// visit), so one shared quest box could never be right for two heroes at once. v2.57.0 made
// them a PP_KEYS slice; P2/S13 finished the move — `quests` lives ON state.player now (the
// game reads state.player.quests directly), so the S.player pin IS the swap and
// PLAYER_TEMPLATE seeds each joiner's own deep-cloned box. It rides the per-character save
// via snapshot()'s player whitelist (v7), like every other per-hero key.
//
// EXCEPT the three that track WORLD OBJECTS rather than the hero: `main` (the Mountain
// Kraken), `frozen` (the Frozen Cache pickup) and `legion` (the war-camps/Sealstones/
// Overlord). Those are ALIASED — one sub-object shared by reference into every player's
// quests — so the war has one state for the whole room. They are also the only quest
// sub-objects the SHARED-PHASE systems touch (updateNemesisPresence/defeatNemesis read
// quests.legion through the pinned hero's box under players[0]) — the alias is what keeps
// those correct no matter which hero happens to be pinned. They deliberately do NOT persist:
// the world regenerates on every boot, so they reset with the world they describe.
// The re-attach seam is the GAME's own `aliasSharedQuests` (P2/S13 — beside party()/actAs()
// in the sim; anchor = players[0]'s box, else the boot hero's): addPlayer and _loadCharacter
// call it on every join/load. A private copy of main/frozen/legion would silently FORK the
// room's war — mp-golden's object-identity assert guards exactly that.

function clone(o) { return structuredClone(o); }
function setKeys(held) { for (const k in G.keys) delete G.keys[k]; if (held) Object.assign(G.keys, held); }
// (P2/S15) inTown/wanderHome/isBoss moved INTO the game beside updateEnemies (heroInSpawnTown/
// wanderEnemyHome — the boss town-blind pool and the amble-home fallback are the sim's own now).
// (P2 fold) nearestPlayer moved in too: the ally-adoption rule rides the game's own nearestHeroTo.

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
  for (const k in v) { if (k === 'held' || k === 'actions' || k === 'input' || k === 'dg' || k === 'activeStock' || k === 'dodgeHits' || k === 'quests' || k === 'bounty' || k === '_qJson' || k === 'inventory') continue; const c = safeClone(v[k], d + 1); if (c !== undefined) r[k] = c; }   // dodgeHits = LIVE enemy refs (dodge i-frame bookkeeping) — never drag into a snapshot clone. quests/bounty are per-player PROPERTIES OF THE PLAYER now, so safeClone(me) would drag ~570 B onto EVERY snapshot at 66 Hz (~37 KB/s/player) for data that changes on human timescales — they ride the version-gated block in _snapshotFor instead (the holdings/legion sizing rule). _qJson is the SERVER-SIDE stringify cache backing that very gate: measured at 603 B on the wire (24% of `me`) before it was skipped — a revision cache must never ride the payload it gates. maxDepth is a bare number and DOES ride `me` (~15 B): the client's wholesale me-adopt carries it (P2/S12 — no explicit adopt line left), and the gated copy is what repaints the box on the FIRST snapshot (before any frame has reconciled). bounty rides the gated block only, so the client re-stamps its last adopted copy across each me-adopt (the wayfind inversion). activeStock (P2/S9, was `_shopStock`) = the open shop session's whole weapon/armor stock — the client already got it in the ONE `shopData` payload and re-stamps its local copy after every adopt, so dragging it onto `me` at 66 Hz would be pure waste (activeShopTown/activeShopName are scalars and ride fine). inventory (snapshot v2, plan §5) = the FAT TAIL of `me` (~1.2 KB of weapons/armor that changes on human timescales) — it rides the VERSION-GATED `snap.inventory` payload (stringify-compared in the S.time%40 block, `_invSeen` vs this._invN, seeded in `welcome` + first snapshot + takeover-rewound), never `me` per broadcast; the client adopts it in ws.onmessage (adoptInventory + adoptQuests' own bag line — the hidden-tab rule).
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
// (P2/S14) The PP_KEYS swap/write-back machinery lived here and is DELETED: every per-player
// key was retired onto state.player key-by-key (S5–S13; ARCHITECTURE.md carries the chronicle),
// so `S.player = p; S.inventory = p.inventory` IS the whole swap. RPC/interact paths run under
// the game's own actAs(p, fn) — the one acting-context seam (pins exactly those two slots,
// restores in a finally). New per-player state is a PLAYER FIELD, never a state.X slice.

// ---- Per-player dungeon instancing -------------------------------------------
// A hero is either on the SHARED overworld or inside their OWN private dungeon. These are the
// singleton "world slots" that differ between the two contexts; we stash/restore them around
// each dungeon player so N heroes can each be in a separate dungeon (or the overworld) without
// corrupting the shared world or one another. Dungeons stay SOLO for now.
const WORLD_SLOTS = ['map', 'enemies', 'pickups', 'npcs', 'projectiles', 'dungeonLevel', 'dungeonEntrance', 'dungeonThemeData', 'floorMod', 'vault', 'citadel'];   // 'vault' (the Key Vault side-room {x,y,opened}) is set per-FLOOR by generateDungeon, so it is a world slot like floorMod/dungeonThemeData — without it a dungeon's vault leaks into the shared overworld and survives every swap (setupDungeonFloor reads state.vault to place the vault chest and to log "A rune-sealed VAULT slumbers on this floor…", so a stale value misplaces loot or logs a phantom). Benign-looking today only because openKeyVault re-checks the T.D_DOOR tile before acting. 'citadel' (#121: 0/1 — is THIS instance the Sunken Citadel?) is the same class: descend() branches on it, so it MUST ride the swap or the overworld would think it's a citadel (or the flag vanish mid-run). Absent (never set) until a citadel is entered, so the golden — which never enters one — keeps its shape.
function grabWorld() { const w = {}; for (const k of WORLD_SLOTS) w[k] = S[k]; w.md = G.maps.dungeon; return w; }
function putWorld(w) { for (const k of WORLD_SLOTS) S[k] = w[k]; G.maps.dungeon = w.md; }
function lightPlayer(p) { return { id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), w: p.w, h: p.h, dir: p.dir, moving: !!p.moving, animFrame: p.animFrame | 0, hp: Math.round(Math.max(0, p.hp)), maxHp: Math.round(p.maxHp), level: p.level, skin: p.skin | 0, downed: !!p.downed, reviveFrac: p.downed ? (p.reviveFrac || 0) : 0, beingRevived: !!p.beingRevived, sailing: !!p.sailing, mounted: !!(p.dragon && p.dragon.mounted), auraEl: p._auraEl || 0, heat: p._auraEl ? Math.round(p.heat || 0) : 0 }; }   // auraEl = the element a heated elemental staff is radiating (else 0) → teammates can draw the glow; heat rides alongside (only while auraing) so their glow scales/pulses ∝ Heat exactly like the caster's own self-pulsate

class World {
  constructor() {
    this.state = S;
    this.players = new Map();          // id -> player object
    this._seq = 0;
    this.sharedDg = null;              // THE party dungeon: one shared instance; first enterer creates it, others join
    this.dgKind = null;                // #121: 'dungeon' | 'citadel' — which kind the live sharedDg is, so a normal-door [E] can't teleport a stranger into an open Citadel (and vice versa). Cleared wherever sharedDg is nulled.
    this.dgSpawn = null;               // current floor's entry point (joiners + descends spawn here)
    // quest-state version is PER-PLAYER (p._qN / p._qJson / p._qSeen, seeded in addPlayer): quests are a
    // per-player slice now, so a single room-wide counter would have stamped players[0]'s quests for everyone.
    this._lgN = 1;                     // Dread Legion roster version: bumps when the shared roster changes → clients resync (same stringify-compare idiom as _qN)
    try { this._lgJson = JSON.stringify(S.legion); } catch (_e) { this._lgJson = ''; }
    // Snapshot v2 (plan §5) — the two new version-gated payloads, state OFF the hashed sim
    // (Maps/fields on `this`, NEVER seeded onto p in addPlayer: the mp-golden baselines hash
    // state.players, and these gates are wire bookkeeping, not sim state; the per-player
    // `_invSeen`/`_wfSeen` cursors are touched lazily in _snapshotFor only, which the golden
    // rig never calls).
    this._invN = new Map();            // player id -> inventory version (bumped by the %40 stringify stamp)
    this._invJson = new Map();         // player id -> last stringify of p.inventory
    this._wfObj = null; this._wfJson = ''; this._wfN = 1;   // WORLD FEATURES (npcs/shrines/loreStones/pois): near-static after worldgen → join payload + edge, never per-snapshot
    try { this._wfObj = this.featuresPayload(); this._wfJson = JSON.stringify(this._wfObj); } catch (_e) {}
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
    if (joining && this.dgKind === 'citadel') { _logbuf.push({ m: 'The rift recoils from the Sunken Citadel — you cannot breach it from here. Use the gate.', c: 'combat', id: p.id }); return; }   // #121 guard 2: a rift must never drop you into a live Citadel
    if (joining && !this.rift.party) return;                          // a solo run isn't joinable
    if (!joining && (p.inventory.keys | 0) <= 0) { _logbuf.push({ m: 'The rift will not open without a KEY — find one first.', c: 'combat', id: p.id }); return; }
    const deep = this.rift.deep, party = this.rift.party;
    const compPos = (S.companions || []).map((c) => [c, c.x, c.y]);   // enterDungeon's setupCompanions() teleports every shared companion to the enterer
    const owBase = grabWorld();                                       // snapshot EVERY world slot BEFORE we disturb it (map/enemies/pickups/npcs/projectiles/dungeon slots/floorMod/maps.dungeon)
    let entered = false;
    try {                                                            // mirror the dungeon phase: ANY failure path must restore ALL swapped slots (no dungeon fragments stranded under map==='overworld')
      S.player = p; S.inventory = p.inventory;
      G.enterDungeon();                                              // builds a floor + stashes the overworld into owSave (a throwaway floor when joining — the shared one is restored next tick)
      if (!joining) { S.dungeonLevel = deep; p.maxDepth = Math.max(p.maxDepth | 0, deep); G.setupDungeonFloor(deep); }   // rebuild at the deep floor (the depth record is the breacher's own — P2/S12)
      if (S.map === 'dungeon') {
        if (joining) { if (this.dgSpawn) { p.x = this.dgSpawn.x; p.y = this.dgSpawn.y; } }
        else { this.sharedDg = grabWorld(); this.dgSpawn = { x: p.x, y: p.y }; }   // first breach → CAPTURE the deep instance
        p.map = 'dungeon'; p._mapSwitchN = (p._mapSwitchN || 0) + 1;
        entered = true;
      }
    } catch (e) { this._err('enterRift', e); }
    finally {
      putWorld(owBase);                                              // ALWAYS restore the shared overworld for everyone else. (The breach's depth bump is written on p directly — P2/S12 — so no write-back is needed here; the machinery that once mirrored it is deleted, P2/S14.)
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

  // (P2/S16) The PROJECTILE partition (`_projectilesByShooter` — the last world.js partition
  // standing) lived here and moved INTO the game's own updateProjectiles VERBATIM: it buckets
  // shots by SHOOTER itself (first-shot order), pins each owner for their bucket (player +
  // inventory, no restore), runs hostile/unowned shots last under roster[0], keeps the
  // PARKED-SHOTS rule (a world with none of its heroes present leaves its in-flight shots
  // waiting), and recombines in bucket order — the step-order determinism the 2p baselines
  // freeze. Both call sites below are now ONE G.updateProjectiles() call each.

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
    //  cooldown/pantry are his own and the template seeds them. visitedTowns + activeShopTown likewise
    //  since P2/S9 — the template's visitedTowns is [0]: startGame() ran markTownVisited on the boot
    //  hero before the template was cloned, so a fresh joiner starts with the spawn town discovered,
    //  exactly like a fresh SP hero. sailing:false + dragon:{tamed:false,mounted:false} likewise since
    //  P2/S10 — a fresh joiner is on foot with no steed, and clone() gives each hero his OWN dragon object.
    //  factions:{vigil:0,wilds:0,dread:0} + loreFound:[] likewise since P2/S11 — a fresh joiner is
    //  unknown to every power and has read no stones, each with his OWN objects via clone().
    //  maxDepth:0 + bounty:null likewise since P2/S12 — the depth record and the accepted
    //  contract are the hero's own; a saved row's values re-land via _loadCharacter.)
    p.lastRestDay = (G.curDay ? G.curDay() : 1); p._exWas = false;   // per-player fatigue — JOIN RESTED overrides the template's day-1 (a saved row's own lastRestDay re-lands via _loadCharacter, P2/S7)
    p.downed = false; p.bleedT = 0; p.reviveProg = 0; p.safeT = 0;   // co-op downed/revive state (join standing)
    p.map = 'overworld'; p.dg = null; p._mapSwitchN = 0; p._sentDgN = 0;   // per-player dungeon instancing (start on the shared overworld)
    // per-player questline (P2/S13): your OWN intro (talk/key/slay/dragon) rides PLAYER_TEMPLATE
    // like every other per-hero key (clone() above deep-copied the box), with the world-object
    // quests (main/frozen/legion) re-aliased THROUGH THE SIM's own seam so the room shares ONE
    // Kraken/Cache/war. Alias BEFORE the roster push below: the first joiner anchors on the boot
    // hero's box (the room's source), every later joiner on players[0]'s — the same objects.
    G.aliasSharedQuests(p.quests);
    p._qN = 1; p._qJson = '';          // quest-sync version + its stringify cache (per-player: see _step)
    p.skin = 0; p._qSeen = 0;          // hero look (0-4) + quest-sync version last sent (0 → first snapshot carries quests)
    p._feedSeen = this.feedN | 0;      // join fresh — don't replay the room's whole event history
    p._lgSeen = 0;                     // Dread Legion roster version last sent (0 → the first snapshot carries the roster, like _qSeen)
    S.players.push(p);
    this.players.set(id, p);
    if (character) this._loadCharacter(p, character);   // restore a saved hero (stats + inventory only)
    // Snapshot v2: seed this hero's inventory-gate version AFTER the load above (so the cached
    // stringify is the LOADED bag, not the template's). Version 1 vs the lazy `me._invSeen|0 = 0`
    // guarantees the FIRST snapshot carries the bag, exactly like _qSeen/quests. On `this`, not p —
    // the mp-golden baselines hash state.players (see the constructor note).
    this._invN.set(id, 1);
    try { this._invJson.set(id, JSON.stringify(p.inventory)); } catch (_e) { this._invJson.set(id, ''); }
    return p;
  }

  // Produce the SAVEABLE per-player character: the game's own snapshot(), but ONLY the
  // player-stat + inventory slices (the shared world — map, legion, holdings — is never
  // per-player; factions/loreFound RIDE the player slice since P2/S11, so a hero's
  // reputations and Realm-stone discoveries finally survive a reboot). Swap this player
  // into the singleton slots so snapshot() reads it.
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
      // copies into player.* on load, then deletes the emptied slice. P2/S9: visitedTowns rides the
      // player slice too (pre-S9 it was a shared root key OUTSIDE this save entirely — every reboot
      // wiped the room's travel list); the shop session (activeShopTown/activeStock/activeShopName)
      // stays out of the whitelist on purpose — a session, not progress.
      // v2: YOUR questline travels with YOUR character. There is no world save at all (db.js has only
      // `accounts`), so before this it lived only in RAM and a Railway scale-to-zero handed a level-45
      // hero "Speak to the Elder" / "Slay monsters (0/5)". P2/S13: quests FOLDED INTO `player` (plan
      // §6 v4 mapping, the FINAL fold) — the box lives on p now, so snapshot()'s player whitelist
      // emits it (deep-copied) under the S.player swap above, exactly like the milestones/steed/
      // depth/bounty; the old "read straight off p, never off snap" hazard is gone because the pin IS
      // the swap. The shared main/frozen/legion serialize as VALUES and are re-aliased to the room's
      // live objects on load (G.aliasSharedQuests — never persisted-authoritative). migrateCharacter
      // maps old rows' top-level quests into player.* on load.
      // P2/S12: maxDepth/bounty FOLDED INTO `player` the same way.
      // P2/S10: the steed FOLDED INTO `player` (plan §6 v4 mapping) — dragon lives on p, so
      // snapshot()'s player whitelist emits it under the S.player swap above (mounted rides
      // as-saved; every load path re-grounds it). migrateCharacter maps old rows' top-level
      // dragon.tamed into player.dragon on load. sailing is never persisted (a session).

      // YOUR recruits travel with YOUR character (connection ids change every reconnect — never key on them)
      companions: (S.companions || []).filter((c) => c.ownerId === id).map((c) => ({
        name: c.name, cls: c.cls, tier: c.tier | 0, unpaid: c.unpaid ? 1 : 0, level: c.level | 0, maxHp: c.maxHp, hp: c.hp, atk: c.atk, def: c.def,
        alive: c.alive !== false, color: c.color || null, postedAt: (typeof c.postedAt === 'number' ? c.postedAt : null),
        weapon: c.weapon ? safeClone(c.weapon) : null,   // #115/F2: tier (stats/upkeep) + unpaid persist across reconnect
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
            name: sc.name || 'Companion', cls: sc.cls, tier: sc.tier | 0, unpaid: sc.unpaid ? 1 : 0, level: sc.level || 1,   // #115/F2: tier + refuse-to-fight state ride the character save
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
      //  tonics/sharpenLevel, S7 shopPurchased/cargo, S8 ingredients — and the top-level `dragon`
      //  slice likewise since P2/S10: the Object.assign(p, c.player) above landed the steed with
      //  the rest of the slice. Ground the transient halves explicitly: your tamed steed rejoins
      //  you GROUNDED and you rejoin ON FOOT — mounted/sailing are sessions, never trusted from a
      //  row (a v1 row has no dragon anywhere → the addPlayer template default stands).)
      if (!p.dragon) p.dragon = { tamed: false, mounted: false }; else p.dragon.mounted = false;
      p.sailing = false;

      // ---- questline + personal milestones — APPLY ONLY (rebuild S1) ----------------------
      // The v1→v2 quest synthesis and the v2→v3 milestone synthesis now live in the PURE
      // module server/migrate.js (the WHY of each rule is documented there); the migrated
      // blob always carries a template-complete quest box IN THE PLAYER SLICE (P2/S13 fold —
      // player-first; a playerless blob keeps it top-level, which the fallback read covers)
      // plus the personal milestones AND a normalized player.maxDepth/player.bounty (P2/S12
      // fold), which the Object.assign above already copied onto `p` with the rest of the slice.
      // This method only ATTACHES, plus the ONE side effect that must touch SHARED state:
      const q = (c.player && c.player.quests) || c.quests;   // fresh clone from migrateCharacter — safe to own
      // A returning v1 veteran has met the Elder → the room's (shared) Kraken hunt is on.
      // migrateCharacter recorded that purely on the BLOB's own main copy; keyed on
      // `wasLegacy` because a v2/v3 row's main copy was always DISCARDED by the re-alias,
      // never propagated — only the legacy synthesis ever reached the shared object.
      const legacyMainStarted = wasLegacy && !!(q.main && q.main.started);
      // The world-object quests are the LIVE room's, never the save's private copy: the world
      // regenerates every boot, so a stale legion/Kraken/Cache from a row would fight the world
      // it describes. (Re-alias AFTER the merge, through the SIM's own seam — P2/S13;
      // migrateCharacter kept the row's copies.)
      G.aliasSharedQuests(q);
      if (legacyMainStarted) q.main.started = true;    // mutates the SHARED main post-alias — the old line-642 effect, exactly
      p.quests = q;                                    // explicit attach (the Object.assign above landed the same ref for v4 rows; older/playerless shapes need this line)
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
    this._invN.delete(id); this._invJson.delete(id);   // snapshot v2: drop the leaver's inventory-gate entries (the Maps must not grow per join/leave)
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
          if (!inDungeon && S.map === 'dungeon') {           // just ENTERED the dungeon (or the Citadel)
            const thisKind = S.citadel ? 'citadel' : 'dungeon';   // #121: which kind did this [E] just build?
            if (this.sharedDg && this.dgKind !== thisKind) {
              // #121 MISMATCH GUARD: a normal-door [E] while the Citadel stands open (a stranger would be
              // teleported into a live Citadel with no business there), or a gate [E] while a normal delve
              // runs. Undo the entry — restore the overworld and leave the hero topside.
              if (owBase) { putWorld(owBase); S.projectiles = projBefore; for (const [c, cx3, cy3] of compPos) { c.x = cx3; c.y = cy3; } }
              _logbuf.push({ m: this.dgKind === 'citadel' ? 'The way below is sealed while the Sunken Citadel stands open.' : 'A delve is already underway — the Citadel gate will not open until it clears.', c: 'combat', id: p.id });
              break;
            }
            if (this.sharedDg) {
              // party dungeon already live → JOIN it: discard the floor the game just built
              // and drop this hero at the shared instance's floor entrance.
              if (this.dgSpawn) { p.x = this.dgSpawn.x; p.y = this.dgSpawn.y; }
            } else {
              // first one in → CREATE the shared instance (p stands at the floor entrance)
              this.sharedDg = grabWorld();
              this.dgSpawn = { x: p.x, y: p.y };
              this.dgKind = thisKind;                          // #121: the instance's kind is fixed at creation
            }
            p.map = 'dungeon'; p._mapSwitchN = (p._mapSwitchN || 0) + 1;
            // peel the shared overworld back into S (saveOverworld stashed it into owSave on entry)
            if (S.owSave) { S.enemies = S.owSave.enemies; S.pickups = S.owSave.pickups; S.npcs = S.owSave.npcs; if (S.owSave.pois) S.pois = S.owSave.pois; }
            S.map = 'overworld';
            S.citadel = owBase ? (owBase.citadel || 0) : 0;  // #121: the entry set S.citadel=1 and grabWorld captured it INTO sharedDg — the peeled overworld must carry the overworld's flag (0), or it leaks a phantom Citadel across every world swap (the WORLD_SLOTS §2.4 hazard)
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
    // (P2/S14) EVERY RPC runs under the game's actAs(p, …) — plan §1's runAs shape (pins ONLY
    // state.player/state.inventory, the two slots that remain; restores both in a finally).
    // The tick's rotation already pins p before _runActions, so inside the tick this is a no-op
    // pin — but nothing ENFORCED it: an RPC invoked outside a rotation slice used to run against
    // whatever hero the previous phase left pinned (the §1 trap). Now the handler carries its own
    // acting context. The special cases below are ORCHESTRATION, not context: id→object
    // resolution, the scene pin, the warband roster splice, the shared-clock freeze.
    G.actAs(p, () => {
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
      const stock = p.activeStock; if (!stock) return;   // P2/S9: the shop session lives on the player (stamped by shopPayloadFor)
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
    });
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
    // P2/S9: stamp the game's own player-carried session fields (was p._shopStock/_shopTown +
    // swapInPP's activeShopTown bridge) — buyGood/sellGood price against p.activeShopTown and
    // the buyWeapon/buyArmor RPC resolves ids against p.activeStock, exactly like SP openShop.
    p.activeStock = npc.stock || { weapons: [], armor: [] };
    p.activeShopTown = ti;
    p.activeShopName = (npc.shopTown && npc.shopTown.name) || 'Shop';
    return { name: p.activeShopName, town: ti, stock: p.activeStock, purchased: (p.shopPurchased || []).slice() };
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
    // (P2/S14) act as this hero through the GAME's own actAs — the one acting-context seam
    // (plan §1's runAs shape: pins state.player/state.inventory, restores both in a finally;
    // since S13 that pin IS the whole per-hero swap, so the hand-rolled pin + swapInPP/
    // writeBackPP pair that lived here is gone).
    let res = null;
    try {
      G.actAs(p, () => {
        if (npcId === 'hearth') res = { kind: 'panel', panel: 'cook' };                                   // client already has ingredients (snap.me)
        else if (npcId === 'hunts') res = { kind: 'panel', panel: 'hunts', huntsSlain: (S.huntsSlain || []).slice() };
        else if (npcId === 'recruit') res = { kind: 'panel', panel: 'companions', companions: (S.companions || []).filter((c) => c.ownerId === p.id).map((c) => safeClone(c)) };   // YOUR warband only (roster + indexes must match the per-owner RPCs)
        else if (npcId === 'bounty') res = this._doInstant(p, 'openBounty');
        else if (npcId === 'shipwright') res = this._doInstant(p, 'buyBoat');
        else {                                                    // elder / guard / any talker → dialogue
          const lines = (npcId === 'elder' && typeof G.elderLines === 'function') ? G.elderLines() : (Array.isArray(npc.lines) ? npc.lines.slice() : ['…']);
          if (npcId === 'elder' && p.quests) {                   // the elder advances the questline — the ACTING hero's own box (P2/S13; talk/key are personal, main/legion write the room's shared objects through the alias, exactly as before)
            const q = p.quests;
            if (q.talk) q.talk.done = true;
            if (q.main) q.main.started = true;
            if (q.key) q.key.hidden = false;
            if (q.legion && !q.legion.started) { q.legion.started = true; q.legion.stage = 'camps'; }
          }
          res = { kind: 'dialogue', speaker: npc.name || '', lines: Array.isArray(lines) ? lines : ['…'] };
        }
      });
    } catch (_e) {}
    return res;
  }

  // Instant NPC action (bounty/boat): run the game fn for p, compose feedback from state deltas
  // (the game's log() only writes to the DOM, so we can't read its text server-side).
  _doInstant(p, fn) {
    if (fn === 'openBounty') {
      const b0 = p.bounty ? { desc: p.bounty.desc, target: p.bounty.target, progress: p.bounty.progress, done: p.bounty.progress >= p.bounty.target } : null;   // P2/S12: the contract lives ON the player (our caller pinned S.player = p, so the game writes p directly — same as buyBoat below)
      const g0 = p.gold | 0;
      if (typeof G.openBounty === 'function') G.openBounty();
      const b = p.bounty, dg = (p.gold | 0) - g0;
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
    // Per-player, not room-wide: quests/bounty/maxDepth all live ON the player (P2/S13/S12), and this
    // block runs OUTSIDE the rotation (S.player is pinned to whoever the last phase left), so reading
    // through state.player here would version-stamp one arbitrary hero's quests on behalf of the whole
    // room. Read each p directly instead.
    // loreFound is per-HERO since P2/S11 (p.loreFound — your own Realm-stone discoveries), so a stone read
    // re-syncs only the READER's box. Cost: one stringify per player per 40 ticks (~2/s/player, ~0.001 ms).
    if (S.time % 40 === 0) {
      for (const p of S.players) {
        let j = ''; try { j = JSON.stringify([p.quests, p.bounty, p.loreFound, p.maxDepth]); } catch (_e) {}
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
      // Inventory sync (snapshot v2 — SAME idiom, deliberately sharing this throttle block): the bag is
      // the fat tail of `me` (~1.2 KB) for data that changes on human timescales (a buy, a drop, a
      // durability tick) — gated it costs 0 B/snapshot at rest instead of 1.2 KB × 20 Hz × players.
      // One stringify per player per 40 ticks, like the quest stamp above. An edge lands ≤0.5 s late.
      for (const p of S.players) {
        let ij = ''; try { ij = JSON.stringify(p.inventory); } catch (_e) {}
        if (ij && ij !== this._invJson.get(p.id)) { this._invJson.set(p.id, ij); this._invN.set(p.id, (this._invN.get(p.id) | 0) + 1); }
      }
      // World-features sync (snapshot v2): npcs/shrines/loreStones/pois are near-STATIC after worldgen
      // (a wandering merchant, an outpost hearth, a shrine spending/sinking, a POI clear). They used to
      // ride EVERY snapshot interest-culled; now the FULL lists ride one gated payload on change + the
      // join `welcome`. The stringify compares the exact PROJECTION the client receives — volatile
      // per-frame fields are stripped/quantized inside featuresPayload (npc `temp` countdown dropped;
      // shrine `cd` reduced to its READINESS sign, which is all drawShrine reads), so a cooling shrine
      // re-sends exactly twice (dormant edge, ready edge), never per stamp.
      let wj = ''; const wf = this.featuresPayload();
      try { wj = JSON.stringify(wf); } catch (_e) {}
      if (wj && wj !== this._wfJson) { this._wfJson = wj; this._wfObj = wf; this._wfN++; }
    }

    // Split the party: heroes on the SHARED overworld vs. each inside their OWN private dungeon.
    const owPre = S.players.filter((p) => p.map !== 'dungeon');
    // MOVEMENT (P2 fold — the LAST rotation): ONE call — the game's own updatePlayer loops the
    // world-scoped standing party itself (JOIN order, per-hero pin + held-keys stamp; the rotation
    // that lived here, moved in). Actions run in the SEPARATE per-hero loop below, AFTER all
    // movement — the fold's one conscious reorder, re-recorded into the 2p baselines with the
    // divergence pinned to exactly that interleave.
    if (owPre.length) {
      try { G.updatePlayer(); } catch (e) { this._err('updatePlayer', e); }
    }
    // PER-PLAYER (overworld): discrete actions (attack/dodge/interact/RPC) + ownership stamps.
    for (const p of owPre) {
      if (p.downed) continue;            // incapacitated — the downed pass (below) runs their timers
      S.player = p; S.inventory = p.inventory; setKeys(p.held);   // the acting pin + input for this hero's action slice (doDodge reads the directional keys; RPCs re-pin via actAs anyway)
      this._runActions(p, false);        // interact may ENTER a dungeon → p.map becomes 'dungeon' + its context captured
      for (const pr of S.projectiles) if (pr.friendly && !pr.ownerRef) pr.ownerRef = p;   // stamp the SHOOTER — hits credit their lifesteal/crit/prof/XP (not players[0])
      if (S.companions) for (const c of S.companions) if (!c.ownerId) c.ownerId = p.id;   // a fresh recruit follows its RECRUITER
      if (S.allies) for (const a of S.allies) if (!a._owner) a._owner = p.id;   // a thrall/bound-elite summoned this slice fights for its summoner
      // (P2/S3) The winter snow-chill replica died here: updateWeather itself now chills every
      // overworld hero (it loops the game's world-scoped partyIn()), so the shared phase covers all.
      // (P2 updateFatigue-in-MP) The per-rotation exhaustion-EDGE replica (recalc on isExhausted()
      // flip vs p._exWas) died here too: the game's own updateFatigue is the A-shape now — ONE call
      // below the rotation loops partyIn() itself, and it does the FULL job (town rest, vigil regen,
      // markTownVisited, the Exhausted/rested feed lines, the HP drain), not just the recalc edge.
      // A hero who just entered the dungeon (p.map flipped above) is excluded by partyIn()'s map
      // filter, exactly like the old `continue` here. addPlayer's p._exWas seed and the doCamp RPC's
      // pre-arm still feed the same per-hero memory the sim reads now.
    }

    // SHARED WORLD — overworld heroes only (dungeon delvers run in their own phase below)
    const players = S.players.filter((p) => p.map !== 'dungeon');
    // FATIGUE (P2 updateFatigue-in-MP): ONE call — the game's own updateFatigue loops the
    // world-scoped partyIn() itself (JOIN ORDER, downed spared, pin-with-restore). This is what
    // ADDS town rest / vigil regen / markTownVisited / the Exhausted feed lines / the exhaustion
    // HP drain to MP heroes — none of it ever ran here (world.js replicated only the recalc edge).
    // Sits where the old per-rotation edge lived: after movement/actions, before enemy combat, and
    // OUTSIDE the shared-phase flag so its log lines stay personal to the acting hero.
    if (players.length) {
      try { G.updateFatigue(); } catch (e) { this._err('updateFatigue', e); }
    }
    // ENEMY COMBAT (P2/S15): ONE call — the game's own updateEnemies partitions foes by nearest
    // hero itself (downed-invisible pools, the boss town-blind bubble, the wander-home fallback,
    // per-bucket hero pins in JOIN ORDER, bucket-order recombine — all moved in verbatim). Its
    // roster is the world-scoped partyIn() = exactly `players` here. state.enemies stays the FULL
    // roster throughout, so killEnemy's inline liberation/POI/raid checks and healAlly/court scans
    // see the whole world — the __libGate that blinded-then-deferred them is retired.
    if (players.length && S.enemies.length) {
      try { G.updateEnemies(); } catch (e) { this._err('updateEnemies', e); }
    }
    if (S.time % 30 === 0) unstickEnemies('overworld');   // pop wall-embedded foes out (leviathan-on-land etc.)

    // ALLIES (P2 fold): ONE call — the game's own updateAllies partitions thralls/bound elites/
    // Vigil patrols by _owner itself (unowned → adopted by the nearest hero, owner-delving → idle
    // with life frozen, per-owner pins in JOIN order, bucket-order recombine — the partition that
    // lived here, moved in verbatim). Overworld phase ONLY: state.allies is not a world slot, so
    // the dungeon phase must never step topside allies against the floor's grid (the dispatcher
    // self-guards on state.map too).
    if (G.updateAllies && S.allies && S.allies.length && players.length) {
      try { G.updateAllies(); } catch (e) { this._err('updateAllies', e); }
    }

    // remaining shared systems run once (acting player = first, cosmetic-only bias). Flag the block so their
    // log lines are world events — broadcast to EVERYONE with no player owner — not personal to players[0].
    _sharedPhase = true;
    // PROJECTILES (P2/S16): ONE call — the game's own updateProjectiles buckets shots by SHOOTER
    // itself (first-shot order, per-bucket owner pins with no restore, hostile/unowned last under
    // roster[0], the parked-shots rule, bucket-order recombine — the partition that lived here,
    // moved in verbatim). Its partyIn() roster is exactly `players` while the overworld holds the
    // state singletons. Stays inside the shared-phase flag (unchanged feed attribution).
    if (players.length && S.projectiles.length) {
      try { G.updateProjectiles(); } catch (e) { this._err('updateProjectiles', e); }
    }
    if (players.length) { S.player = players[0]; S.inventory = players[0].inventory; }   // re-pin players[0] for the rest of the shared systems (the projectile pass left the last shooter swapped in)
    for (const fn of ['updateFires', 'updateWeather', 'updateEvents', 'updateFactionWar', 'updateNemesisPresence', 'maybePinnacleBosses']) {
      if (G[fn]) try { G[fn](); } catch (e) { this._err(fn, e); }
    }   // maybePinnacleBosses: fixed-lair spawn/night-gate/despawn (Drowned King always broods; Pale Shepherd rises at night) — a once-per-tick shared system like updateEvents (self-throttled via state._pinCheckT); its cycle-respawn rides onNewDay→maybeRespawnPinnacle off G.updateTime()
    _sharedPhase = false;

    // WARBAND (P2 fold): ONE call — the game's own updateCompanions partitions recruits by
    // ownerId itself (owners in JOIN order, downed owners' recruits idle, map-scoped so a
    // dungeon-tagged recruit is never stepped topside — the partition that lived here, moved
    // in verbatim; the dungeon phase makes the same one call with the floor swapped in).
    if (G.updateCompanions && S.companions && S.companions.length && players.length) {
      try { G.updateCompanions(); } catch (e) { this._err('updateCompanions', e); }
    }

    // MP SPAWNING (P2 fold): ONE call — the game's own maybeSpawnWild drives LOCAL density itself
    // (staggered per-hero _spawnT cadence, ring-scaled 13→30 vicinity targets, the party-scaled
    // global ceiling, per-hero pins in JOIN order — the pass that lived here, moved in verbatim).
    if (S.map === 'overworld' && G.maybeSpawnWild) {
      try { G.maybeSpawnWild(); } catch (e) { this._err('maybeSpawnWild', e); }
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
        // MOVEMENT (P2 fold): the same ONE updatePlayer call as topside — the dungeon is in S, so
        // its partyIn() roster is the standing delvers. Movement cannot exit/descend (that's [E]),
        // so the instance stays swapped in for the whole pass; the action loop below handles the
        // world-slot choreography per delver.
        try { G.updatePlayer(); } catch (e) { this._err('updatePlayer', e); }
        // per-player: actions (descend / exit / vault / abilities)
        for (const p of dgAll) {
          if (S.map !== 'dungeon') putWorld(this.sharedDg);  // a previous player exited → bring the dungeon back for the rest
          if (p.downed || p.map !== 'dungeon') continue;
          S.player = p; S.inventory = p.inventory; setKeys(p.held);
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
          // (P2 updateFatigue-in-MP) The per-delver exhaustion-EDGE replica died here — the ONE
          // G.updateFatigue() call below the loop covers the standing delvers (partyIn() while the
          // dungeon is swapped in), with the town block map-gated off exactly like SP underground.
        }
        if (S.map !== 'dungeon') putWorld(this.sharedDg);  // last action was an exit → restore for the shared passes
        const stillIn = dgAll.filter((p) => p.map === 'dungeon');
        if (stillIn.length) {
          // FATIGUE (P2 updateFatigue-in-MP): the dungeon phase's own ONE call — its partyIn()
          // roster is exactly `stillIn` (state.map === 'dungeon' while this instance is in S), so
          // delvers keep the exhaustion edge + HP drain (state.map gates the town block off).
          try { G.updateFatigue(); } catch (e) { this._err('updateFatigueDg', e); }
          // ENEMY COMBAT (P2/S15): same ONE call as topside — updateEnemies partitions among the
          // STANDING delvers itself (state.map is 'dungeon' while this instance is swapped in, so
          // its partyIn() roster is exactly `stillIn`, and the boss town-blind pool is overworld-only
          // by its own state.map check). A dungeon boss's key drop rides the KILLER's pin by construction.
          if (S.enemies.length) {
            try { G.updateEnemies(); } catch (e) { this._err('updateEnemies', e); }
          }
          // WARBAND (dungeon, P2 fold): the same ONE updateCompanions call as topside — S.map is
          // 'dungeon' while this instance is swapped in, so the dispatcher steps ONLY map==='dungeon'
          // recruits of the standing delvers (its partyIn() roster is exactly `stillIn`), against the
          // floor's own enemies/grid. Topside recruits are untouched here by the same map filter.
          if (G.updateCompanions && S.companions && S.companions.length) {
            try { G.updateCompanions(); } catch (e) { this._err('updateCompanionsDg', e); }
          }
          // PROJECTILES (P2/S16): same ONE call as topside — updateProjectiles buckets by shooter
          // among the delvers itself (its partyIn() roster is exactly `stillIn` while this instance
          // is swapped in; hostile/unowned shots ride its final pass under the first delver, and
          // (P2/S3) their hit-test loops the world-scoped party, so topside heroes are excluded).
          if (S.projectiles.length) {
            try { G.updateProjectiles(); } catch (e) { this._err('updateProjectiles', e); }
          }
          if (S.time % 30 === 0) unstickEnemies('dungeon');
          this._downedPass(stillIn);                       // downed & revive work INSIDE the dungeon too
        }
        this.sharedDg = stillIn.filter((p) => p.map === 'dungeon').length ? grabWorld() : null;   // save the evolved floor, or dissolve when empty
        if (!this.sharedDg) { this.dgSpawn = null; this.dgKind = null; }   // #121 guard 3: the Citadel/dungeon kind clears with the instance
      } finally {
        putWorld(owBase);                                  // ALWAYS restore the shared overworld for everyone else
      }
    } else if (!dgAll.length && this.sharedDg) { this.sharedDg = null; this.dgSpawn = null; this.dgKind = null; }   // stragglers gone (disconnects) → dissolve (#121: clear kind too)

    // SAFETY: with no live delve, no recruit may linger tagged 'dungeon' (owner bled out / left, or the instance
    // dissolved). Force any straggler topside near its owner so it can't idle invisibly in a dead world-slot.
    if (!this.sharedDg && S.companions) for (const c of S.companions) { if (c.map === 'dungeon') { c.map = 'overworld'; const o = this.players.get(c.ownerId); if (o) { c.x = o.x - 22 + Math.random() * 44; c.y = o.y + 12; } c.attackCd = 0; } }

    // ---- DOWNED & REVIVE (overworld heroes; the dungeon phase runs its own pass) ----
    this._downedPass(players);

    // Liberation reconciliation: killEnemy's inline "last occupier dead?" checks see the FULL
    // roster again (P2/S15 — updateEnemies partitions internally, state.enemies never shrinks to
    // a bucket), so the inline path liberates at the kill, credited to the KILLER's pin. These
    // sweeps REMAIN as reconciliation for guardian removals that BYPASS killEnemy — the leash
    // despawn splice, the unstick pass — which strand a site guarded-by-nobody with no kill event.
    // Only fires once guardians were actually PRESENT then removed (_seen gate) — never for a
    // site whose guardians simply haven't spawned, which would hand out free liberation gold.
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
  static R2 = (34 * (G.TILE || 32)) ** 2;   // interest radius, squared (snapshot v2: 46t → 34t — the viewport half-diagonal is ~18t, so 34t keeps ~2× margin; at 20 Hz an entity entering the ring is visible within one broadcast, so no pop-in. Enemy/proj bytes scale ×(34/46)² ≈ 0.55)
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
      // npcs: OVERWORLD npcs ride the version-gated `wf` payload now (snapshot v2 — near-static
      // after worldgen, they cost ~1 KB/snapshot in town for data that changes on event timescales).
      // Only a DUNGEON's own npcs (normally none) stay inline — the client swaps to them on
      // snap.map==='dungeon' and back to its adopted wf lists topside.
      npcs: inDg ? (W.npcs || []).filter(near).map(packScalar) : undefined,
      // warband companions: dungeon viewers see the delving warbands (map==='dungeon'), surfacers see the topside ones
      comps: (S.companions || []).filter((c) => c.alive && ((c.map === 'dungeon') === inDg) && near(c)).map(packComp),
      // co-op allies (thralls / bound elites / Vigil patrols) — overworld only, interest-culled like enemies
      allies: inDg ? [] : (S.allies || []).filter(near).map(packAlly),
      // (snapshot v2) shrines/loreStones/pois left the per-snapshot body with the npcs — they ride
      // the gated `wf` payload below (join `welcome` + edge on spend/sink/clear/merchant, plan §5).
      holdings: inDg ? null : (S.holdings || []).map((h) => ({ liberated: !!h.liberated, built: !!h.built, level: h.level || 1, besieged: !!h.besieged })),   // outpost status → correct [E] prompt + flip on capture
      rift: (!inDg && this.rift && near(this.rift)) ? { x: this.rift.x, y: this.rift.y, deep: this.rift.deep, party: !!this.rift.party, open: !!this.sharedDg, secs: Math.max(0, Math.ceil((this.rift.expires - S.time) / 80)) } : null,   // #14 ephemeral rift (party=blue co-op)
    };
    // v3.2.2 FIX 1 — authoritative death-FX events for THIS player's world: same 34-tile AOI ring and
    // map partition (dungeon vs surface) the enemy list uses above, so the client's themed burst plays
    // exactly where a foe fell — on every real kill, one-shots included. Cleared once per broadcast
    // (index.js → clearDeaths), so each event rides only the snapshots between its kill and that clear.
    // A dropped one is a lost cosmetic frame, not state — no _seen cursor / welcome seed, unlike the
    // edge-triggered payloads; consumed in the client's ws.onmessage (the one-shot rule) all the same.
    if (_deathbuf.length) {
      const ds = [];
      for (const d of _deathbuf) if (((d.map === 'dungeon') === inDg) && near(d)) ds.push(d);
      if (ds.length) snap.deaths = ds.slice(-40).map((d) => ({ x: d.x, y: d.y, col: d.col, type: d.type, burn: d.burn, frost: d.frost, big: d.big, hunt: d.hunt }));   // cap the wire cost of a mass wipe; the client's per-pass particle budget bounds the FX itself
    }
    if (inDg) { snap.dgLevel = W.dungeonLevel | 0; snap.dgTheme = W.dungeonThemeData ? safeClone(W.dungeonThemeData) : null; snap.floorMod = W.floorMod ? safeClone(W.floorMod) : null; snap.citadel = W.citadel | 0; }   // floor modifier (👑/🐀/☠/🏦) → client dungeon HUD tag; #121 snap.citadel → the client knows this delve is the Sunken Citadel
    if (S.citadelGate) snap.citadelGate = { tx: S.citadelGate.tx, ty: S.citadelGate.ty };   // #121: the world-shared gate a slain pinnacle opened — already-connected clients stamp+render it (the join-time overworld grid can't carry a mid-session tile flip)
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
    // YOUR questline (per-player, ON the player since P2/S13), version-gated so it costs 0 B/tick at
    // rest. Read off `me` — never through the state.player pin, which holds whichever hero the sim last
    // pinned. A fresh player has _qSeen 0 !== _qN 1, so the roster/feed guarantee applies here too:
    // quests ALWAYS ride your first snapshot.
    if ((me._qSeen | 0) !== (me._qN | 0)) {
      me._qSeen = me._qN | 0;
      snap.quests = safeClone(me.quests);
      snap.bounty = me.bounty ? safeClone(me.bounty) : null;
      snap.loreFound = (me.loreFound || []).slice();   // P2/S11: YOUR Realm-stone discoveries (per-hero). Kept in this gated payload (not dropped for the `me` copy) so the quest-box REPAINT edge stays airtight: adoptQuests consumes it in ws.onmessage and calls updateQuests() immediately — before the frame loop has reconciled snap.me into state.player.
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
    // YOUR inventory (snapshot v2) — version-gated exactly like the quest block above: `me` no longer
    // carries the bag (safeClone skips it), so it rides here only when the %40 stamp saw it change.
    // A fresh player has _invSeen 0 !== 1 (addPlayer seeds version 1), so the bag ALWAYS rides your
    // first snapshot; `welcome` seeds it too (inventoryPayload — the takeover path, which also rewinds
    // _invSeen in index.js). Adopted client-side in ws.onmessage (adoptInventory), never reconcile.
    {
      const iv = this._invN.get(id) | 0;
      if ((me._invSeen | 0) !== iv) {
        me._invSeen = iv;
        snap.inventory = safeClone(me.inventory);
      }
    }
    // WORLD FEATURES (snapshot v2) — npcs/shrines/loreStones/pois, one shared version for the room
    // (_wfN, stamped in the %40 block). Fresh player: _wfSeen 0 !== _wfN ≥ 1 → always on the first
    // snapshot; `welcome` seeds it too (featuresPayload) and index.js rewinds _wfSeen on takeover.
    if ((me._wfSeen | 0) !== this._wfN) {
      me._wfSeen = this._wfN;
      snap.wf = this._wfObj || this.featuresPayload();
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

  // Snapshot v2 (plan §5) — the two new gated payload builders. PURE READS, like legionPayload/
  // questPayload below: they must never consume a `_seen` edge (the takeover-rewind rule).
  // This hero's whole bag — rides `welcome` (join/takeover seed) + the gated snap.inventory.
  inventoryPayload(id) {
    const p = this.players.get(id);
    return p ? safeClone(p.inventory) : null;
  }
  // The OVERWORLD's near-static world features, projected to exactly what the client renders.
  // Volatile per-frame fields are stripped/quantized HERE (the %40 gate stringifies this same
  // projection, so a field kept here re-sends the payload every time it ticks):
  //   npc `temp`   — the wandering merchant's despawn countdown, decremented every frame. The
  //                  client never reads it (arrival/removal changes the array itself → edge).
  //   shrine `cd`  — ticks down every frame while cooling; drawShrine reads only its SIGN
  //                  (`cd <= 0`), so it is quantized to 1/0 → exactly two edges per cooldown.
  //   shrine `sinkT` — the 60-frame sink animation counter; stripped (the spend edge repaints
  //                  `sinking`, the splice edge removes it — the client just skips the slide).
  featuresPayload() {
    return {
      npcs: (S.npcs || []).map((n) => { const r = packScalar(n); delete r.temp; return r; }),
      shrines: (S.shrines || []).map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, type: s.type, sinking: !!s.sinking, cd: s.cd > 0 ? 1 : 0 })),
      lore: (S.loreStones || []).map((s) => safeClone(s)),
      pois: (S.pois || []).map((s) => packScalar(s)),
    };
  }

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
    return { quests: safeClone(p.quests), bounty: p.bounty ? safeClone(p.bounty) : null, loreFound: (p.loreFound || []).slice(), maxDepth: p.maxDepth | 0 };   // P2/S11: loreFound is per-hero (this hero's own discoveries)
  }

  // Force a dungeon-grid re-send to a stuck client (it asked via {type:'needmap'}): rewind _sentDgN one
  // behind _mapSwitchN so the next snapshotFor sees a rising edge and re-attaches dgTiles. Covers a dropped
  // grid AND a reconnect that landed straight inside a live dungeon (welcome carries only the overworld).
  resendMap(id) { const p = this.players.get(id); if (p) p._sentDgN = (p._mapSwitchN || 0) - 1; }

  // v3.2.2 FIX 1 — drop the per-broadcast death-FX buffer once every client's snapshot has drained it
  // (index.js broadcast() calls this after the client loop). A pure clear of the module-level array —
  // off the hashed sim state, so it can never move a golden baseline.
  clearDeaths() { _deathbuf.length = 0; }

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
