'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// Verification for the per-player-state fixes in server/world.js (+ client adopt shapes).
// Mimics how server/index.js boots the World; no DB.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server-spike/load-game');   // same module instance world.js uses (require cache)
const { World } = require(REPO + '/server/world');
const S = G.state;
const TILE = G.TILE || 32;

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra) { (cond ? pass++ : fail++); results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra != null ? '  [' + extra + ']' : '')); }

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');

// ---------------------------------------------------------------------------
// FIX 1 — lastRestDay is PLAYER-NATIVE (P2/S7; history: as a root key it was once
// omitted from writeBackPP → resting never persisted, then mirrored for a release,
// and the key now lives on state.player so the stomp machinery is simply gone)
// ---------------------------------------------------------------------------
{
  A.lastRestDay = 1; B.lastRestDay = 1;
  // emulate a rest during A's slice: a monkey-patched updatePlayer stamps state.player.lastRestDay
  // while S.player===A — the exact write shape the game uses post-S7 (doCamp/updateFatigue write p).
  // Pre-S7 this FAILS: writeBackPP copied the untouched root S.lastRestDay back OVER A's stamp
  // (seen failing against the pre-S7 tree — the stomp the retirement removes). B must stay untouched.
  const origUP = G.updatePlayer;
  let restedTo = null;
  G.updatePlayer = function () { if (S.player === A) { restedTo = S.player.lastRestDay = (G.curDay ? G.curDay() : 1) + 3; } return origUP.apply(this, arguments); };
  w.tick();
  G.updatePlayer = origUP;
  ok('FIX1 rest stamped during A\'s slice STICKS on A (player-native — no writeback stomp)', A.lastRestDay === restedTo && restedTo != null, 'A.lastRestDay=' + A.lastRestDay + ' expected=' + restedTo);
  ok('FIX1 B.lastRestDay untouched by A rest', B.lastRestDay !== restedTo, 'B.lastRestDay=' + B.lastRestDay);
}
// camp path: doCamp RPC records the rest on the acting hero.
{
  S.enemies.length = 0;                       // camp refuses with foes within 210px
  A.map = 'overworld'; A.lastRestDay = 1; A._exWas = true;
  A.actions.push({ rpc: 'doCamp', args: [] });
  w.tick();
  ok('FIX1 camp path set A.lastRestDay to curDay', A.lastRestDay === (G.curDay ? G.curDay() : 1) && A._exWas === false, 'A.lastRestDay=' + A.lastRestDay + ' curDay=' + G.curDay());
}

// ---------------------------------------------------------------------------
// FIX 2 — sailing / dragon are PER-PLAYER (no leak across slices) + reach the client
// (P2/S10: they live ON state.player now — the rotation's S.player pin IS the swap, so the
//  game must see each hero's OWN boat/flight through the pin, and root ghosts must not exist.)
// ---------------------------------------------------------------------------
{
  A.sailing = true; A.dragon.mounted = true;
  B.sailing = false; B.dragon.mounted = false;
  const seenSail = {}, seenMount = {};
  const origUP = G.updatePlayer;
  G.updatePlayer = function () { if (S.player) { seenSail[S.player.id] = S.player.sailing; seenMount[S.player.id] = !!(S.player.dragon && S.player.dragon.mounted); } return origUP.apply(this, arguments); };
  w.tick();
  G.updatePlayer = origUP;
  ok("FIX2 A's slice sees his own sailing=true through the pin", seenSail.A === true, 'seenSail.A=' + seenSail.A);
  ok("FIX2 B's slice does NOT inherit sailing (no water-walk leak)", seenSail.B === false, 'seenSail.B=' + seenSail.B);
  ok("FIX2 A's slice sees his own dragon.mounted=true through the pin", seenMount.A === true, 'seenMount.A=' + seenMount.A);
  ok("FIX2 B's slice does NOT inherit flight (no fly-collision leak)", seenMount.B === false, 'seenMount.B=' + seenMount.B);
  ok('FIX2 sailing persisted on A after tick', A.sailing === true, 'A.sailing=' + A.sailing);
  ok('FIX2 mounted persisted on A after tick', A.dragon.mounted === true, 'A.dragon.mounted=' + A.dragon.mounted);
  ok('FIX2 no root ghosts: state.sailing/state.dragon retired with the PP swap (P2/S10)',
    !('sailing' in S) && !('dragon' in S), 'sailing in S=' + ('sailing' in S) + ' dragon in S=' + ('dragon' in S));

  const snapA = JSON.parse(JSON.stringify(w.snapshotFor('A')));
  const snapB = JSON.parse(JSON.stringify(w.snapshotFor('B')));
  ok('FIX2 snapA.me.sailing === true (serialized)', snapA.me.sailing === true, 'got ' + snapA.me.sailing);
  ok('FIX2 snapA.me.dragon.mounted === true (serialized)', snapA.me.dragon && snapA.me.dragon.mounted === true, 'got ' + JSON.stringify(snapA.me.dragon));
  ok('FIX2 snapB.me.sailing falsy', !snapB.me.sailing, 'got ' + snapB.me.sailing);
  ok('FIX2 snapB.me.dragon.mounted falsy', !(snapB.me.dragon && snapB.me.dragon.mounted), 'got ' + JSON.stringify(snapB.me.dragon));
  const aInB = (snapB.players || []).find((p) => p.id === 'A');
  ok("FIX2 B's snapshot of A carries sailing flag (remote sprite)", aInB && aInB.sailing === true, aInB ? 'sailing=' + aInB.sailing : 'A missing');
  ok("FIX2 B's snapshot of A carries mounted flag (remote sprite)", aInB && aInB.mounted === true, aInB ? 'mounted=' + aInB.mounted : 'A missing');

  // save/load: tamed Emberwyrm persists (P2/S10: via the PLAYER slice — no top-level dragon
  // left on a v4 row); mounted restored grounded, sailing never persisted.
  A.dragon.tamed = true; A.dragon.mounted = true;
  const ch = w.characterOf('A');
  ok('FIX2 characterOf saves dragon.tamed in the PLAYER slice (top-level dragon gone, sailing saved nowhere — P2/S10)',
    ch && ch.player && ch.player.dragon && ch.player.dragon.tamed === true && ch.dragon === undefined && ch.player.sailing === undefined,
    'ch.player.dragon=' + JSON.stringify(ch && ch.player && ch.player.dragon) + ' ch.dragon=' + JSON.stringify(ch && ch.dragon));
  const C = w.addPlayer('C', 'Cid', JSON.parse(JSON.stringify(ch)));
  ok('FIX2 loaded hero restores dragon.tamed', C.dragon.tamed === true, 'C.dragon=' + JSON.stringify(C.dragon));
  ok('FIX2 loaded hero grounded (mounted=false), on foot (sailing=false)', C.dragon.mounted === false && C.sailing === false, 'C.dragon.mounted=' + C.dragon.mounted + ' C.sailing=' + C.sailing);
  w.removePlayer('C');
  A.sailing = false; A.dragon.mounted = false;
}

// ---------------------------------------------------------------------------
// FIX 3 — allies: partitioned, updateAllies runs, move/fight/expire + serialize
// ---------------------------------------------------------------------------
{
  S.enemies.length = 0; S.allies = [];
  B.x = A.x + 4000; B.y = A.y + 4000;         // B far away so it neither owns nor sees A's ally yet
  const ally = { x: A.x + 300, y: A.y, w: 22, h: 22, ally: true, _owner: 'A', name: 'Thrall', rank: 0, hp: 90, maxHp: 90, atk: 12, def: 2, color: '#74b0ff', attackCd: 0, life: 2100, wobble: 0 };
  const badName = { x: A.x + 40, y: A.y + 40, w: 22, h: 22, ally: true, _owner: 'A', name: 42, rank: 0, hp: 50, maxHp: 50, atk: 5, def: 1, color: '#9a70ff', attackCd: 0, life: 2100, wobble: 0 };
  S.allies.push(ally, badName);
  const x0 = ally.x, y0 = ally.y;
  for (let i = 0; i < 60; i++) w.tick();
  const moved = Math.abs(ally.x - x0) + Math.abs(ally.y - y0);
  ok('FIX3 ally MOVES toward its owner (updateAllies ran)', moved > 5, 'delta=' + moved.toFixed(1));
  ok('FIX3 non-string ally name coerced server-side', typeof badName.name === 'string', 'name=' + JSON.stringify(badName.name));
  const snapA = JSON.parse(JSON.stringify(w.snapshotFor('A')));
  ok('FIX3 ally appears in owner A snapshot', (snapA.allies || []).length >= 1, 'allies=' + (snapA.allies || []).length);
  const packed = (snapA.allies || [])[0];
  ok('FIX3 packed ally has string name (drawAlly-safe)', packed && typeof packed.name === 'string', packed ? 'name=' + JSON.stringify(packed.name) : 'none');
  ok('FIX3 packed ally carries draw fields', packed && ['x', 'y', 'w', 'h', 'color', 'hp', 'maxHp'].every((k) => packed[k] != null), packed ? JSON.stringify(Object.keys(packed)) : 'none');
  B.x = A.x + 100; B.y = A.y;
  const snapB = JSON.parse(JSON.stringify(w.snapshotFor('B')));
  ok('FIX3 nearby player B also sees the ally', (snapB.allies || []).length >= 1, 'allies=' + (snapB.allies || []).length);

  const before = S.allies.length;
  for (const a of S.allies) a.life = 1;
  w.tick();
  ok('FIX3 expired allies pruned (no leak)', S.allies.length < before && S.allies.length === 0, 'before=' + before + ' after=' + S.allies.length);
}

// ---------------------------------------------------------------------------
// FIX 5 — dungeon-grid attach is transactional; resendMap re-sends for a delver
// ---------------------------------------------------------------------------
{
  S.allies = []; S.enemies.length = 0;
  A.map = 'overworld';
  A.x = S.dungeonEntrance.tx * TILE; A.y = S.dungeonEntrance.ty * TILE;   // the sole overworld dungeon entrance tile (read from state — robust to map resize)
  A.inventory.keys = (A.inventory.keys | 0) + 1;
  A.actions.push('interact');
  w.tick();
  ok('FIX5 setup: A entered the shared dungeon', A.map === 'dungeon' && !!w.sharedDg, 'A.map=' + A.map + ' sharedDg=' + !!w.sharedDg);

  const savedMd = w.sharedDg ? w.sharedDg.md : null;
  const sentBefore = A._sentDgN | 0, switchN = A._mapSwitchN | 0;
  if (w.sharedDg) w.sharedDg.md = null;
  const snapNoGrid = w.snapshotFor('A');
  ok('FIX5 no grid available → dgTiles NOT sent', !snapNoGrid.dgTiles, snapNoGrid.dgTiles ? 'present' : 'absent');
  ok('FIX5 flag left UNCONSUMED for retry (transactional)', (A._sentDgN | 0) === sentBefore && sentBefore !== switchN, '_sentDgN=' + A._sentDgN + ' _mapSwitchN=' + A._mapSwitchN);

  if (w.sharedDg) w.sharedDg.md = savedMd;
  const snapGrid = w.snapshotFor('A');
  ok('FIX5 grid restored → dgTiles now sent', !!snapGrid.dgTiles, snapGrid.dgTiles ? 'present' : 'absent');
  ok('FIX5 edge consumed after successful attach', (A._sentDgN | 0) === (A._mapSwitchN | 0), '_sentDgN=' + A._sentDgN + ' _mapSwitchN=' + A._mapSwitchN);

  const snapSteady = w.snapshotFor('A');
  ok('FIX5 steady state sends no dgTiles', !snapSteady.dgTiles, snapSteady.dgTiles ? 'present' : 'absent');

  w.resendMap('A');
  const snapResend = w.snapshotFor('A');
  ok('FIX5 resendMap re-attaches the grid for a delver', !!snapResend.dgTiles, snapResend.dgTiles ? 'present' : 'absent');
  ok('FIX5 resendMap re-consumes cleanly', (A._sentDgN | 0) === (A._mapSwitchN | 0), '_sentDgN=' + A._sentDgN);
}

// ---------------------------------------------------------------------------
// FIX 6 (P2/S6) — hasBoat is PER-PLAYER + persisted; wayfind seeds ON per hero.
// Pre-S6 both were SHARED root keys: one hero's 250 g bought the whole room a
// boat, and no boat ever survived a reboot (hasBoat was outside characterOf).
// ---------------------------------------------------------------------------
{
  const N = w.addPlayer('N', 'NoBoat');                     // a broke, boatless bystander
  ok('FIX6 heroes seed boatless with the guide ON (PLAYER_TEMPLATE carries the S6 keys)',
    N.hasBoat === false && N.wayfind === true && B.hasBoat === false, 'N.hasBoat=' + N.hasBoat + ' N.wayfind=' + N.wayfind);

  // B buys at the Shipwright through the REAL co-op path (resolveInteract → _doInstant → G.buyBoat)
  const ship = (S.npcs || []).find((n) => n.id === 'shipwright');
  ok('FIX6 setup: the Shipwright exists', !!ship, ship ? 'at ' + Math.round(ship.x) + ',' + Math.round(ship.y) : 'MISSING');
  B.map = 'overworld'; B.x = ship.x; B.y = ship.y; B.gold = 300;
  const res1 = w.resolveInteract('B', 'shipwright');
  ok('FIX6 B buys a boat (toast + 250 g)', !!res1 && res1.kind === 'toast' && /acquire a sturdy boat/.test(res1.text) && B.gold === 50,
    (res1 ? res1.text.slice(0, 40) : 'null') + ' gold=' + B.gold);
  ok('FIX6 the boat is B\'s ALONE (per-player, not the room\'s)', B.hasBoat === true && A.hasBoat === false && N.hasBoat === false,
    'B=' + B.hasBoat + ' A=' + A.hasBoat + ' N=' + N.hasBoat);
  const res2 = w.resolveInteract('B', 'shipwright');
  ok('FIX6 re-interact: B already owns one (no double charge)', !!res2 && /already own/.test(res2.text) && B.gold === 50, res2 && res2.text.slice(0, 40));

  // sail gate reads p.hasBoat: B sails, boatless N (same water) is refused
  let wx = -1, wy = -1;
  const m = G.maps.overworld;
  for (let ty = 4; ty < m.length - 4 && wx < 0; ty++) for (let tx = 4; tx < m[0].length - 4; tx++) {
    const t = G.getTile('overworld', tx, ty), tw = G.getTile('overworld', tx - 1, ty);
    // water with a WALKABLE west shore: sail-out finds the water, and landfall can
    // return to the very tile B stood on (worldgen is unseeded here — be robust)
    if (t === G.T.WATER && tw !== G.T.WATER && !G.SOLID.has(tw)) { wx = tx; wy = ty; break; }
  }
  ok('FIX6 setup: found open water with a walkable shore', wx > 0, wx + ',' + wy);
  B.x = (wx - 1) * TILE; B.y = wy * TILE; B.sailing = false;
  N.x = (wx - 1) * TILE; N.y = wy * TILE; N.sailing = false; N.map = 'overworld';
  B.actions.push({ rpc: 'toggleBoat', args: [] });
  N.actions.push({ rpc: 'toggleBoat', args: [] });
  w.tick();
  ok('FIX6 boat owner B sets sail', B.sailing === true, 'B.sailing=' + B.sailing);
  ok('FIX6 boatless N is refused at the same shore (gate reads p.hasBoat)', N.sailing === false, 'N.sailing=' + N.sailing);
  B.actions.push({ rpc: 'toggleBoat', args: [] });                       // landfall so the regression block below starts B grounded
  w.tick();
  ok('FIX6 B makes landfall', B.sailing === false, 'B.sailing=' + B.sailing);

  // persistence + wire: the player slice carries both keys with zero adopt lines
  const chB = w.characterOf('B'), chN = w.characterOf('N');
  ok('FIX6 characterOf persists the boat (pre-S6 it was NOT saved at all)', chB.player.hasBoat === true && chN.player.hasBoat === false,
    'B=' + chB.player.hasBoat + ' N=' + chN.player.hasBoat);
  ok('FIX6 characterOf persists the guide pref', chB.player.wayfind === true && typeof chN.player.wayfind === 'boolean', 'B.wf=' + chB.player.wayfind);
  const snapB = JSON.parse(JSON.stringify(w.snapshotFor('B')));
  ok('FIX6 hasBoat/wayfind ride `me` on the wire (safeClone keeps player scalars)',
    snapB.me.hasBoat === true && snapB.me.wayfind === true, 'me.hasBoat=' + snapB.me.hasBoat + ' me.wayfind=' + snapB.me.wayfind);

  // client audit (risk #7): wayfind lives on the player now, so the wholesale `S.player = snap.me`
  // would stomp the [O] toggle every snapshot — the client must re-stamp its tab-local pref
  // (headless can't press keys; pin the shipped source like objclient's RECONCILE_SRC probes)
  const MP = require('fs').readFileSync(REPO + '/client/mp.html', 'utf8');
  ok('FIX6 client: [O] is a tab-local pref re-stamped after the wholesale adopt',
    /S\.player\.wayfind = localWayfind/.test(MP) && /localWayfind = !localWayfind/.test(MP)
    && MP.indexOf('S.player = snap.me;') < MP.indexOf('S.player.wayfind = localWayfind'));
}

// ---------------------------------------------------------------------------
// FIX 7 (P2/S9) — the shop SESSION is PER-SHOPPER on state.player (was shared
// state.activeShopTown/activeStock/activeShopName bridged by swapInPP's
// `_shopTown` special case + p._shopStock), and visitedTowns is per-hero.
// Pre-S9 a session-less buyGood RPC slipped the `i < 0` guard (the bridge set
// S.activeShopTown = null; null < 0 is false) and traded at town-0 prices.
// ---------------------------------------------------------------------------
{
  const P = w.addPlayer('P', 'Shopper');
  ok('FIX7 heroes seed with the spawn town discovered + a closed shop session (PLAYER_TEMPLATE carries the S9 keys)',
    Array.isArray(P.visitedTowns) && P.visitedTowns.length === 1 && P.visitedTowns[0] === 0
    && P.activeShopTown === -1 && P.activeStock === undefined,
    'vt=' + JSON.stringify(P.visitedTowns) + ' town=' + P.activeShopTown);

  // two shops in two DIFFERENT towns
  const shops = (S.npcs || []).filter((n) => n.id === 'shop' && n.shopTown && /^t\d+$/.test(n.shopTown.key));
  const shop1 = shops[0];
  const shop2 = shops.find((n) => n.shopTown.key !== shop1.shopTown.key);
  ok('FIX7 setup: two shops in two different towns exist', !!shop1 && !!shop2,
    shops.map((n) => n.shopTown.key).join(','));

  const N7 = w.players.get('N');                              // FIX6's bystander — never opened a shop
  B.map = 'overworld'; B.sailing = false; B.x = shop1.x; B.y = shop1.y;
  P.x = shop2.x; P.y = shop2.y;
  const pay1 = w.shopPayloadFor('B'), pay2 = w.shopPayloadFor('P');
  ok('FIX7 shopPayloadFor stamps the GAME\'s own player-carried session (town/stock/name on p — was _shopTown/_shopStock)',
    !!pay1 && B.activeShopTown === pay1.town && B.activeStock === pay1.stock && B.activeShopName === pay1.name && pay1.town >= 0,
    pay1 ? 'town=' + pay1.town + ' name=' + pay1.name : 'null');
  ok('FIX7 two heroes hold two DIFFERENT sessions at once (per-shopper, no shared root key)',
    !!pay2 && pay2.town >= 0 && pay2.town !== pay1.town && P.activeShopTown === pay2.town
    && N7.activeShopTown === -1 && N7.activeStock === undefined,
    'B@t' + pay1.town + ' P@t' + pay2.town + ' N=' + (N7 && N7.activeShopTown));

  // both buy ALL FOUR trade goods in the same tick: each pays HIS OWN town's prices
  // (generator-driven: two distinct townEcon rows must price the basket differently).
  B.gold = 5000; P.gold = 5000;
  for (const g of ['furs', 'grain', 'spice', 'ore']) { B.actions.push({ rpc: 'buyGood', args: [g] }); P.actions.push({ rpc: 'buyGood', args: [g] }); }
  w.tick();
  const paidB = 5000 - B.gold, paidP = 5000 - P.gold;
  ok('FIX7 both shoppers bought their basket (cargo credited per hero)',
    ['furs', 'grain', 'spice', 'ore'].every((g) => (B.cargo[g] | 0) >= 1 && (P.cargo[g] | 0) >= 1), JSON.stringify({ B: B.cargo, P: P.cargo }));
  ok('FIX7 each pays HIS town\'s prices (baskets differ across towns)', paidB > 0 && paidP > 0 && paidB !== paidP,
    'B paid ' + paidB + ' @t' + pay1.town + ', P paid ' + paidP + ' @t' + pay2.town);

  // a hero with NO open session is REFUSED (pre-S9: the null bridge slipped the guard and sold him town-0 goods)
  N7.gold = 500; N7.map = 'overworld';
  N7.actions.push({ rpc: 'buyGood', args: ['furs'] });
  w.tick();
  ok('FIX7 session-less buyGood is REFUSED (gold + cargo untouched; pre-S9 it bought at town-0 prices)',
    N7.gold === 500 && (N7.cargo.furs | 0) === 0, 'gold=' + N7.gold + ' furs=' + N7.cargo.furs);

  // buyWeapon resolves ids against p.activeStock (the renamed p._shopStock)
  const it7 = pay1.stock && pay1.stock.weapons && pay1.stock.weapons[0];
  ok('FIX7 setup: B\'s stock has a weapon to buy', !!(it7 && it7.id), it7 ? it7.name : 'EMPTY STOCK');
  if (it7) {
    B.gold = 100000;
    B.actions.push({ rpc: 'buyWeapon', args: [it7.id] });
    w.tick();
    ok('FIX7 buyWeapon resolves against p.activeStock (purchase lands on the acting hero)',
      B.shopPurchased.includes(it7.id) && B.gold < 100000, 'gold=' + B.gold + ' purchased=' + B.shopPurchased.includes(it7.id));
  }

  // wire shape: the fat stock never rides `me`; the scalars + travel list do
  const snapB7 = JSON.parse(JSON.stringify(w.snapshotFor('B')));
  ok('FIX7 wire: activeStock SKIPPED on `me` (one shopData payload, not 66 Hz), town/name scalars + visitedTowns ride',
    snapB7.me.activeStock === undefined && snapB7.me.activeShopTown === pay1.town
    && typeof snapB7.me.activeShopName === 'string' && Array.isArray(snapB7.me.visitedTowns),
    'town=' + snapB7.me.activeShopTown + ' stock=' + JSON.stringify(snapB7.me.activeStock));

  // persistence: the travel list rides the player slice; the SESSION is saved nowhere
  const chB7 = w.characterOf('B');
  ok('FIX7 characterOf persists visitedTowns but never the open session',
    Array.isArray(chB7.player.visitedTowns) && chB7.player.activeShopTown === undefined && chB7.player.activeStock === undefined,
    'vt=' + JSON.stringify(chB7.player.visitedTowns) + ' town=' + JSON.stringify(chB7.player.activeShopTown));

  // client audit (risk #7): the session lives on the player and activeStock is off the wire, so
  // the client must re-stamp its tab-local shopData copy after the wholesale adopt (the S6
  // wayfind inversion), and shopData must stamp the player fields — never a ghost root copy.
  const MP7 = require('fs').readFileSync(REPO + '/client/mp.html', 'utf8');
  ok('FIX7 client: shop session is tab-local, re-stamped after the wholesale adopt, no ghost root writes',
    /S\.player\.activeStock = localShop\.stock/.test(MP7)
    && MP7.indexOf('S.player = snap.me;') < MP7.indexOf('S.player.activeStock = localShop.stock')
    && /G\.state\.player\.activeShopTown = localShop\.town/.test(MP7)
    && !/G\.state\.activeStock =/.test(MP7) && !/G\.state\.activeShopTown =/.test(MP7));
}

// ---------------------------------------------------------------------------
// FIX 8 — factions + loreFound are PER-HERO (P2/S11, shared-bugs #2/#3).
// Pre-S11 both were SHARED root keys: one hero's kills swung everyone's prices/aggro,
// one scholar's stone read stripped every other hero's +40 XP, and neither was ever
// saved (characterOf never carried them — reboots reset the room). Post-S11: the
// acting hero's ledger moves on kills, PARTY-NEWS events award every hero, the world
// reacts to the party's EXTREME member, and both keys ride `me` + the player slice.
// ---------------------------------------------------------------------------
{
  const P8 = w.players.get('P'), B8 = w.players.get('B'), A8 = w.players.get('A');
  const led = (p) => ({ v: (p.factions || {}).vigil || 0, w: (p.factions || {}).wilds || 0, d: (p.factions || {}).dread || 0 });
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  // (a) kill attribution: a foe slain under P's pin credits P's OWN ledger; B's is untouched
  {
    const b0 = led(B8), p0 = led(P8);
    const foe = G.makeWildEnemy(Math.floor(P8.x / TILE) + 1, Math.floor(P8.y / TILE));
    foe.hp = 0; S.enemies.push(foe);
    const pp = S.player, pi = S.inventory;
    S.player = P8; S.inventory = P8.inventory;         // the crediting pin killEnemy always runs under
    try { G.killEnemy(foe); } finally { S.player = pp; S.inventory = pi; }
    const p1 = led(P8), b1 = led(B8);
    ok('FIX8 overworld kill rep lands on the KILLER\'s own ledger (wilds -0.4 / vigil +0.15 on P)',
      S.map === 'overworld' && near(p1.w, p0.w - 0.4) && near(p1.v, p0.v + 0.15),
      JSON.stringify({ before: p0, after: p1, map: S.map }));
    ok('FIX8 a bystander\'s ledger is UNTOUCHED by the kill (pre-S11: one shared pool moved for everyone)',
      near(b1.w, b0.w) && near(b1.v, b0.v), JSON.stringify({ before: b0, after: b1 }));
    ok('FIX8 no root ghost: addRep no longer creates state.factions', S.factions === undefined, JSON.stringify(S.factions));
  }

  // (b) the world reacts to the party's EXTREME member: P alone turns infamous → the
  // Dread Legion raids, even though B (and everyone else) is clean. partyRep('dread')
  // is the max over the party — pre-S11 this read the shared root, which stays 0 here.
  {
    P8.factions.dread = 60;
    for (const pl of S.players) pl.level = Math.max(pl.level, 5);   // updateFactionWar gates on the pinned hero's level
    const besiegedBefore = G.getTownZones().filter((tz) => tz.besieged).length;
    S.warTimer = 1;
    const origRnd = Math.random;
    Math.random = () => 0;                              // roll 0 < 0.3 + 60*0.005 → the raid branch, deterministically
    try { G.updateFactionWar(); } finally { Math.random = origRnd; }
    const sieged = G.getTownZones().findIndex((tz) => tz.besieged);
    ok('FIX8 ONE infamous hero draws the raid (partyRep = the party\'s extreme; shared root would read 0 and never fire)',
      besiegedBefore === 0 && sieged >= 0 && S.enemies.some((e) => e.dread && e.raidTown === sieged),
      'siegedTown=' + sieged + ' raiders=' + S.enemies.filter((e) => e.raidTown === sieged).length);

    // (c) party news: breaking the siege pays EVERY hero's ledger — including the delver (rep is not positional)
    const a0 = led(A8), b0 = led(B8), p0 = led(P8);
    for (let i = S.enemies.length - 1; i >= 0; i--) if (S.enemies[i].raidTown === sieged) S.enemies.splice(i, 1);
    G.liberateTown(sieged);
    const a1 = led(A8), b1 = led(B8), p1 = led(P8);
    ok('FIX8 liberation rep is PARTY NEWS: every hero +8 vigil/+4 dread (addRepParty over party(), delving A included)',
      near(a1.v, a0.v + 8) && near(a1.d, a0.d + 4) && near(b1.v, b0.v + 8) && near(b1.d, b0.d + 4)
      && near(p1.v, p0.v + 8) && near(p1.d, p0.d + 4),
      JSON.stringify({ A: [a0, a1], B: [b0, b1], P: [p0, p1] }));
  }

  // (d) Realm-stones: the first-read +40 XP is per-HERO now (THE #3 fix) — through the
  // real MP path (p.actions 'interact' → tryInteract → readLoreStone under the full swap)
  {
    const stone = (S.loreStones || [])[0];
    ok('FIX8 setup: worldgen placed a Realm-stone', !!stone, JSON.stringify(stone));
    if (stone) {
      const put = (p) => { p.x = stone.x; p.y = stone.y; p.map = 'overworld'; };
      const bx0 = { xp: B8.xp, lvl: B8.level, n: (B8.loreFound || []).length };
      put(B8); B8.actions.push('interact'); w.tick();
      ok('FIX8 B\'s first read: stone recorded on B\'s OWN list, +XP paid',
        (B8.loreFound || []).includes(stone.region) && (B8.xp > bx0.xp || B8.level > bx0.lvl),
        JSON.stringify({ lore: B8.loreFound, xp: [bx0.xp, B8.xp] }));
      const px0 = { xp: P8.xp, lvl: P8.level, n: (P8.loreFound || []).length };
      put(P8); P8.actions.push('interact'); w.tick();
      ok('FIX8 P reading the SAME stone is ALSO a first read (+XP) — pre-S11 the shared list silently ate it',
        (P8.loreFound || []).includes(stone.region) && (P8.xp > px0.xp || P8.level > px0.lvl),
        JSON.stringify({ lore: P8.loreFound, xp: [px0.xp, P8.xp] }));
      const bx1 = { xp: B8.xp, lvl: B8.level, n: B8.loreFound.length };
      put(B8); B8.actions.push('interact'); w.tick();
      ok('FIX8 B re-reading pays NOTHING more (dedupe still works, per-hero)',
        B8.loreFound.length === bx1.n && B8.loreFound.filter((r) => r === stone.region).length === 1,
        JSON.stringify({ lore: B8.loreFound }));
      ok('FIX8 no root ghost: state.loreFound retired', S.loreFound === undefined, JSON.stringify(S.loreFound));
    }
  }

  // (e) wire + persistence: both ride `me` (no adopt line needed) and the gated quest box
  {
    const snapB8 = JSON.parse(JSON.stringify(w.snapshotFor('B')));
    const qp = JSON.parse(JSON.stringify(w.questPayload('B')));
    ok('FIX8 wire: factions + loreFound ride `me` (safeClone keeps the plain object/array)',
      snapB8.me.factions && near(snapB8.me.factions.vigil, B8.factions.vigil) && Array.isArray(snapB8.me.loreFound)
      && JSON.stringify(snapB8.me.loreFound) === JSON.stringify(B8.loreFound),
      JSON.stringify({ fac: snapB8.me.factions, lore: snapB8.me.loreFound }));
    ok('FIX8 questPayload carries THIS hero\'s own loreFound (per-hero box seed, takeover-safe)',
      JSON.stringify(qp.loreFound) === JSON.stringify(B8.loreFound), JSON.stringify(qp.loreFound));
  }

  // (f) client audit (risk #7): no ghost root adopts left; the box seed stamps the PLAYER
  {
    const MP8 = require('fs').readFileSync(REPO + '/client/mp.html', 'utf8');
    ok('FIX8 client: adoptQuests stamps state.player.loreFound (not a root ghost); no root factions/loreFound writes anywhere',
      /G\.state\.player\.loreFound = s\.loreFound/.test(MP8)
      && !/G\.state\.loreFound\s*=/.test(MP8) && !/G\.state\.factions\s*=/.test(MP8));
  }
}

// ---------------------------------------------------------------------------
// FIX 9 (P2/S14) — the RPC path carries its OWN acting context: _runRpc runs every
// handler under the game's actAs(p, …) (plan §1's runAs — pins ONLY state.player/
// state.inventory, the two slots that remain; restores both in a finally). The swap
// machinery (PP_KEYS/swapInPP/writeBackPP) is DELETED — the pin IS the whole swap.
// Pre-S14 an RPC ran against whatever hero its caller left pinned (the §1 trap);
// these are plan risk #5's rpc-2p assertions ("B buys, A's gold unchanged").
// ---------------------------------------------------------------------------
{
  const R1 = w.addPlayer('R1', 'Rica');
  const R2 = w.addPlayer('R2', 'Rob');
  R1.map = 'overworld'; R2.map = 'overworld';
  R1.gold = 500; R2.gold = 500;
  const pot = (p) => { const it = (p.inventory.items || []).find((i) => i.name === 'Potion'); return it ? it.qty | 0 : 0; };

  // (a) THE DISCRIMINATOR — an RPC invoked while the AMBIENT pin is another hero must still
  // act as ITS OWN hero. Pre-S14 (no actAs wrapper — the handler trusted its caller's pin)
  // the ambient hero paid: R1 lost the 15 g and pocketed the potion. SEEN FAILING there.
  S.player = R1; S.inventory = R1.inventory;             // the stale-pin shape of the §1 trap
  const g1 = R1.gold, g2 = R2.gold, q1 = pot(R1), q2 = pot(R2);
  w._runRpc({ rpc: 'buyPotion', args: [] }, R2);
  ok('FIX9 the RPC pays the ACTING hero, never the ambient pin (B buys: HIS gold, HIS potion)',
    R2.gold === g2 - 15 && pot(R2) === q2 + 1, 'R2.gold=' + R2.gold + ' potions=' + pot(R2));
  ok('FIX9 the ambient-pinned bystander is UNTOUCHED (A\'s gold unchanged — risk #5)',
    R1.gold === g1 && pot(R1) === q1, 'R1.gold=' + R1.gold + ' potions=' + pot(R1));
  ok('FIX9 actAs RESTORES the ambient pin after the handler (finally semantics)',
    S.player === R1 && S.inventory === R1.inventory, 'pinned=' + (S.player && S.player.name));

  // (b) the REAL path (setInput → tick → _runActions → _runRpc under the rotation): both
  // heroes buy in the SAME tick — each pays exactly his own 15 g, pockets exactly one potion.
  // (Parked in an empty corner: no foes/pickups/tribute to move gold during the tick.)
  R1.x = 8 * TILE; R1.y = 8 * TILE; R2.x = 10 * TILE; R2.y = 8 * TILE; R1.held = {}; R2.held = {};
  const g1b = R1.gold, g2b = R2.gold, q1b = pot(R1), q2b = pot(R2);
  w.setInput('R1', { actions: [{ rpc: 'buyPotion' }] });
  w.setInput('R2', { actions: [{ rpc: 'buyPotion' }] });
  w.tick();
  ok('FIX9 same-tick 2p buys: each hero pays his OWN 15 g and gains his OWN potion',
    R1.gold === g1b - 15 && R2.gold === g2b - 15 && pot(R1) === q1b + 1 && pot(R2) === q2b + 1,
    JSON.stringify({ R1: [g1b, R1.gold, pot(R1)], R2: [g2b, R2.gold, pot(R2)] }));

  // (c) source guard: the machinery is GONE from world.js — definitions AND call sites
  // (only the retirement chronicle in comments may mention the names), and both the RPC
  // dispatcher and the interact resolver run under the game's actAs.
  const WSRC = require('fs').readFileSync(REPO + '/server/world.js', 'utf8');
  ok('FIX9 world.js: no PP_KEYS/swapInPP/writeBackPP definitions or calls remain',
    !/const PP_KEYS/.test(WSRC) && !/function swapInPP/.test(WSRC) && !/function writeBackPP/.test(WSRC)
    && !/swapInPP\s*\(/.test(WSRC) && !/writeBackPP\s*\(/.test(WSRC), '');
  ok('FIX9 world.js: _runRpc + resolveInteract run under G.actAs(p, …)',
    (WSRC.match(/G\.actAs\(p, \(\) =>/g) || []).length >= 2, '');
}

// ---------------------------------------------------------------------------
// REGRESSION — 3 players, 300 ticks incl. a live dungeon delve, zero exceptions
// ---------------------------------------------------------------------------
{
  const D = w.addPlayer('D', 'Dax');           // A is in the dungeon; B & D roam the overworld
  D.x = 116 * TILE; D.y = 97 * TILE;
  B.x = 118 * TILE; B.y = 99 * TILE;
  S.allies.push({ x: B.x + 80, y: B.y, w: 22, h: 22, ally: true, _owner: 'B', name: 'Bound Brute', rank: 0, hp: 120, maxHp: 120, atk: 10, def: 2, color: '#9a70ff', attackCd: 0, life: 5000, wobble: 0 });
  try { const foe = G.makeWildEnemy(Math.floor(B.x / TILE) + 2, Math.floor(B.y / TILE)); if (foe) { foe.x = B.x + 90; foe.y = B.y; S.enemies.push(foe); } } catch (_e) {}
  let err = null, ticks = 0, sawDungeon = false;
  for (let i = 0; i < 300; i++) {
    if (i % 40 === 20) B.actions.push('attack');
    try { w.tick(); ticks++; } catch (e) { err = String(e && e.stack || e); break; }
    if (w.sharedDg) sawDungeon = true;
    try { for (const id of ['A', 'B', 'D']) { const p = w.players.get(id); if (p) JSON.parse(JSON.stringify(w.snapshotFor(id))); } } catch (e) { err = 'snapshot: ' + String(e && e.stack || e); break; }
  }
  ok('REGRESSION 300 ticks, zero exceptions', ticks === 300 && !err, 'ticks=' + ticks + (err ? ' err=' + err : ''));
  ok('REGRESSION a dungeon instance was live during the run', sawDungeon, 'sawDungeon=' + sawDungeon);
  ok('REGRESSION all positions finite', [A, B, D].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), '');
}

console.log('\n=== per-player-state fix verification ===');
for (const r of results) console.log('  ' + r);
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
