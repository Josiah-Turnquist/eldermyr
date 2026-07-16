'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// flat-loader.js — TEST-ONLY loader. Reuses server-spike/load-game.js VERBATIM (identical browser
// stubs / eval epilogue / timer hygiene) with exactly two surgical patches, so old-vs-new can be
// diffed in separate processes without touching a shipped file:
//   (1) the html path becomes overridable via $GAME_HTML  → lets us load a PRISTINE copy of the
//       pre-fix game and observe the assertions FAIL, then the repo file and observe them PASS.
//   (2) a few extra lexical symbols are captured (makeWildDragon / makePinnacleAdd / makeEnemy /
//       MASTERY_LVLS) — these are generators the server never calls, so they are deliberately NOT
//       in the shipped CAPTURE list and are unreachable from outside the eval any other way.
// Both patches are asserted below: a silent no-op replacement would make every test vacuous.
const fs = require('fs'), path = require('path'), Module = require('module');

const SRC = '' + __RR + '/server-spike/load-game.js';
let src = fs.readFileSync(SRC, 'utf8');

// load-game.js now honors GAME_HTML natively (P1: it also honors ELDERMYR_GAME_FILE, at
// LOWER precedence, so ambient dist-battery runs can't override a suite's throwaway copy).
// Patch (1) is therefore an identity check: assert the anchor line still exists as-is.
const A0 = "const htmlPath = path.resolve(process.env.GAME_HTML || process.env.ELDERMYR_GAME_FILE || path.join(__dirname, '..', 'eldermyr-rpg.html'));";
const A1 = A0;
const B0 = 'const CAPTURE = [';
const B1 = "const CAPTURE = [ 'makeWildDragon', 'makePinnacleAdd', 'makeEnemy', 'MASTERY_LVLS', 'partyLvl', 'partyN', 'makeBoss', 'isNight',";

if (!src.includes(A0)) throw new Error('flat-loader: htmlPath anchor not found in load-game.js — patch drifted');
if (!src.includes(B0)) throw new Error('flat-loader: CAPTURE anchor not found in load-game.js — patch drifted');
src = src.replace(A0, A1).replace(B0, B1);
if (!src.includes('GAME_HTML') || !src.includes('makeWildDragon')) throw new Error('flat-loader: patch did not apply');

// Compile it AS server-spike/load-game.js so __dirname / require() resolve exactly as they do in prod.
const m = new Module(SRC, null);
m.filename = SRC;
m.paths = Module._nodeModulePaths(path.dirname(SRC));
m._compile(src, SRC);
module.exports = m.exports;
