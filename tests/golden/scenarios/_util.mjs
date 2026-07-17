/*
 * _util.mjs — deterministic input helpers shared by the scenarios.
 *
 * INVARIANT: nothing here calls Math.random or reads wall-clock time. Every
 * decision is a pure function of the live sim state (which is itself a
 * deterministic function of seed + tick) or of the integer tick index. That is
 * what makes a scenario a reproducible script rather than a second RNG.
 */
'use strict';

// Clear the game's live key map, then (optionally) press a set of keys. The
// game reads keys['w'|'a'|'s'|'d'] (and arrow aliases) in updatePlayer/dirVec.
export function setKeys(G, ...pressed) {
  const keys = G.keys;
  for (const k in keys) delete keys[k];
  for (const k of pressed) keys[k] = true;
}

export function playerCenter(G) {
  const p = G.state.player;
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
}

// Nearest LIVE enemy to the player, by squared center distance. Ties break on
// array index (stable), so the choice is fully deterministic.
export function nearestEnemy(G) {
  const c = playerCenter(G);
  const es = G.state.enemies;
  let best = null, bd = Infinity;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (!e || e.hp <= 0) continue;
    const dx = e.x + e.w / 2 - c.x, dy = e.y + e.h / 2 - c.y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = e; bd = d; }
  }
  return best ? { e: best, dist2: bd } : null;
}

// Press keys to walk toward (tx,ty) world-pixel target. When `squareUp` is set
// and we're close, press ONLY the dominant axis so p.dir faces the target head
// on (melee hitboxes are axis-aligned, so this guarantees the swing lands).
export function steerToward(G, tx, ty, squareUp = false) {
  const c = playerCenter(G);
  const dx = tx - c.x, dy = ty - c.y;
  const TH = 3;
  const keys = [];
  if (squareUp) {
    if (Math.abs(dx) >= Math.abs(dy)) { if (dx > TH) keys.push('d'); else if (dx < -TH) keys.push('a'); }
    else { if (dy > TH) keys.push('s'); else if (dy < -TH) keys.push('w'); }
  } else {
    if (dy < -TH) keys.push('w'); else if (dy > TH) keys.push('s');
    if (dx < -TH) keys.push('a'); else if (dx > TH) keys.push('d');
  }
  setKeys(G, ...keys);
  return { dx, dy, dist2: dx * dx + dy * dy };
}

// Spawn `n` wild foes in a ring around the player using the game's OWN enemy
// factory (captured) — the same pattern server/world.js's self-test uses. Keeps
// the choice deterministic (makeWildEnemy draws from the seeded stream) while
// guaranteeing combat exists to exercise from tick 1.
export function seedFoesAround(G, n, radiusTiles = 3) {
  const TILE = G.TILE || 32;
  const p = G.state.player;
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
