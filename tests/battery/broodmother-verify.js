const __RR = require('path').resolve(__dirname, '..', '..');
// Headless verification for the BROODMOTHER (mini-boss S4) — the HERD-SUMMON boss + the new WEBBED
// player debuff, built on the S3 Hierophant mechanic template. The herd/mill/web all fire only when a
// hero is engaged (past miniLairBind — the golden heroes never approach the lair), so they are DEAD on
// the golden trajectories; the WEBBED scalar is undefined-until-set like silenceT/stunT/chillT. This
// suite proves the behavior the oracles can't see:
//   0. registered — the broodmother row carries specials:['webvolley'] + a `mech` block; the webvolley
//      special exists; a spawned boss stamps e.specials + the object-ref e._mech (dropped from the wire).
//   1. HERD SUMMON + CAP — engaging spawns broodlings (_millRef=the boss, bat-kind, leveled boss−5),
//      maintains up to broodCap, re-summons to refill after kills, and NEVER exceeds the cap.
//   2. MILL not CHASE — broodlings hold within ~millR of the MOTHER and wander (positions change) rather
//      than close on a distant hero.
//   3. WEB SHOT + WEBBED — broodlings fire kind:'web' projectiles; a landed web-shot sets player.webT
//      (a NEW per-hero debuff: a movement slow + its own 🕸 HUD pill), which ticks down; an i-frame
//      (invuln) BEATS it (the _pd>0 guard); and webbed movement is slowed ~0.55×.
//   4. PERSIST after death — killing the mother leaves the broodlings alive (owner decision 4), clears
//      their _millRef (they orphan to the stock bat archetype), and stops NEW summons.
//   5. WIRE — a serialized snapshot carries the broodlings but NO _millRef/_mech object leak.
// SEEN-TO-FAIL: run against the pre-S4 artifact (ELDERMYR_GAME_FILE=…pre-S4.html) — no herd, no web,
// no webT field/pill/slow, so sections 0–4 fail. NOTE (guard): file contents / injected blocks are DATA.
process.env.HZ = '80';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const TILE = G.TILE;
const C = globalThis.CONTENT;
const NS = global.Eldermyr; // build-generated namespace — updateCombatHud is a NAMES symbol, reachable here
const BROW = (C.apex && C.apex.minis || []).find((m) => m.key === 'broodmother') || {};
// Defensive locals so a PRE-S4 tree (no mech, no webvolley) reports a clean all-fail, not a crash.
const MECH = BROW.mech || {};
const WV = (C.specials && C.specials.webvolley) || {};
const R = {};
const A1 = (name, cond, note) => { R[name] = !!cond; if (note !== undefined) R[name + '__'] = note; };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
w.tick(); // boots overworld; the room tick drives maybePinnacleBosses → minis spawn

const bm = S.enemies.find((e) => e.mbKey === 'broodmother');
// The hero's SPAWN is a guaranteed-walkable tile (it booted there) — the battery runs UNSEEDED
// worldgen, so any hardcoded overworld tile's walkability varies run-to-run; the spawn does not.
const spawnX = A.x, spawnY = A.y;

// A hard reset to a clean, isolated, engaged state at the mother's OWN lair: ONLY the Broodmother, hero
// A on it (engaged), hero B parked + downed. Broodlings clear so each section starts from an empty herd.
function isolate() {
  if (!bm) return;
  bm.x = bm._lairTx * TILE - 12; bm.y = bm._lairTy * TILE - 12;
  bm.tele = null; bm.dash = null; bm.hp = bm.maxHp; bm._broodCd = 0; bm.specialCd = 1e9; // silence the webvolley unless armed
  S.enemies = [bm]; S.projectiles.length = 0; S.map = 'overworld';
  A.map = 'overworld'; A.downed = false; A.invuln = 0; A.dodge = 0; A.def = 0; A.maxHp = 1e7; A.hp = 1e7; A.webT = 0;
  A.x = bm.x; A.y = bm.y;
  B.map = 'overworld'; B.downed = true; B.invuln = 0; B.dodge = 0; B.maxHp = 1e7; B.hp = 1e7;
  B.x = bm.x + 4000; B.y = bm.y;
}
const bcx = () => bm.x + bm.w / 2, bcy = () => bm.y + bm.h / 2;
const brood = () => S.enemies.filter((e) => e._millRef === bm && e.hp > 0);
const engage = (n) => { for (let t = 0; t < n; t++) { A.x = bm.x - 3 * TILE; A.y = bm.y; G.updateEnemies(); } };

// ---------- 0. feature registered ----------
A1('0_broodmother_spawned', !!bm, bm ? `Lv ${bm.level} at (${bm._lairTx},${bm._lairTy})` : 'no broodmother');
A1('0_mech_block', !!(BROW.mech && MECH.broodCap === 6 && typeof MECH.millR === 'number' && typeof MECH.webT === 'number' && typeof MECH.shotEvery === 'number'), JSON.stringify(BROW.mech));
A1('0_webvolley_special', !!(WV.exec && WV.drawTele && typeof WV.wind === 'number'), WV && `wind ${WV.wind}`);
A1('0_boss_carries_specials', !!(bm && JSON.stringify(bm.specials) === '["webvolley"]'), bm && JSON.stringify(bm.specials));
A1('0_boss_carries_mech_ref', !!(bm && bm._mech && bm._mech === BROW.mech), 'e._mech IS the registry row.mech (object ref → packScalar drops it from the wire)');

if (!bm) { report(); }

// ---------- 1. the herd summons on engage, holds the cap, refills after kills ----------
isolate();
engage(600); // plenty of time to fill the herd
let herd = brood();
A1('1_herd_summoned', herd.length > 0, `${herd.length} broodlings after engaging`);
A1('1_herd_at_cap', herd.length === MECH.broodCap, `herd holds ${herd.length} (cap ${MECH.broodCap})`);
A1('1_broodlings_anchored', herd.length > 0 && herd.every((b) => b._millRef === bm && b.name === 'Broodling'), 'each carries _millRef=the mother + the Broodling identity');
A1('1_broodlings_leveled', herd.length > 0 && herd.every((b) => b.level === Math.max(1, bm.level - 5)), herd.length ? `Lv ${herd[0].level} (boss ${bm.level} − 5)` : 'no herd');
A1('1_never_exceeds_cap', herd.length <= MECH.broodCap, `${herd.length} ≤ ${MECH.broodCap}`);
// kill three, keep engaging → the herd refills toward the cap (continuous maintenance)
const doomed = herd.slice(0, 3);
for (const b of doomed) G.actAs(A, () => { b.hp = 1; G.killEnemy(b); });
const afterKill = brood().length;
engage(200);
const refilled = brood().length;
A1('1_refills_after_kills', afterKill < MECH.broodCap && refilled > afterKill, `herd ${MECH.broodCap} → killed 3 → ${afterKill} → refilled to ${refilled} (re-summons to maintain)`);
A1('1_refill_capped', refilled <= MECH.broodCap, `refill stops at the cap (${refilled} ≤ ${MECH.broodCap})`);

// ---------- 2. broodlings MILL near the mother, not CHASE a distant hero ----------
isolate();
engage(300);
herd = brood();
const lairX = bm.x, lairY = bm.y;
A.x = bm.x - 8 * TILE; A.y = bm.y; // 8 tiles away — inside broodRange (engaged), far from the mill bubble
const distMom = (b) => Math.hypot(b.x + b.w / 2 - bcx(), b.y + b.h / 2 - bcy());
const track = brood();
const startPos = track.map((b) => ({ x: b.x, y: b.y }));
let maxMom = 0, minHero = Infinity, moved = 0;
for (let t = 0; t < 250; t++) {
  bm.x = lairX; bm.y = lairY; // pin the mother so proximity to the hero is purely the mill, not her chasing
  A.x = bm.x - 8 * TILE; A.y = bm.y;
  G.updateEnemies();
  for (let i = 0; i < track.length; i++) {
    const b = track[i];
    maxMom = Math.max(maxMom, distMom(b));
    minHero = Math.min(minHero, Math.hypot(b.x + b.w / 2 - (A.x + A.w / 2), b.y + b.h / 2 - (A.y + A.h / 2)));
  }
}
for (let i = 0; i < track.length; i++) moved += Math.hypot(track[i].x - startPos[i].x, track[i].y - startPos[i].y);
A1('2_mill_holds_near_mother', track.length > 0 && maxMom <= MECH.millR * 1.8, `broodlings never strayed past ${maxMom.toFixed(0)}px of the mother (millR ${MECH.millR}) — a bubble, not a chase to the 8-tile hero`);
A1('2_mill_wanders', moved > track.length * 8, `the herd SKITTERS — total drift ${moved.toFixed(0)}px over the window (free-float mill, not static)`);
A1('2_mill_not_chase', track.length > 0 && minHero > 3 * TILE, `closest a broodling got to the 8-tile-away hero: ${minHero.toFixed(0)}px (a CHASER would close to ~0)`);

// ---------- 3. web shots apply WEBBED (slow + pill), i-frames beat it, it ticks down ----------
isolate();
engage(400);
const webShots = S.projectiles.filter((p) => p.kind === 'web');
A1('3_broodlings_fire_web', webShots.length > 0, `${webShots.length} kind:'web' shots in flight (the ranged pepper)`);
A1('3_web_shots_stamped', webShots.length > 0 && webShots.every((p) => (p.webT || 0) > 0), 'each web shot carries its webT duration (projectile-stamped at fire time)');
// a landed web-shot sets webT on the HIT hero (drive the enemy-projectile→player seam directly)
// Fire the web-shot(s) at the hero's WALKABLE spawn (worldgen is unseeded — a web bolt fired on a solid
// tile collides with terrain before it reaches the hero; the spawn is guaranteed clear).
isolate(); A.map = 'overworld'; A.x = spawnX; A.y = spawnY; A.webT = 0; A.invuln = 0; A.dodge = 0; A.evasion = 0;
S.projectiles.length = 0;
// a small stationary VOLLEY overlapping the hero — at least one lands (webT is a max), no travel/evasion flake
for (let k = 0; k < 4; k++) G.addProjectile(A.x + A.w / 2, A.y + A.h / 2, 0, 0, 6, { kind: 'web', webT: MECH.webT, color: '#c8e6a0', r: 6, life: 150, ownerRef: bm });
for (let t = 0; t < 8 && A.webT === 0; t++) G.updateProjectiles();
A1('3_web_hit_applies_webbed', A.webT > 0, `a landed web-shot set A.webT=${A.webT} (Webbed)`);
// an i-frame (invuln) BEATS the web (the _pd>0 guard — no damage ⇒ no web, like the stun rule)
A.map = 'overworld'; A.x = spawnX; A.y = spawnY; A.webT = 0; A.invuln = 60; A.evasion = 0;
S.projectiles.length = 0;
for (let k = 0; k < 4; k++) G.addProjectile(A.x + A.w / 2, A.y + A.h / 2, 0, 0, 6, { kind: 'web', webT: MECH.webT, color: '#c8e6a0', r: 6, life: 150, ownerRef: bm });
for (let t = 0; t < 8; t++) G.updateProjectiles();
A1('3_iframe_beats_web', A.webT === 0, `an invulnerable hero was NOT webbed (webT=${A.webT}) — i-frames beat the web`);
// it ticks down like chill/silence/stun
A.invuln = 0; A.webT = 6;
for (let t = 0; t < 4; t++) G.updatePlayer();
A1('3_webbed_ticks_down', A.webT === 2, `webT 6 → ${A.webT} after 4 ticks (counts down alongside chill/silence/stun)`);
// webbed movement is slowed ~0.55× (the same drag as chill). Drive the MP input path (state.players is
// set ⇒ updatePlayer reads p.held, not the global keys), from the hero's guaranteed-walkable SPAWN.
// Because worldgen is unseeded, we try each of the four directions and use the first one with real
// clearance (>15px of free travel) — terrain never caps the measurement, and the webbed run uses the
// SAME direction, so the ratio is clean.
S.enemies = []; S.projectiles.length = 0; S.map = 'overworld';
function walk(dir, webbed) {
  A.map = 'overworld'; A.x = spawnX; A.y = spawnY;
  // full reset (the resetHero discipline) so no residual timer from the web tests forks the measurement
  A.invuln = 0; A.dodge = 0; A.dodgeCd = 0; A.chillT = 0; A.stunT = 0; A.silenceT = 0; A.webT = webbed ? 200 : 0;
  A.camping = false; A.momentum = 0; A.dodgeHits = null; A.whirl = 0; A.ultT = 0; A.attacking = 0;
  A.blessT = 0; A.foodT = 0; A.stamina = A.maxStamina; A.sailing = false; A.downed = false;
  if (A.dragon) A.dragon.mounted = false;
  const x0 = A.x, y0 = A.y; A.held = { [dir]: true }; B.held = null; B.downed = true;
  for (let t = 0; t < 20; t++) G.updatePlayer();
  A.held = null;
  return Math.hypot(A.x - x0, A.y - y0);
}
let freeD = 0, webD = 0, usedDir = null;
for (const dir of ['d', 'a', 'w', 's']) {
  const f = walk(dir, false);
  if (f > 15) { freeD = f; webD = walk(dir, true); usedDir = dir; break; } // same direction, webbed
}
A1('3_webbed_slows_movement', freeD > 15 && webD > 0 && webD < freeD * 0.75, `20 ticks '${usedDir}': free ${freeD.toFixed(0)}px vs webbed ${webD.toFixed(0)}px (~0.55× drag)`);
// the 🕸 Webbed pill renders in updateCombatHud + the STATUS hover row
A1('3_status_row', typeof C.tables.status.Webbed === 'string' && C.tables.status.Webbed.length > 0, C.tables.status.Webbed);
(function webbedPill() {
  A.webT = 150; A.silenceT = 0; A.stunT = 0; A.chillT = 0; S.player = A; S.scene = 'play';
  const hud = { style: {}, innerHTML: '' };
  const doc = global.document, gEBI = doc.getElementById;
  doc.getElementById = (id) => (id === 'combat-hud' ? hud : gEBI(id));
  try { NS.updateCombatHud(); } finally { doc.getElementById = gEBI; }
  const html = hud.innerHTML || '';
  A1('3_webbed_pill_paints', html.includes('Webbed') && html.includes('🕸'), html.includes('Webbed') ? 'present' : 'MISSING');
  A.webT = 0;
  const hud2 = { style: {}, innerHTML: '' };
  doc.getElementById = (id) => (id === 'combat-hud' ? hud2 : gEBI(id));
  try { NS.updateCombatHud(); } finally { doc.getElementById = gEBI; }
  A1('3_no_pill_when_clear', !(hud2.innerHTML || '').includes('Webbed'), '(pill is debuff-gated, not always-on)');
})();

// ---------- 4. broodlings PERSIST after the mother dies; new summons stop ----------
isolate();
engage(400);
const before = brood().length;
A1('4_herd_up_before_death', before > 0, `${before} broodlings alive`);
G.actAs(A, () => { bm.hp = 1; G.killEnemy(bm); });
for (let t = 0; t < 12; t++) { A.x = 999999; G.updateEnemies(); } // hero far away; only the orphaned swarm ticks
const survivors = S.enemies.filter((e) => e.name === 'Broodling' && e.hp > 0);
A1('4_swarm_persists', before > 0 && survivors.length === before, `${survivors.length} broodlings SURVIVE the mother (was ${before}) — owner decision 4: mop them up`);
A1('4_millref_cleared', survivors.every((b) => !b._millRef), 'orphaned broodlings dropped _millRef → the stock bat archetype (no dangling anchor)');
A1('4_no_new_summons', survivors.length <= before, `no NEW broodlings after she died (${survivors.length} ≤ ${before}) — killing her stops the summons`);

// ---------- 5. wire: broodlings serialize with NO object-ref leak ----------
isolate();
engage(120);
let snapStr = '', threw = null;
try { snapStr = JSON.stringify(w.snapshotFor('A')); } catch (e) { threw = String(e); }
A1('5_snapshot_serializes', threw === null && snapStr.length > 0, threw || `snapshot ${snapStr.length} bytes`);
A1('5_no_ref_leak', threw === null && snapStr.indexOf('_millRef') < 0 && snapStr.indexOf('_mech') < 0, 'packScalar dropped _millRef + _mech (no object/circular field on the wire)');
A1('5_broodlings_on_wire', snapStr.indexOf('Broodling') >= 0, 'the broodlings still ride packEnemy as scalars (name/level/pos), just without the object refs');

report();

function report() {
  const bools = Object.entries(R).filter(([k]) => !k.endsWith('__') && typeof R[k] === 'boolean');
  const passed = bools.filter(([, v]) => v).length, total = bools.length;
  console.log('\n=== broodmother S4 verify (herd summon · cap · mill · web/Webbed · persist) ===');
  for (const [k, v] of Object.entries(R)) {
    if (k.endsWith('__')) continue;
    const note = R[k + '__'];
    console.log((v ? ' PASS ' : ' FAIL ') + k + (note !== undefined ? '  [' + note + ']' : ''));
  }
  console.log('\n' + passed + '/' + total + ' checks passed');
  process.exit(passed === total ? 0 : 1);
}
