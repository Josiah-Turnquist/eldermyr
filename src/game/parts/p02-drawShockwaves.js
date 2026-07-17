function drawShockwaves(camX, camY) {
  for (const s of shockwaves) {
    if (s.delay > 0) continue;
    const a = Math.max(0, Math.min(1, s.life));
    if (a <= 0) continue;
    const x = s.x - camX,
      y = s.y - camY,
      r = Math.max(1, s.r);
    if (s.flash) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${(a * 0.85).toFixed(3)})`);
      g.addColorStop(0.35, `rgba(${s.color},${(a * 0.6).toFixed(3)})`);
      g.addColorStop(1, `rgba(${s.color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
    } else {
      ctx.lineWidth = Math.max(1, (s.width || 3) * a);
      ctx.strokeStyle = `rgba(${s.color},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, (s.width || 3) * a * 0.5);
      ctx.strokeStyle = `rgba(255,255,255,${(a * 0.55).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ---- item / style helpers ----
function equippedWeapon() {
  return state.inventory.weapons.find((x) => x.equipped);
}
function equippedArmor() {
  return state.inventory.armor.find((x) => x.equipped);
}
function styleOf(w) {
  return w && w.style ? w.style : 'melee';
}
function styleLabel(s) {
  return { melee: 'Melee', ranged: 'Ranged', magic: 'Magic' }[s] || 'Melee';
}
function styleTag(s) {
  return { melee: 'tag-melee', ranged: 'tag-ranged', magic: 'tag-magic' }[s] || 'tag-melee';
}
// v2.47.0 gear glyphs — shared by inventory rows AND shop rows (buy stock + sell list) so a shop shows the same pic an item shows in the pack. Armor → shield; weapons → style glyph (fallback ⚔). Auto-detects armor when unlabelled (has def, no atk).
function itemGlyph(it, kind) {
  const g =
    kind === 'armor' || (kind == null && it && it.def !== undefined && it.atk === undefined)
      ? '🛡'
      : { melee: '🗡', ranged: '🏹', magic: '🔮' }[styleOf(it)] || '⚔';
  return '<span style="font-size:15px;margin-right:3px">' + g + '</span>';
}
function hasteMul() {
  const p = state.player;
  return (1 - (p.atkHaste || 0)) * (p.blessT > 0 && p.blessType === 'haste' ? 0.7 : 1);
}
function profLvl(style) {
  const pr = state.player.prof[style];
  return pr ? pr.lvl : 1;
}
function profSpeedMul(style) {
  return 1 + 0.025 * (profLvl(style) - 1);
} // #8: projectile/sweep speed scales with proficiency
function profHasteMul(style) {
  return Math.max(0.82, 1 - 0.006 * (profLvl(style) - 1));
} // #11: proficiency slightly quickens attacks
function weaponCd(w) {
  const s = styleOf(w);
  let base = w && w.cd ? w.cd : { melee: 22, ranged: 26, magic: 40 }[s];
  return Math.max(6, Math.round(base * hasteMul() * profHasteMul(s)));
}
function magicCd() {
  const base = 40;
  const profRed = (state.player.prof.magic.lvl - 1) * 1.4;
  return Math.max(14, Math.round((base - profRed) * hasteMul()));
}
function magicCost() {
  const w = equippedWeapon();
  const power = w && styleOf(w) === 'magic' ? w.atk || 0 : 0;
  const base = 8 + Math.round(power * 0.6);
  const red = (state.player.prof.magic.lvl - 1) * 0.5 + (state.player.bonusFont || 0);
  return Math.max(4, Math.round((base - red) * (hasPerk('magic', 1) ? 0.8 : 1)));
}
function weakCastCost() {
  return Math.max(
    8,
    14 - Math.round((state.player.prof.magic.lvl - 1) * 0.5) - (state.player.bonusFont || 0),
  );
}
function isBroken(it) {
  return it && it.dur !== undefined && it.dur <= 0;
}
function brokenMult(it) {
  return isBroken(it) ? 0.25 : 1;
}
function profMult(style) {
  return 1 + (state.player.prof[style].lvl - 1) * 0.02;
}
function canEquip(it) {
  const p = state.player;
  if (it.style) {
    const need = it.reqProf || 1;
    if (need > p.prof[styleOf(it)].lvl)
      return { ok: false, reason: `Requires ${styleLabel(styleOf(it))} proficiency ${need}` };
    return { ok: true };
  }
  if ((it.reqLevel || 1) > p.level) return { ok: false, reason: `Requires level ${it.reqLevel}` };
  return { ok: true };
}
function normItem(it, isWeapon) {
  if (it.rarity === undefined) it.rarity = 0;
  if (it.durMax === undefined) it.durMax = RARITIES[it.rarity].dur;
  if (it.dur === undefined) it.dur = it.durMax;
  if (it.reqLevel === undefined) it.reqLevel = 1;
  if (isWeapon) {
    if (it.style === undefined) it.style = 'melee';
    if (it.reqProf === undefined) it.reqProf = 1;
  }
  return it;
}
// Style Mastery — proficiency Lv 5/10/15 unlock a signature perk per weapon style (v2.30.0)
const MASTERY = CONTENT.gear.mastery; // P3/S6: positional alias → src/content/gear.ts
const MASTERY_LVLS = CONTENT.gear.masteryLvls; // P3/S6: alias — [10,18,24]; hard-earned, prof caps at 25 (v2.34.2)
function masteryLvl(style) {
  const pr = state.player.prof[style];
  return pr ? pr.lvl : 0;
}
function hasPerk(style, i) {
  return masteryLvl(style) >= MASTERY_LVLS[i];
}
function gainProf(style, amt) {
  const pr = state.player.prof[style];
  if (!pr) return;
  const before = pr.lvl;
  pr.xp += amt;
  let up = false;
  while (pr.xp >= pr.next && pr.lvl < 25) {
    pr.xp -= pr.next;
    pr.lvl++;
    pr.next = Math.round(pr.next * 1.35) + 4;
    up = true;
  }
  if (up) {
    recalcStats();
    updateHUD();
    log(`Your ${styleLabel(style)} skill rose to ${pr.lvl}!`, 'good');
    MASTERY_LVLS.forEach((t, i) => {
      if (before < t && pr.lvl >= t && MASTERY[style]) {
        const pk = MASTERY[style][i];
        log(`★ ${styleLabel(style)} Mastery — ${pk[0]} unlocked: ${pk[1]}!`, 'quest');
        Sound.levelup && Sound.levelup();
      }
    });
  }
}
function sellValue(it) {
  const stat = (it.atk !== undefined ? it.atk : it.def) || 0;
  const r = it.rarity || 0;
  return Math.max(2, Math.round(stat * 1.4 + r * 6));
}

// Rarity roll (0 common … 4 legendary). The `shift` slides the roll toward rarer tiers; because everything under `shift` piles onto
// the legendary floor, the OLD shared min(0.10,level*0.006) flooded overworld drops with legendaries (~11% legendary on a lvl17+ wild
// kill). Now the level bonus is SPLIT: bosses keep a strong slide (they SHOULD favor high rarity), while common/overworld drops get a
// tiny capped slide — so legendaries are genuinely RARE at baseline again. Top threshold tightened 0.010→0.006 (base legendary 1.0%→0.6%).
function rollRarity(level, boss) {
  let r = Math.random();
  const shift = boss ? 0.18 + Math.min(0.12, level * 0.006) : Math.min(0.015, level * 0.0008);
  r = Math.max(0, r - shift);
  if (r > 0.42) return 0;
  if (r > 0.15) return 1;
  if (r > 0.045) return 2;
  if (r > 0.006) return 3;
  return 4;
}
// Build-defining combat affixes on rarer gear (Runed+). Weapons lean offensive, armor defensive.
function rollAffixes(rIdx, isWeapon) {
  if (rIdx < 2 || Math.random() > 0.34 + rIdx * 0.14) return null;
  // P3/S6: the offense/defense pool DEFINITIONS live in src/content/gear.ts (affixPool, pure —
  // no RNG). The pick + the second-affix roll stay here, so the draw order is byte-identical.
  const pool = CONTENT.gear.affixPool(rIdx, isWeapon);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const out = [pick];
  if (rIdx >= 4 && Math.random() < 0.5) {
    const p2 = pool[Math.floor(Math.random() * pool.length)];
    if (p2.t !== pick.t) out.push(p2);
  }
  return out;
}
function afxText(a) {
  if (!a) return '';
  return a.t === 'lifesteal' ? `+${a.v || 0}% Lifesteal` : a.label;
} // affix labels are BAKED into saved items, so a coefficient change would strand old gear advertising the old number ("+6% Lifesteal" for what is now 2%). `v` is the truth — derive the lifesteal text from it at render time so existing saves read honestly with no migration.
function affixHtml(it) {
  if (!it || !it.affixes || !it.affixes.length) return '';
  return it.affixes.map((a) => ` <span style="color:#74e0ff">✦${afxText(a)}</span>`).join('');
}
function uniqHtml(it) {
  return it && it.uniq
    ? `<br><span style="font-size:10px;color:#f0a020">✦ ${it.uniqDesc || 'Unique relic'}</span>`
    : '';
} // shows a pinnacle unique's build-changing effect in its inventory row
function genWeapon(level, rIdx) {
  const style = CONTENT.gear.genStyles[Math.floor(Math.random() * 3)]; // P3/S6: gen pool → gear.ts
  const R = RARITIES[rIdx];
  const atk = Math.max(1, Math.round((3 + level * 0.9) * R.mult));
  const tier = Math.min(3, Math.floor(rIdx * 0.7 + Math.random() * 1.4));
  const it = {
    name: `${RAR_PREFIX[rIdx]} ${STYLE_NAMES[style][tier]}`,
    atk,
    style,
    rarity: rIdx,
    reqLevel: Math.max(1, Math.round(level * 0.6) + rIdx),
    reqProf: 1 + rIdx * 2 + Math.floor(level / 4),
    dur: R.dur,
    durMax: R.dur,
    equipped: false,
  };
  if (style === 'melee') it.cd = 22;
  if (style === 'ranged') it.cd = 26;
  if (rIdx >= 2)
    it.bonus =
      Math.random() < 0.5
        ? { stat: 'atk', amount: rIdx, label: `+${rIdx} ATK` }
        : { stat: 'def', amount: rIdx, label: `+${rIdx} DEF` };
  const af = rollAffixes(rIdx, true);
  if (af) it.affixes = af;
  if (Math.random() < 0.16 + rIdx * 0.13) {
    const els = CONTENT.gear.genElements; // P3/S6: gen pool → gear.ts
    it.element = els[Math.floor(Math.random() * 4)];
    it.name = it.name + ' of ' + ELEMENTS[it.element].name;
  }
  return it;
}
function genArmor(level, rIdx) {
  const R = RARITIES[rIdx];
  const def = Math.max(1, Math.round((1.5 + level * 0.5) * R.mult));
  const tier = Math.min(3, Math.floor(rIdx * 0.7 + Math.random() * 1.4));
  const it = {
    name: `${RAR_PREFIX[rIdx]} ${ARMOR_NAMES[tier]}`,
    def,
    rarity: rIdx,
    reqLevel: Math.max(1, Math.round(level * 0.6) + rIdx),
    dur: R.dur,
    durMax: R.dur,
    equipped: false,
  };
  if (rIdx >= 2)
    it.bonus =
      Math.random() < 0.5
        ? { stat: 'def', amount: rIdx, label: `+${rIdx} DEF` }
        : { stat: 'atk', amount: rIdx, label: `+${rIdx} ATK` };
  const af = rollAffixes(rIdx, false);
  if (af) it.affixes = af;
  return it;
}
// #5: super-rare MAGIC weapons with distinct fire patterns (w.pattern → cast path emits N bolts w/ per-bolt dmg mult).
// Absent w.pattern = exactly the current single-bolt behavior. Multi-bolt is weaker per bolt (twin ~60%, tri ~45%);
// the lance is one slow, hard-piercing shot. Preserved by every weapon-copy path (normItem/reforge/fuse/temper/save)
// since those mutate fields in place and never rebuild the item object.
// P3/S6: PATTERN_WEAPONS DATA → src/content/gear.ts (CONTENT.gear.patternWeapons). This is its
// positional alias; rollPatternWeapon JSON-deep-copies a row, so the registry is never mutated.
const PATTERN_WEAPONS = CONTENT.gear.patternWeapons;
function rollPatternWeapon() {
  const t = PATTERN_WEAPONS[Math.floor(Math.random() * PATTERN_WEAPONS.length)];
  const w = JSON.parse(JSON.stringify(t));
  normItem(w, true);
  return w;
}
function ensureCycleAffix(it, rIdx) {
  const isW = it.atk !== undefined;
  let af = null;
  for (let i = 0; i < 12 && !af; i++) af = rollAffixes(Math.max(3, rIdx), isW);
  if (af) {
    it.affixes = it.affixes || [];
    for (const a of af) {
      if (!it.affixes.some((x) => x.t === a.t)) it.affixes.push(a);
    }
  }
} // #2: cycle loot always carries at least one strong affix

// ================= WORLD GEN =================
function townCenter(tz) {
  return { x: tz.x + Math.floor(tz.w / 2), y: tz.y + Math.floor(tz.h / 2) };
}
function isInTown(tx, ty, margin = 0) {
  for (const tz of __g.townZones)
    if (tx >= tz.x - margin && tx < tz.x + tz.w + margin && ty >= tz.y - margin && ty < tz.y + tz.h + margin)
      return true;
  return false;
}
__g.biomeMap = null;
__g.houseTiles = [];
function frozenLimit(tx) {
  return Math.round(OW_H * 0.17 + Math.sin(tx * 0.18) * 4 + Math.sin(tx * 0.06) * 3);
}
function distFactor(tx, ty) {
  const cx = OW_W / 2,
    cy = OW_H / 2;
  return Math.min(1, Math.hypot(tx - cx, ty - cy) / Math.hypot(cx, cy));
}
// Distance→DIFFICULTY multiplier — steep→flat→steep: a small gentle CORE (df<0.10 → 0.71×, i.e. 1.4× easier for brand-new
// players), a FAST climb to ~1.0× baseline by df~0.20, a GENTLE mid plateau (1.0→1.6× across df 0.2–0.7), then a STEEP frontier
// ramp to ~4.0× at the very edge. Smootherstep segments (C¹-continuous, cheap — spawn-rate, never per-frame). NOTE: distFactor
// itself stays a raw LINEAR 0→1 geometry value (rings/POI bands/town tiers read it); ONLY this scalar reshapes wild-enemy power.
function diffMul(df) {
  const ss = (a, b, t) => {
    if (t <= a) return 0;
    if (t >= b) return 1;
    const u = (t - a) / (b - a);
    return u * u * u * (u * (u * 6 - 15) + 10);
  };
  return df < 0.1
    ? 0.71
    : df < 0.2
      ? 0.71 + ss(0.1, 0.2, df) * 0.29
      : df < 0.7
        ? 1.0 + ss(0.2, 0.7, df) * 0.6
        : 1.6 + ss(0.7, 1.0, df) * 2.4;
}
function townTier(cx, cy) {
  const d = distFactor(cx, cy);
  return d < 0.3 ? 0 : d < 0.55 ? 1 : 2;
}
function townInfo(i) {
  const tz = __g.townZones[i];
  const c = townCenter(tz);
  return { key: 't' + i, name: tz.name, biome: tileBiome(c.x, c.y), tier: townTier(c.x, c.y) };
}
function isFrozenTile(tx, ty) {
  return !!(__g.biomeMap && __g.biomeMap[ty] && __g.biomeMap[ty][tx] === 1);
}
function isLavaTile(tx, ty) {
  return !!(__g.biomeMap && __g.biomeMap[ty] && __g.biomeMap[ty][tx] === 2);
}
function tileBiome(tx, ty) {
  return (__g.biomeMap && __g.biomeMap[ty] && __g.biomeMap[ty][tx]) || 0;
}
function generateOverworld() {
  const m = [];
  for (let y = 0; y < OW_H; y++) {
    const row = [];
    for (let x = 0; x < OW_W; x++) row.push(T.GRASS);
    m.push(row);
  }
  for (let x = 0; x < OW_W; x++) {
    m[0][x] = T.MOUNTAIN;
    m[OW_H - 1][x] = T.MOUNTAIN;
  }
  for (let y = 0; y < OW_H; y++) {
    m[y][0] = T.MOUNTAIN;
    m[y][OW_W - 1] = T.MOUNTAIN;
  }
  function cluster(cx, cy, r, tile, density) {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 1 || y < 1 || x >= OW_W - 1 || y >= OW_H - 1) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r && Math.random() < density * (1 - d / (r * 1.5))) m[y][x] = tile;
      }
  }
  const AREA = OW_W * OW_H;
  // INTENTIONAL FORESTS — a couple dozen large, ragged woods with open plains between them (not scatter everywhere).
  // The home Vale (df<0.12) stays airy; roads carved later punch straight through any wood in their way.
  for (let i = 0; i < Math.round(AREA / 2400); i++) {
    const fx = 8 + Math.floor(Math.random() * (OW_W - 16)),
      fy = 8 + Math.floor(Math.random() * (OW_H - 16));
    if (distFactor(fx, fy) < 0.12) continue;
    const fr = 5 + Math.floor(Math.random() * 7);
    for (let y = fy - fr; y <= fy + fr; y++)
      for (let x = fx - fr; x <= fx + fr; x++) {
        if (x < 1 || y < 1 || x >= OW_W - 1 || y >= OW_H - 1) continue;
        const d = Math.hypot(x - fx, y - fy) / fr + (Math.sin(x * 0.7) + Math.cos(y * 0.6)) * 0.11;
        if (d < 0.98 && Math.random() < 0.8) m[y][x] = T.TREE;
      }
  }
  // lone trees dot the open plains
  for (let i = 0; i < Math.round(AREA / 240); i++) {
    const x = 1 + Math.floor(Math.random() * (OW_W - 2)),
      y = 1 + Math.floor(Math.random() * (OW_H - 2));
    if (m[y][x] === T.GRASS) m[y][x] = T.TREE;
  }
  // a few real LAKES + scattered ponds, and mountain RIDGES instead of pimples
  for (let i = 0; i < Math.round(AREA / 2900); i++)
    cluster(
      5 + Math.floor(Math.random() * (OW_W - 10)),
      5 + Math.floor(Math.random() * (OW_H - 10)),
      3 + Math.floor(Math.random() * 4),
      T.WATER,
      0.9,
    );
  for (let i = 0; i < Math.round(AREA / 900); i++)
    cluster(
      3 + Math.floor(Math.random() * (OW_W - 6)),
      3 + Math.floor(Math.random() * (OW_H - 6)),
      1 + Math.floor(Math.random() * 2),
      T.WATER,
      0.85,
    );
  for (let i = 0; i < Math.round(AREA / 1700); i++)
    cluster(
      3 + Math.floor(Math.random() * (OW_W - 6)),
      3 + Math.floor(Math.random() * (OW_H - 6)),
      2 + Math.floor(Math.random() * 3),
      T.MOUNTAIN,
      0.75,
    );
  for (let i = 0; i < Math.round(AREA / 44); i++) {
    const x = 1 + Math.floor(Math.random() * (OW_W - 2)),
      y = 1 + Math.floor(Math.random() * (OW_H - 2));
    if (m[y][x] === T.GRASS) m[y][x] = T.FLOWER;
  }
  __g.townZones = [
    { x: 151, y: 127, w: 16, h: 13, name: 'Eldermyr' },
    { x: 125, y: 48, w: 13, h: 10, name: 'Northwatch' },
    { x: 220, y: 137, w: 13, h: 10, name: 'Eastgate' },
    { x: 237, y: 48, w: 12, h: 9, name: 'Frostspire' },
    { x: 260, y: 214, w: 13, h: 10, name: 'Southreach' },
    { x: 46, y: 154, w: 12, h: 10, name: 'Westhaven' },
  ];
  for (const tz of __g.townZones) {
    for (let y = tz.y - 1; y < tz.y + tz.h + 1; y++)
      for (let x = tz.x - 1; x < tz.x + tz.w + 1; x++) {
        if (x < 1 || y < 1 || x >= OW_W - 1 || y >= OW_H - 1) continue;
        m[y][x] = T.GRASS;
      }
    const midRow = tz.y + Math.floor(tz.h / 2);
    for (let x = tz.x; x < tz.x + tz.w; x++) m[midRow][x] = T.PATH;
    for (let x = tz.x + 1; x < tz.x + tz.w - 1; x += 3) m[tz.y + 1][x] = T.HOUSE;
    for (let x = tz.x + 2; x < tz.x + tz.w - 1; x += 3) m[tz.y + tz.h - 2][x] = T.HOUSE;
    if (tz.h >= 11) {
      m[midRow - 3][tz.x + 1] = T.HOUSE;
      m[midRow + 3][tz.x + tz.w - 2] = T.HOUSE;
    }
  }
  function walk(t) {
    return t === T.WATER ? T.BRIDGE : SOLID.has(t) ? T.PATH : t;
  }
  function carvePath(ax, ay, bx, by) {
    let x = ax,
      y = ay;
    while (x !== bx) {
      m[y][x] = walk(m[y][x]);
      x += x < bx ? 1 : -1;
    }
    while (y !== by) {
      m[y][x] = walk(m[y][x]);
      y += y < by ? 1 : -1;
    }
    m[y][x] = walk(m[y][x]);
  }
  const c0 = townCenter(__g.townZones[0]);
  for (let i = 1; i < __g.townZones.length; i++) {
    const ci = townCenter(__g.townZones[i]);
    carvePath(c0.x, c0.y, ci.x, ci.y);
  }
  let dx = 168,
    dy = 196;
  m[dy][dx] = T.DUNGEON_ENTRANCE;
  m[dy - 1][dx] = walk(m[dy - 1][dx]);
  m[dy][dx - 1] = walk(m[dy][dx - 1]);
  m[dy][dx + 1] = walk(m[dy][dx + 1]);
  carvePath(c0.x, c0.y, dx, dy - 1);
  state.dungeonEntrance = { tx: dx, ty: dy };
  for (const h of HOLD_SITES) {
    for (let y = h.ty - 3; y <= h.ty + 3; y++)
      for (let x = h.tx - 3; x <= h.tx + 3; x++) {
        if (x < 1 || y < 1 || x >= OW_W - 1 || y >= OW_H - 1) continue;
        if (SOLID.has(m[y][x])) m[y][x] = T.GRASS;
      }
    carvePath(c0.x, c0.y, h.tx, h.ty);
  }
  carvePath(c0.x, c0.y, 81, 204); // the harbor road — the Shipwright must never be sealed off by a wood
  __g.biomeMap = [];
  __g.houseTiles = [];
  const lavaThresh = (OW_W + OW_H) * 0.76;
  for (let y = 0; y < OW_H; y++) {
    const row = [];
    for (let x = 0; x < OW_W; x++) {
      row.push(y <= frozenLimit(x) ? 1 : x + y > lavaThresh + Math.round(Math.sin(x * 0.25) * 3) ? 2 : 0);
      if (m[y][x] === T.HOUSE) __g.houseTiles.push({ x, y });
    }
    __g.biomeMap.push(row);
  }
  // dragon lair (Emberwaste, reachable on foot) + peak-ringed kraken arena (fly-only)
  state.dragonLair = { tx: 280, ty: 235 };
  const dl = state.dragonLair;
  for (let y = dl.ty - 4; y <= dl.ty + 4; y++)
    for (let x = dl.tx - 4; x <= dl.tx + 4; x++) {
      if (x < 1 || y < 1 || x >= OW_W - 1 || y >= OW_H - 1) continue;
      if (SOLID.has(m[y][x])) m[y][x] = T.GRASS;
    }
  carvePath(c0.x, c0.y, 280, 235);
  const kx = 62,
    ky = 230;
  state.krakenArena = { tx: kx, ty: ky };
  for (let y = ky - 6; y <= ky + 6; y++)
    for (let x = kx - 6; x <= kx + 6; x++) {
      if (x < 1 || y < 1 || x >= OW_W - 1 || y >= OW_H - 1) continue;
      const d = Math.max(Math.abs(x - kx), Math.abs(y - ky));
      if (d <= 4) m[y][x] = T.GRASS;
      else if (d === 5) m[y][x] = T.MOUNTAIN;
    }
  // --- The Sundered Sea: a boat-only ocean (SW wilderness) with islands holding sea content ---
  state.ocean = { x0: 87, y0: 182, x1: 132, y1: 235 };
  const o = state.ocean;
  for (let y = o.y0; y <= o.y1; y++)
    for (let x = o.x0; x <= o.x1; x++) {
      if (x < 1 || y < 1 || x >= OW_W - 1 || y >= OW_H - 1) continue;
      m[y][x] = T.WATER;
      if (__g.biomeMap[y]) __g.biomeMap[y][x] = 0;
    }
  // proper ISLES now — big enough to be real boss arenas and treasure grounds
  state.islands = [
    { x: 104, y: 199 },
    { x: 120, y: 221 },
  ];
  for (const is of state.islands) {
    for (let y = is.y - 5; y <= is.y + 5; y++)
      for (let x = is.x - 5; x <= is.x + 5; x++) {
        if (x < 1 || y < 1 || x >= OW_W - 1 || y >= OW_H - 1) continue;
        if (Math.hypot(x - is.x, y - is.y) <= 4.3) {
          m[y][x] = T.GRASS;
          if (__g.biomeMap[y]) __g.biomeMap[y][x] = 0;
        }
      }
  }
  maps.overworld = m;
}
