# Realms of Eldermyr

Online-only, server-authoritative multiplayer action-RPG. The sim is built from `src/`
modules + content registries into **one artifact (`dist/eldermyr.html`)**: the Railway
server loads it headlessly and orchestrates it for N players; the client (`client/mp.html`)
loads the same artifact and renders it from server snapshots. There is no single-player
build any more — playing solo is being alone on the server. Everything ships together on
one branch.

**Before touching `server/`, `client/`, or the sim, read
[ARCHITECTURE.md](ARCHITECTURE.md)** (the build, the MP-native sim, the wire, saves, the
per-hero state rule — mistakes against those invariants are silent, not loud). **To add or
change content — an enemy, spell, boss, gear, dungeon, steed, region, curve — read
[CONTENT.md](CONTENT.md)** (one recipe per type; each is a single registry file under
`src/content/`).

## Commands (from repo root)

- `npm run build` — esbuild `src/content` → one chunk, prepend it to the `src/game/` parts
  + the generated namespace, write `dist/eldermyr.html`. **Build FIRST** — the tests and
  both oracles load `dist/`, they do not compile your `.ts`; skip the build and you test
  stale bytes (green against the old tree, your change invisible).
- `npm run typecheck` — `tsc --noEmit`, the type gate.
- `npm run test:battery` — the ~50-suite behavior battery.
- `npm run test:golden` · `npm run test:golden:mp` — the 1-player (8 trajectories) and
  2-player (4) determinism oracles.
- `node server/world.js` — the room self-test (must stay green).
- Local server: `.claude/launch.json` config **eldermyr-mp** (equivalently
  `env -u DATABASE_URL PORT=<high> node server/index.js`), then open `client/mp.html`.
- **Deploy (integrator only):** `railway up -c --service Eldermyr < /dev/null` from repo
  root. Railway deploys the working dir, not git.

**The full gate before any deploy** (CI runs the same on every push):

```sh
npm run build && npm run typecheck && npm run test:battery \
  && npm run test:golden && npm run test:golden:mp && node server/world.js
```

Green = build clean · typecheck clean · battery ~50/50 · golden 8/8 · mp 4/4 · self-test OK.

## Iron rules

1. **Bump `GAME_VERSION`** (in `src/game/parts/p00-GAME_VERSION.js`) on **every** game change.
2. **Every ship adds a `server/releases.js` entry IN THE SAME COMMIT** as the version bump,
   written for players (not commit-speak) — it has silently drifted twice. Notes render
   through an HTML escaper, so use literal Unicode (`— ’ “ ”`), never `&mdash;`-style entities.
3. **Content changes go through the `src/content/` registries** (CONTENT.md). Adding an entry
   is one file. A new game FUNCTION the server or client calls by name also needs a `CAPTURE`
   entry (`server/load-game.js`) **and** a `NAMES` entry (`client/mp.html`) — a listed name
   with no top-level binding **fails the build**, by design (the loud replacement for the old
   silent-no-op capture bug).
4. **A value the sim reaches** (a stat, a curve, a drop) that moves golden hashes is the
   **conscious re-record protocol**, never a silent overwrite: make the change, confirm only
   the intended leaves moved, and commit the re-recorded oracle in the SAME change
   (`tests/golden/README.md`). A *pure addition* (new key, dead on the golden trajectories)
   that moves a hash is a bug — stop and find it.
5. **Run the full gate before deploy. Never `railway up` while an agent is writing** (it
   uploads the working dir mid-edit).
6. **New per-player state is a field on `state.player`** — full stop (ARCHITECTURE.md's
   per-hero rule; the old `state.X` PP_KEYS slice machinery is deleted and must not return).
   Before adding a field, ask whether it is per-HERO or a shared WORLD fact.
7. **The repo is PUBLIC.** Never commit player data or DB dumps. `backups/` is gitignored and
   `scripts/db-dump.mjs` redacts secrets and refuses committable output paths.
8. **Update ARCHITECTURE.md / CONTENT.md** when you change an invariant they document — a
   wrong doc is worse than none.
