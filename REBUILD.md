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
  *Amended (P3/S1, conscious):* content **draw hooks** receive their 2D surface via a
  `DrawView` ARGUMENT (server never calls them) — the rule's intent is "sim can't call
  draw, draw can't mutate sim", not "no art in content". Enforcement = module scope +
  strict tsc + the `content-purity` battery grep on the compiled chunk (no
  document/window/canvas/ctx/localStorage/Sound/state tokens). Registries are
  deliberately NOT frozen (sloppy-mode writes to frozen objects fail SILENTLY — the
  failure class this codebase refuses); the mutation tripwire is the oracles + the
  suite's 3k-tick live-vs-fresh-chunk canary.
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

**P2 — multiplayer-native sim** `[done]`
`players[]` first-class; all three per-player mechanisms (PP_KEYS swap/write-back,
characterOf partition, `_owner` tagging) deleted; systems iterate players. Fix the known
latent shared-state bugs as part of conversion: `visitedTowns`, `factions`, `loreFound`,
`wayfind`, `seenHeatTip`, `hasBoat`, per-shopper `activeStock`. Snapshot v2 (20 Hz +
AOI). Save `schemaVersion` + `migrateCharacter` importer, tested against a real prod
dump. 1-player golden hashes must STILL match (swap removal for one player is an
identity transform); multi-player scenarios get new recorded baselines.
*Gate: golden(1p) identical; MP suites green; importer round-trips prod blobs.*
*END STATE (2026-07-16, S1–S20):* **What died:** the PP_KEYS swap/write-back machinery
(every per-player key now lives ON the player; the two-slot pin IS the swap), the
characterOf shop/quests/dragon/maxDepth/bounty slices (v4 rows are player-slice-only, the
pure `server/migrate.js` importer normalizes v1–v3), `__libGate`, every world.js partition
and replica loop (hazard patches, enemy/projectile partitions, fatigue edge replicas,
allies/companions/spawn passes, the movement rotation — each an in-sim A-shape dispatcher
looping the world-scoped `partyIn()` in join order), the 66 Hz full-fat wire (snapshot v2:
20 Hz + 34t AOI + gated inventory/world-features, measured 3.5× cut), and the golden REMAP
overlay (both oracles re-recorded native in a paired operation). **What deliberately
remains world.js-side:** grabWorld/putWorld dungeon-vs-overworld instancing (plan §1 —
P3+ scope), the per-hero ACTION loop + `_runActions` (RPC allow-list, dungeon enter/
descend/exit choreography, rift breach — orchestration that cannot live in-sim, every
handler under the game's own `actAs`), the ownership STAMPS (ownerRef/ownerId/_owner —
plan M3: tags are sim data, the loops died), downed/revive, the liberation `_seen`
reconciliation sweeps, unstick, threat rescale, rift, feed, serialization; the plan's
aspirational single `G.simTick()` was consciously implemented as one-call-per-system
dispatchers instead (the accepted S15+ pattern), and the "input slice" (uniform p.held
read) stays deferred per the plan's own note — the game's `keys{}` is the one input
carrier, stamped per-hero by the movement dispatcher in MP. **Bug ledger (9/9 fixed):**
the plan's seven — visitedTowns #1, factions #2, loreFound #3, wayfind #4, seenHeatTip #5,
hasBoat #6, per-shopper shop session #7 — plus onNewDay's stale-pin day tick (#116, the
World/Hero split) and updateFatigue-never-ran-in-MP (town rest/regen/drain now exist in
MP). **Gate receipts:** golden 8/8 + full prove and mp-golden 4/4 + full mp-prove on the
NATIVE post-drop baselines (speed/damage cascade @0, hunt exactly @700); battery 45/45
(every new/reworked assert SEEN FAILING against scratch worktrees); world self-test +
typecheck green; live 2-hero + SP browser smoke clean. Importer: round-trips synthetic
v1/v2/v3 fixtures in CI every run; the real-prod-dump sweep is the owner-run
`MIGRATE_DUMP` hook + `scripts/db-dump.mjs` (needs DATABASE_URL) — unchanged since S1 and
still the pre-cutover checklist item.

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
- 2026-07-16: P2/S7 DONE — per-key retirement #3: shopPurchased + cargo + fishCd + lastRestDay moved onto
  state.player (game literal → PLAYER_TEMPLATE seeds MP heroes; buyWeapon/buyArmor/renderShop/buyGood/sellGood/
  tryFish/tickFishing/resetFishing/updatePlayer-cd/daysSinceRest/doCamp/updateFatigue/doTravel/doTravelHold/
  canInteract read p.*; snapshot player-block + applySnapshot root-fallback, field-keyed, NO v bump — fishCd
  stays UNSAVED/reset-0 exactly as always; PP_KEYS 10→6, writeBackPP lines dropped, addPlayer seeds → template,
  doCamp RPC's S-mirror dissolved with the un-skipped-clock recompute kept; characterOf shop slice folded to
  {ingredients} with migrate.js S7 fold shop.shopPurchased/cargo → player.* (cargo normalized; lastRestDay
  deliberately NOT defaulted — absent = join-rested, so old-row veterans don't join Exhausted); mp.html ghost
  adopts S.cargo/S.lastRestDay DELETED per risk #7 + shop-open pre-seed/optimistic-buy/panel-sig repointed to
  state.player.shopPurchased). REMAP +4 (now 9) — golden 1p 8/8 on the UNTOUCHED oracle + full prove
  (speed/damage cascade@0, hunt exactly @700). mp-golden: all 4 diverge @sample 1 unmasked (shape; sample 0
  matches because the boot-literal pin IS the remap view) → delta proven EXACTLY intended before re-record:
  old-shape masking view (root keys re-presented from the LAST-SWAPPED hero, recovered via S.ingredients
  object identity; boot-literal keys moved root-ward at sample 0) reproduces the pre-S7 oracle BYTE-FOR-BYTE
  at all 124 samples, and old-vs-new engine end-state summaries are IDENTICAL per hero — then conscious
  re-record, mp-check 4/4 + mp-prove all green. Battery 41/41; new asserts SEEN FAILING vs a pre-S7 HEAD
  worktree (own dist build): 11 (migrate-roundtrip: 7 fold fixtures + REMAP pin + characterOf S7 emission +
  real-path v1 fold + rest-day-survives-reboot), 1 (verify_fixes FIX1 rework — the writeback stomp), 2+2
  (camp-exhaust/camp-seeker player-native rests), 2+crash (sp-flags-check §2d root-fallback/defaults/round-trip).
  World self-test + typecheck green; live browser smoke: join/combat/downed/respawn clean, 0 console errors,
  all 4 keys ride `me`→state.player with ZERO ghost root keys, renderShop reads p.cargo/p.shopPurchased in the
  real DOM. Conscious MP deltas: a hero's lastRestDay now PERSISTS via the player slice (no more free rest on
  every reconnect; old rows keep join-rested), and shop purchases/trade hold survive exactly as before via the
  player slice instead of the shop slice.
- 2026-07-16: P2/S8 DONE — per-key retirement #4: ingredients (the forage pantry) moved onto
  state.player (game literal → PLAYER_TEMPLATE seeds MP heroes; gainIngredient/canCook/cook/
  sellIngredient/renderCook/shop-forage-list read p.*; snapshot player-block + applySnapshot
  root-fallback, field-keyed, NO v bump; PP_KEYS 6→5, writeBackPP line dropped, addPlayer seed →
  template; characterOf's `shop` slice DIES — migrate.js S8 fold shop.ingredients → player.*
  (normalized like the old apply-side merge) + deletes the emptied slice so migrate(old row) ≡
  characterOf(new hero); world.js _loadCharacter's c.shop block deleted). mp.html ghost adopt
  S.ingredients DELETED per risk #7 (panel sigs already read snap.me). REMAP +1 (now 10) — golden
  1p 8/8 on the UNTOUCHED oracle + full prove (speed/damage cascade@0, hunt exactly @700).
  mp-golden: delta proven EXACTLY intended before re-record — old-shape masking view (root
  ingredients re-presented from the last-swapInPP'd hero, recovered by quests+dragon object-
  identity AGREEMENT; at sample 0 the boot-literal pin IS the remap view) reproduces the pre-S8
  oracle BYTE-FOR-BYTE at all 124 samples, and old-vs-new engine per-hero end-state summaries are
  IDENTICAL on all 4 trajectories — then conscious re-record, mp-check 4/4 + mp-prove all green.
  Battery 41/41 (migrate-roundtrip now 125 asserts); new asserts SEEN FAILING vs a pre-S8
  HEAD-c55e3bf worktree (own dist): 11 (migrate fold ×7 fixtures + REMAP pin + characterOf S8
  emission + real-path v1 fold returning an all-zero pantry + pantry-survives-reboot) + 2+crash
  (sp-flags-check §2e root-fallback/default/root-clean). World self-test + typecheck green; live
  browser smoke: join clean, 0 console errors, NO ghost state.ingredients, THE HEARTH panel
  renders the pantry off state.player.ingredients in the real DOM; headless RPC drive: cook +
  sellIngredient consume the acting hero's OWN pantry (bystander untouched), characterOf row
  carries player.ingredients with NO shop slice. Conscious MP delta: NONE behavioral (ingredients
  was already per-player via PP) — a pure carrier move; the pantry still persists, now via the
  player slice.
- 2026-07-16: P2/S9 DONE — per-key retirement #5: visitedTowns (shared-bug #1) + the per-shopper SHOP
  SESSION (shared-bug #7: activeShopTown/activeStock/activeShopName) moved onto state.player (game
  literal → PLAYER_TEMPLATE seeds MP heroes with visitedTowns:[0]-spawn-town + closed session;
  markTownVisited/renderTravel/openShop/buyGood/sellGood/renderShop read p.*; snapshot player-block +
  applySnapshot root-fallback for visitedTowns ONLY, field-keyed, NO v bump — the session stays
  UNSAVED/reset-(-1) exactly as always; migrate.js default visitedTowns:[]; PP_KEYS stays 5 but
  swapInPP's `_shopTown → S.activeShopTown` special case + the `p._shopStock` stash DIE — shopPayloadFor
  stamps the game's own player fields and the buyWeapon/buyArmor RPC resolves against p.activeStock;
  safeClone skips `activeStock` (the fat stock rides the ONE shopData payload, never `me` at 66 Hz)).
  mp.html: shopData repointed to the player fields via tab-local `localShop`, re-stamped after the
  wholesale adopt (the S6 wayfind inversion — without it the panel blanks in 15 ms since activeStock is
  off the wire); old root writes deleted per risk #7. REMAP +4 (now 14; stock/name no-op unless a
  session is open) — golden 1p 8/8 on the UNTOUCHED oracle + full prove (speed/damage cascade@0, hunt
  exactly @700). mp-golden: all 4 diverge @sample 0 (shape — pre-S9 heroes had NO such keys) → delta
  proven EXACTLY intended before re-record: old-shape masking view (S9 keys hidden on every hero incl.
  the boot literal; root re-presented as the boot hero's visitedTowns + activeShopTown -1@sample-0/null
  after — pre-S9 swapInPP always-assigned null; hashed under the 10 pre-S9 REMAP entries) reproduces the
  pre-S9 oracle BYTE-FOR-BYTE at all 124 samples, and old-vs-new engine per-hero end-state summaries are
  IDENTICAL on all 4 trajectories — then conscious re-record, mp-check 4/4 + mp-prove all green. Battery
  41/41; new asserts SEEN FAILING vs a pre-S9 HEAD-9f3b396 worktree (own dist): 11 (migrate default ×7
  fixtures + REMAP pin + characterOf S9 emission + real-path v1 default + travel-list-survives-reboot),
  2+crash (sp-flags-check §2f root-fallback/default; crash at the S9 snapshot-shape probe), 7
  (verify_fixes FIX7 — incl. the live hole demo: pre-S9 a hero who NEVER opened a shop bought furs for
  38 g through the null-bridge `i < 0` guard slip; post-S9 refused). World self-test + typecheck green;
  live browser smoke (MP + SP pages off the same dist): join clean, 0 console errors, ZERO ghost root
  keys, the shop panel renders stock/name/trade off state.player.active* in the real DOM and SURVIVES
  3 s of reconciles (the re-stamp), SP [T] travel panel renders off state.player.visitedTowns. Conscious
  MP deltas: a hero's discovered-towns list is HIS and now SURVIVES reboots (was shared + never saved);
  a session-less buyGood/sellGood RPC now prices like SP (-1 guard) instead of slipping to town-0
  prices; fresh joiners start with the spawn town discovered (SP parity via the template).
- 2026-07-16: P2/S10 DONE — per-key retirement #6: sailing + dragon (the steed) moved onto state.player
  (game literal → PLAYER_TEMPLATE seeds MP heroes; toggleMount/toggleBoat/tameDragon/updatePlayer-movement/
  maybeSpawnWild-serpents/doDodge/enterDungeon-dismount/openTravel/recalcStats-×1.6/HUD-Flying/drawPlayer/
  canInteract-fish read p.*; maybeRespawnDragon's S4 `(p.dragon || state.dragon)` fallback retired — p.dragon
  now always exists; setupOverworld wild-wyrm gate reads the boot hero; dragonLair/dragonRespawnDay stay
  WORLD state). Save: snapshot player-block gains `dragon` (spread as-saved, root emission dies) +
  applySnapshot player-first/root-fallback, always re-grounded; sailing stays UNSAVED/landfall-on-load
  exactly as always; PP_KEYS 5→3 (quests/maxDepth/bounty), writeBackPP lines dropped, addPlayer seeds →
  template; characterOf's top-level `dragon` slice DIES (rides snap.player) with migrate.js S10 fold
  dragon.tamed → player.dragon={tamed,mounted:false} (top-level deleted; v1 rows synthesize NOTHING —
  template default stands, the lastRestDay precedent); _loadCharacter grounds mounted+sailing explicitly.
  mp.html: drawOthers' root S.sailing/S.dragon override+restore pair DELETED — the TEMP hero object carries
  op.sailing (rides the op spread) + a stamped dragon, and the reconcile's two ghost adopts DELETED per risk
  #7. REMAP +2 (now 16) — golden 1p 8/8 on the UNTOUCHED oracle + full prove (speed/damage cascade@0, hunt
  exactly @700). mp-golden: delta proven EXACTLY intended before re-record — old-shape masking view (root
  sailing/dragon re-presented from state.player, valid because every S.player pin was paired with swapInPP;
  boot-literal player keys hidden; hashed under the 14 pre-S10 REMAP entries) reproduces the pre-S10 oracle
  BYTE-FOR-BYTE at all 124 samples, native run diverges @sample 1 (shape only; sample 0 = the boot-literal-
  pin-is-the-remap-view precedent), and old-vs-new engine per-hero end-state summaries are IDENTICAL on all
  4 trajectories — then conscious re-record, mp-check 4/4 + mp-prove all green. Battery 41/41; new asserts
  SEEN FAILING vs a pre-S10 HEAD-2cc18b7 worktree (own dist): 11 total — 6 migrate-roundtrip (fold ×2 +
  REMAP pin 14≠16 + characterOf S10 emission + real-path v2 fold + steed-survives-reboot-via-player-slice),
  2+crash sp-flags-check §2g (root-fallback/default; TypeError at the S10 snapshot-shape probe), 2
  verify_fixes FIX2 (root ghosts existed pre-S10; characterOf shape), 1 facing-mp-verify (drawOthers
  temp-hero probe). World self-test + typecheck green; live browser smoke (MP + SP off the same dist): join
  clean, 0 console errors, ZERO ghost root keys surviving reconciles, [G]/[B] full RPC path refusals read
  p.*, SP tame→mount (+atk 6→10, Flying pill, steed art renders off p.dragon) and set-sail→landfall clean.
  Conscious MP deltas: NONE behavioral (both keys were already per-player via PP) — but the tamed steed now
  persists via the player slice like everything else (v4 rows carry player.dragon, no top-level slice), and
  a teammate's boat/flight renders without root-key override gymnastics. ARCHITECTURE.md PP_KEYS + LESSON
  bullets updated.
- 2026-07-16: P2/S11 DONE — per-key retirement #7: factions (shared-bug #2) + loreFound (#3) moved onto
  state.player (game literal → PLAYER_TEMPLATE seeds MP heroes; addRep/facTierIdx/dreadLootBonus/
  renderFactions/readLoreStone/drawLoreStone/quest-log read the ACTING hero; NOT PP keys — both were
  SHARED root bugs: one hero's kills swung everyone's prices/aggro, one scholar ate everyone's +40 XP,
  and neither was in characterOf — reboots reset the room). TWO party seams canonized beside addRep (p13):
  `addRepParty` (party news — liberations/siege-breaks/war's-end/thrall-raid/repel loop party() via actAs,
  delvers included) and `partyRep` (shared-phase reads = the party's EXTREME: vigil/dread max, wilds min —
  faction-war raid/stampede/patrol gates, raid sizing, nemesis presence ×2, thrall loyalty, maybeRaidHolding's
  dread≥15 per plan §3.2 with the RNG-guarding short-circuit preserved). Save: snapshot player-block +
  applySnapshot player-first/root-fallback, field-keyed, NO v bump; migrate.js defaults {0,0,0}/[] (no
  historical source — the reset is the documented floor); world.js `_qJson` stringify + snap/questPayload
  loreFound → per-hero (a stone read re-syncs only the READER's box). mp.html: adoptQuests loreFound adopt
  REPOINTED to state.player (not deleted — the ws.onmessage box repaint must not race the frame-loop
  me-adopt, and the me-less `welcome` seed covers takeovers); no factions adopt ever existed (rides me).
  REMAP +2 (now 18) — golden 1p 8/8 on the UNTOUCHED oracle + full prove (speed/damage cascade@0, hunt
  exactly @700). mp-golden: delta proven EXACTLY intended before re-record — (a) masked-equality: old-vs-new
  engine with the S11 keys hidden are IDENTICAL at all 124 samples (nothing but the moved ledgers changed:
  positions/RNG/gold/XP/kill-timing byte-equal; no world-reaction boundary crossed in-window), (b)
  mp-day-rollover old-shape masking view reproduces the pre-S11 oracle BYTE-FOR-BYTE at all samples (zero
  rep events → pure shape), (c) mp-overworld-combat = the attribution split itself: Σ(per-hero ledgers) =
  old shared root within 1 ulp (Δ≤6.2e-15, float regrouping of the same increment stream), asymmetric
  per-hero splits shown (seed 98765: A 9 kills' rep, B 14) — then conscious re-record, mp-check 4/4 +
  mp-prove all green. Battery 41/41; new asserts SEEN FAILING vs the pre-S11 HEAD-8a45b98 worktree (own
  dist): 11 migrate-roundtrip (defaults ×7 fixtures + REMAP pin 16≠18 + characterOf S11 emission +
  real-path v1 defaults + standings-survive-reboot), 2+crash sp-flags-check §2h (root-fallback/defaults;
  TypeError at the S11 snapshot-shape probe), 2+crash verify_fixes FIX8 (kill-rep attribution + the root-
  ghost demo showing the live communal pool {vigil:60.15,wilds:-0.4}; TypeError at the partyRep raid probe
  — the per-hero surface doesn't exist pre-S11; FIX8's 11 asserts also demo ONE infamous hero drawing the
  raid, liberation rep reaching the delver, and the same stone paying BOTH heroes' first-read XP through
  the real 'interact' path). qrender/qclient/objclient/quest-verify mirrors repointed to the player key.
  World self-test + typecheck green; live browser smoke (MP + SP off the same dist): join clean, 0 console
  errors, ZERO ghost root keys surviving reconciles, Standing panel renders tiers/perks off
  state.player.factions in the real DOM, reconcile re-stamps server truth in <400 ms, SP stone read pays
  once + quest-log "Realm-stones discovered: 1/9" off p.loreFound + snapshot/applySnapshot round-trip clean.
  Conscious MP deltas: rep is YOURS (kills credit the killer; prices/loot/aggro/regen follow YOUR standing),
  party-news events pay every hero, the world reacts to the party's extreme member, both keys now SURVIVE
  reboots (never persisted before), and every hero re-earns standings/stones once at migration (no source).
  ARCHITECTURE.md: PP_KEYS bullet + NEW reputation-seams bullet + adopt-list S11 note.
- 2026-07-16: P2/S12 DONE — per-key retirement #8 (the LAST before quests): maxDepth + bounty moved onto
  state.player (game literal → PLAYER_TEMPLATE seeds MP heroes; rollBounty/openBounty/bountyProgress/
  enterDungeon/descend/currentObjective/quest-log/computeScore/recordRun/victory/gameOver read p.*;
  PP_KEYS 3→1 (quests only), writeBackPP's two founding-hazard lines dropped (the Math.max NUMBER and the
  wholesale-replaced OBJECT — the mirror's whole reason to exist — are structurally dead: the game writes p
  directly), addPlayer seeds → template; world.js _enterRift bumps p.maxDepth, _doInstant openBounty reads
  p.bounty under the caller's pin). Save: snapshot player-block + applySnapshot player-first/root-fallback,
  field-keyed, NO v bump; characterOf's top-level maxDepth/bounty DIE (ride snap.player) with migrate.js S12
  fold (old-chain normalization preserved: clamped int / falsy→null / v1 forced 0/null; top-level copies
  deleted, MOVE not dual-write); _loadCharacter's explicit assigns dropped (Object.assign lands them).
  mp.html: adoptQuests stamps state.player.bounty/maxDepth (REPOINTED, not deleted — the ws.onmessage box
  repaint + the me-less welcome/takeover seed); the reconcile's ghost S.maxDepth adopt DELETED per risk #7
  (maxDepth rides `me` ON the player — the wholesale adopt IS the adoption) and bounty gains the CARRY
  (captured before the wholesale me-adopt, re-stamped after — it never rides `me`, safeClone skips it: the
  S6 wayfind inversion by carry instead of a second local, keeping objclient's verbatim-eval of adoptQuests
  working). Golden dungeon scenario's descend-mirror writes p.maxDepth; harness summary reads player-first.
  REMAP +2 (now 20) — golden 1p 8/8 on the UNTOUCHED oracle + full prove (speed/damage cascade@0, hunt
  exactly @700). mp-golden: delta proven EXACTLY intended before re-record — (a) old-shape masking view
  (18 pre-S12 entries + root maxDepth/bounty re-presented from the pinned hero, KEPT inline on roster heroes
  / hidden on the boot literal, since pre-S12 heroes always carried both keys; 0/null uniformity asserted at
  every sample so the recovery can't prove vacuously) reproduces the pre-S12 oracle BYTE-FOR-BYTE at all 124
  samples, (b) native diverges @sample 1 on all 4 (shape only; sample 0 = the boot-literal-pin-is-the-
  remap-view precedent), (c) old-vs-new engine per-hero end-state summaries IDENTICAL on all 4 trajectories
  — then conscious re-record, mp-check 4/4 + mp-prove all green. Battery 41/41; new asserts SEEN FAILING vs
  a pre-S12 HEAD-70fcfb2 worktree (own dist): 21 total — 14 migrate-roundtrip (7 fold fixtures + 4 literal
  blocks + REMAP pin 18≠20 + characterOf S12 emission + contract-survives-reboot), 4 sp-flags-check §2i
  (root-fallback/S12-shape/round-trip + the wayfinder-gate regex), 1 flags-pp-verify T-case via objclient's
  carriesBountyAcrossAdopt/noGhostMaxDepthAdopt probes, 2 quest-verify (D3: the old openBounty wrote root
  state.bounty; E4: no player.maxDepth on the row). World self-test + typecheck green; live browser smoke
  (MP + SP off the same dist): join clean, 0 console errors, ZERO root ghosts surviving reconciles, real
  walk-to-board [E] accept → gated payload → quest box renders the contract off state.player.bounty and
  SURVIVES 3 s of reconciles (the carry), fresh-page reload clean; SP real-DOM accept (Depth-3 bounty
  correctly scaled off p.maxDepth 0) → claim pays out → "Deepest depth: 17" renders off p.maxDepth +
  snapshot/applySnapshot round-trip clean. Conscious MP deltas: NONE behavioral (both keys were already
  per-player via the PP swap) — a pure carrier move; killEnemy's bounty credit rides the pinned killer BY
  CONSTRUCTION now (no slice left to desync). quests(53) + SHARED_QUESTS aliasing stands alone as the final
  per-key slice (the object-identity assert in mp-golden + the v7 stamp land there). ARCHITECTURE.md:
  PP_KEYS chronicle + killEnemy pin bullet + adopt-list S12 carry note + safeClone skip-list note.
- 2026-07-16: P2/S13 DONE — per-key retirement #9, THE QUEST SLICE (the plan's #1-riskiest conversion;
  final shared-key slice): quests(50 game sites) moved onto state.player (game literal → PLAYER_TEMPLATE
  seeds MP heroes; killEnemy-slay/key-drop, checkPickups, frozen-crossing/cache, tameDragon, victory,
  startDialogue-elder, legion war fns ×8, updateQuests, currentObjective, minimap-seat read p.quests —
  the acting pin IS the credit now). SHARED-vs-PERSONAL partition per plan: main/frozen/legion stay ONE
  object per room, re-attached through the GAME's new `aliasSharedQuests` (p22 beside party()/actAs —
  the sim's load/join seam; anchor = players[0]'s box else the boot hero's; SP never calls it; CAPTURE
  entry added); talk/key/slay/dragon genuinely fork per hero. Save: snapshot **v7** (the stamp lands
  here per plan §3) with quests in the player block + applySnapshot player-first/root-fallback;
  characterOf's top-level quests DIES (rides snap.player) with migrate.js S13 fold (normalize-then-place:
  the v1 synthesis + template-merge applies wherever the row carried the box; playerless blobs keep
  top-level); world.js elder-advance reads p.quests; **PP_KEYS is now []** — swapInPP/writeBackPP inert
  (deletion = S14 per plan). mp.html: adoptQuests stamps state.player.quests (risk #7) + the reconcile
  gains the quests CARRY (never rides `me`; safeClone already skipped it). REMAP +1 (21 — the header's
  own worked example) — golden 1p 8/8 on the UNTOUCHED oracle + full prove (speed/damage cascade@0, hunt
  exactly @700). mp-golden: delta proven EXACTLY intended before re-record — old-shape masking view (root
  quests re-presented BY REFERENCE from the pinned hero, boot-literal hidden at sample 0, hashed under
  the 20 pre-S13 entries) reproduces the pre-S13 oracle BYTE-FOR-BYTE at all 124 samples; native diverges
  @sample 1 on all 4 (shape only; sample 0 = the boot-literal-pin precedent) — then conscious re-record,
  mp-check 4/4 + mp-prove all green. THE OBJECT-IDENTITY ASSERT (plan risk #4) lives in BOTH the recorded
  scenario (mp-overworld-combat postTick every 500t: main/frozen/legion === across heroes AND personal
  keys forked) and quest-pp-verify T4 — SEEN FAILING against a deliberately-forked scratch build
  (aliasSharedQuests neutered): scenario throws "quests.main FORKED across heroes" @t=0, T4
  mainAliased/legionAliased/frozenAliased all false. Battery 41/41 (migrate-roundtrip now 160 asserts);
  new/changed asserts SEEN FAILING vs a pre-S13 HEAD-cfcb06a worktree (own dist): 7 migrate fold asserts
  + crash at the hand-literal probe (before the 20≠21 REMAP pin), sp-flags-check v7 stamp + crash at the
  §2j shape probe, quest-verify crash (evaled updateQuests reads player.quests), flags-pp-verify T1 via
  objclient's carriesQuestsAcrossAdopt/adoptStampsPlayerQuests probes, quest-pp T1b-T5 (qrender capture
  crash). World self-test + typecheck green; live browser smoke (MP + SP off the same dist): join clean,
  0 console errors, ZERO root ghosts surviving reconciles, quest box renders off state.player.quests and
  survives 3 s of reconciles (the carry), objective diamond over the Elder, REAL Elder [E] → dialogue +
  talk personal/legion shared + box repaint through the gated payload, a fresh joiner's box showed the
  FIRST hero's shared frozen-reveal (room aliasing live on the wire), SP new-game elder + wayfinder
  ("🗝 The Dungeon Key") + v7 snapshot/applySnapshot round-trip clean. Conscious MP deltas: NONE
  behavioral (quests was already per-player via PP) — a pure carrier move; killEnemy/projectile/ally/
  companion quest credit rides the pinned hero BY CONSTRUCTION (no slice left to desync). S14 (RPC runAs
  + machinery deletion) is now the whole of the swap cleanup. ARCHITECTURE.md: 8 bullets rewritten
  (pin-is-the-swap, questline-on-player + alias seam, no-PP-slice-left rule, projectile re-pin, adopt
  list S13 carry).
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
- 2026-07-16: P2/S14 DONE — RPC runAs + MACHINERY DELETION (the swap cleanup S13 left): PP_KEYS/
  swapInPP/writeBackPP definitions AND all 12+5 call sites deleted from world.js (−32/+37 lines;
  every `S.player = p; S.inventory = p.inventory` pin stays verbatim — the pin IS the swap);
  `_runRpc` wraps its whole dispatch and `resolveInteract` replaces its hand-rolled pin/restore
  with the GAME's own `actAs(p, …)` (plan §1's runAs; CAPTURE +actAs, dist namespace rebuilt —
  no game-file edit), so an RPC/interact handler now CARRIES its acting context instead of
  trusting the caller's pin (the §1 trap). doCamp mirror (dissolved S7) + _shopTown bridge (dead
  S9) verified-gone, not re-deleted; _projectilesByShooter's no-restore pin + characterOf/
  _loadCharacter pins + grabWorld/putWorld untouched per plan. Gates: golden 1p 8/8 on the
  UNTOUCHED oracle + full prove (speed/damage cascade@0, hunt exactly @700); mp-golden 4/4 on the
  UNTOUCHED oracle-mp — NO re-record, identity proven by BOTH runs (pre-change 4/4 + post-change
  4/4, same sha 910071a8…) + mp-prove all green; battery 41/41 + typecheck + world self-test.
  NEW verify_fixes FIX9 (risk #5 rpc-2p, 5 asserts): THE DISCRIMINATOR — `_runRpc(buyPotion, B)`
  under a deliberately-wrong ambient pin pays B (his gold −15, his potion +1), bystander
  untouched, pin restored; same-tick 2p buys via the real setInput path; source guard (no
  machinery text, ≥2 G.actAs sites) — SEEN FAILING 4 asserts vs the pre-S14 HEAD-55298e0
  worktree (own dist): there the AMBIENT hero paid (R1 485 g + stolen potion, R2 untouched) —
  the trap demonstrated live. Live 2-session checklist (shop/smith/camp) on the local server:
  browser actor + a second real ws session (the pane fronts one tab; its hidden tabs throttle
  rAF/timers — audio-unlock + reading the page's own socket made the actor drivable): Elder [E]
  → dialogue + talk.done/legion-camps through actAs'd resolveInteract with live quest-box
  repaint; shop panel over the wire (stock + gold-gated buttons off p.active*) → REAL Buy click
  → gold 30→15/potions 2→3 on the actor only; smith repairItem (kind/idx/name resolution)
  correctly REFUSED at 15 g vs 100 g cost with zero side effects (paid repair rides the same
  headless-proven path — deviation noted: gold farming under a throttled tab made a paid repair
  impractical); [C] camp → lastRestDay 1→7 (stamped to real curDay), instant rest heal,
  Exhausted cleared, room clock never jumped (tick continuity held); bystander ws hero FROZEN
  across all of it (gold 0/potions 2/dur 50/camping false over 100k+ snapshots). Conscious MP
  deltas: NONE behavioral (the machinery was inert since S13) — S14 adds only the enforcement
  seam. ARCHITECTURE.md: room-rotation intro rewritten (pin-is-the-swap + actAs seam), PP_KEYS
  bullet → past-tense chronicle, iron rule 4 forbids reintroducing a state.X slice.
- 2026-07-16: P2/S15 DONE — ENEMY-PARTITION INTERNALIZATION (plan §7 S13 sub-slice 1 "enemies"; the plan's #2-riskiest conversion): updateEnemies is the A-shape now — the SP body became `updateEnemiesFor(list)` (SP calls it with state.enemies: same body, same draws, golden 1p 8/8 on the UNTOUCHED oracle + full prove, speed/damage cascade@0 + hunt exactly @700) and the MP dispatcher moved the whole world.js partition INTO the sim verbatim: partyIn() roster in JOIN ORDER, downed-invisible pools (all-downed → foes still mill), boss town-blind bubble (`heroInSpawnTown` recomputes townCenter(townZones[0])×TILE — the exact value world.js captured as SPAWN), `wanderEnemyHome` fallback, per-bucket `state.player/state.inventory` pins with DELIBERATELY no restore (the ambient last-hero pin is hashed state the 2p baselines freeze), and bucket-order recombine (join order, mid-pass spawns swept to the acting hero's group tail, wanderers last — next tick's grouping iterates that array, so the order IS the determinism contract). THE structural win: `state.enemies` stays the FULL world roster during every pass, so killEnemy's inline last-guardian checks, healAlly, the pinnacle court check and the Quarry burst see the whole world — `__libGate` RETIRED everywhere (world.js init/sets/clears + the three load-game lexical wrappers), liberation fires INLINE at the kill credited to the KILLER's pin, and the `_seen` sweeps REMAIN as reconciliation for kill-less removals (leash despawn — probed explicitly in t2's rework). world.js: both partition blocks (ow+dg) → one `G.updateEnemies()` call each; inTown/wanderHome/isBoss/TOWN_R2/OW_W deleted (nearestPlayer stays — allies still partition world.js-side). mp-golden: 4/4 on the UNTOUCHED oracle-mp — NO re-record, identity proven by BOTH runs (pre-change 4/4 + post-change 4/4, oracle sha 221011e1…: bucket iteration/recombine/pin parity held byte-for-byte at all 124 samples) + mp-prove all green. Battery 42/42: NEW suite `enemies-mp-verify` (direct-call probes: per-foe nearest-hero targeting, regroup order via push-order inversion, ambient-pin contract, per-bucket kill credit xp/gold/slay, boss telegraph-drop + wander vs chase-the-out-of-town-hero, downed invisibility, inline last-guardian refusal + killer-paid liberation, artifact source guards, w.tick regression floor) — SEEN FAILING 12 asserts vs a pre-S15 HEAD-7ee67de worktree (own dist: B's foe frozen, A pocketing BOTH kills' credit while B got +0/+0/+0, boss ticking its telegraph instead of going home, the downed hero chased, A drawing B's site gold); t2-liberation REWORKED (killer-credit pair + sweep-reconciliation probe + gate-gone source guards) — SEEN FAILING 3 asserts vs the same tree. World self-test + typecheck green; live browser smoke (MP + SP off the same dist): join clean, enemies aggro/chase/strike through the internalized path, downed→bleed-out→respawn at town, kills → LEVEL UP + "Slay 5 monsters" quest completion live in the feed, 0 console errors across the session; SP page boots and plays with `state.players` provably unset (the MP branch is dead code in the browser). Conscious MP deltas (recorded trajectories unaffected — hashes identical): liberation/POI/siege rewards now pay the hero whose kill freed the site (was players[0] via the deferred sweep); healers/marks/boss-court checks see across bucket boundaries (co-op-correct); wanderers stay in state.enemies during passes (guarded against same-tick cross-bucket death). ARCHITECTURE.md: epilogue hook list (gate retirement chronicle), the partitioned-combat bullet rewritten as the internalized contract, bag-sync bullet repointed in-game. Remaining P2 arc: projectile internalization, updateFatigue-in-MP, snapshot v2, S16 remap drop.
- 2026-07-16: P2/S18 DONE — SNAPSHOT V2 (plan §5 / ladder S15; wire-shape ONLY — sim hashes untouched):
  BCAST_MS 15→50 (66→20 Hz), AOI 46t→34t (enemies/proj/pickups/allies/comps; ~2× viewport margin),
  and TWO new version-gated payloads: `inventory` (the fat tail of `me` — safeClone skips it now;
  per-player stringify in the %40 stamp block with versions/caches in Maps ON THE WORLD INSTANCE,
  deliberately off the hashed sim so the baselines can't move; `me._invSeen` cursors touched lazily
  in snapshotFor only) and `wf` (npcs/shrines/loreStones/pois — near-static, FULL lists on change +
  join, NEVER per-snapshot; featuresPayload strips/quantizes the volatile fields: npc `temp`
  dropped, shrine `sinkT` dropped, shrine `cd` → its readiness SIGN, which is all drawShrine reads —
  so a cooling shrine re-sends exactly twice, not 2/s). Dungeon npcs stay inline (a delver must
  never resolve topside npcs). NEVER-filtered edges untouched per the hidden-tab lesson:
  quests/legion/feed/dgTiles/holdings/me/players — and the new payloads follow the FULL pattern
  (gate + `welcome` seed via pure inventoryPayload/featuresPayload + takeover rewind of
  _invSeen/_wfSeen beside _qSeen + ws.onmessage adoption). mp.html: adoptInventory/adoptWorldFeatures
  in BOTH onmessage branches (bag adopted BEFORE the box paints; adoptQuests keeps a self-contained
  `s.inventory` line — it's extracted verbatim by objclient); reconcile's me.inventory adopt deleted
  (the singleton persists across me-adopts); npcs/features stamped per frame from tab-local localWF
  (dungeon: inline snap.npcs wins, features blank); finders/panel-sigs/loot-jingle/ult-replay
  repointed G.state.inventory / G.state.npcs; smoothing retuned for 50 ms gaps (_sk /55→/40,
  _skp /26→/18, pred correction 0.25→0.45). index.js also grew a wire counter (/health.json
  `wireKBs`/`wireMBTotal`). SIM IDENTITY proven by BOTH golden runs on byte-untouched oracles:
  golden 1p 8/8 + full prove, mp-golden 4/4 + full mp-prove (pre-change 4/4 after the S17 re-record,
  post-change 4/4 — NO re-record; the off-state gate design is what made that possible). MEASURED
  BANDWIDTH (real ws socket, standing at spawn, 12 s, identical methodology): **601.7 KB/s/player
  @58.3 Hz × 10.33 KB → 170.6 KB/s @19.3 Hz × 8.83 KB — a 3.5× cut** (at-rest snapshot 7.85 KB:
  enemies 4.3 @34t, me 1.8 slim, pickups 1.1; the plan's ~130 estimate assumed the calibration
  point's sparser ring — the density-driven spawner keeps 13–30 foes INSIDE 34t by design, so the
  residual delta is enemy bytes, not un-gated payloads). Battery 44/44: v4b-fullstack EXTENDED into
  the real-socket S15 gate (phase 1: 19.3 Hz band, welcome seeds all four gated payloads with real
  shapes, FIRST snapshot carries all four, at-rest quiet ≤1, me slim, standing-median budget <9 KB;
  phase 2: same-token TAKEOVER — samePid, superseded old socket, welcome re-seeds, rewound cursors
  re-deliver over the stream) — SEEN FAILING vs the pre-change HEAD-0410003 worktree on FIVE assert
  families (58.3 Hz, no seeds, me carries the bag, median 10.94 KB — the plan's own 10.9 baseline);
  v4b added to the runner's FLAKY retry set (wall-clock windows on a loaded machine; hz lower bound
  kept loose — the discriminator is the ≤30 upper bound). World self-test + typecheck green. LIVE
  browser (the pane parks rAF between captures — which made it the PERFECT hidden-tab rig): join
  clean, 0 console errors, wf lists live in state (24 packScalar-shaped server npcs — no `lines`,
  proving the source — 3 shrines/9 stones/10 POIs), movement/combat/feed at 20 Hz (2 slay-quest
  kills + gold + durability + DOWNED overlay + bleed-out → respawn-at-town with the half-gold
  forfeit), shop panel over the wire (real stock, honest gold, correct Need-gold refusal at 10 g),
  and THE HIDDEN-TAB PROOF: with rAF fully parked, Elder [E] → dialogue opened + quest box DOM
  repainted from "Speak to the Elder" to the post-Elder objectives purely through ws.onmessage —
  then a second tab took over the hero and woke up showing the CURRENT box (2/5 slays) from the
  welcome seed while the old tab read superseded. Conscious deltas: inventory-driven UI updates
  can lag ≤0.5 s (the %40 stamp); equip/buy still repaint on the edge. ARCHITECTURE.md: wire
  section rewritten (20 Hz, 34t, gated inventory/wf, measured numbers, client shape bullet).
  Remaining P2 arc: S16 remap drop (allies/companions/spawn/rotation still partition world.js-side).
- 2026-07-16: P2/S17 DONE — UPDATEFATIGUE-IN-MP (plan §2's updateFatigue row; the LAST shared-state bug):
  updateFatigue was NEVER called in the MP tick — world.js replicated only the recalc EDGE per rotation, so
  town rest, vigil regen, markTownVisited, the Exhausted/rested feed lines and the exhaustion HP drain
  silently didn't exist for MP heroes (a hero could stand in town three game-days and go Exhausted anyway;
  the visitedTowns fix #1 was only half-landed without it). It is the A-shape now: the SP body became
  `updateFatigueFor(mp)` (verbatim; the ONE seam is the exhaustion edge MEMORY — SP keeps `__g._wasExhausted`,
  MP reads/writes the acting hero's `p._exWas`, which addPlayer seeds and the doCamp RPC pre-arms) and
  `updateFatigue()` dispatches: MP loops the WORLD-SCOPED partyIn() (JOIN order, downed spared,
  pin-with-restore so a no-work tick leaves the room byte-identical); world.js's two edge replicas DELETED →
  ONE `G.updateFatigue()` call per phase (ow after the rotation, outside the shared-phase flag so log lines
  stay personal; dg over stillIn). updateFatigue was already in CAPTURE (dead entry, now live) — zero
  CAPTURE/NAMES churn, zero client edits (lastRestDay rides `me`; the pill reads it). Golden 1p 8/8 on the
  UNTOUCHED oracle + full prove (speed/damage cascade@0, hunt exactly @700 — the 1p harness exercises the
  converted fn every tick). mp-golden: REAL behavior change, divergence evidence BEFORE re-record —
  mp-overworld-combat byte-identical on BOTH seeds (no day boundary crossed: same-value town stamps + the
  restore-pin leave zero footprint), mp-day-rollover diverges at EXACTLY tick 700 (sample 7) on both seeds,
  and the serialized deep-diff at that sample is EXACTLY 2 leaves: {A,B}.lastRestDay 1→2 (the in-town rest
  stamp; nothing else — no RNG shift); end-state comparison pre-vs-post: pre = BOTH heroes Exhausted-in-town
  by day 3 (lastRestDay frozen at 1, atk-penalized + half speed — the bug live), post = both rested
  (lastRestDay 3), positions diverge downstream of the speed effect only — then conscious re-record,
  mp-check 4/4 + mp-prove all green. Battery 44/44: NEW suite `fatigue-mp-verify` (19 asserts: in-town stamp
  vs stale wanderer, personal Exhausted feed line + per-hero edge + atk recalc, drain through real w.tick()s
  + 65% floor, tier-2 vigil regen vs tier-0 bystander, per-hero town discovery + its feed line, dungeon-tag
  excluded by partyIn (risk #9), downed spared, source guards) — SEEN FAILING 11 asserts vs a pre-change
  HEAD-0410003 worktree (own dist; incl. F2d catching the pre-change collateral: the in-town bystander went
  exhausted too). t3-restore's injection vector REPLACED (it sabotaged the old unguarded G.isExhausted
  edge-check — now an instance-shadowed _downedPass throws mid-phase; same finally-restore subject) and
  verify_fixes FIX1's future-day fixture moved out of town (in-town rest legitimately re-stamps it now) —
  both fixture updates, subjects unchanged. World self-test + typecheck green. LIVE browser smoke (HZ=640
  fast days; the pane throttles rAF between captures — audio keep-alive + screenshot-forced frames):
  Exhausted pill 😴 appeared client-side after 2 stale days, hp drained 30→19 = EXACTLY the 65% floor then
  stopped (server-observed, no combat), [C] camp → +heal to 30/30, pill gone, "You feel rested…" in the
  real DOM log; town-standing heroes never went exhausted (the fix's own proof). Conscious MP deltas: town
  rest/regen/discovery/drain now EXIST in MP (SP parity); an exhausted joiner's edge line fires once
  (SP suppresses it via the applySnapshot pre-arm — informative, kept). ARCHITECTURE.md gains the
  fatigue-internalized bullet. Remaining P2 arc: snapshot v2, S16 remap drop (allies/companions/spawn/
  rotation still partition world.js-side).
- 2026-07-16: P2/S19 DONE — THE LAST PARTITIONS FOLD (plan §7 S13's remaining sub-slices: allies,
  companions, spawn, the movement rotation — after this, world.js runs ZERO per-player system loops).
  All four are A-shapes now: the SP bodies became updateAlliesFor/updateCompanionsFor/maybeSpawnWildFor/
  updatePlayerFor (verbatim; golden 1p 8/8 on the oracle at every sub-step + full prove) and the captured
  names are MP dispatchers looping the WORLD-SCOPED partyIn() (JOIN order). Allies: the _owner buckets
  moved in verbatim (unowned → ADOPTED by nearestHeroTo in-sim, delving owner → life-frozen idle, name
  normalization, state.map self-guard — state.allies is NOT a world slot); companions: BOTH world.js
  passes (ow byOwner + dg per-delver) became ONE map-scoped owner loop (owner order canonized to JOIN
  order from first-recruit order — no comps in the recorded windows, hashes untouched); spawn: the whole
  density pass (150+80/hero ceiling, staggered per-hero _spawnT@55t, ring-scaled 13→30 targets in 34t)
  moved beside the body; movement: the game pins each standing hero and stamps p.held into its own keys{}
  (the setKeys idiom in-sim; SP keydown keeps writing that global — ONE input carrier, the plan's uniform-
  p.held read stays deferred as the plan's own "input slice"). world.js keeps ONLY the per-hero ACTION
  loop (attack/dodge/interact/RPC — world-slot choreography), now AFTER the movement call: the fold's one
  conscious reorder (move-then-act within a tick). mp-golden: 4/4 on the UNTOUCHED oracle-mp after EVERY
  sub-step (pre+post both-runs, sha 282db979…) — allies/companions/spawn are draw-for-draw verbatim, and
  the rotation reorder proved UNOBSERVABLE on the recorded trajectories (the hash identity is the proof:
  attacks draw in join order under both interleaves, enemies never move during the rotation, and no
  hero reads another's same-tick action outcome in-window) — so the reorder's teeth live in battery
  instead. Battery 45/45: NEW suite `partyloop-mp-verify` (23 asserts: one-call rotation moves BOTH
  heroes per their OWN held keys with empty global keys, downed frozen, delver excluded, ambient-pin
  contract, per-owner ally kill credit, in-sim adoption, life-frozen idling, per-owner recruit steps,
  map scoping, spawn ceiling/stagger/per-hero refill/density skip/downed freeze, source guards, tick
  floor) — SEEN FAILING 17/23 vs a pre-fold worktree at HEAD 11322a2 (own dist), incl. the live demos:
  a direct G.updatePlayer() moved NOBODY, B's thrall's kill paid the AMBIENT hero (A 0→25), B's recruit
  TELEPORTED to the ambient hero (dist 54), a direct spawn call stamped/spawned nothing. Fixture reworks
  (subjects unchanged, teeth re-proven): verify_fixes FIX1 stamps through actAs mid-tick + FIX2 probes
  the pin by EFFECT (A sails/flies a scanned water lane while B is refused at the shore AND stays free
  on land — the leak's both faces) — SEEN FAILING vs a perturbed scratch dist (actAs de-pinned → the
  stamp landed ambient + 10 more actAs-seam probes fell; pre-S10 root-sailing read resurrected → B
  frozen on grass dx=0); camp-exhaust restores the real between-tick invariant (a tick never begins
  with S.map='dungeon'; B probes out of town — town-rest legitimately re-stamps now). World self-test +
  typecheck green; live browser smoke (local server, MP + SP off the same dist): headless ws probe
  moved 188–192px east on held keys through the folded rotation in BOTH a 1-hero and a 2-hero room,
  took real contact damage, welcome carried all four gated seeds, stopped clean against the Hearth's
  collision; browser hero joined, "2 online" with the probe rendered mid-walk, quest box + feed +
  region banners painting, 0 console errors; SP page: New Game → play, hero walks east through the
  dispatcher's SP branch, spawn cadence live, state.players provably unset, 0 console errors.
  Conscious MP deltas: NONE on the recorded trajectories (hashes identical); movement now resolves
  for the whole party before any hero acts (imperceptible at 80 Hz), and companion owner order is
  join-order by contract. ARCHITECTURE.md: room intro rewritten (no per-player loops left; the action
  loop is what remains) + the allies bullet became the four-fold internalization bullet.
- 2026-07-16: P2/S20 DONE — THE REMAP DROP (plan §7 S16, the P2 close-out): tests/golden/serialize.mjs's
  REMAP overlay — the 21-entry table AND the buildOverlay machinery + remap parameter — DELETED; the
  golden hash now covers the NATIVE player-keyed shape (header → past-tense chronicle; a future key move
  is a conscious re-record, never an overlay). PAIRED RE-RECORD, one engine state (the post-S19 tree,
  nothing else touched between the legs): parent leg = the remap serializer reproduced BOTH committed
  oracles first (check 8/8 vs oracle.json sha a4f26557…, mp-check 4/4 vs oracle-mp.json sha 282db979…
  — the engine is byte-identical to the recordings), the drop was then proven LIVE (native serializer
  vs old oracle: 0/8, divergence at sample 0 — the safe direction the header promised), child leg =
  both oracles re-recorded native (oracle.json → 24c2ed95…, oracle-mp.json → 0db3e62a…; 8/8 + 4/4
  green on the new baselines) — so the ONLY delta between old and new baselines is the serializer
  view. FRESH TEETH on the new baselines: full prove (determinism ×4; speed perturb diverges @0 and
  cascades all 31 samples; damage @0; hunt EXACTLY @700 with samples 0–6 identical — the boundary
  path still pinned; seed variance ×4) + full mp-prove (determinism; speed(A) @0 cascading on both
  scenarios; hunt exactly @700; seed variance) ALL GREEN. Battery 45/45: migrate-roundtrip's layer 2
  reworked from the 21-entry pin into the POST-drop guard (REMAP export GONE + no overlay text; a
  player-keyed box hashes DIFFERENTLY from its old root spot — no view can mask a key move; $ref
  dedup identity + no-mutation + key-sort invariants kept) — SEEN FAILING 2 vs a scratch tree with
  the old overlay resurrected (the masked-equal hashes 9dad5bc9…=9dad5bc9… demonstrated live);
  harness.mjs + tests/golden/README.md chronicles updated (oracle-mp's "re-recorded per slice" era
  closed). World self-test + typecheck green. P2 IS CLOSED — see the phase section above.
- 2026-07-16: P2/S16 DONE — PROJECTILE INTERNALIZATION (plan §7 S13 sub-slice "projectiles"; the plan's #3-riskiest conversion; the LAST world.js combat partition): updateProjectiles is the A-shape now — the SP body became `updateProjectilesFor()` (SP calls it on the whole pool: same body, same draws, golden 1p 8/8 on the UNTOUCHED oracle + full prove, speed/damage cascade@0 + hunt exactly @700) and the MP dispatcher moved world.js's `_projectilesByShooter` INTO the sim VERBATIM: shots bucketed by SHOOTER in FIRST-SHOT order (Map insertion, NOT roster order), per-bucket owner pins (player + INVENTORY) with deliberately no restore (the ambient last-owner pin is hashed state; the ow shared phase re-pins players[0] right after, unchanged), hostile/unowned shots last under roster[0], the PARKED-SHOTS rule moved in (a world with none of its heroes present leaves its in-flight shots waiting — the stale-pin dungeon-coordinates hazard), and bucket-order recombine (mid-pass spawns — the ricochet bounce, the Leviathan lance — land at the acting owner's bucket tail; next tick's grouping iterates that array, so the order IS the determinism contract). world.js: `_projectilesByShooter` + both call sites DELETED → ONE `G.updateProjectiles()` call per phase (ow inside the shared-phase flag + dungeon); zero CAPTURE/NAMES churn (updateProjectiles was already captured; the dispatcher is in-sim). mp-golden: 4/4 on the UNTOUCHED oracle-mp — NO re-record, identity proven by BOTH runs (pre-change 4/4 + post-change 4/4, same sha 910071a8…: first-shot bucket order, pin parity and recombine held byte-for-byte at all 124 samples) + mp-prove all green. Battery 43/43 ×2: NEW suite `projectiles-mp-verify` (direct-call probes: first-shot recombine order, the no-restore pin incl. INVENTORY, rest-pass under roster[0], parked-shots freeze, dungeon-boss key drop into the SHOOTER's bag, artifact/world.js source guards, w.tick per-shooter kill-credit floor) — SEEN FAILING 12 asserts vs a pre-S16 HEAD-0b5def1 worktree (own dist), incl. the live inventory-pin hole: pre-S16 a direct call dropped B's boss key into the AMBIENT hero's bag (A.keys 0→1, B 0→0). camp-seeker-verify's SP seeker block gained the roster tag its probes now need (an acting hero must be IN the probed world — the parked rule working as designed on direct calls; the edit is a no-op on the pre-S16 engine, proven 40/40 there). BONUS: enemies-mp-verify's ~1/4 flake KILLED (reproduced at pre-S16 HEAD — unseeded worldgen put B's blind +150t/+40t teleport targets in water/rock so probe foes couldn't step): probe arenas now scan for open pockets (openNear), probe foes leash-exempt + never aquatic — 15/15 + 10/10 green on changed/pre-change trees. World self-test + typecheck green; live browser smoke (MP + SP off the same dist): MP join clean → hostile contact → downed → bleed-out → respawn-at-town live, 0 console errors, client state.players unset; SP new-game with a bow — arrows fly/hit (+prof.ranged xp), RICOCHET bounce fires — and a fire staff — magic bolts, Heat 0→24, "Your Magic skill rose to 2!" in the real DOM; state.players provably unset (the MP branch is dead code in the browser). Conscious MP deltas: NONE on the recorded trajectories (hashes identical); the acting-context contract is now enforced in-sim (the bucket pin carries the BAG — a shooter's key drop can no longer land in a bystander's inventory on any direct-call path). ARCHITECTURE.md: the shooter-partition bullet rewritten as the internalized contract. Remaining P2 arc: updateFatigue-in-MP, snapshot v2, S16 remap drop (allies/companions/spawn/rotation still partition world.js-side — plan §7 S13's remaining sub-slices).
- 2026-07-16: P3/S1 DONE — the content seam + ELEMENTS (first registry): `src/content/{types,elements,index}.ts` (strict TS) esbuild-bundled (pinned exactly 0.28.1) into ONE non-minified iife chunk prepended to the parts concat by scripts/build.mjs behind 3 loud guards (standalone classic-script parse · no top-level "use strict", with esbuild's emitted top-of-file directive RELOCATED into the IIFE body — the guard was seen firing LIVE on raw esbuild output before the relocation · `globalThis.CONTENT` assignment present, and a CAPTURE'd registry name still FAILS the build — proven, scratch tree); p17:172 → positional alias `const ELEMENTS = CONTENT.elements;` (zero call-site churn, golden-proven identical); facing-noregress children now self-assemble WITH their own side's chunk (skipped when a side has no src/content — pre-S1 HEAD; proven by omission: WT child dies `ReferenceError: CONTENT is not defined`, exit 1); qrender/objclient second-eval save/restore extended to CONTENT (risk #4); NEW battery `content-purity` (17 asserts: fresh-chunk byte-pin at the program HEAD, sloppy-safety, purity token grep, seam, fire.color pin + the game's own elemRgb reading THROUGH the registry, 3k-tick 2-hero live-vs-fresh canary) — SEEN FAILING on scratch worktrees (fire.color perturb → 5c, unrebuilt → 1a/1b stale-dist; updateWeather poking the registry mid-run → canary at `_poked:3000`); REBUILD.md purity amendment above. Gates: golden 1p 8/8 + mp 4/4 on BYTE-UNTOUCHED oracles (24c2ed95…/0db3e62a…, identity by both runs — a pure-lookup move, zero hashes moved), battery 46/46, world self-test green, typecheck green (deliberate `color: 42` seen failing the gate once, TS2322, reverted), build idempotent from `rm -rf dist` ×2 (9ce71358…), live browser smoke on the local MP server: join → fight → 2 slay-quest kills + downed/bleed-out/respawn, and elements combat-visible on the same artifact (fire staff: #ff7838 bolts on screen AND in proj state, HUD 🔥Fire via elemHtml, burn applied burnT/burnDmg via applyElementOnHit, the -3 burn tick floatie + flame particles live) — 0 console errors both pages.
