# Golden-master determinism harness

Regression oracle for the coming split of `eldermyr-rpg.html` into modules. It records
sha256 **state-hash trajectories** from today's engine; every refactor step must reproduce
them byte-for-byte. A pure module split changes no values, so it must not move a single hash.

## Run

```sh
node tests/golden/harness.mjs check     # re-run all scenarios, diff vs oracle.json (exit≠0 on divergence)
node tests/golden/harness.mjs prove     # acceptance proofs: (a) determinism (b) sensitivity (c) seed variance
node tests/golden/harness.mjs record    # (re)write oracle.json from the current tree
node tests/golden/harness.mjs run <scenario> <seed> [--perturb speed|damage]   # one worker, prints hashes
```

Scenarios: `overworld-combat`, `dungeon`, `daily-life` (3000 ticks each, hashed every 100).
`check` reports the FIRST divergent tick per scenario.

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
