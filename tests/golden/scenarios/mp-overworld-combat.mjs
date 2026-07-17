/*
 * MP scenario (kind 'world'): mp-overworld-combat — rebuild P2/S2.
 * The overworld-combat ANALOGUE for the 2-player rig: the harness worker seeds
 * Math.random, requires server/world.js (which boots the game), adds players
 * A + B, and calls w.tick() ~3000 times while THIS module scripts each hero's
 * held keys + attack actions (self-test style). Hash root: {state, maps} —
 * the World's off-state room fields (feed/_errAt/perf EMAs) are excluded.
 *
 * Coverage (the machinery the P2 ladder rewrites — these baselines freeze it):
 * per-player rotation + PP swap, enemy nearest-player partition + __libGate,
 * killEnemy credit per bucket, projectile shooter buckets, per-player spawn
 * pass, hostile-shot/fire/chill patches, downed/revive, threat rescale.
 *
 * Determinism contract: players are visited in state.players JOIN ORDER
 * (A then B); the only inputs are nearest-live-enemy positions and the tick
 * index. No scenario-side Math.random, no wall clock.
 */
'use strict';
import { nearestEnemyTo, heldToward, seedFoesAroundPlayer } from './_util-mp.mjs';

const PATROL = { A: ['d', 's', 'a', 'w'], B: ['a', 'w', 'd', 's'] }; // opposite headings → the heroes split up (distinct enemy buckets)

export default {
  id: 'mp-overworld-combat',
  kind: 'world',
  ticks: 3000,
  players: [{ id: 'A', name: 'Ava' }, { id: 'B', name: 'Bo' }],

  setup(ctx) {
    // Guarantee foes for BOTH heroes from tick 1 (mirrors the world.js
    // self-test); the World's own density-driven spawn pass tops up after.
    for (const p of ctx.players) seedFoesAroundPlayer(ctx.G, p, 6, 3);
  },

  postTick(ctx, t) {
    // P2/S13 ACTIVE ASSERT (the plan's quest-slice gate): the world-object quests —
    // main (one Kraken), frozen (one Cache), legion (one war) — must be THE SAME OBJECT
    // across every hero, tick after tick (the room shares one war), while the personal
    // keys (talk/key/slay/dragon) must be genuinely FORKED per hero. A private copy of a
    // shared quest silently forks the room's war; a shared personal key re-creates the
    // v2.57.0 "one box for two heroes" bug. Identity (===), not value equality — a deep
    // clone with equal values is exactly the failure this exists to catch.
    // SEEN FAILING against a deliberately-forked scratch build (aliasSharedQuests
    // neutered to deep-clone): throws here at t=0.
    if (t % 500 === 0) {
      const [A, B] = ctx.players;
      for (const k of ['main', 'frozen', 'legion']) {
        if (A.quests[k] !== B.quests[k]) throw new Error(`S13 identity assert @t=${t}: quests.${k} FORKED across heroes (room's war split)`);
      }
      for (const k of ['talk', 'key', 'slay', 'dragon']) {
        if (A.quests[k] === B.quests[k]) throw new Error(`S13 identity assert @t=${t}: personal quests.${k} SHARED across heroes (one box for two heroes)`);
      }
    }
  },

  preTick(ctx, t) {
    for (const p of ctx.players) {              // JOIN ORDER — part of the contract
      if (p.downed) { p.held = {}; continue; }  // incapacitated: the downed pass owns them
      const tgt = nearestEnemyTo(ctx.G, p);
      if (tgt) {
        // Square up (dominant-axis facing) within ~2 tiles so melee lands;
        // approach diagonally when farther — same thresholds as the SP scenario.
        const e = tgt.e;
        p.held = heldToward(p, e.x + e.w / 2, e.y + e.h / 2, tgt.dist2 < 64 * 64);
        // "Hold the attack key": tryAttack self-gates on p.attackCooldown.
        // Bounded queue: _runActions drains it every tick while standing.
        if (tgt.dist2 < 52 * 52 && p.actions.length < 4) p.actions.push('attack');
      } else {
        // No target: patrol outward on a tick-derived heading, each hero on a
        // different rotation so they separate (and a speed perturb on A still
        // shows while idle-searching).
        const held = {};
        held[PATROL[p.id][Math.floor(t / 240) % 4]] = true;
        p.held = held;
      }
    }
  },
};
