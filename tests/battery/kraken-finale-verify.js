const __RR = require('path').resolve(__dirname, '..', '..');
// Headless 2-player MP verification for #123 — the Mountain Kraken finale.
// Guards: flat ~48k HP + party-size scaling + level + respawn cycle; VICTORY ONCE PER HERO via the
// personal quests.finale key (main.done shared, finale.done personal); a cycle re-kill fires no
// second victory for a prior victor; a hero absent at the kill does NOT win; a projectile kill
// credits each PRESENT hero's OWN box (the shooter pin never misattributes); the ★ line broadcasts;
// migrate defaults finale for old rows. The once-per-hero gate is SEEN FAILING against a scratch
// tree with the `firstWin` guard removed (see the sibling run in the slice report).
process.env.HZ = '80';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const TILE = G.TILE;
const DAY = 21600;
const R = {};
function A1(name, cond, note) { R[name] = !!cond; if (note !== undefined) R[name + '__'] = note; }

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
w.tick();
const ar = S.krakenArena;
function atArena(p) { p.x = ar.tx * TILE; p.y = ar.ty * TILE; p.map = 'overworld'; }

// ---------- 1. the kraken is the flat finale: 48k base * party(2)=1.4, atk 130, def 14, level 90 ----------
let k = S.enemies.find((e) => e.isKraken);
A1('1_kraken_present', !!k);
// The boot kraken spawns at world setup (party size 1) → the FLAT 48k base. Party-size and cycle
// scaling apply to RESPAWNS (proven in section 3: 94080 = 48000 × 1.4 party × 1.4 cycle).
A1('1_flat_base_hp', k && k.maxHp === 48000, k && `maxHp=${k.maxHp} (flat 48k base — the finale sits above pinnacle tier)`);
A1('1_atk_pinnacle_class', k && k.atk === 130, k && `atk=${k.atk}`);
A1('1_def', k && k.def === 14, k && `def=${k.def}`);
A1('1_level_90', k && k.level === 90, k && `level=${k.level}`);
A1('1_isFinalBoss', k && !!k.isFinalBoss);
// level is a scalar → rides packEnemy to clients
atArena(A);
w.tick();
const sk = (w.snapshotFor('A').enemies || []).find((e) => e.isKraken);
A1('1_level_on_wire', sk && sk.level === 90, sk && `snap.level=${sk.level}`);

// ---------- 2. two heroes PRESENT at the kill → BOTH win once (finale personal, main shared) ----------
atArena(A); atArena(B);
const Ag0 = A.gold, Bg0 = B.gold;
A1('2_pre_A_finale_false', A.quests.finale.done === false);
A1('2_pre_B_finale_false', B.quests.finale.done === false);
G.actAs(A, () => { k.hp = 1; G.killEnemy(k); });   // A lands the blow; both are present
A1('2_A_finale_done', A.quests.finale.done === true);
A1('2_B_finale_done', B.quests.finale.done === true, 'B present → B also wins');
A1('2_A_champion_bounty', A.gold - Ag0 >= 5000, `A gold +${A.gold - Ag0} (kill gold + 5000 bounty)`);
A1('2_B_champion_bounty', B.gold - Bg0 === 5000, `B gold +${B.gold - Bg0} (bounty only — B didn't land the kill)`);
A1('2_main_shared_A', A.quests.main.done === true);
A1('2_main_shared_B', B.quests.main.done === true);
A1('2_krakenDead_flag', S.flags.krakenDead === true);
A1('2_respawn_scheduled', S.krakenRespawnDay === G.curDay() + 4, `respawnDay=${S.krakenRespawnDay} curDay=${G.curDay()}`);
A1('2_kraken_removed', !S.enemies.some((e) => e.isKraken));

// ---------- 3. respawn cycle: cross the day boundary → cycle+1, kraken back, cycle-scaled HP ----------
S.krakenRespawnDay = G.curDay() + 1;
S.time = G.curDay() * DAY - 2;                       // 2 frames before the next day boundary
for (let i = 0; i < 60 && !S.enemies.some((e) => e.isKraken); i++) w.tick();
let k2 = S.enemies.find((e) => e.isKraken);
A1('3_kraken_respawned', !!k2);
A1('3_cycle_bumped', S.krakenCycle === 1, `krakenCycle=${S.krakenCycle}`);
A1('3_krakenDead_cleared', S.flags.krakenDead === false);
A1('3_cycle_scaled_hp', k2 && k2.maxHp === Math.round(48000 * 1.4 * (1 + 1 * 0.4)), k2 && `maxHp=${k2.maxHp} (expect 94080)`);
A1('3_cycle_scaled_atk', k2 && k2.atk === Math.round(130 * (1 + 1 * 0.15)), k2 && `atk=${k2.atk} (expect 150)`);

// ---------- 4. re-kill: a PRIOR victor gets NO second victory (finale stays done, no 2nd bounty) ----------
atArena(A); atArena(B);
const Ag1 = A.gold, Bg1 = B.gold;
G.actAs(A, () => { k2.hp = 1; G.killEnemy(k2); });
A1('4_A_finale_still_done', A.quests.finale.done === true);
// A got only the cycle kill gold (no extra +5000 champion bounty): the bounty fires ONLY on the finale edge
A1('4_A_no_repeat_champion_bounty', A.gold - Ag1 === Math.round(12000 * 1.4), `A gold +${A.gold - Ag1} (cycle kill gold 16800, NOT +5000 again)`);
A1('4_B_no_repeat_champion_bounty', B.gold - Bg1 === 0, `B gold +${B.gold - Bg1} (0 — B already won, no kill gold either)`);

// ---------- 5. a hero ABSENT at the kill does NOT win — then wins on his OWN first present kill ----------
// Fresh victor C who was never present.
const C = w.addPlayer('C', 'Cy');
w.tick();
A1('5_C_starts_unwon', C.quests.finale.done === false);
// respawn the kraken, kill it while C is in a DUNGEON (absent from the overworld partyIn)
S.pinnacleSlain = S.pinnacleSlain || [];
S.krakenCycle = 1;
if (!S.enemies.some((e) => e.isKraken)) S.enemies.push(G.makeKraken(ar.tx, ar.ty));
let k3 = S.enemies.find((e) => e.isKraken);
atArena(A);
C.map = 'dungeon';                                   // C is delving → NOT in the overworld partyIn()
const Cw0 = C.quests.finale.done;
G.actAs(A, () => { k3.hp = 1; G.killEnemy(k3); });
A1('5_absent_C_did_not_win', C.quests.finale.done === false && Cw0 === false, 'C in a dungeon at kill → no win');
// now C surfaces and is present for the NEXT kill → wins his first
S.krakenCycle = 2;
if (!S.enemies.some((e) => e.isKraken)) S.enemies.push(G.makeKraken(ar.tx, ar.ty));
let k4 = S.enemies.find((e) => e.isKraken);
atArena(C); atArena(A);
const Cg0 = C.gold;
G.actAs(A, () => { k4.hp = 1; G.killEnemy(k4); });
A1('5_present_C_wins_first', C.quests.finale.done === true, 'C present now → wins his first even though others killed it before');
A1('5_present_C_bounty', C.gold - Cg0 === 5000, `C gold +${C.gold - Cg0}`);

// ---------- 6. PROJECTILE kill credits each PRESENT hero's OWN box (shooter pin never misattributes) ----------
// Fresh joiners in the SAME room → their finale starts false (PLAYER_TEMPLATE); everyone else is home.
A.map = B.map = C.map = 'dungeon';                    // park the prior victors out of the overworld partyIn()
const P = w.addPlayer('P', 'Pat');
const Q = w.addPlayer('Q', 'Quinn');
w.tick();
atArena(P); atArena(Q);
S.krakenCycle = 2;
if (!S.enemies.some((e) => e.isKraken)) S.enemies.push(G.makeKraken(ar.tx, ar.ty));
let k5 = S.enemies.find((e) => e.isKraken);
k5.x = Q.x + 40; k5.y = Q.y; k5.hp = 1;
const Pg0 = P.gold, Qg0 = Q.gold;
// Q fires the killing projectile; killEnemy runs pinned to Q (shooter) — the finale loop must still
// credit BOTH present heroes' OWN quests (not Q's box twice).
G.addProjectile(Q.x + Q.w / 2, Q.y + Q.h / 2, 6, 0, 5, { friendly: true, kind: 'arrow', style: 'ranged', element: null, pierce: 0, r: 6, life: 60, ownerRef: Q });
for (let i = 0; i < 30 && S.enemies.some((e) => e.isKraken); i++) w.tick();
A1('6_projectile_killed_kraken', !S.enemies.some((e) => e.isKraken));
A1('6_shooter_Q_won', Q.quests.finale.done === true);
A1('6_bystander_P_won', P.quests.finale.done === true, 'P present → wins (finale is party-present, not shooter-only)');
A1('6_P_own_box', P.quests.finale.done === true && P.gold - Pg0 === 5000, `P own bounty +${P.gold - Pg0}`);
A1('6_Q_own_box_not_double', Q.gold - Qg0 >= 5000, `Q own bounty +${Q.gold - Qg0} (his own box, not P's)`);

// ---------- 7. the ★ victory line broadcasts to the other hero's feed ----------
const feedP = (w.snapshotFor('P').feed || []).map((f) => f.m || '');
A1('7_victory_line_broadcast', feedP.some((m) => /slain the Mountain Kraken/i.test(m)), `feed: ${JSON.stringify(feedP.filter((m) => /Kraken/i.test(m)))}`);

// ---------- 8. migrate defaults finale for old rows; preserves a set finale ----------
const { migrateCharacter } = require('' + __RR + '/server/migrate.js');
const v1 = migrateCharacter({ v: 1, player: { level: 5 }, inventory: { keys: 0 } });
A1('8_v1_row_gets_finale_default', v1.blob.player.quests.finale && v1.blob.player.quests.finale.done === false);
const withFin = migrateCharacter({ schemaVersion: 4, player: { quests: { finale: { done: true } } } });
A1('8_set_finale_preserved', withFin.blob.player.quests.finale.done === true, 'a hero who already won stays won across a load');
const noFin = migrateCharacter({ schemaVersion: 4, player: { quests: { main: { done: false } } } });
A1('8_missing_finale_filled', noFin.blob.player.quests.finale && noFin.blob.player.quests.finale.done === false);

// ---------- report ----------
const bools = Object.entries(R).filter(([, v]) => typeof v === 'boolean');
const passed = bools.filter(([, v]) => v).length, total = bools.length;
console.log('\n=== #123 kraken-finale MP verify ===');
for (const [key, v] of Object.entries(R)) {
  if (key.endsWith('__')) continue;
  const note = R[key + '__'];
  console.log((typeof v === 'boolean' ? (v ? ' PASS ' : ' FAIL ') : '  ·   ') + key + (note !== undefined ? '  [' + note + ']' : ''));
}
console.log('\n' + passed + '/' + total + ' boolean checks passed');
process.exit(passed === total ? 0 : 1);
