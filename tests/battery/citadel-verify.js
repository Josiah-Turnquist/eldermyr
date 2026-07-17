const __RR = require('path').resolve(__dirname, '..', '..');
// Headless verification for #121 — the Sunken Citadel (pinnacle dungeons), F4a/b/c.
// Guards: a slain pinnacle DROPS the persistent gate (tile + state.citadelGate; never re-placed);
// entering builds the Citadel (state.citadel=1); floors 1-3 are a flat trash ramp (lvl 60/75/90) with
// a down-stair + floorMod/vault null; floor 4 is the boss room (no stairs). The Drowned Archivist is
// level 200 (flat 240k HP / atk 260 / def 46), cycles stances+phases, raises a lvl-100 ordered-kill
// court, and leaps only onto legal tiles; packEnemy carries phase/stance/arenaR/level and NO object.
// PER-PLAYER hidden 1% relic roll: each present hero rolls independently, direct to his OWN bag —
// hero A's success NEVER grants B. The 5 relics are recalcStats flags (equip→set, break→clear) and
// Aegis cheat-death works. MP: a stranger at the normal dungeon door is REFUSED while the Citadel
// stands; a wipe leaves the gate open. Every citadel path is dead code on the golden trajectories.
process.env.HZ = '80';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server-spike/load-game.js');
const S = G.state;
const TILE = G.TILE;
const T = G.T;
const R = {};
const A1 = (name, cond, note) => { R[name] = !!cond; if (note !== undefined) R[name + '__'] = note; };
const hasTile = (v) => { const m = G.maps.dungeon; for (const r of m) for (const t of r) if (t === v) return true; return false; };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
w.tick();
const ow = { ax: A.x, ay: A.y };

// ---------- 1. a slain pinnacle DROPS the persistent gate (tile + state) ----------
S.pinnacleSlain = []; S._pinCheckT = 0;
const pb = G.PINNACLE_BOSSES[0];
const king = G.makePinnacleBoss(pb, 120, 221);
S.enemies.push(king);
G.actAs(A, () => { king.hp = 1; G.killEnemy(king); });
A1('1_gate_opened', !!S.citadelGate, S.citadelGate ? `at ${S.citadelGate.tx},${S.citadelGate.ty}` : 'null');
A1('1_gate_tile_stamped', !!S.citadelGate && G.maps.overworld[S.citadelGate.ty][S.citadelGate.tx] === T.CITADEL_GATE);
const gate0 = JSON.stringify(S.citadelGate);
const shep = G.makePinnacleBoss(G.PINNACLE_BOSSES[1], 250, 22);
S.enemies.push(shep);
G.actAs(A, () => { shep.hp = 1; G.killEnemy(shep); });
A1('1_gate_persistent', JSON.stringify(S.citadelGate) === gate0, 'a 2nd pinnacle kill never re-places the gate');
A1('1_gate_rides_snapshot', (() => { A.x = S.citadelGate.tx * TILE; A.y = S.citadelGate.ty * TILE; w.tick(); const s = w.snapshotFor('A'); return s.citadelGate && s.citadelGate.tx === S.citadelGate.tx; })(), 'connected clients get state.citadelGate on the wire');

// ---------- 2. floor structure (SP-style, via the captured factories) ----------
S.citadel = 1;
for (const n of [1, 2, 3, 4]) {
  S.dungeonLevel = n;
  G.setupCitadelFloor(n);
  const lvls = [...new Set(S.enemies.map((e) => e.level))];
  if (n < 4) {
    A1(`2_floor${n}_lvl`, lvls.length === 1 && lvls[0] === [0, 60, 75, 90][n], `levels=${JSON.stringify(lvls)}`);
    A1(`2_floor${n}_descend`, hasTile(T.D_DESCEND));
    A1(`2_floor${n}_minions_tagged`, S.enemies.every((e) => e.isCitadelMinion));
  } else {
    A1('2_floor4_boss_room', S.enemies.some((e) => e.isCitadel));
    A1('2_floor4_no_descend', !hasTile(T.D_DESCEND) && !hasTile(T.D_EXIT));
  }
  A1(`2_floor${n}_floorMod_null`, S.floorMod === null);
  A1(`2_floor${n}_vault_null`, !S.vault);
}

// ---------- 3. the Drowned Archivist — level 200, flat, scalars only on the wire ----------
S.dungeonLevel = 4; G.setupCitadelFloor(4);
const boss = S.enemies.find((e) => e.isCitadel);
A1('3_boss_level_200', boss && boss.level === 200);
A1('3_boss_flat_hp', boss && boss.maxHp === Math.round(240000 * (1 + (2 - 1) * 0.7)), boss && `maxHp=${boss.maxHp} (240k × party 1.7)`);
A1('3_boss_atk_260', boss && boss.atk === 260);
A1('3_boss_def_46', boss && boss.def === 46);
A1('3_boss_stance_blade', boss && boss.stance === 'blade' && Array.isArray(boss.specials));
// drive the boss through its phases/stances/court/leap
A.x = boss.x - 70; A.y = boss.y; A.map = 'dungeon'; S.map = 'dungeon';
const seenStance = new Set(), seenPhase = new Set(); let inWall = 0, courtMax = 0;
const ORDER = ['updateTime', 'updatePlayer', 'updateEnemies', 'updateProjectiles', 'updateParticles'];
for (let t = 0; t < 8000; t++) {
  if (t % 40 === 0) boss.hp = Math.max(1, boss.hp - boss.maxHp * 0.006);
  for (const fn of ORDER) { const f = G[fn]; if (typeof f === 'function') f(); }
  seenStance.add(boss.stance); seenPhase.add(boss.phase);
  courtMax = Math.max(courtMax, S.enemies.filter((e) => e._pinRef === boss).length);
  if (G.getTile('dungeon', Math.floor((boss.x + boss.w / 2) / TILE), Math.floor((boss.y + boss.h / 2) / TILE)) === T.D_WALL) inWall++;
}
A1('3_all_three_stances', seenStance.size === 3, [...seenStance].join(','));
A1('3_all_three_phases', seenPhase.has(1) && seenPhase.has(2) && seenPhase.has(3), [...seenPhase].sort().join(','));
A1('3_court_lvl100', (() => { const c = S.enemies.find((e) => e._pinRef === boss && e.isCitadelMinion); return c && c.level === 100 && c.maxHp === Math.round(18233 * 1.4) && c._orderIdx !== undefined && c._rezN !== undefined; })(), 'ordered-kill court (party-scaled)');
A1('3_court_wave', courtMax === 3);
A1('3_leap_never_in_wall', inWall === 0);
A1('3_arena_shrinks', boss.arenaR <= 105, `arenaR=${Math.round(boss.arenaR)}`);
// packScalar shape: pack a fresh boss and confirm scalars ride + arrays/objects drop
const pboss = G.makeCitadelBoss(5, 5);
// simulate packScalar (world.js): keep number|string|boolean|null, drop the rest
const packedKeys = Object.keys(pboss).filter((k) => { const v = pboss[k]; return v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'; });
A1('3_pack_has_phase_stance_arenaR_level', ['phase', 'stance', 'arenaR', 'level'].every((k) => packedKeys.includes(k)));
A1('3_pack_drops_specials_array', !packedKeys.includes('specials'), 'the array e.specials never rides the wire');

// ---------- 4. PER-PLAYER hidden 1% relic roll — independent, own bag, invisible to others ----------
A.map = B.map = 'overworld'; S.map = 'overworld'; A.x = ow.ax; A.y = ow.ay; B.x = A.x + 40; B.y = A.y;
A._lastStyle = 'melee'; B._lastStyle = 'ranged';
function rollCase(aHit, bHit) {
  A.map = B.map = 'overworld'; S.map = 'overworld'; // partyIn() world-scopes by state.map — keep it overworld
  A.inventory.weapons = A.inventory.weapons.filter((x) => !x.uniq); A.inventory.armor = A.inventory.armor.filter((x) => !x.uniq);
  B.inventory.weapons = B.inventory.weapons.filter((x) => !x.uniq); B.inventory.armor = B.inventory.armor.filter((x) => !x.uniq);
  S.enemies = S.enemies.filter((e) => !e.isCitadel);
  const bk = G.makeCitadelBoss(120, 221); bk.x = A.x + 60; bk.y = A.y; S.enemies.push(bk);
  const real = Math.random;
  Math.random = () => { const id = S.player && S.player.id; if (id === 'A') return aHit ? 0.005 : 0.9; if (id === 'B') return bHit ? 0.005 : 0.9; return 0.5; };
  const ag0 = A.gold, bg0 = B.gold;
  G.actAs(A, () => { bk.hp = 1; G.killEnemy(bk); });
  Math.random = real;
  return {
    a: A.inventory.weapons.concat(A.inventory.armor).filter((x) => x.uniq).map((x) => x.uniq),
    b: B.inventory.weapons.concat(B.inventory.armor).filter((x) => x.uniq).map((x) => x.uniq),
    ag: A.gold - ag0, bg: B.gold - bg0,
  };
}
const c1 = rollCase(true, false);
A1('4_A_hit_gets_relic', c1.a.length === 1 && c1.a[0] === 'sunderking', JSON.stringify(c1.a));
A1('4_A_hit_B_untouched', c1.b.length === 0, "A's success NEVER grants B (independence)");
const c2 = rollCase(false, true);
A1('4_B_hit_gets_relic', c2.b.length === 1 && c2.b[0] === 'hundredfold');
A1('4_B_hit_A_untouched', c2.a.length === 0);
const c3 = rollCase(true, true);
A1('4_both_own_style_relic', c3.a[0] === 'sunderking' && c3.b[0] === 'hundredfold', 'each his OWN style-matched relic in his OWN bag');
const c4 = rollCase(false, false);
A1('4_both_miss_no_relic', c4.a.length === 0 && c4.b.length === 0);
A1('4_guaranteed_clear_gold', c4.bg === 6000 && c4.ag >= 6000, `everyone present gets +6000 clear gold regardless of the roll (B ${c4.bg}; A ${c4.ag} = clear + 18k Archivist kill gold as the killer)`);

// ---------- 5. relic flags flip (equip→set, swap/break→clear) + Aegis cheat-death ----------
S.player = A; S.inventory = A.inventory;
function eq(item) { const arr = item.atk !== undefined ? S.inventory.weapons : S.inventory.armor; arr.forEach((x) => (x.equipped = false)); item.equipped = true; arr.push(item); G.recalcStats(); }
eq(G.makeUnique('sunderking', 200)); A1('5_uEdge_set', A.uEdge === true);
eq(G.makeUnique('hundredfold', 200)); A1('5_swap_clears_uEdge', A.uEdge === false && A.uQuiver === true);
eq(G.makeUnique('emberheart', 200)); A1('5_uLocket_set', A.uLocket === true);
eq(G.makeUnique('namelessaegis', 200)); A1('5_uAegis_set', A.uAegis === true);
const aeg = S.inventory.armor.find((x) => x.uniq === 'namelessaegis'); aeg.dur = 0; G.recalcStats();
A1('5_broken_clears', A.uAegis === false, 'a broken relic loses its magic');
aeg.dur = aeg.durMax; G.recalcStats(); A._aegisT = 0; A.hp = 50; A.invuln = 0; A.dodge = 0; A.evasion = 0;
G.playerTakeDamage(99999);
A1('5_aegis_cheat_death', A.hp === 1 && A._aegisT === 1, 'a killing blow leaves you at 1 HP, once per floor');
A.invuln = 0; G.playerTakeDamage(99999);
A1('5_aegis_once_per_floor', A.hp <= 0, 'the 2nd lethal blow lands (latch spent)');
// Locket surge scalars bump on a kill
A.hp = 100; const loc = G.makeUnique('emberheart', 200); S.inventory.armor.forEach((x) => (x.equipped = false)); loc.equipped = true; S.inventory.armor.push(loc); G.recalcStats();
const foe = { hp: 1, maxHp: 1, xp: 1, gold: 1, x: A.x, y: A.y, w: 20, h: 20, color: '#fff' }; S.enemies.push(foe);
G.actAs(A, () => G.killEnemy(foe));
A1('5_locket_surge_bumps', (A._surgeN | 0) >= 1 && (A._surgeT | 0) > 0, `surgeN=${A._surgeN} surgeT=${A._surgeT}`);

// ---------- 6. MP dgKind guard: a stranger at the NORMAL dungeon door is refused while the Citadel stands ----------
const w2 = new World();
const C = w2.addPlayer('C', 'Cy');
const D = w2.addPlayer('D', 'Dee');
w2.tick();
// C opens the Citadel: stamp a gate under C, press [E]
S.citadelGate = S.citadelGate || { tx: Math.floor(C.x / TILE), ty: Math.floor(C.y / TILE) };
const gt = S.citadelGate; if (G.maps.overworld[gt.ty]) G.maps.overworld[gt.ty][gt.tx] = T.CITADEL_GATE;
C.x = gt.tx * TILE; C.y = gt.ty * TILE; C.actions = ['interact']; C.held = {};
w2.tick();
A1('6_C_in_citadel', C.map === 'dungeon' && w2.dgKind === 'citadel', `dgKind=${w2.dgKind}`);
// D (with a key + prior access) presses [E] on a REAL overworld dungeon-entrance tile → must be
// REFUSED by the dgKind guard (not teleported into the live Citadel). Scan the grid for the tile.
let dent = null;
for (let y = 0; y < G.maps.overworld.length && !dent; y++) for (let x = 0; x < G.maps.overworld[y].length; x++) if (G.maps.overworld[y][x] === T.DUNGEON_ENTRANCE) { dent = { tx: x, ty: y }; break; }
D.inventory.keys = 5; D.enteredDungeon = true; // D CAN normally delve — only the open Citadel blocks it
D.x = dent.tx * TILE; D.y = dent.ty * TILE; D.actions = ['interact']; D.held = {};
w2.tick();
A1('6_D_refused_at_normal_door', D.map !== 'dungeon', `a stranger is NOT dropped into the live Citadel (D.map=${D.map})`);

// ---------- 7. persistence on a wipe: the gate survives (never consumed) ----------
const gateBeforeWipe = JSON.stringify(S.citadelGate);
C.map = 'overworld'; C.downed = false; // surface everyone → the instance dissolves
w2.tick(); w2.tick();
A1('7_instance_dissolved', !w2.sharedDg && w2.dgKind === null, 'the Citadel instance + kind clear when empty');
A1('7_gate_persists_after_wipe', JSON.stringify(S.citadelGate) === gateBeforeWipe && !!S.citadelGate, 'the overworld gate is never consumed — re-enterable');

// ---------- report ----------
const bools = Object.entries(R).filter(([k]) => !k.endsWith('__') && typeof R[k] === 'boolean');
const passed = bools.filter(([, v]) => v).length, total = bools.length;
console.log('\n=== #121 Sunken Citadel verify ===');
for (const [k, v] of Object.entries(R)) {
  if (k.endsWith('__')) continue;
  const note = R[k + '__'];
  console.log((v ? ' PASS ' : ' FAIL ') + k + (note !== undefined ? '  [' + note + ']' : ''));
}
console.log('\n' + passed + '/' + total + ' checks passed');
process.exit(passed === total ? 0 : 1);
