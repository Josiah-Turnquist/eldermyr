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
