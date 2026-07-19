# Mini-boss build spec — 5 fixed, respawning, soloable mini-bosses

Recon @ HEAD d4f36ff (GAME_VERSION v3.2.1). RECON+DESIGN only — no code changed.
File shorthand: `p17:450` = `src/game/parts/p17-drawAlly.js:450`; `world:991` = `server/world.js:991`;
registries by name (`apex.ts` = `src/content/apex.ts`).

**Ground truth found in recon (drives every choice below):**
- NO player stun or silence exists. `stunT` exists on ENEMIES only (p17:551-554 skips a stunned foe's
  whole turn — a free "vulnerable lull" primitive). The word "silence" appears once, in a stale comment
  (p13:444). Both player debuffs are fully new.
- The player-debuff pipeline already exists end-to-end for `chillT`: set anywhere server-side
  (specials.ts:165, p23:256), slows movement (p13:424), ticks down (p13:433), renders as a HUD pill
  (p15:143 `debuffs.push({ic:'❄',label:'Chilled',t:p.chillT,...})`), hover text from
  `CONTENT.tables.status` (tables.ts:91 via p15:25/27). New debuffs copy this shape exactly.
- The wire is FREE for player scalars: `snap.me = safeClone(me)` (world:1199, safeClone world:216
  copies every scalar), client wholesale-adopts snap.me into state.player (mp.html:699 comment) and
  calls the game's own `updateCombatHud` per frame (mp.html:92 NAMES, mp.html:1368). A new
  `p.silenceT`/`p.stunT` reaches the HUD with ZERO wire/NAMES/CAPTURE changes.
- Boss specials are registry entries (specials.ts:25 `SPECIALS`, one `{wind, exec(e,a), drawTele(v,e)}`
  per key + `SpecialKey` in types.ts:269). `updateBoss` picks uniformly from `e.specials` (p17:487-493),
  `startBossSpecial` arms `e.tele` (p17:404), `execBossSpecial` threads the actView bag (p17:412-449).
  `e.tele` rides `packEnemy` (world:206) and the client draws `CONTENT.specials[name].drawTele`
  (p20:72-85) — new telegraphs render on the client automatically.
- Fixed world-boss pattern = the pinnacles: `maybePinnacleBosses` (p23:303) is a presence-check loop,
  self-throttled by `state._pinCheckT`, run every SP frame (p23:600) AND every server tick (world:991) —
  spawn-on-boot + respawn both fall out of it. Respawn-day pattern: killEnemy stamps
  `state.pinnacleRespawnDay = curDay()+4` (p12:259); `onNewDayWorld` (p13:690) clears it.
  In MP the world regenerates each boot, so slain/respawn state is per-boot (the kraken precedent,
  p14:26-29) — nothing to persist.
- Lair binding precedent: the Emberwyrm is bound to its lair — 10-tile domain, wings home when no prey
  inside (p17:568-586). Pinnacles drift home via `wanderEnemyHome` off `_lairTx` (p17:758-761).
- MP partition: `updateEnemies` buckets each foe to its nearest hero and pins `state.player` per bucket
  (p17:780-821) — killer credit (killEnemy p12:136 runs under the pin), mid-pass spawns join the acting
  hero's bucket (p17:806-810). Party-wide boss AoE MUST loop `partyIn()` + `actAs` — a bare
  `playerTakeDamage` hits only the bucketed duelist (the leap-special warning, specials.ts:274-277;
  the party-menace template is pinnacleHazard p23:266-289).
- Level model v3.1.0: apex bosses carry FLAT hand-set levels (apex.ts hunts `level: 55..70`); rank-and-
  file derive stats via `scaleEnemyToLevel` (p03:222) from `owLevel(df)` (curves.ts:36). Minions of a
  boss can ride `scaleEnemyToLevel`; the boss itself is hand-set (the hunts/pinnacle precedent).
- `makeBoss` (p03:236) makes ZERO Math.random draws (wobble:0) — a boss factory can spawn with no RNG.
  `findWildTileNear` (p03:71) DOES draw RNG → use the deterministic shepherdLair spiral scan
  (p06:14-39: outward rings, skip SOLID/unreachable/town) for lair resolution instead, so boot spawns
  shift no RNG stream (keeps the golden re-record evidence surgical — see §4).

---

## 1. The five bosses

Coordinates verified against OW 347×291 (p01:56), `distFactor` (p02:302), `owLevel` (curves.ts:36),
`regionOf` (p16:1), frozen strip `frozenLimit` (p02:299), rings RING_SAFE=.30/RING_MID=.58 (p01:61).

| Boss | Region / site (seed tile) | df / tile-owLevel | Lv | Centerpiece (special key) | Minions | Player debuff | Signature drop | Solo path |
|---|---|---|---|---|---|---|---|---|
| **The Hierophant** | Western Marches (reg 3), ruined shrine — seed **(70,150)** | .458 / L24 | **25** | Healer ring: 4 orbiting acolytes pulse green heals into it; `smite` telegraphed AoE on the player's position + aimed radiant bolt cadence | 4 acolytes (`healer` reskin, orbit AI §2b) | — | Hierophant's Sunstave (magic, fire, affixed legendary) | Dodge smites, cut down acolytes as they orbit past, then burn the boss before it re-rings |
| **The Emberkeg** | Emberwaste Frontier (reg 8), cinder crater — seed **(305,238)** | .710 / L45 | **45** | `kegburst` timed radial explosion — long wind-up, ring of projectiles in all directions (dodge the gaps), then a self-stun lull (vulnerable) | none (lone) | knockback (radial shove at detonation) | Kegheart Cinderplate (armor, evasion/fort affixes) | Read the wind-up, slip a gap (or dodge-roll i-frames), unload during the lull |
| **The Broodmother** | Eastern Wilds dark wood (reg 5) — seed **(312,158)** | .614 / L37 | **40** | Herd-summon: continually spawns skittering broodlings that mill around her and pot-shot you; `webvolley` web-shots slow | up to 6 broodlings (`bat` reskin, mill AI §2b) | web slow (`chillT` via `kind:'web'` projectile) | Broodsilk Recurve (ranged, poison, +crit) | Rush HER through the herd — dead mother = no more spawns; mop the brood after |
| **The Colossus** | Northeast Range (reg 2), war-camp ruin — seed **(300,40)** | .727 / L47 | **60** | `quakeslam` telegraphed ground-slam that **STUNS** if caught | 3 shooter adds (`archer` reskin, mill AI — they pin you for the slam) | **stun** (`p.stunT`, new §2a) | Warcamp Crusher (melee, berserk/crit) | Pre-dodge every slam telegraph (stun only lands with the hit), thin the archers in recovery windows |
| **The Hexbinder** | Northern Wastes frozen strip (reg 1) — seed **(128,24)**, ty<frozenLimit(128)=49 ✓ | .573 / L33 | **55** | `hexsilence` telegraphed pulse that **SILENCES** (no spells/abilities for ~3 s) | 3 circling casters (`mage` reskin, orbit AI — attack, not heal: contrast to #1) | **silence** (`p.silenceT`, new §2a) | Hexbinder's Icon (magic, frost, +lifesteal) | Silence windows = basic-attacks-only; kite the orbiters, spend abilities in the gaps |

Levels are HAND-SET in the registry (the apex `h.level` precedent, apex.ts:29) chosen to match/overshoot
the site's tile owLevel — Hierophant/Emberkeg sit exactly on their tile's level; Broodmother +3;
Colossus/Hexbinder overshoot their tile like the Frost Titan (L60 @ a .59-df tile) because their
regions' apex tier sets the expectation. Spacing verified vs existing anchors: Frost Titan (174,17),
Shepherd (250,22), Storm Roc (269,84), Emberhorn (269,241), holds (tables.ts:143) — nearest neighbor
≥ 24 tiles in every case.

**Stats (registry rows, FLAT — no partyN, no partyLvl, per the owner's soloable rule):** each row
carries hp/atk/def/xp/gold hand-tuned at its level; deliberately NOT the makePinnacleBoss shape
(p22:382-397 multiplies party-size factors `pn/pnh` — minis take NONE; a 4-stack simply shreds them).
Ballpark (validate in the tuning pass against `playerTakeDamage`'s `max(ceil(a*.45), a−def)` floor,
p12:494): Hierophant 950hp/26atk; Emberkeg 2.1k/44; Broodmother 1.8k/38; Colossus 3.6k/60;
Hexbinder 2.8k/52. XP/gold ≈ hunt-tier scaled down (~350–900 by level).

**Registry vs sim, per boss:** registry (`apex.ts` new `minis` table + `ApexMini` in types.ts) holds
key/name/color/level/stats/lair-seed/specials list/mechanic knobs (orbitN, healPct, burstN, broodCap,
radii, debuff durations) + drop spec. Sim (game parts) holds: `makeMiniBoss` factory + lair resolver +
the spawn/respawn loop (fold into `maybePinnacleBosses`, p23:303) + the killEnemy branch + the two
minion-AI blocks + the specials' exec/drawTele hooks live in specials.ts (registry, CONTENT.md recipe 3).

---

## 2. New mechanics

### 2a. Player SILENCE + STUN debuffs (server-authoritative, sim-side)

Both are countdown scalars ON `state.player` (iron rule 6: per-HERO facts — each hero is silenced
independently). No wire work (recon: safeClone/me/updateCombatHud chain above).

**`p.silenceT`** — set by `hexsilence.exec`: loop `partyIn()` (p22:190), for each hero whose center is
inside the pulse radius, `actAs(pl, ...)` (p22:195) → `pl.silenceT = 240` (~3 s @ the 80 Hz server tick;
the citadel `_stanceT` comment fixes the tick rate, p23:87) + small damage via `playerTakeDamage`.
Blocks (one-line early-return guard, after the cooldown check, before any cost is paid, in each):
- `castSpell` (p11:396) — guard at :398, style-symmetric (F is a spell for everyone)
- `useUltimate` (p08:384), `useWhirlwind` (p08:299), `useFocus` / `useSummon` (p08/p16 siblings),
  the dominate entries (p16:318/339/399)
Does NOT block: `tryAttack` (p11:312 — all three styles keep their basic attack, magic included),
`doDodge`, `drinkPotion` (p10:357) — both are owner forks, §6.1.
Guard body: `if (p.silenceT > 0) { Sound.error(); log('Your voice is bound — nothing answers.', 'combat'); p.attackCooldown = 10; return; }`
(the castSpell energy-fizzle shape, p11:402-406 — logs reach the right hero's feed via the pin).
Tick: `if (p.silenceT > 0) p.silenceT--;` next to chillT (p13:433). Guarded tick + field-unset-until-hit
⇒ dead on golden trajectories (see §4).

**`p.stunT`** — set by `quakeslam.exec` ONLY when `playerTakeDamage` returned real damage (it returns
undefined on perfect-dodge/evasion/invuln, p12:541) — i-frames beat the stun, by design:
`const d = playerTakeDamage(...); if (d > 0) pl.stunT = Math.min(90, 55);` (cap prevents chain-lock).
Blocks: movement — in `updatePlayerFor`, next to the camping zero (p13:383-387):
`if (p.stunT > 0) { p.stunT--; dx = 0; dy = 0; p.moving = false; }` (an in-flight dodge, `p.dodge>0`
p13:390, is allowed to finish — its i-frames were earned) — plus the same early-return guard as silence
in `tryAttack`, `castSpell`, `doDodge` (p11:438, alongside the mounted/camping refusals at :440), and
the ability fns. Duration 55 (mirrors the enemy stagger stun, p08:487).

**HUD pills (client-automatic):** `updateCombatHud` debuffs block (p15:142-144):
`if (p.silenceT > 0) debuffs.push({ic:'🔇', label:'Silenced', t:p.silenceT, color:'#c08cff'});`
`if (p.stunT > 0) debuffs.push({ic:'💫', label:'Stunned', t:p.stunT, color:'#ffd24a'});`
plus two hover rows in `STATUS` (tables.ts:91 — pill hover reads `STATUS_DESC[label]`, p15:25-27).
Wire field needed: **none** (scalars ride snap.me). Polish (later, client-only): a rising-edge
"SILENCED!" float on the client, the v3.2.1 death-juice/level-flourish pattern — the server's own
`floatDamage` is a DOM stub headless, so the apply-moment flash is a client regen, not sim work.

### 2b. Orbit AI, herd-mill AI, heal pulse (minion primitives, shared by 4 of 5 bosses)

Both are new guard blocks in `updateEnemiesFor`, placed AFTER the status/stun gates (p17:550-554) and
BEFORE the leash block (p17:587) — the `tauntRef` block (p17:611-620) is the structural precedent
(early `continue`, ref-validity check first). Minions are ordinary enemies made by `makeEnemy` with
existing kinds (the makePinnacleAdd reskin pattern, p23:1-25: rename + recolor + stat stamp — ZERO new
art, zero new EnemyKindKey), leveled via `scaleEnemyToLevel(e, bossLv−5)` (p03:222).

**Orbit** (Hierophant acolytes, Hexbinder casters): fields `e._orbRef` (boss OBJECT ref — dropped from
the wire by packScalar exactly like `_pinRef`, world:187/p22:288), `e._orbIdx`, `e._orbN` (numbers —
ride packEnemy harmlessly). Block:
dead/gone anchor (`!e._orbRef || e._orbRef.hp <= 0`, the p12:154 `_pinRef.hp>0` idiom) → clear ref,
fall through to the kind's stock archetype (healer/mage AI — mop-up; owner fork §6.3);
else target = boss center + `(wobble·0.35 + _orbIdx/_orbN·6.28)` at radius ~64 px, `stepToward` at
1.15× speed, then payload, then `continue`.
- Heal-pulse payload (Hierophant): reuse the healer clock fields (`e.healCd`, p17:645-649): every 150
  ticks `boss.hp = min(maxHp, hp + round(maxHp·0.012))` + `spawnBurst` green `#70ffb0` at BOTH ends
  (healAlly's color/shape, p17:319-326) — 4 acolytes ≈ 2.6% boss hp/s, tuned so on-level solo DPS
  cannot outpace a live ring (the "break the ring" law), battery-asserted (§5). NOTE healAlly itself
  skips bosses (`o.isBoss` continue, p17:310) — this bespoke pulse is why the orbit payload exists.
- Caster payload (Hexbinder): every ~110 ticks (the caster cadence, p17:686) if bucket-hero dist<340,
  one aimed frost bolt `addProjectile(..., {element:'frost', ownerRef:e})` (p17:679-686 shape).

**Herd-mill** (broodlings; Colossus archers): fields `e._millRef`, `e._millT`, `e._mtx/_mty`. Block:
same anchor check; every 40-70 ticks pick a fresh random offset within ~5 tiles of the boss
(`_millT` clock — RNG here is fine, these exist only mid-fight, never on golden trajectories),
`stepToward` it (the skitter); pot-shot payload: every ~90 ticks if bucket-hero dist<340, one weak
arrow (p17:657-666 archer shape, `ownerRef:e`). Milling ignores aggro range on purpose — the herd
belongs to the boss's section, and the section is entered knowingly.

**Summon specials** (registry, specials.ts): `raisering` (Hierophant) and `broodcall` (Broodmother)
follow the `raiseadds`/`summon` exec templates (specials.ts:112-141/193-253): gate on live-count
(`enemies.some(x => x._orbRef === e && x.hp > 0)` for the ring — re-rings only when ALL 4 are down,
owner fork §6.7; `enemies.filter(x => x._millRef === e && x.hp > 0).length < broodCap(6)` for the
brood — 2 per cast), place via `findOpenTile` around the boss (a.map/a.TILE, specials.ts:121-125),
spawn through the actView's factory. The actView bag (p17:424-448) needs the mini factory (or spawn
inline with `a.enemies.push` + the existing `makeDungeonEnemy`-style capture — add `makeMiniAdd` to
the bag, the makePinnacleAdd/makeCitadelAdd precedent :443-444). Colossus's archer wave: same gate
inside `quakesummon` or folded as a phase call in its exec.

### 2c. Timed radial explosion — `kegburst`

Registry special (specials.ts). `wind: 70` (the longest in the game — slam is 46; long = readable).
`drawTele`: expanding ring + spoke marks at the gap angles (pure painter, `v.g2d`, the pullunder
template :169-191). `exec` (the nova/pullunder shape :84-98/:153-163):
1. Outer ring: n=10 projectiles, speed 3.0, `ownerRef:e`, fire element — 36° gaps, dodgeable by
   walking; inner ring n=10 offset half-a-gap at 2.2 speed fired same tick (staggered arrival —
   the "timed" read). Projectiles → party-correct by construction (specials.ts:275-277 rule).
2. Knockback: for each `partyIn()` hero within 90 px, `actAs` → small `playerTakeDamage(e.atk·0.5)` +
   radial displacement ~26 px checked through `canMoveTo` (the ultimate's enemy-knockback shape
   reversed, p08:488-492) — anti-point-blank-cheese; this is the owner's knockback secondary.
3. The lull: `e.stunT = 110` on ITSELF — p17:551-554 then parks the boss (no move, no melee, no
   specials) = the vulnerability window, zero new AI. specialCd doesn't tick while parked (updateBoss
   is skipped), so the cycle is stun 110 + cd 150-270 (p17:461) ≈ 3.3-4.7 s — sane solo rhythm.

Web-shot (Broodmother `webvolley`): 3-bolt aimed spread (castvolley shape :323-343) with
`kind:'web'`, slow fat bolts. One sim line at the enemy-projectile→player hit seam (p13:183-190,
where `playerTakeDamage(pr.dmg)` runs under the hit hero's pin): `if (pr.kind === 'web' && _pd > 0)
state.player.chillT = Math.max(state.player.chillT || 0, 130);` — reuses the SHIPPED slow
(p13:424 `spd *= 0.55`) + the shipped ❄ pill; recon found NO existing enemy-projectile→chill path
(chill sources today: pullunder direct, pinnacle hazard, winter), so this line is the one new seam.
Engineering default: reuse chillT (owner may want a themed 🕸 pill — §6, cheap either way).

### 2d. Minions in the MP-native sim — ownership, credit, wire

- **Spawn ownership:** minions spawned inside `exec` during a bucket pass join the ACTING hero's
  bucket automatically (p17:806-810 mid-pass adoption) — no code.
- **Kill credit:** whoever's bucket lands the kill — `killEnemy` runs under the bucket pin
  (p17:804), XP/gold via `gainXP`/`state.player.gold` (p12:176/186) — no code.
- **Wire:** object refs `_orbRef/_millRef` are dropped by `packScalar` (world:187 — the `_pinRef`
  guarantee, p22:288-290); the numeric `_orbIdx/_orbN/_millT` scalars ride packEnemy harmlessly.
  Never add an object/array field to a minion beyond these refs (the `_burnNoSpread` warning,
  p17:220).
- **Targeting:** minis are `isBoss` ⇒ overworld bucket = `bossPool` (town-blind + downed-blind,
  p17:790-796); with no valid target they `wanderEnemyHome` — extend its lair clause to
  `(e.isPinnacle || e.isMini) && e._lairTx != null` (p17:758-761, one line).
- **Party-wide effects:** smite/quakeslam/hexsilence/keg-knockback all loop `partyIn()` + `actAs`
  (the pinnacleHazard menace template p23:266-289); projectiles reach everyone by construction.
- **Lair bind (the "set map section"):** in `updateBoss` (or a guard before it), the Emberwyrm domain
  shape (p17:568-586): if the bucketed hero is > ~12 tiles from `_lairTx/Ty`, drop tele/dash, stride
  home, and heal to full on arrival (anti-chip-kiting; the arena-reset spirit of p23:247). Log once.

---

## 3. Zones, seeding, respawn, MP model

**Seeding:** NO setupOverworld edit. Extend `maybePinnacleBosses` (p23:303-337) — after the
PINNACLE_BOSSES loop, iterate `CONTENT.apex.minis`: present in `state.enemies` (by `mbKey`)? skip.
`state.mbRespawnDay` has the key and `curDay() < day`? skip. Else delete the key's entry, resolve the
lair, push `makeMiniBoss(row, tx, ty)`. Same `_pinCheckT` throttle (p23:305-309), already wired into
both drivers (SP loop p23:600; server tick world:991 — the fold means NO new CAPTURE name and no
world.js edit; a new top-level fn in world:991's list without CAPTURE would be a silent no-op, the
exact bug class iron rule 3 exists for).

**Lair resolve:** `resolveMiniLair(seed)` = the shepherdLair DETERMINISTIC spiral (p06:14-39): outward
rings from the seed, first tile that is in-bounds, non-SOLID, `isReachableOW`, not in town; fall back
to the raw seed. Deliberately NOT `findWildTileNear` (p03:71 draws RNG — §4). Reachability is the
non-negotiable (an unreachable boss is unfightable; the shepherd learned this).

**Respawn:** killEnemy grows an `e.isMini` branch after the isPinnacle block (p12:255-264):
push nothing to a slain-list — instead `(state.mbRespawnDay ||= {})[e.mbKey] = curDay() + 1`
(owner: ~1 day; `curDay` p13:633, DAY_FRAMES 21600 ≈ 4.5 real minutes @80 Hz — §6.4), then
`dropMiniReward(e)`, small `addRep('vigil', 5)`, a `log(..., 'quest')` line. The presence loop above
IS the respawner (per-key days, bosses independent — unlike the pinnacles' whole-roster day). No
`onNewDayWorld` entry needed; day-rollover only matters through `curDay()` comparisons. World state,
per-boot, unpersisted (the kraken rule p14:26-29) — a server reboot simply respawns all five.

**Drops:** `dropMiniReward` = the hunt first-kill shape (p22:257-283): guaranteed fixed named
legendary from the registry row (`JSON.parse(JSON.stringify(row.reward))` + `normItem`, apex hunts
:41-54 row shape) dropped as a ground pickup at the corpse; re-kills (the farm loop) drop the same
item again at reduced ceremony OR roll leveled loot — owner fork §6.2. NOT the citadel 1% relic
model, NOT p.u* build-effect uniques (each of those needs its own recalcStats seam — CONTENT.md
recipe 5 trap) unless the owner asks (§6.2).

**MP model: world-shared, pinnacle-class.** One instance per boss in the shared overworld —
everyone sees and fights the same Hierophant (the snapshot interest-cull world:1203 shows it to
whoever's near). Not instanced, not per-player. Party makes it easier ONLY through more bodies
(no partyN stat terms — §1). Loot: signature drop is a world pickup (first-to-grab, the hunt/
pinnacle norm); XP/gold to the killer's bucket (standard). Downed/town heroes are invisible to it
(bossPool); no valid target → walks home and heals (lair bind).

---

## 4. Oracle impact — BOTH oracles move; the conscious protocol

This adds live sim content: the five bosses spawn ON BOOT via the presence loop, on every overworld
scenario. `state.enemies` gains five objects ⇒ the `{state,maps}` hash moves from the FIRST hashed
tick in `overworld-combat`, `daily-life`, `day-rollover`, AND both mp scenarios (`mp-overworld-combat`,
`mp-day-rollover`). `dungeon` alone stays clean (no overworld boot… verify: the dungeon scenario still
boots the overworld first — assume it moves too until proven).

Containment that makes the re-record AUDITABLE (why §3's choices matter):
- `makeBoss` draws no RNG (p03:236-263), stats are hand-set, and the lair spiral is deterministic ⇒
  boot-time spawns consume ZERO extra `Math.random()` draws ⇒ the seeded stream (golden README
  "How it works") is UNSHIFTED and every pre-existing leaf should hash identically; the diff is the
  five new enemy subtrees + the enemies-array shape + `wobble += 0.1` ticks on them.
- The lairs sit at df .45-.73 — golden's scripted heroes never approach them ⇒ no aggro, no specials,
  no minions, no drops on-trajectory. The respawn path needs a KILL ⇒ dead on-trajectory (battery
  covers it). `day-rollover`'s hunt-respawn crossing is untouched (minis don't ride onNewDayWorld).
- S1 (debuff primitives) is a PURE addition: guarded ticks (`>0`), fields never set on-trajectory,
  guards never taken ⇒ oracles must NOT move — if they do, stop, it's a bug (CONTENT.md "Add vs.
  change").

Protocol per spawn-touching slice (S2-S5): run GATE, expect golden+mp to fail at the boot hash,
`record` + `mp-record`, eyeball the oracle git-diff — evidence = (a) first divergent tick is the first
hashed tick, (b) diffed leaves are ONLY under the new enemy entries (no drifted player/npc/map leaf),
(c) the hunt tripwire still diverges exactly @700 (`mp-prove`) — commit oracle + change together
(tests/golden/README.md; iron rule 4).

---

## 5. Slice ladder (each slice: `npm run build && typecheck && battery && golden && golden:mp && node server/world.js` green before merge)

**S1 — RECOMMENDED FIRST: the debuff primitives (silence + stun + pills).** §2a exactly: two fields,
~8 one-line guards (castSpell/useUltimate/useWhirlwind/useFocus/useSummon/dominate/tryAttack(stun)/
doDodge(stun)), the movement zero, two tick lines, two HUD pills, two STATUS rows. NEW battery
`silence-stun-verify.js` (seen-to-fail: set `p.silenceT=100`, drive castSpell ⇒ energy unchanged +
cooldown-tap; `p.stunT=50` ⇒ position frozen over ticks, doDodge refused, tryAttack refused; ticks
reach 0 and clear; chillT untouched). Oracle-NEUTRAL — plain GATE, no re-record (that's the test the
slice is honest). Smallest honest step; everything later consumes it.
*(Alternative first slice — one boss end-to-end — rejected: it forces the oracle re-record and the
registry/factory/spawn plumbing into the same diff as brand-new AI; S1 is the only slice that can
prove itself with an untouched oracle.)*

**S2 — world integration: all five spawn as STOCK bosses.** `apex.ts` `minis` table + `ApexMini`
type; `makeMiniBoss` (flat stats, `isBoss+isMini+mbKey+level+_lairTx/Ty`, stock
`specials:['slam','charge','nova']` for now); `resolveMiniLair` spiral; the presence/respawn fold in
`maybePinnacleBosses`; lair bind + `wanderEnemyHome` clause; `killEnemy` isMini branch + respawnDay +
`dropMiniReward` (fixed rewards in the rows); nameplates ride packEnemy free. ONE conscious dual
re-record (§4 evidence). NEW battery `miniboss-verify.js` (all five present after boot at expected
lairs/levels; kill one ⇒ reward pickup + respawnDay stamped; advance `state.time` a day ⇒ presence
loop respawns it; drag hero away ⇒ boss homes + heals) + `mp-miniboss-verify.js` (2 heroes: one shared
instance, killer-credit lands on the killer, no `_orbRef`-class object leaks in a serialized snapshot —
the objclient precedent).

**S3 — the Hierophant vertical slice (mechanics template).** Orbit AI block + heal pulse; `raisering`,
`smite` (aim-point drawTele — the leap precedent specials.ts:305-320; partyIn damage loop) in
specials.ts + SpecialKey; `e.caster=true` aimed-bolt cadence; ring-gate tuning (heal > solo DPS while
ring lives — battery-assert: fixed-DPS harness cannot drop boss hp with ring up, can with ring down).
Re-record (evidence: Hierophant subtree only). Extend miniboss-verify with the ring seen-to-fail.

**S4 — Emberkeg + Broodmother.** `kegburst` (+ self-stun lull + knockback), `broodcall` + mill AI +
`webvolley` + the `kind:'web'` chill line (p13:183-190). Battery: burst ring count/gap geometry, lull
parks the boss, knockback displaces, brood cap holds at 6, mother-death stops spawns, web applies
chillT to the HIT hero only. Re-record.

**S5 — Colossus + Hexbinder.** `quakeslam` (→ `p.stunT` via the damage-landed rule; i-frame negates),
archer herd reusing mill AI; `hexsilence` (→ `p.silenceT`, partyIn radius), caster orbiters reusing
orbit AI. Battery: stun only on landed hit; perfect-dodge ⇒ no stun; silence blocks exactly the §2a
list; out-of-radius hero unaffected (mp). Re-record.

**S6 — polish + ship.** Balance pass vs an on-level solo kit (each boss killable, deaths honest);
optional bespoke art hooks (enemies.ts draw-only entries, the boss/dragon precedent) + client
apply-moment FX (client-only, oracle-untouched); minimap/wayfinder markers optional; **bump
GAME_VERSION + the same-commit `server/releases.js` entry written for players** (iron rules 1-2);
full gate; deploy (integrator only, never mid-edit — rule 5).

Six slices, one agent each; S3-S5 are sized by "one to two bosses + their battery teeth."

---

## 6. Vision forks — genuine owner calls (engineering defaults marked)

1. **Silence scope.** Default: blocks castSpell + all actives (Q/R/X/Z + dominate); basic attacks
   (all styles, staff bolt included) and dodge stay; potions stay. Ask: should it also bind the magic
   BASIC attack (full mage disarm — harsher), and/or potions?
2. **Signature drops.** Default: guaranteed fixed named legendary per boss, first kill AND re-kills
   (they're the farm). Ask: (a) guaranteed vs rare (citadel 1% relic style)? (b) plain affixed
   legendaries vs true UNIQUES with build-changing `p.u*` effects (5 new sim seams — a real slice of
   extra work)? (c) re-kill = same item, or leveled random super-loot instead?
3. **Orphan minions.** Default: acolytes/broodlings/archers SURVIVE their boss (lose the anchor,
   fall to stock AI, get mopped up). Ask: die/flee with her instead?
4. **Respawn timing.** Owner said ~1 day = ~4.5 real minutes @80 Hz — genuinely fast (a lap of the
   five re-arms the first). Confirm 1 day, or prefer 2-3 (pinnacles use 4)? And: flat forever
   (default — farmable minis) vs cycle-scaling harder+richer (the hunt/pinnacle precedent)?
5. **Party scaling.** Confirming the read-back: ZERO party terms (a 4-stack melts them in seconds) —
   accepted? (Default: yes — soloable-first is the whole point; the pinnacles remain the party test.)
6. **Broodmother's wood.** Owner said "Marches/Frontier dark wood"; the map's woods region is the
   EASTERN Wilds — proposed (312,158) L40 there. OK, or force the western Marches (a lower-level
   site, ~L25-30)?
7. **Hierophant re-ring.** Default: she re-summons a fresh ring ONLY after all 4 acolytes are down
   (wind 60 — a real burn window). Ask: one ring per engagement instead (break it once, done)?
8. **Web pill.** Default: web-slow reuses the ❄ Chilled pill (zero new UI). Want a themed 🕸
   "Webbed" pill (tiny extra: one field or a label variant)?

---

## 7. Risk register (top 8, each with detection)

1. **Party-wide AoE hits only the bucketed duelist** (the slam trap — specials.ts:274-277 warns).
   Smite/quakeslam/hexsilence/keg-knockback must loop partyIn+actAs. *Detect:* mp-miniboss-verify
   places 2 heroes in-radius, asserts BOTH took damage/debuff.
2. **Golden re-record masks an unintended change** (full-stream shift would make the diff unreadable).
   Mitigated by zero-RNG boot spawns (§4). *Detect:* oracle git-diff leaf audit per slice — any
   changed leaf OUTSIDE the new enemy subtrees = stop; hunt tripwire still @700 (`mp-prove`).
3. **Heal-ring softlock** (heal ≥ any reasonable DPS even with the ring down, or acolytes untargetable
   behind smite spam). *Detect:* battery fixed-DPS harness — boss hp must fall with ring dead, must
   NOT fall (at on-level DPS) with ring alive; acolyte TTK bound asserted.
4. **Perma-lock chains** (stun/silence reapplied before expiry; Colossus adds + slam overlap).
   Caps (`stunT ≤ 90`), cadence floors (specialCd ≥ 150 post-exec, p17:461), single-source rule.
   *Detect:* battery 3k-tick scripted fight asserts max consecutive locked ticks < threshold.
5. **Silent no-op spawn loop** — a NEW top-level fn added to world:991's list without CAPTURE is
   skipped without error (the old capture-bug class). Avoided by folding into `maybePinnacleBosses`.
   *Detect:* mp-miniboss-verify asserts all five exist after N server ticks (fails loudly if not);
   v3-missing-captures stays green.
6. **Object-ref wire leak** (`_orbRef/_millRef` on minions, or a future object field). packScalar
   drops refs, but a NUMBER stand-in left stale rides forever (the `_burstKill` lesson, p12:361).
   *Detect:* mp suite JSON-stringifies a snapshot and asserts no `_orbRef`/circular/object fields;
   objclient/qclient stay green.
7. **Unreachable or terrain-broken lair** (seed lands in peaks/sea on some seed's worldgen; boss
   spawns unfightable or in a town's face). Spiral resolver requires `isReachableOW` + not-in-town.
   *Detect:* miniboss-verify asserts each resolved lair is reachable + ≥ 20 tiles from every town
   center and hold, across 3 worldgen seeds.
8. **Debuff pills desync or get stomped client-side** (the wholesale snap.me adopt vs client-local
   re-stamps — the localShop/wayfind pattern, mp.html:699). Pills read adopted scalars only, no local
   mirror. *Detect:* manual 2-tab smoke in S5 (hexsilence lands → pill appears within one snapshot,
   counts down, clears); plus battery HUD-string check via the qrender precedent if cheap.

---
*Recon sources: p01:56-66, p02:299-311, p03:71-90/184-263/264-317/410-458, p06:1-40, p08:299/384-503,
p10:357, p11:108-130/312-468, p12:136-265/363-393/442-541, p13:183-190/360-541/544/633-711,
p14:1-76/450, p15:25-27/117-175, p16:1/318-483, p17:220/304-328/378-511/512-705/706-821,
p18:92-161, p20:50-85, p22:175-404, p23:1-337/588-641; specials.ts, apex.ts, curves.ts, enemies.ts,
tables.ts:91-147, types.ts:269; server/world.js:187-260/216-233/640-701/874-1010/991/1180-1330;
server/load-game.js:111-230; client/mp.html:90-92/209/699/1368; CONTENT.md; tests/golden/README.md.*

---

## OWNER DECISIONS (locked 2026-07-18) — supersede the "vision forks" above

1. **Silence scope = abilities + ALL spellcasting.** Blocks active skills AND a mage's basic
   staff/bolt (a caster is reduced to running/melee during silence). Basic MELEE/RANGED
   attacks and POTIONS still work. Brutal for pure-magic builds by design.
2. **Signature drops = rare roll every kill (~5%), per-player hidden roll** — the Sunken
   Citadel relic model exactly (independent per hero, invisible to others). Every kill
   also pays gold + XP. A long farmable chase, no loot flood.
3. **Respawn = ~2–3 in-world days** (≈10–15 real min; use 2 days = curDay()+2, or 3 —
   pick 2 unless a beat argues otherwise). Zone reads "cleared" for a session-scale window
   but stays farmable. Flat forever (no cycle-scaling).
4. **Summoned minions PERSIST after the boss dies** — mop them up. The swarm outlives the
   summoner; a careless victory can still get you killed by leftover adds.

### Coordinator defaults (locked, not owner-facing unless they object)
- **Zero party scaling** (owner: "tough but soloable") — no partyN stat terms; a 4-stack
  legitimately melts them.
- **Broodmother site = the EASTERN Wilds woods** (~312,158, L40), the map's real forest —
  not the western Marches (the recon corrected the region).
- **Web slow = its own "Webbed" HUD pill** (themed), not a reused Chilled pill.
- **Hierophant ring re-forms once ALL 4 healers are dead** (not on partial breaks) — so
  "break the ring, then burst" is the strategy, and it can't stall forever.
- **Hierophant ALSO attacks** (owner tweak): aimed radiant bolt (ranged cadence) + a
  telegraphed "smite" AoE dropped on the player — dodge smites WHILE breaking the ring.

Build order unchanged: S1 primitives (oracle-neutral) → S2 five stock bosses + respawn +
5% drops → S3 Hierophant vertical slice → S4 Emberkeg + Broodmother → S5 Colossus +
Hexbinder → S6 balance/art/FX + ship. Both oracles re-record at S2 (conscious).
