function updateProjectiles() {
  const p = state.player;
  const _party = partyIn();
  /* P2/S3: hostile shots hit-test EVERY hero in this world (join order — first overlap wins, exactly
     the old players[0]-then-patch priority), retiring world.js's players[1..N] hostile patches in both
     worlds. World-scoped (partyIn, plan risk #9): an overworld arrow must never hit-test a delver's
     dungeon coordinates. Hoisted once per call: players cannot move (or change worlds) mid-pass.
     SP: partyIn() === [state.player] → the loop degenerates to the old single test. */
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const pr = state.projectiles[i];
    if (pr.seek) steerSeek(pr);
    /* Seeker Bolt in-flight soft-steer (magic bolts only carry pr.seek) — O(1)/bolt, cheap falsy skip for every other projectile */ pr.x +=
      pr.vx;
    pr.y += pr.vy;
    pr.life--;
    let dead = pr.life <= 0 || isSolidAt(pr.x, pr.y);
    if (!dead) {
      if (pr.friendly) {
        const po = pr.ownerRef && pr.ownerRef.maxHp !== undefined ? pr.ownerRef : p;
        const _sp = state.player;
        state.player = po;
        /* co-op: hits credit the SHOOTER (crit/lifesteal/prof/XP), not whoever state.player happens to be */ for (const e of [
          ...state.enemies,
        ]) {
          if (pr.hits.includes(e)) continue;
          if (projHitsRect(pr, e)) {
            const _far =
              pr.style === 'ranged' &&
              (pr.x - (po.x + po.w / 2)) ** 2 + (pr.y - (po.y + po.h / 2)) ** 2 > 8 * TILE * (8 * TILE);
            const crit = Math.random() < (po.crit || 0) + (_far ? 0.3 : 0);
            /* DEADEYE: ranged shots landing >8 tiles out gain +crit */ let dmg = Math.max(
              1,
              Math.round((pr.dmg - e.def + Math.floor(Math.random() * 3)) * playerDmgMul() * execMul(e)),
            );
            if (pr.style === 'ranged') dmg = Math.round(dmg * weakMul(e, 'ranged'));
            if (pr.style === 'ranged') {
              const _mn0 = e._markBy === po ? e._markN || 0 : 0;
              if (e._markBy === po) {
                dmg = Math.round(dmg * (1 + 0.15 * (e._markN || 0)));
                e._markN = Math.min(3, (e._markN || 0) + 1);
              } else {
                e._markBy = po;
                e._markN = 1;
              }
              /* QUARRY MARKS: bonus dmg from the marker only, stacks to 3 (per-target state lives on the enemy) */ if (
                pr.uLance &&
                _mn0 < 3 &&
                e._markN >= 3
              ) {
                const _lm = Math.hypot(pr.vx, pr.vy) || 1,
                  _ls = 5.5;
                addProjectile(
                  pr.x,
                  pr.y,
                  (pr.vx / _lm) * _ls,
                  (pr.vy / _lm) * _ls,
                  Math.max(1, Math.round((po.atk || 8) * 0.9)),
                  {
                    friendly: true,
                    kind: 'lance',
                    color: '#5fd8ff',
                    r: 9,
                    life: 70,
                    pierce: 3,
                    style: 'ranged',
                    element: 'frost',
                    ownerRef: po,
                  },
                );
                floatDamage(e.x + e.w / 2, e.y - 16, 'LANCE!', '#5fd8ff');
                spawnBurst(pr.x, pr.y, 8, { color: '#5fd8ff', speed: 2.6, decay: 0.05 });
                Sound.tone && Sound.tone(680, 0.14, 'triangle', 0.12, { slideTo: 1200 });
              }
              /* LEVIATHAN SPINE: the shot that raises a target's Marks to 3 looses a FREE frost lance along the shot line — friendly+pierce, its damage/element run the same afxHit + applyElementOnHit gates; the lance carries no uLance so it can't recurse */ po._lastMarkN =
                e._markN;
              po._markShowT = 180;
              const _pbx = pr.x - (po.x + po.w / 2),
                _pby = pr.y - (po.y + po.h / 2);
              if (_pbx * _pbx + _pby * _pby < 1.5 * TILE * (1.5 * TILE)) {
                const _m = Math.hypot(_pbx, _pby) || 1,
                  _kx = po.x - (_pbx / _m) * 10,
                  _ky = po.y - (_pby / _m) * 10;
                if (canMoveTo(_kx, po.y, po.w, po.h)) po.x = _kx;
                if (canMoveTo(po.x, _ky, po.w, po.h)) po.y = _ky;
              } /* point-blank shove: spacing is the skill */
            }
            if (crit) dmg = Math.round(dmg * 2 * weakMul(e, 'crit'));
            e.hp -= afxHit(e, dmg);
            e.hitFlash = 8;
            pr.hits.push(e);
            const col = crit ? '#fff060' : pr.kind === 'arrow' ? '#ffe0a0' : '#c0a0ff';
            floatDamage(e.x + e.w / 2, e.y, dmg, col);
            spawnBurst(e.x + e.w / 2, e.y + e.h / 2, crit ? 8 : 4, {
              color: col,
              speed: crit ? 2.8 : 1.8,
              decay: 0.06,
            });
            Sound.hit();
            applyElementOnHit(e, pr.element, dmg);
            applyLifesteal(e, dmg);
            if (crit) {
              __g.hitStop = Math.max(__g.hitStop, 3);
              addShake(1.5);
            }
            if (_far) {
              floatDamage(e.x + e.w / 2, e.y - 15, 'DEADEYE!', '#5ce0ff');
              spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 8, { color: '#5ce0ff', speed: 3.4, decay: 0.05 });
              Sound.tone && Sound.tone(940, 0.09, 'square', 0.1, { slideTo: 1500 });
              addShake(1);
              if ((e.hitFlash || 0) < 8) e.hitFlash = 8;
            } /* DEADEYE feedback: a >8-tile shot reads DISTINCTLY (cyan callout + crosshair burst + sharp cue) whether or not it crit — the long-range reward is now visible on the struck foe */
            if (pr.style === 'magic' && hasPerk('magic', 2)) {
              for (const e2 of [...state.enemies]) {
                if (e2 === e || e2.hp <= 0) continue;
                if (Math.hypot(e2.x + e2.w / 2 - (e.x + e.w / 2), e2.y + e2.h / 2 - (e.y + e.h / 2)) < 46) {
                  const sd = Math.max(1, Math.round(dmg * 0.4));
                  e2.hp -= afxHit(e2, sd);
                  e2.hitFlash = 6;
                  floatDamage(e2.x + e2.w / 2, e2.y, sd, '#c0a0ff');
                  if (e2.hp <= 0) killEnemy(e2);
                }
              }
              spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 7, { color: '#c0a0ff', speed: 2.2, decay: 0.06 });
            }
            if (pr.kind === 'arrow' && !pr.rico && hasPerk('ranged', 0)) {
              let b2 = null,
                b2d = 1e9;
              for (const e2 of state.enemies) {
                if (e2 === e || e2.hp <= 0 || pr.hits.includes(e2)) continue;
                const dd = Math.hypot(e2.x + e2.w / 2 - (e.x + e.w / 2), e2.y + e2.h / 2 - (e.y + e.h / 2));
                if (dd < b2d && dd < 7 * TILE) {
                  b2d = dd;
                  b2 = e2;
                }
              }
              if (b2) {
                const ang = Math.atan2(b2.y + b2.h / 2 - (e.y + e.h / 2), b2.x + b2.w / 2 - (e.x + e.w / 2));
                addProjectile(
                  e.x + e.w / 2,
                  e.y + e.h / 2,
                  Math.cos(ang) * 6.5,
                  Math.sin(ang) * 6.5,
                  Math.max(1, Math.round(pr.dmg * 0.6)),
                  {
                    friendly: true,
                    kind: 'arrow',
                    color: '#ffe0a0',
                    r: 4,
                    life: 50,
                    pierce: 0,
                    style: 'ranged',
                    element: pr.element,
                    rico: true,
                    ownerRef: pr.ownerRef,
                  },
                );
              }
            } /* RICOCHET: bounce to a NEARBY un-hit foe — 7 tiles (5.3 was so tight it silently no-op'd; v2.53.1's 12 tiles was a room-clearer that killed foes the player never aimed at, off-screen). Bounce arrow 6.5spd×50life=325px: comfortably covers the 7-tile (224px) search yet CANNOT cross a room. rico:true still caps it at one bounce. */
            if (pr.style) gainProf(pr.style, 1 + Math.floor(dmg / 4));
            if (e.hp <= 0) killEnemy(e);
            if (pr.pierce <= 0) {
              dead = true;
              break;
            } else pr.pierce--;
          }
        }
        state.player = _sp;
      } else {
        for (const pl of _party) {
          if (pl.downed)
            continue; /* bleed-out owns the downed — don't pile on (MP-only field, undefined in SP) */
          if (projHitsRect(pr, pl)) {
            const _sp = state.player,
              _si = state.inventory;
            state.player = pl;
            if (pl.inventory) state.inventory = pl.inventory;
            /* playerTakeDamage reads state.player (+ equipped gear off state.inventory), so pin both
               to the struck hero; SP: self-assignments (pl === state.player), byte-identical. */
            const _pd = playerTakeDamage(pr.dmg) || 0;
            if (_pd > 0 && pr.ownerRef && pr.ownerRef.afxVamp) afxVampHeal(pr.ownerRef, _pd);
            /* vampiric archer/caster elites heal off their landed shots (ownerRef is the shooting ENEMY on hostile projectiles; packScalar drops it on the wire) */ if (
              pr.element === 'frost'
            )
              pl.chillT = Math.max(pl.chillT || 0, 90);
            state.player = _sp;
            state.inventory = _si;
            dead = true;
            break;
          }
        }
      }
    }
    if (dead) {
      if (pr.friendly) projImpact(pr);
      state.projectiles.splice(i, 1);
    }
  }
}

// ================= PICKUPS =================
function checkPickups() {
  const p = state.player;
  for (const pk of state.pickups) {
    if (pk.collected) continue;
    if (rectOverlap(p, pk)) {
      pk.collected = true;
      if (pk.kind === 'gold') {
        p.gold += pk.value;
        Sound.gold();
        spawnBurst(pk.x + 8, pk.y + 8, 8, { color: '#f0d050', speed: 1.6, up: 0.6, grav: 0.1, decay: 0.045 });
        log(`Found ${pk.value} gold!`, 'good');
      } else if (pk.kind === 'potion') {
        state.inventory.items.find((i) => i.name === 'Potion').qty += pk.value;
        Sound.item();
        spawnBurst(pk.x + 8, pk.y + 8, 6, { color: '#ff8080', speed: 1.4, decay: 0.05 });
        log('Found a potion!', 'good');
      } else if (pk.kind === 'key') {
        state.inventory.keys += 1;
        p.gotKey = true;
        state.player.quests.key.done = true;
        updateQuests();
        Sound.jingle();
        spawnBurst(pk.x + 8, pk.y + 8, 14, { color: '#fff2a0', speed: 2, decay: 0.03 });
        log('You found the DUNGEON KEY! Now seek the entrance to the south.', 'quest');
      } else if (pk.kind === 'chest' || pk.kind === 'loot') {
        Sound.item();
        spawnBurst(pk.x + 8, pk.y + 8, 12, { color: '#ffffff', speed: 2, decay: 0.035 });
        const it = pk.value;
        if (it.weapon) {
          normItem(it.weapon, true);
          state.inventory.weapons.push(it.weapon);
          log(
            `✦ ${rarityName(it.weapon.rarity)} ${it.weapon.name} (+${it.weapon.atk} ${styleLabel(styleOf(it.weapon))})! Equip with [I].`,
            pk.kind === 'loot' ? 'quest' : 'good',
          );
        }
        if (it.armor) {
          normItem(it.armor, false);
          state.inventory.armor.push(it.armor);
          log(
            `✦ ${rarityName(it.armor.rarity)} ${it.armor.name} (+${it.armor.def} DEF)! Equip with [I].`,
            pk.kind === 'loot' ? 'quest' : 'good',
          );
        }
        const _uq = (it.weapon && it.weapon.uniq) || (it.armor && it.armor.uniq);
        if (_uq) {
          if (!state.uniquesFound) state.uniquesFound = [];
          if (!state.uniquesFound.includes(_uq)) {
            state.uniquesFound.push(_uq);
            log(`✦ A pinnacle relic — ${(it.weapon || it.armor).name} — is added to your legend.`, 'quest');
          }
        }
        /* uniquesFound: keyed on the item's uniq tag → the Stage-C Trophy Wall reads this durable list */ if (
          pk.frozenCache &&
          state.player.quests.frozen
        ) {
          state.player.quests.frozen.done = true;
          state.player.quests.frozen.hidden = false;
          updateQuests();
          Sound.jingle();
          log('You claim the Frostbrand from the Frozen Cache!', 'quest');
        }
      } else if (pk.kind === 'forage') {
        const k = pk.value;
        gainIngredient(k, 1);
        Sound.item && Sound.item();
        spawnBurst(pk.x + 8, pk.y + 8, 6, {
          color: (INGR[k] || {}).color || '#9d6',
          speed: 1.3,
          up: 0.5,
          decay: 0.06,
        });
        log('Foraged ' + ((INGR[k] || {}).name || k) + '.', 'good');
      }
      updateHUD();
      saveGame();
    }
  }
}

// ================= MOVEMENT =================
function getTile(mapName, tx, ty) {
  const m = maps[mapName];
  if (!m) return T.MOUNTAIN;
  if (ty < 0 || ty >= m.length || tx < 0 || tx >= m[0].length) return T.MOUNTAIN;
  return m[ty][tx];
}
function isSolidAt(px, py) {
  const t = getTile(state.map, Math.floor(px / TILE), Math.floor(py / TILE));
  if (t === T.WATER && state.map === 'overworld' && isWinter()) return false;
  return SOLID.has(t);
}
function canMoveTo(nx, ny, w, h) {
  return (
    !isSolidAt(nx, ny) &&
    !isSolidAt(nx + w - 1, ny) &&
    !isSolidAt(nx, ny + h - 1) &&
    !isSolidAt(nx + w - 1, ny + h - 1)
  );
}
function isWaterTile(tx, ty) {
  const t = getTile('overworld', tx, ty);
  return t === T.WATER || t === T.BRIDGE;
}
function canSailTo(nx, ny, w, h) {
  const c = (x, y) => isWaterTile(Math.floor(x / TILE), Math.floor(y / TILE));
  return c(nx, ny) && c(nx + w - 1, ny) && c(nx, ny + h - 1) && c(nx + w - 1, ny + h - 1);
}
function updatePlayer() {
  const p = state.player;
  let dx = 0,
    dy = 0;
  if (keys['w'] || keys['arrowup']) {
    dy = -1;
    p.dir = 'up';
  } else if (keys['s'] || keys['arrowdown']) {
    dy = 1;
    p.dir = 'down';
  }
  if (keys['a'] || keys['arrowleft']) {
    dx = -1;
    p.dir = 'left';
  } else if (keys['d'] || keys['arrowright']) {
    dx = 1;
    p.dir = 'right';
  }
  p.moving = dx !== 0 || dy !== 0;
  if (dx !== 0 && dy !== 0) {
    dx *= 0.707;
    dy *= 0.707;
  }
  if (p.camping) {
    dx = 0;
    dy = 0;
    p.moving = false;
  }
  const mounted = p.dragon.mounted;
  const move = mounted ? flyCanMove : p.sailing ? canSailTo : canMoveTo;
  if (p.dodge > 0) {
    p.dodge--;
    const dnx = p.x + p.dvx,
      dny = p.y + p.dvy;
    if (move(dnx, p.y, p.w, p.h)) p.x = dnx;
    if (move(p.x, dny, p.w, p.h)) p.y = dny;
    p.moving = true;
    if (p.dodgeHits) {
      const box = { x: p.x, y: p.y, w: p.w, h: p.h };
      const wel = (equippedWeapon() || {}).element;
      const _ds = styleOf(equippedWeapon()) === 'melee' && (p.momentum || 0) >= 5 ? 1.4 : 0.6;
      /* DASH-STRIKE: at full Momentum the melee dodge-roll becomes a hard offensive strike */ for (const e of [
        ...state.enemies,
      ]) {
        if (p.dodgeHits.includes(e) || e.hp <= 0) continue;
        if (rectOverlap(box, e)) {
          p.dodgeHits.push(e);
          const dmg = Math.max(1, Math.round((p.atk * _ds - e.def) * playerDmgMul() * execMul(e)));
          e.hp -= afxHit(e, dmg);
          e.hitFlash = 6;
          if (!e.isBoss) e.stunT = Math.max(e.stunT || 0, 8);
          floatDamage(e.x + e.w / 2, e.y, dmg, '#cfe6ff');
          spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 5, { color: '#cfe6ff', speed: 2, decay: 0.06 });
          applyElementOnHit(e, wel, dmg);
          applyLifesteal(e, dmg);
          Sound.hit();
          if (e.hp <= 0) killEnemy(e);
        }
      }
    }
  } else {
    let spd = p.speed;
    if (mounted) spd *= 1.7;
    else if (p.sailing) spd *= 1.5;
    else if (p.chillT > 0) spd *= 0.55;
    if (!mounted && isExhausted()) spd *= 0.5;
    if (p.blessT > 0 && p.blessType === 'haste') spd *= 1.3;
    if (p.foodT > 0 && p.foodBuff === 'swift') spd *= 1.2;
    const nx = p.x + dx * spd,
      ny = p.y + dy * spd;
    if (move(nx, p.y, p.w, p.h)) p.x = nx;
    if (move(p.x, ny, p.w, p.h)) p.y = ny;
  }
  if (p.chillT > 0) p.chillT--;
  if (p.dodgeCd > 0) p.dodgeCd--;
  if (__g.interactCd > 0) __g.interactCd--;
  if (p.stamina < p.maxStamina) {
    p.stamina = Math.min(p.maxStamina, p.stamina + 0.9);
    updateStaminaBar();
  }
  if (p.attackCooldown > 0) p.attackCooldown--;
  if (p.attacking > 0) p.attacking--;
  if (p.invuln > 0) p.invuln--;
  updateStyleResources();
  /* Pillar 1: momentum/heat decay, riposte/silence/vent timers, style-swap reset, vent-nova completion */ if (
    p.whirl > 0
  )
    p.whirl--;
  if (p.abilityCd.whirlwind > 0) p.abilityCd.whirlwind--;
  if (p.abilityCd.focus > 0) p.abilityCd.focus--;
  if (p.abilityCd.ultimate > 0) p.abilityCd.ultimate--;
  if (p.ultT > 0) p.ultT--;
  if (p.abilityCd.summon > 0) p.abilityCd.summon--;
  if (p.abilityCd.dominate > 0) p.abilityCd.dominate--;
  tickBlessing();
  tickFood();
  tickCampRest();
  tickFishing();
  if (p.fishCd > 0) p.fishCd--; // per-hero cooldown (P2/S7) — runs inside updatePlayer, so `p` IS the acting hero
  if (p.energy < p.maxEnergy) {
    p.energy = Math.min(
      p.maxEnergy,
      p.energy +
        (isExhausted() ? 0.18 : 0.4) +
        (p.bonusFont || 0) * 0.15 +
        (p.foodT > 0 && p.foodBuff === 'energized' ? 0.4 : 0),
    );
    updateEnergyBar();
  }
  if (p.moving) {
    p.animTimer++;
    if (p.animTimer > 8) {
      p.animFrame = (p.animFrame + 1) % 4;
      p.animTimer = 0;
    }
  } else p.animFrame = 0;
  if (p.uCloak) {
    const _acted = p.moving || p.attacking > 0 || p.dodge > 0 || p.whirl > 0 || p.ultT > 0;
    if (_acted) {
      p.cloaked = false;
      p._stillT = 0;
    } else {
      p._stillT = (p._stillT || 0) + 1;
      if (p._stillT >= 90 && !p.cloaked) {
        p.cloaked = true;
        spawnBurst(p.x + p.w / 2, p.y + p.h / 2, 10, { color: '#9fb0d0', speed: 1.2, decay: 0.06 });
        floatDamage(p.x + p.w / 2, p.y - 10, 'CLOAKED', '#c8d4ea');
        Sound.tone && Sound.tone(300, 0.2, 'sine', 0.06, { slideTo: 520 });
      }
    }
  } else {
    p.cloaked = false;
    p._stillT = 0;
  } /* GRAVEWOOL CLOAK: ~1.5s (90 frames) of no move/attack/dodge/ability cloaks you; any action clears both scalars at once (p.cloaked rides `me` to clients like the other player scalars — no adoption line) */
  checkPickups();
  if (state.map === 'overworld') {
    const ftx = Math.floor((p.x + p.w / 2) / TILE),
      fty = Math.floor((p.y + p.h / 2) / TILE);
    const _reg = regionOf(ftx, fty);
    if (state._lastRegion === undefined) state._lastRegion = _reg;
    if (_reg !== state._lastRegion) {
      state._lastRegion = _reg;
      showRegionBanner(REGION_NAMES[_reg].replace(/^the /, '').toUpperCase(), REGION_SUBS[_reg]);
      Sound.tone && Sound.tone(220, 0.35, 'sine', 0.08, { slideTo: 330 });
    }
    if (isFrozenTile(ftx, fty) && !p.enteredFrozen) {
      p.enteredFrozen = true;
      if (state.player.quests.frozen) {
        state.player.quests.frozen.hidden = false;
        updateQuests();
      }
      log(
        'You cross into the Frozen Wastes. The cold bites — a Frostbrand lies buried somewhere in the snow.',
        'lore',
      );
      Sound.tone(330, 0.4, 'sine', 0.12, { slideTo: 160 });
      saveGame();
    }
  }
}
// ================= LIVING WORLD: time, weather, light, rest, fire, events, nemesis =================
const DAY_FRAMES = 21600; // ~6 min/day @60fps
let weatherParts = [];
__g._wasExhausted = false;
// ================= FACTIONS & REPUTATION =================
const FACTIONS = {
  vigil: { name: 'The Vigil', color: '#80c0ff', desc: 'The kingdom & its towns', repName: 'Honor' },
  wilds: { name: 'The Wilds', color: '#80e060', desc: 'Beasts & dragon-kin', repName: 'Kinship' },
  dread: { name: 'The Dread Legion', color: '#e05050', desc: 'Warlords of ruin', repName: 'Infamy' },
};
const REP_TIERS = ['Hostile', 'Neutral', 'Friendly', 'Honored'];
const DREAD_TIERS = ['Unknown', 'Marked', 'Hunted', 'Dreaded'];
function repTierIdx(v) {
  if (v >= 70) return 3;
  if (v >= 30) return 2;
  if (v >= -20) return 1;
  return 0;
}
function dreadTierIdx(v) {
  if (v >= 75) return 3;
  if (v >= 45) return 2;
  if (v >= 20) return 1;
  return 0;
}
function facTierIdx(fac) {
  const v = ((state.player || {}).factions || {})[fac] || 0; // P2/S11: YOUR standing (per-hero) — acting-hero readers (prices, loot, aggro, regen) follow the pin
  return fac === 'dread' ? dreadTierIdx(v) : repTierIdx(v);
}
function facTierName(fac) {
  return (fac === 'dread' ? DREAD_TIERS : REP_TIERS)[facTierIdx(fac)];
}
function addRep(fac, amt) {
  const p = state.player; // P2/S11: rep is per-HERO now — the acting hero's own ledger (kills, POI clears, purchases credit whoever is pinned)
  if (!p.factions) p.factions = { vigil: 0, wilds: 0, dread: 0 };
  const before = p.factions[fac] || 0;
  let v = before + amt;
  v = fac === 'dread' ? Math.max(0, Math.min(100, v)) : Math.max(-100, Math.min(100, v));
  p.factions[fac] = v;
  const ti = fac === 'dread' ? dreadTierIdx : repTierIdx;
  if (ti(v) !== ti(before)) {
    const up = ti(v) > ti(before);
    const F = FACTIONS[fac];
    const names = fac === 'dread' ? DREAD_TIERS : REP_TIERS;
    log(`${F.name}: you are now ${names[ti(v)]}.`, up ? 'good' : 'combat');
    updateWorldLine && updateWorldLine();
  }
}
function addRepParty(fac, amt) {
  // P2/S11: rep events that are PARTY NEWS — liberations (holdings/POIs/town sieges), the
  // war's end, a thrall's raid, the shared-phase systems' awards — shift the realm's opinion
  // of the whole band, so EVERY hero's ledger moves. actAs pins each hero in JOIN ORDER, so
  // addRep writes THEIR factions and a tier-crossing line reaches THEIR feed. Single-player:
  // party() = [state.player] → one iteration, exactly the old addRep (byte-identical).
  for (const pl of party()) actAs(pl, () => addRep(fac, amt));
}
function partyRep(fac) {
  // P2/S11: the party's EFFECTIVE standing wherever the WORLD reacts to the band as a whole
  // (shared-phase reads — faction war, nemesis presence, thrall loyalty, holding raids): the
  // EXTREME member decides. wilds → the most-HATED hero (min: stampedes avenge your worst
  // offender); vigil/dread → the highest hero (the Vigil rallies to its champion, the Legion
  // marks its greatest threat — the plan's maybeRaidHolding "max over party" rule). No RNG,
  // no writes. Single-player: party() = [state.player] → exactly the hero's own value.
  let v = null;
  for (const pl of party()) {
    const x = (pl.factions || {})[fac] || 0;
    v = v === null ? x : fac === 'wilds' ? Math.min(v, x) : Math.max(v, x);
  }
  return v || 0;
}
// Perks derived from standing
function vigilDiscount() {
  return [0, 0, 0.1, 0.2][facTierIdx('vigil')];
}
function wildsFireResist() {
  return [0, 0, 0.25, 0.45][facTierIdx('wilds')];
}
function beastAggroMul() {
  return [1.25, 1, 0.6, 0.35][facTierIdx('wilds')];
}
function dreadLootBonus() {
  return 1 + ((state.player.factions || {}).dread || 0) * 0.005; // P2/S11: the KILLER's infamy prices the spoils (killEnemy runs under the crediting hero's pin)
}
function buyPrice(c) {
  return Math.max(1, Math.round(c * (1 - vigilDiscount())));
}
const NEMESIS_NAMES = [
  'Grukk the Render',
  'Sythe Blackmaw',
  'Karzul Ironjaw',
  'Vexa the Cruel',
  'Mordrek Skullsplitter',
  'Threx Gravecaller',
];
const NEMESIS_TITLES = ['the Hunter', 'the Relentless', 'the Vengeful', 'the Terror', 'Bane of Eldermyr'];

// ---- time / day-night ----
function curDay() {
  return Math.floor(state.time / DAY_FRAMES) + 1;
}
function dayFrac() {
  return (state.time % DAY_FRAMES) / DAY_FRAMES;
}
function darkness() {
  const f = dayFrac();
  if (f < 0.02) return 1;
  if (f < 0.08) return 1 - (f - 0.02) / 0.06;
  if (f < 0.62) return 0;
  if (f < 0.72) return (f - 0.62) / 0.1;
  return 1;
}
function isNight() {
  return darkness() > 0.55;
}
function timeLabel() {
  const hr = Math.floor(dayFrac() * 24 + 6) % 24;
  return (hr % 12 || 12) + (hr < 12 ? 'am' : 'pm');
}
function updateTime() {
  const b = Math.floor(state.time / DAY_FRAMES);
  state.time++;
  if (Math.floor(state.time / DAY_FRAMES) > b) onNewDay();
}
function maybeRespawnDragon() {
  if (state.map !== 'overworld') return;
  // P2/S4 (#116): the wild Emberwyrm returns while ANY hero still has it untamed — one tamed
  // hero no longer parks it for the whole room. Since P2/S10 the steed lives ON the player
  // (every hero — SP literal, MP template, loaded row — carries p.dragon), so the old
  // (p.dragon || state.dragon) singleton fallback is gone with the root key itself.
  if (
    party().every((p) => p.dragon.tamed) ||
    !state.dragonRespawnDay ||
    curDay() < state.dragonRespawnDay
  )
    return;
  if (state.enemies.some((e) => e.isWildDragon)) {
    state.dragonRespawnDay = null;
    return;
  }
  state.enemies.push(makeWildDragon(state.dragonLair.tx, state.dragonLair.ty));
  state.dragonRespawnDay = null;
  log(
    '🔥 The skies over the Emberwaste burn — the Emberwyrm has RETURNED to its lair, mightier than before.',
    'combat',
  );
  Sound.boss && Sound.boss();
}
function onNewDayHero() {
  // Per-HERO daily effects — the caller pins the acting hero (actAs), so state.player IS the
  // hero here. party(), not partyIn(): tribute isn't positional; delvers and downed heroes
  // draw their share too.
  dailyHoldingIncome();
}
function onNewDayWorld() {
  // Once-per-WORLD daily effects: shared rosters, raids, revivals, respawns. Runs AFTER the
  // hero loop, preserving the old single-hero order — tribute lands before the day's raid can
  // besiege the outpost that pays it.
  maybeRaidHolding();
  reviveCompanions();
  maybeRespawnDragon();
  maybeRespawnHunts();
  maybeRespawnLegion();
  maybeRespawnPinnacle();
}
function onNewDay() {
  // P2/S4 (#116) — the World/Hero split. The composition preserves the old body's exact call
  // order (raise -> income -> raid -> revive -> respawns); with party() = [state.player] and
  // actAs a self-pin, single-player runs the byte-identical sequence. In MP, EVERY hero draws
  // the holding income (per-head pay — outposts are party assets, the quests-went-per-player
  // precedent), not just whoever the previous tick last left pinned.
  maybeRaiseNemesis();
  for (const p of party()) actAs(p, onNewDayHero);
  onNewDayWorld();
}
// #2 CYCLES: once the whole roster is cleared, wait a few in-world days, then respawn it harder & richer.
// Persistent counters (huntCycle/legionCycle) ride the save; the enemy's e.cycle (stamped in the generators)
// drives both stat scaling AT SPAWN and the drop-tier branch AT DEATH. One-time rewards (Great-Beast trophy,
// Dawnbreaker) are keyed off cycle===0 / quest.stage==='done', so re-kills never re-grant them.
