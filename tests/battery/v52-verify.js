'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// v2.52.0 batch verification: (1) S._partyN + warlord atk, (2) rift depth, (4) ally _aid in snapshot
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server-spike/load-game.js');
const { World } = require(REPO + '/server/world.js');
const S = G.state;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
const C = w.addPlayer('C', 'Cy');
B.x = A.x + 300; B.y = A.y + 300; C.x = A.x - 300; C.y = A.y + 300;
for (const p of [A, B, C]) { p.def = 999999; p.maxHp = 999999; p.hp = 999999; }
for (let i = 0; i < 8; i++) w.tick();

// ===================== ITEM 1a: S._partyN =====================
out.push('\n--- ITEM 1a: S._partyN ---');
ok('boot 3 players -> _partyN === 3', S._partyN === 3, 'S._partyN=' + S._partyN);
w.removePlayer('C');
w.tick();
ok('drop one -> _partyN === 2', S._partyN === 2, 'S._partyN=' + S._partyN);
w.addPlayer('D', 'Di'); w.tick();
ok('add one -> _partyN === 3', S._partyN === 3, 'S._partyN=' + S._partyN);

// ===================== ITEM 1b: warlord atk scaling =====================
out.push('\n--- ITEM 1b: warlord atk from _baseAtk (full boost, idempotent) ---');
const mkWL = () => ({ warlordRef: { level: 3, rank: 1 }, maxHp: 100, hp: 100, atk: 20, def: 5, x: 1000, y: 1000, w: 24, h: 24 });
// idempotency: rescale twice at one level -> identical atk & hp
{
  S.enemies = [mkWL()]; const e = S.enemies[0];
  w._rescaleThreats(10); const a1 = e.atk, h1 = e.maxHp;
  w._rescaleThreats(10); const a2 = e.atk, h2 = e.maxHp;
  ok('idempotent atk at lvl10 (twice = identical)', a1 === a2, a1 + ' == ' + a2);
  ok('idempotent maxHp at lvl10 (twice = identical)', h1 === h2, h1 + ' == ' + h2);
}
// growth: fresh warlord (base 100hp/20atk, warlordRef level3 rank1) rescaled at each level
out.push('  lvl | boost | base_atk | OLD_atk(x0.6) | NEW_atk(xboost) | maxHp');
let prevAtk = 0, mono = true;
for (const lvl of [5, 10, 15, 20, 25]) {
  S.enemies = [mkWL()]; const e = S.enemies[0];
  w._rescaleThreats(lvl);
  const boost = Math.max(1, (lvl + 1) / 3);
  const oldAtk = Math.round(20 * (1 + (boost - 1) * 0.6));
  out.push('  ' + String(lvl).padStart(3) + ' | ' + boost.toFixed(2) + ' | ' + String(20).padStart(8) + ' | ' + String(oldAtk).padStart(13) + ' | ' + String(e.atk).padStart(15) + ' | ' + e.maxHp);
  if (e.atk < prevAtk) mono = false;
  prevAtk = e.atk;
}
{
  S.enemies = [mkWL()]; const e5 = S.enemies[0]; w._rescaleThreats(5); const atk5 = e5.atk;
  S.enemies = [mkWL()]; const e25 = S.enemies[0]; w._rescaleThreats(25); const atk25 = e25.atk;
  ok('atk grows 5 -> 25 (meaningfully above base 20)', atk25 > atk5 && atk25 > 20 * 3, 'atk5=' + atk5 + ' atk25=' + atk25 + ' base=20');
  ok('atk monotonic non-decreasing across levels', mono, '');
  // consistency with HP boost: at lvl25, atk multiple should equal hp multiple (both x boost)
  const boost25 = Math.max(1, (25 + 1) / 3);
  ok('atk uses SAME boost as HP (atk == round(base*boost))', atk25 === Math.round(20 * boost25), 'atk25=' + atk25 + ' round(20*' + boost25.toFixed(2) + ')=' + Math.round(20 * boost25));
}

// ===================== ITEM 2: rift depth scales with party level =====================
out.push('\n--- ITEM 2: rift depth window scales with party level ---');
// keep only overworld players present (A,B,D exist; ensure overworld + not downed)
for (const id of ['A', 'B', 'D']) { const p = w.players.get(id); if (p) { p.map = 'overworld'; p.downed = false; } }
function forceRifts(plvl, n) {
  S._partyLevel = plvl;
  const all = [], solo = [], party = [];
  for (let i = 0; i < n; i++) {
    w.rift = null; w.sharedDg = null; w._riftCd = 0;
    w._maybeRift();
    if (w.rift) { all.push(w.rift.deep); (w.rift.party ? party : solo).push(w.rift.deep); }
  }
  const stats = (arr) => arr.length ? { min: Math.min(...arr), max: Math.max(...arr), mean: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2), n: arr.length } : { n: 0 };
  return { all: stats(all), solo: stats(solo), party: stats(party) };
}
const windows = { 3: [3, 7], 12: [6, 10], 25: [9, 13] };   // stated OVERALL windows (solo..party inclusive)
const means = {};
for (const plvl of [3, 12, 25]) {
  const r = forceRifts(plvl, 600);
  means[plvl] = r.all.mean;
  const [lo, hi] = windows[plvl];
  out.push('  plvl ' + String(plvl).padStart(2) + ': all[' + r.all.min + '-' + r.all.max + '] mean=' + r.all.mean +
    ' | solo[' + (r.solo.min || '-') + '-' + (r.solo.max || '-') + '] mean=' + (r.solo.mean || '-') +
    ' | party[' + (r.party.min || '-') + '-' + (r.party.max || '-') + '] mean=' + (r.party.mean || '-') + ' (n=' + r.all.n + ')');
  ok('plvl ' + plvl + ': all rifts opened (n>0)', r.all.n > 0, 'n=' + r.all.n);
  ok('plvl ' + plvl + ': all depths within stated window [' + lo + '-' + hi + ']', r.all.min >= lo && r.all.max <= hi, r.all.min + '-' + r.all.max);
  ok('plvl ' + plvl + ': party mean > solo mean (party sits deeper)', r.party.mean > r.solo.mean, 'party=' + r.party.mean + ' solo=' + r.solo.mean);
}
ok('depth mean monotonic (3 < 12 < 25)', means[3] < means[12] && means[12] < means[25], means[3] + ' < ' + means[12] + ' < ' + means[25]);

// snapshot payload carries the SCALED depth
{
  S._partyLevel = 25;
  const A2 = w.players.get('A'); A2.map = 'overworld'; A2.downed = false;
  let tries = 0; do { w.rift = null; w.sharedDg = null; w._riftCd = 0; w._maybeRift(); tries++; } while (!w.rift && tries < 200);
  ok('forced a rift for snapshot test', !!w.rift, 'deep=' + (w.rift && w.rift.deep));
  if (w.rift) {
    // place the rift right on A so interest-cull includes it
    w.rift.x = A2.x; w.rift.y = A2.y;
    const snap = JSON.parse(JSON.stringify(w.snapshotFor('A')));
    ok('snapshot.rift present (near player)', !!snap.rift, 'rift=' + JSON.stringify(snap.rift));
    ok('snapshot.rift.deep === live scaled rift.deep', snap.rift && snap.rift.deep === w.rift.deep, 'snap=' + (snap.rift && snap.rift.deep) + ' live=' + w.rift.deep);
    ok('snapshot rift depth is scaled (>=9 at plvl25)', snap.rift && snap.rift.deep >= 9, 'deep=' + (snap.rift && snap.rift.deep));
  }
}

// ===================== ITEM 4: ally _aid survives serialization =====================
out.push('\n--- ITEM 4: ally _aid in serialized snapshot ---');
{
  const A3 = w.players.get('A'); A3.map = 'overworld';
  S.allies = S.allies || [];
  const ally = { name: 'Thrall', x: A3.x + 40, y: A3.y + 40, w: 24, h: 24, hp: 50, maxHp: 50, _owner: 'A', bound: true };
  S.allies.push(ally);
  const snap = JSON.parse(JSON.stringify(w.snapshotFor('A')));
  const sa = (snap.allies || []).find((x) => x.name === 'Thrall');
  ok('ally present in serialized snapshot.allies', !!sa, 'allies.len=' + (snap.allies || []).length);
  ok('ally _aid is a number after JSON round-trip', sa && typeof sa._aid === 'number', '_aid=' + (sa && sa._aid));
  ok('ally.name is a string (drawAlly-safe)', sa && typeof sa.name === 'string', 'name=' + (sa && sa.name));
}

console.log(out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
