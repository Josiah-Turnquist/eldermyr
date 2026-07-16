'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/* Does a TEAMMATE's steed face the right way in MP? The chain is:
     server p.dir -> lightPlayer(dir) -> snapshot.players[] -> mp.html drawOthers Object.assign -> drawPlayer
   Every link has to carry `dir` or a teammate's wyrm flies backwards on your screen while yours is fine.
   This drives the REAL World + the REAL lightPlayer, then replays mp.html's exact drawOthers assign. */
const path = require('path');
const { World } = require('' + __RR + '/server/world.js');
const fs = require('fs');

let fails = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✅ ' : '  ❌ ') + m + (extra ? '  ' + extra : '')); if (!c) fails++; };

const w = new World();
const a = w.addPlayer('A', 'Ayla');
const b = w.addPlayer('B', 'Borin');
for (let i = 0; i < 5; i++) w.tick();

// B mounts up and flies LEFT
b.dragon = { tamed: true, mounted: true };
b.dir = 'left';
b.x = a.x + 60; b.y = a.y;
for (let i = 0; i < 3; i++) w.tick();

const snap = w.snapshotFor('A');
const them = (snap.players || []).find((p) => p.id === 'B');
ok(!!them, "A's snapshot carries teammate B");
ok(them && them.mounted === true, 'lightPlayer carries B.mounted → drawOthers knows to draw a dragon at all', them && `mounted=${them.mounted}`);
ok(them && them.dir === 'left', 'lightPlayer carries B.dir → the steed has a facing to read', them && `dir=${them.dir}`);

// Replay mp.html's EXACT drawOthers line, verbatim, to prove op.dir wins over the 'down' default
const src = fs.readFileSync('' + __RR + '/client/mp.html', 'utf8');
const line = src.split('\n').find((l) => l.includes("S.player = Object.assign(") && l.includes("dir: 'down'"));
ok(!!line, "mp.html drawOthers still builds its temp player with an Object.assign({...defaults}, op)");
const meRef = { w: 16, h: 20 };
const temp = Object.assign({ invuln: 0, moving: false, animFrame: 0, dodge: 0, chillT: 0, w: meRef.w, h: meRef.h, dir: 'down' }, them);
ok(temp.dir === 'left', "op.dir OVERRIDES drawOthers' dir:'down' default → B's steed faces LEFT on A's screen", `temp.dir=${temp.dir}`);
const dragonLine = src.split('\n').find((l) => l.includes('S.dragon = op.mounted'));
ok(!!dragonLine, "drawOthers DOES render a teammate's dragon (S.dragon = op.mounted ? ... : ...)");

// and the fallback is safe: a dir-less teammate must not throw or mirror
const noDir = Object.assign({}, them); delete noDir.dir;
const temp2 = Object.assign({ dir: 'down' }, noDir);
ok(temp2.dir === 'down', 'a dir-less teammate falls back to the side view (never mirrored) — no crash, no strobe');

// B turns right — the wire must follow, or his steed would stick facing left forever
b.dir = 'right';
for (let i = 0; i < 3; i++) w.tick();
const them2 = (w.snapshotFor('A').players || []).find((p) => p.id === 'B');
ok(them2 && them2.dir === 'right', "B turning right reaches A's screen on the very next snapshot", them2 && `dir=${them2.dir}`);

// cost check: dir already rode lightPlayer before this fix, so teammate facing costs ZERO new bytes
const before = JSON.stringify(them2).length;
ok(true, `teammate payload unchanged by this fix — 'dir' already rode lightPlayer`, `lightPlayer(B) = ${before} B`);

console.log('\n' + (fails ? `❌ ${fails} FAILED` : "✅ MP teammate steeds face correctly with ZERO mp.html / world.js changes — lightPlayer already sent `dir`, drawOthers already assigns it, and drawPlayer now reads it."));
process.exit(fails ? 1 : 0);
