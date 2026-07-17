# Eldermyr verification battery — manifest

Standalone Node suites that drive the **real** game headlessly
(`server/load-game.js` + `server/world.js`) or boot the MP server, assert behavior,
and exit nonzero on any failure. Rescued from an accumulated scratchpad of ~198 files.

Run them all as one command from the repo root:

```
node tests/run-battery.mjs            # every suite; nonzero exit if any fails after retry
node tests/run-battery.mjs style map  # only suites whose name matches an arg
```

The runner spawns each suite as a child process (per-suite 180 s timeout), retries the
known-flaky ones once, prints a `suite | result | seconds` table, and exits nonzero if any
suite still fails. Full battery is ~11 s wall on a warm tree.

Each suite resolves the repo root from its own location (`path.resolve(__dirname, '..', '..')`),
so the battery runs from any checkout. No suite needs a database; `server/load-game.js`,
`server/world.js`, `server/index.js`, `node_modules/pg`, and `server/node_modules/ws` must exist.

## Known-flaky suites (retried once by the runner)

| Suite | Rate | Cause |
|---|---|---|
| `ranged-verify` | ~1/12 | projectile-spread RNG |
| `pinnacle-verify` | ~1/12 | "boss drifts home" positional race |
| `style-verify` | ~7% | Quarry Marks accrual timing |

These are pre-existing, documented flakes in the source suites — not tree regressions.

## Kept suites (38) — what each guards

### Load-and-orchestrate + server-boot invariants
- `v1-timers` — load-game restores the REAL global timers after boot (setTimeout/setInterval fire & clear; rAF stays stubbed).
- `v2-inertness` — headless inertness: no leaked autosave/music interval, no stray-timer throw, process drains to `beforeExit`.
- `v3-missing-captures` — the committed CAPTURE list resolves zero `__missingCaptures`, and the drift filter flags a bogus symbol.
- `v4b-fullstack` — end-to-end: `server/index.js` boots ephemerally on a high port; a ws client gets welcome + map + authoritative snapshots.
- `v5-pg-timeout` — the pg connection-timeout timer fires (real global `setTimeout` restored); pre-fix this hung forever.

### Combat / style-identity / loot
- `style-verify` — Pillar 1 style identity (Momentum / Quarry Marks / Heat+Vent); enemy `_markBy` never leaks into a snapshot.
- `affix-verify` — Pillar 3 elite affixes (Shielded / Vampiric / Splitting / Warded) spawn and behave.
- `ranged-verify` — the ranged rework: Ricochet fix, visible Marks, Deadeye feedback, late-burst.
- `combat-nerf-verify` — the v2.56.3 combat nerfs stay applied.
- `uniques-verify` — Pinnacle Stage B: the 4 chase uniques and their `recalcStats`.
- `vtune-verify` — balance tuning: diffMul distance curve, hunt/legion 1:1 levels, `_rescaleThreats` idempotency.

### Abilities / dominate / balance fixes
- `verify-overlord-dominate` — the Overlord-domination softlock fix.
- `verify_fixes` — the per-player-state fixes in `server/world.js` + client adopt shapes.
- `verify-cleanup` — the final MP cleanup wave (world.js items 1–4, 6–8, 11).

### Quests + personal-milestone flags (per-player)
- `quest-verify` — completed / no-longer-relevant intro quests retire correctly.
- `quest-pp-verify` — the questline is PER-PLAYER across the full chain (swap / save / snapshot / adopt); orchestrator spawns a fresh child per case.
- `flags-pp-verify` — the personal-milestones split: `enteredDungeon`/`gotKey`/`enteredFrozen` per-hero vs `krakenDead`/`legionBroken` world-facts; orchestrator.
- `sp-flags-check` — the single-player half of that split: the v5→v6 save migration is lossless (dungeon door / wayfinder don't reset).
- `migrate-roundtrip` — the pure save importer `server/migrate.js` (rebuild S1): v1/v2/v3 fixtures vs a frozen copy of the old inline chains + hand-derived literals, idempotence/purity, `characterOf` stamps `schemaVersion: 4`, QUEST_TEMPLATE drift guard against the booted game, and the inert golden REMAP overlay unit proof. `MIGRATE_DUMP=<db-dump path>` additionally sweeps every real blob (no-throw, monotone, idempotent).

### World systems
- `rift-check` — `_enterRift` restores ALL world slots on every failure path (mirrors the dungeon `finally`).
- `warband-delve` — per-owner warband delving (the entering player's own warband follows them down).
- `camp-seeker-verify` — camping in a dungeon/rift (no shared-clock skip) + Seeker Bolt behavior.
- `camp-exhaust-verify` — camping in a dungeon CLEARS Exhausted, per-player (v2.56.5).
- `fatigue-mp-verify` — updateFatigue-in-MP (rebuild P2, the last shared-state bug): town rest / vigil regen / markTownVisited / Exhausted edge+drain now run per-hero through the game's own A-shape dispatcher (partyIn, downed spared, world-scoped); world.js's recalc-edge replica is gone.
- `legion-mp-verify` — the Dread Legion roster reaches MP clients (snapshot + welcome payload).
- `vault-slot-verify` — the Key Vault side-room rides `WORLD_SLOTS`; a dungeon player sees this floor's vault, not the overworld's stray.

### Pinnacle / great-beasts (v52)
- `pinnacle-verify` — Pinnacle Stage A bosses (Drowned King + Pale Shepherd).
- `mp-pinnacle-verify` — Stage C pinnacle bosses in 2-player MP (trophy shape on the wire).
- `v52-verify` — the v2.52.0 batch (`_partyN` + warlord atk, rift depth, ally `_aid` in snapshot…).
- `v52-beast-verify` — Great-Beast rescale CALLS `makeGreatBeast` (no formula mirror that would drift).

### Flat apex levels, directional facing, enlarged overworld
- `flat-levels-verify` — v2.57.x flat apex levels (bosses stop scaling above the cap).
- `facing-verify` — the creature-facing fix actually MIRRORS, and facing save/restore is balanced.
- `facing-noregress` — zero-regression: a right-facing creature renders identically to git `HEAD`.
- `facing-mp-verify` — a teammate's steed faces the right way over the MP wire (the `_faceL` scalar).
- `map-enlarge-verify` — the 248×208 → 347×291 overworld resize is valid (sites reachable & correct tier, kraken ring sealed, nothing in the ocean).
- `map-mp-verify` — the MP room boots on the enlarged map; `mapPayload` dims 347×291; 300 spawn/kill ticks clean.

### The hazards fold (rebuild P2/S3)
- `hazards-mp-verify` — snow chill / fire tiles / hostile projectiles loop the game's world-scoped `partyIn()` in-sim (world.js players[1..N] patches deleted): the non-first player takes hazard damage, players[0] unchanged, vamp heal preserved, a delver-tagged hero is NOT hit by overworld shots, a dungeon shot hits a fellow delver, the downed are spared. (The pinnacle menace half of the fold is guarded by `mp-pinnacle-verify` §4.)

### The onNewDay World/Hero split (rebuild P2/S4, #116)
- `newday-mp-verify` — the day tick no longer fires per-player effects against a stale pin: `dailyHoldingIncome` pays EVERY hero the full per-head tribute (besieged outposts pay nobody; delver-tagged and downed heroes still draw — `party()`, not `partyIn()`, tribute isn't positional); `legionDaily` raises fresh captains at the PARTY's level (`state._partyLevel`); `maybeRespawnDragon` gates on the whole party (one tamed hero, even while pinned, no longer parks the wild Emberwyrm). The per-head tribute also has an ACTIVE assert inside the `mp-day-rollover` golden scenario itself.
- `enemies-mp-verify` — the enemy nearest-hero partition INTERNALIZED (rebuild P2/S15): one direct `G.updateEnemies()` call partitions foes by nearest hero itself — B's foe chases B while A is pinned (the pre-S15 trap), survivors regroup in bucket order (join order, wanderers last), the no-restore pin leaves the last roster hero pinned, killEnemy XP/gold/slay credit rides each bucket's OWN hero, a target-less boss (everyone in the town bubble) drops its telegraph and wanders home while an out-of-town hero is chased even when an in-town one is nearer, downed heroes are invisible, and the last-guardian liberation fires INLINE at the kill paying the KILLER (full-roster `state.enemies` — the `__libGate` replacement); plus artifact source guards and a w.tick() regression floor. SEEN FAILING (12 asserts) against a pre-S15 worktree.
- `projectiles-mp-verify` — the projectile SHOOTER partition INTERNALIZED (rebuild P2/S16): one direct `G.updateProjectiles()` call buckets shots by shooter itself — survivors recombine in FIRST-SHOT bucket order (pre-S16 the interleaved push order survives), the no-restore pin leaves the last bucket owner pinned (player + inventory; pre-S16 the body's per-shot repin restores the ambient pin), hostile shots ride the final pass under roster[0]'s pin, the PARKED-SHOTS rule lives in the sim (every hero tagged away → shots frozen; pre-S16 a direct call stepped them), and a bucket kill's INVENTORY writes ride the shooter's own bag (dungeon boss key drop — pre-S16 the key fell into the AMBIENT bag, demonstrated live); plus artifact/world.js source guards and a w.tick() per-shooter kill-credit regression floor. SEEN FAILING (12 asserts) against a pre-S16 worktree (own dist). (S16 also HARDENED `enemies-mp-verify`'s probe placement: worldgen is unseeded, so blind teleport targets — SPAWN+150t/+40t — land in water/rock on some boots and the stepped-toward-hero asserts flaked ~1/4 on BOTH engines; probe arenas now scan for open pockets (`openNear`), probe foes are leash-exempt and never aquatic. 15/15 + 10/10 green post-fix on the changed/pre-change trees.)
- `partyloop-mp-verify` — the LAST world.js partitions FOLDED in-sim (rebuild P2 close; plan §7 S13's remaining sub-slices): one direct `G.updatePlayer()` call walks the whole standing party per each hero's OWN held keys (pre-fold a direct call read the empty global keys and moved nobody; downed frozen, delvers excluded by partyIn, ambient pin = last standing hero); `G.updateAllies()` buckets by `_owner` in-sim (B's thrall's kill pays B — pre-fold it paid the AMBIENT hero, demonstrated live `A 0→25`; unowned allies adopted by the nearest hero, a delving owner's ally idles life-frozen, nameless allies normalized); `G.updateCompanions()` steps each warband toward ITS owner map-scoped (pre-fold B's recruit teleported to the ambient hero); `G.maybeSpawnWild()` owns the density pass (party-scaled ceiling, per-hero `_spawnT` stagger, every sparse vicinity refilled, at-density skipped, downed cadence frozen — pre-fold a direct call spawned nothing and stamped nothing); plus world.js/artifact source guards (partition text gone, movement precedes the action loop) and a w.tick() regression floor. SEEN FAILING (17 of 23 asserts) against a pre-fold worktree at HEAD 11322a2 (own dist).
- `content-purity` — the content build seam (rebuild P3/S1): the compiled `src/content` chunk (strict TS registries → one non-minified iife) is embedded byte-for-byte at the HEAD of the artifact's game program, parses standalone as a classic script with NO top-level `"use strict"` (the concat program stays sloppy-mode), never mentions `document`/`window`/`canvas`/`ctx`/`localStorage`/`Sound`/`state`, assigns `globalThis.CONTENT`, pipes through to the live game (fire.color pin + the game's own `elemRgb()` reading the registry through the p17 alias), and survives a 3,000-tick 2-hero headless run byte-equal to a fresh chunk re-eval (the no-freeze mutation canary, plan risk #3). Tree-resolving: pointing `GAME_HTML` at a scratch worktree's dist exercises THAT tree. SEEN FAILING: fire.color perturbed in a scratch tree → 5c (+1a from the repo suite vs the scratch dist); a scratch part mutating `ELEMENTS` at load → §6.

### Liberation / restore regression tiers
- `t1-knockdown` — co-op knockdown must NOT run the SP `gameOver` path.
- `t2-liberation` — no premature liberation from partitioned combat. Since P2/S15 the protection is STRUCTURAL (updateEnemies keeps `state.enemies` the full roster, so killEnemy's inline last-guardian checks see other heroes' buckets; `__libGate` retired — source-guarded here): the freeing kill liberates INLINE and pays the KILLER, and the `_seen` sweeps' REMAINING job — liberating a site whose last guardian vanished with NO kill event (leash despawn) under players[0] — is probed explicitly.
- `t3-restore` — the dungeon phase restores the overworld even when a sim call throws.
- `t4-regression` — 3 players, ~420 ticks including a real dungeon delve, no throw.

## Helper modules (not run directly)

Required by the suites above; copied alongside them with the same path fix:

- `objclient.js` — client-side objective/reconcile shims (required by `flags-pp-verify`).
- `qclient.js` — client-side quest-adoption shim (required by `quest-pp-verify`).
- `qrender.js` — quest/inventory render defaults (required by `qclient.js`).
- `flat-loader.js` — a `GAME_HTML`-overridable wrapper around `load-game.js` (required by `flat-levels-verify`).

The per-player orchestrators (`flags-pp-verify`, `quest-pp-verify`) write transient
`_flags_save.json` / `_qpp_save.json` into this directory; the runner deletes them on exit and
`.gitignore` covers any left by an interrupted run.

## Also rescued

- `tools/creature-compare.html` — art side-by-side viewer (executes the real `drawEnemy` per build). Not a test; kept as a tool.

---

## Dropped (157 files) — filename + one-word reason

Everything not durable-verification: probes, scratch, build/compare artifacts, logs, and suites
asserting behavior the shipped game no longer has. Grouped by reason.

**stale** — asserts behavior the current tree no longer has (investigated, not a regression):
`verify.js` (expects >2 dominate binds; game caps at 2), `verify-5reqs.js` (3 content checks changed; also exits 0 despite failures), `health-check.js` (expects `/health` to return JSON — it is now a static HTML dashboard; JSON moved to `/health.json`).

**live** — needs an externally-running server / live ws session, not self-contained:
`takeover-test.js`, `legion-live-server.js`, `feedquest-live-server.js`, `quest-live-ws.js`, `map-ws-smoke.js`, `aura-wire-test.js`.

**oneoff** — incremental MP integration probes, superseded by the kept `*-verify` suites:
`test-authdeadline.js`, `test-batch2.js`, `test-batch3.js`, `test-batch4.js`, `test-batch5.js`, `test-dg2.js`, `test-dungeon.js`, `test-interact.js`, `test-interact-prod.js`, `test-interact-ws.js`, `test-needmap.js`, `test-normal.js`, `test-oversized.js`, `test-prod2.js`, `test-prod3.js`, `test-savechain.js`, `test-sell.js`, `test-shared-dg.js`, `test-skills.js`, `test-superseded.js`, `test-warband2.js`, `test-warband3.js`, `test-warband4.js`.

**probe** — one-off investigative scripts (measure/inspect, no durable assertions):
`_dawnmelt-mp.js`, `_diffmul_probe.js`, `_dragon-ttk.js`, `_extract-dragon.js`, `_extract-player.js`, `_pinhaz_probe.js`, `art-isolation-proof.js`, `aura-mp-probe.js`, `aura-style-probe.js`, `authed-smoke.js`, `bosses-live-probe.js`, `bot.js`, `compat.js`, `dungeon-death-probe.js`, `glyph_probe.js`, `legion-baseline.js`, `mk-dbg.js`, `mp-test-hook.js`, `old-branches.js`, `old-drawenemy.js`, `probe.js`, `probe-bounty.js`, `probe-cold.js`, `probe-coop.js`, `probe-npcs.js`, `probe-save.js`, `probe-takeover.js`, `ricochet-reach-probe.js`, `steed-stub-safe.js`, `v52-greatbeast-probe.js`, `v52-mp-extract.js`, `v52-warlord-glance.js`.

**perf** — performance / byte-count / calibration scripts (measure, don't assert):
`calib.js`, `calib2.js`, `count-ops.js`, `count-steed-ops.js`, `curve.js`, `legion-bytes.js`, `perf-3p-styles-affixes.js`, `perf-burst-cmp.js`, `perf-heat-aura.js`, `perf-ranged-burst.js`, `pinnacle-perf.js`, `quest-bytes.js`, `quest-perf.js`, `ram_proof.js`, `seeker-perf.js`.

**gamecopy** — extracted / inlined copies of the game script (drift bait, not tests):
`_addsprobe.js`, `_chk.js`, `_chk_EDITED.js`, `_chk_PRISTINE.js`, `_gamecheck.js`, `_inline.js`, `_qcheck.js`, `_syntax_check.js`, `extracted.js`, `game.js`, `mp-check.js`, `mp-inline.js`, `mp-inline2.js`, `mp-inline-v52.js`, `mp_0.js`, `mp_check.js`, `sp_check.js`.

**build** — whole-file HTML build snapshots for A/B comparison:
`HEAD-game.html`, `_MYBUILD.html`, `_flat_MID.html`, `_flat_OLD.html`, `_pristine.html`.

**fork** — depend on a forked copy of the loader (`load-game-test.js`), a drift risk:
`load-game-test.js`, `ult_damage_regression.js`.

**repro** — minimal bug reproductions, not assertions:
`repro.js`, `repro1.js`, `repro2.js`, `repro3.js`, `repro4.js`.

**superseded** — replaced by this battery or by a kept suite:
`run-battery.sh`, `run-art-battery.sh` (the old shell runners), `verify-camp.js`, `verify-guards.js`, `verify-guard-clean.js`.

**output** — captured stdout of past runs:
`_out_affix-verify.txt`, `_out_flat_NEW.txt`, `_out_flat_OLD.txt`, `_out_map-enlarge.txt`, `_out_ranged-verify.txt`, `_out_rift-check.txt`, `_out_style-verify.txt`, `_out_t1-knockdown.txt`, `_out_t2-liberation.txt`, `_out_t3-restore.txt`, `_out_t4-regression.txt`, `_out_verify-overlord-dominate.txt`, `_out_verify_fixes.txt`, `_out_vtune-verify.txt`, `_out_warband-delve.txt`, `_out_worldself.txt`.

**log** — server/http run logs: `_feedquest.log`, `_legion-live.log`, `_mp8199.log`, `_mpserver.log`, `_sp8137.log`, `httpd.log`, `mp_server.log`, `server.log`.

**fixture** — save-state JSON dumps: `_flags_save.json`, `_qpp_save.json`, `save.json`.

**patch** — one-off Python source patchers (not tests): `patch_ability.py`, `patch_dominate.py`, `patch_fish.py`, `patch_prof.py`, `patch_temper.py`, `patch_ui.py`, `patch_world.py`.

**artifact** — extracted source fragments: `_BASELINE_prefix.txt`, `head-de.txt`, `wt-de.txt`.

**scratch** — source-analysis dumps / helpers: `attr.awk`, `fnindex.txt`, `prefix` (empty), `prefix-tree` (empty), `statekeys.txt`.

**compare** — generator for the kept viewer: `build-compare.js` (emits `tools/creature-compare.html`).

**diff** — `main.diff` (a saved working diff).

**symlink** — `repo` → repo root (a scratchpad convenience; the copies resolve the root themselves).
