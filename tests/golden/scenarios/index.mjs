/*
 * Scenario registry. Add a scenario module here and it becomes recordable /
 * checkable by id. Each module default-exports { id, ticks, setup, preTick,
 * postTick }.
 */
'use strict';
import overworldCombat from './overworld-combat.mjs';
import dungeon from './dungeon.mjs';
import dailyLife from './daily-life.mjs';

export const SCENARIOS = {
  [overworldCombat.id]: overworldCombat,
  [dungeon.id]: dungeon,
  [dailyLife.id]: dailyLife,
};

export const SCENARIO_IDS = Object.keys(SCENARIOS);
