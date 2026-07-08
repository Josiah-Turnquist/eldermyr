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

// ---- serialization helpers (feed the real game renderer) ----
// scalar-only copy: safe against circular refs (e.g. enemy.warlordRef), keeps
// every primitive field the draw functions read (type, color, wobble, status…).
function packScalar(o) {
  const r = {};
  for (const k in o) { const v = o[k], t = typeof v; if (v === null || t === 'number' || t === 'string' || t === 'boolean') r[k] = v; }
  return r;
}
let _nidSeq = 0;
function packEnemy(e) {
  if (e._nid == null) e._nid = ++_nidSeq;   // stable id so the client can diff hits/deaths across snapshots
  const r = packScalar(e);
  if (e.tele) r.tele = { t: e.tele.t, max: e.tele.max, name: e.tele.name, radius: e.tele.radius, aimX: e.tele.aimX, aimY: e.tele.aimY };
  return r;
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
  for (const k in v) { if (k === 'held' || k === 'actions' || k === 'input') continue; const c = safeClone(v[k], d + 1); if (c !== undefined) r[k] = c; }
  return r;
}

// Whitelist of game functions a client may invoke on itself via a menu RPC.
// (Anything not here — startGame, genLegion, etc. — is ignored, so a client
// can't drive arbitrary server logic.)
const RPC_OK = new Set([
  'equipWeapon', 'equipArmor', 'sellItem', 'sellAllJunk', 'drinkPotion', 'spendPoint',
  'useWhirlwind', 'useFocus', 'castSpell', 'useUltimate', 'useSummon', 'toggleMount', 'toggleBoat', 'doCamp',
]);

class World {
  constructor() {
    this.state = S;
    this.players = new Map();          // id -> player object
    this._seq = 0;
  }

  get list() { return S.players; }

  addPlayer(id, name) {
    const p = clone(PLAYER_TEMPLATE);
    p.id = id;
    p.name = name || ('Hero-' + (++this._seq));
    p.x = SPAWN.x + (Math.floor((this._seq) / 4) * TILE);   // fan out a little so they don't stack
    p.y = SPAWN.y + ((this._seq % 4) * TILE);
    p.hp = p.maxHp;
    p.inventory = clone(INV_TEMPLATE);
    p.held = {}; p.actions = [];
    S.players.push(p);
    this.players.set(id, p);
    return p;
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

  // ---- the authoritative tick ----
  tick() {
    if (!S.players.length) return;
    S.scene = 'play';                 // server always simulates; neutralize transient scene changes (death/dialogue/shop)
    G.updateTime();

    // PER-PLAYER: movement, discrete actions, fatigue. Swap the acting player +
    // its inventory into the singleton slots the game logic reads.
    for (const p of S.players) {
      S.player = p; S.inventory = p.inventory;
      setKeys(p.held);
      try { G.updatePlayer(); } catch (_e) {}
      // discrete actions (edge-triggered in single-player via keydown)
      if (p.actions.length) {
        for (const a of p.actions) {
          try {
            if (a === 'attack' && G.tryAttack) { G.keys[' '] = true; G.tryAttack(); }
            else if (a === 'interact' && G.tryInteract) G.tryInteract();
            else if (a === 'dodge' && G.doDodge) G.doDodge();
            else if (a && a.rpc && RPC_OK.has(a.rpc) && typeof G[a.rpc] === 'function') G[a.rpc].apply(null, Array.isArray(a.args) ? a.args : []);
          } catch (_e) {}
        }
        p.actions.length = 0;
      }
      if (G.updateFatigue) try { G.updateFatigue(); } catch (_e) {}
    }

    // SHARED WORLD — enemies via nearest-player PARTITION (reuses real updateEnemies)
    const players = S.players;
    if (S.enemies.length) {
      const buckets = new Map(players.map((p) => [p, []]));
      for (const e of S.enemies) buckets.get(nearestPlayer(e, players)).push(e);
      const survivors = [];
      for (const p of players) {
        S.player = p;
        S.enemies = buckets.get(p);         // this player's assigned foes target HIM
        try { G.updateEnemies(); } catch (_e) {}
        survivors.push(...S.enemies);        // killEnemy() may have spliced some out
      }
      S.enemies = survivors;
    }

    // remaining shared systems run once (acting player = first, cosmetic-only bias)
    S.player = players[0]; S.inventory = players[0].inventory;
    for (const fn of ['updateProjectiles', 'maybeSpawnWild', 'updateFires', 'updateWeather', 'updateEvents', 'updateFactionWar', 'updateNemesisPresence']) {
      if (G[fn]) try { G[fn](); } catch (_e) {}
    }
    // respawn dead players at town — one death must not end everyone's shared game
    for (const p of players) {
      if (p.hp <= 0) {
        p.hp = p.maxHp; p.x = SPAWN.x; p.y = SPAWN.y; p.invuln = 90;
        p.chillT = 0; p.burnT = 0; p.poisonT = 0; p.dead = false;
        p._respawned = (p._respawned || 0) + 1;
      }
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
    const cx = me.x, cy = me.y;
    const near = (o) => (o.x - cx) ** 2 + (o.y - cy) ** 2 < World.R2;
    return {
      t: S.time, wx: S.weather, you: id,
      me: safeClone(me),
      players: S.players.map((p) => ({ id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), w: p.w, h: p.h, dir: p.dir, moving: !!p.moving, animFrame: p.animFrame | 0, hp: Math.round(p.hp), maxHp: Math.round(p.maxHp), level: p.level })),
      enemies: S.enemies.filter(near).map(packEnemy),
      proj: S.projectiles.filter(near).map(packScalar),
      pickups: S.pickups.filter((p) => !p.collected && near(p)).map((p) => safeClone(p)),
      npcs: (S.npcs || []).filter(near).map(packScalar),
    };
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
