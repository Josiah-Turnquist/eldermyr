# ⚔ Realms of Eldermyr

An online-only, server-authoritative multiplayer action-RPG. Explore one shared realm
with friends — every sprite, sound, and song is generated in code. The simulation is built
from `src/` modules and content registries into a single artifact (`dist/eldermyr.html`)
that the server loads headlessly and orchestrates for everyone at once.

**Play it:** [eldermyr-production.up.railway.app](https://eldermyr-production.up.railway.app)

Pick a hero name and you're in. Your character saves to the server and is yours to reclaim
on any device with the recovery code shown once at creation — playing solo just means
being the only one on the server.

## The realm

- **A 347×291-tile overworld** in concentric difficulty rings — a safe home Vale, contested
  Marches, and a deadly Frontier — with intentional forests, a boat-only sea with real
  isles, frozen wastes, and a lava frontier
- **Combat**: three weapon styles (melee / ranged / magic) with mastery perks earned by
  use, dodge-rolls with i-frames, crits, lifesteal, berserk, elements, telegraphed boss
  specials, and an adaptive Ultimate
- **Co-op, natively**: fight, quest, and delve alongside other players in the same world —
  the sim is multiplayer to its core, not a bolt-on
- **The Dread Legion**: a nemesis hierarchy of named warlords who hold territory, remember
  your encounters, and grow when they kill you — culminating in the Legion War questline
- **Territory**: liberate razed outposts, rebuild and upgrade them, garrison companions to
  repel sieges, and collect daily tribute
- **A warband**: recruit a knight, ranger, and mage across three tiers who fight beside
  you, level with you, and draw a daily wage
- **Endless dungeons** with floor modifiers, key vaults, and a grind premium — plus the
  **Sunken Citadel**, a pinnacle dungeon guarding build-changing relics
- **A living world**: day/night, weather, seasons (the sea freezes walkable in winter), a
  dynamic regional trade economy, foraging & cooking, sailing, four legendary Great Hunts,
  a tamable dragon steed, and the **Mountain Kraken** — a respawning endgame finale
- **Meta-progression**: score, ascension (New Game+), and server-persisted heroes

The player-facing version history lives at the
[`/release`](https://eldermyr-production.up.railway.app/release) route (authored in
`server/releases.js`).

## Running it locally

Start the server via the `.claude/launch.json` config **eldermyr-mp**, or directly:

```sh
npm install
npm run build                               # assemble dist/eldermyr.html from src/
env -u DATABASE_URL PORT=8138 node server/index.js
```

Then open `client/mp.html` against it. Without a `DATABASE_URL` the server runs fine with
ephemeral (in-memory) heroes; link a Postgres to persist them.

## For contributors

- **[CLAUDE.md](CLAUDE.md)** — commands, the full test gate, and the iron rules
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the build, the multiplayer-native sim, the wire
  protocol, saves, and the invariants that keep co-op coherent
- **[CONTENT.md](CONTENT.md)** — one recipe per content type; adding an enemy, spell, boss,
  gear piece, dungeon, or steed is a single entry in a `src/content/` registry

`GAME_VERSION` lives in `src/game/parts/p00-GAME_VERSION.js`.

Built collaboratively with [Claude Code](https://claude.com/claude-code).
