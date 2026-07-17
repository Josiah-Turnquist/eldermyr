'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// uniques-verify.js — STAGE B of the Pinnacle Bosses: the 4 chase uniques, their recalcStats
// flags, the 4 combat seams, dropPinnacleReward first-kill-style-match + cycle reroll,
// uniquesFound persistence, and reforge/temper tag-preservation. Drives the REAL game
// headlessly through captured symbols only (killEnemy/updateProjectiles/playerTakeDamage/
// updateAllies/updatePlayer/updateEnemies/recalcStats/equip*/snapshot/afxHit/canDominate).
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game.js');
const S = G.state, TILE = G.TILE;
let LOG = []; global.__onLog = (m) => { LOG.push(String(m)); }; global.__onGameOver = () => {};
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

// ---- boot a clean, high-level SP overworld so every legendary unique is equippable ----
G.startGame();
S.scene = 'play'; S.map = 'overworld'; S.player.sailing = false; if (S.player.dragon) S.player.dragon.mounted = false;   // P2/S10: boat-state + steed live ON the player
S.player.level = 25; S._partyLevel = 25; S._partyN = 1;
S.player.prof.melee.lvl = 25; S.player.prof.ranged.lvl = 25; S.player.prof.magic.lvl = 25;
G.recalcStats();
const P = S.player;

// ---- helpers ----
function equipWObj(w) { G.normItem(w, true); S.inventory.weapons.push(w); G.equipWeapon(S.inventory.weapons.indexOf(w)); G.recalcStats(); return w; }
function equipAObj(a) { G.normItem(a, false); S.inventory.armor.push(a); G.equipArmor(S.inventory.armor.indexOf(a)); G.recalcStats(); return a; }
function equipByUniq(key, isW) { const arr = isW ? S.inventory.weapons : S.inventory.armor; const i = arr.findIndex(x => x.uniq === key); if (i >= 0) { (isW ? G.equipWeapon : G.equipArmor)(i); G.recalcStats(); } return i; }
const bow = () => ({ name: 'T-Bow', atk: 12, style: 'ranged', rarity: 1, dur: 40, durMax: 40, equipped: false, reqProf: 1 });
const sword = () => ({ name: 'T-Sword', atk: 10, style: 'melee', rarity: 1, dur: 40, durMax: 40, equipped: false, reqProf: 1 });
const staff = () => ({ name: 'T-Staff', atk: 10, style: 'magic', rarity: 1, dur: 40, durMax: 40, equipped: false, reqProf: 1 });
// kill a hand-built pinnacle boss via the REAL killEnemy → dropPinnacleReward path; return dropped uniques + items
function killPin(pinKey, cycle, seedSlain) {
  S.pickups.length = 0; S.enemies.length = 0;
  S.pinnacleSlain = seedSlain ? [pinKey] : (S.pinnacleSlain || []).filter(k => k !== pinKey);
  const e = { isPinnacle: true, pinKey, cycle: cycle || 0, x: P.x, y: P.y, w: 54, h: 54, hp: 0, maxHp: 2600, xp: 30, gold: 30, color: '#888', name: 'Test ' + pinKey, level: 25 };
  S.enemies.push(e); G.killEnemy(e);
  const uni = [], items = [];
  for (const pk of S.pickups) { const it = pk.value && (pk.value.weapon || pk.value.armor); if (it) { items.push(it); if (it.uniq) uni.push(it.uniq); } }
  return { uni, items };
}

// ===== 1) DROP LOGIC — first-kill style match =====
S.player._lastStyle = 'ranged'; equipWObj(bow());
const rRanged = killPin('drownedking', 0, false);
ok('first-kill RANGED killer vs Drowned King → Leviathan Spine', rRanged.uni.includes('leviathanspine') && !rRanged.uni.includes('tidecalleraegis'), rRanged.uni.join(','));
ok('first-kill drops exactly ONE unique', rRanged.uni.length === 1, rRanged.uni.length);

S.player._lastStyle = 'melee'; equipWObj(sword());
const rMelee = killPin('drownedking', 0, false);
ok('first-kill MELEE killer vs Drowned King → universal Tidecaller Aegis', rMelee.uni.includes('tidecalleraegis') && !rMelee.uni.includes('leviathanspine'), rMelee.uni.join(','));

S.player._lastStyle = 'magic'; equipWObj(staff());
const rMagic = killPin('paleshepherd', 0, false);
ok('first-kill MAGIC killer vs Pale Shepherd → Shepherd Bell (summon→magic match)', rMagic.uni.includes('shepherdsbell'), rMagic.uni.join(','));

S.player._lastStyle = 'melee'; equipWObj(sword());
const rShepUniv = killPin('paleshepherd', 0, false);
ok('first-kill MELEE killer vs Pale Shepherd → universal Gravewool Cloak', rShepUniv.uni.includes('gravewoolcloak'), rShepUniv.uni.join(','));

// MP-safety: _lastStyle (rides `me`) overrides a wrong equippedWeapon() bag (projectile-kill swap)
S.player._lastStyle = 'ranged'; equipWObj(sword());  // bag says melee, but the killer's style scalar says ranged
const rMP = killPin('drownedking', 0, false);
ok('MP-safe: _lastStyle=ranged drops Leviathan Spine despite a melee bag', rMP.uni.includes('leviathanspine'), rMP.uni.join(','));

// ===== 2) DROP LOGIC — re-kill cycle pool + super-loot =====
S.player._lastStyle = 'ranged'; equipWObj(bow());
const rCyc = killPin('drownedking', 2, true);
ok('re-kill: rolls exactly ONE unique from the pool', rCyc.uni.length === 1 && (rCyc.uni[0] === 'leviathanspine' || rCyc.uni[0] === 'tidecalleraegis'), rCyc.uni.join(','));
ok('re-kill: also drops a cycle super-loot (>=2 pinnacle items total)', rCyc.items.length >= 2, rCyc.items.length);
{ const seen = new Set(); for (let i = 0; i < 60; i++) killPin('drownedking', 1, true).uni.forEach(u => seen.add(u)); ok('re-kill pool eventually yields BOTH uniques (both obtainable)', seen.has('leviathanspine') && seen.has('tidecalleraegis'), [...seen].join(',')); }

// ---- grab one authoritative object of each unique (produced by makeUnique via the real drop) ----
S.player._lastStyle = 'ranged'; equipWObj(bow()); const spine = killPin('drownedking', 0, false).items.find(i => i.uniq === 'leviathanspine');
S.player._lastStyle = 'melee'; equipWObj(sword()); const aegis = killPin('drownedking', 0, false).items.find(i => i.uniq === 'tidecalleraegis');
S.player._lastStyle = 'magic'; equipWObj(staff()); const bell = killPin('paleshepherd', 0, false).items.find(i => i.uniq === 'shepherdsbell');
S.player._lastStyle = 'melee'; equipWObj(sword()); const cloak = killPin('paleshepherd', 0, false).items.find(i => i.uniq === 'gravewoolcloak');

// ===== 3) makeUnique OUTPUT shape =====
ok('Leviathan Spine: ranged weapon, frost, legendary, uniq+desc', !!spine && spine.style === 'ranged' && spine.element === 'frost' && spine.rarity === 4 && spine.atk > 0 && spine.uniq === 'leviathanspine' && /lance/i.test(spine.uniqDesc), spine && spine.atk);
ok('Tidecaller Aegis: armor (no atk), legendary, uniq+desc', !!aegis && aegis.def > 0 && aegis.atk === undefined && aegis.rarity === 4 && aegis.uniq === 'tidecalleraegis' && /nova/i.test(aegis.uniqDesc), aegis && aegis.def);
ok('Shepherd Bell: magic weapon, uniq+desc', !!bell && bell.style === 'magic' && bell.atk > 0 && bell.uniq === 'shepherdsbell' && /thrall/i.test(bell.uniqDesc), bell && bell.atk);
ok('Gravewool Cloak: armor (no atk), uniq+desc', !!cloak && cloak.def > 0 && cloak.atk === undefined && cloak.uniq === 'gravewoolcloak' && /still/i.test(cloak.uniqDesc), cloak && cloak.def);

// stash them once for equip/seam tests
const iSpine = (G.normItem(spine, true), S.inventory.weapons.push(spine), S.inventory.weapons.length - 1);
const iBell = (G.normItem(bell, true), S.inventory.weapons.push(bell), S.inventory.weapons.length - 1);
G.normItem(aegis, false); S.inventory.armor.push(aegis);
G.normItem(cloak, false); S.inventory.armor.push(cloak);
const iPlainW = (S.inventory.weapons.push(sword()), S.inventory.weapons.length - 1);
const iPlainA = (S.inventory.armor.push({ name: 'Plain Robe', def: 4, rarity: 0, dur: 40, durMax: 40, equipped: false }), S.inventory.armor.length - 1);

// ===== 4) recalcStats FLAG DERIVATION =====
equipByUniq('leviathanspine', true);
ok('equip Leviathan Spine → uLance only', P.uLance === true && !P.uFrostNova && !P.uBell && !P.uCloak, [P.uLance, P.uFrostNova, P.uBell, P.uCloak].join(','));
equipByUniq('tidecalleraegis', false);
ok('equip Tidecaller Aegis → uFrostNova true', P.uFrostNova === true);
equipByUniq('shepherdsbell', true);
ok('equip Shepherd Bell → uBell true, uLance false', P.uBell === true && P.uLance === false);
equipByUniq('gravewoolcloak', false);
ok('equip Gravewool Cloak → uCloak true, uFrostNova false', P.uCloak === true && P.uFrostNova === false);
G.equipWeapon(iPlainW); G.equipArmor(iPlainA); G.recalcStats();
ok('unequip all uniques → every u* flag false', !P.uLance && !P.uFrostNova && !P.uBell && !P.uCloak, [P.uLance, P.uFrostNova, P.uBell, P.uCloak].join(','));
// broken relic loses its magic
equipByUniq('leviathanspine', true); spine.dur = 0; G.recalcStats();
ok('BROKEN Leviathan Spine → uLance false', P.uLance === false);
spine.dur = spine.durMax; G.recalcStats();
ok('repaired Leviathan Spine → uLance true', P.uLance === true);

// ===== 5) SEAM — Leviathan Spine free lance on the 3rd Mark =====
equipByUniq('leviathanspine', true);
S.enemies.length = 0; S.projectiles.length = 0;
const foeL = { x: P.x + 40, y: P.y, w: 24, h: 24, hp: 800, maxHp: 800, def: 2, color: '#f00', hitFlash: 0, _markBy: P, _markN: 2 };
S.enemies.push(foeL);
G.addProjectile(foeL.x + 2, foeL.y + 6, 4, 0, 30, { friendly: true, kind: 'arrow', style: 'ranged', element: 'frost', ownerRef: P, uLance: true, pierce: 0, life: 90, r: 5 });
G.updateProjectiles();
const lance = S.projectiles.find(pr => pr.kind === 'lance');
ok('uLance: the hit raising Marks to 3 fires a free frost LANCE', !!lance && lance.friendly && lance.element === 'frost' && lance.pierce >= 1, lance && JSON.stringify({ k: lance.kind, el: lance.element, p: lance.pierce }));
ok('uLance: target Marks reached 3', foeL._markN === 3, foeL._markN);
// a lance does NOT itself carry uLance → no recursion
ok('uLance: the spawned lance carries no uLance flag (no recursion)', lance && !lance.uLance);
// arrows without uLance (plain bow) never spawn a lance
equipWObj(bow()); S.enemies.length = 0; S.projectiles.length = 0;
const foeN = { x: P.x + 40, y: P.y, w: 24, h: 24, hp: 800, maxHp: 800, def: 2, color: '#f00', hitFlash: 0, _markBy: P, _markN: 2 };
S.enemies.push(foeN);
G.addProjectile(foeN.x + 2, foeN.y + 6, 4, 0, 30, { friendly: true, kind: 'arrow', style: 'ranged', element: 'frost', ownerRef: P, uLance: false, pierce: 0, life: 90, r: 5 });
G.updateProjectiles();
ok('control: a plain arrow (no uLance) never spawns a lance', !S.projectiles.some(pr => pr.kind === 'lance'));

// ===== 6) SEAM — Tidecaller Aegis perfect-dodge frost nova =====
equipByUniq('tidecalleraegis', false);
S.enemies.length = 0; S.projectiles.length = 0;
const foeF = { x: P.x + 30, y: P.y, w: 24, h: 24, hp: 300, maxHp: 300, def: 1, color: '#f00', hitFlash: 0 };
S.enemies.push(foeF);
P.dodge = 13; P.invuln = 15; P.hp = P.maxHp; const hpBefore = P.hp;
G.playerTakeDamage(60);
const frostP = S.projectiles.filter(pr => pr.friendly && pr.element === 'frost');
ok('uFrostNova: perfect dodge emits friendly frost projectiles', frostP.length >= 8, frostP.length);
ok('uFrostNova: perfect dodge negates the hit (no HP loss)', P.hp === hpBefore, P.hp);
ok('uFrostNova: nearby enemy is chilled', (foeF.chillT || 0) > 0, foeF.chillT);
// control: no aegis → no nova
G.equipArmor(iPlainA); G.recalcStats(); S.projectiles.length = 0; P.dodge = 13; P.invuln = 15;
G.playerTakeDamage(60);
ok('control: without Aegis a perfect dodge emits no nova', !S.projectiles.some(pr => pr.friendly && pr.element === 'frost'));

// ===== 7) SEAM — Shepherd Bell: +1 thrall cap =====
equipByUniq('shepherdsbell', true);
P.abilities.dominate = true; P.energy = 60; P.abilityCd.dominate = 0;
S.allies = [{ bound: true }, { bound: true }];
const elite = { elite: true, isBoss: false, isNemesis: false, isGreatBeast: false, hp: 10, maxHp: 100, warlordRef: null };
ok('uBell: canDominate TRUE with 2 bound thralls (cap 3)', G.canDominate(elite) === true);
G.equipWeapon(iPlainW); G.recalcStats();
ok('no uBell: canDominate FALSE with 2 bound thralls (cap 2)', G.canDominate(elite) === false);

// ===== 8) SEAM — Shepherd Bell: thralls detonate on expiry (afxHit gated) =====
equipByUniq('shepherdsbell', true);
S.enemies.length = 0; S.allies = [];
const foeB = { x: P.x + 20, y: P.y, w: 24, h: 24, hp: 400, maxHp: 400, def: 0, color: '#f00', hitFlash: 0 };
S.enemies.push(foeB);
S.allies.push({ x: P.x + 30, y: P.y, w: 22, h: 22, ally: true, name: 'Thrall', hp: 50, maxHp: 50, atk: 30, def: 1, life: 1, color: '#7cf', attackCd: 0, wobble: 0 });
const bHp0 = foeB.hp;
G.updateAllies();  // life 1 → --0 → detonate
ok('uBell: an expiring thrall detonates — nearby foe takes damage', foeB.hp < bHp0, bHp0 - foeB.hp);
ok('uBell: the expired thrall is removed', !S.allies.some(a => a.name === 'Thrall'));
// WARDED gate: detonation must respect afxHit (0 to a warded elite in its ward window)
S.enemies.length = 0; S.allies = [];
const warded = { x: P.x + 20, y: P.y, w: 24, h: 24, hp: 400, maxHp: 400, def: 0, color: '#f00', hitFlash: 0, _afxN: 1, afxWard: 1, wardT: 60, wardCd: 300, _wfT: 0 };
S.enemies.push(warded);
S.allies.push({ x: P.x + 30, y: P.y, w: 22, h: 22, ally: true, name: 'Thrall2', hp: 50, maxHp: 50, atk: 30, def: 1, life: 1, color: '#7cf', attackCd: 0, wobble: 0 });
const wHp0 = warded.hp;
G.updateAllies();
ok('WARDED gate: detonation deals 0 to a warded elite (afxHit respected)', warded.hp === wHp0, wHp0 - warded.hp);
// control: no bell → no detonation
G.equipWeapon(iPlainW); G.recalcStats(); S.enemies.length = 0; S.allies = [];
const foeC = { x: P.x + 20, y: P.y, w: 24, h: 24, hp: 400, maxHp: 400, def: 0, color: '#f00', hitFlash: 0 };
S.enemies.push(foeC); S.allies.push({ x: P.x + 30, y: P.y, w: 22, h: 22, ally: true, name: 'T3', hp: 50, maxHp: 50, atk: 30, def: 1, life: 1, color: '#7cf', attackCd: 0, wobble: 0 });
const cHp0 = foeC.hp; G.updateAllies();
ok('control: without Bell an expiring thrall does NOT detonate', foeC.hp === cHp0);

// ===== 9) SEAM — Gravewool Cloak: stand-still stealth + aggro break =====
equipByUniq('gravewoolcloak', false);
S.enemies.length = 0; S.pickups.length = 0;
for (const k in G.keys) G.keys[k] = false;
P.cloaked = false; P._stillT = 0; P.attacking = 0; P.dodge = 0; P.whirl = 0; P.ultT = 0;
for (let i = 0; i < 95; i++) G.updatePlayer();
ok('uCloak: ~90 still frames → cloaked=true', P.cloaked === true, '_stillT=' + P._stillT);
G.keys['d'] = true; G.updatePlayer(); G.keys['d'] = false;
ok('uCloak: moving instantly clears cloak + _stillT', P.cloaked === false && P._stillT === 0);
// a cloaked player is unseen by a plain foe
S.enemies.length = 0;
const stalker = { x: P.x + 20, y: P.y, w: 24, h: 24, hp: 100, maxHp: 100, def: 0, atk: 25, color: '#f00', hitFlash: 0, speed: 1, wobble: 0, attackCd: 0, windup: 0 };
S.enemies.push(stalker);
P.cloaked = true; P.hp = P.maxHp; P.invuln = 0;
for (let i = 0; i < 24; i++) G.updateEnemies();
ok('uCloak: cloaked player takes NO damage from a plain foe', P.hp === P.maxHp, 'hp=' + P.hp);
ok('uCloak: cloaked player never triggers the foe windup', !stalker.windup, 'windup=' + stalker.windup);
P.cloaked = false; P.hp = P.maxHp;
for (let i = 0; i < 48; i++) G.updateEnemies();
ok('un-cloaked: the same foe now engages (winds up / deals damage)', stalker.windup > 0 || P.hp < P.maxHp, 'hp=' + P.hp + ' windup=' + stalker.windup);

// ===== 10) afxHit gate (unit) =====
ok('afxHit: non-affixed enemy takes full damage', G.afxHit({ hp: 100, x: 0, y: 0, w: 24, h: 24 }, 50) === 50);
ok('afxHit: warded enemy in ward window takes 0', G.afxHit({ _afxN: 1, afxWard: 1, wardT: 60, hitFlash: 0, _wfT: 0, x: 0, y: 0, w: 24, h: 24 }, 50) === 0);
{ const sh = { _afxN: 1, afxShield: 1, shieldHp: 30, shieldMax: 30, hp: 100, x: 0, y: 0, w: 24, h: 24, hitFlash: 0 }; const dealt = G.afxHit(sh, 50); ok('afxHit: shielded enemy absorbs into the bubble first', dealt < 50 && sh.shieldHp < 30, 'dealt=' + dealt + ' shield=' + sh.shieldHp); }

// ===== 11) reforge / temper PRESERVE the uniq tag =====
equipByUniq('leviathanspine', true); P.gold = 999999;
const atk0 = spine.atk; G.temperWeapon();
ok('temper preserves uniq/uniqDesc and adds power', spine.uniq === 'leviathanspine' && !!spine.uniqDesc && spine.atk === atk0 + 2 && spine.temper === 1, 'atk ' + atk0 + '→' + spine.atk);
G.reforgeWeapon();
ok('reforge preserves uniq (only affixes change)', spine.uniq === 'leviathanspine');
G.recalcStats();
ok('reforge/temper: uLance still derives true afterwards', P.uLance === true);

// ===== 12) uniquesFound: pickup tracking + save round-trip =====
S.uniquesFound = [];
const freshCloak = { name: 'Gravewool Cloak', def: 22, rarity: 4, dur: 150, durMax: 150, equipped: false, uniq: 'gravewoolcloak', uniqDesc: 'x' };
S.pickups.length = 0; S.pickups.push({ x: P.x, y: P.y, w: 16, h: 16, kind: 'loot', value: { armor: freshCloak }, collected: false, bob: 0 });
for (const k in G.keys) G.keys[k] = false; G.updatePlayer();  // updatePlayer → checkPickups
ok('checkPickups: collecting a unique records it in uniquesFound', (S.uniquesFound || []).includes('gravewoolcloak'), JSON.stringify(S.uniquesFound));
S.uniquesFound = ['leviathanspine', 'gravewoolcloak'];
const snap = G.snapshot();
S.uniquesFound = [];
G.applySnapshot(snap);
ok('snapshot→applySnapshot preserves uniquesFound', JSON.stringify(S.uniquesFound) === JSON.stringify(['leviathanspine', 'gravewoolcloak']), JSON.stringify(S.uniquesFound));
ok('inventory unique survives the save round-trip (uniq tag intact)', S.inventory.weapons.some(w => w.uniq === 'leviathanspine'));
const snap2 = G.snapshot(); delete snap2.uniquesFound; G.applySnapshot(snap2);
ok('missing-field save defaults uniquesFound=[]', Array.isArray(S.uniquesFound) && S.uniquesFound.length === 0);
// applySnapshot zeroes the transient cloak scalars
ok('applySnapshot zeroes cloaked/_stillT (old saves default off)', S.player.cloaked === false && S.player._stillT === 0);

console.log('\n===== PINNACLE STAGE B — UNIQUES HEADLESS VERIFY =====');
out.forEach(l => console.log('  ' + l));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log(fail === 0 ? '  ✅ PINNACLE STAGE B OK' : '  ❌ FAILURES ABOVE');
process.exit(fail === 0 ? 0 : 1);
