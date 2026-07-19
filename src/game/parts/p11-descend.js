function descend() {
  // #121 — the Sunken Citadel descends on its own ladder (reuses state.dungeonLevel 1→4, so the MP
  // party-descend-together path works unchanged). No Delver's Insight / theme-cross lines here.
  if (state.citadel) {
    if (state.dungeonLevel >= 4) return; // no stairs exist on floor 4 anyway — belt & braces
    state.dungeonLevel++;
    setupCitadelFloor(state.dungeonLevel);
    Sound.descend();
    log(
      state.dungeonLevel === 4
        ? 'The stair ends. Ahead: a drowned hall, and something that has waited an age.'
        : `You descend deeper into the Sunken Citadel — tier ${state.dungeonLevel}.`,
      'lore',
    );
    updateHUD();
    return;
  }
  const prevTheme = dungeonTheme(state.dungeonLevel);
  const prevMax = state.player.maxDepth; /* P2/S12: player-carried — Delver's Insight pays each hero's OWN first visit */
  state.dungeonLevel++;
  state.player.maxDepth = Math.max(state.player.maxDepth, state.dungeonLevel);
  bountyProgress('depth');
  setupDungeonFloor(state.dungeonLevel);
  Sound.descend();
  if (state.dungeonLevel > prevMax) {
    const bx = 25 + state.dungeonLevel * 12;
    gainXP(bx);
    log(`⛏ Delver's insight — first time at Depth ${state.dungeonLevel}: +${bx} XP.`, 'good');
  }
  const th = dungeonTheme(state.dungeonLevel);
  if (th.key !== prevTheme.key)
    log(`You cross into ${th.name}. The very stone changes around you...`, 'lore');
  else log(`You descend to Depth ${state.dungeonLevel}. The air grows colder...`, 'lore');
  if ((state.dungeonLevel - 1) % 3 === 0) log('A passage back to the surface glimmers here (▲).', 'quest');
  if (state.dungeonLevel % 5 === 0) log('A Warden guards this floor — a mightier foe than most.', 'combat');
  updateHUD();
}
function exitDungeon() {
  resetFishing();
  if (state.citadel) state.citadel = 0; // #121 — clear the citadel flag ONLY if set (never create the key on a normal-delve exit — the golden's shape holds; the overworld gate persists regardless)
  const de = state.dungeonEntrance;
  state.player.x = de.tx * TILE;
  state.player.y = (de.ty - 1) * TILE;
  loadOverworld();
  /* position BEFORE loadOverworld — it anchors companions near the player (they were being left at dungeon-space coords, i.e. the far NW wilderness) */ Sound.startMusic(
    'overworld',
  );
  Sound.tone(330, 0.3, 'sine', 0.16, { slideTo: 660 });
  log('You climb back to the surface, into daylight.', 'lore');
  updateHUD();
  saveGame(false);
}

// ================= DIALOGUE =================
function startDialogue(npc) {
  state.scene = 'dialogue';
  const lines = npc.id === 'elder' ? elderLines() : [...npc.lines];
  __g.currentDialogue = { npc, lines, idx: 0 };
  document.getElementById('dialogue').style.display = 'block';
  showDialogueLine();
  if (npc.id === 'elder') {
    state.player.quests.talk.done = true;
    state.player.quests.main.started = true;
    state.player.quests.key.hidden = false;
    if (state.player.quests.legion && !state.player.quests.legion.started) {
      state.player.quests.legion.started = true;
      state.player.quests.legion.stage = 'camps';
    }
    updateQuests();
    saveGame();
  }
}
function showDialogueLine() {
  const d = __g.currentDialogue;
  document.getElementById('d-speaker').textContent = d.npc.name;
  document.getElementById('d-text').textContent = d.lines[d.idx];
}
function advanceDialogue() {
  const d = __g.currentDialogue;
  d.idx++;
  if (d.idx >= d.lines.length) endDialogue();
  else {
    Sound.blip();
    showDialogueLine();
  }
}
function endDialogue() {
  document.getElementById('dialogue').style.display = 'none';
  state.scene = 'play';
  __g.currentDialogue = null;
  __g.interactCd = 18;
}

// ================= COMBAT =================
function dirVec() {
  let dx = 0,
    dy = 0;
  if (keys['w'] || keys['arrowup']) dy = -1;
  else if (keys['s'] || keys['arrowdown']) dy = 1;
  if (keys['a'] || keys['arrowleft']) dx = -1;
  else if (keys['d'] || keys['arrowright']) dx = 1;
  if (dx !== 0 || dy !== 0) {
    const m = Math.hypot(dx, dy);
    return [dx / m, dy / m];
  }
  return { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[state.player.dir];
} // fire along your actual movement — diagonals included (v2.34.2)
function addProjectile(x, y, vx, vy, dmg, o) {
  o = o || {};
  state.projectiles.push({
    x,
    y,
    vx,
    vy,
    dmg,
    life: o.life || 160,
    r: o.r || 6,
    color: o.color || '#a060ff',
    friendly: !!o.friendly,
    pierce: o.pierce || 0,
    kind: o.kind || 'bolt',
    style: o.style || null,
    element: o.element || null,
    rico: !!o.rico,
    ownerRef: o.ownerRef || null,
    seek: o.seek || null,
    uLance: !!o.uLance,
    hits: o.friendly ? [] : null,
  });
} // uLance: Leviathan Spine stamps the fired arrow (projectile-stamped → MP-correct; the free lance itself never carries it, so no recursion)
// Per-element projectile feel: shock = fast & piercing, fire = slow & fat (explodes), frost/poison = mid & lobbed.
function projParams(el, style) {
  const magic = style === 'magic';
  const base = magic ? { spd: 3.4, r: 8, pierce: 1 } : { spd: 5, r: 5, pierce: 0 };
  if (el === 'shock') {
    base.spd *= 1.5;
    if (magic) base.pierce += 1;
    base.r = Math.max(4, base.r - 1);
  } else if (el === 'fire') {
    base.spd *= 0.88;
    base.r += 2;
    if (!magic) base.pierce = 0;
  } else if (el === 'frost') {
    base.spd *= 0.94;
    base.r += 1;
  } else if (el === 'poison') {
    base.spd *= 0.92;
    base.r += 1;
  }
  if (style === 'ranged' || style === 'magic') base.spd *= profSpeedMul(style);
  return base;
} // v2.39.0: magic ALWAYS pierces one foe (fire included); arrows never pierce (hit 1, but harder)
// #5: emit magic projectiles per w.pattern. No pattern → a single bolt (byte-identical to the old cast). Lives in
// the cast path (projParams is CAPTURE'd) so patterns work server-side/MP automatically.
function magicShot(p, w, d, ps, el, dmg, seek) {
  const px = p.x + p.w / 2,
    py = p.y + p.h / 2;
  const pat = w && w.pattern;
  const base = {
    friendly: true,
    kind: 'magic',
    color: el ? elemColor(el) : '#b070ff',
    r: ps.r,
    life: 130,
    pierce: ps.pierce,
    style: 'magic',
    element: el,
    seek: seek || null,
  };
  if (pat === 'twin') {
    const ang = Math.atan2(d[1], d[0]),
      nx = -Math.sin(ang),
      ny = Math.cos(ang),
      bd = Math.max(1, Math.round(dmg * 0.6));
    for (const s of [-1, 1])
      addProjectile(px + nx * 7 * s, py + ny * 7 * s, d[0] * ps.spd, d[1] * ps.spd, bd, { ...base });
  } // two parallel bolts, ~60% each
  else if (pat === 'trifan') {
    const b = Math.atan2(d[1], d[0]),
      bd = Math.max(1, Math.round(dmg * 0.45));
    for (const off of [-0.22, 0, 0.22]) {
      const a = b + off;
      addProjectile(px, py, Math.cos(a) * ps.spd, Math.sin(a) * ps.spd, bd, { ...base });
    }
  } // three-bolt fan, ~45% each
  else if (pat === 'lance') {
    addProjectile(px, py, d[0] * ps.spd * 0.7, d[1] * ps.spd * 0.7, Math.max(1, Math.round(dmg * 1.15)), {
      ...base,
      r: ps.r + 3,
      pierce: ps.pierce + 4,
      life: 170,
    });
  } // one slow, hard-piercing lance
  else addProjectile(px, py, d[0] * ps.spd, d[1] * ps.spd, Math.round(dmg), { ...base });
  if (w && w.element) {
    const HEAT_BY_PAT = { twin: 8, trifan: 11, lance: 3 };
    const powMul = 1 + (w.atk || 0) * 0.05;
    /* stronger staves ramp Heat FASTER (like magicCost scaling on w.atk) — a Legendary blazes its aura up in ~2 casts, a common one in ~6 */ p.heat =
      Math.min(100, (p.heat || 0) + (HEAT_BY_PAT[pat] || 5) * powMul);
    p._heatCool = 45;
    /* HEAT builds per cast, proportional to bolts fired × weapon power: trifan fan-staff is a Heat engine, the pierce lance a sipper. Only an ELEMENTAL staff heats — a plain staff has no Heat and no aura. */ if (
      !p.seenHeatTip && // per-hero (P2/S5): the CASTER's own tip flag — one mage's first aura no longer suppresses the teach for every other hero
      (p.heat || 0) >= HEAT_AURA_MIN
    ) {
      p.seenHeatTip = true;
      const _en = ((ELEMENTS[w.element] || {}).name || 'Arcane').toLowerCase(),
        _vb = { fire: 'burns', frost: 'chills', poison: 'poisons', shock: 'jolts' }[w.element] || 'sears';
      log(
        'Your ' + _en + ' staff is heating up — keep casting to blaze an aura that ' + _vb + ' nearby foes.',
        'lore',
      );
      saveGame();
    } /* one-time element-aware aura tip the first time Heat crosses the aura threshold */
  }
}
// Friendly elemental projectiles burst on death: fire = damaging blast, frost = chill nova, poison = lingering cloud.
function projImpact(pr) {
  if (!pr || !pr.friendly || !pr.element) return;
  const cx = pr.x,
    cy = pr.y,
    el = pr.element;
  if (el === 'fire') {
    Sound.tone(130, 0.16, 'sawtooth', 0.14, { slideTo: 50 });
    addShake(2);
    spawnBurst(cx, cy, 16, { color: '#ff8030', speed: 3.2, decay: 0.045 });
    spawnBurst(cx, cy, 8, { color: '#ffd060', speed: 1.8, decay: 0.06 });
    igniteTile(Math.floor(cx / TILE), Math.floor(cy / TILE));
    const aoe = Math.max(1, Math.round(pr.dmg * 0.5));
    for (const o of [...state.enemies]) {
      if (o.hp <= 0) continue;
      const ox = o.x + o.w / 2,
        oy = o.y + o.h / 2;
      if (Math.hypot(ox - cx, oy - cy) < 42) {
        const d = Math.max(1, aoe - Math.floor((o.def || 0) / 2));
        o.hp -= afxHit(o, d);
        if ((o.hitFlash || 0) < 5) o.hitFlash = 5;
        floatDamage(ox, o.y, d, '#ff9040');
        applyElementOnHit(o, 'fire', d);
        if (o.hp <= 0) killEnemy(o);
      }
    }
  } else if (el === 'poison') {
    spawnBurst(cx, cy, 12, { color: '#9be24a', speed: 1.6, up: 0.3, decay: 0.05 });
    for (const o of [...state.enemies]) {
      if (o.hp <= 0) continue;
      if (Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy) < 36) applyElementOnHit(o, 'poison', pr.dmg);
    }
  } else if (el === 'frost') {
    spawnBurst(cx, cy, 12, { color: '#a8e2ff', speed: 2, decay: 0.06 });
    for (const o of [...state.enemies]) {
      if (o.hp <= 0) continue;
      if (Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy) < 34) applyElementOnHit(o, 'frost', pr.dmg);
    }
  }
}
// Seeker Bolt (magic mastery tier 0, hasPerk('magic',0)): a LOS-gated SOFT seek, not an aimbot. At cast, seekTarget()
// picks the nearest LIVING foe with clear line of sight within range; the bolt still fires where you AIMED (dirVec is
// unchanged) and then BENDS toward that target in flight by a capped turn rate (steerSeek). Walls block target
// SELECTION, and a throttled in-flight LOS re-check drops a target that ducks behind cover — so your aim still matters
// and a hard-dodging / behind-you foe can be MISSED. (Was a full snap-to-nearest auto-aim that ignored walls and aim.)
function hasLineOfSight(x1, y1, x2, y2) {
  const dx = x2 - x1,
    dy = y2 - y1,
    dist = Math.hypot(dx, dy),
    steps = Math.max(1, Math.ceil(dist / (TILE * 0.5)));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (isSolidAt(x1 + dx * t, y1 + dy * t)) return false;
  }
  return true;
} // cheap raycast: sample in ~half-tile steps, solid tile between = blocked (endpoints skipped — shooter/target tiles)
function seekTarget() {
  const p = state.player,
    px = p.x + p.w / 2,
    py = p.y + p.h / 2;
  let best = null,
    bd = 1e9;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const d = rectDist(p, e);
    if (d < bd && d < 300 && hasLineOfSight(px, py, e.x + e.w / 2, e.y + e.h / 2)) {
      bd = d;
      best = e;
    }
  }
  return best;
} // nearest living foe within 300px WITH line of sight — a CAST-RATE scan; returns the enemy OBJECT (stamped as pr.seek; packScalar drops object fields → server-side only, never on the wire)
function steerSeek(pr) {
  const t = pr.seek;
  if (!t || t.hp <= 0) {
    pr.seek = null;
    return;
  }
  if (pr.life % 6 === 0 && !hasLineOfSight(pr.x, pr.y, t.x + t.w / 2, t.y + t.h / 2)) {
    pr.seek = null;
    return;
  }
  /* target dead or ducked behind a wall (LOS re-checked ~every 6 frames) → drop it and fly straight */ const spd =
      Math.hypot(pr.vx, pr.vy) || 1,
    cur = Math.atan2(pr.vy, pr.vx),
    want = Math.atan2(t.y + t.h / 2 - pr.y, t.x + t.w / 2 - pr.x);
  let dA = want - cur;
  while (dA > Math.PI) dA -= 2 * Math.PI;
  while (dA < -Math.PI) dA += 2 * Math.PI;
  const cap = 0.12;
  if (dA > cap) dA = cap;
  else if (dA < -cap) dA = -cap;
  const na = cur + dA;
  pr.vx = Math.cos(na) * spd;
  pr.vy = Math.sin(na) * spd;
} // O(1)/bolt/frame: capped ~0.12rad bend toward the target's CURRENT center, speed preserved (no per-frame enemy scan — target was chosen once at cast)
function tryAttack() {
  const p = state.player;
  if (p.attackCooldown > 0) return;
  if (p.stunT > 0) {
    Sound.error();
    log('You are stunned — you cannot act!', 'combat');
    p.attackCooldown = 10;
    return;
  } /* STUN locks out every basic attack (melee/ranged/magic) */
  const w = equippedWeapon();
  const s = styleOf(w);
  if (s === 'melee') {
    p.attackCooldown = weaponCd(w);
    p.attacking = 12;
    Sound.swing();
    meleeSwing();
    degrade(w, 0.12);
  } else if (s === 'ranged') {
    p.attackCooldown = weaponCd(w);
    p.attacking = 6;
    Sound.shoot();
    const d = dirVec();
    const el = w && w.element;
    const ps = projParams(el, 'ranged');
    if (hasPerk('ranged', 1)) {
      ps.spd *= 1.15;
      ps.pierce += 1;
    }
    addProjectile(
      p.x + p.w / 2,
      p.y + p.h / 2,
      d[0] * ps.spd,
      d[1] * ps.spd,
      Math.max(1, Math.round(p.atk * 1.0)),
      {
        friendly: true,
        kind: 'arrow',
        color: el ? elemColor(el) : '#e8d8a0',
        r: ps.r,
        life: 90,
        pierce: ps.pierce,
        style: 'ranged',
        element: el,
        uLance: !!p.uLance,
      },
    );
    if (hasPerk('ranged', 2) && Math.random() < 0.12) {
      const a = Math.atan2(d[1], d[0]) + 0.14;
      addProjectile(
        p.x + p.w / 2,
        p.y + p.h / 2,
        Math.cos(a) * ps.spd,
        Math.sin(a) * ps.spd,
        Math.max(1, Math.round(p.atk * 1.0)),
        {
          friendly: true,
          kind: 'arrow',
          color: el ? elemColor(el) : '#e8d8a0',
          r: ps.r,
          life: 90,
          pierce: ps.pierce,
          style: 'ranged',
          element: el,
          uLance: !!p.uLance,
        },
      );
    }
    degrade(w, 0.12);
  } else if (s === 'magic') {
    if (p.silenceT > 0) {
      Sound.error();
      log('Your voice is bound — no spell answers.', 'combat');
      p.attackCooldown = 10;
      return;
    } /* SILENCE binds the magic BASIC attack (owner: a silenced caster is reduced to running/melee) — melee/ranged basics above stay usable */
    const cost = magicCost();
    if (p.energy < cost) {
      Sound.error();
      log('Your magic fizzles — not enough energy.', 'combat');
      p.attackCooldown = 10;
      return;
    }
    p.energy -= cost;
    p.attackCooldown = magicCd();
    p.attacking = 8;
    Sound.cast();
    let d = dirVec();
    const seek = hasPerk('magic', 0) ? seekTarget() : null;
    /* Seeker Bolt: aim (dirVec) is UNCHANGED — the bolt fires where you aimed and merely bends toward a LOS-visible foe in flight */ const el =
      w && w.element;
    const ps = projParams(el, 'magic');
    magicShot(p, w, d, ps, el, p.atk * 1.4, seek);
    degrade(w, 0.12);
    updateHUD();
  }
}
function castSpell() {
  const p = state.player;
  if (p.attackCooldown > 0) return;
  if (p.silenceT > 0) {
    Sound.error();
    log('Your voice is bound — nothing answers.', 'combat');
    p.attackCooldown = 10;
    return;
  } /* SILENCE blocks ALL spellcasting (F is a spell for every style) */
  if (p.stunT > 0) {
    Sound.error();
    log('You are stunned — you cannot act!', 'combat');
    p.attackCooldown = 10;
    return;
  }
  const w = equippedWeapon();
  const staff = styleOf(w) === 'magic';
  const cost = staff ? magicCost() : weakCastCost();
  if (p.energy < cost) {
    Sound.error();
    log('Your spell sputters — not enough energy.', 'combat');
    p.attackCooldown = 10;
    return;
  }
  p.energy -= cost;
  p.attacking = 8;
  Sound.cast();
  let d = dirVec();
  if (staff) {
    p.attackCooldown = magicCd();
    const seek = hasPerk('magic', 0) ? seekTarget() : null;
    /* Seeker Bolt: aim UNCHANGED — soft in-flight bend toward a LOS-visible foe, not a snap */ const el =
      w && w.element;
    const ps = projParams(el, 'magic');
    magicShot(p, w, d, ps, el, p.atk * 1.4, seek);
    degrade(w, 0.12);
  } else {
    p.attackCooldown = Math.max(20, Math.round(34 * hasteMul()));
    const dmg = Math.max(1, Math.round(p.atk * 0.1));
    addProjectile(p.x + p.w / 2, p.y + p.h / 2, d[0] * 3.0, d[1] * 3.0, dmg, {
      friendly: true,
      kind: 'magic',
      color: '#6a5a90',
      r: 5,
      life: 90,
      pierce: 0,
      style: 'magic',
    });
    log('Without a staff, your magic barely flickers.', 'combat');
  }
  updateHUD();
}
// ================= COMBAT 2.0: dodge, stamina, hit-stop, crit/lifesteal/berserk =================
__g.hitStop = 0;
function doDodge() {
  const p = state.player;
  if (p.dragon.mounted || p.dodge > 0 || p.dodgeCd > 0 || p.camping || p.stunT > 0) return; // STUN refuses a new dodge (silent, like the mounted/camping refusals); SILENCE leaves the dodge — mobility, not a spell
  const cost = Math.max(18, 34 - (p.bonusEvasion || 0) * 2);
  if (p.stamina < cost) {
    Sound.error();
    return;
  }
  let dx = 0,
    dy = 0;
  if (keys['w'] || keys['arrowup']) dy = -1;
  else if (keys['s'] || keys['arrowdown']) dy = 1;
  if (keys['a'] || keys['arrowleft']) dx = -1;
  else if (keys['d'] || keys['arrowright']) dx = 1;
  if (dx === 0 && dy === 0) {
    const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[p.dir];
    dx = v[0];
    dy = v[1];
  }
  const mag = Math.hypot(dx, dy) || 1;
  p.dvx = (dx / mag) * 5.6;
  p.dvy = (dy / mag) * 5.6;
  p.dodge = 13;
  p.dodgeCd = 24;
  p.dodgeHits = [];
  p.invuln = Math.max(p.invuln, 15 + (p.bonusEvasion || 0) * 2);
  p.stamina -= cost;
  updateStaminaBar();
  Sound.tone(360, 0.16, 'sine', 0.12, { slideTo: 660 });
  spawnBurst(p.x + p.w / 2, p.y + p.h / 2, 7, { color: '#cfe6ff', speed: 1.5, decay: 0.07 });
}
function playerDmgMul() {
  const p = state.player;
  return (
    1 +
    (p.berserk > 0 ? p.berserk * (1 - p.hp / p.maxHp) : 0) +
    0.03 * (p.momentum || 0) +
    (p._surgeT > 0 ? 0.25 * (p._surgeN || 0) : 0)
  );
} // MOMENTUM folds in here: each melee pip +3% dmg (0 for ranged/magic — they never build it), so ALL player damage keeps one multiplier. #121 Emberheart Locket: +25%/kill-surge stack (all styles) folds in the SAME multiplier.
function execMul(e) {
  const p = state.player;
  return p.exec > 0 && e && e.maxHp && e.hp / e.maxHp < 0.3 ? 1 + p.exec : 1;
}
function applyLifesteal(e, dmg) {
  const p = state.player;
  if (p.lifesteal > 0 && dmg > 0) {
    let heal = Math.round(dmg * p.lifesteal * (e && e.isBoss ? 0.25 : 1));
    heal = Math.min(heal, Math.round(p.maxHp * 0.06));
    if (heal > 0) p.hp = Math.min(p.maxHp, p.hp + heal);
  }
}
// ============ STYLE IDENTITY (Pillar 1): Momentum / Quarry Marks / Heat ============
// HEAT amplification: a magic user's OWN elemental side-effects scale 0→1 with heat (0 for melee/ranged — they have no heat).
function heatAmp() {
  const p = state.player;
  return styleOf(equippedWeapon()) === 'magic' ? Math.max(0, Math.min(1, (p.heat || 0) / 100)) : 0;
}
// P3/S10: the heat-aura threshold + throttle are ability knobs in src/content/tables.ts; positional aliases.
const HEAT_AURA_MIN = CONTENT.tables.abilities.heatAuraMin,
  HEAT_AURA_TICKS = CONTENT.tables.abilities.heatAuraTicks; // an elemental staff radiates its aura past 40 Heat; the nearby-foe scan is throttled to every 16 frames
// Per-frame per-player style bookkeeping — runs INSIDE updatePlayer so the MP server inherits it. O(1) except the THROTTLED+GATED aura scan.
function updateStyleResources() {
  const p = state.player;
  const w = equippedWeapon(),
    st = styleOf(w);
  if (p._lastStyle !== st) {
    p._lastStyle = st;
    p.momentum = 0;
    p.riposteT = 0;
    p.heat = 0;
    p._momoDecay = 0;
    p._heatCool = 0;
    p._auraCd = 0;
    p._auraEl = 0;
    p._lastMarkN = 0;
    p._markShowT = 0;
  } // weapon-style swap (or load) → reset the other styles' transients
  if (p.riposteT > 0) p.riposteT--;
  /* #121 CITADEL RELIC transients (recalcStats-derived flags, no gear read):
     · Emberheart Locket surge decays (clears the stack at 0).
     · Sunderking's Edge: at 5 Momentum the riposte window never closes → every hit a guaranteed crit
       (meleeSwing consumes riposteT). Bleed a pip (Momentum<5) and it shuts.
     · Chainbreaker Coil: Heat never falls below the aura threshold (40) while a magic weapon is held. */
  if (p._surgeT > 0) {
    p._surgeT--;
    if (p._surgeT <= 0) p._surgeN = 0;
  }
  if (p.uEdge && (p.momentum || 0) >= 5) p.riposteT = Math.max(p.riposteT || 0, 2);
  if (p.uCoil && st === 'magic') p.heat = Math.max(p.heat || 0, 40);
  if (st === 'melee') {
    if (p.momentum > 0) {
      p._momoDecay = (p._momoDecay || 0) + 1;
      if (p._momoDecay >= 150) {
        p.momentum--;
        p._momoDecay = 0;
      }
    }
  } else if (p.momentum) {
    p.momentum = 0;
  } // MOMENTUM idle decay: lose 1 pip / ~2.5s without a landed hit
  if (st === 'magic') {
    if (p._heatCool > 0) p._heatCool--;
    else if (p.heat > 0) p.heat = Math.max(0, p.heat - 0.8);
  } else {
    if (p.heat) p.heat = 0;
    p._heatCool = 0;
  } // HEAT passive cool: ~0.75s after your last cast, then 0.8/frame — the aura fades a beat after you stop casting
  if (st === 'ranged') {
    if (p._markShowT > 0) {
      p._markShowT--;
      if (p._markShowT <= 0) p._lastMarkN = 0;
    }
  } else if (p._lastMarkN) {
    p._lastMarkN = 0;
    p._markShowT = 0;
  } // marks HUD mirror fades ~3s after your last marking hit
  const el = st === 'magic' && w && w.element ? w.element : 0;
  p._auraEl = el && (p.heat || 0) >= HEAT_AURA_MIN ? el : 0; // teammate-visible aura flag (rides lightPlayer): the element you're radiating, else 0
  if (el && (p.heat || 0) >= HEAT_AURA_MIN) updateHeatAura(p, el);
  else p._auraCd = 0; // GATE: only an elemental staff past the threshold runs the aura scan
}
// HEAT AURA (magic, passive): a heated ELEMENTAL staff radiates a "don't-touch-me" field — nearby foes periodically take the staff's
// element (all damage/status routed through applyElementOnHit + the afxHit gate, so warded/shielded elites are respected). Radius &
// tick damage SCALE with Heat. THROTTLED via the per-player _auraCd counter — kill-rate, not a per-frame scan, no per-frame allocation.
const AURA_ELEM_OPT = { noIgnite: true }; // hoisted: the aura must never light the ground under its own caster, and a per-hit object literal would allocate inside the scan
