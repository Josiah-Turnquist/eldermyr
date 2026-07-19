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
  // radius rides e.tele (packEnemy wires it), so a special's DRAWN telegraph and its exec's damage
  // zone read the same value on both sides; `|| 175` keeps every pre-S3 special byte-identical.
  e.tele = { name, t: wind, max: wind, aimX: pcx, aimY: pcy, radius: (sp && sp.radius) || 175 };
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
    // S3: the world-scoped party seam so a DIRECT party-wide AoE exec (smite) strikes every hero in
    // its zone, not just the bucketed duelist (risk #1). SP: partyIn() === [state.player], one pass.
    partyIn,
    actAs,
    // S4: the Emberkeg kegburst KNOCKBACK displaces each in-range hero through canMoveTo (no wall-cross).
    canMoveTo,
  });
}
// Mini-bosses are LAIR-BOUND (S2) — the Emberwyrm's volcanic-domain shape (p17:568) and the pinnacle
// arena leash, but with NO hazard: if the bucket hero is beyond ~12 tiles of the stamped lair, the
// mini drops any telegraph/dash, strides straight home (flying free of terrain traps like the dragon),
// and heals to full on arrival (anti-chip-kiting — you can't whittle it from outside its ground). It
// draws ZERO RNG (hypot/atan2/canMoveTo only) and, when already home (dh<26, full hp), touches nothing
// but returns true — so an idle mini far from every scripted golden hero is inert each tick save the
// ambient wobble, leaving the seeded stream unshifted (the surgical re-record).
const MINI_LEASH = 12 * TILE;
function miniLairBind(e, pcx, pcy) {
  if (e._lairTx == null) return false;
  const lx = e._lairTx * TILE + 16,
    ly = e._lairTy * TILE + 16;
  if (Math.hypot(pcx - lx, pcy - ly) <= MINI_LEASH) return false; // hero inside the domain → fight normally
  e.tele = null;
  e.dash = null;
  const ecx = e.x + e.w / 2,
    ecy = e.y + e.h / 2,
    dh = Math.hypot(ecx - lx, ecy - ly);
  if (dh > 26) {
    const a = Math.atan2(ly - ecy, lx - ecx),
      nx = e.x + Math.cos(a) * e.speed * 2.2,
      ny = e.y + Math.sin(a) * e.speed * 2.2;
    if (canMoveTo(nx, e.y, e.w, e.h)) e.x = nx;
    if (canMoveTo(e.x, ny, e.w, e.h)) e.y = ny;
  } else if (e.hp < e.maxHp) e.hp = e.maxHp; // arrived home → shed any chip damage
  return true;
}
// S3 — the Hierophant's healer RING (its signature). Acolytes are ordinary `healer`-kind enemies (the
// makePinnacleAdd reskin: recolour + level-stamp, ZERO new art / EnemyKindKey), leveled ~5 below the
// boss. They carry only `_orbRef` (the boss OBJECT ref — packScalar drops it from the wire) + the
// numeric `_orbIdx/_orbN` (ride packEnemy). They KEEP `e.healer`, so when the boss dies they orphan
// cleanly to the stock healer archetype (owner decision 4: the ring PERSISTS, you mop it up).
function makeHierophantAcolyte(boss, tx, ty, idx, n) {
  const e = makeEnemy(tx, ty, 'healer');
  e.name = 'Sun Acolyte';
  e.color = '#8fe6b4'; // green — the heal theme (the client's healer draw glows green for free)
  scaleEnemyToLevel(e, Math.max(1, boss.level - 5));
  e._orbRef = boss;
  e._orbIdx = idx;
  e._orbN = n;
  // staggered first pulse so the four don't all mend on the same tick (a smooth drip, not a lump)
  const every = (boss._mech && boss._mech.healEvery) || 150;
  e.healCd = Math.max(1, Math.round(((idx + 1) / n) * every));
  return e;
}
// Summon (or re-form) the ring: N acolytes on a circle around the boss, placed via the DETERMINISTIC
// findOpenTile spiral (no RNG of its own), each bursting in green. Called from hierophantPhase only
// when the ring is empty AND under the cap — forms once on engage, re-forms exactly once more.
function summonHierophantRing(boss, n) {
  const bcx = boss.x + boss.w / 2,
    bcy = boss.y + boss.h / 2;
  const R = (boss._mech && boss._mech.orbitR) || 60;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * 6.283;
    const o = findOpenTile(state.map, Math.floor((bcx + Math.cos(ang) * R) / TILE), Math.floor((bcy + Math.sin(ang) * R) / TILE));
    const ac = makeHierophantAcolyte(boss, o.tx, o.ty, i, n);
    state.enemies.push(ac);
    spawnBurst(ac.x + ac.w / 2, ac.y + ac.h / 2, 10, { color: '#70ffb0', speed: 1.8, decay: 0.045 });
  }
  spawnBurst(bcx, bcy, 14, { color: '#70ffb0', speed: 2.2, decay: 0.04 });
  Sound.cast && Sound.cast();
  log('The Hierophant raises its hands — a ring of acolytes rises to mend its wounds. Cut them down.', 'combat');
}
// S3 — the Hierophant's per-tick signature phase (the citadelBossPhase precedent), run from updateBoss
// ONLY when a hero is engaged (past miniLairBind) ⇒ never on a golden trajectory. Two jobs: (1) keep a
// healer RING up — summon on first engage, re-form ONCE when all N are dead, then stop (ringCap), so
// "break the ring, then burst" is the strategy and it can't stall forever; (2) fire an aimed RADIANT
// BOLT on its OWN cadence (a clock separate from the smite specialCd — continuous ranged pressure
// while you cut the ring). All fight state is LAZY scalars (_ringN/_boltCd) initialized here, never at
// spawn — so the boss's boot subtree gains only `specials` + `_mech` (the surgical golden re-record).
function hierophantPhase(e, dist, pcx, pcy) {
  const M = e._mech || {};
  const range = M.boltRange || 540;
  const cap = M.ringCap || 2;
  let live = 0;
  for (const x of state.enemies) if (x._orbRef === e && x.hp > 0) live++;
  if (live === 0 && (e._ringN || 0) < cap && dist < range) {
    summonHierophantRing(e, M.orbitN || 4);
    e._ringN = (e._ringN || 0) + 1;
  }
  e._boltCd = (e._boltCd || 0) - 1;
  if (e._boltCd <= 0 && dist < range) {
    const ecx = e.x + e.w / 2,
      ecy = e.y + e.h / 2;
    const ang = Math.atan2(pcy - ecy, pcx - ecx);
    addProjectile(ecx, ecy, Math.cos(ang) * 3.4, Math.sin(ang) * 3.4, Math.round(e.atk * (M.boltDmg || 0.8)), {
      color: '#ffe08a',
      r: 7,
      life: 240,
      element: 'fire',
      kind: 'radiant',
      ownerRef: e,
    });
    e._boltCd = M.boltEvery || 150;
    Sound.cast && Sound.cast();
  }
}
// S4 — the Broodmother's skittering BROODLING (her signature herd). Broodlings are ordinary `bat`-kind
// enemies (the acolyte reskin: recolour + level-stamp, ZERO new art / EnemyKindKey), leveled ~5 below
// the mother. They carry only `_millRef` (the mother OBJECT ref — packScalar drops it from the wire)
// plus numeric mill/shot clocks (ride packEnemy). They keep no `healer/archer` flag, so on the mother's
// death they orphan cleanly to the stock bat archetype (owner decision 4: the swarm PERSISTS, you mop it up).
function makeBroodling(mother, tx, ty) {
  const e = makeEnemy(tx, ty, 'bat');
  e.name = 'Broodling';
  e.color = '#9fce5a'; // sickly green — the mother's palette (the client's bat draw renders it for free)
  scaleEnemyToLevel(e, Math.max(1, mother.level - 5));
  e._millRef = mother;
  e._shotCd = Math.floor(Math.random() * ((mother._mech && mother._mech.shotEvery) || 100)); // staggered first pot-shot
  return e;
}
// S4 — the Broodmother's per-tick HERD MAINTENANCE (the hierophantPhase precedent), run from updateBoss
// ONLY when a hero is engaged (past miniLairBind) ⇒ never on a golden trajectory. Keep the herd topped
// up: count live broodlings (keyed on `_millRef === her`), and while under `broodCap` re-summon
// `broodPerCast` at a time on a `_broodCd` clock. Placement uses the DETERMINISTIC findOpenTile spiral
// off a random bearing (RNG is fine — broodlings exist only mid-fight, never on golden). All fight state
// is LAZY (`_broodCd`), initialized here, never at spawn — so her boot subtree gains only `specials` +
// `_mech` (the surgical golden re-record). Killing her stops the summons; the swarm already out lives her.
function broodmotherPhase(e, dist) {
  const M = e._mech || {};
  if (dist >= (M.broodRange || 560)) return; // only spawn with a hero engaged
  const cap = M.broodCap || 6;
  let live = 0;
  for (const x of state.enemies) if (x._millRef === e && x.hp > 0) live++;
  e._broodCd = (e._broodCd || 0) - 1;
  if (live < cap && e._broodCd <= 0) {
    const bcx = e.x + e.w / 2,
      bcy = e.y + e.h / 2;
    const per = Math.min(M.broodPerCast || 2, cap - live);
    const R = M.broodR || 70;
    if (live === 0)
      log('The Broodmother chitters — a skittering brood spills forth. They spin the webs; rush HER through them.', 'combat');
    for (let i = 0; i < per; i++) {
      const ang = Math.random() * 6.283;
      const o = findOpenTile(state.map, Math.floor((bcx + Math.cos(ang) * R) / TILE), Math.floor((bcy + Math.sin(ang) * R) / TILE));
      const b = makeBroodling(e, o.tx, o.ty);
      state.enemies.push(b);
      spawnBurst(b.x + b.w / 2, b.y + b.h / 2, 8, { color: '#9fce5a', speed: 1.6, decay: 0.05 });
    }
    e._broodCd = M.broodEvery || 90;
    Sound.cast && Sound.cast();
  }
}
function updateBoss(e, dist, pcx, pcy) {
  const ecx = e.x + e.w / 2,
    ecy = e.y + e.h / 2;
  if ((e.isPinnacle || e.isCitadel) && pinnacleHazard(e, pcx, pcy))
    return; /* #121: the Citadel boss shares the shrinking-arena hazard; returns true only when it steered the boss home (player abandoned the arena) so normal AI is skipped this tick */
  if (e.isMini && miniLairBind(e, pcx, pcy)) return; // S2: lair-bound — hero abandoned the domain → home, skip AI (no RNG)
  if (e.mbKey === 'hierophant') hierophantPhase(e, dist, pcx, pcy); // S3: healer-ring lifecycle (initial summon + ONE re-form) + the aimed radiant bolt. Reached ONLY past miniLairBind (a hero is engaged) → dead on golden. The citadelBossPhase precedent (a boss-specific phase hook, not a rotation special).
  if (e.mbKey === 'broodmother') broodmotherPhase(e, dist); // S4: keep the broodling herd topped up (continuous summon, capped). Same engagement gate as hierophantPhase → dead on golden. Her webvolley rotation special is picked below like any other.
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
    // S3 — ORBIT AI (Hierophant acolytes): a healer ring that holds station AROUND its boss and pulses
    // heals into it — NOT the chase AI. Guarded on `_orbRef` (a boss OBJECT ref packScalar drops from
    // the wire, like _pinRef) ⇒ DEAD on every golden trajectory (acolytes exist only mid-fight, never
    // on-trajectory, so this block never runs there — no hash move). Sits before the leash/aggro gates
    // so the ring holds formation at any hero distance. Orphaned (boss dead/gone) → clear the ref and
    // fall through to the stock healer archetype below (owner decision 4: minions PERSIST, get mopped).
    if (e._orbRef) {
      const boss = e._orbRef;
      if (boss.hp <= 0 || state.enemies.indexOf(boss) < 0) {
        e._orbRef = null; // anchor gone → drop to stock healer AI (mop-up), no continue
      } else {
        const M = boss._mech || {};
        const bcx = boss.x + boss.w / 2,
          bcy = boss.y + boss.h / 2;
        // even spacing (_orbIdx/_orbN) + a slow SHARED rotation off the wobble clock (0.012 rad/tick).
        const ang = e.wobble * 0.12 + (e._orbIdx / (e._orbN || 1)) * 6.283;
        const R = M.orbitR || 60;
        // Move FREELY toward the ring point — the acolytes are a magical ring BOUND to the boss, so they
        // float over terrain (the boss's own lair-homing does the same) rather than snag on a shrine wall
        // and collapse into the centre. Snap when within a step ⇒ the ring holds radius exactly on any
        // ground (the "cut them as they orbit past" read never breaks). No canMoveTo — deliberate.
        const otx = bcx + Math.cos(ang) * R, oty = bcy + Math.sin(ang) * R;
        let omx = otx - (e.x + e.w / 2), omy = oty - (e.y + e.h / 2);
        const omg = Math.hypot(omx, omy) || 1;
        const ostep = Math.min((e.speed || 1) * (M.orbitSpd || 1.6) * (e.chillT > 0 ? 0.45 : 1), omg);
        e.x += (omx / omg) * ostep;
        e.y += (omy / omg) * ostep;
        if (e.healCd > 0) e.healCd--;
        if (e.healCd <= 0) {
          const amt = Math.max(1, Math.round(boss.maxHp * (M.healPct || 0.012)));
          boss.hp = Math.min(boss.maxHp, boss.hp + amt); // while the ring lives it out-heals your DPS — the "break the ring" law
          e.healCd = M.healEvery || 150;
          spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 8, { color: '#70ffb0', speed: 1.2, up: 0.6, decay: 0.05 });
          spawnBurst(bcx, bcy, 8, { color: '#70ffb0', speed: 1.3, up: 0.7, decay: 0.05 }); // green pulse at BOTH ends (healAlly's colour)
          Sound.tone && Sound.tone(620, 0.14, 'sine', 0.06, { slideTo: 900 });
        }
        continue;
      }
    }
    // S4 — MILL AI (Broodmother broodlings): a loose free-float swarm that WANDERS inside a leash bubble
    // around its mother and pot-shots the hero with WEB bolts — NOT the chase AI (a looser cousin of the
    // S3 orbit). Guarded on `_millRef` (a mother OBJECT ref packScalar drops from the wire) ⇒ DEAD on
    // every golden trajectory (broodlings exist only mid-fight). Sits beside the orbit block so the herd
    // mills at any hero distance (it ignores aggro range — the herd belongs to the boss's section).
    // Orphaned (mother dead/gone) → clear the ref, fall through to the stock bat archetype (owner
    // decision 4: the swarm PERSISTS). Free-float (no canMoveTo) so a bead can't snag a wall and collapse.
    if (e._millRef) {
      const mother = e._millRef;
      if (mother.hp <= 0 || state.enemies.indexOf(mother) < 0) {
        e._millRef = null; // anchor gone → drop to stock bat AI (mop-up), no continue
      } else {
        const M = mother._mech || {};
        const mcx = mother.x + mother.w / 2,
          mcy = mother.y + mother.h / 2;
        const millR = M.millR || 120;
        // re-pick a fresh random target inside the bubble on a clock (RNG fine — never on golden)
        e._millT = (e._millT || 0) - 1;
        if (e._millT <= 0 || e._mtx == null) {
          const a = Math.random() * 6.283,
            rr = Math.random() * millR;
          e._mtx = mcx + Math.cos(a) * rr;
          e._mty = mcy + Math.sin(a) * rr;
          e._millT = (M.millEvery || 55) + Math.floor(Math.random() * 30);
        }
        // free-float toward the wander target — NOT stepToward (terrain-collapse rule); snap within a step
        let mmx = e._mtx - (e.x + e.w / 2),
          mmy = e._mty - (e.y + e.h / 2);
        const mg = Math.hypot(mmx, mmy) || 1;
        const mstep = Math.min((e.speed || 1) * (M.millSpd || 0.9) * (e.chillT > 0 ? 0.45 : 1), mg);
        e.x += (mmx / mg) * mstep;
        e.y += (mmy / mg) * mstep;
        // WEB pot-shot at the bucket hero on its own cadence (kind:'web' → the Webbed slow, p13 hit seam)
        e._shotCd = (e._shotCd || 0) - 1;
        const dh = Math.hypot(pcx - (e.x + e.w / 2), pcy - (e.y + e.h / 2));
        if (e._shotCd <= 0 && dh < (M.shotRange || 360)) {
          const ang = Math.atan2(pcy - (e.y + e.h / 2), pcx - (e.x + e.w / 2));
          const sp = M.shotSpd || 3.4;
          addProjectile(e.x + e.w / 2, e.y + e.h / 2, Math.cos(ang) * sp, Math.sin(ang) * sp, Math.max(1, Math.round(e.atk * (M.webDmg || 0.55))), {
            color: '#c8e6a0',
            r: 5,
            life: 150,
            kind: 'web',
            webT: M.webT || 120,
            ownerRef: e,
          });
          e._shotCd = (M.shotEvery || 100) + Math.floor(Math.random() * 30);
        }
        continue;
      }
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
  } else if ((e.isPinnacle || e.isMini) && e._lairTx != null) {
    hx = e._lairTx * TILE + 16;
    hy = e._lairTy * TILE + 16;
  } // pinnacle + mini bosses drift back to their STAMPED lair, never the nearest sea/wall edge (the no-valid-target MP wanderers path)
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
