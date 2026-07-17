# CONTENT.md — the Eldermyr content cookbook

Mechanical recipes for adding content through the `src/content/` registries. One recipe per
type: the ONE file to edit, the entry shape (with a real template to copy), the gate, and the
one trap that bites. For *why* the platform is shaped this way, see ARCHITECTURE.md — not here.

## How the build works (read once)

- 11 registries in `src/content/*.ts` (strict TS). `index.ts` imports them into one `CONTENT`
  object and does `globalThis.CONTENT = CONTENT`.
- `node scripts/build.mjs` esbuilds `index.ts` → one non-minified IIFE **content chunk**,
  prepends it to the game parts (`src/game/parts/`, ordered by `manifest.json`) + a generated
  namespace, and writes **`dist/eldermyr.html`** — the single artifact everything loads.
- Game parts read content via `CONTENT.<registry>` or a **positional alias** at the old
  declaration line (`const ELEMENTS = CONTENT.elements;`). You almost never touch a part.
- Server (`server/load-game.js` `CAPTURE`) + client (`client/mp.html` `NAMES`) grab game
  **functions** by name. A `CAPTURE`/`NAMES` name with no top-level binding **fails the build** —
  by design (a dead capture must be loud, never a silent runtime no-op).
- Registries are deliberately **not frozen**. Hooks must stay pure (see the three hard rules).

## The gate (`GATE`)

Every recipe below ends in "run `GATE`". `GATE` is, from repo root:

```sh
node scripts/build.mjs \
  && npx tsc --noEmit \
  && node tests/run-battery.mjs \
  && node tests/golden/harness.mjs check \
  && node tests/golden/harness.mjs mp-check
```

Green = **battery 50/50 · golden 8/8 · mp 4/4 · typecheck clean · build clean**. CI runs the
same five on every push (`.github/workflows`). **Build FIRST** — the suites and both oracles
load `dist/eldermyr.html`; they do not compile your `.ts`. Skip the build and you test stale
bytes (green against the OLD tree, your change invisible). This is the single most common miss.

**Add vs. change.** A *new* row/entry (new key) is dead code on the golden trajectories → the
oracles do not move, plain `GATE` passes. *Changing a shipped value* the sim reaches (a stat, a
curve, a drop) moves golden hashes → that is the conscious re-record path (last hard rule). If a
pure addition moves a hash, STOP — it is a bug, not a re-record.

---

## Recipes

### 1. Add an enemy — `src/content/enemies.ts` (+ `types.ts`)
- **Shape**: add a key to `ENEMIES` (template: `slime`) — `{name,hp,atk,def,speed,xp,gold,color,size}`,
  and add that key to `EnemyKindKey` in `types.ts`. Optional `init(e)` seeds behavior fields
  (template: `mage` / `charger`). **`draw(v, e)` is MANDATORY** — paint through `v.g2d` only
  (destructure `{ g2d: d, sx, sy, flash, shade, rgbOf } = v`), read `e`, never write it. Set
  `faces: true` only if it has an unambiguous head+tail (template: `charger`); `FACING` is
  DERIVED from the flag, never hand-listed. To make it spawn, add a `{t, kind}` threshold row to
  the relevant `WILD_SPAWN.tables.<biome>` (template: `vale`); rows are ordered, first `r < t` wins.
- **Trap**: a kind with no `draw` is a TS error, not an invisible foe (that is the point). Any
  `Math.random()` in `init` is the determinism contract — same count and order as the siblings;
  the wobble draw stays first. Reordering it moves golden hashes.
- Gate: `GATE`.

### 2. Add an element (spell/aura) — `src/content/elements.ts` (+ `types.ts`)
- **Shape**: add a key to `ELEMENTS` (template: `fire`) — `{name, color, rgb, tag}` — and add the
  key to `ElementKey` in `types.ts`. That is name + bolt/glow color + HUD tag.
- **Trap**: the registry gives visuals ONLY. The on-hit EFFECT (burn/chill/…) is coded in the sim
  (`applyElementOnHit`, a game part) keyed on the id — a new element with no branch there tags and
  glows but does nothing on hit. Generated loot rolls read `gear.ts` `genElements` (an explicit
  array, NOT derived from this registry) — a new element won't appear on dropped gear until you
  add it there too. Passive aura/rank knobs live in `tables.ts` `abilities`
  (`rankMax`/`heatAuraMin`/`heatAuraTicks`); a brand-new *active* ability still needs the
  input/UI seam and is deferred to the GUI arc — not a one-file change today.
- Gate: `GATE`.

### 3. Add a boss special — `src/content/specials.ts` (+ `types.ts`)
- **Shape**: add a key to `SPECIALS` (template: `slam`) with all three hooks: `wind` (windup
  ticks, a number), `exec(e, a)` (the effect — mutate `e` and the live refs on the actView `a`;
  audio via `a.sfx`), and **`drawTele(v, e)`** (the telegraph, painting through `v.g2d`). Add the
  key to `SpecialKey` in `types.ts`. To put it in the standard boss rotation, edit `BOSS_ROSTER`.
- **Trap**: `drawTele` is a required property — a special with no telegraph is a TS error at
  author time, never a silent unwarned one-shot in game (the DESIGN silent-failure #1 this
  registry exists to kill). `exec` reads only the curated `a` bag — no bare `state`/`Sound`; RNG
  in `exec` (e.g. summon placement) is the determinism contract, same draws in the same order.
- Gate: `GATE`.

### 4. Add an apex boss — `src/content/apex.ts` (+ `types.ts`)
- **Shape**: a Great Hunt = a row in `HUNTS` (template: `frosttitan`) — stats + `lair{tx,ty}` +
  `specials` + a fixed `reward`. A pinnacle = a row in `PINNACLES` (template: `drownedking`) with
  `drops`. The finale kraken / citadel Archivist are the `kraken` / `archivist` keys. Flat tuning
  consts (`dragonLevel`, `pinLevel`, arena knobs) sit at the bottom.
- **Trap**: the STATS/lair/drops still flow through in-part scaling *factories* (`makeGreatBeast`
  etc.) — apex holds DATA only; a genuinely new scaling SHAPE needs a factory edit, not just a
  row. `GREAT_HUNTS`/`PINNACLE_BOSSES` are `CAPTURE`'d (the server reads them) — that's fine,
  they're data. Changing an EXISTING hunt's stats/reward moves `oracle-mp` and rides the golden
  **hunt tripwire that must still diverge EXACTLY @700** → conscious re-record with evidence. A
  brand-new key is dead on the golden trajectories → plain `GATE`.
- Gate: `GATE`.

### 5. Add gear — `src/content/gear.ts`
- **Shape**: shop weapon = a row in `shopWeapons` (template: `steel_sword`) —
  `{id,name,style,atk,cd?,cost,rarity,reqLevel,reqProf,element?}`. Shop armor = `shopArmor`
  (template: `chain_mail`). A pinnacle/citadel relic = a key in `uniques` (template:
  `leviathanspine`) — `{slot,style?,element?,name,atkMul|defMul,cd?,uniqDesc}`. Pattern weapon =
  `patternWeapons`; a rarity tier = `rarities`.
- **Trap**: a unique's `uniqDesc` is FLAVOR — the build-changing effect is coded at its one sim
  seam (a `recalcStats`-derived `p.u*` flag, never a combat-time gear read; the MP wrong-bag
  rule). Adding the row without the seam gives a relic that reads well and does nothing.
- Gate: `GATE`.

### 6. Add an elite affix — `src/content/affixes.ts` (+ `types.ts`)
- **Shape**: add a key to `DEFS` (template: `shielded` for one with seeding, `vampiric` for one
  without) — `{flag, label, pre, apply?(e)}` — and append the key to `KEYS` (the ordered RNG
  pool). `apply(e)` seeds instance fields at roll time and mutates ONLY `e`.
- **Trap**: `KEYS` order IS the RNG splice contract — append, don't reorder. If the affix gates
  damage on hit, its behavior lives in the hot-path `afxHit` (a game part), not a per-hit hook —
  the `apply` hook only seeds. Elite affixes fire only at `partyLvl >= 15`, so golden never
  exercises them: their guard is the battery (`affix-verify`, `content-purity`), not the oracle.
- Gate: `GATE`.

### 7. Add a dungeon theme / floor-mod — `src/content/dungeons.ts` (+ `types.ts` for a mod key)
- **Shape**: theme = a row in `THEMES` (template: `catacombs`) — palette + `pitKind` + a `pool`
  of enemy kinds; themes cycle by depth via `theme(level)`. Floor-mod = a key in `FLOOR_MODS`
  (template: `gilded`) + its key in `FloorModKey` (`types.ts`) + a band in `pickFloorMod(r)`.
  Depth-gated pool additions go in `poolGrowth`; the vault knobs are `vault`.
- **Trap**: `pickFloorMod` uses strict `<` and the bands must stay ordered/summing as before — a
  threshold belongs to the NEXT band. The `Math.random()` draw stays in the game part
  (`rollFloorMod`); `pickFloorMod` is RNG-free and only maps `r`. Reweighting the bands changes
  live drops → re-record territory.
- Gate: `GATE`.

### 8. Add a companion class / tier — `src/content/companions.ts` (+ `types.ts`)
- **Shape**: class = a key in `CLASSES` (template: `knight`) — base stats + `hire` + `tiers:
  tiersFor(hireBase)`. Retune tiers via the shared `STAT_MUL` / `UPKEEP` arrays or `tiersFor`.
  `statsFor(cls, level, tier)` applies `tiers[tier].statMul`.
- **Trap**: `tiers[0].statMul` must stay `1` — `statsFor` at tier 0 must be byte-identical to the
  pre-economy numbers (`x * 1 === x`), or you move the T1 identity the battery pins. `statsFor` is
  **oracle-invisible** (no companions in the golden windows) — a stats bug is caught by
  `warband-econ-verify` / `content-purity`, NOT golden. Run the battery.
- Gate: `GATE`.

### 9. Add a steed — `src/content/apex.ts` (art hook DEFERRED — read this)
- **Shape today**: the only steed is the Emberwyrm; its tuning is `apex.ts` `dragonLevel` +
  `dragonColor` — the ONE colour source (`makeWildDragon` AND the mounted-steed art both derive
  every tone from it; recolour here, recolour both). Retune/recolour = these two consts.
- **Honest gap**: a genuinely NEW steed with its own art is NOT one-file yet. The mounted-steed
  DRAW hook (~175 lines, coupled to the player frame in a game part) has NOT been extracted to a
  registry `drawSteed` hook — that is the deferred S5-style render half (REBUILD P3/S10).
  `facing-noregress` already guards the steed op-for-op for when that seam lands. Until then, new
  steed ART means editing the player-draw part, not a registry row.
- Gate: `GATE`.

### 10. Add a region / flavor row — `src/content/tables.ts` (+ `types.ts` for a new cluster)
- **Shape**: regions are three PARALLEL arrays in `REGIONS` — `names`, `subs`, `lore`, indexed by
  region id (0–8). Add at the same index in all three. Other flavor clusters: `trade` (template:
  `furs`), `poi`, `foods`, `status`, `warlord`/`nemesis` naming, `abilities` knobs — all pure
  display data, each with a positional alias in a game part.
- **Trap**: `warlord`/`nemesis` rows are LABELS only — the strength EFFECTS and stat curves stay
  in `makeWarlordEnemy` (a game part). Some rows the sim reaches (trade `base`, `abilities`
  caps, hold coords) DO move golden if you change a shipped value — add a NEW row freely, change
  an existing one consciously.
- Gate: `GATE`.

### 11. Tune a curve — `src/content/curves.ts`
- **Shape**: the level/distance FORMULAS — `xpForLevel`, `wildStat`, `wildXp`/`wildGold`,
  `dungeonStat`, `dungeonBossStat`, `ascMul`, and the `dungeonXpMul`/`dungeonGoldMul` knobs.
  Content can't read state, so `ascension`/`df`/`level` arrive as args; `Math.round` stays at the
  factory CALL SITE (a game part), only the raw factor lives here.
- **Trap**: curves are reached by EVERY golden trajectory (every spawn/level-up) — any change
  moves the hashes. That is not a bug, it is the oracle working. Re-record CONSCIOUSLY per the
  last hard rule; a tuning change with no golden diff means the curve is dead code (also a bug).
- Gate: `GATE` — expect golden to fail until you re-record.

---

## The three hard rules (every recipe)

1. **No state reach-ins from a registry.** A hook reads its arguments (`e`, the `DrawView v`, the
   actView `a`) and mutates only the instance / live refs it is handed. Never `state.*`, `window`,
   `document`, canvas, `localStorage`, or `Sound` in `src/content/` — the `content-purity` battery
   greps the compiled chunk for those tokens and fails on a hit. (`exec` gets `a.sfx` on purpose.)
   Never mutate a registry ROW from the sim (a row aliased into state poisons the next boot) — the
   `content-purity` canary deep-equals live `CONTENT` against a fresh chunk after a 3k-tick run.
2. **RNG only in hooks the sim calls, and the draw order is frozen.** `init`/`exec` may call
   `Math.random()`, but the count and order are the determinism contract — the golden harness
   seeds one global stream. Never add, drop, or reorder a draw in a hook without expecting the
   oracles to move. Pure map/pick helpers (`pick`, `pickFloorMod`, `affixPool`) stay RNG-free; the
   draw stays in the game part.
3. **Re-record golden ONLY with divergence evidence.** When a *deliberate* value change moves the
   hashes: `node tests/golden/harness.mjs record` (and `mp-record`), eyeball the `git diff` on the
   oracle, confirm ONLY the intended leaves moved, and commit the oracle in the SAME change. Never
   re-record to silence an *unexplained* diff during an add/refactor — that is a real bug. Full
   protocol: `tests/golden/README.md`.

Note: `GAME_VERSION` is NOT bumped during the rebuild (nothing ships until the v3.0.0 cutover);
the bump-every-change + `server/releases.js` rules resume at cutover.
