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
// Dungeon 2.0 — themed floor sets cycle by depth, each with its own palette, enemy pool, and hazard
// flavor. P3/S8: the theme table + the depth index live in src/content/dungeons.ts (CONTENT.dungeons);
// p03 keeps positional aliases — p18 (drawDungeon) reads DUNGEON_THEMES[0], p10/p11 read dungeonTheme().
const DUNGEON_THEMES = CONTENT.dungeons.themes;
function dungeonTheme(level) {
  return CONTENT.dungeons.theme(level);
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
  // P3/S8: minLevel/odds are registry knobs (CONTENT.dungeons.vault); the draw stays here.
  state.vault = null;
  if (level >= CONTENT.dungeons.vault.minLevel && Math.random() < CONTENT.dungeons.vault.odds) {
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
  // P3/S2: the kind rows + per-type init hooks live in src/content/enemies.ts — read
  // through CONTENT.enemies[type] (the compiled content chunk at the head of this
  // program). Same fields, same values; only primitives are copied off the shared row, so
  // no registry object can land in live sim data. The instance literal below keeps its
  // wobble draw FIRST, then the entry's init hook makes exactly the Math.random() draws
  // the old inline type blocks made — same count, same order.
  const base = CONTENT.enemies[type];
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
  if (base.init) base.init(e);
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
  // P3/S2: the threshold tables live in src/content/enemies.ts (CONTENT.wildSpawn); the
  // ring/level BRANCHING is game logic and stays here. pick() walks `r < t` rows exactly
  // like the old ternary chains — same constants, same order, same single r drawn above.
  const WS = CONTENT.wildSpawn;
  if (lava) type = WS.pick(r, WS.tables.lava);
  else if (frozen) type = WS.pick(r, WS.tables.frozen);
  else if (df < RING_SAFE)
    type = WS.pick(r, WS.tables.vale); // Vale — easy lowland, no chargers
  else if (df >= RING_MID)
    type = WS.pick(r, WS.tables.frontier); // Frontier — hardest, widest variety (ranged archers + healers appear here)
  else if (lvl < 3) type = WS.pick(r, WS.tables.midEarly);
  else if (lvl < 6) type = WS.pick(r, WS.tables.midCore);
  else type = WS.pick(r, WS.tables.midLate);
  const e = makeEnemy(tx, ty, type);
  const biomeMul = frozen ? 1.3 : lava ? 1.6 : 1;
  // Distance→difficulty via diffMul(df): easier CORE (~0.71×) → fast climb → gentle mid plateau → STEEP Frontier ramp (~4× at the edge).
  // P3/S11: the stat/reward FACTORS are curves.ts fns (wildStat/wildReward); Math.round + the biomeMul/diffMul draws stay here.
  const f = CONTENT.curves.wildStat(lvl, biomeMul, diffMul(df));
  e.maxHp = Math.round(e.maxHp * f);
  e.hp = e.maxHp;
  e.atk = Math.round(e.atk * f);
  const rew = CONTENT.curves.wildReward(biomeMul, df);
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
  // P3/S2: level-gated pool growth (archer@3 / healer@4) is a registry knob —
  // src/content/dungeons.ts. Row order = the old if-order, so the pool is identical.
  for (const g of CONTENT.dungeons.poolGrowth) if (level >= g.minLevel) pool = pool.concat([g.add]);
  const type = pool[Math.floor(Math.random() * pool.length)];
  const e = makeEnemy(tx, ty, type);
  // P3/S11: dungeon stat factor + the grind-premium multipliers are curves.ts (dungeonStat/dungeonXpMul/dungeonGoldMul).
  const f = CONTENT.curves.dungeonStat(level, state.ascension || 0);
  e.maxHp = Math.round(e.maxHp * f);
  e.hp = e.maxHp;
  e.atk = Math.round(e.atk * f);
  e.xp = Math.round(e.xp * f * CONTENT.curves.dungeonXpMul);
  e.gold = Math.round(e.gold * f * CONTENT.curves.dungeonGoldMul);
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
  // P3/S11: the ascension multiplier + boss level factor are curves.ts (ascMul/dungeonBossStat); `asc`
  // stays a local (reused for atk); the base stat literals (90/12+level*2.2/4+level/100/200) stay here.
  const asc = CONTENT.curves.ascMul(state.ascension || 0);
  const f = CONTENT.curves.dungeonBossStat(level, asc);
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
// P3/S10: POI kinds live in src/content/tables.ts (CONTENT.tables.poi); positional alias (read by p03/p04/p05/p21).
const POI_KINDS = CONTENT.tables.poi;
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
  const q = state.player.quests.legion;
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
  const q = state.player.quests.legion;
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
  const q = state.player.quests.legion;
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
  const q = state.player.quests.legion;
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
