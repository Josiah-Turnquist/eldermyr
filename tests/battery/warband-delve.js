'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// Verification: PER-OWNER warband delving (the ENTERING player's own warband follows them into
// rifts/dungeons; nobody else's warband moves). Boots World like server/index.js, no DB.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game');
const { World } = require(REPO + '/server/world');
const S = G.state;
const TILE = G.TILE || 32;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

const COL = { knight: '#cdd0e6', ranger: '#9bd56a', mage: '#b886ff' };
let _cseq = 0;
function giveComp(p, cls, opts) {
  cls = cls || 'knight';
  const c = {
    name: 'Comp' + (++_cseq), cls, level: 5, alive: true, maxHp: 300, hp: 300, atk: 30, def: 5,
    weapon: null, postedAt: null, x: p.x - 20, y: p.y + 16, w: 22, h: 22, attackCd: 0, hurtCd: 0,
    wobble: 0, color: COL[cls] || '#ccc', ownerId: p.id, map: 'overworld',
  };
  if (opts) Object.assign(c, opts);
  if (!S.companions) S.companions = [];
  S.companions.push(c);
  return c;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function enterViaEntrance(p) {
  const de = S.dungeonEntrance;
  p.inventory.keys = 3;
  p.x = de.tx * TILE + 4; p.y = (de.ty + 1) * TILE + 4;
  p.actions.push('interact');
  w.tick();
}
function findTileXY(md, id) { for (let y = 0; y < md.length; y++) for (let x = 0; x < md[0].length; x++) if (md[y][x] === id) return { x, y }; return null; }
function resetTopside() {
  S.companions = [];
  A.map = 'overworld'; A.dg = null; A.downed = false; A.bleedT = 0; A.hp = A.maxHp;
  w.sharedDg = null; w.dgSpawn = null;
  for (let i = 0; i < 22; i++) w.tick();   // let interactCd (shared, decays 1/tick) clear + world settle
}

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
B.x = A.x + 500; B.y = A.y + 500;                          // far from A: separate buckets, no comp/enemy mingling
for (const p of [A, B]) { p.def = 999999; p.maxHp = 999999; p.hp = 999999; }   // tanky (won't go down unless we force it)
for (let i = 0; i < 8; i++) w.tick();

// ============ SCENARIO 1: ENTRANCE enter — A's warband delves, B's stays topside ============
S.companions = [];
const a1 = giveComp(A, 'knight');
const a2 = giveComp(A, 'ranger');
const b1 = giveComp(B, 'knight');
enterViaEntrance(A);
ok('S1 A entered the dungeon', A.map === 'dungeon' && !!w.sharedDg, 'A.map=' + A.map);
ok("S1 A's knight tagged map='dungeon'", a1.map === 'dungeon', 'a1.map=' + a1.map);
ok("S1 A's ranger tagged map='dungeon'", a2.map === 'dungeon', 'a2.map=' + a2.map);
ok("S1 A's warband near A in dungeon coords", dist(a1, A) < 60 && dist(a2, A) < 60, 'd1=' + Math.round(dist(a1, A)) + ' d2=' + Math.round(dist(a2, A)));
ok("S1 B's knight NOT delving (map stays overworld)", b1.map === 'overworld', 'b1.map=' + b1.map);
ok("S1 B's knight untouched (still near B topside)", dist(b1, B) < 60, 'd=' + Math.round(dist(b1, B)));
{
  const snapA = w.snapshotFor('A'), snapB = w.snapshotFor('B');
  const aIds = new Set(snapA.comps.map((c) => c._cid)), bIds = new Set(snapB.comps.map((c) => c._cid));
  ok("S1 A's snapshot carries A's 2 delving comps", snapA.comps.length === 2 && aIds.has(a1._cid) && aIds.has(a2._cid), 'n=' + snapA.comps.length + ' map=' + snapA.map);
  ok("S1 B's snapshot carries ONLY B's topside comp", snapB.comps.length === 1 && bIds.has(b1._cid), 'n=' + snapB.comps.length + ' map=' + snapB.map);
  ok("S1 A's dungeon comps ABSENT from B's overworld snapshot", !bIds.has(a1._cid) && !bIds.has(a2._cid));
}

// ---- FIGHT: a dungeon foe next to A's knight takes damage / the knight closes in ----
{
  let foe = null; for (let d = 0; d < 12 && !foe; d++) foe = G.makeWildEnemy(Math.floor(A.x / TILE) + 1 + d, Math.floor(A.y / TILE));
  foe.hp = foe.maxHp = 999999; foe.x = a1.x + 26; foe.y = a1.y; foe.holdKey = undefined; foe.raidTown = undefined;
  w.sharedDg.enemies.push(foe);
  const hp0 = foe.hp, d0 = dist(a1, foe);
  for (let i = 0; i < 80; i++) w.tick();
  const d1 = dist(a1, foe);
  ok('S1 companion FIGHTS below (foe damaged OR knight closed distance)', foe.hp < hp0 || d1 < d0, 'foeHp ' + hp0 + '→' + Math.round(foe.hp) + '  dist ' + Math.round(d0) + '→' + Math.round(d1));
}

// ============ SCENARIO 4 (chained): DESCEND one floor — A's warband follows ============
{
  const lvl0 = w.sharedDg.dungeonLevel;
  const dsc = findTileXY(w.sharedDg.md, G.T.D_DESCEND);
  A.x = dsc.x * TILE; A.y = dsc.y * TILE;
  A.actions.push('interact'); w.tick();
  ok('S4 A descended a floor', w.sharedDg && w.sharedDg.dungeonLevel === lvl0 + 1, 'lvl ' + lvl0 + '→' + (w.sharedDg && w.sharedDg.dungeonLevel));
  ok("S4 A's warband followed to the new floor (still map='dungeon', near A)", a1.map === 'dungeon' && a2.map === 'dungeon' && dist(a1, A) < 70 && dist(a2, A) < 70, 'd1=' + Math.round(dist(a1, A)) + ' d2=' + Math.round(dist(a2, A)));
}

// ============ SCENARIO 5: EXIT — A's warband returns topside with them ============
resetTopside();
{
  const e1 = giveComp(A, 'knight'), e2 = giveComp(A, 'mage');
  enterViaEntrance(A);                                     // fresh instance, level 1 (has a ▲ exit)
  ok('S5 A re-entered (fresh instance)', A.map === 'dungeon' && e1.map === 'dungeon' && e2.map === 'dungeon');
  for (let i = 0; i < 22; i++) w.tick();                   // clear interactCd
  const up = findTileXY(w.sharedDg.md, G.T.D_EXIT);
  ok('S5 level-1 floor has an exit tile', !!up);
  A.x = up.x * TILE; A.y = up.y * TILE;
  A.actions.push('interact'); w.tick();
  ok('S5 A exited to the overworld', A.map === 'overworld', 'A.map=' + A.map);
  ok("S5 A's warband returned topside (map='overworld', reunited near A)", e1.map === 'overworld' && e2.map === 'overworld' && dist(e1, A) < 80 && dist(e2, A) < 80, 'd1=' + Math.round(dist(e1, A)) + ' d2=' + Math.round(dist(e2, A)));
  const snapA = w.snapshotFor('A');
  const aIds = new Set(snapA.comps.map((c) => c._cid));
  ok('S5 A now sees its warband topside again', snapA.map === 'overworld' && aIds.has(e1._cid) && aIds.has(e2._cid));
}

// ============ SCENARIO 6: owner DOWNED in the dungeon → bleeds out → comps surface too ============
resetTopside();
{
  const d1 = giveComp(A, 'knight'), d2 = giveComp(A, 'ranger');
  enterViaEntrance(A);
  ok('S6 A delving with 2 comps', A.map === 'dungeon' && d1.map === 'dungeon' && d2.map === 'dungeon');
  let foe = null; for (let k = 0; k < 12 && !foe; k++) foe = G.makeWildEnemy(Math.floor(A.x / TILE) + 1 + k, Math.floor(A.y / TILE));
  foe.hp = foe.maxHp = 999999; foe.x = A.x + 40; foe.y = A.y; w.sharedDg.enemies.push(foe);   // a foe near A → bleed ticks (no self-recover)
  A.hp = 0;                                                // drop A → the dungeon downed-pass will goDown
  w.tick();
  ok('S6 A went DOWNED in the dungeon', A.downed === true, 'downed=' + A.downed);
  A.bleedT = 2;                                            // fast-forward the bleed-out
  for (let i = 0; i < 8; i++) w.tick();
  ok('S6 A bled out and respawned topside', A.map === 'overworld' && !A.downed, 'A.map=' + A.map + ' downed=' + A.downed);
  ok("S6 A's warband surfaced with A (map='overworld', near A at town)", d1.map === 'overworld' && d2.map === 'overworld' && dist(d1, A) < 80 && dist(d2, A) < 80, 'd1=' + Math.round(dist(d1, A)) + ' d2=' + Math.round(dist(d2, A)));
  ok('S6 no companion stranded tagged dungeon', !(S.companions || []).some((c) => c.map === 'dungeon'));
}

// ============ SCENARIO 2: RIFT breach — the breacher's warband dives too ============
resetTopside();
{
  const r1 = giveComp(A, 'knight'), r2 = giveComp(A, 'ranger');
  const rb = giveComp(B, 'mage');                          // B's comp must not be dragged into A's rift
  A.inventory.keys = 2;
  w.rift = { x: A.x, y: A.y, deep: 4, party: false, expires: S.time + 2400, n: 99 };
  w.sharedDg = null; w.dgSpawn = null;
  w._enterRift(A);
  ok('S2 A breached the rift into the deep', A.map === 'dungeon' && !!w.sharedDg, 'A.map=' + A.map);
  ok("S2 A's warband dived with them (map='dungeon', near A)", r1.map === 'dungeon' && r2.map === 'dungeon' && dist(r1, A) < 60 && dist(r2, A) < 60, 'd1=' + Math.round(dist(r1, A)) + ' d2=' + Math.round(dist(r2, A)));
  ok("S2 B's comp stayed topside (map='overworld')", rb.map === 'overworld', 'rb.map=' + rb.map);
  const snapA = w.snapshotFor('A'), snapB = w.snapshotFor('B');
  const aIds = new Set(snapA.comps.map((c) => c._cid)), bIds = new Set(snapB.comps.map((c) => c._cid));
  ok("S2 A's snapshot shows A's diving warband", aIds.has(r1._cid) && aIds.has(r2._cid) && snapA.map === 'dungeon');
  ok("S2 B's snapshot excludes A's rift comps", !bIds.has(r1._cid) && !bIds.has(r2._cid));
}

// ============ SCENARIO 7: a GARRISONED (posted) companion never delves ============
resetTopside();
{
  const posted = giveComp(A, 'knight', { postedAt: 0 });   // stationed at outpost 0
  const roamer = giveComp(A, 'ranger');
  enterViaEntrance(A);
  ok('S7 A delving; the un-posted roamer follows', A.map === 'dungeon' && roamer.map === 'dungeon');
  ok("S7 the GARRISONED comp stays topside (map!='dungeon', postedAt kept)", posted.map !== 'dungeon' && posted.postedAt === 0, 'map=' + posted.map + ' postedAt=' + posted.postedAt);
  const snapA = w.snapshotFor('A');
  const aIds = new Set(snapA.comps.map((c) => c._cid));
  ok('S7 the garrisoned comp is NOT in the delver snapshot', !aIds.has(posted._cid) && aIds.has(roamer._cid));
  // descend a floor: garrison STILL topside
  for (let i = 0; i < 22; i++) w.tick();
  const dsc = findTileXY(w.sharedDg.md, G.T.D_DESCEND);
  A.x = dsc.x * TILE; A.y = dsc.y * TILE; A.actions.push('interact'); w.tick();
  ok('S7 garrison unmoved through a descend', posted.map !== 'dungeon' && posted.postedAt === 0);
}

// ============ SCENARIO 8: owner DISCONNECTS mid-delve → no stranded dungeon comp ============
resetTopside();
{
  const g1 = giveComp(A, 'knight'), g2 = giveComp(A, 'mage');
  const bKeep = giveComp(B, 'ranger');
  enterViaEntrance(A);
  ok('S8 A delving with a warband', A.map === 'dungeon' && g1.map === 'dungeon' && g2.map === 'dungeon');
  w.removePlayer('A');                                     // A drops connection while below
  w.tick();
  ok("S8 A's recruits spliced out on disconnect (none remain owned by A)", !(S.companions || []).some((c) => c.ownerId === 'A'));
  ok('S8 no companion left stranded tagged dungeon', !(S.companions || []).some((c) => c.map === 'dungeon'));
  ok('S8 shared dungeon instance dissolved (last delver gone)', w.sharedDg === null);
  ok("S8 B's own recruit is intact and topside", (S.companions || []).includes(bKeep) && bKeep.map === 'overworld');
  let err = null; try { for (let i = 0; i < 20; i++) w.tick(); } catch (e) { err = String(e && e.message); }
  ok('S8 room keeps ticking cleanly after the disconnect', err === null, err || '');
}

// ============ SCENARIO 9: TWO co-delvers — one descends, BOTH warbands ride down ============
// Fresh registered players (S8 removed A; and we need two clean co-delvers in the room).
{
  S.companions = [];
  const P = w.addPlayer('P', 'Pip'), Q = w.addPlayer('Q', 'Quin');
  for (const p of [P, Q]) { p.def = 999999; p.maxHp = 999999; p.hp = 999999; p.map = 'overworld'; }
  for (let i = 0; i < 22; i++) w.tick();
  const p1 = giveComp(P, 'knight'), q1 = giveComp(Q, 'ranger'), q2 = giveComp(Q, 'mage');
  const de = S.dungeonEntrance;
  // P creates the shared instance
  P.inventory.keys = 3; P.x = de.tx * TILE + 4; P.y = (de.ty + 1) * TILE + 4;
  P.actions.push('interact'); w.tick();
  ok('S9 P opened the shared delve', P.map === 'dungeon' && !!w.sharedDg && p1.map === 'dungeon', 'P.map=' + P.map);
  for (let i = 0; i < 22; i++) w.tick();                   // clear shared interactCd
  // Q joins the SAME instance from the same entrance
  Q.inventory.keys = 3; Q.x = de.tx * TILE + 4; Q.y = (de.ty + 1) * TILE + 4;
  Q.actions.push('interact'); w.tick();
  ok('S9 Q joined the same instance', Q.map === 'dungeon' && q1.map === 'dungeon' && q2.map === 'dungeon', 'Q.map=' + Q.map);
  for (let i = 0; i < 22; i++) w.tick();
  // P descends → Q is a co-delver dragged to the new floor; Q's warband must ride down too
  const lvl0 = w.sharedDg.dungeonLevel;
  const dsc = findTileXY(w.sharedDg.md, G.T.D_DESCEND);
  P.x = dsc.x * TILE; P.y = dsc.y * TILE; P.actions.push('interact'); w.tick();
  ok('S9 floor advanced for the party', w.sharedDg.dungeonLevel === lvl0 + 1, 'lvl ' + lvl0 + '→' + w.sharedDg.dungeonLevel);
  ok('S9 co-delver Q was pulled to the new floor', Q.map === 'dungeon' && dist(Q, P) < 60, 'dist(Q,P)=' + Math.round(dist(Q, P)));
  ok("S9 Q's warband rode down WITH Q (map='dungeon', near Q on the new floor)", q1.map === 'dungeon' && q2.map === 'dungeon' && dist(q1, Q) < 70 && dist(q2, Q) < 70, 'd1=' + Math.round(dist(q1, Q)) + ' d2=' + Math.round(dist(q2, Q)));
  ok("S9 P's own warband also on the new floor", p1.map === 'dungeon' && dist(p1, P) < 70, 'd=' + Math.round(dist(p1, P)));
  const snapQ = w.snapshotFor('Q');
  const qIds = new Set(snapQ.comps.map((c) => c._cid));
  // co-op: co-delvers stand together, so Q sees the whole shared-floor warband (its own + P's) by interest-culling —
  // the same way it sees teammates topside. The point is Q's OWN warband is present and it's all map==='dungeon'.
  ok("S9 Q's snapshot carries Q's warband below (co-op sees the shared floor)", snapQ.map === 'dungeon' && qIds.has(q1._cid) && qIds.has(q2._cid) && snapQ.comps.every((c) => c.alive), 'n=' + snapQ.comps.length + ' (own q1,q2 + co-located p1)');
}

console.log('\n' + out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
