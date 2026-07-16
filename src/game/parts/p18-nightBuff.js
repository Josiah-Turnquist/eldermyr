function nightBuff(e) {
  if (isNight()) {
    e.maxHp = Math.round(e.maxHp * 1.25);
    e.hp = e.maxHp;
    e.atk = Math.round(e.atk * 1.2);
    e.night = true;
  }
  return e;
}
// ================= ELITE AFFIXES (Pillar 3 — variety at zero art cost) =================
// All affix state lives as SCALARS on the enemy (numbers/strings only — MP packScalar drops arrays/objects),
// so affixed elites ride snapshots to clients with zero extra wiring, and old saves default them off.
// ELITE-ONLY invariant: rollEliteAffixes refuses bosses/nemesis/hunts/dragons/named/dread/warlords.
// Split copies NEVER split again (_splitChild) and are built from a WHITELIST — no site/quest/Legion tags.
const AFX_DEFS = {
  shielded: { flag: 'afxShield', label: 'SHIELDED', pre: 'Shielded ' },
  vampiric: { flag: 'afxVamp', label: 'VAMPIRIC', pre: 'Vampiric ' },
  splitting: { flag: 'afxSplit', label: 'SPLITTING', pre: 'Splitting ' },
  warded: { flag: 'afxWard', label: 'WARDED', pre: 'Warded ' },
};
const AFX_KEYS = ['shielded', 'vampiric', 'splitting', 'warded'];
function afxCount(maxAfx) {
  if (maxAfx !== undefined) return Math.max(0, Math.min(maxAfx, AFX_KEYS.length));
  const pl = partyLvl();
  return pl >= 22 ? 2 : pl >= 15 ? 1 : 0;
} // party gate: 1 affix at 15+, 2 at 22+; pinnacle/cycle phases pass maxAfx=3 later (the clean hook)
function rollEliteAffixes(e, maxAfx) {
  if (!e || e._afxN || e._splitChild) return e;
  if (
    e.isBoss ||
    e.isNemesis ||
    e.isGreatBeast ||
    e.isWildDragon ||
    e.isFinalBoss ||
    e.named ||
    e.dread ||
    e.warlordRef
  )
    return e;
  const n = afxCount(maxAfx);
  if (n <= 0) return e;
  const pool = AFX_KEYS.slice();
  let tag = '';
  for (let i = 0; i < n; i++) {
    const key = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const d = AFX_DEFS[key];
    e[d.flag] = 1;
    tag = d.label + (tag ? ' ' : '') + tag;
    e.name = d.pre + (e.name || 'Foe');
    if (key === 'shielded') {
      e.shieldMax = Math.max(1, Math.round(e.maxHp * 0.25));
      e.shieldHp = e.shieldMax;
      e.shieldRegenT = 0;
    } else if (key === 'warded') {
      e.wardT = 0;
      e.wardCd = 180;
    }
    e.xp = Math.round(e.xp * 1.3);
    e.gold = Math.round(e.gold * 1.3);
  } // reward: +30% xp & gold per affix (drop-quality bump lives in tryDropLoot)
  e._afxN = n;
  e.afxTag = '★ ' + tag + ' ELITE';
  return e;
}
// afxHit — the ONE damage gate for elite affixes. Every player/ally/companion damage site routes its
// hp subtraction through this: e.hp-=afxHit(e,dmg). Non-affixed enemies cost a single falsy check.
function afxHit(e, dmg) {
  if (!e._afxN || dmg <= 0) return dmg;
  if (e.wardT > 0) {
    if (e.hitFlash < 4) e.hitFlash = 4;
    if ((e._wfT || 0) <= 0) {
      e._wfT = 16;
      floatDamage(e.x + e.w / 2, e.y - 4, 'WARDED', '#9ecbff');
    }
    return 0;
  } // WARDED: fully immune inside its ward window (window is timer-bounded — quest targets always reopen)
  if (e.afxShield) {
    e.shieldRegenT = 360; // any hit restarts the ~6s out-of-combat recharge clock
    if (e.shieldHp > 0) {
      const a = e.shieldHp < dmg ? e.shieldHp : dmg;
      e.shieldHp -= a;
      dmg -= a;
      if (e.shieldHp <= 0) {
        e.shieldHp = 0;
        floatDamage(e.x + e.w / 2, e.y - 4, 'SHATTERED', '#7ed2ff');
        spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 10, { color: '#7ed2ff', speed: 2.2, decay: 0.05 });
        Sound.tone && Sound.tone(880, 0.12, 'sine', 0.08, { slideTo: 220 });
      }
      if (dmg <= 0) return 0;
    }
  }
  return dmg;
}
function afxVampHeal(e, dealt) {
  if (!dealt || dealt <= 0 || e.hp <= 0) return;
  const h = Math.min(e.maxHp - e.hp, Math.max(1, Math.round(dealt * 0.4)));
  if (h <= 0) return;
  e.hp += h;
  floatDamage(e.x + e.w / 2, e.y - 4, '+' + h, '#ff5878');
  spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 3, { color: '#c02040', speed: 1.2, up: 0.4, decay: 0.07 });
} // VAMPIRIC: heals ~40% of damage actually dealt to heroes/companions
function enemyStrike(e, amt) {
  const d = playerTakeDamage(amt) || 0;
  if (d > 0 && e.afxVamp) afxVampHeal(e, d);
  return d;
} // contact-damage wrapper: pure passthrough for non-vampiric foes
function afxSplitDeath(e) {
  const base = (e.name || 'Foe')
    .replace(/^(Shielded |Vampiric |Splitting |Warded )+/, '')
    .replace(/^Elite /, '');
  const tx = Math.floor((e.x + e.w / 2) / TILE),
    ty = Math.floor((e.y + e.h / 2) / TILE);
  for (let k = 0; k < 2; k++) {
    const o = findOpenTile(state.map, tx + (k ? 1 : -1), ty);
    const hp = Math.max(1, Math.round(e.maxHp * 0.45));
    const c = {
      x: o.tx * TILE + 6,
      y: o.ty * TILE + 6,
      w: Math.max(14, Math.round(e.w * 0.7)),
      h: Math.max(14, Math.round(e.h * 0.7)),
      type: e.type,
      hp,
      maxHp: hp,
      atk: Math.max(1, Math.round(e.atk * 0.45)),
      def: Math.floor((e.def || 0) * 0.45),
      speed: (e.speed || 1) * 1.05,
      xp: Math.max(1, Math.round(e.xp * 0.06)),
      gold: Math.max(1, Math.round(e.gold * 0.06)),
      color: e.color,
      name: 'Lesser ' + base,
      hitFlash: 0,
      attackCd: 26,
      castCd: 0,
      caster: false,
      isBoss: false,
      wobble: Math.random() * 6.28,
      _splitChild: 1,
    };
    if (e.homeDf !== undefined) c.homeDf = e.homeDf;
    if (e.aquatic) c.aquatic = true; // leash + water AI only — NEVER poiKey/holdKey/raidTown/legion/guardian/cycle/treasure/night (copies must not count as site guardians or inherit Legion identity)
    state.enemies.push(c);
    spawnBurst(c.x + c.w / 2, c.y + c.h / 2, 8, { color: e.color, speed: 1.8, decay: 0.05 });
  }
  addShake(2);
  log(`${e.name} splits apart!`, 'combat');
} // SPLITTING: exactly two lesser copies (~45% stats, scrap rewards); copies never split
function makeElite(e, maxAfx) {
  e.elite = true;
  e.maxHp = Math.round(e.maxHp * 1.7);
  e.hp = e.maxHp;
  e.atk = Math.round(e.atk * 1.3);
  e.def = (e.def || 0) + 1;
  e.w += 4;
  e.h += 4;
  e.xp = Math.round(e.xp * 1.9);
  e.gold = Math.round(e.gold * 1.9);
  e.name = 'Elite ' + e.name;
  rollEliteAffixes(e, maxAfx);
  return e;
}
function spawnPackAround(tx, ty, n, cap) {
  for (let j = 0; j < n; j++) {
    if (state.enemies.length >= cap) break;
    const ox = tx + Math.round((Math.random() - 0.5) * 5),
      oy = ty + Math.round((Math.random() - 0.5) * 5);
    if (ox < 1 || oy < 1 || ox >= OW_W - 1 || oy >= OW_H - 1) continue;
    if (SOLID.has(getTile('overworld', ox, oy)) || isInTown(ox, oy, 1)) continue;
    state.enemies.push(nightBuff(makeWildEnemy(ox, oy, tileBiome(ox, oy))));
  }
}
function maybeSpawnWild() {
  if (state.map !== 'overworld') return;
  state.spawnTimer--;
  if (state.spawnTimer > 0) return;
  state.spawnTimer = isNight() ? 105 : 170;
  const cap = state.maxWildEnemies + (isNight() ? 6 : 0);
  const p = state.player,
    px = Math.floor((p.x + p.w / 2) / TILE),
    py = Math.floor((p.y + p.h / 2) / TILE);
  if (p.sailing) {
    if (state.enemies.filter((e) => e.aquatic).length >= 4) return;
    for (let tries = 0; tries < 24; tries++) {
      const ang = Math.random() * 6.28,
        d = 6 + Math.random() * 5;
      const tx = Math.floor(px + Math.cos(ang) * d),
        ty = Math.floor(py + Math.sin(ang) * d);
      if (tx < 1 || ty < 1 || tx >= OW_W - 1 || ty >= OW_H - 1) continue;
      if (getTile('overworld', tx, ty) !== T.WATER) continue;
      const e = makeEnemy(tx, ty, 'serpent');
      const f = 1 + (state.player.level - 1) * 0.16;
      e.maxHp = Math.round(e.maxHp * f);
      e.hp = e.maxHp;
      e.atk = Math.round(e.atk * f);
      e.xp = Math.round(e.xp * 1.3);
      e.gold = Math.round(e.gold * 1.3);
      if (isNight()) {
        e.atk = Math.round(e.atk * 1.15);
        e.night = true;
      }
      state.enemies.push(e);
      return;
    }
    return;
  }
  if (state.enemies.length >= cap) return;
  // Spawn in a ring around the PLAYER (not anywhere on the huge map) so the world feels alive wherever you
  // roam — and since difficulty reads the tile's distFactor, spawns automatically match the ring you're in.
  for (let tries = 0; tries < 34; tries++) {
    let tx, ty;
    if (tries < 22) {
      const ang = Math.random() * 6.28,
        dd = 10 + Math.random() * 26;
      tx = Math.floor(px + Math.cos(ang) * dd);
      ty = Math.floor(py + Math.sin(ang) * dd);
    } else {
      tx = 1 + Math.floor(Math.random() * (OW_W - 2));
      ty = 1 + Math.floor(Math.random() * (OW_H - 2));
    }
    if (tx < 1 || ty < 1 || tx >= OW_W - 1 || ty >= OW_H - 1) continue;
    if (SOLID.has(getTile('overworld', tx, ty))) continue;
    if (isInTown(tx, ty, 2)) continue;
    if (Math.abs(tx - px) < 7 && Math.abs(ty - py) < 6) continue;
    const df = distFactor(tx, ty);
    const lead = nightBuff(makeWildEnemy(tx, ty, tileBiome(tx, ty)));
    const packChance = (df < RING_SAFE ? 0.4 : 0.12 + df * 0.55) + (isNight() ? 0.12 : 0);
    if (Math.random() < packChance) {
      if (df >= RING_MID && Math.random() < 0.5) makeElite(lead);
      state.enemies.push(lead);
      const size = 1 + Math.floor(Math.random() * (2 + Math.round(df * 4) + (isNight() ? 1 : 0)));
      spawnPackAround(tx, ty, size, cap);
    } else {
      state.enemies.push(lead);
    }
    return;
  }
}
function updateCamera() {
  const p = state.player,
    m = maps[state.map],
    mapW = m[0].length * TILE,
    mapH = m.length * TILE;
  state.camera.x =
    mapW <= __g.VIEW_W
      ? (mapW - __g.VIEW_W) / 2
      : clamp(p.x + p.w / 2 - __g.VIEW_W / 2, 0, mapW - __g.VIEW_W);
  state.camera.y =
    mapH <= __g.VIEW_H
      ? (mapH - __g.VIEW_H) / 2
      : clamp(p.y + p.h / 2 - __g.VIEW_H / 2, 0, mapH - __g.VIEW_H);
}

// ================= RENDER =================
function drawTile(t, sx, sy, biome) {
  if (biome === 1) {
    switch (t) {
      case T.GRASS:
      case T.FLOWER:
      case T.SAND:
        ctx.fillStyle = '#dbe6f1';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#c8d6e6';
        ctx.fillRect(sx + 6, sy + 9, 3, 3);
        ctx.fillRect(sx + 20, sy + 18, 3, 3);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx + 14, sy + 24, 2, 2);
        return;
      case T.PATH:
        ctx.fillStyle = '#c2ccd8';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#b0bbc8';
        ctx.fillRect(sx + 4, sy + 6, 4, 4);
        ctx.fillRect(sx + 22, sy + 20, 4, 4);
        return;
      case T.TREE:
        ctx.fillStyle = '#dbe6f1';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#5a3a1a';
        ctx.fillRect(sx + 14, sy + 19, 5, 11);
        ctx.fillStyle = '#2c5642';
        ctx.beginPath();
        ctx.moveTo(sx + 16, sy + 3);
        ctx.lineTo(sx + 6, sy + 21);
        ctx.lineTo(sx + 26, sy + 21);
        ctx.fill();
        ctx.fillStyle = '#eef4fb';
        ctx.beginPath();
        ctx.moveTo(sx + 16, sy + 3);
        ctx.lineTo(sx + 11, sy + 12);
        ctx.lineTo(sx + 21, sy + 12);
        ctx.fill();
        return;
      case T.WATER:
        ctx.fillStyle = '#aacdec';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.strokeStyle = '#84b0d8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx + 4, sy + 7);
        ctx.lineTo(sx + 15, sy + 13);
        ctx.lineTo(sx + 9, sy + 25);
        ctx.stroke();
        return;
      case T.BRIDGE:
        ctx.fillStyle = '#aacdec';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#8a6a3a';
        ctx.fillRect(sx, sy + 5, TILE, 22);
        ctx.fillStyle = '#eef4fb';
        ctx.fillRect(sx, sy + 5, TILE, 3);
        return;
      case T.HOUSE:
        ctx.fillStyle = '#dbe6f1';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#6a4a3a';
        ctx.fillRect(sx, sy + 12, TILE, TILE - 12);
        ctx.fillStyle = '#eef4fb';
        ctx.beginPath();
        ctx.moveTo(sx, sy + 13);
        ctx.lineTo(sx + 16, sy + 1);
        ctx.lineTo(sx + 32, sy + 13);
        ctx.fill();
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(sx + 12, sy + 19, 8, 11);
        ctx.fillStyle = '#f0d050';
        ctx.fillRect(sx + 4, sy + 17, 5, 5);
        ctx.fillRect(sx + 23, sy + 17, 5, 5);
        return;
    }
  }
  if (biome === 2) {
    switch (t) {
      case T.GRASS:
      case T.FLOWER:
      case T.SAND:
      case T.PATH:
        ctx.fillStyle = '#3a2420';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#52312a';
        ctx.fillRect(sx + 5, sy + 8, 4, 4);
        ctx.fillRect(sx + 19, sy + 18, 4, 4);
        ctx.fillStyle = '#1e1410';
        ctx.fillRect(sx + 13, sy + 24, 3, 3);
        return;
      case T.WATER: {
        const g = Math.sin(Date.now() / 280 + sx * 0.1) * 0.2 + 0.8;
        ctx.fillStyle = '#c82808';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = `rgba(255,${Math.floor(120 * g + 40)},20,0.95)`;
        ctx.fillRect(sx + 3, sy + 4, TILE - 6, TILE - 8);
        ctx.fillStyle = '#ffe070';
        ctx.fillRect(sx + 6, sy + 9, 5, 3);
        ctx.fillRect(sx + 18, sy + 18, 5, 3);
        return;
      }
      case T.BRIDGE:
        ctx.fillStyle = '#c82808';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#6a4a2a';
        ctx.fillRect(sx, sy + 5, TILE, 22);
        return;
      case T.TREE:
        ctx.fillStyle = '#3a2420';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#1a1010';
        ctx.fillRect(sx + 13, sy + 10, 6, 18);
        ctx.fillStyle = '#2a1a14';
        ctx.fillRect(sx + 8, sy + 9, 16, 4);
        return;
      case T.HOUSE:
        ctx.fillStyle = '#3a2420';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#5a3020';
        ctx.fillRect(sx, sy + 12, TILE, TILE - 12);
        ctx.fillStyle = '#7a2a18';
        ctx.beginPath();
        ctx.moveTo(sx, sy + 13);
        ctx.lineTo(sx + 16, sy + 1);
        ctx.lineTo(sx + 32, sy + 13);
        ctx.fill();
        ctx.fillStyle = '#1a0e0a';
        ctx.fillRect(sx + 12, sy + 19, 8, 11);
        ctx.fillStyle = '#ff9020';
        ctx.fillRect(sx + 4, sy + 17, 5, 5);
        ctx.fillRect(sx + 23, sy + 17, 5, 5);
        return;
    }
  }
  const _wtx = Math.round((sx + state.camera.x) / TILE),
    _wty = Math.round((sy + state.camera.y) / TILE);
  const th = ((_wtx * 73856093) ^ (_wty * 19349663)) >>> 0; // stable per-WORLD-tile hash (v2.34.0)
  switch (t) {
    case T.GRASS:
      {
        const sh = th % 3;
        ctx.fillStyle = sh === 0 ? '#487a38' : sh === 1 ? '#4d8140' : '#447434';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#558840';
        ctx.fillRect(sx + 4 + (th % 16), sy + 5 + ((th >> 3) % 16), 2, 4);
        ctx.fillRect(sx + 3 + ((th >> 5) % 20), sy + 4 + ((th >> 7) % 20), 2, 3);
        if (th % 5 === 0) {
          ctx.fillStyle = '#3f6e30';
          ctx.fillRect(sx + 5 + ((th >> 4) % 18), sy + 6 + ((th >> 6) % 18), 3, 2);
        }
        if (th % 11 === 0) {
          ctx.fillStyle = '#5f9448';
          ctx.fillRect(sx + 8 + ((th >> 8) % 14), sy + 9 + ((th >> 9) % 14), 2, 2);
        }
      }
      break;
    case T.FLOWER:
      {
        const sh = th % 3;
        ctx.fillStyle = sh === 0 ? '#487a38' : sh === 1 ? '#4d8140' : '#447434';
        ctx.fillRect(sx, sy, TILE, TILE);
        const cols = ['#e860a0', '#f0d050', '#60a0e0', '#f0f0e8'];
        const c1 = cols[th % 4],
          c2 = cols[(th >> 2) % 4];
        ctx.fillStyle = '#3f6e30';
        ctx.fillRect(sx + 9, sy + 11, 2, 6);
        ctx.fillRect(sx + 19, sy + 17, 2, 6);
        ctx.fillStyle = c1;
        ctx.fillRect(sx + 7, sy + 7, 6, 6);
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx + 9, sy + 9, 2, 2);
        ctx.fillStyle = c2;
        ctx.fillRect(sx + 17, sy + 13, 6, 6);
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx + 19, sy + 15, 2, 2);
      }
      break;
    case T.TREE:
      {
        const sh = th % 3;
        ctx.fillStyle = sh === 0 ? '#487a38' : sh === 1 ? '#4d8140' : '#447434';
        ctx.fillRect(sx, sy, TILE, TILE);
        const j = (th % 5) - 2;
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.beginPath();
        ctx.ellipse(sx + 16, sy + 28, 10 + j * 0.5, 3.4, 0, 0, 6.28);
        ctx.fill();
        ctx.fillStyle = '#4a2e14';
        ctx.fillRect(sx + 13, sy + 17, 6, 13);
        ctx.fillStyle = '#6a4422';
        ctx.fillRect(sx + 14, sy + 17, 2, 13);
        ctx.fillStyle = '#224e1a';
        ctx.beginPath();
        ctx.arc(sx + 16, sy + 13, 12 + j * 0.6, 0, 6.28);
        ctx.fill();
        ctx.fillStyle = '#2f6524';
        ctx.beginPath();
        ctx.arc(sx + 14 + j, sy + 11, 9 + j * 0.4, 0, 6.28);
        ctx.fill();
        ctx.fillStyle = '#3f7a30';
        ctx.beginPath();
        ctx.arc(sx + 11 + j, sy + 8, 5, 0, 6.28);
        ctx.fill();
        if (th % 7 === 0) {
          ctx.fillStyle = '#57944a';
          ctx.fillRect(sx + 9 + j, sy + 6, 2, 2);
        }
      }
      break;
    case T.WATER:
      {
        if (isWinter()) {
          ctx.fillStyle = '#cde2ee';
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.strokeStyle = '#a8c6d8';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx + 3, sy + 6);
          ctx.lineTo(sx + 14, sy + 11);
          ctx.lineTo(sx + 10, sy + 24);
          ctx.stroke();
          ctx.fillStyle = '#eaf4fb';
          ctx.fillRect(sx + 18, sy + 5, 7, 2);
          break;
        }
        ctx.fillStyle = '#264f86';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#2a5a9a';
        ctx.fillRect(sx, sy, TILE, 14);
        const wob = Math.sin(Date.now() / 420 + _wtx * 0.7 + _wty * 0.4) * 2.4;
        ctx.fillStyle = 'rgba(120,170,220,0.5)';
        ctx.fillRect(sx + 3 + (th % 6), sy + 7 + wob, 11, 2);
        ctx.fillRect(sx + 16 + ((th >> 3) % 6), sy + 19 - wob, 10, 2);
        const gl = Math.sin(Date.now() / 240 + th) * 0.5 + 0.5;
        ctx.fillStyle = 'rgba(230,244,255,' + (gl * 0.5).toFixed(2) + ')';
        ctx.fillRect(sx + 6 + ((th >> 4) % 18), sy + 5 + ((th >> 6) % 20), 3, 2);
      }
      break;
    case T.MOUNTAIN:
      {
        const j = (th % 5) - 2;
        ctx.fillStyle = '#63636c';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#4c4c55';
        ctx.beginPath();
        ctx.moveTo(sx + 16 + j, sy + 3);
        ctx.lineTo(sx + 3, sy + 29);
        ctx.lineTo(sx + 29, sy + 29);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#5b5b64';
        ctx.beginPath();
        ctx.moveTo(sx + 16 + j, sy + 3);
        ctx.lineTo(sx + 29, sy + 29);
        ctx.lineTo(sx + 16, sy + 29);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#eef0f5';
        ctx.beginPath();
        ctx.moveTo(sx + 16 + j, sy + 3);
        ctx.lineTo(sx + 11 + j, sy + 13);
        ctx.lineTo(sx + 21 + j, sy + 13);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(sx, sy, TILE, 4);
      }
      break;
    case T.PATH:
      {
        ctx.fillStyle = '#a89060';
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#9a8354';
        ctx.fillRect(sx + 2 + (th % 12), sy + 4 + ((th >> 3) % 16), 5, 3);
        ctx.fillRect(sx + 14 + ((th >> 5) % 10), sy + 16 + ((th >> 7) % 10), 5, 3);
        ctx.fillStyle = '#b39c6c';
        ctx.fillRect(sx + 6 + ((th >> 4) % 16), sy + 10 + ((th >> 6) % 14), 4, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(sx, sy, TILE, 3);
      }
      break;
    case T.SAND:
      ctx.fillStyle = '#d8c890';
      ctx.fillRect(sx, sy, TILE, TILE);
      break;
    case T.HOUSE:
      ctx.fillStyle = '#7a4a2a';
      ctx.fillRect(sx, sy + 10, TILE, TILE - 10);
      ctx.fillStyle = '#a05030';
      ctx.beginPath();
      ctx.moveTo(sx, sy + 12);
      ctx.lineTo(sx + 16, sy);
      ctx.lineTo(sx + 32, sy + 12);
      ctx.fill();
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(sx + 12, sy + 18, 8, 12);
      ctx.fillStyle = '#f0d050';
      ctx.fillRect(sx + 4, sy + 16, 5, 5);
      ctx.fillRect(sx + 23, sy + 16, 5, 5);
      break;
    case T.DUNGEON_ENTRANCE:
      ctx.fillStyle = '#4a7c3a';
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = '#3a3a44';
      ctx.beginPath();
      ctx.moveTo(sx + 6, sy + 30);
      ctx.lineTo(sx + 6, sy + 14);
      ctx.arc(sx + 16, sy + 14, 10, 3.14, 0);
      ctx.lineTo(sx + 26, sy + 30);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(sx + 10, sy + 30);
      ctx.lineTo(sx + 10, sy + 16);
      ctx.arc(sx + 16, sy + 16, 6, 3.14, 0);
      ctx.lineTo(sx + 22, sy + 30);
      ctx.fill();
      ctx.fillStyle = '#f0a020';
      ctx.font = '12px monospace';
      ctx.fillText('▼', sx + 12, sy + 12);
      break;
    case T.BRIDGE:
      ctx.fillStyle = '#2a5a9a';
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(sx, sy + 4, TILE, 24);
      ctx.fillStyle = '#6a4a2a';
      for (let i = 0; i < 4; i++) ctx.fillRect(sx + i * 8, sy + 4, 2, 24);
      break;
    case T.D_FLOOR:
      {
        const TH = state.dungeonThemeData || DUNGEON_THEMES[0];
        ctx.fillStyle = TH.floor;
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = TH.floor2;
        ctx.fillRect(sx + 1 + (th % 3), sy + 1 + ((th >> 2) % 3), 14, 14);
        ctx.fillRect(sx + 17 - ((th >> 4) % 3), sy + 17 - ((th >> 5) % 3), 14, 14);
        if (th % 6 === 0) {
          ctx.strokeStyle = 'rgba(0,0,0,0.28)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx + 5 + (th % 10), sy + 7 + ((th >> 3) % 12));
          ctx.lineTo(sx + 13 + (th % 10), sy + 15 + ((th >> 3) % 12));
          ctx.stroke();
        }
        if (th % 9 === 0) {
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = TH.accent;
          ctx.fillRect(sx + 7 + ((th >> 6) % 16), sy + 9 + ((th >> 7) % 14), 3, 3);
          ctx.globalAlpha = 1;
        }
      }
      break;
    case T.D_WALL:
      {
        const TH = state.dungeonThemeData || DUNGEON_THEMES[0];
        ctx.fillStyle = TH.wall2;
        ctx.fillRect(sx, sy, TILE, TILE);
        for (let row = 0; row < 3; row++) {
          const ry = sy + 1 + row * 10;
          const split = 7 + ((th >> (row * 3)) % 14);
          ctx.fillStyle = row % 2 ? TH.wall3 : TH.wall;
          ctx.fillRect(sx + 1, ry, split, 9);
          ctx.fillRect(sx + split + 3, ry, 28 - split, 9);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(sx, sy, TILE, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(sx, sy + TILE - 2, TILE, 2);
      }
      break;
    case T.D_PIT:
      {
        const TH = state.dungeonThemeData || DUNGEON_THEMES[0];
        if (TH.pitKind === 'lava') {
          ctx.fillStyle = TH.pit;
          ctx.fillRect(sx, sy, TILE, TILE);
          const fl = 0.45 + Math.sin(Date.now() / 220 + sx * 0.3 + sy * 0.2) * 0.3;
          ctx.globalAlpha = Math.max(0, fl);
          ctx.fillStyle = TH.pit2;
          ctx.fillRect(sx + 3, sy + 3, 26, 26);
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#ffe070';
          ctx.fillRect(sx + 9 + Math.sin(Date.now() / 300 + sx) * 4, sy + 11, 4, 3);
        } else if (TH.pitKind === 'void') {
          ctx.fillStyle = TH.pit;
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = TH.pit2;
          ctx.fillRect(sx + 3, sy + 3, 26, 26);
          const tw = Math.sin(Date.now() / 400 + sx * 0.5) * 0.5 + 0.5;
          ctx.fillStyle = 'rgba(176,112,255,' + (tw * 0.6).toFixed(2) + ')';
          ctx.fillRect(sx + 13, sy + 13, 4, 4);
        } else {
          ctx.fillStyle = TH.pit;
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = TH.pit2;
          ctx.fillRect(sx + 4, sy + 4, 24, 24);
        }
      }
      break;
    case T.D_EXIT:
      ctx.fillStyle = '#2a2832';
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = '#5a4a2a';
      ctx.beginPath();
      ctx.moveTo(sx + 6, sy + 30);
      ctx.lineTo(sx + 6, sy + 12);
      ctx.arc(sx + 16, sy + 12, 10, 3.14, 0);
      ctx.lineTo(sx + 26, sy + 30);
      ctx.fill();
      ctx.fillStyle = '#90f0c0';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▲', sx + 16, sy + 22);
      ctx.textAlign = 'left';
      break;
    case T.D_DESCEND:
      ctx.fillStyle = '#2a2832';
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = '#15131c';
      ctx.fillRect(sx + 6, sy + 6, 20, 20);
      ctx.fillStyle = '#3a3542';
      ctx.fillRect(sx + 8, sy + 8, 16, 3);
      ctx.fillRect(sx + 10, sy + 13, 12, 3);
      ctx.fillRect(sx + 12, sy + 18, 8, 3);
      ctx.fillStyle = '#f0a020';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▼', sx + 16, sy + 31);
      ctx.textAlign = 'left';
      break;
    case T.D_DOOR:
      {
        const TH = state.dungeonThemeData || DUNGEON_THEMES[0];
        ctx.fillStyle = TH.wall;
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(sx + 5, sy + 4, 22, 26);
        ctx.fillStyle = '#5a4428';
        ctx.fillRect(sx + 7, sy + 6, 18, 22);
        const gl = 0.5 + Math.sin(Date.now() / 260) * 0.4;
        ctx.fillStyle = 'rgba(255,215,106,' + Math.max(0.15, gl).toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(sx + 16, sy + 15, 3.4, 0, 6.28);
        ctx.fill();
        ctx.fillStyle = '#2a1c10';
        ctx.fillRect(sx + 15, sy + 16, 3, 6);
      }
      break;
    default:
      ctx.fillStyle = '#4a7c3a';
      ctx.fillRect(sx, sy, TILE, TILE);
  }
}
