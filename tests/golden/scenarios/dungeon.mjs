/*
 * Scenario (b): dungeon.
 * Travel toward state.dungeonEntrance, enter the Sunken Dungeon, descend through
 * several floors, and fight — ~3000 ticks.
 *
 * The overworld->entrance walk is capped: the entrance is often ~200 tiles from
 * spawn (infeasible to foot-slog in 3000 ticks), so we walk toward it for a
 * short overworld phase (exercising overworld movement/collision/spawns), then
 * place the hero on the entrance tile and call the captured enterDungeon(). Most
 * of the run is spent IN the dungeon (the point of this scenario): descending via
 * the captured setupDungeonFloor and fighting the floor's foes.
 *
 * Determinism contract: phase transitions are keyed to the integer tick; combat
 * steering is keyed to nearest-enemy position. No scenario-side Math.random.
 */
'use strict';
import { setKeys, steerToward, nearestEnemy } from './_util.mjs';

const ENTER_TICK = 300;    // overworld travel window, then descend
const DESCEND_EVERY = 500; // ticks between floor descents once inside

let entered = false;
let lastDescend = 0;

export default {
  id: 'dungeon',
  ticks: 3000,

  setup(G) {
    entered = false;
    lastDescend = 0;
  },

  preTick(G, t) {
    const S = G.state;
    const TILE = G.TILE || 32;
    if (!entered) {
      // Overworld: steer toward the dungeon entrance world-pixel target.
      const ent = S.dungeonEntrance || { tx: 168, ty: 196 };
      steerToward(G, ent.tx * TILE + TILE / 2, ent.ty * TILE + TILE / 2, false);
      return;
    }
    // In the dungeon: chase and square up on the nearest foe.
    const tgt = nearestEnemy(G);
    if (tgt) {
      const e = tgt.e;
      steerToward(G, e.x + e.w / 2, e.y + e.h / 2, tgt.dist2 < (64 * 64));
    } else {
      // No foe in view: patrol on a tick-derived heading to find the room.
      const phase = Math.floor(t / 90) % 4;
      setKeys(G, ['d', 's', 'a', 'w'][phase]);
    }
  },

  postTick(G, t) {
    const S = G.state;
    const TILE = G.TILE || 32;

    // Transition: enter the dungeon once the overworld window elapses.
    if (!entered && t >= ENTER_TICK) {
      const ent = S.dungeonEntrance || { tx: 168, ty: 196 };
      const p = S.player;
      // "Arrive" at the entrance tile, then use the real descent path.
      p.x = ent.tx * TILE; p.y = ent.ty * TILE;
      try { G.enterDungeon(); entered = true; lastDescend = t; } catch (_e) {}
      return;
    }

    if (entered) {
      // Attack anything in reach (self-gated by cooldown).
      const tgt = nearestEnemy(G);
      if (tgt && tgt.dist2 < (52 * 52)) { try { G.tryAttack(); } catch (_e) {} }

      // Descend on a fixed cadence via the captured floor generator. We mirror
      // descend()'s core (bump level + maxDepth, regenerate the floor) without
      // the uncaptured descend() wrapper.
      if (t - lastDescend >= DESCEND_EVERY) {
        S.dungeonLevel = (S.dungeonLevel | 0) + 1;
        S.maxDepth = Math.max(S.maxDepth | 0, S.dungeonLevel);
        try { G.setupDungeonFloor(S.dungeonLevel); } catch (_e) {}
        lastDescend = t;
      }
    }
  },
};
