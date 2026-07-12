# Eldermyr Endgame Design — Style Identity, Pinnacle Bosses, Endless Depth

*Design doc for the v2.53–v2.56 arc. Goal: each combat style plays like its own game,
high-level fighting has real decision depth, and the multiplayer open world stays
worth logging into indefinitely. Nothing here is generic filler — every system below
reuses or deepens something the game already has.*

---

## Pillar 1 — Style identity: three fighting styles, not three weapon skins

Today melee/ranged/magic differ in stats, perks, and abilities, but moment-to-moment
play converges on the same loop (kite → hit → dodge). Each style gets a **core
mechanic** — a resource loop only it has, visible as HUD pips, that skilled play
feeds and careless play drains. All state lives on the player (MP-safe per the
ARCHITECTURE.md per-player checklist); all logic runs in game combat functions
(server-authoritative for free).

### Melee — MOMENTUM (aggression is defense)
- Landing hits builds Momentum (max 5 pips). Each pip: small +damage, +move speed.
- Getting hit drops 2 pips. Standing passive decays 1 pip / few seconds.
- At full Momentum the dodge-roll becomes a **dash-strike** (existing capstone talent
  gets folded in and deepened).
- **Perfect dodge** (i-frame through an attack in the last ~150ms) keeps all pips and
  opens a 2s **riposte window**: next hit is a guaranteed crit.
- Depth: uptime management, dodge timing, when to disengage without bleeding pips.

### Ranged — QUARRY MARKS (target discipline and kill-chaining)
- Consecutive hits on the same target stack **Marks** (max 3); marked targets take
  bonus damage *from you*.
- Killing a marked target transfers one Mark to the nearest foe — kill-chains reward
  planned target order across a pack.
- Distance play: shots from beyond ~8 tiles gain **Deadeye** (+crit); point-blank
  shots knock *you* back a step (spacing is the skill).
- Depth: pre-marking a pack, choosing chain order, holding distance under pressure.

### Magic — HEAT (cadence and risk management)
- Casting builds **Heat** (0–100). High Heat amplifies the weapon's elemental
  side-effects (bigger burn spread, deeper chill, chain shock).
- At 100 you **Overload**: brief self-silence + small self-damage — unless you
  **Vent** first (channel ~0.6s, converts current Heat into an elemental nova around
  you, scaled by Heat spent).
- v2.52's pattern weapons interact: multi-bolt weapons build Heat faster — the fan
  staff is a Heat engine, the pierce lance a Heat sipper.
- Depth: ride the redline, vent at the right moment in the right position.

**Implementation shape:** ~3 small per-player fields per style + hooks in
tryAttack/castSpell/playerTakeDamage/doDodge + one HUD pip row. Server inherits via
the loader; client shows pips from `me.*`.

---

## Pillar 2 — Pinnacle bosses & chase uniques (the reason to go somewhere)

Rules: opt-in and clearly lethal; mechanics over HP sponges (telegraphs, phases,
adds, arena hazards — all existing tech); party-scaled via partyLvl/_partyN; each
boss guards a **drop pool of 2 named uniques — one style-specific, one universal**.
First kill guarantees the unique matching your style; re-kills (cycle system, v2.52)
roll the pool. Every unique has ONE visible build-changing effect (hasPerk-style
flag read in combat code), never a stat stick.

| Boss | Where / gate | Fight identity | Style unique | Universal unique |
|---|---|---|---|---|
| **The Drowned King** | Shipwreck isle, Sundered Sea (boat) | Pull-under telegraphs, drowning adds, shrinking dry ground | **Leviathan Spine** (ranged): 3rd hit on a Marked target fires a free water lance | **Tidecaller's Aegis**: perfect-dodge releases a frost nova |
| **The Pale Shepherd** | Frozen Wastes, night only | Frozen adds must die in order or resurrect; lantern light shrinks | **Shepherd's Bell** (summoner/magic): +1 thrall cap, thralls detonate on expiry | **Gravewool Cloak**: standing still 1.5s cloaks you until you act |
| **Ashen Colossus** | Emberwaste arena | Floor progressively ignites (fire-spread), slam telegraphs, enrage timer | **Cinderheart** (melee): below 40% HP attacks cleave in fire; Momentum decays slower | **Magmaplate**: immune to burning ground; leave burning footprints |
| **Depth Tyrant** | Dungeon depth 15+ (deep rifts) | Anti-turtle: arena shrinks per phase, void zones chase campers | **Voidpiercer Crown** (magic): Vent nova pulls enemies in before detonating | **Voidmantle**: dash leaves a damaging rift-trail |

**Trophy Wall**: a town panel (Hunt-Master pattern) listing every pinnacle boss, its
region hint, and its uniques — undiscovered ones greyed out. The locked list *is*
the chase. MP: broadcast feed line on any server-first kill.

---

## Pillar 3 — High-level depth & the endless loop

### Elite affixes (variety at zero art cost)
Past party level ~15, elites roll 1 affix; past ~22, up to 2; pinnacle-cycle enemies 3:
- **Shielded** (absorb bubble, recharges out of combat), **Vampiric** (heals off
  hits), **Splitting** (dies into two lesser copies), **Warded** (immune during its
  telegraph — punishes mindless DPS), **Frenzied** (speed+damage below half HP),
  **Anchored** (immune to knockback, drops a slow-zone on death).
- Affixes multiply drop quality. Implementation: flags in the elite generator +
  small hooks in damageEnemy/updateEnemies.

### Renown (infinite, sublinear progression)
- Past level cap, XP converts to **Renown points**: spend on style-specific nodes
  (melee: momentum retention; ranged: +mark duration; magic: cheaper venting; plus
  universal QoL nodes). Costs scale so power grows forever but slowly — endless
  without breaking balance. Per-player, persisted like skill points.

### Awakening (gear sink + gambling loop)
- Blacksmith end-tier service on legendaries: **Awaken** — high gold + a rare
  reagent (pinnacle/cycle drops) for a roll: 60% add a minor style modifier, 30%
  nothing, 10% fracture (item needs expensive repair). Creates the long-tail
  perfect-item chase and a real gold sink at 25+.

### World Tiers — "Calamities" (the multiplayer endless loop)
- The v2.52 cycle counters already escalate hunts/legion. Generalize: when the
  server's combined cycle count crosses thresholds, the **world tier** rises:
  higher affix budgets, higher loot floor, subtle world tinting (existing ring mood
  tech), tier shown on the HUD. Tier climbs forever; numbers stay sane because
  Renown+Awakening climb with it.

### Rotating world events (no infra, pure day-math)
- Deterministic from the in-game day counter (server-authoritative, no cron):
  - **Blood Moon** (every ~7th night): elites everywhere, double unique chance.
  - **Rift Storm** (~5th day): rifts spawn often, +2 depth, always party-blue.
  - **Legion Offensive** (~9th day): sieges intensify, warlord drops boosted.
- Announced via the feed + region banner. Gives the server "appointment" texture.

### Renown Board (social glue)
- Town board: server records — deepest delve, fastest hunt kill, highest tier
  reached, first-kills with player names. Cheap (a few maxima in world state) and
  it makes other players' achievements visible, which is half of "endless" in MP.

---

## Rollout (each phase = delegated agents + full regression + one deploy)

1. **v2.53.0 — Style identity + elite affixes.** Biggest play-feel win first; the
   bosses land better once styles are distinct. (Momentum/Marks/Heat, HUD pips,
   first 4 affixes.)
2. **v2.54.0 — Drowned King + Pale Shepherd + Trophy Wall** (+ their 4 uniques,
   first-kill guarantees, feed broadcasts).
3. **v2.55.0 — Ashen Colossus + Depth Tyrant + Awakening** (+ their uniques,
   reagent drops).
4. **v2.56.0 — World Tiers + rotating events + Renown points + Renown Board.**

Every per-player field follows the ARCHITECTURE.md checklist (PP swap, save/load,
snapshot, client adopt). Every formula lives in ONE generator (rebuild-from-
generator rule — no mirrors). Old saves default all new fields safely.
