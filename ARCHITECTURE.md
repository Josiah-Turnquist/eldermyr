# Eldermyr — Architecture

*For humans and AI agents. Read this before touching `server/`, `client/`, or the sim. It
documents invariants and gotchas, not line numbers — verify specifics against the code. For
how to ADD content (an enemy, spell, gear, dungeon…), see [CONTENT.md](CONTENT.md); this file
is the cross-cutting machinery.*

## The one-sentence model

`npm run build` compiles `src/content` + `src/game/` into one artifact, **`dist/eldermyr.html`**;
the **server loads that artifact headlessly and orchestrates it** for N players, and the
**client loads the same artifact and renders it** from server snapshots. The sim is
multiplayer-native — one shared `state`, every hero a first-class `players[]` entry. There is
no single-player fork.

## The build (`scripts/build.mjs`)

- esbuild bundles `src/content/index.ts` → one non-minified IIFE **content chunk** that assigns
  `globalThis.CONTENT`; the build prepends it to `src/game/shell-head.html` + the `src/game/parts/`
  (ordered by `manifest.json`) + `shell-tail.html`, then appends a generated `globalThis.Eldermyr`
  **namespace** and writes `dist/eldermyr.html`.
- The namespace is the explicit export surface: **every `CAPTURE` symbol (`server/load-game.js`) ∪
  every `NAMES` symbol (`client/mp.html`) ∪ `{state, maps, g}`**. A listed name with **no top-level
  binding FAILS the build** — this is the loud replacement for the monolith-era "a missing capture
  silently no-ops" bug. So: a new game function the server/client calls by name needs its `CAPTURE`
  and/or `NAMES` entry, or the build stops.
- Module-level `let`s that are **rebound after init** (townZones, VIEW_W, hitStop, …) live as slots
  on a globals holder `const __g` (`globalThis.__g`) — ES modules forbid assigning to an import, so
  rebindable state sits on one mutable object. The parts read/write `__g.x`.
- Content is read via `CONTENT.<registry>` or a positional alias at the old declaration line
  (`const ELEMENTS = CONTENT.elements;`). Registries are deliberately **not frozen** (sloppy-mode
  writes to a frozen object fail *silently* — the failure class this codebase refuses); the
  `content-purity` battery is the tripwire (see Verification).

## The headless loader (`server/load-game.js`)

Installs DOM/canvas/audio stubs, extracts the single `<script>` from `dist/eldermyr.html`, `eval`s
it, and captures the `CAPTURE` symbols into `global.__game` (`G`). Prefers the `Eldermyr` namespace
when present.

- **Epilogue hooks** rewrap two lexical bindings so the server can intercept internal calls (game
  functions call each other by *lexical* name — reassigning `G.fn` after load does nothing):
  `log` → `globalThis.__onLog` (the event feed) and `gameOver` → `globalThis.__onGameOver` (the
  server sets a no-op — co-op death is the downed/revive pass, never SP game-over). Mirror this
  pattern for any new internal call you must intercept.
- `townZones` is reassigned at worldgen, so it is exposed via a live getter `getTownZones()`, not a
  direct capture — copy that for any symbol the game rebinds after boot.
- **Timers** are stubbed only for the span of the eval, then restored from `node:timers` (pg/ws
  resolve global timers at call time and need real ones); `requestAnimationFrame` stays stubbed
  forever (the server drives ticks by hand). The game's autosave/music intervals are latched off
  inside the eval — decide the headless fate of any new `setInterval` you add.

## The room (`server/world.js`)

One shared game `state` (`S`). **The acting-hero seam is a two-slot pin:** `S.player = p;
S.inventory = p.inventory` runs game functions as that hero. Since every per-hero key lives ON the
player object, **that pin IS the whole swap** — the old `PP_KEYS` / `swapInPP` / `writeBackPP` mirror
machinery is deleted and must not return.

- **world.js runs no per-player system loops.** Movement, enemies, allies, companions, projectiles,
  fatigue and spawning are each ONE `G.fn()` call per world phase. Each such fn is an **A-shape**: the
  SP body is `updateXFor(...)`, and the MP dispatcher loops the world-scoped **`partyIn()`** itself in
  **JOIN order**, pinning each hero for their slice. Per-bucket pins often have *no restore* — the
  ambient last-hero pin is part of the hashed state the 2-player baselines freeze.
- **What world.js still owns:** the per-hero **action queue** (`_runActions`: attack/dodge/interact/
  RPC — the world-slot choreography that cannot live in-sim), which runs AFTER the movement call
  (within a tick: the party moves, then acts); **downed/revive** (`goDown`/`_downedPass`, on `hp<=0`
  — `gameOver()` must never run its SP consequences server-side); the world-slot instancing; threat
  rescale; the liberation `_seen` reconciliation sweeps; feed; serialization; the connection layer.
- **RPC and interact do not trust the caller's pin.** `_runRpc` and `resolveInteract` run their
  bodies under the game's own **`actAs(p, fn)`** (pins only player + inventory, restores both in a
  `finally`), so a handler invoked outside an action slice cannot act as a stale hero.

### Per-hero state — the one rule

**New per-player state is a scalar (or object) field on `state.player`. Full stop.** It rides the
whole chain for free: `S.player = p` swaps it, `snapshot()`'s player whitelist persists it,
`characterOf` (which pins `S.player = p` before `snapshot()`) saves it, `_loadCharacter`'s
`Object.assign(p, c.player)` restores it, `safeClone` rides it on `me`, and the client's wholesale
`S.player = snap.me` adopts it — **no explicit client-adopt line**. There is no `state.X` per-player
slice left; do not reintroduce one.

- Before adding a field, ask **per-HERO or shared WORLD fact?** `state.flags` once held both and was
  wrong for years. The split is the invariant: **`enteredDungeon`/`gotKey`/`enteredFrozen` are
  per-hero scalars on `state.player`** ("have I been there?"); **`krakenDead`/`legionBroken` are WORLD
  facts on the shared `state.flags`** (one Kraken, one Legion). You **cannot alias a scalar** — a
  partner's Kraken kill must still count for you, so world facts stay shared, not per-hero.

### The seams beside `party()` (all in the sim, all captured)

- **`party()`** — all heroes (non-positional: money, reputation, quests). **`partyIn()`** — heroes
  whose `p.map === state.map` (anything positional: hazards, hit-tests). A shared-phase per-player
  effect must loop `partyIn()` **inside the sim fn** (world.js carries no players[1..N] replica
  patches), or it silently hits only the pinned hero.
- **`actAs(p, fn)`** — pins player+inventory, restores in `finally`; the acting-context seam for
  RPC/interact/day-tick.
- **`aliasSharedQuests()`** — re-attaches the three WORLD-tracking quests (`main`=Kraken,
  `frozen`=Cache, `legion`=war) **by reference** into every hero's `quests` on join/load, so the room
  shares one object. `talk`/`key`/`slay`/`dragon`/`finale` genuinely fork per hero. A private copy of
  a shared quest silently FORKS the room's war — the mp-golden object-identity assert guards it.
- **`addRep`** credits the acting hero; **`addRepParty`** (party news — liberations, siege breaks,
  the war's end) loops `party()` via `actAs`; a shared-phase READ of standing uses **`partyRep(fac)`**
  (the party's extreme member), never `facTierIdx` (reads whoever is pinned). SP: all degenerate to
  the one hero.
- **The day tick is split:** `onNewDay` = `maybeRaiseNemesis()` → `for (p of party()) actAs(p,
  onNewDayHero)` → `onNewDayWorld()`. A daily effect touching one hero's state goes in `onNewDayHero`
  (tribute, upkeep); roster/respawn work goes in `onNewDayWorld`. Never read `state.player` from
  world-scoped day code (it is whatever the last tick left pinned — scale to `state._partyLevel ||
  state.player.level`).

### Determinism contract

Per-player iteration order is **`state.players` JOIN order**, everywhere (dispatchers, `party()`,
`actAs` loops). The mp-golden baselines freeze exactly this. Bucketed passes recombine survivors in
bucket order (join order; mid-pass spawns land at the acting owner's tail) — next tick iterates that
array, so **the order IS the contract**.

### Shared dungeon & threat scaling

Exactly one `sharedDg`. `grabWorld()`/`putWorld()` swap the `WORLD_SLOTS` (map/enemies/pickups/npcs/
projectiles/dungeonLevel/… + `citadel`). The dungeon/citadel phase is `try { … } finally {
putWorld(owBase) }` — **any new world-swapping path must restore in a `finally`**, or one throw
strands the whole room underground. `_rescaleThreats` must be **idempotent** (recompute from a cached
base/template at the target level; never multiply current stats in place — that compounds every
party-level rise; it deliberately rebuilds only Great Beasts and warlords, never a flat-levelled rung).

## Content mechanics live as scalars

The combat pillars (style resources, elite affixes, pinnacle/apex bosses, chase uniques) add **no
server plumbing** because all their state is **scalars on the player or the enemy**, which
`safeClone`/`packScalar` copy to the wire automatically — so they need **no client-adopt line** (the
whole reason they live there). Invariants that keep this working:

- **Per-enemy memory must be authored server-side.** The client rebuilds `state.enemies` from fresh
  JSON every snapshot (`S.enemies = snap.enemies`), so an enemy cannot remember anything across
  frames on the client. Any per-enemy state (hysteresis, a latched facing bit, mark ownership, affix
  shields, boss phase) is an **enemy scalar** authored server-side; deriving it in the renderer
  compiles, looks right in SP, and **strobes in MP**. `packScalar` drops object/array fields — object
  refs like `e._markBy` / `e._pinRef` deliberately never serialize (identity checks run
  server-authoritatively); gate any costly scalar to the types that need it (the `FACING` map).
- **One damage gate:** every player/ally/companion→enemy hp subtraction routes through `afxHit(e,dmg)`
  (ward/shield live there); enemy→player through `enemyStrike`. A new damage site routes through them,
  not a parallel path. Momentum/riposte/mark/heat all fold into the existing `playerDmgMul`/`crit`/
  `applyElementOnHit`.
- **Unique/relic effects are `recalcStats`-derived player flags** (`p.uLance`/`p.uAegis`/…), never a
  combat-time gear read — a gear read sees the wrong bag in MP (a bucket pin swaps `state.player` but
  not always the equipped-bag context). Projectile effects are projectile-stamped at fire time.
- **Pinnacle/apex bosses + the steed are FLAT-levelled** (`PIN_LEVEL`, `DRAGON_LEVEL`, kraken/citadel
  levels) — they do NOT read `partyLvl()`, because scaling *down* to the party let a low hero solo an
  apex terror. Party-size / cycle / ascension / distance still multiply on top. Never put a flat rung
  into `_rescaleThreats`, and keep the DROP tracking `partyLvl()` (the reward suits the killer).

The registries themselves are pure — a content hook reads its arguments and mutates only the
instance/refs it is handed, never `state`/DOM/`Sound` (the `content-purity` grep enforces it). See
CONTENT.md for the recipes.

## Snapshots & the wire

`snapshotFor(id)` builds each client's view at **20 Hz** (`BCAST_MS`=50 in `index.js`, decoupled from
the 80 Hz sim): `me` via depth-bounded `safeClone` (skips `held`, `dodgeHits`, and the whole
`inventory` — it rides a gated payload); other players via `lightPlayer` (includes `sailing`/`mounted`/
`auraEl`); enemies/allies/pickups interest-culled at **34 tiles**. Measured at rest: **~170 KB/s/player**
(a 3.5× cut from the pre-v2 66 Hz wire); `/health.json` exposes the live `wireKBs`.

- **Edge-triggered payloads** (sent only on change, per-player counters): the event feed (`_feedSeen`),
  quest state (`_qSeen`/`_qN` — per-player, the questline is per-hero), the Legion roster (`_lgSeen`),
  the dungeon tile grid (`_sentDgN`), the **inventory** (`me._invSeen`/`_invN`), and **world features**
  `wf` (npcs/shrines/loreStones/pois — near-static, full lists on change, never per-snapshot). The
  version counters/stringify caches live on the World instance keyed by player id, **off the hashed sim
  state** so the mp-golden baselines don't move.
- **A one-shot payload must be consumed in `ws.onmessage`, NOT in the reconcile.** `client/mp.html`
  keeps only the newest snapshot and reconciles inside the *frame loop*; at 20 Hz vs a slower render —
  or a **backgrounded tab, where `requestAnimationFrame` throttles to ~1 Hz** — most snapshots are
  overwritten before a frame sees them, so an edge-triggered field reconciled in the frame loop is a
  coin flip. This is not theoretical: it is exactly how the Legion-roster fix passed every headless
  check and failed its first live test.
- **Every edge-triggered payload needs a join seed in `welcome`** (a pure `xPayload` builder) **and** a
  takeover rewind of its `_seen` cursor. **Takeover is why** `welcome` seeds everything: an auth for a
  token with a live socket supersedes the old one and the new socket adopts the live pid (no DB reload)
  — a brand-new page whose `_seen` counters were already caught up would render boot defaults forever.
  Every wifi blip, reload and second tab takes this path. Verify this class of fix over a **real socket**
  — headless calls `snapshotFor` directly and never exercises `welcome`.
- **Sizing rule:** tiny shared state (`holdings`, ~165 B) rides every snapshot; anything bigger must be
  **version-gated** (stringify-compare on a throttled `% 40` tick, bump a `_xN`, attach only when
  `me._xSeen !== _xN`), or it silently costs `size × 20 Hz × players` forever. Prefer stringify-compare
  over a per-mutation `_rev` (it cannot miss a site).
- **Event feed:** game `log()` → `__onLog` → `World.feed`; personal lines to the acting hero, epic
  lines (FEED_BROADCAST regex) to everyone.
- **Connection (`server/index.js`):** auth resolves a token → DB character (Neon Postgres; ephemeral
  mode without `DATABASE_URL`). DB *errors* refuse auth ("try again") — they must never mint a fresh
  hero for a valid token. Saves serialize per token through a promise chain. `maxPayload` 64 KB; the
  idle-kick counts only intent-bearing messages (the client streams no-op input at 60 Hz).

## Client (`client/mp.html`)

Loads the same artifact, captures `NAMES` into `window.__G`. Server-authoritative: the reconcile
adopts snapshots into `G.state` (wrapped in a throttled try/catch — keep it that way); local
prediction covers own movement (collision/speed switch on `sailing`/`mounted`).

- **Fields that live ON the player need no adopt line** (`S.player = snap.me` is the adoption). A
  per-player **`state.X`** field riding `me` (floorMod, allies) DOES need an explicit `G.state.X = me.X`
  — this bit twice. Two inversions: a client-side **preference** (the `[O]` guide toggle) is re-stamped
  from a tab-local *after* the wholesale adopt (the server default would otherwise stomp it), and a key
  deliberately OFF the wire (the shop `activeStock`, `bounty`, `quests` — `safeClone` skips them) is
  carried across the me-adopt from a tab-local or captured value.
- **The client must never GENERATE shared world state.** `welcome` nukes the client-random features and
  adopts the server's; `window.genLegion` is **stubbed to a no-op before `startGame()`** so the client
  cannot fabricate a roster (overriding `window.X` DOES intercept the game's internal lexical calls
  here — the client is one classic `<script>`, so top-level `function`s are window properties; the
  opposite of the server's `G.fn=` gotcha).
- **Map switches:** never flip `state.map` to `'dungeon'` before `G.maps.dungeon` exists; the frame
  loop's hard guard skips world render and requests `needmap` — keep it.
- **RPC overrides** (`window.buyX = () => actions.push({rpc:…})`) mirror a server allow-list (`RPC_OK`
  in world.js). A new menu action = game fn + `RPC_OK` + `CAPTURE` + client override.

## Saves

`accounts.character` is a JSONB blob stamped with `schemaVersion` (the v7-era shape: per-hero slice,
`player.quests` included). `characterOf` writes it (pinning `S.player = p`, so the player whitelist is
the save); `_loadCharacter` **applies** a pure importer's output, never migrates inline. The importer
is **`server/migrate.js` `migrateCharacter(blob) → {blob, fromVersion, toVersion}`** — it normalizes
every historical shape (folds old top-level/`shop` slices into `player.*`, defaults absent fields)
into the current player-slice shape, so `migrate(old row) ≡ characterOf(new hero)`. Readers are
**field-keyed, player-first with a root fallback** (`s.player.X !== undefined ? s.player.X : s.X`) so a
mid-rebuild snapshot and a current one both load. Tokens + recovery codes carry over untouched. A
pre-cutover DB backup is `scripts/db-dump.mjs` (owner-run, needs `DATABASE_URL`, redacts secrets,
refuses committable output).

## Verification

- **Golden oracles** (`tests/golden/`): a seeded PRNG drives the captured update fns and hashes
  `{state, maps}` at intervals against a recorded oracle — 1-player (`check`, 8 trajectories) and
  2-player (`mp-check`, 4). A moved hash fails the gate; that is the safety net for every data/refactor
  slice. **Re-record ONLY with divergence evidence** (`record`/`mp-record`, confirm only the intended
  leaves moved, commit the oracle in the same change): full protocol in `tests/golden/README.md`.
- **Battery** (`tests/battery/`, `node tests/run-battery.mjs [name…]`): ~50 standalone suites that drive
  the real game headlessly (`server/load-game.js` + `server/world.js`) or boot the MP server, asserting
  behavior the oracles can't see (co-op partitioning, per-hero credit, MP-only paths). `content-purity`
  greps the compiled chunk for banned tokens and runs a 3k-tick live-vs-fresh-chunk mutation canary.
  See `tests/battery/MANIFEST.md`.
- **Vacuous-test rule:** a new assertion counts only after it has been **seen failing** against
  perturbed behavior once — otherwise it proves nothing.
- Boot headless: `const G = require('./server/load-game.js')` → `G.startGame()`, call captured fns.
  Room: `node server/world.js` (1200-tick self-test, must stay green). Full stack:
  `env -u DATABASE_URL PORT=<high> node server/index.js` + a `ws` client. Perf/lag: `GET /health`.

## Iron rules

1. Bump `GAME_VERSION` on every game change; add a `server/releases.js` entry in the same commit.
2. New per-player state is a **field on `state.player`** — never a `state.X` slice (that machinery is
   deleted). Ask per-HERO vs WORLD fact first.
3. A game function the server/client call by name needs its `CAPTURE`/`NAMES` entry — else the build
   fails (by design).
4. No bare `catch (_e) {}` around subsystem calls — use the throttled `_err(key, e)` logger.
5. **Update this file** when you change an invariant above — a wrong doc is worse than none.
