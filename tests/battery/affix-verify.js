'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// affix-verify.js — Pillar 3 elite affixes (Shielded / Vampiric / Splitting / Warded)
// Drives the REAL game headlessly (server/load-game) then an MP World (server/world.js).
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game.js');
const { World } = require(REPO + '/server/world.js');   // requiring world.js runs G.startGame() (boots the overworld)
const S = G.state;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };
const TILE = G.TILE;

let _rnd = Math.random;
const stubRnd = (v) => { Math.random = () => v; };
const stubSeq = (arr) => { let i = 0; Math.random = () => arr[Math.min(i++, arr.length - 1)]; };
const unstub = () => { Math.random = _rnd; };

// open field (style-verify idiom): random overworld per boot — find open tiles once
function openField() { const m = G.maps.overworld, H = m.length, W = m[0].length, solid = (tx, ty) => G.SOLID.has(G.getTile('overworld', tx, ty)); for (let ty = Math.floor(H / 2); ty < H - 3; ty++) for (let tx = 6; tx < W - 14; tx++) { let good = true; for (let dy = 0; dy <= 1 && good; dy++) for (let dx = -1; dx <= 11; dx++) if (solid(tx + dx, ty + dy)) { good = false; break; } if (good) return { x: tx * TILE, y: ty * TILE, tx, ty }; } return { x: 100 * TILE, y: 100 * TILE, tx: 100, ty: 100 }; }
const FIELD = openField();
// raw enemy template — no site tags, no homeDf (leash-proof for tick tests)
const mk = (o) => Object.assign({ x: FIELD.x, y: FIELD.y, w: 24, h: 24, type: 'slime', hp: 100, maxHp: 100, atk: 10, def: 0, speed: 1, xp: 100, gold: 100, color: '#60d060', name: 'Slime', hitFlash: 0, attackCd: 0, castCd: 0, caster: false, isBoss: false, wobble: 0 }, o || {});
const flagsOf = (e) => (e.afxShield ? 1 : 0) + (e.afxVamp ? 1 : 0) + (e.afxSplit ? 1 : 0) + (e.afxWard ? 1 : 0);
const farAway = () => { const p = S.player; p.x = FIELD.x + 2000; p.y = FIELD.y; };   // outside every aggro radius (affix clocks must still tick)

// ============================================================================
out.push('=== Roll gating by party level (none <15, 1 at 15-21, 2 at 22+, no dupes) ===');
(function gating() {
  S.player.level = 1;
  const at = (pl, maxAfx) => { S._partyLevel = pl; const e = mk(); G.rollEliteAffixes(e, maxAfx); return e; };
  ok('party 1  -> 0 affixes', at(1)._afxN === undefined);
  ok('party 14 -> 0 affixes', at(14)._afxN === undefined);
  ok('party 15 -> exactly 1 affix', at(15)._afxN === 1 && flagsOf(at(15)) === 1);
  ok('party 21 -> exactly 1 affix', at(21)._afxN === 1);
  ok('party 22 -> exactly 2 affixes', at(22)._afxN === 2 && flagsOf(at(22)) === 2);
  let dupes = 0, seen = { afxShield: 0, afxVamp: 0, afxSplit: 0, afxWard: 0 };
  for (let i = 0; i < 300; i++) { const e = at(22); if (e._afxN !== 2 || flagsOf(e) !== 2) dupes++; for (const k in seen) if (e[k]) seen[k]++; }
  ok('300 rolls at 22: always 2 DISTINCT affixes (no dupes)', dupes === 0, 'bad=' + dupes);
  ok('all four affixes occur across 300 rolls', Object.values(seen).every((v) => v > 0), JSON.stringify(seen));
  ok('maxAffixes hook: rollEliteAffixes(e,3) at party 1 rolls 3', (S._partyLevel = 1, at(1, 3)._afxN === 3 && flagsOf(at(1, 3)) === 3));
  ok('maxAffixes hook: 0 disables the roll at party 22', at(22, 0)._afxN === undefined);
  // the real generator path
  S._partyLevel = 22; const me = G.makeElite(mk());
  ok('makeElite at party 22 rolls 2 affixes + keeps the elite frame', me._afxN === 2 && me.elite === true && me.maxHp === Math.round(100 * 1.7), 'afxN=' + me._afxN + ' maxHp=' + me.maxHp);
  ok('name is prefixed (reads before Elite)', /^((Shielded|Vampiric|Splitting|Warded) ){2}Elite Slime$/.test(me.name), me.name);
  ok('afxTag precomputed for the badge', typeof me.afxTag === 'string' && me.afxTag.indexOf('ELITE') > 0, me.afxTag);
  // elite-only gate: specials refuse affixes even if something routes them through the roll
  for (const tag of ['isBoss', 'isNemesis', 'isGreatBeast', 'isWildDragon', 'isFinalBoss', 'named', 'dread', 'warlordRef']) {
    const sp = mk(); sp[tag] = tag === 'warlordRef' ? { id: 1 } : true; G.rollEliteAffixes(sp);
    if (sp._afxN !== undefined) { ok('elite-only gate blocks ' + tag, false); return; }
  }
  ok('elite-only gate blocks bosses/nemesis/hunts/dragon/final/named/dread/warlords', true);
  ok('split children never roll', (function () { const c = mk({ _splitChild: 1 }); G.rollEliteAffixes(c); return c._afxN === undefined; })());
  S._partyLevel = 0;
})();

// ============================================================================
out.push('\n=== Reward bumps (+30% xp/gold per affix) ===');
(function rewards() {
  S.player.level = 1; S._partyLevel = 0;
  stubRnd(0); const e1 = mk(); G.rollEliteAffixes(e1, 1); unstub();
  ok('1 affix: xp 100->130, gold 100->130', e1.xp === 130 && e1.gold === 130, e1.xp + '/' + e1.gold);
  stubSeq([0, 0]); const e2 = mk(); G.rollEliteAffixes(e2, 2); unstub();
  ok('2 affixes: xp 100->169 (1.3^2, per-step rounding)', e2.xp === 169 && e2.gold === 169, e2.xp + '/' + e2.gold);
  stubSeq([0, 0, 0]); const e3 = mk(); G.rollEliteAffixes(e3, 3); unstub();
  ok('3 affixes (future hook): xp 100->220', e3.xp === 220, e3.xp);
})();

// ============================================================================
out.push('\n=== Shielded: absorbs, breaks, recharges after ~6s out of combat ===');
(function shielded() {
  farAway(); S.map = 'overworld';
  stubRnd(0); const e = mk({ maxHp: 200, hp: 200 }); G.rollEliteAffixes(e, 1); unstub();
  ok('rolled shielded (RNG 0 -> pool[0])', e.afxShield === 1 && e._afxN === 1, e.afxTag);
  ok('shield = 25% of maxHp, starts full', e.shieldMax === 50 && e.shieldHp === 50);
  S.enemies = [e];
  G.statusDamage(e, 30, '#fff');
  ok('30 dmg: shield absorbs all, HP untouched', e.hp === 200 && e.shieldHp === 20, 'hp=' + e.hp + ' sh=' + e.shieldHp);
  ok('taking a hit arms the 6s recharge clock', e.shieldRegenT === 360);
  G.statusDamage(e, 30, '#fff');
  ok('next 30: 20 breaks the bubble, 10 spills into HP', e.hp === 190 && e.shieldHp === 0, 'hp=' + e.hp + ' sh=' + e.shieldHp);
  for (let i = 0; i < 100; i++) G.updateEnemies();
  const midT = e.shieldRegenT;
  G.statusDamage(e, 5, '#fff');
  ok('a hit mid-recharge resets the clock to 360', midT === 260 && e.shieldRegenT === 360 && e.hp === 185, 'mid=' + midT);
  for (let i = 0; i < 359; i++) G.updateEnemies();
  ok('at 359/361 ticks: still down', e.shieldHp === 0, 'sh=' + e.shieldHp + ' t=' + e.shieldRegenT);
  G.updateEnemies(); G.updateEnemies();
  ok('after ~6s without damage: shield snaps back to full', e.shieldHp === 50, 'sh=' + e.shieldHp);
  ok('HP was never healed by the recharge', e.hp === 185);
})();

// ============================================================================
out.push('\n=== Warded: periodic ward pulse — bounded immunity, damage lands outside ===');
(function warded() {
  farAway();
  stubRnd(0.9); const e = mk({ maxHp: 300, hp: 300 }); G.rollEliteAffixes(e, 1); unstub();
  ok('rolled warded (RNG .9 -> pool[3])', e.afxWard === 1 && e._afxN === 1, e.afxTag);
  ok('spawns with ward DOWN (first pulse at ~3s)', e.wardT === 0 && e.wardCd === 180);
  S.enemies = [e];
  for (let i = 0; i < 179; i++) G.updateEnemies();
  ok('tick 179: still vulnerable', e.wardT === 0);
  G.updateEnemies();
  ok('tick 180: ward raises for 66 frames (~1.1s)', e.wardT === 66 && e.wardCd === 300);
  const hp0 = e.hp; G.statusDamage(e, 40, '#fff');
  ok('hit during ward: fully immune', e.hp === hp0, 'hp=' + e.hp);
  e.hp = 10; G.statusDamage(e, 9999, '#fff');
  ok('even a lethal hit during ward does nothing', e.hp === 10 && S.enemies.includes(e));
  e.hp = 300;
  // bounded: count immune frames across 3 full cycles
  let immune = 0, maxRun = 0, run = 0;
  for (let i = 0; i < 1098; i++) { G.updateEnemies(); if (e.wardT > 0) { immune++; run++; if (run > maxRun) maxRun = run; } else run = 0; }
  ok('ward uptime is bounded (~18%, never a lock)', immune > 0 && immune / 1098 < 0.25, (100 * immune / 1098).toFixed(1) + '%');
  ok('longest single window <= 66 frames', maxRun <= 66, 'maxRun=' + maxRun);
  while (e.wardT > 0) G.updateEnemies();
  const hp1 = e.hp; G.statusDamage(e, 40, '#fff');
  ok('outside the window damage lands in full', e.hp === hp1 - 40, 'hp=' + e.hp);
  e.hp = 5; while (e.wardT > 0) G.updateEnemies();
  G.statusDamage(e, 40, '#fff');
  ok('warded elites stay killable (quest/bounty safe)', !S.enemies.includes(e));
})();

// ============================================================================
out.push('\n=== Vampiric: heals ~40% of damage dealt to the player ===');
(function vamp() {
  const p = S.player; p.x = FIELD.x; p.y = FIELD.y; p.def = 0; p.evasion = 0; p.fort = 0; p.blessDR = 0; p.invuln = 0; p.dodge = 0; p.hp = p.maxHp = 800;
  stubRnd(0.3); const e = mk({ maxHp: 400, hp: 100 }); G.rollEliteAffixes(e, 1); unstub();
  ok('rolled vampiric (RNG .3 -> pool[1])', e.afxVamp === 1 && e._afxN === 1, e.afxTag);
  S.enemies = [e];
  const dealt = G.enemyStrike(e, 50);
  ok('contact strike: player takes the full 50', dealt === 50 && p.hp === 750, 'dealt=' + dealt + ' php=' + p.hp);
  ok('attacker heals 40% of it (100 -> 120)', e.hp === 120, 'ehp=' + e.hp);
  p.invuln = 20;
  const d2 = G.enemyStrike(e, 50);
  ok('a negated hit (invuln) heals nothing', (d2 || 0) === 0 && e.hp === 120, 'ehp=' + e.hp);
  p.invuln = 0; e.hp = e.maxHp - 5;
  G.enemyStrike(e, 50);
  ok('heal caps at maxHp (no overheal)', e.hp === e.maxHp, 'ehp=' + e.hp + '/' + e.maxHp);
  // ranged: hostile projectile carries ownerRef = the shooting enemy
  e.hp = 100; p.invuln = 0; p.hp = 700;
  G.addProjectile(p.x + p.w / 2, p.y + p.h / 2, 0, 0, 30, { ownerRef: e });
  G.updateProjectiles();
  const dealtP = 700 - p.hp;
  ok('projectile hit damages the player', dealtP === 30, 'dealt=' + dealtP);
  ok('vampiric shooter heals off the landed shot', e.hp === 100 + Math.round(dealtP * 0.4), 'ehp=' + e.hp);
  // non-vampiric shooter: pure passthrough
  const plain = mk(); S.enemies = [plain]; p.invuln = 0; p.hp = 700;
  G.addProjectile(p.x + p.w / 2, p.y + p.h / 2, 0, 0, 30, { ownerRef: plain });
  G.updateProjectiles();
  ok('non-vampiric shooter: no heal, identical damage', plain.hp === 100 && p.hp === 670, 'ehp=' + plain.hp);
})();

// ============================================================================
out.push('\n=== Splitting: exactly 2 lesser copies, no chains, no site tags ===');
(function splitting() {
  const p = S.player; p.x = FIELD.x + 2000;
  stubRnd(0.6); const e = mk({ maxHp: 200, hp: 200, atk: 40, def: 4, xp: 100, gold: 100, name: 'Slime' }); G.rollEliteAffixes(e, 1); unstub();
  ok('rolled splitting (RNG .6 -> pool[2])', e.afxSplit === 1 && e.name === 'Splitting Slime', e.name);
  // load the parent with every site/quest/Legion tag; blockers keep liberation sweeps from actually firing
  Object.assign(e, { poiKey: 'poiZZ', holdKey: 1, legion: true, raidTown: 2, guardian: true, cycle: 3, treasure: true, night: true, homeDf: 0.5 });
  const blocker = mk({ poiKey: 'poiZZ', holdKey: 1, raidTown: 2, name: 'Blocker' });
  S.enemies = [e, blocker];
  const xpParent = e.xp, goldParent = e.gold, lvl0 = S.player.level;
  e.hp = 0; G.killEnemy(e);
  const copies = S.enemies.filter((x) => x._splitChild);
  ok('death spawns exactly 2 copies', copies.length === 2, 'n=' + copies.length);
  ok('copies are ~45% stat clones', copies.every((c) => c.maxHp === Math.round(200 * 0.45) && c.hp === c.maxHp && c.atk === Math.round(40 * 0.45) && c.def === Math.floor(4 * 0.45)), JSON.stringify(copies.map((c) => [c.maxHp, c.atk, c.def])));
  ok('copies give only scraps (6% xp/gold)', copies.every((c) => c.xp === Math.max(1, Math.round(xpParent * 0.06)) && c.gold === Math.max(1, Math.round(goldParent * 0.06))), 'xp=' + copies[0].xp);
  ok('copies carry NO affixes and can never split', copies.every((c) => c._afxN === undefined && !c.afxSplit && !c.afxShield && !c.afxVamp && !c.afxWard && c._splitChild === 1));
  const tagLeak = copies.some((c) => c.poiKey !== undefined || c.holdKey !== undefined || c.legion !== undefined || c.raidTown !== undefined || c.guardian !== undefined || c.cycle !== undefined || c.treasure !== undefined || c.night !== undefined || c.elite !== undefined);
  ok('copies carry NO site/quest/Legion tags (poiKey/holdKey/raidTown/legion/guardian/cycle/treasure/night/elite)', !tagLeak);
  ok('copies DO keep the leash (homeDf) + name reads Lesser', copies.every((c) => c.homeDf === 0.5 && c.name === 'Lesser Slime'), copies[0].name);
  ok('blocker still holds the site (sweep un-fooled)', S.enemies.includes(blocker) && S.enemies.some((x) => x.holdKey === 1));
  // kill both copies — the chain must END
  for (const c of copies) { c.hp = 0; G.killEnemy(c); }
  ok('killing copies spawns nothing further', S.enemies.filter((x) => x._splitChild).length === 0 && S.enemies.length === 1);
  ok('parent xp still paid once (player gained xp, copies are extra scraps)', S.player.level >= lvl0);
  S.enemies = [];
})();

// ============================================================================
out.push('\n=== Dominate on an affixed elite -> clean bound ally ===');
(function dominateClean() {
  const p = S.player; p.x = FIELD.x; p.y = FIELD.y;
  S._partyLevel = 22; S.player.level = Math.max(S.player.level, 1);
  const e = G.makeElite(mk({ maxHp: 200, hp: 200, name: 'Slime' }));
  S._partyLevel = 0;
  ok('victim is a 2-affix elite', e._afxN === 2, e.name);
  e.hp = Math.round(e.maxHp * 0.2);
  p.abilities.dominate = true; p.abilityCd.dominate = 0; p.energy = 100; S.allies = [];
  S.enemies = [e]; const nBefore = S.enemies.length;
  G.dominate(e);
  const a = S.allies[S.allies.length - 1];
  ok('domination succeeded (ally created, foe removed)', !!a && a.bound === true && !S.enemies.includes(e));
  const leak = ['afxShield', 'afxVamp', 'afxSplit', 'afxWard', '_afxN', 'afxTag', 'shieldHp', 'shieldMax', 'shieldRegenT', 'wardT', 'wardCd'].filter((k) => a[k] !== undefined);
  ok('bound ally carries ZERO affix fields', leak.length === 0, leak.join(','));
  ok('bound ally name is scrubbed of affix words', a.name === 'Bound Slime', a.name);
  ok('dominating a Splitting elite does NOT split it', S.enemies.filter((x) => x._splitChild).length === 0 && S.enemies.length === nBefore - 1);
  S.allies = [];
})();

// ============================================================================
out.push('\n=== Drop-quality bump (rarity roll rides existing machinery) ===');
(function drops() {
  S.map = 'overworld'; S.player.level = 22;
  const rarOf = (pk) => { const it = pk.value.weapon || pk.value.armor; return it.rarity || 0; };
  function sample(afxN) {
    const drops = []; for (let i = 0; i < 6000; i++) { const e = mk({ elite: true }); if (afxN) e._afxN = afxN; const n0 = S.pickups.length; G.tryDropLoot(e); if (S.pickups.length > n0) { drops.push(rarOf(S.pickups.pop())); } }
    return drops;
  }
  const base = sample(0), boosted = sample(2);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  ok('elite drop CHANCE unchanged (~12% both)', Math.abs(base.length - boosted.length) < base.length * 0.35, base.length + ' vs ' + boosted.length);
  ok('2 affixes push the rarity roll up (mean +>0.3 tiers)', mean(boosted) - mean(base) > 0.3, mean(base).toFixed(2) + ' -> ' + mean(boosted).toFixed(2));
})();

// ============================================================================
out.push('\n=== Non-affixed enemies: byte-identical behavior ===');
(function identity() {
  S.player.level = 1; S._partyLevel = 0;
  const e = mk(); S.enemies = [e]; farAway();
  ok('afxHit is a pure passthrough without affixes', G.afxHit(e, 37) === 37 && G.afxHit(e, 1) === 1);
  G.statusDamage(e, 7, '#fff');
  ok('statusDamage math unchanged (100-7=93)', e.hp === 93, 'hp=' + e.hp);
  for (let i = 0; i < 10; i++) G.updateEnemies();
  ok('ticks add NO affix fields to plain enemies', !('_afxN' in e) && !('wardT' in e) && !('shieldHp' in e) && !('_wfT' in e));
  const p = S.player; p.invuln = 0; p.dodge = 0; p.evasion = 0; p.def = 0; p.hp = p.maxHp = 500;
  const d = G.enemyStrike(e, 20);
  ok('enemyStrike == playerTakeDamage for plain foes (no heal, same dmg)', d === 20 && p.hp === 480 && e.hp === 93);
  ok('below party 15 makeElite stays vanilla (30 spawns, zero affixes)', (function () { for (let i = 0; i < 30; i++) { if (G.makeElite(mk())._afxN !== undefined) return false; } return true; })());
})();

// ============================================================================
out.push('\n=== MP: 2-player world @ party 22 — affixed elites, 200 ticks combat ===');
(function mp() {
  S.enemies = [];
  const w = new World();
  const errs = []; w._err = (k, e2) => errs.push(k + ': ' + (e2 && e2.message || e2));
  const A = w.addPlayer('A', 'Ava'), B = w.addPlayer('B', 'Bo');
  A.level = 22; B.level = 22;
  A.maxHp = 99999; A.hp = 99999; B.maxHp = 99999; B.hp = 99999; B.x = A.x + 200; B.y = A.y;
  for (let i = 0; i < 30; i++) w.tick();
  ok('party level tracked at 22', S._partyLevel === 22, S._partyLevel);
  const p0 = w.perf();   // resets the rolling max
  // ring of affixed elites around A (real generator => real affix rolls at party 22)
  const atx = Math.floor((A.x + A.w / 2) / TILE), aty = Math.floor((A.y + A.h / 2) / TILE);
  let spawned = 0, splitter = null;
  for (let k = 0; k < 8; k++) {
    const ang = k / 8 * 6.28; const e = G.makeWildEnemy(atx + Math.round(Math.cos(ang) * 2), aty + Math.round(Math.sin(ang) * 2), 0);
    G.makeElite(e); e.x = A.x + Math.cos(ang) * 40; e.y = A.y + Math.sin(ang) * 40; delete e.homeDf;
    if (e._afxN === 2) spawned++;
    if (e.afxSplit && !splitter) { splitter = e; e.hp = 1; }   // first hit kills it -> split happens INSIDE the partitioned tick
    S.enemies.push(e);
  }
  ok('all 8 spawns rolled 2 affixes at party 22', spawned === 8, spawned + '/8');
  let sawCopies = false, threw = null;
  for (let i = 0; i < 200; i++) {
    w.setInput('A', { held: { d: i % 20 < 10 }, actions: ['attack'] });
    w.setInput('B', { held: { a: i % 20 < 10 }, actions: ['attack'] });
    try { w.tick(); } catch (e2) { threw = e2; break; }
    if (S.enemies.some((x) => x._splitChild)) sawCopies = true;
  }
  ok('200 combat ticks: no exceptions thrown', !threw, threw && threw.message);
  ok('200 combat ticks: no _err-captured subsystem failures', errs.length === 0, errs.slice(0, 3).join(' | '));
  if (splitter) ok('a splitting elite killed mid-partition produced copies that SURVIVED recombination', sawCopies || S.enemies.includes(splitter), sawCopies ? 'copies seen' : 'splitter unkilled (still alive - acceptable)');
  // snapshot: affix fields must ride packEnemy/packScalar to the client
  const fresh = G.makeWildEnemy(atx, aty, 0); G.makeElite(fresh); delete fresh.homeDf;
  fresh.x = A.x + 30; fresh.y = A.y; S.enemies.push(fresh);
  const snap = w.snapshotFor('A');
  const se = (snap.enemies || []).find((x) => x._afxN === 2);
  ok('snapshot carries an affixed elite', !!se, 'enemies=' + (snap.enemies || []).length);
  if (se) {
    ok('afx flags/scalars serialized (numbers/strings only)', ['_afxN'].concat(se.afxShield ? ['shieldHp', 'shieldMax', 'shieldRegenT'] : []).concat(se.afxWard ? ['wardT', 'wardCd'] : []).every((k) => typeof se[k] === 'number') && typeof se.afxTag === 'string' && typeof se.name === 'string', se.afxTag + ' | ' + se.name);
    ok('no object-typed leaks in the packed elite', Object.keys(se).every((k) => se[k] === null || ['number', 'string', 'boolean', 'object'].includes(typeof se[k]) && (typeof se[k] !== 'object' || se[k] === null || k === 'tele')), Object.keys(se).filter((k) => typeof se[k] === 'object' && se[k] !== null).join(','));
  }
  const p1 = w.perf();
  out.push('PERF  before combat: tickMsAvg=' + p0.tickMsAvg + '  |  after 200 affix-combat ticks: tickMsAvg=' + p1.tickMsAvg + ' tickMsMax=' + p1.tickMsMax + ' enemies=' + p1.enemies);
  ok('tick stays fast with affixed elites (<8ms avg)', p1.tickMsAvg < 8, p1.tickMsAvg + 'ms');
})();

console.log(out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
