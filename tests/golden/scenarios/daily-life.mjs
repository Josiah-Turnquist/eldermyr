/*
 * Scenario (c): daily-life.
 * A quiet hero near the home town: potter about, then make camp and rest.
 * Camping (the captured doCamp) fast-forwards the shared clock to the next
 * morning and heals — so a handful of camps march the world through several
 * day cycles in ~3000 ticks, exercising the time/weather/event/fatigue/nemesis
 * systems and the camp-rest heal path without ever picking a fight.
 *
 * Determinism contract: movement is a tick-derived box walk; camp toggles are
 * keyed to the tick modulo and gated on the live camping flag. No scenario-side
 * Math.random.
 */
'use strict';
import { setKeys } from './_util.mjs';

const CAMP_PERIOD = 650; // one camp cycle per this many ticks
const CAMP_START = 12;   // phase within the period to start a camp
const CAMP_BREAK = 110;  // phase within the period to break it

export default {
  id: 'daily-life',
  ticks: 3000,

  setup(G) {},

  preTick(G, t) {
    const p = G.state.player;
    if (p.camping) { setKeys(G); return; } // resting: hold still
    // Small deterministic box walk around the home town (right/down/left/up),
    // net drift ~zero so the hero stays in the safe zone where camp is legal.
    const phase = Math.floor(t / 60) % 4;
    setKeys(G, ['d', 's', 'a', 'w'][phase]);
  },

  postTick(G, t) {
    const p = G.state.player;
    const inPeriod = t % CAMP_PERIOD;
    if (inPeriod === CAMP_START && !p.camping) {
      try { G.doCamp(); } catch (_e) {}       // start: heal + skip to next dawn
    } else if (inPeriod === CAMP_BREAK && p.camping) {
      try { G.doCamp(); } catch (_e) {}       // break: resume the day
    }
  },
};
