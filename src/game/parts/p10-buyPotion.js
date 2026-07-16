function buyPotion() {
  const p = state.player;
  if (p.gold < 15) return;
  p.gold -= 15;
  state.inventory.items.find((i) => i.name === 'Potion').qty++;
  log('Bought a Potion.', 'good');
  afterBuy();
}
function buyTonic() {
  const p = state.player;
  const c = tonicCost();
  if (p.gold < c) return;
  p.gold -= c;
  p.tonics++; // per-hero (P2/S5): each hero's tonic count — and therefore price ramp — is their own
  p.maxHp += 5;
  p.hp += 5;
  log('Health Tonic! +5 Max HP forever.', 'good');
  afterBuy();
}
function buyWeapon(it) {
  const p = state.player;
  const cost = buyPrice(it.cost);
  if (p.gold < cost || p.shopPurchased.includes(it.id)) return;
  p.gold -= cost;
  p.shopPurchased.push(it.id); // per-hero (P2/S7): your purchase greys the item for YOU, not the room
  const R = RARITIES[it.rarity];
  const w = {
    name: it.name,
    atk: it.atk,
    style: it.style,
    rarity: it.rarity,
    reqLevel: it.reqLevel,
    reqProf: it.reqProf,
    dur: R.dur,
    durMax: R.dur,
    equipped: false,
  };
  if (it.cd) w.cd = it.cd;
  if (it.element) w.element = it.element;
  if (it.affixes) w.affixes = it.affixes;
  if (it.bonus) w.bonus = it.bonus;
  state.inventory.weapons.push(w);
  log(`Bought ${it.name} (${styleLabel(it.style)})! Equip in inventory [I].`, 'good');
  afterBuy();
}
function buyArmor(it) {
  const p = state.player;
  const cost = buyPrice(it.cost);
  if (p.gold < cost || p.shopPurchased.includes(it.id)) return;
  p.gold -= cost;
  p.shopPurchased.push(it.id);
  const R = RARITIES[it.rarity];
  const a = {
    name: it.name,
    def: it.def,
    rarity: it.rarity,
    reqLevel: it.reqLevel,
    dur: R.dur,
    durMax: R.dur,
    equipped: false,
  };
  if (it.affixes) a.affixes = it.affixes;
  if (it.bonus) a.bonus = it.bonus;
  state.inventory.armor.push(a);
  log(`Bought ${it.name}! Equip in inventory [I].`, 'good');
  afterBuy();
}
function sellItem(it, kind) {
  if (it.equipped) return;
  const arr = kind === 'weapon' ? state.inventory.weapons : state.inventory.armor;
  const idx = arr.indexOf(it);
  if (idx < 0) return;
  if (arr.length <= 1) {
    log(`You can't sell your only ${kind}.`, 'combat');
    return;
  }
  arr.splice(idx, 1);
  const val = sellValue(it);
  state.player.gold += val;
  log(`Sold ${it.name} for ${val} gold.`, 'good');
  afterBuy();
}
function afterBuy() {
  updateHUD();
  renderShop();
  saveGame();
  Sound.click();
}

// ================= BLACKSMITH =================
function repairCost(it) {
  const miss = (it.durMax || 0) - (it.dur ?? it.durMax);
  if (miss <= 0) return 0;
  const rIdx = it.rarity || 0;
  return Math.max(1, Math.ceil(miss * 2 * (1 + rIdx * 0.6) * (1 - vigilDiscount())));
}
function openSmith() {
  state.scene = 'smith';
  document.getElementById('smith').style.display = 'block';
  renderSmith();
}
function closeSmith() {
  document.getElementById('smith').style.display = 'none';
  state.scene = 'play';
  saveGame();
  __g.interactCd = 18;
}
function damagedItems() {
  const list = [];
  state.inventory.weapons.forEach((w) => {
    if (w.durMax !== undefined && w.dur < w.durMax) list.push(w);
  });
  state.inventory.armor.forEach((a) => {
    if (a.durMax !== undefined && a.dur < a.durMax) list.push(a);
  });
  return list;
}
// Forge services (v2.32.0): REFORGE rerolls the equipped weapon's affixes; FUSE melts your best spare
// same-style weapon into it (+25% of its atk, max 3 fusions, inherits its element if the blade has none).
function bestFuseSacrifice() {
  const w = equippedWeapon();
  if (!w) return null;
  const st = styleOf(w);
  return (
    state.inventory.weapons
      .filter((x) => x !== w && !x.equipped && styleOf(x) === st)
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0] || null
  );
}
function temperMax(w) {
  return w ? 2 + (w.rarity || 0) : 0;
} // Common 2 slots … Legendary 6
function temperCost(w) {
  return w ? 70 + (w.temper || 0) * 60 + (w.rarity || 0) * 40 : 0;
}
function temperWeapon() {
  const p = state.player;
  const w = equippedWeapon();
  if (!w) {
    log('Equip a weapon first.');
    return;
  }
  if ((w.temper || 0) >= temperMax(w)) {
    Sound.error && Sound.error();
    log(`${w.name} is tempered to its limit (${temperMax(w)}/${temperMax(w)}).`, 'lore');
    return;
  }
  const c = temperCost(w);
  if (p.gold < c) {
    Sound.error();
    return;
  }
  p.gold -= c;
  w.atk = (w.atk || 0) + 2;
  w.temper = (w.temper || 0) + 1;
  recalcStats();
  Sound.jingle && Sound.jingle();
  addShake(2);
  log(`\u2692 ${w.name} tempered \u2014 +2 power (temper ${w.temper}/${temperMax(w)}).`, 'good');
  renderSmith();
  updateHUD();
  saveGame();
}
function reforgeWeapon() {
  const p = state.player;
  const w = equippedWeapon();
  if (!w || (w.rarity || 0) < 2) return;
  const cost = 120 * ((w.rarity || 0) + 1);
  if (p.gold < cost) {
    Sound.error();
    return;
  }
  p.gold -= cost;
  let af = null;
  for (let i = 0; i < 24 && !af; i++) af = rollAffixes(w.rarity || 0, true);
  if (af) w.affixes = af;
  recalcStats();
  Sound.jingle && Sound.jingle();
  log(
    `⚒ ${w.name} reforged — ${w.affixes && w.affixes.length ? w.affixes.map((a) => afxText(a)).join(', ') : 'the metal stays plain'}.`,
    'good',
  );
  renderSmith();
  updateHUD();
  saveGame();
}
function fuseWeapon() {
  const p = state.player;
  const w = equippedWeapon();
  const sac = bestFuseSacrifice();
  if (!w || !sac || (w.fused || 0) >= 3) return;
  const cost = 150;
  if (p.gold < cost) {
    Sound.error();
    return;
  }
  p.gold -= cost;
  const gain = Math.max(1, Math.ceil((sac.atk || 0) * 0.25));
  w.atk = (w.atk || 0) + gain;
  w.fused = (w.fused || 0) + 1;
  let elMsg = '';
  if (!w.element && sac.element) {
    w.element = sac.element;
    elMsg = ` It drinks in the sacrifice's ${ELEMENTS[sac.element].name}!`;
  }
  state.inventory.weapons.splice(state.inventory.weapons.indexOf(sac), 1);
  recalcStats();
  Sound.levelup && Sound.levelup();
  addShake(3);
  log(`⚒ ${sac.name} is melted into ${w.name}: +${gain} ⚔ (fusion ${w.fused}/3).${elMsg}`, 'good');
  renderSmith();
  updateHUD();
  saveGame();
}
function renderSmith() {
  const p = state.player;
  document.getElementById('smith-gold-amt').textContent = p.gold;
  const el = document.getElementById('smith-list');
  el.innerHTML = '';
  const w = equippedWeapon();
  if (w) {
    const hdr = document.createElement('div');
    hdr.style.cssText = 'color:#d0b070;font-size:12px;text-align:center;margin:2px 0 5px';
    hdr.textContent = '⚒ FORGE — ' + w.name;
    el.appendChild(hdr);
    const rc = 120 * ((w.rarity || 0) + 1);
    const r1 = document.createElement('div');
    r1.className = 'skill-row';
    r1.innerHTML = `<div><b>Reforge Affixes</b> <span class="sk-desc">reroll this weapon's affixes anew</span><br><span class="sk-val">${w.affixes && w.affixes.length ? w.affixes.map((a) => afxText(a)).join(', ') : 'no affixes yet'} · <span style="color:#f0d050">${rc}g</span></span></div>`;
    const b1 = document.createElement('button');
    b1.className = 'sk-btn';
    if ((w.rarity || 0) < 2) {
      b1.textContent = 'Rarity 2+';
      b1.disabled = true;
    } else if (p.gold < rc) {
      b1.textContent = 'Need gold';
      b1.disabled = true;
    } else {
      b1.textContent = 'Reforge';
      b1.onclick = () => reforgeWeapon();
    }
    r1.appendChild(b1);
    el.appendChild(r1);
    const sac = bestFuseSacrifice();
    const fusedN = w.fused || 0;
    const r2 = document.createElement('div');
    r2.className = 'skill-row';
    r2.innerHTML = `<div><b>Fuse Weapon</b> <span class="sk-desc">melt your best spare ${styleLabel(styleOf(w))} arm into this one (${fusedN}/3)</span><br><span class="sk-val">${sac ? `consumes ${sac.name} → +${Math.max(1, Math.ceil((sac.atk || 0) * 0.25))} ⚔${!w.element && sac.element ? ' + its element' : ''}` : 'no spare ' + styleLabel(styleOf(w)) + ' weapon'} · <span style="color:#f0d050">150g</span></span></div>`;
    const b2 = document.createElement('button');
    b2.className = 'sk-btn';
    if (!sac) {
      b2.textContent = 'No spare';
      b2.disabled = true;
    } else if (fusedN >= 3) {
      b2.textContent = 'Max fused';
      b2.disabled = true;
    } else if (p.gold < 150) {
      b2.textContent = 'Need gold';
      b2.disabled = true;
    } else {
      b2.textContent = 'Fuse';
      b2.onclick = () => fuseWeapon();
    }
    r2.appendChild(b2);
    el.appendChild(r2);
    {
      const tc = temperCost(w),
        tmax = temperMax(w),
        tcur = w.temper || 0,
        tmaxed = tcur >= tmax;
      el.appendChild(
        shopRow(
          'Temper Weapon',
          `+2 power \u2014 hone the blade (${tcur}/${tmax})`,
          tmaxed ? 'at its limit' : tc + ' gold',
          () => temperWeapon(),
          !tmaxed && p.gold < tc,
          tmaxed,
        ),
      );
    }
    const rh = document.createElement('div');
    rh.style.cssText = 'color:#d0b070;font-size:12px;text-align:center;margin:8px 0 4px';
    rh.textContent = '🔧 REPAIRS';
    el.appendChild(rh);
  }
  const items = damagedItems();
  if (items.length === 0) {
    const d = document.createElement('div');
    d.className = 'skill-row';
    d.style.justifyContent = 'center';
    d.innerHTML = '<span style="color:#80b080">All your gear is in fine repair.</span>';
    el.appendChild(d);
    return;
  }
  const total = items.reduce((s, it) => s + repairCost(it), 0);
  const head = document.createElement('div');
  head.className = 'skill-row';
  head.innerHTML = `<div><b>Repair Everything</b> <span class="sk-desc">restore all damaged gear</span><br><span class="sk-val" style="color:#f0d050">${total} gold</span></div>`;
  const hb = document.createElement('button');
  hb.className = 'sk-btn fix-btn';
  if (p.gold < total) {
    hb.textContent = 'Need gold';
    hb.disabled = true;
  } else {
    hb.textContent = 'Repair All';
    hb.onclick = () => repairAll();
  }
  head.appendChild(hb);
  el.appendChild(head);
  items.forEach((it) => {
    const cost = repairCost(it);
    const col = rarityColor(it.rarity);
    const dmg = isBroken(it) ? '<span style="color:#ff5050">BROKEN</span>' : `${it.dur}/${it.durMax}`;
    const r = document.createElement('div');
    r.className = 'skill-row';
    r.innerHTML = `<div><b style="color:${col}">${it.name}</b> <span class="sk-desc">${dmg}</span><br><span class="sk-val" style="color:#f0d050">${cost} gold</span></div>`;
    const b = document.createElement('button');
    b.className = 'sk-btn fix-btn';
    if (p.gold < cost) {
      b.textContent = 'Need gold';
      b.disabled = true;
    } else {
      b.textContent = 'Repair';
      b.onclick = () => repairItem(it);
    }
    r.appendChild(b);
    el.appendChild(r);
  });
}
function repairItem(it) {
  const c = repairCost(it);
  if (c <= 0 || state.player.gold < c) return;
  state.player.gold -= c;
  it.dur = it.durMax;
  recalcStats();
  updateHUD();
  renderSmith();
  saveGame();
  Sound.click();
  log(`${it.name} repaired to full.`, 'good');
}
function repairAll() {
  const items = damagedItems();
  const total = items.reduce((s, it) => s + repairCost(it), 0);
  if (state.player.gold < total) return;
  state.player.gold -= total;
  items.forEach((it) => (it.dur = it.durMax));
  recalcStats();
  updateHUD();
  renderSmith();
  saveGame();
  Sound.click();
  log('All gear repaired to full.', 'good');
}

function drinkPotion() {
  const pot = state.inventory.items.find((i) => i.name === 'Potion');
  if (!pot || pot.qty <= 0) {
    Sound.error();
    log('No potions left!', 'combat');
    return;
  }
  if (state.player.hp >= state.player.maxHp) {
    log('Already at full health.');
    return;
  }
  pot.qty--;
  state.player.hp = Math.min(state.player.maxHp, state.player.hp + 15);
  Sound.heal();
  spawnBurst(state.player.x + state.player.w / 2, state.player.y + state.player.h / 2, 10, {
    color: '#ff8080',
    speed: 1.4,
    up: 0.7,
    decay: 0.04,
  });
  log('You drink a potion. +15 HP.', 'good');
  updateHUD();
}

// ================= INTERACT =================
// --- Shrines of blessing ---
const BLESS = {
  might: { name: 'Might', color: '#ff8050', desc: '+40% damage' },
  ward: { name: 'Ward', color: '#70b0ff', desc: '−40% damage taken' },
  haste: { name: 'Haste', color: '#90e060', desc: 'faster attacks & movement' },
  renewal: { name: 'Renewal', color: '#90ffb0', desc: 'regenerate health' },
};
const BLESS_DUR = 1800,
  SHRINE_CD = 2700;
function activateShrine(s) {
  const p = state.player;
  if (s.sinking) {
    return;
  }
  if (s.cd > 0) {
    Sound.error();
    log(`The shrine lies dormant — it stirs again in ${Math.ceil(s.cd / 60)}s.`, 'lore');
    return;
  }
  const b = BLESS[s.type];
  p.blessType = s.type;
  p.blessT = BLESS_DUR;
  s.sinking = 1;
  s.sinkT = 0;
  recalcStats();
  Sound.jingle();
  addShake(2);
  for (let i = 0; i < 3; i++)
    spawnBurst(s.x + s.w / 2, s.y + s.h / 2, 14, { color: b.color, speed: 1.4 + i, up: 0.5, decay: 0.04 });
  log(`You kneel at the Shrine of ${b.name}. Blessing: ${b.desc} (30s).`, 'quest');
  log('Its power spent, the shrine sinks back into the earth…', 'lore');
  updateHUD();
  updateWorldLine();
}
function tickBlessing() {
  const p = state.player;
  if (p.blessT > 0) {
    p.blessT--;
    if (p.blessType === 'renewal' && p.hp < p.maxHp && p.blessT % 12 === 0)
      p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.round(p.maxHp * 0.012)));
    if (p.blessT <= 0) {
      p.blessType = null;
      recalcStats();
      log('Your blessing fades.', 'lore');
      updateHUD();
    }
  }
  for (const s of state.shrines) if (s.cd > 0) s.cd--;
}
// --- Bounties ---
function rollBounty() {
  const lvl = state.player.level;
  const r = Math.random();
  if (r < 0.34)
    return {
      type: 'cull',
      target: 8 + lvl,
      progress: 0,
      reward: 120 + lvl * 25,
      desc: `Cull the wilds: slay ${8 + lvl} foes`,
    };
  if (r < 0.67)
    return {
      type: 'elite',
      target: 3,
      progress: 0,
      reward: 200 + lvl * 35,
      sp: 1,
      desc: 'Hunt 3 Elite foes',
    };
  return {
    type: 'depth',
    target: state.maxDepth + 3,
    progress: state.maxDepth,
    reward: 260 + lvl * 30,
    loot: true,
    desc: `Delve to dungeon Depth ${state.maxDepth + 3}`,
  };
}
function openBounty() {
  const p = state.player;
  const b = state.bounty;
  if (!b) {
    state.bounty = rollBounty();
    updateQuests();
    Sound.blip();
    log(
      `Bounty accepted — ${state.bounty.desc}. Reward: ${state.bounty.reward} gold${state.bounty.sp ? ' + a skill point' : ''}${state.bounty.loot ? ' + rare loot' : ''}.`,
      'quest',
    );
    saveGame();
    return;
  }
  if (b.progress >= b.target) {
    p.gold += b.reward;
    if (b.sp) p.skillPoints += 1;
    if (b.loot) {
      const rIdx = Math.min(4, 3 + Math.floor(Math.random() * 2));
      const it =
        Math.random() < 0.5
          ? { weapon: genWeapon(p.level + 2, rIdx) }
          : { armor: genArmor(p.level + 2, rIdx) };
      if (it.weapon) {
        normItem(it.weapon, true);
        state.inventory.weapons.push(it.weapon);
      }
      if (it.armor) {
        normItem(it.armor, false);
        state.inventory.armor.push(it.armor);
      }
    }
    Sound.jingle();
    log(
      `Bounty complete! +${b.reward} gold${b.sp ? ' +1 skill point' : ''}${b.loot ? ' + rare loot (check [I])' : ''}.`,
      'good',
    );
    addRep('vigil', 6);
    addRep('dread', 3);
    state.bounty = null;
    updateQuests();
    updateHUD();
    saveGame();
    return;
  }
  Sound.blip();
  log(
    `Bounty in progress — ${b.desc} (${Math.min(b.progress, b.target)}/${b.target}). Return when it's done.`,
    'quest',
  );
}
function bountyProgress(kind, e) {
  const b = state.bounty;
  if (!b || b.progress >= b.target) return;
  const was = b.progress;
  if (b.type === 'cull' && kind === 'kill' && !(e && e.isBoss)) b.progress++;
  else if (b.type === 'elite' && kind === 'kill' && e && e.elite) b.progress++;
  else if (b.type === 'depth' && kind === 'depth') b.progress = Math.max(b.progress, state.maxDepth);
  if (b.progress >= b.target && was < b.target) {
    log(`Bounty ready to claim at a Bounty Board: ${b.desc}!`, 'good');
    updateQuests();
  }
}
function tryInteract() {
  if (__g.interactCd > 0) return;
  const p = state.player;
  for (const e of state.enemies)
    if (e.isWildDragon && e.subdued && rectDist(p, e) < 64) {
      tameDragon(e);
      return;
    }
  for (const e of state.enemies)
    if (canDominate(e) && rectDist(p, e) < 54) {
      dominate(e);
      return;
    }
  for (const s of state.shrines)
    if (rectDist(p, s) < 40) {
      activateShrine(s);
      return;
    }
  for (const s of state.loreStones || [])
    if (rectDist(p, s) < 44) {
      readLoreStone(s);
      return;
    }
  for (const npc of state.npcs)
    if (rectDist(p, npc) < 40) {
      if (npc.id === 'shop') openShop(npc);
      else if (npc.id === 'smith') openSmith();
      else if (npc.id === 'bounty') openBounty();
      else if (npc.id === 'shipwright') buyBoat();
      else if (npc.id === 'hunts') openHunts();
      else if (npc.id === 'hearth') openCook();
      else if (npc.id === 'recruit') openCompanions();
      else startDialogue(npc);
      return;
    }
  const tx = Math.floor((p.x + p.w / 2) / TILE),
    ty = Math.floor((p.y + p.h / 2) / TILE);
  if (state.map === 'overworld') {
    const hi = holdNear(tx, ty, 2);
    if (hi >= 0 && state.holdings[hi]) {
      const hd = state.holdings[hi];
      if (hd.liberated && !hd.built) {
        rebuildOutpost(hi);
        return;
      }
      if (hd.built && !hd.besieged && hd.level < 3) {
        upgradeOutpost(hi);
        return;
      }
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (getTile('overworld', tx + dx, ty + dy) === T.DUNGEON_ENTRANCE) {
          tryEnterDungeon();
          return;
        }
  }
  if (state.map === 'dungeon') {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = getTile('dungeon', tx + dx, ty + dy);
        if (t === T.D_DOOR) {
          openKeyVault(tx + dx, ty + dy);
          return;
        }
        if (t === T.D_DESCEND) {
          descend();
          return;
        }
        if (t === T.D_EXIT) {
          exitDungeon();
          return;
        }
      }
  }
  if (state.map === 'overworld' && tryFish()) return;
}
function tryEnterDungeon() {
  if (state.inventory.keys > 0 || state.player.enteredDungeon) {
    if (!state.player.enteredDungeon) {
      log('You unlock the dungeon with the key. The door groans open...', 'quest');
      state.player.enteredDungeon = true;
    }
    enterDungeon();
  } else {
    log('The dungeon door is sealed. You need the KEY.', 'combat');
    log('The Elder said it was lost out in the wild lands.', 'quest');
  }
}
function enterDungeon() {
  resetFishing();
  if (state.dragon.mounted) {
    state.dragon.mounted = false;
    recalcStats();
  }
  saveOverworld();
  state.dungeonLevel = 1;
  state.maxDepth = Math.max(state.maxDepth, 1);
  setupDungeonFloor(1);
  Sound.descend();
  Sound.startMusic('dungeon');
  log('You descend into the Sunken Dungeon — ' + dungeonTheme(1).name + '. Depth 1.', 'lore');
  log('Find ▼ stairs to go deeper. ▲ returns to the surface (every 3rd floor).', 'quest');
  updateHUD();
}
function openKeyVault(tx, ty) {
  const p = state.player;
  if (state.inventory.keys <= 0) {
    Sound.error();
    log('A rune-sealed vault door. It hungers for a DUNGEON KEY.', 'combat');
    return;
  }
  state.inventory.keys--;
  maps.dungeon[ty][tx] = T.D_FLOOR;
  if (state.vault) state.vault.opened = true;
  Sound.jingle && Sound.jingle();
  addShake(3);
  spawnBurst(tx * TILE + 16, ty * TILE + 16, 14, { color: '#ffd76a', speed: 2, decay: 0.04 });
  log('🗝 The key crumbles to dust — the vault grinds open!', 'good');
  if (state.vault && Math.random() < 0.35) {
    const v = state.vault;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++)
      state.enemies.push(
        makeDungeonEnemy(
          v.x - 1 + Math.floor(Math.random() * 3),
          v.y - 1 + Math.floor(Math.random() * 3),
          state.dungeonLevel,
        ),
      );
    log('…it was a DEN! Steel yourself!', 'combat');
    Sound.boss && Sound.boss();
  }
  updateHUD();
  saveGame();
}
