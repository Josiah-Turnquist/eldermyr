const __RR = require('path').resolve(__dirname, '..', '..');
// Headless verification: the Dread Legion roster now reaches MP clients (snapshot + welcome payload),
// gated by the _lgN revision counter so it costs 0 bytes/tick at rest.
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const R = {};

const w = new World();
const A = w.addPlayer('A', 'Ava');
A.level = 19;
for (let i = 0; i < 600; i++) w.tick();

// ---------- 1. server roster scales to the level-19 solo player ----------
const L = S.legion;
R['1_server_overlord_lv19'] = L.overlord.level === 19;
R['1_server_warlords_lv19'] = L.warlords.every((x) => x.level === 19);

// ---------- 2. the ROSTER RIDES THE SNAPSHOT with correct levels (the actual bug) ----------
// (first snapshot always carries it: a fresh player's _lgSeen is 0, _lgN starts at 1)
const snapA = w.snapshotFor('A');
R['2_snap_has_legion'] = !!snapA.legion;
R['2_snap_overlord_lv19'] = !!snapA.legion && snapA.legion.overlord.level === 19;
R['2_snap_warlords_lv19'] = !!snapA.legion && snapA.legion.warlords.every((x) => x.level === 19);
R['2_snap_no_lv1_members'] = !!snapA.legion && [snapA.legion.overlord, ...snapA.legion.warlords].every((x) => x.level === 19);
// names must MATCH the server's roster (proves the client reads the SERVER's roster, not its own RNG phantom)
const srvNames = [L.overlord.name, ...L.warlords.map((x) => x.name)].join('|');
const snapNames = [snapA.legion.overlord.name, ...snapA.legion.warlords.map((x) => x.name)].join('|');
R['2_snap_names_match_server'] = srvNames === snapNames;
// the panel's full field set survives the trip
const need = ['id', 'name', 'rank', 'level', 'alive', 'scouted', 'strength', 'weakness', 'grudge', 'kills', 'region'];
R['2_snap_all_panel_fields'] = need.every((k) => snapA.legion.overlord[k] !== undefined);

// ---------- 3. welcome/join payload carries it (covers session TAKEOVER: adopts a caught-up _lgSeen) ----------
const wp = w.legionPayload();
R['3_welcome_payload_ok'] = !!wp && wp.overlord.level === 19 && wp.warlords.length === 5;
R['3_welcome_names_match'] = !!wp && [wp.overlord.name, ...wp.warlords.map((x) => x.name)].join('|') === srvNames;

// ---------- 4. REVISION GATE: 0 bytes/tick at rest, resend on change ----------
let carried = 0, bytesAtRest = 0, n = 0;
for (let i = 0; i < 200; i++) { w.tick(); const s = w.snapshotFor('A'); if (s.legion) carried++; bytesAtRest += JSON.stringify({ type: 'state', snap: s }).length; n++; }
R['4_at_rest_no_resend'] = carried === 0;
const restAvg = Math.round(bytesAtRest / n);

// mutate the roster the way the game does (a scouted reveal) → must resend exactly once
L.warlords[0].scouted = 1;
let after = 0, sawIt = null;
for (let i = 0; i < 120; i++) { w.tick(); const s = w.snapshotFor('A'); if (s.legion) { after++; sawIt = s.legion; } }
R['5_change_pushes_once'] = after === 1;
R['5_change_carries_reveal'] = !!sawIt && sawIt.warlords[0].scouted === 1;   // the "???" trait reveal reaches the client

// ---------- 6. no object-typed junk on the wire ----------
function scan(o, path, bad) {
  for (const k in o) {
    const v = o[k], t = typeof v;
    if (v === null || t === 'number' || t === 'string' || t === 'boolean') continue;
    if (Array.isArray(v) || t === 'object') { scan(v, path + '.' + k, bad); continue; }
    bad.push(path + '.' + k + ' = ' + t);
  }
  return bad;
}
const junk = scan(snapA.legion, 'legion', []);
R['6_no_fn_or_undefined_on_wire'] = junk.length === 0;
// the roster must carry NO live object refs back into the sim (warlordRef lives on the ENEMY, never here)
R['6_no_live_refs'] = snapA.legion.overlord !== L.overlord && snapA.legion.warlords[0] !== L.warlords[0];
R['6_json_roundtrips'] = (() => { try { JSON.parse(JSON.stringify(snapA.legion)); return true; } catch (e) { return false; } })();

// ---------- 7. a SECOND player at a different level behaves sanely ----------
const B = w.addPlayer('B', 'Bo');
B.level = 5;                       // party avg (19+5)/2 = 12 → below _threatLvl 19, must NOT demote the roster
for (let i = 0; i < 200; i++) w.tick();
R['7_roster_never_demotes'] = S.legion.overlord.level === 19 && S.legion.warlords.every((x) => x.level >= 19);
const snapB = w.snapshotFor('B');
R['7_newcomer_gets_roster'] = !!snapB.legion;                                   // B's _lgSeen starts 0 → first snapshot carries it
R['7_both_see_same_roster'] = !!snapB.legion && [snapB.legion.overlord.name, ...snapB.legion.warlords.map((x) => x.name)].join('|') === [S.legion.overlord.name, ...S.legion.warlords.map((x) => x.name)].join('|');
R['7_B_sees_lv19_not_lv5'] = !!snapB.legion && snapB.legion.overlord.level === 19;

// a party level RISE above the high-water mark re-scales and pushes to both
A.level = 30; B.level = 30;
for (let i = 0; i < 200; i++) w.tick();
let gotA = null, gotB = null;
for (let i = 0; i < 120; i++) { w.tick(); const sa = w.snapshotFor('A'), sb = w.snapshotFor('B'); if (sa.legion) gotA = sa.legion; if (sb.legion) gotB = sb.legion; }
R['8_rise_rescales_roster'] = S.legion.overlord.level === 30;
R['8_rise_pushed_to_A'] = !!gotA && gotA.overlord.level === 30;
R['8_rise_pushed_to_B'] = !!gotB && gotB.overlord.level === 30;

// ---------- 9. roster survives across ticks / the questline still reads it ----------
R['9_roster_survives'] = !!S.legion && S.legion.warlords.length === 5 && !!S.legion.overlord;
R['9_overlord_alive_readable'] = S.legion.overlord.alive === true;   // updateQuests/advanceLegionQuest gate

// ---------- perf ----------
console.log('--- results ---');
let pass = 0, fail = 0;
for (const k of Object.keys(R)) { const ok = R[k]; console.log((ok ? 'PASS ' : 'FAIL ') + k); ok ? pass++ : fail++; }
console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log('\n--- bandwidth ---');
console.log('snapshot @rest bytes  :', restAvg, '(baseline 10791)');
console.log('roster bytes on change:', JSON.stringify(w.legionPayload()).length);
console.log('tick avg ms           :', w._tickMsAvg.toFixed(4), '(baseline ~0.052)');
console.log('snap avg ms           :', w._snapMsAvg.toFixed(4), '(baseline ~0.025)');
console.log('\nserver roster:', [S.legion.overlord, ...S.legion.warlords].map((x) => x.name + ' Lv' + x.level).join(' | '));
process.exit(fail ? 1 : 0);
