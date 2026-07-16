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
`--engine=legacy|modular` so both load paths hit the same oracle. At end of P1 the
server imports sim directly — `CAPTURE`/`NAMES` lists deleted (still swap-multiplexing);
`eldermyr-rpg.html` deleted (lives on in the `v2-final` tag).
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
