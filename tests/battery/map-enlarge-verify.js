'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// map-enlarge-verify.js — proves the 248x208 -> 347x291 overworld resize is VALID:
// every fixed site non-solid + reachable, correct tier, kraken ring sealed (fly-only),
// no site in the ocean, leviathan==islands[0], POIs/entities placed, ticks clean, save-compat.
const fs = require('fs');
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server-spike/load-game.js');
const T = G.TILE;

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; fails.push(name + (extra != null ? '  [' + extra + ']' : '')); }
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra != null ? '   [' + extra + ']' : '')); }

// ---- HOLD_SITES is a lexical const not in CAPTURE — extract it from source (verifies the real values) ----
const html = fs.readFileSync(REPO + '/eldermyr-rpg.html', 'utf8');
const holdSrc = html.match(/const HOLD_SITES=\[[^\]]*\];/)[0];
// eslint-disable-next-line no-new-func
const HOLD_SITES = (new Function('return ' + holdSrc.replace(/^const HOLD_SITES=/, '').replace(/;$/, '')))();

// ---- boot the SP game ----
let bootErr = null; try { G.startGame(); } catch (e) { bootErr = String(e && e.stack || e); }
ok('startGame() did not throw', !bootErr, bootErr);

const S = G.state, M = G.maps.overworld, SOLID = G.SOLID, TT = G.T;
const OW_W = G.OW_W, OW_H = G.OW_H;
const tile = (x, y) => (M[y] && M[y][x] !== undefined) ? M[y][x] : -1;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < OW_W && y < OW_H;

// ---- independent reachability BFS from town-0 center (replicates computeReachableOW: 4-neigh over non-SOLID) ----
const townZones = G.getTownZones();
const tc = (tz) => ({ x: tz.x + Math.floor(tz.w / 2), y: tz.y + Math.floor(tz.h / 2) });
const c0 = tc(townZones[0]);
function bfs(sx, sy) {
  const seen = new Set([sx + ',' + sy]); const st = [[sx, sy]];
  while (st.length) { const [x, y] = st.pop();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inBounds(nx, ny)) continue; if (SOLID.has(M[ny][nx])) continue;
      const k = nx + ',' + ny; if (seen.has(k)) continue; seen.add(k); st.push([nx, ny]); } }
  return seen;
}
const reach = bfs(c0.x, c0.y);
const isReach = (x, y) => reach.has(x + ',' + y);
const tierOf = (x, y) => { const d = G.distFactor(x, y); return d < 0.3 ? 0 : (d < 0.55 ? 1 : 2); };

// ===================== 1) DIMENSIONS =====================
ok('OW_W === 347', OW_W === 347, OW_W);
ok('OW_H === 291', OW_H === 291, OW_H);
ok('maps.overworld rows === 291', M.length === 291, M.length);
ok('maps.overworld cols === 347', M[0].length === 347, M[0].length);

// ===================== 2) TOWNS =====================
const EXP_TOWNS = { Eldermyr: [151, 127], Northwatch: [125, 48], Eastgate: [220, 137], Frostspire: [237, 48], Southreach: [260, 214], Westhaven: [46, 154] };
for (const tz of townZones) {
  const exp = EXP_TOWNS[tz.name];
  ok('town ' + tz.name + ' at expected (x,y)', exp && tz.x === exp[0] && tz.y === exp[1], tz.x + ',' + tz.y);
  const c = tc(tz);
  ok('town ' + tz.name + ' center in-bounds', inBounds(c.x, c.y), c.x + ',' + c.y);
  ok('town ' + tz.name + ' center non-solid', !SOLID.has(tile(c.x, c.y)), 'tile=' + tile(c.x, c.y));
  ok('town ' + tz.name + ' center reachable', isReach(c.x, c.y));
  // whole AABB in bounds
  ok('town ' + tz.name + ' AABB in-bounds', tz.x >= 1 && tz.y >= 1 && tz.x + tz.w < OW_W - 1 && tz.y + tz.h < OW_H - 1);
}
ok('Eldermyr (town 0) is tier 0', tierOf(c0.x, c0.y) === 0, 'tier=' + tierOf(c0.x, c0.y) + ' df=' + G.distFactor(c0.x, c0.y).toFixed(3));
// no two town AABBs overlap (with the 1-tile grass halo the gen carves)
for (let i = 0; i < townZones.length; i++) for (let j = i + 1; j < townZones.length; j++) {
  const a = townZones[i], b = townZones[j];
  const overlap = a.x - 1 < b.x + b.w + 1 && b.x - 1 < a.x + a.w + 1 && a.y - 1 < b.y + b.h + 1 && b.y - 1 < a.y + a.h + 1;
  ok('town AABB ' + a.name + ' vs ' + b.name + ' disjoint', !overlap);
}

// ===================== 3) DUNGEON ENTRANCE =====================
const de = S.dungeonEntrance;
ok('dungeonEntrance at (168,196)', de.tx === 168 && de.ty === 196, de.tx + ',' + de.ty);
ok('dungeonEntrance tile is DUNGEON_ENTRANCE type', tile(de.tx, de.ty) === TT.DUNGEON_ENTRANCE, 'tile=' + tile(de.tx, de.ty));
ok('dungeonEntrance reachable', isReach(de.tx, de.ty));

// ===================== 4) HOLD SITES =====================
const EXP_HOLD = { 'Hawthorn Vale': [106, 84], 'Ironford': [269, 112], 'Mossbridge': [154, 246] };
ok('HOLD_SITES count === 3', HOLD_SITES.length === 3, HOLD_SITES.length);
for (const h of HOLD_SITES) {
  const e = EXP_HOLD[h.name];
  ok('hold ' + h.name + ' at expected', e && h.tx === e[0] && h.ty === e[1], h.tx + ',' + h.ty);
  ok('hold ' + h.name + ' in-bounds', inBounds(h.tx, h.ty));
  ok('hold ' + h.name + ' non-solid', !SOLID.has(tile(h.tx, h.ty)), 'tile=' + tile(h.tx, h.ty));
  ok('hold ' + h.name + ' reachable', isReach(h.tx, h.ty));
}

// ===================== 5) DRAGON LAIR =====================
const dl = S.dragonLair;
ok('dragonLair at (280,235)', dl.tx === 280 && dl.ty === 235, dl.tx + ',' + dl.ty);
ok('dragonLair in-bounds', inBounds(dl.tx, dl.ty));
ok('dragonLair center non-solid', !SOLID.has(tile(dl.tx, dl.ty)));
ok('dragonLair center reachable', isReach(dl.tx, dl.ty));
let clearGrass = true, clearBad = null;
for (let y = dl.ty - 4; y <= dl.ty + 4; y++) for (let x = dl.tx - 4; x <= dl.tx + 4; x++) {
  if (x < 1 || y < 1 || x >= OW_W - 1 || y >= OW_H - 1) continue;
  // clearing turned SOLID tiles to grass; non-solid non-grass (path/flower) may remain if pre-existing — assert NOT solid
  if (SOLID.has(tile(x, y))) { clearGrass = false; clearBad = x + ',' + y + '=' + tile(x, y); }
}
ok('dragonLair ±4 clearing has no solid tiles', clearGrass, clearBad);

// ===================== 6) KRAKEN ARENA (fly-only) =====================
const ka = S.krakenArena;
ok('krakenArena at (62,230)', ka.tx === 62 && ka.ty === 230, ka.tx + ',' + ka.ty);
ok('krakenArena center is GRASS', tile(ka.tx, ka.ty) === TT.GRASS, 'tile=' + tile(ka.tx, ka.ty));
ok('krakenArena center NOT reachable on foot (fly-only)', !isReach(ka.tx, ka.ty));
let ringClosed = true, ringBad = null;
for (let y = ka.ty - 6; y <= ka.ty + 6; y++) for (let x = ka.tx - 6; x <= ka.tx + 6; x++) {
  const d = Math.max(Math.abs(x - ka.tx), Math.abs(y - ka.ty));
  if (d === 5) { if (tile(x, y) !== TT.MOUNTAIN) { ringClosed = false; ringBad = x + ',' + y + '=' + tile(x, y); } }
}
ok('krakenArena Chebyshev-5 ring is fully MOUNTAIN (sealed)', ringClosed, ringBad);
// interior (d<=4) is grass
let kInterior = true;
for (let y = ka.ty - 4; y <= ka.ty + 4; y++) for (let x = ka.tx - 4; x <= ka.tx + 4; x++) {
  if (Math.max(Math.abs(x - ka.tx), Math.abs(y - ka.ty)) <= 4 && tile(x, y) !== TT.GRASS) kInterior = false;
}
ok('krakenArena interior (d<=4) all GRASS', kInterior);

// ===================== 7) OCEAN + ISLANDS =====================
const oc = S.ocean;
ok('ocean rect === (87,182,132,235)', oc.x0 === 87 && oc.y0 === 182 && oc.x1 === 132 && oc.y1 === 235, [oc.x0, oc.y0, oc.x1, oc.y1].join(','));
const islands = S.islands;
ok('islands === [(104,199),(120,221)]', islands[0].x === 104 && islands[0].y === 199 && islands[1].x === 120 && islands[1].y === 221, JSON.stringify(islands));
const nearIsland = (x, y) => islands.some(is => Math.hypot(x - is.x, y - is.y) <= 4.3);
// every rect tile is WATER unless within an island disk (then GRASS)
let oceanWater = true, oceanBad = null, islGrass = true;
for (let y = oc.y0; y <= oc.y1; y++) for (let x = oc.x0; x <= oc.x1; x++) {
  if (nearIsland(x, y)) { if (tile(x, y) !== TT.GRASS) islGrass = false; }
  else if (tile(x, y) !== TT.WATER) { oceanWater = false; oceanBad = x + ',' + y + '=' + tile(x, y); }
}
ok('ocean interior (non-island) all WATER', oceanWater, oceanBad);
ok('island disks are GRASS', islGrass);
for (const is of islands) {
  ok('island (' + is.x + ',' + is.y + ') center GRASS', tile(is.x, is.y) === TT.GRASS, 'tile=' + tile(is.x, is.y));
  ok('island (' + is.x + ',' + is.y + ') inside ocean rect', is.x >= oc.x0 && is.x <= oc.x1 && is.y >= oc.y0 && is.y <= oc.y1);
}
// NO town/hold/dragon/dungeon center inside ocean rect
const inRect = (x, y) => x >= oc.x0 && x <= oc.x1 && y >= oc.y0 && y <= oc.y1;
for (const tz of townZones) { const c = tc(tz); ok('town ' + tz.name + ' center NOT in ocean', !inRect(c.x, c.y), c.x + ',' + c.y); }
for (const h of HOLD_SITES) ok('hold ' + h.name + ' NOT in ocean', !inRect(h.tx, h.ty), h.tx + ',' + h.ty);
ok('dragonLair NOT in ocean', !inRect(dl.tx, dl.ty));
ok('dungeonEntrance NOT in ocean', !inRect(de.tx, de.ty));

// ===================== 8) GREAT HUNTS =====================
const GH = G.GREAT_HUNTS;
const EXP_LAIR = { frosttitan: [174, 17], stormroc: [269, 84], emberhorn: [269, 241], leviathan: [104, 199] };
for (const h of GH) {
  const e = EXP_LAIR[h.key];
  ok('hunt ' + h.key + ' lair at expected', e && h.lair.tx === e[0] && h.lair.ty === e[1], h.lair.tx + ',' + h.lair.ty);
  ok('hunt ' + h.key + ' lair in-bounds', inBounds(h.lair.tx, h.lair.ty));
  if (h.island) {
    ok('hunt ' + h.key + ' lair === islands[0]', h.lair.tx === islands[0].x && h.lair.ty === islands[0].y);
    ok('hunt ' + h.key + ' lair is GRASS', tile(h.lair.tx, h.lair.ty) === TT.GRASS, 'tile=' + tile(h.lair.tx, h.lair.ty));
  } else {
    // near reachable land: some non-solid reachable tile within radius 10
    let near = false;
    for (let r = 0; r <= 10 && !near; r++) for (let dy = -r; dy <= r && !near; dy++) for (let dx = -r; dx <= r && !near; dx++) {
      const x = h.lair.tx + dx, y = h.lair.ty + dy; if (inBounds(x, y) && !SOLID.has(tile(x, y)) && isReach(x, y)) near = true;
    }
    ok('hunt ' + h.key + ' lair near reachable land (r<=10)', near);
  }
}

// ===================== 9) ENTITIES CREATED AT SITES =====================
ok('wild dragon spawned at lair', S.enemies.some(e => e.isWildDragon && Math.abs(e.x / T - dl.tx) < 2 && Math.abs(e.y / T - dl.ty) < 2));
ok('kraken spawned at arena', S.enemies.some(e => (e.isKraken || /kraken/i.test(e.name || '')) && Math.abs(e.x / T - ka.tx) < 3));
const beasts = S.enemies.filter(e => e.isGreatBeast);
ok('4 great beasts spawned', beasts.length === 4, beasts.length);
// leviathan beast sits on the isle
const lev = beasts.find(e => e.huntKey === 'leviathan');
ok('leviathan beast on islands[0] tile', lev && Math.abs(lev.x / T + 12 / T - islands[0].x) < 3, lev ? (lev.x / T).toFixed(1) : 'none');

// ===================== 10) POIs =====================
ok('pois exist', Array.isArray(S.pois) && S.pois.length > 0, S.pois && S.pois.length);
ok('pois count === 10 (6 camps + 4 keeps)', S.pois.length === 10, S.pois.length);
for (const p of S.pois) {
  ok('poi ' + p.key + '(' + p.kind + ') in-bounds', inBounds(p.tx, p.ty), p.tx + ',' + p.ty);
  ok('poi ' + p.key + ' non-solid', !SOLID.has(tile(p.tx, p.ty)));
  ok('poi ' + p.key + ' reachable', isReach(p.tx, p.ty));
  ok('poi ' + p.key + ' not in a town', !townZones.some(tz => p.tx >= tz.x - 1 && p.tx < tz.x + tz.w + 1 && p.ty >= tz.y - 1 && p.ty < tz.y + tz.h + 1));
}

// ===================== 11) SCATTER IN BOUNDS =====================
const scatterOK = (arr, name) => { let bad = null; const good = arr.every(o => { const x = Math.floor((o.x + (o.w || 0) / 2) / T), y = Math.floor((o.y + (o.h || 0) / 2) / T); if (!inBounds(x, y)) { bad = x + ',' + y; return false; } return true; }); ok(name + ' all in-bounds', good, bad); };
scatterOK(S.pickups, 'pickups');
scatterOK(S.enemies, 'enemies');
scatterOK(S.npcs, 'npcs');
if (S.shrines) scatterOK(S.shrines, 'shrines');
if (S.loreStones) scatterOK(S.loreStones, 'loreStones');

// ===================== 12) SAVE-COMPAT (old-frame snapshot) =====================
let scErr = null, playerAtC0 = false, holdIdx = false, snapNoXY = false, noOOB = false;
try {
  // a real old save carries the ancient quest set (key/talk/…) — capture the live one (complete) so the
  // wayfinder's currentObjective (reads q.key.hidden, not backfilled by applySnapshot) stays valid.
  const savedQuests = JSON.parse(JSON.stringify(S.quests));
  const oldSnap = {
    v: 5,
    player: { hp: 44, maxHp: 44, xp: 3, xpNext: 20, level: 1, gold: 25, speed: 1.6, atkHaste: 0, energy: 100, maxEnergy: 100, skillPoints: 0, bonusAtk: 0, bonusDef: 0, abilities: {}, prof: { melee: { lvl: 1, xp: 0, next: 12 }, ranged: { lvl: 1, xp: 0, next: 12 }, magic: { lvl: 1, xp: 0, next: 12 } } }, // NOTE: no x, no y (old frame)
    inventory: { weapons: [], armor: [] },
    quests: savedQuests,
    flags: {},
    dungeonLevel: 0, maxDepth: 0, map: 'overworld',
    holdings: [ { liberated: true, built: true, level: 2 }, { liberated: false, built: false, level: 1 }, { liberated: true, built: false, level: 1 } ], // 3-index, pre-widening
    // everything else omitted -> applySnapshot defaults it
  };
  G.applySnapshot(oldSnap);           // must not throw
  G.setupOverworld();                 // real load path: startLoaded places player at town-0 center
  const p = S.player;
  const nc0 = tc(G.getTownZones()[0]);
  playerAtC0 = Math.abs(p.x - nc0.x * T) < 1 && Math.abs(p.y - nc0.y * T) < 1;
  noOOB = p.x >= 0 && p.y >= 0 && p.x < OW_W * T && p.y < OW_H * T;
  holdIdx = S.holdings.length === 3 && S.holdings[0].liberated === true && S.holdings[0].level === 2 && S.holdings[1].liberated === false && S.holdings[2].liberated === true;
  const s2 = G.snapshot();
  snapNoXY = !('x' in s2.player) && !('y' in s2.player);
} catch (e) { scErr = String(e && e.stack || e); }
ok('save-compat applySnapshot+load did not throw', !scErr, scErr);
ok('save-compat player ends at scaled town-0 center', playerAtC0, S.player.x / T + ',' + S.player.y / T);
ok('save-compat player not OOB', noOOB);
ok('save-compat holdings map by index (len 3, [0]lib+lvl2,[1]!lib,[2]lib)', holdIdx, JSON.stringify(S.holdings.map(h => [h.liberated, h.level])));
ok('snapshot() output still has NO x/y', snapNoXY);

console.log('\n==== map-enlarge-verify: ' + pass + ' passed, ' + fail + ' failed ====');
if (fail) { console.log('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }
