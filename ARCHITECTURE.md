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

## Style-identity resources (Pillar 1: Momentum / Quarry Marks / Heat)

Each combat style has a resource loop whose state and logic live **entirely inside the
existing combat functions**, so the loader/room inherit it for free — no new server plumbing.

- **All player state is scalars on `state.player`** (melee `momentum`/`riposteT`/`_momoDecay`;
  magic `heat`/`_heatCool`/`_auraCd`/`_auraEl`; ranged `_lastMarkN`/`_markShowT`;
  plus `_lastStyle`). These are **transient** — deliberately *not* in `snapshot()`'s whitelist,
  and `applySnapshot` zeroes them, so old saves default to 0/off. They reach MP clients with
  **zero extra wiring**: the client adopts `me` wholesale (`S.player = snap.me`), and `safeClone`
  copies top-level scalars — so unlike `state.X` fields (tonics/sailing/…), these need **no
  explicit adoption line**. That is the whole reason they live on the player object.
- **Marks are per-TARGET, so they live on the ENEMY**, not the player: `e._markN` (0–3, a number
  — it *does* ride `packEnemy`/`packScalar`, harmless) and `e._markBy` = the **owning player
  OBJECT ref**. The "bonus damage from you" check is `e._markBy === po` (identity, O(1)); packScalar
  drops object-typed fields, so `_markBy` **never serializes** — do not change it to an id/string
  (a string would leak onto the wire, and SP players have no `.id`). For MP own-mark rendering,
  `packEnemy` emits a SEPARATE derived scalar `_markById = _markBy.id` (leave `_markBy` an object);
  `drawEnemy` shows a viewer's own pips via `_markBy===state.player` (SP) or `_markById===state.player.id` (MP).
  Enemies are shared in MP, so one enemy carries exactly one owner's mark. Entity scans these
  mechanics may do are all **kill-rate, not frame-rate**: the nearest-foe scan in `killEnemy` for
  the kill-chain transfer, and (ranged prof ≥24 capstone) the in-radius scan for the Deadeye
  marked-kill burst (routes damage through the one `afxHit` gate; splices the corpse before its
  burst snapshot so nested bursts can't re-hit it).
  Everything else is O(1): Deadeye/point-blank are computed at hit-time from shooter→impact
  distance (no scan), momentum/heat decay are counters in `updateStyleResources`.
- **Reset-on-swap is a single seam:** `updateStyleResources()` (called each frame from
  `updatePlayer`) compares `styleOf(equippedWeapon())` to `p._lastStyle`; on a *style* change it
  wipes every other style's transients. This is the ONE reset path — it fires for SP equips, MP
  equip RPCs, and load alike, so nothing else needs to know about swaps. (It runs after the first
  frame latches `_lastStyle`, which is why `updatePlayer` must run before any attack — it already
  does, both in the SP loop and the world tick's per-player phase.)
- **Heat is a passive elemental AURA** — no key, no RPC (the old manual `[V]` vent + peg/overload/
  silence punishment, and the `silenceT`/`ventT`/`ventHeat`/`_vHeld`/`doVent`/`ventNova` machinery,
  were all removed). Casting an **elemental** staff builds `heat` (gated on `w.element`, scaled by
  weapon power in `magicShot`); a plain staff never heats and never auras. Past `HEAT_AURA_MIN` (40)
  the player radiates an aura that periodically strikes nearby foes with the staff's element. It
  lives **inside `updateStyleResources`** — which `updatePlayer` runs per player, SP loop and world
  tick alike, on the overworld and in the shared-dungeon phase — so the loader/room inherit it with
  zero plumbing. The nearby-foe scan (`updateHeatAura`) is **GATED then THROTTLED, in that order:**
  the call is gated on `w.element && heat≥40` *before* it happens (else `_auraCd` is zeroed); inside,
  a per-player `_auraCd` counter fires the scan only every `HEAT_AURA_TICKS` (16) frames — so the
  `[...state.enemies]` copy allocates on ~1/16 aura ticks and **never** while idle/under-threshold.
  Aura damage routes through the one `afxHit` gate (warded/shielded elites respected) + the shared
  `applyElementOnHit`. `_auraEl` (the element *string*, else `0`) is set/cleared **every** tick and
  rides `lightPlayer` as `auraEl` so teammates can draw the glow — it is not a throttled value, so it
  never sticks stale on the wire. (The `[V]` key is dead: the SP keydown no longer binds it, and the
  MP client still streams a vestigial `held.v` that `setKeys` sets but nothing reads — harmless, but
  a candidate for cleanup in `client/mp.html`.) If you ever add a NON-key trigger for a new game fn
  the server must call, that's when you'd touch `RPC_OK`+`CAPTURE` (see the capture-drift note above).
- **Perfect-dodge seam:** `playerTakeDamage` treats a hit arriving during *active roll i-frames*
  (`p.dodge>0 && p.invuln>0`) as a perfect dodge — melee keeps its pips (we `return` before the
  on-hit pip drop) and opens the riposte window. Keying on `p.dodge>0` (not just `invuln`) is what
  distinguishes a dodge from post-hit/blessing invuln.
- **No parallel damage paths:** Momentum folds into `playerDmgMul()` (the one damage multiplier),
  riposte/Deadeye set the existing `crit` flag, mark bonus multiplies the computed hit, and Heat
  amplification routes through `applyElementOnHit` via `heatAmp()`. Touch those, not a copy.

## Elite affixes (Pillar 3: Shielded / Vampiric / Splitting / Warded)

- **All affix state is SCALARS on the enemy** (`_afxN`, `afxShield`/`afxVamp`/`afxSplit`/`afxWard`,
  `shieldHp`/`shieldMax`/`shieldRegenT`, `wardT`/`wardCd`, the precomputed `afxTag` badge string, and the
  prefixed `name`). packScalar keeps numbers/strings/booleans and DROPS arrays/objects — that is why there
  is deliberately no `e.afx = [...]` array. Affixed elites therefore ride packEnemy → snapshot → the client's
  wholesale enemy adoption → game-side drawEnemy with **zero mp.html changes**, and absent fields default OFF
  (old saves and pre-affix enemies behave identically).
- **Elite-only invariant:** affixes roll ONLY in `rollEliteAffixes`, called from `makeElite` (and the
  keep-guardian branch, after its rename so the prefix/shield read the final identity). It refuses
  isBoss/isNemesis/isGreatBeast/isWildDragon/isFinalBoss/named/dread/warlordRef and never re-rolls
  (`_afxN` set = done). Party gate: 1 affix at partyLvl ≥15, 2 at ≥22, distinct picks.
  `rollEliteAffixes(e, maxAfx)` is the hook for the later pinnacle/cycle 3-affix budget (pass 3);
  pass 0 to suppress. (The `triggerEvent` war-pack sets a bare `e.elite=true` without `makeElite` —
  those event mobs intentionally stay affix-free.)
- **One damage gate:** every player/ally/companion→enemy hp subtraction routes through `afxHit(e,dmg)`
  (`e.hp-=afxHit(e,dmg)`) — ward immunity and shield absorption live there and nowhere else; non-affixed
  enemies pay one falsy check. **A new damage site must route through afxHit.** Enemy→player contact damage
  goes through `enemyStrike(e,amt)` (`playerTakeDamage` now RETURNS the damage actually dealt) so vampiric
  healing has one seam; hostile projectiles carry `ownerRef` = the shooting ENEMY (object ref — packScalar
  drops it on the wire; world.js's friendly-shooter stamp is gated on `pr.friendly`, so no clash).
- **Copies never split & carry no site tags:** `afxSplitDeath` (killEnemy) builds the two 45%-stat copies
  from an explicit WHITELIST — type/color/size/speed/homeDf/aquatic only. poiKey/holdKey/raidTown/legion/
  guardian/treasure/cycle/night/elite are deliberately NOT copied, so liberation/siege sweeps (SP inline and
  the MP `_seen` sweeps) never wait on scraps, and `_splitChild:1` blocks both re-splitting and future affix
  rolls. `dominateElite` likewise builds its ally from a fresh whitelist — dominating an affixed elite yields
  a CLEAN thrall (name scrubbed of affix words).
- **Ward windows are timer-bounded** (66 frames up per 300 down, ticked at the TOP of updateEnemies before
  the stun/aggro `continue`s), so a warded quest/bounty target can never be immune-locked, even leashed,
  stunned, or attacked from beyond aggro range.
