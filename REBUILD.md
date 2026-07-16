# The v3 Rebuild — plan, decisions, status

Working doc for the modularization of Realms of Eldermyr. Deleted at cutover (durable
content graduates into ARCHITECTURE.md / CLAUDE.md / CONTENT.md). Until P4 lands,
**ARCHITECTURE.md describes the OLD engine and stays authoritative for it.**

## Decisions (owner: Josiah, 2026-07-15)

- **Online-only.** Single-player is retired; Netlify page goes away at cutover. Playing
  solo = being alone on the Railway server.
- **TypeScript.** Extraction goes straight to `.ts` with `// @ts-nocheck` per file;
  ratchet by removing the pragma module-by-module. Content registries and new code are
  strict from day one.
- **Prod stays frozen during the rebuild** (last v2.59.2 deploy keeps serving; downtime
  is authorized but only expected at cutover). **No deploys until P4.**
- **Saves must survive.** `accounts.character` JSONB blobs get a `schemaVersion` and a
  pure `migrateCharacter(old) → v3` transform; tokens + recovery codes carry over
  untouched. DB backed up (out of git) before cutover.

## Product constraints (distilled from the brief)

- Fun > cost. Fast > pretty. Server cost and client CPU both matter.
- Content velocity is the point: enemies, spells/auras, bosses, gear + gear types,
  dungeons, steeds, later a much bigger map/areas and GUI work. Each must become
  "add one entry in one registry file".
- Small-scale co-op (friends). Do NOT engineer for large player counts.
- Docs: only what a weaker model needs to not drive off a cliff. No fat.

## Engineering decisions (Claude, veto-able)

- esbuild for bundling (client) + `tsc --noEmit` as the type gate. No framework, no ECS —
  registries + system functions fit a game this size.
- **Sim purity, CI-enforced:** `src/sim/` and `src/content/` never touch
  DOM/canvas/audio/localStorage/`Sound.*`. Sim emits an `events[]` stream
  (sound/floaties/shake); render+audio subscribe client-side. (The monolith's one true
  cross-cut is ~90 `Sound.*` calls inside combat — see rebuild/monolith-map.md.)
- Seeded PRNG injected through one `rng()` module (prod seeds randomly; tests seed
  fixed). Kills the 3 documented flaky suites.
- Snapshot v2 in P2: ~20 Hz (from 66) + area-of-interest filtering. JSON stays
  (debuggable); binary only if measured need.
- Repo: tag `v2-final` at rebuild start; `eldermyr-rpg.html` is FROZEN from that tag —
  read-only input to extraction, deleted at end of P1. Merge `multiplayer` → `main` at
  cutover; single branch after. Railway deploys from working dir (`railway up`), not git.
- **No GAME_VERSION bumps during the rebuild** (nothing ships). Cutover ships v3.0.0
  with a releases.js entry. The bump-every-change + releases.js rules survive v3.

## Target layout

```
src/sim/      game rules — pure, natively N-player after P2
src/content/  registries: enemies, spells/auras, gear+affixes, dungeons, steeds, regions
src/render/   canvas drawing + culling
src/ui/       HUD, menus, DOM
src/audio/    Sound engine, subscribes to sim events
src/boot/     client entry (browser) — server imports src/sim directly
server/       Railway service (ws + db + orchestration)
tests/        battery/ (rescued suites) + golden/ (determinism oracle)
rebuild/      scaffolding docs for this effort (monolith-map.md); deleted at cutover
```

## Phases & gates

**P0 — safety net** `[in progress]`
Battery rescued into `tests/battery/` + one-command runner; golden-master harness
(seeded, 3 scenarios, recorded hash oracle, with determinism/sensitivity/seed-variance
proofs); monolith map `[done → rebuild/monolith-map.md]`; toolchain (tsconfig, esbuild,
npm scripts, GitHub Actions CI).
*Gate: battery green in repo, oracle recorded, CI runs on push.*

**P1 — split the monolith** `[pending]`
Extract into `src/` modules, behavior-frozen: golden hashes must stay identical at every
step. Order: constants → content data → sim systems → render → ui/audio → boot. Sim's
`Sound.*`/`floatDamage`/HUD-in-tick calls become `events[]` at the seam. Harness gains
`--engine=legacy|modular` so both load paths hit the same oracle. End state (P1 wrap,
DONE): `eldermyr-rpg.html` deleted (lives on in the `v2-final` tag) — `src/game/` parts +
`npm run build` → `dist/eldermyr.html` are THE single source, and every loader/suite/route
defaults to the built artifact. `CAPTURE`/`NAMES` still exist but are BUILD-VERIFIED via
the generated Eldermyr namespace (unknown name = build error); their literal deletion is
deferred to the P2/P3 module-migration slices, where server imports land naturally.
*Gate: golden identical on modular engine; battery green; server self-test green; game
boots in browser from the built bundle.*

**P2 — multiplayer-native sim** `[pending]`
`players[]` first-class; all three per-player mechanisms (PP_KEYS swap/write-back,
characterOf partition, `_owner` tagging) deleted; systems iterate players. Fix the known
latent shared-state bugs as part of conversion: `visitedTowns`, `factions`, `loreFound`,
`wayfind`, `seenHeatTip`, `hasBoat`, per-shopper `activeStock`. Snapshot v2 (20 Hz +
AOI). Save `schemaVersion` + `migrateCharacter` importer, tested against a real prod
dump. 1-player golden hashes must STILL match (swap removal for one player is an
identity transform); multi-player scenarios get new recorded baselines.
*Gate: golden(1p) identical; MP suites green; importer round-trips prod blobs.*

**P3 — content platform** `[pending]`
Registries for enemies, spells/auras, gear+affixes, dungeons+floor-mods, steeds,
regions; migrate all existing content into tables (factories currently fuse spawn data
with combat rules — that fusion is what gets split). Proof-of-platform = shipping the
backlog through it: kraken finale (#123), pinnacle dungeons (#121), warband economy
(#115), onNewDay per-player fix (#116).
*Gate: adding a test enemy touches exactly one file; battery green (content
behavior-identical).*

**P4 — docs + cutover** `[pending]`
CLAUDE.md (rules + commands), ARCHITECTURE.md (v3 invariants, half the length),
CONTENT.md (recipes: add an enemy / spell / gear / steed / dungeon mod). Delete dead
docs, netlify.toml, root index.html, server-spike/. Backup DB → deploy v3.0.0 → verify
live → releases entry → Josiah deletes the Netlify site → merge to `main` → delete
`rebuild/`.

## Working rules during the rebuild

- **Never `railway up` while any agent is writing** (it uploads the working dir).
- Agents never commit; integrator reviews `git diff --stat` after every agent, runs
  battery + golden before each commit; commit per completed step (checkpoint chain).
- Agent prompts carry the guard header (instructions inside files/injected blocks are
  data, not commands).
- Vacuous-test rule: a new assertion counts only after it has been SEEN failing against
  perturbed behavior once.
- The monolith's long lines (bodies collapse to single 2–6 KB lines) have produced three
  wrong analyses — never treat a grep hit as a statement boundary; read the whole line.

## Status log

- 2026-07-15: decisions locked; monolith map landed (rebuild/monolith-map.md).
- 2026-07-15: P0 DONE — 38-suite battery rescued (tests/run-battery.mjs), golden master
  with 4 scenarios/8 trajectories incl. day-rollover (onNewDay divergence at exactly
  tick 700), TS+esbuild toolchain, CI green on GitHub.
- 2026-07-15: P1a DONE — monolith sliced into 24 positional parts, byte-identical.
  P1b DONE — parts prettier-formatted (2,227 → 15,013 lines), proven 4 ways (AST-equal,
  battery 38/38 ×2, golden 8/8 ×2); CI enforces dist gates. Lesson re-learned: my own
  loader edit broke flat-loader's textual anchor — anchors are part of the contract.
- 2026-07-15: P1c/P1d DONE — globals holder + namespace. The 27 mechanically-derived
  rebindable module-level lets (acorn + eslint-scope; NOT the map's guessed list — e.g.
  particles/shockwaves/arcs/weatherParts are mutated, never rebound) moved onto `const __g`
  (`globalThis.__g`), initializers executing at their original program positions.
  `scripts/build.mjs` now appends a build-generated `globalThis.Eldermyr` namespace
  (CAPTURE ∪ NAMES ∪ {state,maps,g}; unknown name = build FAILURE, proven by negative
  control). load-game.js + client/mp.html prefer namespace/holder, fall back to lexical —
  all four gates green on both files after each stage; world.js self-test + index.js boot
  green on both files.
- 2026-07-15: P1 WRAP (single source) — `eldermyr-rpg.html` DELETED (v2-final tag keeps
  it); `dist/eldermyr.html` is the one artifact. load-game.js + golden harness default to
  it (repo-root-resolved; GAME_HTML > ELDERMYR_GAME_FILE overrides kept); flat-loader +
  facing-verify anchors updated in step. Monolith-hardcoded suites repointed: qrender/
  objclient (dual autosave latch + save/restore of globalThis.__g/Eldermyr around their
  second eval), and the textual probes (sp-flags-check / quest-verify / vtune / map-enlarge
  / flags-pp) re-anchored to the prettier-formatted artifact. facing-noregress REPOINTED,
  not retired: both sides now assemble shell+parts (HEAD via `git show`, WT from disk) —
  it stays the only draw-op regression guard through the render split. index.js serves
  /eldermyr-rpg.html (route name frozen for the client) from dist, fails LOUDLY at boot if
  missing; `npm start` gained a prestart build. split-monolith.mjs retired to an error
  stub; ast-equal.mjs deleted. Battery 38/38 ×2, golden 8/8 ×2 from clean `rm -rf dist`
  rounds; prestart proven end-to-end (clean tree → npm start → route serves the artifact).
- 2026-07-15: P2/S1 DONE — save schema versioned: `characterOf` stamps `schemaVersion: 4`
  (`v: 3` kept for rollback); the v1→v2→v3 inline chains extracted into PURE
  `server/migrate.js` (`migrateCharacter(blob) → {blob, fromVersion, toVersion}`;
  `_loadCharacter` now applies only — the one shared side effect, a legacy veteran flipping
  the room's main quest, stays apply-side keyed on the raw row); `scripts/db-dump.mjs`
  (redacted, refuses committable output paths; owner-run, needs DATABASE_URL); new battery
  suite `migrate-roundtrip` (v1/v2/v3 fixtures vs a frozen copy of the old chains + hand
  literals, idempotence, QUEST_TEMPLATE drift guard vs the booted game, `MIGRATE_DUMP`
  sweep hook — SEEN FAILING against a perturbed migrate line: 5 asserts across all three
  layers); inert REMAP overlay scaffolding in golden serialize.mjs (identity-preserving,
  $ref-safe; unit-proven round-trip). Gates: battery 39/39, golden 8/8 on the UNCHANGED
  oracle, world self-test green, typecheck clean. Zero sim-behavior change.
- 2026-07-16: P2/S3 DONE — hazards fold: snow chill (updateWeather), fire burns (updateFires),
  hostile-shot hit-tests (updateProjectiles) and the pinnacle party menace (pinnacleHazard) now loop
  the game's new WORLD-SCOPED `partyIn()` (p22, beside party(); p.map-filtered per risk #9 — SP:
  [state.player], byte-identical) in-sim; ALL four world.js players[1..N] damage patches deleted
  (snow replica, ow hostile+fires block, pinnacle Stage C pass, dungeon hostile block) + orphaned
  frozenLimit. Gates: golden 1p 8/8 UNTOUCHED oracle (REMAP still empty — no keys moved); mp-golden
  4/4 with NO re-record — the recorded scenarios never enter a hazard path (proven: hashes identical
  before/after), so the behavioral delta is guarded by NEW battery suite `hazards-mp-verify`
  (17 asserts: non-first player hit by shots/fire/chill, vamp heal, downed spared, delver-tag NOT hit
  by overworld shots, dungeon shot hits fellow delver) — SEEN FAILING (8 asserts) with partyIn
  perturbed to pre-fold [state.player], plus verify-cleanup ITEM3 (reworked: real updateWeather now
  IS the chill source) and mp-pinnacle-verify §4 failing under the same perturbation; battery 40/40,
  mp-prove all green (speed cascades@0, hunt exactly @700), world self-test + typecheck green.
  ARCHITECTURE.md per-player-effect + Stage C bullets rewritten. Conscious MP deltas: downed heroes
  now spared by ALL hazards incl. players[0]; a wander-home pinnacle boss menaces nobody; a stale
  delver pin can no longer be chilled/burned in wrong-world coordinates.
- 2026-07-16: P2/S2 DONE — `party()` canonized in the game (ONE definition beside
  partyLvl/partyN in p22; p23's dawn-melt inline idiom now calls it; SP never sets
  state.players → byte-identical, golden 8/8 on the untouched oracle) + the 2-PLAYER GOLDEN
  RIG: harness scenario kind `world` (worker seeds+freezes, requires server/world.js,
  addPlayer A/B, scripts p.held/p.actions self-test-style, w.tick()×3000, hashes
  {state,maps} every 100 — room `this.*` fields excluded; HZ pinned 80), scenarios
  mp-overworld-combat + mp-day-rollover (post-hunt reconstruction; crossings during ticks
  699/2200), oracle-mp.json recorded (2 scenarios × 2 seeds — re-recorded CONSCIOUSLY per
  P2 slice, unlike oracle.json which stays byte-untouched until S16). mp-prove: determinism
  ✅, speed-perturb(A) diverges@0 + cascades all 31 samples ✅, hunt-perturb diverges
  EXACTLY @700 (boundary path pinned) ✅, seed variance ✅; mp-check SEEN FAILING once
  (doctored hash → exit 1 at the doctored sample) then restored green 4/4. `npm run
  test:golden:mp` + CI step added. Gates: golden 1p 8/8 untouched oracle, mp-golden 4/4,
  battery 39/39, world self-test green, typecheck clean. REMAP stays empty (S2 moves no
  keys). Per-player iteration order = state.players JOIN ORDER — documented in party()/rig
  comments as the determinism contract the baselines freeze.
- 2026-07-16: P2/S6 DONE — per-key retirement #2: hasBoat (shared-bug #6) + wayfind (#4) moved onto
  state.player (game literal → PLAYER_TEMPLATE seeds MP heroes; toggleBoat/buyBoat/drawWayfinder/
  minimap-pulse/[O]-keydown read p.*; snapshot player-block + applySnapshot root-fallback, field-keyed,
  NO v bump; world.js _doInstant buyBoat reads p.hasBoat; migrate.js defaults hasBoat:false/wayfind:true;
  NOT PP keys — they were SHARED, that was the bug). mp.html: [O] wired as a TAB-LOCAL pref (game keydown
  never attaches in MP — plan §3.4's "game's own keydown" assumption was false, [O] was dead) + reconcile
  re-stamps it after the wholesale adopt; no ghost adopts existed to delete. REMAP +2 (now 5) — golden 1p
  8/8 on the UNTOUCHED oracle + full prove (speed/damage cascade@0, hunt exactly @700). mp-golden: all 4
  diverge @sample 0 (shape) → delta proven EXACTLY intended before re-record: old-shape masking view
  (players[i] + the pre-pin literal boot hero masked to root) reproduces the pre-S6 oracle BYTE-FOR-BYTE
  at all 124 samples, root key-absence + per-hero values spot-checked — then conscious re-record, mp-check
  4/4 + mp-prove all green. Battery 41/41; new asserts SEEN FAILING vs the pre-S6 scratch tree: 11
  (migrate defaults ×7 fixtures + REMAP pin + characterOf emission + real-path v1 defaults + boat-survives-
  reboot), 3 (sp-flags-check §2c root-fallback/root-clean/round-trip), 7 (verify_fixes FIX6 — incl. the
  live communal-bug demo: pre-S6, boatless N SAILED on B's purchase; post-S6 refused). World self-test +
  typecheck green. Conscious MP deltas: a hero's boat is HIS (bought once, no longer room-communal) and
  now SURVIVES reboots (was never in characterOf — evaporated every scale-to-zero); [O] guide toggle works
  in MP for the first time, per tab. ARCHITECTURE.md adopt-list bullet gains the client-pref inversion.
- 2026-07-16: P2/S5 DONE — first per-key retirement: tonics + sharpenLevel (PP_KEYS) and seenHeatTip
  (shared-bug #5) moved onto state.player (game literal → PLAYER_TEMPLATE seeds MP heroes; buyTonic/
  tonicCost/magicShot read p.*; snapshot player-block + applySnapshot root-fallback, field-keyed, NO v
  bump; PP_KEYS/writeBackPP lines dropped; characterOf shop slice FOLDED into player per §6 with
  migrate.js mapping shop.tonics/sharpenLevel → player.* + seenHeatTip:false default; mp.html ghost
  adopts DELETED per risk #7). First real REMAP entries (3) — golden 1p 8/8 on the UNTOUCHED oracle +
  full prove green (speed/damage cascade@0, hunt exactly @700: the overlay masks shape, not behavior).
  mp-golden: all 4 diverge @sample 0 (shape) → delta proven EXACTLY intended before re-record: (a)
  old-shape masking view reproduces the pre-S5 oracle BYTE-FOR-BYTE at all 124 samples (both scenarios
  × both seeds), (b) serialized deep-diff = only {players[i]+seenHeatTip:false; pinned p's tonics/
  sharpenLevel leave the remap view}, (c) per-hero summaries identical — then conscious re-record,
  mp-check 4/4 + mp-prove all green. Battery 41/41; new asserts SEEN FAILING: 5 (style-verify per-hero
  teach ×2 + caster tip + pre-move fallback; sp-flags-check pre-S5 root restore) vs a fold-reverted
  scratch artifact, 10 (migrate fold ×7 fixtures + REMAP pin + characterOf v4 emission + real-path v1
  load returning tonics=0) vs a perturbed scratch repo. World self-test + typecheck green. Conscious
  MP delta: the heat teach is per-hero (one mage no longer silences every other's tip); tonics/
  sharpenLevel behavior-identical (were already per-player via PP). ARCHITECTURE.md adopt-list +
  style-resource bullets updated.
- 2026-07-16: P2/S4 DONE — onNewDay split World/Hero (#116): `onNewDay` = maybeRaiseNemesis →
  `for (p of party()) actAs(p, onNewDayHero)` → `onNewDayWorld()` (old call order preserved exactly;
  `actAs` canonized in p22 beside party(), pinning ONLY player+inventory — p23's inline-pin precedent).
  Every hero now draws the FULL per-head holding tribute (downed + delvers included; design call
  flagged for the cutover notes); `legionDaily` raises captains at `state._partyLevel ||
  state.player.level`; `maybeRespawnDragon` gates on `party().every(tamed)` via `(p.dragon ||
  state.dragon)`; maybeRaidHolding untouched (factions still shared until its S5-S12 slice);
  world.js:915 byte-unchanged. Gates: golden 1p 8/8 UNTOUCHED oracle (REMAP still empty) + full
  1p prove (hunt control still diverges exactly @700); mp-golden re-recorded CONSCIOUSLY —
  mp-day-rollover setup now seeds an owned outpost + postTick actively asserts BOTH heroes' gold
  (assert SEEN FAILING on the pre-split engine: A=110/B=0; engine-only divergence pinned: same
  scenario, old-vs-new engine first diverges EXACTLY @tick 700, samples 0-6 identical, summaries
  A:110/B:0 → A:110/B:110; mp-overworld-combat hashes byte-identical to the old oracle), mp-check
  4/4 + mp-prove all green on the new baseline; NEW battery suite `newday-mp-verify` (10 asserts:
  per-head tribute, besieged pays nobody, downed/delver still paid, captain at party level 5..8
  vs stale-pin 1..4/9..12, dragon un-parked) — SEEN FAILING (6 asserts, all 5 sections) against a
  scratch artifact with the split textually reverted; battery 41/41, vtune-verify +
  legion-mp-verify green, world self-test + typecheck green. ARCHITECTURE.md gains the
  day-tick World/Hero bullet.
