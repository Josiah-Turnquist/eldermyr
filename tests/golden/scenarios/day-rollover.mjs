/*
 * Scenario (d): day-rollover.
 * Exercise onNewDay() NATURALLY: park state.time just before the day boundary,
 * then tick THROUGH it so updateTime() itself fires onNewDay — no direct-set
 * ever crosses a boundary. Two crossings in 3000 ticks:
 *
 *   setup:       time = DAY_FRAMES-700 (20900, day 1)  -> crossing #1 during tick 699
 *   tick 1500:   time = 2*DAY_FRAMES-700 (42500 — still day 2, floor unchanged,
 *                so the set skips NOTHING)              -> crossing #2 during tick 2200
 *
 * To make onNewDay do REAL work at crossing #1 (not just legionDaily), setup
 * reconstructs the post-Great-Hunt world state: all four beasts slain (the boot
 * spawns removed, their keys in huntsSlain) with the respawn due tomorrow —
 * exactly what killEnemy leaves behind. maybeRespawnHunts then rebuilds all four
 * beasts from the GREAT_HUNTS table AT the boundary (huntCycle 0->1). Crossing
 * #2 exercises the quiet daily path (respawn day consumed, all maybe* no-op) and
 * marches curDay to 3, which also flips isExhausted (lastRestDay stays 1).
 *
 * Determinism contract: setup is fixed, movement is a tick-derived box walk, the
 * re-park is at a fixed tick. No scenario-side Math.random, no wall clock.
 */
'use strict';
import { setKeys } from './_util.mjs';

// The game's day length. NOT in the CAPTURE list, so it cannot be read directly —
// but curDay() IS captured, so setup() hard-verifies this constant against the
// live engine and throws loudly on drift (a changed day length is a gameplay
// change: re-record consciously, don't let a silent skew record a bogus oracle).
const DAY_FRAMES = 21600;
const PRE = 700;          // park this many ticks before each boundary
const REPARK_TICK = 1500; // fixed tick for the (non-crossing) day-2 re-park

export default {
  id: 'day-rollover',
  ticks: 3000,

  setup(G) {
    const S = G.state;
    // Guard DAY_FRAMES against the captured curDay() (curDay = floor(t/D)+1).
    const t0 = S.time;
    S.time = DAY_FRAMES; if (G.curDay() !== 2) { S.time = t0; throw new Error('DAY_FRAMES drift: curDay(' + DAY_FRAMES + ') !== 2'); }
    S.time = DAY_FRAMES - 1; if (G.curDay() !== 1) { S.time = t0; throw new Error('DAY_FRAMES drift: curDay(' + (DAY_FRAMES - 1) + ') !== 1'); }

    // Post-hunt world state (what killEnemy leaves after the 4th Great Beast):
    // boot-spawned beasts removed, all keys slain, respawn due on day 2.
    const keys = (G.GREAT_HUNTS || []).map((h) => h.key);
    S.huntsSlain = keys.slice();
    for (let i = S.enemies.length - 1; i >= 0; i--) { if (S.enemies[i] && S.enemies[i].isGreatBeast) S.enemies.splice(i, 1); }
    S.huntRespawnDay = 2;

    // Park just before the day-1 -> 2 boundary; the run TICKS across it.
    S.time = DAY_FRAMES - PRE;
  },

  preTick(G, t) {
    // Quiet, deterministic box walk near the home town (same idiom as daily-life).
    const phase = Math.floor(t / 60) % 4;
    setKeys(G, ['d', 's', 'a', 'w'][phase]);
  },

  postTick(G, t) {
    if (t === REPARK_TICK) {
      // Move WITHIN day 2 (20900+1501=22401 -> 42500; floor(t/DAY_FRAMES)=1 for
      // both, so no boundary is skipped by the set). Crossing #2 then happens
      // naturally ~700 ticks later, during tick 2200.
      G.state.time = 2 * DAY_FRAMES - PRE;
    }
  },
};
