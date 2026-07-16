'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/*
 * qclient.js — run client/mp.html's REAL adoptQuests() against the game's REAL updateQuests().
 *
 * Why not mirror it: mirroring adoptQuests is exactly how a test passes before AND after a fix.
 * This regex-extracts the ACTUAL `function adoptQuests(s){...}` source out of client/mp.html and
 * evals it with the same free names it closes over in the browser (G, window, edgeErr), so the
 * assertion below is against shipped client code, not a paraphrase of it.
 *
 * qrender.js supplies the other half: the real updateQuests, lifted out of the untouched
 * eldermyr-rpg.html, with a DOM shim that records what it paints into #quest-list.
 */
const fs = require('fs');
const path = require('path');
const { CG, DEFAULT_QUESTS, DEFAULT_INV } = require(path.join(__dirname, 'qrender.js'));

const MP = fs.readFileSync(path.join(__RR, 'client', 'mp.html'), 'utf8');

// ---- lift the REAL adoptQuests source (brace-match from its declaration) ----
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('client/mp.html: could not find function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces extracting ' + name);
}
const ADOPT_SRC = extractFn(MP, 'adoptQuests');

// ---- the DOM-recording render harness (same shim qrender uses) ----
let painted = [];
function paintingUpdateQuests() {
  painted = [];
  const list = { innerHTML: '', appendChild: (c) => painted.push(c.textContent) };
  const doc = global.document;
  const gEBI = doc.getElementById, cE = doc.createElement;
  doc.getElementById = (id) => (id === 'quest-list' ? list : gEBI(id));
  doc.createElement = () => ({ className: '', textContent: '' });
  try { CG.updateQuests(); } finally { doc.getElementById = gEBI; doc.createElement = cE; }
}

// ---- the browser scope adoptQuests closes over in mp.html ----
const G = { state: CG.state, log: () => {} };
const errors = [];
const edgeErr = (what, e) => errors.push(what + ': ' + (e && e.message || e));
if (!global.window) global.window = {};
global.window.updateQuests = paintingUpdateQuests;

// eslint-disable-next-line no-eval
const adoptQuests = eval('(' + ADOPT_SRC + ')');

/**
 * Simulate ONE client, from a state we control, receiving snapshot `s`.
 *  opts.bag — what G.state.inventory holds when the payload arrives.
 *             Default = the game's own default bag (keys:0) — i.e. a page that has run
 *             startGame() but whose FRAME LOOP has not reconciled a snapshot yet. That is
 *             the real first-paint ordering: ws.onmessage runs before the first rAF frame.
 * Returns the lines the real updateQuests actually painted.
 */
function clientReceive(s, opts) {
  opts = opts || {};
  const st = CG.state;
  st.quests = JSON.parse(JSON.stringify(DEFAULT_QUESTS));   // a brand-new page's quest state
  st.bounty = null; st.loreFound = []; st.maxDepth = 0;
  st.inventory = opts.bag ? JSON.parse(JSON.stringify(opts.bag)) : JSON.parse(JSON.stringify(DEFAULT_INV));
  errors.length = 0;
  painted = [];
  adoptQuests(s);
  return { painted: painted.slice(), errors: errors.slice(), state: st };
}

module.exports = { clientReceive, ADOPT_SRC, CG, DEFAULT_QUESTS, DEFAULT_INV };
