/*
 * Scenario (a): overworld-combat.
 * Drive a single hero to move toward and attack the nearest enemy, ~3000 ticks.
 *
 * Determinism contract: the only inputs are (1) the nearest live enemy's
 * position and (2) the tick index — both deterministic functions of seed+tick.
 * No Math.random is called by the scenario itself.
 *
 * Coverage: updatePlayer movement, meleeSwing/tryAttack, killEnemy, loot drops,
 * gainXP/level-up/recalcStats, maybeSpawnWild refills, particles, and the whole
 * shared-phase battery (weather/events/faction war/nemesis) via the tick loop.
 */
'use strict';
import { setKeys, steerToward, nearestEnemy, seedFoesAround, playerCenter } from './_util.mjs';

export default {
  id: 'overworld-combat',
  ticks: 3000,

  setup(G) {
    // Guarantee foes to fight from tick 1 (mirrors world.js's self-test), then
    // let maybeSpawnWild top up the vicinity over the run.
    seedFoesAround(G, 6, 3);
  },

  preTick(G, t) {
    const tgt = nearestEnemy(G);
    if (tgt) {
      // Square up (dominant-axis facing) once we're within ~2 tiles so the
      // axis-aligned melee hitbox lands; approach diagonally when farther.
      const close = tgt.dist2 < (64 * 64);
      const e = tgt.e;
      steerToward(G, e.x + e.w / 2, e.y + e.h / 2, close);
    } else {
      // No target in the roster: patrol outward on a tick-derived heading so the
      // hero leaves the safe town into spawn country (and so a speed
      // perturbation still shows up while idle-searching).
      const phase = Math.floor(t / 240) % 4;
      setKeys(G, ['d', 's', 'a', 'w'][phase]);
    }
  },

  postTick(G, t) {
    // Attack whenever a foe is within a generous reach; tryAttack self-gates on
    // p.attackCooldown, so calling every tick just means "hold the attack key".
    const tgt = nearestEnemy(G);
    if (tgt && tgt.dist2 < (52 * 52)) {
      try { G.tryAttack(); } catch (_e) {}
    }
  },
};
