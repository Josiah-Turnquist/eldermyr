function updateEnergyBar() {
  const p = state.player;
  document.getElementById('en-fill').style.width = (p.energy / p.maxEnergy) * 100 + '%';
  document.getElementById('en-text').textContent = `${Math.floor(p.energy)} / ${p.maxEnergy}`;
}
function updateHUD() {
  const p = state.player;
  document.getElementById('hp-fill').style.width = (p.hp / p.maxHp) * 100 + '%';
  document.getElementById('hp-text').textContent = `${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`;
  document.getElementById('xp-fill').style.width = (p.xp / p.xpNext) * 100 + '%';
  document.getElementById('xp-text').textContent = `${p.xp} / ${p.xpNext}`;
  updateEnergyBar();
  updateStaminaBar();
  const potCount = state.inventory.items.find((i) => i.name === 'Potion')?.qty || 0;
  document.getElementById('stats-line').innerHTML =
    `LV ${p.level}  <span style="color:#ff9060">⚔${p.atk}</span> <span style="color:#9ad0ff">🛡${p.def}</span>  <span style="color:#f0d050">⬤${p.gold}</span> <span style="color:#ff9090"><svg width="9" height="11" viewBox="0 0 10 12" style="vertical-align:-1px"><path d="M4 0h2v4l2 2.6a3.4 3.4 0 1 1-6 0L4 4V0z" fill="currentColor"/></svg>${potCount}</span>`;
  const w = equippedWeapon();
  const s = styleOf(w);
  const col = { melee: '#ff9060', ranged: '#90e060', magic: '#b070ff' }[s];
  let durHtml = '';
  if (w && w.durMax !== undefined) {
    const frac = (w.dur || 0) / w.durMax;
    const dc = isBroken(w) ? '#ff5050' : frac < 0.3 ? '#f0a040' : '#80b080';
    durHtml = ` <span style="color:${dc}">⛨${isBroken(w) ? 'BROKEN' : w.dur + '/' + w.durMax}</span>`;
  }
  document.getElementById('weap-line').innerHTML =
    `<span style="color:${w ? rarityColor(w.rarity) : '#c0c0d0'}">${w ? w.name : 'Unarmed'}</span> <span style="color:${col}">[${styleLabel(s)} Lv${p.prof[s].lvl}]</span>${w ? elemHtml(w.element) : ''}${durHtml}`;
  document.getElementById('gold-line').textContent =
    state.inventory.keys > 0 ? `🗝 ${state.inventory.keys} keys` : '';
  document.getElementById('skill-line').textContent =
    p.skillPoints > 0 ? `✦ ${p.skillPoints} skill points! (press K in town)` : '';
  document.getElementById('loc-line').textContent =
    state.map === 'dungeon'
      ? `☠ ${(state.dungeonThemeData || {}).name || 'Sunken Dungeon'} — Depth ${state.dungeonLevel}${state.floorMod && FLOOR_MODS[state.floorMod] ? ` · ${FLOOR_MODS[state.floorMod].icon} ${FLOOR_MODS[state.floorMod].name}` : ''}`
      : '⛺ Kingdom of Eldermyr';
}
function updateQuests() {
  const list = document.getElementById('quest-list');
  list.innerHTML = '';
  const q = state.quests;
  const items = [];
  const _hasKey = q.key.done || ((state.inventory && state.inventory.keys) | 0) > 0;
  /* intro quests RETIRE once satisfied: talked-to-Elder, own a key (pickup OR any keys in bag), 5 monsters slain — don't linger as permanent ✓ clutter for a leveled hero */ if (
    !q.talk.done
  )
    items.push({ t: q.talk.name, done: false });
  if (!q.key.hidden && !_hasKey) items.push({ t: 'Find the Dungeon Key', done: false });
  if (!q.slay.done) items.push({ t: `Slay monsters (${q.slay.count}/${q.slay.target})`, done: false });
  if (q.frozen && !q.frozen.hidden) items.push({ t: q.frozen.name, done: q.frozen.done });
  if (q.dragon && !q.dragon.hidden)
    items.push({
      t: q.dragon.done ? 'The Emberwyrm is tamed!' : 'Tame the Emberwyrm (Lv 20, far southeast)',
      done: q.dragon.done,
    });
  if (q.legion && q.legion.started) {
    const lq = q.legion;
    if (lq.stage === 'camps')
      items.push({ t: `⚔ War of the Legion — break the war-camps (${lq.camps}/3)`, done: false });
    else if (lq.stage === 'keeps')
      items.push({
        t: `⚔ War of the Legion — recover Sealstones from ruined keeps (${lq.sealstones}/3)`,
        done: false,
      });
    else if (lq.stage === 'overlord')
      items.push({
        t: `⚔ War of the Legion — confront the Dread Overlord in ${REGION_NAMES[lq.seatRegion]}`,
        done: false,
      });
    else if (lq.stage === 'done') items.push({ t: 'The Dread Legion is broken!', done: true });
  }
  if (q.main.started)
    items.push({
      t: q.main.done
        ? 'The Mountain Kraken is slain!'
        : 'Fly beyond the western peaks & slay the Mountain Kraken',
      done: q.main.done,
    });
  if (state.player.bounty) {
    const b = state.player.bounty; // P2/S12: YOUR contract
    const done = b.progress >= b.target;
    items.push({
      t: `Bounty: ${b.desc} (${Math.min(b.progress, b.target)}/${b.target})` + (done ? ' — claim it!' : ''),
      done,
    });
  }
  if ((state.player.loreFound || []).length > 0)
    items.push({
      t: `Realm-stones discovered: ${state.player.loreFound.length}/9`, // P2/S11: YOUR count
      done: state.player.loreFound.length >= 9,
    });
  if (state.player.maxDepth > 0) items.push({ t: `Deepest depth: ${state.player.maxDepth}`, done: false }); // P2/S12: YOUR record
  items.forEach((it) => {
    const d = document.createElement('div');
    d.className = 'q-item' + (it.done ? ' q-done' : '');
    d.textContent = (it.done ? '✓ ' : '◇ ') + it.t;
    list.appendChild(d);
  });
}

// ================= GAME OVER =================
// ================= DRAGON STEED, WILD DRAGON & MOUNTAIN KRAKEN =================
// The Emberwyrm is a FIXED RUNG at DRAGON_LEVEL, on the pinnacle's MULTIPLICATIVE lf curve (2200*4.25 = 9,350 hp,
// 36*3.5 = 126 atk). Two things were wrong before. (1) It read state.player.level DIRECTLY instead of partyLvl() —
// the only threat in the game that did — so in MP its difficulty was decided by whichever hero happened to be
// swapped in at spawn, i.e. random. A flat level deletes that read entirely. (2) Its curve was ADDITIVE
// (2200+lvl*50), so a flat level alone would have been COSMETIC: level 30 would read 3,700 hp against 3,150 today.
// Multiplicative is what makes the number mean something. 9,350/126 lands it right about where the Drowned King
// stood when he was soloable at 19 — a real fight at the Lv-20 taming gate, and comfortably below the new 75 rung.
// The Lv-20 gate and the 15% subdue threshold are untouched: this still gates the MOUNT, it just earns it now.
const DRAGON_LEVEL = 30;
/* THE ONE SOURCE OF THE WYRM'S COLOUR. Read by makeWildDragon (below) for the wild Emberwyrm's `e.color`,
   and by drawPlayer's mounted-steed block for the tamed one. Both used to hardcode their own tones — which is
   exactly how taming the wyrm handed you a differently-coloured animal. Every other tone on both is DERIVED
   from this via shade(), so there is nothing left to keep in sync: recolour here, recolour both. */
const DRAGON_COLOR = '#e85020';
function makeWildDragon(tx, ty) {
  const e = makeBoss(tx, ty);
  e.type = 'dragon';
  e.isWildDragon = true;
  e.name = 'Emberwyrm';
  e.w = 46;
  e.h = 40;
  e.x = tx * TILE - 7;
  e.y = ty * TILE - 4;
  e.color = DRAGON_COLOR;
  /* NEVER hardcode this tone — drawPlayer's steed reads the same const, and that is the only thing keeping the tamed wyrm the same animal as the wild one */ const lf =
    1 + Math.max(0, DRAGON_LEVEL - 5) * 0.13;
  e.maxHp = Math.round(2200 * lf);
  e.hp = e.maxHp;
  e.atk = Math.round(36 * (1 + Math.max(0, DRAGON_LEVEL - 5) * 0.1));
  e.def = 12;
  e.xp = 420;
  e.gold = 500;
  e.caster = true;
  e.specials = ['slam', 'nova', 'charge'];
  e.specialCd = 150;
  e.subdued = false;
  e.level = DRAGON_LEVEL;
  return e;
}
function makeKraken(tx, ty) {
  const e = makeBoss(tx, ty);
  e.type = 'kraken';
  e.isKraken = true;
  e.isFinalBoss = true;
  e.name = 'The Mountain Kraken';
  e.w = 62;
  e.h = 58;
  e.x = tx * TILE - 15;
  e.y = ty * TILE - 13;
  e.color = '#5566aa';
  const asc = 1 + (state.ascension || 0) * 0.2;
  e.maxHp = Math.round(1500 * asc);
  e.hp = e.maxHp;
  e.atk = Math.round(34 * asc);
  e.def = 12;
  e.xp = 2500;
  e.gold = 2500;
  e.caster = true;
  e.specials = ['slam', 'nova', 'summon', 'charge'];
  e.specialCd = 130;
  return e;
}
// ================= THE GREAT HUNTS — legendary roaming world-beasts =================
const GREAT_HUNTS = [
  {
    key: 'frosttitan',
    name: 'The Frost Titan',
    color: '#bfe9ff',
    element: 'frost',
    where: 'the Frozen Wastes (far north)',
    lair: { tx: 174, ty: 17 },
    hp: 900,
    atk: 26,
    def: 9,
    xp: 900,
    gold: 900,
    specials: ['slam', 'nova', 'charge'],
    reward: {
      weapon: {
        name: 'Titan’s Maul',
        atk: 30,
        style: 'melee',
        cd: 24,
        rarity: 4,
        element: 'frost',
        affixes: [
          { t: 'crit', v: 3, label: '+15% Crit' },
          { t: 'berserk', v: 1, label: 'Berserker' },
        ],
      },
    },
  },
  {
    key: 'stormroc',
    name: 'The Storm Roc',
    color: '#ffe24a',
    element: 'shock',
    where: 'the high wilds (northeast)',
    lair: { tx: 269, ty: 84 },
    hp: 820,
    atk: 24,
    def: 7,
    xp: 850,
    gold: 850,
    specials: ['charge', 'nova', 'summon'],
    reward: {
      weapon: {
        name: 'Stormcaller Bow',
        atk: 26,
        style: 'ranged',
        cd: 24,
        rarity: 4,
        element: 'shock',
        affixes: [
          { t: 'crit', v: 3, label: '+15% Crit' },
          { t: 'lifesteal', v: 2, label: '+2% Lifesteal' },
        ],
      },
    },
  },
  {
    key: 'emberhorn',
    name: 'Emberhorn the Scorched',
    color: '#ff7838',
    element: 'fire',
    where: 'the Emberwaste (far southeast)',
    lair: { tx: 269, ty: 241 },
    hp: 1000,
    atk: 30,
    def: 10,
    xp: 1000,
    gold: 1000,
    specials: ['slam', 'charge', 'nova'],
    reward: {
      armor: {
        name: 'Scaled Aegis of Cinders',
        def: 24,
        rarity: 4,
        affixes: [
          { t: 'evasion', v: 3, label: '+9% Evade' },
          { t: 'lifesteal', v: 2, label: '+2% Lifesteal' },
        ],
      },
    },
  },
  {
    key: 'leviathan',
    name: 'The Tide Leviathan',
    color: '#2ad0c0',
    element: 'frost',
    island: true,
    where: 'an isle in the Sundered Sea (sail to reach it)',
    lair: { tx: 104, ty: 199 },
    hp: 1100,
    atk: 28,
    def: 9,
    xp: 1100,
    gold: 1200,
    specials: ['slam', 'nova', 'summon', 'charge'],
    reward: {
      weapon: {
        name: 'Leviathan’s Trident',
        atk: 32,
        style: 'magic',
        rarity: 4,
        element: 'frost',
        affixes: [
          { t: 'crit', v: 2, label: '+10% Crit' },
          { t: 'lifesteal', v: 3, label: '+3% Lifesteal' },
        ],
      },
    },
  },
];
function partyLvl() {
  return Math.max(state.player.level || 1, state._partyLevel || 0);
}
function partyN() {
  return Math.max(1, state._partyN || 1);
} // #1: server populates _partyN (player count); SP default 1 keeps values identical
function party() {
  return state.players && state.players.length ? state.players : [state.player];
} // P2/S2: THE one definition of the MP-roster idiom (the p23 dawn-melt precedent). The server sets state.players; single-player NEVER does, so this is [state.player] — same array, same draws, byte-identical SP. Converted loops iterate party() in state.players JOIN ORDER (the determinism contract the 2p golden baselines freeze).
function partyIn() {
  const out = [];
  for (const pl of party()) if ((pl.map || state.map) === state.map) out.push(pl);
  return out;
} // P2/S3: party WORLD-SCOPED to whatever world is swapped into the state singletons right now (plan risk #9). The server runs these same fns against the shared overworld AND the party dungeon (world-slot swap), and a hazard that looped the whole roster would hit delvers in overworld coordinates (or vice versa). p.map is server-stamped ('overworld'/'dungeon'); single-player never sets it, so (undefined || state.map) === state.map keeps this [state.player] — byte-identical SP, zero extra RNG draws. Iteration stays JOIN ORDER (party()'s contract).
function actAs(p, fn) {
  const pp = state.player,
    pi = state.inventory;
  state.player = p;
  if (p.inventory) state.inventory = p.inventory;
  try {
    return fn(p);
  } finally {
    state.player = pp;
    state.inventory = pi;
  }
} // P2/S4: THE acting-hero context for per-hero sim phases (canonizes the inline pin p23's pinnacleHazard already ships). Pins ONLY player + inventory — the two slots that survive P2 (plan §1's runAs shape); PP keys keep riding the server's swapInPP until their retirement slices, so an actAs body must not touch state.<PP-key>. Single-player: p === state.player and p.inventory is undefined, so both pins are no-ops — byte-identical. MP callers iterate party() in JOIN ORDER.
function makeGreatBeast(h, tx, ty) {
  const e = makeBoss(tx, ty);
  e.isGreatBeast = true;
  e.huntKey = h.key;
  e.name = h.name;
  e.w = 48;
  e.h = 48;
  e.x = tx * TILE - 12;
  e.y = ty * TILE - 12;
  e.color = h.color;
  e.element = h.element;
  const cyc = state.huntCycle || 0;
  const pn = 1 + (partyN() - 1) * 0.15,
    pnh = 1 + (partyN() - 1) * 0.35,
    cycHp = 1 + cyc * 0.35,
    cycAtk = 1 + cyc * 0.25,
    cycRew = 1 + cyc * 0.4;
  const asc = 1 + (state.ascension || 0) * 0.2;
  const lf = 1 + Math.max(0, partyLvl() - 5) * 0.11;
  const dcf = 1 + distFactor(tx, ty) * 0.7;
  e.maxHp = Math.round(h.hp * asc * lf * dcf * pnh * cycHp);
  e.hp = e.maxHp;
  e.atk = Math.round(
    h.atk * asc * (1 + distFactor(tx, ty) * 0.3) * (1 + Math.max(0, partyLvl() - 5) * 0.09) * pn * cycAtk,
  );
  e.def = h.def + cyc;
  e.xp = Math.round(h.xp * lf * dcf * cycRew);
  e.gold = Math.round(h.gold * lf * dcf * cycRew);
  e.cycle = cyc;
  e.caster = true;
  e.castCd = 120;
  e.specials = h.specials;
  e.specialCd = 140;
  e.level = partyLvl();
  return e;
} // #2: hunt LEVEL tracks party 1:1 — the hp/atk/xp/gold curves above stay as tuning ON TOP of that level (no level offset was ever added to a beast; this just makes the 1:1 explicit)   // #1: damage-vs-level steepened 0.05→0.09 (L1 unchanged, L25 ~2.8× vs old 2.0×) + per-extra-player factor; #2: huntCycle scales hp/atk/rewards, e.cycle stamps the drop tier
function dropGreatBeastReward(e) {
  const h = GREAT_HUNTS.find((x) => x.key === e.huntKey);
  if (!h) return;
  const cyc = e.cycle || 0;
  let item;
  if (cyc > 0) {
    /* re-kill (#2): the fixed one-time trophy does NOT drop again — instead, procedural super-loot with a rarity floor that climbs with the cycle, bonus gold, a guaranteed strong affix, and a rising shot at a pattern weapon */ const level =
      partyLvl() + cyc * 3;
    const rIdx = Math.max(rollRarity(level, true), Math.min(4, 3 + Math.floor(cyc / 2)));
    const inner = Math.random() < 0.5 ? genWeapon(level, rIdx) : genArmor(level, rIdx);
    ensureCycleAffix(inner, rIdx);
    item = inner.atk !== undefined ? { weapon: inner } : { armor: inner };
    if (Math.random() < 0.12 + cyc * 0.06) {
      const pw = rollPatternWeapon();
      if (pw) item = { weapon: pw };
    }
    state.player.gold += 200 + cyc * 150;
  } else {
    if (!h.reward) return;
    item = JSON.parse(JSON.stringify(h.reward));
    if (item.weapon) normItem(item.weapon, true);
    if (item.armor) normItem(item.armor, false);
  }
  const tx = Math.floor((e.x + e.w / 2) / TILE),
    ty = Math.floor((e.y + e.h / 2) / TILE);
  const o = findOpenTile(state.map, tx, ty);
  state.pickups.push(makePickup(o.tx, o.ty, 'loot', item));
}
// ================= PINNACLE BOSSES — the two apex fights (opt-in, clearly lethal) =================
// Mirrors the GREAT_HUNTS spine: a data TABLE + a generator that scales off partyLvl/partyN/ascension/pinnacleCycle,
// telegraph specials, ordered adds, and a shrinking-arena hazard. ALL per-fight state is SCALARS on the enemy
// (arenaR, _nextKill, _hazT, _lairTx/_lairTy, pinKey, cycle; each add carries _orderIdx/_rezN numbers + the _pinRef
// object ref which packScalar drops on the wire) — so a later MP stage serializes the fight for free; deliberately NO
// arrays/objects for per-boss fight-state. NOT isFinalBoss / NOT isKraken (killEnemy never calls victory()); it IS isBoss.
// drops.* keys are carried as DATA only — Stage B implements the named uniques from them.
const PIN_ARENA_START = 360,
  PIN_ARENA_MIN = 100,
  PIN_ARENA_SHRINK = 0.05,
  PIN_LEASH = 980;
// The pinnacle bosses are a FIXED RUNG, not a mirror. They used to bake partyLvl() into their hp/atk/xp/gold,
// so they scaled DOWN to whoever showed up and a level-19 hero could solo both apex terrors with zero problem —
// the fight was never harder than you, so it was never a fight. PIN_LEVEL is what they are, always: you come to
// them, not the other way round. It drives ONLY the level factor; party-size/cycle/ascension/distance still
// multiply on top (a 4-stack still gets a fatter King), and rewards ride the same lf — fixed difficulty, fixed
// (and now much richer) payout. The DROP's item level deliberately still tracks partyLvl() — see dropPinnacleReward.
const PIN_LEVEL = 75;
// ===== PINNACLE CHASE UNIQUES (Pillar 2) — each is a real weapon/armor object shaped like genWeapon/genArmor
// output (so equip/sell/reforge/fuse/temper/inventory all work), carrying a `uniq` tag (persists via normal
// inventory serialization; the smith paths mutate in place and never strip it) + a one-line uniqDesc. The ONE
// build-changing effect is read from a recalcStats-derived p.u* scalar in combat code — never a stat stick. =====
const UNIQUES = {
  leviathanspine: {
    slot: 'weapon',
    style: 'ranged',
    element: 'frost',
    name: 'Leviathan Spine',
    atkMul: 1.2,
    cd: 24,
    uniqDesc: 'Every 3rd hit on a Marked target looses a free frost lance.',
  },
  tidecalleraegis: {
    slot: 'armor',
    name: "Tidecaller's Aegis",
    defMul: 1.22,
    uniqDesc: 'A perfect dodge releases a frost nova.',
  },
  shepherdsbell: {
    slot: 'weapon',
    style: 'magic',
    element: 'frost',
    name: "Shepherd's Bell",
    atkMul: 1.1,
    uniqDesc: '+1 thrall cap; your thralls detonate when they expire.',
  },
  gravewoolcloak: {
    slot: 'armor',
    name: 'Gravewool Cloak',
    defMul: 1.15,
    uniqDesc: 'Stand still ~1.5s to cloak until you act.',
  },
};
function makeUnique(key, level) {
  const U = UNIQUES[key];
  if (!U) return null;
  const L = Math.max(1, level || partyLvl());
  const R = RARITIES[4]; // legendary tier
  if (U.slot === 'weapon') {
    const atk = Math.max(1, Math.round((3 + L * 0.9) * R.mult * (U.atkMul || 1)));
    const it = {
      name: U.name,
      atk,
      style: U.style || 'melee',
      rarity: 4,
      reqLevel: Math.max(1, Math.round(L * 0.5)),
      reqProf: Math.max(1, Math.min(14, Math.round(L * 0.4))),
      dur: R.dur,
      durMax: R.dur,
      equipped: false,
      uniq: key,
      uniqDesc: U.uniqDesc,
      bonus: { stat: 'atk', amount: 4, label: '+4 ATK' },
    };
    if ((U.style || 'melee') === 'melee') it.cd = 22;
    else if (U.style === 'ranged') it.cd = U.cd || 26;
    if (U.element) it.element = U.element;
    return it;
  }
  const def = Math.max(1, Math.round((1.5 + L * 0.5) * R.mult * (U.defMul || 1)));
  return {
    name: U.name,
    def,
    rarity: 4,
    reqLevel: Math.max(1, Math.round(L * 0.5)),
    dur: R.dur,
    durMax: R.dur,
    equipped: false,
    uniq: key,
    uniqDesc: U.uniqDesc,
    bonus: { stat: 'def', amount: 4, label: '+4 DEF' },
  };
}
const PINNACLE_BOSSES = [
  {
    key: 'drownedking',
    name: 'The Drowned King',
    color: '#2f7fb0',
    type: 'kraken',
    island: true,
    where: 'a shipwreck in the Sundered Sea',
    hp: 2600,
    atk: 44,
    def: 14,
    xp: 3200,
    gold: 3400,
    night: false,
    specials: ['pullunder', 'raiseadds', 'nova', 'charge'],
    drops: { style: 'ranged', styleUniq: 'leviathanspine', universalUniq: 'tidecalleraegis' },
  },
  {
    key: 'paleshepherd',
    name: 'The Pale Shepherd',
    color: '#d6e6f2',
    type: 'boss',
    island: false,
    where: 'the Frozen Wastes, by night',
    hp: 2400,
    atk: 46,
    def: 13,
    xp: 3000,
    gold: 3200,
    night: true,
    specials: ['raiseadds', 'nova', 'charge'],
    drops: { style: 'summon', styleUniq: 'shepherdsbell', universalUniq: 'gravewoolcloak' },
  },
];
function pinnacleLair(pb) {
  if (pb.key === 'drownedking')
    return (
      state.drownedLair ||
      (state.islands && state.islands[1] && { tx: state.islands[1].x, ty: state.islands[1].y }) || {
        tx: 120,
        ty: 221,
      }
    );
  return state.shepherdLair || { tx: 250, ty: 22 };
}
function makePinnacleBoss(pb, tx, ty) {
  const e = makeBoss(tx, ty);
  e.isPinnacle = true;
  e.pinKey = pb.key;
  e.type = pb.type;
  e.name = pb.name;
  e.color = pb.color;
  e.w = 54;
  e.h = 54;
  e.x = tx * TILE - 15;
  e.y = ty * TILE - 15;
  e._lairTx = tx;
  e._lairTy = ty;
  e.arenaR = PIN_ARENA_START;
  e._nextKill = 0;
  e._hazT = 0;
  const cyc = state.pinnacleCycle || 0;
  const pn = 1 + (partyN() - 1) * 0.18,
    pnh = 1 + (partyN() - 1) * 0.4,
    cycHp = 1 + cyc * 0.4,
    cycAtk = 1 + cyc * 0.28,
    cycRew = 1 + cyc * 0.45;
  const asc = 1 + (state.ascension || 0) * 0.2;
  const lf = 1 + Math.max(0, PIN_LEVEL - 5) * 0.13;
  const dcf = 1 + distFactor(tx, ty) * 0.7;
  e.maxHp = Math.round(pb.hp * asc * lf * dcf * pnh * cycHp);
  e.hp = e.maxHp;
  e.atk = Math.round(
    pb.atk * asc * (1 + distFactor(tx, ty) * 0.3) * (1 + Math.max(0, PIN_LEVEL - 5) * 0.1) * pn * cycAtk,
  );
  e.def = pb.def + cyc * 2;
  e.xp = Math.round(pb.xp * lf * dcf * cycRew);
  e.gold = Math.round(pb.gold * lf * dcf * cycRew);
  e.cycle = cyc;
  e.caster = true;
  e.castCd = 120;
  e.specials = pb.specials;
  e.specialCd = 150;
  e.level = PIN_LEVEL;
  return e;
} // scaled NOTABLY above a Great Hunt (higher base hp/atk/xp/gold in the table + steeper party/cycle curves); FLAT at PIN_LEVEL (lf 10.1, atk x8.0) — party-size/cycle/ascension/distance still multiply on top
