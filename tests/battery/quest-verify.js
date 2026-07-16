'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// quest-verify.js — the quest-reset bug: completed / no-longer-relevant intro quests
// must RETIRE (not linger forever) in the quest box AND the wayfinder, in SP + MP.
// Drives the REAL game headlessly (server-spike/load-game) + a real MP World.
const fs = require('fs');
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server-spike/load-game.js');           // installs browser stubs, evals the game
const { World } = require(REPO + '/server/world.js');             // requiring world.js runs G.startGame()
const S = G.state;

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '   [' + x + ']' : '')); };

// ---- Expose the two functions I edited (NOT in load-game CAPTURE) by evaling their
//      real source (with my edits) in global scope, wiring their free vars to captured
//      symbols. Only the talk/key branches are exercised, so the legion/holdings deps
//      are harmless stubs. -----------------------------------------------------------
const html = fs.readFileSync(require(REPO + '/tests/battery/game-file.js').gameFilePath(), 'utf8');
function slice(startSig, endSig) {
  const a = html.indexOf(startSig); const b = html.indexOf(endSig, a + 1);
  if (a < 0 || b < 0) throw new Error('cannot slice ' + startSig);
  return html.slice(a, b);
}
global.state = S; global.TILE = G.TILE; global.distFactor = G.distFactor;
global.OW_W = G.OW_W; global.OW_H = G.OW_H;
global.HOLD_SITES = []; global.dist2ToPlayerTile = () => 1e9;
global.REGION_NAMES = ['n','e','s','w','ne','se','sw','nw','c'];
global.POI_KINDS = { camp: { mark: '#fff' }, keep: { mark: '#fff' } };
const coSrc = slice('function currentObjective() {', '\nfunction drawWayfinder(');
const uqSrc = slice('function updateQuests() {', '\nfunction tameDragon(');
(0, eval)('global.currentObjective = ' + coSrc.replace('function currentObjective', 'function'));
(0, eval)('global.updateQuests = '     + uqSrc.replace('function updateQuests',     'function'));

// ---- DOM-capture: run updateQuests() and return the rendered quest-box lines. -------
function questBox() {
  const lines = [];
  const list = { innerHTML: '', appendChild(d) { lines.push(d.textContent); } };
  const realGet = global.document.getElementById, realCreate = global.document.createElement;
  global.document.getElementById = (id) => (id === 'quest-list' ? list : realGet(id));
  global.document.createElement = () => ({ className: '', textContent: '' });
  try { global.updateQuests(); } finally { global.document.getElementById = realGet; global.document.createElement = realCreate; }
  return lines;
}
const has = (lines, sub) => lines.some((l) => l.indexOf(sub) >= 0);

// Reset quests to a known FRESH state (as the initial state literal / startGame leaves them).
// P2/S13: the box lives ON the player — poke S.player.quests (the evaled updateQuests/
// currentObjective read state.player.quests). NB this replaces the BOOT hero's box with a
// fresh object; the room's SHARED_QUESTS anchor is players[0]'s box once heroes exist, so
// section E's aliasing is unaffected (its heroes alias at their own join).
function freshQuests() {
  S.player.quests = { main:{name:'Slay the Mountain Kraken',done:false,started:false,hidden:true},
    talk:{name:'Speak to the Elder',done:false},
    key:{name:'Find the Dungeon Key',done:false,hidden:true},
    slay:{name:'Slay 5 monsters',done:false,count:0,target:5},
    frozen:{name:'Plunder the Frozen Cache',done:false,hidden:true},
    dragon:{name:'Tame the Emberwyrm (Lv 20)',done:false,hidden:true},
    legion:{started:false,stage:'none',camps:0,sealstones:0,villages:0,seatRegion:-1} };
  S.player.bounty = null; S.player.loreFound = []; S.player.maxDepth = 0; S.inventory.keys = 0;   // P2/S11: loreFound lives on the player; P2/S12: bounty/maxDepth too
}
// mirror startDialogue(elder) / world.js elder branch
function talkToElder() { const q = S.player.quests; q.talk.done = true; q.main.started = true; q.key.hidden = false;
  if (!q.legion.started) { q.legion.started = true; q.legion.stage = 'camps'; } }

out.push('=== A. Quest BOX retires completed / satisfied intro quests ===');
freshQuests();
let L = questBox();
ok('A1 fresh: shows Speak to the Elder', has(L, 'Speak to the Elder'), L.join(' | '));
ok('A1 fresh: shows Slay monsters (0/5)', has(L, 'Slay monsters (0/5)'));
ok('A1 fresh: key is HIDDEN (not shown)', !has(L, 'Dungeon Key'));

talkToElder();
L = questBox();
ok('A2 after Elder: Speak to the Elder is GONE (retired)', !has(L, 'Speak to the Elder'), L.join(' | '));
ok('A2 after Elder: Find the Dungeon Key now shows', has(L, 'Find the Dungeon Key'));
ok('A2 after Elder: legion camps quest shows (real active quest)', has(L, 'break the war-camps'));

S.inventory.keys = 16;                    // has 16 keys but key.done still false (boss/vault keys)
L = questBox();
ok('A3 with 16 keys: Find the Dungeon Key is GONE (symptom b fixed)', !has(L, 'Find the Dungeon Key'), 'keys=16');
ok('A3 with 16 keys: legion quest STILL shows', has(L, 'break the war-camps'));

S.player.quests.slay.count = 5; S.player.quests.slay.done = true;
L = questBox();
ok('A4 slay done: Slay monsters is GONE (retired)', !has(L, 'Slay monsters'), L.join(' | '));

// progressed level-5-ish hero: talked, 16 keys, 5+ slain, incomplete slay-quest edge
S.player.level = 5;
L = questBox();
ok('A5 progressed hero sees NONE of the 3 intro quests', !has(L, 'Speak to the Elder') && !has(L, 'Find the Dungeon Key') && !has(L, 'Slay monsters'), L.join(' | '));
ok('A5 progressed hero STILL sees the active Legion quest', has(L, 'break the war-camps'));

// a still-INCOMPLETE key quest (talked, no keys) must still show — don't over-retire
freshQuests(); talkToElder(); S.inventory.keys = 0;
L = questBox();
ok('A6 incomplete key quest still shows when 0 keys', has(L, 'Find the Dungeon Key'));

out.push('=== B. Wayfinder (currentObjective) re-evaluates ===');
S.map = 'overworld'; S.scene = 'play';
freshQuests();
let o = global.currentObjective();
ok('B1 fresh: objective = Speak to the Elder', !!o && /Speak to the Elder/.test(o.label), o && o.label);

talkToElder(); S.inventory.keys = 0;
// ensure a collectible key pickup exists so the key objective CAN resolve
if (!S.pickups.some((p) => p.kind === 'key' && !p.collected)) {
  S.pickups.push({ x: 40 * G.TILE, y: 40 * G.TILE, w: 16, h: 16, kind: 'key', collected: false });
}
o = global.currentObjective();
ok('B2 talked, 0 keys, pickup exists: objective = Dungeon Key', !!o && /Dungeon Key/.test(o.label), o && o.label);

S.inventory.keys = 16;
o = global.currentObjective();
ok('B3 with 16 keys: NOT pointed at the key (symptom b)', !(o && /Dungeon Key/.test(o.label)), o && o.label);

out.push('=== C. Completion PERSISTS across snapshot() -> applySnapshot() (SP save/reload; v7 player-slice shape + v6 root-fallback) ===');
freshQuests(); talkToElder();
S.player.quests.slay.count = 5; S.player.quests.slay.done = true; S.player.quests.key.done = true; S.inventory.keys = 4; S.player.level = 6;
const snap = G.snapshot();
ok('C1 snapshot v7: quests ride the PLAYER slice, never the root', snap.v === 7 && !!snap.player.quests && snap.quests === undefined,
  'v=' + snap.v + ' player.quests=' + !!snap.player.quests + ' root=' + (snap.quests === undefined ? 'absent' : 'PRESENT'));
// perturb, then restore from the snapshot
S.player.quests.talk.done = false; S.player.quests.slay.done = false; S.player.quests.key.done = false; S.inventory.keys = 0;
G.applySnapshot(JSON.parse(JSON.stringify(snap)));
ok('C1 talk.done survived save/reload', S.player.quests.talk.done === true);
ok('C1 slay.done survived save/reload', S.player.quests.slay.done === true);
ok('C1 key.done survived save/reload', S.player.quests.key.done === true);
ok('C1 inventory.keys survived save/reload', S.inventory.keys === 4, 'keys=' + S.inventory.keys);
L = questBox();
ok('C1 after reload: intro quests stay retired', !has(L, 'Speak to the Elder') && !has(L, 'Find the Dungeon Key') && !has(L, 'Slay monsters'), L.join(' | '));

// old save: key.done never set, but bag already has keys -> must retire via LIVE check.
// Forged to the PRE-S13 shape (root quests, none in the player slice) so this also
// exercises applySnapshot's root FALLBACK — the lossless path every v<=6 save takes.
freshQuests(); talkToElder(); S.player.quests.key.done = false; S.inventory.keys = 5;
const oldSnap = G.snapshot();
oldSnap.quests = oldSnap.player.quests; delete oldSnap.player.quests; oldSnap.v = 6;   // era-honest v6 row
oldSnap.quests.key.done = false;
G.applySnapshot(JSON.parse(JSON.stringify(oldSnap)));
L = questBox();
ok('C2 old save (key.done=false, 5 keys) retires the key quest', !has(L, 'Find the Dungeon Key'), 'keys=' + S.inventory.keys);

out.push('=== D. No regression: rewards + real quests still fire ===');
// D1: boss-dropped key now also marks key.done (Edit C) — drive REAL killEnemy
freshQuests(); talkToElder(); S.player.quests.key.done = false; S.inventory.keys = 0;
S.map = 'dungeon';
const _r = Math.random; Math.random = () => 0.05;   // force the 30% key-drop roll
const boss = G.makeWildEnemy(10, 10, 3) || {};
boss.isBoss = true; boss.isFinalBoss = false; boss.hp = 0; boss.xp = 10; boss.gold = 5;
boss.x = 10 * G.TILE; boss.y = 10 * G.TILE; boss.w = 24; boss.h = 24; boss._markN = 0;
if (!S.enemies.includes(boss)) S.enemies.push(boss);
const keysBefore = S.inventory.keys;
try { G.killEnemy(boss); } catch (e) { out.push('   killEnemy threw: ' + e.message); }
Math.random = _r;
ok('D1 boss-drop: inventory.keys incremented', S.inventory.keys === keysBefore + 1, 'keys ' + keysBefore + '->' + S.inventory.keys);
ok('D1 boss-drop: key.done now set + persists', S.player.quests.key.done === true);
S.map = 'overworld';

// D2: slay quest still counts + completes via REAL killEnemy
freshQuests(); talkToElder(); S.player.quests.slay.count = 4; S.player.quests.slay.done = false;
const mob = G.makeWildEnemy(12, 12, 1) || {};
mob.hp = 0; mob.xp = 5; mob.gold = 1; mob.x = 12 * G.TILE; mob.y = 12 * G.TILE; mob.w = 24; mob.h = 24; mob._markN = 0; mob.isBoss = false;
if (!S.enemies.includes(mob)) S.enemies.push(mob);
try { G.killEnemy(mob); } catch (e) { out.push('   killEnemy(mob) threw: ' + e.message); }
ok('D2 slay quest reaches 5/5 + done', S.player.quests.slay.count >= 5 && S.player.quests.slay.done === true, S.player.quests.slay.count + '/5');

// D3: bounty reward still grants gold (openBounty captured)
freshQuests();
S.player.gold = 0; S.player.bounty = null;   // P2/S12: the contract lives on the player
try { G.openBounty(); } catch (e) { out.push('   openBounty accept threw: ' + e.message); }
ok('D3 bounty accepted (state.player.bounty set)', !!S.player.bounty, S.player.bounty && S.player.bounty.desc);
if (S.player.bounty) { S.player.bounty.progress = S.player.bounty.target; const goldBefore = S.player.gold;
  try { G.openBounty(); } catch (e) { out.push('   openBounty claim threw: ' + e.message); }
  ok('D3 bounty claim paid out gold', S.player.gold > goldBefore, goldBefore + '->' + S.player.gold);
  ok('D3 bounty cleared after claim', S.player.bounty === null); }

// D4: legion / frozen / dragon display branches intact (real active quests still render)
freshQuests(); talkToElder();
S.player.quests.legion.stage = 'keeps'; L = questBox();
ok('D4 legion keeps stage renders', has(L, 'recover Sealstones'));
S.player.quests.legion.stage = 'overlord'; S.player.quests.legion.seatRegion = 2; L = questBox();
ok('D4 legion overlord stage renders', has(L, 'confront the Dread Overlord'));
S.player.quests.frozen.hidden = false; L = questBox();
ok('D4 frozen quest renders when revealed', has(L, 'Frozen Cache'));
S.player.quests.dragon.hidden = false; L = questBox();
ok('D4 dragon quest renders when revealed', has(L, 'Emberwyrm'));

out.push('=== E. MP: the questline is PER-PLAYER; the world-object quests stay shared ===');
// REWRITTEN for v2.57.0 (quests/maxDepth/bounty became PP_KEYS). This section used to encode the
// SHARED-quests model and, in doing so, asserted the bug it was meant to catch:
//   • it drove progress by poking the SHARED `S.quests` global — which is now just whichever hero
//     the sim last swapped in, so it never touched the player it was about to assert on;
//   • old E2 ("reconnecting/new player still sees completed quest") called addPlayer('P2') — a
//     brand-NEW hero, not a reconnect — and required him to inherit the veteran's finished intro.
//     That is exactly D4: a level-1 joiner could never be handed "Speak to the Elder". It is now
//     INVERTED. A real reconnect keeps its progress by a different route (session takeover adopts
//     the live pid; a DB load restores p.quests) — both covered by scratchpad/quest-pp-verify.js.
//   • the cold-boot hole was self-reported here as a "[finding] … (pre-existing, orthogonal)"
//     while the suite printed 34/0 green. It was neither pre-existing-and-fine nor orthogonal: it
//     was the reported bug. It is an ASSERTION now (E4).
const w = new World();
const p1 = w.addPlayer('P1', 'One');
const elderNpc = (S.npcs || []).find((n) => n.id === 'elder');
p1.x = elderNpc.x; p1.y = elderNpc.y;
w.resolveInteract('P1', 'elder');                      // the REAL server path (swapInPP → quest writes → writeBackPP)
for (let i = 0; i < 42; i++) w.tick();                 // let the 40-tick quest version stamp fire
const s1 = w.snapshotFor('P1');
ok('E1 the acting hero\'s own snapshot carries his completed quest (talk.done)', !!(s1 && s1.quests && s1.quests.talk && s1.quests.talk.done === true), s1 && s1.quests && ('talk.done=' + s1.quests.talk.done));
// a brand-NEW hero joins mid-session: he must get his OWN intro, not inherit P1's finished one
const p2 = w.addPlayer('P2', 'Two');
w.tick();
const s2 = w.snapshotFor('P2');
ok('E2 a NEW player does NOT inherit the veteran\'s completed intro (D4)', !!(s2 && s2.quests && s2.quests.talk && s2.quests.talk.done === false), s2 && s2.quests && ('talk.done=' + s2.quests.talk.done));
ok('E2b …and the veteran keeps his own progress', s1.quests.talk.done === true && p1.quests.talk.done === true);
// the WORLD-object quests (Kraken / Frozen Cache / the Legion war) are aliased — one state per room
ok('E3 world quests stay SHARED by reference (main/frozen/legion)',
  p1.quests.main === p2.quests.main && p1.quests.frozen === p2.quests.frozen && p1.quests.legion === p2.quests.legion);
ok('E3b …so the Elder starting the Legion war starts it for the whole room', p2.quests.legion.started === true && s2.quests.legion.started === true);
ok('E3c …while the per-player sub-objects are distinct (not a shallow clone)',
  p1.quests.talk !== p2.quests.talk && p1.quests.key !== p2.quests.key && p1.quests.slay !== p2.quests.slay);
// E4 (was the "[finding]"): the questline IS in the per-character DB slice → it survives a cold boot
const ch = w.characterOf('P1');
ok('E4 characterOf() persists the questline per character IN the player slice (survives a room COLD boot; no top-level copy since P2/S13)',
  !!(ch && ch.player && ch.player.quests && ch.player.quests.talk && ch.player.quests.talk.done === true && ch.quests === undefined && ch.player.maxDepth !== undefined && (ch.v | 0) >= 2), ch && ('v=' + ch.v + ' player.quests=' + (ch.player && ch.player.quests ? 'yes' : 'no') + ' topQuests=' + (ch.quests ? 'PRESENT' : 'absent') + ' player.maxDepth=' + (ch.player && ch.player.maxDepth)));   // P2/S12: depth rides the player slice; P2/S13: the questline too
ok('E5 a join/takeover seed exists (welcome payload, mirrors legionPayload)',
  typeof w.questPayload === 'function' && !!(w.questPayload('P1') || {}).quests);

out.push('');
out.push(pass + ' passed, ' + fail + ' failed');
console.log(out.join('\n'));
process.exit(fail ? 1 : 0);
