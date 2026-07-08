# Server-authoritative feasibility spike — RESULT: ✅ GREEN

Run: `node server-spike/headless-harness.js` (reads the live game out of `../eldermyr-rpg.html`, so it always tests current code).

## What it proved
The Eldermyr simulation runs **headless under Node** with a stubbed browser (DOM / canvas 2d / Web Audio / localStorage all faked). Boot + 3000 sim ticks + a real combat scenario through `killEnemy()` (the most DOM-welded hot path) all ran with **zero errors**.

| Measure | Result |
|---|---|
| Load whole `<script>` under Node | ok, no throws |
| `startGame()` world-gen (248×208, 131 enemies, POIs, legion, holdings) | ran headless |
| Sim block (18 `update*` fns from `eldermyr-rpg.html:1848`) × 3000 | 3000/3000 clean |
| `killEnemy()` × 4 (log/Sound/spawnBurst/floatDamage/updateHUD/loot/faction/quest) | clean; gold+42, xp+1033 |
| Sim perf | **~0.042 ms/tick ≈ 23,800 Hz / core** |

## The key insight
The sim calls the DOM/audio a lot (~1200 `ctx.`, 238 `Sound.`, 144 `document.`) but **never reads gameplay state back from them** — every call is a one-way *write* (draw, sound, HUD, float text). So the browser isn't a dependency of the simulation; it's a *sink*. Extraction is mechanical, not architectural.

Because those side effects funnel through a handful of **chokepoint functions** (`log`, `Sound.*`, `spawnBurst`, `floatDamage`, `addShake`, `updateHUD`, `updateQuests`), the server can simply no-op them (as this spike does) and broadcast state; clients regenerate juice locally from state deltas. **No hundreds-of-call-sites emitter refactor is required for v1.**

## What this did NOT test (the real remaining bulk)
- **Single-player → N-players-in-one-world.** `state.player` is assumed-singular everywhere (camera, inventory, `pcx/pcy`, enemy "nearest player" targeting). Turning it into `state.players[sessionId]` with per-player input is the human-weeks core of the project. **Next gate: a second micro-spike proving N players + per-player input + nearest-player targeting in the headless sim.**
- Colyseus room wiring, Neon persistence of `snapshot()`, Fly deploy — all standard, low-risk, downstream of the multi-player refactor.

## Decisions locked
Server-authoritative · **Neon** (serverless Postgres, scale-to-zero) · **Fly.io** single machine with `auto_stop_machines`/`auto_start_machines` (one shared world) · **Colyseus** (Node + WS). Single-player HTML stays untouched and keeps shipping to Netlify; multiplayer is additive and reuses the sim.
