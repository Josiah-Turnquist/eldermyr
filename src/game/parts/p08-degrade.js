function degrade(it, prob) {
  if (!it || it.dur === undefined) return;
  if (Math.random() < prob) {
    const was = it.dur;
    it.dur = Math.max(0, it.dur - 1);
    if (was > 0 && it.dur === 0) {
      recalcStats();
      updateHUD();
      log(`${it.name} has broken! Repair it at a blacksmith.`, 'combat');
    }
  }
}

// ================= SKILLS =================
function toggleSkills() {
  const panel = document.getElementById('skills');
  if (state.scene === 'skills') {
    panel.style.display = 'none';
    state.scene = 'play';
  } else if (state.scene === 'play') {
    if (state.map === 'dungeon') {
      log('You can only train and spend skills outside the dungeon — return to the surface first.', 'combat');
      return;
    }
    panel.style.display = 'block';
    state.scene = 'skills';
    renderSkills();
  }
}
function renderSkills() {
  const p = state.player;
  document.getElementById('sp-count').textContent = p.skillPoints;
  const profEl = document.getElementById('prof-list');
  profEl.innerHTML = '';
  ['melee', 'ranged', 'magic'].forEach((st) => {
    const pr = p.prof[st];
    const col = { melee: '#ff9060', ranged: '#90e060', magic: '#b070ff' }[st];
    const row = document.createElement('div');
    row.className = 'prof-bar';
    row.innerHTML = `<span style="color:${col};width:70px">${styleLabel(st)}</span><b style="width:34px">Lv ${pr.lvl}</b><div class="pbtrack"><div class="pbfill" style="width:${Math.round((pr.xp / pr.next) * 100)}%;background:${col}"></div></div><span style="color:#8088a0;font-size:10px;width:46px;text-align:right">+${Math.round((pr.lvl - 1) * 2)}% dmg</span>`;
    profEl.appendChild(row);
    const pk = document.createElement('div');
    pk.style.cssText = 'margin:-2px 2px 9px 74px; font-size:10px; line-height:1.5;';
    pk.innerHTML = MASTERY[st]
      .map((m, i) => {
        const got = pr.lvl >= MASTERY_LVLS[i];
        const nmc = got ? col : '#6b6b7a',
          efc = got ? '#aeb2c0' : '#5f5f6c',
          mk = got ? '✦' : `<span style="color:#83839a">Lv ${MASTERY_LVLS[i]}</span>`;
        return `<div><b style="color:${nmc}">${mk} ${m[0]}</b> <span style="color:${efc}">— ${m[1]}</span></div>`;
      })
      .join('');
    profEl.appendChild(pk);
  }); /* milestones' single home: name + effect inline, unlocked=style-colored ✦, locked=greyed w/ unlock level — data-driven off MASTERY[] so future perk changes flow through */
  const passives = [
    { id: 'might', name: 'Might', desc: '+2 Power (all weapons)', val: `ATK ${p.atk}` },
    { id: 'vigor', name: 'Vigor', desc: '+10 Max HP', val: `HP ${p.maxHp}` },
    { id: 'guard', name: 'Guard', desc: '+1 Defense', val: `DEF ${p.def}` },
    {
      id: 'swift',
      name: 'Swift',
      desc: '+Speed & faster attacks',
      val: `SPD ${p.speed.toFixed(1)} · ${Math.round(p.atkHaste * 100)}% haste`,
      maxed: p.speed >= 2.8 && p.atkHaste >= 0.4,
    },
    {
      id: 'precision',
      name: 'Precision',
      desc: '+5% critical hit (deals 2× damage)',
      val: `Crit ${Math.round((p.crit || 0) * 100)}%`,
      maxed: (p.bonusCrit || 0) >= 12,
    },
    {
      id: 'lifedrain',
      name: 'Lifedrain',
      desc: 'Heal for a % of damage you deal',
      val: `Lifesteal ${Math.round((p.lifesteal || 0) * 100)}%`,
      maxed: (p.bonusLifesteal || 0) >= 15,
    },
    {
      id: 'bloodlust',
      name: 'Bloodlust',
      desc: 'Deal more damage the lower your HP',
      val: `Berserk up to +${Math.round((p.berserk || 0) * 100)}%`,
      maxed: (p.bonusBerserk || 0) >= 6,
    },
    {
      id: 'evasion',
      name: 'Evasion',
      desc: 'Chance to evade hits; cheaper dodge-rolls',
      val: `Evade ${Math.round((p.evasion || 0) * 100)}%`,
      maxed: (p.bonusEvasion || 0) >= 13,
    },
    {
      id: 'executioner',
      name: 'Executioner',
      desc: '+12% damage to enemies below 30% HP',
      val: `Execute +${Math.round((p.exec || 0) * 100)}%`,
      maxed: (p.bonusExec || 0) >= 4,
    },
    {
      id: 'bulwark',
      name: 'Bulwark',
      desc: 'Flat damage reduction from every hit',
      val: `Reduce ${Math.round((p.fort || 0) * 100)}%`,
      maxed: (p.bonusFort || 0) >= 6,
    },
    {
      id: 'arcanefont',
      name: 'Arcane Font',
      desc: 'Faster energy regen + cheaper spells',
      val: `Font +${p.bonusFont || 0}`,
      maxed: (p.bonusFont || 0) >= 4,
    },
  ];
  const pEl = document.getElementById('skill-list-passive');
  pEl.innerHTML = '';
  passives.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.innerHTML = `<div><b>${s.name}</b> <span class="sk-desc">${s.desc}</span><br><span class="sk-val">${s.val}</span></div>`;
    const btn = document.createElement('button');
    btn.className = 'sk-btn';
    if (s.maxed) {
      btn.textContent = 'Maxed';
      btn.disabled = true;
    } else if (p.skillPoints > 0) {
      btn.textContent = '+ Upgrade';
      btn.onclick = () => spendPoint(s.id);
    } else {
      btn.textContent = 'No points';
      btn.disabled = true;
    }
    row.appendChild(btn);
    pEl.appendChild(row);
  });
  /* eff(r): the LIVE per-rank effect number, pulled from each use-fn so the menu can't drift — whirlwind 1.15*(1+0.30*(r-1)) [useWhirlwind]; focus 25+16*(r-1) [useFocus]; ultimate _um=1+0.35*(r-1) [useUltimate]; summon 1+r [useSummon]; dominate single-rank [dominateElite/Warlord] */
  const abilities = [
    {
      id: 'whirlwind',
      name: 'Whirlwind (Q)',
      desc: 'Melee spin — needs a blade. 30 energy.',
      req: 2,
      eff: (r) => Math.round(115 * (1 + 0.3 * (r - 1))) + '% Power dmg',
    },
    {
      id: 'focus',
      name: 'Battle Focus (R)',
      desc: 'Restore HP instantly. 50 energy.',
      req: 3,
      eff: (r) => 'Heal +' + (25 + 16 * (r - 1)) + ' HP',
    },
    {
      id: 'ultimate',
      name: 'Ultimate (Z)',
      desc: 'Signature move — adapts to your weapon: melee Cleaving Storm, ranged Arrow Storm, magic Elemental Nova. 45 energy, 5s cooldown.',
      req: 5,
      eff: (r) => '×' + (1 + 0.35 * (r - 1)).toFixed(2) + ' damage',
    },
    {
      id: 'dominate',
      name: 'Dominate',
      desc: 'A mage\u2019s art — bring a Dread warlord OR an Elite foe below 25% HP, then [E] to bind its will to yours.',
      req: 1,
      profReq: 18,
      eff: (r) => 'Bind a foe below 25% HP (max 2 at once)',
    },
    {
      id: 'summon',
      name: 'Summon Thrall (X)',
      desc: 'Call your dominated warlords to fight beside you. 40 energy, 10s cooldown.',
      req: 8,
      eff: (r) => 'Summons ' + (1 + r) + ' thralls at once',
    },
  ];
  const aEl = document.getElementById('skill-list-active');
  aEl.innerHTML = '';
  abilities.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'skill-row';
    const rk = abRank(s.id);
    const rmax = ABILITY_RMAX[s.id] || 1;
    const owned = rk > 0;
    const maxed = owned && rk >= rmax;
    const _profOk = !s.profReq || p.prof.magic.lvl >= s.profReq;
    const _lvlOk = p.level >= s.req;
    const statusHtml = owned
      ? `<span style="color:#74e08a">✓ ${rmax > 1 ? `Rank ${rk}/${rmax}` : 'Unlocked'}</span> · <span style="color:#aeb2c0">${s.eff(rk)}</span>`
      : `<span style="color:#8b90a4">${!_profOk ? 'Requires Magic proficiency ' + s.profReq : !_lvlOk ? 'Requires LV ' + s.req : 'Ready to learn'}</span>`; /* line 2: rank + LIVE effect at current rank (or the requirement when locked) */
    const previewHtml = maxed
      ? '<span style="color:#d0b070">◆ MAX — fully mastered</span>'
      : owned
        ? `→ Rank ${rk + 1}: ${s.eff(rk + 1)}`
        : `→ Unlock (Rank 1): ${s.eff(1)}`; /* line 3: what the next skill point buys */
    row.innerHTML = `<div><b>${s.name}</b> <span class="sk-desc">${s.desc}</span><br><span class="sk-val">${statusHtml}</span><br><span style="font-size:10px;color:#6b6b7a">${previewHtml}</span></div>`;
    const btn = document.createElement('button');
    btn.className = 'sk-btn';
    if (maxed) {
      btn.textContent = 'Maxed';
      btn.disabled = true;
    } else if (!_lvlOk || !_profOk) {
      btn.textContent = s.profReq ? 'Magic ' + s.profReq : 'LV ' + s.req;
      btn.disabled = true;
    } else if (p.skillPoints <= 0) {
      btn.textContent = 'No points';
      btn.disabled = true;
    } else {
      btn.textContent = owned ? '+ Rank up' : 'Unlock';
      btn.onclick = () => unlockAbility(s.id);
    }
    row.appendChild(btn);
    aEl.appendChild(row);
  });
}
function spendPoint(id) {
  const p = state.player;
  if (p.skillPoints <= 0) return;
  if (id === 'might') p.bonusAtk += 2;
  if (id === 'vigor') {
    p.maxHp += 10;
    p.hp += 10;
  }
  if (id === 'guard') p.bonusDef += 1;
  if (id === 'swift') {
    if (p.speed >= 2.8 && p.atkHaste >= 0.4) return;
    p.speed = Math.min(2.8, Math.round((p.speed + 0.1) * 10) / 10);
    p.atkHaste = Math.min(0.4, Math.round((p.atkHaste + 0.04) * 100) / 100);
  }
  if (id === 'precision') {
    if ((p.bonusCrit || 0) >= 12) return;
    p.bonusCrit = (p.bonusCrit || 0) + 2;
  }
  if (id === 'lifedrain') {
    if ((p.bonusLifesteal || 0) >= 15) return;
    p.bonusLifesteal = (p.bonusLifesteal || 0) + 1;
  }
  if (id === 'bloodlust') {
    if ((p.bonusBerserk || 0) >= 6) return;
    p.bonusBerserk = (p.bonusBerserk || 0) + 1;
  }
  if (id === 'evasion') {
    if ((p.bonusEvasion || 0) >= 13) return;
    p.bonusEvasion = (p.bonusEvasion || 0) + 1;
  }
  if (id === 'executioner') {
    if ((p.bonusExec || 0) >= 4) return;
    p.bonusExec = (p.bonusExec || 0) + 1;
  }
  if (id === 'bulwark') {
    if ((p.bonusFort || 0) >= 6) return;
    p.bonusFort = (p.bonusFort || 0) + 1;
  }
  if (id === 'arcanefont') {
    if ((p.bonusFont || 0) >= 4) return;
    p.bonusFont = (p.bonusFont || 0) + 1;
  }
  p.skillPoints--;
  recalcStats();
  updateHUD();
  renderSkills();
  saveGame();
  log(`Skill improved: ${id.charAt(0).toUpperCase() + id.slice(1)}.`, 'good');
}
// P3/S10: ability rank caps live in src/content/tables.ts (CONTENT.tables.abilities.rankMax); positional alias.
const ABILITY_RMAX = CONTENT.tables.abilities.rankMax;
function abRank(id) {
  const p = state.player,
    r = p.abilityRank;
  return (r && r[id]) || (p.abilities[id] ? 1 : 0);
}
function unlockAbility(id) {
  const p = state.player;
  if (p.skillPoints <= 0) return;
  if (id === 'dominate' && p.prof.magic.lvl < 18) {
    Sound.error && Sound.error();
    log('Dominate is a mage\u2019s art — raise your Magic proficiency to 18 first.', 'combat');
    return;
  }
  if (!p.abilityRank) p.abilityRank = { whirlwind: 0, focus: 0, ultimate: 0, summon: 0, dominate: 0 };
  const max = ABILITY_RMAX[id] || 1;
  const cur = p.abilityRank[id] || (p.abilities[id] ? 1 : 0);
  if (cur >= max) return;
  p.abilities[id] = true;
  p.abilityRank[id] = cur + 1;
  p.skillPoints--;
  updateHUD();
  renderSkills();
  saveGame();
  const nm =
    {
      whirlwind: 'Whirlwind',
      focus: 'Battle Focus',
      ultimate: 'Ultimate (Z)',
      dominate: 'Dominate',
      summon: 'Summon Thrall (X)',
    }[id] || id;
  log(cur === 0 ? `Ability unlocked: ${nm}!` : `${nm} strengthened - rank ${cur + 1}.`, 'good');
}
function useWhirlwind() {
  const p = state.player;
  const wel = (equippedWeapon() || {}).element;
  if (!p.abilities.whirlwind) {
    log('Whirlwind not unlocked yet — open Skills [K] in town.');
    return;
  }
  if (p.abilityCd.whirlwind > 0) return;
  if (p.energy < 30) {
    Sound.error();
    log('Not enough energy for Whirlwind!', 'combat');
    return;
  }
  const melee = styleOf(equippedWeapon()) === 'melee';
  const _wrk = abRank('whirlwind') || 1;
  const mult = (melee ? 1.15 : 0.4) * (1 + 0.3 * (_wrk - 1));
  p.energy -= 30;
  p.abilityCd.whirlwind = 45;
  p.whirl = 16;
  p.attacking = 14;
  Sound.whirl();
  addShake(3);
  let hit = false;
  for (const e of [...state.enemies]) {
    if (rectDist(p, e) < 58 + 5 * (_wrk - 1)) {
      const dmg = Math.max(1, Math.floor(p.atk * mult) - e.def + Math.floor(Math.random() * 3));
      e.hp -= afxHit(e, dmg);
      e.hitFlash = 8;
      hit = true;
      floatDamage(e.x + e.w / 2, e.y, dmg, '#a0e0ff');
      spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 5, { color: '#a0e0ff', speed: 2.4, decay: 0.06 });
      applyElementOnHit(e, wel, dmg);
      if (!e.isBoss && weakMul(e, 'stagger') > 1) e.stunT = Math.max(e.stunT || 0, 50);
      const kb = e.isBoss ? 3 : 8,
        ang = Math.atan2(e.y + e.h / 2 - (p.y + p.h / 2), e.x + e.w / 2 - (p.x + p.w / 2));
      e.x += Math.cos(ang) * kb;
      e.y += Math.sin(ang) * kb;
      if (checkHazardFall(e)) continue;
      if (melee) gainProf('melee', 2);
      if (e.hp <= 0) killEnemy(e);
    }
  }
  if (hit) {
    Sound.hit();
    log(
      melee ? 'Whirlwind tears through your foes!' : 'Without a blade, your whirlwind is feeble.',
      'combat',
    );
    if (melee) degrade(equippedWeapon(), 0.2);
  }
  updateHUD();
}
function useFocus() {
  const p = state.player;
  if (p.cloaked || p._stillT) {
    p.cloaked = false;
    p._stillT = 0;
  }
  /* GRAVEWOOL: an ability breaks the cloak */ if (!p.abilities.focus) {
    log('Battle Focus not unlocked yet — open Skills [K] in town.');
    return;
  }
  if (p.energy < 50) {
    Sound.error();
    log('Not enough energy for Battle Focus!', 'combat');
    return;
  }
  if (p.hp >= p.maxHp) {
    log('Already at full health.');
    return;
  }
  const _frk = abRank('focus') || 1;
  const _fheal = 25 + 16 * (_frk - 1);
  p.energy -= 50;
  p.hp = Math.min(p.maxHp, p.hp + _fheal);
  Sound.heal();
  spawnBurst(p.x + p.w / 2, p.y + p.h / 2, 12, { color: '#90ffb0', speed: 1.6, up: 0.8, decay: 0.035 });
  log('Battle Focus surges — +' + _fheal + ' HP.', 'good');
  updateHUD();
}
// Ultimate (Z) — a signature move that ADAPTS to your weapon style & element, and scales with your build (crit/berserk/exec/lifesteal).
function ultLabel() {
  const s = styleOf(equippedWeapon());
  return s === 'ranged' ? 'Arrow Storm' : s === 'magic' ? 'Elemental Nova' : 'Cleaving Storm';
}
function useUltimate() {
  const p = state.player;
  if (!p.abilities.ultimate) {
    log('Ultimate not unlocked yet — open Skills [K] in town.');
    return;
  }
  if (p.abilityCd.ultimate > 0) {
    Sound.error();
    log(`${ultLabel()} is recharging (${Math.ceil(p.abilityCd.ultimate / 60)}s).`, 'combat');
    return;
  }
  if (p.energy < 45) {
    Sound.error();
    log('Not enough energy for your Ultimate!', 'combat');
    return;
  }
  const w = equippedWeapon();
  const s = styleOf(w);
  const el = w && w.element;
  p.energy -= 45;
  p.abilityCd.ultimate = 300;
  p.ultT = 26;
  addShake(5);
  const cx = p.x + p.w / 2,
    cy = p.y + p.h / 2;
  const _um = 1 + 0.35 * ((abRank('ultimate') || 1) - 1);
  if (s === 'ranged') {
    const dv = dirVec();
    const base = Math.atan2(dv[1], dv[0]);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.17;
      const ps = projParams(el, 'ranged');
      addProjectile(
        cx,
        cy,
        Math.cos(a) * ps.spd * 1.1,
        Math.sin(a) * ps.spd * 1.1,
        Math.max(1, Math.round(p.atk * 0.7 * _um)),
        {
          friendly: true,
          kind: 'arrow',
          color: el ? elemColor(el) : '#e8d8a0',
          r: ps.r,
          life: 80,
          pierce: ps.pierce + 1,
          style: 'ranged',
          element: el,
        },
      );
    }
    ultimateNova(cx, cy, el, _um, { col: '#e8d8a0', rgb: '232,216,160' });
    Sound.shoot();
    Sound.whirl();
    log('⟫ ARROW STORM! ⟪', 'good');
    if (w) degrade(w, 0.3);
  } else if (s === 'magic') {
    let hit = false;
    for (const e of [...state.enemies]) {
      if (e.hp <= 0) continue;
      if (Math.hypot(e.x + e.w / 2 - cx, e.y + e.h / 2 - cy) < 120) {
        const crit = Math.random() < p.crit;
        let dmg = Math.max(1, Math.round((p.atk * 1.1 * _um - e.def) * playerDmgMul() * execMul(e)));
        if (crit) dmg *= 2;
        e.hp -= afxHit(e, dmg);
        e.hitFlash = 8;
        hit = true;
        floatDamage(e.x + e.w / 2, e.y, dmg, crit ? '#fff060' : '#c0a0ff');
        spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 6, {
          color: el ? elemColor(el) : '#b070ff',
          speed: 2.6,
          decay: 0.05,
        });
        applyElementOnHit(e, el, dmg);
        applyLifesteal(e, dmg);
        if (e.hp <= 0) killEnemy(e);
      }
    }
    ultimateNova(cx, cy, el, _um);
    Sound.cast();
    Sound.whirl();
    log('✦ ELEMENTAL NOVA! ✦', 'good');
    if (w) degrade(w, 0.3);
  } else {
    p.whirl = 22;
    let hit = false;
    for (const e of [...state.enemies]) {
      if (e.hp <= 0) continue;
      if (rectDist(p, e) < 92) {
        const crit = Math.random() < p.crit;
        let dmg = Math.max(1, Math.round((p.atk * 1.5 * _um - e.def) * playerDmgMul() * execMul(e)));
        if (crit) dmg *= 2;
        e.hp -= afxHit(e, dmg);
        e.hitFlash = 8;
        hit = true;
        floatDamage(e.x + e.w / 2, e.y, dmg, crit ? '#fff060' : '#a0e0ff');
        spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 7, {
          color: crit ? '#fff060' : '#a0e0ff',
          speed: 3,
          decay: 0.05,
        });
        applyElementOnHit(e, el, dmg);
        applyLifesteal(e, dmg);
        if (!e.isBoss && weakMul(e, 'stagger') > 1) e.stunT = Math.max(e.stunT || 0, 55);
        const kb = e.isBoss ? 5 : 20,
          ang = Math.atan2(e.y + e.h / 2 - cy, e.x + e.w / 2 - cx);
        e.x += Math.cos(ang) * kb;
        e.y += Math.sin(ang) * kb;
        if (checkHazardFall(e)) continue;
        gainProf('melee', 3);
        if (e.hp <= 0) killEnemy(e);
      }
    }
    ultimateNova(cx, cy, el, _um, { col: '#cfe6ff', rgb: '207,230,255' });
    if (hit) Sound.hit();
    Sound.whirl();
    log('⚔ CLEAVING STORM! ⚔', 'good');
    if (w) degrade(w, 0.3);
  }
  updateHUD();
}

// ================= SHOP =================
const SHOP_NAMES = CONTENT.gear.shopNames; // P3/S6: positional alias → src/content/gear.ts
function genShopStock(town) {
  const t = town.tier,
    b = town.biome,
    el = b === 1 ? 'frost' : b === 2 ? 'fire' : null,
    nm = SHOP_NAMES[b] || SHOP_NAMES[0];
  const tpre = t >= 2 ? 'Greater ' : t >= 1 ? 'Fine ' : '';
  const rIdx = Math.min(4, t + (b ? 1 : 0)),
    lv = Math.max(1, t * 4),
    reqP = Math.max(1, t * 2 + 1),
    aB = 6 + t * 7,
    dB = 4 + t * 4,
    cm = 1 + t * 1.3;
  const weapons = [
    {
      id: 'shop_' + town.key + '_w0',
      name: tpre + nm.melee,
      style: 'melee',
      atk: Math.round(aB * 1.1),
      cd: 22,
      cost: Math.round(120 * cm),
      rarity: rIdx,
      reqLevel: lv,
      reqProf: reqP,
      element: el,
      affixes: rollAffixes(rIdx, true),
    },
    {
      id: 'shop_' + town.key + '_w1',
      name: tpre + nm.ranged,
      style: 'ranged',
      atk: aB,
      cd: 26,
      cost: Math.round(130 * cm),
      rarity: rIdx,
      reqLevel: lv,
      reqProf: reqP,
      element: el,
      affixes: rollAffixes(rIdx, true),
    },
    {
      id: 'shop_' + town.key + '_w2',
      name: tpre + nm.magic,
      style: 'magic',
      atk: Math.round(aB * 1.2),
      cost: Math.round(150 * cm),
      rarity: rIdx,
      reqLevel: lv,
      reqProf: reqP,
      element: el,
      affixes: rollAffixes(rIdx, true),
    },
  ];
  const armor = [
    {
      id: 'shop_' + town.key + '_a0',
      name: tpre + nm.mail,
      def: dB,
      cost: Math.round(110 * cm),
      rarity: rIdx,
      reqLevel: lv,
      affixes: rollAffixes(rIdx, false),
    },
  ];
  if (t >= 1)
    armor.push({
      id: 'shop_' + town.key + '_a1',
      name: tpre + nm.plate,
      def: Math.round(dB * 1.5),
      cost: Math.round(240 * cm),
      rarity: Math.min(4, rIdx + 1),
      reqLevel: lv + 2,
      affixes: rollAffixes(Math.min(4, rIdx + 1), false),
    });
  return { weapons, armor };
}
const SHOP_WEAPONS = CONTENT.gear.shopWeapons; // P3/S6: positional alias → src/content/gear.ts
