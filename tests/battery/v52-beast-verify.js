'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// Great-Beast rescale reconciliation: _rescaleThreats must now CALL G.makeGreatBeast (no formula mirror).
// Asserts: fresh-spawn parity (no nerf), idempotency, huntCycle>0 respected, hp-ratio preserved, no side effects.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game.js');
const { World } = require(REPO + '/server/world.js');
const S = G.state;
const TILE = G.TILE || 32;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

const w = new World();
const A = w.addPlayer('A', 'Ava');
for (let i = 0; i < 4; i++) w.tick();

const h = G.GREAT_HUNTS[0];
const tx = Math.floor(A.x / TILE) + 3, ty = Math.floor(A.y / TILE) + 3;
const setCtx = (plvl, pn, cyc) => { A.level = plvl; S.player = A; S._partyLevel = plvl; S._partyN = pn; S.huntCycle = cyc; };

// ===== 1. FRESH-SPAWN PARITY: 5-player L25 beast, rescale at same state -> IDENTICAL (the 118->53 nerf is gone) =====
out.push('--- 1. fresh-spawn parity (5 players, L25, cyc0) ---');
{
  setCtx(25, 5, 0);
  const fresh = G.makeGreatBeast(h, tx, ty);
  const f = { atk: fresh.atk, hp: fresh.maxHp, xp: fresh.xp, gold: fresh.gold };
  S.enemies = [fresh];
  w._rescaleThreats(25);
  out.push('  fresh: atk=' + f.atk + ' hp=' + f.hp + ' xp=' + f.xp + ' gold=' + f.gold);
  out.push('  after: atk=' + fresh.atk + ' hp=' + fresh.maxHp + ' xp=' + fresh.xp + ' gold=' + fresh.gold);
  ok('rescale preserves fresh atk (no nerf)', fresh.atk === f.atk, f.atk + ' -> ' + fresh.atk);
  ok('rescale preserves fresh maxHp', fresh.maxHp === f.hp, f.hp + ' -> ' + fresh.maxHp);
  ok('rescale preserves fresh xp/gold', fresh.xp === f.xp && fresh.gold === f.gold);
  ok('hp stays full (undamaged)', fresh.hp === fresh.maxHp);
  ok('no side effects: S.enemies.length still 1', S.enemies.length === 1, 'len=' + S.enemies.length);
  ok('S._partyLevel restored after rescale', S._partyLevel === 25);
}

// ===== 2. IDEMPOTENT: rescale twice at one level -> identical =====
out.push('--- 2. idempotency ---');
{
  setCtx(25, 5, 0);
  const b = G.makeGreatBeast(h, tx, ty); S.enemies = [b];
  w._rescaleThreats(25); const a1 = b.atk, h1 = b.maxHp, x1 = b.xp, g1 = b.gold;
  w._rescaleThreats(25); const a2 = b.atk, h2 = b.maxHp, x2 = b.xp, g2 = b.gold;
  ok('twice at L25 -> identical atk/hp/xp/gold', a1 === a2 && h1 === h2 && x1 === x2 && g1 === g2, 'atk ' + a1 + '==' + a2 + ', hp ' + h1 + '==' + h2);
}

// ===== 3. RESCALE ADOPTS THE LIVE CURVE (the "no formula mirror" guard). v3.1.0: hunts are FLAT-leveled,
//         so a rescale is driven by PARTY SIZE + cycle, never player LEVEL (here 1p→5p, not L1→L25). =====
out.push('--- 3. rescale adopts the live curve (party SIZE + cycle, never player level) ---');
{
  setCtx(1, 1, 0);
  const b = G.makeGreatBeast(h, tx, ty);                      // spawned when the room held ONE hero
  const soloAtk = b.atk, soloHp = b.maxHp;
  setCtx(25, 5, 0);                                           // player level 25 is now IRRELEVANT; the PARTY grew to 5
  const want = G.makeGreatBeast(h, tx, ty);                   // what a FRESH spawn would be now (5 players)
  S.enemies = [b];
  w._rescaleThreats(25);
  out.push('  solo(1p): atk=' + soloAtk + ' hp=' + soloHp + '  ->  rescaled(5p): atk=' + b.atk + ' hp=' + b.maxHp + '  (fresh-now: atk=' + want.atk + ' hp=' + want.maxHp + ')');
  ok('rescaled == what the generator makes NOW (no formula mirror)', b.atk === want.atk && b.maxHp === want.maxHp, 'atk ' + b.atk + '==' + want.atk + ', hp ' + b.maxHp + '==' + want.maxHp);
  ok('grows with PARTY SIZE 1p→5p (hp ~×2.4 via pnh, atk ~×1.6 via pn)', b.maxHp > soloHp * 2 && b.atk > soloAtk * 1.4, 'hp ' + soloHp + '→' + b.maxHp + ', atk ' + soloAtk + '→' + b.atk);
  // v3.1.0 proof: player LEVEL alone (same 1 player, L1 vs L25) does NOTHING to a flat-leveled beast
  setCtx(1, 1, 0); const bl1 = G.makeGreatBeast(h, tx, ty); setCtx(25, 1, 0); const bl25 = G.makeGreatBeast(h, tx, ty);
  ok('player level alone (L1 vs L25, 1p) leaves the beast IDENTICAL', bl1.maxHp === bl25.maxHp && bl1.atk === bl25.atk, 'L1 ' + bl1.maxHp + ' vs L25 ' + bl25.maxHp);
}

// ===== 4. huntCycle>0 respected =====
out.push('--- 4. huntCycle respected ---');
{
  setCtx(25, 5, 0);
  const b0 = G.makeGreatBeast(h, tx, ty); S.enemies = [b0]; w._rescaleThreats(25);
  const atk0 = b0.atk, hp0 = b0.maxHp, xp0 = b0.xp;
  setCtx(25, 5, 2);                                           // two hunt cycles in
  const b2 = G.makeGreatBeast(h, tx, ty);                     // cycle-2 fresh spawn
  const c2 = { atk: b2.atk, hp: b2.maxHp };
  // now rescale a cycle-0-spawned beast under huntCycle=2: stats adopt the cycle-2 curve (loot stamp e.cycle untouched)
  setCtx(25, 5, 0); const bMix = G.makeGreatBeast(h, tx, ty); ok('spawn stamp e.cycle=0', bMix.cycle === 0);
  S.huntCycle = 2; S.enemies = [bMix]; w._rescaleThreats(25);
  out.push('  cyc0 rescaled: atk=' + atk0 + ' hp=' + hp0 + ' | cyc2 fresh: atk=' + c2.atk + ' hp=' + c2.hp + ' | cyc0-spawned rescaled under cyc2: atk=' + bMix.atk + ' hp=' + bMix.maxHp);
  ok('cyc2 rescale > cyc0 rescale (atk x~1.5, hp x~1.7)', bMix.atk > atk0 && bMix.maxHp > hp0, atk0 + ' -> ' + bMix.atk);
  ok('cyc2 rescale matches cyc2 fresh spawn', bMix.atk === c2.atk && bMix.maxHp === c2.hp);
  ok('xp scales with cycle too (cycRew)', bMix.xp > xp0, xp0 + ' -> ' + bMix.xp);
  ok('e.cycle loot stamp NOT retagged by rescale', bMix.cycle === 0, 'cycle=' + bMix.cycle);
  S.huntCycle = 0;
}

// ===== 5. hp RATIO preserved on a damaged beast =====
out.push('--- 5. damage-done preserved ---');
{
  setCtx(10, 3, 0);
  const b = G.makeGreatBeast(h, tx, ty); S.enemies = [b];
  b.hp = Math.round(b.maxHp * 0.4);                           // fought to 40%
  w._rescaleThreats(20);
  const ratio = b.hp / b.maxHp;
  ok('hp ratio ~0.4 after rescale', Math.abs(ratio - 0.4) < 0.01, 'ratio=' + ratio.toFixed(3));
  ok('maxHp grew (10 -> 20)', true, 'maxHp=' + b.maxHp);
}

console.log(out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
