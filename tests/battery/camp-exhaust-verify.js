const __RR = require('path').resolve(__dirname, '..', '..');
// v2.56.5: camping in a dungeon must CLEAR Exhausted (v2.56.2 healed but never recorded the rest).
// isExhausted() = curDay()-lastRestDay >= 2. lastRestDay lives ON state.player (P2/S7; formerly a
// PP_KEY, swapped per slice) — only state.time is shared.
const { World } = require('' + __RR + '/server/world.js');
const DAY = 21600;   // real literal — G.DAY_FRAMES is uncaptured (undefined → NaN poisons the clock)
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${x !== undefined ? '  [' + x + ']' : ''}`); };

const w = new World();
const G = global.__game, S = G.state;
const p = w.addPlayer('a', { name: 'A' });
const p2 = w.addPlayer('b', { name: 'B' });

// --- SP-shape check: drive doCamp directly with this hero swapped in ---
// (P2/S7: lastRestDay/camping/campHealLeft live ON the player, so the S.player pin IS the swap.)
const camp = (map, hero) => {
  S.player = hero; S.inventory = hero.inventory;
  S.map = map;
  S.enemies.length = 0;                       // no foes near → camp allowed
  hero.camping = false;
  const t0 = S.time;
  G.doCamp();
  return { t0, timeAfter: S.time, lastRestDay: hero.lastRestDay, camping: S.player.camping };
};

console.log('=== DUNGEON camp clears Exhausted ===');
S.time = 6 * DAY + Math.floor(DAY * 0.45);    // day 7, midday
p.lastRestDay = 1;                            // rested on day 1 → 6 days ago → EXHAUSTED
S.player = p;
ok(G.isExhausted() === true, 'precondition: hero IS Exhausted before camping', 'daysSinceRest=' + (G.curDay()-(p.lastRestDay||1)));

const r = camp('dungeon', p);
ok(r.camping === true, 'dungeon camp engaged', 'camping=' + r.camping);
ok(G.isExhausted() === false, 'dungeon camp CLEARS Exhausted  <-- the reported bug', 'daysSinceRest=' + (G.curDay()-(p.lastRestDay||1)));
ok(r.lastRestDay === G.curDay(), 'lastRestDay recorded as TODAY (no skip)', 'lastRestDay=' + r.lastRestDay + ' curDay=' + G.curDay());
ok(r.timeAfter === r.t0, 'dungeon camp does NOT skip the shared clock', 'time ' + r.t0 + ' -> ' + r.timeAfter);

console.log('\n=== OVERWORLD camp still behaves exactly as before ===');
S.time = 6 * DAY + Math.floor(DAY * 0.45);
p.lastRestDay = 1;
S.player = p;
const ow = camp('overworld', p);
ok(ow.timeAfter > ow.t0, 'overworld camp STILL fast-forwards to next morning', 'time ' + ow.t0 + ' -> ' + ow.timeAfter);
ok(G.isExhausted() === false, 'overworld camp still clears Exhausted');
ok(ow.lastRestDay === G.curDay(), 'overworld lastRestDay = the skipped-to day', 'lastRestDay=' + ow.lastRestDay);

console.log('\n=== MP: dungeon camp via the real RPC path, per-player only ===');
S.time = 6 * DAY + Math.floor(DAY * 0.45);
const day = Math.floor(S.time / DAY) + 1;
p.lastRestDay = 1; p2.lastRestDay = 1;        // BOTH heroes exhausted
// doCamp reads state.map, NOT p.map — setting only p.map silently tested an OVERWORLD camp
// (it skipped the clock, hit the `camped` branch, and "passed" for the wrong reason).
S.map = 'dungeon'; p.map = 'dungeon'; p.camping = false;
S.enemies.length = 0;
const tBefore = S.time;
w._runRpc({ rpc: 'doCamp', args: [] }, p);    // only A camps
w.tick();
ok(p.lastRestDay === day, 'A: rest RECORDED on the player (P2/S7: doCamp writes state.player.lastRestDay directly — the rotation pin IS the swap, no mirror needed)', 'A.lastRestDay=' + p.lastRestDay + ' day=' + day);
ok(p.camping === true, 'A: is camping', 'camping=' + p.camping);
ok(p2.lastRestDay === 1, 'B: UNAFFECTED — resting is per-player, not shared', 'B.lastRestDay=' + p2.lastRestDay);
ok(Math.abs(S.time - tBefore) <= 2, 'world clock did NOT jump for anyone', 'dt=' + (S.time - tBefore));
ok(p._exWas === false, 'A: server fatigue mirror cleared', '_exWas=' + p._exWas);

console.log(`\n  ${fail === 0 ? '✅' : '⚠'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
