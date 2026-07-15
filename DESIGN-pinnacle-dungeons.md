# The Sunken Citadel — pinnacle dungeons, the level-200 boss, and chase uniques

*Build spec for the v2.57–v2.60 arc. Companion to [DESIGN-endgame.md](DESIGN-endgame.md)
(which this extends) and [ARCHITECTURE.md](ARCHITECTURE.md) (whose invariants this obeys).
Line numbers are as of **v2.56.5** — verify before editing; names are the durable reference.*

**Owner's ask, verbatim:** *"I want to add dungeons that drop from pinnacle bosses which have 3
levels and then a big room with a super hard boss. And each drops unique gear with special bonuses
when equipped, but they should be like 1% chance to drop. The boss should be extremely difficult,
have lots of fighting styles, jump around, use minions that are uber-powerful, etc.. Think like
level 100 minions and level 200 boss."*

**Owner's design direction (same session):** *"We will probably move away from tuning bosses to
party level. Instead, make them level X flat."* — pinnacle bosses → **75 flat**, Emberwyrm → **30
flat**. This spec's boss is **200 flat**, its minions **100 flat**.

---

## 0. THE HEADLINE PROBLEM: "level 200" is cosmetic today

**`e.level` is a write-only field.** It is set in exactly two places — `makeGreatBeast`
(:2069, `e.level=partyLvl()`) and `makePinnacleBoss` (:2099, `e.level=partyLvl()`) — and **nothing
in the game, server, or client ever reads it.** It is not drawn (`drawEnemy` :1965 has no level
text), not in the combat HUD (`updateCombatHud` :1677 is player-side only), and not used in any
damage formula. Setting `e.level = 200` changes *nothing*.

**And the stat curves are additive, so a flat level barely moves them.** Measured against the real
generators:

| generator | curve | @30 | @200 |
|---|---|---|---|
| `makeWildDragon` (:2058) | `maxHp = 2200 + lvl*50` | 3,700 | **12,200** |
| | `atk = 36 + lvl*0.7` | 57 | 176 |
| `makeDungeonBoss` (:946) | `maxHp = 90*(1+(lvl-1)*0.55)` | 1,526 | **9,941** |
| | `atk = 12 + lvl*2.2` | 78 | 452 |
| | `def = 4 + lvl` | 34 | **204** ⚠ |

A realistic endgame player does **~1,550 DPS**. So a "level 200" dragon (12,200 HP) dies in
**~8 seconds**. The base constant (2200, 90) dominates; the level term is rounding error.

### 0.1 Calibrating against real player power (not vibes)

Measured headlessly through the real formulas (`recalcStats` :1289, `meleeSwing` :1524,
`updateProjectiles` :1544, `playerTakeDamage` :1542). The **XP curve bounds the player**:
`xpForLevel` (:1540) is geometric at ×1.58 — L19→20 costs 75k, cumulative L25 is **3.2M**, L30 is
**31.3M**. **Level 22–25 is the practical ceiling**; L30 is theoretical.

| player | atk | def | maxHp | crit | melee DPS (SP 60fps) | melee DPS (**MP 80Hz**) |
|---|---|---|---|---|---|---|
| L19 *(owner's Drowned King solo)* | 119 | 66 | 284 | 55% | ~713 | ~951 |
| L22 *(realistic strong endgame)* | 137 | 74 | 358 | 60% | ~902 | ~1,202 |
| **L25 *(near-ceiling — the design anchor)*** | **155** | **82** | **432** | 60% | ~1,164 | **~1,552** |
| L30 *(theoretical, ~31M XP)* | 179 | 94 | 527 | 60% | ~1,405 | ~1,873 |

> **The model reproduces the owner's experience exactly.** 9,500 HP ÷ 951 DPS ≈ **10 seconds** at
> L19 — hence *"zero problem."* The Drowned King is not a boss; it is a 10-second speed bump.

Two facts that drive every number below:

1. **⚠ MP attacks ~33% faster than SP.** `weaponCd` (:788) returns **frames**; the SP loop is rAF
   (~60fps) but the server sims at **80Hz** (`HZ` in index.js:42). A 12-frame cooldown = 5 hits/s
   in SP, **6.7 hits/s in MP**. Tune against the MP rate — it is the higher ceiling.
2. **Style parity is already good** — at the L25 ceiling vs def 40 (MP): melee ~1,552, ranged
   ~1,469, magic ~1,627 DPS. No style needs special-casing.

### 0.2 ⚠ `def` is a CLIFF, not a dial

Player→enemy damage (both `meleeSwing` :1524 and `updateProjectiles` :1544) is:

```js
dmg = Math.max(1, Math.round((atk - e.def + rand(0..2)) * playerDmgMul() * execMul(e)))
```

`def` subtracts **before** the multipliers, with a hard `max(1, …)` floor and **no percentage
floor**. So:

| boss def | vs L25 atk 155 | |
|---|---|---|
| 20 | 136/hit | 117% of baseline |
| **46** | **110/hit** | **95% — the sweet spot** |
| 120 | 36/hit | 31% |
| 155 | **1/hit** | ⚠ **floored — unwinnable by attrition** |
| 204 *(`makeDungeonBoss` @200)* | **1/hit** | ⚠ **854-second TTK** |

**`makeDungeonBoss`'s `def = 4+lvl` at level 200 gives def 204 — above the player's atk.** That is
the *opposite* failure from the HP one: not "too easy" but a 14-minute 1-damage-per-hit grind.
**Def must stay well below the weakest expected participant's atk (~120 at L20). Never reuse
`4+lvl`.** HP is the lever; def is a 5% garnish.

### 0.3 ⚠ Player EHP is LINEAR — so `atk` must be too

`gainXP` (:1541) grants `maxHp += 8` per level. Player HP is **linear** while player DPS is
**multiplicative** (atk × crit × haste × prof × gear-drop-level). Therefore **HP scales
exponentially with level and atk scales linearly.** Anything else one-shots the player.

Incoming damage is floored at 45% and cannot be tanked away (`playerTakeDamage` :1542):

```js
let dmg = Math.max(Math.ceil(amount*0.45), amount - p.def);   // ← 45% is UNMITIGABLE by def
if (p.fort > 0) dmg = Math.max(1, Math.round(dmg*(1-p.fort)));   // fort caps at 0.30
```

At boss atk 260 vs the L25 anchor (def 82, fort 25%): def absorbs nothing — the 45% floor wins —
so contact = **134** (3.2 hits to die) and a 1.3× slam = **192** (2.3 slams to die).

### 0.4 THE FIX: one multiplicative curve for the whole flat-level ladder

```js
// ONE generator, ONE source of truth (rebuild-from-generator rule — no formula mirrors).
const LVL_HP  = (l) => Math.round(1400 * Math.pow(1.026, l));  // EXPONENTIAL — tracks player DPS
const LVL_ATK = (l) => Math.round(30 + l * 1.15);              // LINEAR — tracks player maxHp
const LVL_DEF = (l) => Math.round(12 + l * 0.17);              // SHALLOW — stays off the cliff
```

| lvl | HP | atk | def | who |
|---|---|---|---|---|
| 30 | 3,024 | 65 | 17 | **Emberwyrm** (owner: 30 flat) — today it's 3,700/57/12 ✔ |
| 75 | **9,598** | 116 | 25 | **Pinnacle bosses** (owner: 75 flat) — Drowned King as actually fought ≈ **9,500**/~137/14 ✔ |
| 100 | **18,233** | 145 | 29 | **Citadel minions** |
| 200 | **237,465** | **260** | **46** | **Citadel boss** |

> **Validation:** the curve independently reproduces the Drowned King at the owner's chosen flat
> level of 75 (**9,598 vs ~9,500 observed**) and the Emberwyrm at 30 (3,024 vs 3,700). The ladder
> the owner picked by feel is *already* this curve — it just wasn't written down. Adopting it makes
> "level 200" mean something without re-tuning anything the owner is happy with.

**What level 200 actually means, in one line:** **237,465 HP · 260 atk · 46 def** — a **3.6-minute**
solo fight for a ceiling player that deletes a careless one in **2.3 slams**.

| player | solo TTK | contact | slam (1.3×) | nova bolt (0.7×) |
|---|---|---|---|---|
| L20 (under-geared) | 5.7 min | 165 *(1.8 hits to die)* | 231 *(1.3)* | 99 |
| L22 (realistic) | 4.7 min | 149 *(2.4)* | 211 *(1.7)* | 86 |
| L25 (ceiling) | **3.6 min** | 134 *(3.2)* | 192 *(2.3)* | 75 |

**Party-size scaling (HP only, orthogonal to flat level).** "Flat level" is about *level not
chasing `partyLvl()`* — it says nothing about party *size*. Keeping a `partyN()` HP factor of
`1+(partyN()-1)*0.7` holds the fight at a consistent **2.8–3.6 min** for 1–4 players. Without it a
4-stack melts it in 54s. → **Open Question #4.**

**Minions @100 — genuinely "uber":** 18,233 HP (11s each for a ceiling player, 14s at L22), atk 145
(50 dmg/contact, 8.6 hits to die). **A wave of 3 = 54,699 HP = 23% of the boss's own HP** — a real
phase, not chaff. For scale: *one minion has ~2× the Drowned King's entire health bar.*

**Floor trash (a ramp into the fight):**

| floor | lvl | HP | atk | def | TTK each (L25) |
|---|---|---|---|---|---|
| 1 | 60 | 6,531 | 99 | 22 | ~3.6s |
| 2 | 75 | 9,598 | 116 | 25 | ~5.5s |
| 3 | 90 | 14,106 | 134 | 27 | ~8.2s |

**Make the level VISIBLE**, or none of this reads. Add a `Lv 200` tag to `drawEnemy`'s boss branch
(gated on `e.level && (e.isPinnacle||e.isCitadel)` so no existing enemy changes) — `e.level` is a
number, so it rides `packEnemy`/`packScalar` to MP clients for free.

---

## 1. The key / drop

### 1.1 ⚠ Read the ask carefully — "1%" is ambiguous

> *"And each drops unique gear with special bonuses when equipped, but they should be like 1% chance
> to drop."*

Two readings, and they are **not** compatible:

- **(A) The KEY is 1%** from pinnacle bosses (my caller's brief; matches *"dungeons that drop from
  pinnacle bosses"*).
- **(B) The UNIQUES are 1%** from the citadel boss ("each [dungeon] drops unique gear … at 1%").

**Do not ship both** — they multiply. 1% key × 1% unique = 1 in 10,000 boss kills ≈ **never**.
→ **Open Question #1.** Recommendation and math below.

### 1.2 The math the owner hasn't seen

`DAY_FRAMES = 21600` (:1562) ⇒ at 80Hz an in-game day is **4.5 real minutes**. `killEnemy` (:1527)
sets `pinnacleRespawnDay = curDay()+4`, and `maybeRespawnPinnacle` (:2123) then revives *both*
bosses ⇒ **2 kills per ~18 min ≈ 6.7 pinnacle kills/hour.**

| design | expected kills | **real hours of boss farming** |
|---|---|---|
| flat 1%, no pity | 100 | **~15 hours** |
| flat 1% key × 1% unique | 10,000 | ~1,500 hours *(never)* |
| **1% + pity (recommended)** | **~22** | **~3.3 hours** |

**A flat 1% with no pity is not acceptable.** It is a ~15-hour gate on *seeing the content once*,
and — worse — it is memoryless, so a player can be 40 kills deep with nothing and no reason to
believe the next one is closer. **Recommendation: keep the 1% *headline* and add bad-luck
protection.**

```js
// in dropPinnacleReward (:2104) — the ONE drop seam for pinnacle bosses
const pity = state.player._citPity | 0;                       // 0 on old saves
const chance = 0.01 + Math.max(0, pity - 10) * 0.04;          // 1% flat for 10 kills, then +4%/kill
if (Math.random() < chance) {
  state.player._citPity = 0;
  const o = findOpenTile(state.map, tx, ty);
  state.pickups.push(makePickup(o.tx, o.ty, 'sigil', 1));     // ← a PICKUP, not a bag write
  log('★ A CITADEL SIGIL falls from the corpse — black glass, still warm. Somewhere, a gate opens.', 'quest');
} else state.player._citPity = pity + 1;
```

Curve: 1% for kills 1–10 (the lucky-drop fantasy survives intact), then +4%/kill → **guaranteed by
kill 35**, expected ~22 (**~3.3 h**). Tunable; the shape is the point.

### 1.3 ⚠ Where the counters can safely live (kill-attribution trap)

`dropPinnacleReward` carries this comment (:2107) and it is load-bearing:

> *"a projectile kill swaps `state.player` to the shooter but NOT `state.inventory`, so a raw
> `equippedWeapon()` read could hit the wrong bag"*

So **inside `dropPinnacleReward`, `state.player` is always the killer but `state.inventory` may be
someone else's bag.** A naive `state.inventory.citadelKeys++` there would **credit the wrong
player** on every projectile kill. Hence:

| what | where | why it works | plumbing needed |
|---|---|---|---|
| **pity counter** | `state.player._citPity` | `state.player` **is** the shooter in `updateProjectiles` (:1544). Same seam `state.player.gold += g` already uses (:2104). | **1 line** in `snapshot()`'s player whitelist (:1250). `applySnapshot`'s `Object.assign(p, s.player)` restores it free. Rides `me` via `safeClone` — **no client adoption line** (ARCHITECTURE.md "u* flags" rule). |
| **the key** | a **pickup** → `state.inventory.citadelSigils` in `checkPickups` (:1550) | `checkPickups` runs inside the PP loop where `state.player` **and** `state.inventory` are both the collector's. No attribution problem at all. | **ZERO.** See below. |

**The key needs zero plumbing — this is the most important structural insight in the doc.**
`state.inventory` already rides the entire chain:

- **SP save** — `snapshot()` (:1250) does `inventory: JSON.parse(JSON.stringify(state.inventory))` — a *wholesale* stringify. ✔
- **SP load** — `applySnapshot` (:1251) does `state.inventory = s.inventory`. ✔
- **DB persist** — `characterOf` (world.js:454) stores `inventory: snap.inventory`. ✔
- **PP swap** — `S.inventory = p.inventory` runs in every phase already. ✔
- **MP wire** — `safeClone` (world.js:230) skips only `held/actions/input/dg/_shopStock/dodgeHits`; **`inventory` is not skipped**, so `me.inventory` rides every snapshot. ✔
- **Client adopt** — mp.html:944 already does `if (snap.me.inventory) S.inventory = snap.me.inventory;`. ✔
- **Old saves** — absent field → `undefined` → `|0` → 0. ✔

Cost: two integers inside an object that is already serialized. **Do not invent a PP_KEY for this.**

⚠ **Use a NEW pickup kind (`'sigil'`), never `'key'`.** `checkPickups`'s `kind==='key'` branch
(:1550) fires `state.flags.gotKey = true` + `state.quests.key.done = true` + the *"Now seek the
entrance to the south"* log — reusing it would silently complete the tutorial quest.

⚠ **MP fairness:** a ground pickup is first-to-grab. That is *consistent* — `dropPinnacleReward`
already drops the uniques as pickups (:2115) — but a 1% key sniped by a teammate is a different
emotional event from a sniped sword. → **Open Question #2.**

### 1.4 Consumption

Spent on **opening** the citadel gate (§2.2), not on entering an already-open one — mirroring
`_enterRift`'s `joining` rule exactly (world.js:403: `if (!joining) { p.inventory.keys--; … }`), so
teammates dive in free. **Only decrement after a *successful* build** — world.js:403 carries the
scar tissue: *"a failed breach no longer eats the key."*

---

## 2. Structure — 3 floors + a boss arena

### 2.1 ⚠ THE decision: extend the shared dungeon, do NOT build a parallel instance

**Constraint:** MP has **exactly one** dungeon instance. `this.sharedDg` (world.js:279) with
`WORLD_SLOTS` (:269) swapped by `grabWorld`/`putWorld` (:270–271). The rift system doesn't create a
second instance — `_maybeRift` (:341) *refuses to open while one exists* (`if (this.rift ||
this.sharedDg) return;`) and `_enterRift` (:369) just seeds `sharedDg` at a deeper floor.

**Verdict: reuse `sharedDg`.** Justification:

- **A parallel instance costs ~110 lines of the most fragile code in the room** — the dungeon phase
  (world.js:968–1073) is a `try { … } finally { putWorld(owBase) }` around per-player movement,
  action processing, enemy partitioning, warband stepping, projectiles and the downed pass.
  ARCHITECTURE.md: *"any new code path that swaps worlds must restore in a `finally`, or one throw
  strands the whole room in the dungeon."* Duplicating that doubles the blast radius of the single
  most dangerous invariant in the codebase, and `_snapshotFor`'s `inDg` (:1163) would become
  tri-state, touching every entity-source line.
- **Reuse buys the whole feature for free:** party-descend already moves everyone together
  (world.js:991–1004, keyed on `S.dungeonLevel !== lvl0`), enemy partitioning, warband delving,
  projectile cross-hits, `_downedPass`, `dgTiles` transactional resend, instance dissolve-on-empty
  (:1067) — **all unchanged.**
- **Cost: exclusivity.** While a Citadel run is live, nobody can start a normal delve or a rift.
  That limitation *already exists* between rifts and dungeons; the Citadel just joins the set.

**Price of admission — three guards, or a stranger teleports into your raid.** Today
`_runActions` (world.js:574) says: *if you press [E] on the dungeon entrance and `sharedDg` exists,
you JOIN it.* Uncorrected, **any player pressing [E] at the overworld dungeon door would be dropped
into a live Citadel with no key.** Add `this.dgKind` (`'dungeon' | 'citadel'`) on `World`:

1. **world.js:574** (`if (!inDungeon && S.map === 'dungeon')`) — if `this.dgKind === 'citadel'`,
   undo the entry (the `owBase`/`compPos` restore path at :573 is the template) and log *"The way
   below is sealed while the Citadel stands open."*
2. **world.js:373** (`_enterRift`'s `joining = !!this.sharedDg`) — refuse to join a citadel via a rift.
3. **world.js:1067–1068** — clear `dgKind` wherever `sharedDg` is nulled (both sites: :1068 and :1073).

### 2.2 Entry: a fixed world gate (cheapest correct option)

Add `T.CITADEL_GATE` to the tile enum and place it at worldgen at a fixed frontier coordinate (the
`pinnacleLair` :2096 idiom — fixed coords, no RNG). Then extend `tryInteract`'s existing
overworld tile scan (:1456, the `T.DUNGEON_ENTRANCE` branch) with a `T.CITADEL_GATE` branch →
`tryEnterCitadel()`.

**Why a tile beats every alternative: it costs ZERO bytes/tick.** `mapPayload()` (world.js:1236)
ships the entire overworld grid **once, at join**. No snapshot field, no version gate, no client
adoption, no expiry timer, no new render path beyond a tile sprite.

*Alternatives considered:* an ephemeral portal at the boss's death site (thematically ideal, but
needs the rift's whole wire+client shape *and* forces you to dive immediately — hostile for a
1%-drop key you want to save); overloading `this.rift` with a `citadel` flag (economical but
inherits the 30s expiry and `_maybeRift`'s RNG clobbering).

### 2.3 Floors: a new generator, sharing the fixtures

`setupDungeonFloor` (:1222) is ~25 lines of *"roll a floor mod, spawn `4+level` enemies, add
elites, place a boss, scatter pickups"* — none of which the Citadel wants. **Write
`setupCitadelFloor(n)` as a sibling**, reusing `generateDungeon`'s fixtures rather than branching a
flag through the existing function (which would make every `if (state.citadel)` a live grenade in
the normal delve path).

```js
const CITADEL_LVLS = [0, 60, 75, 90, 200];   // index by floor: 1→60, 2→75, 3→90, 4→the boss

function setupCitadelFloor(n) {
  state.dungeonThemeData = CITADEL_THEME;    // custom theme obj; in WORLD_SLOTS already → snap.dgTheme ✔
  state.floorMod = null;                     // ⚠ no floor mods: 'swarming' would spawn 25 lvl-90 elites
  const { W, H } = generateCitadel(n);       // n<4: normal-ish + D_DESCEND · n===4: ONE BIG ROOM, no stairs
  …
}
```

- **The boss room is guaranteed structurally, not by chance** — `generateCitadel(4)` branches on
  `n === 4`: no obstacle loop, no `D_DESCEND`, no `D_EXIT`, no vault; place `makeCitadelBoss()` at
  centre. There is no RNG to fail. (`generateDungeon` :905 always places `D_DESCEND` at bottom-right
  and `D_EXIT` only on `(level-1)%3===0` — the Citadel wants neither on floor 4.)
- **The arena fits.** `generateDungeon`'s `W=22,H=18` at `TILE=32` = 704×576 px. `PIN_ARENA_START =
  360` (:2078) covers most of it and shrinks to `PIN_ARENA_MIN = 100` — the existing hazard tuning
  works unmodified.
- **`PIN_LEASH = 980` never triggers** in a 704×576 room, so `pinnacleHazard`'s wander-home branch
  (:2120) is dead code here. Harmless, but don't rely on it.
- ⚠ **No floor mods.** `rollFloorMod` (:1221) `'swarming'` multiplies the roster ×1.6 and
  `'cursed'` gives +35% HP / +30% atk. At level 90 that is a wipe generator. Force `null`.

### 2.4 Descent

**Reuse `state.dungeonLevel` (1→4), not a new depth counter.** The MP party-descend at world.js:991
keys on `S.dungeonLevel !== lvl0` — reusing it makes *"the whole delving party goes down together"*
work with zero server changes. Add a scalar discriminator `state.citadel` (0/1) and branch
`descend()` (:1460):

```js
function descend(){
  if (state.citadel) {
    if (state.dungeonLevel >= 4) return;                 // no stairs exist on 4 anyway — belt & braces
    state.dungeonLevel++;
    setupCitadelFloor(state.dungeonLevel);
    Sound.descend();
    log(state.dungeonLevel === 4
      ? 'The stair ends. Ahead: a drowned hall, and something that has been waiting.'
      : `You descend into the Citadel — tier ${state.dungeonLevel}.`, 'lore');
    updateHUD(); return;
  }
  …existing body unchanged…
}
```

> ### ⚠⚠ `state.citadel` MUST be added to `WORLD_SLOTS` (world.js:269)
> This is the single most important server-side line in the spec. `WORLD_SLOTS` is the list of
> singleton `state` fields that **differ between the overworld and the dungeon** and get stashed and
> restored around every dungeon player. Miss it and `state.citadel` **leaks across the world swap** —
> the overworld thinks it's a citadel, or the flag vanishes mid-run.
>
> **Precedent that this is a real failure mode: `state.vault` is missing from `WORLD_SLOTS` today.**
> `generateDungeon` (:913) sets `state.vault`, yet `WORLD_SLOTS` (world.js:269) lists only
> `map, enemies, pickups, npcs, projectiles, dungeonLevel, dungeonEntrance, dungeonThemeData, floorMod`
> — no `vault`. (world.js mentions "vault" three times; all three are *comments* about key-vaults, never
> the slot list.) So the vault flag leaks across every world swap today. It is benign only because
> `openKeyVault` (:1459) re-checks the door *tile* before acting. Don't rely on that luck twice.

`state.maxDepth`/`bountyProgress('depth')` in `descend()` are harmless — any player with a Citadel
Sigil has `maxDepth` ≫ 4, so `Delver's Insight` grants nothing. Verify, don't assume.

### 2.5 Death / leave — what already happens

Nothing new needed; the existing rules are coherent:

- **A single death is not a wipe.** `gameOver()` is rewrapped to `__onGameOver` (load-game.js:160) →
  `goDown`/`_downedPass` (world.js:175) → teammates can revive you.
- **Bleeding out** (`BLEED_FRAMES` expires) → `respawnAt` (world.js:~183): **lose half your gold**,
  respawn at town, `p.map = 'overworld'`, and your warband is force-surfaced.
- **The instance dissolves when the last delver leaves** (world.js:1067) — so a **full wipe burns
  the Sigil**, because it was spent on opening.

**That default is harsh for a ~3-hour key.** Softeners (owner's call → **Open Question #3**):
consume the Sigil only on reaching floor 4; refund on a wipe; or let the gate stay open for N
in-game days after a wipe.

---

## 3. The boss — The Drowned Archivist, level 200

*(Name is a placeholder — matches the `PINNACLE_BOSSES` naming voice.)*

### 3.1 Generator

Table-plus-generator, mirroring `PINNACLE_BOSSES` (:2092) / `makePinnacleBoss` (:2097) — but
**flat**: no `partyLvl()` term anywhere.

```js
const CITADEL_BOSS = { key:'archivist', name:'The Drowned Archivist', color:'#7fe0d0', level:200,
  stances:['blade','storm','grave'], where:'the Sunken Citadel' };

function makeCitadelBoss(tx, ty) {
  const e = makeBoss(tx, ty);                    // inherits isBoss ⇒ updateBoss AI (:1811), aggro 640, tele/dash slots
  e.isCitadel = true; e.citKey = 'archivist'; e.name = CITADEL_BOSS.name; e.color = CITADEL_BOSS.color;
  e.w = 62; e.h = 62; e.x = tx*TILE - 15; e.y = ty*TILE - 15;
  e.level = 200;                                 // now MEANINGFUL (§0.4) and drawn (§0.4)
  const L = 200, pnh = 1 + (partyN()-1)*0.7, asc = 1 + (state.ascension||0)*0.2, cyc = state.citadelCycle||0;
  e.maxHp = Math.round(LVL_HP(L) * pnh * asc * (1 + cyc*0.4));   // NO partyLvl term — flat by design
  e.hp = e.maxHp;
  e.atk = Math.round(LVL_ATK(L) * asc * (1 + cyc*0.15));         // atk stays gentle (§0.3)
  e.def = LVL_DEF(L);                                            // 46 — off the cliff (§0.2)
  e.xp = 24000; e.gold = 18000; e.cycle = cyc;
  e._lairTx = tx; e._lairTy = ty; e.arenaR = PIN_ARENA_START; e._nextKill = 0; e._hazT = 0;
  e.phase = 1; e.stance = 'blade'; e._stanceT = 0; e._leapN = 0; e._enrage = 0;   // ALL SCALARS
  e.caster = true; e.castCd = 100; e.specialCd = 120; e.specials = STANCE_SPECIALS.blade;
  return e;
}
```

> **⚠ Every field above is a scalar** (`packScalar` world.js:201 keeps `number|string|boolean|null`
> and **drops arrays and objects**). `e.specials` is an array — but note it is *already* an array on
> every boss today (`makeBoss` :932) and is *already* dropped on the wire; the client never reads it,
> the server-authoritative AI does. That is fine and intentional. **Do not add a
> `e.phaseData = {…}` object or an `e.activeAdds = []`** — they will silently vanish client-side.
> The one object ref, `_pinRef` on adds, is deliberately never serialized (ARCHITECTURE.md).

### 3.2 "Lots of fighting styles" — STANCES

`e.stance` is a **string scalar** that swaps `e.specials` (the existing `updateBoss` :1811 picks
uniformly at random from `e.specials`, so re-pointing the array *is* the whole mechanic — no AI
rewrite):

| stance | tell | specials | identity |
|---|---|---|---|
| **blade** | body flares white, `Sound.swing` | `['charge','leap','slam']` | melee pressure — chases, closes, punishes |
| **storm** | body flares cyan, rising tone | `['nova','castvolley','leap']` | ranged zoning — fills the room with bolts |
| **grave** | body dims, low drone | `['raisecourt','pullunder','slam']` | adds + control |

Rotate every ~14s (`e._stanceT` counts down in `updateBoss`'s citadel branch) **and** on every phase
change. `e.stance` and `e.color` both ride `packEnemy` → the client re-tints for free.

### 3.3 Phases (thresholds on `e.hp/e.maxHp` — no new state)

| phase | HP | what changes | tell |
|---|---|---|---|
| **1** | 100–66% | one stance at a time; `specialCd` 120 | — |
| **2** | 66–33% | stance rotates 2× faster; **one wave of 3 lvl-100 minions**; `arenaR` shrink rate ×2 | screen shake + `★` feed line |
| **3** | 33–0% | `_enrage=1`: `specialCd` ×0.6, leaps double-hop, **second minion wave**; arena at `PIN_ARENA_MIN` | boss reddens, sustained low drone |

Phase transition is a cheap check at the top of the citadel branch of `updateBoss`:
`const ph = e.hp > e.maxHp*0.66 ? 1 : (e.hp > e.maxHp*0.33 ? 2 : 3); if (ph !== e.phase) { … }`.

### 3.4 "Jump around" — the LEAP (⚠ genuinely new; there is no blink precedent)

`grep -i blink|teleport|warp` over the game file returns **nothing** but one unrelated comment. The
closest existing thing is `e.dash` (the `charge` special, `execBossSpecial` :1804) — which is a
*slide*, not a jump. So `leap` is new code:

```js
// startBossSpecial (:1803): add the windup. The tele object ALREADY carries aimX/aimY/radius.
const wind = {slam:46, charge:32, nova:34, summon:40, pullunder:48, raiseadds:44, leap:40, castvolley:30, raisecourt:44}[name] || 36;

// execBossSpecial (:1804): land it.
else if (name === 'leap') {
  const ax = e.tele ? e.tele.aimX : pcx, ay = e.tele ? e.tele.aimY : pcy;
  const o = findOpenTile(state.map, Math.floor(ax/TILE), Math.floor(ay/TILE));   // ⚠ never teleport into a wall
  e.x = o.tx*TILE - (e.w-TILE)/2; e.y = o.ty*TILE - (e.h-TILE)/2;
  const R = e.tele ? e.tele.radius : 150, cx2 = e.x+e.w/2, cy2 = e.y+e.h/2;
  addShake(14); spawnRing(cx2, cy2, e.color); Sound.tone(60,0.5,'sawtooth',0.28,{slideTo:34});
  const n = 14; for (let k = 0; k < n; k++) {                                    // ⚠ radial burst = PROJECTILES (see below)
    const a = k/n*6.28;
    addProjectile(cx2, cy2, Math.cos(a)*3.2, Math.sin(a)*3.2, Math.round(e.atk*0.6),
      { color:e.color, r:8, life:200, element:'frost', ownerRef:e });
  }
  if (e._enrage && !e._leapN) { e._leapN = 1; startBossSpecial(e, 'leap', pcx, pcy); }   // phase 3: double-hop
  else e._leapN = 0;
}
```

> ### ⚠⚠ TWO SILENT FAILURES EVERY NEW SPECIAL WILL HIT
>
> **1. The telegraph render is a hardcoded `if/else if` chain on `e.tele.name`** (`drawEnemy`,
> :1977–1983 — branches for `slam`/`charge`/`nova`/`summon`/`pullunder`/`raiseadds` **only**). A new
> name renders **nothing** — an invisible telegraph on a boss that one-shots you. **Every new special
> needs a matching draw branch.** Note every existing telegraph draws at the *enemy's* centre
> (`cx = sx+e.w/2`); the leap is the first to need its marker at the **aim point**:
> `e.tele.aimX - state.camera.x`. That is new drawing code, not a copy.
>
> **2. `playerTakeDamage` only ever hits ONE player in MP.** `execBossSpecial`'s `slam` branch
> (:1805) calls `playerTakeDamage` directly — during partitioned combat that is *only* the bucketed
> duelist. This is precisely why `pullunder` was built projectile-based, per its own comment (:2121):
> *"projectile-based so Stage C lands it on ALL players."* **Every party-wide Citadel mechanic must be
> projectiles**, which reach everyone via the dungeon phase's cross-hit loop (world.js:1046–1063).

### 3.5 "Uber minions" — reuse the ordered-kill court verbatim

`makeCitadelAdd(pin, tx, ty, idx)` mirrors `makePinnacleAdd` (:2100) with level-100 stats, and sets
the **same three fields**: `e._orderIdx = idx`, `e._pinRef = pin`, `e._rezN = 0`.

**That is the entire integration.** `killEnemy`'s ordered-kill resurrect (:1527, *before* the splice)
is keyed purely on `_pinRef`/`_orderIdx`/`_rezN` — it is boss-agnostic. Kill them out of order and
they rise (capped at 3), gated on `_pinRef.hp>0` so a dead boss's court dies clean. **No new code.**

At 18,233 HP each (11s of focused DPS), an out-of-order kill costing a full resurrect is a
*brutal* mistake — exactly the intent.

⚠ `rollEliteAffixes` (:1848) refuses `isBoss` but **not** a bare `isCitadel` add. Adds are made via
`makeEnemy` and never passed to `makeElite`, so they stay affix-free by construction — but if you
ever route them through `makeElite`, pass `rollEliteAffixes(e, 0)` to suppress, or a Warded lvl-100
minion becomes immune-locked.

### 3.6 Arena hazard — ⚠ the party-wide pass does NOT cover dungeons

`pinnacleHazard` (:2118) works as-is (shrink + out-of-ring damage on the acting player). But the
**party-wide** pass that menaces *everyone else* is gated (world.js:947):

```js
if (players.length > 1 && G.playerTakeDamage && S.map === 'overworld' && S.time % 42 === 0) {
```

**`S.map === 'overworld'` — and it runs outside the dungeon phase, where `S` holds the shared
overworld.** A Citadel boss inside `sharedDg` gets **no party-wide hazard**: only the duelist is
threatened, everyone else stands in the dark for free. **Replicate the pass inside the dungeon
phase** (world.js, inside the `if (stillIn.length)` block at :1011, after `updateEnemies`), iterating
`stillIn` instead of `players`. Keep its two hard-won properties: **defer the filter-allocation until
a boss is actually found** (:949), and **only READ `arenaR`, never shrink it** (:946) — the
partition's `pinnacleHazard` owns the shrink.

Gate the draw and the drive on `(e.isPinnacle || e.isCitadel)` at all four sites:
`drawEnemy`'s ring (:1984), `updateBoss`'s hazard call (:1812), world.js's wander-home (:110), and
the new dungeon-phase pass.

---

## 4. The uniques — 5 build-changing relics

### 4.1 The iron rule (v2.56.0, ARCHITECTURE.md)

> *"Unique build-effects are **recalcStats-derived player flags, never gear-reads in combat**."*

Because the MP combat partition does not always swap `S.inventory`, an `equippedWeapon()` read
inside `updateEnemies`/`updateProjectiles` can hit **the wrong player's bag**. Every effect is
therefore a scalar set in `recalcStats` (:1289, alongside `p.uLance`/`p.uFrostNova`/`p.uBell`/
`p.uCloak`), which rides `me` via `safeClone` with **no client adoption line**.

```js
// recalcStats (:1289), extending the existing u* block — cleared when broken, matching affix gating
p.uEdge   = !!(w && w.uniq === 'sunderking'  && !isBroken(w));
p.uQuiver = !!(w && w.uniq === 'hundredfold' && !isBroken(w));
p.uCoil   = !!(w && w.uniq === 'chainbreaker'&& !isBroken(w));
p.uAegis  = !!(a && a.uniq === 'namelessaegis'&& !isBroken(a));
p.uLocket = !!(a && a.uniq === 'emberheart'  && !isBroken(a));
```

### 4.2 The relics

Added to `UNIQUES` (:2083); `makeUnique` (:2089) builds them at legendary tier with **no changes**.

| key | slot / style | effect | flag | hook — *one* existing seam |
|---|---|---|---|---|
| **Sunderking's Edge** | weapon / melee | At 5 Momentum your **riposte window never closes** — every hit is a guaranteed crit. Bleed a pip and it shuts. | `p.uEdge` | `updateStyleResources` — `if (p.uEdge && p.momentum >= 5) p.riposteT = Math.max(p.riposteT, 2);`. `meleeSwing` (:1524) already consumes `riposteT` as a crit. **Zero new damage path.** |
| **The Hundredfold Quiver** | weapon / ranged | A Marked target's death transfers **all** its Marks to the nearest foe (not one) **and** refunds your attack cooldown. | `p.uQuiver` | `killEnemy`'s Quarry kill-chain block (:1535) — the early branch sets `nn._markN = Math.min(3,(nn._markN||0)+1)`; under the flag carry `e._markN` across and set `_mk.attackCooldown = 0`. Turns kill-chaining into a real ranged engine. |
| **Chainbreaker Coil** | weapon / magic | Your Heat **never decays below the aura threshold** (40), and aura strikes **chain to 2 extra foes**. | `p.uCoil` | `updateStyleResources` / `updateHeatAura` (ARCHITECTURE.md "Style-identity resources"). Damage still routes through the one `afxHit` + `applyElementOnHit` gate. ⚠ The chain must reuse the **existing gated-then-throttled** `_auraCd` scan — don't add a second per-frame scan. |
| **Aegis of the Nameless** | armor / universal | A blow that would kill you leaves you at **1 HP** instead. Once per floor. | `p.uAegis` + `p._aegisT` | `playerTakeDamage` (:1542), immediately before `if (p.hp <= 0){ … gameOver(); }`. Sits *above* the `__onGameOver` rewrap (load-game.js:160), so it works identically in SP death and MP downed. Reset `p._aegisT = 0` in `setupCitadelFloor`. |
| **Emberheart Locket** | armor / universal | Each kill grants **+25% damage for ~2s, stacking to 3** (+75%). | `p.uLocket` + `p._surgeT`/`p._surgeN` | `killEnemy` (:1535) bumps the scalars; **`playerDmgMul()` (:1498) reads them** — literally *"the one damage multiplier"* that Momentum already folds into. Decay in `updateStyleResources`. Perfect fit for the no-parallel-paths rule. |

All are scalars on `state.player` ⇒ they ride `me` ⇒ **no snapshot changes, no client adoption, no
PP_KEYS.** `applySnapshot` (:1251) must zero the transients (`_aegisT`, `_surgeT`, `_surgeN`)
alongside the existing `p.cloaked=false; p._stillT=0;` line, so old saves default off.

### 4.3 Drop rules (assuming §1 Option A — the *key* is the 1%)

Mirror `dropPinnacleReward` (:2104) exactly:

- **First clear** guarantees the relic matching your `_lastStyle`. ⚠ **Read `state.player._lastStyle`
  (which rides `me`), never a raw `equippedWeapon()`** — the trap documented at :2107. Universal
  relics (Aegis/Locket) suit any style, so a summoner-style killer falls back to those.
- **Re-clears** roll the full 5-relic pool + a cycle super-loot legendary.
- `checkPickups` (:1550) already records `uniquesFound` off `it.weapon.uniq`/`it.armor.uniq` — so
  the **Trophy Wall lights up for free** (`resolveInteract('trophy')`, world.js:692).
- Log with `★` so `FEED_BROADCAST` (world.js:56, matches `★`/`vanquished`/`falls!`) broadcasts the
  server-first kill to everyone.

---

## 5. MP correctness checklist

| concern | verdict |
|---|---|
| **Instancing** | **Party-shared**, via `sharedDg`. Not per-player — the room supports exactly one instance (§2.1). |
| **New PP_KEYS** | **None.** The Sigil lives in `state.inventory` (already swapped/persisted/wired); the pity counter on `state.player` (already `safeClone`'d into `me`). §1.3. |
| **New snapshot fields** | **One optional scalar**, `snap.citadel`, attached beside the existing `snap.dgLevel`/`dgTheme`/`floorMod` in the `if (inDg)` block (world.js:1191). ~15 B, only while delving, mirrors an existing pattern. **Not** version-gated because it isn't shared world state and it's tiny — contrast the Legion roster (~991 B), which ungated would cost ~64 KB/s/player. |
| **Edge-triggered payloads** | **None added — deliberately.** ARCHITECTURE.md: *"A one-shot payload must be consumed in `ws.onmessage`, NOT in reconcile"* — `client/mp.html` keeps only the newest snapshot (`snap = m.snap`, :462) and reconciles in the **frame loop**, which a backgrounded tab throttles to ~1 Hz, so most snapshots are overwritten before a frame sees them. If a "Citadel opened!" one-shot is ever added, it goes in `ws.onmessage` beside `adoptLegion`/`adoptFeed`/`adoptQuests` (:461) — **never** in reconcile. The existing `dgTiles` transactional resend (:1225–1231) already covers the Citadel's map switches. |
| **Client adoption** | **One line**, if `snap.citadel` ships: `S.citadel = snap.citadel \|\| 0;` beside mp.html:953. Per-player fields on `me` need **no** line (the `u*` flag rule); `state.X` fields **always** do — *"LESSON (bit us twice)."* |
| **`WORLD_SLOTS`** | ⚠ **`state.citadel` MUST be added** (world.js:269). See §2.4. |
| **`CAPTURE`** (load-game.js:111) | Add: `setupCitadelFloor`, `makeCitadelBoss`, `CITADEL_BOSS`, `tryEnterCitadel`. ⚠ **A missing capture no-ops SILENTLY** behind `G.fn && G.fn()`. `G.__missingCaptures` warns at boot — read it. |
| **`NAMES`** (mp.html:89) | Add anything the client must call. If the Citadel adds no new client-invoked fn, add nothing — but **check the boot audit** (:99) after every stage. |
| **`RPC_OK`** (world.js:245) | **No new entry.** Entry is `[E]` → `tryInteract` → an existing action, not a menu RPC. |
| **⚠ Warband in the instance** | **The highest-risk neighbor.** Companions-following-into-instances has broken repeatedly: the `compPos` save/restore dance appears **four** times (world.js:569, 984, 992–1001, 1077) because `setupCompanions()` inside `enterDungeon`/`descend` **teleports every shared companion to the acting player**. `setupCitadelFloor` must either call `setupCompanions()` and be wrapped in the same compPos dance, or not call it at all. The safety sweep at :1077 (force-surface stragglers when `sharedDg` is null) is the backstop — **test it**. |
| **Rift overlap** | `_maybeRift` (:343) already early-outs on `this.sharedDg`. ✔ But `_enterRift`'s `joining` (:373) must refuse a citadel (§2.1 guard 2). |
| **Save compat** | All new fields absent on old saves → `|0` / `||0` → off. `snapshot()` (:1250) needs **one** new key (`_citPity` in the player whitelist) plus `citadelCycle`/`citadelSlain` if §6 Stage 4 ships. Bump `snapshot()`'s `v:5` only if a *migration* is needed — additive fields don't need one. |
| **Perf** | The floor is ~14 enemies vs the current `4+level`. Boss scans are kill-rate, not frame-rate. Check `GET /health` (tick EMA/max vs the ~12.5 ms @80Hz budget) with 4 players + a full minion wave. |
| **Version** | ⚠ Bump `GAME_VERSION` (:619) on **every** game change. Ship `eldermyr-rpg.html` to **both** branches; `server/`+`client/` stay on `multiplayer`. |

---

## 6. Staged build order

Each stage is independently shippable and verifiable — the v2.56.0 pinnacle bosses were built this
way and it worked. `node server/world.js` (the 1200-tick self-test) **must stay green after every
stage**. Run `git diff --stat` after every delegated agent.

### Stage 1 — `v2.57.0` · The curve + the Sigil *(no new content; highest risk of neighbor damage)*
Add `LVL_HP/LVL_ATK/LVL_DEF`. Retarget `makeWildDragon` (:2058) → flat 30 and `makePinnacleBoss`
(:2097) → flat 75 through the new curve. Draw `Lv N` on pinnacle/citadel bosses. Add the `'sigil'`
pickup kind + `_citPity` + the drop roll in `dropPinnacleReward`.
- **Accept:** headless — `makeWildDragon().maxHp` ≈ 3,024 and `makePinnacleBoss(PINNACLE_BOSSES[0],…).maxHp`
  ≈ 9,598×(party/asc factors); neither reads `partyLvl()`. Kill a pinnacle boss 200× headlessly →
  Sigil count ≈ 5–9, **never 0 past 35 kills**, and `_citPity` resets on drop. Load a pre-v2.57 save →
  `_citPity` is 0, no crash. `node server/world.js` green.
- **⚠ Breaks neighbors:** this *re-tunes two shipped bosses.* Get the owner's eyes on the Emberwyrm
  (3,700→3,024 HP) and the Drowned King before proceeding.

### Stage 2 — `v2.58.0` · The Citadel shell *(3 floors, no boss)*
`T.CITADEL_GATE` + worldgen placement + `tryEnterCitadel`. `state.citadel` **→ `WORLD_SLOTS`**.
`generateCitadel`/`setupCitadelFloor` for floors 1–3, `descend()` branch, floor 4 = an empty big
room. The three `dgKind` guards (§2.1). CAPTURE entries.
- **Accept:** headless — open with a Sigil (count decrements **once**, only on success); descend 1→2→3→4;
  floor 4 has no `D_DESCEND`/`D_EXIT`/vault; `state.floorMod` is null on every floor. **Two-player
  test:** B [E]s the normal dungeon door while A is inside → B is **refused**, not teleported in;
  `_maybeRift` opens nothing. Exit → `state.citadel` is 0 **on the overworld** (the `WORLD_SLOTS`
  proof). Warband follows A down and surfaces with A. `node server/world.js` green.

### Stage 3 — `v2.59.0` · The Archivist *(the fight)*
`CITADEL_BOSS` + `makeCitadelBoss` + `makeCitadelAdd`. Stances, phases, `leap`, `castvolley`,
`raisecourt`. **The new `drawEnemy` telegraph branches.** `(e.isPinnacle||e.isCitadel)` at all four
gates. The dungeon-phase party-wide hazard pass.
- **Accept:** headless — boss spawns at 237,465×factors HP / atk 260 / def 46; drive 20k ticks: it
  changes stance, all three phases fire, adds spawn and **resurrect out of order** (`_rezN` caps at 3),
  a leap never lands in a wall (assert `canMoveTo` post-leap), `arenaR` shrinks to `PIN_ARENA_MIN`.
  **`JSON.stringify(packEnemy(boss))` contains `phase`/`stance`/`arenaR`/`level` and NO object field.**
  Four-player headless: the leap burst damages **≥2** players (the projectile proof); an out-of-ring
  non-duelist takes hazard damage (the §3.6 gap-fix proof). Measure TTK vs a scripted 1,550-DPS dummy →
  **within 3–4 min**. `/health` tick max under budget with a full wave.

### Stage 4 — `v2.60.0` · The relics + the cycle
`UNIQUES` entries, `recalcStats` flags, the five hooks, `dropCitadelReward`, `citadelSlain`/
`citadelCycle`, the Trophy Wall rows, the `★` broadcast.
- **Accept:** headless — equip each relic → the flag flips; break it → clears. First clear drops the
  `_lastStyle`-matched relic; a **projectile** kill credits the shooter (the :2107 trap). Re-clear rolls
  the pool. `uniquesFound` grows → Trophy Wall shows them. Save→load→`recalcStats` re-derives every flag
  and zeroes `_aegisT`/`_surgeT`/`_surgeN`. **Live two-browser test** (not just headless — this is how
  the Legion roster fix passed every headless check and failed live): the feed broadcasts the kill to
  the other client.

---

## 7. Open questions — owner's call, not mine

1. **⚠ What is the 1% on — the KEY or the UNIQUES?** (§1.1) They multiply to *never* if both. **My
   recommendation: the KEY**, with pity; then make the relics generous (first clear guaranteed).
   Reason: the key is already a ~3-hour gate; double-gating is a 1,500-hour gate.
2. **⚠ Is a flat 1% with no pity acceptable?** (§1.2) **My recommendation: NO — add pity.** Flat 1% =
   **~15 hours** of pinnacle farming to see the content *once*, and it's memoryless, so a 40-kill dry
   streak feels identical to the first kill. 1% headline + a floor at kill 35 keeps the fantasy and
   bounds the misery to ~3.3 h.
3. **Does the Sigil burn on a wipe?** (§2.5) The *default* (spend on open + instance dissolves on the
   last death) says **yes**. Harsh for a 3-hour key. Alternatives: spend only on reaching floor 4;
   refund on wipe; gate stays open N days.
4. **Flat level — does HP still scale with party SIZE?** (§0.4) "Flat" plainly means *level doesn't
   chase `partyLvl()`*. Party *size* is orthogonal. **My recommendation: keep `1+(partyN()-1)*0.7`**
   → a steady 2.8–3.6 min for 1–4 players; without it a 4-stack melts it in 54s.
5. **Is a ~3.6-minute solo fight the right "extremely difficult"?** Long fights + a 2.3-slam death =
   punishing *re-runs*. Shorter+deadlier (150k HP) or longer+more mechanical (400k) are both one
   constant away.
6. **MP: should a teammate be able to grab your 1% Sigil?** (§1.3) Ground pickups are first-to-grab,
   consistent with the existing unique drops. Direct-to-killer is a small change and a big feelings
   difference.
7. **Is Citadel-blocks-everything acceptable?** (§2.1) While a run is live, nobody else can delve or
   rift. Correct for a small room; a real cost on a busy server.
8. **`Aegis of the Nameless` cheat-death in MP** — does it also skip the downed state (a true save), or
   only prevent the killing blow? Interacts with `goDown`/revive.
9. **Where is the Citadel Gate?** (§2.2) I'd put it in the deep frontier (high `distFactor`, per the
   ring design) — but it's a world-feel call.
10. **Does the Emberwyrm losing ~18% HP (3,700→3,024) at flat 30 bother you?** (§6 Stage 1) The
    alternative is a bespoke constant that breaks the one-curve rule.

---

## 8. Files this arc touches

| file | what | branch |
|---|---|---|
| `eldermyr-rpg.html` | the curve, generators, `setupCitadelFloor`, boss + specials + telegraph draws, uniques, `recalcStats` flags, `snapshot`/`applySnapshot`, `GAME_VERSION` (:619) | **both** (`main` SP + `multiplayer` MP) |
| `server/world.js` | `WORLD_SLOTS`+`state.citadel`, `dgKind` + 3 guards, dungeon-phase hazard pass, `snap.citadel` | `multiplayer` |
| `server-spike/load-game.js` | `CAPTURE` entries (:111) | `multiplayer` |
| `client/mp.html` | `NAMES` (:89) if needed; one `S.citadel` adopt line | `multiplayer` |
| `ARCHITECTURE.md` | ⚠ **update the invariants this changes**: `WORLD_SLOTS` gains a member; the party-wide hazard is no longer overworld-only; the telegraph-draw chain is a documented extension point | `multiplayer` |
| `DESIGN-endgame.md` | note that the Depth Tyrant (planned for "dungeon depth 15+ / deep rifts") now **overlaps this feature** — reconcile or drop it | both |
