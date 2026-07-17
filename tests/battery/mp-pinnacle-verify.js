const __RR = require('path').resolve(__dirname, '..', '..');
// Headless 2-player MP verification for Stage C pinnacle bosses.
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const TILE = G.TILE;
const R = {};
const near = (a, b, t) => Math.abs(a - b) <= t;

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
const A0 = { x: A.x, y: A.y }, B0 = { x: B.x, y: B.y };   // town spawn
const lair = S.drownedLair, LX = lair.tx * TILE + 16, LY = lair.ty * TILE + 16;

// ---------- 1. Drowned King spawns at islands[1] (always-on), rides the snapshot ----------
for (let i = 0; i < 60; i++) w.tick();
let king = S.enemies.find((e) => e.isPinnacle && e.pinKey === 'drownedking');
R['1_king_spawned'] = !!king;
R['1_king_at_lair'] = king ? (near(Math.floor((king.x + king.w / 2) / TILE), lair.tx, 2) && near(Math.floor((king.y + king.h / 2) / TILE), lair.ty, 2)) : false;
R['1_king_has_arenaR_scalar'] = king ? typeof king.arenaR === 'number' : false;
// move A onto the lair so interest-culling keeps the King in A's snapshot
A.x = lair.tx * TILE; A.y = lair.ty * TILE;
w.tick();
const snapA = w.snapshotFor('A');
const sKing = (snapA.enemies || []).find((e) => e.pinKey === 'drownedking');
R['1b_king_in_snapshot'] = !!sKing;
R['1b_snapshot_isPinnacle'] = sKing ? !!sKing.isPinnacle : false;
R['1b_snapshot_arenaR_number'] = sKing ? typeof sKing.arenaR === 'number' : false;

// ---------- 2. Force night -> Pale Shepherd rises; force day -> melts ----------
A.x = A0.x; A.y = A0.y; B.x = B0.x; B.y = B0.y;    // both back in town (far from shepherd lair 250,22)
S.time = 17280; S._pinCheckT = 0;                  // deep night (dayFrac ~0.80)
for (let i = 0; i < 50; i++) w.tick();
R['2_shepherd_rose_at_night'] = !!S.enemies.find((e) => e.isPinnacle && e.pinKey === 'paleshepherd');
S.time = 6480; S._pinCheckT = 0;                   // midday (dayFrac ~0.30); players in town -> not "near" -> melts
for (let i = 0; i < 60; i++) w.tick();
R['2_shepherd_melted_at_dawn'] = !S.enemies.find((e) => e.isPinnacle && e.pinKey === 'paleshepherd');

// ---------- 3. wanderHome sends a target-less King toward its lair (not a wall/edge) ----------
king = S.enemies.find((e) => e.isPinnacle && e.pinKey === 'drownedking');
if (!king) { S.pinnacleSlain = []; S._pinCheckT = 0; w.tick(); king = S.enemies.find((e) => e.isPinnacle && e.pinKey === 'drownedking'); }
A.x = A0.x; A.y = A0.y; B.x = B0.x; B.y = B0.y;    // BOTH in town -> bossPool empty -> King becomes a wanderer
king.x = (lair.tx + 24) * TILE; king.y = (lair.ty) * TILE;   // displace it well off the lair
const kc = () => [king.x + king.w / 2, king.y + king.h / 2];
let [kx0, ky0] = kc(); const d0 = Math.hypot(kx0 - LX, ky0 - LY);
for (let i = 0; i < 6; i++) w.tick();
let [kx1, ky1] = kc(); const d1 = Math.hypot(kx1 - LX, ky1 - LY);
R['3_wander_moved_toward_lair'] = d1 < d0 - 2;
R['3_wander_delta'] = +(d0 - d1).toFixed(1);

// ---------- 4. Party-wide arena hazard damages a SECOND player outside the ring ----------
king.x = lair.tx * TILE - 15; king.y = lair.ty * TILE - 15; king.arenaR = 360;   // King back at lair, fresh ring
A.x = lair.tx * TILE + 40; A.y = lair.ty * TILE;                  // A inside the ring (pdl ~55) -> the "owner"/duelist
B.x = (lair.tx + 15) * TILE; B.y = lair.ty * TILE;                // B outside ring (~480px) but within leash
// The King is now FLAT at PIN_LEVEL 75 (atk 466 at 2p, was 119 party-scaled), so the addPlayer()
// default level-1 heroes this suite used to lean on are flattened on tick 0 — and section 1 above
// parks A right on the lair, so A arrives here ALREADY downed from earlier in the suite. That
// silently DESTROYED what this section measures: a `downed` A leaves `eligible`, B becomes
// nearestPlayer()==owner, and the party-wide pass skips B by design ("don't double-dip the duelist")
// -> no chill, which the test read as a routing failure. This section is about hazard ROUTING to a
// SECOND player, not about survivability, so stand both heroes up with an apex-rung body and let the
// routing be observable. `4_precondition_duelist_survived` pins that down: if A ever drops again this
// section fails LOUDLY instead of quietly measuring nothing.
const standUp = (p) => { p.downed = false; p.dead = false; p.bleedT = 0; p.reviveProg = 0; p.beingRevived = false; p.stabilizing = false; p.maxHp = 99999; p.hp = p.maxHp; p.def = 999; };
standUp(A); standUp(B);
B.chillT = 0; B.invuln = 0;
const bHp0 = B.hp; let bMaxChill = 0;
for (let i = 0; i < 96; i++) { w.tick(); bMaxChill = Math.max(bMaxChill, B.chillT || 0); if (king.arenaR > 460) king.arenaR = 360; }
R['4_precondition_duelist_survived'] = !A.downed;   // A must stay the `owner`, else B is skipped and the checks below are vacuous
R['4_second_player_hazard_dmg'] = B.hp < bHp0;
R['4_second_player_hp_lost'] = bHp0 - B.hp;
R['4_second_player_chilled'] = bMaxChill >= 70;

// ---------- 5. Server-first kill broadcasts an epic feed line to the OTHER player ----------
king = S.enemies.find((e) => e.isPinnacle && e.pinKey === 'drownedking');
w.snapshotFor('B');                       // baseline B's _feedSeen so we only read NEW entries
const feedBefore = w.feedN;
const pp = S.player, pi = S.inventory;
S.player = A; S.inventory = A.inventory;
king.hp = 1; king._pinRef = null;
try { G.killEnemy(king); } catch (e) { R['5_kill_threw'] = String(e); }
S.player = pp; S.inventory = pi;
w.tick();                                  // drain the captured log into the versioned feed
R['5_pinnacleSlain_recorded'] = (S.pinnacleSlain || []).includes('drownedking');
const snapB = w.snapshotFor('B');
const feed = snapB.feed || [];
// The client feed payload has no `bc` field; the server only forwards ANOTHER player's line when e.bc is
// true, and it prepends the owner's name ("Ava: ..."). So a kill line B doesn't own, carrying the "Ava: "
// prefix, PROVES it was broadcast (bc-routed) from A -> B. (line 1175 in world.js)
const gotKill = feed.filter((f) => /^Ava: /.test(f.m || '') && /vanquished/i.test(f.m || ''));
R['5_broadcast_in_other_player_feed'] = gotKill.length > 0;
R['5_pinnacle_epic_line_broadcast'] = feed.some((f) => /^Ava: /.test(f.m || '') && /apex terror/i.test(f.m || ''));
R['5_lines_B_received'] = JSON.stringify((feed || []).map((f) => f.m));

// ---------- 6. resolveInteract('trophy') returns the panel descriptor with the arrays ----------
const tr = w.resolveInteract('A', 'trophy');
R['6_trophy_kind_panel'] = !!(tr && tr.kind === 'panel' && tr.panel === 'trophy');
R['6_trophy_has_pinnacleSlain_array'] = !!(tr && Array.isArray(tr.pinnacleSlain));
R['6_trophy_has_uniquesFound_array'] = !!(tr && Array.isArray(tr.uniquesFound));
R['6_trophy_pinnacleSlain'] = tr ? JSON.stringify(tr.pinnacleSlain) : '(null)';

// ---------- report ----------
const bools = Object.entries(R).filter(([k, v]) => typeof v === 'boolean');
const passed = bools.filter(([k, v]) => v).length, total = bools.length;
console.log('\n=== Stage C headless MP verify ===');
for (const [k, v] of Object.entries(R)) console.log((typeof v === 'boolean' ? (v ? ' PASS ' : ' FAIL ') : '  ·   ') + k + ' = ' + v);
console.log('\n' + passed + '/' + total + ' boolean checks passed');
process.exit(passed === total ? 0 : 1);
