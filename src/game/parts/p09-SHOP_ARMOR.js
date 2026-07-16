const SHOP_ARMOR = [
  { id: 'chain_mail', name: 'Chain Mail', def: 5, cost: 90, rarity: 0, reqLevel: 2 },
  { id: 'plate_armor', name: 'Plate Armor', def: 8, cost: 220, rarity: 1, reqLevel: 5 },
  { id: 'guardian_plate', name: 'Guardian Plate', def: 13, cost: 460, rarity: 2, reqLevel: 8 },
];
function tonicCost() {
  const t = state.player.tonics | 0; // per-hero (P2/S5): the price ramps on YOUR tonic count
  return 50 + t * t * 10 + t * 40;
} // v2.41.0: steeper (2x+ per upgrade) — was 50+tonics*30, too spammable in MP
function openShop(npc) {
  if (
    npc &&
    npc.holdIdx != null &&
    state.holdings &&
    state.holdings[npc.holdIdx] &&
    state.holdings[npc.holdIdx].besieged
  ) {
    Sound.error();
    log(`${HOLD_SITES[npc.holdIdx].name} is under siege — drive off the Legion before trading.`, 'combat');
    return;
  }
  const key = npc && npc.shopTown && npc.shopTown.key;
  const ti = key && /^t\d+$/.test(key) ? parseInt(key.slice(1)) : -1;
  if (ti >= 0 && __g.townZones[ti] && __g.townZones[ti].besieged) {
    Sound.error();
    log(
      `${__g.townZones[ti].name} is under siege — drive off the Dread Legion before any trade resumes.`,
      'combat',
    );
    return;
  }
  state.scene = 'shop';
  // P2/S9: the shop SESSION lives on the PLAYER (which town/stock/name THIS hero is trading
  // at) — shared root keys meant two heroes at two stores traded at whichever opened last.
  state.player.activeShopTown = ti;
  state.player.activeStock = (npc && npc.stock) || genShopStock({ key: 'def', biome: 0, tier: 1 });
  state.player.activeShopName = (npc && npc.shopTown && npc.shopTown.name) || 'Shop';
  document.getElementById('shop').style.display = 'block';
  renderShop();
}
function closeShop() {
  document.getElementById('shop').style.display = 'none';
  state.scene = 'play';
  saveGame();
  __g.interactCd = 18;
}
function currentTownIndex() {
  if (state.map !== 'overworld') return -1;
  const tx = Math.floor((state.player.x + state.player.w / 2) / TILE),
    ty = Math.floor((state.player.y + state.player.h / 2) / TILE);
  for (let i = 0; i < __g.townZones.length; i++) {
    const tz = __g.townZones[i];
    if (tx >= tz.x - 1 && tx < tz.x + tz.w + 1 && ty >= tz.y - 1 && ty < tz.y + tz.h + 1) return i;
  }
  return -1;
}
function markTownVisited() {
  const p = state.player; // P2/S9: the travel list is per-HERO ("have I been there?") and rides the save
  if (!p.visitedTowns) p.visitedTowns = [];
  const i = currentTownIndex();
  if (i >= 0 && !p.visitedTowns.includes(i)) {
    p.visitedTowns.push(i);
    if (i !== 0)
      log(`${__g.townZones[i].name} discovered — fast-travel here anytime with [T] from a town.`, 'good');
  }
}
function openTravel() {
  if (state.scene !== 'play' || state.map !== 'overworld') return;
  if (state.dragon.mounted) {
    log('Dismount before invoking fast-travel.', 'combat');
    Sound.error();
    return;
  }
  if (currentTownIndex() < 0 && currentHoldIndex() < 0) {
    log('Fast-travel can only be invoked from a town or one of your outposts.', 'combat');
    Sound.error();
    return;
  }
  for (const e of state.enemies)
    if (rectDist(state.player, e) < 210) {
      log('Foes are too near — you cannot set out.', 'combat');
      Sound.error();
      return;
    }
  state.scene = 'travel';
  document.getElementById('travel').style.display = 'block';
  renderTravel();
}
function closeTravel() {
  document.getElementById('travel').style.display = 'none';
  state.scene = 'play';
}
function openLegion() {
  if (state.scene !== 'play') return;
  if (!state.legion) genLegion();
  state.scene = 'legion';
  document.getElementById('legion').style.display = 'block';
  renderLegion();
}
function closeLegion() {
  document.getElementById('legion').style.display = 'none';
  state.scene = 'play';
}
function renderLegion() {
  const el = document.getElementById('legion-list');
  if (!el) return;
  el.innerHTML = '';
  const L = state.legion;
  if (!L) {
    el.innerHTML = '<div style="color:#8088a0">The Legion has not yet stirred.</div>';
    return;
  }
  const order = [
    L.overlord,
    ...L.warlords.slice().sort((a, b) => b.rank - a.rank || b.level - a.level),
  ].filter(Boolean);
  for (const w of order) {
    const dead = !w.alive;
    const thrall = w.dominated && w.alive;
    const rankCol = thrall ? '#70c0ff' : w.rank >= 3 ? '#ff3030' : w.rank >= 2 ? '#e04040' : '#cf6a6a';
    const str = w.scouted >= 1 ? WL_STRENGTHS[w.strength] : '??? — wound it to learn';
    const wk = w.scouted >= 2 ? WL_WEAKNESS[w.weakness] : '??? — expose by bringing it low';
    const tag = thrall
      ? ` · <span style="color:#70c0ff">in your service</span>`
      : w.grudge > 0
        ? ` · <span style="color:#ff8080">grudge ×${w.grudge}</span>`
        : '';
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.style.display = 'block';
    if (dead) row.style.opacity = '0.4';
    row.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="color:${rankCol}">${dead ? '† ' : thrall ? '★ ' : ''}${w.name}</b><span style="color:${rankCol};font-size:11px">${RANK_NAMES[w.rank]} · Lv ${w.level}</span></div><div class="sk-desc" style="font-size:11px">${REGION_NAMES[w.region]}${tag}<br>💪 <span style="color:#cfd6e6">${str}</span><br>🎯 <span style="color:#cfd6e6">${wk}</span></div>`;
    if (thrall) {
      const loy = Math.round(w.loyalty || 0);
      const ctrl = document.createElement('div');
      ctrl.style.marginTop = '5px';
      const status =
        (w.raidT || 0) > 0 ? ` · on raid (${Math.ceil(w.raidT / 60)}s)` : w.posted ? ' · bodyguard' : '';
      ctrl.innerHTML = `<span style="font-size:11px;color:${loy < 25 ? '#ff7070' : '#90c0ff'}">Loyalty ${loy}${status}</span> `;
      const mk = (label, fn, dis) => {
        const b = document.createElement('button');
        b.className = 'sk-btn';
        b.style.cssText = 'font-size:10px;padding:2px 6px;margin-left:4px';
        b.textContent = label;
        if (dis) b.disabled = true;
        else b.onclick = fn;
        return b;
      };
      ctrl.appendChild(
        mk(
          `Promote ${promoteCost(w)}g`,
          () => promoteThrall(w),
          state.player.gold < promoteCost(w) || (w.raidT || 0) > 0,
        ),
      );
      ctrl.appendChild(mk(w.posted ? 'Recall' : 'Guard', () => togglePost(w), (w.raidT || 0) > 0));
      ctrl.appendChild(
        mk((w.raidT || 0) > 0 ? 'Raiding…' : 'Raid', () => sendRaid(w), w.posted || (w.raidT || 0) > 0),
      );
      row.appendChild(ctrl);
    }
    el.appendChild(row);
  }
}
function openCook() {
  if (state.scene !== 'play') return;
  state.scene = 'cook';
  document.getElementById('cook').style.display = 'block';
  renderCook();
}
function closeCook() {
  document.getElementById('cook').style.display = 'none';
  state.scene = 'play';
}
function renderCook() {
  const ig = document.getElementById('cook-ingredients');
  if (ig) {
    const inv = state.player.ingredients || {};
    ig.innerHTML =
      'Pantry: ' +
      Object.keys(INGR)
        .map(
          (k) => `<span style="color:${INGR[k].color}">${INGR[k].icon} ${INGR[k].name} ${inv[k] || 0}</span>`,
        )
        .join('  ·  ');
  }
  const el = document.getElementById('cook-list');
  if (!el) return;
  el.innerHTML = '';
  for (const key in FOODS) {
    const f = FOODS[key];
    const ok = canCook(f);
    const needStr = Object.keys(f.need)
      .map((k) => `${INGR[k].icon}${f.need[k]}`)
      .join(' ');
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.innerHTML = `<div><b style="color:#ffcf80">${f.name}</b> <span class="sk-desc">${needStr}</span><br><span class="sk-val" style="color:#cfd6e6">${FOOD_LABEL[f.buff]} — ${f.desc} (${Math.round(f.dur / 60)}s)</span></div>`;
    const b = document.createElement('button');
    b.className = 'sk-btn';
    if (ok) {
      b.textContent = 'Cook';
      b.onclick = () => cook(key);
    } else {
      b.textContent = 'Need more';
      b.disabled = true;
    }
    row.appendChild(b);
    el.appendChild(row);
  }
}
function openHunts() {
  if (state.scene !== 'play') return;
  state.scene = 'hunts';
  document.getElementById('hunts').style.display = 'block';
  renderHunts();
}
function closeHunts() {
  document.getElementById('hunts').style.display = 'none';
  state.scene = 'play';
}
function openTrophy() {
  if (state.scene !== 'play' && state.scene !== 'hunts') return;
  const h = document.getElementById('hunts');
  if (h) h.style.display = 'none';
  state.scene = 'trophy';
  document.getElementById('trophy').style.display = 'block';
  renderTrophy();
} // reachable from the hub tab (scene 'play') OR the Hunt Master's panel button (scene 'hunts') — fold-in access, no new NPC
function closeTrophy() {
  document.getElementById('trophy').style.display = 'none';
  state.scene = 'play';
}
function renderTrophy() {
  const el = document.getElementById('trophy-list');
  if (!el) return;
  el.innerHTML = '';
  const found = state.uniquesFound || [];
  const slain = state.pinnacleSlain || [];
  for (const pb of PINNACLE_BOSSES) {
    const dr = pb.drops || {};
    const down = slain.includes(pb.key);
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.style.display = 'block';
    let uHtml = '';
    for (const uu of [
      [dr.styleUniq, 'Style'],
      [dr.universalUniq, 'Universal'],
    ]) {
      const uk = uu[0];
      if (!uk) continue;
      const U = UNIQUES[uk] || {};
      const got = found.includes(uk);
      uHtml += `<div style="margin-top:5px;padding-left:6px;opacity:${got ? 1 : 0.5}"><span style="color:${got ? '#74e0ff' : '#9aa0b4'}">${got ? '✓' : '🔒'} ${U.name || uk}</span> <span style="font-size:10px;color:#7a7f92">[${uu[1]}]</span><br><span class="sk-desc" style="font-size:11px">${U.uniqDesc || ''}</span></div>`;
    }
    row.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="color:${pb.color}">${down ? '† ' : '⊹ '}${pb.name}</b><span style="font-size:11px;color:${down ? '#80c080' : '#ff9090'}">${down ? 'SLAIN' : 'Stalking'}</span></div><div class="sk-desc" style="font-size:11px">${pb.where}</div>${uHtml}`;
    el.appendChild(row);
  }
} // Trophy Wall: each pinnacle boss + region hint + BOTH uniques (name+effect), greyed until the uniq key is in state.uniquesFound
function renderHunts() {
  const el = document.getElementById('hunts-list');
  if (!el) return;
  el.innerHTML = '';
  const slain = state.huntsSlain || [];
  for (const h of GREAT_HUNTS) {
    const dead = slain.includes(h.key);
    const rw = h.reward.weapon || h.reward.armor;
    const E = ELEMENTS[h.element];
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.style.display = 'block';
    if (dead) row.style.opacity = '0.5';
    row.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="color:${h.color}">${dead ? '† ' : '⊹ '}${h.name}</b><span style="font-size:11px;color:${dead ? '#80c080' : '#ff9090'}">${dead ? 'SLAIN' : 'Stalking'}</span></div><div class="sk-desc" style="font-size:11px">${E ? E.tag + ' ' + E.name + ' · ' : ''}${h.where}<br>Trophy: <span style="color:#74e0ff">${rw.name}</span></div>`;
    el.appendChild(row);
  }
}
function openFactions() {
  if (state.scene !== 'play') return;
  state.scene = 'factions';
  document.getElementById('factions').style.display = 'block';
  renderFactions();
}
function closeFactions() {
  document.getElementById('factions').style.display = 'none';
  state.scene = 'play';
}
function renderFactions() {
  const el = document.getElementById('factions-list');
  if (!el) return;
  el.innerHTML = '';
  const perks = {
    vigil: (t) =>
      t >= 3
        ? '20% off gear & repairs · healing in towns'
        : t >= 2
          ? '10% off gear & repairs · healing in towns'
          : t >= 1
            ? 'Reach Friendly for discounts & town healing'
            : 'Hostile — the realm offers you no favors',
    wilds: (t) =>
      t >= 3
        ? 'Beasts often ignore you · the wilds are quiet'
        : t >= 2
          ? 'Beasts are calmer — less eager to attack'
          : t >= 1
            ? 'Reach Friendly to calm the beasts'
            : 'The beasts are enraged — they hunt you harder',
    dread: (t) =>
      t >= 3
        ? 'Dreaded — warlords drop far richer spoils, but hunt without mercy'
        : t >= 2
          ? 'Hunted — warlord spoils are richer'
          : t >= 1
            ? 'Marked — the Legion has taken notice of you'
            : 'Unknown to the Legion',
  };
  for (const key of ['vigil', 'wilds', 'dread']) {
    const F = FACTIONS[key];
    const v = (state.factions || {})[key] || 0;
    const frac = key === 'dread' ? v / 100 : (v + 100) / 200;
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.style.display = 'block';
    row.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="color:${F.color}">${F.name}</b><span style="color:${F.color};font-size:12px">${facTierName(key)} · ${F.repName} ${Math.round(v)}</span></div><div style="background:#15151f;border-radius:4px;height:8px;margin:5px 0;overflow:hidden"><div style="background:${F.color};height:100%;width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></div></div><div class="sk-desc" style="font-size:11px">${F.desc} — <span style="color:#cfd6e6">${perks[key](facTierIdx(key))}</span></div>`;
    el.appendChild(row);
  }
}
function renderTravel() {
  const el = document.getElementById('travel-list');
  el.innerHTML = '';
  const here = currentTownIndex();
  const visited = (state.player.visitedTowns || []).slice().sort((a, b) => a - b); // P2/S9: YOUR discoveries
  const ownedH = ownedHoldings();
  if (visited.length <= 1 && !ownedH.length) {
    el.innerHTML =
      '<div style="color:#8088a0;padding:8px">No other towns discovered yet. Explore the realm and step into distant towns to unlock them as destinations.</div>';
    return;
  }
  visited.forEach((i) => {
    const info = townInfo(i);
    const tag = info.biome === 1 ? ' ❄' : info.biome === 2 ? ' 🔥' : '';
    const isHere = i === here;
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.innerHTML = `<div><b style="color:${isHere ? '#90ff90' : '#f0e0a0'}">⌂ ${__g.townZones[i].name}${tag}</b> <span class="sk-desc">Tier ${info.tier + 1}${isHere ? ' · you are here' : ''}</span></div>`;
    const b = document.createElement('button');
    b.className = 'sk-btn';
    if (isHere) {
      b.textContent = 'Here';
      b.disabled = true;
    } else {
      b.textContent = 'Travel';
      b.onclick = () => doTravel(i);
    }
    row.appendChild(b);
    el.appendChild(row);
  });
  if (ownedH.length) {
    const hereH = currentHoldIndex();
    const hdr = document.createElement('div');
    hdr.style.cssText = 'color:#d0b070;font-size:11px;margin:9px 2px 3px;text-align:center';
    hdr.textContent = '⚑ Your Outposts';
    el.appendChild(hdr);
    ownedH.forEach(({ h: hd, i }) => {
      const nm = HOLD_SITES[i].name;
      const isHere = hereH === i;
      const row = document.createElement('div');
      row.className = 'skill-row';
      row.innerHTML = `<div><b style="color:${isHere ? '#90ff90' : '#f0d878'}">🏰 ${nm}</b> <span class="sk-desc">Outpost${hd.besieged ? ' · ⚔ besieged' : isHere ? ' · you are here' : ''}</span></div>`;
      const b = document.createElement('button');
      b.className = 'sk-btn';
      if (isHere) {
        b.textContent = 'Here';
        b.disabled = true;
      } else if (hd.besieged) {
        b.textContent = 'Besieged';
        b.disabled = true;
      } else {
        b.textContent = 'Travel';
        b.onclick = () => doTravelHold(i);
      }
      row.appendChild(b);
      el.appendChild(row);
    });
  }
}
function doTravel(i) {
  const tz = __g.townZones[i];
  if (!tz) return;
  resetFishing();
  const c = townCenter(tz);
  const p = state.player;
  p.x = c.x * TILE;
  p.y = c.y * TILE;
  p.dvx = 0;
  p.dvy = 0;
  p.dodge = 0;
  p.invuln = 30;
  state.camera.x = p.x - __g.VIEW_W / 2;
  state.camera.y = p.y - __g.VIEW_H / 2;
  state.time += Math.floor(DAY_FRAMES * 0.32);
  state.player.lastRestDay = curDay();
  __g._wasExhausted = isExhausted();
  markTownVisited();
  recalcStats();
  spawnBurst(p.x + p.w / 2, p.y + p.h / 2, 18, { color: '#a8c8ff', speed: 2, decay: 0.04 });
  Sound.tone(440, 0.3, 'sine', 0.12, { slideTo: 880 });
  setupCompanions();
  closeTravel();
  log(`You travel the old roads to ${tz.name}. A day's journey passes.`, 'lore');
  updateHUD();
  updateWorldLine();
  saveGame();
}
// ================= DYNAMIC ECONOMY — trade goods, regional prices =================
const TRADE_GOODS = {
  furs: { name: 'Furs', base: 40, icon: '🦊' },
  grain: { name: 'Grain', base: 14, icon: '🌾' },
  spice: { name: 'Spice', base: 60, icon: '🧂' },
  ore: { name: 'Ore', base: 34, icon: '⛏' },
};
const FORAGE_VALUE = { herb: 8, berry: 7, mushroom: 9, fish: 12 };
function townEcon(i) {
  const E = [
    { ex: 'grain', dm: 'spice' },
    { ex: 'furs', dm: 'grain' },
    { ex: 'ore', dm: 'furs' },
    { ex: 'furs', dm: 'spice' },
    { ex: 'spice', dm: 'grain' },
    { ex: 'grain', dm: 'ore' },
  ];
  return E[i] || E[0];
}
function seasonGoodMod(good) {
  const s = seasonIdx();
  if (good === 'furs') return [1, 0.8, 1.05, 1.4][s];
  if (good === 'grain') return [1.05, 1, 0.7, 1.2][s];
  if (good === 'spice') return [1, 1.1, 1, 1.05][s];
  if (good === 'ore') return [1, 1, 1, 1.08][s];
  return 1;
}
function goodBuyPrice(i, good) {
  const g = TRADE_GOODS[good];
  if (!g) return 0;
  const ec = townEcon(i);
  let m = seasonGoodMod(good);
  if (ec.ex === good) m *= 0.6;
  if (ec.dm === good) m *= 1.6;
  m *= 1 - vigilDiscount() * 0.5;
  return Math.max(1, Math.round(g.base * m));
}
function goodSellPrice(i, good) {
  return Math.max(1, Math.round(goodBuyPrice(i, good) * 0.85));
}
function buyGood(good) {
  const i = state.player.activeShopTown; // P2/S9: price against YOUR open shop session
  if (i < 0) return;
  const c = goodBuyPrice(i, good);
  if (state.player.gold < c) {
    Sound.error();
    return;
  }
  state.player.gold -= c;
  state.player.cargo[good] = (state.player.cargo[good] || 0) + 1;
  Sound.click && Sound.click();
  updateHUD();
  renderShop();
  saveGame();
}
function sellGood(good) {
  const i = state.player.activeShopTown; // P2/S9: price against YOUR open shop session
  if ((state.player.cargo[good] || 0) <= 0) return;
  state.player.gold += goodSellPrice(i, good);
  state.player.cargo[good]--;
  Sound.gold && Sound.gold();
  updateHUD();
  renderShop();
  saveGame();
}
function sellIngredient(k) {
  if ((state.player.ingredients[k] || 0) <= 0) return;
  state.player.gold += Math.max(1, Math.round((FORAGE_VALUE[k] || 5) * (1 + vigilDiscount() * 0.5)));
  state.player.ingredients[k]--;
  Sound.gold && Sound.gold();
  updateHUD();
  renderShop();
  saveGame();
}
function shopRow(name, descHtml, priceText, onbuy, disabled, owned, btnClass, btnLabel) {
  const r = document.createElement('div');
  r.className = 'skill-row';
  r.innerHTML = `<div><b>${name}</b> <span class="sk-desc">${descHtml}</span><br><span class="sk-val" style="color:#f0d050">${owned ? '✓ Owned' : priceText}</span></div>`;
  const b = document.createElement('button');
  b.className = 'sk-btn ' + (btnClass || 'buy-btn');
  if (owned) {
    b.textContent = 'Owned';
    b.disabled = true;
  } else if (disabled) {
    b.textContent = 'Need gold';
    b.disabled = true;
  } else {
    b.textContent = btnLabel || 'Buy';
    b.onclick = onbuy;
  }
  r.appendChild(b);
  return r;
}
function renderShop() {
  const p = state.player;
  document.getElementById('shop-gold-amt').textContent = p.gold;
  {
    const st = document.getElementById('shop-title');
    if (st) st.textContent = '🛒 ' + (p.activeShopName || 'SHOP').toUpperCase() + ' 🛒'; // P2/S9: session rides the player
  }
  const svc = document.getElementById('shop-list-svc');
  svc.innerHTML = '';
  svc.appendChild(shopRow('Potion', 'Heal 15 HP', '15 gold', () => buyPotion(), p.gold < 15, false));
  svc.appendChild(
    shopRow(
      'Health Tonic',
      '+5 Max HP (permanent)',
      tonicCost() + ' gold',
      () => buyTonic(),
      p.gold < tonicCost(),
      false,
    ),
  );
  const wEl = document.getElementById('shop-list-weap');
  wEl.innerHTML = '';
  (p.activeStock ? p.activeStock.weapons : []).forEach((it) => {
    const owned = state.player.shopPurchased.includes(it.id);
    wEl.appendChild(
      shopRow(
        `${itemGlyph(it, 'weapon')}<span style="color:${rarityColor(it.rarity)}">${it.name}</span>`,
        `+${it.atk} · <span class="${styleTag(it.style)}">${styleLabel(it.style)}</span>${elemHtml(it.element)}${affixHtml(it)} · req Lv ${it.reqLevel}/${styleLabel(it.style)} ${it.reqProf}`,
        buyPrice(it.cost) + ' gold',
        () => buyWeapon(it),
        p.gold < buyPrice(it.cost),
        owned,
      ),
    );
  });
  const aEl = document.getElementById('shop-list-armor');
  aEl.innerHTML = '';
  (p.activeStock ? p.activeStock.armor : []).forEach((it) => {
    const owned = state.player.shopPurchased.includes(it.id);
    aEl.appendChild(
      shopRow(
        `${itemGlyph(it, 'armor')}<span style="color:${rarityColor(it.rarity)}">${it.name}</span>`,
        `+${it.def} DEF${affixHtml(it)} · req Lv ${it.reqLevel}`,
        buyPrice(it.cost) + ' gold',
        () => buyArmor(it),
        p.gold < buyPrice(it.cost),
        owned,
      ),
    );
  });
  {
    const i = p.activeShopTown; // P2/S9: session rides the player
    const ec = townEcon(i);
    const th = document.getElementById('shop-trade-head');
    if (th)
      th.innerHTML = `TRADE GOODS — exports <span style="color:#90e090">${TRADE_GOODS[ec.ex].name}</span> (cheap) · craves <span style="color:#f0a060">${TRADE_GOODS[ec.dm].name}</span> (dear)`;
    const tEl = document.getElementById('shop-list-trade');
    tEl.innerHTML = '';
    for (const k in TRADE_GOODS) {
      const g = TRADE_GOODS[k];
      const bp = goodBuyPrice(i, k),
        sp = goodSellPrice(i, k);
      const have = state.player.cargo[k] || 0;
      const r = document.createElement('div');
      r.className = 'skill-row';
      r.innerHTML = `<div><b>${g.icon} ${g.name}</b> <span class="sk-desc">in your hold: ${have}</span><br><span class="sk-val" style="color:#f0d050">Buy ${bp}g · Sell ${sp}g</span></div>`;
      const bb = document.createElement('button');
      bb.className = 'sk-btn buy-btn';
      bb.textContent = 'Buy';
      if (p.gold < bp) {
        bb.disabled = true;
      } else bb.onclick = () => buyGood(k);
      const sb = document.createElement('button');
      sb.className = 'sk-btn sell-btn';
      sb.textContent = 'Sell';
      if (have <= 0) {
        sb.disabled = true;
      } else sb.onclick = () => sellGood(k);
      r.appendChild(bb);
      r.appendChild(sb);
      tEl.appendChild(r);
    }
    for (const k of ['fish', 'herb', 'berry', 'mushroom']) {
      const have = state.player.ingredients[k] || 0;
      if (have <= 0) continue;
      const ic = INGR[k];
      const val = Math.max(1, Math.round((FORAGE_VALUE[k] || 5) * (1 + vigilDiscount() * 0.5)));
      const r = document.createElement('div');
      r.className = 'skill-row';
      r.innerHTML = `<div><b style="color:${ic.color}">${ic.icon} ${ic.name}</b> <span class="sk-desc">foraged ×${have}</span><br><span class="sk-val" style="color:#70c0f0">Sell ${val}g each</span></div>`;
      const sb = document.createElement('button');
      sb.className = 'sk-btn sell-btn';
      sb.textContent = 'Sell';
      sb.onclick = () => sellIngredient(k);
      r.appendChild(sb);
      tEl.appendChild(r);
    }
  }
  const sEl = document.getElementById('shop-list-sell');
  sEl.innerHTML = '';
  const sellables = [
    ...state.inventory.weapons.map((it) => ({ it, kind: 'weapon' })),
    ...state.inventory.armor.map((it) => ({ it, kind: 'armor' })),
  ];
  sellables.forEach(({ it, kind }) => {
    const val = sellValue(it);
    const stat = kind === 'weapon' ? `+${it.atk} ${styleLabel(styleOf(it))}` : `+${it.def} DEF`;
    const r = document.createElement('div');
    r.className = 'skill-row';
    r.innerHTML = `<div>${itemGlyph(it, kind)}<b style="color:${rarityColor(it.rarity)}">${it.name}</b> <span class="sk-desc">${stat}${it.equipped ? ' (equipped)' : ''}</span><br><span class="sk-val" style="color:#70c0f0">Sell: ${val} gold</span></div>`;
    const b = document.createElement('button');
    b.className = 'sk-btn sell-btn';
    if (it.equipped) {
      b.textContent = 'Equipped';
      b.disabled = true;
    } else {
      b.textContent = 'Sell';
      b.onclick = () => sellItem(it, kind);
    }
    r.appendChild(b);
    sEl.appendChild(r);
  });
}
