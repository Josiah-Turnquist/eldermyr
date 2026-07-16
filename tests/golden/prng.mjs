/*
 * prng.mjs — mulberry32, a tiny fast deterministic 32-bit PRNG.
 * ----------------------------------------------------------------------------
 * The golden-master harness replaces the global `Math.random` with an instance
 * of this BEFORE the game code is eval'd, so every `Math.random()` the engine
 * calls (worldgen, spawns, loot, crits, wander…) draws from a seeded stream.
 * Same seed -> same stream -> same sim trajectory. That is the whole trick that
 * turns a stochastic action-RPG into a reproducible oracle.
 *
 * Reference implementation (public domain, Tommy Ettinger / bryc). Returns a
 * float in [0, 1) with the same contract as Math.random.
 */
'use strict';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normalize any seed (number or string) into a uint32, so callers can pass a
// human-readable label ("overworld-combat") or a number and get a stable seed.
export function seedFrom(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  const s = String(value);
  // FNV-1a 32-bit — deterministic string -> uint32.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
