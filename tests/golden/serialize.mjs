/*
 * serialize.mjs — a STABLE, canonical serialization of live sim state, plus a
 * sha256 over it. This is the "state hash" the golden master records/compares.
 * ----------------------------------------------------------------------------
 * Requirements (from the harness spec):
 *   - recursively SORTED object keys        -> insertion-order independence
 *   - functions / undefined / symbols SKIPPED
 *   - FULL float precision                  -> String(n) is the shortest
 *                                              round-trippable form (ES spec),
 *                                              so no precision is lost
 *   - deterministic across separate processes
 *
 * The sim graph is NOT a tree: enemies hold `warlordRef` (also under
 * state.legion), `_markBy` (-> state.player), `_pinRef` (-> another enemy),
 * projectiles hold `ownerRef` (-> an enemy/player). A naive recursion would
 * either infinite-loop on a cycle or duplicate a shared object hugely. We
 * dedup by assigning each object an id on FIRST encounter in a fully
 * deterministic traversal order (sorted keys, arrays in index order); a
 * re-encounter emits {"$ref":id}. Because the traversal order is identical in
 * every process, the id assignment — and therefore the byte stream — is
 * identical in every process. The ids are traversal-order based, never
 * identity/GC based, so two separate OS processes agree.
 *
 * REMAP (P2 ladder scaffolding — rebuild/p2-plan.md, "the hash-shape problem"):
 * the golden hash covers SHAPE, so when a P2 slice MOVES a key (state.quests →
 * state.player.quests) the bytes change even though behavior is identical. Each
 * entry below presents a moved key at its OLD spot, for hashing only:
 *
 *     { from: 'state.player.quests', to: 'state.quests' }   // one line per moved key
 *
 * Implementation is an identity-preserving OVERLAY, not a copied tree: the
 * emitter hides `from`'s leaf where its holder is emitted and emits the SAME
 * value object under `to` — object identities are untouched, so `$ref` dedup
 * (enemies._markBy → player, etc.) produces exactly the pre-move byte stream.
 * A `from` path that doesn't resolve no-ops (the hash then reflects the native
 * shape and the golden check fails LOUDLY — the safe direction).
 *
 * The overlay was landed EMPTY in S1 (inert fast path, unchanged oracle) and is
 * unit-proven in tests/battery/migrate-roundtrip.js. Every entry added must keep
 * the `prove` perturb controls failing (the vacuous-test rule); S16 deletes the
 * table and re-records oracle.json natively.
 *
 * NOTE (MP): hashState is also the mp-golden hasher. An entry's `from` resolves
 * through state.player — in MP that is the last-PINNED hero, and the OTHER
 * players[] entries are not overlaid. oracle-mp.json is re-recorded consciously
 * per slice anyway (S2 rule), with the shape delta proven at re-record time.
 */
'use strict';
import { createHash } from 'node:crypto';

export const REMAP = [
  // P2/S5 — town-empowerment + heat-teach keys moved onto the player (plan §7 S5):
  { from: 'state.player.tonics', to: 'state.tonics' },
  { from: 'state.player.sharpenLevel', to: 'state.sharpenLevel' },
  { from: 'state.player.seenHeatTip', to: 'state.seenHeatTip' },
  // P2/S6 — boat ownership + the [O] guide pref moved onto the player (shared-bugs #4/#6):
  { from: 'state.player.hasBoat', to: 'state.hasBoat' },
  { from: 'state.player.wayfind', to: 'state.wayfind' },
  // P2/S7 — town-economy + fatigue PP keys moved onto the player (plan §7 group 3):
  { from: 'state.player.fishCd', to: 'state.fishCd' },
  { from: 'state.player.lastRestDay', to: 'state.lastRestDay' },
  { from: 'state.player.cargo', to: 'state.cargo' },
  { from: 'state.player.shopPurchased', to: 'state.shopPurchased' },
  // P2/S8 — the forage pantry moved onto the player (plan §7 group 4; the last shop-slice key):
  { from: 'state.player.ingredients', to: 'state.ingredients' },
];

// overlay: Map<holderObject, { hide:Set<key>, add:Map<key,value> }> — built per hash call.
function buildOverlay(root, remap) {
  const ov = new Map();
  const rec = (o) => { let r = ov.get(o); if (!r) { r = { hide: new Set(), add: new Map() }; ov.set(o, r); } return r; };
  const walk = (obj, segs) => { let cur = obj; for (const s of segs) { if (cur === null || typeof cur !== 'object') return undefined; cur = cur[s]; } return cur; };
  for (const { from, to } of remap) {
    const f = from.split('.'), t = to.split('.');
    const fromParent = walk(root, f.slice(0, -1)), fromKey = f[f.length - 1];
    if (fromParent === null || fromParent === undefined || typeof fromParent !== 'object' || !(fromKey in fromParent)) continue; // key absent → entry no-ops (see header)
    const toParent = walk(root, t.slice(0, -1)), toKey = t[t.length - 1];
    if (toParent === null || toParent === undefined || typeof toParent !== 'object') continue;
    rec(fromParent).hide.add(fromKey);
    rec(toParent).add.set(toKey, fromParent[fromKey]); // added key WINS over a same-named survivor
  }
  return ov.size ? ov : null;
}

function numToken(n) {
  if (Number.isFinite(n)) {
    // String(n) is the shortest round-trippable decimal for a double (ES2015+),
    // so this preserves full precision. Normalize -0 to 0.
    return Object.is(n, -0) ? '0' : String(n);
  }
  // JSON can't hold these; emit an unambiguous quoted token so a NaN/Inf that a
  // regression introduces still changes the hash deterministically.
  return JSON.stringify(String(n)); // "NaN" | "Infinity" | "-Infinity"
}

export function stableSerialize(root, remap = null) {
  const overlay = remap && remap.length ? buildOverlay(root, remap) : null;
  const seen = new Map(); // object -> assigned id
  let counter = 0;
  const out = [];

  function emit(v) {
    if (v === null) { out.push('null'); return; }
    const t = typeof v;
    if (t === 'number') { out.push(numToken(v)); return; }
    if (t === 'boolean') { out.push(v ? 'true' : 'false'); return; }
    if (t === 'string') { out.push(JSON.stringify(v)); return; }
    if (t === 'bigint') { out.push('"' + v.toString() + 'n"'); return; }
    if (t === 'function' || t === 'undefined' || t === 'symbol') { out.push('null'); return; }
    // object-like
    if (seen.has(v)) { out.push('{"$ref":' + seen.get(v) + '}'); return; }
    const id = counter++;
    seen.set(v, id);

    if (Array.isArray(v)) {
      out.push('[');
      for (let i = 0; i < v.length; i++) {
        if (i) out.push(',');
        emit(v[i]); // holes/undefined -> null, matching JSON array semantics
      }
      out.push(']');
      return;
    }
    if (v instanceof Map) {
      const entries = [...v.entries()].map(([k, val]) => [typeof k === 'object' ? stableSerialize(k) : String(k), val]);
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      out.push('{"$map":[');
      entries.forEach(([k, val], i) => { if (i) out.push(','); out.push('[' + JSON.stringify(k) + ','); emit(val); out.push(']'); });
      out.push(']}');
      return;
    }
    if (v instanceof Set) {
      const els = [...v].map((x) => (typeof x === 'object' ? stableSerialize(x) : numToken(typeof x === 'number' ? x : NaN) + String(x)));
      els.sort();
      out.push('{"$set":' + JSON.stringify(els) + '}');
      return;
    }
    if (ArrayBuffer.isView(v)) { // typed arrays (defensive; sim uses plain arrays)
      out.push('[');
      for (let i = 0; i < v.length; i++) { if (i) out.push(','); out.push(numToken(v[i])); }
      out.push(']');
      return;
    }

    // plain object (REMAP overlay applies here only — the golden spine is plain objects)
    const o = overlay ? overlay.get(v) : undefined;
    let keys = Object.keys(v);
    if (o) {
      keys = keys.filter((k) => !o.hide.has(k));
      for (const k of o.add.keys()) if (!keys.includes(k)) keys.push(k);
    }
    keys.sort();
    out.push('{');
    let first = true;
    for (const k of keys) {
      const val = o && o.add.has(k) ? o.add.get(k) : v[k];
      const vt = typeof val;
      if (vt === 'function' || vt === 'undefined' || vt === 'symbol') continue; // SKIP, don't even emit the key
      if (!first) out.push(',');
      first = false;
      out.push(JSON.stringify(k));
      out.push(':');
      emit(val);
    }
    out.push('}');
  }

  emit(root);
  return out.join('');
}

export function sha256Hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

// The one call the harness uses: canonical-serialize the sim root, then sha256.
// `remap` defaults to the module REMAP table (empty today → untouched fast path);
// tests may pass an explicit table to unit-prove the overlay.
export function hashState(root, remap = REMAP) {
  return sha256Hex(stableSerialize(root, remap));
}
