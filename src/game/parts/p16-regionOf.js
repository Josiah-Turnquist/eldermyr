function regionOf(tx, ty) {
  const cx = Math.min(2, Math.floor(tx / (OW_W / 3))),
    cy = Math.min(2, Math.floor(ty / (OW_H / 3)));
  return cy * 3 + cx;
}
function mkWarlord(rank, region, level) {
  const L = state.legion;
  const id = 'wl' + (L ? L.nextId++ : Math.floor(Math.random() * 1e6));
  return {
    id,
    name: NEM_PICK(WL_FIRST) + ' ' + NEM_PICK(WL_EPITHET),
    rank,
    level: Math.max(1, level),
    alive: true,
    scouted: 0,
    strength: NEM_PICK(Object.keys(WL_STRENGTHS)),
    weakness: NEM_PICK(Object.keys(WL_WEAKNESS)),
    grudge: 0,
    kills: 0,
    region,
  };
}
function genLegion() {
  state.legion = { warlords: [], overlord: null, nextId: 1, kills: 0 };
  const lvl = partyLvl();
  const corners = [0, 2, 6, 8];
  const oReg = corners[Math.floor(Math.random() * corners.length)];
  const regs = [0, 1, 2, 3, 5, 6, 7, 8].filter((r) => r !== oReg).sort(() => Math.random() - 0.5);
  for (let i = 0; i < 5; i++) state.legion.warlords.push(mkWarlord(i === 0 ? 2 : 1, regs[i], lvl));
  state.legion.overlord = mkWarlord(3, oReg, lvl);
} // #2: warlord/overlord LEVEL tracks party 1:1 (was +1..+3 / +5) — rank & the makeWarlordEnemy stat curves keep them tough
function legionRoster() {
  const L = state.legion;
  return L ? [L.overlord, ...L.warlords].filter(Boolean) : [];
}
function weakMul(e, kind) {
  const w = e && e.warlordRef;
  return w && w.weakness === kind ? 1.6 : 1;
}
function maybeRaiseNemesis() {
  legionDaily();
}
function legionDaily() {
  const L = state.legion;
  if (!L) return;
  L.warlords = L.warlords.filter((w) => w.alive);
  while (L.warlords.length < 5) {
    const taken = new Set([
      4,
      L.overlord && L.overlord.alive ? L.overlord.region : -1,
      ...L.warlords.map((w) => w.region),
    ]);
    let r = 0;
    for (let i = 0; i < 9; i++)
      if (!taken.has(i)) {
        r = i;
        break;
      }
    const w = mkWarlord(1, r, state.player.level + Math.floor(Math.random() * 3));
    L.warlords.push(w);
    log(`A new captain rises in the Dread Legion: ${w.name} seizes ${REGION_NAMES[w.region]}.`, 'lore');
  }
  if (Math.random() < 0.5) {
    const w = NEM_PICK(L.warlords);
    if (w) {
      w.level++;
      if (w.rank < 2 && Math.random() < 0.3) {
        w.rank++;
        log(`${w.name} climbs the Legion's ranks to ${RANK_NAMES[w.rank]}.`, 'combat');
      }
    }
  }
  // thrall loyalty drifts with your Infamy; the resentful defect
  for (const w of legionRoster()) {
    if (w && w.dominated && w.alive) {
      w.loyalty = Math.max(0, Math.min(100, (w.loyalty || 50) + (facTierIdx('dread') >= 2 ? 3 : -5)));
      if (w.loyalty <= 15 && Math.random() < 0.45) {
        w.dominated = false;
        w.posted = false;
        w.grudge = (w.grudge || 0) + 1;
        const i = state.allies.findIndex((a) => a.bodyguardOf === w.id);
        if (i >= 0) state.allies.splice(i, 1);
        log(
          `☠ ${w.name}'s loyalty shatters — the ${RANK_NAMES[w.rank]} breaks free and turns on you once more!`,
          'combat',
        );
      }
    }
  }
}
function makeWarlordEnemy(w, tx, ty) {
  const cyc = state.legionCycle || 0;
  const pn = 1 + (partyN() - 1) * 0.15,
    pnh = 1 + (partyN() - 1) * 0.35,
    cycHp = 1 + cyc * 0.35,
    cycAtk = 1 + cyc * 0.25,
    cycRew = 1 + cyc * 0.4;
  const f = (1 + (w.level - 1) * 0.15 + w.rank * 0.28) * (1 + distFactor(tx, ty) * 0.5);
  const e = makeEnemy(tx, ty, 'skeleton');
  e.isNemesis = true;
  e.warlordRef = w;
  e.dread = true;
  e.name = w.name;
  e.w = 24 + w.rank * 4;
  e.h = 24 + w.rank * 4;
  e.maxHp = Math.round((45 + w.rank * 40) * f * pnh * cycHp);
  e.hp = e.maxHp;
  e.atk = Math.round(
    (6 + w.level * 1.35 + Math.max(0, w.level - 5) * 0.6) * (1 + w.rank * 0.16) * pn * cycAtk,
  );
  e.def = Math.round(2 + w.level * 0.5 + w.rank + cyc);
  e.speed = 1.22;
  e.xp = Math.round((80 + w.rank * 70) * f * cycRew);
  e.gold = Math.round((150 + w.rank * 120) * f * cycRew);
  e.cycle = cyc;
  e.color = w.rank >= 3 ? '#ff2828' : w.rank >= 2 ? '#e04040' : '#cf6a6a';
  e.charger = true;
  e.chargeCd = 78;
  e.chargeState = 0;
  e.chargeT = 0;
  if (w.strength === 'ironhide') e.def += Math.round(6 + w.level * 0.4);
  if (w.strength === 'fireborn') e.fireImmune = true;
  if (w.strength === 'frostbound') e.frostImmune = true;
  if (w.strength === 'frenzied') {
    e.speed *= 1.25;
    e.atk = Math.round(e.atk * 1.18);
  }
  if (w.strength === 'regenerator') e.regen = Math.max(1, Math.round(e.maxHp * 0.0035));
  if (w.strength === 'swarmlord') {
    for (let i = 0; i < 2; i++) {
      const o = findOpenTile('overworld', tx + (i ? 2 : -2), ty + 1);
      const m = makeWildEnemy(o.tx, o.ty, tileBiome(o.tx, o.ty));
      state.enemies.push(m);
    }
  }
  return e;
}
function spawnWarlord(w) {
  if (state.map !== 'overworld' || state.enemies.some((e) => e.isNemesis)) return false;
  const p = state.player;
  let c = null;
  for (let i = 0; i < 30; i++) {
    const ang = Math.random() * 6.28,
      d = 9 + Math.random() * 5;
    const tx = Math.floor((p.x + p.w / 2) / TILE + Math.cos(ang) * d),
      ty = Math.floor((p.y + p.h / 2) / TILE + Math.sin(ang) * d);
    if (tx < 1 || ty < 1 || tx >= OW_W - 1 || ty >= OW_H - 1) continue;
    if (SOLID.has(getTile('overworld', tx, ty)) || isInTown(tx, ty)) continue;
    c = { tx, ty };
    break;
  }
  if (!c) c = findWildTile();
  if (!c) return false;
  state.enemies.push(makeWarlordEnemy(w, c.tx, c.ty));
  const known = w.scouted >= 1 ? ` [${WL_STRENGTHS[w.strength].split(' — ')[0]}]` : '';
  log(
    `☠ ${w.name} — ${RANK_NAMES[w.rank]} of ${REGION_NAMES[w.region]}${known} — ambushes you!` +
      (w.grudge > 0 ? ` "You cost me dearly. Now you die."` : ''),
    'combat',
  );
  Sound.boss();
  Sound.tone(110, 0.5, 'sawtooth', 0.18, { slideTo: 70 });
  return true;
}
function updateNemesisPresence() {
  const L = state.legion;
  if (state.map !== 'overworld' || !L) return;
  // Softlock guard (v2.34.2): if the finale stage points at an Overlord who already fell (slain early via
  // high-infamy ambushes — legionDaily refills warlords but never re-crowns an Overlord), the war is won.
  {
    const lq = state.quests.legion;
    if (lq && lq.stage === 'overlord' && (!L.overlord || !L.overlord.alive)) completeLegionQuest();
  }
  const present = state.enemies.find((e) => e.isNemesis);
  if (present) {
    const w = present.warlordRef;
    if (w) {
      if (w.scouted < 1 && present.hp <= present.maxHp * 0.7) {
        w.scouted = 1;
        log(`You take ${w.name}'s measure: ${WL_STRENGTHS[w.strength]}.`, 'quest');
      }
      if (w.scouted < 2 && present.hp <= present.maxHp * 0.4) {
        w.scouted = 2;
        log(`${w.name}'s weakness is laid bare: ${WL_WEAKNESS[w.weakness]}!`, 'quest');
      }
      if (present.regen && present.hp > 0 && present.hp < present.maxHp && state.time % 30 === 0)
        present.hp = Math.min(present.maxHp, present.hp + present.regen);
    }
    const pp = state.player;
    const ptx = Math.floor((pp.x + pp.w / 2) / TILE),
      pty = Math.floor((pp.y + pp.h / 2) / TILE);
    if (rectDist(pp, present) > 840 || isInTown(ptx, pty)) {
      const i = state.enemies.indexOf(present);
      if (i >= 0) {
        state.enemies.splice(i, 1);
        log(`${present.name} loses your trail — but the hunt is far from over.`, 'lore');
      }
    }
    return;
  }
  // FINALE (v2.36.5): entering the seat region with the war at its end summons the Overlord IMMEDIATELY —
  // no ambush timer, no roll, and no captain squatting the region can hijack the duel.
  {
    const lq = state.quests.legion;
    if (lq && lq.stage === 'overlord' && L.overlord && L.overlord.alive) {
      const p0 = state.player;
      const reg0 = regionOf(Math.floor((p0.x + p0.w / 2) / TILE), Math.floor((p0.y + p0.h / 2) / TILE));
      if (reg0 === L.overlord.region) {
        if (spawnWarlord(L.overlord))
          log('The ground trembles — the DREAD OVERLORD rises to defend its seat!', 'combat');
        return;
      }
    }
  }
  state.legionTimer = (state.legionTimer || 300) - 1;
  if (state.legionTimer > 0 || state.player.level < 5) return;
  state.legionTimer = isNight() ? 360 : 780;
  const p = state.player;
  const ptx = Math.floor((p.x + p.w / 2) / TILE),
    pty = Math.floor((p.y + p.h / 2) / TILE);
  const pdf = distFactor(ptx, pty);
  if (pdf < WL_MIN_DF) return;
  /* the Vale & Heartland are sanctuary — warlords stalk only the mid-outer lands, never near home */ const reg =
    regionOf(ptx, pty);
  let target = L.warlords.find((w) => w.alive && w.region === reg);
  const finale = state.quests.legion && state.quests.legion.stage === 'overlord';
  if (
    !target &&
    (facTierIdx('dread') >= 3 || finale) &&
    L.overlord &&
    L.overlord.alive &&
    reg === L.overlord.region
  )
    target = L.overlord;
  if (!target) return;
  let chance =
    (isNight() ? 0.5 : 0.12) +
    (pdf - WL_MIN_DF) * 0.5 +
    (state.factions.dread || 0) * 0.004 +
    target.grudge * 0.07;
  if (finale && target === L.overlord) chance = 0.95;
  if (state.flags.legionBroken) chance *= 0.4;
  if (Math.random() < chance) spawnWarlord(target);
}
function defeatNemesis(e) {
  const w = e.warlordRef;
  const L = state.legion;
  if (!w || !L) return;
  const reward = Math.round((160 + w.rank * 120) * (1 + w.level * 0.15));
  state.player.gold += reward;
  L.kills = (L.kills || 0) + 1;
  if (w.rank < 3 && Math.random() < 0.2) {
    w.grudge++;
    w.scouted = Math.max(w.scouted, 1);
    log(
      `★ You cut down ${w.name} — but it drags itself away, scarred. It WILL return for vengeance. +${reward} gold.`,
      'quest',
    );
  } else {
    w.alive = false;
    log(
      `★ ${w.name}, ${RANK_NAMES[w.rank]} of ${REGION_NAMES[w.region]}, is slain! +${reward} gold.`,
      'quest',
    );
    if (w.rank >= 3) {
      addRep('vigil', 15);
      if (!state.legionRespawnDay) state.legionRespawnDay = curDay() + 4;
      log('The Overlord has fallen — the Dread Legion is leaderless.', 'lore');
      if (state.quests.legion && state.quests.legion.stage === 'overlord') completeLegionQuest();
      else log('A new terror will rise.', 'lore');
    }
    if (w !== L.overlord) {
      const sub = L.warlords
        .filter((x) => x.alive && x !== w && x.rank < 2)
        .sort((a, b) => b.level - a.level)[0];
      if (sub) {
        sub.rank = Math.min(2, sub.rank + 1);
        sub.region = w.region;
        sub.level += 1;
        log(`${sub.name} seizes ${REGION_NAMES[w.region]} and rises to ${RANK_NAMES[sub.rank]}.`, 'combat');
      }
    }
  }
  Sound.levelup();
  addShake(8);
  saveGame();
}
function nemesisGrows() {
  const L = state.legion;
  if (!L) return;
  let w = (state.enemies.find((e) => e.isNemesis) || {}).warlordRef;
  if (!w) {
    const alive = L.warlords.filter((x) => x.alive);
    w = alive.sort((a, b) => b.grudge - a.grudge)[0];
  }
  if (!w) return;
  w.grudge++;
  w.level += 2;
  if (w.rank < 2) w.rank++;
  if (Math.random() < 0.4) {
    w.strength = NEM_PICK(Object.keys(WL_STRENGTHS));
    w.scouted = 0;
  }
  log(
    `☠ ${w.name} grows mightier from your fall — now a Lv ${w.level} ${RANK_NAMES[w.rank]}, and it remembers your face.`,
    'combat',
  );
}
// --- Domination: break a weakened warlord's will and bind it as a thrall ---
function isOverlordWarlord(w) {
  return !!(w && state.legion && (w === state.legion.overlord || w.rank >= 3));
} // the Overlord must DIE to finish the questline — never bindable
function canDominate(e) {
  if (!e || e.hp <= 0 || !state.player.abilities.dominate || e.hp > e.maxHp * 0.25) return false;
  if (isOverlordWarlord(e.warlordRef)) return false;
  const p = state.player;
  if (e.isNemesis && e.warlordRef) return p.abilityCd.dominate <= 0;
  if (!(e.elite && !e.isBoss && !e.isNemesis && !e.isGreatBeast)) return false;
  if (p.abilityCd.dominate > 0) return false;
  if (p.energy < 35) return false;
  if (
    state.allies.filter((a) => a.bound && (!a._owner || a._owner === state.player.id)).length >=
    2 + (state.player.uBell ? 1 : 0)
  )
    return false;
  return true;
} /* SHEPHERD'S BELL: +1 to the bound-thrall cap */
function dominate(e) {
  if (e.warlordRef) dominateWarlord(e);
  else dominateElite(e);
}
function dominateElite(e) {
  const p = state.player;
  if (p.cloaked || p._stillT) {
    p.cloaked = false;
    p._stillT = 0;
  }
  /* GRAVEWOOL: an ability breaks the cloak */ if (p.abilityCd.dominate > 0) {
    Sound.error && Sound.error();
    log(`Your will must recover before you bind again (${Math.ceil(p.abilityCd.dominate / 60)}s).`, 'combat');
    return;
  }
  if (p.energy < 35) {
    Sound.error && Sound.error();
    log('Not enough energy to dominate (needs 35).', 'combat');
    return;
  }
  if (
    state.allies.filter((a) => a.bound && (!a._owner || a._owner === state.player.id)).length >=
    2 + (state.player.uBell ? 1 : 0)
  ) {
    Sound.error && Sound.error();
    log(
      `You can bind only ${2 + (state.player.uBell ? 1 : 0)} elites at once \u2014 one must fall before you seize another.`,
      'combat',
    );
    return;
  }
  /* SHEPHERD'S BELL: +1 to the bound-thrall cap */ const i = state.enemies.indexOf(e);
  if (i >= 0) state.enemies.splice(i, 1);
  const hp = Math.round((e.maxHp || 60) * 0.7);
  state.allies.push({
    x: e.x,
    y: e.y,
    w: 22,
    h: 22,
    ally: true,
    bound: true,
    name:
      'Bound ' +
      (e.name || 'Elite').replace(/^(Shielded |Vampiric |Splitting |Warded )+/, '').replace(/^Elite /, ''),
    /* a bound thrall keeps NO affixes — mechanics (fresh whitelist object) and name both come out clean */ rank: 0,
    hp,
    maxHp: hp,
    atk: Math.max(6, Math.round((e.atk || 8) * 0.9)),
    def: e.def || 1,
    color: '#9a70ff',
    attackCd: 0,
    life: 1800,
    wobble: Math.random() * 6.28,
  });
  p.energy -= 35;
  p.abilityCd.dominate = 900;
  addRep('dread', 2);
  log(`\u2726 Your will seizes the ${e.name} \u2014 it fights for you now!`, 'quest');
  Sound.levelup && Sound.levelup();
  addShake(5);
  spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 16, { color: '#9a70ff', speed: 2.4, decay: 0.04 });
}
function dominateWarlord(e) {
  const w = e.warlordRef;
  if (!w) return;
  if (isOverlordWarlord(w)) {
    log("The Dread Overlord's will cannot be bound — it must be broken in battle.", 'lore');
    Sound.error && Sound.error();
    return;
  }
  if (state.player.abilityCd.dominate > 0) {
    Sound.error && Sound.error();
    log(
      `Your will must recover before you bind again (${Math.ceil(state.player.abilityCd.dominate / 60)}s).`,
      'combat',
    );
    return;
  }
  w.dominated = true;
  w.alive = true;
  w.grudge = 0;
  w.loyalty = 65;
  w.posted = false;
  w.raidT = 0;
  const i = state.enemies.indexOf(e);
  if (i >= 0) state.enemies.splice(i, 1);
  state.player.abilityCd.dominate = 900;
  addRep('dread', 5);
  log(
    `☠→★ You break ${w.name}'s will — the ${RANK_NAMES[w.rank]} is now your THRALL. Summon it to battle with [X].`,
    'quest',
  );
  Sound.levelup();
  addShake(6);
  spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 22, { color: '#70c0ff', speed: 2.6, decay: 0.04 });
  saveGame();
}
function thralls() {
  return legionRoster().filter((w) => w && w.dominated && w.alive);
}
function summonAlly(w) {
  const p = state.player;
  const hp = 90 + (w ? w.level * 12 + w.rank * 30 : 0);
  state.allies.push({
    x: p.x - 18 + Math.random() * 36,
    y: p.y + 10,
    w: 22,
    h: 22,
    ally: true,
    name: w ? w.name : 'Thrall',
    rank: w ? w.rank : 0,
    hp,
    maxHp: hp,
    atk: 10 + (w ? w.level * 2 + w.rank * 3 : 0),
    def: 2 + (w ? w.rank : 0),
    color: w && w.rank >= 2 ? '#5a9cff' : '#74b0ff',
    attackCd: 0,
    life: 2100,
    wobble: Math.random() * 6.28,
  });
}
function useSummon() {
  const p = state.player;
  if (p.cloaked || p._stillT) {
    p.cloaked = false;
    p._stillT = 0;
  }
  /* GRAVEWOOL: an ability breaks the cloak */ if (!p.abilities.summon) {
    log('Summon Thrall not unlocked yet — open Skills [K] in town.');
    return;
  }
  if (p.abilityCd.summon > 0) {
    Sound.error();
    log(`Your thralls must rest (${Math.ceil(p.abilityCd.summon / 60)}s).`, 'combat');
    return;
  }
  const t = thralls();
  if (!t.length) {
    log('You have no thralls. Bring a warlord below 25% HP, then press [E] to dominate it.', 'combat');
    Sound.error();
    return;
  }
  const avail = t.filter((w) => !w.posted && (w.raidT || 0) <= 0);
  if (!avail.length) {
    Sound.error();
    log('Your thralls are all posted as guards or away on raids.', 'combat');
    return;
  }
  if (p.energy < 40) {
    Sound.error();
    log('Not enough energy to summon.', 'combat');
    return;
  }
  p.energy -= 40;
  p.abilityCd.summon = 600;
  const _srk = abRank('summon') || 1;
  for (const w of avail.slice(0, Math.min(1 + _srk, avail.length))) summonAlly(w);
  Sound.cast();
  Sound.whirl();
  addShake(3);
  spawnBurst(p.x + p.w / 2, p.y + p.h / 2, 16, { color: '#70c0ff', speed: 2.2, decay: 0.04 });
  const nc = Math.min(1 + _srk, avail.length);
  log(`★ You call ${nc} thrall${nc > 1 ? 's' : ''} to your side!`, 'good');
  updateHUD();
}
function updateAllies() {
  if (!state.allies) state.allies = [];
  const p = state.player;
  const list = state.allies;
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    a.life--;
    if (a.life <= 0 || a.hp <= 0) {
      if (a.life <= 0 && state.player.uBell) {
        const _bx = a.x + a.w / 2,
          _by = a.y + a.h / 2,
          _br = 84,
          _bd = Math.max(1, Math.round((a.atk || 8) * 1.2));
        addShake(3);
        spawnBurst(_bx, _by, 16, { color: '#bfe9ff', speed: 2.8, decay: 0.045 });
        floatDamage(_bx, _by - 12, 'DETONATE', '#bfe9ff');
        Sound.tone && Sound.tone(300, 0.2, 'sawtooth', 0.12, { slideTo: 80 });
        for (const _e of [...state.enemies]) {
          if (_e.hp <= 0) continue;
          if (Math.hypot(_e.x + _e.w / 2 - _bx, _e.y + _e.h / 2 - _by) < _br) {
            const _dd = afxHit(_e, _bd);
            _e.hp -= _dd;
            if ((_e.hitFlash || 0) < 6) _e.hitFlash = 6;
            floatDamage(_e.x + _e.w / 2, _e.y, _dd, '#bfe9ff');
            _e.chillT = Math.max(_e.chillT || 0, _e.frostImmune ? 0 : 60);
            if (_e.hp <= 0) killEnemy(_e);
          }
        }
      }
      /* SHEPHERD'S BELL: a thrall that reaches the end of its life DETONATES a frost burst — damage routes through the one afxHit gate (warded/shielded elites respected); runs per-owner in MP with state.player=owner, so state.player.uBell is the owner's flag */ spawnBurst(
        a.x + a.w / 2,
        a.y + a.h / 2,
        10,
        { color: '#70c0ff', speed: 1.6, decay: 0.05 },
      );
      if (a.hp <= 0) log(`${a.name} is struck down in your service.`, 'combat');
      list.splice(i, 1);
      continue;
    }
    a.wobble += 0.09;
    let best = null,
      bd = 1e9;
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      const d = rectDist(a, e);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best && bd < 300) {
      stepToward(a, best.x + best.w / 2, best.y + best.h / 2, 1.35);
      if (bd < 32 && a.attackCd <= 0) {
        const dmg = Math.max(1, a.atk - (best.def || 0) + Math.floor(Math.random() * 3));
        best.hp -= afxHit(best, dmg);
        best.hitFlash = 6;
        floatDamage(best.x + best.w / 2, best.y, dmg, '#90c8ff');
        spawnBurst(best.x + best.w / 2, best.y + best.h / 2, 3, {
          color: '#90c8ff',
          speed: 1.5,
          decay: 0.08,
        });
        a.attackCd = 42;
        Sound.hit && Sound.hit();
        if (best.hp <= 0) killEnemy(best);
      }
    } // #3: still engage — a nearby foe pulls the ally in to fight
    else {
      const LEASH = 150;
      if (rectDist(a, p) > LEASH) {
        stepToward(a, p.x + p.w / 2, p.y + p.h / 2, 1.5);
      } // #3: only when they stray past a LOOSE leash do they amble back toward the owner
      else {
        if ((a.driftT = (a.driftT || 0) - 1) <= 0) {
          a.driftT = 90 + Math.floor(Math.random() * 120);
          a.wanderX = (Math.random() * 2 - 1) * 70;
          a.wanderY = (Math.random() * 2 - 1) * 70;
        }
        const tx = p.x + p.w / 2 + (a.wanderX || 0),
          ty = p.y + p.h / 2 + (a.wanderY || 0);
        if (Math.hypot(a.x + a.w / 2 - tx, a.y + a.h / 2 - ty) > 14)
          stepToward(a, tx + Math.sin(a.wobble) * 6, ty, 0.55);
      }
    } // #3: inside the leash they meander mindlessly around a slow, re-rolling drift offset — close-ish, never a strict follow
    for (const o2 of list) {
      if (o2 === a) continue;
      const ddx = a.x - o2.x,
        ddy = a.y - o2.y;
      const dd = Math.hypot(ddx, ddy);
      if (dd > 0.1 && dd < 20) {
        const nx2 = a.x + (ddx / dd) * 0.5,
          ny2 = a.y + (ddy / dd) * 0.5;
        if (canMoveTo(nx2, ny2, a.w, a.h)) {
          a.x = nx2;
          a.y = ny2;
        }
      }
    } // #3: ported warband separation — allies never stand inside each other (nudge respects walls)
    if (a.attackCd > 0) a.attackCd--;
  }
}
