const __RR = require('path').resolve(__dirname, '..', '..');
// WORLD_SLOTS omitted 'vault'. state.vault is the Key Vault side-room {x,y,opened} for the CURRENT
// dungeon floor (generateDungeon). grabWorld/putWorld round-trip only WORLD_SLOTS (+md).
//
// THE INVARIANT: whatever the shared overworld holds in state.vault must NOT be what a dungeon
// player's code sees. setupDungeonFloor reads state.vault to place the vault chest and to log
// "A rune-sealed VAULT slumbers on this floor…", so a stray/stale value misplaces loot or logs a
// phantom vault.
//
// Observed by hooking G.updatePlayer — world.js calls it THROUGH the capture object, once per
// player inside the dungeon phase (after putWorld(sharedDg)) and again in the overworld phase.
// So it samples state.vault from inside each phase, which is the only honest way to see this.
const { World } = require('' + __RR + '/server/world.js');
const G = global.__game, S = G.state;
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${x !== undefined ? '  [' + x + ']' : ''}`); };

const w = new World();
const A = w.addPlayer('a', { name: 'Ava' });
A.level = 10;
w.tick();

// --- A delves (entry is key-gated) ---
S.player = A; S.inventory = A.inventory;
const ent = S.dungeonEntrance;
A.x = ent.tx * 32; A.y = ent.ty * 32; A.map = 'overworld';
A.inventory.keys = 5;
A.actions.push('interact');
w.tick();
console.log('=== setup ===');
ok(A.map === 'dungeon', 'A is in the dungeon', 'depth=' + S.dungeonLevel);

// Give the live floor a DISTINCTIVE vault, as a depth>=2 floor would have.
w.sharedDg.vault = { x: 11, y: 22, opened: false };
const DG = JSON.stringify(w.sharedDg.vault);

// The overworld holds a DIFFERENT value (a stale leftover, or another floor's vault).
const SENTINEL = { x: 999, y: 999, opened: true };
S.vault = SENTINEL;

// Sample state.vault from inside each phase, per player.
const seen = [];
const realUpdatePlayer = G.updatePlayer;
G.updatePlayer = function () {
  seen.push({ map: S.map, vault: JSON.stringify(S.vault) });
  return realUpdatePlayer.apply(this, arguments);
};
w.tick();
G.updatePlayer = realUpdatePlayer;

console.log('\n=== what state.vault looked like from INSIDE each phase ===');
for (const s of seen) console.log('   map=' + String(s.map).padEnd(9), 'state.vault=' + s.vault);

const dgSample = seen.find((s) => s.map === 'dungeon');
console.log('\n=== THE INVARIANT ===');
ok(!!dgSample, 'the dungeon phase actually ran for A', dgSample ? 'sampled' : 'NO dungeon sample — test is vacuous!');
if (dgSample) {
  ok(dgSample.vault !== JSON.stringify(SENTINEL),
     "a dungeon player does NOT see the overworld's stray vault  <-- the bug",
     'dungeon saw ' + dgSample.vault);
  ok(dgSample.vault === DG,
     "a dungeon player sees THIS FLOOR's own vault",
     'expected ' + DG + ' got ' + dgSample.vault);
}

// And the floor's own vault must survive the swap back out.
ok(JSON.stringify(w.sharedDg.vault) === DG,
   "the floor's vault survives the round-trip into sharedDg",
   'sharedDg.vault=' + JSON.stringify(w.sharedDg.vault));

console.log(`\n  ${fail === 0 ? '✅' : '⚠'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
