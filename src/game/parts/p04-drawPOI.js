function drawPOI(poi) {
  const sx = poi.x - state.camera.x,
    sy = poi.y - state.camera.y;
  if (sx < -90 || sx > VIEW_W + 90 || sy < -90 || sy > VIEW_H + 90) return;
  const k = POI_KINDS[poi.kind];
  const cleared = poi.cleared,
    near = rectDist(state.player, poi) < 48;
  ctx.save();
  if (poi.kind === 'camp') {
    for (let i = 0; i < 3; i++) {
      const ox = sx - 16 + i * 17,
        oy = sy + (i % 2 ? 6 : 0);
      ctx.fillStyle = cleared ? '#463f36' : '#6a3a30';
      ctx.beginPath();
      ctx.moveTo(ox, oy + 14);
      ctx.lineTo(ox + 9, oy - 3);
      ctx.lineTo(ox + 18, oy + 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = cleared ? '#2c2722' : '#3a201a';
      ctx.fillRect(ox + 7, oy + 6, 4, 8);
    }
    const px = sx + 9;
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, sy + 16);
    ctx.lineTo(px, sy - 18);
    ctx.stroke();
    if (!cleared) {
      ctx.fillStyle = '#d03028';
      ctx.beginPath();
      ctx.moveTo(px, sy - 18);
      ctx.lineTo(px + 15, sy - 13.5);
      ctx.lineTo(px, sy - 9);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, sy + 2);
      ctx.lineTo(px + 13, sy + 7);
      ctx.stroke();
    }
  } else if (poi.kind === 'keep') {
    const seg = [
      [-18, -6, 10, 22],
      [-2, -15, 12, 31],
      [14, -4, 11, 20],
    ];
    for (const s of seg) {
      ctx.fillStyle = cleared ? '#585360' : '#6a6472';
      ctx.fillRect(sx + s[0], sy + s[1], s[2], s[3]);
      ctx.fillStyle = cleared ? '#46424e' : '#54505e';
      ctx.fillRect(sx + s[0], sy + s[1], s[2], 3);
    }
    if (cleared) {
      const g = 0.4 + Math.sin(Date.now() / 300) * 0.25;
      ctx.fillStyle = 'rgba(240,210,90,' + g.toFixed(2) + ')';
      ctx.fillRect(sx - 1, sy - 5, 12, 19);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const ox = sx - 18 + i * 16,
        oy = sy - (i % 2 ? 6 : 0);
      if (cleared) {
        ctx.fillStyle = '#8a5a36';
        ctx.fillRect(ox, oy, 13, 12);
        ctx.fillStyle = '#b06038';
        ctx.beginPath();
        ctx.moveTo(ox - 1, oy);
        ctx.lineTo(ox + 6.5, oy - 7);
        ctx.lineTo(ox + 14, oy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f0d050';
        ctx.fillRect(ox + 5, oy + 5, 3, 7);
      } else {
        ctx.fillStyle = '#4a3a2e';
        ctx.fillRect(ox, oy + 3, 13, 9);
        ctx.fillStyle = '#2e2118';
        ctx.beginPath();
        ctx.moveTo(ox - 1, oy + 3);
        ctx.lineTo(ox + 6, oy - 3);
        ctx.lineTo(ox + 13, oy + 3);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  const lx = sx + poi.w / 2;
  ctx.textAlign = 'center';
  ctx.font = '9px monospace';
  ctx.fillStyle = cleared ? '#8a8a9a' : k.mark;
  ctx.fillText(cleared ? (poi.kind === 'village' ? '✓ Liberated' : '✓ Cleared') : k.name, lx, sy - 23);
  if (!cleared && near) {
    const bob = Math.sin(Date.now() / 200) * 2;
    ctx.fillStyle = '#ff6a5a';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('⚔', lx, sy - 31 + bob);
  }
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  ctx.restore();
}

// ================= HOLDINGS — reclaim & hold frontier outposts =================
// Fixed Marches sites you can liberate from the Legion and rebuild into your own outposts (fast-travel +
// a Quartermaster vendor + daily tribute), then defend from sieges. Ownership persists in state.holdings.
const HOLD_SITES = [
  { tx: 106, ty: 84, name: 'Hawthorn Vale' },
  { tx: 269, ty: 112, name: 'Ironford' },
  { tx: 154, ty: 246, name: 'Mossbridge' },
];
function initHoldings() {
  state.holdings = HOLD_SITES.map(() => ({ liberated: false, built: false, level: 1, besieged: false }));
}
function ensureHoldings() {
  if (!state.holdings || state.holdings.length !== HOLD_SITES.length) initHoldings();
}
function holdNear(tx, ty, r) {
  r = r || 2;
  for (let i = 0; i < HOLD_SITES.length; i++) {
    const h = HOLD_SITES[i];
    if (Math.abs(h.tx - tx) <= r && Math.abs(h.ty - ty) <= r) return i;
  }
  return -1;
}
function currentHoldIndex() {
  const p = state.player;
  const hi = holdNear(Math.floor((p.x + p.w / 2) / TILE), Math.floor((p.y + p.h / 2) / TILE), 3);
  return hi >= 0 && state.holdings && state.holdings[hi] && state.holdings[hi].built ? hi : -1;
}
function ownedHoldings() {
  return (state.holdings || []).map((h, i) => ({ h, i })).filter((o) => o.h.built);
}
function spawnHoldOccupiers(i) {
  const h = HOLD_SITES[i];
  const n = 3 + Math.floor(Math.random() * 2);
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * 6.28;
    const o = findOpenTile(
      'overworld',
      h.tx + Math.round(Math.cos(ang) * 2),
      h.ty + Math.round(Math.sin(ang) * 2),
    );
    const e = nightBuff(makeWildEnemy(o.tx, o.ty, tileBiome(o.tx, o.ty)));
    e.holdKey = i;
    e.legion = true;
    e.color = '#c85048';
    if (k === 0) makeElite(e);
    state.enemies.push(e);
  }
}
function placeHoldVendor(i) {
  const h = HOLD_SITES[i];
  const o = findOpenTile('overworld', h.tx + 3, h.ty + 1);
  const q = makeNPC(
    o.tx,
    o.ty,
    'Quartermaster',
    '#c0a060',
    [
      'Your outpost stands ready, commander — wares and a warm hearth await.',
      "I'll buy what you've no use for, too.",
    ],
    'shop',
  );
  q.shopTown = { key: 'h' + i, name: h.name, biome: tileBiome(h.tx, h.ty), tier: 1 };
  q.stock = genShopStock(q.shopTown);
  q.holdIdx = i;
  state.npcs.push(q);
  return q;
}
function setupHoldings() {
  ensureHoldings();
  state.holdings.forEach((hd, i) => {
    hd.besieged = false;
    if (hd.built) {
      placeHoldVendor(i);
      placeHoldAmenities(i);
    } else if (!hd.liberated) spawnHoldOccupiers(i);
  });
}
function liberateHolding(i) {
  const hd = state.holdings[i];
  if (!hd) return;
  const h = HOLD_SITES[i];
  const p = state.player;
  if (hd.besieged) {
    hd.besieged = false;
    const r = 120 + p.level * 15;
    p.gold += r;
    addRep('vigil', 6);
    addRep('dread', -4);
    log(`★ You break the siege of ${h.name}! (+${r} gold) Its tribute resumes.`, 'quest');
    Sound.jingle && Sound.jingle();
    addShake(4);
    updateHUD();
    saveGame();
    return;
  }
  if (!hd.liberated) {
    hd.liberated = true;
    const r = 80 + p.level * 10;
    p.gold += r;
    addRep('vigil', 6);
    addRep('dread', -5);
    log(
      `★ ${h.name} is freed from the Legion! (+${r} gold) Stand on the ruins and press [E] to rebuild it into your outpost.`,
      'quest',
    );
    Sound.jingle && Sound.jingle();
    addShake(4);
    updateHUD();
    saveGame();
  }
}
function rebuildCost(i) {
  return 250;
}
function rebuildOutpost(i) {
  const hd = state.holdings[i];
  const h = HOLD_SITES[i];
  const p = state.player;
  if (hd.built) return;
  if (!hd.liberated) {
    log('Clear the Legion from these ruins first.', 'combat');
    Sound.error();
    return;
  }
  const cost = rebuildCost(i);
  if (p.gold < cost) {
    Sound.error();
    log(`Rebuilding ${h.name} costs ${cost} gold — you have ${p.gold}.`, 'combat');
    return;
  }
  p.gold -= cost;
  hd.built = true;
  placeHoldVendor(i);
  addRep('vigil', 8);
  addRep('dread', -6);
  log(
    `🏰 ${h.name} is yours! An outpost rises — fast-travel here [T], trade with the Quartermaster, and it yields gold each day. Hold it well.`,
    'good',
  );
  Sound.levelup && Sound.levelup();
  addShake(6);
  spawnBurst(p.x + p.w / 2, p.y + p.h / 2, 18, { color: '#f0d050', speed: 2, up: 0.4, decay: 0.04 });
  if (ownedHoldings().length >= HOLD_SITES.length) {
    addRep('vigil', 12);
    log('★ The whole frontier flies YOUR banner — the realm rallies to your cause!', 'quest');
  }
  if ((state.companions || []).length < COMP_CAP) {
    grantCompanion(NEM_PICK(['knight', 'ranger', 'mage']));
    log('A militia volunteer from the outpost takes up arms with you.', 'lore');
  }
  updateHUD();
  saveGame();
}
function upgradeCost(i) {
  return state.holdings[i].level >= 2 ? 700 : 400;
}
function placeHoldAmenities(i) {
  const h = HOLD_SITES[i];
  const hd = state.holdings[i];
  if (!hd || !hd.built) return;
  if (hd.level >= 2 && !state.npcs.some((n) => n.holdIdx === i && n.id === 'hearth')) {
    const o = findOpenTile('overworld', h.tx - 3, h.ty + 1);
    const n = makeNPC(
      o.tx,
      o.ty,
      'Hearth',
      '#e08850',
      ['A warm outpost hearth — cook a meal from your stores [E].'],
      'hearth',
    );
    n.holdIdx = i;
    state.npcs.push(n);
  }
  if (hd.level >= 3 && !state.npcs.some((n) => n.holdIdx === i && n.id === 'smith')) {
    const o = findOpenTile('overworld', h.tx, h.ty + 3);
    const n = makeNPC(
      o.tx,
      o.ty,
      'Blacksmith',
      '#e0a060',
      ["I'll mend your arms right here in the field."],
      'smith',
    );
    n.holdIdx = i;
    state.npcs.push(n);
  }
}
function upgradeOutpost(i) {
  const hd = state.holdings[i];
  const h = HOLD_SITES[i];
  const p = state.player;
  if (!hd || !hd.built || hd.besieged) return;
  if (hd.level >= 3) {
    log(`${h.name} already stands at its height.`, 'lore');
    return;
  }
  const cost = upgradeCost(i);
  if (p.gold < cost) {
    Sound.error();
    log(`Raising ${h.name} to Lv ${hd.level + 1} costs ${cost} gold — you have ${p.gold}.`, 'combat');
    return;
  }
  p.gold -= cost;
  hd.level++;
  placeHoldAmenities(i);
  addRep('vigil', 3);
  Sound.levelup && Sound.levelup();
  addShake(4);
  spawnBurst(p.x + p.w / 2, p.y + p.h / 2, 16, { color: '#f0d050', speed: 1.8, up: 0.4, decay: 0.04 });
  log(
    `🏰 ${h.name} grows to Lv ${hd.level} — tribute rises to ${40 + hd.level * 15}/day${hd.level === 2 ? ', and a HEARTH is raised (cook here)' : ', and a BLACKSMITH sets up his forge (repair here)'}.`,
    'good',
  );
  updateHUD();
  saveGame();
}
function dailyHoldingIncome() {
  const built = ownedHoldings();
  if (!built.length) return;
  let gold = 0;
  for (const o of built) {
    if (o.h.besieged) continue;
    gold += 40 + o.h.level * 15;
  }
  if (gold > 0) {
    state.player.gold += gold;
    log(`⛺ Your outposts send ${gold} gold in tribute.`, 'good');
    updateHUD();
  }
}
function maybeRaidHolding() {
  const avail = ownedHoldings().filter((o) => !o.h.besieged);
  if (!avail.length || (state.factions.dread || 0) < 15 || Math.random() > 0.4) return;
  const o = NEM_PICK(avail);
  // A garrisoned companion meets the assault: healthy → repelled (at a cost); too weak → overwhelmed, siege lands.
  const guard = (state.companions || []).find((c) => c.alive && c.postedAt === o.i);
  if (guard) {
    guard.hp -= Math.round(guard.maxHp * 0.35);
    if (guard.hp > 0) {
      addRep('vigil', 2);
      log(
        `⚔ The Dread Legion assaults ${HOLD_SITES[o.i].name} — ${guard.name} holds the wall and repels them! (${Math.ceil(guard.hp)}/${guard.maxHp} HP)`,
        'good',
      );
      Sound.hit && Sound.hit();
      return;
    }
    guard.hp = 0;
    guard.alive = false;
    log(
      `${guard.name} is overwhelmed defending ${HOLD_SITES[o.i].name} — the outpost falls under siege!`,
      'combat',
    );
  }
  o.h.besieged = true;
  if (state.map === 'overworld') spawnHoldOccupiers(o.i);
  log(
    `⚔ The Dread Legion assaults your outpost at ${HOLD_SITES[o.i].name}! Drive them off, or its tribute stops.`,
    'combat',
  );
  Sound.boss && Sound.boss();
}
function drawHolding(i) {
  const h = HOLD_SITES[i];
  const hd = state.holdings && state.holdings[i];
  if (!hd) return;
  const sx = h.tx * TILE - state.camera.x,
    sy = h.ty * TILE - state.camera.y;
  if (sx < -110 || sx > VIEW_W + 110 || sy < -110 || sy > VIEW_H + 110) return;
  const p = state.player;
  const near = Math.abs((p.x + p.w / 2) / TILE - h.tx) < 3 && Math.abs((p.y + p.h / 2) / TILE - h.ty) < 3;
  ctx.save();
  for (let j = 0; j < 3; j++) {
    const ox = sx - 20 + j * 18,
      oy = sy - (j % 2 ? 6 : 0);
    const intact = hd.built;
    ctx.fillStyle = intact ? '#8a5a36' : '#4a3a2e';
    ctx.fillRect(ox, oy + 3, 14, 11);
    ctx.fillStyle = intact ? '#b06038' : '#2e2118';
    ctx.beginPath();
    ctx.moveTo(ox - 1, oy + 3);
    ctx.lineTo(ox + 7, oy - 4);
    ctx.lineTo(ox + 15, oy + 3);
    ctx.closePath();
    ctx.fill();
    if (intact) {
      ctx.fillStyle = '#f0d050';
      ctx.fillRect(ox + 5, oy + 6, 3, 6);
    }
  }
  const px = sx + 8;
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, sy + 14);
  ctx.lineTo(px, sy - 20);
  ctx.stroke();
  if (!hd.liberated) {
    ctx.fillStyle = '#d03028';
    ctx.beginPath();
    ctx.moveTo(px, sy - 20);
    ctx.lineTo(px + 15, sy - 15.5);
    ctx.lineTo(px, sy - 11);
    ctx.closePath();
    ctx.fill();
  } else if (hd.built) {
    ctx.fillStyle = hd.besieged ? '#d03028' : '#f0c040';
    ctx.beginPath();
    ctx.moveTo(px, sy - 20);
    ctx.lineTo(px + 15, sy - 15.5);
    ctx.lineTo(px, sy - 11);
    ctx.closePath();
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.font = '9px monospace';
  let lbl, col;
  if (!hd.liberated) {
    lbl = '⚔ ' + h.name + ' — Legion-held';
    col = '#ff6a5a';
  } else if (!hd.built) {
    lbl = '○ ' + h.name + ' — ruins';
    col = '#c8c8d8';
  } else {
    lbl = (hd.besieged ? '⚔ ' : '🏰 ') + h.name + (hd.level > 1 ? ' · Lv' + hd.level : '');
    col = hd.besieged ? '#ff7070' : '#f0d878';
  }
  ctx.fillStyle = col;
  ctx.fillText(lbl, px, sy - 24);
  if (near) {
    const bob = Math.sin(Date.now() / 200) * 2;
    if (hd.liberated && !hd.built) {
      ctx.fillStyle = '#90ff90';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('[E] Rebuild (' + rebuildCost(i) + 'g)', px, sy - 34 + bob);
    } else if (!hd.liberated) {
      ctx.fillStyle = '#ff6a5a';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('⚔', px, sy - 34 + bob);
    } else if (hd.built && !hd.besieged && hd.level < 3) {
      ctx.fillStyle = '#90ff90';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('[E] Upgrade (' + upgradeCost(i) + 'g)', px, sy - 34 + bob);
    }
  }
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  ctx.restore();
}
function doTravelHold(i) {
  const h = HOLD_SITES[i];
  const p = state.player;
  resetFishing();
  p.x = h.tx * TILE;
  p.y = h.ty * TILE;
  p.dvx = 0;
  p.dvy = 0;
  p.dodge = 0;
  p.invuln = 30;
  state.camera.x = p.x - VIEW_W / 2;
  state.camera.y = p.y - VIEW_H / 2;
  state.time += Math.floor(DAY_FRAMES * 0.32);
  state.lastRestDay = curDay();
  _wasExhausted = isExhausted();
  recalcStats();
  spawnBurst(p.x + p.w / 2, p.y + p.h / 2, 18, { color: '#a8c8ff', speed: 2, decay: 0.04 });
  Sound.tone(440, 0.3, 'sine', 0.12, { slideTo: 880 });
  setupCompanions();
  closeTravel();
  log(`You travel the old roads to your outpost at ${h.name}.`, 'lore');
  updateHUD();
  updateWorldLine();
  saveGame();
}

// ================= COMPANIONS — a recruited warband that fights, levels, and can fall =================
const COMP_CLASSES = {
  knight: {
    name: 'Knight',
    color: '#cdd0e6',
    baseHp: 120,
    baseAtk: 11,
    baseDef: 6,
    range: 42,
    melee: true,
    speed: 1.5,
    hire: 200,
    icon: '⚔',
    desc: 'Stalwart melee — wades in and soaks blows.',
  },
  ranger: {
    name: 'Ranger',
    color: '#9bd56a',
    baseHp: 78,
    baseAtk: 10,
    baseDef: 2,
    range: 250,
    melee: false,
    speed: 1.6,
    hire: 200,
    icon: '➶',
    desc: 'Looses arrows from range; keeps her distance.',
  },
  mage: {
    name: 'Mage',
    color: '#b886ff',
    baseHp: 64,
    baseAtk: 13,
    baseDef: 1,
    range: 220,
    melee: false,
    speed: 1.4,
    hire: 240,
    icon: '✦',
    desc: 'Hurls piercing arcane bolts; fragile.',
  },
};
const COMP_NAMES = [
  'Sera',
  'Brom',
  'Kael',
  'Lyra',
  'Dorn',
  'Wren',
  'Talia',
  'Garrick',
  'Mira',
  'Osric',
  'Fenn',
  'Isolde',
  'Rurik',
  'Esme',
  'Joss',
  'Nadia',
];
const COMP_CAP = 3;
function compStatsFor(cls, level) {
  const C = COMP_CLASSES[cls] || COMP_CLASSES.knight;
  const f = 1 + (level - 1) * 0.14;
  return {
    maxHp: Math.round(C.baseHp * f),
    atk: Math.round(C.baseAtk * f),
    def: Math.round(C.baseDef + (level - 1) * 0.4),
  };
}
function activeCompanions() {
  return (state.companions || []).filter((c) => c.alive);
}
function placeCompanionNearPlayer(c) {
  const p = state.player;
  c.x = p.x - 22 + Math.random() * 44;
  c.y = p.y + 12 + Math.random() * 12;
  c.attackCd = 0;
  c.hurtCd = 0;
}
function anchorCompanion(c) {
  if (c.postedAt != null && HOLD_SITES[c.postedAt]) {
    if (state.map === 'overworld') {
      const h = HOLD_SITES[c.postedAt];
      c.x = h.tx * TILE + 8;
      c.y = h.ty * TILE + 20;
      c.attackCd = 0;
      c.hurtCd = 0;
    }
  } else placeCompanionNearPlayer(c);
}
function makeCompanion(cls, name) {
  const lvl = Math.max(1, state.player.level);
  const s = compStatsFor(cls, lvl);
  const c = {
    name,
    cls,
    level: lvl,
    alive: true,
    maxHp: s.maxHp,
    hp: s.maxHp,
    atk: s.atk,
    def: s.def,
    weapon: null,
    postedAt: null,
    x: 0,
    y: 0,
    w: 22,
    h: 22,
    attackCd: 0,
    hurtCd: 0,
    wobble: Math.random() * 6.28,
    color: COMP_CLASSES[cls].color,
  };
  placeCompanionNearPlayer(c);
  return c;
}
function freeCompName() {
  const used = (state.companions || []).map((c) => c.name);
  return NEM_PICK(COMP_NAMES.filter((n) => !used.includes(n))) || NEM_PICK(COMP_NAMES);
}
function recruitCompanion(cls) {
  const p = state.player;
  if (!state.companions) state.companions = [];
  if (state.companions.length >= COMP_CAP) {
    Sound.error();
    log(`Your warband is full (${COMP_CAP}). Dismiss someone first.`, 'combat');
    return;
  }
  const cost = COMP_CLASSES[cls].hire;
  if (p.gold < cost) {
    Sound.error();
    log(`Hiring a ${COMP_CLASSES[cls].name} costs ${cost} gold — you have ${p.gold}.`, 'combat');
    return;
  }
  p.gold -= cost;
  const c = makeCompanion(cls, freeCompName());
  state.companions.push(c);
  Sound.jingle && Sound.jingle();
  log(`⚔ ${c.name} the ${COMP_CLASSES[cls].name} joins your warband!`, 'good');
  updateHUD();
  if (state.scene === 'companions') renderCompanions();
  saveGame();
}
function grantCompanion(cls) {
  if (!state.companions) state.companions = [];
  if (state.companions.length >= COMP_CAP) return false;
  const c = makeCompanion(cls, freeCompName());
  state.companions.push(c);
  log(`⚔ ${c.name} the ${COMP_CLASSES[cls].name} pledges to your banner!`, 'good');
  return true;
}
function dismissCompanion(idx) {
  const c = state.companions[idx];
  if (!c) return;
  if (c.weapon) {
    state.inventory.weapons.push(c.weapon);
    log(`${c.name} returns the ${c.weapon.name} before departing.`, 'lore');
    c.weapon = null;
  }
  state.companions.splice(idx, 1);
  log(`${c.name} departs your warband.`, 'lore');
  Sound.blip && Sound.blip();
  renderCompanions();
  saveGame();
}
function setupCompanions() {
  for (const c of state.companions || []) if (c.alive) anchorCompanion(c);
}
function bumpCompanionLevels() {
  for (const c of state.companions || []) {
    if (c.level < state.player.level) {
      c.level = state.player.level;
      const s = compStatsFor(c.cls, c.level);
      const frac = c.maxHp ? c.hp / c.maxHp : 1;
      c.maxHp = s.maxHp;
      c.hp = Math.max(1, Math.round(c.maxHp * Math.max(0.55, frac)));
      c.atk = s.atk;
      c.def = s.def;
    }
  }
}
function reviveCompanions() {
  let n = 0;
  for (const c of state.companions || []) {
    if (!c.alive) {
      c.alive = true;
      c.hp = c.maxHp;
      anchorCompanion(c);
      n++;
    } else if (c.hp < c.maxHp) {
      c.hp = c.maxHp;
    }
  }
  if (n > 0)
    log(`${n} fallen companion${n > 1 ? 's' : ''} recover${n > 1 ? '' : 's'} and return to duty.`, 'good');
}
// Companion gear: one weapon slot, filled with your best spare weapon of the class's style. +70% of its atk.
function compStyleFor(cls) {
  return cls === 'ranger' ? 'ranged' : cls === 'mage' ? 'magic' : 'melee';
}
function compWeaponBonus(c) {
  return c.weapon ? Math.max(0, Math.round((c.weapon.atk || 0) * 0.7)) : 0;
}
function armCompanion(idx) {
  const c = state.companions[idx];
  if (!c) return;
  const want = compStyleFor(c.cls);
  const pool = state.inventory.weapons
    .filter((w) => !w.equipped && styleOf(w) === want)
    .sort((a, b) => (b.atk || 0) - (a.atk || 0));
  if (!pool.length) {
    Sound.error();
    log(`No spare ${styleLabel(want)} weapon in your bags for ${c.name}.`, 'combat');
    return;
  }
  const bestW = pool[0];
  if (c.weapon && (bestW.atk || 0) <= (c.weapon.atk || 0)) {
    log(`${c.name} already carries a finer ${styleLabel(want)} arm (${c.weapon.name}).`, 'lore');
    return;
  }
  if (c.weapon) state.inventory.weapons.push(c.weapon);
  state.inventory.weapons.splice(state.inventory.weapons.indexOf(bestW), 1);
  c.weapon = bestW;
  Sound.click && Sound.click();
  log(`${c.name} takes up the ${bestW.name} (+${compWeaponBonus(c)} ⚔).`, 'good');
  renderCompanions();
  saveGame();
}
