# P2 plan — multiplayer-native sim (players[] first-class, swap machinery deleted)

Recon @ HEAD 3603a9b (branch `multiplayer`). Line numbers: `server/world.js` (1481 L),
`server/index.js` (580 L), and `src/game/parts/pNN-*.js` (prettier-formatted, cited as
`pNN:line`). Verified today: `node server/world.js` self-test GREEN, snapshot = **10.88 KB**
(2 players, 19 near enemies). Read with ARCHITECTURE.md + rebuild/monolith-map.md §2/§5.

**The identity trick that makes golden(1p) hold:** the game already contains the pattern
`state.players && state.players.length ? state.players : [state.player]` (p23:137,
maybePinnacleBosses dawn-melt — shipped SP-byte-identical). P2 canonizes it as one helper
(`party()`), and *never sets `state.players` in SP*. With one player every converted loop is
`for (p of [state.player])` — same body, same RNG draw order, same hash. The server keeps
setting `S.players` (world.js:32) exactly as today.

**The hash-shape problem (must be decided up front):** the golden root is `{state, maps}`
(tests/golden/harness.mjs:97-99) and hashes SHAPE. Moving a key (`state.quests` →
`state.player.quests`) changes bytes even when behavior is identical. Ruling for P2:
`tests/golden/serialize.mjs` gains a tiny pure **REMAP table** (present moved keys at their
old spot for hashing; ~1 line per key, added in the same slice that moves the key).
oracle.json stays untouched all ladder long; the perturb controls (`prove`) must still fail
after every remap addition (the vacuous-test rule). One final slice deletes the remap table
and re-records oracle.json with the native shape (paired-run proof in the commit message).

---

## 1. Mechanism inventory (server/world.js)

### M1 — PP_KEYS swap/write-back — DIES
- Definition: `PP_KEYS` 282 (12 keys: shopPurchased, tonics, sharpenLevel, cargo,
  ingredients, lastRestDay, fishCd, sailing, dragon, quests, maxDepth, bounty);
  `swapInPP` 283 (also maps `p._shopTown` → `S.activeShopTown`); `writeBackPP` 292
  (explicit lines for number/replaced keys — maxDepth, bounty — per the 287-291 comment).
- swapInPP call sites (12): 411 `_enterRift` · 469 `_projectilesByShooter.runAs` ·
  850 `resolveInteract` · 945 overworld rotation · 984 ow enemy partition ·
  1015 ow allies partition · 1026 shared-phase re-pin · 1044 ow companions ·
  1062 spawn pass · 1142 dungeon rotation · 1181 dg enemy partition · 1198 dg companions.
- writeBackPP call sites (5): 423 `_enterRift` finally · 869 `resolveInteract` ·
  951 dungeon-enter early-out · 956 ow rotation end · 1167 dg rotation end.
- Adjacent: QUEST_TEMPLATE/SHARED_QUESTS/aliasSharedQuests 109-111; addPlayer PP seeding
  500-516; `_qN/_qJson` stamp loop 922-926.

### M2 — characterOf partition (save side) — DIES as a partition
- `characterOf` 528-562: pins S.player/S.inventory 531-535, calls game `snapshot()` 534,
  reads quests/maxDepth/bounty off `p` 552 (NOT off snap — comment 546-551: it never
  swapInPPs), shop slice 545, dragon 553, companions filtered by `ownerId` 556-560.
- `_loadCharacter` 567-681: v1→v2 quest synthesis 616-643, v3 milestone synthesis 646-672,
  recalcStats under a pin 674-677. Consumers: index.js close-save 486-490, autosave
  509-516, `serialSave` 499-505, db.js `saveCharacter` 89-92 (accounts.character JSONB).
- Replacement: player-native `characterOf(p)` (no pin — snapshot()'s player slice reads
  `p` directly once keys live on p) + the pure `migrateCharacter` module (§6).

### M3 — _owner tagging + tick partitions — the PARTITION LOOPS die, the TAGS stay
Ownership fields (`pr.ownerRef`, `a._owner`, `c.ownerId`) become first-class sim data
(they already are the identity model); what dies is world.js re-running one-player game
fns once per bucket:
- projectile shooter stamp 948 (ow), 1146 (dg); `_projectilesByShooter` 453-477
  (bucket 461-466, runAs swap 468-473, hostile/unowned final pass 475, parked-shots
  guard 460).
- allies: tag 950/1147; partition + per-owner updateAllies 1003-1020; packAlly 236-241.
- companions: tag 949; removePlayer scrub 686-691; warband-RPC roster splice 770-778;
  ow per-owner updateCompanions 1034-1048; dg per-owner 1192-1202; respawn surfacing
  215-217, 1237.
- enemy nearest-player partition: ow 961-992 (buckets 971-980, `__libGate` 982/991),
  dg 1173-1188; wanderHome fallback 125-146, 989.
- players[1..N] damage patches (exist only because game fns see one player): hostile
  projectiles 1071-1089 (+vamp heal 1082), fires 1090-1099, pinnacle party hazard
  1102-1126, snow chill 953-955. All die when the game fn loops `party()` itself.
- Liberation `_seen` sweeps 1242-1273 REMAIN (they reconcile bucket-blind inline checks;
  after conversion updateEnemies sees the full roster per world, so `__libGate`
  (load-game epilogue + 58, 982, 1179, 1246) can be retired in the same slice as the
  enemy-loop conversion — gate stays until then).

### RPC path — `_runActions` 714-757 / `_runRpc` 759-821
`_runActions` itself swaps NOTHING; both call sites run inside a full swap (945-947,
1142-1145 — swapInPP before, writeBackPP after). The in-file comment 810-813 claims "no
swapInPP around an RPC" and doCamp therefore mirrors `p.lastRestDay` manually 816-817 —
belt-and-braces today, but it documents the real trap: **nothing enforces that an RPC
handler runs under the acting hero's full slice** (resolveInteract 849-869 and _doInstant
875-895 had to add their own swap+writeback; characterOf deliberately doesn't and reads
`p`). Special-cased handlers to convert: sellAllJunk scene-pin 761-766, warband roster
splice 770-778, buyWeapon/buyArmor via `p._shopStock` 779-785, sellItem 786-792,
repairItem 793-799, doCamp time-freeze + mirror 800-819, allow-list apply 820.
Post-P2 shape: every RPC runs as `runAs(p, () => G[rpc](...))` where `runAs` sets ONLY
`state.player`/`state.inventory` (the two slots that remain) — PP mirroring dissolves
because the keys live on `p`.

### grabWorld/putWorld — **STAYS**
WORLD_SLOTS/grab/put 299-301; sites: _enterRift 408/422, _runActions enter-throw restore
722/725, sharedDg create 733, dungeon phase 1134/1136/1140/1169/1227/1231. This is
DUNGEON-vs-OVERWORLD world instancing, orthogonal to per-player state; deleting it is P3+
scope (worlds-as-objects), not P2. The `try{…}finally{putWorld(owBase)}` invariant
(ARCHITECTURE) survives unchanged. P2 only re-points *who iterates inside* the swapped
world.

---

## 2. Per-system conversion table

Legend — mech: **PP**=swapInPP slice, **pin**=S.player/S.inventory pin, **part**=world.js
partition, **patch**=world.js players[1..N] loop, **shared**=runs once under players[0].
Shape: **A**=fn loops `party()` internally · **B**=caller loops (rotation survives inside
the sim tick fn, not world.js) · **C**=already safe/shared, no change.
⚠ = per-player ORDER matters (pin iteration to `state.players` join order — document as
part of the determinism contract; 2p golden baselines freeze it).

| fn (site) | per-player state touched | today | P2 shape |
|---|---|---|---|
| updateTime p13:542 | none itself | shared (world.js:915, stale S.player) | C; onNewDay split — §4 |
| updatePlayer p13:288 (+updateStyleResources p11:477, tickBlessing/Food/CampRest/Fishing, checkPickups) | p.* movement/stamina/heat/momentum; keys{}; state.sailing/dragon/fishCd/lastRestDay (PP); state.seenHeatTip ⚠bug | pin+PP rotation 945/1142 | **B→A**: `updatePlayers()` loops party(); input reads `p.held` (SP: keydown writes state.player.held; keys{} kept as an alias write for hash freeze until the input slice) |
| checkPickups p13:180 | p.gold/gotKey, inventory, quests.key/frozen, state.uniquesFound (world) | runs inside updatePlayer under rotation | A (inherits updatePlayer loop) ⚠ two heroes on one pickup same tick — first-in-order wins `pk.collected` (already the swap semantics) |
| tryAttack p11:295 / castSpell p11:379 / magicShot p11:138 (heat+seenHeatTip 185-190) / doDodge | p combat scalars, inventory, energy/stamina | invoked from _runActions under rotation | C body; caller becomes runAs(p) |
| updateEnemies p17:576 (+enemyStrike/afxHit/bossSpecials/pinnacleHazard) | targets state.player; contact dmg; killEnemy credit | part 961-992/1173-1188 + __libGate | **A**: nearest-player bucketing moves INSIDE (reuse nearestPlayer logic; boss town-blind pool 964-980); ⚠ bucket iteration order; __libGate retired here |
| killEnemy p12:136 | gainXP→p; p.gold 177; quests.slay 180; bounty 261; key-drop → inventory+quests.key 195-199; marks _markBy; world: huntsSlain/pinnacleSlain/flags.krakenDead/POI/holdings | writes into whatever slice is swapped in | **C body** — reads state.player/state.quests; correctness moves to callers: every kill path must have pinned `state.player` to the crediting hero ⚠⚠ two players killing the same enemy same tick = whoever's sub-loop runs first (today: bucket order; keep identical) |
| gainXP p12:375 | p.xp/level; bumpCompanionLevels (OWNER's comps only post-P2) | swapped slice | C body; bumpCompanionLevels gains `c.ownerId === state.player.id` filter (SP: ownerId unset → all, identical) |
| updateAllies p16:493 | killEnemy credit via state.player | part by _owner 1003-1020 | **A**: loop owners internally; unowned→nearest (1009) moves in-sim |
| updateCompanions p05:79 | steps toward state.player; kills credit owner | part by ownerId 1034-1048/1192-1202 | **A** |
| updateProjectiles p13:1 | self-repins state.player→pr.ownerRef 13-16 (crit/prof/XP); hostile shots hit-test state.player ONLY | shooter buckets 453-477 + hostile patch 1071-1089 | **A**: friendly path already self-repinning — extend its repin to be the FULL acting context (the PP-slice-per-bucket reason dissolves once quests/bounty live on p ⚠ the repin at p13:14 then suffices); hostile hit-test loops party() (kills patch 1071-1089); keep parked-shots rule 460 (skip worlds with no pool) |
| maybeSpawnWild p18:171 | spawns around state.player | per-player forced-timer loop 1054-1066 | **A**: density/cadence logic (localTarget/nearEnemyCount/_spawnT, world.js 73-88, 1055-1065) moves into the sim fn ⚠ RNG order = player order |
| maybePinnacleBosses p23:117 | already scans party (137) | shared 1027 | C |
| updateFires p15:180 | burns state.player | shared + patch 1090-1099 | **A** (tile-check loops party) |
| updateWeather p14:128 | snow chill state.player 153-158 | shared + world.js chill patch 955 | **A for the chill lines only** (weatherParts/reroll stay shared) |
| updateEvents p15:351 / triggerEvent / updateFactionWar p15:512 / updateNemesisPresence p16:165 / updateWarband p17:159 | world state; log lines; occasional addRep (→per-player post-fix) | shared | C; addRep in shared phase becomes party-wide loop (§3 factions) |
| updateFatigue p14:466 | lastRestDay in-town 481, markTownVisited 482, vigil regen 484-487, exhaustion drain | **NOT CALLED in MP** (world.js replicates only the recalc edge 952/1166) | **A** and world.js edge-check deleted — NOTE: this *adds* town-rest/regen/visited-marking to MP (bugfix, matches SP); golden 1p unaffected (SP always ran it) |
| onNewDay p13:562 | see §4 | shared, stale slice | split World/Hero — §4 |
| RPC menu/economy: buyPotion/buyTonic/buyWeapon/buyArmor/sellItem p10:1-82, afterBuy 83, temperWeapon 136, reforgeWeapon 164, fuseWeapon 187, repairItem 331, repairAll 343, drinkPotion 357, spendPoint p08:215, unlockAbility p08:270, useWhirlwind/Focus/Ultimate p08:298/350/383, useSummon p16:449, sellAllJunk p07:398, equipWeapon/equipArmor p07:479/494, cook p14:253, doCamp p14:421, toggleMount/toggleBoat/buyBoat p23:161/189/250, openBounty p10:461, doTravel p09:384 (not in RPC_OK — SP-only today, keep) | p.gold, inventory, PP keys (tonics/sharpenLevel/shopPurchased/cargo/ingredients/bounty), hasBoat/activeShop* ⚠bugs | rotation swap around _runActions; resolveInteract's own swap 849-869 | C bodies; all callers → runAs(p). doCamp's time-freeze 800-819 stays (world clock is shared); its lastRestDay mirror dissolves |
| tryInteract p10:524 / enterDungeon 613 / descend p11:1 / exitDungeon p11:22 / openKeyVault | maxDepth (p), inventory.keys, world slots | rotation + grabWorld choreography 720-749 | C bodies; world-slot choreography in world.js survives (§1 grabWorld) |
| snapshot p06:535 / applySnapshot p07:1 | whole save | pin via characterOf | reshaped in the per-key slices + §6 |

---

## 3. The 7 shared-state bugs — exact fix sites

All seven follow ARCHITECTURE's "prefer a scalar/field on state.player" rule: on the
player they ride `snapshot().player` (persistence), `characterOf` (MP save), `safeClone(me)`
(wire — it keeps arrays/plain objects, world.js 255-265), and the client's wholesale
`S.player = snap.me` (mp.html:966) with **no adopt line**. Each move = rewrite the listed
sites `state.K` → `state.player.K`, add to snapshot()'s player block (p06:539-568), read
back in applySnapshot (p07 §top; keep `s.K` fallback for old SP saves), add a golden REMAP
entry, add migrate default (§6).

1. **visitedTowns** (8 sites) → `p.visitedTowns` (array of town idx). Init p01:250; write
   markTownVisited p09:54-62 (callers: updateFatigue p14:482 — MP gains it via the
   updateFatigue conversion; doTravel p09:401; startLoaded p07:309); read renderTravel
   p09:329; save p06:578/load p07:69/reset p07:284. Client: zero edits (renderTravel reads
   the moved key off snap.me). Migrate: no durable source in v1-v3 rows → `[]`,
   self-heals on next town visit (fast-travel list re-earns; acceptable, note in release).
2. **factions** (14 sites + ~25 addRep calls) → `p.factions` {vigil,wilds,dread}. Core:
   addRep/facTierIdx/buyPrice p13:473-480ish; readers renderFactions p09:284/316,
   maybeRaidHolding p04:341 (dread≥15 gate — becomes `Math.max` over party), vigil regen
   p14:484, vigilDiscount/dreadLootBonus/wildsFireResist/beastAggroMul (p13 tier fns).
   killEnemy/POI addReps credit the acting hero (correct post-conversion). Shared-phase
   addRep sites (triggerEvent p15, startDreadRaid, liberation sweeps world.js 1252/1259/
   1271 running under players[0]) → loop party (rep events are party news). SP: party of
   one → identical. Save: player block; migrate default {0,0,0} (never persisted per-hero
   before — document the reset). Client: zero edits.
3. **loreFound** (10 sites) → `p.loreFound`. readLoreStone p05:407-431 (first-read +40 XP
   becomes per-hero — the fix), quest-log p22:86-89, drawLoreStone read p05:429, save
   p06:592, load p07:87/297. Wire cleanup: drop `loreFound` from the _qSeen gate
   (world.js:1371) and questPayload (1425) + mp.html adoptQuests line 186 — it rides `me`
   now. Migrate: `[]` (no per-hero source; stones re-readable = +XP once each, fine).
4. **wayfind** (7 sites) → `p.wayfind` (default true). Toggle keydown p07:261-264, readers
   drawWayfinder p05:545 + travel-marker p21:443, save p06:612/load p07:125. MP: the [O]
   toggle runs client-side inside the game's own keydown; reconcile re-stomps p.wayfind
   from `me` every snapshot → mp.html reconcile preserves the local value (1 line after
   :966: `S.player.wayfind = localWayfind`), keeping it a client pref; server copy is only
   the SP-save default. No RPC needed.
5. **seenHeatTip** (4 sites) → `p.seenHeatTip`. Write/read magicShot p11:185-190; save
   p06:613/load p07:126. Tip log() reaches the acting caster via the feed. Client: zero.
   Migrate: false (tip re-shows once per hero — intended).
6. **hasBoat** (6 sites) → `p.hasBoat`. buyBoat p23:250-265, toggleBoat gate p23:191,
   world.js `_doInstant` buyBoat reads S.hasBoat 887-893 → `p.hasBoat`; save p06:582/load
   p07:74/298. TODAY the boat is NOT in characterOf at all — MP boats evaporate on reboot
   and are communal while up; this fix also makes them persist. Migrate: false (no
   source; 250 g re-buy — cheap; optionally `true` if row's gold history… no, keep false).
7. **per-shopper shop session** → formalize `p._shopTown`/`p._shopStock` (already stamped
   by shopPayloadFor world.js:833-834) as THE session; move `state.activeShopTown/
   activeStock/activeShopName` (openShop p09:31-36; buyGood/sellGood read activeShopTown
   p09:453/468; renderShop reads stock/name p09:510/527/542) onto `p` (`p.shop = {town,
   name, stock}` or keep the three keys player-side). The rolled STOCK stays npc-owned
   (npc.stock — one town, one store; that sharing is correct). Deletes swapInPP's
   `_shopTown` special case (283). Client: mp.html:491 already sets the client-local
   copies from shopData — repoint to the player fields (1-line). Not persisted (session).

Save/load impact summary: snapshot() player block +7 fields → **v7** (p06:538); applySnapshot
reads with old-location fallback (mirrors the v5→v6 flags migration at p07:56-62, which is
the worked example of a lossless key relocation); characterOf carries them for free via
snap.player; migrateCharacter defaults per above.

---

## 4. onNewDay (#116)

- **Call path**: world.js:915 `G.updateTime()` runs BEFORE the rotation, so at the day tick
  `S.player`/PP slice is whoever the PREVIOUS tick last pinned (liberation sweeps 1252/
  1259/1271 → players[0], else the last dungeon/spawn hero). onNewDay p13:562-571 then
  fires per-player effects against that arbitrary hero:
  - `dailyHoldingIncome` p04:325-338 — `state.player.gold += tribute` (334): ONE stale
    hero receives the party's outpost income; the log is a personal line to them.
  - `legionDaily` p16:43-…: new-warlord level = `state.player.level + rand(3)` (~p16:59)
    — scales the Legion to a random hero, not the party.
  - `maybeRespawnDragon` p13:547-561 — gates on `state.dragon.tamed` (549), a PP key of
    the stale slice: one tamed hero parks the wild Emberwyrm for everyone.
  - `maybeRaidHolding` p04:339-… — `state.factions.dread` gate (shared today; per-player
    after fix #2 → needs a party read).
  - reviveCompanions p04:666 (all companions — fine), maybeRespawnHunts/Legion/Pinnacle
    p14:1/26, p23:106 (world state + _partyLevel — fine).
- **Fix shape**: split `onNewDay` into
  `onNewDayWorld()` — maybeRaiseNemesis (legionDaily reads
  `state._partyLevel || state.player.level`), maybeRaidHolding (dread gate =
  `max over party(p.factions.dread)`), reviveCompanions, respawn trio; dragon respawn
  gates on `party().some(p => !p.dragon.tamed)`; and
  `onNewDayHero(p)` — dailyHoldingIncome per hero (design call: EVERY hero draws the
  tribute — holdings are party assets and per-head pay matches the quests-went-per-player
  precedent; alternative: split evenly — decide at implementation, flag in release notes).
  `updateTime()` calls `onNewDayWorld(); for (p of party()) actAs(p, onNewDayHero)`.
- **SP identity**: party()=[player]; `_partyLevel` undefined → `state.player.level`
  fallback; dragon gate reduces to the old condition; income paid once. Golden's
  `day-rollover` scenario (divergence at tick 700) is the designed tripwire — it must
  stay hash-identical; the `hunt` perturb control keeps proving the boundary path.

---

## 5. Snapshot v2 (~20 Hz + AOI)

- **Knobs**: `BCAST_MS = 15` index.js:524 (used in simStep 546) → **50** (20 Hz). Sim HZ
  stays 80 (index.js:42). Client already smooths (pred + smooth maps, mp.html:989-997) —
  re-tune `_sk/_skp` divisors for 50 ms gaps.
- **AOI today**: `snapshotFor` is ALREADY per-player interest-culled at R2 = 46 tiles
  (world.js:1312, filters 1336-1349: enemies/proj/pickups/npcs/comps/allies/shrines/lore/
  pois; holdings ride tiny 1348). v2 tightens + gates:
  - Radius 46t → ~34t for enemies/proj/pickups/allies/comps (viewport half-diagonal ≈18t;
    34t keeps ~2× margin so 20 Hz entry latency can't pop-in).
  - Version-gate near-static arrays via the `_qN` stringify idiom (world.js:922-926,
    sizing rule in ARCHITECTURE): npcs (static after worldgen → join payload + gate),
    shrines/loreStones/pois (join + edge on clear/read/cd).
  - Slim `me`: inventory is the fat tail of safeClone(me) — gate it (`_invN/_invSeen`,
    stringify at `S.time % 40`), ALWAYS seeded in `welcome` and on takeover (the
    questPayload precedent, world.js:1410-1426 / index.js:415/423).
- **NEVER filtered/AOI'd** (the hidden-tab lesson, ARCHITECTURE "Snapshots & the wire"):
  quests/bounty/maxDepth gate (1367-1373), legion gate (1379-1382), feed (1354-1363),
  dgTiles transactional attach (1388-1394) + resendMap 1431, holdings, `me`, players list.
  These are edge-triggered: consumed in ws.onmessage client-side, seeded in `welcome`
  (takeover), transactional where loss is possible — 20 Hz makes drops MORE likely per
  payload, so the discipline tightens, it does not relax. Any new gated field follows the
  full pattern (gate + welcome seed + onmessage consume) or it will strand a tab.
- **Bandwidth estimate** (baseline: measured 10.88 KB snapshot; world.js:931-935 gives the
  calibration point — 991 B ungated ≈ 64 KB/s/player at 66 Hz):
  - Today: 10.88 KB × 66.7 Hz ≈ **~725 KB/s/player**.
  - 20 Hz alone: ≈ 218 KB/s (−70%).
  - +inventory gated (~−1.2 KB at rest) +npc/features gated (~−0.8 KB) +radius 46→34
    (enemy/proj bytes ×(34/46)² ≈ 0.55; ~−2.2 KB) → ~6.5 KB × 20 Hz ≈ **~130 KB/s/player
    at rest** (~5.5× cut). Change-ticks spike briefly (inventory edge ≈ +1.2 KB once).
  - Re-measure at each step: self-test `snapshot.kb` + `/health` snapMsAvg.

---

## 6. Save schema

- **Current versions**: game `snapshot()` **v6** (p06:538) — full SP save, retired with
  online-only at cutover but its `player`/`inventory` slices are what characterOf embeds.
  `accounts.character` = characterOf **v3** (world.js:544): `{v:3, name, level, skin,
  player: snapshot().player, inventory, shop:{shopPurchased,tonics,sharpenLevel,cargo,
  ingredients}, quests, maxDepth, bounty, dragon:{tamed}, companions[]}`.
- **v-next (v4)**: add `schemaVersion: 4` (reader accepts `c.schemaVersion ?? c.v ?? 1`);
  emitted by the player-native characterOf. Shape change: the `shop` slice and top-level
  quests/maxDepth/bounty/dragon FOLD INTO `player` as the keys move onto p (they arrive
  via snapshot().player automatically). Keep top-level name/level/skin (login/UI reads).
- **migrateCharacter(old) → v4 mapping** (pure module, e.g. `src/sim/save/migrate.ts`,
  extracted FROM `_loadCharacter`'s inline chains — v1→v2 quests world.js:616-643,
  v2→v3 milestones 646-672 — so the World applies, never migrates):

  | old (v1/v2/v3) | v4 |
  |---|---|
  | player.* (v6 whitelist p06:539-568) | player.* unchanged |
  | inventory | inventory (normItem on apply, as 578-584) |
  | shop.shopPurchased/tonics/sharpenLevel/cargo/ingredients | player.shopPurchased/tonics/sharpenLevel/cargo/ingredients |
  | quests (absent on v1 → synthesize per 625-637) | player.quests (shared main/frozen/legion still re-aliased ON APPLY, never persisted-authoritative — 638-642) |
  | maxDepth / bounty (absent v1 → 0/null) | player.maxDepth / player.bounty |
  | dragon.tamed | player.dragon = {tamed, mounted:false} |
  | companions[] | companions[] (same shape 556-560) |
  | player.enteredDungeon/gotKey/enteredFrozen (absent pre-v3 → synthesize per 651-671) | unchanged |
  | — (new, the 7 fixes) | player.visitedTowns:[] · player.factions:{0,0,0} · player.loreFound:[] · player.wayfind:true · player.seenHeatTip:false · player.hasBoat:false |

  Idempotence requirement: `migrateCharacter(migrateCharacter(x)) deep-equals
  migrateCharacter(x)` for every input version.
- **Round-trip test vs prod** (designed for Josiah to run; needs DATABASE_URL):
  - `scripts/db-dump.mjs` sketch: `pg` SELECT `name, character, updated_at` (token
    REDACTED to sha256 prefix — never dump the browser secrets), `--limit N`, writes
    `../eldermyr-db-backup/dump-<ISO>.json` **outside the repo** (REBUILD backup rule).
  - `tests/battery/migrate-roundtrip.js`: for each row (prod dump if
    `ELDERMYR_DUMP=<path>`, else committed synthetic v1/v2/v3 fixtures so CI always runs):
    migrate → assert schemaVersion 4 + invariants (level/gold/inventory counts preserved,
    quests keys ⊇ template, booleans well-typed) → idempotence → boot World, addPlayer
    with it, tick 100, characterOf → migrate again → deep-equal (modulo hp regen/x/y).
    Must be SEEN failing once (feed it a corrupted row / drop a field).

---

## 7. Conversion ladder (each slice: one agent; gate = golden 1p identical + battery green)

Battery names from tests/battery/MANIFEST.md. NEW harness work in S2.

- **S1 (FIRST — recommended)**: schemaVersion + `migrateCharacter` extraction (pure module
  mirroring _loadCharacter 610-672), characterOf emits v4, apply-path consumes migrated
  shape; `scripts/db-dump.mjs`; `migrate-roundtrip` suite (+synthetic fixtures); inert
  REMAP scaffolding in serialize.mjs (empty table + a unit proof that a remap entry
  round-trips). Zero sim-behavior change — golden untouched by construction. Gates:
  golden check, battery quest-pp-verify / flags-pp-verify / v4b-fullstack, new roundtrip
  suite. *Smallest honest step: it builds the safety floor every other slice stands on.*
- **S2**: `party()` helper in the game (p23:137 idiom, one definition) + **2-player golden
  rig**: new scenario kind `world` — child process seeds Math.random (prng.mjs), requires
  `server/world.js`, addPlayer A/B, scripted `p.held` per tick (self-test style,
  world.js:1450-1479), `w.tick()` × N, hash `{state, maps}` every 100 (excludes `this.*`
  room fields — feed/_errAt/hrtime live off-state). Record 2p baselines for
  overworld-combat + day-rollover analogues; prove sensitivity (speed perturb). Gates:
  golden 1p untouched, new mp-golden recorded + perturb-fails, battery green.
- **S3**: hazards fold — snow chill (p14:153-158 loops party), fires (p15 tile check),
  hostile-projectile hit-tests (p13 hostile branch), pinnacle party hazard; DELETE
  world.js patches 953-955, 1071-1089, 1090-1099, 1102-1126. Gates: golden 1p, mp-golden
  re-record (2p behavior intentionally identical-or-better — assert non-first player
  still takes damage; seen-failing by disabling the loop), t4-regression, verify_fixes,
  mp-pinnacle-verify.
- **S4**: onNewDay split (§4); world.js:915 unchanged. Gates: golden day-rollover
  identical; mp-golden 2p day-rollover baseline (asserts BOTH heroes' gold moves);
  vtune-verify, legion-mp-verify.
- **S5-S12**: **per-key retirement**, one slice per key group, ascending risk (site counts
  from grep): sharpenLevel(2)+tonics(6)+seenHeatTip(4) → wayfind(7)+hasBoat(6) →
  fishCd(11)+lastRestDay(7)+cargo(8)+shopPurchased(8) → ingredients(13) →
  visitedTowns(8)+shop-session(12) → sailing(13)+dragon(39) → factions(14)+loreFound(10)
  → maxDepth(20)+bounty(14) → **quests(53) last** (aliased SHARED_QUESTS is the trap —
  alias re-attach moves from world.js:111/513/641 into the sim's load/join path; assert
  object IDENTITY across players in mp-golden). Each slice: move sites + snapshot/
  applySnapshot + REMAP entry + drop the key's swapIn/writeBack lines + migrate default +
  client line if listed in §3. Gates per slice: golden 1p (via remap), mp-golden,
  battery quest-pp-verify/flags-pp-verify/sp-flags-check/verify_fixes/camp-* (fishing/
  rest keys)/style-verify (heat/seenHeatTip).
- **S13**: system loops in-sim (§2 A-shapes): updatePlayers rotation, enemy partition +
  __libGate retirement, allies/companions owner loops, projectile internalization, spawn
  pass. world.js `_step` shrinks to: clock/party stamps → `G.simTick()` per world (ow +
  sharedDg under grabWorld/putWorld) → downed pass → sweeps → feed. Possibly 2-3
  sub-slices (enemies; allies+companions; projectiles+spawn). Gates: golden 1p (the fns
  must degenerate to today's SP bodies), mp-golden re-record with paired-run proof,
  t1-t4, warband-delve, map-mp-verify, rift-check.
- **S14**: RPC path → runAs(p); delete PP_KEYS/swapInPP/writeBackPP/doCamp mirror/
  _shopTown bridge. Gates: golden untouched, verify-cleanup, verify_fixes, camp-exhaust,
  live 2-tab shop/smith/camp checklist.
- **S15**: snapshot v2 (§5): BCAST 50 ms, radius, inventory/npc/feature gates + welcome
  seeds. Gates: v4b-fullstack (extend to assert gated payloads arrive over a REAL socket
  + after a takeover), self-test kb budget, live hidden-tab test (headless cannot catch
  it — ARCHITECTURE lesson).
- **S16**: drop the REMAP table, re-record oracle.json native-shape (paired-run proof:
  parent-with-remap vs child-native hash-equal under the remap view); perturb controls
  re-proven. Battery full sweep.

---

## 8. Risk register (top 10)

| # | risk | detection gate |
|---|---|---|
| 1 | RNG draw-order drift in a converted loop (hoisted check, reordered spawn) | golden 1p hash diverges at the offending slice |
| 2 | REMAP table masks a real behavior change (not just shape) | `prove` perturb controls must FAIL after every remap addition; paired-run at S16 |
| 3 | killEnemy credits the wrong hero (order/pin regression) | mp-golden 2p combat baseline + quest-pp-verify (slay/bounty counters per hero) |
| 4 | quests move forks the shared war (private main/frozen/legion copy) | mp-golden identity assert (`pA.quests.legion === pB.quests.legion`), legion-mp-verify, quest-pp-verify |
| 5 | RPC handler runs without acting context after swap deletion (the §1 trap) | verify-cleanup/verify_fixes + new rpc-2p assertions (B buys, A's gold unchanged); live 2-tab |
| 6 | migrate loses a field / not idempotent → prod hero regresses at cutover | migrate-roundtrip vs real dump (S1); refuse-on-dbError already covers load errors |
| 7 | client ghost keys: mp.html explicit adopts (S.cargo 969, S.maxDepth 972, S.sailing 973, S.dragon 974, tonics/sharpen 856-857) recreate retired state.X, panels read stale copies | per-key slice includes the mp.html line audit (§3); facing-mp-verify/map-mp-verify; live 2-tab panel check |
| 8 | 20 Hz drops an edge payload → stuck client (quests/legion/dgTiles/inventory) | welcome-seed + transactional-flag pattern enforced per gate; extended v4b-fullstack over a real socket incl. takeover; live hidden-tab |
| 9 | dungeon world-swap vs native loops (a fn loops party() while only the dungeon is in S → hits topside heroes in wrong coordinates) | party() must be WORLD-SCOPED (partyIn(map)) from S3 on; t1-knockdown/t3-restore/warband-delve; parked-shots rule test |
| 10 | perf regression: N× loops + finer gates raise tick ms | /health tickMsAvg budget (~12.5 ms @80 Hz) in v4b-fullstack + perf-review gate before merge |

---

### Answers requested by the caller
- **First slice**: S1 — schemaVersion + pure migrateCharacter + db-dump script +
  round-trip suite + inert golden REMAP scaffolding (zero sim change, everything later
  stands on it).
- **3 riskiest conversions**: (1) `quests` per-key move (53 sites + SHARED_QUESTS
  aliasing + save/wire edges), (2) enemy-partition internalization (killEnemy credit,
  __libGate retirement, bucket order), (3) projectile internalization (self-repinning fn,
  hostile pass, parked-shots, per-bucket slice agreement).
- **grabWorld/putWorld**: STAYS (dungeon-vs-overworld instancing, not a player mechanism).
- **Snapshot v2 bandwidth**: ~725 KB/s/player today (10.88 KB × 66.7 Hz) → ~218 KB/s at
  20 Hz alone → **~130 KB/s/player at rest** with AOI tightening + gating (~5.5× cut).
- **Current snapshot version**: game `snapshot()` **v6** (p06:538); `accounts.character`
  (characterOf) **v3** (world.js:544) → proposed schemaVersion 4.
