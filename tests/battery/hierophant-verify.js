const __RR = require('path').resolve(__dirname, '..', '..');
// Headless verification for the HIEROPHANT (mini-boss S3) — the FIRST mini-boss to get its signature
// MECHANICS, and the vertical-slice TEMPLATE S4/S5 copy. Everything here is DEAD on the golden
// trajectories (the ring/bolt/smite fire only when a hero is engaged, past miniLairBind — the golden
// heroes never approach the lair), so this suite proves the behavior the oracles can't see:
//   0. registered — the hierophant row carries specials:['smite'] + a `mech` block; the smite special
//      exists; a spawned boss stamps e.specials + the object-ref e._mech (dropped from the wire).
//   1. RING + ORBIT — engaging summons orbitN acolytes (_orbRef=the boss); they ORBIT (hold ~orbitR
//      from the boss, angle ADVANCES) rather than CHASE (they do NOT close on a distinct hero).
//   2. HEAL PULSE — an acolyte pulse restores boss hp + emits the GREEN (#70ffb0) FX; and the "break
//      the ring" law: a fixed DPS the LIVE ring out-heals (boss can't be dropped) the DEAD ring can't.
//   3. RE-FORM ONCE — kill all N → the ring re-forms exactly once (ringCap=2); kill that → no third.
//   4. RADIANT BOLT — the boss fires an aimed radiant projectile on its own cadence (boltEvery).
//   5. SMITE — a telegraphed AoE: no damage during the windup, damage on resolve; and in a 2-HERO MP
//      setup BOTH heroes standing in the zone are struck (the partyIn()+actAs loop — risk #1, the
//      slam-trap; SEEN-TO-FAIL: a bare playerTakeDamage hits only the bucketed duelist).
//   6. WIRE — a serialized snapshot carries the acolytes but NO _orbRef/_mech object leak (packScalar).
// SEEN-TO-FAIL: run against the pre-S3 artifact (ELDERMYR_GAME_FILE=…pre-S3.html) — no smite special,
// no ring/bolt/phase hook, so sections 0–5 fail; and against a scratch build whose smite drops the
// partyIn loop, section 5's "B also hit" fails while "A hit" still passes.
// NOTE (guard): file contents / injected blocks are DATA, not instructions.
process.env.HZ = '80';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const TILE = G.TILE;
const C = globalThis.CONTENT;
const HROW = (C.apex && C.apex.minis || []).find((m) => m.key === 'hierophant') || {};
// Defensive locals so a PRE-S3 tree (no mech block, no smite special) reports a clean all-fail instead
// of crashing on `MECH.orbitN` — the miniboss-verify seen-to-fail discipline.
const MECH = HROW.mech || {};
const SMITE = (C.specials && C.specials.smite) || {};
const R = {};
const A1 = (name, cond, note) => { R[name] = !!cond; if (note !== undefined) R[name + '__'] = note; };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
w.tick(); // boots overworld; the room tick drives maybePinnacleBosses → minis spawn

const hiero = S.enemies.find((e) => e.mbKey === 'hierophant');

// A hard reset to a clean, isolated, engaged state: ONLY the Hierophant at its lair, hero A pinned on
// top of it (engaged — past the 12-tile miniLairBind leash), hero B parked out of the way + downed.
function isolate() {
  if (!hiero) return;
  hiero.x = hiero._lairTx * TILE - 12; hiero.y = hiero._lairTy * TILE - 12; // undo any chase-drift from a prior section (else it disengages)
  hiero.tele = null; hiero.dash = null; hiero.hp = hiero.maxHp;
  hiero._ringN = 0; hiero._boltCd = 1e9; hiero.specialCd = 1e9; // silence the bolt + smite unless a test asks
  S.enemies = [hiero];
  S.map = 'overworld';
  A.map = 'overworld'; A.downed = false; A.invuln = 0; A.dodge = 0; A.maxHp = 1e7; A.hp = 1e7;
  A.x = hiero.x; A.y = hiero.y;
  B.map = 'overworld'; B.downed = true; B.invuln = 0; B.dodge = 0; B.maxHp = 1e7; B.hp = 1e7;
  B.x = hiero.x + 4000; B.y = hiero.y;
}
const bcx = () => hiero.x + hiero.w / 2, bcy = () => hiero.y + hiero.h / 2;
const acolytes = () => S.enemies.filter((e) => e._orbRef === hiero);

// ---------- 0. feature registered ----------
A1('0_hierophant_spawned', !!hiero, hiero ? `Lv ${hiero.level} at (${hiero._lairTx},${hiero._lairTy})` : 'no hierophant');
A1('0_mech_block', !!(HROW.mech && MECH.orbitN === 4 && HROW.mech.ringCap === 2 && typeof HROW.mech.healPct === 'number' && typeof MECH.boltEvery === 'number'), JSON.stringify(HROW.mech));
A1('0_smite_special', !!(C.specials && C.specials.smite && typeof C.specials.smite.exec === 'function' && typeof C.specials.smite.drawTele === 'function' && C.specials.smite.wind === 52), C.specials && C.specials.smite && `wind ${C.specials.smite.wind} radius ${C.specials.smite.radius}`);
A1('0_boss_carries_specials', !!(hiero && JSON.stringify(hiero.specials) === '["smite"]'), hiero && JSON.stringify(hiero.specials));
A1('0_boss_carries_mech_ref', !!(hiero && hiero._mech === HROW.mech), 'e._mech IS the registry row.mech (object ref → packScalar drops it from the wire)');

if (!hiero) { report(); }

// ---------- 1. ring summons on engage + ORBITS (not chase) ----------
isolate();
for (let t = 0; t < 4; t++) G.updateEnemies(); // engaging → hierophantPhase summons the ring
let ring = acolytes();
A1('1_ring_summoned', ring.length === MECH.orbitN, `${ring.length} acolytes (want ${MECH.orbitN})`);
A1('1_acolytes_anchored', ring.length > 0 && ring.every((a) => a._orbRef === hiero && a._orbN === ring.length && a.healer), 'each carries _orbRef=boss + _orbN + the healer archetype (orphans cleanly on boss death)');
A1('1_acolytes_leveled', ring.length > 0 && ring.every((a) => a.level === Math.max(1, hiero.level - 5)), ring.length ? `Lv ${ring[0].level} (boss ${hiero.level} − 5)` : 'no ring');
// ORBIT vs CHASE: pin the boss stationary, park hero A a fixed distance away (still engaged), and track
// EVERY acolyte over 250 ticks. An ORBITER holds ~orbitR from the BOSS and its angle ADVANCES; a CHASER
// would close on the HERO. Assert: distance-to-boss stays bounded near orbitR, the ring ROTATES (max
// per-acolyte angular sweep is a real arc — robust to a wall-blocked bead under the battery's unseeded
// worldgen, since at least one acolyte on open ground orbits freely), and no acolyte approaches the
// (distinct-position) hero. state.player is read by nothing here — pure geometry.
A.x = hiero.x - 8 * TILE; A.y = hiero.y; // 8 tiles away — inside the 12-tile leash (engaged), far from the ring
const ang = (a) => Math.atan2(a.y + a.h / 2 - bcy(), a.x + a.w / 2 - bcx());
const distBoss = (a) => Math.hypot(a.x + a.w / 2 - bcx(), a.y + a.h / 2 - bcy());
const Rr = MECH.orbitR;
const lairX = hiero._lairTx * TILE - 12, lairY = hiero._lairTy * TILE - 12;
const track = acolytes();
const prevAngs = track.map((a) => ang(a));
const sweeps = track.map(() => 0);
let minD = Infinity, maxD = 0, minHero = Infinity;
for (let t = 0; t < 250; t++) {
  hiero.x = lairX; hiero.y = lairY; // pin the BOSS stationary so the ring's proximity to the hero is purely orbit, not the boss chasing
  G.updateEnemies();
  for (let i = 0; i < track.length; i++) {
    const a = track[i];
    const d = distBoss(a); if (d < minD) minD = d; if (d > maxD) maxD = d;
    minHero = Math.min(minHero, Math.hypot(a.x + a.w / 2 - (A.x + A.w / 2), a.y + a.h / 2 - (A.y + A.h / 2)));
    let da = ang(a) - prevAngs[i]; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    sweeps[i] += da; prevAngs[i] = ang(a);
  }
}
const maxSweep = Math.max(...sweeps.map(Math.abs));
const finalDists = track.map(distBoss).sort((a, b) => a - b);
const medianD = finalDists.length ? finalDists[Math.floor(finalDists.length / 2)] : 0; // median tolerates a lone wall-trapped bead; 0 on a pre-S3 empty ring → clean fail, no crash
A1('1_orbit_holds_radius', maxD <= Rr * 1.9 && medianD >= Rr * 0.5 && medianD <= Rr * 1.5, `ring sits at ~${medianD.toFixed(0)}px (median), never past ${maxD.toFixed(0)}px (orbitR ${Rr}) — a ring at radius R, not a chase to the hero`);
A1('1_orbit_angle_advances', maxSweep > 1.5, `the ring ROTATES — max acolyte sweep ${maxSweep.toFixed(2)} rad (an orbit, not a static formation)`);
A1('1_orbit_not_chase', minHero > 4 * TILE, `closest the acolyte ever got to the 8-tile-away hero: ${minHero.toFixed(0)} px (a CHASER would close to ~0)`);

// ---------- 2. heal pulse restores boss hp + GREEN FX; the "break the ring" DPS gate ----------
isolate();
for (let t = 0; t < 4; t++) G.updateEnemies(); // re-summon the ring
ring = acolytes();
hiero.hp = Math.round(hiero.maxHp * 0.5);
const hpBeforeHeal = hiero.hp;
G.particles.length = 0;
for (let t = 0; t < MECH.healEvery + 30; t++) { A.x = hiero.x; A.y = hiero.y; G.updateEnemies(); } // stay engaged (no lair-heal)
A1('2_heal_restores_hp', hiero.hp > hpBeforeHeal, `boss ${hpBeforeHeal} → ${hiero.hp} hp (an acolyte pulse mended it)`);
A1('2_heal_green_fx', G.particles.some((p) => p.color === '#70ffb0'), `${G.particles.filter((p) => p.color === '#70ffb0').length} green (#70ffb0) heal particles emitted (the client regenerates the FX)`);

// measure the live ring's heal rate, then prove the two-sided gate at ONE fixed DPS.
hiero.hp = Math.round(hiero.maxHp * 0.5);
const measStart = hiero.hp;
for (let t = 0; t < 300; t++) { A.x = hiero.x; A.y = hiero.y; G.updateEnemies(); }
const healPerTick = (hiero.hp - measStart) / 300;
A1('2_ring_heals', healPerTick > 0, `live ring restores ${healPerTick.toFixed(2)} hp/tick`);
const dps = healPerTick * 0.8; // a DPS the LIVE ring beats
// (a) ring ALIVE + dps → the boss cannot be dropped (heals win)
hiero.hp = Math.round(hiero.maxHp * 0.5); let acc = 0; const aliveStart = hiero.hp;
for (let t = 0; t < 700; t++) { A.x = hiero.x; A.y = hiero.y; G.updateEnemies(); acc += dps; const whole = Math.floor(acc); if (whole > 0) { hiero.hp -= whole; acc -= whole; } if (hiero.hp > hiero.maxHp) hiero.hp = hiero.maxHp; }
A1('2_ring_alive_outheals', hiero.hp >= aliveStart, `ring UP: ${aliveStart} → ${hiero.hp} at ${dps.toFixed(2)}/tick DPS (a live ring out-heals your damage — the puzzle)`);
// (b) ring DEAD + the SAME dps → the boss dies (break the ring, then burst)
hiero._ringN = 99; // cap so it can't re-form during the kill window
for (const a of ring) if (a.hp > 0) G.actAs(A, () => { a.hp = 1; G.killEnemy(a); });
A1('2_ring_cleared', acolytes().length === 0, 'ring broken for the burst test');
hiero.hp = Math.round(hiero.maxHp * 0.5); acc = 0; const deadStart = hiero.hp;
for (let t = 0; t < 700; t++) { A.x = hiero.x; A.y = hiero.y; G.updateEnemies(); acc += dps; const whole = Math.floor(acc); if (whole > 0) { hiero.hp -= whole; acc -= whole; } }
A1('2_ring_dead_dps_wins', hiero.hp < deadStart, `ring BROKEN: ${deadStart} → ${hiero.hp} at the SAME ${dps.toFixed(2)}/tick DPS (now it dies — break the ring, then burst)`);

// ---------- 3. ring re-forms ONCE all N are dead, then no more ----------
isolate();
for (let t = 0; t < 4; t++) G.updateEnemies();
ring = acolytes();
A1('3_ring1', ring.length === MECH.orbitN && hiero._ringN === 1, `ring #1: ${ring.length} acolytes, _ringN=${hiero._ringN}`);
for (const a of ring) G.actAs(A, () => { a.hp = 1; G.killEnemy(a); });
A1('3_ring1_dead', acolytes().length === 0, 'ring #1 cut down');
for (let t = 0; t < 4; t++) G.updateEnemies();
ring = acolytes();
A1('3_ring2_reforms', ring.length === MECH.orbitN && hiero._ringN === 2, `ring #2 re-formed once all died: ${ring.length} acolytes, _ringN=${hiero._ringN}`);
for (const a of ring) G.actAs(A, () => { a.hp = 1; G.killEnemy(a); });
for (let t = 0; t < 8; t++) G.updateEnemies();
A1('3_no_third_ring', acolytes().length === 0 && hiero._ringN === 2, `after ring #2 dies: ${acolytes().length} acolytes, _ringN=${hiero._ringN} (re-forms exactly ONCE — then the burst window)`);

// ---------- 4. radiant bolt fires on cadence, aimed at the hero ----------
isolate();
hiero._boltCd = 0; hiero.specialCd = 1e9; hiero._ringN = 99; // enable bolt, silence smite + ring
const bLairX = hiero._lairTx * TILE - 12, bLairY = hiero._lairTy * TILE - 12;
A.x = bLairX - 5 * TILE; A.y = bLairY; // engaged, off to one side so the bolt has a clear aim vector
S.projectiles.length = 0;
hiero.x = bLairX; hiero.y = bLairY;
G.updateEnemies();
let bolts = S.projectiles.filter((p) => p.kind === 'radiant');
A1('4_bolt_fires', bolts.length === 1, `${bolts.length} radiant bolt on the first engaged tick`);
A1('4_bolt_is_radiant', !!(bolts[0] && bolts[0].color === '#ffe08a' && bolts[0].element === 'fire' && bolts[0].ownerRef === hiero), bolts[0] && `color ${bolts[0].color} el ${bolts[0].element} owned ${bolts[0].ownerRef === hiero}`);
A1('4_bolt_aimed', !!(bolts[0] && bolts[0].vx < 0 && Math.abs(bolts[0].vy) < Math.abs(bolts[0].vx)), bolts[0] && `v=(${bolts[0].vx.toFixed(2)},${bolts[0].vy.toFixed(2)}) — points left, toward the hero`);
// cadence: over 2×boltEvery more ticks it fires ~twice more, NOT every tick (boss pinned + hero fixed so
// it stays engaged the whole window — no chase-drift disengage).
S.projectiles.length = 0;
for (let t = 0; t < 2 * MECH.boltEvery + 4; t++) { hiero.x = bLairX; hiero.y = bLairY; A.x = bLairX - 5 * TILE; A.y = bLairY; G.updateEnemies(); }
const fired = S.projectiles.filter((p) => p.kind === 'radiant').length;
A1('4_bolt_cadence', fired >= 2 && fired <= 4, `${fired} bolts over ${2 * MECH.boltEvery + 4} ticks (cadence ~every ${MECH.boltEvery} — not a per-tick stream)`);

// ---------- 5. smite telegraphs then damages — 2-HERO MP hits BOTH in the zone ----------
isolate();
hiero._boltCd = 1e9; hiero._ringN = 99; hiero.specialCd = 1e9; // isolate the smite: no bolt, no ring
B.downed = false; // BOTH heroes live and standing in the world
const smiteR = SMITE.radius;
const aimX = hiero.x + hiero.w / 2, aimY = hiero.y + hiero.h / 2;
// both heroes inside the zone, at distinct offsets; A nearer the boss centre → A is the bucketed
// duelist. A CORRECT smite (partyIn loop) hits BOTH; the slam-trap version hits only A.
A.x = aimX - 30 - A.w / 2; A.y = aimY - A.h / 2; A.hp = 1e7; A.invuln = 0; A.dodge = 0; A.def = 0;
B.x = aimX + 34 - B.w / 2; B.y = aimY - 18 - B.h / 2; B.hp = 1e7; B.invuln = 0; B.dodge = 0; B.def = 0;
const bothInZone = Math.hypot(A.x + A.w / 2 - aimX, A.y + A.h / 2 - aimY) <= smiteR && Math.hypot(B.x + B.w / 2 - aimX, B.y + B.h / 2 - aimY) <= smiteR;
hiero.tele = { name: 'smite', t: 2, max: 52, aimX, aimY, radius: smiteR };
const aHp0 = A.hp, bHp0 = B.hp;
G.updateEnemies(); // tele.t 2 → 1, no damage yet (windup)
A1('5_telegraph_no_damage_during_windup', A.hp === aHp0 && B.hp === bHp0 && !!hiero.tele, `mid-windup: A/B untouched, tele still live (t=${hiero.tele && hiero.tele.t})`);
for (let t = 0; t < 3; t++) G.updateEnemies(); // tele resolves → smite.exec fires
const aTook = aHp0 - A.hp, bTook = bHp0 - B.hp;
A1('5_zone_setup_both_inside', bothInZone, `A ${Math.hypot(A.x + A.w / 2 - aimX, A.y + A.h / 2 - aimY).toFixed(0)}px / B ${Math.hypot(B.x + B.w / 2 - aimX, B.y + B.h / 2 - aimY).toFixed(0)}px from the aim point (zone radius ${smiteR})`);
A1('5_smite_hits_bucketed_hero', aTook > 0, `A (the bucketed duelist) took ${aTook} smite damage`);
A1('5_smite_hits_BOTH_heroes', aTook > 0 && bTook > 0, `BOTH heroes struck — A ${aTook}, B ${bTook} (the partyIn()+actAs loop; the slam-trap version would leave B at 0)`);
A1('5_smite_resolved', !hiero.tele, 'the telegraph consumed itself on exec');

// ---------- 6. wire: acolytes serialize with NO object-ref leak ----------
isolate();
for (let t = 0; t < 4; t++) G.updateEnemies();
let snapStr = '';
let threw = null;
try { snapStr = JSON.stringify(w.snapshotFor('A')); } catch (e) { threw = String(e); }
A1('6_snapshot_serializes', threw === null && snapStr.length > 0, threw || `snapshot ${snapStr.length} bytes`);
A1('6_no_orbref_leak', threw === null && snapStr.indexOf('_orbRef') < 0 && snapStr.indexOf('_mech') < 0, 'packScalar dropped _orbRef + _mech (no object/circular field on the wire)');
A1('6_acolytes_on_wire', snapStr.indexOf('Sun Acolyte') >= 0, 'the acolytes still ride packEnemy as scalars (name/level/pos), just without the object refs');

report();

function report() {
  const bools = Object.entries(R).filter(([k]) => !k.endsWith('__') && typeof R[k] === 'boolean');
  const passed = bools.filter(([, v]) => v).length, total = bools.length;
  console.log('\n=== hierophant S3 verify (orbit ring · heal · re-form · radiant bolt · party-wide smite) ===');
  for (const [k, v] of Object.entries(R)) {
    if (k.endsWith('__')) continue;
    const note = R[k + '__'];
    console.log((v ? ' PASS ' : ' FAIL ') + k + (note !== undefined ? '  [' + note + ']' : ''));
  }
  console.log('\n' + passed + '/' + total + ' checks passed');
  process.exit(passed === total ? 0 : 1);
}
