# eldermyr-rpg.html — monolith map (for modularization)

Working map, not prose. Line numbers are `eldermyr-rpg.html` at v2.59.2 (2486 lines / 498 KB).
Read alongside `ARCHITECTURE.md` (load-and-orchestrate, PP_KEYS, snapshot) — this file adds the
line-level geography that doc deliberately omits.

## Reading hazards (verified, not folklore)
- Script is **one flat `<script>` 258–2485**; HTML/CSS above (style 7–114, DOM panels/canvas 116–257).
- **Top-level `function` decls are one-per-line** (no line carries two `function` keywords) — but their
  **bodies collapse onto single enormous lines**: killEnemy's body is the 5835-char line 1545;
  drawEnemy is 2068–2284 (216 lines, one creature-art `switch`); genShopStock/renderShop/applySnapshot
  each ~2–4 KB single lines. A grep hit is mid-statement; read the whole line before concluding.
- **Top-level `const` can pack several decls via `;`** (e.g. 1622 = SEASONS + SEASON_LEN + SEASON_ICON).
- **Canvas `ctx` purity is GOOD** — `ctx.` appears only in draw*/render*/fitCanvas. The `ctx.` hits at
  735–738 are the **Web Audio** context inside `Sound`, not canvas. The real cross-cut is AUDIO, not canvas.
- Everything calls everything by **bare lexical name** (no namespace object). This is load-bearing for BOTH
  MP load paths (server captures lexical bindings; client relies on decls being `window.*`).

---

# 1. Section inventory (file order)

## constants / config
- 619 `GAME_VERSION`; 621 `canvas`, 622 `ctx`, 624 `TILE`=32, 625 `VIEW_W/VIEW_H/ZOOM`(let), 626 `lightCanvas/lightCtx`(let)
- 629 `fitCanvas()` resize; 642 resize listener
- 644 `T{}` tile enum, 645 `SOLID` set, 646 `OW_W/OW_H`=347×291, 650 `RING_SAFE/RING_MID/WL_MIN_DF`, 653 `LEASH_MARGIN`
- 654 `maps{overworld,dungeon}`(const, slots reassigned), 655 `townZones=[]`(let, **rebound at worldgen**)
- 656 `SAVE_KEY`, 659 `SaveStore{}` IndexedDB wrapper (localStorage fallback 268/289), 673 `autosaveStarted`(let)
- 675 `RARITIES[]`, 682 `rarityName`, 683 `rarityColor`, 684 `STYLE_NAMES`, 685 `ARMOR_NAMES`, 686 `RAR_PREFIX`
- 726 `MUSIC{}`; 806 `MASTERY`, 807 `MASTERY_LVLS`; 829 `PATTERN_WEAPONS[]`
- 907 `DUNGEON_THEMES[]`; 962 `POI_KINDS{}`; 1038 `HOLD_SITES[]`(3 outposts, fixed tx/ty)
- 1071 `COMP_CLASSES`, 1076 `COMP_NAMES`, 1077 `COMP_CAP`=3; 1124 `REGION_SUBS`, 1125 `LORE_TEXTS`
- 1229 `FLOOR_MODS`; 1321 `ABILITY_RMAX`; 1335 `SHOP_NAMES`, 1342 `SHOP_WEAPONS`, 1357 `SHOP_ARMOR`
- 1388 `TRADE_GOODS`, 1389 `FORAGE_VALUE`; 1457 `BLESS`, 1458 `BLESS_DUR/SHRINE_CD`
- 1513 `HEAT_AURA_MIN/TICKS`, 1527 `AURA_ELEM_OPT`; 1572 `DAY_FRAMES`; 1575 `FACTIONS`, 1576 `REP_TIERS`, 1577 `DREAD_TIERS`
- 1589 `NEMESIS_NAMES`, 1590 `NEMESIS_TITLES`; 1622 `SEASONS/SEASON_LEN/SEASON_ICON`, 1623 `SEASON_TINT`
- 1629 `INGR`, 1630 `FOODS`, 1631 `FOOD_LABEL`; 1671 `STATUS_DESC`
- 1723 `WL_FIRST`,1724 `WL_EPITHET`,1725 `RANK_NAMES`,1726 `WL_STRENGTHS`,1727 `WL_WEAKNESS`,1728 `REGION_NAMES`
- 1788 `ELEMENTS`; 1856 `AFX_DEFS`, 1857 `AFX_KEYS`; 2066 `FACING{dragon,serpent,charger}`, 2067 `FACE_DZ`
- 2315 `HUB_TABS`; 2365 `DRAGON_LEVEL`=30, 2370 `DRAGON_COLOR`, 2374 `GREAT_HUNTS`
- 2391 `PIN_ARENA_*`, 2398 `PIN_LEVEL`=75, 2403 `UNIQUES`, 2412 `PINNACLE_BOSSES`
- 2462 `FINAL_DEPTH`=10, 2463 `LEGACY_KEY`, 2477 `clamp`, 2478 `rectOverlap`, 2479 `rectDist` (geom utils)

## state shape
- 688 `let state={}` (initializer 688–722, keys in §2); 723 `keys{}`,`currentDialogue`,`interactCd`(let)

## audio  (see Purity — stubbed server-side)
- 733 `Sound{}` Web-Audio synth: `init/resume/play/startMusic`, **music sequencer setInterval 757**, mute→localStorage 759
- 761 `updateAudioIndicator` (DOM); 1655 `musicMoodFor`, 1657 `updateMusicMood`, 1659 `updateAmbience`

## particles / FX
- 764 `particles/shake/hurtFlash/shockwaves`(let); 765 `addShake`,766 `pushShock`,767 `spawnBurst`,768 `updateParticles`,769 `drawParticles`,770 `applyShake`,775 `ultimateNova`,782 `drawShockwaves`; 1789 `arcs`(let),1795 `spawnArc`,1803 `drawArcs`

## item / weapon / stat helpers
- 785 `equippedWeapon`,786 `equippedArmor`,787 `styleOf`,788 `styleLabel`,789 `styleTag`,791 `itemGlyph`
- 792–802 mults: `hasteMul/profLvl/profSpeedMul/profHasteMul/weaponCd/magicCd/magicCost/weakCastCost/isBroken/brokenMult/profMult`
- 803 `canEquip`,804 `normItem`,808 `masteryLvl`,809 `hasPerk`,810 `gainProf`(Sound),811 `sellValue`
- 817 `rollRarity`,819 `rollAffixes`,820 `afxText`,821 `affixHtml`,822 `uniqHtml`,823 `genWeapon`,824 `genArmor`,834 `rollPatternWeapon`,835 `ensureCycleAffix`

## worldgen
- 838 `townCenter`,839 `isInTown`,840 `biomeMap/houseTiles`(let, **rebound**),841 `frozenLimit`,842 `distFactor`,847 `diffMul`,849 `townTier`,850 `townInfo`,851 `isFrozenTile`,852 `isLavaTile`,853 `tileBiome`
- 854 `generateOverworld` (writes townZones/biomeMap/maps.overworld),858 `cluster`,881 `walk`,882 `carvePath`,898 `findOpenTile`
- 899 `reachableOW`(let),900 `computeReachableOW`,901 `isReachableOW`,902 `findWildTile`,903 `wildTileInRange`,904 `findWildTileNear`,905 `clearAround`
- 913 `dungeonTheme`,914 `generateDungeon` (writes maps.dungeon + state.vault/dungeonThemeData)
- 1163 `setupOverworld` (orchestrates worldgen+spawns; also genShop caches),1174 `placeNPC`,1230 `rollFloorMod`,1231 `setupDungeonFloor`

## entity factories
- 931 `makeEnemy`,941 `makeBoss`,942 `makeWildEnemy`,954 `makeDungeonEnemy`,955 `makeDungeonBoss`,956 `makeNPC`,957 `makePickup`
- 2371 `makeWildDragon`,2372 `makeKraken`,2382 `makeGreatBeast`,2409 `makeUnique`,2416 `pinnacleLair`,2417 `makePinnacleBoss`,2420 `makePinnacleAdd`
- 1731 `mkWarlord`,1740 `makeWarlordEnemy`,1859 `rollEliteAffixes`,1880 `makeElite`,1882 `maybeSpawnWild`,1881 `spawnPackAround`,969 `spawnPoiEnemy`

## POI / holdings / companions / legion-quest content
- 968 `findWildTileInBand`,973 `placePOI`,977 `setupPOIs`,987 `clearPOI`(**__libGate**),995 `onPoiCleared`,1000 `advanceLegionQuest`,1005 `completeLegionQuest`,1008 `elderLines`
- 1039 `initHoldings`…1056 `maybeRaidHolding` (holdings lifecycle: 1047 `liberateHolding`**gated**,1049 `rebuildOutpost`,1054 `upgradeOutpost`,1055 `dailyHoldingIncome`,1068 `doTravelHold`)
- 1078 `compStatsFor`…1098 `compMeleeHit`,1099 `compRangedShot`,1100 `updateCompanions`,1082 `makeCompanion`,1084 `recruitCompanion`,1087 `setupCompanions`,1088 `bumpCompanionLevels`,1089 `reviveCompanions`,1096 `garrisonCompanion`
- 1130 `findWildTileInRegion`,1131 `placeLoreStones`,1132 `readLoreStone`,1140 `compass8`,1141 `currentObjective` (wayfinder resolver)

## economy / quests / factions / shrines
- 1336 `genShopStock`,1358 `tonicCost`,1390 `townEcon`,1391 `seasonGoodMod`,1392 `goodBuyPrice`,1393 `goodSellPrice`,1394 `buyGood`,1395 `sellGood`,1396 `sellIngredient`
- 1414 `buyPotion`,1415 `buyTonic`,1416 `buyWeapon`,1417 `buyArmor`,1418 `sellItem`,1419 `afterBuy`,1422 `repairCost`,1431 `temperWeapon`,1432 `reforgeWeapon`,1433 `fuseWeapon`,1450 `repairItem`,1451 `repairAll`,1453 `drinkPotion`
- 1459 `activateShrine`,1460 `tickBlessing`,1462 `rollBounty`,1464 `bountyProgress`; 1285 `sellAllJunk`,1284 `isJunk`
- 1578–1588 faction/rep: `repTierIdx/dreadTierIdx/facTierIdx/facTierName/addRep/vigilDiscount/wildsFireResist/beastAggroMul/dreadLootBonus/buyPrice`
- 2353 `updateQuests`(DOM), quest state lives in `state.quests` (PP slice)

## per-frame systems (update*/tick*)  [driven by loop()@2481]
loop play-phase order: `updateTime, updatePlayer, updateEnemies, updateAllies, updateCompanions,
updateProjectiles, maybeSpawnWild, maybePinnacleBosses, updateParticles, updateFires, updateWeather,
updateEvents, updateFactionWar, updateWarband, updateFatigue, updateNemesisPresence, updateWorldLine,
updateMusicMood, updateAmbience` → then `updateCamera` + render.
- 1568 `updatePlayer` (movement/input-apply/style-resources/camp),1598 `updateTime`,1600 `onNewDay`,1615 `updateWeather`,1635 `tickFood`,1637 `tickCampRest`,1639 `tickFishing`,1649 `updateFatigue`
- 1704 `updateEvents`,1716 `updateFactionWar`,1745 `updateNemesisPresence`,1770 `updateAllies`,1785 `updateWarband`,1808 `updateCharger`,1821 `updateBoss`,1829 `updateEnemies`,1696 `updateFires`,1802 `tickEnemyStatus`
- 1515 `updateStyleResources`(momentum/heat, called per-player),1528 `updateHeatAura`,1599/1605/1606/2444 `maybeRespawn*`,2445 `maybePinnacleBosses`

## projectiles / combat / status
- 1479 `dirVec`,1480 `addProjectile`,1482 `projParams`,1485 `magicShot`,1493 `projImpact`,1499 `hasLineOfSight`,1500 `seekTarget`,1501 `steerSeek`,1553 `projHitsRect`,1554 `updateProjectiles`
- 1502 `tryAttack`,1503 `castSpell`,1506 `doDodge`,1507 `playerDmgMul`,1508 `execMul`,1509 `applyLifesteal`,1512 `heatAmp`,1532 `onHitDealt`,1534 `meleeSwing`
- 1536 `notableEnemy`,1537 `killEnemy` (**quest/bounty/drop credit → swapped-in PP slice**),1546 `tryDropLoot`,1550 `xpForLevel`,1551 `gainXP`,1552 `playerTakeDamage`(returns dmg),1560 `checkPickups`
- 1790–1802 elemental: `elemColor/elemRgb/elemHtml/isUndead/statusDamage/applyElementOnHit/tickEnemyStatus`
- 1858 `afxCount`,1868 `afxHit`(**the one damage gate**),1873 `afxVampHeal`,1874 `enemyStrike`,1875 `afxSplitDeath`
- 1811 `bossSpecials`,1812 `spawnRing`,1813 `startBossSpecial`,1814 `execBossSpecial`,1850 `nightBuff`,1806 `stepToward`,1807 `healAlly`
- 1667 `igniteTile`,1697 `drawFires`,1698 `checkHazardFall`; 1701 `triggerEvent`,1711 `startDreadRaid`,1712 `liberateTown`(**gated**),1714 `spawnVigilPatrol`,1715 `startStampede`
- 1729 `NEM_PICK`,1732 `genLegion`(client-stubbed),1733 `legionRoster`,1735 `maybeRaiseNemesis`,1744 `spawnWarlord`,1755 `defeatNemesis`,1760 `nemesisGrows`
- 1763 `canDominate`,1764 `dominate`,1765 `dominateElite`,1766 `dominateWarlord`,1767 `thralls`,1768 `summonAlly`,1769 `useSummon`,1779 `promoteThrall`,1781 `togglePost`,1782 `sendRaid`,1783 `resolveRaid`,1784 `ensureBodyguards`
- 1320 `spendPoint`,1322 `abRank`,1323 `unlockAbility`,1324 `useWhirlwind`,1325 `useFocus`,1328 `useUltimate`

## cooking / fishing / fatigue / camp / time
- 1593 `curDay`,1594 `dayFrac`,1595 `darkness`,1596 `isNight`,1597 `timeLabel`,1624 `seasonIdx`,1625 `curSeason`,1626 `isWinter`
- 1632 `gainIngredient`,1633 `canCook`,1634 `cook`,1638 `tryFish`,1641 `resetFishing`,1642 `resolveFishing`,1643 `nearWater`,1646 `daysSinceRest`,1647 `isExhausted`,1648 `doCamp`

## interact / dungeon / dialogue
- 1465 `tryInteract`,1466 `tryEnterDungeon`,1467 `enterDungeon`,1468 `openKeyVault`,1469 `descend`,1470 `exitDungeon`
- 1473 `startDialogue`,1474 `showDialogueLine`,1475 `advanceDialogue`,1476 `endDialogue`

## render (draw*)  [ctx-confined — clean]
- 1888 `updateCamera`,1891 `drawTile`,1927 `drawPlayer`(art 1927–2031),2033 `shade`,2048 `rgbOf`(2032/2047 memo caches)
- 2068 `drawEnemy` (**biggest art block, 2068–2284, all 11 creatures**),2285 `drawNPC`,2286 `drawShrine`,2287 `drawPickup`,2288 `nearInteractable`,2289 `drawProjectile`
- 1019 `drawPOI`,1061 `drawHolding`,1109 `drawCompanion`,1129 `drawMoodTint`,1133 `drawLoreStone`,1151 `drawWayfinder`,1609 `drawLighting`,1619 `drawWeather`,1627 `drawSeasonTint`,1776 `drawAlly`
- 2298 `buildMinimapBase`,2299 `drawMapMarkers`,2310 `drawMinimapTo`,2311 `updateMinimap`,2312 `openFullMap`,2329 `enemyVisible`,2334 `renderWorld` (top render entry)

## UI / HUD / menus (DOM)
- 1266 `log` (**feed; rewrapped → __onLog server-side**),1263 `showSavedToast`,1127 `showRegionBanner`,1664 `updateWorldLine`
- 1277 `toggleInventory`,1286 `renderInventory`,1296 `equipWeapon`,1297 `equipArmor`,1298 `recalcStats`,1301 `degrade`
- 1304 `toggleSkills`,1305 `renderSkills`,1327 `ultLabel`; menu open/close/render pairs: 1359 `openShop`/1398 `renderShop`, 1363 `openTravel`/1384 `renderTravel`/1386 `doTravel`, 1365 `openLegion`/1367 `renderLegion`, 1371 `openCook`/1373 `renderCook`, 1374 `openHunts`/1379 `renderHunts`, 1376 `openTrophy`/1378 `renderTrophy`, 1380 `openFactions`/1382 `renderFactions`, 1423 `openSmith`/1434 `renderSmith`, 1112 `openCompanions`/1114 `renderCompanions`, 1463 `openBounty`
- 1533 `updateStaminaBar`,1687 `updateCombatHud`(1672 `chStatusPill`,1673 `chAbPill`,1675 `chStyleRow`),2351 `updateEnergyBar`,2352 `updateHUD`,2320 `updateHubTabs`,2316 `hubIdxOfScene`,2317 `closeHubPanels`,2318 `openHub`,2319 `switchHubTab`,2313 `closeFullMap`
- 1547 `floatDamage` (**combat→DOM: getElementById('game-wrap')+createElement+setTimeout**)

## save / load / legacy
- 1255 `saveOverworld`,1256 `loadOverworld` (SP dungeon round-trip; MP uses grabWorld/putWorld)
- 1259 `snapshot` (**the durable per-hero contract — v6**),1260 `applySnapshot`(zeroes style-resources),1261 `saveGame`,1262 `loadGame`,1264 `ensureAutosave`(**setInterval, latched off headless**)
- 2464 `legacy`(let),2465 `loadLegacy`,2466 `saveLegacy`,2467 `computeScore`,2468 `recordRun`,2469 `legacyLineHtml`

## input
- 642 resize→fitCanvas; 1269 `keydown` (main input dispatch: movement/attack/menu hotkeys); 1270 `keyup`
- 1271 start-btn→startGame; 1272 continue-btn→loadGame; 2311 minimap `onclick`→openFullMap; 2482 `visibilitychange`
- (No canvas mouse listeners — aim/attack is keyboard-directional via `keys{}` + `player.dir`.)

## boot / main loop
- 1273 `startGame`,1274 `startLoaded`,2470 `victory`,2471 `resumeAfterVictory`,2473 `gameOver`(**SP-only consequences; server no-ops via __onGameOver**),2474 `clearSaveAndRestart`,2475 `confirmNewGame`
- 2481 `loop` (**requestAnimationFrame; server drives ticks manually instead**),2483 `init` async,2484 `init()` call

---

# 2. `state` object — top-level keys (~79)

Tag key: **[pp]**=in PP_KEYS (swapInPP/writeBackPP slice) · **[world]**=WORLD_SLOTS (grab/putWorld swap) ·
**[shared]**=single S, never swapped · **[pp*]**=per-player via a *separate* mechanism · **[+]**=added
after the initializer (not on lines 688–722).

Initializer (688–722):
- `scene`[shared] · `map`[world] · `player`[pp* S.player=p] · `inventory`[pp* S.inventory=p.inventory]
- `enemies`[world]·`npcs`[world]·`pickups`[world]·`projectiles`[world] — also **partitioned per-owner/shooter** in tick
- `owSave`[shared, **vestigial in MP**] · `dungeonLevel`[world] · `dungeonEntrance`[world] · `maxDepth`[pp]
- `spawnTimer`/`maxWildEnemies`[shared] · `tonics`[pp]·`sharpenLevel`[pp]·`shopPurchased`[pp]·`cargo`[pp]·`ingredients`[pp]·`fishCd`[pp]·`sailing`[pp]·`dragon`[pp]·`quests`[pp]·`bounty`[pp]·`lastRestDay`[pp]
- `visitedTowns`[shared ⚠]·`shrines`[shared]·`pois`[shared]·`holdings`[shared]·`companions`[pp* characterOf+partition]·`loreFound`[shared ⚠]·`factions`[shared ⚠]·`allies`[pp* partition by `_owner`]·`hasBoat`[shared ⚠]·`wayfind`[shared ⚠]·`activeShopTown`[pp* via `p._shopTown` in swapInPP]
- `flags`[shared] = ONLY `krakenDead`/`legionBroken` world facts (milestones moved to state.player)
- `camera`[shared]·`time`[shared]·`weather`/`weatherTimer`[shared]·`fires`/`events`/`eventTimer`[shared]·`seenHeatTip`[shared ⚠]·`nemesis`[shared]·`ascension`[shared]·`won`[shared]

Added after init [+]:
- `vault`[world]·`dungeonThemeData`[world]·`floorMod`[world] (set per-floor by generateDungeon/setupDungeonFloor)
- worldgen: `ocean`,`islands`,`krakenArena`,`dragonLair`,`drownedLair`,`shepherdLair`[all shared, regenerated per boot]
- shared world progress (in snapshot, reach client via Trophy-Wall RPC / version-gated payload): `huntsSlain`,`huntCycle`,`huntRespawnDay`,`pinnacleSlain`,`pinnacleCycle`,`pinnacleRespawnDay`,`uniquesFound`,`dragonRespawnDay`,`legion`,`legionCycle`,`legionRespawnDay`
- timers/caches [shared]: `warTimer`,`legionTimer`,`_pinCheckT`,`_lastRegion`,`_partyLevel`,`_partyN`,`players`(MP roster; undefined in SP→`[state.player]`)
- UI transient: `activeShopName`,`activeStock`[shared ⚠ shop stock],`hubTab`[client-local],`loreStones`[shared]

### state.player scalars  → all **[player-scalar]** (ride `me` free; §ARCHITECTURE Pillar-1)
~60 fields (690–710). MP-relevant subsets:
- **Milestones** `enteredDungeon`,`gotKey`,`enteredFrozen` (moved OFF flags → per-hero, persisted).
- **Style-resources (transient, zeroed on load, NOT in snapshot):** `momentum`,`riposteT`,`_momoDecay`,`heat`,`_heatCool`,`_auraCd`,`_auraEl`,`_lastMarkN`,`_markShowT`,`_lastStyle`; unique flags `cloaked`,`_stillT`,`uLance`/`uFrostNova`/`uBell`/`uCloak`; `_shopTown`.
- Durable stats/prof/abilities: hp/maxHp/xp/level/gold/atk/def/energy/stamina/prof{}/abilities{}/abilityRank{}/food buff.

### Counts
- **[pp] (PP_KEYS): 12** — shopPurchased, tonics, sharpenLevel, cargo, ingredients, lastRestDay, fishCd, sailing, dragon, quests, maxDepth, bounty.
- **[world] (WORLD_SLOTS): 10** — map, enemies, pickups, npcs, projectiles, dungeonLevel, dungeonEntrance, dungeonThemeData, floorMod, vault.
- **[pp*] separate mechanism: 5** — player, inventory, activeShopTown, companions, allies.
- **[shared] everything else: ~52** (most intentional world facts).

---

# 3. Purity audit — sim-side functions touching DOM / canvas / audio / storage

**Canvas (`ctx`): CLEAN.** Only draw*/render*/`fitCanvas`@629 touch `ctx`. No update*/combat function draws.

**DOM (getElementById/document) from sim/combat — the entanglements:**
| fn | line | touches |
|---|---|---|
| `floatDamage` | 1547 | `getElementById('game-wrap')`, `canvas.getBoundingClientRect()`, createElement — **called from killEnemy/playerTakeDamage/gainXP** |
| `log` | 1266 | feed DOM; **but rewrapped lexically → `__onLog`** (server seam) |
| `updateStaminaBar` | 1533 | HUD el (called in updatePlayer path) |
| `updateCombatHud` | 1687 | HUD els (per-frame) |
| `updateWorldLine` | 1664 | HUD el (per-frame in loop) |
| `updateEnergyBar`/`updateHUD`/`updateQuests` | 2351/2352/2353 | HUD els (per-frame) |
| `updateMinimap`/`updateHubTabs` | 2311/2320 | canvas+DOM (per-frame) |
All render/menu open*/render* also DOM — expected, not sim.

**Audio (`Sound.*`) — THE cross-cut. ~90 functions call it directly, incl. hot sim path:**
`killEnemy`1537, `playerTakeDamage`1552, `updateProjectiles`1554, `updateEnemies`1829, `updatePlayer`1568,
`checkPickups`1560, `meleeSwing`1534, `tryAttack`1502, `castSpell`1503, `projImpact`1493, `gainXP`1551,
`doDodge`1506, `afxHit`1868, `updateAllies`1770, `updateCharger`1808, `startBossSpecial`1813, `execBossSpecial`1814,
`defeatNemesis`1755, `checkHazardFall`1698, `updateFatigue`1649, `maybeRespawn*`, `triggerEvent`1701, all economy
(`buyGood/afterBuy/temperWeapon/reforgeWeapon/fuseWeapon/repairItem/drinkPotion/activateShrine`…). No event bus.
Server survives only because `Sound` is a **stub object** (load-game) → every call no-ops.

**localStorage:** 268/289 (SaveStore IndexedDB fallback), 759 (Sound mute pref), 1264 `ensureAutosave` (autosave interval, **latched off headless**), 2483 `init` (mute). Not in hot sim path.

---

# 4. Cross-cutting globals (read/written everywhere)
- `state` — the one shared mutable object; every category reads/writes it directly (no accessor).
- `ctx`, `canvas`, `VIEW_W/VIEW_H/ZOOM`, `lightCanvas/lightCtx` — render singletons; `floatDamage` also holds `canvas`.
- `TILE`, `T`(tile enum), `SOLID`, `OW_W/OW_H` — geometry, read by worldgen+sim+render.
- `maps` (const object, slots reassigned), `townZones`(let, **rebound at worldgen → exposed via getTownZones server-side**), `biomeMap`, `houseTiles`, `reachableOW` — worldgen outputs read by sim+render.
- `keys{}` — input state, read by updatePlayer + hotkey dispatch.
- `Sound` — audio singleton (stubbed server-side).
- Module-level FX lets: `particles`,`shake`,`hurtFlash`,`shockwaves`,`arcs`,`weatherParts`,`hitStop`.
- `GAME_VERSION`, `legacy`, `RARITIES`, `ELEMENTS`, `FACTIONS`, `MASTERY` — const tables read broadly.

---

# 5. Proposed first-cut seam + hardest entanglements

## bucketing (first pass)
- **sim/** — updatePlayer, updateEnemies/updateBoss/updateCharger, updateProjectiles+projImpact, combat
  (tryAttack/castSpell/meleeSwing/killEnemy/playerTakeDamage/afxHit/enemyStrike/applyElementOnHit), style-resources,
  time/weather/season, fatigue/cook/fish/camp ticks, factions/nemesis/legion/warband/allies, events/faction-war,
  respawns, movement/tile predicates. **state factories** (makeEnemy…makePinnacleBoss) → straddle sim+content.
- **content/** — all const tables (§1 constants), worldgen (generateOverworld/Dungeon, setup*, POI/holdings/lore
  placement), shop stock/trade tables, drop/loot tables, dialogue lines (elderLines), legacy scoring.
- **render/** — draw* + renderWorld + updateCamera + minimap/fullmap + lighting/weather/season/mood tints + shade/rgbOf.
- **ui/** — DOM HUD (updateHUD/updateQuests/updateCombatHud/updateEnergyBar/updateStaminaBar/updateWorldLine), all
  menu open/close/render, hub, toasts/banners, wayfinder HUD, floatDamage(needs re-homing — see #2).
- **audio/** — Sound + music/ambience mood; every current `Sound.*` sim call becomes an emitted event.
- **boot/** — init, loop, startGame/startLoaded, save/load (snapshot/applySnapshot/SaveStore), input listeners,
  victory/gameOver, mount/boat/dragon toggles.

## 10 hardest entanglements
1. **Bare-lexical cross-calls are the MP contract.** Server `CAPTURE` grabs lexical bindings; client relies on
   top-level `function` decls being `window.*`. An ESM/module split silently breaks BOTH load paths — the whole
   flat scope is load-bearing, not incidental. (ARCHITECTURE "the gotcha").
2. **Audio is woven through the sim** (~90 `Sound.*` call sites incl. killEnemy/playerTakeDamage/updateEnemies).
   No emit layer; sim can't leave without an event bus or a permanent Sound stub.
3. **`floatDamage`@1547 = combat→DOM.** killEnemy/playerTakeDamage/gainXP call it; it reaches into
   `getElementById('game-wrap')` + `canvas.getBoundingClientRect()`. Sim holds a DOM+canvas ref mid-combat.
4. **HUD updaters live inside the tick.** loop() calls updateWorldLine/updateMusicMood/updateAmbience each frame and
   updatePlayer drives stamina/combat-HUD — sim tick and DOM writes share one call tree.
5. **`state` is a single 79-key global mutated by everyone**, no accessor boundary; sim+render+ui all read
   state.player/enemies/camera directly. WORLD_SLOTS swap + PP swap depend on it staying a flat mutable object.
6. **grabWorld/putWorld swaps flat state keys + `maps.dungeon`** and render reads the same live slots — encapsulating
   world state must keep exactly WORLD_SLOTS swappable by the server, in a `finally`.
7. **Worldgen rebinds module-level `let`s** (townZones/biomeMap/reachableOW/maps) that sim AND render read;
   server already needs a live getter for townZones. Any content/ move must keep the rebinding observable to both.
8. **Menu/economy fns fuse state-mutation + DOM render + audio** (openShop→genShopStock+renderShop; buyWeapon/
   temperWeapon mutate inventory, play Sound, re-render). MP already had to bolt on an RPC_OK allow-list around them;
   the game fns still do all three jobs at once.
9. **killEnemy credits whatever PP slice is swapped in** (quests/bounty/drops). Splitting combat must preserve the
   swap-in discipline — a moved kill-credit line silently credits the wrong hero (ARCHITECTURE's recurring bug).
10. **Entity factories straddle sim+content** (makeEnemy…makePinnacleBoss read partyLvl/flat-level constants and set
    combat scalars). They can't cleanly land in content/ (they encode combat rules) nor sim/ (they encode spawn data).

---

# 6. Findings for the caller

**10 hardest entanglements:** see §5 (bare-lexical MP contract, audio-in-sim, floatDamage DOM-in-combat,
HUD-in-tick, one giant `state`, grab/putWorld flat-slot swap, worldgen `let`-rebinding, menu fns fusing
state+DOM+audio, killEnemy PP-slice credit, factory sim/content straddle).

**Per-player vs world counts (top-level state):** [pp] PP_KEYS = **12**; [world] WORLD_SLOTS = **10**;
[pp*] separate mechanism = **5** (player, inventory, activeShopTown, companions, allies); [shared] = **~52**.
Plus ~60 [player-scalar] fields on state.player (milestones + transient style-resources ride `me` free).

**State keys NOT covered by PP_KEYS/WORLD_SLOTS that are in `snapshot()` (durable) yet shared at runtime — the
latent-MP class ARCHITECTURE already fixed for `flags`, not yet for these:**
- `visitedTowns` — fast-travel unlocks are communal (one hero unlocks all).
- `factions` — one shared reputation pool for the whole party.
- `loreFound` — lore-stone discoveries communal.
- `wayfind` — the [O] wayfinder toggle is global (one player's toggle flips everyone's).
- `seenHeatTip` — one-time tutorial tip; only the first player to heat up ever sees it.
- `hasBoat` — boat ownership communal (while `sailing` is [pp]).
- `activeStock`/`activeShopName` — shop stock is shared S (activeShopTown IS per-player via `_shopTown`, but the
  rolled stock array isn't) — two simultaneous shoppers may collide.
Each is durable-per-hero on save but single-shared at runtime — the exact incoherence that sent a level-45 hero
back to the Sunken Dungeon before milestones moved to state.player.

**Surprises a refactorer should brace for:**
- Canvas `ctx` is already clean (draw/render only); the pervasive cross-cut is **AUDIO**, not rendering.
- Functions are one-per-line-declared but bodies are single 2–6 KB lines (killEnemy=line 1545 @5835 chars;
  drawEnemy art = 216 lines); never trust a grep hit as a statement boundary.
- Some `const` lines declare 2–3 symbols via `;` (1622).
- `owSave` (+ saveOverworld/loadOverworld) is largely vestigial under MP's grabWorld/putWorld shared dungeon.
- `companions` is genuinely per-player but rides characterOf + a tick-time partition, NOT PP_KEYS — don't "fix" it in.
- 4 repeating timers exist (music seq 757, autosave 1264, banner 1127, floatDamage 1547) — load-game latches the
  first two off; a new game-side setInterval needs an explicit headless decision.
- `state.players`/`_partyLevel`/`_partyN` are MP-injected; SP paths default them so behavior stays byte-identical.
