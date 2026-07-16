function applySnapshot(s) {
  const p = state.player;
  Object.assign(p, s.player);
  p.abilities = { ...s.player.abilities };
  if (s.player.prof) p.prof = s.player.prof;
  if (!p.prof)
    p.prof = {
      melee: { lvl: 1, xp: 0, next: 12 },
      ranged: { lvl: 1, xp: 0, next: 12 },
      magic: { lvl: 1, xp: 0, next: 12 },
    };
  if (p.atkHaste === undefined) p.atkHaste = 0;
  p.abilities = {
    whirlwind: false,
    focus: false,
    ultimate: false,
    dominate: false,
    summon: false,
    ...s.player.abilities,
  };
  p.abilityRank = Object.assign(
    { whirlwind: 0, focus: 0, ultimate: 0, summon: 0, dominate: 0 },
    s.player.abilityRank || {},
  );
  for (const _k in p.abilities) {
    if (p.abilities[_k] && !(p.abilityRank[_k] > 0)) p.abilityRank[_k] = 1;
  }
  p.abilityCd = { whirlwind: 0, focus: 0, ultimate: 0, summon: 0, dominate: 0 };
  p.invuln = 0;
  p.attacking = 0;
  p.whirl = 0;
  p.ultT = 0;
  p.attackCooldown = 0;
  p.momentum = 0;
  p.riposteT = 0;
  p.heat = 0;
  p._momoDecay = 0;
  p._heatCool = 0;
  p._auraCd = 0;
  p._auraEl = 0;
  p._lastMarkN = 0;
  p._markShowT = 0;
  p._lastStyle = null;
  /* Pillar 1: old saves default all style resources to 0/off */ p.cloaked = false;
  p._stillT = 0;
  /* Pillar 2 Gravewool: transient cloak state — old saves default off (u* effect flags are re-derived by recalcStats below) */ p.dir =
    'down';
  state.allies = [];
  state.inventory = s.inventory;
  state.inventory.weapons.forEach((w) => normItem(w, true));
  state.inventory.armor.forEach((a) => normItem(a, false));
  state.quests = s.quests;
  if (!state.quests.frozen)
    state.quests.frozen = { name: 'Plunder the Frozen Cache', done: false, hidden: true };
  {
    const _of = s.flags || {};
    state.flags = { krakenDead: !!_of.krakenDead, legionBroken: !!_of.legionBroken };
    /* WORLD facts only (v6) — a v<=5 save's flags object also carried the personal milestones, so read them back off it below: that migration is LOSSLESS (the old save literally holds each value) and it is why a pre-v6 save does not re-lock the dungeon door or re-point the wayfinder. */ p.enteredDungeon =
      s.player.enteredDungeon !== undefined ? !!s.player.enteredDungeon : !!_of.enteredDungeon;
    p.gotKey = s.player.gotKey !== undefined ? !!s.player.gotKey : !!_of.gotKey;
    p.enteredFrozen = s.player.enteredFrozen !== undefined ? !!s.player.enteredFrozen : !!_of.enteredFrozen;
  }
  state.dungeonLevel = s.dungeonLevel;
  state.maxDepth = s.maxDepth;
  state.map = s.map;
  /* P2/S5: tonics/sharpenLevel live on the PLAYER now. New saves carry them in s.player (the
     Object.assign above already landed them); a pre-move save holds them at the root — read them
     back off it, LOSSLESSLY, exactly like the v5→v6 flags migration above. Explicit (not relying
     on Object.assign) so a stale session value can never survive loading an old save. */
  p.tonics = (s.player.tonics !== undefined ? s.player.tonics : s.tonics) || 0;
  p.sharpenLevel = (s.player.sharpenLevel !== undefined ? s.player.sharpenLevel : s.sharpenLevel) || 0;
  /* P2/S7 player-carried (same doctrine): new saves hold it in s.player, pre-move saves at the
     root — read back LOSSLESSLY, explicit so a stale session value can never survive a load. */
  p.shopPurchased = s.player.shopPurchased !== undefined ? s.player.shopPurchased : s.shopPurchased || [];
  state.visitedTowns = s.visitedTowns || [];
  state.bounty = s.bounty || null;
  state.factions = s.factions || { vigil: 0, wilds: 0, dread: 0 };
  state.legion = s.legion || null;
  if (!state.legion || !state.legion.warlords || !state.legion.warlords.length) genLegion();
  /* P2/S6 player-carried (same doctrine as tonics/sharpenLevel above): a new save holds it in
     s.player, a pre-move save at the root — read back LOSSLESSLY, explicit so a stale session
     value can never survive loading an old save. */
  p.hasBoat = s.player.hasBoat !== undefined ? !!s.player.hasBoat : !!s.hasBoat;
  state.sailing = false;
  state.huntsSlain = s.huntsSlain || [];
  state.huntCycle = s.huntCycle || 0;
  state.huntRespawnDay = s.huntRespawnDay || null;
  state.pinnacleSlain = s.pinnacleSlain || [];
  state.pinnacleCycle = s.pinnacleCycle || 0;
  state.pinnacleRespawnDay = s.pinnacleRespawnDay || null;
  state._pinCheckT = 0;
  state.uniquesFound = s.uniquesFound || [];
  /* old saves lack these → default []/0/null (Pinnacle bosses + chase-unique tracking for the Trophy Wall) */ state.legionCycle =
    s.legionCycle || 0;
  state.legionRespawnDay = s.legionRespawnDay || null;
  state.loreFound = s.loreFound || [];
  state.holdings =
    s.holdings && s.holdings.length === HOLD_SITES.length
      ? s.holdings.map((h) => ({
          liberated: !!h.liberated,
          built: !!h.built,
          level: h.level || 1,
          besieged: false,
        }))
      : null;
  if (!state.holdings) initHoldings();
  state.companions = (s.companions || []).map((c) => ({
    name: c.name,
    cls: c.cls,
    level: c.level || 1,
    maxHp: c.maxHp,
    hp: c.hp,
    atk: c.atk,
    def: c.def,
    alive: c.alive !== false,
    weapon: c.weapon ? normItem(c.weapon, true) : null,
    postedAt:
      typeof c.postedAt === 'number' && c.postedAt >= 0 && c.postedAt < HOLD_SITES.length ? c.postedAt : null,
    x: 0,
    y: 0,
    w: 22,
    h: 22,
    attackCd: 0,
    hurtCd: 0,
    wobble: Math.random() * 6.28,
    color: (COMP_CLASSES[c.cls] || {}).color || '#cccccc',
  }));
  state.ingredients = s.ingredients || { herb: 0, berry: 0, mushroom: 0, fish: 0 };
  /* P2/S7 player-carried trade hold (root fallback for pre-move saves) */
  p.cargo = s.player.cargo !== undefined ? s.player.cargo : s.cargo || { furs: 0, grain: 0, spice: 0, ore: 0 };
  state.activeShopTown = -1;
  p.fishCd = 0; /* never persisted — a load always starts you off cooldown, exactly as before P2/S7 */
  if (!p.foodBuff) p.foodBuff = null;
  if (!p.foodT) p.foodT = 0;
  p.wayfind = s.player.wayfind !== undefined ? s.player.wayfind !== false : s.wayfind !== false;
  /* P2/S6 player-carried [O] pref — default ON when absent everywhere, like the old root read */
  p.seenHeatTip = s.player.seenHeatTip !== undefined ? !!s.player.seenHeatTip : !!s.seenHeatTip;
  /* P2/S5 player-carried; pre-move saves hold it at the root (lossless fallback), truly old saves lack it everywhere → default false, so the tip still shows once */ state.time = s.time || 0;
  p.lastRestDay = (s.player.lastRestDay !== undefined ? s.player.lastRestDay : s.lastRestDay) || 1;
  /* P2/S7 player-carried rest day (root fallback; `|| 1` keeps the old 0→1 default) */
  state.weather = s.weather || 'clear';
  state.nemesis = s.nemesis || { alive: false, level: 0, name: '', title: '', kills: 0 };
  state.ascension = s.ascension || 0;
  state.won = !!s.won;
  state.dragon = s.dragon || { tamed: false, mounted: false };
  state.dragon.mounted = false;
  state.dragonRespawnDay = s.dragonRespawnDay || null;
  if (!state.quests.dragon)
    state.quests.dragon = { name: 'Tame the Emberwyrm (Lv 20)', done: false, hidden: true };
  if (!state.quests.legion)
    state.quests.legion = {
      started: false,
      stage: 'none',
      camps: 0,
      sealstones: 0,
      villages: 0,
      seatRegion: -1,
    };
  state.fires = [];
  state.events = [];
  recalcStats();
}
async function saveGame(silent = true) {
  if (state.scene !== 'play' || state.player.hp <= 0) return;
  try {
    const ok = await SaveStore.set(SAVE_KEY, JSON.stringify(snapshot()));
    if (ok && !silent) showSavedToast();
  } catch (e) {}
}
async function loadGame() {
  try {
    const v = await SaveStore.get(SAVE_KEY);
    if (!v) return false;
    applySnapshot(JSON.parse(v));
    return true;
  } catch (e) {
    return false;
  }
}
function showSavedToast() {
  const el = document.getElementById('saved-toast');
  el.style.opacity = '1';
  setTimeout(() => (el.style.opacity = '0'), 900);
}
function ensureAutosave() {
  if (__g.autosaveStarted) return;
  __g.autosaveStarted = true;
  setInterval(() => {
    if (state.scene === 'play') saveGame(false);
  }, 60000);
}

function log(msg, cls = '') {
  const logEl = document.getElementById('log');
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = msg;
  logEl.appendChild(div);
  while (logEl.children.length > 6) logEl.removeChild(logEl.firstChild);
}

// ================= INPUT =================
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  keys[k] = true;
  Sound.resume();
  if (k === 'm') {
    Sound.toggleMute();
    return;
  }
  if (k === 'h') {
    const c = document.getElementById('controls');
    if (c) c.style.display = c.style.display === 'block' ? 'none' : 'block';
    return;
  }
  if (k === 'tab') {
    e.preventDefault();
    if (hubIdxOfScene() >= 0) closeHubPanels();
    else if (state.scene === 'play') openHub(state.hubTab || 0);
    return;
  }
  if (hubIdxOfScene() >= 0 && (k === 'arrowleft' || k === 'arrowright')) {
    switchHubTab(k === 'arrowright' ? 1 : -1);
    return;
  }
  if (state.scene === 'title') return;
  if (k === 'i') toggleInventory();
  if (k === 'k') toggleSkills();
  if (k === 'escape') {
    if (state.scene === 'inventory') toggleInventory();
    else if (state.scene === 'skills') toggleSkills();
    else if (state.scene === 'shop') closeShop();
    else if (state.scene === 'smith') closeSmith();
    else if (state.scene === 'travel') closeTravel();
    else if (state.scene === 'factions') closeFactions();
    else if (state.scene === 'legion') closeLegion();
    else if (state.scene === 'hunts') closeHunts();
    else if (state.scene === 'trophy') closeTrophy();
    else if (state.scene === 'cook') closeCook();
    else if (state.scene === 'companions') closeCompanions();
    else if (state.scene === 'map') closeFullMap();
  }
  if ((k === 'e' || k === ' ') && state.scene === 'dialogue') {
    advanceDialogue();
    return;
  }
  if (k === 'e' && state.scene === 'shop') {
    closeShop();
    return;
  }
  if (k === 'e' && state.scene === 'smith') {
    closeSmith();
    return;
  }
  if (k === 'e' && state.scene === 'play') tryInteract();
  if ((k === ' ' || k === 'j') && state.scene === 'play') tryAttack();
  if (k === 'q' && state.scene === 'play') useWhirlwind();
  if (k === 'r' && state.scene === 'play') useFocus();
  if (k === 'f' && state.scene === 'play') castSpell();
  if (k === '1' && state.scene === 'play') drinkPotion();
  if (k === 'c' && state.scene === 'play') doCamp();
  if (k === 'g' && state.scene === 'play') toggleMount();
  if (k === 'b' && state.scene === 'play') toggleBoat();
  if ((k === 'shift' || k === 'l') && state.scene === 'play') doDodge();
  if (k === 'z' && state.scene === 'play') useUltimate();
  if (k === 'x' && state.scene === 'play') useSummon();
  if (k === 't') {
    if (state.scene === 'play') openTravel();
    else if (state.scene === 'travel') closeTravel();
  }
  if (k === 'o' && state.scene === 'play') {
    state.player.wayfind = state.player.wayfind === false;
    log('Objective guide ' + (state.player.wayfind ? 'ON — follow the arrow' : 'OFF — wander free') + '.', 'lore');
    Sound.blip && Sound.blip();
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});
document.getElementById('start-btn').addEventListener('click', () => {
  startGame();
});
document.getElementById('continue-btn').addEventListener('click', async () => {
  const ok = await loadGame();
  if (ok) startLoaded();
  else startGame();
});
function startGame() {
  document.getElementById('overlay').style.display = 'none';
  state.scene = 'play';
  Sound.init();
  Sound.resume();
  Sound.startMusic('overworld');
  state.ascension = legacy.ascension || 0;
  state.visitedTowns = [];
  state.factions = { vigil: 0, wilds: 0, dread: 0 };
  state.bounty = null;
  state.huntsSlain = [];
  state.huntCycle = 0;
  state.huntRespawnDay = null;
  state.pinnacleSlain = [];
  state.pinnacleCycle = 0;
  state.pinnacleRespawnDay = null;
  state._pinCheckT = 0;
  state.uniquesFound = [];
  state.legionCycle = 0;
  state.legionRespawnDay = null;
  state.loreFound = [];
  state.player.hasBoat = false; // P2/S6: player-carried (fresh start = no boat, guide pref keeps its literal default)
  state.sailing = false;
  state.allies = [];
  state.ingredients = { herb: 0, berry: 0, mushroom: 0, fish: 0 };
  state.player.cargo = { furs: 0, grain: 0, spice: 0, ore: 0 }; // P2/S7: player-carried (fresh start = empty hold, no cooldown)
  state.player.fishCd = 0;
  state.player.foodBuff = null;
  state.player.foodT = 0;
  state.companions = [];
  initHoldings();
  setupOverworld();
  markTownVisited();
  genLegion();
  if (state.ascension > 0) {
    state.player.skillPoints += state.ascension * 2;
    state.player.maxHp += state.ascension * 10;
    state.player.hp = state.player.maxHp;
  }
  recalcStats();
  ensureAutosave();
  log('You arrive in Eldermyr, central town of the realm.', 'lore');
  if (state.ascension > 0)
    log(
      `Ascension ${state.ascension} — the dark grows fiercer, but you begin hardened (+${state.ascension * 2} skill points, +${state.ascension * 10} HP).`,
      'quest',
    );
  log('Speak to the Elder (E). Equip a weapon [I] to set your style. Spend skills [K] in town.', 'quest');
  updateHUD();
  updateQuests();
}
function startLoaded() {
  document.getElementById('overlay').style.display = 'none';
  state.scene = 'play';
  Sound.init();
  Sound.resume();
  if (state.map === 'dungeon' && state.dungeonLevel > 0) {
    setupOverworld();
    saveOverworld();
    setupDungeonFloor(state.dungeonLevel);
    Sound.startMusic('dungeon');
  } else {
    setupOverworld();
    Sound.startMusic('overworld');
  }
  ensureAutosave();
  updateHUD();
  updateQuests();
  log('Welcome back, hero. Your journey continues.', 'lore');
}

// ================= INVENTORY =================
function toggleInventory() {
  const inv = document.getElementById('inventory');
  if (state.scene === 'inventory') {
    inv.style.display = 'none';
    state.scene = 'play';
  } else if (state.scene === 'play') {
    inv.style.display = 'block';
    state.scene = 'inventory';
    renderInventory();
  }
}
function durTextHtml(it) {
  if (it.durMax === undefined) return '';
  const frac = (it.dur || 0) / it.durMax;
  let col = isBroken(it) ? '#ff5050' : frac < 0.3 ? '#f0a040' : '#80b080';
  const lbl = isBroken(it) ? 'BROKEN' : `${it.dur}/${it.durMax}`;
  return ` <span style="color:${col}">⛨${lbl}</span>`;
}
// Inventory legibility: sort each section (equipped first, then strongest→weakest) and mark each item vs equipped.
function gearPrimary(it) {
  return (it.atk !== undefined ? it.atk : it.def !== undefined ? it.def : 0) || 0;
}
function invSorted(arr) {
  return arr
    .map((o, idx) => ({ o, idx }))
    .sort(
      (A, B) =>
        (B.o.equipped ? 1 : 0) - (A.o.equipped ? 1 : 0) ||
        gearPrimary(B.o) - gearPrimary(A.o) ||
        (B.o.rarity || 0) - (A.o.rarity || 0),
    );
}
function cmpMark(it, eq) {
  if (!eq || it.equipped) return '';
  const a = gearPrimary(it),
    b = gearPrimary(eq);
  if (a > b) return '<span style="color:#90ff90" title="upgrade vs equipped">▲</span> ';
  if (a < b) return '<span style="color:#e07070" title="worse than equipped">▼</span> ';
  return '<span style="color:#8a8a9a" title="same as equipped">=</span> ';
}
// Junk = unequipped, low-rarity (≤ Uncommon), plain (no element/affix), and no better than what you've equipped. Never touches anything valuable.
function isJunk(it, kind) {
  if (it.equipped) return false;
  if ((it.rarity || 0) > 1) return false;
  if (it.element || (it.affixes && it.affixes.length)) return false;
  const eq = kind === 'weapon' ? equippedWeapon() : equippedArmor();
  if (!eq) return false;
  return gearPrimary(it) <= gearPrimary(eq);
}
function sellAllJunk() {
  if (state.scene !== 'shop') {
    Sound.error && Sound.error();
    log('You need a merchant to sell your junk — visit any shop or your outpost Quartermaster.', 'combat');
    return;
  }
  let n = 0,
    g = 0;
  [
    ['weapons', 'weapon'],
    ['armor', 'armor'],
  ].forEach(([key, kind]) => {
    const arr = state.inventory[key];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr.length <= 1) break;
      if (isJunk(arr[i], kind)) {
        g += sellValue(arr[i]);
        arr.splice(i, 1);
        n++;
      }
    }
  });
  if (n === 0) {
    Sound.error && Sound.error();
    log('Nothing to clear — your packs hold only keepers and upgrades.', 'lore');
    return;
  }
  state.player.gold += g;
  Sound.gold && Sound.gold();
  log(`🧹 Cleared ${n} junk item${n > 1 ? 's' : ''} for ${g} gold.`, 'good');
  afterBuy();
}
function renderInventory() {
  const wEl = document.getElementById('inv-weapons'),
    aEl = document.getElementById('inv-armor'),
    iEl = document.getElementById('inv-items');
  wEl.innerHTML = '';
  aEl.innerHTML = '';
  iEl.innerHTML = '';
  const ew = equippedWeapon(),
    ea = equippedArmor();
  invSorted(state.inventory.weapons).forEach(({ o: w, idx }) => {
    const s = styleOf(w);
    const col = rarityColor(w.rarity);
    const eq = canEquip(w);
    const reqTxt = w.reqProf > 1 ? `Req ${styleLabel(s)} proficiency ${w.reqProf}` : 'No requirement';
    const d = document.createElement('div');
    d.className = 'inv-item' + (w.equipped ? ' equipped' : '') + (eq.ok ? '' : ' locked');
    d.innerHTML = `${cmpMark(w, ew)}${itemGlyph(w, 'weapon')}<span style="color:${col}">${rarityName(w.rarity)} ${w.name}</span> (+${w.atk}) <span class="${styleTag(s)}">[${styleLabel(s)}]</span>${elemHtml(w.element)}${w.bonus ? ` <span style="color:#90ff90">${w.bonus.label}</span>` : ''}${affixHtml(w)}<br><span style="font-size:10px;color:${eq.ok ? '#8088a0' : '#e06060'}">${reqTxt}</span>${durTextHtml(w)}${uniqHtml(w)}`;
    d.onclick = () => equipWeapon(idx);
    wEl.appendChild(d);
  });
  invSorted(state.inventory.armor).forEach(({ o: a, idx }) => {
    const col = rarityColor(a.rarity);
    const eq = canEquip(a);
    const reqTxt = a.reqLevel > 1 ? `Req Lv ${a.reqLevel}` : 'No requirement';
    const d = document.createElement('div');
    d.className = 'inv-item' + (a.equipped ? ' equipped' : '') + (eq.ok ? '' : ' locked');
    d.innerHTML = `${cmpMark(a, ea)}${itemGlyph(a, 'armor')}<span style="color:${col}">${rarityName(a.rarity)} ${a.name}</span> (+${a.def} DEF)${a.bonus ? ` <span style="color:#90ff90">${a.bonus.label}</span>` : ''}${affixHtml(a)}<br><span style="font-size:10px;color:${eq.ok ? '#8088a0' : '#e06060'}">${reqTxt}</span>${durTextHtml(a)}${uniqHtml(a)}`;
    d.onclick = () => equipArmor(idx);
    aEl.appendChild(d);
  });
  const pot = state.inventory.items.find((i) => i.name === 'Potion');
  if (pot && pot.qty > 0) {
    const d = document.createElement('div');
    d.className = 'inv-item';
    d.textContent = `Potion x${pot.qty} (heal 15)`;
    d.onclick = () => {
      drinkPotion();
      renderInventory();
    };
    iEl.appendChild(d);
  }
  if (state.inventory.keys > 0) {
    const d = document.createElement('div');
    d.className = 'inv-item';
    d.textContent = `Dungeon Key x${state.inventory.keys}`;
    iEl.appendChild(d);
  }
  if (iEl.children.length === 0) iEl.innerHTML = '<span class="inv-empty">No items</span>';
}
function equipWeapon(idx) {
  const w = state.inventory.weapons[idx];
  const eq = canEquip(w);
  if (!eq.ok) {
    Sound.error();
    log(`Cannot equip ${w.name}: ${eq.reason}.`, 'combat');
    return;
  }
  state.inventory.weapons.forEach((x, i) => (x.equipped = i === idx));
  recalcStats();
  renderInventory();
  updateHUD();
  Sound.click();
  log(`Equipped ${w.name} — now fighting as ${styleLabel(styleOf(w))}.`, 'good');
}
function equipArmor(idx) {
  const a = state.inventory.armor[idx];
  const eq = canEquip(a);
  if (!eq.ok) {
    Sound.error();
    log(`Cannot equip ${a.name}: ${eq.reason}.`, 'combat');
    return;
  }
  state.inventory.armor.forEach((x, i) => (x.equipped = i === idx));
  recalcStats();
  renderInventory();
  updateHUD();
  Sound.click();
  log(`Equipped ${a.name}.`, 'good');
}
function recalcStats() {
  const p = state.player;
  const w = equippedWeapon(),
    a = equippedArmor();
  let atk = 4 + (p.level - 1) * 2 + p.bonusAtk;
  let def = 1 + Math.floor(p.level - 1) + p.bonusDef;
  let crit = p.bonusCrit || 0,
    life = p.bonusLifesteal || 0,
    bsk = p.bonusBerserk || 0,
    eva = p.bonusEvasion || 0;
  const addAffix = (it) => {
    if (it && it.affixes && !isBroken(it))
      for (const af of it.affixes) {
        if (af.t === 'crit') crit += af.v;
        else if (af.t === 'lifesteal') life += af.v;
        else if (af.t === 'berserk') bsk += af.v;
        else if (af.t === 'evasion') eva += af.v;
        else if (af.t === 'atk') atk += af.v;
        else if (af.t === 'def') def += af.v;
      }
  };
  if (w) {
    const st = styleOf(w);
    atk += Math.round((w.atk || 0) * brokenMult(w) * profMult(st) * 0.7);
    if (w.bonus) {
      if (w.bonus.stat === 'atk') atk += w.bonus.amount;
      else def += w.bonus.amount;
    }
  }
  if (a) {
    def += Math.round((a.def || 0) * brokenMult(a));
    if (a.bonus) {
      if (a.bonus.stat === 'atk') atk += a.bonus.amount;
      else def += a.bonus.amount;
    }
  }
  addAffix(w);
  addAffix(a);
  if (typeof isExhausted === 'function' && isExhausted()) atk = Math.max(1, Math.round(atk * 0.78));
  if (state.dragon && state.dragon.mounted) atk = Math.round(atk * 1.6);
  p.atk = atk;
  p.def = def;
  p.crit = Math.min(0.6, crit * 0.05);
  p.lifesteal = Math.min(0.3, life * 0.01);
  p.berserk = Math.min(1.5, bsk * 0.25);
  /* LIFESTEAL = 1% per point (was 2.5%, which pinned any invested build at the 30% cap and made sustain trivial). DERIVED here from the point count, so every existing character self-corrects on the next recalc — snapshot() saves bonusLifesteal (the points), never the %. The 0.3 cap is now only a backstop: the richest legal build (15 skill pts + two v:3 affixes) reaches 21%. */ p.evasion =
    Math.min(0.4, eva * 0.03);
  p.exec = Math.min(0.45, (p.bonusExec || 0) * 0.12);
  p.fort = Math.min(0.3, (p.bonusFort || 0) * 0.05);
  if (p.blessT > 0 && p.blessType === 'might') p.atk = Math.round(p.atk * 1.4);
  p.blessDR = p.blessT > 0 && p.blessType === 'ward' ? 0.4 : 0;
  if (p.foodT > 0 && p.foodBuff === 'wellfed') {
    p.atk = Math.round(p.atk * 1.12);
    p.def += 3;
  }
  /* PINNACLE UNIQUES (Pillar 2): derive per-player build-flags from the equipped weapon/armor's .uniq tag HERE — never at combat time. These ride `me` to clients like p.crit/p.lifesteal (safeClone copies top-level scalars), so no client adoption line is needed; a broken relic loses its magic (matches affix gating). */
  p.uLance = !!(w && w.uniq === 'leviathanspine' && !isBroken(w));
  p.uFrostNova = !!(a && a.uniq === 'tidecalleraegis' && !isBroken(a));
  p.uBell = !!(w && w.uniq === 'shepherdsbell' && !isBroken(w));
  p.uCloak = !!(a && a.uniq === 'gravewoolcloak' && !isBroken(a));
}
