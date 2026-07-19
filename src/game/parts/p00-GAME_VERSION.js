// P1c GLOBALS HOLDER — every module-level let that is REBOUND after init lives here as a
// slot (under ES modules, assignment-to-an-import is illegal, so rebindable state must sit
// on one mutable object). Slots are pre-listed for build-time discovery; each is initialized
// at its ORIGINAL program position (search "__g." below) so execution order is unchanged.
// Exposed as globalThis.__g for the headless loaders (server/load-game.js, client/mp.html).
const __g = {
  VIEW_W: undefined,
  VIEW_H: undefined,
  ZOOM: undefined,
  lightCanvas: undefined,
  lightCtx: undefined,
  townZones: undefined,
  autosaveStarted: undefined,
  currentDialogue: undefined,
  interactCd: undefined,
  shake: undefined,
  hurtFlash: undefined,
  biomeMap: undefined,
  houseTiles: undefined,
  reachableOW: undefined,
  poiSeq: undefined,
  _bannerTimer: undefined,
  _bannerUntil: undefined,
  moodR: undefined,
  moodG: undefined,
  moodB: undefined,
  moodA: undefined,
  hitStop: undefined,
  _wasExhausted: undefined,
  _musicCheck: undefined,
  _ambT: undefined,
  minimapBase: undefined,
  minimapBaseWinter: undefined,
};
globalThis.__g = __g;
// ===== VERSION =====
// Bump GAME_VERSION on EVERY change so you can tell if you're on the latest build.
// Shown on-screen (bottom-center) across the title, play, and death screens.
//   v0.1.0          — pre-versioning baseline (original game)
//   v0.2.0  2026-06-25 — reachability softlock fix, level-weighted wild enemies,
//                        perf cleanups (double-camera, redundant saves), on-screen version display
//   v0.3.0  2026-06-25 — responsive full-window canvas (fills the screen, crisp at any DPI),
//                        keeps ~15-tile vertical framing, centers maps smaller than the view
//   v0.4.0  2026-06-25 — log box more transparent + fits all text (clips oldest, not newest);
//                        SAVE now falls back to localStorage so it auto-saves in any browser
//   v0.5.0  2026-06-25 — JUICE: procedural WebAudio SFX + ambient music (M to mute, persisted),
//                        screen shake, hit/death/pickup particles, level-up burst, hurt vignette
//   v0.6.0  2026-06-25 — combat variety: 3 new enemies (charger/archer/healer) with distinct AI;
//                        telegraphed boss specials (slam AoE, charge, projectile nova, summon)
//   v0.7.0  2026-06-25 — elements & status effects: weapons roll fire/frost/poison/shock; hits apply
//                        burn & poison DoT, frost chill/freeze, shock chain+stun; undead/boss resist; frost casters chill you
//   v0.8.0  2026-06-25 — Frozen Wastes biome (north): snow/ice tiles, hardier frost-casting enemies,
//                        a guarded Frozen Cache (Frostbrand reward) + tracked mini-quest
//   v0.9.0  2026-06-25 — LIVING WORLD: day/night clock + dynamic lighting, weather (rain/blizzard),
//                        minimal rest (auto in towns, Camp [C], Exhausted after 2 days), fire-spread &
//                        knockback-into-hazard kills, dynamic events + a persistent hunting nemesis
//   v0.9.1  2026-06-25 — flames rendered as flickering tongues (not blocks); houses emit window light
//                        at night + warm additive glow from hearths & fires
//   v1.0.0  2026-06-25 — BALANCE & 1.0: data-driven pass. Rusty Sword atk 0→3 (smoother start);
//                        nemesis re-anchors to player level on rise + death-growth capped at player+4
//                        (no death-spiral); exhaustion HP-drain floor 50%→65%; startGame recalcs stats.
//                        Verified: ~1.2ms/frame heavy scene, fair boss/nemesis margins, no console errors.
//   v1.0.1  2026-06-25 — nemesis is now a NIGHT STALKER: only rises at level 3+, appears near you when
//                        night falls (not 24/7), and retreats into the shadows at dawn.
//   v1.1.0  2026-06-25 — ENDGAME & META: true final boss Morthrax the Deathless at Depth 10 → victory
//                        screen; score + persistent legacy (best/wins/deepest, localStorage) on title &
//                        death/victory; Ascension (New Game+) scales player & enemies each win.
//   v1.2.0  2026-06-25 — DRAGON & KRAKEN: dungeon endless again; new Emberwaste lava biome (SE) with a
//                        deadly wild Emberwyrm; tame it at Lv20 (subdue→[E]) for a flying steed ([G],
//                        +speed/+melee, soars over peaks/lava); fly to the peak-ringed Mountain Kraken,
//                        the true endgame boss → victory. Quest line reworked around the dragon/kraken arc.
//   v1.3.0  2026-06-25 — WORLD x4: overworld 100x80; enemies scale with distance from center (tougher +
//                        richer the farther out); 6 towns across biomes/distances with unique biome+tier
//                        shop stock (frost north, fire SE, mightiest at the edges).
//   v2.0.0  2026-06-27 — COMBAT 2.0: dodge-roll w/ stamina + i-frames (Shift/L), hit-stop on impact,
//                        heavier knockback + hit-stun, enemies telegraph melee (red ring + "!"). Builds:
//                        crit/lifesteal/berserk/evasion talents + gear AFFIXES that reshape play; loot
//                        matters. Per-element BULLETS (fire explodes & ignites, frost nova, shock fast+chains,
//                        poison cloud). Leveling curve steepened. Fast-travel between discovered towns (T).
//                        Denser encounters: distance-scaled packs + Elite leaders far from center.
//   v2.0.1  2026-06-27 — COMBAT 2.0 BALANCE (sim-driven): lifesteal was immortality vs bosses
//                        (+81 HP/s on the dragon) — cap 45%→30%, bosses resist it (×0.25), heal/hit
//                        capped at 6% max HP. Defense no longer trivializes big hits: incoming damage
//                        floors at 45% of raw atk, so bosses threaten tanky players. Dragon 380→600 HP
//                        (atk 24→30) so the tame fight isn't over in 1s. Net: lifesteal = strong
//                        sustain not invuln; kraken is a true race (6s survive vs 6.8s kill).
//   v2.1.0  2026-06-27 — BUILDS & ABILITIES: new Ultimate (Z) that ADAPTS to your weapon — melee
//                        Cleaving Storm (AoE), ranged Arrow Storm (9-arrow fan), magic Elemental Nova;
//                        scales with crit/berserk/exec/lifesteal/element (45 energy, 5s cd). Dodge-rolls
//                        now DASH-STRIKE through enemies (dmg+stun+element). 3 capstone talents:
//                        Executioner (+dmg vs <30% HP foes), Bulwark (flat dmg reduction), Arcane Font
//                        (energy regen + cheaper spells). Live ✦Z readiness chip in the world line.
//   v2.2.0  2026-06-27 — DUNGEON 2.0: themed floor sets cycle every 3 depths — Catacombs, Sunken
//                        Caverns, the Inferno (glowing lava pits), the Abyss (void) — each with its own
//                        palette, enemy pool & hazard flavor. Elite mini-bosses stalk deeper floors
//                        (1/3/6/10+), every 5th floor is a buffed Warden, and a guaranteed loot chest
//                        now drops on EVERY floor (richer every 3rd) with more gold.
//   v2.3.0  2026-06-27 — WORLD CONTENT: Shrines of blessing dot the realm (some in the frontier) — kneel
//                        [E] for a 30s boon: Might (+40% dmg), Ward (−40% taken), Haste (faster), Renewal
//                        (regen). A Bounty Board in Eldermyr posts cull/elite/depth contracts for gold,
//                        skill points & rare loot (tracked in quests). Ancient caches hide rich gear far
//                        out, rewarding exploration of the dangerous edges.
//   v2.4.0  2026-06-27 — FACTIONS: three powers track your standing (key [P]) — The Vigil (Honor →
//                        10/20% off gear & repairs + town healing), The Wilds (Kinship → calmer beasts;
//                        anger them and they hunt harder), The Dread Legion (Infamy → richer warlord
//                        spoils, deadlier rivals). Real trade-offs: culling beasts pleases the Vigil but
//                        angers the Wilds; taming the dragon wins Kinship; crushing warlords raises both
//                        Honor & Infamy. Substrate for the coming nemesis hierarchy.
//   v2.5.0  2026-06-27 — THE DREAD LEGION (emergent nemesis hierarchy, key [N]): a roster of named
//                        warlords (Grunt→Captain→Warlord→Overlord) hold territory across the map and
//                        ambush you there. Each has a procedural STRENGTH (ironhide/fireborn/frostbound/
//                        frenzied/regenerator/swarmlord) and WEAKNESS (poison/ranged/crit/stagger/fire) —
//                        wound them to scout it, exploit it for 1.6× damage. MEMORY: kill you → they
//                        promote, power up & hold a grudge; you kill them → they die (or crawl off scarred
//                        to return) and a subordinate seizes the territory. Power struggles refill the
//                        ranks each day. Slaying warlords feeds Dread infamy. The old lone nemesis is gone.
//   v2.6.0  2026-06-27 — DOMINATION & THRALLS: bring a warlord below 25% HP and [E] to break its will
//                        (Dominate skill) — it joins YOUR Dread Legion as a thrall. Summon Thrall [X]
//                        calls your dominated warlords as autonomous allies that hunt enemies at your
//                        side (scaling with their rank/level). Two new active skills (Dominate, Summon).
//                        Caps the factions/nemesis arc: crush rivals, then turn them into your army.
//   v2.7.0  2026-06-27 — FACTION WAR (living world): the three powers contest the realm via standing-
//                        weighted events. Dread RAIDS lay siege to towns (shop & rest sealed until you
//                        kill the war-party and liberate it → Vigil honor + gold). Vigil PATROLS of allied
//                        guards rally to you at high Honor. Wilds STAMPEDES of enraged beasts strike when
//                        Kinship is low. Besieged towns flash red on the map & world line.
//   v2.8.0  2026-06-27 — WARBAND COMMAND: your dominated thralls become a managed force (manage in the
//                        Legion panel [N]). PROMOTE them with gold (stronger + loyalty up); POST up to 2
//                        as persistent roaming BODYGUARDS that fight at your side across maps; SEND them on
//                        off-screen RAIDS that return gold & rare loot. Each has LOYALTY that drifts with
//                        your Dread Infamy — let it rot and the resentful BETRAY you, turning hostile again.
//   v2.9.0  2026-06-27 — NAVAL EXPLORATION: a Shipwright (by the western sea) sells you a boat; press [B]
//                        at the shore to set sail across the new Sundered Sea (a real boat-only ocean with
//                        two islands). Sailing is faster, water becomes passable & land blocked. The sea
//                        holds floating shipwreck loot/gold and rich island caches — and Sea Serpents
//                        (aquatic enemies) hunt you on the waves. Foundation for the Great Hunts.
//   v2.10.0 2026-06-27 — THE GREAT HUNTS: four legendary world-beasts at lairs across the realm — the
//                        Frost Titan (north), Storm Roc (NE wilds), Emberhorn (Emberwaste), and the Tide
//                        Leviathan (a sea isle, sail to reach). A Hunt Master in Eldermyr tracks them
//                        (status + location + trophy). Each is a telegraphed boss-tier fight that drops a
//                        guaranteed UNIQUE legendary weapon/armor. Overworld endgame beyond the dungeon.
//   v2.11.0 2026-06-28 — SEASONS & QUIET LIFE: the year now turns Spring→Summer→Autumn→Winter (seasonal
//                        color wash; WINTER freezes the sea & lakes into walkable ice). A gentle non-combat
//                        loop: FORAGE herbs/berries/mushrooms (seasonal) in the wilds, FISH at the water
//                        [E], and COOK at a town Hearth into meals granting lingering food buffs (Hearty/
//                        Energized/Swift/Well Fed). Also fixed a latent haste-shrine speed-stacking bug.
//   v2.12.0 2026-06-28 — DYNAMIC ECONOMY & TRADE: a merchant's life. Trade goods (Furs/Grain/Spice/Ore)
//                        with regional prices — every town EXPORTS one good cheap and CRAVES another dear,
//                        and seasons swing prices (furs dear in winter, grain cheap at autumn harvest).
//                        Buy low, haul, sell high (15% spread stops same-town flipping). A Trade section in
//                        every shop; sell your foraged herbs/fish/etc. for coin too. Vigil standing sweetens
//                        deals. Cargo persists.
//   v2.13.0 2026-06-28 — UI 1/4 — HUD DECLUTTER: the top-left is now one compact panel (slim HP bar, thin
//                        XP, Energy+Stamina side-by-side, a combined LV/⚔/🛡/gold/potions line); the
//                        message log shrank to a few fading lines; the always-on controls wall is replaced
//                        by a quiet [H] controls · [E] interact hint (press H to toggle the full list).
//   v2.14.0 2026-06-28 — UI 2/4 — MINIMAP: a live corner minimap (bottom-right) of the overworld — biome
//                        tints (frozen/ember/sea, with winter ice), towns (red-ringed when besieged),
//                        shrines, Great Hunt lairs, dungeon, and your heading. Click it for a big full-realm
//                        map with a legend ([ESC] closes). Cached terrain base, redrawn only on map/season
//                        change for performance.
//   v2.15.0 2026-06-28 — UI 3/4 — MENU HUB: [Tab] opens a unified tabbed hub over the always-available
//                        screens — Items / Skills / Standing / Legion / Hunts / Cook — switch with ◄ ►
//                        or by clicking the tabs; the direct hotkeys (I/K/P/N…) still work and light up the
//                        matching tab. Tames the ~20-key sprawl into one discoverable surface.
//   v2.16.0 2026-06-28 — UI 4/4 — POLISH PASS: cohesive menu styling across every panel — rounded cards
//                        with hover, softer hairline borders, consistent pill buttons, unified centered
//                        headers, and subtle custom scrollbars. The UI overhaul (declutter + minimap +
//                        hub + polish) is complete.
//   v2.17.0 2026-06-29 — WORLD REBALANCE — concentric difficulty rings so the realm is fair to beginners.
//                        Map grown 100×80 → 124×104, the whole hand-authored realm re-centered with a new
//                        frontier ring around it. THREE rings by distance-from-home (distFactor): the VALE
//                        (<0.30) is a gentle, safe lowland — weak foes only (no chargers) regardless of your
//                        level, plus frequent small grind-clusters and 5 seeded starter packs near town; the
//                        MARCHES escalate; the FRONTIER (>0.58) turns brutal — hard enemy mix, elites, big
//                        packs, convex power curve. Dread warlords now stalk ONLY the mid-outer lands
//                        (distFactor ≥ 0.42) — the home town & Heartland are sanctuary; the Overlord moved
//                        from the center to a deadly frontier corner. Warlords also start later (Lv5, was
//                        Lv3), ambush far less by day near the edge, and hit softer early (gentler HP/atk,
//                        slower charge). Fixes: "big guys too hard early, home town wasn't safe."
//   v2.18.0 2026-06-29 — FRONTIER CONTENT (1/2) — the bigger map now has reasons to explore it.
//                        New Points of Interest seeded across the Marches & Frontier rings, each marked
//                        on the map: LEGION WAR-CAMPS (clusters of red Legion troops round a banner —
//                        rout them to make the Legion reel, gold + rep), RUINED KEEPS (Frontier-only, a
//                        beefed Keep Guardian + escorts hoard a rare vault chest), and RAZED VILLAGES
//                        (the Marches — clear the raiders to liberate them for gold + potions + Vigil).
//                        Cleared sites change to a ruined/restored look. Foundation for the questline (2/2).
//   v2.19.0 2026-06-29 — THE LEGION WAR (2/2) — a main questline threads the frontier content. The Elder
//                        now gives staged objectives that walk you Vale→Marches→Frontier: (1) break 3 war-
//                        camps, (2) recover 3 Sealstones from the ruined keeps, (3) the Sealstones reveal
//                        the Dread Overlord's seat — marked on your map — where it reliably faces you for a
//                        finale. Slaying it BREAKS THE LEGION: +1500 gold, +3 skill points, big Vigil, and
//                        the unique Dawnbreaker, Bane of the Legion (rarity-5 fire blade, +Crit/Executioner);
//                        warlord ambushes then drop off (flags.legionBroken). Quest log tracks each stage;
//                        state in quests.legion (persisted, with save migration). Elder dialogue is staged.
//   v2.20.0 2026-06-29 — INVENTORY REFINEMENT — taming loot bloat with two focused tools (no clutter of
//                        clutter-managers): (1) each WEAPONS/ARMOR list is now sorted equipped-first then
//                        strongest→weakest, and every item is tagged ▲ (upgrade) / ▼ (worse) / = vs your
//                        equipped gear — a 50-item list reads at a glance; (2) a "🧹 Sell all junk" button
//                        clears the actual clutter in one click, selling only unequipped, low-rarity
//                        (≤ Uncommon), plain (no element/affix), no-better-than-equipped gear — it never
//                        touches rares, uniques, elemental or affixed pieces, or your equipped items.
//   v2.21.0 2026-06-29 — COMBAT CLARITY HUD — a single bottom-center readout for your moment-to-moment
//                        state, so you can read a fight at a glance: a row of active BUFFS/DEBUFFS with live
//                        countdowns (⟡ blessing · 🍲 food · 🐉 flying · ❄ chilled · 😴 exhausted) and an
//                        ABILITY BAR of pips showing readiness/cooldown (Z Ultimate · Q Whirlwind · R Focus ·
//                        X Summon · ⇧ Dodge — green ● ready, grey Ns cooling, amber = needs energy/stamina).
//                        Consolidation, not addition: these used to be scattered text chips in the world-line,
//                        which now carries only day/time/season/weather/siege. Updates only when state changes.
//   v2.22.0 2026-06-29 — CLAIM & HOLD TERRITORY (pillar 1/2) — three fixed frontier sites (Hawthorn Vale,
//                        Ironford, Mossbridge) start Legion-held. Clear the occupiers to LIBERATE a site,
//                        then stand on the ruins and [E] to REBUILD it (250g) into YOUR OUTPOST: a fast-
//                        travel hub ([T] to/from it), a Quartermaster vendor, and daily gold tribute. But
//                        the Legion can BESIEGE your outposts (tribute + trade stop until you drive them
//                        off). Hold all three → the realm rallies (Vigil). Ownership persists in
//                        state.holdings (fixed positions survive the per-load world regen). The old random
//                        'razed village' POI is replaced by these reclaimable sites. Next: companions (2/2).
//   v2.23.0 2026-06-29 — RECRUITABLE COMPANIONS (pillar 2/2) — raise a warband of named heroes who fight
//                        beside you. Hire a Knight (tanky melee), Ranger (arrows), or Mage (arcane bolts)
//                        from the Sellsword Captain in Eldermyr (up to 3), or get one free for rebuilding an
//                        outpost. They follow you overworld AND into the dungeon, target foes by class
//                        (knights close in, ranged kite & shoot friendly projectiles), level up WITH you so
//                        they stay relevant, and can be DOWNED in a hard fight — they recover when you camp
//                        [C] or by morning. Manage/dismiss/hire in the Warband panel ([E] the Sellsword).
//                        Persisted in state.companions. Ties the two pillars: outposts grant militia recruits.
//   v2.24.0 2026-06-29 — PACING — (1) slower EARLY game: the XP curve gets a front-loaded surcharge (up to
//                        +45% at L1, fading to 0 by L7+) via xpForLevel(), so the first levels are a real ramp
//                        while mid/late leveling is unchanged. (2) Enemy LEASH: each wild foe remembers its
//                        spawn distFactor (e.homeDf); if you lure it more than LEASH_MARGIN (0.18) inward of
//                        its home ring it loses the trail and falls back (despawns off-screen). The hard outer
//                        layers stay fully accessible — you can go fight them — but their enemies no longer
//                        follow you into the easy inner layers. Bosses/nemesis/raiders/guards/serpents exempt.
//   v2.25.0 2026-07-01 — OUTPOST & COMPANION DEPTH — the completion pass on both pillars. (1) UPGRADE an
//                        outpost with [E] at its banner: Lv2 (400g) raises tribute 55→70/day and raises a
//                        HEARTH (cook in the field); Lv3 (700g) → 85/day and a BLACKSMITH (repair out there).
//                        (2) GARRISON: station a companion at the outpost you stand in (Warband panel) — they
//                        hold post there (⚑, defend it if you're present for a fight) instead of following,
//                        and when the Legion assaults, a healthy garrison REPELS the siege outright (taking a
//                        35%-max-HP beating); a weakened one is overwhelmed and the siege lands. (3) COMPANION
//                        GEAR: "Arm" hands a companion your best spare weapon of their style (knight=melee,
//                        ranger=ranged, mage=magic) for +70% of its ATK on their strikes; Take/Dismiss returns
//                        it. All persisted. FIX: a siege that fired while you were in the dungeon left the
//                        outpost besieged with no attackers to clear — loadOverworld now backfills occupiers.
//   v2.25.1 2026-07-01 — EMBERWYRM FIX & BUFF — strong sub-20 players could kill the dragon: the "roars and
//                        recovers" gate lived only in updateEnemies (checks the 0–15% band on live frames), so
//                        any burst hit crossing 16%→dead called killEnemy directly and bypassed it. The Lv-20
//                        gate is now ALSO enforced at the top of killEnemy (covers crits/exec/ultimate/DOTs/
//                        companions): below 20, a killing blow glances off and it recovers to 60%. And the
//                        Emberwyrm is now a true world-terror — way tankier & stronger, scaling with your
//                        level: 600→2200+50·lvl HP (L20 ≈ 3200), atk 30→36+0.7·lvl (~50), def 7→12; slaying
//                        it at 20+ now pays 420 XP / 500 gold.
//   v2.26.0 2026-07-01 — THE GREAT WIDENING + three fixes. (1) MAP DOUBLED 124×104 → 248×208 (4× area): every
//                        landmark re-anchored at 2× coords; ring gradients now span real distances so easy and
//                        hard country no longer rub shoulders; Southreach nudged deeper SE to stay in the
//                        Emberwaste. Proper AREA SIZING: the Sundered-Sea isles grew from ~9 tiles to real
//                        arenas (r≈4.3), the Kraken ring-arena doubled, dragon-lair clearing 5×5→9×9, outpost
//                        clearings 5×5→7×7, plus a carved harbor road to the Shipwright. INTENTIONAL FORESTS:
//                        ~20 large ragged woods with open plains between them (home Vale stays airy; roads
//                        punch through) replace the old everywhere-scatter; fewer-but-real lakes and mountain
//                        ridges. Wild spawns now ring the PLAYER (10–36 tiles) instead of anywhere on the map,
//                        so the world stays alive at 4× size and spawns always match the ring you stand in;
//                        seeds/caps/pickups/shrines/caches/POIs retuned for the area. (2) "Sell all junk" now
//                        lives in the SHOP's sell section — selling requires a merchant (inventory keeps the
//                        ▲/▼ compare legend). (3) DUNGEON = THE GRIND: dungeon foes pay +40% XP and +25% gold
//                        over the surface, and each first-time depth grants Delver's Insight bonus XP
//                        (25+12·depth) — the surface is the journey, the depths are the training ground.
//   v2.27.0 2026-07-01 — WAYFINDING — the widened realm gets a compass. ONE objective at a time, priority-
//                        resolved (defend your besieged outpost > the Elder's intro > the Dungeon Key > the
//                        Sunken Dungeon > the current Legion-War target: nearest uncleared camp/keep, then
//                        the Overlord's seat). Off-screen → an EDGE ARROW pointing the way with a label,
//                        distance in tiles and compass heading; nearby → a bobbing diamond over the site;
//                        and a gold pulse rings it on the minimap & full map. [O] toggles the guide off for
//                        pure wanderers (choice persisted). currentObjective()/drawWayfinder(); drawn after
//                        renderWorld so it rides above night lighting.
//   v2.28.0 2026-07-01 — REGION IDENTITY & MOOD — the rings feel like places, not difficulty bands.
//                        Crossing any of the 9 named regions fades in a BANNER (title + a line of flavor);
//                        a subtle MOOD TINT eases between the rings (warm gold Vale · windswept blue-grey
//                        Marches · ash-red Frontier), stacking under the season wash; and 9 REALM-STONES —
//                        one per region, placed reachable in the wilds — hold a line of realm lore each.
//                        [E] reads a stone; the first reading pays +40 XP and counts toward "Realm-stones
//                        discovered: N/9" in the quest log (loreFound persisted). No map markers on purpose:
//                        the stones reward wandering off the roads.
//   v2.29.0 2026-07-01 — DUNGEON VARIETY — the grind stays fresh: each descent past Depth 1 may roll a
//                        FLOOR MODIFIER (45% chance): 👑 GILDED (all gold doubled) · 🐀 SWARMING (+60% foes
//                        at 70% HP — a feeding frenzy) · ☠ CURSED (foes +35% HP/+30% ATK but +30% XP and a
//                        rarer chest) · 🏦 TREASURE VAULT (rare: two bonus rare chests + gold piles). The
//                        modifier is announced on arrival and shown in the HUD depth line; the floor boss
//                        only shares in gilded riches (no cursed super-wardens).
//   v2.30.0 2026-07-01 — STYLE MASTERY PERKS — the melee/ranged/magic proficiency tracks now pay out
//                        signature perks at Lv 5/10/15 (shown under each track in Skills, announced on
//                        unlock): MELEE — Cleave (wider, longer swings) · Momentum (kills refund 14 stamina)
//                        · Executioner's Edge (+25% vs <30% HP). RANGED — Ricochet (arrows bounce to a 2nd
//                        target at 60%) · Steady Draw (faster arrows, +1 pierce) · Double Nock (12% free 2nd
//                        arrow). MAGIC — Twin Bolt (casts fork at the nearest other foe, 50%) · Attunement
//                        (spells cost 20% less) · Overload (bolts splash 40% around the mark).
//   v2.31.0 2026-07-01 — KEY VAULTS — Dungeon Keys finally matter past the front door. Floors below Depth 1
//                        have a 40% chance to hold a sealed 5×5 VAULT room (rune door glows through the dark,
//                        its chest visible but walled off). [E] the door with a key in your pack — the key is
//                        consumed, the vault opens: a rare chest + rich gold… and a 35% chance it was a DEN.
//                        Dungeon bosses now drop keys 30% of the time, so the key economy flows.
//   v2.32.0 2026-07-01 — REFORGE & FUSE — the blacksmith learns the forge arts (top of the Smith panel,
//                        works on your EQUIPPED weapon): REFORGE (120g × rarity+1, rarity 2+) rerolls its
//                        affixes anew; FUSE (150g) melts your best spare same-style weapon into it for
//                        +25% of the sacrifice's ATK (max 3 fusions, shown as a counter) — and if your
//                        blade bears no element, it drinks in the sacrifice's. Gear agency at last: your
//                        favorite weapon can grow with you instead of being outgrown.
//   v2.33.0 2026-07-01 — REGIONAL MUSIC & AMBIENCE — the ears get the mood pass the eyes got in v2.28.
//                        The overworld track now follows the ring you stand in (Vale = the bright original ·
//                        MARCHES = a wistful modal turn · FRONTIER = slow sawtooth dread) and flips to a
//                        driving DANGER theme while a boss or warlord is near (checked every 1.5s; the
//                        dungeon keeps its own track). Quiet ambient one-shots dress the world: birdsong in
//                        the Vale by day, distant wolf-howls at night, cold wind in winter and the frontier.
//   v2.34.0 2026-07-01 — GRAPHICS REVAMP (terrain) — every core overworld tile redrawn with a stable
//                        per-tile hash so the world stops looking like a checkerboard: GRASS gets 3 shade
//                        variants + scattered tufts, TREES get layered two-tone canopies with highlights,
//                        size jitter and ground shadows, WATER gets a deep-tone bed with drifting animated
//                        glints, MOUNTAINS get shaded faces + snowcaps with silhouette jitter, PATHS get
//                        worn speckling, FLOWERS bloom in 4 colors. Ice/lava biome tiles keep their looks.
//   v2.34.1 2026-07-01 — FIX: the wayfinder edge arrow could clamp to top-center and overlap the region
//                        banner while it was up. The arrow now tracks the banner window (_bannerUntil) and
//                        slides below the banner zone for its ~3.6s of life, then reclaims the top edge.
//   v2.34.2 2026-07-01 — COMBAT-FEEL & QUEST FIXES (user reports). (1) DIAGONAL AIM: dirVec() now fires
//                        along your actual movement vector (normalized, diagonals included) and only falls
//                        back to 4-way facing when standing still — horizontal keys no longer hijack your
//                        aim mid-strafe. (2) MASTERY EARNED: perk thresholds raised 5/10/15 → 8/16/22 (prof
//                        caps at 25) via a single hasPerk() gate — Ricochet/Twin-Bolt "auto-aim" and the
//                        arrow-spam feel are now genuine late-track rewards, not day-one unlocks. (3)
//                        OVERLORD SEAT SOFTLOCK: if the Overlord was slain BEFORE the finale stage (possible
//                        via high-infamy ambushes; legionDaily never re-crowns one), the seat pointed at a
//                        dead king forever — the quest now completes the war the moment the finale stage
//                        finds no living Overlord (checked on stage entry and every overworld frame).
//   v2.35.0 2026-07-01 — GRAPHICS REVAMP PHASE 2 (creatures & the deep) — the PLAYER gets a 4-frame walk
//                        cycle, shaded two-tone tunic with belt & buckle, and hair with a side-part;
//                        SKELETONS get ribcages and striding bone legs, ARCHERS a quiver of fletched arrows
//                        and legs; SEA SERPENTS get a sprite AT ALL (bug: 'serpent' had no draw case — they
//                        rendered as a shadow with an HP bar since v2.9); BOSSES gain a pulsing arcane aura
//                        and shoulder spikes so they read instantly. THE DUNGEON gets mortared brick-course
//                        walls (hash-varied splits, lit top edge) and floors with flagstone offsets, hairline
//                        cracks, and rare theme-accent glints. Same flat-color style — more craft.
//   v2.35.1 2026-07-01 — SEEKER BOLT — the magic tier-1 mastery no longer doubles your projectiles. "Twin
//                        Bolt" (aimed bolt + a second auto-aimed one) is now "Seeker Bolt": your single cast
//                        BENDS toward the nearest foe within range — one true bolt, full damage, auto-aimed.
//                        No enemy near → it flies where you aim, as ever. (User: auto-aim should be ONE.)
//   v2.36.0 2026-07-02 — TOWNS WORTH THE NAME — towns were pitifully small with NPCs shoulder-to-shoulder
//                        and unreadable overlapping labels. Every town zone roughly DOUBLED in footprint
//                        (Eldermyr 9×8 → 16×13; the rest 12–13 × 9–10; centers pinned so roads, tiers, and
//                        the economy don't move; Southreach nudged deeper to stay in the Emberwaste). House
//                        rows now line the top and bottom streets (plus flank houses in tall towns). All 8
//                        Eldermyr NPCs spread onto a real plaza (±5–6 tiles, ≥3-tile gaps): Elder north,
//                        Merchant/Guard on the upper flanks, Bounty Board/Hunt Master on the lower flanks,
//                        Blacksmith/Hearth south, Sellsword Captain at the south gate. Satellite towns and
//                        outposts spread likewise. NPC name labels get a dark backing pill — readable
//                        anywhere, even against houses.
//   v2.36.1 2026-07-02 — FIX: [E] could never end a conversation. The keydown handler was a chain of
//                        independent ifs — the final [E] ended the dialogue (scene → 'play'), then the SAME
//                        keypress fell through to the scene==='play' branch and tryInteract() re-opened the
//                        conversation with the NPC you were still standing beside. Dialogue/shop/smith [E]
//                        handling now consumes the keypress (return guards) — closing also no longer
//                        triggers a stray attack when advancing dialogue with Space. And a 0.3s interact
//                        grace (interactCd) after any talk/shop/smith closes means mashing [E] can't
//                        instantly reopen it either — a deliberate later press still does.
//   v2.36.2 2026-07-02 — THE WYRM STAYS HOME + FAIR QUEST TARGETS (user reports: "the dragon found me in
//                        town lol"). (1) The Emberwyrm is BOUND to its volcanic lair: it cannot see players
//                        more than 10 tiles from the lair, and with no prey in its domain it always wings
//                        straight home (direct flight, cancels mid-special) — no more cross-realm chases
//                        ending in Eldermyr's plaza. (2) War-camps now place in an ASCENDING ladder (2 entry
//                        camps at df .34–.48, 2 mid, 2 deep; keeps 2 near-frontier + 2 deep), and the
//                        wayfinder targets the EASIEST uncleared camp/keep first (df-dominant scoring,
//                        distance tiebreak) instead of the nearest — the arrow now walks beginners up the
//                        difficulty curve instead of pointing them at the map's edge.
//   v2.36.3 2026-07-02 — FIX: companions "stuck in the dungeon" after leaving (user report). exitDungeon
//                        called loadOverworld() — which anchors the warband near the player — BEFORE
//                        teleporting the player to the surface entrance, so companions were re-anchored at
//                        the player's dungeon-space coordinates: the far-northwest wilderness of the
//                        overworld, leaving them to trudge (or wedge on forests) 100+ tiles home. The
//                        player now moves first. Fast travel ([T] to towns AND outposts) had the sibling
//                        bug — it never re-anchored companions at all — both now call setupCompanions()
//                        after arrival. Garrisoned companions are unaffected (they anchor at their posts).
//   v2.36.4 2026-07-02 — DRAGON RESPAWN + CONTROLS OVERLAP. (1) Slaying the Emberwyrm is no longer forever:
//                        its ashes stir, and TWO DAYS later it returns to its lair (level-scaled to you, so
//                        the rematch is mightier) — checked at dawn and on surfacing from the dungeon;
//                        taming still ends it for good. (2) The [H] controls panel and the minimap were
//                        parked on the same bottom-right corner (both ~bottom:34px) — the controls panel
//                        now sits above the minimap (bottom:172px), no overlap.
//   v2.36.5 2026-07-02 — THE OVERLORD ANSWERS (user: "I go to the seat and nothing is there"). The finale
//                        relied on the ordinary ambush system — a 6–13s timer tick and a roll — so arriving
//                        at the seat showed nothing, and worse, legionDaily could refill a captain INTO the
//                        Overlord's region, hijacking target selection down to lowly day-ambush odds. Now:
//                        entering the seat region during the finale summons the Overlord IMMEDIATELY ("the
//                        ground trembles…"), squatters can't steal the duel, and the captain-refill can
//                        never take the Overlord's region while it lives.
//   v2.37.1 2026-07-11 — CAMP NERF (user: "camp heals too much, too fast"). [C] no longer instantly
//                        restores 40% HP. It now queues a slow regen (tickCampRest) that mends ~35% of
//                        maxHp over several seconds. The "foes near" safety guard and the energy/chill/
//                        fatigue refresh are untouched. (Time-skip stays; MP undoes the jump server-side.)
const GAME_VERSION = 'v3.2.1'; // LEVEL-UP FLOURISH (client-only) — on level gain the client spins a ring of GREEN particles UP around the hero (~1.3s) and floats a green "LEVEL UP!" over their head; the old one-shot green burst + chime stay. And TEAMMATES SEE IT TOO: each swirl is keyed to a player id and follows that player (local = your predicted pos; remote = the teammate in the roster), and a remote hero's level rise is detected from lightPlayer's `level` field (already on the wire) → the swirl + text pop over THEM. Cap 8 concurrent. Pure cosmetic, regenerated from the feelLvl / roster-level delta — the sim, the wire shape and both golden oracles are untouched. DEATH JUICE (client-only) — slaying something finally feels like it. The server just stops sending a dead enemy; the MP client detected that vanish and popped a fixed muddy-red 12-particle poof (SP's own killEnemy FX run server-side, invisible to the client). Now the client REPLAYS a satisfying death regenerated from the death delta: enemies BURST in their OWN color with particle count/speed + gibs + a shockwave ring + shake all scaled by size (a tiny tap for trash, a real jolt for a beast), a white flash sub-burst on every kill; enemies that died BURNING go out in warm embers over an ash-grey scorch and FROZEN ones shatter in icy-blue shards; a fading ground scorch/ash/splat is left at the spot (≤40, oldest-evicted); and a boss/hunt dies with the full finale — a white world-pulse, a big element-tinted nova (reusing ultimateNova) and a heavy shake. To make it fast (a 10-20 enemy AoE/ultimate/whirlwind wipe must not tank fps), every spawn draws from a PER-FRAME budget and scales DOWN as many die at once — worst case (20 simultaneous deaths in one reconcile pass): ≤130 new particles+gibs, ≤16 decals, ≤5 rings, ≤3 death sounds, ≤6 total shake, ≤2 novas; the particle pool's own 260 cap is the backstop. Pure cosmetic: NO sim change, NO gameplay change, the wire shape and BOTH golden oracles are byte-untouched. Plumbing: enemyMem now records the creature color/type + a burning/frozen flag (all ride packEnemy as scalars), and NAMES gained pushShock (the shockwave-ring primitive). v3.1.3 — DODGE POLISH (client-only) — two residual artifacts the owner hit after v3.1.1's dodge prediction. (1) The i-frame BLINK flickered: drawPlayer hides the sprite on floor(p.invuln/4)%2, but the client adopted snap.me.invuln at 20 Hz and held it FLAT between snapshots (never decremented per frame) AND only after a round-trip — so the flash stepped in coarse jumps and lagged the roll. The local invuln is purely COSMETIC (the server owns the real i-frame hit detection), so the client now mirrors doDodge's i-frames (15 + evasion·2) on frame 1 with the lunge and decrements them SMOOTHLY per frame (a fresh server i-frame from a HIT still (re)starts the blink via a rising-edge adopt) → the shimmer is smooth and starts with the roll. (2) Rapid multi-directional dodges could still POP: the client gates a predicted dodge on the DELAYED snapshot's stamina/cooldown, so on a fast chain it occasionally predicts a dodge the server rejects (out of stamina / still cooling), and v3.1.1's post-guard reconcile HARD-SNAPPED that residual. Now a moderate residual (64–200 px) GLIDES out per frame (capped ~18 px/frame, run to convergence) instead of snapping; only a genuine >200 px teleport still snaps instantly. A drift-free local cooldown mirror (doDodge's 24-tick dodgeCd — its only source) also prevents most rapid-chain mispredicts up front. Client-only; the sim, the wire shape and both golden oracles are untouched. v3.1.2 — MELEE SWING PREDICTED (client-only) — v3.1.1 predicted your dodge and shots but deliberately left the melee swing ARC server-driven (it flashed ~one round-trip late) to avoid a feared double-hit. The arc is PURELY COSMETIC though: the hitbox is 100% server-side (meleeSwing in tryAttack) and client state.player is only the RENDER copy, so a client-set p.attacking moves ONLY the drawn arc, never damage. So the client now mirrors tryAttack's `attacking = 12` locally — the swing flashes on frame 1 (from the predicted position + the aimed direction, so it tracks your body as you move), decays over the same 12 ticks, and re-fires at the weapon's real weaponCd cadence while attack is held. The local arc is owned ENTIRELY by this mirror: snap.me.attacking (the delayed server value) is ignored for the local hero, so you never see a predicted arc AND a second server-driven arc ~110 ms later. Melee only (ranged/magic already render a projectile — v3.1.1); remote players keep server-driven rendering. weaponCd is exposed to the client via NAMES (the game's own cadence fn, not a client-side formula mirror). The sim, the wire shape and both golden oracles are untouched. v3.1.1 — OWN-ACTION PREDICTION (client-only) — the client dead-reckoned your MOVEMENT but not your ACTIONS, so dodge/shots/swings all arrived a snapshot late on the v3.0.1 delayed timeline. (1) DODGE is now mirrored locally (doDodge's 5.6 px/tick × 13-tick lunge along the held-move-or-facing vector, same collision fn as the walk), so the >64 px reconcile no longer HARD-SNAPS pred to the server position → the hero-glued camera stops lurching; a big err DURING the predicted lunge is its own broadcast lag (pred is legitimately a beat ahead in TIME), so the client TRUSTS its local mirror through a guard window (the lunge + a short settle) — never snapping, never tugging pred backward toward the still-lagging snapshot — and resumes normal reconcile once the server's confirmation lands (both moved the same ~73 px, so err≈0). (2) PROJECTILES forward-extrapolate from the newest sample at their OWN velocity (derived from the last two samples; stamped vx/vy on first sight) with no render-delay, instead of interpolating in the delayed past like direction-changers — your own bolt leaves the muzzle on frame 1-2 instead of hanging ~5-7 frames, and all bolts stay smooth; enemies/players/companions/allies KEEP the delayed-timeline interp (correct for things that change direction). (3) MELEE swing already renders at the predicted position (drawPlayer reads state.player, whose x/y the client overwrites with pred before renderWorld) — confirmed body-tracking (no detachment while moving); only the swing TRIGGER stays server-authoritative (~one round-trip late), acceptable this pass. The sim, the wire shape and both golden oracles are untouched. v3.1.0 — LEVEL-DRIVEN ENEMIES — every rank-and-file foe (wild, regular dungeon minions + floor bosses, Citadel guards) now carries a real integer level and derives hp/atk/def from it through ONE curve (curves.ts: owLevel(distFactor)/dungeonLevel(depth) level sources + hp/atk/def/xp/goldForLevel). Player level (partyLvl) NO LONGER touches enemy stats, TYPE selection, or rewards — danger is driven by DISTANCE from home (overworld) and DEPTH (dungeon/rift; rifts reuse dungeonLevel), so home stays L1-safe forever and the frontier is frightening at any level. def now scales (armor matters) behind the existing hard Math.max(1,…) damage floor so no foe is ever unkillable; the Sunken Citadel's 3 floors of trash now match their master (Lv 200 through the unified curve, overriding 60/75/90), while its ordered-kill COURT stays BESPOKE (~18k HP, hand-tuned like the Archivist) but wears his Lv 200 for display; every foe shows its Lv on its nameplate. The old wildStat/wildXp/wildGold/dungeonStat/dungeonBossStat curves + diffMul + the biome ×1.3/1.6 stat bump are deleted (biome still selects TYPE + frost/lava on-hit). The GREAT HUNTS are now FLAT-leveled (55–70, apex.ts h.level — makeGreatBeast reads it for lf/atk, dropping partyLvl): the LAST player-LEVEL dependence, removed, so a hunt no longer bows to whoever shows up (parity with the pinnacles/dragon/kraken). The other bespoke uniques (Emberwyrm/Kraken/pinnacles/Archivist) keep hand-set stats; player COUNT/distance/cycle/ascension still stack — only player LEVEL was banned. v3.0.1 — MP MOTION SMOOTHED — snapshot v2's 20 Hz broadcast read as missed frames: the client chased each newest snapshot exponentially (surge-then-coast velocity sawtooth; projectiles effectively SNAPPED to each 20 Hz position — a ~3-frame stall then a jump). Remote movers (enemies, projectiles, other heroes, companions, allies) now render on a delayed timeline, lerped at CONSTANT velocity between the last two snapshots: the client measures the real arrival cadence and sizes its render delay from it (1.2×, clamped 40–120 ms), extrapolates at most 100 ms on a late snapshot then holds, and still snaps on teleports (>6 px/ms). Client-only; the sim and wire shape are untouched. v3.0.0 — THE v3 REBUILD (online-only cutover). The single-file monolith was split into src/ modules + content registries and made multiplayer-native; single-player is retired (solo = being alone on the Railway server). Nine co-op bugs fixed — your boat, questline, reputation, discovered towns / fast-travel and realm-stone lore are all per-hero and persist across restarts; the whole warband draws its tribute at dawn; town rest, personal shops and per-hero victory all work in co-op. New endgame: the Mountain Kraken finale (+ a respawn cycle), the Sunken Citadel pinnacle dungeon (the Lv-200 Drowned Archivist + build-changing relics), a three-tier warband with daily upkeep, a level-scaled overworld XP/gold curve, and a 3.5x-lighter connection. v2.59.2 — Beasts with a head now face where they're going. Nothing in this game ever rendered directionally — invisible while every creature was a blob, glaring the moment the wyrm had a head and a tail and flew backwards. The steed, the wild Emberwyrm, the sea serpent and the Dire Hound now turn; the blobs and the camera-facing foes rightly don't. v2.59.1 — Your Emberwyrm is the same beast tamed as it was wild. v2.59.0 redrew the wild dragon but not the steed, so taming it turned it into a different, cruder animal — the steed is now built from the same wings, skull and scales, and both derive every tone from ONE colour so they can never drift apart again. v2.59.0 — EVERY CREATURE REDRAWN. All 11 now have outlines, real shading, a highlight and motion that sells weight — the slime was one flat blob and two 2px dots; the boss a flat triangle. Same silhouettes, done properly, and their colours are honest now (a warlord's bones are red, the Pale Shepherd isn't violet). AND THE GAME GOT FASTER: the renderer was drawing all ~130 enemies every frame, 2 of them on screen — it culls now, so 3.3x the art costs 30% LESS frame time. v2.58.1 — The Sunken Dungeon arrow finally lets go. "Have I been there?" milestones (entered the dungeon / crossed into the Wastes / found the key) were SHARED, never saved, and never even sent to your screen — so the game pointed you at the front door on every single page load, however deep you'd delved. They're yours now, and they stick. v2.58.0 — APEX FIGHTS STOP BOWING TO YOU. The pinnacle bosses and the Emberwyrm no longer scale down to whoever shows up — they stand at a fixed, terrible strength (King ~9.4k→33.8k HP, Emberwyrm 3.2k→9.4k). And a marked kill's burst no longer chain-detonates: one kill wiped a line of 8 foes; now it kills 2. v2.57.0 — YOUR QUESTLINE IS NOW YOUR OWN. Quests/depth/bounty were SHARED world state that was never saved — so a room reboot, a reconnect, or a second tab put a depth-45 hero back on "Speak to the Elder", and a co-op newbie inherited your finished intro. They are per-player and persisted now, and kill credit no longer leaks between heroes (ranged/magic kills were all crediting the first player). v2.56.6 — Combat nerfs: RICOCHET no longer clears rooms — its bounce hunted foes up to 11 tiles away and flew 16 tiles, killing things you never aimed at (and Deadeye made that collateral CRIT hardest at max range); now 6 tiles. Magic aura damage HALVED and its field pulled in, and it can no longer set the ground on fire under your own feet. Lifesteal is 1% per point (was 2.5%) — item labels now tell the truth. v2.56.5 — Camping in a dungeon/rift now actually RESTS you — v2.56.2 let you camp underground and heal, but never recorded the rest, so you stayed Exhausted forever no matter how long you slept. v2.56.4 — MP: the event feed and quest box were silently DROPPING updates whenever the tab wasn't focused — one-shot payloads were consumed in the frame loop, which a hidden tab suspends entirely, so feed lines were lost forever and the quest box froze. Now adopted in ws.onmessage, which sees every message. Also: [N] Legion / [P] Standing hotkeys removed (use the [Tab]/[I] hub — ESC closes), and the HP potion HUD glyph is an actual potion instead of a pink alembic. v2.56.3 — MP: the Dread Legion panel was showing a PHANTOM roster — the client generated its own at startGame() while the hero was still the level-1 default, so every member read "Lv 1" forever and the nemesis "???" reveals could never resolve. The roster is now server-owned: it rides the snapshot (version-gated, 0 bytes/tick at rest) and the client adopts it explicitly. v2.56.2 — You can now make camp in dungeons/rifts (heal + energy + revive) so deep delving is survivable — no shared-clock skip underground, so one nap won't shove everyone's day forward in co-op. Magic's Seeker Bolt is no longer an aimbot: it picks the nearest foe you have LINE OF SIGHT to (walls block it), fires where you aimed, then bends toward the target by a capped turn rate — so a dodging/behind-cover foe can be missed.
