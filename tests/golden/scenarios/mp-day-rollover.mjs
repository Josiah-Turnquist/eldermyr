/*
 * MP scenario (kind 'world'): mp-day-rollover — rebuild P2/S2.
 * The day-rollover ANALOGUE for the 2-player rig: exercise onNewDay() through
 * the World tick (world.js:_step → G.updateTime()) exactly like the SP
 * scenario — park state.time just before the boundary, then TICK across it.
 * Two crossings in 3000 ticks (#1 during tick 699 → first divergent sample
 * possible at 700; #2 during tick 2200), with the post-Great-Hunt world state
 * reconstructed so maybeRespawnHunts does REAL work at crossing #1.
 *
 * This is the baseline S4 (the onNewDay World/Hero split) re-records and
 * asserts against; until then it freezes today's behavior, INCLUDING the known
 * #116 bug (onNewDay firing against whichever hero the previous tick last
 * pinned) — the bug is deterministic, so it hashes stably.
 *
 * Determinism contract: fixed setup, tick-derived box walks (A and B on
 * opposite rotations), fixed re-park tick. Players visited in JOIN ORDER.
 * No scenario-side Math.random, no wall clock.
 */
'use strict';

// The game's day length, hard-verified against the captured curDay() below
// (same drift guard as the SP scenario — a changed day length is a gameplay
// change: re-record consciously, never let a silent skew record a bogus oracle).
const DAY_FRAMES = 21600;
const PRE = 700;          // park this many ticks before each boundary
const REPARK_TICK = 1500; // fixed tick for the (non-crossing) day-2 re-park
const WALK = { A: ['d', 's', 'a', 'w'], B: ['a', 'w', 'd', 's'] };

export default {
  id: 'mp-day-rollover',
  kind: 'world',
  ticks: 3000,
  players: [{ id: 'A', name: 'Ava' }, { id: 'B', name: 'Bo' }],

  setup(ctx) {
    const G = ctx.G, S = G.state;
    const t0 = S.time;
    S.time = DAY_FRAMES; if (G.curDay() !== 2) { S.time = t0; throw new Error('DAY_FRAMES drift: curDay(' + DAY_FRAMES + ') !== 2'); }
    S.time = DAY_FRAMES - 1; if (G.curDay() !== 1) { S.time = t0; throw new Error('DAY_FRAMES drift: curDay(' + (DAY_FRAMES - 1) + ') !== 1'); }

    // Post-hunt world state (what killEnemy leaves after the 4th Great Beast):
    // boot-spawned beasts removed, all keys slain, respawn due on day 2.
    // Removing them BEFORE the first tick also keeps the World's
    // _rescaleThreats pass off the GREAT_HUNTS table, so a 'hunt' perturbation
    // stays invisible until the boundary consumes it (the b2 proof relies on it).
    const keys = (G.GREAT_HUNTS || []).map((h) => h.key);
    S.huntsSlain = keys.slice();
    for (let i = S.enemies.length - 1; i >= 0; i--) { if (S.enemies[i] && S.enemies[i].isGreatBeast) S.enemies.splice(i, 1); }
    S.huntRespawnDay = 2;

    // Park just before the day-1 -> 2 boundary; the run TICKS across it.
    S.time = DAY_FRAMES - PRE;
  },

  preTick(ctx, t) {
    // Quiet, deterministic box walks near the home town, opposite rotations.
    const phase = Math.floor(t / 60) % 4;
    for (const p of ctx.players) {               // JOIN ORDER
      const held = {};
      if (!p.downed) held[WALK[p.id][phase]] = true;
      p.held = held;
    }
  },

  postTick(ctx, t) {
    if (t === REPARK_TICK) {
      // Move WITHIN day 2 (floor(t/DAY_FRAMES)=1 both sides of the set, so no
      // boundary is skipped). Crossing #2 then happens naturally ~tick 2200.
      ctx.G.state.time = 2 * DAY_FRAMES - PRE;
    }
  },
};
