function findOpenTile(mapName, tx, ty) {
  const m = maps[mapName];
  if (!m) return { tx, ty };
  for (let r = 0; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = tx + dx,
          ny = ty + dy;
        if (ny < 0 || nx < 0 || ny >= m.length || nx >= m[0].length) continue;
        if (!SOLID.has(m[ny][nx])) return { tx: nx, ty: ny };
      }
  }
  return { tx, ty };
}
__g.reachableOW = null;
function computeReachableOW(stx, sty) {
  const m = maps.overworld;
  if (!m) {
    __g.reachableOW = null;
    return;
  }
  const H = m.length,
    W = m[0].length;
  const seen = new Set([stx + ',' + sty]);
  const st = [[stx, sty]];
  while (st.length) {
    const [x, y] = st.pop();
    const nb = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || ny >= H || nx >= W) continue;
      if (SOLID.has(m[ny][nx])) continue;
      const k = nx + ',' + ny;
      if (seen.has(k)) continue;
      seen.add(k);
      st.push([nx, ny]);
    }
  }
  __g.reachableOW = seen;
}
function isReachableOW(tx, ty) {
  return !__g.reachableOW || __g.reachableOW.has(tx + ',' + ty);
}
function findWildTile() {
  for (let i = 0; i < 120; i++) {
    const tx = 1 + Math.floor(Math.random() * (OW_W - 2)),
      ty = 1 + Math.floor(Math.random() * (OW_H - 2));
    if (SOLID.has(getTile('overworld', tx, ty))) continue;
    if (isInTown(tx, ty, 1)) continue;
    if (!isReachableOW(tx, ty)) continue;
    return { tx, ty };
  }
  return null;
}
function wildTileInRange(y0, y1) {
  for (let i = 0; i < 120; i++) {
    const tx = 1 + Math.floor(Math.random() * (OW_W - 2)),
      ty = y0 + Math.floor(Math.random() * (y1 - y0 + 1));
    if (SOLID.has(getTile('overworld', tx, ty))) continue;
    if (isInTown(tx, ty, 1)) continue;
    if (!isReachableOW(tx, ty)) continue;
    return { tx, ty };
  }
  return findWildTile();
}
function findWildTileNear(cx, cy, maxD) {
  for (let i = 0; i < 200; i++) {
    const ang = Math.random() * 6.28,
      d = 5 + Math.random() * maxD;
    const tx = Math.round(cx + Math.cos(ang) * d),
      ty = Math.round(cy + Math.sin(ang) * d);
    if (tx < 1 || ty < 1 || tx >= OW_W - 1 || ty >= OW_H - 1) continue;
    if (SOLID.has(getTile('overworld', tx, ty)) || isInTown(tx, ty, 1) || !isReachableOW(tx, ty)) continue;
    return { tx, ty };
  }
  return findWildTile();
}
function clearAround(m, tx, ty) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx,
        y = ty + dy;
      if (y > 0 && x > 0 && y < m.length - 1 && x < m[0].length - 1) m[y][x] = T.D_FLOOR;
    }
}
// Dungeon 2.0 — themed floor sets cycle by depth, each with its own palette, enemy pool, and hazard flavor.
const DUNGEON_THEMES = [
  {
    key: 'catacombs',
    name: 'The Catacombs',
    floor: '#2a2832',
    floor2: '#322f3c',
    wall: '#4a4452',
    wall2: '#3a3542',
    wall3: '#544e5e',
    pit: '#1a1820',
    pit2: '#0a080e',
    pitKind: 'pit',
    pool: ['skeleton', 'skeleton', 'bat', 'slime', 'archer'],
    accent: '#9a90b0',
  },
  {
    key: 'caverns',
    name: 'Sunken Caverns',
    floor: '#2c2a22',
    floor2: '#37322a',
    wall: '#52483a',
    wall2: '#3e3528',
    wall3: '#60543e',
    pit: '#15120b',
    pit2: '#080603',
    pitKind: 'pit',
    pool: ['charger', 'slime', 'bat', 'charger', 'skeleton'],
    accent: '#c0a060',
  },
  {
    key: 'inferno',
    name: 'The Inferno',
    floor: '#3a201a',
    floor2: '#46241a',
    wall: '#5a3024',
    wall2: '#42201a',
    wall3: '#6e382a',
    pit: '#7a2210',
    pit2: '#ff5a14',
    pitKind: 'lava',
    pool: ['charger', 'skeleton', 'mage', 'charger', 'charger'],
    accent: '#ff7838',
  },
  {
    key: 'abyss',
    name: 'The Abyss',
    floor: '#1e1a2e',
    floor2: '#262038',
    wall: '#3a2e54',
    wall2: '#2a2240',
    wall3: '#463a64',
    pit: '#0a0814',
    pit2: '#000000',
    pitKind: 'void',
    pool: ['mage', 'archer', 'mage', 'skeleton', 'healer'],
    accent: '#b070ff',
  },
];
function dungeonTheme(level) {
  return DUNGEON_THEMES[Math.floor((level - 1) / 3) % DUNGEON_THEMES.length];
}
function generateDungeon(level) {
  const theme = state.dungeonThemeData || dungeonTheme(level);
  const W = 22,
    H = 18;
  const m = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++)
      row.push(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? T.D_WALL : T.D_FLOOR);
    m.push(row);
  }
  const obstacles = Math.min(
    46,
    16 + level * 2 + (theme.key === 'caverns' || theme.key === 'inferno' ? 8 : 0),
  );
  for (let i = 0; i < obstacles; i++) {
    const x = 2 + Math.floor(Math.random() * (W - 4)),
      y = 3 + Math.floor(Math.random() * (H - 5));
    if (x <= 5 && y <= 4) continue;
    m[y][x] = Math.random() < 0.5 ? T.D_WALL : T.D_PIT;
  }
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 5; x++) m[y][x] = T.D_FLOOR;
  // Key Vault — a sealed 5×5 side-room with a rune door; a Dungeon Key opens it (v2.31.0)
  state.vault = null;
  if (level >= 2 && Math.random() < 0.4) {
    const vx = 7 + Math.floor(Math.random() * (W - 14)),
      vy = 6 + Math.floor(Math.random() * (H - 12));
    for (let y = vy - 2; y <= vy + 2; y++)
      for (let x = vx - 2; x <= vx + 2; x++) {
        const edge = x === vx - 2 || x === vx + 2 || y === vy - 2 || y === vy + 2;
        m[y][x] = edge ? T.D_WALL : T.D_FLOOR;
      }
    m[vy + 2][vx] = T.D_DOOR;
    state.vault = { x: vx, y: vy, opened: false };
  }
  maps.dungeon = m;
  const dp = findOpenTile('dungeon', W - 3, H - 3);
  clearAround(m, dp.tx, dp.ty);
  m[dp.ty][dp.tx] = T.D_DESCEND;
  if ((level - 1) % 3 === 0) {
    const up = findOpenTile('dungeon', 2, H - 3);
    clearAround(m, up.tx, up.ty);
    m[up.ty][up.tx] = T.D_EXIT;
  }
  return { W, H };
}

// ================= ENTITIES =================
function makeEnemy(tx, ty, type) {
  const base = {
    slime: { hp: 11, atk: 4, def: 0, speed: 0.7, xp: 8, gold: 5, color: '#60d060', size: 20, name: 'Slime' },
    bat: { hp: 8, atk: 5, def: 0, speed: 1.5, xp: 10, gold: 6, color: '#a060d0', size: 18, name: 'Cave Bat' },
    skeleton: {
      hp: 20,
      atk: 7,
      def: 2,
      speed: 1.05,
      xp: 18,
      gold: 12,
      color: '#e0e0d0',
      size: 22,
      name: 'Skeleton',
    },
    mage: {
      hp: 15,
      atk: 6,
      def: 1,
      speed: 0.9,
      xp: 18,
      gold: 16,
      color: '#60a0ff',
      size: 22,
      name: 'Dark Caster',
    },
    charger: {
      hp: 17,
      atk: 7,
      def: 1,
      speed: 1.0,
      xp: 16,
      gold: 12,
      color: '#e08040',
      size: 22,
      name: 'Dire Hound',
    },
    archer: {
      hp: 13,
      atk: 6,
      def: 1,
      speed: 0.95,
      xp: 16,
      gold: 14,
      color: '#9aa860',
      size: 20,
      name: 'Bone Archer',
    },
    healer: {
      hp: 15,
      atk: 3,
      def: 1,
      speed: 0.9,
      xp: 22,
      gold: 20,
      color: '#60e0a0',
      size: 20,
      name: 'Acolyte',
    },
    serpent: {
      hp: 26,
      atk: 9,
      def: 2,
      speed: 1.15,
      xp: 24,
      gold: 18,
      color: '#2aa0a0',
      size: 26,
      name: 'Sea Serpent',
    },
  }[type];
  const e = {
    x: tx * TILE + (TILE - base.size) / 2,
    y: ty * TILE + (TILE - base.size) / 2,
    w: base.size,
    h: base.size,
    type,
    hp: base.hp,
    maxHp: base.hp,
    atk: base.atk,
    def: base.def,
    speed: base.speed,
    xp: base.xp,
    gold: base.gold,
    color: base.color,
    name: base.name,
    hitFlash: 0,
    attackCd: 0,
    castCd: 0,
    caster: false,
    isBoss: false,
    wobble: Math.random() * 6.28,
  };
  if (type === 'mage') {
    e.caster = true;
    e.castCd = 60 + Math.floor(Math.random() * 40);
  }
  if (type === 'archer') {
    e.archer = true;
    e.attackCd = 30 + Math.floor(Math.random() * 40);
  }
  if (type === 'charger') {
    e.charger = true;
    e.chargeCd = 70 + Math.floor(Math.random() * 60);
    e.chargeState = 0;
    e.chargeT = 0;
    e.dvx = 0;
    e.dvy = 0;
  }
  if (type === 'healer') {
    e.healer = true;
    e.healCd = 90 + Math.floor(Math.random() * 60);
  }
  if (type === 'serpent') {
    e.aquatic = true;
  }
  return e;
}
function makeBoss(tx, ty) {
  return {
    x: tx * TILE - 8,
    y: ty * TILE - 8,
    w: 44,
    h: 44,
    type: 'boss',
    hp: 90,
    maxHp: 90,
    atk: 12,
    def: 4,
    speed: 0.95,
    xp: 100,
    gold: 200,
    color: '#c080ff',
    name: 'Morthrax',
    hitFlash: 0,
    attackCd: 0,
    castCd: 120,
    caster: false,
    isBoss: true,
    wobble: 0,
    specialCd: 180,
    tele: null,
    dash: null,
    specials: ['slam', 'charge', 'nova'],
  };
}
function makeWildEnemy(tx, ty, biome) {
  const lvl = partyLvl();
  const r = Math.random();
  const df = distFactor(tx, ty);
  const frozen = biome === 1,
    lava = biome === 2;
  let type;
  // Enemy TYPE is gated by ring, not just player level: the Vale stays gentle even for veterans, the Frontier is brutal at any level.
  if (lava) type = r < 0.3 ? 'charger' : r < 0.6 ? 'skeleton' : r < 0.85 ? 'mage' : 'bat';
  else if (frozen) type = r < 0.34 ? 'skeleton' : r < 0.62 ? 'charger' : r < 0.86 ? 'mage' : 'bat';
  else if (df < RING_SAFE)
    type = r < 0.55 ? 'slime' : r < 0.9 ? 'bat' : 'skeleton'; // Vale — easy lowland, no chargers
  else if (df >= RING_MID)
    type =
      r < 0.14
        ? 'slime'
        : r < 0.34
          ? 'skeleton'
          : r < 0.56
            ? 'charger'
            : r < 0.7
              ? 'archer'
              : r < 0.82
                ? 'mage'
                : r < 0.92
                  ? 'healer'
                  : 'bat'; // Frontier — hardest, widest variety (ranged archers + healers appear here)
  else if (lvl < 3) type = r < 0.5 ? 'slime' : r < 0.88 ? 'bat' : 'skeleton';
  else if (lvl < 6) type = r < 0.38 ? 'slime' : r < 0.68 ? 'bat' : r < 0.9 ? 'skeleton' : 'charger';
  else type = r < 0.28 ? 'slime' : r < 0.52 ? 'bat' : r < 0.78 ? 'skeleton' : 'charger';
  const e = makeEnemy(tx, ty, type);
  const biomeMul = frozen ? 1.3 : lava ? 1.6 : 1;
  // Distance→difficulty via diffMul(df): easier CORE (~0.71×) → fast climb → gentle mid plateau → STEEP Frontier ramp (~4× at the edge).
  const f = (1 + (lvl - 1) * 0.26) * biomeMul * diffMul(df);
  e.maxHp = Math.round(e.maxHp * f);
  e.hp = e.maxHp;
  e.atk = Math.round(e.atk * f);
  const rew = biomeMul * (1 + df * 1.0 + df * df * 1.3);
  e.xp = Math.round(e.xp * rew);
  e.gold = Math.round(e.gold * rew);
  if (frozen) e.frost = true;
  if (lava) e.lava = true;
  e.homeDf = df;
  return e;
}
function makeDungeonEnemy(tx, ty, level) {
  const theme = state.dungeonThemeData || dungeonTheme(level);
  let pool = theme && theme.pool ? theme.pool.slice() : ['slime', 'bat', 'skeleton', 'skeleton'];
  if (level >= 3) pool = pool.concat(['archer']);
  if (level >= 4) pool = pool.concat(['healer']);
  const type = pool[Math.floor(Math.random() * pool.length)];
  const e = makeEnemy(tx, ty, type);
  const f = (1 + (level - 1) * 0.4) * (1 + (state.ascension || 0) * 0.2);
  e.maxHp = Math.round(e.maxHp * f);
  e.hp = e.maxHp;
  e.atk = Math.round(e.atk * f);
  e.xp = Math.round(e.xp * f * 1.4);
  e.gold = Math.round(e.gold * f * 1.25);
  if (theme && theme.key === 'inferno') e.lava = true;
  return e;
} // dungeon pays a grind premium: +40% XP, +25% gold over the surface
function makeDungeonBoss(tx, ty, level) {
  const names = [
    'Gravewright the Pale',
    'Ashfiend',
    'The Hollow King',
    'Dreadmaw',
    'Vorlok the Endless',
    'Skarn the Devourer',
    'Morthrax the Deathless',
  ];
  const name = level <= names.length ? names[level - 1] : 'Abyssal Horror +' + (level - names.length);
  const b = makeBoss(tx, ty);
  const asc = 1 + (state.ascension || 0) * 0.2;
  const f = (1 + (level - 1) * 0.55) * asc;
  b.maxHp = Math.round(90 * f);
  b.hp = b.maxHp;
  b.atk = Math.round((12 + level * 2.2) * asc);
  b.def = Math.round(4 + level);
  b.xp = Math.round(100 * f);
  b.gold = Math.round(200 * f);
  b.name = name;
  b.color = level % 2 === 0 ? '#ff6060' : '#c080ff';
  b.caster = level >= 2;
  b.castCd = 120;
  b.specials = bossSpecials(level, b.color);
  b.specialCd = 150;
  b.tele = null;
  b.dash = null;
  return b;
}
function makeNPC(tx, ty, name, color, lines, id) {
  return { x: tx * TILE + 4, y: ty * TILE + 4, w: 24, h: 24, name, color, lines, id };
}
function makePickup(tx, ty, kind, value) {
  return {
    x: tx * TILE + 8,
    y: ty * TILE + 8,
    w: 16,
    h: 16,
    kind,
    value,
    collected: false,
    bob: Math.random() * 6.28,
  };
}

// ================= POINTS OF INTEREST — frontier content =================
// Optional objectives seeded across the Marches & Frontier rings: clear the guardians to claim the spoils.
// Each fills the bigger map with a reason to venture out. (Phase-2 questline hooks in via onPoiCleared.)
const POI_KINDS = {
  camp: { name: 'Legion War-Camp', mark: '#ff5040' },
  keep: { name: 'Ruined Keep', mark: '#c8b8ff' },
  village: { name: 'Razed Village', mark: '#f0c060' },
};
__g.poiSeq = 0;
function findWildTileInBand(lo, hi) {
  for (let i = 0; i < 240; i++) {
    const c = findWildTile();
    if (!c) break;
    const d = distFactor(c.tx, c.ty);
    if (d >= lo && d < hi) return c;
  }
  return null;
}
function spawnPoiEnemy(tx, ty, key, opts) {
  opts = opts || {};
  const o = findOpenTile('overworld', tx, ty);
  const e = nightBuff(makeWildEnemy(o.tx, o.ty, tileBiome(o.tx, o.ty)));
  e.poiKey = key;
  e.legion = true;
  e.color = '#c85048';
  e.homeTx = o.tx;
  e.homeTy = o.ty;
  if (opts.elite) makeElite(e);
  if (opts.guardian) {
    makeElite(e, 0);
    e.maxHp = Math.round(e.maxHp * 1.5);
    e.hp = e.maxHp;
    e.atk = Math.round(e.atk * 1.12);
    e.def = (e.def || 0) + 2;
    e.name = 'Keep Guardian';
    e.guardian = true;
    e.w += 4;
    e.h += 4;
    e.color = '#b84038';
    rollEliteAffixes(e);
  } // affixes roll AFTER the guardian rename/buff so the name prefix and shield % read the final identity
  state.enemies.push(e);
  return e;
}
function placePOI(kind, lo, hi) {
  const c = findWildTileInBand(lo, hi);
  if (!c) return null;
  const key = 'poi' + __g.poiSeq++;
  const poi = {
    key,
    kind,
    tx: c.tx,
    ty: c.ty,
    x: c.tx * TILE,
    y: c.ty * TILE,
    w: TILE,
    h: TILE,
    cleared: false,
    seal: false,
  };
  state.pois.push(poi);
  if (kind === 'keep') {
    spawnPoiEnemy(c.tx, c.ty, key, { guardian: true });
    spawnPoiEnemy(c.tx - 2, c.ty + 1, key, {});
    spawnPoiEnemy(c.tx + 2, c.ty + 1, key, {});
  } else {
    const n = kind === 'camp' ? 4 + Math.floor(Math.random() * 2) : 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * 6.28;
      spawnPoiEnemy(c.tx + Math.round(Math.cos(ang) * 2), c.ty + Math.round(Math.sin(ang) * 2), key, {
        elite: kind === 'camp' && i === 0,
      });
    }
  }
  return poi;
}
function setupPOIs() {
  state.pois = [];
  __g.poiSeq = 0;
  // war-camps ladder OUTWARD (v2.36.2): two entry camps in the near Marches, two mid, two deep — so the
  // questline's first targets are beginner-fair and the arrow can walk players up the difficulty curve
  placePOI('camp', 0.34, 0.48);
  placePOI('camp', 0.34, 0.48);
  placePOI('camp', 0.48, 0.65);
  placePOI('camp', 0.48, 0.65);
  placePOI('camp', 0.65, 0.92);
  placePOI('camp', 0.65, 0.92);
  placePOI('keep', 0.58, 0.72);
  placePOI('keep', 0.58, 0.72); // ruined keeps — near-frontier pair…
  placePOI('keep', 0.72, 1.01);
  placePOI('keep', 0.72, 1.01); // …and the deep-frontier pair
  // (razed villages are now the fixed reclaimable HOLD_SITES — see setupHoldings)
}
function clearPOI(poi) {
  if (poi.cleared) return;
  poi.cleared = true;
  const p = state.player;
  const cx = poi.x + poi.w / 2,
    cy = poi.y + poi.h / 2;
  const k = POI_KINDS[poi.kind];
  addShake(4);
  if (Sound.jingle) Sound.jingle();
  if (poi.kind === 'camp') {
    const g = 120 + Math.floor(Math.random() * 90);
    p.gold += g;
    addRepParty('dread', -6); // P2/S11: a POI liberated is PARTY news — every hero's standing moves (MP: the _seen sweep owns these calls; gold/loot stay with the pinned hero as before)
    addRepParty('vigil', 5);
    log(`⚔ War-camp broken! The Dread Legion reels. +${g} gold.`, 'good');
  } else if (poi.kind === 'keep') {
    const rIdx = Math.min(4, 3 + Math.floor(Math.random() * 2));
    const item =
      Math.random() < 0.5 ? { weapon: genWeapon(p.level + 3, rIdx) } : { armor: genArmor(p.level + 3, rIdx) };
    state.pickups.push(makePickup(poi.tx, poi.ty, 'chest', item));
    const g = 90 + Math.floor(Math.random() * 70);
    p.gold += g;
    addRepParty('vigil', 3);
    log(`✦ The keep's vault breaks open — +${g} gold and treasure within. Grab it!`, 'good');
  } else if (poi.kind === 'village') {
    const g = 70 + Math.floor(Math.random() * 50);
    p.gold += g;
    const pot = state.inventory.items.find((i) => i.name === 'Potion');
    if (pot) pot.qty += 2;
    addRepParty('vigil', 6);
    addRepParty('dread', -4);
    log(`✦ Village liberated! Grateful survivors give +${g} gold & 2 potions.`, 'good');
  }
  for (let i = 0; i < 3; i++) spawnBurst(cx, cy, 12, { color: k.mark, speed: 1.6 + i, decay: 0.04 });
  if (typeof onPoiCleared === 'function') onPoiCleared(poi);
  updateQuests();
  updateHUD();
  saveGame();
}
// ---- The Legion War: a main questline that threads the frontier POIs (camps → keeps/Sealstones → Overlord) ----
function onPoiCleared(poi) {
  const q = state.quests.legion;
  if (!q || !q.started) return;
  if (poi.kind === 'camp') {
    if (q.camps < 3) {
      q.camps++;
      if (q.stage === 'camps') log(`War-camp routed. (${q.camps}/3)`, 'quest');
    }
  } else if (poi.kind === 'keep') {
    if (q.sealstones < 3) {
      q.sealstones++;
      log(`You recover an ancient SEALSTONE from the keep's vault. (${q.sealstones}/3)`, 'quest');
    }
  } else if (poi.kind === 'village') {
    q.villages = (q.villages || 0) + 1;
  }
  advanceLegionQuest();
}
function advanceLegionQuest() {
  const q = state.quests.legion;
  if (!q || !q.started || q.stage === 'done') return;
  if (q.stage === 'camps' && q.camps >= 3) {
    q.stage = 'keeps';
    log(
      "The Legion's camps lie in ashes. Return to the Elder — or press on: their STRONGHOLDS, the ruined keeps, hold the old Sealstones. Recover three.",
      'quest',
    );
    Sound.jingle && Sound.jingle();
  }
  if (q.stage === 'keeps' && q.sealstones >= 3) {
    q.stage = 'overlord';
    q.seatRegion = state.legion && state.legion.overlord ? state.legion.overlord.region : 8;
    log(
      `The three Sealstones sing as one and reveal the Dread Overlord's seat: ${REGION_NAMES[q.seatRegion]}. Go — end its reign.`,
      'quest',
    );
    Sound.boss && Sound.boss();
  }
  if (q.stage === 'overlord' && (!state.legion || !state.legion.overlord || !state.legion.overlord.alive)) {
    completeLegionQuest();
    return;
  }
  updateQuests();
}
function completeLegionQuest() {
  const q = state.quests.legion;
  if (!q || q.stage === 'done') return;
  q.stage = 'done';
  const p = state.player;
  p.gold += 1500;
  p.skillPoints += 3;
  addRepParty('vigil', 25); // P2/S11: the WAR's end is party news (the quest object itself is room-shared) — every hero's standing moves; the gold/points/Dawnbreaker stay with the hero who struck the blow, as before
  addRepParty('dread', -45);
  state.flags.legionBroken = true;
  const rw = {
    name: 'Dawnbreaker, Bane of the Legion',
    atk: 30,
    style: 'melee',
    cd: 22,
    rarity: 4,
    element: 'fire',
    affixes: [
      { t: 'crit', v: 3, label: '+15% Crit' },
      { t: 'exec', v: 2, label: 'Executioner' },
    ],
  };
  normItem(rw, true);
  state.inventory.weapons.push(rw);
  log('★ THE DREAD LEGION IS BROKEN! The Overlord lies dead and its host scatters to the winds.', 'quest');
  log(
    'The Elder grants you DAWNBREAKER, Bane of the Legion, +1500 gold and +3 skill points. Eldermyr breathes free.',
    'good',
  );
  Sound.levelup && Sound.levelup();
  addShake(10);
  updateQuests();
  updateHUD();
  saveGame();
}
function elderLines() {
  const q = state.quests.legion;
  if (!q.started)
    return [
      'Ah, a traveler — thank the stars. The Dread Legion masses beyond the safe Vale, and the wilds grow crueler by the day.',
      'Help us break them. First, scatter their WAR-CAMPS — find their red banners across the Marches and frontier (click your minimap to see them). Rout three, and their grip loosens.',
      'Morthrax still festers in the Sunken Dungeon to the south; its KEY was lost in the wild lands. But the Legion is the nearer threat. Go — train your craft by doing, and spend skill points here in town.',
    ];
  if (q.stage === 'camps')
    return [
      `Their war-camps still fly the banner — you've routed ${q.camps} of 3. Look to the red marks on your map.`,
      'Break their camps, and the Legion will reel.',
    ];
  if (q.stage === 'keeps')
    return [
      `The camps are scattered — well done, hero. Now their STRONGHOLDS: the ruined keeps hoard Sealstones of the old wards. Recover three — you have ${q.sealstones} of 3.`,
      'Each keep is held by a Keep Guardian, deep in the frontier. Tread carefully.',
    ];
  if (q.stage === 'overlord')
    return [
      `The Sealstones reveal the Dread Overlord's seat: ${REGION_NAMES[q.seatRegion]}. It is marked upon your map.`,
      'Seek it out, hero — face the Overlord and end this. The realm holds its breath.',
    ];
  return [
    'You broke the Dread Overlord and scattered the Legion — Eldermyr lives because of you.',
    "Yet the dungeon's endless depths and the world's far terrors still call. A hero's work is never done.",
  ];
}
