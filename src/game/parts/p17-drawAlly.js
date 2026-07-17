function drawAlly(a) {
  const sx = a.x - state.camera.x,
    sy = a.y - state.camera.y;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(sx + a.w / 2, sy + a.h + 1, a.w / 2, 3, 0, 0, 6.28);
  ctx.fill();
  const fl = Math.sin(a.wobble) * 1.5;
  ctx.fillStyle = a.color;
  ctx.fillRect(sx + 4, sy + 8 + fl, a.w - 8, a.h - 8);
  ctx.fillStyle = '#dfeaff';
  ctx.fillRect(sx + 5, sy + fl, a.w - 10, 10);
  ctx.fillStyle = '#102038';
  ctx.fillRect(sx + 8, sy + 3 + fl, 2, 2);
  ctx.fillRect(sx + a.w - 10, sy + 3 + fl, 2, 2);
  const aura = Math.sin(Date.now() / 240) * 0.3 + 0.5;
  ctx.strokeStyle = `rgba(112,176,255,${aura * 0.7})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(sx + a.w / 2, sy + a.h / 2, a.w * 0.7, 0, 6.28);
  ctx.stroke();
  if (a.hp < a.maxHp) {
    ctx.fillStyle = '#000';
    ctx.fillRect(sx - 1, sy - 6, a.w + 2, 4);
    ctx.fillStyle = '#5aa0ff';
    ctx.fillRect(sx, sy - 5, a.w * (a.hp / a.maxHp), 2);
  }
  ctx.fillStyle = '#a8c8ff';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('✦' + a.name.split(' ')[0], sx + a.w / 2, sy - 9);
  ctx.textAlign = 'left';
}
// ================= WARBAND COMMAND — manage your thralls =================
function promoteCost(w) {
  return 80 + w.level * 30 + w.rank * 60;
}
function promoteThrall(w) {
  const c = promoteCost(w);
  if (state.player.gold < c) {
    Sound.error();
    log('Not enough gold to promote.', 'combat');
    return;
  }
  state.player.gold -= c;
  w.level += 1;
  w.loyalty = Math.min(100, (w.loyalty || 50) + 6);
  Sound.levelup();
  log(`${w.name} grows in power — now a Lv ${w.level} ${RANK_NAMES[w.rank]}. Loyalty rises.`, 'good');
  updateHUD();
  renderLegion();
  saveGame();
}
function postedCount() {
  return legionRoster().filter((w) => w && w.dominated && w.posted).length;
}
function togglePost(w) {
  if (w.posted) {
    w.posted = false;
    const i = state.allies.findIndex((a) => a.bodyguardOf === w.id);
    if (i >= 0) state.allies.splice(i, 1);
    log(`${w.name} stands down from your guard.`, 'lore');
  } else {
    if (postedCount() >= 2) {
      Sound.error();
      log('You can field at most 2 bodyguards at once.', 'combat');
      return;
    }
    if ((w.raidT || 0) > 0) {
      Sound.error();
      log(`${w.name} is away on a raid.`, 'combat');
      return;
    }
    w.posted = true;
    log(`${w.name} now marches at your side as a bodyguard.`, 'good');
    ensureBodyguards();
  }
  renderLegion();
  saveGame();
}
function sendRaid(w) {
  if (w.posted) {
    Sound.error();
    log(`Recall ${w.name} from your guard first.`, 'combat');
    return;
  }
  if ((w.raidT || 0) > 0) {
    Sound.error();
    return;
  }
  w.raidT = 3600;
  log(`${w.name} sets out to raid the Dread Legion's holdings — they will return in a day or so.`, 'quest');
  Sound.descend && Sound.descend();
  renderLegion();
  saveGame();
}
function resolveRaid(w) {
  w.raidT = 0;
  const r = Math.random();
  const base = 120 + w.level * 25 + w.rank * 60;
  if (r < 0.18) {
    w.loyalty = Math.max(0, (w.loyalty || 50) - 12);
    log(`✖ ${w.name} returns from the raid wounded and empty-handed — loyalty wavers.`, 'combat');
  } else {
    const great = r > 0.8;
    const gold = Math.round(base * (great ? 2 : 1));
    state.player.gold += gold;
    w.loyalty = Math.min(100, (w.loyalty || 50) + 5);
    let msg = `★ ${w.name} returns from the raid bearing ${gold} gold`;
    if (great) {
      const rIdx = Math.min(4, 2 + Math.floor(Math.random() * 2));
      const it =
        Math.random() < 0.5
          ? { weapon: genWeapon(state.player.level + 2, rIdx) }
          : { armor: genArmor(state.player.level + 2, rIdx) };
      if (it.weapon) {
        normItem(it.weapon, true);
        state.inventory.weapons.push(it.weapon);
      }
      if (it.armor) {
        normItem(it.armor, false);
        state.inventory.armor.push(it.armor);
      }
      msg += ' and plundered gear (check [I])';
    }
    log(msg + '!', 'quest');
  }
  addRepParty('dread', 2); // P2/S11: a thrall raiding under the party's banner is party news (updateWarband is a shared-phase system — nobody is "acting")
  Sound.jingle();
  updateHUD();
}
function ensureBodyguards() {
  if (!state.allies) state.allies = [];
  for (const w of legionRoster()) {
    if (!w || !w.dominated || !w.alive || !w.posted || (w.raidT || 0) > 0) continue;
    if (state.allies.some((a) => a.bodyguardOf === w.id)) continue;
    const p = state.player;
    const hp = 110 + w.level * 14 + w.rank * 30;
    state.allies.push({
      x: p.x - 18,
      y: p.y + 12,
      w: 24,
      h: 24,
      ally: true,
      bodyguardOf: w.id,
      name: w.name,
      rank: w.rank,
      hp,
      maxHp: hp,
      atk: 12 + w.level * 2 + w.rank * 3,
      def: 3 + w.rank,
      color: '#5a9cff',
      attackCd: 0,
      life: 1e9,
      wobble: Math.random() * 6.28,
    });
  }
}
function updateWarband() {
  const L = state.legion;
  if (!L) return;
  for (const w of legionRoster()) {
    if (w && w.dominated && w.alive && (w.raidT || 0) > 0) {
      w.raidT--;
      if (w.raidT <= 0) resolveRaid(w);
    }
  }
  ensureBodyguards();
}

// ================= ELEMENTS & STATUS EFFECTS =================
// P3/S1: the rows live in src/content/elements.ts — the compiled content chunk (prepended
// to this program by scripts/build.mjs) assigns globalThis.CONTENT before any part runs.
// Positional lexical alias: same binding, same declaration position, zero call-site churn.
const ELEMENTS = CONTENT.elements;
let arcs = [];
function elemColor(el) {
  return (ELEMENTS[el] || {}).color || '#c0c0d0';
}
function elemRgb(el) {
  return (ELEMENTS[el] || {}).rgb || '192,192,208';
} // "r,g,b" for rgba() aura glows (Heat pulsate)
function elemHtml(el) {
  const E = ELEMENTS[el];
  return E ? ` <span style="color:${E.color}">${E.tag}${E.name}</span>` : '';
}
function isUndead(e) {
  return e.type === 'skeleton' || e.type === 'archer';
}
function statusDamage(e, dmg, color) {
  e.hp -= afxHit(e, dmg);
  if (e.hitFlash < 3) e.hitFlash = 3;
  floatDamage(e.x + e.w / 2, e.y, dmg, color);
  if (e.hp <= 0) {
    killEnemy(e);
    return true;
  }
  return false;
}
function spawnArc(a, b) {
  arcs.push({ x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2, life: 1 });
  if (arcs.length > 50) arcs.shift();
}
function applyElementOnHit(e, el, baseDmg, opt) {
  if (!el || !e || e.hp <= 0) return;
  const f = e.isBoss ? 0.5 : 1;
  const hot =
    heatAmp(); /* HEAT amplifies a magic user's OWN elemental side-effects: bigger burn spread, deeper chill, an extra shock chain (0 for melee/ranged). opt.noIgnite (passed ONLY by the passive Heat aura) keeps a source from lighting the ground: an aura foe stands 1-3 tiles away, i.e. INSIDE the caster's own field, so its burning tile used to cook the caster himself. A direct fire CAST has no opt and still ignites — that's a deliberate play at range. */
  if (el === 'fire') {
    if (e.fireImmune) return;
    e.burnT = Math.max(e.burnT || 0, Math.round(90 * f * (1 + 0.6 * hot)));
    e.burnDmg = Math.max(1, Math.round(baseDmg * 0.18 * (1 + 0.35 * hot) * weakMul(e, 'fire')));
    if (opt && opt.noIgnite) {
      e._burnNoSpread = 1;
    } else {
      if (e._burnNoSpread) e._burnNoSpread = 0;
      if (Math.random() < 0.5 + 0.4 * hot)
        igniteTile(Math.floor((e.x + e.w / 2) / TILE), Math.floor((e.y + e.h / 2) / TILE));
    }
  } /* _burnNoSpread closes the SECOND self-immolation route: the burn this applies would otherwise let tickEnemyStatus spread fire from the foe back under the caster. A later direct cast on the same foe clears the flag (it re-enters this else-branch), so only aura-lit burns stay inert. The flag is only ever CREATED by the aura branch — packScalar sweeps every scalar onto the wire, so cast-only foes must not grow a new per-enemy field. */
  else if (el === 'poison') {
    if (isUndead(e)) return;
    e.poisonT = Math.max(e.poisonT || 0, Math.round(132 * f * (1 + 0.5 * hot)));
    e.poisonDmg = Math.max(1, Math.round(baseDmg * 0.13 * weakMul(e, 'poison')));
  } else if (el === 'frost') {
    if (e.frostImmune) return;
    e.chillT = Math.max(e.chillT || 0, Math.round(130 * f * (1 + 0.6 * hot)));
    if (!e.isBoss && Math.random() < 0.16 + 0.24 * hot) e.stunT = Math.max(e.stunT || 0, 28);
  } else if (el === 'shock') {
    if (!e.isBoss) e.stunT = Math.max(e.stunT || 0, 14);
    const arc = Math.max(1, Math.round(baseDmg * 0.5));
    const maxArc = 2 + (hot >= 0.66 ? 1 : 0);
    let hits = 0;
    for (const o of [...state.enemies]) {
      if (o === e || hits >= maxArc || o.hp <= 0) continue;
      if (rectDist(e, o) < 76 + 30 * hot) {
        spawnArc(e, o);
        o.hp -= afxHit(o, arc);
        if (o.hitFlash < 4) o.hitFlash = 4;
        floatDamage(o.x + o.w / 2, o.y, arc, '#ffe24a');
        if (!o.isBoss) o.stunT = Math.max(o.stunT || 0, 10);
        if (o.hp <= 0) killEnemy(o);
        hits++;
      }
    }
  }
}
function tickEnemyStatus(e) {
  if (e.burnT > 0) {
    if (e.burnT % 18 === 0 && statusDamage(e, e.burnDmg, '#ff8030')) return true;
    e.burnT--;
  }
  if (e.poisonT > 0) {
    if (e.poisonT % 22 === 0 && statusDamage(e, e.poisonDmg, '#9be24a')) return true;
    e.poisonT--;
  }
  if (e.chillT > 0) e.chillT--;
  if ((e.burnT > 0 || e.poisonT > 0 || e.chillT > 0) && Math.random() < 0.28) {
    const c = e.burnT > 0 ? '#ff9040' : e.poisonT > 0 ? '#9be24a' : '#a0d8ff';
    spawnBurst(e.x + e.w / 2, e.y + Math.random() * e.h - 2, 1, {
      color: c,
      speed: 0.4,
      up: 0.9,
      decay: 0.06,
      size: 2,
    });
  }
  if (e.burnT > 0 && !e._burnNoSpread && state.map === 'overworld' && Math.random() < 0.035)
    igniteTile(Math.floor((e.x + e.w / 2) / TILE), Math.floor((e.y + e.h / 2) / TILE));
  return false;
} /* _burnNoSpread: a burn lit by the passive Heat aura never spreads fire — the foe is inside the caster's own field, so this roll used to set the CASTER's ground alight. Cast-applied burns (flag 0/absent) spread exactly as before. */
function drawArcs(camX, camY) {
  ctx.lineWidth = 2;
  for (const a of arcs) {
    ctx.strokeStyle = `rgba(255,236,90,${Math.max(0, a.life)})`;
    const x1 = a.x1 - camX,
      y1 = a.y1 - camY,
      x2 = a.x2 - camX,
      y2 = a.y2 - camY;
    const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * 12,
      my = (y1 + y2) / 2 + (Math.random() - 0.5) * 12;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(mx, my);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

// --- enemy AI helpers ---
function stepToward(e, tx, ty, spd) {
  if (e.chillT > 0) spd *= 0.45;
  let mx = tx - (e.x + e.w / 2),
    my = ty - (e.y + e.h / 2);
  const mag = Math.hypot(mx, my) || 1;
  mx /= mag;
  my /= mag;
  const nx = e.x + mx * spd,
    ny = e.y + my * spd;
  const mv = e.aquatic ? canSailTo : canMoveTo;
  if (mv(nx, e.y, e.w, e.h)) e.x = nx;
  if (mv(e.x, ny, e.w, e.h)) e.y = ny;
}
function healAlly(e) {
  const ecx = e.x + e.w / 2,
    ecy = e.y + e.h / 2;
  let best = null,
    bestMiss = 4;
  for (const o of state.enemies) {
    if (o === e || o.isBoss || o.hp >= o.maxHp) continue;
    const miss = o.maxHp - o.hp;
    if (miss > bestMiss && Math.hypot(o.x + o.w / 2 - ecx, o.y + o.h / 2 - ecy) < 240) {
      best = o;
      bestMiss = miss;
    }
  }
  if (!best && e.hp < e.maxHp) best = e;
  if (best) {
    best.hp = Math.min(best.maxHp, best.hp + Math.round(best.maxHp * 0.22) + 3);
    spawnBurst(best.x + best.w / 2, best.y + best.h / 2, 10, {
      color: '#70ffb0',
      speed: 1.3,
      up: 0.7,
      decay: 0.045,
    });
    Sound.tone(620, 0.16, 'sine', 0.07, { slideTo: 900 });
  }
}
function updateCharger(e, dist, pcx, pcy) {
  const ecx = e.x + e.w / 2,
    ecy = e.y + e.h / 2;
  if (e.chargeState === 2) {
    let moved = false;
    const cf = e.chillT > 0 ? 0.5 : 1;
    const nx = e.x + e.dvx * cf,
      ny = e.y + e.dvy * cf;
    if (canMoveTo(nx, e.y, e.w, e.h)) {
      e.x = nx;
      moved = true;
    }
    if (canMoveTo(e.x, ny, e.w, e.h)) {
      e.y = ny;
      moved = true;
    }
    if (dist < 32 && e.attackCd <= 0) {
      enemyStrike(e, Math.round(e.atk * 1.3));
      e.attackCd = 30;
    }
    e.chargeT--;
    if (e.chargeT <= 0 || !moved) {
      e.chargeState = 0;
      e.chargeCd = 70 + Math.floor(Math.random() * 60);
    }
  } else if (e.chargeState === 1) {
    e.chargeT--;
    if (e.chargeT <= 0) {
      const ang = Math.atan2(pcy - ecy, pcx - ecx);
      e.dvx = Math.cos(ang) * 4.4;
      e.dvy = Math.sin(ang) * 4.4;
      e.chargeState = 2;
      e.chargeT = 34;
      Sound.swing();
    }
  } else {
    if (e.chargeCd > 0) e.chargeCd--;
    if (dist < 220 && dist > 44 && e.chargeCd <= 0) {
      e.chargeState = 1;
      e.chargeT = 24;
    } else {
      stepToward(e, pcx, pcy, e.speed * 0.9);
      if (dist < 28 && e.attackCd <= 0) {
        enemyStrike(e, e.atk);
        e.attackCd = 45;
      }
    }
  }
}
function bossSpecials(level, color) {
  /* P3/S4: the pick table is CONTENT.specialRoster (data); the BRANCHING stays here (the S2
     precedent). slice() copies the registry's base array so a boss never mutates a row. */
  const R = CONTENT.specialRoster;
  const s = R.base.slice();
  s.push(color === R.redColor ? R.redAdd : R.elseAdd);
  if (level >= R.summonLevel) s.push(R.summonAdd);
  return s;
}
function spawnRing(x, y, color) {
  for (let k = 0; k < 30; k++) {
    if (particles.length >= 260) particles.shift();
    const a = (k / 30) * 6.28;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * 4.5,
      vy: Math.sin(a) * 4.5,
      life: 1,
      decay: 0.05,
      color,
      size: 4,
      grav: 0,
    });
  }
}
function startBossSpecial(e, name, pcx, pcy) {
  // P3/S4: windup length is CONTENT.specials[name].wind (was the inline `{…}[name]` table);
  // the `|| 36` fallback for an unknown name is preserved bit-for-bit.
  const sp = CONTENT.specials[name];
  const wind = (sp && sp.wind) || 36;
  e.tele = { name, t: wind, max: wind, aimX: pcx, aimY: pcy, radius: 175 };
  Sound.tone(150, 0.45, 'sawtooth', 0.13, { slideTo: 230 });
}
function execBossSpecial(e, name, pcx, pcy) {
  /* P3/S4: the six effect branches are CONTENT.specials[name].exec hooks (src/content/
     specials.ts) — moved VERBATIM (same op order, same Math.random() draws); the ambient
     sim/audio/factory surface is threaded through the curated act-view bag built here under
     non-banned member names (`sfx` for Sound, `enemies`/`player`/`map`/`dungeonLevel` for
     the state slices the branches read). No registry row is ever mutated — the branch only
     touches the instance and the LIVE world references it always did. An unknown name
     resolves to no entry and fires nothing, exactly as the old if/else-if chain did.
     (slam-telegraphed radial FROST pullunder still lands on ALL players via projectiles;
     raiseadds still spawns the ORDERED court, _pinRef=this boss, cursor _nextKill reset.) */
  const sp = CONTENT.specials[name];
  if (!sp) return;
  sp.exec(e, {
    px: pcx,
    py: pcy,
    map: state.map,
    dungeonLevel: state.dungeonLevel,
    enemies: state.enemies,
    player: state.player,
    sfx: Sound,
    TILE,
    OW_W,
    OW_H,
    T,
    addShake,
    playerTakeDamage,
    spawnRing,
    spawnBurst,
    addProjectile,
    findOpenTile,
    makeDungeonEnemy,
    makePinnacleAdd,
    makeCitadelAdd,
    getTile,
    floatDamage,
    log,
  });
}
function updateBoss(e, dist, pcx, pcy) {
  const ecx = e.x + e.w / 2,
    ecy = e.y + e.h / 2;
  if ((e.isPinnacle || e.isCitadel) && pinnacleHazard(e, pcx, pcy))
    return; /* #121: the Citadel boss shares the shrinking-arena hazard; returns true only when it steered the boss home (player abandoned the arena) so normal AI is skipped this tick */
  if (e.isCitadel) citadelBossPhase(e, pcx, pcy); /* #121: stance rotation + phase transitions (court waves, enrage) — no AI rewrite, just re-points e.specials */
  if (e.tele) {
    e.tele.t--;
    if (e.tele.t <= 0) {
      execBossSpecial(e, e.tele.name, pcx, pcy);
      e.tele = null;
      e.specialCd = 150 + Math.floor(Math.random() * 120);
      if (e.isCitadel && e._enrage) e.specialCd = Math.round(e.specialCd * 0.6); /* #121 phase 3: relentless */
    }
    return;
  }
  if (e.dash) {
    let moved = false;
    const cf = e.chillT > 0 ? 0.5 : 1;
    const nx = e.x + e.dash.vx * cf,
      ny = e.y + e.dash.vy * cf;
    if (canMoveTo(nx, e.y, e.w, e.h)) {
      e.x = nx;
      moved = true;
    }
    if (canMoveTo(e.x, ny, e.w, e.h)) {
      e.y = ny;
      moved = true;
    }
    if (dist < 48 && e.attackCd <= 0) {
      playerTakeDamage(Math.round(e.atk * 1.2));
      e.attackCd = 30;
    }
    e.dash.t--;
    if (e.dash.t <= 0 || !moved) e.dash = null;
    return;
  }
  if (e.specialCd > 0) e.specialCd--;
  if (e.specialCd <= 0 && dist < 600) {
    const name =
      e.specials && e.specials.length ? e.specials[Math.floor(Math.random() * e.specials.length)] : 'slam';
    startBossSpecial(e, name, pcx, pcy);
    return;
  }
  stepToward(e, pcx, pcy, e.speed);
  if (dist < 48 && e.attackCd <= 0) {
    playerTakeDamage(e.atk);
    e.attackCd = 45;
  }
  if (e.caster && e.castCd <= 0 && dist < 540) {
    const base = Math.atan2(pcy - ecy, pcx - ecx);
    for (let k = -1; k <= 1; k++) {
      const ang = base + k * 0.26;
      addProjectile(ecx, ecy, Math.cos(ang) * 3.0, Math.sin(ang) * 3.0, Math.round(e.atk * 0.8), {
        color: '#ff60a0',
        r: 7,
        life: 240,
      });
    }
    e.castCd = 150;
  }
}
function updateEnemiesFor(list) {
  /* THE enemy-AI body (P2/S15). Single-player calls it with state.enemies (the spread below is
     byte-identical to the old `[...state.enemies]`); in MP updateEnemies() calls it once per hero
     with that hero's assigned foes while state.enemies stays the FULL world roster — so every
     inline `state.enemies` read in here (the leash despawn splice, killEnemy's last-guardian
     liberation checks, healAlly's wounded-mate scan, raiseadds' court check, the Quarry burst)
     sees the whole world, not one hero's slice. `list` decides WHO acts; state.enemies stays WHAT EXISTS. */
  const p = state.player;
  const pcx = p.x + p.w / 2,
    pcy = p.y + p.h / 2;
  for (const e of [...list]) {
    if (e.hitFlash > 0) e.hitFlash--;
    if (e.attackCd > 0) e.attackCd--;
    if (e.castCd > 0) e.castCd--;
    e.wobble += 0.1;
    if (FACING[e.type]) {
      const _fdx = pcx - (e.x + e.w / 2);
      if (_fdx < -FACE_DZ) e._faceL = 1;
      else if (_fdx > FACE_DZ) e._faceL = 0;
    } /* FACING (cosmetic-only, read by drawEnemy). Derived from the CHASE VECTOR, not from actual movement: these three all charge you, so "where the hero is" IS "where I'm going" for every frame you can see — and unlike a movement delta it doesn't spin the beast 180° every time knockback (dvx) shoves it backwards, or when it strafes. It sits ABOVE the stun/leash/aggro `continue`s with the affix clocks, so a foe's heading never freezes mid-turn. In MP `state.player` here is the BUCKET hero = the nearest one = the one it's actually chasing, and the answer is authoritative, so every screen agrees. Deliberately NOT a client-side render-time derivation: the client rebuilds `state.enemies` from fresh JSON each snapshot, so a remembered facing bit cannot survive there — the FACE_DZ hysteresis would be dead on arrival in MP and only SP would hold steady. */
    if (e._afxN) {
      if (e._wfT > 0) e._wfT--;
      if (e.afxWard) {
        if (e.wardT > 0) e.wardT--;
        else if (--e.wardCd <= 0) {
          e.wardT = 66;
          e.wardCd = 300;
          spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 6, { color: '#9ecbff', speed: 1.4, decay: 0.06 });
        }
      }
      if (e.afxShield && e.shieldHp < e.shieldMax) {
        if (e.shieldRegenT > 0) e.shieldRegenT--;
        else {
          e.shieldHp = e.shieldMax;
          spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 6, { color: '#7ed2ff', speed: 1.4, decay: 0.06 });
        }
      }
    } // affix clocks tick BEFORE the stun/aggro gates so ward windows stay bounded even for leashed/idle foes
    if (tickEnemyStatus(e)) continue;
    if (e.stunT > 0) {
      e.stunT--;
      continue;
    }
    if (e.isWildDragon && e.hp <= e.maxHp * 0.15) {
      if (state.player.level >= 20) {
        if (!e.subdued) {
          e.subdued = true;
          log('The Emberwyrm collapses, subdued! Approach and press [E] to tame it.', 'quest');
          Sound.tone(160, 0.5, 'sawtooth', 0.16, { slideTo: 90 });
        }
        continue;
      } else {
        e.hp = Math.round(e.maxHp * 0.6);
        log('The Emberwyrm roars and recovers — you are not yet mighty enough (Level 20).', 'combat');
      }
    }
    // The Emberwyrm is BOUND to its volcanic lair (v2.36.2): it cannot see prey more than 10 tiles from the
    // lair, and with no one in its domain it always wings straight home (flies over anything — no pathing).
    if (e.isWildDragon && state.dragonLair) {
      const lx = state.dragonLair.tx * TILE + 16,
        ly = state.dragonLair.ty * TILE + 16;
      if (Math.hypot(pcx - lx, pcy - ly) > 10 * TILE) {
        e.tele = null;
        e.dash = null;
        const ecx2 = e.x + e.w / 2,
          ecy2 = e.y + e.h / 2;
        const dh = Math.hypot(ecx2 - lx, ecy2 - ly);
        if (dh > 20) {
          const ang = Math.atan2(ly - ecy2, lx - ecx2);
          e.x += Math.cos(ang) * e.speed * 2.6;
          e.y += Math.sin(ang) * e.speed * 2.6;
        }
        continue;
      }
    }
    if (
      state.map === 'overworld' &&
      e.homeDf !== undefined &&
      !e.isBoss &&
      !e.isNemesis &&
      !e.dread &&
      !e.isGreatBeast &&
      e.poiKey === undefined &&
      e.holdKey === undefined &&
      !e.aquatic
    ) {
      const ex = e.x + e.w / 2,
        ey = e.y + e.h / 2;
      const edf = distFactor(Math.floor(ex / TILE), Math.floor(ey / TILE));
      if (e.homeDf - edf > LEASH_MARGIN) {
        const ang = Math.atan2(ey - (OW_H * TILE) / 2, ex - (OW_W * TILE) / 2);
        stepToward(e, ex + Math.cos(ang) * 40, ey + Math.sin(ang) * 40, e.speed * 0.9);
        if (rectDist(p, e) > 700) {
          const ix = state.enemies.indexOf(e);
          if (ix >= 0) state.enemies.splice(ix, 1);
        }
        continue;
      }
    }
    if (e.tauntRef) {
      const tc = e.tauntRef;
      e.tauntT = (e.tauntT || 0) - 1;
      if (e.tauntT <= 0 || !tc.alive || tc.hp <= 0) {
        e.tauntRef = null;
      } else {
        if (rectDist(tc, e) > 26) stepToward(e, tc.x + tc.w / 2, tc.y + tc.h / 2, e.speed || 1);
        continue;
      }
    } // v2.39.0: a companion's strikes TAUNT — the foe turns on the warband (contact damage lands in updateCompanions)
    const dist = rectDist(p, e);
    const active = e.isBoss || e.isNemesis || (e.charger && e.chargeState > 0) || e.tele || e.dash;
    let aggro = e.isBoss
      ? 640
      : e.isNemesis
        ? 900
        : e.flee
          ? 420
          : e.caster || e.archer || e.healer
            ? 360
            : e.charger
              ? 240
              : 190;
    if (state.map === 'overworld' && !e.isBoss && !e.isNemesis && !e.dread && !e.night)
      aggro *= beastAggroMul();
    if ((dist >= aggro || state.player.cloaked) && !active)
      continue; /* GRAVEWOOL: a cloaked player is unseen by any not-already-engaged foe (bosses/nemesis/charging/telegraphing enemies stay `active` and still track); state.player is this bucket's player in MP, so the flag is read correctly */
    const ecx = e.x + e.w / 2,
      ecy = e.y + e.h / 2;
    if (e.isBoss) {
      updateBoss(e, dist, pcx, pcy);
    } else if (e.healer) {
      if (dist < 170) stepToward(e, 2 * ecx - pcx, 2 * ecy - pcy, e.speed);
      else if (dist > 300) stepToward(e, pcx, pcy, e.speed * 0.7);
      if (e.healCd > 0) e.healCd--;
      if (e.healCd <= 0) {
        healAlly(e);
        e.healCd = 150 + Math.floor(Math.random() * 60);
      }
      if (dist < 26 && e.attackCd <= 0) {
        enemyStrike(e, e.atk);
        e.attackCd = 60;
      }
    } else if (e.archer) {
      if (dist < 150) stepToward(e, 2 * ecx - pcx, 2 * ecy - pcy, e.speed);
      else if (dist > 250) stepToward(e, pcx, pcy, e.speed);
      if (e.attackCd <= 0 && dist < 340) {
        const ang = Math.atan2(pcy - ecy, pcx - ecx);
        addProjectile(ecx, ecy, Math.cos(ang) * 4.3, Math.sin(ang) * 4.3, e.atk, {
          color: '#e8d8a0',
          r: 5,
          life: 170,
          kind: 'arrow',
          ownerRef: e,
        });
        e.attackCd = 66;
      }
    } else if (e.flee) {
      stepToward(e, 2 * ecx - pcx, 2 * ecy - pcy, e.speed);
    } else if (e.charger) {
      updateCharger(e, dist, pcx, pcy);
    } else if (e.caster) {
      let dir = 0;
      if (dist < 130) dir = -1;
      else if (dist > 210) dir = 1;
      if (dir !== 0) stepToward(e, ecx + (pcx - ecx) * dir, ecy + (pcy - ecy) * dir, e.speed);
      if (e.castCd <= 0 && dist < 300) {
        const ang = Math.atan2(pcy - ecy, pcx - ecx);
        addProjectile(ecx, ecy, Math.cos(ang) * 3.2, Math.sin(ang) * 3.2, e.atk, {
          color: '#60a0ff',
          r: 6,
          life: 200,
          element: 'frost',
          ownerRef: e,
        });
        e.castCd = 110;
      }
      if (dist < 26 && e.attackCd <= 0) {
        enemyStrike(e, e.atk);
        e.attackCd = 50;
      }
    } else {
      if (e.windup > 0) {
        e.windup--;
        if (e.windup <= 0) {
          if (rectDist(p, e) < 34) enemyStrike(e, e.atk);
          e.attackCd = 52;
        }
      } else {
        stepToward(e, pcx, pcy, e.speed);
        if (dist < 28 && e.attackCd <= 0) e.windup = 11;
      }
    }
  }
}
/* ---- MP enemy partition, internalized (P2/S15 — plan §7 S13 "enemies") -----------------------
   These four run ONLY on the server (state.players is never set in SP — party()'s contract).
   They are the old server/world.js partition MOVED VERBATIM into the sim, so updateEnemies is
   the one place enemies pick targets: each foe chases its NEAREST eligible hero, and each
   hero's foes act under that hero's pin, so killEnemy's XP/gold/quests.slay/bounty credit
   lands on the killer BY CONSTRUCTION. Downed heroes are invisible to foes (that's the revive
   window) unless EVERYONE is down (the wipe still resolves); on the overworld, BOSS-tier foes
   cannot see heroes in the main-town vicinity and amble home when no valid target remains. */
function nearestHeroTo(e, pool) {
  const ex = e.x + e.w / 2,
    ey = e.y + e.h / 2;
  let best = pool[0],
    bd = Infinity;
  for (const q of pool) {
    const d = (q.x + q.w / 2 - ex) ** 2 + (q.y + q.h / 2 - ey) ** 2;
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
} // ties break first-in-JOIN-ORDER (strict <) — part of the determinism contract the 2p baselines freeze
function heroInSpawnTown(q) {
  const tz0 = __g.townZones && __g.townZones[0];
  if (!tz0) return false;
  const c0 = townCenter(tz0);
  const cx = q.x + q.w / 2 - c0.x * TILE,
    cy = q.y + q.h / 2 - c0.y * TILE;
  return cx * cx + cy * cy < (20 * TILE) ** 2;
} // the main-town safety bubble: same center startGame spawns the hero at (setupOverworld's c0×TILE — the value the server used to capture as SPAWN), same 20-tile radius
function wanderEnemyHome(e) {
  e.tele = null;
  e.dash = null;
  e.windup = 0;
  e.chargeState = 0;
  const ecx = e.x + e.w / 2,
    ecy = e.y + e.h / 2;
  let hx, hy;
  if (e.isKraken && state.krakenArena) {
    hx = state.krakenArena.tx * TILE;
    hy = state.krakenArena.ty * TILE;
  } // the Kraken stays in its peak-ringed arena (was wandering to the nearest map edge → "escaping")
  else if (e.isWildDragon && state.dragonLair) {
    hx = state.dragonLair.tx * TILE + 16;
    hy = state.dragonLair.ty * TILE + 16;
  } else if (e.isGreatBeast && e.huntKey) {
    // great beasts amble to their OWN lair (the Tide Leviathan was heading to "nearest edge" through dry land)
    const h = GREAT_HUNTS.find((x) => x.key === e.huntKey);
    if (h && h.lair) {
      hx = h.lair.tx * TILE + 16;
      hy = h.lair.ty * TILE + 16;
    }
  } else if (e.isPinnacle && e._lairTx != null) {
    hx = e._lairTx * TILE + 16;
    hy = e._lairTy * TILE + 16;
  } // pinnacle bosses drift back to their STAMPED lair, never the nearest sea/wall edge
  if (hx === undefined) {
    const W = OW_W * TILE,
      H = OW_H * TILE,
      dl = ecx,
      dr = W - ecx,
      dt = ecy,
      db = H - ecy,
      m = Math.min(dl, dr, dt, db);
    hx = m === dl ? 0 : m === dr ? W : ecx;
    hy = m === dt ? 0 : m === db ? H : ecy;
  }
  const d = Math.hypot(hx - ecx, hy - ecy);
  if (d > 8) {
    const sp = (e.speed || 1.2) * 1.4;
    e.x += ((hx - ecx) / d) * sp;
    e.y += ((hy - ecy) / d) * sp; // move freely so terrain can't trap a leaving boss
  }
}
function updateEnemies() {
  if (!(state.players && state.players.length)) {
    updateEnemiesFor(state.enemies);
    return;
  } // SP: the one hero, the whole roster — same body, same draws, byte-identical
  const roster = partyIn(); // heroes of THE WORLD SWAPPED IN right now (risk #9), in JOIN ORDER
  if (!roster.length || !state.enemies.length) return; // nobody here → foes stand (the parked-worlds rule)
  const overworld = state.map === 'overworld';
  const standing = roster.filter((q) => !q.downed);
  const normalPool = standing.length ? standing : roster; // everyone downed → foes still mill on them (the wipe resolves via bleed-out, never a frozen sim)
  const bossPool = overworld ? standing.filter((q) => !heroInSpawnTown(q)) : standing;
  const buckets = new Map(roster.map((q) => [q, []]));
  const wanderers = [];
  for (const e of state.enemies) {
    if (overworld && (e.isBoss || e.isNemesis || e.isGreatBeast || e.isWildDragon)) {
      if (bossPool.length) buckets.get(nearestHeroTo(e, bossPool)).push(e);
      else wanderers.push(e); // no valid target (all in town / all downed) → amble home below
    } else {
      buckets.get(nearestHeroTo(e, normalPool)).push(e);
    }
  }
  const seen = new Set(state.enemies);
  for (const q of roster) {
    state.player = q;
    state.inventory = q.inventory; // the pin IS the swap (P2/S13): combat-time gear reads AND killEnemy's credit ride the bucket hero. Deliberately NO restore — the old world.js loop left the last hero pinned and the shared phase re-pins players[0] right after; the ambient pin is part of the hashed state the 2p baselines freeze.
    updateEnemiesFor(buckets.get(q));
    for (const e of state.enemies)
      if (!seen.has(e)) {
        seen.add(e);
        buckets.get(q).push(e);
      } // mid-pass spawns (split children, boss summons, a raised court) belong to the acting hero's group, in push order — exactly where the old bucket-swap left them
  }
  const alive = new Set(state.enemies); // splices (killEnemy, the leash despawn) hit the FULL array live; the rebuild below just re-groups the survivors
  const rebuilt = [];
  for (const q of roster) for (const e of buckets.get(q)) if (alive.has(e)) rebuilt.push(e);
  for (const e of wanderers)
    if (alive.has(e)) {
      wanderEnemyHome(e);
      rebuilt.push(e);
    }
  state.enemies = rebuilt; // recombined in bucket order (hero join order, wanderers last) — the SAME end-of-tick array order the old world.js partition produced, because next tick's grouping iterates it
}
