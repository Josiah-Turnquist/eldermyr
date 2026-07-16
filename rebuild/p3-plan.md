# P3 plan — content platform (registries; proof = shipping #123/#121/#115/#113 through them)

Recon @ HEAD 8f71537 (branch `multiplayer`, P2 closed S1–S20). Line numbers: `src/game/parts/pNN-*.js`
(cited `pNN:line`), `server/world.js`, `scripts/build.mjs`. Read with REBUILD.md (P3 gate: *adding a
test enemy touches exactly one file*), rebuild/monolith-map.md §5 #10 (factories fuse spawn data with
combat rules — that fusion is what splits), rebuild/p2-plan.md (the slice-ladder discipline this plan
inherits verbatim: battery + both oracles + self-test + typecheck + live smoke; vacuity proofs on
scratch worktrees; re-record ONLY with divergence evidence), DESIGN-pinnacle-dungeons.md (build spec
for #121 — its LVL_HP retune of shipped dragon/pinnacle bosses is REJECTED; owner decided flat levels,
already shipped as PIN_LEVEL=75 p22:392 / DRAGON_LEVEL=30 p22:110, and per-player hidden 1% drops).

**What "one entry in one file" must mean at the end:** a new enemy = one entry in
`src/content/enemies.ts` (stats + init hook + draw hook). A new boss special = one entry in
`specials.ts` (windup + exec + telegraph draw). A new apex boss = one entry in `apex.ts` (stats +
lair + respawn descriptor + drops hook). A new gear piece/affix/dungeon-mod/steed/region = one row.
TS-strict from day one. The four backlog features are built AS those entries, or the platform failed.

---

## 1. Registry architecture

### 1.1 File layout — `src/content/` (NOT `src/game/content/`)

```
src/content/
  types.ts       shared entry-shape interfaces (EnemyKind, ApexBoss, Special, EliteAffix, …)
  index.ts       imports every registry, builds one object, does (globalThis as any).CONTENT = …
  elements.ts    enemies.ts  specials.ts  apex.ts  gear.ts  affixes.ts  dungeons.ts
  companions.ts  curves.ts   tables.ts (foods/bless/trade/status/regions/steed/poi/names sweep)
```

Decided against `src/game/content/`, against the REAL build: `scripts/build.mjs` concatenates
`src/game/parts/*` in `manifest.json` order into one classic **script** (`sourceType:'script'`,
build.mjs:106-108) — proximity to parts buys nothing because TS cannot ride the concat as parts
(§1.4), so content enters the program as one compiled prelude chunk regardless of where its sources
live. `src/content/` is REBUILD.md's target layout, is already inside tsconfig `include:["src"]`
(strict, `tsc --noEmit` = the existing gate, zero config change), and the CI purity rule is written
against that path. `src/game/` stays "the legacy program"; content becomes the first real v3 module
tree that survives the module era unchanged.

### 1.2 Entry shape per content type (defined in types.ts; all strict)

- **EnemyKind** (11 keys = the drawEnemy switch: slime/bat/skeleton/mage/charger/archer/healer/
  serpent/dragon/kraken/boss): `{ name, hp, atk, def, speed, xp, gold, color, size,
  init?(e): void, draw(v: DrawView, e): void, faces?: boolean }` — `init` = the per-type block
  p03:294-316 verbatim (caster/archer/charger/healer/aquatic seeds, SAME RNG draws); `draw` = the
  p20 art branch verbatim; `faces` = the FACING table p20:40. `spawn?: {vale,mid,frontier,frozen,
  lava: number}` weights = the makeWildEnemy type tables p03:355-376 (the #10 fusion split: spawn
  data in the entry, scaling curves in curves.ts).
- **Special** (boss telegraphs): `{ wind: number, exec(e, ctx): void, drawTele?(v, e): void }` —
  wind = p17:405 table; exec = the execBossSpecial p17:409 branch; drawTele = the p20:1000 chain
  branch. THIS dissolves DESIGN doc §3.4 silent-failure #1 (a new special without a draw branch is
  a type error, not an invisible one-shot).
- **ApexBoss** (world bosses): `{ key, name, color, type, size:{w,h,dx,dy}, level, base:{hp,atk,
  def,xp,gold}, specials: string[], stats(e, ctx): void, lair(state): {tx,ty}, respawn?:{dayKey,
  cycleKey, days}, drops(e, ctx): void, flags:{isPinnacle?,isKraken?,isFinalBoss?,isGreatBeast?,
  isWildDragon?,night?,island?} }` — one entry each for the 4 hunts + 2 pinnacles + dragon +
  kraken (+ #121's Archivist). `stats` = each factory's scaling block VERBATIM (four different
  formulas — p22:126-138, 152-161, 322-345, 529-552 — deliberately NOT unified in migration).
- **GearItem/Unique/PatternWeapon/EliteAffix/DungeonTheme/FloorMod/CompanionClass/Steed/Region/
  Food/Bless/TradeGood/Status**: today's row shapes, typed. EliteAffix gains `apply(e)` (the
  p18:50-57 per-key seeding); affix HIT behavior stays in afxHit p18:67 (hot path — data-driven,
  not hook-per-hit). CompanionClass gains `tiers: [T1,T2,T3]` (§3 #115). Steed: `{ key, color,
  level, tameLevel, drawSteed(v,p) }` (Emberwyrm = sole entry; `p.dragon` shape untouched — a
  second steed later adds `p.dragon.key`, a conscious re-record then, not now).
- **curves.ts**: named formula constants — `xpForLevel` terms (p12:370-374), wild stat/reward
  terms (p03:378-386), dungeon enemy/boss terms (p03:399-404, 420-427). Formulas-as-data; ONE
  source (the rebuild-from-generator rule) — battery evaluates the registry directly, never a
  mirror.

Rule: entry data = plain values; hooks = pure functions of their args; RNG only via draws the
migrated body already made, same count, same order. Serializer key-sorts (tests/golden/
serialize.mjs:78,98) so field order can't move oracle hashes — keep it verbatim anyway (the wire
doesn't sort).

### 1.3 Reachability — sim, renderer, server, client (without breaking concat/namespace)

`index.ts` ends with `(globalThis as any).CONTENT = CONTENT` (explicit, greppable, no esbuild
globalName). The compiled chunk is inserted at the HEAD of the game program (before p00), so every
part sees it at load time. Consumption pattern — **positional lexical alias**: the migrated part
keeps its declaration line, body replaced:

```js
const AFX_DEFS = CONTENT.affixes.defs;   // p18:15 — same binding, same position, zero call-site churn
```

Bare-name reads in classic-script parts resolve through globalThis, but the alias keeps the symbol
a REAL top-level binding — so `namespaceEpilogue` (build.mjs:55-101) still resolves it, CAPTURE/
NAMES entries keep working, grep keeps working, and a partial migration can never be shadowed by a
stale lexical const (the alias IS the const). Dispatch sites (drawEnemy p20:42, updateBoss
p17:516/524, factories) look up `CONTENT.enemies[e.type]` / `CONTENT.specials[name]` directly.
Registries themselves are deliberately NOT capturable: a CONTENT name added to CAPTURE/NAMES has no
top-level binding and no `__g` slot → **build fails loudly** (build.mjs:74-79) — the rule "server
and client reach content only through game fns" is build-enforced. Server side: load-game.js
evals the whole artifact (load-game.js:213) — `globalThis.CONTENT` lands on the Node global; world.js
may READ it for display payloads but never mutates. Client: the artifact script runs in the page;
`window.CONTENT` exists the same way. Hooks compiled from modules cannot lexically reach game
globals (`state`, `TILE` are not in module scope — **tsc errors at compile time**), so every hook
receives what it needs via args — the acting-context discipline is type-enforced.

### 1.4 TS strategy + the MINIMAL build change

Registries are **real strict ES modules now** — NOT `.js`-with-JSDoc, NOT TS-as-script-parts.
TS-script parts are impossible under the repo's `isolatedModules: true` (a global-script .ts is
TS1208), and dropping that flag or forking a second tsconfig is a worse trade than one bundle call.
Typecheck: the existing `npm run typecheck` already covers them (include `["src"]`, strict). Build
delta in scripts/build.mjs, ~30 lines, everything else untouched:

1. `esbuild.build({ entryPoints:['src/content/index.ts'], bundle:true, write:false, format:'iife',
   minify:false, sourcemap:false, target:'es2022', platform:'neutral' })` → `contentChunk`.
2. Guards (all throw): chunk must not start with top-level `"use strict"` (the concat program is
   sloppy-mode; a strict prelude at top level would flip the WHOLE script), must contain
   `globalThis.CONTENT`, must acorn-parse standalone.
3. `program = contentChunk + manifest parts` (build.mjs:106); the existing whole-program acorn
   parse (:108) and namespaceEpilogue stay as-is (the chunk's IIFE adds no top-level bindings).
4. **facing-noregress repoint** (the one suite that self-assembles shell+parts from git-HEAD and
   worktree, tests/battery/facing-noregress.js:36-39): both children materialize `src/content/` to
   a tmpdir (`git show HEAD:…` / disk copy), run the same esbuild call, prepend the chunk. Without
   this, the first part that reads CONTENT crashes its assembled program — do it IN S1 and prove it
   by omission (chunk removed → suite fails loudly, not silently).
5. Pin esbuild (devDep already ^0.28.1) — chunk text is part of the artifact; version drift = dist
   churn, reviewed like any diff.

Module era (post-P3): the chunk step is deleted, imports go direct — registries don't change.

Purity (REBUILD.md CI rule, amended consciously): content never references `document/window/canvas/
ctx/localStorage/Sound/state` — module scope + tsc enforce it; **draw hooks receive the 2D context
via `DrawView`** (server never calls them; the rule's intent is "sim can't call draw, draw can't
mutate sim", not "no art in content"). Record the amendment in REBUILD.md in S1. NO freezing of
registry objects (sloppy-mode writes to frozen objects fail SILENTLY — the exact failure class this
codebase hates); mutation tripwire = the oracles + a content-purity battery grep (S1).

---

## 2. Migration table (current site → registry; class: **P**=pure lookup, hashes must not move ·
**H**=verbatim hook move, hashes must not move · **R**=designed re-record in a feature slice)

| content | current site | destination | class |
|---|---|---|---|
| ELEMENTS | p17:172 | elements.ts | P (S1) |
| 8 enemy kinds (stats+type blocks) | p03:201-318 | enemies.ts data+init | P+H (S2) |
| wild spawn type tables (ring/biome) | p03:353-376 | enemies.ts `spawn` weights | P (S2) |
| makeDungeonEnemy pool growth (archer@3/healer@4) | p03:392-397 | dungeons.ts theme knobs | P (S2) |
| creature art ×11 | p20:56,103,192,248,323,394,476,555,638,770,858 | enemies.ts `draw` | H (S3) |
| FACING/FACE_DZ | p20:40-41 | enemies.ts `faces` + one const | P (S3) |
| boss special windups | p17:405 | specials.ts `wind` | P (S4) |
| execBossSpecial branches (slam/charge/nova/summon/pullunder/raiseadds) | p17:409+ | specials.ts `exec` | H (S4) |
| telegraph draw chain | p20:~1000 | specials.ts `drawTele` | H (S4) |
| bossSpecials roster fn | p17:380 | specials.ts pick tables | P (S4) |
| GREAT_HUNTS ×4 | p22:165-275 | apex.ts | P (S5) |
| PINNACLE_BOSSES ×2 + PIN_* consts + PIN_LEVEL | p22:382-501 | apex.ts | P (S5) |
| dragon consts + makeWildDragon | p22:110-140 | apex.ts entry (stats hook verbatim) | H (S5) |
| makeKraken | p22:141-163 | apex.ts entry | H (S5, re-tuned in F3=R) |
| makeGreatBeast / makePinnacleBoss / pinnacleLair | p22:311-345, 502-553 | apex.ts stats/lair hooks | H (S5) |
| makePinnacleAdd / dropPinnacleReward / dropGreatBeastReward | p23:1-67, p22:347-374 | apex.ts adds/drops hooks | H (S5) |
| respawn trio pattern (hunt/pinnacle/dragon day+cycle keys) | p23:130-140, p14:1-25, p13:665-688 | apex.ts `respawn` descriptors (bodies stay in-part, table-driven) | H (S5) |
| SHOP_WEAPONS / SHOP_ARMOR / SHOP_NAMES | p08:598-…, p09:1-5, p08:506 | gear.ts | P (S6) |
| RARITIES/STYLE_NAMES/ARMOR_NAMES/RAR_PREFIX | p01:112-131 | gear.ts | P (S6) |
| UNIQUES (4 relics) + makeUnique tuning | p22:397-467 | gear.ts uniques | P (S6; +5 in F4c) |
| PATTERN_WEAPONS / MASTERY / MASTERY_LVLS | p02:293, 127, 147 | gear.ts | P (S6) |
| gen name pools in genWeapon/genArmor + rollAffixes gear-affix defs | p02:201-292 | gear.ts pools | P (S6) |
| AFX_DEFS/AFX_KEYS + per-key seeding | p18:15-63 | affixes.ts (`apply` hook) | P+H (S7) |
| DUNGEON_THEMES + dungeonTheme | p03:92-152 | dungeons.ts | P (S8) |
| FLOOR_MODS + rollFloorMod weights + vault odds | p06:370-384, p03:177 | dungeons.ts | P (S8) |
| COMP_CLASSES/COMP_NAMES/COMP_CAP/compStatsFor | p04:486-554 | companions.ts (tiers[0]=today) | P (S9) |
| FOODS/INGR/FOOD_LABEL/BLESS/TRADE_GOODS/FORAGE_VALUE/STATUS_DESC/SEASONS/SEASON_TINT | p14:221-251, p10:383-390, p09:417-423, p15:24, p14:197-200 | tables.ts | P (S10) |
| regions: REGION_NAMES/REGION_SUBS/LORE_TEXTS (+regionOf p16:1 reads) | p15:607, p05:344-…, p05:355 | tables.ts regions | P (S10) |
| steed: DRAGON_LEVEL/DRAGON_COLOR + drawPlayer steed block | p22:110-115, p19 (mounted block) | tables.ts steeds (drawSteed hook) | P+H (S10) |
| POI_KINDS/HOLD_SITES/WL_FIRST/WL_EPITHET/RANK_NAMES/WL_STRENGTHS/WL_WEAKNESS/NEMESIS_NAMES/TITLES | p03:457, p04:111, p15:554-607, p13:628-636 | tables.ts | P (S10) |
| ability knobs: ABILITY_RMAX + HEAT_AURA_MIN/aura opts | p08:264, p11:474 | tables.ts abilities | P (S10) |
| xpForLevel + wild/dungeon scaling terms | p12:370-374, p03:378-386, 399-404, 420-427 | curves.ts | P (S11), changed in F1=R |
| warlord stat curve (makeWarlordEnemy) + strengths effects | p16:91-140 | stays in-part THIS phase (nemesis system, not a spawn table; entry-ize with the legion arc later) | — |

Behavior-identical discipline (P/H rows): both oracles byte-identical at every slice
(`oracle.json` 24c2ed95…, `oracle-mp.json` 0db3e62a… — the S20 native baselines); table
relocation must not touch state shape (registries are lookups; nothing registry-owned is ever
ASSIGNED into state except values that were already assigned — e.g. `state.dungeonThemeData =
theme` p03:154 keeps pointing at the same-VALUED object, and serialize-by-value hashes it
identically). Any slice that cannot hold the hashes takes the conscious-re-record path with
deep-diff evidence — designed to happen ONLY in F1/F3.

---

## 3. The four backlog features as registry proofs

### #113 — overworld XP/gold curve (through curves.ts) — the R slice with the smallest blast
- Today (p03:380-386): stats scale `f=(1+(lvl-1)*0.26)*biomeMul*diffMul(df)` but rewards scale
  ONLY `rew=biomeMul*(1+df*1.0+df*df*1.3)` — no level term at all: high-level heroes fight
  spongier foes for flat pay. Fix in curves.ts: `xp *= (1+(lvl-1)*0.26)` (the FULL stat term);
  `gold *= (1+(lvl-1)*0.10)` (gentler — gold has other faucets: tribute, trade, bounties).
  Constants are owner-tunable registry knobs.
- Hooks: makeWildEnemy p03:384-386 reads `CONTENT.curves.wildReward(...)` (already extracted S11).
- Battery: NEW `curve-verify` — evaluates the registry fns over a (lvl, df, biome) grid vs exact
  expected values, plus the bug demo pinned failing on a pre-change scratch tree (L20 hero's slime
  pays the same as L1's).
- Oracles: **hashes MOVE by design** (every overworld kill pays differently → gainXP cascade).
  Conscious paired re-record, BOTH oracles, with evidence: (a) old-vs-new engine first diverges at
  the first overworld kill tick of each trajectory, (b) serialized deep-diff at that sample =
  xp/gold leaves only (before the level-up cascade), (c) per-hero end-state table (levels/gold up,
  positions downstream), (d) hunt control still diverges exactly @700 after re-record.

### #115 — warband economy (through companions.ts + onNewDayHero)
- Entries: `tiers` per class — T1 = today's numbers EXACTLY (hire 200/200/240, p04:497/509/522 —
  golden-neutral by construction), T2/T3 on the ~10× curve: knight/ranger 2,000 → 20,000, mage
  2,400 → 24,000; stat blocks per tier as entry data (compStatsFor p04:546 gains a tier factor,
  T1 factor = 1); `upkeep` gold/day per tier (owner's daily upkeep — e.g. 10/60/300, knobs).
- Hooks: `recruitCompanion(cls, tier)` p04:606 (RPC_OK world.js:231 already lists it; args ride
  `_runRpc`); NEW `promoteCompanion(idx)` RPC (+1 RPC_OK entry — flag to owner). Upkeep in
  **onNewDayHero** p13:689 beside dailyHoldingIncome p04:325: the acting hero pays for HIS comps
  (`c.ownerId === state.player.id` filter — the bumpCompanionLevels precedent; SP: ownerId unset →
  all his). Short gold → `c.unpaid = 1` (scalar → rides packComp world.js:193 free) + feed line;
  paid in full next day-tick → cleared. **Unpaid = stay but refuse to fight** (owner's exact
  words): updateCompanions gates compMeleeHit/compRangedShot on `!c.unpaid`; follow/garrison/level
  unchanged. renderCompanions shows tier/upkeep/unpaid.
- Battery: NEW `warband-economy-verify` — tier costs/stats, per-owner upkeep in a 2-hero world
  (A's comp never drains B), unpaid refusal (foe adjacent, zero comp damage) + resume after pay,
  promote path, T1-is-identical guard (compStatsFor(cls,lvl,tier=0) === pre-change values) — SEEN
  FAILING vs scratch.
- Oracles: recorded windows contain NO companions (P2/S19 note) and day-700 upkeep no-ops on an
  empty roster → both oracles expected byte-identical — prove by both-runs identity (the S14/S16
  pattern), NO re-record; the behavioral delta lives in battery. If any 1p scenario turns out to
  own a comp across a day tick, fall back to the evidence+re-record path (diff = gold leaves only).

### #123 — kraken → real finale (through apex.ts + a personal quest key)
- Entry rework (`apex.kraken`, consumed by makeKraken p22:141): **48,000 flat base HP** (no
  partyLvl term — the flat-levels doctrine; sits above PIN tier: Drowned King effective ≈26k),
  keep `×(1+(partyN()-1)*0.4)` party-size HP and ascension knobs (entry data), atk ~raised to
  pinnacle-class (knob), `level: 90` stamped (drawn via the apex `Lv N` tag), `respawn:
  { dayKey:'krakenRespawnDay', cycleKey:'krakenCycle', days: 4 }` — the pinnacleRespawnDay/Cycle
  pattern verbatim (killEnemy sets the day exactly like p12:232; NEW `maybeRespawnKraken` joins
  onNewDayWorld p13:695 beside maybeRespawnPinnacle; cycle scales hp/atk/rewards via the entry's
  stats hook like p22:529-545). setupOverworld p06:356 spawn stays; `state.flags.krakenDead`
  remains the world fact (dialogue p21:673, minimap) but no longer permanent — cleared on respawn
  (MP world state regenerates each boot anyway, world.js:491 comment — cycles are per-boot, same
  as hunts; note in release).
- **Victory once per hero, via their own quest state:** killEnemy's isFinalBoss branch p12:205-212
  (today: `flags.krakenDead=true; saveGame(); victory()` — victory() p23:370 is a DOM overlay,
  scene-neutralized in MP at world.js:856, and `quests.main` is room-SHARED via aliasSharedQuests
  p22:302 so it can only fire once per ROOM) → reworked: `quests.finale = {done:false}` PERSONAL
  key added to the quest literal p01:307-313 (personal like talk/key/slay/dragon — deliberately
  NOT in the alias list p22:305-307); on kill, `for (pl of partyIn()) actAs(pl, …)` → first time:
  `finale.done=true`, ★ feed line (FEED_BROADCAST picks ★), per-hero rewards; `main.done` still
  flips (shared war outcome). SP victory() overlay keys on the hero's own finale edge — fires
  once; cycle re-kills drop cycle loot, no second overlay. MP client: personal quests already ride
  the gated quest payload (p._qJson, world.js ~922-926) → box repaints; optional tab-local banner
  on the finale.done edge in mp.html (ws.onmessage side, NEVER reconcile — the one-shot rule).
- Oracles: the quest literal + PLAYER_TEMPLATE (world.js:80) gain a key → BOTH oracles
  shape-diverge at sample 0 → the S5-S13 masking-view protocol: old-shape view (finale hidden on
  every hero) must reproduce both committed oracles BYTE-FOR-BYTE at all samples + per-hero
  end-state summaries identical → then conscious re-record. migrate.js: default
  `quests.finale={done:false}` for old rows (v1-v4 synthesis chain).
- Battery: NEW `kraken-finale-verify` — 2-hero kill → BOTH heroes' finale.done + each paid once;
  re-kill fires nobody's victory twice; respawn day set at kill, day-advance → cycle+1 spawn with
  cycle-scaled HP; projectile kill credits the shooter's quest box (the pin-carries-the-bag probe,
  S16 precedent); migrate fixtures ×7 — SEEN FAILING vs scratch.

### #121 — pinnacle dungeons (the Citadel; spec = DESIGN-pinnacle-dungeons.md with owner overrides)
Owner overrides applied: NO retune of shipped dragon/pinnacle (spec §0.4's curve stays out of
apex entries that already ship); **drop rule = per-player hidden flat 1% unique roll on the
citadel boss** (replaces spec §1's sigil-pity design); **entrance persists on death**.
- Entry design: killing a pinnacle boss OPENS a persistent gate near its lair (`state.citadelGate
  {tx,ty}` world-shared, NOT persisted — regenerates by re-kill after reboot, the krakenDead
  class), honoring the ask's "dungeons that drop from pinnacle bosses" with zero consumable-key
  machinery; a wipe never closes it (owner: persists on death). Spec's fixed-tile T.CITADEL_GATE
  (§2.2) stays the render/interact vehicle (tile stamped when the gate opens; mapPayload
  transactional resend already covers tile switches). Flagged alternative (sigil item) rejected
  by default — reintroduces the pity math the owner superseded.
- Structure (spec §2 verbatim, still-valid after P2): reuse `sharedDg` — NO parallel instance;
  `WORLD_SLOTS` world.js:252 **+= 'citadel'** (the spec's ⚠⚠, vault precedent in the same line's
  comment); `state.citadel` NEVER pre-initialized (absent until first entry → recorded scenarios
  keep their shape → oracles hold); dgKind guards ×3 (normal-door join refusal at the world.js:654
  enter path, _enterRift joining world.js:370-384, clear at both dissolve sites world.js:1080/1083);
  descend() branch p11:1 keyed on state.citadel; `setupCitadelFloor` sibling of setupDungeonFloor
  p06:385 (floorMod forced null — spec §2.3); floors 1-3 trash + floor 4 = one big boss room.
  NOTE: spec §3.6's world.js party-hazard replication is OBSOLETE — P2/S3 folded the party-wide
  menace INTO pinnacleHazard via world-scoped partyIn() (p23:104-127), which is dungeon-correct by
  construction; only the `(e.isPinnacle || e.isCitadel)` gates at the four sites remain.
- Registry entries: `dungeons.citadel` theme (+ floor levels [60,75,90] + boss-room layout knob);
  `apex.archivist` (level 200 FLAT entry data — spec §0's validated player-power math sets the
  defaults: hp ≈ 240,000 base, atk 260, def 46 — DEF CLIFF warning from §0.2 encoded as a typed
  max on the field; partyN HP knob per §0.4/OQ#4; stances as entry data swapping `e.specials`);
  minions entry (lvl-100, `_orderIdx/_pinRef/_rezN` — the ordered-kill court killEnemy p12:153-170
  honors with ZERO new code); NEW specials entries `leap`/`castvolley`/`raisecourt` in specials.ts
  — each carries exec + **drawTele** (the S4 registry makes the spec's two silent failures
  structural: no draw hook = type error; party-wide mechanics = projectiles, per the p23 comment);
  5 relics as `gear.uniques` entries + recalcStats p07:544 u*-flag block (+5 flags beside p07:600,
  the v2.56.0 iron rule: flags, never gear-reads in combat).
- **Per-player hidden 1%:** on Archivist death, `for (pl of partyIn()) actAs(pl, () => { if
  (rng() < 0.01) { bag the relic (state.inventory under actAs — the pin carries the bag, S16),
  personal ★ line } })` — direct-to-bag (no ground-pickup sniping; the spec's OQ#6 resolved by
  the owner's per-player wording), no pity, no visible counter. Roll order = partyIn join order
  (the determinism contract). Everyone also gets the guaranteed gold/legendary floor drop.
- Server/wire: `snap.citadel` beside dgLevel in the inDg block (~15 B, spec §5); ONE mp.html adopt
  line; CAPTURE += setupCitadelFloor/tryEnterCitadel (+build-verified via the namespace — unknown
  name = build error, the P1d gate); no new RPC (entry is [E]→tryInteract).
- Oracles: both must stay byte-identical (prove both-runs; nothing recorded enters a citadel or
  reads the absent keys). Battery: NEW `citadel-verify` (gate opens on pinnacle kill, persists
  through a wipe, floors 1-4 shape, floorMod null, boss stances/phases cycle, leap lands in-bounds
  `canMoveTo` asserted, adds rez out-of-order capped, packEnemy(boss) has phase/stance/arenaR/level
  and NO object field) + `mp-citadel-verify` (2-hero: B refused at the normal door mid-run, party
  descend together, per-player roll probe under seeded rng — one hero hits, bystander's bag
  untouched, wipe → gate still open + sharedDg dissolves + warband force-surfaced world.js:1080) —
  SEEN FAILING vs scratch trees.

---

## 4. Slice ladder (one agent each; gate **G** = battery green with new asserts SEEN FAILING on a
scratch worktree + golden 1p 8/8 + mp-golden 4/4 byte-identical (or the slice's DESIGNED re-record
with divergence evidence) + world self-test + typecheck + live browser smoke when render/client/UI
is touched; `git diff --stat` review after every agent; no commits by agents)

- **S1 — the content seam + ELEMENTS** *(FIRST — smallest honest registry)*: build.mjs compose
  step + the 3 chunk guards (§1.4); `src/content/{types,index,elements}.ts`; p17:172 → alias
  const; **facing-noregress assembly gains the chunk** (both children; proven by omission);
  NEW battery `content-purity` (chunk position, no top-level "use strict", no document/Sound/
  localStorage/state tokens in the chunk, CONTENT assignment present); REBUILD.md purity
  amendment. Vacuity: scratch tree with elements.fire.color perturbed → probe fails; CAPTURE-a-
  registry negative control → build fails. Why ELEMENTS: 4 rows, zero RNG, read by sim
  (applyElementOnHit p17:~207), render (elemColor), and UI (elemHtml) — proves the whole pipe for
  pennies, inside the golden path (oracles prove identity).
- **S2 — enemy kinds**: base table p03:201-318 → entries + init hooks; wild spawn tables
  p03:353-376 → `spawn` weights (makeWildEnemy keeps its curve inline until S11). G.
- **S3 — creature art**: 11 draw branches p20:56-1000 → entry.draw; dispatch + shadow/flash
  prelude stay in-part; facing-noregress = the op-for-op oracle (all creatures, HEAD vs WT). G.
- **S4 — boss specials registry**: windups p17:405, exec branches p17:409+, telegraph chain
  p20:~1000, roster fn p17:380 → specials.ts. NEW battery `specials-draw-verify` (forced e.tele
  per name → op-count probe per drawTele; SEEN FAILING vs a branch-deleted scratch). G.
- **S5 — apex registry** *(the riskiest migration — see risks #2/#3)*: 8 entries (hunts×4,
  pinnacles×2, dragon, kraken) + stats/lair/adds/drops hooks verbatim + respawn descriptors;
  killEnemy p12:219-248 respawn-day writes + maybeRespawn trio become table-driven. The golden
  `hunt` perturb control (diverges EXACTLY @700) is the designed tripwire for this slice — it
  must still fire exactly there. G.
- **S6 — gear registry**: shop tables, rarity tables, UNIQUES, pattern weapons, gen pools,
  mastery. G.
- **S7 — elite affixes**: AFX_DEFS + apply hooks; afxHit stays in-part. G.
- **S8 — dungeon registry**: themes + floor mods + vault knobs. G.
- **S9 — companion registry**: COMP_CLASSES → tiers-ready (tiers[0] ≡ today, tier param default
  0 → byte-identical). G.
- **S10 — small-tables sweep**: foods/bless/trade/status/seasons/regions/steed/POI/holds/names/
  ability-knobs (2-agent-parallel-safe: tables.ts is append-only rows; keep ONE integrator
  commit). Honest scope note for "spells/auras": passive knobs (aura element opts, rank caps,
  bless) become entries now; a NEW active ability = one entry still needs the input/UI seam —
  that lands with the GUI arc, documented as such in the cookbook. G.
- **S11 — curves registry**: extraction only (identical math, identical rounding, call sites
  evaluate registry fns). G — hashes untouched; this stages F1.
- **F1 — #113 curve change** (§3): the ONE designed re-record pair for tuning; `curve-verify`. 
- **F2 — #115 warband economy** (§3): `warband-economy-verify`; oracles prove-identical path.
- **F3 — #123 kraken finale** (§3): the SECOND designed re-record (template key); live 2-tab
  smoke (feed ★ + box repaint on both).
- **F4a — #121 citadel shell**: gate-on-pinnacle-kill + WORLD_SLOTS 'citadel' + dgKind guards +
  floors + descend branch; `citadel-verify` structure asserts; oracles prove-identical.
- **F4b — #121 the Archivist**: apex entry + minions + stances + leap/castvolley/raisecourt
  specials entries + `(isPinnacle||isCitadel)` gates; TTK calibration vs a scripted 1,550-DPS
  dummy (spec §0.1 anchor) recorded in the slice report; `/health` tick budget with a full wave.
- **F4c — #121 relics + per-player 1%**: 5 uniques entries + recalc flags + the actAs roll loop +
  trophy rows; `mp-citadel-verify` drop probes; live 2-browser feed check (the Legion-roster
  lesson: headless passed, live failed).
- **S-final — registry cookbook**: draft CONTENT.md (P4 consumes): one recipe per content type —
  add an enemy / special / apex boss / gear piece / gear type / elite affix / dungeon mod / steed /
  region / companion tier / curve knob — each recipe = the entry shape, the ONE file to touch,
  which hooks are mandatory (draw!), which gates to run, and the three hard rules (no state
  reach-ins, RNG only in hooks the sim calls, re-record only with evidence). Plus: retire dead
  aliases where every read moved (grep-proven), REBUILD.md P3 status entry.

18 slices. Sequencing: S1 → S2 → S3 → S4 → S5 are ordered (each builds on the last); S6-S10 are
file-disjoint after S1 and may interleave; S11 → F1; S9 → F2; S5 → F3; {S4,S5,S6,S8} → F4a → F4b →
F4c; cookbook last. No deploys anywhere in P3 (REBUILD.md: nothing ships until P4).

---

## 5. Risk register (top 8)

| # | risk | detection |
|---|---|---|
| 1 | The content chunk breaks self-assembling/textual suites (facing-noregress HEAD-side has no chunk → assembled program throws on first CONTENT read; textual anchors shift) | S1 repoints facing-noregress and PROVES by omission; battery full sweep per slice (sp-flags-check/quest-verify/vtune/map-enlarge/flags-pp anchor on part text, unaffected by a prepended chunk — asserted by their own green runs) |
| 2 | RNG draw-order drift in a hook move (an init/stats hook adds/loses/reorders a Math.random) | golden 1p diverges at the offending slice; the hunt control must still diverge EXACTLY @700 (S5's tripwire) |
| 3 | Registry data lands in state by REFERENCE and a sim write mutates the registry (e.g. `e.specials = h.specials` p22:342, `state.dungeonThemeData = dungeonTheme(level)` p06:386) — next boot's reads see poisoned content | NO freezing (sloppy-mode silent-no-write is worse); `content-purity` gains a canary: after a 3k-tick headless run, deep-equal CONTENT vs a fresh re-eval of the chunk — SEEN FAILING with a deliberate `entry.hp++` probe |
| 4 | Cross-eval identity: `globalThis.CONTENT` is process-global; a second game eval (qrender/objclient re-eval, future multi-room) sees the LAST chunk's objects | hooks are arg-pure (tsc-enforced, §1.3) so sharing is value-identical; objclient/qrender already save/restore globals around their second eval — extend to CONTENT in S1 |
| 5 | Per-player 1% roll credits the wrong bag (the :2107 class — projectile kill's ambient pin) or double-pays via re-entry | mp-citadel-verify seeded-rng probes: shooter's bag +1, bystander byte-untouched, re-kill in the same tick can't re-roll; the actAs loop is the only roll site (source guard) |
| 6 | A "pure" slice moves hashes anyway (template/state key added early, alias evaluated at a different program position changing TDZ/init order) | per-slice oracle byte-check on BOTH baselines is the gate itself; aliases sit at the ORIGINAL declaration lines (§1.3); re-records exist only in F1/F3 — any other divergence = stop the slice |
| 7 | F1/F3 re-records mask an unintended second delta (the S17 lesson inverted) | divergence-evidence protocol is mandatory: masked-view/first-divergence deep-diff must show ONLY the designed leaves; both-runs identity legs before and after; fresh full prove + mp-prove on the new baselines |
| 8 | Perf: registry indirection + citadel wave in the 80 Hz tick (entry lookup per draw call, per spawn) | aliases make table reads a const deref (zero cost); draw hooks are one property lookup per entity per frame — /health tickMsAvg vs the ~12.5 ms budget in v4b-fullstack + a perf-review pass after S3 (the render slice) and F4b (the wave), the standing perf-gate |

---

### Answers for the caller
- **First slice**: S1 — the build seam (esbuild chunk + guards + facing-noregress repoint +
  content-purity battery) carrying ELEMENTS (p17:172) as the smallest honest registry: 4 rows
  crossing sim+render+UI inside the golden path, zero RNG, oracle-proven identical.
- **Layout + TS call**: `src/content/` (REBUILD.md's target tree; nothing about the parts-concat
  favors src/game/ — content enters as a compiled prelude either way). Registries are REAL strict
  ES modules typechecked by the existing `tsc --noEmit` (include ["src"]) — TS-as-script-parts is
  impossible under isolatedModules (TS1208) and .js-with-JSDoc breaks the owner's TS-strict
  decision; the MINIMAL build change is ~30 lines in scripts/build.mjs (one non-minified esbuild
  iife of src/content/index.ts prepended to the concat, three loud guards) + the facing-noregress
  assembly repoint. The chunk step deletes itself at the module era.
- **Riskiest migration**: S5 (apex registry) — four different verbatim scaling formulas, the
  respawn-day/cycle machinery threaded through killEnemy p12:219-248, and it sits directly on the
  golden hunt-perturb tripwire (must keep diverging EXACTLY @700). Runner-up: S3 creature art
  (1,150 lines of draw ops), but facing-noregress guards it op-for-op.
- **Ladder length**: 18 slices — S1-S11 (platform, hashes frozen), F1/F2/F3/F4a/F4b/F4c (the four
  backlog proofs; exactly two designed re-records: F1 #113, F3 #123), S-final (cookbook →
  CONTENT.md for P4).
