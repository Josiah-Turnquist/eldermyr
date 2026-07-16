function makePinnacleAdd(pin, isKing, tx, ty, idx) {
  const e = makeEnemy(tx, ty, 'skeleton');
  e.name = isKing ? 'Drowned Dead' : 'Pale Flock';
  e.color = isKing ? '#3f7794' : '#cdddec';
  const lf =
    (1 + Math.max(0, PIN_LEVEL - 5) * 0.13) *
    (1 + (state.ascension || 0) * 0.18) *
    (1 + (partyN() - 1) * 0.28) *
    (1 + (state.pinnacleCycle || 0) * 0.35);
  e.maxHp = Math.round(46 * lf);
  e.hp = e.maxHp;
  e.atk = Math.round((11 + PIN_LEVEL * 0.7) * (1 + (state.ascension || 0) * 0.18));
  e.def = 2 + Math.floor(PIN_LEVEL * 0.15);
  e.xp = Math.round(30 * lf);
  e.gold = Math.round(16 * lf);
  e.speed = isKing ? 1.15 : 1.0;
  e.element = 'frost';
  if (isKing) e.aquatic = true;
  else e.frost = true;
  e._orderIdx = idx;
  e._pinRef = pin;
  e._rezN = 0;
  return e;
} // ordered adds: aquatic 'drowned' (King, water ring) / frozen 'flock' (Shepherd, land); normal enemies otherwise → serialize/partition free   // FLAT at PIN_LEVEL too — the court BELONGS to the encounter, so it scales with the fight (ascension/party-size/cycle still stack), not with whoever walked in

// ===== STAGE B REPLACEMENT POINT: replace this whole placeholder with the drop-pool logic — first kill guarantees
// PINNACLE_BOSSES[*].drops.styleUniq matching the killer's style; re-kills (cycle) roll {styleUniq, universalUniq} +
// reagents. For Stage A it drops solid gold + a legendary-floor loot pickup so the kill is rewarding. =====
function dropPinnacleReward(e, isFirst) {
  const cyc = e.cycle || 0;
  const level = partyLvl() + 8 + cyc * 3;
  const g = 900 + cyc * 450;
  state.player.gold += g;
  const pb = PINNACLE_BOSSES.find((p) => p.key === e.pinKey) || {};
  const dr = pb.drops || {};
  const drops = [];
  if (isFirst) {
    // FIRST kill guarantees the unique matching the KILLER'S style; else the universal one (suits everyone)
    const ks =
      state.player._lastStyle ||
      styleOf(
        equippedWeapon(),
      ); /* _lastStyle rides `me` and is derived from the equipped style each frame — MP-safe (a projectile kill swaps state.player to the shooter but NOT state.inventory, so a raw equippedWeapon() read could hit the wrong bag) */
    const matchStyle =
      dr.style === 'summon'
        ? 'magic'
        : dr.style; /* the Shepherd's summoner drop is a magic weapon → a magic killer matches */
    const u = makeUnique(ks === matchStyle ? dr.styleUniq : dr.universalUniq, level);
    if (u) drops.push(u);
  } else {
    // RE-KILL (cycle): roll the 2-unique pool (both eventually obtainable) + a cycle super-loot legendary (mirrors the hunt cycle branch)
    const pool = [dr.styleUniq, dr.universalUniq].filter(Boolean);
    const u = makeUnique(pool[Math.floor(Math.random() * pool.length)], level);
    if (u) drops.push(u);
    const rIdx = Math.max(4, rollRarity(level, true));
    drops.push(Math.random() < 0.5 ? genWeapon(level, rIdx) : genArmor(level, rIdx));
  }
  const tx = Math.floor((e.x + e.w / 2) / TILE),
    ty = Math.floor((e.y + e.h / 2) / TILE);
  drops.forEach((inner, i) => {
    const item = inner.atk !== undefined ? { weapon: inner } : { armor: inner };
    const o = findOpenTile(state.map, tx + (i % 2), ty + ((i / 2) | 0));
    state.pickups.push(makePickup(o.tx, o.ty, 'loot', item));
  });
  const nm = drops.map((d) => d.name).join(' & ');
  log(`${e.name}'s hoard spills across the ground — ${nm} and ${g} gold!`, 'quest');
}
function pinnacleHazard(e, pcx, pcy) {
  const lx = (e._lairTx != null ? e._lairTx : Math.floor((e.x + e.w / 2) / TILE)) * TILE + 16,
    ly = (e._lairTy != null ? e._lairTy : Math.floor((e.y + e.h / 2) / TILE)) * TILE + 16;
  e.arenaR = Math.max(PIN_ARENA_MIN, (e.arenaR || PIN_ARENA_START) - PIN_ARENA_SHRINK);
  const pdl = Math.hypot(pcx - lx, pcy - ly);
  if (pdl > PIN_LEASH) {
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
    } else e.arenaR = PIN_ARENA_START;
    return true;
  } // wander-home: the acting player abandoned the arena → abort any special, drift back to the lair, reset the ring
  if (pdl > e.arenaR) {
    e._hazT = (e._hazT || 0) - 1;
    if (e._hazT <= 0) {
      e._hazT = 42;
      const isKing = e.pinKey === 'drownedking';
      playerTakeDamage(Math.max(4, Math.round(e.atk * 0.4)));
      state.player.chillT = Math.max(state.player.chillT || 0, 80);
      floatDamage(
        state.player.x + state.player.w / 2,
        state.player.y - 8,
        isKing ? 'DROWNING' : 'THE DARK',
        isKing ? '#2f7fb0' : '#c8d8f0',
      );
      addShake(2);
    }
  } else e._hazT = 0; // outside the shrinking ring: drowning (King) / the killing dark (Shepherd) — throttled dmg+chill on the ACTING player (party-wide pass is Stage C)
  return false;
}
function maybeRespawnPinnacle() {
  if (!state.pinnacleRespawnDay || curDay() < state.pinnacleRespawnDay) return;
  state.pinnacleCycle = (state.pinnacleCycle || 0) + 1;
  state.pinnacleSlain = [];
  state.pinnacleRespawnDay = null;
  log(
    `★ The apex terrors stir anew — the Drowned King and Pale Shepherd return, mightier and richer (Pinnacle cycle ${state.pinnacleCycle}).`,
    'quest',
  );
  Sound.boss && Sound.boss();
} // #cycle: whole roster returns a few days after the FIRST kill, harder & richer (e.cycle stamps the drop tier)
function maybePinnacleBosses() {
  if (state.map !== 'overworld') return;
  if (state._pinCheckT > 0) {
    state._pinCheckT--;
    return;
  }
  state._pinCheckT = 40; // cheap throttle (~every 40 SP frames); Stage C drives this from the room tick
  if (!state.pinnacleSlain) state.pinnacleSlain = [];
  const slain = state.pinnacleSlain;
  for (const pb of PINNACLE_BOSSES) {
    const boss = state.enemies.find((x) => x.isPinnacle && x.pinKey === pb.key);
    const dead = slain.includes(pb.key);
    const lr = pinnacleLair(pb);
    if (pb.night) {
      if (dead) continue; // Pale Shepherd: rises only at NIGHT; melts at dawn when no one's engaged nearby
      if (isNight()) {
        if (!boss) state.enemies.push(makePinnacleBoss(pb, lr.tx, lr.ty));
      } else if (boss) {
        const bx = boss.x + boss.w / 2,
          by = boss.y + boss.h / 2;
        const _pp = party(); // P2/S2: the canonized helper (p22) — identical to the inline idiom this line used to carry
        const near = _pp.some((pl) => Math.hypot(pl.x + pl.w / 2 - bx, pl.y + pl.h / 2 - by) < 520);
        if (!near) {
          for (let i = state.enemies.length - 1; i >= 0; i--) {
            const x = state.enemies[i];
            if (x === boss || x._pinRef === boss) state.enemies.splice(i, 1);
          }
          log('The Pale Shepherd melts into the snow as dawn breaks.', 'lore');
        }
      } /* dawn-melt: keep the Shepherd alive while ANY party member is engaged nearby — the shared phase runs under players[0], so a players[0]-only proximity check would vanish the boss mid-fight for a non-first player (state.players is the MP roster; undefined in SP → falls back to [state.player], byte-identical single-player behaviour) */
    } else {
      if (!dead && !boss) state.enemies.push(makePinnacleBoss(pb, lr.tx, lr.ty));
    } // Drowned King: always broods at his shipwreck isle until slain
  }
}
function flyCanMove(nx, ny, w, h) {
  const m = maps.overworld;
  if (!m) return false;
  const x0 = Math.floor(nx / TILE),
    y0 = Math.floor(ny / TILE),
    x1 = Math.floor((nx + w - 1) / TILE),
    y1 = Math.floor((ny + h - 1) / TILE);
  return x0 >= 0 && y0 >= 0 && x1 < m[0].length && y1 < m.length;
}
function toggleMount() {
  if (!state.dragon.tamed) {
    log('You have no steed — tame the Emberwyrm first.');
    Sound.error();
    return;
  }
  if (state.map !== 'overworld') {
    log('The dragon cannot fly within the dungeon.');
    Sound.error();
    return;
  }
  if (state.sailing) {
    log('You cannot mount while at sea.');
    Sound.error();
    return;
  }
  state.dragon.mounted = !state.dragon.mounted;
  resetFishing();
  recalcStats();
  if (state.dragon.mounted) {
    log('You mount the Emberwyrm and soar! (+speed, +power; fly over peaks & lava)', 'good');
    Sound.tone(180, 0.45, 'sawtooth', 0.18, { slideTo: 520 });
  } else {
    log('You dismount the Emberwyrm.', 'lore');
    Sound.tone(420, 0.3, 'sine', 0.12, { slideTo: 180 });
  }
  updateHUD();
}
function toggleBoat() {
  const p = state.player;
  if (!state.hasBoat) {
    log('You have no boat — seek the Shipwright by the western sea.', 'combat');
    Sound.error();
    return;
  }
  if (state.map !== 'overworld') {
    Sound.error();
    return;
  }
  if (state.dragon.mounted) {
    log('Dismount before you set sail.', 'combat');
    Sound.error();
    return;
  }
  resetFishing();
  const ptx = Math.floor((p.x + p.w / 2) / TILE),
    pty = Math.floor((p.y + p.h / 2) / TILE);
  if (!state.sailing) {
    let dest = null;
    for (let r = 1; r <= 3 && !dest; r++)
      for (let dy = -r; dy <= r && !dest; dy++)
        for (let dx = -r; dx <= r && !dest; dx++) {
          const tx = ptx + dx,
            ty = pty + dy;
          if (isWaterTile(tx, ty) && getTile('overworld', tx, ty) === T.WATER) dest = { tx, ty };
        }
    if (!dest) {
      log('No open water nearby to set sail.', 'combat');
      Sound.error();
      return;
    }
    p.x = dest.tx * TILE + (TILE - p.w) / 2;
    p.y = dest.ty * TILE + (TILE - p.h) / 2;
    state.sailing = true;
    log('⛵ You set sail upon the Sundered Sea. [B] to make landfall.', 'lore');
    Sound.tone(300, 0.4, 'sine', 0.12, { slideTo: 460 });
  } else {
    let dest = null;
    for (let r = 1; r <= 4 && !dest; r++)
      for (let dy = -r; dy <= r && !dest; dy++)
        for (let dx = -r; dx <= r && !dest; dx++) {
          const tx = ptx + dx,
            ty = pty + dy;
          const t = getTile('overworld', tx, ty);
          if (!SOLID.has(t) && t !== T.WATER) dest = { tx, ty };
        }
    if (!dest) {
      log('No shore nearby to make landfall.', 'combat');
      Sound.error();
      return;
    }
    p.x = dest.tx * TILE + (TILE - p.w) / 2;
    p.y = dest.ty * TILE + (TILE - p.h) / 2;
    state.sailing = false;
    log('You make landfall.', 'lore');
    Sound.tone(420, 0.3, 'sine', 0.12, { slideTo: 200 });
  }
  updateHUD();
}
function buyBoat() {
  if (state.hasBoat) {
    log('You already own a boat. Press [B] beside open water to set sail.', 'lore');
    Sound.error();
    return;
  }
  const cost = 250;
  if (state.player.gold < cost) {
    Sound.error();
    log(`A boat costs ${cost} gold — return when you can pay.`, 'combat');
    return;
  }
  state.player.gold -= cost;
  state.hasBoat = true;
  Sound.jingle();
  addShake(2);
  log(
    '★ You acquire a sturdy boat! Press [B] by the water to sail the Sundered Sea and plunder its isles.',
    'quest',
  );
  updateHUD();
  saveGame();
}
function tameDragon(e) {
  if (state.player.level < 20) {
    log('You are not yet mighty enough to tame it (Level 20 required).', 'combat');
    Sound.error();
    return;
  }
  state.dragon.tamed = true;
  addRep('wilds', 45);
  addRep('vigil', 5);
  const i = state.enemies.indexOf(e);
  if (i >= 0) state.enemies.splice(i, 1);
  if (state.quests.dragon) state.quests.dragon.done = true;
  state.quests.main.started = true;
  state.quests.main.hidden = false;
  updateQuests();
  spawnBurst(e.x + e.w / 2, e.y + e.h / 2, 30, { color: '#ff8030', speed: 3, decay: 0.03 });
  log('★ The Emberwyrm submits — it is now your steed! Press [G] to mount and take to the skies.', 'quest');
  log('Beyond the western peaks broods the Mountain Kraken. Only a dragon-rider may reach it.', 'quest');
  Sound.levelup();
  addShake(8);
  saveGame();
}

// ================= ENDGAME & META-PROGRESSION =================
const FINAL_DEPTH = 10;
const LEGACY_KEY = 'eldermyr_legacy';
let legacy = { bestScore: 0, wins: 0, bestDepth: 0, ascension: 0 };
async function loadLegacy() {
  try {
    const v = await SaveStore.get(LEGACY_KEY);
    if (v) {
      const o = JSON.parse(v);
      legacy.bestScore = o.bestScore || 0;
      legacy.wins = o.wins || 0;
      legacy.bestDepth = o.bestDepth || 0;
      legacy.ascension = o.ascension || 0;
    }
  } catch (e) {}
}
function saveLegacy() {
  try {
    SaveStore.set(LEGACY_KEY, JSON.stringify(legacy));
  } catch (e) {}
}
function computeScore() {
  const p = state.player;
  return Math.round(
    (p.level * 120 +
      state.maxDepth * 600 +
      p.gold +
      ((state.legion && state.legion.kills) || 0) * 1000 +
      (state.won ? 6000 : 0)) *
      (1 + (state.ascension || 0) * 0.5),
  );
}
function recordRun(won) {
  const sc = computeScore();
  const newBest = sc > legacy.bestScore;
  if (newBest) legacy.bestScore = sc;
  if (state.maxDepth > legacy.bestDepth) legacy.bestDepth = state.maxDepth;
  if (won) {
    legacy.wins++;
    legacy.ascension = Math.max(legacy.ascension, (state.ascension || 0) + 1);
  }
  saveLegacy();
  return { score: sc, newBest };
}
function legacyLineHtml() {
  if (legacy.bestScore <= 0 && legacy.wins <= 0 && legacy.bestDepth <= 0) return '';
  return `★ Best ${legacy.bestScore} &nbsp;•&nbsp; Wins ${legacy.wins} &nbsp;•&nbsp; Deepest ${legacy.bestDepth}${legacy.ascension > 0 ? ` &nbsp;•&nbsp; Ascension ${legacy.ascension}` : ''}`;
}
function victory() {
  state.scene = 'won';
  state.won = true;
  state.quests.main.done = true;
  updateQuests();
  Sound.levelup();
  const r = recordRun(true);
  try {
    SaveStore.set(SAVE_KEY, JSON.stringify(snapshot()));
  } catch (e) {}
  const ov = document.getElementById('overlay');
  ov.className = '';
  ov.style.display = 'flex';
  const bestTag = r.newBest ? ' <span style="color:#90ff90">(NEW BEST!)</span>' : '';
  ov.innerHTML = `<h1 style="color:#90ffa0">VICTORY</h1><div class="subtitle">~ Morthrax the Deathless is undone ~</div><div class="intro-text">You descended to Depth ${state.maxDepth} and felled Morthrax at level ${state.player.level}.<br><b style="color:#f0d050">Score: ${r.score}${bestTag}</b><br>The realm draws breath — yet darker depths await those who would ascend.</div><div><button class="start-btn continue-btn" onclick="resumeAfterVictory()">DESCEND ONWARD</button><button class="start-btn" onclick="clearSaveAndRestart()">NEW GAME+ (Ascension ${legacy.ascension})</button></div>`;
}
function resumeAfterVictory() {
  document.getElementById('overlay').style.display = 'none';
  state.scene = 'play';
}

function gameOver() {
  state.scene = 'dead';
  Sound.gameover();
  const _run = recordRun(false);
  if (state.nemesis && state.nemesis.alive) nemesisGrows();
  const ov = document.getElementById('overlay');
  ov.className = 'death-screen';
  ov.style.display = 'flex';
  const depthLine = state.maxDepth > 0 ? ` You delved to dungeon depth ${state.maxDepth}.` : '';
  ov.innerHTML = `<h1>YOU HAVE FALLEN</h1><div class="subtitle">~ Darkness claims Eldermyr ~</div><div class="intro-text">You reached level ${state.player.level} with ${state.player.gold} gold before falling.${depthLine}<br><b style="color:#f0d050">Score: ${_run.score}${_run.newBest ? ' <span style="color:#90ff90">(NEW BEST!)</span>' : ''}</b><br>Your last save endures — continue to fight on.</div><div><button class="start-btn continue-btn" onclick="location.reload()">CONTINUE FROM SAVE</button><button class="start-btn" onclick="clearSaveAndRestart()">NEW GAME</button></div>`;
}
async function clearSaveAndRestart() {
  try {
    await SaveStore.remove(SAVE_KEY);
  } catch (e) {}
  location.reload();
}
function confirmNewGame() {
  if (confirm('Start a NEW game? This erases your saved progress.')) clearSaveAndRestart();
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function rectOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function rectDist(a, b) {
  const ax = a.x + a.w / 2,
    ay = a.y + a.h / 2,
    bx = b.x + b.w / 2,
    by = b.y + b.h / 2;
  return Math.hypot(ax - bx, ay - by);
}

function loop() {
  if (state.scene === 'play') {
    if (__g.hitStop > 0) {
      __g.hitStop--;
    } else {
      updateTime();
      updatePlayer();
      updateEnemies();
      updateAllies();
      updateCompanions();
      updateProjectiles();
      maybeSpawnWild();
      maybePinnacleBosses();
      updateParticles();
      updateFires();
      updateWeather();
      updateEvents();
      updateFactionWar();
      updateWarband();
      updateFatigue();
      updateNemesisPresence();
      updateWorldLine();
      updateMusicMood();
      updateAmbience();
    }
  }
  if (
    [
      'play',
      'dialogue',
      'inventory',
      'skills',
      'shop',
      'smith',
      'travel',
      'factions',
      'legion',
      'hunts',
      'trophy',
      'cook',
      'companions',
      'map',
    ].includes(state.scene)
  ) {
    updateCamera();
    applyShake();
    renderWorld();
    drawWayfinder();
    updateMinimap();
    updateHubTabs();
    updateCombatHud();
  }
  requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveGame(true);
});
async function init() {
  const vt = document.getElementById('version-tag');
  if (vt) vt.textContent = GAME_VERSION;
  try {
    Sound.muted = localStorage.getItem('eldermyr_muted') === '1';
  } catch (e) {}
  updateAudioIndicator();
  await loadLegacy();
  const ll = document.getElementById('legacy-line');
  if (ll) ll.innerHTML = legacyLineHtml();
  const sb = document.getElementById('start-btn');
  if (sb && legacy.ascension > 0) sb.textContent = 'NEW GAME+ (Asc ' + legacy.ascension + ')';
  let hasSave = false;
  try {
    const v = await SaveStore.get(SAVE_KEY);
    if (v) hasSave = true;
  } catch (e) {}
  document.getElementById('continue-btn').style.display = hasSave ? 'inline-block' : 'none';
  loop();
}
init();
