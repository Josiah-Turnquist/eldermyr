# Golden-master determinism harness

Regression oracle for the split of the single-file game into modules. It records
sha256 **state-hash trajectories** from the pre-split engine; every refactor step must
reproduce them byte-for-byte. A pure module split changes no values, so it must not move a
single hash. The harness drives the built artifact `dist/eldermyr.html` by default (the
single source since the P1 wrap; override with `ELDERMYR_GAME_FILE`).

## Run

```sh
node tests/golden/harness.mjs check     # re-run all scenarios, diff vs oracle.json (exit≠0 on divergence)
node tests/golden/harness.mjs prove     # acceptance proofs: (a) determinism (b) sensitivity (c) seed variance
node tests/golden/harness.mjs record    # (re)write oracle.json from the current tree
node tests/golden/harness.mjs run <scenario> <seed> [--perturb speed|damage]   # one worker, prints hashes
node tests/golden/harness.mjs mp-check  # 2-player world-kind scenarios vs oracle-mp.json (rebuild P2/S2)
node tests/golden/harness.mjs mp-prove  # 2p proofs: determinism / speed+hunt perturbs / seed variance
node tests/golden/harness.mjs mp-record # (re)write oracle-mp.json — consciously, per P2 slice
```

Scenarios: `overworld-combat`, `dungeon`, `daily-life`, `day-rollover` (3000 ticks each, hashed
every 100; `day-rollover` parks `state.time` just before two day boundaries so `updateTime()`
itself fires `onNewDay` — hunt respawn at crossing #1, quiet daily path at #2).
`check` reports the FIRST divergent tick per scenario. `ELDERMYR_GAME_FILE=dist/eldermyr.html`
(absolute or CWD-relative, same as load-game.js) points every run at a rebuilt artifact.

## The 2-player rig (kind `world` — rebuild P2/S2)

`mp-overworld-combat` and `mp-day-rollover` are `kind: 'world'` scenarios: the worker seeds +
freezes exactly like the 1p path, then requires `server/world.js` (which boots the game through
the same loader), joins heroes A + B, scripts each hero's `held`/`actions` per tick (the
self-test idiom) and drives `w.tick()`. The hash root is still `{state, maps}`; the World's
room fields (`feed`/`_errAt`/perf EMAs) live on `this`, off-state, outside the oracle. The
worker pins `HZ=80` so ambient env can't skew the downed/revive frame constants.

These baselines (`oracle-mp.json`) froze the ORCHESTRATION machinery the P2 conversion ladder
rewrote — rotation + PP swap, enemy/ally/companion partitions, projectile shooter buckets,
players[1..N] damage patches, per-player spawn cadence — plus the per-player ITERATION ORDER
(`state.players` join order), which is part of the determinism contract. Through the ladder
`oracle.json` stayed byte-untouched (a REMAP overlay in serialize.mjs re-presented moved keys
at their old spots) while `oracle-mp.json` moved consciously per slice. At P2 close (plan §7
S16) the overlay was DELETED and BOTH oracles were re-recorded in one PAIRED operation at a
single engine state: the old view first reproduced the old oracles byte-for-byte (proving the
engine unchanged), then the native player-keyed shape was recorded, and `prove`/`mp-prove`
re-demonstrated teeth on the fresh baselines. Post-P2 both oracles hash the NATIVE shape;
either moving is a conscious re-record — `record`/`mp-record`, eyeball the diff, commit it
with the slice, and keep the proofs passing (a baseline a real value change cannot move is
worse than none).

## How it works

Each (scenario, seed) runs in its **own child process** (the loaded game is a process
singleton). Before the game is loaded the worker (1) replaces `Math.random` with a seeded
mulberry32 and (2) freezes `Date`/`Date.now` to a fixed epoch. It then loads the game exactly
like `server/world.js` (via `server-spike/load-game.js`) and drives the captured update
functions — the body of the game's own `loop()` — with scripted, tick-derived input. The hash
covers `{state, maps}` (sim state + tile grids), keys recursively sorted, functions skipped,
full float precision, cross-references deduped.

## When a divergence is INTENTIONAL

A real balance/content change (new drop rate, retuned damage, altered worldgen) legitimately
moves the hashes — `check` will fail. That is the oracle doing its job, not a bug. Confirm the
change is deliberate, then **re-record consciously**: `node tests/golden/harness.mjs record`,
eyeball the `git diff` on `oracle.json`, and commit it **in the same change** as the gameplay
edit, alongside the `GAME_VERSION` bump. Never re-record to silence an *unexplained* diff
during a refactor — a refactor must reproduce the oracle, so an unexplained diff is a real bug.
