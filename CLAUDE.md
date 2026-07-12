# Realms of Eldermyr

Single-file HTML5 canvas action-RPG (`eldermyr-rpg.html`) with a server-authoritative
multiplayer mode (`server/` + `client/mp.html`, deployed on Railway) that loads the
*same untouched game file* headlessly.

**Before working on anything under `server/`, `client/`, or `server-spike/`: read
[ARCHITECTURE.md](ARCHITECTURE.md).** It documents the load-and-orchestrate model, the
lexical-capture gotcha, the per-player state rules, and the snapshot protocol — mistakes
against those invariants are silent, not loud.

Iron rules (details in ARCHITECTURE.md):

- Bump the displayed `GAME_VERSION` on **every** game change.
- Game-file edits must stay browser-safe and single-player-identical; they ship to both
  branches (`main` → Netlify SP, `multiplayer` → Railway MP). Server/client edits stay on
  `multiplayer`.
- New per-player state needs the full chain: PP_KEYS + swap/writeback + save/load +
  snapshot + explicit client adoption.
- New game fns called from server/client need `CAPTURE` (load-game.js) and `NAMES`
  (mp.html) entries — missing captures no-op silently.
- Update ARCHITECTURE.md when you change an invariant it documents.

Dev: SP via `.claude/launch.json` (port 8137). MP local: `env -u DATABASE_URL PORT=<high>
node server/index.js`. Headless verification: `node server/world.js` self-test must stay
green. Deploy MP: `railway up -c --service Eldermyr < /dev/null` from repo root.
