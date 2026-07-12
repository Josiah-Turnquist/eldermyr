# Eldermyr — Multiplayer Architecture

*For humans and AI agents. Read this before touching `server/`, `client/`, or `server-spike/`.
It documents invariants and gotchas, not line numbers — verify specifics against the code.*

## The one-sentence model

The single-player game file (`eldermyr-rpg.html`) is never forked: the **server loads it
headlessly and orchestrates it** for N players; the **client loads the same file and renders
it** from server snapshots. All game logic changes go into `eldermyr-rpg.html` and must stay
browser-safe and single-player-identical.

## Load-and-orchestrate (server side)

`server-spike/load-game.js` extracts the `<script>` from `eldermyr-rpg.html`, installs
DOM/canvas/audio stubs, `eval`s it, and captures lexical symbols into `global.__game` (`G`)
per its `CAPTURE` list.

**THE gotcha of this codebase:** game functions call each other by *lexical* name.
Reassigning `G.someFn` after load does **not** change internal call sites. To intercept an
internal call you must rewrap the lexical binding in the load-game **epilogue**. Existing
hooks (mirror these): `log` → `globalThis.__onLog`; `gameOver` → `__onGameOver` (server sets
a no-op — co-op death is the downed/revive pass, never SP game-over);
`liberateHolding`/`clearPOI`/`liberateTown` → gated by `__libGate` (set to `()=>false` only
while combat runs against a partitioned bucket; the `_seen` sweeps own liberation).
`townZones` is reassigned at worldgen, so it's exposed via a live getter (`getTownZones`),
not a direct capture — copy that pattern for any symbol the game rebinds after boot.

**Timers:** the global timers are stubbed **only during eval** and restored from
`node:timers` right after (pg/ws resolve globals at call time and need real ones).
`server/index.js` additionally pre-captures `node:timers` as module-locals. `requestAnimationFrame`
stays stubbed forever (the server drives ticks manually). The game's own repeating timers
(localStorage autosave, music sequencer) are latched off *inside* the eval — if you add a new
`setInterval` to the game, decide its headless fate in load-game.

**Capture drift:** `G.__missingCaptures` lists CAPTURE names that resolved `undefined`
(warned at boot). If you make the server or client call a new game function, add it to
`CAPTURE` (server) **and** `NAMES` in `client/mp.html` (client). A missing capture silently
no-ops behind `G.fn && G.fn()` guards — this class of bug hid the event feed and the travel
marker for weeks.

## The room (`server/world.js`)

One shared game `state` (`S`). Per tick, **player rotation**: `S.player = p;
S.inventory = p.inventory; swapInPP(p)` → run game functions as that player → `writeBackPP(p)`.

- **PP_KEYS rule:** every per-player key must appear in *both* `swapInPP` and `writeBackPP`,
  and (if durable) in `characterOf` + the load path, and (if client-visible) in the snapshot
  + explicit client adoption. `lastRestDay` was missing from writeBack for weeks; don't be next.
- **Partitioned combat:** `S.enemies` is replaced by per-player buckets, then recombined.
  Inline game checks that scan `state.enemies` are *bucket-blind* during this window — that's
  why `__libGate` exists and why holdings/POIs/town-sieges are liberated only by the
  full-roster `_seen` sweeps after recombination.
- **Allies** partition by `a._owner` *after* enemy recombination (targeting needs the full
  enemy list). Unowned allies self-heal to the nearest hero. Allies are overworld-only; a
  delving owner leaves them idling topside. Ally `name` must always be a string
  (`drawAlly` splits it).
- **Downed/revive** is owned by world.js (`goDown`/`_downedPass`, triggered by `hp<=0`).
  `gameOver()` must never run its SP consequences server-side (scene='dead',
  `nemesisGrows`, `recordRun`).
- **Shared dungeon:** exactly one `sharedDg`. `grabWorld()`/`putWorld()` swap the
  `WORLD_SLOTS` (map/enemies/pickups/npcs/projectiles/dungeonLevel/dungeonEntrance/
  dungeonThemeData/floorMod + `md`). The dungeon phase is `try { … } finally { putWorld(owBase) }` —
  any new code path that swaps worlds must restore in a `finally`, or one throw strands the
  whole room in the dungeon.
- **Threat scaling** (`_rescaleThreats`) must be *idempotent*: recompute from a cached
  base/template at the target level. Never multiply current stats in place — that compounds
  on every party-level rise.
- **Shared-phase systems** (weather, faction war, nemesis) run once per tick under
  `players[0]`. Their log lines must broadcast (feed attribution), and any *per-player
  effect* (e.g. snow chill) belongs in the per-player loop, not the shared phase.

## Snapshots & the wire

`snapshotFor(id)` builds each client's view (~10 Hz): `me` via depth-bounded `safeClone`
(skip-list includes `held`, `inventory` internals, `dodgeHits`), other players via
`lightPlayer` (includes `sailing`/`mounted` flags), interest-culled enemies/allies/npcs/pickups.

**Edge-triggered extras** (sent only on change, tracked by per-player counters): the event
feed (`_feedSeen`), quest state (`_qSeen`), and the dungeon tile grid (`_sentDgN` vs
`_mapSwitchN`). **dgTiles is transactional:** the flag is consumed *only when a grid actually
attaches*; otherwise it retries next tick. Clients that still end up grid-less send
`{type:'needmap'}` → `world.resendMap(pid)` rewinds the flag. If you add a new edge-triggered
payload, follow this pattern — a naive one-shot WILL eventually be lost (broadcast wraps each
client's send in try/catch) and the client will be stuck.

**Event feed:** game `log()` → `__onLog` → `World.feed`. Personal lines go to the acting
player; epic lines (FEED_BROADCAST regex) go to everyone.

**Connection layer (`server/index.js`):** auth resolves a token → DB character (Neon
Postgres; ephemeral mode without `DATABASE_URL`). **Session takeover:** an auth for a token
that already has a live socket supersedes the old one (`{type:'superseded'}` then terminate)
and the new socket **adopts the live pid** — no DB reload, no duplicate hero; a superseded
socket's close skips both save and removePlayer. DB *errors* refuse auth ("try again") —
they must never mint a fresh hero for a valid token. Saves serialize per token through a
promise chain. `maxPayload` 64 KB; 10 s auth deadline; idle-kick counts only intent-bearing
messages (the client streams no-op input at 60 Hz — never count that).

## Client (`client/mp.html`)

Loads the same game script, captures the `NAMES` list into `window.__G` (boot audit warns on
undefined captures). Server-authoritative: reconcile adopts snapshots into `G.state`
(wrapped in throttled try/catch — keep it that way), local prediction covers own movement
(collision/speed switch on `sailing`/`mounted`).

- **LESSON (bit us twice):** per-player fields riding `me` are *not* auto-applied — each
  needs an explicit `G.state.X = me.X` adoption (tonics, sharpenLevel, sailing, dragon,
  allies, floorMod…).
- **Map switches:** never flip `state.map` to `'dungeon'` before `G.maps.dungeon` exists;
  the frame loop has a hard guard that skips world render and requests `needmap` — keep it.
- RPC overrides (`window.buyX = () => actions.push({rpc:…})`) mirror a server allow-list
  (`RPC_OK` in world.js). Adding a menu action means: game fn (browser) + RPC_OK + CAPTURE +
  client override.

## Verification idioms

- Headless game: `const G = require('./server-spike/load-game.js')` → `G.startGame()`, call
  captured fns directly.
- Room: boot `World` the way `server/index.js` does (no DB needed); `node server/world.js`
  runs a 1200-tick self-test that must stay green.
- Full stack: `env -u DATABASE_URL PORT=<high> node server/index.js` + a `ws` client script
  (server/node_modules has `ws`).
- Perf/lag questions: `GET /health` exposes tick EMA/max, snapshot EMA, entity counts, RSS.

## Iron rules

1. Bump the displayed `GAME_VERSION` on every game change (the integrating session owns it).
2. `eldermyr-rpg.html` edits ship to both branches (`main` = Netlify SP, `multiplayer` =
   Railway MP); `server/`/`client/` stay on `multiplayer`.
3. No bare `catch (_e) {}` around subsystem calls — use the throttled `_err(key, e)` logger.
4. New per-player state: PP_KEYS + swapInPP + writeBackPP + save/load + snapshot + client adopt.
5. **Update this file** when you change any invariant above — a wrong doc is worse than none.
