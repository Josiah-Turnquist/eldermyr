// src/content/specials.ts — the boss-special registry (P3/S4).
//
// The telegraph triad the DESIGN doc's silent-failure #1 warned about, moved out of the game
// parts into one entry per special: `wind` (windup length, was the p17 `{slam:46,…}[name]`
// table in startBossSpecial), `exec` (the effect, was the execBossSpecial branch, p17:407+),
// and `drawTele` (the telegraph, was the p20 `if (nm===…)` chain). bossSpecials' roster fn
// (p17:378) → BOSS_ROSTER data below (the pick table; the branching stays in the p17 wrapper).
//
// Adding a boss special = one entry here (wind + exec + drawTele) plus its key in SpecialKey
// (types.ts). The game reads specials through CONTENT.specials[name] ONLY: startBossSpecial
// reads `.wind`, execBossSpecial dispatches `.exec(e, actView)`, and the p20 telegraph
// dispatch calls `.drawTele(_DV, e)`. A special missing its drawTele is a missing property at
// author time — never an invisible in-game one-shot.
//
// exec hooks: VERBATIM p17 branch bodies (same op order, same Math.random() draws), with the
// ambient surface arriving through the SpecialActView arg `a` — the only textual change from
// the monolith is `Sound.`→`a.sfx.` and `state.X`→the destructured `X` (audio/roster/player
// are off the purity token grep by name). They mutate the INSTANCE and the live world refs
// they are handed; they never touch a registry row (plan risk #3 — the content-purity canary
// deep-equals live CONTENT against a fresh chunk after a headless run).
// drawTele hooks: pure painters through `v.g2d` (the S3 DrawView surface), reading the boss
// instance only — never a sim write (SpecialDrawn is readonly).
import type { BossRoster, Special, SpecialKey } from './types';

export const SPECIALS: Record<SpecialKey, Special> = {
  slam: {
    wind: 46,
    exec(e, a) {
      const ecx = e.x + e.w / 2,
        ecy = e.y + e.h / 2;
      const { px: pcx, py: pcy, sfx, addShake, spawnRing, playerTakeDamage } = a;
      const R = e.tele ? e.tele.radius : 175;
      addShake(13);
      sfx.tone(70, 0.5, 'sawtooth', 0.26, { slideTo: 38 });
      sfx.noise(0.32, 0.2, { filter: 'lowpass', freq: 220 });
      spawnRing(ecx, ecy, '#ffb050');
      if (Math.hypot(pcx - ecx, pcy - ecy) < R) playerTakeDamage(Math.round(e.atk * 1.3));
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2;
      d.strokeStyle = `rgba(255,150,50,${0.4 + 0.5 * fr})`;
      d.lineWidth = 3;
      d.beginPath();
      d.arc(cx, cy, e.tele.radius * fr, 0, 6.28);
      d.stroke();
      d.fillStyle = `rgba(255,120,30,${0.12 * fr})`;
      d.beginPath();
      d.arc(cx, cy, e.tele.radius * fr, 0, 6.28);
      d.fill();
    },
  },
  charge: {
    wind: 32,
    exec(e, a) {
      const ecx = e.x + e.w / 2,
        ecy = e.y + e.h / 2;
      const { px: pcx, py: pcy, sfx, addShake } = a;
      const ax = e.tele ? e.tele.aimX : pcx,
        ay = e.tele ? e.tele.aimY : pcy;
      const ang = Math.atan2(ay - ecy, ax - ecx);
      e.dash = { vx: Math.cos(ang) * 6, vy: Math.sin(ang) * 6, t: 42 };
      sfx.swing();
      addShake(3);
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2;
      const a = Math.atan2(e.tele.aimY - (e.y + e.h / 2), e.tele.aimX - (e.x + e.w / 2));
      d.strokeStyle = `rgba(255,80,80,${0.5 + 0.4 * fr})`;
      d.lineWidth = 4;
      d.beginPath();
      d.moveTo(cx, cy);
      d.lineTo(cx + Math.cos(a) * 200 * fr, cy + Math.sin(a) * 200 * fr);
      d.stroke();
    },
  },
  nova: {
    wind: 34,
    exec(e, a) {
      const ecx = e.x + e.w / 2,
        ecy = e.y + e.h / 2;
      const { sfx, addProjectile, addShake } = a;
      const n = 12;
      sfx.cast();
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * 6.28;
        addProjectile(ecx, ecy, Math.cos(ang) * 3.1, Math.sin(ang) * 3.1, Math.round(e.atk * 0.7), {
          color: '#ff70b0',
          r: 7,
          life: 260,
        });
      }
      addShake(2);
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2;
      d.strokeStyle = `rgba(255,110,180,${0.4 + 0.5 * fr})`;
      d.lineWidth = 3;
      d.beginPath();
      d.arc(cx, cy, e.w * 0.7 + fr * 34, 0, 6.28);
      d.stroke();
    },
  },
  summon: {
    wind: 40,
    exec(e, a) {
      const ecx = e.x + e.w / 2,
        ecy = e.y + e.h / 2;
      const { sfx, findOpenTile, makeDungeonEnemy, spawnBurst, TILE, map, dungeonLevel, enemies } = a;
      const lvl = dungeonLevel || 1;
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * 6.28 + 0.5;
        const o = findOpenTile(
          map,
          Math.floor((ecx + Math.cos(ang) * 64) / TILE),
          Math.floor((ecy + Math.sin(ang) * 64) / TILE),
        );
        enemies.push(makeDungeonEnemy(o.tx, o.ty, Math.max(1, lvl - 1)));
        spawnBurst(o.tx * TILE + 16, o.ty * TILE + 16, 10, { color: '#c080ff', speed: 1.6, decay: 0.04 });
      }
      sfx.cast();
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2;
      d.fillStyle = `rgba(192,128,255,${0.3 * fr})`;
      d.beginPath();
      d.arc(cx, cy, e.w * 0.85, 0, 6.28);
      d.fill();
    },
  },
  pullunder: {
    wind: 48,
    exec(e, a) {
      const ecx = e.x + e.w / 2,
        ecy = e.y + e.h / 2;
      const { px: pcx, py: pcy, sfx, addShake, spawnRing, addProjectile, floatDamage, player } = a;
      const R = e.tele ? e.tele.radius : 175;
      addShake(11);
      sfx.tone(88, 0.5, 'sawtooth', 0.22, { slideTo: 40 });
      sfx.noise && sfx.noise(0.3, 0.18, { filter: 'lowpass', freq: 200 });
      spawnRing(ecx, ecy, '#2f7fb0');
      const n = 16;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * 6.28;
        addProjectile(ecx, ecy, Math.cos(ang) * 2.8, Math.sin(ang) * 2.8, Math.round(e.atk * 0.72), {
          color: '#5ad0e6',
          r: 8,
          life: 220,
          element: 'frost',
          ownerRef: e,
        });
      }
      if (Math.hypot(pcx - ecx, pcy - ecy) < R * 0.6) {
        player.chillT = Math.max(player.chillT || 0, 150);
        floatDamage(player.x + player.w / 2, player.y - 8, 'DRAGGED UNDER', '#2f7fb0');
      }
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2;
      const rr = e.tele.radius * (1 - fr * 0.7);
      d.strokeStyle = `rgba(60,150,205,${0.45 + 0.5 * fr})`;
      d.lineWidth = 3;
      d.beginPath();
      d.arc(cx, cy, rr, 0, 6.28);
      d.stroke();
      d.fillStyle = `rgba(47,127,176,${0.14 * fr})`;
      d.beginPath();
      d.arc(cx, cy, rr, 0, 6.28);
      d.fill();
      for (let s = 0; s < 6; s++) {
        const a = (s / 6) * 6.28 + fr * 3.4;
        d.strokeStyle = `rgba(120,210,235,${0.5 * fr})`;
        d.beginPath();
        d.arc(cx, cy, rr, a, a + 0.5);
        d.stroke();
      }
    },
  },
  raiseadds: {
    wind: 44,
    exec(e, a) {
      const ecx = e.x + e.w / 2,
        ecy = e.y + e.h / 2;
      const {
        sfx,
        addShake,
        log,
        findOpenTile,
        makePinnacleAdd,
        spawnBurst,
        getTile,
        TILE,
        OW_W,
        OW_H,
        T,
        map,
        enemies,
      } = a;
      if (!enemies.some((x) => x._pinRef === e && x.hp > 0)) {
        const isKing = e.pinKey === 'drownedking';
        const n = 3;
        e._nextKill = 0;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * 6.28 + e.wobble;
          let spot: { tx: number; ty: number } | null = null;
          if (isKing) {
            for (let t2 = 0; t2 < 24 && !spot; t2++) {
              const tx = Math.floor((ecx + Math.cos(ang) * 72 + (Math.random() - 0.5) * 40) / TILE),
                ty = Math.floor((ecy + Math.sin(ang) * 72 + (Math.random() - 0.5) * 40) / TILE);
              if (
                tx > 1 &&
                ty > 1 &&
                tx < OW_W - 1 &&
                ty < OW_H - 1 &&
                getTile('overworld', tx, ty) === T.WATER
              )
                spot = { tx, ty };
            }
          }
          if (!spot)
            spot = findOpenTile(
              map,
              Math.floor((ecx + Math.cos(ang) * 64) / TILE),
              Math.floor((ecy + Math.sin(ang) * 64) / TILE),
            );
          const add = makePinnacleAdd(e, isKing, spot.tx, spot.ty, i);
          enemies.push(add);
          spawnBurst(add.x + add.w / 2, add.y + add.h / 2, 11, { color: add.color, speed: 1.9, decay: 0.045 });
        }
        sfx.cast && sfx.cast();
        addShake(3);
        log(
          isKing
            ? 'The Drowned King calls his drowned court — cut them down in the order they rose, or they rise again!'
            : 'The Pale Shepherd raises his frozen flock — cull them in the order they rose, or the dead return!',
          'combat',
        );
      }
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2;
      d.fillStyle = `rgba(150,190,225,${0.28 * fr})`;
      d.beginPath();
      d.arc(cx, cy, e.w * 0.95, 0, 6.28);
      d.fill();
      d.strokeStyle = `rgba(190,215,240,${0.4 + 0.5 * fr})`;
      d.lineWidth = 2;
      for (let s = 0; s < 3; s++) {
        const a = (s / 3) * 6.28 + e.wobble;
        d.beginPath();
        d.moveTo(cx, cy);
        d.lineTo(cx + Math.cos(a) * e.w * 0.9 * fr, cy + Math.sin(a) * e.w * 0.9 * fr);
        d.stroke();
      }
    },
  },
  // #121 — LEAP: the Archivist blinks to the aim point (never into a wall) and detonates a radial
  // frost burst of PROJECTILES (party-wide by construction — reaches every delver via the dungeon
  // cross-hit loop; a direct playerTakeDamage would hit only the bucketed duelist). The telegraph
  // marker draws at the AIM POINT, not the boss centre (the first special to need that).
  leap: {
    wind: 40,
    exec(e, a) {
      const { px: pcx, py: pcy, sfx, addShake, spawnRing, addProjectile, findOpenTile, map, TILE } = a;
      const ax = e.tele ? e.tele.aimX : pcx,
        ay = e.tele ? e.tele.aimY : pcy;
      const o = findOpenTile(map, Math.floor(ax / TILE), Math.floor(ay / TILE)); // never land in a wall
      e.x = o.tx * TILE - (e.w - TILE) / 2;
      e.y = o.ty * TILE - (e.h - TILE) / 2;
      const cx2 = e.x + e.w / 2,
        cy2 = e.y + e.h / 2;
      const col = e.color || '#7fe0d0';
      addShake(14);
      spawnRing(cx2, cy2, col);
      sfx.tone(60, 0.5, 'sawtooth', 0.28, { slideTo: 34 });
      const n = 14;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * 6.28;
        addProjectile(cx2, cy2, Math.cos(ang) * 3.2, Math.sin(ang) * 3.2, Math.round(e.atk * 0.6), {
          color: col,
          r: 8,
          life: 200,
          element: 'frost',
          ownerRef: e,
        });
      }
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max;
      // the marker sits at the AIM POINT (screen space), not the boss — leap is the first to need it
      const ax = sx + (e.tele.aimX - (e.x + e.w / 2)),
        ay = sy + (e.tele.aimY - (e.y + e.h / 2));
      d.strokeStyle = `rgba(127,224,208,${0.4 + 0.5 * fr})`;
      d.lineWidth = 3;
      d.beginPath();
      d.arc(ax, ay, 40 * fr + 8, 0, 6.28);
      d.stroke();
      d.fillStyle = `rgba(60,160,150,${0.16 * fr})`;
      d.beginPath();
      d.arc(ax, ay, 40 * fr + 8, 0, 6.28);
      d.fill();
    },
  },
  // #121 — CASTVOLLEY: a fanned wall of frost bolts (the storm stance's zoning). Projectiles → all delvers.
  castvolley: {
    wind: 30,
    exec(e, a) {
      const ecx = e.x + e.w / 2,
        ecy = e.y + e.h / 2;
      const { px: pcx, py: pcy, sfx, addProjectile, addShake } = a;
      sfx.cast();
      const base = Math.atan2(pcy - ecy, pcx - ecx);
      const n = 9;
      for (let k = 0; k < n; k++) {
        const ang = base + (k - (n - 1) / 2) * 0.24;
        addProjectile(ecx, ecy, Math.cos(ang) * 3.4, Math.sin(ang) * 3.4, Math.round(e.atk * 0.7), {
          color: '#7fe0d0',
          r: 7,
          life: 260,
          element: 'frost',
          ownerRef: e,
        });
      }
      addShake(3);
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2;
      const base = Math.atan2(e.tele.aimY - (e.y + e.h / 2), e.tele.aimX - (e.x + e.w / 2));
      d.strokeStyle = `rgba(127,224,208,${0.35 + 0.5 * fr})`;
      d.lineWidth = 2;
      for (let k = -4; k <= 4; k++) {
        const ang = base + k * 0.24;
        d.beginPath();
        d.moveTo(cx, cy);
        d.lineTo(cx + Math.cos(ang) * 160 * fr, cy + Math.sin(ang) * 160 * fr);
        d.stroke();
      }
    },
  },
  // #121 — RAISECOURT: the ordered-kill court of level-100 acolytes (reuses killEnemy's _pinRef/
  // _orderIdx/_rezN resurrect verbatim — boss-agnostic, no new kill code). Only raises a fresh wave
  // when the court is clear (gated on `_pinRef===e && hp>0`), matching raiseadds.
  raisecourt: {
    wind: 44,
    exec(e, a) {
      const ecx = e.x + e.w / 2,
        ecy = e.y + e.h / 2;
      const { sfx, addShake, log, findOpenTile, makeCitadelAdd, spawnBurst, TILE, map, enemies } = a;
      if (!enemies.some((x) => x._pinRef === e && x.hp > 0)) {
        const n = 3;
        e._nextKill = 0;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * 6.28 + e.wobble;
          const o = findOpenTile(map, Math.floor((ecx + Math.cos(ang) * 72) / TILE), Math.floor((ecy + Math.sin(ang) * 72) / TILE));
          const add = makeCitadelAdd(e, o.tx, o.ty, i);
          enemies.push(add);
          spawnBurst(add.x + add.w / 2, add.y + add.h / 2, 12, { color: add.color, speed: 1.9, decay: 0.045 });
        }
        sfx.cast && sfx.cast();
        addShake(3);
        log('The Archivist raises its drowned court — cut them down in the ORDER they rose, or they rise again!', 'combat');
      }
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2;
      d.fillStyle = `rgba(90,176,168,${0.3 * fr})`;
      d.beginPath();
      d.arc(cx, cy, e.w * 0.95, 0, 6.28);
      d.fill();
      d.strokeStyle = `rgba(127,224,208,${0.4 + 0.5 * fr})`;
      d.lineWidth = 2;
      for (let s = 0; s < 3; s++) {
        const ang = (s / 3) * 6.28 + e.wobble;
        d.beginPath();
        d.moveTo(cx, cy);
        d.lineTo(cx + Math.cos(ang) * e.w * 0.9 * fr, cy + Math.sin(ang) * e.w * 0.9 * fr);
        d.stroke();
      }
    },
  },
  // S3 — SMITE: the Hierophant marks a hero and drops a RADIANT ZONE on where they stood (dodge OUT of
  // it during the windup). The telegraph draws at the AIM POINT (the leap precedent — screen-space
  // marker), and `radius` (110) rides e.tele.radius so the drawn ring and the damage zone match on
  // BOTH sides (packEnemy wires tele). CRITICAL: a direct-damage AoE reaches only the bucketed duelist
  // unless it loops the world-scoped party — so exec iterates partyIn()+actAs and strikes EVERY hero
  // whose centre is inside the zone (risk #1, the slam-trap; mp-battery proves both heroes are hit).
  smite: {
    wind: 52,
    radius: 110,
    exec(e, a) {
      const { sfx, addShake, spawnRing, spawnBurst, playerTakeDamage, partyIn, actAs } = a;
      const ax = e.tele ? e.tele.aimX : a.px,
        ay = e.tele ? e.tele.aimY : a.py;
      const R = e.tele ? e.tele.radius : 110;
      const dmg = Math.round(e.atk * 1.1);
      addShake(9);
      sfx.tone(880, 0.26, 'sine', 0.14, { slideTo: 300 });
      sfx.noise && sfx.noise(0.22, 0.12, { filter: 'highpass', freq: 900 });
      spawnRing(ax, ay, '#ffe08a');
      spawnBurst(ax, ay, 18, { color: '#ffe08a', speed: 2.6, decay: 0.04 });
      for (const pl of partyIn()) {
        const dx = pl.x + pl.w / 2 - ax,
          dy = pl.y + pl.h / 2 - ay;
        if (dx * dx + dy * dy <= R * R) actAs(pl, () => playerTakeDamage(dmg));
      }
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max;
      // the marker sits at the AIM POINT (screen space), not the boss centre (the leap precedent)
      const ax = sx + (e.tele.aimX - (e.x + e.w / 2)),
        ay = sy + (e.tele.aimY - (e.y + e.h / 2));
      const R = e.tele.radius;
      d.fillStyle = `rgba(255,210,90,${0.12 + 0.16 * fr})`;
      d.beginPath();
      d.arc(ax, ay, R, 0, 6.28);
      d.fill();
      d.strokeStyle = `rgba(255,226,138,${0.4 + 0.5 * fr})`;
      d.lineWidth = 3;
      d.beginPath();
      d.arc(ax, ay, R * (0.35 + 0.65 * fr), 0, 6.28);
      d.stroke();
      d.beginPath();
      for (let s = 0; s < 4; s++) {
        const ang = (s / 4) * 6.28 + fr * 0.5;
        d.moveTo(ax, ay);
        d.lineTo(ax + Math.cos(ang) * R, ay + Math.sin(ang) * R);
      }
      d.stroke();
    },
  },
  // S4 — KEGBURST (the Emberkeg): a TIMED RADIAL EXPLOSION. The longest windup in the game (70 — long =
  // readable; you get time to find a gap), then a full ring of enemy PROJECTILES in all directions
  // (outer + a half-gap-offset inner ring at a slower speed → staggered arrival, the "timed" read).
  // The bolts are party-correct BY CONSTRUCTION (each hits whoever it reaches). The KNOCKBACK is the
  // DIRECT party-wide effect and MUST loop partyIn()+actAs (risk #1, the slam-trap) — a bare
  // playerTakeDamage shoves only the bucketed duelist. Then the keg SELF-STUNS (`e.stunT`): next tick
  // updateEnemiesFor's stun gate parks it — no move, no melee, no special — the vulnerable LULL you
  // punish. Burst/knock/lull tunables ride `e._mech`; the telegraph radius is on the special (`radius`).
  kegburst: {
    wind: 70,
    radius: 120,
    exec(e, a) {
      const ecx = e.x + e.w / 2,
        ecy = e.y + e.h / 2;
      const { sfx, addShake, spawnRing, addProjectile, playerTakeDamage, partyIn, actAs, canMoveTo } = a;
      const M = e._mech || {};
      const n = M.burstN || 13;
      const outSpd = M.burstSpd || 3.0,
        inSpd = M.innerSpd || 2.1;
      const dmg = Math.max(1, Math.round(e.atk * (M.burstDmg || 0.7)));
      addShake(12);
      sfx.tone(70, 0.5, 'sawtooth', 0.26, { slideTo: 200 });
      sfx.noise && sfx.noise(0.3, 0.16, { filter: 'highpass', freq: 700 });
      spawnRing(ecx, ecy, '#ff7838');
      // outer ring (fast) + inner ring offset half a gap (slow) — same tick, staggered arrival
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * 6.283;
        addProjectile(ecx, ecy, Math.cos(ang) * outSpd, Math.sin(ang) * outSpd, dmg, {
          color: '#ff9a3c',
          r: 7,
          life: 240,
          element: 'fire',
          ownerRef: e,
        });
      }
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * 6.283 + 3.1416 / n;
        addProjectile(ecx, ecy, Math.cos(ang) * inSpd, Math.sin(ang) * inSpd, dmg, {
          color: '#ffc060',
          r: 6,
          life: 260,
          element: 'fire',
          ownerRef: e,
        });
      }
      // KNOCKBACK — the DIRECT party-wide effect: loop partyIn()+actAs so EVERY in-range hero is shoved
      // (not just the bucketed duelist). Radial displacement checked through canMoveTo (no wall-cross).
      const knockR = M.knockR || 100,
        kdmg = Math.max(1, Math.round(e.atk * (M.knockDmg || 0.5))),
        push = M.knockPush || 28;
      for (const pl of partyIn()) {
        const dx = pl.x + pl.w / 2 - ecx,
          dy = pl.y + pl.h / 2 - ecy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= knockR * knockR)
          actAs(pl, () => {
            playerTakeDamage(kdmg);
            const d = Math.sqrt(d2) || 1;
            const nx = pl.x + (dx / d) * push,
              ny = pl.y + (dy / d) * push;
            if (canMoveTo(nx, pl.y, pl.w, pl.h)) pl.x = nx;
            if (canMoveTo(pl.x, ny, pl.w, pl.h)) pl.y = ny;
          });
      }
      // THE LULL — self-stun: the stun gate parks the boss next tick (specialCd frozen while parked ⇒
      // the dodge-the-ring → punish-the-lull rhythm). Zero new AI — reuses the enemy stunT primitive.
      e.stunT = M.lullT || 110;
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2;
      const R = e.tele.radius;
      // the warning: a filling core + an expanding ring, and spoke marks at the GAP angles (where the
      // bolts will NOT be — read the gaps, aim for one)
      d.fillStyle = `rgba(255,120,56,${0.1 + 0.22 * fr})`;
      d.beginPath();
      d.arc(cx, cy, e.w * 0.6 + fr * 10, 0, 6.28);
      d.fill();
      d.strokeStyle = `rgba(255,150,70,${0.4 + 0.5 * fr})`;
      d.lineWidth = 3;
      d.beginPath();
      d.arc(cx, cy, R * (0.3 + 0.7 * fr), 0, 6.28);
      d.stroke();
      const n = (e._mech && e._mech.burstN) || 13;
      d.strokeStyle = `rgba(255,200,120,${0.35 + 0.4 * fr})`;
      d.lineWidth = 2;
      d.beginPath();
      for (let s = 0; s < n; s++) {
        const ang = (s / n) * 6.283 + 3.1416 / n; // the gap bearings (between the outer-ring bolts)
        d.moveTo(cx, cy);
        d.lineTo(cx + Math.cos(ang) * R * fr, cy + Math.sin(ang) * R * fr);
      }
      d.stroke();
    },
  },
  // S4 — WEBVOLLEY (the Broodmother): an aimed FAN of fat web-bolts. `kind:'web'` → a landed shot applies
  // the WEBBED slow (the new per-hero debuff, p13 hit seam). Projectiles reach every hero by
  // construction (no partyIn loop needed). Her continuous HERD is separate (broodmotherPhase + mill AI).
  webvolley: {
    wind: 30,
    exec(e, a) {
      const ecx = e.x + e.w / 2,
        ecy = e.y + e.h / 2;
      const { px: pcx, py: pcy, sfx, addProjectile, addShake } = a;
      const M = e._mech || {};
      sfx.cast();
      const base = Math.atan2(pcy - ecy, pcx - ecx);
      const n = M.volleyN || 3;
      const spread = M.volleySpread || 0.26;
      for (let k = 0; k < n; k++) {
        const ang = base + (k - (n - 1) / 2) * spread;
        addProjectile(ecx, ecy, Math.cos(ang) * 3.2, Math.sin(ang) * 3.2, Math.max(1, Math.round(e.atk * (M.volleyDmg || 0.7))), {
          color: '#b6e08a',
          r: 8,
          life: 220,
          kind: 'web',
          webT: M.webT || 120,
          ownerRef: e,
        });
      }
      addShake(3);
    },
    drawTele(v, e) {
      const { g2d: d, sx, sy } = v;
      const fr = 1 - e.tele.t / e.tele.max,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2;
      const base = Math.atan2(e.tele.aimY - (e.y + e.h / 2), e.tele.aimX - (e.x + e.w / 2));
      d.strokeStyle = `rgba(182,224,138,${0.35 + 0.5 * fr})`;
      d.lineWidth = 2;
      for (let k = -1; k <= 1; k++) {
        const ang = base + k * 0.26;
        d.beginPath();
        d.moveTo(cx, cy);
        d.lineTo(cx + Math.cos(ang) * 150 * fr, cy + Math.sin(ang) * 150 * fr);
        d.stroke();
      }
    },
  },
};

// bossSpecials' pick table (p17:378). The p17 wrapper slices `base` (never mutating the
// registry array — plan risk #3), pushes the colour-keyed extra, then the level-gated summon.
export const BOSS_ROSTER: BossRoster = {
  base: ['slam', 'charge', 'nova'],
  redColor: '#ff6060',
  redAdd: 'charge',
  elseAdd: 'nova',
  summonLevel: 3,
  summonAdd: 'summon',
};
