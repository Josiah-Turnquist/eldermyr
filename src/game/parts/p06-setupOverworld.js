function setupOverworld() {
  generateOverworld();
  const c0 = townCenter(townZones[0]);
  state.player.x = c0.x * TILE;
  state.player.y = c0.y * TILE;
  computeReachableOW(c0.x, c0.y);
  // Pinnacle-boss lairs (recomputed each session like krakenArena/dragonLair; NOT serialized). The Drowned King broods on
  // the second Sundered-Sea isle (islands[1], boat-reached); the Pale Shepherd's lantern rises on a REACHABLE, non-solid
  // frozen tile near (250,22), kept well east of the Frost Titan's lair (174,17).
  state.drownedLair =
    state.islands && state.islands[1]
      ? { tx: state.islands[1].x, ty: state.islands[1].y }
      : { tx: 120, ty: 221 };
  state.shepherdLair = (function () {
    for (let r = 0; r <= 34; r++) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = 250 + dx,
            ty = 22 + dy;
          if (tx < 2 || ty < 2 || tx >= OW_W - 2 || ty >= OW_H - 2) continue;
          if (SOLID.has(getTile('overworld', tx, ty)) || !isFrozenTile(tx, ty) || !isReachableOW(tx, ty))
            continue;
          if (Math.hypot(tx - 174, ty - 17) < 12) continue;
          return { tx, ty };
        }
    }
    for (let i = 0; i < 200; i++) {
      const ft = wildTileInRange(3, 52);
      if (
        ft &&
        isFrozenTile(ft.tx, ft.ty) &&
        isReachableOW(ft.tx, ft.ty) &&
        Math.hypot(ft.tx - 174, ft.ty - 17) > 12
      )
        return ft;
    }
    return { tx: 250, ty: 22 };
  })();
  state._pinCheckT = 0;
  state.npcs = [];
  state.projectiles = [];
  particles.length = 0;
  arcs.length = 0;
  shake = 0;
  hurtFlash = 0;
  function placeNPC(tx, ty, name, color, lines, id) {
    const o = findOpenTile('overworld', tx, ty);
    const n = makeNPC(o.tx, o.ty, name, color, lines, id);
    state.npcs.push(n);
    return n;
  }
  placeNPC(
    c0.x,
    c0.y - 4,
    'Elder',
    '#80c0ff',
    [
      'Ah, a traveler! Thank the stars. Eldermyr suffers.',
      'Morthrax festers in the endless Sunken Dungeon, south of here — none have plumbed its bottom. A KEY to its door was lost in the WILD LANDS — explore the wilderness. And know this: a far greater terror sleeps beyond the western peaks...',
      "Train your craft by doing — swing, shoot, or cast. And spend your hard-won skill points here in town; there is no time for study in the dungeon's dark.",
      'True treasures are rare indeed. Keep your gear mended, hero — the blacksmith will see to that.',
    ],
    'elder',
  );
  {
    const mn = placeNPC(
      c0.x - 5,
      c0.y - 2,
      'Merchant',
      '#f0b050',
      [
        "Wares for a hero! I'll also buy gear you no longer need.",
        'Far-flung towns stock rarer arms — frost in the north, fire in the Emberwaste, and the mightiest at the edges of the realm.',
      ],
      'shop',
    );
    mn.shopTown = townInfo(0);
    mn.stock = genShopStock(mn.shopTown);
  }
  placeNPC(
    c0.x + 5,
    c0.y - 2,
    'Guard',
    '#c0c0c0',
    [
      'The wilds grow crueler by the day. Tread carefully.',
      "A spark of magic needs no staff — but it's a tenth as strong with [F].",
    ],
    'guard',
  );
  placeNPC(
    c0.x - 2,
    c0.y + 4,
    'Blacksmith',
    '#e0a060',
    [
      "Bring me your worn arms and armor — I'll mend them, for a price.",
      'The rarer the gear, the dearer the repair.',
    ],
    'smith',
  );
  placeNPC(
    c0.x - 5,
    c0.y + 2,
    'Bounty Board',
    '#d0b070',
    ['Bounties for coin — cull the wilds, hunt elites, or delve deep. [E] to take or claim.'],
    'bounty',
  );
  placeNPC(
    c0.x + 5,
    c0.y + 2,
    'Hunt Master',
    '#7ad0a0',
    [
      'Legendary beasts stalk the far corners of the realm. Slay them for trophies beyond price. [E] to study the hunts.',
    ],
    'hunts',
  );
  for (let i = 1; i < townZones.length; i++) {
    const c = townCenter(townZones[i]);
    const sk = placeNPC(
      c.x - 4,
      c.y - 2,
      'Shopkeeper',
      '#f0b050',
      ['Finest wares in ' + townZones[i].name + '!'],
      'shop',
    );
    sk.shopTown = townInfo(i);
    sk.stock = genShopStock(sk.shopTown);
    placeNPC(c.x + 4, c.y - 2, 'Blacksmith', '#e0a060', ['Need something mended?'], 'smith');
    placeNPC(
      c.x,
      c.y + 3,
      'Hearth',
      '#e08850',
      ["A warm hearth — cook a meal from what you've foraged & fished."],
      'hearth',
    );
  }
  placeNPC(
    c0.x + 2,
    c0.y + 4,
    'Hearth',
    '#e08850',
    ["A warm hearth. Cook what you've gathered into hearty meals [E]."],
    'hearth',
  );
  placeNPC(
    c0.x,
    c0.y + 6,
    'Sellsword Captain',
    '#90c0ff',
    [
      'Looking to raise a warband? Knights, rangers, and mages for hire.',
      'Companions fight at your side and grow as you do — and recover when you rest. [E] to recruit.',
    ],
    'recruit',
  );
  placeNPC(
    81,
    204,
    'Shipwright',
    '#5a9cff',
    [
      'The Sundered Sea to the east hides islands few dare reach.',
      'A stout boat is yours for 250 gold — then press [B] by the water to sail.',
    ],
    'shipwright',
  );
  state.pickups = [];
  const kt = findWildTileNear(c0.x, c0.y, 22);
  if (kt) state.pickups.push(makePickup(kt.tx, kt.ty, 'key', 1));
  let t;
  if ((t = findWildTileNear(c0.x, c0.y, 26)))
    state.pickups.push(
      makePickup(t.tx, t.ty, 'chest', {
        weapon: normItem({ name: 'Iron Sword', atk: 5, style: 'melee', cd: 22 }, true),
      }),
    );
  if ((t = findWildTileNear(c0.x, c0.y, 26)))
    state.pickups.push(
      makePickup(t.tx, t.ty, 'chest', {
        weapon: normItem({ name: "Hunter's Bow", atk: 6, style: 'ranged', cd: 26 }, true),
      }),
    );
  if ((t = findWildTileNear(c0.x, c0.y, 26)))
    state.pickups.push(
      makePickup(t.tx, t.ty, 'chest', {
        weapon: normItem({ name: 'Apprentice Staff', atk: 7, style: 'magic' }, true),
      }),
    );
  if ((t = findWildTileNear(c0.x, c0.y, 26)))
    state.pickups.push(
      makePickup(t.tx, t.ty, 'chest', { armor: normItem({ name: 'Leather Armor', def: 3 }, false) }),
    );
  for (let i = 0; i < 26; i++)
    if ((t = findWildTile()))
      state.pickups.push(makePickup(t.tx, t.ty, 'gold', 15 + Math.floor(Math.random() * 20)));
  for (let i = 0; i < 14; i++)
    if ((t = findWildTile())) state.pickups.push(makePickup(t.tx, t.ty, 'potion', 1));
  for (let i = 0; i < 6; i++)
    if (Math.random() < 0.5) {
      const wt = findWildTile();
      if (wt) {
        const rIdx = 2 + Math.floor(Math.random() * 2);
        const item =
          Math.random() < 0.5
            ? { weapon: genWeapon(state.player.level + 1, rIdx) }
            : { armor: genArmor(state.player.level + 1, rIdx) };
        state.pickups.push(makePickup(wt.tx, wt.ty, 'loot', item));
      }
    }
  state.enemies = [];
  for (let i = 0; i < 56; i++)
    if ((t = findWildTile())) state.enemies.push(makeWildEnemy(t.tx, t.ty, tileBiome(t.tx, t.ty)));
  // Starter clusters — small groups of weak foes in the home Vale so a fresh hero always has something safe to grind near town.
  for (let i = 0; i < 6; i++) {
    const ct = findWildTileNear(c0.x, c0.y, 24);
    if (ct && distFactor(ct.tx, ct.ty) < RING_SAFE)
      spawnPackAround(ct.tx, ct.ty, 2 + Math.floor(Math.random() * 3), 999);
  }
  let fc = null;
  for (let i = 0; i < 80; i++) {
    const ft = wildTileInRange(4, 32);
    if (ft && isFrozenTile(ft.tx, ft.ty)) {
      fc = ft;
      break;
    }
  }
  if (fc && !(state.quests && state.quests.frozen && state.quests.frozen.done)) {
    const cache = makePickup(fc.tx, fc.ty, 'chest', {
      weapon: normItem(
        { name: 'Frostbrand', atk: 14, style: 'melee', cd: 22, rarity: 3, element: 'frost' },
        true,
      ),
    });
    cache.frozenCache = true;
    state.pickups.push(cache);
    for (let g = 0; g < 2; g++) {
      const o = findOpenTile('overworld', fc.tx + (g ? 2 : -2), fc.ty);
      state.enemies.push(makeWildEnemy(o.tx, o.ty, 1));
    }
  }
  // Shrines of blessing — POIs (two near the heartland, three in the frontier) that grant a temporary boon [E].
  // Shrines are RARE (v2.38.0): only a few exist at once, they're one-use (sink into the
  // earth when spent — see activateShrine), and new ones rise rarely at random (updateEvents).
  state.shrines = [];
  const shrineTypes = ['might', 'renewal', 'ward', 'haste'];
  for (let i = 0; i < 3; i++) {
    let st = null;
    if (i >= 1) {
      for (let k = 0; k < 50; k++) {
        const c = findWildTile();
        if (c && distFactor(c.tx, c.ty) > 0.4) {
          st = c;
          break;
        }
      }
    }
    if (!st) st = findWildTileNear(c0.x, c0.y, 40) || findWildTile();
    if (st)
      state.shrines.push({
        x: st.tx * TILE + 3,
        y: st.ty * TILE + 3,
        w: 26,
        h: 26,
        type: shrineTypes[Math.floor(Math.random() * shrineTypes.length)],
        cd: 0,
      });
  }
  // Ancient caches — rich loot far out in the frontier, rewarding deep exploration.
  for (let i = 0; i < 5; i++) {
    let bt = null;
    for (let k = 0; k < 60; k++) {
      const c = findWildTile();
      if (c && distFactor(c.tx, c.ty) > 0.55) {
        bt = c;
        break;
      }
    }
    if (bt) {
      const rIdx = Math.min(4, 3 + Math.floor(distFactor(bt.tx, bt.ty) * 2));
      const item =
        Math.random() < 0.5
          ? { weapon: genWeapon(state.player.level + 4, rIdx) }
          : { armor: genArmor(state.player.level + 4, rIdx) };
      state.pickups.push(makePickup(bt.tx, bt.ty, 'chest', item));
    }
  }
  // Sea treasures — boat-only: a rich cache on each isle + floating shipwreck loot & gold on the open sea
  if (state.islands)
    for (const is of state.islands) {
      const rIdx = 4;
      const item =
        Math.random() < 0.5
          ? { weapon: genWeapon(state.player.level + 5, rIdx) }
          : { armor: genArmor(state.player.level + 5, rIdx) };
      state.pickups.push(makePickup(is.x, is.y, 'chest', item));
    }
  if (state.ocean) {
    const o = state.ocean;
    const rndWater = () => {
      for (let t = 0; t < 25; t++) {
        const tx = o.x0 + 1 + Math.floor(Math.random() * (o.x1 - o.x0 - 1)),
          ty = o.y0 + 1 + Math.floor(Math.random() * (o.y1 - o.y0 - 1));
        if (getTile('overworld', tx, ty) === T.WATER) return { tx, ty };
      }
      return null;
    };
    for (let i = 0; i < 4; i++) {
      const w = rndWater();
      if (w) state.pickups.push(makePickup(w.tx, w.ty, 'gold', 70 + Math.floor(Math.random() * 90)));
    }
    for (let i = 0; i < 2; i++) {
      const w = rndWater();
      if (w) {
        const rIdx = 2 + Math.floor(Math.random() * 2);
        const it =
          Math.random() < 0.5
            ? { weapon: genWeapon(state.player.level + 3, rIdx) }
            : { armor: genArmor(state.player.level + 3, rIdx) };
        state.pickups.push(makePickup(w.tx, w.ty, 'loot', it));
      }
    }
  }
  // Seasonal foraging — herbs, berries & mushrooms scatter the wilds (sparser in winter)
  {
    const si = seasonIdx();
    const pool = [
      ['herb', 'berry', 'herb', 'berry', 'mushroom'],
      ['herb', 'berry', 'mushroom', 'herb', 'mushroom'],
      ['mushroom', 'berry', 'mushroom', 'herb'],
      ['mushroom', 'herb'],
    ][si];
    const count = [22, 26, 19, 11][si];
    for (let i = 0; i < count; i++) {
      const ft = findWildTile();
      if (ft)
        state.pickups.push(makePickup(ft.tx, ft.ty, 'forage', pool[Math.floor(Math.random() * pool.length)]));
    }
  }
  placeLoreStones(); // one Realm-stone of lore per region
  state._lastRegion = regionOf(c0.x, c0.y); // no banner at spawn
  setupPOIs(); // frontier content: war-camps, ruined keeps (+ their guardians)
  setupHoldings(); // reclaimable outpost sites (occupiers if razed, vendor if built)
  setupCompanions(); // reposition the living warband beside the player
  state.fires = [];
  weatherParts.length = 0;
  state.eventTimer = 2400;
  minimapBase = null;
  if (!state.dragon.tamed && state.dragonLair)
    state.enemies.push(makeWildDragon(state.dragonLair.tx, state.dragonLair.ty));
  if (!state.flags.krakenDead && state.krakenArena)
    state.enemies.push(makeKraken(state.krakenArena.tx, state.krakenArena.ty));
  // Great Hunts — legendary beasts at their lairs (one is sea-locked on an isle)
  if (!state.huntsSlain) state.huntsSlain = [];
  for (const h of GREAT_HUNTS) {
    if (state.huntsSlain.includes(h.key)) continue;
    let t = h.island
      ? { tx: h.lair.tx, ty: h.lair.ty }
      : findWildTileNear(h.lair.tx, h.lair.ty, 7) || { tx: h.lair.tx, ty: h.lair.ty };
    state.enemies.push(makeGreatBeast(h, t.tx, t.ty));
  }
  state.map = 'overworld';
}
// Floor modifiers — each descent past depth 1 may roll a twist, so the grind stays fresh (v2.29.0)
const FLOOR_MODS = {
  gilded: { icon: '👑', name: 'Gilded Floor', desc: 'the very walls glitter — riches abound' },
  swarming: { icon: '🐀', name: 'Swarming Floor', desc: 'a horde stirs — many foes, but frail' },
  cursed: { icon: '☠', name: 'Cursed Floor', desc: 'mighty foes guard a richer prize' },
  vault: { icon: '🏦', name: 'Treasure Vault', desc: 'a hoard beyond counting' },
};
function rollFloorMod(level) {
  if (level < 2) return null;
  const r = Math.random();
  if (r < 0.55) return null;
  if (r < 0.685) return 'gilded';
  if (r < 0.82) return 'swarming';
  if (r < 0.955) return 'cursed';
  return 'vault';
}
function setupDungeonFloor(level) {
  state.dungeonThemeData = dungeonTheme(level);
  state.floorMod = rollFloorMod(level);
  const fm = state.floorMod;
  const { W, H } = generateDungeon(level);
  const sp = findOpenTile('dungeon', 2, 2);
  state.player.x = sp.tx * TILE;
  state.player.y = sp.ty * TILE;
  state.projectiles = [];
  particles.length = 0;
  arcs.length = 0;
  shake = 0;
  hurtFlash = 0;
  setupCompanions();
  state.enemies = [];
  let count = 4 + level;
  if (fm === 'swarming') count = Math.round(count * 1.6);
  for (let i = 0; i < count; i++) {
    const o = findOpenTile(
      'dungeon',
      2 + Math.floor(Math.random() * (W - 4)),
      3 + Math.floor(Math.random() * (H - 4)),
    );
    if (Math.abs(o.tx - sp.tx) < 2 && Math.abs(o.ty - sp.ty) < 2) continue;
    state.enemies.push(makeDungeonEnemy(o.tx, o.ty, level));
  }
  // mini-bosses: elite stalkers prowl the deeper floors
  const elites = (level >= 3 ? 1 : 0) + (level >= 6 ? 1 : 0) + (level >= 10 ? 1 : 0);
  for (let i = 0; i < elites; i++) {
    const o = findOpenTile(
      'dungeon',
      2 + Math.floor(Math.random() * (W - 4)),
      3 + Math.floor(Math.random() * (H - 4)),
    );
    if (Math.abs(o.tx - sp.tx) < 3 && Math.abs(o.ty - sp.ty) < 3) continue;
    const me = makeDungeonEnemy(o.tx, o.ty, level);
    makeElite(me);
    state.enemies.push(me);
  }
  const bp = findOpenTile('dungeon', W - 4, H - 4);
  const boss = makeDungeonBoss(bp.tx, bp.ty, level);
  if (level % 5 === 0) {
    boss.maxHp = Math.round(boss.maxHp * 1.4);
    boss.hp = boss.maxHp;
    boss.atk = Math.round(boss.atk * 1.15);
    boss.name = 'Warden ' + boss.name;
    boss.warden = true;
  }
  state.enemies.push(boss);
  // apply the floor modifier to the rank-and-file (the boss only shares in gilded riches)
  if (fm)
    for (const e of state.enemies) {
      if (e.isBoss) {
        if (fm === 'gilded') e.gold = Math.round(e.gold * 2);
        continue;
      }
      if (fm === 'swarming') {
        e.maxHp = Math.round(e.maxHp * 0.7);
        e.hp = e.maxHp;
        e.xp = Math.round(e.xp * 0.85);
      } else if (fm === 'cursed') {
        e.maxHp = Math.round(e.maxHp * 1.35);
        e.hp = e.maxHp;
        e.atk = Math.round(e.atk * 1.3);
        e.xp = Math.round(e.xp * 1.3);
        e.gold = Math.round(e.gold * 1.2);
      } else if (fm === 'gilded') {
        e.gold = Math.round(e.gold * 2);
      }
    }
  state.pickups = [];
  let o;
  for (let i = 0; i < 2; i++) {
    o = findOpenTile(
      'dungeon',
      3 + Math.floor(Math.random() * (W - 6)),
      3 + Math.floor(Math.random() * (H - 6)),
    );
    state.pickups.push(makePickup(o.tx, o.ty, 'potion', 1));
  }
  o = findOpenTile('dungeon', Math.floor(W / 2), 3);
  state.pickups.push(makePickup(o.tx, o.ty, 'gold', (40 + level * 22) * (fm === 'gilded' ? 2 : 1)));
  // guaranteed loot chest EVERY floor; rarity scales with depth (richer every 3rd, and on cursed floors)
  o = findOpenTile('dungeon', Math.floor(W / 2), H - 4);
  {
    const rIdx = rollRarity(level, level % 3 === 0 || fm === 'cursed');
    const item = Math.random() < 0.55 ? { weapon: genWeapon(level, rIdx) } : { armor: genArmor(level, rIdx) };
    state.pickups.push(makePickup(o.tx, o.ty, 'chest', item));
  }
  if (state.vault) {
    const v = state.vault;
    const rIdx = rollRarity(level, true);
    const it =
      Math.random() < 0.55 ? { weapon: genWeapon(level + 1, rIdx) } : { armor: genArmor(level + 1, rIdx) };
    state.pickups.push(makePickup(v.x, v.y, 'chest', it));
    state.pickups.push(makePickup(v.x + 1, v.y, 'gold', 80 + level * 26));
  }
  if (fm === 'vault') {
    for (let i = 0; i < 2; i++) {
      o = findOpenTile(
        'dungeon',
        3 + Math.floor(Math.random() * (W - 6)),
        3 + Math.floor(Math.random() * (H - 6)),
      );
      const rI = rollRarity(level, true);
      const it = Math.random() < 0.55 ? { weapon: genWeapon(level, rI) } : { armor: genArmor(level, rI) };
      state.pickups.push(makePickup(o.tx, o.ty, 'chest', it));
    }
    for (let i = 0; i < 3; i++) {
      o = findOpenTile(
        'dungeon',
        3 + Math.floor(Math.random() * (W - 6)),
        3 + Math.floor(Math.random() * (H - 6)),
      );
      state.pickups.push(makePickup(o.tx, o.ty, 'gold', 60 + level * 24));
    }
  }
  if (fm) {
    const M = FLOOR_MODS[fm];
    log(`${M.icon} ${M.name} — ${M.desc}.`, fm === 'cursed' ? 'combat' : 'good');
    Sound.blip && Sound.blip();
  }
  if (state.vault) log('A rune-sealed VAULT slumbers on this floor… (🗝 a Dungeon Key will open it)', 'lore');
  state.npcs = [];
  state.map = 'dungeon';
  saveGame(false);
}
function saveOverworld() {
  state.owSave = { enemies: state.enemies, pickups: state.pickups, npcs: state.npcs, pois: state.pois };
}
function loadOverworld() {
  state.enemies = state.owSave.enemies;
  state.pickups = state.owSave.pickups;
  state.npcs = state.owSave.npcs;
  state.pois = state.owSave.pois || [];
  state.projectiles = [];
  particles.length = 0;
  arcs.length = 0;
  shake = 0;
  hurtFlash = 0;
  state.map = 'overworld';
  if (state.holdings)
    state.holdings.forEach((hd, i) => {
      if (hd.built && hd.besieged && !state.enemies.some((e) => e.holdKey === i)) spawnHoldOccupiers(i);
    });
  setupCompanions();
  maybeRespawnDragon();
}

// ================= SAVE / LOAD =================
function snapshot() {
  const p = state.player;
  return {
    v: 6,
    player: {
      enteredDungeon: !!p.enteredDungeon,
      gotKey: !!p.gotKey,
      enteredFrozen: !!p.enteredFrozen,
      /* v6: PERSONAL MILESTONES ride the player slice — that is what makes them durable per-HERO (MP's characterOf() saves exactly this slice, having swapped S.player to that hero) instead of dying with the shared, never-persisted state.flags */ hp: p.hp,
      maxHp: p.maxHp,
      xp: p.xp,
      xpNext: p.xpNext,
      level: p.level,
      gold: p.gold,
      speed: p.speed,
      atkHaste: p.atkHaste,
      energy: p.energy,
      maxEnergy: p.maxEnergy,
      skillPoints: p.skillPoints,
      bonusAtk: p.bonusAtk,
      bonusDef: p.bonusDef,
      bonusCrit: p.bonusCrit || 0,
      bonusLifesteal: p.bonusLifesteal || 0,
      bonusBerserk: p.bonusBerserk || 0,
      bonusEvasion: p.bonusEvasion || 0,
      bonusExec: p.bonusExec || 0,
      bonusFort: p.bonusFort || 0,
      bonusFont: p.bonusFont || 0,
      foodBuff: p.foodBuff || null,
      foodT: p.foodT || 0,
      abilities: { ...p.abilities },
      abilityRank: { ...(p.abilityRank || {}) },
      prof: JSON.parse(JSON.stringify(p.prof)),
    },
    inventory: JSON.parse(JSON.stringify(state.inventory)),
    quests: JSON.parse(JSON.stringify(state.quests)),
    flags: { ...state.flags },
    dungeonLevel: state.dungeonLevel,
    maxDepth: state.maxDepth,
    map: state.map,
    tonics: state.tonics,
    sharpenLevel: state.sharpenLevel,
    shopPurchased: [...state.shopPurchased],
    visitedTowns: [...(state.visitedTowns || [])],
    bounty: state.bounty ? { ...state.bounty } : null,
    factions: { ...(state.factions || { vigil: 0, wilds: 0, dread: 0 }) },
    legion: state.legion ? JSON.parse(JSON.stringify(state.legion)) : null,
    hasBoat: !!state.hasBoat,
    huntsSlain: [...(state.huntsSlain || [])],
    huntCycle: state.huntCycle || 0,
    huntRespawnDay: state.huntRespawnDay || null,
    pinnacleSlain: [...(state.pinnacleSlain || [])],
    pinnacleCycle: state.pinnacleCycle || 0,
    pinnacleRespawnDay: state.pinnacleRespawnDay || null,
    uniquesFound: [...(state.uniquesFound || [])],
    legionCycle: state.legionCycle || 0,
    legionRespawnDay: state.legionRespawnDay || null,
    loreFound: [...(state.loreFound || [])],
    holdings: (state.holdings || []).map((h) => ({
      liberated: !!h.liberated,
      built: !!h.built,
      level: h.level || 1,
    })),
    companions: (state.companions || []).map((c) => ({
      name: c.name,
      cls: c.cls,
      level: c.level,
      maxHp: c.maxHp,
      hp: c.hp,
      atk: c.atk,
      def: c.def,
      alive: c.alive !== false,
      weapon: c.weapon ? JSON.parse(JSON.stringify(c.weapon)) : null,
      postedAt: typeof c.postedAt === 'number' ? c.postedAt : null,
    })),
    ingredients: { ...(state.ingredients || { herb: 0, berry: 0, mushroom: 0, fish: 0 }) },
    cargo: { ...(state.cargo || { furs: 0, grain: 0, spice: 0, ore: 0 }) },
    wayfind: state.wayfind !== false,
    seenHeatTip: !!state.seenHeatTip,
    time: state.time,
    lastRestDay: state.lastRestDay,
    weather: state.weather,
    nemesis: { ...state.nemesis },
    ascension: state.ascension || 0,
    won: !!state.won,
    dragon: { ...state.dragon },
    dragonRespawnDay: state.dragonRespawnDay || null,
  };
}
