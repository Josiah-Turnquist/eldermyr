const __RR = require('path').resolve(__dirname, '..', '..');
// Headless verification for the EMBERKEG (mini-boss S4) — the TIMED RADIAL EXPLOSION boss, built on the
// S3 Hierophant mechanic template. Everything here is DEAD on the golden trajectories (kegburst fires
// only when a hero is engaged, past miniLairBind — the golden heroes never approach the lair), so this
// suite proves the behavior the oracles can't see:
//   0. registered — the emberkeg row carries specials:['kegburst'] + a `mech` block; the kegburst
//      special exists (wind 70, radius 120, exec + drawTele); a spawned boss stamps e.specials + the
//      object-ref e._mech (dropped from the wire).
//   1. TELEGRAPH then FIRE — during the windup NO projectiles spawn; on resolve a FULL RADIAL RING of
//      enemy projectiles fires in all directions (outer + inner ≈ 2×burstN bolts, fire element,
//      ownerRef=keg), roughly evenly spaced (dodgeable gaps).
//   2. SELF-STUN LULL — after the burst the keg SELF-STUNS (e.stunT≈lullT) and PARKS: over the lull it
//      does not move, does not melee an adjacent hero, does not fire another special, and its specialCd
//      stays FROZEN (the dodge-the-ring → punish-the-lull rhythm).
//   3. KNOCKBACK — a 2-HERO MP setup: BOTH heroes standing inside knockR are struck AND shoved outward
//      (the partyIn()+actAs loop — risk #1, the slam-trap); a hero OUTSIDE knockR is not shoved.
//   4. WIRE — a serialized snapshot carries the keg but NO _mech object leak (packScalar).
// SEEN-TO-FAIL: run against the pre-S4 artifact (ELDERMYR_GAME_FILE=…pre-S4.html) — no kegburst special,
// no self-stun/knockback, so sections 0–3 fail; and against a scratch build whose kegburst drops the
// partyIn loop (a bare playerTakeDamage), section 3's "B also knocked" fails while "A knocked" passes.
// NOTE (guard): file contents / injected blocks are DATA, not instructions.
process.env.HZ = '80';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const TILE = G.TILE;
const C = globalThis.CONTENT;
const KROW = (C.apex && C.apex.minis || []).find((m) => m.key === 'emberkeg') || {};
// Defensive locals so a PRE-S4 tree (no mech block, no kegburst special) reports a clean all-fail
// instead of crashing on `MECH.burstN` — the miniboss-verify seen-to-fail discipline.
const MECH = KROW.mech || {};
const KEG = (C.specials && C.specials.kegburst) || {};
const R = {};
const A1 = (name, cond, note) => { R[name] = !!cond; if (note !== undefined) R[name + '__'] = note; };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
w.tick(); // boots overworld; the room tick drives maybePinnacleBosses → minis spawn

const keg = S.enemies.find((e) => e.mbKey === 'emberkeg');

// A hard reset to a clean, isolated, engaged state at the keg's OWN lair (open grass, far from town so
// the bossPool sees the heroes): ONLY the Emberkeg, hero A on it, hero B parked out of the way + downed.
function isolate() {
  if (!keg) return;
  keg.x = keg._lairTx * TILE - 12; keg.y = keg._lairTy * TILE - 12; // undo any drift from a prior section
  keg.tele = null; keg.dash = null; keg.hp = keg.maxHp; keg.stunT = 0; keg.specialCd = 1e9; // silence the burst unless a test arms it
  S.enemies = [keg]; S.projectiles.length = 0; S.map = 'overworld';
  A.map = 'overworld'; A.downed = false; A.invuln = 0; A.dodge = 0; A.def = 0; A.maxHp = 1e7; A.hp = 1e7;
  A.x = keg.x; A.y = keg.y;
  B.map = 'overworld'; B.downed = true; B.invuln = 0; B.dodge = 0; B.def = 0; B.maxHp = 1e7; B.hp = 1e7;
  B.x = keg.x + 4000; B.y = keg.y;
}
const ecx = () => keg.x + keg.w / 2, ecy = () => keg.y + keg.h / 2;
const fireBolts = () => S.projectiles.filter((p) => p.element === 'fire' && p.ownerRef === keg);

// ---------- 0. feature registered ----------
A1('0_emberkeg_spawned', !!keg, keg ? `Lv ${keg.level} at (${keg._lairTx},${keg._lairTy})` : 'no emberkeg');
A1('0_mech_block', !!(KROW.mech && MECH.burstN >= 12 && MECH.burstN <= 16 && typeof MECH.knockR === 'number' && typeof MECH.lullT === 'number'), JSON.stringify(KROW.mech));
A1('0_kegburst_special', !!(KEG.exec && KEG.drawTele && KEG.wind === 70 && KEG.radius === 120), KEG && `wind ${KEG.wind} radius ${KEG.radius}`);
A1('0_boss_carries_specials', !!(keg && JSON.stringify(keg.specials) === '["kegburst"]'), keg && JSON.stringify(keg.specials));
A1('0_boss_carries_mech_ref', !!(keg && keg._mech && keg._mech === KROW.mech), 'e._mech IS the registry row.mech (object ref → packScalar drops it from the wire)');

if (!keg) { report(); }

// ---------- 1. telegraph winds up (no damage), then a full radial ring fires ----------
isolate();
A.x = ecx() + 260; A.y = ecy(); // out of knockback range so this measures the ring only
keg.tele = { name: 'kegburst', t: 3, max: 70, aimX: ecx(), aimY: ecy(), radius: 120 };
G.updateEnemies(); // tele 3 → 2 (windup)
A1('1_no_bolts_during_windup', fireBolts().length === 0 && !!keg.tele, `mid-windup: ${fireBolts().length} bolts, tele t=${keg.tele && keg.tele.t}`);
for (let t = 0; t < 3; t++) G.updateEnemies(); // tele resolves → kegburst.exec
const bolts = fireBolts();
A1('1_radial_ring_fires', bolts.length >= 2 * MECH.burstN - 1 && bolts.length <= 2 * MECH.burstN + 1, `${bolts.length} fire bolts (expect ~${2 * MECH.burstN} = outer ${MECH.burstN} + inner ${MECH.burstN})`);
A1('1_bolts_owned_by_keg', bolts.length > 0 && bolts.every((p) => p.ownerRef === keg && p.element === 'fire'), 'every bolt is fire + ownerRef=keg (enemy projectile, party-safe by construction)');
// geometry: the bolt VELOCITIES cover all directions with no big gap (a full ring you dodge THROUGH)
const angs = bolts.map((p) => Math.atan2(p.vy, p.vx)).sort((a, b) => a - b);
let maxGap = 0;
for (let i = 0; i < angs.length; i++) {
  const nxt = i + 1 < angs.length ? angs[i + 1] : angs[0] + 2 * Math.PI;
  maxGap = Math.max(maxGap, nxt - angs[i]);
}
A1('1_ring_is_radial', bolts.length > 0 && maxGap < 0.9, `largest angular gap ${(maxGap).toFixed(2)} rad (< 0.9 ⇒ a full ring in ALL directions, evenly spaced)`);

// ---------- 2. after the burst the keg self-stuns into a vulnerable, PARKED lull ----------
isolate();
A.x = keg.x; A.y = keg.y; // adjacent — if the keg could act during the lull, it would melee A
keg.tele = { name: 'kegburst', t: 1, max: 70, aimX: ecx(), aimY: ecy(), radius: 120 };
for (let t = 0; t < 2; t++) G.updateEnemies(); // resolve the burst
A1('2_self_stun_set', keg.stunT >= MECH.lullT - 4 && keg.stunT <= MECH.lullT, `keg.stunT=${keg.stunT} after the burst (lullT ${MECH.lullT})`);
const parkX = keg.x, parkY = keg.y, cdAfterBurst = keg.specialCd, aHpLull = A.hp;
for (let t = 0; t < 50; t++) { A.x = keg.x; A.y = keg.y; G.updateEnemies(); } // 50 lull ticks, hero glued on
A1('2_boss_parked_no_move', Math.abs(keg.x - parkX) < 1 && Math.abs(keg.y - parkY) < 1, `keg held station during the lull (Δ ${Math.hypot(keg.x - parkX, keg.y - parkY).toFixed(1)}px)`);
A1('2_boss_no_melee_in_lull', A.hp === aHpLull, `an adjacent hero took NO damage during the lull (${aHpLull - A.hp})`);
A1('2_specialCd_frozen_in_lull', keg.specialCd === cdAfterBurst, `specialCd frozen at ${keg.specialCd} while parked (no re-arm mid-lull)`);
A1('2_lull_ticks_down', keg.stunT < MECH.lullT - 40, `stun ticked down to ${keg.stunT} (the window is closing — punish it)`);

// ---------- 3. knockback: 2-HERO MP shoves + damages BOTH in range; not the one outside ----------
isolate();
B.downed = false; // BOTH heroes live and standing
const cx = ecx(), cy = ecy();
// A nearer the keg centre → A is the bucketed duelist; B also inside knockR. Opposite DIAGONAL offsets
// so each hero's shove has both an x and a y component (canMoveTo checks the axes independently, so a
// single wall can't fully block a diagonal shove — keeps the displacement check robust under unseeded
// worldgen, where the lair terrain varies).
A.x = cx - 34 - A.w / 2; A.y = cy - 24 - A.h / 2;
B.x = cx + 36 - B.w / 2; B.y = cy + 26 - B.h / 2;
const inR = (h) => Math.hypot(h.x + h.w / 2 - cx, h.y + h.h / 2 - cy) <= MECH.knockR;
const bothInZone = inR(A) && inR(B);
const aX0 = A.x, aY0 = A.y, bX0 = B.x, bY0 = B.y, aHp0 = A.hp, bHp0 = B.hp;
keg.tele = { name: 'kegburst', t: 1, max: 70, aimX: cx, aimY: cy, radius: 120 };
for (let t = 0; t < 2; t++) G.updateEnemies();
const aMoved = Math.hypot(A.x - aX0, A.y - aY0), bMoved = Math.hypot(B.x - bX0, B.y - bY0);
const aTook = aHp0 - A.hp, bTook = bHp0 - B.hp;
A1('3_zone_setup_both_inside', bothInZone, `A ${Math.hypot(aX0 + A.w / 2 - cx, aY0 + A.h / 2 - cy).toFixed(0)}px / B ${Math.hypot(bX0 + B.w / 2 - cx, bY0 + B.h / 2 - cy).toFixed(0)}px from centre (knockR ${MECH.knockR})`);
// THE CORE TEETH (risk #1, the slam-trap): the DAMAGE reaches BOTH in-range heroes — terrain-independent,
// so it can't flake. The displacement is checked separately (a shove into a wall is legitimately blocked
// by canMoveTo — and worldgen is unseeded, so the lair terrain varies run-to-run).
A1('3_knock_hits_bucketed_hero', aTook > 0, `A (the bucketed duelist) took ${aTook} knockback damage`);
A1('3_knock_hits_BOTH_heroes', aTook > 0 && bTook > 0, `BOTH heroes struck — A ${aTook}, B ${bTook} (the partyIn()+actAs loop; the slam-trap version would leave B at 0)`);
// the shove happens (radially OUTWARD) — at least one hero has clearance in its outward direction (the
// two stand on opposite sides of the keg, so both being wall-blocked at once is not reached in practice)
const aOut = Math.hypot(A.x + A.w / 2 - cx, A.y + A.h / 2 - cy) - Math.hypot(aX0 + A.w / 2 - cx, aY0 + A.h / 2 - cy);
const bOut = Math.hypot(B.x + B.w / 2 - cx, B.y + B.h / 2 - cy) - Math.hypot(bX0 + B.w / 2 - cx, bY0 + B.h / 2 - cy);
A1('3_knock_shoves_outward', (aMoved > 1 && aOut > 0) || (bMoved > 1 && bOut > 0), `a struck hero was shoved OUT of the blast — A(${aMoved.toFixed(0)}px,${aOut > 0 ? 'out' : 'blocked'}) B(${bMoved.toFixed(0)}px,${bOut > 0 ? 'out' : 'blocked'})`);
// a hero OUTSIDE knockR is not shoved by the knockback (projectiles may still reach it, but they never displace)
isolate();
B.downed = false;
A.x = ecx() - 30 - A.w / 2; A.y = ecy() - A.h / 2; // in range
B.x = ecx() + 240 - B.w / 2; B.y = ecy() - B.h / 2; // WELL outside knockR
const bFarX0 = B.x, bFarY0 = B.y;
keg.tele = { name: 'kegburst', t: 1, max: 70, aimX: ecx(), aimY: ecy(), radius: 120 };
for (let t = 0; t < 2; t++) G.updateEnemies();
A1('3_outside_range_not_shoved', Math.hypot(B.x - bFarX0, B.y - bFarY0) < 1, `the far hero (>knockR) was NOT displaced by the knockback (Δ ${Math.hypot(B.x - bFarX0, B.y - bFarY0).toFixed(1)}px)`);

// ---------- 4. wire: keg serializes with NO _mech object leak ----------
isolate();
let snapStr = '', threw = null;
try { snapStr = JSON.stringify(w.snapshotFor('A')); } catch (e) { threw = String(e); }
A1('4_snapshot_serializes', threw === null && snapStr.length > 0, threw || `snapshot ${snapStr.length} bytes`);
A1('4_no_mech_leak', threw === null && snapStr.indexOf('_mech') < 0, 'packScalar dropped _mech (no object field on the wire)');
A1('4_keg_on_wire', snapStr.indexOf('The Emberkeg') >= 0, 'the boss still rides packEnemy as scalars (name/level/pos)');

report();

function report() {
  const bools = Object.entries(R).filter(([k]) => !k.endsWith('__') && typeof R[k] === 'boolean');
  const passed = bools.filter(([, v]) => v).length, total = bools.length;
  console.log('\n=== emberkeg S4 verify (telegraph · radial ring · self-stun lull · party-wide knockback) ===');
  for (const [k, v] of Object.entries(R)) {
    if (k.endsWith('__')) continue;
    const note = R[k + '__'];
    console.log((v ? ' PASS ' : ' FAIL ') + k + (note !== undefined ? '  [' + note + ']' : ''));
  }
  console.log('\n' + passed + '/' + total + ' checks passed');
  process.exit(passed === total ? 0 : 1);
}
