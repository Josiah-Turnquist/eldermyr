'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/* facing-verify.js — does the creature-facing fix actually MIRROR, and is save/restore BALANCED?
   The shipped Proxy canvas stub no-ops save/restore/translate/scale, so it can neither catch an
   unbalanced pair nor tell us whether the art moved. So: a THROWAWAY copy of the game whose ONE
   patched line hands the main `ctx` to a counting wrapper that tracks the save-depth and the x
   affine (x' = a*x + e), records every draw op in world space, then forwards to the real stub.
   The repo file is never touched (proven by a git-diff check in run-facing-battery.sh). */
const fs = require('fs'), path = require('path'), os = require('os');

const REPO = require(path.join(__dirname, 'game-file.js')).gameFilePath();   // dist/eldermyr.html since the P1 wrap
const TMP = path.join(os.tmpdir(), 'facing-throwaway-' + process.pid + '.html');
const ANCHOR = "const ctx = canvas.getContext('2d');";
let src = fs.readFileSync(REPO, 'utf8');
if (!src.includes(ANCHOR)) throw new Error('ctx anchor drifted — patch would be vacuous');
src = src.replace(ANCHOR, "const ctx = globalThis.__COUNT_CTX(canvas.getContext('2d'));");
if (!src.includes('__COUNT_CTX')) throw new Error('patch did not apply');
fs.writeFileSync(TMP, src);
process.on('exit', () => { try { fs.unlinkSync(TMP); } catch (e) {} });

// ---- the counting ctx -------------------------------------------------------------------
const R = { depth: 0, maxDepth: 0, underflow: false, saves: 0, restores: 0, ops: [], rec: false };
let TX = { a: 1, e: 0 };            // x' = a*x + e
let stack = [];
const XARG = { arc: 0, ellipse: 0, fillRect: 0, strokeRect: 0, moveTo: 0, lineTo: 0, rect: 0, fillText: 1, arcTo: 0, quadraticCurveTo: 0 };
let FILL = '';   // the live fillStyle — recorded with every op so a test can point at ONE feature ("the maw", "the eye") instead of guessing from coordinates
globalThis.__COUNT_CTX = (real) => new Proxy({}, {
  get(_t, k) {
    if (k === 'save') return () => { stack.push({ a: TX.a, e: TX.e }); R.depth++; R.saves++; if (R.depth > R.maxDepth) R.maxDepth = R.depth; return real.save && real.save(); };
    if (k === 'restore') return () => { const p = stack.pop(); if (p) TX = p; R.depth--; R.restores++; if (R.depth < 0) R.underflow = true; return real.restore && real.restore(); };
    if (k === 'translate') return (x) => { TX.e += TX.a * x; };
    if (k === 'scale') return (sx) => { TX.a *= sx; };
    if (k === 'setTransform' || k === 'resetTransform') return () => { TX = { a: 1, e: 0 }; };
    const v = real[k];
    if (typeof v === 'function' || v === undefined) {
      return (...args) => {
        if (R.rec && k in XARG) { const raw = args[XARG[k]]; if (typeof raw === 'number') R.ops.push({ op: k, x: TX.a * raw + TX.e, mirrored: TX.a < 0, fill: FILL }); }
        try { return typeof v === 'function' ? v.apply(real, args) : undefined; } catch (e) { return undefined; }
      };
    }
    return v;
  },
  set(_t, k, v) { if (k === 'fillStyle') FILL = String(v); try { real[k] = v; } catch (e) {} return true; },
});

const reset = () => { R.depth = 0; R.maxDepth = 0; R.underflow = false; R.saves = 0; R.restores = 0; R.ops = []; TX = { a: 1, e: 0 }; stack = []; };

// ---- loader: load-game.js VERBATIM + two surgical test patches (same idiom as flat-loader.js).
// drawEnemy/makeEnemy/makeWildDragon are deliberately NOT in the shipped CAPTURE (the server never
// calls them — loop() reaches drawEnemy lexically), so a test can only get at them this way. The
// shipped list is NOT modified; this patch lives and dies in this process.
const Module = require('module');
const LG = '' + __RR + '/server-spike/load-game.js';
let lg = fs.readFileSync(LG, 'utf8');
// load-game.js honors GAME_HTML natively (highest precedence) since P1, defaulting to
// dist/eldermyr.html since the P1 wrap — no htmlPath patch needed; the anchor assertion
// below still guards against silent drift.
const A0 = "const htmlPath = path.resolve(process.env.GAME_HTML || process.env.ELDERMYR_GAME_FILE || path.join(__dirname, '..', 'dist', 'eldermyr.html'));";
const B0 = 'const CAPTURE = [';
if (!lg.includes(A0) || !lg.includes(B0)) throw new Error('load-game.js anchors drifted — patch would be vacuous');
lg = lg.replace(B0, "const CAPTURE = [ 'drawEnemy', 'makeEnemy', 'makeWildDragon',");
if (!lg.includes('drawEnemy')) throw new Error('CAPTURE patch did not apply');
const _m = new Module(LG, null);
_m.filename = LG; _m.paths = Module._nodeModulePaths(path.dirname(LG));
process.env.GAME_HTML = TMP;
_m._compile(lg, LG);
const G = _m.exports;
for (const n of ['drawEnemy', 'drawPlayer', 'updateEnemies', 'makeEnemy', 'makeWildDragon']) if (typeof G[n] !== 'function') throw new Error('capture failed: ' + n);
G.startGame();
const S = G.state;

let fails = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✅ ' : '  ❌ ') + m + (extra ? '  ' + extra : '')); if (!c) fails++; };

const capture = (fn) => { reset(); FILL = ''; R.rec = true; fn(); R.rec = false; return { ops: R.ops.slice(), balanced: R.depth === 0 && !R.underflow, saves: R.saves, restores: R.restores, depth: R.depth, underflow: R.underflow }; };
// A max-x over all ops does NOT find the head: the dragon's WINGS reach further than its skull and are
// symmetric, so max-x is identical either way. Point at one unmistakable feature instead, by the tone it
// is painted with — the maw fire / the eye. These are the exact literals in the shipped art.
const MAW = '#ff6020', DRAGON_EYE = '#ffe030', SERPENT_EYE = '#ffe060', CHARGER_EYE = '#ff3018';
const featX = (ops, fill) => { const f = ops.filter((o) => o.fill === fill); return f.length ? f[0].x : NaN; };
const headX = (ops) => Math.max(...ops.map((o) => o.x));
const tailX = (ops) => Math.min(...ops.map((o) => o.x));

console.log('\n=== 1. THE STEED (drawPlayer) — does it flip, and does the RIDER stay put? ===');
S.dragon = { tamed: true, mounted: true };
S.player.invuln = 0; S.player.cloaked = false; S.player.moving = true; S.player.skin = 0;
const perDir = {};
for (const dir of ['right', 'left', 'up', 'down']) {
  S.player.dir = dir;
  const r = capture(() => G.drawPlayer());
  perDir[dir] = r;
  ok(r.balanced, `dir=${dir}: save/restore balanced`, `(${r.saves} save / ${r.restores} restore, depth ${r.depth})`);
  ok(!r.ops.some((o) => o.mirrored && o.op === 'fillText'), `dir=${dir}: no TEXT drawn mirrored`);
}
ok(perDir.right.ops.some((o) => o.mirrored) === false, 'facing right → nothing is mirrored (identity transform)');
ok(perDir.left.ops.some((o) => o.mirrored) === true, 'facing left  → the steed IS drawn mirrored');
// drawPlayer draws a shadow/heat-glow preamble, THEN the steed, THEN the rider — so "the leading run of
// ops" is not the steed. Identify the steed by the transform flag itself, then compare those same op
// INDICES across the two captures (the op sequence is identical; only x differs). That is the strongest
// available proof: a true mirror about the hero's own centre, op for op.
const mIdx = perDir.left.ops.map((o, i) => (o.mirrored ? i : -1)).filter((i) => i >= 0);
const pcx = S.player.x - S.camera.x + S.player.w / 2;
ok(mIdx.length > 0 && mIdx.length < perDir.left.ops.length, 'the mirror is SCOPED — the steed is mirrored, the preamble and rider are not', `${mIdx.length} steed ops / ${perDir.left.ops.length - mIdx.length} preamble+rider ops`);
ok(mIdx.every((i) => !perDir.right.ops[i].mirrored), 'the SAME ops are unmirrored when facing right');
const worst = Math.max(...mIdx.map((i) => Math.abs(perDir.left.ops[i].x - (2 * pcx - perDir.right.ops[i].x))));
ok(worst < 0.01, 'every steed op is the EXACT mirror of itself about the hero centre (x → 2·cx − x)', `worst deviation ${worst.toFixed(4)}px over ${mIdx.length} ops`);
const nonSteed = perDir.left.ops.map((o, i) => i).filter((i) => !perDir.left.ops[i].mirrored);
ok(nonSteed.every((i) => perDir.left.ops[i].x === perDir.right.ops[i].x || i >= mIdx[mIdx.length - 1]), 'the preamble (shadow/heat glow) is drawn in world space either way');
// the maw fire is the wyrm's mouth — unambiguous, and it is NOT symmetric like the wings are
const mawR = featX(perDir.right.ops, MAW), mawL = featX(perDir.left.ops, MAW);
ok(mawL < pcx && mawR > pcx, 'the MAW crosses the hero: out front-right when facing right, front-left when facing left', `maw x: right=${mawR.toFixed(1)} → left=${mawL.toFixed(1)} (hero centre ${pcx.toFixed(1)})`);
ok(Math.abs((mawR + mawL) / 2 - pcx) < 0.01, 'the steed mirrors about the hero centre — it does not slide sideways when it turns');
ok(perDir.left.ops.slice(mIdx[mIdx.length - 1] + 1).every((o) => !o.mirrored), 'once restored, NOTHING is mirrored again (hero body/armour/cape clean)', `${perDir.left.ops.length - 1 - mIdx[mIdx.length - 1]} rider ops after restore`);
// up/down: the documented decision is "keep the side view, do not snap"
ok(!perDir.up.ops.some((o) => o.mirrored) && !perDir.down.ops.some((o) => o.mirrored), 'up/down → side view facing right (documented decision, matches the cape)');

console.log('\n=== 2. UNMOUNTED hero is untouched (no stray transform) ===');
S.dragon = { tamed: false, mounted: false };
for (const dir of ['right', 'left']) { S.player.dir = dir; const r = capture(() => G.drawPlayer()); ok(r.balanced && !r.ops.some((o) => o.mirrored), `on foot, dir=${dir}: no mirror, balanced`, `(${r.saves}/${r.restores})`); }
S.dragon = { tamed: true, mounted: true };

console.log('\n=== 3. THE WILD EMBERWYRM + SERPENT + CHARGER (drawEnemy) ===');
const mk = (type) => {
  const e = type === 'dragon' ? G.makeWildDragon(20, 20) : G.makeEnemy(20, 20, type);
  e.x = S.camera.x + 200; e.y = S.camera.y + 200; e.hitFlash = 0; e.tele = null; e.wobble = 1; e.hp = e.maxHp;
  if (type === 'charger') e.chargeState = 2, e.dvx = -3;
  return e;
};
const HEAD_TONE = { dragon: MAW, serpent: SERPENT_EYE, charger: CHARGER_EYE };
for (const type of ['dragon', 'serpent', 'charger']) {
  const e = mk(type);
  if (!e || e.type !== type) { ok(false, `${type}: could not build a real ${type} (got ${e && e.type})`); continue; }
  const right = capture(() => { e._faceL = 0; G.drawEnemy(e); });
  const left = capture(() => { e._faceL = 1; G.drawEnemy(e); });
  ok(right.balanced && left.balanced, `${type}: save/restore balanced both ways`, `(R ${right.saves}/${right.restores}, L ${left.saves}/${left.restores})`);
  ok(!right.ops.some((o) => o.mirrored), `${type}: _faceL=0 → unmirrored (pixel-identical to the shipped art)`);
  ok(left.ops.some((o) => o.mirrored), `${type}: _faceL=1 → mirrored`);
  const cx = e.x - S.camera.x + e.w / 2;
  // op-for-op exact mirror about the creature's OWN centre (else it teleports sideways when it turns)
  const idx = left.ops.map((o, i) => (o.mirrored ? i : -1)).filter((i) => i >= 0);
  const w = Math.max(...idx.map((i) => Math.abs(left.ops[i].x - (2 * cx - right.ops[i].x))));
  ok(w < 0.01, `${type}: every art op is the EXACT mirror about its own centre`, `worst ${w.toFixed(4)}px over ${idx.length} ops`);
  ok(left.ops.filter((o, i) => !o.mirrored).length === right.ops.filter((o, i) => !idx.includes(i)).length, `${type}: the same ops stay in world space both ways`);
  // the HEAD, located by the tone it is painted with (max-x finds the symmetric wings, not the skull)
  const hr = featX(right.ops, HEAD_TONE[type]), hl = featX(left.ops, HEAD_TONE[type]);
  ok(hr > cx && hl < cx, `${type}: the head leads RIGHT of centre facing right, LEFT of centre facing left`, `head x ${hr.toFixed(1)} → ${hl.toFixed(1)} (centre ${cx.toFixed(1)})`);
  ok(Math.abs((hr + hl) / 2 - cx) < 0.01, `${type}: mirrors about its OWN centre (no sideways slide)`, `axis=${((hr + hl) / 2).toFixed(1)} vs cx=${cx.toFixed(1)}`);
}
// the [E] TAME label must never be mirrored
{
  const e = mk('dragon'); e.subdued = true; e._faceL = 1;
  const r = capture(() => G.drawEnemy(e));
  ok(r.balanced, 'subdued wyrm facing left: balanced');
  ok(!r.ops.some((o) => o.op === 'fillText' && o.mirrored), '"[E] TAME" is drawn in world space, NOT mirrored');
}
// hit-flash / telegraph white-out must still work while mirrored
{
  const e = mk('dragon'); e._faceL = 1; e.hitFlash = 4;
  const r = capture(() => G.drawEnemy(e));
  ok(r.balanced, 'wyrm facing left WHILE flashing: balanced (flash branches keep their save/restore)');
}

console.log('\n=== 4. HYSTERESIS — a foe dead-level with you must not strobe ===');
{
  const e = mk('dragon');
  S.enemies = [e]; S.map = 'overworld';
  const p = S.player;
  // place(off): offset of the WYRM relative to the hero's column. off>0 → wyrm is right of the hero →
  // the hero is to its left → it should face LEFT. (Getting this backwards is easy; spell it out.)
  const place = (off) => { e.x = p.x + p.w / 2 - e.w / 2 + off; };
  e.y = p.y - 300;

  // park it dead-level with the hero, then jiggle by sub-deadzone noise for 400 frames
  place(0); e._faceL = 0;
  let flips = 0, prev = e._faceL;
  for (let i = 0; i < 400; i++) {
    place(Math.sin(i * 1.7) * 4.5);   // ±4.5px — inside the ±6 deadzone
    G.updateEnemies();
    if (e._faceL !== prev) { flips++; prev = e._faceL; }
  }
  ok(flips === 0, 'dead-level + ±4.5px jitter over 400 frames → ZERO flips (deadzone holds)', `flips=${flips}`);

  // a real, decisive crossing must still turn it
  e._faceL = 0; place(40); G.updateEnemies();
  ok(e._faceL === 1, 'wyrm 40px RIGHT of the hero (hero on its left) → turns to face left');
  place(-40); G.updateEnemies();
  ok(e._faceL === 0, 'wyrm 40px LEFT of the hero (hero on its right) → turns back to face right');

  // and the band is genuinely 12px wide (true hysteresis, not a strobe relocated to a new threshold)
  e._faceL = 1; place(-5); G.updateEnemies();
  ok(e._faceL === 1, 'facing left, hero only 5px to the right → HOLDS left (inside the band)');
  place(-7); G.updateEnemies();
  ok(e._faceL === 0, 'facing left, hero 7px to the right → flips (band exited)');
  e._faceL = 0; place(5); G.updateEnemies();
  ok(e._faceL === 0, 'facing right, hero only 5px to the left → HOLDS right (band is symmetric)');
  place(7); G.updateEnemies();
  ok(e._faceL === 1, 'facing right, hero 7px to the left → flips');
}

console.log('\n=== 5. NO facing state on creatures that do not have a front ===');
{
  const p = S.player;
  const others = ['slime', 'bat', 'skeleton', 'mage', 'archer', 'healer'];
  const built = others.map((t) => mk(t)).filter((e) => e);
  S.enemies = built;
  for (const e of built) { e.x = p.x - 200; e.y = p.y; }
  for (let i = 0; i < 30; i++) G.updateEnemies();
  const leaked = built.filter((e) => e._faceL !== undefined).map((e) => e.type);
  ok(leaked.length === 0, 'blobs/skulls never get a _faceL → 0 extra bytes on the MP wire for them', leaked.length ? 'LEAKED: ' + leaked : '(slime/bat/skeleton/mage/archer/healer all clean)');
}

console.log('\n' + (fails ? `❌ ${fails} FAILED` : '✅ ALL PASSED — creatures face where they travel, the mirror is scoped to the art, save/restore is balanced, and the deadzone kills the strobe.'));
process.exit(fails ? 1 : 0);
