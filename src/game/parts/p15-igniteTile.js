function igniteTile(tx, ty) {
  if (state.map !== 'overworld') return;
  const t = getTile('overworld', tx, ty);
  if (t !== T.GRASS && t !== T.FLOWER && t !== T.PATH) return;
  if (isFrozenTile(tx, ty)) return;
  if (state.fires.length >= 130) return;
  for (const f of state.fires) if (f.tx === tx && f.ty === ty) return;
  state.fires.push({
    tx,
    ty,
    life: 180 + Math.floor(Math.random() * 120),
    spread: 55 + Math.floor(Math.random() * 40),
  });
}
// Combat-clarity HUD (bottom-center): active buffs/debuffs with countdown timers + an ability-cooldown bar.
// This is the single home for player status — the world-line keeps only day/time/season/weather/siege.
function chCanUse(a) {
  const p = state.player;
  if (a.cd > 0) return false;
  if (a.en && p.energy < a.en) return false;
  if (a.st && p.stamina < a.st) return false;
  return true;
}
const STATUS_DESC = {
  Exhausted:
    'Worn out from too long without rest \u2014 \u221222% attack and half move speed. Sleep in a town or make camp [C] to recover.',
  Chilled: 'Struck by frost \u2014 your movement is slowed for a few seconds.',
  Flying: 'Riding your dragon \u2014 faster, tougher, and able to soar over mountains and water.',
};
function chStatusPill(s) {
  const d = (s.desc || STATUS_DESC[s.label] || s.label).replace(/"/g, '&quot;');
  return `<span class="ch-st" title="${d}" style="color:${s.color};border-color:${s.color}55;cursor:help">${s.ic} ${s.label}${s.t > 0 ? ' ' + Math.ceil(s.t / 60) + 's' : ''}</span>`;
}
function chAbPill(a) {
  const cooling = a.cd > 0;
  const ready = chCanUse(a);
  const txt = cooling ? Math.ceil(a.cd / 60) + 's' : '●';
  const col = cooling ? '#6a7088' : ready ? '#86f08a' : '#caa44a';
  return `<span class="ch-ab" title="${a.nm}" style="color:${col}"><b style="color:#dfe2ee">${a.k}</b> ${txt}</span>`;
}
// Pillar 1 HUD: one compact style-resource pill (momentum pips / mark pips / heat bar), matching the ch-st styling. Returns {html,sig}; empty when the resource is fully idle so the HUD still hides at rest.
function chStyleRow(p) {
  const st = styleOf(equippedWeapon());
  let html = '',
    sig = '';
  if (st === 'melee') {
    const m = p.momentum || 0,
      rip = p.riposteT > 0;
    if (m > 0 || rip) {
      let pips = '';
      for (let i = 0; i < 5; i++)
        pips += '<span style="color:' + (i < m ? '#ff9060' : '#4a3a34') + '">◆</span>';
      html =
        '<span class="ch-st" title="Momentum — land hits to build; each pip +3% dmg; full = dash-strike; perfect-dodge = riposte" style="border-color:#ff906055;color:#ffb488">⚔ ' +
        pips +
        (rip ? ' <b style="color:#ffd24a">RIPOSTE</b>' : '') +
        '</span>';
      sig = 'm' + m + (rip ? 'R' : '');
    }
  } else if (st === 'ranged') {
    const n = p._lastMarkN || 0;
    if (n > 0) {
      let pips = '';
      for (let i = 0; i < 3; i++)
        pips += '<span style="color:' + (i < n ? '#ff4d4d' : '#402c2c') + '">◈</span>';
      html =
        '<span class="ch-st" title="Quarry Marks — consecutive hits stack (max 3), marked foes take bonus dmg from you; a marked kill chains a Mark onward" style="border-color:#ff4d4d55;color:#ff9a9a">🎯 ' +
        pips +
        '</span>';
      sig = 'k' + n;
    }
  } else if (st === 'magic') {
    const _w = equippedWeapon(),
      el = _w && _w.element;
    const h = Math.round(p.heat || 0);
    if (el && h > 0) {
      const w = Math.max(0, Math.min(100, h));
      const ec = elemColor(el),
        rgb = elemRgb(el),
        live = h >= HEAT_AURA_MIN; // ELEMENTAL staff only — a plain staff has no Heat and no pill
      const nm = ((ELEMENTS[el] || {}).name || 'Arcane').toUpperCase();
      const auraTag =
        { fire: 'SEARING', frost: 'FROZEN AURA', poison: 'VENOM AURA', shock: 'STORM AURA' }[el] || 'AURA'; // element-appropriate live-aura state tag (no emoji, drawn text)
      const bar =
        '<span style="display:inline-block;width:52px;height:8px;border:1px solid #4a4550;border-radius:4px;overflow:hidden;background:#181320;flex:0 0 auto"><span style="display:block;height:100%;width:' +
        w +
        '%;background:' +
        ec +
        ';border-radius:3px;box-shadow:0 0 5px ' +
        ec +
        '"></span></span>'; // temperature bar, fill = the equipped element's color
      const lbl = '<b style="color:' + ec + ';font-size:9px;letter-spacing:.5px">' + nm + '</b>'; // text label (element name), NOT a variable-width emoji
      const tag = live
        ? '<b style="color:' +
          ec +
          ';font-size:9px;letter-spacing:.5px;animation:heatPulse .7s ease-in-out infinite">' +
          auraTag +
          '</b>'
        : '';
      html =
        '<span class="ch-st" title="Heat — casting your ' +
        ((ELEMENTS[el] || {}).name || 'elemental') +
        ' staff builds it; past ' +
        HEAT_AURA_MIN +
        ' Heat you radiate an aura that strikes nearby foes with ' +
        ((ELEMENTS[el] || {}).name || '') +
        '. Stronger staves heat faster." style="border-color:rgba(' +
        rgb +
        ',.42);color:' +
        ec +
        ';display:inline-flex;align-items:center;justify-content:center;gap:5px">' +
        lbl +
        bar +
        tag +
        '</span>'; // inline-flex + centered: no glyph to off-center the bar
      sig = 'h' + w + (live ? 'A' : '') + el;
    }
  }
  return { html, sig };
}
function updateCombatHud() {
  const scrim = document.getElementById('menu-scrim');
  if (scrim) {
    const _d = state.scene !== 'play' && state.scene !== 'dialogue' ? 'block' : 'none';
    if (scrim.style.display !== _d) scrim.style.display = _d;
  }
  /* dim wash behind centered menu panels — SP loop + MP frame both call this (dialogue is a bottom bar below the scrim, so it stays clear) */ const el =
    document.getElementById('combat-hud');
  if (!el) return;
  if (state.scene !== 'play') {
    if (el.style.display !== 'none') {
      el.style.display = 'none';
      el._sig = null;
    }
    return;
  }
  const p = state.player;
  const buffs = [];
  if (p.blessT > 0 && BLESS[p.blessType]) {
    const b = BLESS[p.blessType];
    buffs.push({ ic: '⟡', label: b.name, t: p.blessT, color: b.color });
  }
  if (p.foodT > 0 && FOOD_LABEL[p.foodBuff])
    buffs.push({ ic: '🍲', label: FOOD_LABEL[p.foodBuff], t: p.foodT, color: '#ffcf80' });
  if (p.dragon && p.dragon.mounted) buffs.push({ ic: '🐉', label: 'Flying', t: 0, color: '#ff9050' });
  const debuffs = [];
  if (p.chillT > 0) debuffs.push({ ic: '❄', label: 'Chilled', t: p.chillT, color: '#9fd8ff' });
  if (isExhausted()) debuffs.push({ ic: '😴', label: 'Exhausted', t: 0, color: '#ff7565' });
  const ab = [];
  if (p.abilities.ultimate) ab.push({ k: 'Z', nm: ultLabel(), cd: p.abilityCd.ultimate, en: 45 });
  if (p.abilities.whirlwind) ab.push({ k: 'Q', nm: 'Whirlwind', cd: p.abilityCd.whirlwind, en: 30 });
  if (p.abilities.focus) ab.push({ k: 'R', nm: 'Battle Focus (heal)', cd: 0, en: 50 });
  if (p.abilities.summon) ab.push({ k: 'X', nm: 'Summon Thralls', cd: p.abilityCd.summon, en: 40 });
  const showAb = ab.length > 0;
  if (showAb)
    ab.push({ k: '⇧', nm: 'Dodge-roll', cd: p.dodgeCd, st: Math.max(18, 34 - (p.bonusEvasion || 0) * 2) });
  const _sty = chStyleRow(p);
  const sig =
    buffs.map((b) => b.label + Math.ceil(b.t / 60)).join(',') +
    '|' +
    debuffs.map((d) => d.label + Math.ceil(d.t / 60)).join(',') +
    '|' +
    ab.map((a) => a.k + (a.cd > 0 ? Math.ceil(a.cd / 60) : chCanUse(a) ? 'r' : 'x')).join(',') +
    '|' +
    _sty.sig;
  if (el._sig === sig) return;
  el._sig = sig;
  const rows = [];
  if (_sty.html) rows.push('<div class="ch-row">' + _sty.html + '</div>');
  const st = buffs.concat(debuffs).map(chStatusPill);
  if (st.length) rows.push('<div class="ch-row">' + st.join('') + '</div>');
  if (showAb) rows.push('<div class="ch-row">' + ab.map(chAbPill).join('') + '</div>');
  if (!rows.length) {
    if (el.style.display !== 'none') el.style.display = 'none';
    return;
  }
  el.innerHTML = rows.join('');
  el.style.display = 'flex';
}
function updateFires() {
  if (state.map !== 'overworld') {
    if (state.fires.length) state.fires.length = 0;
    return;
  }
  const p = state.player;
  for (let i = state.fires.length - 1; i >= 0; i--) {
    const f = state.fires[i];
    f.life--;
    f.spread--;
    const fx = f.tx * TILE + 16,
      fy = f.ty * TILE + 16;
    if (state.time % 4 === 0)
      spawnBurst(fx - 6 + Math.random() * 12, fy + 4, 1, {
        color: Math.random() < 0.6 ? '#ff8030' : '#ffd860',
        speed: 0.4,
        up: 1.3,
        decay: 0.05,
        size: 3,
      });
    if (state.time % 18 === 0) {
      for (const e of [...state.enemies]) {
        if (Math.floor((e.x + e.w / 2) / TILE) === f.tx && Math.floor((e.y + e.h / 2) / TILE) === f.ty) {
          e.hp -= afxHit(e, 3);
          if (e.hitFlash < 3) e.hitFlash = 3;
          if (!e.isBoss) {
            e.burnT = Math.max(e.burnT || 0, 40);
            e.burnDmg = Math.max(e.burnDmg || 0, 2);
          }
          if (e.hp <= 0) killEnemy(e);
        }
      }
      for (const pl of partyIn()) {
        /* P2/S3: burn EVERY hero standing in this fire, not just the pinned state.player — retires
           world.js's players[1..N] fire patch. playerTakeDamage reads state.player/state.inventory
           (armor degrade), so pin both around the call; SP: partyIn() === [state.player] and the
           pins are self-assignments — identical. downed heroes are spared (MP-only field). */
        if (pl.downed) continue;
        if (Math.floor((pl.x + pl.w / 2) / TILE) === f.tx && Math.floor((pl.y + pl.h / 2) / TILE) === f.ty) {
          const _sp = state.player,
            _si = state.inventory;
          state.player = pl;
          if (pl.inventory) state.inventory = pl.inventory;
          playerTakeDamage(3);
          state.player = _sp;
          state.inventory = _si;
        }
      }
    }
    if (f.spread <= 0 && f.life > 50) {
      f.spread = 70 + Math.floor(Math.random() * 50);
      const d = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ][Math.floor(Math.random() * 4)];
      if (Math.random() < 0.7) igniteTile(f.tx + d[0], f.ty + d[1]);
    }
    if (f.life <= 0) state.fires.splice(i, 1);
  }
}
function drawFires(camX, camY) {
  for (const f of state.fires) {
    const bx = f.tx * TILE - camX,
      by = f.ty * TILE - camY,
      t = state.time * 0.3 + f.tx * 1.7;
    ctx.fillStyle = 'rgba(60,24,10,0.35)';
    ctx.beginPath();
    ctx.ellipse(bx + 16, by + TILE - 5, 12, 4, 0, 0, 6.28);
    ctx.fill();
    for (let k = 0; k < 4; k++) {
      const ox = bx + 7 + k * 6,
        base = by + TILE - 4,
        fl = Math.sin(t + k * 1.9) * 0.5 + 0.5,
        h = 11 + fl * 10,
        w = 3.5 + fl * 2;
      const g = ctx.createLinearGradient(ox, base, ox, base - h);
      g.addColorStop(0, 'rgba(255,95,20,0.9)');
      g.addColorStop(0.5, 'rgba(255,170,50,0.82)');
      g.addColorStop(1, 'rgba(255,238,140,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(ox - w, base);
      ctx.quadraticCurveTo(ox - w * 0.7, base - h * 0.55, ox, base - h);
      ctx.quadraticCurveTo(ox + w * 0.7, base - h * 0.55, ox + w, base);
      ctx.closePath();
      ctx.fill();
    }
    const cf = Math.sin(t * 1.6) * 0.5 + 0.5;
    const ch = 8 + cf * 5;
    ctx.fillStyle = 'rgba(255,244,180,0.92)';
    ctx.beginPath();
    ctx.moveTo(bx + 13, by + TILE - 4);
    ctx.quadraticCurveTo(bx + 13, by + TILE - 4 - ch * 0.6, bx + 16, by + TILE - 4 - ch);
    ctx.quadraticCurveTo(bx + 19, by + TILE - 4 - ch * 0.6, bx + 19, by + TILE - 4);
    ctx.closePath();
    ctx.fill();
  }
}
function checkHazardFall(e) {
  if (e.isBoss || e.isNemesis || e.aquatic) return false;
  const tx = Math.floor((e.x + e.w / 2) / TILE),
    ty = Math.floor((e.y + e.h / 2) / TILE);
  const t = getTile(state.map, tx, ty);
  if ((t === T.WATER && !(state.map === 'overworld' && isWinter())) || t === T.D_PIT) {
    spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 11, {
      color: t === T.WATER ? '#70b0e8' : '#20202a',
      speed: 1.6,
      up: 0.4,
      decay: 0.05,
    });
    Sound.tone(210, 0.22, 'sine', 0.12, { slideTo: 70 });
    e.hp = 0;
    killEnemy(e);
    return true;
  }
  return false;
}

// ---- dynamic events ----
function triggerEvent() {
  if (state.map !== 'overworld') return;
  const r = Math.random();
  if (r < 0.42) {
    const c = findWildTile();
    if (!c) return;
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const _a = Math.random() * 6.28,
        _r = 1 + Math.random() * 2.4;
      const o = findOpenTile(
        'overworld',
        c.tx + Math.round(Math.cos(_a) * _r),
        c.ty + Math.round(Math.sin(_a) * _r),
      );
      const e = makeWildEnemy(o.tx, o.ty, tileBiome(o.tx, o.ty));
      e.maxHp = Math.round(e.maxHp * 1.35);
      e.hp = e.maxHp;
      e.atk = Math.round(e.atk * 1.15);
      e.elite = true;
      state.enemies.push(e);
    }
    log('⚔ A roaming war-pack prowls the wilds! Danger and plunder await.', 'quest');
    Sound.boss();
  } else if (r < 0.7) {
    const c = findWildTile();
    if (!c) return;
    const o = findOpenTile('overworld', c.tx, c.ty);
    const npc = makeNPC(
      o.tx,
      o.ty,
      'Wandering Merchant',
      '#d0a0f0',
      ['Rare wares, traveler — but I move on soon!'],
      'shop',
    );
    npc.temp = 1500;
    npc.shopTown = {
      key: 'wander',
      name: 'Wandering Merchant',
      biome: Math.floor(Math.random() * 3),
      tier: 2,
    };
    npc.stock = genShopStock(npc.shopTown);
    state.npcs.push(npc);
    log('🛒 A Wandering Merchant appears in the wilds — reach them before they vanish.', 'quest');
  } else {
    const c = findWildTile();
    if (!c) return;
    const o = findOpenTile('overworld', c.tx, c.ty);
    const e = makeEnemy(o.tx, o.ty, 'bat');
    e.name = 'Treasure Sprite';
    e.color = '#f0d050';
    e.maxHp = Math.round(18 * (1 + state.player.level * 0.18));
    e.hp = e.maxHp;
    e.speed = 2.3;
    e.treasure = true;
    e.flee = true;
    e.xp = 45;
    e.gold = 130;
    state.enemies.push(e);
    log('✦ A Treasure Sprite flickers through the grass — catch it for riches!', 'quest');
  }
}
function updateEvents() {
  if (state.map !== 'overworld') return;
  state.eventTimer--;
  if (state.eventTimer <= 0) {
    state.eventTimer = 2700 + Math.floor(Math.random() * 2700);
    triggerEvent();
  }
  // shrines: spent ones sink into the earth and vanish; a new one rises rarely (cap 3)
  for (let i = state.shrines.length - 1; i >= 0; i--) {
    const s = state.shrines[i];
    if (s.sinking) {
      s.sinkT = (s.sinkT || 0) + 1;
      if (s.sinkT > 60) state.shrines.splice(i, 1);
    }
  }
  if (state.shrines.length < 3 && Math.random() < 0.00006) {
    const c = findWildTile();
    if (c) {
      const tps = ['might', 'renewal', 'ward', 'haste'];
      state.shrines.push({
        x: c.tx * TILE + 3,
        y: c.ty * TILE + 3,
        w: 26,
        h: 26,
        type: tps[Math.floor(Math.random() * tps.length)],
        cd: 0,
      });
    }
  }
  for (let i = state.npcs.length - 1; i >= 0; i--) {
    const n = state.npcs[i];
    if (n.temp !== undefined) {
      n.temp--;
      if (n.temp <= 0) {
        if (state.scene !== 'shop') {
          state.npcs.splice(i, 1);
        }
      }
    }
  }
}
// ================= FACTION WAR — the three powers contest the realm =================
function anyTownBesieged() {
  return __g.townZones.some((tz) => tz.besieged);
}
function besiegedTown() {
  const i = __g.townZones.findIndex((tz) => tz.besieged);
  return i < 0 ? null : i;
}
function startDreadRaid() {
  const free = __g.townZones.map((tz, i) => i).filter((i) => !__g.townZones[i].besieged);
  if (!free.length) return;
  const i = NEM_PICK(free);
  const tz = __g.townZones[i];
  tz.besieged = true;
  const c = townCenter(tz);
  const n = 3 + Math.floor(partyRep('dread') / 28); // P2/S11: the raid scales to the party's most-infamous hero (shared-phase read)
  const f = 1 + (state.player.level - 1) * 0.16;
  for (let k = 0; k < n; k++) {
    const _a = Math.random() * 6.28,
      _r = 1 + Math.random() * 2.4;
    const o = findOpenTile(
      'overworld',
      c.x + Math.round(Math.cos(_a) * _r),
      c.y - 1 + Math.round(Math.sin(_a) * _r),
    );
    const t = k === 0 ? 'charger' : k % 2 ? 'skeleton' : 'mage';
    const e = makeEnemy(o.tx, o.ty, t);
    e.maxHp = Math.round(e.maxHp * 1.5 * f);
    e.hp = e.maxHp;
    e.atk = Math.round(e.atk * 1.3 * f);
    e.def += 2;
    e.dread = true;
    e.raidTown = i;
    e.color = '#c83030';
    e.xp = Math.round(e.xp * 1.5);
    e.gold = Math.round(e.gold * 1.5);
    state.enemies.push(e);
  }
  log(
    `⚔ The Dread Legion lays SIEGE to ${tz.name}! Its gates are barred until you drive them off.`,
    'combat',
  );
  Sound.boss();
  Sound.tone(90, 0.6, 'sawtooth', 0.18, { slideTo: 60 });
}
function liberateTown(i) {
  const tz = __g.townZones[i];
  if (!tz || !tz.besieged) return;
  tz.besieged = false;
  addRepParty('vigil', 8); // P2/S11: a town freed is PARTY news — every hero's standing moves (in MP this runs from the full-roster _seen sweep; the last blow's gold stays personal)
  addRepParty('dread', 4);
  const reward = 120 + state.player.level * 20;
  state.player.gold += reward;
  log(`★ ${tz.name} is liberated! The grateful townsfolk reward you (+${reward} gold).`, 'quest');
  Sound.jingle();
  addShake(4);
  updateHUD();
  saveGame();
}
function checkRaidLiberation(town) {
  if (town == null || town === undefined) return;
  if (!state.enemies.some((e) => e.raidTown === town)) liberateTown(town);
}
function spawnVigilPatrol() {
  const p = state.player;
  for (let k = 0; k < 2; k++) {
    state.allies.push({
      x: p.x - 20 + k * 40,
      y: p.y + 14,
      w: 22,
      h: 22,
      ally: true,
      vigil: true,
      name: 'Vigil Guard',
      rank: 0,
      hp: 90,
      maxHp: 90,
      atk: 12 + state.player.level,
      def: 3,
      color: '#9ad0ff',
      attackCd: 0,
      life: 1500,
      wobble: Math.random() * 6.28,
    });
  }
  log('⚜ A Vigil patrol rallies to your side!', 'good');
  Sound.item && Sound.item();
}
function startStampede() {
  const p = state.player;
  let c = null;
  for (let i = 0; i < 20; i++) {
    const ang = Math.random() * 6.28,
      d = 8 + Math.random() * 4;
    const tx = Math.floor((p.x + p.w / 2) / TILE + Math.cos(ang) * d),
      ty = Math.floor((p.y + p.h / 2) / TILE + Math.sin(ang) * d);
    if (tx < 1 || ty < 1 || tx >= OW_W - 1 || ty >= OW_H - 1) continue;
    if (SOLID.has(getTile('overworld', tx, ty)) || isInTown(tx, ty)) continue;
    c = { tx, ty };
    break;
  }
  if (!c) return;
  const n = 4 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) {
    const _a = Math.random() * 6.28,
      _r = 1 + Math.random() * 2.4;
    const o = findOpenTile(
      'overworld',
      c.tx + Math.round(Math.cos(_a) * _r),
      c.ty + Math.round(Math.sin(_a) * _r),
    );
    const e = makeWildEnemy(o.tx, o.ty, tileBiome(o.tx, o.ty));
    e.atk = Math.round(e.atk * 1.2);
    e.speed *= 1.2;
    e.night = true;
    state.enemies.push(e);
  }
  log('🐗 The Wilds turn on you — a stampede of enraged beasts thunders in!', 'combat');
  Sound.boss();
}
function updateFactionWar() {
  if (state.map !== 'overworld' || state.player.level < 4) return;
  state.warTimer = (state.warTimer || 1800) - 1;
  if (state.warTimer > 0) return;
  state.warTimer = 3000 + Math.floor(Math.random() * 3000);
  // P2/S11: the WORLD reacts to the party's EXTREME member (shared-phase reads — rep is
  // per-hero now): raids chase the most-infamous (dread max), stampedes avenge the
  // most-hated (wilds min), the patrol rallies to the most-honored (vigil max). SP: the
  // hero's own values, exactly as before.
  const dreadX = partyRep('dread'),
    wildsX = partyRep('wilds');
  const roll = Math.random();
  if (dreadX >= 20 && !anyTownBesieged() && roll < 0.3 + dreadX * 0.005) {
    startDreadRaid();
    return;
  }
  if (wildsX <= -20 && roll < 0.5) {
    startStampede();
    return;
  }
  if (repTierIdx(partyRep('vigil')) >= 2 && state.enemies.length > 0 && !(state.allies || []).some((a) => a.vigil)) {
    spawnVigilPatrol();
    return;
  }
}

// ---- nemesis ----
// ================= THE DREAD LEGION — emergent nemesis hierarchy =================
const WL_FIRST = [
  'Grukk',
  'Sythe',
  'Karzul',
  'Vexa',
  'Mordrek',
  'Threx',
  'Bral',
  'Ghorza',
  'Uzgar',
  'Nazru',
  'Skarn',
  'Yrra',
  'Drog',
  'Hexa',
  'Volk',
  'Murg',
  'Zradd',
  'Olga',
];
const WL_EPITHET = [
  'the Render',
  'Blackmaw',
  'Ironjaw',
  'the Cruel',
  'Skullsplitter',
  'Gravecaller',
  'the Flayer',
  'Bonechewer',
  'the Vile',
  'Doomspeaker',
  'the Wretched',
  'Ashtongue',
  'the Maimer',
  'Grimscar',
  'the Defiler',
];
const RANK_NAMES = ['Grunt', 'Captain', 'Warlord', 'Overlord'];
const WL_STRENGTHS = {
  ironhide: 'Ironhide — shrugs off blows',
  fireborn: 'Fireborn — immune to fire',
  frostbound: 'Frostbound — cannot be frozen',
  frenzied: 'Frenzied — fast and ferocious',
  regenerator: 'Regenerator — wounds knit shut',
  swarmlord: 'Swarmlord — fights with a retinue',
};
const WL_WEAKNESS = {
  poison: 'Dreads poison',
  ranged: 'Fears the bow',
  crit: 'Bleeds easily (crits hit hard)',
  stagger: 'Loses nerve when staggered',
  fire: 'Flammable',
};
const REGION_NAMES = [
  'the Northwest Reaches',
  'the Northern Wastes',
  'the Northeast Range',
  'the Western Marches',
  'the Heartlands',
  'the Eastern Wilds',
  'the Southern Bogs',
  'the Southlands',
  'the Emberwaste Frontier',
];
function NEM_PICK(a) {
  return a[Math.floor(Math.random() * a.length)];
}
