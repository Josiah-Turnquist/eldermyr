/*
 * _util-mp.mjs — deterministic input helpers for the `world`-kind (2-player)
 * scenarios (rebuild P2/S2). They script each hero's `p.held`/`p.actions` the
 * way server/world.js's own self-test does; the World's per-player rotation
 * consumes them (setKeys(p.held), _runActions).
 *
 * INVARIANT (same as _util.mjs): nothing here calls Math.random or reads a
 * clock. Every decision is a pure function of live sim state + the tick index,
 * and callers must visit players in state.players JOIN ORDER (A then B) —
 * per-player iteration order is part of the determinism contract these
 * baselines freeze (rebuild/p2-plan.md §2 legend ⚠).
 */
'use strict';

export function centerOf(o) { return { x: o.x + o.w / 2, y: o.y + o.h / 2 }; }

// Nearest LIVE enemy to player p, by squared center distance. Ties break on
// array index (stable), so the choice is fully deterministic.
export function nearestEnemyTo(G, p) {
  const c = centerOf(p);
  const es = G.state.enemies;
  let best = null, bd = Infinity;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (!e || e.hp <= 0) continue;
    const dx = e.x + e.w / 2 - c.x, dy = e.y + e.h / 2 - c.y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = e; }
  }
  return best ? { e: best, dist2: bd } : null;
}

// Build the `held` map that walks p toward (tx,ty). squareUp: dominant axis
// only, so p.dir faces the target head-on and the axis-aligned melee hitbox
// lands (identical logic to _util.mjs's steerToward, minus the G.keys write —
// in MP the World feeds p.held into G.keys itself, per player, per tick).
export function heldToward(p, tx, ty, squareUp = false) {
  const c = centerOf(p);
  const dx = tx - c.x, dy = ty - c.y;
  const TH = 3;
  const held = {};
  if (squareUp) {
    if (Math.abs(dx) >= Math.abs(dy)) { if (dx > TH) held.d = true; else if (dx < -TH) held.a = true; }
    else { if (dy > TH) held.s = true; else if (dy < -TH) held.w = true; }
  } else {
    if (dy < -TH) held.w = true; else if (dy > TH) held.s = true;
    if (dx < -TH) held.a = true; else if (dx > TH) held.d = true;
  }
  return held;
}

// Spawn n wild foes in a deterministic ring around PLAYER P using the game's
// OWN enemy factory (RNG draws come from the seeded stream) — _util.mjs's
// seedFoesAround, parameterized by player instead of reading state.player.
export function seedFoesAroundPlayer(G, p, n, radiusTiles = 3) {
  const TILE = G.TILE || 32;
  const ptx = Math.floor((p.x + p.w / 2) / TILE);
  const pty = Math.floor((p.y + p.h / 2) / TILE);
  let made = 0;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2; // deterministic ring, not random
    const tx = ptx + Math.round(Math.cos(ang) * radiusTiles);
    const ty = pty + Math.round(Math.sin(ang) * radiusTiles);
    let e = null;
    try { e = G.makeWildEnemy(tx, ty); } catch (_e) { e = null; }
    if (!e) continue;
    // pin it just off the player so the first swings connect
    e.x = p.x + Math.cos(ang) * radiusTiles * TILE;
    e.y = p.y + Math.sin(ang) * radiusTiles * TILE;
    G.state.enemies.push(e);
    made++;
  }
  return made;
}
