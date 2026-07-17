/*
 * MP scenario (kind 'world'): mp-day-rollover — rebuild P2/S2.
 * The day-rollover ANALOGUE for the 2-player rig: exercise onNewDay() through
 * the World tick (world.js:_step → G.updateTime()) exactly like the SP
 * scenario — park state.time just before the boundary, then TICK across it.
 * Two crossings in 3000 ticks (#1 during tick 699 → first divergent sample
 * possible at 700; #2 during tick 2200), with the post-Great-Hunt world state
 * reconstructed so maybeRespawnHunts does REAL work at crossing #1.
 *
 * P2/S4 (the onNewDay World/Hero split, #116) re-recorded this baseline: setup
 * seeds an OWNED outpost so each crossing's dailyHoldingIncome does real work,
 * and postTick actively asserts EVERY hero draws the full per-head tribute.
 * Evidence pair (S4 report): same scenario, pre-split engine -> A=110/B=0 gold
 * and the assert throws; split engine -> A=110/B=110, first hash divergence
 * exactly at tick 700 (samples 0-6 identical).
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

    // An OWNED outpost (liberated + rebuilt, level 1), so the boundary's
    // dailyHoldingIncome does REAL work: tribute = 40 + level*15 = 55/hero/day.
    // dread rep is 0 (< 15) so maybeRaidHolding still returns BEFORE its RNG
    // draw — seeding the outpost shifts no random stream on either engine.
    if (!S.holdings || !S.holdings[0]) throw new Error('no holdings[0] to seed');
    S.holdings[0].liberated = true;
    S.holdings[0].built = true;

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
    // P2/S4 ACTIVE ASSERT (the plan's S4 gate): BOTH heroes' gold moves at each
    // crossing — every hero draws the outpost's full tribute (per-head pay), not
    // just whoever the previous tick left pinned (#116). Tribute is the run's
    // ONLY gold source (no shops, no scripted kills), so the check is exact.
    // SEEN FAILING on the pre-split engine: B.gold stayed 0 while A drew 110.
    if (t === PRE + 20 || t === REPARK_TICK + PRE + 20) {
      const S = ctx.G.state;
      const per = 40 + (S.holdings[0].level || 1) * 15; // dailyHoldingIncome's rate
      const days = t < REPARK_TICK ? 1 : 2;
      for (const p of ctx.players) {
        if (p.gold !== per * days) {
          throw new Error(
            `S4 tribute assert @t=${t}: hero ${p.id} gold=${p.gold}, expected ${per * days} ` +
            `(${days} crossing(s) x ${per}/hero) — daily income must reach EVERY hero`,
          );
        }
      }
    }
  },
};
