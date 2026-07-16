'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/*
 * objclient.js — ask the REAL client what the wayfinder is pointing at.
 *
 * The [O] arrow / edge marker / minimap pulse all render CLIENT-side off the game's own
 * currentObjective(). So the only honest test of "is a level-45 hero still being sent to the
 * Sunken Dungeon?" is: take a REAL snapshotFor() payload, adopt it exactly the way
 * client/mp.html adopts it, and call the game's OWN currentObjective().
 *
 * Two rules keep this from being a mirror that passes before and after the fix:
 *  1. currentObjective + updateQuests come from a SECOND eval of the untouched
 *     eldermyr-rpg.html (qrender.js's idiom). That second instance's `state` is an
 *     INDEPENDENT object — i.e. exactly a fresh MP page — not the server's module-singleton
 *     G.state. (currentObjective is NOT in load-game.js's CAPTURE list, so G.currentObjective
 *     does not exist; the second eval is also the only way to get the binding at all.)
 *  2. adoptQuests() is lifted VERBATIM out of client/mp.html (qclient.js's idiom), and the two
 *     reconcile lines this harness reproduces by hand are ASSERTED against mp.html's source
 *     (RECONCILE_SRC_OK) — if the shipped client stops doing `S.player = snap.me`, the assert
 *     fails instead of the harness quietly lying.
 */
const fs = require('fs');
const path = require('path');



const REPO = process.env.EM_REPO || __RR;
require(path.join(REPO, 'server-spike', 'load-game.js'));   // installs window/document/localStorage stubs
const MP = fs.readFileSync(path.join(REPO, 'client', 'mp.html'), 'utf8');
// The game artifact: env overrides first (same chain as load-game.js), then the REPO's built
// dist/eldermyr.html (single source since the P1 wrap), then the REPO's monolith as a
// back-compat fallback so EM_REPO can still point at a pre-wrap checkout.
const gamePath = process.env.GAME_HTML || process.env.ELDERMYR_GAME_FILE ||
  [path.join(REPO, 'dist', 'eldermyr.html'), path.join(REPO, 'eldermyr-rpg.html')].find((p) => fs.existsSync(p));
if (!gamePath) throw new Error('objclient: no game artifact in ' + REPO + ' — run `npm run build` there first');
const html = fs.readFileSync(gamePath, 'utf8');

// ---- a SECOND, independent instance of the real game = one fresh MP page ----
const a = html.indexOf('<script>'), b = html.indexOf('</script>', a);
let code = html.slice(a + '<script>'.length, b);
code += '\n;try{ autosaveStarted = true; }catch(_e){}\n';
// Artifact path: autosaveStarted lives on the __g globals holder (the bare latch above throws
// there, caught) — latch the holder too, same dual path load-game.js uses.
code += '\n;try{ if (globalThis.__g && ("autosaveStarted" in globalThis.__g)) globalThis.__g.autosaveStarted = true; }catch(_e){}\n';
code += '\n;try{ Sound.startMusic = function(){}; }catch(_e){}\n';
code += '\n;globalThis.__og = {};' +
  ['state', 'currentObjective', 'updateQuests'].map((n) => `try{ globalThis.__og[${JSON.stringify(n)}] = ${n}; }catch(_e){}`).join('\n');
// The second eval re-runs the artifact's `globalThis.__g = __g` / `globalThis.Eldermyr = {…}`
// lines — save and restore them so the FIRST (load-game) instance's holder/namespace stay
// authoritative for the rest of this process.
{
  const __save_g = globalThis.__g, __save_ns = globalThis.Eldermyr;
  (function () { eval(code); })();   // eslint-disable-line no-eval
  globalThis.__g = __save_g; globalThis.Eldermyr = __save_ns;
}
const CG = globalThis.__og;
if (typeof CG.currentObjective !== 'function') throw new Error('failed to capture the real currentObjective');

// ---- the REAL adoptQuests, lifted out of client/mp.html ----
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
const G = { state: CG.state, log: () => {} };
const errors = [];
const edgeErr = (what, e) => errors.push(what + ': ' + (e && e.message || e));
if (!global.window) global.window = {};
global.window.updateQuests = () => {};
const adoptQuests = eval('(' + ADOPT_SRC + ')');   // eslint-disable-line no-eval

// The reconcile lines below are reproduced by hand — assert the shipped client really does them.
const RECONCILE_SRC = {
  adoptsMeWholesale: /S\.player\s*=\s*snap\.me\s*;/.test(MP),
  carriesBountyAcrossAdopt: /const _pb = S\.player\.bounty;/.test(MP) && /S\.player\.bounty = _pb \|\| null;/.test(MP),   // P2/S12: bounty is gated-only (never rides `me`) — the reconcile must carry the last adopted contract across the wholesale adopt
  noGhostMaxDepthAdopt: !/S\.maxDepth = snap\.me\.maxDepth/.test(MP),   // P2/S12: maxDepth rides `me` ON the player — the old explicit root adopt must be GONE (risk #7)
  carriesQuestsAcrossAdopt: /const _pq = S\.player\.quests;/.test(MP) && /if \(_pq\) S\.player\.quests = _pq;/.test(MP),   // P2/S13: quests is gated-only (never rides `me`) — the reconcile must carry the last adopted box across the wholesale adopt
  adoptStampsPlayerQuests: /G\.state\.player\.quests = s\.quests/.test(ADOPT_SRC) && !/G\.state\.quests\s*=/.test(ADOPT_SRC),   // P2/S13: adoptQuests stamps the PLAYER, never a root ghost (risk #7)
  callsObjective: /G\.currentObjective\s*&&\s*G\.currentObjective\(\)/.test(MP),
  namesHasObjective: /'currentObjective'/.test(MP),
};
const RECONCILE_SRC_OK = Object.values(RECONCILE_SRC).every(Boolean);

const DEFAULT_STATE = JSON.parse(JSON.stringify({ inventory: CG.state.inventory, player: CG.state.player }));   // P2/S13: the player clone CARRIES the boot quest box

/**
 * One fresh MP page receives `snap` (a REAL world.snapshotFor() payload) and renders.
 * Returns whatever the wayfinder would point at: {label,...} or null.
 */
function clientObjective(snap) {
  const st = CG.state;
  // a brand-new page: the game's own boot defaults, nothing adopted yet
  st.player = JSON.parse(JSON.stringify(DEFAULT_STATE.player));   // carries the boot quest box (P2/S13); no root st.quests exists any more
  st.inventory = JSON.parse(JSON.stringify(DEFAULT_STATE.inventory));
  st.map = 'overworld'; st.holdings = []; st.npcs = []; st.pickups = [];
  if (st.player) st.player.loreFound = [];   // P2/S11: loreFound lives on the player (st.player is re-cloned from the boot default above, which already carries [])
  if (st.player) { st.player.maxDepth = 0; st.player.bounty = null; }   // P2/S12: maxDepth/bounty live on the player too (the re-clone already seeds them; explicit for scenario isolation — no root ghosts)
  st.flags = { krakenDead: false, legionBroken: false, enteredDungeon: false, gotKey: false, enteredFrozen: false };   // a fresh page's flags (pre-fix: the client GENERATES these; they are never on the wire)
  errors.length = 0;
  // --- ws.onmessage: the edge-triggered quest payload ---
  adoptQuests(snap);
  // --- the frame loop's reconcile (client/mp.html) ---
  if (snap.me) {
    const _pb = st.player.bounty;   // P2/S12 mirror: the shipped reconcile carries the contract across the wholesale adopt (bounty never rides `me`)
    const _pq = st.player.quests;   // P2/S13 mirror: same carry for the quest box (quests never rides `me` either)
    st.player = snap.me;
    if (snap.me.inventory) st.inventory = snap.me.inventory;
    st.player.bounty = _pb || null;
    if (_pq) st.player.quests = _pq;
  }
  let o = null;
  try { o = CG.currentObjective(); } catch (e) { errors.push('currentObjective: ' + e.message); }
  return o;
}

const isDungeonObjective = (o) => !!(o && /Sunken Dungeon/.test(o.label || ''));

module.exports = { clientObjective, isDungeonObjective, CG, RECONCILE_SRC, RECONCILE_SRC_OK, errors };
