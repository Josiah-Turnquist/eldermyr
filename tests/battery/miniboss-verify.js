const __RR = require('path').resolve(__dirname, '..', '..');
// Headless verification for the mini-boss feature, slice S2 — presence + persistence + reward
// (signature MECHANICS are S3–S5, not here). Guards, all dead on the golden trajectories:
//   1. all FIVE spawn on boot at their fixed lairs, at their hand-set levels, curve-leveled from the
//      makeBoss base (90/12/4) with NO party term — 2 heroes joined, hp still the flat curve value;
//      each lair is non-solid + reachable + out of town; a 2nd presence pass makes no duplicates.
//   2. LAIR-BOUND: with both heroes far, a mini does not chase across the realm (sits at its lair);
//      bring a hero into the ~12-tile domain and it engages (not permanently frozen).
//   3. a KILL removes the boss + stamps state.mbRespawnDay[key] = curDay()+2, and it stays dead while
//      the cooldown holds (the presence loop refuses to re-spawn early).
//   4. once the day passes, the presence loop RE-SPAWNS it and clears the stale key; the onNewDayWorld
//      sweep (maybeRespawnMinis) clears come-due keys and keeps future ones.
//   5. the per-hero ~5% SIGNATURE roll is INDEPENDENT (the Citadel relic model): with RNG stubbed in
//      join order, A-hit/B-miss puts the legendary in A's bag only; B-hit/A-miss the reverse — proving
//      each present hero rolls their own, straight to their own bag, invisible to the other.
// SEEN-TO-FAIL: run against a pre-S2 artifact (ELDERMYR_GAME_FILE=…pre-S2.html) — 0 minis spawn and
// G.dropMiniReward is undefined, so every group fails.
process.env.HZ = '80';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const TILE = G.TILE;
const C = globalThis.CONTENT;
const CURVES = C.curves;
const MINIS = (C.apex && C.apex.minis) || []; // [] on a pre-S2 tree → the seen-to-fail reports clean all-fail, not a crash
const DAY_FRAMES = 21600;
const R = {};
const A1 = (name, cond, note) => { R[name] = !!cond; if (note !== undefined) R[name + '__'] = note; };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
w.tick(); // boots overworld; the room tick drives maybePinnacleBosses → minis spawn

// A land-reachability BFS from the hero spawn (isReachableOW isn't captured — replicate it).
const reachSet = (() => {
  const m = G.maps.overworld;
  const stx = Math.floor((A.x + A.w / 2) / TILE), sty = Math.floor((A.y + A.h / 2) / TILE);
  const seen = new Set([stx + ',' + sty]), st = [[stx, sty]];
  while (st.length) {
    const [x, y] = st.pop();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || ny >= m.length || nx >= m[0].length) continue;
      if (G.SOLID.has(G.getTile('overworld', nx, ny))) continue;
      const k = nx + ',' + ny; if (seen.has(k)) continue; seen.add(k); st.push([nx, ny]);
    }
  }
  return seen;
})();
const reachable = (tx, ty) => reachSet.has(tx + ',' + ty);

// ---------- 1. all five spawn at fixed lairs, correct levels, flat (no party) curve ----------
A1('0_feature_registered', MINIS.length === 5 && typeof G.makeMiniBoss === 'function' && typeof G.dropMiniReward === 'function', `CONTENT.apex.minis=${MINIS.length}, makeMiniBoss=${typeof G.makeMiniBoss}, dropMiniReward=${typeof G.dropMiniReward}`);
S._pinCheckT = 0; G.maybePinnacleBosses(); // force a fresh presence pass (belt + suspenders)
const spawned = S.enemies.filter((e) => e.isMini);
A1('1_all_five_present', spawned.length === 5, `got ${spawned.length} of 5 (keys: ${spawned.map((e) => e.mbKey).join(',')})`);
for (const row of MINIS) {
  const e = spawned.find((x) => x.mbKey === row.key);
  A1(`1_${row.key}_present`, !!e);
  if (!e) continue;
  const tx = Math.round((e.x + e.w / 2) / TILE), ty = Math.round((e.y + e.h / 2) / TILE);
  A1(`1_${row.key}_level`, e.level === row.level, `Lv ${e.level} want ${row.level}`);
  A1(`1_${row.key}_at_lair`, e._lairTx === tx && e._lairTy === ty && e.isBoss, `center (${tx},${ty}) _lair (${e._lairTx},${e._lairTy}) isBoss=${e.isBoss}`);
  A1(`1_${row.key}_lair_reachable`, reachable(e._lairTx, e._lairTy) && !G.SOLID.has(G.getTile('overworld', e._lairTx, e._lairTy)), `reach=${reachable(e._lairTx, e._lairTy)}`);
  // FLAT curve from the makeBoss base — with TWO heroes joined, no party term inflates it.
  A1(`1_${row.key}_hp_flat_curve`, e.maxHp === CURVES.hpForLevel(90, row.level) && e.hp === e.maxHp, `maxHp ${e.maxHp} want ${CURVES.hpForLevel(90, row.level)} (partyN=2, must NOT scale)`);
  A1(`1_${row.key}_atk_flat_curve`, e.atk === CURVES.atkForLevel(12, row.level), `atk ${e.atk} want ${CURVES.atkForLevel(12, row.level)}`);
  A1(`1_${row.key}_def_flat_curve`, e.def === CURVES.defForLevel(4, row.level), `def ${e.def} want ${CURVES.defForLevel(4, row.level)}`);
}
G.maybePinnacleBosses(); // (no throttle reset → real second pass on the next forced call below)
S._pinCheckT = 0; G.maybePinnacleBosses();
A1('1_no_duplicates', S.enemies.filter((e) => e.isMini).length === 5, `after 2 more passes: ${S.enemies.filter((e) => e.isMini).length} (must stay 5)`);

// ---------- 2. lair-bound: won't chase far; engages when near ----------
// Isolate the Hierophant as the ONLY enemy so the leash behaviour is deterministic under the battery's
// unseeded RNG (no stray wild foe can move it or land the "engage" damage). Restored before section 3.
const hiero = S.enemies.find((e) => e.mbKey === 'hierophant');
if (!hiero) {
  A1('2_lairbound_stays_home', false, 'no hierophant spawned (pre-S2 tree)');
  A1('2_engages_when_near', false, 'no hierophant spawned');
} else {
const rosterBackup = S.enemies.filter((e) => e !== hiero);
S.enemies = [hiero];
// (a) BOTH heroes parked ~60 tiles away (well beyond the ~12-tile leash) → the boss sits at its lair.
const farTx = hiero._lairTx + 60, farTy = hiero._lairTy;
for (const q of [A, B]) { q.map = 'overworld'; q.downed = false; q.x = farTx * TILE; q.y = farTy * TILE; }
S.map = 'overworld';
const lx0 = hiero._lairTx, ly0 = hiero._lairTy;
for (let t = 0; t < 400; t++) G.updateEnemies();
const dtx = Math.round((hiero.x + hiero.w / 2) / TILE), dty = Math.round((hiero.y + hiero.h / 2) / TILE);
const drift = Math.hypot(dtx - lx0, dty - ly0);
A1('2_lairbound_stays_home', drift <= 3, `drifted ${drift.toFixed(1)} tiles from its lair over 400 far-hero ticks (a chasing boss walks off)`);
// (b) A steps INTO the domain (on top of the boss) → the leash releases and the boss attacks. A gets a
// huge HP pool so a hit registers without downing it; B is downed out of the boss pool so A is the sole
// target. Deterministic: while specialCd>0 (first ~150 ticks) an in-range boss lands its basic attack.
A.maxHp = 1e6; A.hp = 1e6; A.invuln = 0; A.downed = false; A.x = hiero.x; A.y = hiero.y;
B.downed = true;
const aHp0 = A.hp;
for (let t = 0; t < 200; t++) G.updateEnemies();
A1('2_engages_when_near', A.hp < aHp0, `hero took ${(aHp0 - A.hp).toFixed(0)} dmg once inside the domain (leash released — not permanently frozen)`);
S.enemies = [hiero, ...rosterBackup]; B.downed = false;
}

// ---------- 3. a kill removes the boss + stamps the ~2-day respawn ----------
S.mbRespawnDay = undefined;
const victim = S.enemies.find((e) => e.mbKey === 'colossus');
const day0 = G.curDay();
if (!victim) {
  A1('3_boss_removed', false, 'no colossus spawned (pre-S2 tree)');
  A1('3_respawnday_stamped', false, 'no colossus');
  A1('3_stays_dead_in_cooldown', false, 'no colossus');
} else {
G.actAs(A, () => { victim.hp = 1; G.killEnemy(victim); });
A1('3_boss_removed', !S.enemies.includes(victim) && !S.enemies.some((e) => e.mbKey === 'colossus'), 'colossus spliced from the roster');
A1('3_respawnday_stamped', !!(S.mbRespawnDay && S.mbRespawnDay.colossus === day0 + 2), `mbRespawnDay.colossus=${S.mbRespawnDay && S.mbRespawnDay.colossus} want ${day0 + 2}`);
S._pinCheckT = 0; G.maybePinnacleBosses();
A1('3_stays_dead_in_cooldown', !S.enemies.some((e) => e.mbKey === 'colossus'), 'presence loop does NOT re-spawn while the cooldown holds');
}

// ---------- 4. respawns after the day; day-sweep housekeeping ----------
if (!victim) {
  for (const k of ['4_curday_advanced', '4_respawned_after_day', '4_stale_key_cleared', '4_daysweep_clears_due', '4_daysweep_keeps_future']) A1(k, false, 'no colossus / no S2 respawn path');
} else {
S.time = (day0 + 1) * DAY_FRAMES; // curDay() = day0+2 == the respawn day → cooldown elapsed
A1('4_curday_advanced', G.curDay() === day0 + 2, `curDay=${G.curDay()} want ${day0 + 2}`);
S._pinCheckT = 0; G.maybePinnacleBosses();
A1('4_respawned_after_day', S.enemies.some((e) => e.mbKey === 'colossus'), 'colossus returns once its respawn day passes');
A1('4_stale_key_cleared', !(S.mbRespawnDay && S.mbRespawnDay.colossus), 'the presence loop clears the come-due key on re-spawn');
// maybeRespawnMinis (the onNewDayWorld sweep): clears a come-due key, keeps a future one.
S.mbRespawnDay = { emberkeg: G.curDay(), hexbinder: G.curDay() + 5 };
if (typeof G.maybeRespawnMinis === 'function') G.maybeRespawnMinis();
A1('4_daysweep_clears_due', !S.mbRespawnDay.emberkeg, 'come-due key cleared by the onNewDayWorld sweep');
A1('4_daysweep_keeps_future', S.mbRespawnDay.hexbinder === G.curDay() + 5, 'a not-yet-due key survives the sweep');
S.mbRespawnDay = undefined;
}

// ---------- 5. per-hero ~5% signature roll is independent (id-stubbed RNG, join order [A,B]) ----------
const dropTarget = S.enemies.find((e) => e.mbKey === 'hierophant');
for (const q of [A, B]) { q.map = 'overworld'; q.downed = false; }
S.map = 'overworld';
const realRandom = Math.random;
function rollWith(seq) {
  A.inventory.weapons = []; A.inventory.armor = []; B.inventory.weapons = []; B.inventory.armor = [];
  let si = 0;
  Math.random = () => (si < seq.length ? seq[si++] : realRandom());
  try { if (typeof G.dropMiniReward === 'function' && dropTarget) G.dropMiniReward(dropTarget); } finally { Math.random = realRandom; }
}
// A rolls under 5% (hit), B rolls over (miss): the Sunstave lands in A's bag ONLY.
rollWith([0.01, 0.99]);
const aItem = A.inventory.weapons.find((x) => x.name.indexOf('Sunstave') >= 0);
A1('5_A_hit_gets_item', !!aItem, `A weapons: [${A.inventory.weapons.map((x) => x.name).join(' | ')}]`);
A1('5_A_item_is_legendary', !!(aItem && aItem.rarity === 4 && aItem.element === 'fire' && aItem.affixes && aItem.affixes.length === 2 && aItem.style === 'magic'), aItem ? `rarity=${aItem.rarity} el=${aItem.element} affixes=${aItem.affixes && aItem.affixes.length}` : 'no item');
A1('5_B_miss_untouched', B.inventory.weapons.length === 0 && B.inventory.armor.length === 0, `B bag weapons=${B.inventory.weapons.length} armor=${B.inventory.armor.length} — A's success must NOT grant B`);
// Reverse: B hits, A misses — proves the rolls are per-hero, not shared.
rollWith([0.99, 0.01]);
A1('5_B_hit_gets_item', !!B.inventory.weapons.find((x) => x.name.indexOf('Sunstave') >= 0), `B weapons: [${B.inventory.weapons.map((x) => x.name).join(' | ')}]`);
A1('5_A_miss_untouched', A.inventory.weapons.length === 0 && A.inventory.armor.length === 0, `A bag weapons=${A.inventory.weapons.length} armor=${A.inventory.armor.length}`);

// ---------- report ----------
const bools = Object.entries(R).filter(([k]) => !k.endsWith('__') && typeof R[k] === 'boolean');
const passed = bools.filter(([, v]) => v).length, total = bools.length;
console.log('\n=== mini-boss S2 verify (presence + persistence + reward) ===');
for (const [k, v] of Object.entries(R)) {
  if (k.endsWith('__')) continue;
  const note = R[k + '__'];
  console.log((v ? ' PASS ' : ' FAIL ') + k + (note !== undefined ? '  [' + note + ']' : ''));
}
console.log('\n' + passed + '/' + total + ' checks passed');
process.exit(passed === total ? 0 : 1);
