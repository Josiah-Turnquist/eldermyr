/*
 * server/releases.js — the player-facing changelog data for the /release page.
 * =============================================================================
 * A plain, ordered (NEWEST-FIRST) array of release entries. server/index.js
 * renders it into the /release (and /releases) HTML page; this module holds
 * ONLY data — no rendering, no server imports — so it's trivial to append to.
 *
 * To add a release: drop a new object at the TOP of the array. Shape:
 *   {
 *     version: 'v2.54.0',            // the version badge (any string: a range like 'v2.30–v2.35' is fine)
 *     date:    '2026-07-20',         // human date, or '' to omit the date line (used for the pre-repo epochs)
 *     title:   'One-line headline',  // what this release is, for players
 *     notes:   ['bullet one', ...],  // 2–5 short bullets, written for players (not commit-speak)
 *   }
 *
 * Curated to NOTABLE releases, not every micro-patch — recent feature drops are
 * listed individually; the deep single-player history is grouped into the
 * milestone arcs it shipped in. Dates come from git; entries older than the repo
 * (v1.0 … v2.35) predate version control, so their date is intentionally blank.
 */
'use strict';

module.exports = [
  {
    version: 'v3.2.0',
    date: '2026-07-18',
    title: 'Slaying something finally feels like it — foes burst in their own colors, burning and frozen enemies die in embers and ice, and bosses go out with a bang, with a scorch left behind to prove it happened',
    notes: [
      'Enemies used to just vanish on death. Now they burst apart in their own color, with a flash and a shockwave — a tiny pop for small foes, a real jolt for something big.',
      'How a creature dies matches how it died: cut something down while it’s burning and it goes out in a shower of embers over an ash scorch; kill something frozen and it shatters into icy shards.',
      'Every kill leaves a fading mark on the ground — a scorch, ash, or a splat — that lingers a moment before it clears.',
      'Bosses and the great beasts go out with a bang: a white flash, a big colored blast, and a heavy shake. A kill that mattered now feels like a moment.',
      'Built to stay fast: wiping a whole pack at once with an ultimate or a whirlwind won’t drop your frame rate — the effects gracefully scale down when a crowd dies together.',
      'This is purely how your screen draws a death — nothing about combat, damage, or the enemies themselves changed.',
    ],
  },
  {
    version: 'v3.1.3',
    date: '2026-07-17',
    title: 'Dodging is cleaner — a smooth invincibility shimmer, and no screen-jerk when you chain rolls low on stamina',
    notes: [
      'The invincibility shimmer during a dodge is smooth now. It used to flicker unevenly and start a beat after your roll; it now begins the instant you dodge and shimmers cleanly all the way through.',
      'Chaining rolls no longer jerks the screen. When you mash dodge and run low on stamina, the game occasionally guessed a roll the server didn’t allow — and the correction used to snap. It now glides the hero smoothly back into place instead.',
      'True teleports — fast travel, entering a dungeon — still snap instantly, exactly as before; only the small mispredicts are smoothed.',
      'As always, this is purely how your screen draws your own dodge — the roll, its distance, and your invincibility frames are decided on the server exactly as before.',
    ],
  },
  {
    version: 'v3.1.2',
    date: '2026-07-17',
    title: 'Blade swings now flash the instant you attack, tracking your body as you move',
    notes: [
      'Your melee swing appears the moment you press attack, instead of a fraction of a second later. The arc now flashes on the first frame — pointed where you aimed — and follows your hero as you move, so fighting on the run feels connected.',
      'The hit itself still lands on the server exactly as before — this changes only how quickly the swing is drawn on your screen, never what it does. Damage, reach and timing are unchanged.',
      'While you hold attack, swings keep pace with your weapon’s real speed, so faster blades flash faster and nothing strobes or double-flashes.',
      'This completes the set from the last update: your dodge, your shots and now your swings are all drawn the instant you act, while everyone else stays smooth.',
    ],
  },
  {
    version: 'v3.1.1',
    date: '2026-07-17',
    title: 'Your own moves feel instant again — dodges, shots and swings no longer lag behind you',
    notes: [
      'Dodging no longer jerks the screen. Your roll used to be decided on the server and arrive a beat later, so the view would lurch and everything around you seemed to glitch as it caught up. Your hero now lunges the instant you press it, and the camera rides along smoothly.',
      'Your bolts and arrows leave your hands immediately. They used to hang at the tip of your weapon for a blink before shooting off — now they launch the moment you loose them, and every shot in the realm stays smooth in flight.',
      'Your blade stays with you. A swing now tracks your body as you move instead of trailing a step behind, so fighting on the run feels connected.',
      'Under the hood: the game already predicted your walking so it felt instant — it now predicts your dodge the same way and launches your shots forward from their newest known spot, while everyone else’s movement keeps the smooth catch-up that keeps the realm silky. Nothing about the world, your gear, or your saves changed — this is purely how your screen draws your own actions.',
    ],
  },
  {
    version: 'v3.1.0',
    date: '2026-07-17',
    title: 'Every foe now wears its level — and the map, not your XP bar, sets the danger',
    notes: [
      'Every enemy now shows its level, so you can read the danger at a glance before you commit to a fight.',
      'A foe’s strength no longer chases your XP bar. It is set by WHERE the foe stands — how far from home in the wilds, or how deep in a dungeon or rift — and never by your own level. So home stays safe forever, and the frontier stays frightening whether you are level 1 or level 60.',
      'Defense finally matters. Well-armored foes shrug off weak hits now, so a heavier weapon earns its keep against the tough ones — but there is always a floor, so nothing is ever truly unkillable.',
      'The Sunken Citadel’s guards have stopped holding back: every floor’s trash now matches their master, the Drowned Archivist, at Level 200. It is brutal. That is the point.',
      'The Great Hunts join the pinnacle lords in standing at a fixed, terrible strength — the Frost Titan, Storm Roc, Emberhorn and Tide Leviathan no longer scale down to whoever shows up, so a low-level hero now meets the hunt’s true might instead of a pushover. The Emberwyrm, the Mountain Kraken, the pinnacle lords and the Drowned Archivist keep their own hand-set strength, unchanged.',
    ],
  },
  {
    version: 'v3.0.1',
    date: '2026-07-17',
    title: 'Motion is glassy-smooth again',
    notes: [
      'Everything that moves — foes, arrows and bolts, your fellow heroes, your warband — now glides between server updates instead of stepping. If the realm felt jittery after v3.0.0, like frames were being missed, this is the cure.',
      'Projectiles were the worst offenders: they would hang in the air for a blink, then leap. They fly true now.',
      'Under the hood, the game watches the real rhythm of the server’s updates and renders every moving thing a heartbeat behind it, sliding smoothly from one known position to the next — so motion stays silk even when the connection stutters, and teleports still snap instantly instead of smearing across the realm.',
    ],
  },
  {
    version: 'v3.0.0',
    date: '2026-07-16',
    title: 'The realm rebuilt — co-op that finally holds together, and a new doom to break',
    notes: [
      'Nine things that quietly broke when you played with friends now work. Your boat, your questline, your faction standing, the towns you have discovered and can fast-travel to, and the realm-stone lore you have read are all yours now — personal to each hero rather than poured into one shared pool, and every one of them survives the realm sleeping and waking.',
      'The whole warband draws its tribute at dawn, not only the host. Resting in a town truly rests you, even with a party around. Two of you can trade at the same merchant without treading on each other. And felling the realm’s doom is a victory each hero earns for themselves — a newcomer joining your realm begins their own story, instead of inheriting your finished one.',
      'A new finale wakes: the Mountain Kraken. The old ending waited at the bottom of the Sunken Dungeon; now a far greater terror stirs beyond the western peaks. Break it and the realm draws breath — then, days later, it rises again, stronger and richer, for as many cycles as you dare.',
      'A new dungeon beyond the dungeons: the Sunken Citadel. Fell a pinnacle boss and a black-glass gate opens onto three drowned tiers and the hall of the Drowned Archivist — a level-200 duel of shifting stances and a resurrecting court, guarding five build-changing relics that only the deepest delvers will ever hold.',
      'Your warband grows up. Companions now come in three tiers — hire one cheap and green, or pay for a hardened veteran — each drawing a daily wage. Keep them paid and they fight at your side; let the coin run dry and they will still follow, but they will not draw steel until you settle up.',
      'Fighting far from home finally pays. Wild foes out in the deadly rings now grant experience and gold that keep pace with their strength, instead of the pittance a starting-zone kill once paid.',
      'And the realm runs lighter and quicker — the game now sends about three and a half times less over the wire, so co-op stays smooth even with more happening on screen.',
    ],
  },
  {
    version: 'v2.59.2',
    date: '2026-07-15',
    title: 'Beasts with a head now face where they are going',
    notes: [
      'Your steed flew backwards when you flew west. Nothing in the realm had ever been drawn facing a direction &mdash; which nobody could tell while every creature was a blob or a skull staring straight at you. Give a wyrm a head and a tail and it becomes rather obvious.',
      'The steed, the wild Emberwyrm, the sea serpent and the Dire Hound now turn to face their travel. The slimes, bats and hooded casters do not &mdash; they have no front to speak of, and turning them would be meaningless.',
      'Beasts keep looking at you when you strike them, rather than spinning about from the shove, and a foe standing level with you no longer flickers between facings.',
      'Riding beside a companion, their steed faces their heading too, not yours.',
    ],
  },
  {
    version: 'v2.59.1',
    date: '2026-07-15',
    title: 'Your Emberwyrm is the same beast tamed as it was wild',
    notes: [
      'Last release redrew the wild Emberwyrm but not the steed you ride, so taming it turned your prize into a different, cruder animal. The steed is now built from the same wings, skull and scales &mdash; same beast, saddled.',
      'It is not merely the wild wyrm pasted under you: you sit on its back, so its bulk trails behind your shoulders, its neck reaches up to look ahead, and the lit scales run along its haunch and a ridge up the neck instead of under the saddle.',
      'Both the wild wyrm and the steed now take every tone from one colour, so they can never drift apart again.',
    ],
  },
  {
    version: 'v2.59.0',
    date: '2026-07-15',
    title: 'Every creature redrawn &mdash; and the game got faster',
    notes: [
      'All eleven creatures have been redrawn: outlines so they read against grass and stone alike, real shading instead of flat fills, a highlight, and movement with weight to it. The slime was a single flat blob with two dots for eyes; Morthrax was a plain triangle. Same silhouettes &mdash; done properly.',
      'Their colours are honest now. A Legion warlord is a red skeleton, so his bones are red rather than bone-white; the Pale Shepherd is pale, rather than wearing the same violet robe as every other boss. Elite and biome tints carry through everywhere.',
      'And it runs faster than before. The world was drawing all ~130 creatures every single frame &mdash; only a couple of which you could actually see. It now skips the ones off your screen, so more detailed monsters cost about a third less frame time than the old flat ones did.',
      'Charging foes and apex arenas are exempt from that skip, so a telegraphed charge or a closing arena ring still shows even when its owner is off-screen.',
    ],
  },
  {
    version: 'v2.58.1',
    date: '2026-07-15',
    title: 'The Sunken Dungeon arrow finally lets go',
    notes: [
      'The realm kept pointing you at the Sunken Dungeon no matter how many times you had delved it. Milestones like “I have been down there”, “I have crossed into the Wastes” and “I found the key” were held for the whole realm at once, were never written down, and never even reached your screen — so the arrow returned on every single visit.',
      'Those are yours now, and they stay yours: they survive a reload, a reconnect, and the realm going quiet. Long-standing heroes are recognised from what they have already done — if you carry dungeon keys or have delved deep, the game knows.',
      'In co-op, guidance is finally personal: a newcomer is still shown the way while a veteran isn’t, and one hero crossing into the Frozen Wastes no longer stops everyone else’s discovery.',
      'What belongs to the whole realm still does — the Kraken and the Legion are slain for everyone, not just for whoever struck the blow.',
    ],
  },
  {
    version: 'v2.58.0',
    date: '2026-07-15',
    title: 'The apex fights stop bowing to you',
    notes: [
      'The Drowned King, the Pale Shepherd and the Emberwyrm no longer shrink to match whoever walks in. They stand at a fixed, terrible strength — the King now bears roughly three and a half times the health he used to, and hits far harder. If you felled them easily before, they will not go quietly now.',
      'The Emberwyrm is a real fight at last. He was a pushover with a third of a pinnacle boss’s health; he now stands where that King stood — still beatable at the taming gate, but he will make you earn the sky.',
      'A wyrm or apex terror still grows with the size of your party and with each cycle you re-slay it — only its base strength stopped chasing your level. The relics it guards still suit the hero who claims them.',
      'Ranged: a marked kill’s burst no longer chain-detonates. One kill used to wipe a whole line of foes across the room; the burst itself is untouched — it simply stops setting off its neighbours.',
    ],
  },
  {
    version: 'v2.57.0',
    date: '2026-07-15',
    title: 'Your questline is your own',
    notes: [
      'Quests, deepest depth and bounties are now yours alone. They used to be shared across the whole realm — so a newcomer inherited a veteran’s finished intro, and could never be told to seek the Elder because someone else already had.',
      'They also survive properly now. A reconnect, a reload, a second window, or a quiet realm going to sleep would put a seasoned delver back on “Speak to the Elder”, and hand a Depth-45 veteran a bounty to reach Depth 3.',
      'Slain foes credit the hero who actually felled them. Arrows and spells were quietly crediting the first player in the realm — a bow-carrying companion’s “Slay monsters” could never finish.',
      'Long-standing heroes keep their progress: your finished intro is recognised from what you’ve already done.',
    ],
  },
  {
    version: 'v2.56.6',
    date: '2026-07-15',
    title: 'Combat rebalance — ricochet, aura, lifesteal',
    notes: [
      'Ricochet is a bounce again, not artillery. Its arrows were seeking out foes eleven tiles from the one you shot and flying clear across the room — killing things you never aimed at, often off-screen. Now it reaches about six.',
      'The elemental aura deals half the damage over a tighter field, and it no longer sets the ground alight beneath your own feet. Cast fire directly and it still burns the world exactly as before.',
      'Lifesteal is 1% per point (was 2.5%). Your gear’s labels were understating the change and now tell the truth.',
    ],
  },
  {
    version: 'v2.56.3–v2.56.5',
    date: '2026-07-15',
    title: 'Co-op repairs: a real Legion, a feed that stays, rest that counts',
    notes: [
      'The Dread Legion roster was a phantom. Your realm invented its own warlords at load and froze them at Lv 1 — different names from the true host, and their strengths could never be learned no matter how many you wounded. The roster is now the realm’s own, and the ??? resolve as you fight them.',
      'The event log stopped losing lines. With the window unfocused, every entry was being dropped and never resent — you simply never saw them.',
      'Camping in the dark now truly rests you. You could make camp underground and heal, yet stay Exhausted forever, because the rest was never written down.',
      'Cleanup: the Legion and Standing hotkeys are gone (use the menu hub — Esc closes), and the healing draught in your HUD finally looks like a potion.',
    ],
  },
  {
    version: 'v2.56.2',
    date: '2026-07-14',
    title: 'Make camp underground; magic stops cheating',
    notes: [
      'You can make camp in dungeons and rifts — heal, recover your wind, and rouse fallen companions — so delving deep is survivable. Underground rest doesn’t drag the realm’s day forward for everyone else.',
      'Seeker Bolt is no longer an aimbot. It used to snap every cast onto the nearest foe, straight through solid walls. Now it bends toward foes you can actually see, fires where you aimed, and a foe who dodges or ducks behind cover can be missed.',
    ],
  },
  {
    version: 'v2.56.1',
    date: '2026-07-14',
    title: 'The Ultimate is an actual explosion',
    notes: [
      'Unleashing your Ultimate [Z] now looks like one: a flash, expanding shockwave rings in your element’s colour, and a burst of debris.',
      'It grows with your power — a single ring at first, three screen-filling waves at mastery. Allies see it too.',
    ],
  },
  {
    version: 'v2.56.0',
    date: '2026-07-13',
    title: 'Pinnacle bosses & chase relics',
    notes: [
      'Two apex fights you seek out on purpose: the Drowned King on a shipwreck isle (sail to it) and the Pale Shepherd in the Frozen Wastes — but only at night.',
      "They don't just soak damage — telegraphed attacks, a shrinking safe ground, and adds that rise again if you slay them out of order.",
      'Each guards two build-defining relics; your first kill drops the one that fits how you fight. Leviathan Spine, Tidecaller’s Aegis, Shepherd’s Bell, Gravewool Cloak.',
      'A Trophy Wall at the Hunt Master tracks which apex terrors you’ve felled and which relics remain.',
    ],
  },
  {
    version: 'v2.55.0',
    date: '2026-07-13',
    title: 'A wider world',
    notes: [
      'The overworld grew about 1.4× on each side — roughly double the land to roam, every town, lair, and landmark re-placed.',
      'The new difficulty curve now has room to breathe: a gentle ride out of the starter vale into a genuinely brutal frontier, instead of a sudden wall.',
      'Old heroes load right in, no migration needed.',
    ],
  },
  {
    version: 'v2.54.0',
    date: '2026-07-13',
    title: 'Difficulty with a real shape',
    notes: [
      'Enemies near the heart of the realm are gentler for newcomers; the frontier is far deadlier for veterans — a steep-then-plateau-then-steep curve instead of a flat ramp.',
      'Great Hunts and the Dread Legion now scale to your party’s level one-to-one.',
      'Legendaries are rare again out in the wilds (about 5× fewer) — boss and hunt hauls stay rich.',
      'Also: completed quests finally clear out instead of nagging you forever.',
    ],
  },
  {
    version: 'v2.53.5',
    date: '2026-07-13',
    title: 'Clearer skills',
    notes: [
      'Active abilities now show their current rank, exactly what they do at it, and what the next point buys — no more blind upgrades.',
    ],
  },
  {
    version: 'v2.53.4',
    date: '2026-07-13',
    title: 'Auras you can see',
    notes: [
      "In co-op you now see your teammates' Heat aura — an element-colored glow that pulses and swells as their Heat climbs.",
      'Retired the old vent key and tidied up after it.',
    ],
  },
  {
    version: 'v2.53.3',
    date: '2026-07-13',
    title: 'Heat becomes an aura',
    notes: [
      'Magic Heat is now a passive elemental aura instead of a manual vent — cast an elemental staff to build Heat and it periodically strikes nearby foes with your element.',
      'No more overload, silence punishment, or the [V] vent key.',
      'UI tidy-up: a cleaner Heat pill, no more hub-and-panel overlap, and clearer red mark pips.',
    ],
  },
  {
    version: 'v2.53.1',
    date: '2026-07-13',
    title: 'Style & UI polish',
    notes: [
      'Clearer Heat readout, with visible ranged Marks and a Deadeye callout when a shot lands true.',
      'Ricochet now triggers reliably.',
      'Added a menu scrim and made the skill-milestone text readable.',
    ],
  },
  {
    version: 'v2.53.0',
    date: '2026-07-12',
    title: 'Style identity & elite affixes',
    notes: [
      'Every combat style now carries its own resource: melee Momentum, ranged Marks, and magic Heat.',
      'Elite foes can roll dangerous new affixes — Shielded, Vampiric, Splitting, and Warded.',
      'The opening phase of the endgame arc.',
    ],
  },
  {
    version: 'v2.52.0',
    date: '2026-07-11',
    title: 'Warband delving & sharper threats',
    notes: [
      'Your warband can now follow you down into the dungeon.',
      'Great Hunt and Legion damage bites harder and scales to your party.',
      'Enemies respawn in cycles with better loot; allies wander and no longer stack up.',
      'Shop items get glyph icons, plus three new pattern-firing magic weapons.',
    ],
  },
  {
    version: 'v2.51.0',
    date: '2026-07-11',
    title: 'The audit wave',
    notes: [
      '30+ bug fixes and cleanups across the game, server, and client.',
      'Fixed an Overlord-questline softlock and retuned Dominate’s cost, cooldown, and cap.',
      'Closed a Frostbrand reload-farm exploit and fixed fishing-state and dragon-respawn edge cases.',
    ],
  },
  {
    version: 'v2.50.0',
    date: '2026-07-11',
    title: 'Temper your gear',
    notes: [
      'Weapon upgrading is reworked into "Temper" at the blacksmith.',
      'Each weapon has an upgrade cap set by its rarity, so every temper feels deliberate.',
    ],
  },
  {
    version: 'v2.49.0',
    date: '2026-07-11',
    title: 'Deep-dungeon Rifts',
    notes: [
      'Rifts tear open in the wild for 30 seconds — breach one with a key for a deep dungeon run.',
      'Purple rifts are a solo plunge; blue rifts pull the whole party in for co-op.',
      'Plus server crash-proofing so one bad frame can never take the room down.',
    ],
  },
  {
    version: 'v2.47.0',
    date: '2026-07-11',
    title: 'Inventory & avatars',
    notes: [
      'Inventory items now show icons, and status effects have hover tooltips.',
      'A new avatar picker that previews your real hero sprite.',
    ],
  },
  {
    version: 'v2.46.0',
    date: '2026-07-11',
    title: 'Fishing, reimagined',
    notes: [
      'Fishing is a real cast → wait → bite now, with a proper windup.',
      'You can reel up gear and gold, not just fish (or the occasional bit of junk).',
    ],
  },
  {
    version: 'v2.45.0',
    date: '2026-07-11',
    title: 'Scaling & the frontier',
    notes: [
      'Your warband teleports back to you when it gets lost.',
      'The Legion and Great Hunts scale with party size and how far you’ve pushed from home.',
      'More frontier variety, including archers and healers.',
    ],
  },
  {
    version: 'v2.44.0',
    date: '2026-07-11',
    title: 'The art of Dominate',
    notes: [
      'Dominate is now a late-game magic art, unlocked at magic proficiency 18.',
      'Bind Elite foes and turn them to your side as allies.',
    ],
  },
  {
    version: 'v2.43.0',
    date: '2026-07-11',
    title: 'Proficiency depth',
    notes: [
      'Weapon proficiency runs deeper — attack speed scales up and mastery milestones reach further.',
      'Some weapons are gated behind proficiency, with mastery tooltips to guide the climb.',
    ],
  },
  {
    version: 'v2.42.0',
    date: '2026-07-11',
    title: 'Ranks & lifesteal',
    notes: [
      'Lifesteal grows +1% per skill level.',
      'Activation abilities gain ranks, hitting harder for every point you invest.',
      'Dying without a revive now costs half your gold.',
    ],
  },
  {
    version: 'v2.41.0',
    date: '2026-07-11',
    title: 'Co-op fixes',
    notes: [
      'Fixed the multiplayer event feed and kept the kraken leashed to its arena.',
      'Outposts sync correctly across the party; hordes scatter instead of clumping.',
      'Steeper health-tonic pricing.',
    ],
  },
  {
    version: 'v2.40',
    date: '2026-07-11',
    title: 'Heroes with identity',
    notes: [
      'Five distinct hero archetypes: Knight, Ranger, Mage, Barbarian, and Rogue.',
      'A living, animated cape that trails, flaps, and billows as you run.',
      'Hero skins (cape + hair) stay visible even under plate armor.',
      'Warbands hold a formation instead of piling up on top of each other.',
    ],
  },
  {
    version: 'v2.38',
    date: '2026-07-11',
    title: 'Camp, quest & survive — in co-op',
    notes: [
      'Channeled camping to heal up ([C]), with exhaustion that halves your speed if you overdo it.',
      'Quests, fishing, and shared dungeons all work in multiplayer now.',
      'Rare, one-use sinking shrines out in the world.',
      'Magic pierces a foe, arrows hit once but harder, and enemies will fight your warband.',
    ],
  },
  {
    version: 'v2.37.0',
    date: '2026-07-09',
    title: 'Combat rebalance',
    notes: [
      'Baseline enemies hit harder across the board.',
      'Weapons matter a little less, so your skill and tactics matter more.',
    ],
  },
  {
    version: 'Multiplayer',
    date: '2026-07-08',
    title: 'Co-op arrives',
    notes: [
      'Realms of Eldermyr goes co-op with a server-authoritative multiplayer mode.',
      'Friends join the same living world from a single link — no accounts, just a hero name and a recovery code.',
      'The single-player game is loaded headlessly on the server and shared across every player, so co-op stays true to the solo game.',
    ],
  },
  {
    version: 'v2.36',
    date: '2026-07-03',
    title: 'Towns worth the name',
    notes: [
      'Towns feel fuller and more alive.',
      'The Overlord answers at his seat, and the wyrm stays home instead of wandering off.',
      'The Dragon respawns after two days.',
      'A batch of early fixes — conversations that end, companions that aren’t stranded, and fairer quest targets.',
    ],
  },
  {
    version: 'v2.30–v2.35',
    date: '',
    title: 'Mastery & the Forge',
    notes: [
      'Combat-style mastery perks unlock at proficiency 8 / 16 / 22 — cleave, ricochet, twin-bolt, and more.',
      'Dungeon key vaults to crack open, plus Reforge and Fuse at the smith.',
      'Music and ambience that shift with the region you’re in.',
      'A full terrain and character graphics revamp — hero walk cycles, boss auras, and brick dungeon walls.',
    ],
  },
  {
    version: 'v2.26–v2.29',
    date: '',
    title: 'The Great Widening',
    notes: [
      'The world map doubled in size, with intentional forests and real isles to explore.',
      'Region banners and an eased, per-region mood tint.',
      'Nine Realm-stones to discover, each carrying a piece of lore.',
      'Dungeon floors gain modifiers — gilded, swarming, cursed, or a vault.',
      'A wayfinding arrow that always points to your current objective.',
    ],
  },
  {
    version: 'v2.22–v2.25',
    date: '',
    title: 'Territory & companions',
    notes: [
      'Liberate, rebuild, and own three frontier outposts — fast-travel, vendors, and daily tribute.',
      'Recruit a three-strong warband (knight, ranger, mage) that levels with you and can be revived when downed.',
      'Garrison a companion to repel sieges, and arm your warband with spare gear.',
    ],
  },
  {
    version: 'v2.17–v2.21',
    date: '',
    title: 'World rings & the frontier war',
    notes: [
      'The world is now concentric rings — a safe Vale at the heart out to a deadly Frontier.',
      'Warlords are confined to the frontier, and enemies leash to their own ground.',
      'Frontier points of interest: war-camps, ruined keeps, and razed villages.',
      'The Legion War main questline, from the Elder’s call to the Overlord finale.',
      'HUD and inventory polish, with sorting and a "sell all junk" button.',
    ],
  },
  {
    version: 'v2.13–v2.16',
    date: '',
    title: 'The UI overhaul',
    notes: [
      'A compact, readable HUD and a gently faded event log.',
      'A corner minimap plus a full-screen world map.',
      'A [Tab] menu hub that ties the whole interface together.',
    ],
  },
  {
    version: 'v2.11–v2.12',
    date: '',
    title: 'Seasons & a living economy',
    notes: [
      'Seasons arrive — deep winter can freeze the sea solid enough to walk across.',
      'The quiet life: forage, fish, and cook for food buffs, warming up at town Hearths.',
      'A dynamic trade economy with regional and seasonal prices — buy low, sell high.',
    ],
  },
  {
    version: 'v2.9–v2.10',
    date: '',
    title: 'Set sail & the Great Hunts',
    notes: [
      'Take to the water and sail the Sundered Sea — islands, sea serpents, and shipwreck loot.',
      'The Great Hunts: four legendary world-beasts, a Hunt Master to answer to, and unique trophies.',
    ],
  },
  {
    version: 'v2.4–v2.8',
    date: '',
    title: 'Factions & the Dread Legion',
    notes: [
      'Factions and reputation you can earn or lose.',
      'The Dread Legion — a nemesis hierarchy that grows stronger every time it beats you.',
      'Dominate defeated foes into loyal thralls.',
      'Faction war with town sieges, patrols, and stampedes.',
      'Command your own warband: promote, bodyguard, raid — and weather the occasional betrayal.',
    ],
  },
  {
    version: 'v2.1–v2.3',
    date: '',
    title: 'The great expansion',
    notes: [
      'An adaptive Ultimate and a dash-strike, capped off with capstone talents.',
      'Dungeon 2.0 with themed floors.',
      'Shrines, bounties, and hidden caches scattered across the world.',
      'A broad pass of combat balancing.',
    ],
  },
  {
    version: 'v2.0',
    date: '',
    title: 'Combat 2.0',
    notes: [
      'A depth overhaul built on dodge-rolling and stamina.',
      'Build paths — crit, lifesteal, berserk, evasion — supported by gear affixes.',
      'Elemental bullets, enemy telegraphs, roaming monster packs, and fast-travel.',
    ],
  },
  {
    version: 'v1.0',
    date: '',
    title: 'Realms of Eldermyr',
    notes: [
      'The adventure begins: an open fantasy world to wander.',
      'Fight, level up, loot, and delve the dungeon.',
      'The first public release.',
    ],
  },
];
