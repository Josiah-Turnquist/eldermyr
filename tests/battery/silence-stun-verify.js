'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// silence-stun-verify.js — the mini-boss SILENCE + STUN player debuffs (rebuild S1).
// Drives the REAL game headlessly (server/load-game.js + server/world.js), the proven
// combat-nerf-verify.js / ranged-verify.js recipe.
//
//   SILENCE (p.silenceT) — owner-locked scope: blocks abilities + ALL spellcasting AND the
//     mage's BASIC staff/bolt attack; leaves basic MELEE/RANGED attacks, the dodge (mobility)
//     and POTIONS usable. Also binds the offensive momentum dash-strike.
//   STUN (p.stunT) — a full lockout: no movement, no attack of any style, no spell, no ability,
//     no dodge, no potion, until it ticks out.
//   Both are per-hero countdown scalars on state.player (undefined until a boss sets them, like
//     chillT), tick down each sim tick next to chillT, and ride safeClone(me) → HUD pills with
//     NO wire/NAMES/CAPTURE change.
//
// NON-VACUOUS BY CONSTRUCTION: run this file against a PRE-S1 artifact (GAME_HTML=<old dist>)
// and every [CORE] assertion FAILS — a silence/stun that gates nothing gives spells that still
// fire, a hero that still walks, and a HUD with no pills. Run against the S1 tree and they pass.
// (The [CTRL] positive controls — melee/ranged/potion still work under silence — pass on BOTH
// trees; they prove the silence gate is SELECTIVE, not a blanket disable.)
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game.js');
require(REPO + '/server/world.js'); // requiring world.js runs G.startGame()
const S = G.state;
const NS = global.Eldermyr; // the build-generated namespace — updateCombatHud is a NAMES symbol (client-render fn, not in server CAPTURE), reachable here on the SAME state
const CONTENT = global.CONTENT;

let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };
const say = (s) => out.push(s);

// Capture the game's event feed: load-game rewraps the lexical `log` → globalThis.__onLog, so
// every in-sim log() (incl. our guard messages) lands here. Off by default = a no-op feed.
let LOGS = [];
global.__onLog = (m) => { LOGS.push(String(m)); };
const logsHave = (frag) => LOGS.some((l) => l.toLowerCase().includes(frag.toLowerCase()));

function equip(style, element) {
  const p = S.player;
  S.inventory.weapons.forEach((w) => (w.equipped = false));
  const w = { name: 'T-' + style, atk: 30, style, element: element || null, rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true };
  S.inventory.weapons.push(w);
  G.recalcStats();
  p._lastStyle = style;
  return w;
}
// a clean, fully-capable hero with every ability unlocked and no debuff — the baseline each
// sub-test perturbs by setting exactly ONE of silenceT / stunT.
function resetHero() {
  const p = S.player;
  p.silenceT = 0; p.stunT = 0; p.chillT = 0; p.burnT = 0; p.poisonT = 0;
  p.attackCooldown = 0; p.attacking = 0; p.dodge = 0; p.dodgeCd = 0; p.invuln = 0; p.camping = false;
  p.momentum = 0; p.dodgeHits = null; p.whirl = 0; p.ultT = 0; p.blessT = 0; p.foodT = 0;
  p.energy = 100; p.maxEnergy = 100; p.stamina = 100; p.maxStamina = 100;
  p.hp = 200; p.maxHp = 300;
  p.dragon = { tamed: false, mounted: false }; p.sailing = false;
  p.abilities = { whirlwind: true, focus: true, ultimate: true, dominate: true, summon: true };
  p.abilityCd = { whirlwind: 0, focus: 0, ultimate: 0, summon: 0, dominate: 0 };
  for (const k of ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']) G.keys[k] = false;
  S.projectiles = []; S.enemies = []; S.allies = [];
  LOGS = [];
}

// ============================================================================
// SILENCE — blocks abilities + all spellcasting + the magic basic; leaves melee/ranged/potion.
// ============================================================================
say('=== SILENCE: gates abilities + all spellcasting (+ magic basic); spares melee/ranged/dodge/potion ===');

// castSpell (F) — a spell for every style; silence blocks it before any energy is paid.
(function silenceCast() {
  resetHero(); equip('melee'); const p = S.player;
  p.silenceT = 100; const e0 = p.energy; LOGS = [];
  G.castSpell();
  ok('[CORE] silenced castSpell pays no energy (spell blocked)', p.energy === e0, 'energy ' + e0 + '->' + p.energy);
  ok('[CORE] silenced castSpell logs the bound-voice feed line', logsHave('voice is bound'), LOGS.join(' | ') || '(no log)');
})();

// Ultimate (Z) — an active; blocked with cooldown/charge untouched.
(function silenceUlt() {
  resetHero(); equip('melee'); const p = S.player;
  p.silenceT = 100; const e0 = p.energy; LOGS = [];
  G.useUltimate();
  ok('[CORE] silenced Ultimate does not fire (energy + cooldown + ultT untouched)', p.energy === e0 && p.abilityCd.ultimate === 0 && p.ultT === 0, 'e=' + p.energy + ' cd=' + p.abilityCd.ultimate + ' ultT=' + p.ultT);
})();

// Whirlwind (Q).
(function silenceWhirl() {
  resetHero(); equip('melee'); const p = S.player;
  p.silenceT = 100; const e0 = p.energy; LOGS = [];
  G.useWhirlwind();
  ok('[CORE] silenced Whirlwind does not fire (energy + cooldown + whirl untouched)', p.energy === e0 && p.abilityCd.whirlwind === 0 && p.whirl === 0, 'e=' + p.energy + ' cd=' + p.abilityCd.whirlwind + ' whirl=' + p.whirl);
})();

// Battle Focus (R) — a heal; blocked leaves HP unchanged.
(function silenceFocus() {
  resetHero(); equip('melee'); const p = S.player;
  p.hp = p.maxHp - 40; p.silenceT = 100; const h0 = p.hp, e0 = p.energy; LOGS = [];
  G.useFocus();
  ok('[CORE] silenced Battle Focus heals nothing (hp + energy untouched)', p.hp === h0 && p.energy === e0, 'hp ' + h0 + '->' + p.hp);
})();

// Summon Thralls (X) — the guard fires before the no-thralls path, so the feed proves it.
(function silenceSummon() {
  resetHero(); const p = S.player;
  p.silenceT = 100; LOGS = [];
  G.useSummon();
  ok('[CORE] silenced Summon is bound before the thralls check (feed line proves the guard)', logsHave('voice is bound') && !logsHave('no thralls'), LOGS.join(' | ') || '(no log)');
})();

// The MAGIC BASIC attack — owner-locked: silence binds it (a caster is reduced to running/melee).
(function silenceMagicBasic() {
  resetHero(); equip('magic', 'fire'); const p = S.player;
  p.silenceT = 100; const e0 = p.energy; LOGS = [];
  G.tryAttack();
  ok('[CORE] silenced MAGIC basic attack is bound (no shot fired, no energy paid)', p.attacking === 0 && p.energy === e0 && S.projectiles.length === 0, 'attacking=' + p.attacking + ' energy=' + p.energy + ' proj=' + S.projectiles.length);
  ok('[CORE] silenced magic basic logs a bound-voice feed line', logsHave('voice is bound') || logsHave('no spell'), LOGS.join(' | ') || '(no log)');
})();

// ---- SELECTIVITY (positive controls) — these pass on the pre-S1 tree too ----
(function silenceMeleeStillWorks() {
  resetHero(); equip('melee'); const p = S.player;
  p.silenceT = 100; LOGS = [];
  G.tryAttack();
  ok('[CTRL] silenced hero CAN still swing a MELEE basic (attacking triggered)', p.attacking > 0 && !logsHave('voice is bound'), 'attacking=' + p.attacking);
})();
(function silenceRangedStillWorks() {
  resetHero(); equip('ranged'); const p = S.player;
  p.silenceT = 100; LOGS = [];
  G.tryAttack();
  ok('[CTRL] silenced hero CAN still loose a RANGED basic (projectile fired)', S.projectiles.length > 0 && p.attacking > 0, 'proj=' + S.projectiles.length + ' attacking=' + p.attacking);
})();
(function silencePotionStillWorks() {
  resetHero(); const p = S.player;
  S.inventory.items = (S.inventory.items || []).filter((i) => i.name !== 'Potion');
  S.inventory.items.push({ name: 'Potion', qty: 3 });
  p.hp = p.maxHp - 50; p.silenceT = 100; const h0 = p.hp; LOGS = [];
  G.drinkPotion();
  ok('[CTRL] silenced hero CAN still drink a POTION (healed)', p.hp > h0, 'hp ' + h0 + '->' + p.hp);
})();
(function silenceDodgeStillWorks() {
  resetHero(); equip('melee'); const p = S.player;
  p.silenceT = 100; p.dodge = 0; p.dodgeCd = 0; p.stamina = 100; LOGS = [];
  G.doDodge();
  ok('[CTRL] silenced hero CAN still dodge (mobility is not a spell)', p.dodge > 0, 'dodge=' + p.dodge);
})();

// ============================================================================
// STUN — a full lockout: no movement, no attack, no spell, no ability, no dodge, no potion.
// ============================================================================
say('\n=== STUN: full lockout — movement + every action refused until it ticks out ===');

(function stunFreezesMovement() {
  resetHero(); equip('melee'); const p = S.player;
  const x0 = p.x, y0 = p.y;
  p.stunT = 40; G.keys['d'] = true; // hold "move right"
  for (let t = 0; t < 20; t++) G.updatePlayer();
  const frozen = p.x === x0 && p.y === y0;
  G.keys['d'] = false;
  ok('[CORE] a stunned hero cannot move (20 ticks holding a direction → position frozen)', frozen, 'moved dx=' + Math.round(p.x - x0) + ' dy=' + Math.round(p.y - y0));
  // and once the stun is gone the same input DOES move — proves the freeze was the stun, not a stuck hero
  const x1 = p.x; p.stunT = 0; G.keys['d'] = true;
  for (let t = 0; t < 20; t++) G.updatePlayer();
  G.keys['d'] = false;
  ok('[CORE] the SAME input moves the hero once the stun clears (freeze was the stun)', p.x > x1, 'dx after clear=' + Math.round(p.x - x1));
})();

(function stunBlocksAttack() {
  resetHero(); equip('melee'); const p = S.player;
  p.stunT = 40; LOGS = [];
  G.tryAttack();
  ok('[CORE] a stunned hero cannot attack (no swing triggered)', p.attacking === 0 && logsHave('stunned'), 'attacking=' + p.attacking);
})();

(function stunBlocksCast() {
  resetHero(); equip('magic', 'fire'); const p = S.player;
  p.stunT = 40; const e0 = p.energy; LOGS = [];
  G.castSpell();
  ok('[CORE] a stunned hero cannot cast (energy untouched)', p.energy === e0 && logsHave('stunned'), 'energy ' + e0 + '->' + p.energy);
})();

(function stunBlocksDodge() {
  resetHero(); equip('melee'); const p = S.player;
  p.stunT = 40; p.dodge = 0; p.dodgeCd = 0; p.stamina = 100; const st0 = p.stamina;
  G.doDodge();
  ok('[CORE] a stunned hero cannot dodge (no lunge, no stamina spent)', p.dodge === 0 && p.stamina === st0, 'dodge=' + p.dodge + ' stamina=' + p.stamina);
})();

(function stunBlocksAbility() {
  resetHero(); equip('melee'); const p = S.player;
  p.stunT = 40; const e0 = p.energy; LOGS = [];
  G.useUltimate();
  ok('[CORE] a stunned hero cannot use an ability (Ultimate does not fire)', p.energy === e0 && p.abilityCd.ultimate === 0 && logsHave('stunned'), 'e=' + p.energy + ' cd=' + p.abilityCd.ultimate);
})();

(function stunBlocksPotion() {
  resetHero(); const p = S.player;
  S.inventory.items = (S.inventory.items || []).filter((i) => i.name !== 'Potion');
  S.inventory.items.push({ name: 'Potion', qty: 3 });
  p.hp = p.maxHp - 50; p.stunT = 40; const h0 = p.hp; LOGS = [];
  G.drinkPotion();
  ok('[CORE] a stunned hero cannot drink a potion (full lockout — hp untouched)', p.hp === h0 && logsHave('stunned'), 'hp ' + h0 + '->' + p.hp);
})();

// ============================================================================
// TICK-DOWN + INDEPENDENCE — both decrement each sim tick, clamp at 0, and leave chillT alone.
// ============================================================================
say('\n=== TICK-DOWN: silenceT + stunT count down alongside chillT (independent), clamp at 0 ===');
(function tickDown() {
  resetHero(); equip('melee'); const p = S.player;
  p.silenceT = 3; p.stunT = 4; p.chillT = 10;
  for (let t = 0; t < 4; t++) G.updatePlayer();
  ok('[CORE] silenceT ticked to 0 and clamped (started 3, 4 ticks)', p.silenceT === 0, 'silenceT=' + p.silenceT);
  ok('[CORE] stunT ticked to 0 (started 4, 4 ticks)', p.stunT === 0, 'stunT=' + p.stunT);
  ok('[CORE] chillT ticked INDEPENDENTLY, untouched by the new debuffs (10 - 4 = 6)', p.chillT === 6, 'chillT=' + p.chillT);
  // a few more ticks — neither must go negative
  for (let t = 0; t < 5; t++) G.updatePlayer();
  ok('[CORE] silenceT/stunT never go negative (guarded > 0 tick)', p.silenceT === 0 && p.stunT === 0, 's=' + p.silenceT + ' st=' + p.stunT);
})();

// ============================================================================
// HUD PILLS — updateCombatHud renders a 🔇 Silenced and 💫 Stunned pill, hover text from STATUS.
// ============================================================================
say('\n=== HUD: silence/stun pills render in updateCombatHud + STATUS hover rows ===');
(function hudPills() {
  ok('[CORE] STATUS registry carries a Silenced hover row', typeof CONTENT.tables.status.Silenced === 'string' && CONTENT.tables.status.Silenced.length > 0, CONTENT.tables.status.Silenced);
  ok('[CORE] STATUS registry carries a Stunned hover row', typeof CONTENT.tables.status.Stunned === 'string' && CONTENT.tables.status.Stunned.length > 0, CONTENT.tables.status.Stunned);

  resetHero(); const p = S.player;
  p.silenceT = 160; p.stunT = 88; S.scene = 'play';
  // capture what updateCombatHud paints — the qrender precedent: override getElementById to hand
  // it a stable element for #combat-hud, read its innerHTML back.
  const hud = { _sig: null, style: {}, innerHTML: '' };
  const doc = global.document;
  const gEBI = doc.getElementById;
  doc.getElementById = (id) => (id === 'combat-hud' ? hud : gEBI(id));
  try { NS.updateCombatHud(); } finally { doc.getElementById = gEBI; }
  const html = hud.innerHTML || '';
  ok('[CORE] HUD paints a Silenced pill (icon + label + countdown)', html.includes('Silenced') && html.includes('🔇'), html.includes('Silenced') ? 'present' : 'MISSING');
  ok('[CORE] HUD paints a Stunned pill (icon + label + countdown)', html.includes('Stunned') && html.includes('💫'), html.includes('Stunned') ? 'present' : 'MISSING');
  ok('[CORE] the Silenced pill carries its STATUS hover text', html.includes('voice is bound'), html.includes('voice is bound') ? 'present' : 'MISSING');
  // and with neither debuff live, no such pill appears (the pills are debuff-gated, not always-on)
  resetHero(); S.player.silenceT = 0; S.player.stunT = 0; S.scene = 'play';
  const hud2 = { _sig: null, style: {}, innerHTML: '' };
  doc.getElementById = (id) => (id === 'combat-hud' ? hud2 : gEBI(id));
  try { NS.updateCombatHud(); } finally { doc.getElementById = gEBI; }
  ok('[CTRL] no Silenced/Stunned pill when neither debuff is live', !(hud2.innerHTML || '').includes('Silenced') && !(hud2.innerHTML || '').includes('Stunned'), '(clean HUD)');
})();

// ============================================================================
console.log(out.join('\n'));
console.log('\n' + (fail ? 'FAILED' : 'ALL GREEN') + ' — pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
