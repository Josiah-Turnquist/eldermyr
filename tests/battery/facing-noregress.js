'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/* ZERO-REGRESSION PROOF: a creature facing RIGHT (_faceL falsy — the default, and what HEAD always drew)
   must be drawn EXACTLY as the last committed build drew it. Renders each creature under the game
   ASSEMBLED FROM git-HEAD's src/game/ and under one assembled from the working tree, through the same
   counting canvas, then diffs the op streams op-for-op. (P1 wrap: the monolith is deleted — both sides
   assemble shell + parts in manifest order; draw ops have no other guard, golden hashes {state,maps}.)
   P3/S3: coverage widened from the 3 facing kinds to ALL ELEVEN drawEnemy creatures (+ the steed) —
   this suite is the op-for-op oracle for the art migration into src/content/enemies.ts entry.draw
   hooks (HEAD side renders the inline branches, WT side the registry hooks; both must emit the
   identical op stream). Date.now()-driven wiggle only ever rides Y/alpha in the shipped art, so the
   recorded X streams stay deterministic — same property the 3-kind version always relied on.
   Run as: node facing-noregress.js <HEAD|WT>  — the parent forks both and compares the JSON. */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), Module = require('module');

const MODE = process.argv[2];
const LG = '' + __RR + '/server-spike/load-game.js';

if (!MODE) {
  const run = (m) => JSON.parse(cp.execSync(`node ${__filename} ${m}`, { maxBuffer: 1e9 }).toString());
  const a = run('HEAD'), b = run('WT');
  let fails = 0;
  const ok = (c, m, extra) => { console.log((c ? '  ✅ ' : '  ❌ ') + m + (extra ? '  ' + extra : '')); if (!c) fails++; };
  console.log('\n=== facing RIGHT (_faceL=0) must render EXACTLY as the shipped build ===');
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    ok(x.length === y.length, `${k}: same number of draw ops`, `HEAD ${x.length} vs now ${y.length}`);
    const diff = x.map((o, i) => (y[i] && o.op === y[i].op && Math.abs(o.x - y[i].x) < 1e-9 ? null : `#${i} ${o.op}@${o.x} → ${y[i] ? y[i].op + '@' + y[i].x : 'MISSING'}`)).filter(Boolean);
    ok(diff.length === 0, `${k}: every op identical to HEAD`, diff.length ? diff.slice(0, 3).join(' | ') : `${x.length} ops match`);
  }
  console.log('\n' + (fails ? `❌ ${fails} REGRESSION(S)` : '✅ Right-facing creatures are pixel-identical to the shipped build — the fix only ever ADDS the left-facing case.'));
  process.exit(fails ? 1 : 0);
}

// ---- child: render one build and print the op stream --------------------------------------------
// Both sides are the build's head+concat(parts)+tail (no namespace epilogue needed — load-game
// falls back to lexical capture, which every artifact supports).
const TMP = path.join(os.tmpdir(), `nr-${MODE}-${process.pid}.html`);
const read = MODE === 'HEAD'
  ? (f) => cp.execSync(`git -C ${__RR} show HEAD:${f}`, { maxBuffer: 1e9 }).toString()
  : (f) => fs.readFileSync(path.join(__RR, f), 'utf8');

// P3/S1: prepend the side's OWN content chunk, compiled exactly the way scripts/build.mjs
// does (src/content/index.ts → bundle → non-minified iife, "use strict" relocated into the
// IIFE body so the assembled classic script stays sloppy-mode). Without this, the first
// part that reads CONTENT crashes the assembled program (proven by omission in the S1
// report). A side with NO src/content (pre-S1 checkouts) legitimately skips the chunk —
// its parts hold the content inline and never read CONTENT.
function contentChunkFor(mode) {
  let names;
  if (mode === 'HEAD') {
    try {
      names = cp.execSync(`git -C ${__RR} ls-tree --name-only HEAD:src/content`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().split('\n').filter(Boolean);
    } catch (e) { return ''; }                       // no src/content at HEAD → no chunk
  } else {
    const d = path.join(__RR, 'src', 'content');
    if (!fs.existsSync(d)) return '';
    names = fs.readdirSync(d);
  }
  if (!names.includes('index.ts')) return '';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nr-content-${mode}-`));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} });
  for (const n of names) fs.writeFileSync(path.join(dir, n), read('src/content/' + n));
  const r = require('esbuild').buildSync({
    entryPoints: [path.join(dir, 'index.ts')], absWorkingDir: dir,   // deterministic file markers (cosmetically `// index.ts` here — this suite compares draw ops, not chunk text)
    bundle: true, write: false,
    format: 'iife', minify: false, sourcemap: false, target: 'es2022', platform: 'neutral',
  });
  let chunk = r.outputFiles[0].text;
  const PROLOGUE = '"use strict";\n(() => {\n';      // same relocation scripts/build.mjs performs
  if (chunk.startsWith(PROLOGUE)) chunk = '(() => {\n  "use strict";\n' + chunk.slice(PROLOGUE.length);
  return chunk;
}

const manifest = JSON.parse(read('src/game/manifest.json'));
let src = read('src/game/shell-head.html') + contentChunkFor(MODE) + manifest.map((f) => read('src/game/parts/' + f)).join('') + read('src/game/shell-tail.html');
const ANCHOR = "const ctx = canvas.getContext('2d');";
if (!src.includes(ANCHOR)) throw new Error('ctx anchor drifted');
src = src.replace(ANCHOR, "const ctx = globalThis.__COUNT_CTX(canvas.getContext('2d'));");
fs.writeFileSync(TMP, src);
process.on('exit', () => { try { fs.unlinkSync(TMP); } catch (e) {} });

const R = { ops: [], rec: false };
let TX = { a: 1, e: 0 }, stack = [];
const XARG = { arc: 0, ellipse: 0, fillRect: 0, strokeRect: 0, moveTo: 0, lineTo: 0, rect: 0, fillText: 1, arcTo: 0, quadraticCurveTo: 0 };
globalThis.__COUNT_CTX = (real) => new Proxy({}, {
  get(_t, k) {
    if (k === 'save') return () => { stack.push({ ...TX }); return real.save && real.save(); };
    if (k === 'restore') return () => { const p = stack.pop(); if (p) TX = p; return real.restore && real.restore(); };
    if (k === 'translate') return (x) => { TX.e += TX.a * x; };
    if (k === 'scale') return (sx) => { TX.a *= sx; };
    const v = real[k];
    if (typeof v === 'function' || v === undefined) return (...args) => {
      if (R.rec && k in XARG) { const raw = args[XARG[k]]; if (typeof raw === 'number') R.ops.push({ op: k, x: TX.a * raw + TX.e }); }
      try { return typeof v === 'function' ? v.apply(real, args) : undefined; } catch (e) { return undefined; }
    };
    return v;
  },
  set(_t, k, v) { try { real[k] = v; } catch (e) {} return true; },
});

// GAME_HTML is honored natively by load-game.js since P1 (highest precedence) — only the
// CAPTURE patch remains.
let lg = fs.readFileSync(LG, 'utf8')
  .replace('const CAPTURE = [', "const CAPTURE = [ 'drawEnemy', 'makeEnemy', 'makeWildDragon', 'makeKraken', 'makeBoss',");
const m = new Module(LG, null);
m.filename = LG; m.paths = Module._nodeModulePaths(path.dirname(LG));
process.env.GAME_HTML = TMP;
m._compile(lg, LG);
const G = m.exports;
G.startGame();
const S = G.state;
S.dragon = { tamed: true, mounted: true };            // pre-S10 engines (the HEAD side) read the root key
S.player.dragon = { tamed: true, mounted: true };     // post-S10 engines read the player (P2/S10) — set BOTH so either side of the HEAD/WT diff mounts up
S.player.invuln = 0; S.player.moving = true; S.player.skin = 0; S.player.dir = 'right'; S.player.animFrame = 1;
S.player.heat = 0; S.player.cloaked = false;

const grab = (fn) => { R.ops = []; TX = { a: 1, e: 0 }; stack = []; R.rec = true; fn(); R.rec = false; return R.ops.slice(); };
const out = {};
out.steed = grab(() => G.drawPlayer());
// P3/S3: every drawEnemy kind, built by its REAL factory (kraken/boss have no makeEnemy row).
const FACTORY = { dragon: () => G.makeWildDragon(20, 20), kraken: () => G.makeKraken(20, 20), boss: () => G.makeBoss(20, 20) };
for (const type of ['slime', 'bat', 'skeleton', 'mage', 'charger', 'archer', 'healer', 'serpent', 'dragon', 'kraken', 'boss']) {
  const e = FACTORY[type] ? FACTORY[type]() : G.makeEnemy(20, 20, type);
  e.x = S.camera.x + 200; e.y = S.camera.y + 200; e.hitFlash = 0; e.tele = null; e.wobble = 1; e.hp = e.maxHp;
  if (type === 'charger') { e.chargeState = 2; e.dvx = 3; }   // dvx>0 = running RIGHT: the shipped case the smear fix must not disturb
  e._faceL = 0;
  out[type] = grab(() => G.drawEnemy(e));
}
process.stdout.write(JSON.stringify(out));
