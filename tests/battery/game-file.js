'use strict';
// game-file.js — TEST DEP (not a suite). The one resolver for "which game artifact does this
// suite read?" used by the suites that open the game SOURCE directly (static text probes and
// second evals). Mirrors server/load-game.js's precedence exactly:
//   GAME_HTML (suite-internal, e.g. a patched throwaway copy)
//   > ELDERMYR_GAME_FILE (ambient, e.g. CI aiming the battery at another artifact)
//   > <repo>/dist/eldermyr.html — THE single source since the P1 wrap. The frozen monolith
//     (eldermyr-rpg.html) is deleted; it lives on in the v2-final tag.
const path = require('path');
const fs = require('fs');
const DIST = path.resolve(__dirname, '..', '..', 'dist', 'eldermyr.html');

function gameFilePath() {
  const p = path.resolve(process.env.GAME_HTML || process.env.ELDERMYR_GAME_FILE || DIST);
  if (!fs.existsSync(p)) {
    throw new Error('game artifact not found: ' + p + (p === DIST ? ' — run `npm run build` first' : ''));
  }
  return p;
}

module.exports = { gameFilePath, DIST };
