/*
 * snapshot-size.js — WIRE-COST CHECK for "broadcast the world at 20Hz".
 * -----------------------------------------------------------------------------
 * Server-authoritative + low expectations = we can broadcast state instead of
 * deltas. But we must NOT ship the static 248×208 tile map every tick. This
 * measures: (a) naive whole-state, (b) the map alone, (c) a minimal per-tick
 * snapshot of just the dynamic entities a client needs to render — and the
 * resulting bandwidth per player at 20Hz.
 *
 * Run: node server-spike/snapshot-size.js
 */
'use strict';
const G = require('./load-game');
G.startGame();
// populate with a realistic load: enemies from world-gen + a few projectiles/pickups
const s = G.state;
const kb = (obj) => (Buffer.byteLength(JSON.stringify(obj)) / 1024);
const f1 = (n) => +n.toFixed(1);

// ---- minimal per-tick snapshot: only what a client needs to DRAW this frame ----
function compactEnemy(e, i) {
  return { i, x: Math.round(e.x), y: Math.round(e.y), w: e.w, h: e.h, t: e.type || e.kind,
    hp: Math.round(e.hp), mhp: Math.round(e.maxHp), dir: e.dir, f: e.hitFlash | 0,
    b: e.isBoss ? 1 : 0, n: e.isBoss || e.isNemesis ? e.name : undefined,
    st: (e.burnT > 0 ? 'b' : e.chillT > 0 ? 'c' : e.poisonT > 0 ? 'p' : undefined) };
}
function compactPlayer(p) {
  return { id: p.pid, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir, hp: Math.round(p.hp),
    mhp: Math.round(p.maxHp), lvl: p.level, atk: p.attacking | 0, mounted: !!(p.mounted) };
}
function compactProj(pr) { return { x: Math.round(pr.x), y: Math.round(pr.y), k: pr.kind, fr: pr.friendly ? 1 : 0 }; }
function minimalSnapshot(st, players) {
  return {
    t: st.time, wx: st.weather, map: st.map,
    players: (players || [st.player]).map(compactPlayer),
    enemies: st.enemies.map(compactEnemy),
    proj: st.projectiles.map(compactProj),
    pickups: st.pickups.filter((p) => !p.collected).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), k: p.kind })),
  };
}

// simulate a couple of players + some projectiles for realism
const A = s.player; A.pid = 'A';
const B = structuredClone(A); B.pid = 'B'; B.x += 200;
const players = [A, B];
for (let i = 0; i < 8; i++) if (G.addProjectile) G.addProjectile(A.x, A.y, 3, 0, 10, { friendly: true, kind: 'arrow', r: 4, life: 60, style: 'ranged' });

const mapKb = kb(G.maps.overworld);
const wholeStateKb = kb(s);
const snap = minimalSnapshot(s, players);
const snapKb = kb(snap);

const HZ = 20;
const report = {
  world: { enemies: s.enemies.length, projectiles: s.projectiles.length, players: players.length },
  sizes_KB: {
    staticMap_sendOnce: f1(mapKb),
    naiveWholeState: f1(wholeStateKb),
    minimalPerTickSnapshot: f1(snapKb),
  },
  bandwidth_perPlayer: {
    ifWeShippedWholeState: f1(wholeStateKb * HZ) + ' KB/s  (' + f1(wholeStateKb * HZ / 1024) + ' MB/s) — too much',
    minimalSnapshotAt20Hz: f1(snapKb * HZ) + ' KB/s  (' + f1(snapKb * HZ * 8 / 1024) + ' Mbit/s)',
  },
  verdict: snapKb * HZ < 200
    ? 'Fine. Send the static map ONCE on join; broadcast the minimal snapshot each tick.'
    : 'Snapshot larger than expected — trim fields or drop to 15Hz / interest-cull far enemies.',
  note: 'Enemies far off every screen could be interest-culled later; not needed at this size.',
};
console.log('\n' + '='.repeat(74));
console.log('  ELDERMYR — BROADCAST WIRE-COST CHECK (20Hz)');
console.log('='.repeat(74));
console.log(JSON.stringify(report, null, 2));
console.log('-'.repeat(74) + '\n');
