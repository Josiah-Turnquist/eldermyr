'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// Verifies the Overlord-domination softlock fix in eldermyr-rpg.html via the headless loader.
const G = require('' + __RR + '/server-spike/load-game.js');

let fails = 0;
function ok(name, cond){ console.log((cond?'PASS':'FAIL')+' — '+name); if(!cond) fails++; }

// Boot a full valid game state (also generates the Legion + Overlord).
G.startGame();
const state = G.state;
if(!state.legion || !state.legion.overlord) G.genLegion();
const L = state.legion;

// canDominate only gates on abilities.dominate; the magic-prof-18 gate lives in unlockAbility.
// Set both so our "passing case" mirrors a legitimately unlocked mage.
state.player.abilities.dominate = true;
state.player.prof.magic.lvl = 18;

const overlord = L.overlord;
const regularWarlord = L.warlords[0];           // rank 1 or 2 — a normal, bindable warlord
console.log('overlord rank =', overlord.rank, '| sample warlord rank =', regularWarlord.rank);

// Helper: build an enemy the way makeWarlordEnemy does, brought below 25% HP (domination window).
const lowHp = (ref) => ({ isNemesis:true, warlordRef:ref, hp:5, maxHp:100 });

// 1) The live Overlord enemy (warlordRef === state.legion.overlord) must NOT be dominatable.
ok('canDominate(live Overlord enemy) === false', G.canDominate(lowHp(overlord)) === false);

// 2) A stale-reference Overlord (save/load could break object identity) — caught by rank>=3 backup.
ok('canDominate(stale Overlord, rank 3, different object) === false',
   G.canDominate(lowHp({ rank:3 })) === false);

// 3) A regular warlord below 25% is STILL dominatable (no regression).
//    NB: the nemesis branch returns the (truthy) warlordRef object, not literal true — the
//    call site (tryInteract) uses it as a truthy gate, so assert truthiness.
ok('canDominate(regular weakened warlord) is truthy', G.canDominate(lowHp(regularWarlord)) != false);

// 4) A regular Elite (magic-Dominate target, no warlordRef) is STILL dominatable.
ok('canDominate(regular Elite) is truthy',
   G.canDominate({ elite:true, isBoss:false, isNemesis:false, isGreatBeast:false, hp:5, maxHp:100 }) != false);

// 5) Sanity: a healthy Overlord (above 25%) is false too (unchanged base gate).
ok('canDominate(healthy Overlord) === false',
   G.canDominate({ isNemesis:true, warlordRef:overlord, hp:90, maxHp:100 }) === false);

// 6) End-to-end through the captured dispatcher `dominate` (which calls the edited, uncaptured
//    dominateWarlord): the Overlord must remain unbound (dominated stays falsy).
const beforeAlive = overlord.alive;
G.dominate(lowHp(overlord));
ok('dominate(Overlord) leaves overlord.dominated falsy', !overlord.dominated);
ok('dominate(Overlord) does not touch overlord.alive', overlord.alive === beforeAlive);

// 7) End-to-end: a regular warlord CAN still be bound through the same dispatcher (no regression).
const w2 = L.warlords[1] || regularWarlord;
G.dominate(lowHp(w2));
ok('dominate(regular warlord) sets dominated === true', w2.dominated === true);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
