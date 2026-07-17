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
 * REMAP — RETIRED (P2 close; rebuild/p2-plan.md §7 S16). Through the P2 per-key
 * ladder (S5–S13) this module carried a pure overlay table that re-presented each
 * key MOVED onto state.player at its old root spot, for hashing only, so
 * oracle.json could stay byte-untouched while the state shape changed underneath.
 * At the ladder's end the table (21 entries) was DELETED in a PAIRED operation:
 * at one engine state, the remap serializer first reproduced the old oracles
 * (proving the engine byte-identical to the recording), then this native
 * serializer re-recorded both oracles — so the only delta between old and new
 * baselines is the serializer view. The hash now covers the NATIVE, player-keyed
 * shape; a key that moves again must be a conscious re-record, never an overlay.
 */
'use strict';
import { createHash } from 'node:crypto';

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

export function stableSerialize(root) {
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

    // plain object
    const keys = Object.keys(v).sort();
    out.push('{');
    let first = true;
    for (const k of keys) {
      const val = v[k];
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
// NATIVE shape — the REMAP overlay that once rode here is retired (see header).
export function hashState(root) {
  return sha256Hex(stableSerialize(root));
}
