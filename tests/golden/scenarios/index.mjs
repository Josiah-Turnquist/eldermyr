/*
 * Scenario registry. Add a scenario module here and it becomes recordable /
 * checkable by id. Each module default-exports { id, ticks, setup, preTick,
 * postTick } — plus, for the 2-player rig (rebuild P2/S2), { kind: 'world',
 * players } which makes the worker drive server/world.js's tick() instead of
 * the captured SP update loop.
 *
 * TWO registries on purpose: SCENARIOS/SCENARIO_IDS stay 1-player-only (they
 * feed oracle.json's record/check/prove — untouched all P2 long, per
 * rebuild/p2-plan.md's hash-shape ruling); MP_SCENARIOS feed oracle-mp.json
 * via the mp-record/mp-check/mp-prove commands and are re-recorded
 * consciously per P2 slice.
 */
'use strict';
import overworldCombat from './overworld-combat.mjs';
import dungeon from './dungeon.mjs';
import dailyLife from './daily-life.mjs';
import dayRollover from './day-rollover.mjs';
import mpOverworldCombat from './mp-overworld-combat.mjs';
import mpDayRollover from './mp-day-rollover.mjs';

export const SCENARIOS = {
  [overworldCombat.id]: overworldCombat,
  [dungeon.id]: dungeon,
  [dailyLife.id]: dailyLife,
  [dayRollover.id]: dayRollover,   // appended LAST: keeps oracle.json re-records additive
};

export const SCENARIO_IDS = Object.keys(SCENARIOS);

export const MP_SCENARIOS = {
  [mpOverworldCombat.id]: mpOverworldCombat,
  [mpDayRollover.id]: mpDayRollover,
};

export const MP_SCENARIO_IDS = Object.keys(MP_SCENARIOS);
