'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/*
 * qrender.js — get the REAL updateQuests() out of the game artifact and record
 * what it actually paints. NOT a formula mirror: this evals the artifact's own
 * <script> (same extraction load-game.js uses) and calls the game's own function.
 *
 * The server's CAPTURE list has no 'updateQuests' (the server never renders the box —
 * only client/mp.html does, via window.updateQuests). So we do a SECOND eval to obtain
 * the binding. That second instance's `state` is the game's DEFAULT state literal —
 * i.e. exactly a fresh MP client that has run startGame() but adopted nothing yet.
 */
const fs = require('fs');
const path = require('path');

// requiring load-game installs the browser stubs (window/document/localStorage/timers) globally
require(path.join(__RR, 'server-spike', 'load-game.js'));

const htmlPath = require(path.join(__dirname, 'game-file.js')).gameFilePath();   // dist/eldermyr.html since the P1 wrap
const html = fs.readFileSync(htmlPath, 'utf8');
const a = html.indexOf('<script>'); const b = html.indexOf('</script>', a);
let code = html.slice(a + '<script>'.length, b);
code += '\n;try{ autosaveStarted = true; }catch(_e){}\n';
// The artifact keeps autosaveStarted on the __g globals holder (the bare latch above throws
// there, caught) — latch the holder too, same dual path load-game.js uses.
code += '\n;try{ if (globalThis.__g && ("autosaveStarted" in globalThis.__g)) globalThis.__g.autosaveStarted = true; }catch(_e){}\n';
code += '\n;try{ Sound.startMusic = function(){}; }catch(_e){}\n';
// capture ONLY what the client's adoptQuests touches + the renderer itself
code += '\n;globalThis.__cg = {};' +
  ['state', 'updateQuests'].map((n) => `try{ globalThis.__cg[${JSON.stringify(n)}] = ${n}; }catch(_e){}`).join('\n');

// This SECOND eval of the artifact re-runs its `globalThis.__g = __g` and
// `globalThis.Eldermyr = {…}` lines, which would clobber the FIRST (load-game) instance's
// holder/namespace for anything reading them later in this process. The second instance
// only needs its own lexical bindings, so save and restore the globals around the eval.
{
  const __save_g = globalThis.__g, __save_ns = globalThis.Eldermyr;
  (function () { eval(code); })();   // eslint-disable-line no-eval
  globalThis.__g = __save_g; globalThis.Eldermyr = __save_ns;
}
const CG = globalThis.__cg;
if (typeof CG.updateQuests !== 'function') throw new Error('failed to capture the real updateQuests');

/**
 * Simulate client/mp.html's adoptQuests(s) + updateQuests() and record the painted box.
 * `inventory` is what G.state.inventory holds AT PAINT TIME (the whole point of the probe).
 */
function renderQuestBox(s, inventory) {
  const st = CG.state;
  // --- exactly what client/mp.html adoptQuests() does (mp.html:158-167) ---
  if (s.quests) st.quests = JSON.parse(JSON.stringify(s.quests));
  if (st.player) st.player.bounty = s.bounty || null;   // P2/S12: the real adoptQuests stamps the PLAYER (updateQuests reads state.player.bounty)
  if (s.loreFound && st.player) st.player.loreFound = s.loreFound;   // P2/S11: the real adoptQuests stamps the PLAYER (updateQuests reads state.player.loreFound)
  if (s.maxDepth != null && st.player) st.player.maxDepth = s.maxDepth;   // P2/S12: likewise
  // --- whatever the client's state.inventory happens to be when the box paints ---
  st.inventory = inventory;

  // record the REAL render: updateQuests resolves `document` off the global stub
  const painted = [];
  const list = { innerHTML: '', appendChild: (c) => painted.push(c.textContent) };
  const doc = global.document;
  const gEBI = doc.getElementById, cE = doc.createElement;
  doc.getElementById = (id) => (id === 'quest-list' ? list : gEBI(id));
  doc.createElement = (t) => ({ className: '', textContent: '' });
  try { CG.updateQuests(); } finally { doc.getElementById = gEBI; doc.createElement = cE; }
  return painted;
}

// the game's PRISTINE default quest state, captured before any render mutates it —
// this is what a brand-new page holds after startGame() and before it adopts anything.
const DEFAULT_QUESTS = JSON.parse(JSON.stringify(CG.state.quests));
const DEFAULT_INV = JSON.parse(JSON.stringify(CG.state.inventory));

/** What a FRESH page paints with no adoption at all (startGame()'s own updateQuests call). */
function renderDefaultBox() {
  return renderQuestBox({ quests: DEFAULT_QUESTS, maxDepth: 0, loreFound: [], bounty: null }, DEFAULT_INV);
}

module.exports = { renderQuestBox, renderDefaultBox, DEFAULT_QUESTS, DEFAULT_INV, CG };
