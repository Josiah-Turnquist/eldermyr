'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// pinnacle-verify.js — STAGE A of the two Pinnacle Bosses (Drowned King + Pale Shepherd).
// Drives the REAL game headlessly (server/load-game) via captured symbols only
// (loop/updateEnemies/killEnemy/snapshot/applySnapshot/state) — no harness changes.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game.js');
const S = G.state, TILE = G.TILE, OW_W = G.OW_W, OW_H = G.OW_H, DAY = 21600;
let LOG = []; global.__onLog = (m) => { LOG.push(String(m)); }; global.__onGameOver = () => {};

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

// ---- boot a clean SP overworld ----
G.startGame();
S.scene = 'play'; S.map = 'overworld'; S.player.sailing = false; if (S.player.dragon) S.player.dragon.mounted = false;   // P2/S10: boat-state + steed live ON the player
const clearPin = () => { for (let i = S.enemies.length - 1; i >= 0; i--) { const e = S.enemies[i]; if (e.isPinnacle || e._pinRef) S.enemies.splice(i, 1); } };
const king = () => S.enemies.find(e => e.isPinnacle && e.pinKey === 'drownedking');
const shep = () => S.enemies.find(e => e.isPinnacle && e.pinKey === 'paleshepherd');
const setDay = () => { S.time = Math.floor(0.30 * DAY); };   // darkness()==0 → day
const setNight = () => { S.time = Math.floor(0.80 * DAY); };  // darkness()==1 → night
const drive = (n) => { for (let i = 0; i < n; i++) { S._pinCheckT = 0; G.loop(); } };  // force the throttle each frame

// ===== T1 — startGame inits the pinnacle fields =====
ok('startGame: pinnacleSlain=[]', Array.isArray(S.pinnacleSlain) && S.pinnacleSlain.length === 0);
ok('startGame: pinnacleCycle=0', S.pinnacleCycle === 0, S.pinnacleCycle);
ok('startGame: pinnacleRespawnDay=null', S.pinnacleRespawnDay === null, S.pinnacleRespawnDay);
ok('setup: drownedLair === islands[1]', S.drownedLair && S.islands && S.drownedLair.tx === S.islands[1].x && S.drownedLair.ty === S.islands[1].y, JSON.stringify(S.drownedLair));
ok('setup: shepherdLair set & non-solid', S.shepherdLair && !G.SOLID.has(G.getTile('overworld', S.shepherdLair.tx, S.shepherdLair.ty)), JSON.stringify(S.shepherdLair));

// ---- BFS land-reachability of the shepherd lair from the town spawn (the player must be able to WALK there) ----
(() => {
  const stx = Math.floor((S.player.x + S.player.w / 2) / TILE), sty = Math.floor((S.player.y + S.player.h / 2) / TILE);
  const seen = new Set([stx + ',' + sty]), st = [[stx, sty]];
  while (st.length) { const [x, y] = st.pop(); for (const [nx, ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) { if (nx < 0 || ny < 0 || nx >= OW_W || ny >= OW_H) continue; if (G.SOLID.has(G.getTile('overworld', nx, ny))) continue; const k = nx + ',' + ny; if (seen.has(k)) continue; seen.add(k); st.push([nx, ny]); } }
  ok('shepherdLair reachable by land from town', seen.has(S.shepherdLair.tx + ',' + S.shepherdLair.ty), JSON.stringify(S.shepherdLair));
  ok('shepherdLair in frozen band (ty<=52)', S.shepherdLair.ty <= 52, 'ty=' + S.shepherdLair.ty);
  ok('shepherdLair away from Frost Titan (174,17)', Math.hypot(S.shepherdLair.tx - 174, S.shepherdLair.ty - 17) >= 12, 'd=' + Math.hypot(S.shepherdLair.tx - 174, S.shepherdLair.ty - 17).toFixed(1));
})();

// ===== T2 — Drowned King present at islands[1] (day or night); NOT a final boss =====
clearPin(); setDay(); drive(2);
{ const k = king();
  ok('DAY: Drowned King present', !!k);
  ok('King at islands[1] lair', k && k._lairTx === S.drownedLair.tx && k._lairTy === S.drownedLair.ty, k && (k._lairTx + ',' + k._lairTy));
  ok('King isBoss, type kraken', k && k.isBoss === true && k.type === 'kraken');
  ok('King NOT isFinalBoss / NOT isKraken (no victory)', k && !k.isFinalBoss && !k.isKraken);
  ok('King stamps scalar fight-state (arenaR/_nextKill/_hazT/pinKey)', k && typeof k.arenaR === 'number' && typeof k._nextKill === 'number' && typeof k._hazT === 'number' && k.pinKey === 'drownedking');
}

// ===== T3 — Pale Shepherd: night present / day absent =====
clearPin(); setNight(); drive(2);
ok('NIGHT: Pale Shepherd present at frozen lair', !!shep() && shep()._lairTx === S.shepherdLair.tx, shep() && (shep()._lairTx + ',' + shep()._lairTy));
setDay(); S.player.x = 10 * TILE; S.player.y = 10 * TILE; drive(2);   // player far from the frozen lair → melts at dawn
ok('DAY: Pale Shepherd absent (melted)', !shep());
ok('melt logged', LOG.some(l => /melts into the snow/.test(l)));

// ===== T4 — makePinnacleBoss is FLAT at PIN_LEVEL, but party SIZE still scales =====
// REWRITTEN: this used to assert "King hp/atk scales up with party (L25/4p >> L1/1p)" — it moved
// _partyLevel AND _partyN together, so it could never tell which one did the scaling. Party-LEVEL
// scaling is exactly the design the owner rejected ("make him level 75 flat" — he soloed both apex
// bosses at 19 precisely because they scaled DOWN to him), and the old assertion would still have
// passed on the flat build off partyN alone: it was about to become a green light for a rejected
// design. Split the two axes so each is proven independently.
clearPin(); S.pinnacleSlain = []; S.player.level = 1; S._partyLevel = 1; S._partyN = 1; setDay(); drive(2);
const k1 = king(); const k1hp = k1.maxHp, k1atk = k1.atk;
clearPin(); S.player.level = 45; S._partyLevel = 45; drive(2);          // party LEVEL alone: must change NOTHING
const kL = king();
ok('King hp is FLAT across party level (L1 === L45)', kL.maxHp === k1hp, k1hp + ' -> ' + kL.maxHp);
ok('King atk is FLAT across party level (L1 === L45)', kL.atk === k1atk, k1atk + ' -> ' + kL.atk);
clearPin(); S.player.level = 1; S._partyLevel = 1; S._partyN = 4; drive(2);   // party SIZE alone: must still scale
const k2 = king(); const k2hp = k2.maxHp, k2atk = k2.atk;
ok('King hp still scales with party SIZE (4p = 2.2x solo)', Math.abs(k2hp / k1hp - 2.2) < 0.01, k1hp + ' -> ' + k2hp);
ok('King atk still scales with party SIZE (4p = 1.54x solo)', Math.abs(k2atk / k1atk - 1.54) < 0.01, k1atk + ' -> ' + k2atk);
ok('King hp is an APEX rung even for a lone level-1 (flat PIN_LEVEL 75)', k1hp > 30000, 'L1/1p king hp=' + k1hp);
S._partyLevel = 1; S._partyN = 1; S.player.level = 1;

// ===== T5 — raiseadds spawns 3 ORDERED adds; out-of-order kill RESURRECTS =====
clearPin(); S.pinnacleSlain = []; setDay(); drive(2);
let K = king();
S.player.x = K.x + 20; S.player.y = K.y + 40; K.specialCd = 0; K.tele = null; K.dash = null; K.specials = ['raiseadds']; K.caster = false;
G.updateEnemies();                          // picks raiseadds → sets tele (windup)
if (K.tele) K.tele.t = 1;                    // fast-forward the windup
G.updateEnemies();                          // fires execBossSpecial('raiseadds')
let adds = S.enemies.filter(e => e._pinRef === K).sort((a, b) => a._orderIdx - b._orderIdx);
ok('raiseadds spawned 3 adds', adds.length === 3, 'n=' + adds.length);
ok('adds carry _orderIdx 0,1,2', adds.length === 3 && adds[0]._orderIdx === 0 && adds[1]._orderIdx === 1 && adds[2]._orderIdx === 2);
ok('adds _pinRef === boss', adds.every(a => a._pinRef === K));
ok('King add is aquatic (drowned court)', adds.every(a => a.aquatic === true), 'aquatic=' + adds.map(a => a.aquatic).join(','));
ok('boss kill-cursor reset to 0', K._nextKill === 0, K._nextKill);
// kill add #2 OUT OF ORDER → resurrect
const a2 = adds[2]; a2.hp = 0; G.killEnemy(a2);
ok('out-of-order kill RESURRECTS (still alive)', S.enemies.includes(a2) && a2.hp === a2.maxHp, 'hp=' + a2.hp + '/' + a2.maxHp);
ok('resurrect counted (_rezN=1) & cursor unmoved', a2._rezN === 1 && K._nextKill === 0);
ok("'dead do not stay down' logged", LOG.some(l => /dead do not stay down/i.test(l)));
// kill in order 0,1,2 → they stay dead
const a0 = adds[0], a1 = adds[1]; a0.hp = 0; G.killEnemy(a0);
ok('in-order kill #0 stays dead, cursor→1', !S.enemies.includes(a0) && K._nextKill === 1, 'cursor=' + K._nextKill);
a1.hp = 0; G.killEnemy(a1);
ok('in-order kill #1 stays dead, cursor→2', !S.enemies.includes(a1) && K._nextKill === 2, 'cursor=' + K._nextKill);
a2.hp = 0; G.killEnemy(a2);
ok('in-order kill #2 stays dead, cursor→3', !S.enemies.includes(a2) && K._nextKill === 3, 'cursor=' + K._nextKill);

// ===== T6 — boss dead ⇒ adds die normally (guard gated on _pinRef.hp>0, no softlock) =====
K.specialCd = 0; K.tele = null; K.specials = ['raiseadds']; G.updateEnemies(); if (K.tele) K.tele.t = 1; G.updateEnemies();
let adds2 = S.enemies.filter(e => e._pinRef === K).sort((a, b) => a._orderIdx - b._orderIdx);
ok('fresh wave of 3 adds', adds2.length === 3, 'n=' + adds2.length);
K.hp = 0; G.killEnemy(K);                     // slay the boss
const strag = adds2[2]; strag.hp = 0; G.killEnemy(strag);   // out-of-order, but boss is dead
ok('boss dead ⇒ out-of-order add DIES normally (no rez)', !S.enemies.includes(strag) && (strag._rezN || 0) === 0);

// ===== T7 — killEnemy(King): slain-record, respawn scheduled, EPIC log, loot drop, NO victory =====
LOG = []; ok('King already vanquished this run', S.pinnacleSlain.includes('drownedking'));
ok('respawn scheduled (pinnacleRespawnDay set)', typeof S.pinnacleRespawnDay === 'number' && S.pinnacleRespawnDay > 0, S.pinnacleRespawnDay);
ok('scene NOT won (no victory triggered)', S.scene !== 'won', S.scene);
// re-check the epic log via a fresh kill of a spawned king (LOG was cleared above; re-drive)
clearPin(); S.pinnacleSlain = []; S.pinnacleRespawnDay = null; setDay(); drive(2); K = king();
const pkBefore = S.pickups.length; const goldBefore = S.player.gold; LOG = [];
K.hp = 0; G.killEnemy(K);
ok('pinnacleSlain records key (dedup push)', S.pinnacleSlain.filter(k => k === 'drownedking').length === 1, JSON.stringify(S.pinnacleSlain));
ok('EPIC log line (★ / vanquished / falls)', LOG.some(l => /★|vanquish|falls/i.test(l)), LOG.find(l => /★|vanquish|falls/i.test(l)) || '(none)');
ok('loot pickup dropped at boss tile', S.pickups.length > pkBefore, (S.pickups.length - pkBefore) + ' new');
ok('solid gold awarded', S.player.gold > goldBefore, '+' + (S.player.gold - goldBefore));

// ===== T8 — arenaR shrinks over a prolonged fight (player in the ring) =====
clearPin(); S.pinnacleSlain = []; setNight(); drive(2); let SH = shep();
SH.specialCd = 99999; SH.tele = null; SH.caster = false;
const lcx = SH._lairTx * TILE + 16, lcy = SH._lairTy * TILE + 16;
S.player.maxHp = 99999; S.player.hp = 99999; S.player.def = 999;
S.player.x = lcx - S.player.w / 2; S.player.y = lcy - S.player.h / 2;   // stand in the arena centre
const r0 = SH.arenaR; for (let i = 0; i < 80; i++) G.updateEnemies();
ok('arenaR shrinks over the fight', SH.arenaR < r0 && SH.arenaR >= 100, r0.toFixed(1) + ' -> ' + SH.arenaR.toFixed(1));

// ===== T9 — outside the ring ⇒ throttled drowning/dark dmg + chill on the acting player =====
SH.arenaR = 200; SH.specialCd = 99999; SH.caster = false;
S.player.maxHp = 99999; S.player.hp = 99999; S.player.def = 0; S.player.chillT = 0; S.player.invuln = 0; S.player.evasion = 0;
S.player.x = lcx + 320; S.player.y = lcy;   // 320px from lair centre → beyond arenaR(200), within leash(980)
const hp0 = S.player.hp; for (let i = 0; i < 130; i++) G.updateEnemies();
ok('out-of-ring hazard damages the acting player', S.player.hp < hp0, hp0 + ' -> ' + S.player.hp);
ok('out-of-ring hazard chills the acting player', S.player.chillT > 0, 'chillT=' + S.player.chillT);

// ===== T10 — wander-home when the player abandons the arena (tele aborted, boss drifts to lair) =====
// place the boss on a VERIFIED non-solid tile ~2t from its lair so the home-step runs on walkable ground
let off = null; for (const [dx, dy] of [[0, 2], [2, 0], [-2, 0], [0, -2], [2, 2], [-2, 2]]) { const tx = SH._lairTx + dx, ty = SH._lairTy + dy; if (!G.SOLID.has(G.getTile('overworld', tx, ty))) { off = { tx, ty }; break; } }
SH.tele = { name: 'nova', t: 30, max: 30 }; SH.x = (off ? off.tx * TILE : lcx + 2 * TILE) - SH.w / 2; SH.y = (off ? off.ty * TILE : lcy);
S.player.x = lcx + 1200; S.player.y = lcy;   // player beyond PIN_LEASH(980) from lair
const dh0 = Math.hypot((SH.x + SH.w / 2) - lcx, (SH.y + SH.h / 2) - lcy);
const dp0 = Math.hypot((SH.x + SH.w / 2) - (S.player.x + S.player.w / 2), (SH.y + SH.h / 2) - (S.player.y + S.player.h / 2));
G.updateEnemies();
ok('wander-home aborts the telegraph', SH.tele === null);
for (let i = 0; i < 60; i++) G.updateEnemies();
const dh1 = Math.hypot((SH.x + SH.w / 2) - lcx, (SH.y + SH.h / 2) - lcy);
ok('boss drifts home to its lair (not chasing the far player)', dh1 < dh0, 'lairD ' + dh0.toFixed(1) + '->' + dh1.toFixed(1) + ' (player 1200px away, ignored)');

// ===== T11 — persistence round-trip + missing-field defaults =====
S.pinnacleSlain = ['drownedking']; S.pinnacleCycle = 2; S.pinnacleRespawnDay = 7;
let snap = G.snapshot();
ok('snapshot carries pinnacleSlain', JSON.stringify(snap.pinnacleSlain) === '["drownedking"]', JSON.stringify(snap.pinnacleSlain));
ok('snapshot carries pinnacleCycle', snap.pinnacleCycle === 2);
ok('snapshot carries pinnacleRespawnDay', snap.pinnacleRespawnDay === 7);
G.applySnapshot(snap);
ok('applySnapshot restores pinnacleSlain/cycle/respawn', S.pinnacleSlain.length === 1 && S.pinnacleSlain[0] === 'drownedking' && S.pinnacleCycle === 2 && S.pinnacleRespawnDay === 7);
let snap2 = G.snapshot(); delete snap2.pinnacleSlain; delete snap2.pinnacleCycle; delete snap2.pinnacleRespawnDay;
G.applySnapshot(snap2);
ok('missing-field save defaults pinnacleSlain=[]', Array.isArray(S.pinnacleSlain) && S.pinnacleSlain.length === 0);
ok('missing-field save defaults pinnacleCycle=0', S.pinnacleCycle === 0);
ok('missing-field save defaults pinnacleRespawnDay=null', S.pinnacleRespawnDay === null);

// ===== T12 — maybeRespawnPinnacle: cycle bump + roster clear on the scheduled day =====
S.pinnacleSlain = ['drownedking', 'paleshepherd']; S.pinnacleCycle = 0; S.pinnacleRespawnDay = G.curDay() + 4;
// jump time forward past the respawn day, then fire a new-day (onNewDay → maybeRespawnPinnacle) via updateTime crossing a boundary
S.time = (G.curDay() + 4) * DAY - 1; G.updateTime();  // crosses into the respawn day
ok('respawn: pinnacleSlain cleared', Array.isArray(S.pinnacleSlain) && S.pinnacleSlain.length === 0, JSON.stringify(S.pinnacleSlain));
ok('respawn: pinnacleCycle bumped to 1', S.pinnacleCycle === 1, S.pinnacleCycle);
ok('respawn: pinnacleRespawnDay cleared', S.pinnacleRespawnDay === null);

console.log('\n===== PINNACLE STAGE A — HEADLESS VERIFY =====');
out.forEach(l => console.log('  ' + l));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log(fail === 0 ? '  ✅ PINNACLE STAGE A OK' : '  ❌ FAILURES ABOVE');
process.exit(fail === 0 ? 0 : 1);
