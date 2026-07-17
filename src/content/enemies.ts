// src/content/enemies.ts — the enemy-kind registry (P3/S2 data+init, P3/S3 art).
//
// P3/S2: makeEnemy's base table + per-type init blocks (was src/game/parts/
// p03-findOpenTile.js:201-318) and the makeWildEnemy ring/biome type tables (p03:353-376).
// P3/S3: drawEnemy's 11 per-kind art branches (was p20, ~940 lines of draw ops) moved onto
// the SAME entries as `draw(v, e)` hooks, VERBATIM — the only code transform is the 2D
// surface arriving as `v.g2d` (local alias `d`) instead of the game's ambient context,
// plus two type-only annotations esbuild erases. boss/dragon/kraken join the registry as
// draw-hook-only entries (their stats keep their factories until the S5 apex slice).
// tests/battery/facing-noregress.js proves every branch op-for-op against git-HEAD.
//
// Adding a wild-spawnable enemy = one entry in ENEMIES (+ its key in EnemyKindKey,
// types.ts) plus its threshold row(s) in WILD_SPAWN.tables below — one file, and `draw`
// is MANDATORY (a kind without art is a type error, not an invisible foe). The game
// reads kinds through CONTENT.enemies[type] (makeEnemy; drawEnemy dispatches
// CONTENT.enemies[e.type].draw) and the spawn tables through CONTENT.wildSpawn
// (makeWildEnemy); the ring/level BRANCHING and the scaling curves stay in-part (curves
// migrate in S11).
//
// init hooks: pure functions of the instance they receive — they seed behavior fields and
// make EXACTLY the Math.random() draws the inline blocks made (same count, same order; the
// golden harness seeds Math.random globally, so hook draws ride the same stream).
// draw hooks: pure functions of (DrawView, instance) — they read the instance and paint
// through v.g2d ONLY (never ambient globals, never a sim write; EnemyDrawn is readonly).
import type { DrawView, EnemyArt, EnemyArtKey, EnemyDrawn, EnemyInst, EnemyKind, EnemyKindKey, WildSpawnTable } from './types';

export const ENEMIES: Record<EnemyKindKey, EnemyKind> & Record<EnemyArtKey, EnemyArt> = {
  slime: {
    name: 'Slime',
    hp: 11,
    atk: 4,
    def: 0,
    speed: 0.7,
    xp: 8,
    gold: 5,
    color: '#60d060',
    size: 20,
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const sq = Math.sin(e.wobble) * 2.2,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2 + sq / 2,
        rx = e.w / 2 + Math.max(0, sq) * 0.35,
        ry = e.h / 2 - sq / 2; // squash & stretch: it widens as it flattens, so it reads as jelly with weight
      d.fillStyle = flash ? '#fff' : shade(e.color, -52);
      d.beginPath();
      d.ellipse(cx, cy, rx, ry, 0, 0, 6.28);
      d.fill(); // rim
      d.fillStyle = flash ? '#fff' : e.color;
      d.beginPath();
      d.ellipse(cx, cy, rx - 1, ry - 1, 0, 0, 6.28);
      d.fill(); // body
      if (!flash) {
        d.save();
        d.beginPath();
        d.ellipse(cx, cy, rx - 1, ry - 1, 0, 0, 6.28);
        d.clip();
        d.fillStyle = shade(e.color, -26);
        d.beginPath();
        d.ellipse(cx, cy + ry * 0.75, rx, ry * 0.7, 0, 0, 6.28);
        d.fill(); // underside shadow — form, not a flat disc
        d.fillStyle = shade(e.color, -14);
        d.beginPath();
        d.ellipse(cx, cy + ry * 0.25, rx * 0.42, ry * 0.34, 0, 0, 6.28);
        d.fill();
        d.restore(); // translucent core
        d.fillStyle = 'rgba(255,255,255,0.45)';
        d.beginPath();
        d.ellipse(cx - rx * 0.34, cy - ry * 0.45, rx * 0.24, ry * 0.16, -0.5, 0, 6.28);
        d.fill();
      } // the one highlight
      const ey = cy - ry * 0.12,
        er = 1.9 + Math.max(0, -sq) * 0.12;
      d.fillStyle = '#141018';
      d.beginPath();
      d.ellipse(cx - 3.6, ey, er, er * 1.15, 0, 0, 6.28);
      d.fill();
      d.beginPath();
      d.ellipse(cx + 3.6, ey, er, er * 1.15, 0, 0, 6.28);
      d.fill(); // eyes stay dark through the flash — they're what keeps it readable as a face
      if (!flash) {
        d.fillStyle = 'rgba(255,255,255,0.9)';
        d.fillRect(cx - 4.3, ey - 1.2, 1, 1);
        d.fillRect(cx + 2.9, ey - 1.2, 1, 1);
      }
    },
  },
  bat: {
    name: 'Cave Bat',
    hp: 8,
    atk: 5,
    def: 0,
    speed: 1.5,
    xp: 10,
    gold: 6,
    color: '#a060d0',
    size: 18,
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const flap = Math.sin(e.wobble * 3),
        cx = sx + e.w / 2,
        cy = sy + e.h / 2,
        br = e.w / 3,
        wt = cy - flap * 4; // only 18px — the wingbeat IS the read, so it gets the detail and the body stays simple
      const rim = flash ? '#fff' : shade(e.color, -58),
        mem = flash ? '#fff' : shade(e.color, -32);
      d.fillStyle = rim;
      d.beginPath();
      d.moveTo(cx - 3, cy - 2);
      d.quadraticCurveTo(cx - 8, wt - 4, sx - 3, wt);
      d.quadraticCurveTo(cx - 7, cy + 3, cx - 2, cy + 4);
      d.closePath();
      d.fill();
      d.beginPath();
      d.moveTo(cx + 3, cy - 2);
      d.quadraticCurveTo(cx + 8, wt - 4, sx + e.w + 3, wt);
      d.quadraticCurveTo(cx + 7, cy + 3, cx + 2, cy + 4);
      d.closePath();
      d.fill(); // wing rims
      if (!flash) {
        d.fillStyle = mem;
        d.beginPath();
        d.moveTo(cx - 3, cy - 1);
        d.quadraticCurveTo(cx - 8, wt - 3, sx - 1.6, wt - 0.4);
        d.quadraticCurveTo(cx - 6.6, cy + 2.4, cx - 2, cy + 3);
        d.closePath();
        d.fill();
        d.beginPath();
        d.moveTo(cx + 3, cy - 1);
        d.quadraticCurveTo(cx + 8, wt - 3, sx + e.w + 1.6, wt - 0.4);
        d.quadraticCurveTo(cx + 6.6, cy + 2.4, cx + 2, cy + 3);
        d.closePath();
        d.fill(); // membranes
        d.strokeStyle = rim;
        d.lineWidth = 0.8;
        d.beginPath();
        d.moveTo(cx - 2, cy + 1);
        d.lineTo(sx - 1, wt + 0.6);
        d.stroke();
        d.beginPath();
        d.moveTo(cx + 2, cy + 1);
        d.lineTo(sx + e.w + 1, wt + 0.6);
        d.stroke();
      } // one rib each
      d.fillStyle = rim;
      d.beginPath();
      d.moveTo(cx - 3.4, cy - br + 1);
      d.lineTo(cx - 4.6, cy - br - 3.4);
      d.lineTo(cx - 1, cy - br - 0.4);
      d.closePath();
      d.fill();
      d.beginPath();
      d.moveTo(cx + 3.4, cy - br + 1);
      d.lineTo(cx + 4.6, cy - br - 3.4);
      d.lineTo(cx + 1, cy - br - 0.4);
      d.closePath();
      d.fill(); // ears — cheap, and they carry the silhouette
      d.beginPath();
      d.arc(cx, cy, br + 1, 0, 6.28);
      d.fill();
      d.fillStyle = flash ? '#fff' : e.color;
      d.beginPath();
      d.arc(cx, cy, br, 0, 6.28);
      d.fill();
      if (!flash) {
        d.save();
        d.beginPath();
        d.arc(cx, cy, br, 0, 6.28);
        d.clip();
        d.fillStyle = shade(e.color, -30);
        d.beginPath();
        d.ellipse(cx, cy + br * 0.85, br, br * 0.7, 0, 0, 6.28);
        d.fill();
        d.restore();
        d.fillStyle = 'rgba(255,255,255,0.35)';
        d.beginPath();
        d.ellipse(cx - br * 0.35, cy - br * 0.45, br * 0.3, br * 0.2, -0.5, 0, 6.28);
        d.fill();
      }
      d.fillStyle = '#f04040';
      d.fillRect(cx - 3.5, cy - 1, 2, 2);
      d.fillRect(cx + 1.5, cy - 1, 2, 2);
      if (!flash) {
        d.fillStyle = 'rgba(255,210,210,0.9)';
        d.fillRect(cx - 3.5, cy - 1, 1, 1);
        d.fillRect(cx + 1.5, cy - 1, 1, 1);
      }
    },
  },
  skeleton: {
    name: 'Skeleton',
    hp: 20,
    atk: 7,
    def: 2,
    speed: 1.05,
    xp: 18,
    gold: 12,
    color: '#e0e0d0',
    size: 22,
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const step = Math.sin(e.wobble * 2),
        st2 = step > 0 ? 1 : 0,
        bob = Math.abs(step) * 0.6,
        oy = sy - bob; // the bob puts weight on each footfall
      const bone = flash ? '#fff' : e.color,
        dark = flash ? '#fff' : shade(e.color, -115),
        mid = flash ? '#fff' : shade(e.color, -30); // rim derives from e.color: warlords are RED skeletons, pinnacle adds blue/pale
      d.fillStyle = dark;
      d.fillRect(sx + 6, oy + e.h - 7 + st2, 4, 7 - st2);
      d.fillRect(sx + e.w - 10, oy + e.h - 6 - st2, 4, 6 + st2);
      d.fillStyle = bone;
      d.fillRect(sx + 7, oy + e.h - 7 + st2, 2, 6 - st2);
      d.fillRect(sx + e.w - 9, oy + e.h - 6 - st2, 2, 5 + st2); // legs
      d.fillStyle = dark;
      d.fillRect(sx + 1, oy + 9, 3, 9);
      d.fillRect(sx + e.w - 4, oy + 9, 3, 9);
      d.fillStyle = bone;
      d.fillRect(sx + 2, oy + 9, 1, 8);
      d.fillRect(sx + e.w - 3, oy + 9, 1, 8); // arms
      d.fillStyle = dark;
      d.fillRect(sx + 4, oy + 8, e.w - 8, e.h - 13);
      d.fillStyle = bone;
      d.fillRect(sx + 5, oy + 8, e.w - 10, e.h - 14);
      if (!flash) {
        d.strokeStyle = 'rgba(20,16,14,0.5)';
        d.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          d.beginPath();
          d.arc(sx + e.w / 2, oy + 11 + i * 3 - 2.4, 4.6 + i * 0.3, 0.35, 3.14 - 0.35);
          d.stroke();
        } // real curved ribs
        d.fillStyle = 'rgba(20,16,14,0.42)';
        d.fillRect(sx + e.w / 2 - 0.5, oy + 9, 1, e.h - 15); // spine
        d.fillStyle = mid;
        d.fillRect(sx + e.w - 6, oy + 9, 1, e.h - 15);
      } // form shadow, one side
      d.fillStyle = dark;
      d.fillRect(sx + 3, oy - 1, e.w - 6, 11);
      d.fillStyle = bone;
      d.fillRect(sx + 4, oy, e.w - 8, 9); // skull: rim + dome
      if (!flash) {
        d.fillStyle = mid;
        d.fillRect(sx + e.w - 6, oy, 2, 9);
        d.fillStyle = 'rgba(20,16,14,0.35)';
        d.fillRect(sx + 6, oy + 7, e.w - 12, 1);
      } // side shading + jaw line
      d.fillStyle = '#0d0b0e';
      d.fillRect(sx + 6, oy + 2, 4, 4);
      d.fillRect(sx + e.w - 10, oy + 2, 4, 4); // deep sockets
      if (!flash) {
        d.fillStyle = 'rgba(255,190,90,0.55)';
        d.fillRect(sx + 7, oy + 3, 2, 2);
        d.fillRect(sx + e.w - 9, oy + 3, 2, 2);
      }
    }, // the faintest ember
  },
  mage: {
    name: 'Dark Caster',
    hp: 15,
    atk: 6,
    def: 1,
    speed: 0.9,
    xp: 18,
    gold: 16,
    color: '#60a0ff',
    size: 22,
    init(e: EnemyInst) {
      e.caster = true;
      e.castCd = 60 + Math.floor(Math.random() * 40);
    },
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const float = Math.sin(e.wobble) * 1.5,
        cx = sx + e.w / 2,
        orb = Math.sin(Date.now() / 180) * 0.5 + 0.5,
        rgb = rgbOf(e.color);
      d.fillStyle = flash ? '#fff' : shade(e.color, 0, 0.22);
      d.beginPath();
      d.moveTo(cx, sy + 2 + float);
      d.lineTo(sx + e.w - 1, sy + e.h + 1 + float);
      d.lineTo(sx + 1, sy + e.h + 1 + float);
      d.closePath();
      d.fill(); // robe rim
      d.fillStyle = flash ? '#fff' : shade(e.color, 0, 0.45);
      d.beginPath();
      d.moveTo(cx, sy + 3.5 + float);
      d.lineTo(sx + e.w - 2, sy + e.h + float);
      d.lineTo(sx + 2, sy + e.h + float);
      d.closePath();
      d.fill(); // robe — derived, so a Dread-raid mage (#c83030) wears RED, not the old hardcoded navy
      if (!flash) {
        d.strokeStyle = shade(e.color, 0, 0.16);
        d.lineWidth = 1;
        d.beginPath();
        d.moveTo(cx - 3, sy + 14 + float);
        d.lineTo(cx - 5, sy + e.h + float);
        d.stroke();
        d.beginPath();
        d.moveTo(cx + 3, sy + 14 + float);
        d.lineTo(cx + 5, sy + e.h + float);
        d.stroke();
        d.strokeStyle = 'rgba(' + rgb + ',0.40)';
        d.lineWidth = 1.1;
        d.beginPath();
        d.moveTo(cx, sy + 4 + float);
        d.lineTo(sx + 2.5, sy + e.h - 1 + float);
        d.stroke();
      } // folds + lit edge
      d.fillStyle = flash ? '#fff' : shade(e.color, -70);
      d.beginPath();
      d.arc(cx, sy + 8 + float, 7.6, 0, 6.28);
      d.fill();
      d.fillStyle = flash ? '#fff' : e.color;
      d.beginPath();
      d.arc(cx, sy + 8 + float, 6.8, 0, 6.28);
      d.fill(); // cowl keeps e.color
      if (!flash) {
        d.fillStyle = 'rgba(255,255,255,0.28)';
        d.beginPath();
        d.ellipse(cx - 3, sy + 4.6 + float, 2.4, 1.5, -0.5, 0, 6.28);
        d.fill();
      } // the one highlight
      d.fillStyle = flash ? '#fff' : shade(e.color, 0, 0.1);
      d.beginPath();
      d.arc(cx, sy + 9 + float, 5, 0, 6.28);
      d.fill(); // the void under the hood
      d.fillStyle = flash ? '#fff' : shade(e.color, 70);
      d.fillRect(cx - 3, sy + 8 + float, 2, 2);
      d.fillRect(cx + 1, sy + 8 + float, 2, 2); // eyes
      if (!flash) {
        d.fillStyle = 'rgba(' + rgb + ',0.22)';
        d.beginPath();
        d.arc(sx + e.w - 1, sy + 10 + float + orb * 0.6, 6.5, 0, 6.28);
        d.fill();
      } // orb glow
      d.fillStyle = flash ? '#fff' : 'rgba(' + rgb + ',' + (0.55 + orb * 0.45).toFixed(2) + ')';
      d.beginPath();
      d.arc(sx + e.w - 1, sy + 10 + float + orb * 0.6, 4, 0, 6.28);
      d.fill();
      if (!flash) {
        d.fillStyle = 'rgba(255,255,255,' + (0.35 + orb * 0.4).toFixed(2) + ')';
        d.beginPath();
        d.arc(sx + e.w - 2.2, sy + 8.8 + float + orb * 0.6, 1.4, 0, 6.28);
        d.fill();
      }
    }, // orb core
  },
  charger: {
    name: 'Dire Hound',
    hp: 17,
    atk: 7,
    def: 1,
    speed: 1.0,
    xp: 16,
    gold: 12,
    color: '#e08040',
    size: 22,
    init(e: EnemyInst) {
      e.charger = true;
      e.chargeCd = 70 + Math.floor(Math.random() * 60);
      e.chargeState = 0;
      e.chargeT = 0;
      e.dvx = 0;
      e.dvy = 0;
    },
    faces: true,
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const wind = e.chargeState === 1,
        crouch = wind ? 3 : 0,
        run = e.chargeState === 2 ? Math.sin(e.wobble * 4) : Math.sin(e.wobble * 1.6),
        by = sy + e.h * 0.42 + crouch,
        bh = e.h * 0.4 - crouch;
      const base = flash ? '#fff' : wind ? shade(e.color, 55) : e.color,
        rim = flash ? '#fff' : shade(e.color, -72); // the windup tint DERIVES now — a recoloured hound still flushes as it winds up
      d.save();
      if (e._faceL) {
        d.translate((sx + e.w / 2) * 2, 0);
        d.scale(-1, 1);
      } /* FACE LEFT: a four-legged hound with a snout, an ear and one eye at the front and a tail at the back — the most COMMON creature with a real front, so this is the flip you'll see most. Same unconditional save/restore as the wyrm; the windup ring at the end is centred on the mirror axis, so it renders identically either way and needs no special care. */
      if (e.chargeState === 2) {
        d.fillStyle = 'rgba(' + rgbOf(e.color) + ',0.35)';
        d.fillRect(sx - Math.abs(e.dvx!) * 2, sy + e.h * 0.45, e.w, e.h * 0.35);
      } // speed smear. Math.abs because inside the mirror the hound ALWAYS runs "right", so its smear always trails to local-left; the old raw -e.dvx pushed the smear in FRONT of a left-running hound (a latent bug that only ever looked like a bad sneeze) and mirroring it would have doubled the error.
      d.fillStyle = rim;
      d.fillRect(sx + 4, sy + e.h - 6 + run * 1.2, 3, 6 - run * 1.2);
      d.fillRect(sx + e.w - 9, sy + e.h - 6 - run * 1.2, 3, 6 + run * 1.2); // far legs (behind, darker = depth)
      d.fillStyle = rim;
      d.fillRect(sx + 1, by - 1, e.w - 2, bh + 2);
      d.beginPath();
      d.arc(sx + e.w - 4, sy + e.h * 0.55 + crouch, 6, 0, 6.28);
      d.fill(); // silhouette: body + head in one rim pass
      d.fillStyle = base;
      d.fillRect(sx + 2, by, e.w - 4, bh);
      d.beginPath();
      d.arc(sx + e.w - 4, sy + e.h * 0.55 + crouch, 5, 0, 6.28);
      d.fill();
      if (!flash) {
        d.fillStyle = wind ? shade(e.color, 10) : shade(e.color, -34);
        d.fillRect(sx + 2, by + bh * 0.55, e.w - 4, bh * 0.45); // belly shadow
        d.fillStyle = 'rgba(255,255,255,0.22)';
        d.fillRect(sx + 3, by + 0.5, e.w - 7, 1.2);
      } // lit back — the one highlight
      d.fillStyle = rim;
      d.beginPath();
      d.moveTo(sx + e.w - 7, sy + e.h * 0.55 + crouch - 5);
      d.lineTo(sx + e.w - 9.5, sy + e.h * 0.4 + crouch - 1);
      d.lineTo(sx + e.w - 4, sy + e.h * 0.5 + crouch - 4.5);
      d.closePath();
      d.fill(); // ear
      d.fillStyle = base;
      d.fillRect(sx + e.w - 3, sy + e.h * 0.58 + crouch, 4, 3); // snout
      d.strokeStyle = rim;
      d.lineWidth = 2;
      d.lineCap = 'round';
      d.beginPath();
      d.moveTo(sx + 2, by + 2);
      d.quadraticCurveTo(sx - 4, by - 1 + run, sx - 3, by + 5 + run);
      d.stroke();
      d.lineCap = 'butt'; // tail
      d.fillStyle = base;
      d.fillRect(sx + 5, sy + e.h - 5 - run * 1.2, 3, 5 + run * 1.2);
      d.fillRect(sx + e.w - 8, sy + e.h - 5 + run * 1.2, 3, 5 - run * 1.2); // near legs — four legs and a gait: it reads as a running animal now, not a brick
      d.fillStyle = flash ? '#fff' : '#ff3018';
      d.fillRect(sx + e.w - 4, sy + e.h * 0.5 + crouch, 2, 2);
      if (!flash) {
        d.fillStyle = 'rgba(255,190,150,0.9)';
        d.fillRect(sx + e.w - 4, sy + e.h * 0.5 + crouch, 1, 1);
      }
      if (wind) {
        const pl = Math.sin(Date.now() / 50) * 0.4 + 0.6;
        d.strokeStyle = `rgba(255,60,30,${pl})`;
        d.lineWidth = 2;
        d.beginPath();
        d.arc(sx + e.w / 2, sy + e.h / 2, e.w * 0.7, 0, 6.28);
        d.stroke();
      }
      d.restore();
    },
  },
  archer: {
    name: 'Bone Archer',
    hp: 13,
    atk: 6,
    def: 1,
    speed: 0.95,
    xp: 16,
    gold: 14,
    color: '#9aa860',
    size: 20,
    init(e: EnemyInst) {
      e.archer = true;
      e.attackCd = 30 + Math.floor(Math.random() * 40);
    },
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const step = Math.sin(e.wobble * 2),
        st2 = step > 0 ? 1 : 0,
        bob = Math.abs(step) * 0.5,
        oy = sy - bob; // same bone language as the skeleton, so a Bone Archer reads as its kin
      const bone = flash ? '#fff' : e.color,
        dark = flash ? '#fff' : shade(e.color, -115),
        mid = flash ? '#fff' : shade(e.color, -30);
      d.fillStyle = dark;
      d.fillRect(sx + 6, oy + e.h - 6 + st2, 3, 6 - st2);
      d.fillRect(sx + e.w - 10, oy + e.h - 5 - st2, 3, 5 + st2);
      d.fillStyle = mid;
      d.fillRect(sx + 7, oy + e.h - 6 + st2, 1, 5 - st2);
      d.fillRect(sx + e.w - 9, oy + e.h - 5 - st2, 1, 4 + st2); // legs
      d.fillStyle = flash ? '#fff' : '#3a2410';
      d.fillRect(sx, oy + 6, 5, 11);
      d.fillStyle = flash ? '#fff' : '#5a3a1a';
      d.fillRect(sx + 1, oy + 7, 3, 10); // quiver
      if (!flash) {
        d.fillStyle = '#e8d8a0';
        d.fillRect(sx + 2, oy + 3, 1, 5);
        d.fillRect(sx + 4, oy + 2, 1, 6);
        d.fillStyle = '#c04030';
        d.fillRect(sx + 1.6, oy + 3, 2, 1.6);
        d.fillRect(sx + 3.6, oy + 2, 2, 1.6);
      } // arrows + fletching
      d.fillStyle = dark;
      d.fillRect(sx + 4, oy + 6, e.w - 9, e.h - 11);
      d.fillStyle = bone;
      d.fillRect(sx + 5, oy + 7, e.w - 11, e.h - 13);
      if (!flash) {
        d.strokeStyle = 'rgba(20,16,14,0.5)';
        d.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          d.beginPath();
          d.arc(sx + e.w / 2 - 1, oy + 10 + i * 3.4 - 2, 3.8, 0.4, 3.14 - 0.4);
          d.stroke();
        }
        d.fillStyle = mid;
        d.fillRect(sx + e.w - 7, oy + 8, 1, e.h - 14);
      } // ribs + form shadow
      d.fillStyle = dark;
      d.fillRect(sx + 3, oy - 1, e.w - 7, 11);
      d.fillStyle = bone;
      d.fillRect(sx + 4, oy, e.w - 9, 9);
      if (!flash) {
        d.fillStyle = mid;
        d.fillRect(sx + e.w - 7, oy, 2, 9);
        d.fillStyle = 'rgba(20,16,14,0.35)';
        d.fillRect(sx + 6, oy + 7, e.w - 14, 1);
      } // side shading + jaw line
      d.fillStyle = '#0d0b0e';
      d.fillRect(sx + 6, oy + 2, 3, 3);
      d.fillRect(sx + e.w - 10, oy + 2, 3, 3);
      if (!flash) {
        d.fillStyle = 'rgba(255,190,90,0.55)';
        d.fillRect(sx + 6.6, oy + 2.6, 1.6, 1.6);
        d.fillRect(sx + e.w - 9.4, oy + 2.6, 1.6, 1.6);
      } // sockets + ember
      d.strokeStyle = flash ? '#fff' : '#3d2c14';
      d.lineWidth = 3;
      d.beginPath();
      d.arc(sx + e.w - 1, oy + e.h / 2, 7, -1.3, 1.3);
      d.stroke();
      d.strokeStyle = flash ? '#fff' : '#7a5a2a';
      d.lineWidth = 1.6;
      d.beginPath();
      d.arc(sx + e.w - 1, oy + e.h / 2, 7, -1.3, 1.3);
      d.stroke(); // bow: rim then wood
      if (!flash) {
        d.strokeStyle = 'rgba(220,190,120,0.5)';
        d.lineWidth = 0.7;
        d.beginPath();
        d.arc(sx + e.w - 1.6, oy + e.h / 2, 7, -1.2, 1.2);
        d.stroke();
      } // lit edge on the limb
      d.strokeStyle = flash ? '#fff' : '#d8d0c0';
      d.lineWidth = 1;
      d.beginPath();
      d.moveTo(sx + e.w - 1, oy + e.h / 2 - 6.7);
      d.lineTo(sx + e.w - 1, oy + e.h / 2 + 6.7);
      d.stroke();
    },
  },
  healer: {
    name: 'Acolyte',
    hp: 15,
    atk: 3,
    def: 1,
    speed: 0.9,
    xp: 22,
    gold: 20,
    color: '#60e0a0',
    size: 20,
    init(e: EnemyInst) {
      e.healer = true;
      e.healCd = 90 + Math.floor(Math.random() * 60);
    },
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const hf = Math.sin(e.wobble) * 1.5,
        cx = sx + e.w / 2,
        aura = Math.sin(Date.now() / 220) * 0.3 + 0.5,
        rgb = rgbOf(e.color);
      if (!flash) {
        const g = d.createRadialGradient(cx, sy + e.h / 2 + hf, e.w * 0.22, cx, sy + e.h / 2 + hf, e.w * 0.8); // aura: a soft bloom instead of a flat disc
        g.addColorStop(0, 'rgba(' + rgb + ',' + (0.26 * aura).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + rgb + ',0)');
        d.fillStyle = g;
        d.beginPath();
        d.arc(cx, sy + e.h / 2 + hf, e.w * 0.8, 0, 6.28);
        d.fill();
      }
      d.fillStyle = flash ? '#fff' : shade(e.color, 0, 0.24);
      d.beginPath();
      d.moveTo(cx, sy + 2 + hf);
      d.lineTo(sx + e.w - 1, sy + e.h + 1 + hf);
      d.lineTo(sx + 1, sy + e.h + 1 + hf);
      d.closePath();
      d.fill();
      d.fillStyle = flash ? '#fff' : shade(e.color, 0, 0.46);
      d.beginPath();
      d.moveTo(cx, sy + 3.5 + hf);
      d.lineTo(sx + e.w - 2, sy + e.h + hf);
      d.lineTo(sx + 2, sy + e.h + hf);
      d.closePath();
      d.fill(); // robe rim + body
      if (!flash) {
        d.strokeStyle = shade(e.color, 0, 0.17);
        d.lineWidth = 1;
        d.beginPath();
        d.moveTo(cx - 3, sy + 13 + hf);
        d.lineTo(cx - 5, sy + e.h + hf);
        d.stroke();
        d.beginPath();
        d.moveTo(cx + 3, sy + 13 + hf);
        d.lineTo(cx + 5, sy + e.h + hf);
        d.stroke();
        d.strokeStyle = 'rgba(' + rgb + ',0.40)';
        d.lineWidth = 1.1;
        d.beginPath();
        d.moveTo(cx, sy + 4 + hf);
        d.lineTo(sx + 2.5, sy + e.h - 1 + hf);
        d.stroke();
      } // folds + lit edge
      d.fillStyle = flash ? '#fff' : shade(e.color, -70);
      d.beginPath();
      d.arc(cx, sy + 8 + hf, 6.7, 0, 6.28);
      d.fill();
      d.fillStyle = flash ? '#fff' : e.color;
      d.beginPath();
      d.arc(cx, sy + 8 + hf, 5.9, 0, 6.28);
      d.fill(); // cowl
      if (!flash) {
        d.save();
        d.beginPath();
        d.arc(cx, sy + 8 + hf, 5.9, 0, 6.28);
        d.clip();
        d.fillStyle = shade(e.color, -46);
        d.beginPath();
        d.ellipse(cx + 3, sy + 12 + hf, 5, 4, 0, 0, 6.28);
        d.fill();
        d.restore();
        d.fillStyle = 'rgba(255,255,255,0.30)';
        d.beginPath();
        d.ellipse(cx - 2.6, sy + 5.4 + hf, 2.1, 1.4, -0.5, 0, 6.28);
        d.fill();
      } // form shadow + the one highlight
      d.fillStyle = flash ? '#fff' : shade(e.color, 0, 0.12);
      d.fillRect(cx - 2.6, sy + 7 + hf, 5.2, 3); // shadowed face
      if (!flash) {
        d.fillStyle = 'rgba(255,255,255,' + (0.3 + aura * 0.45).toFixed(2) + ')';
        d.fillRect(cx - 2, sy + e.h / 2 - 1 + hf, 4, 11);
        d.fillRect(cx - 4.5, sy + e.h / 2 + 1 + hf, 9, 4);
      } // cross glow
      d.fillStyle = flash ? '#fff' : '#eafff2';
      d.fillRect(cx - 1, sy + e.h / 2 + hf, 2, 8);
      d.fillRect(cx - 3, sy + e.h / 2 + 2 + hf, 6, 2);
    },
  },
  serpent: {
    name: 'Sea Serpent',
    hp: 26,
    atk: 9,
    def: 2,
    speed: 1.15,
    xp: 24,
    gold: 18,
    color: '#2aa0a0',
    size: 26,
    init(e: EnemyInst) {
      e.aquatic = true;
    },
    faces: true,
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const und = e.wobble * 2,
        hy = sy + e.h / 2 + Math.sin(und) * 3,
        hr = e.w * 0.22;
      d.save();
      if (e._faceL) {
        d.translate((sx + e.w / 2) * 2, 0);
        d.scale(-1, 1);
      } /* FACE LEFT: NOT symmetrical — the head (jaw, slit-pupil eye, dorsal fin) leads at sx+e.w-8 and four shrinking coils trail left, so a serpent swimming left swims tail-first. Same unconditional save/restore as the wyrm; this branch is pure art (no text), so the restore sits at its very end. */
      const seg = (i: number) => ({
        x: sx + e.w / 2 - 4 - i * 4.5,
        y: sy + e.h / 2 + Math.sin(und + i * 1.1) * 4,
        r: Math.max(3, e.w * 0.17 - i * 0.9),
      });
      d.fillStyle = flash ? '#fff' : shade(e.color, -62);
      for (let i = 3; i >= 1; i--) {
        const s3 = seg(i);
        d.beginPath();
        d.arc(s3.x, s3.y, s3.r + 1, 0, 6.28);
        d.fill();
      }
      d.beginPath();
      d.arc(sx + e.w - 8, hy, hr + 1, 0, 6.28);
      d.fill(); // one rim pass over the whole body — the undulating coil reads as ONE animal, not five discs
      d.fillStyle = flash ? '#fff' : e.color;
      for (let i = 3; i >= 1; i--) {
        const s3 = seg(i);
        d.beginPath();
        d.arc(s3.x, s3.y, s3.r, 0, 6.28);
        d.fill();
      }
      d.beginPath();
      d.arc(sx + e.w - 8, hy, hr, 0, 6.28);
      d.fill();
      if (!flash) {
        d.fillStyle = shade(e.color, -30);
        for (let i = 3; i >= 1; i--) {
          const s3 = seg(i);
          d.beginPath();
          d.ellipse(s3.x, s3.y + s3.r * 0.5, s3.r * 0.85, s3.r * 0.5, 0, 0, 6.28);
          d.fill();
        } // underside on every segment
        d.fillStyle = 'rgba(255,255,255,0.30)';
        for (let i = 3; i >= 1; i--) {
          const s3 = seg(i);
          d.beginPath();
          d.ellipse(s3.x - s3.r * 0.2, s3.y - s3.r * 0.5, s3.r * 0.45, s3.r * 0.22, -0.3, 0, 6.28);
          d.fill();
        } // wet backlit sheen
        d.save();
        d.beginPath();
        d.arc(sx + e.w - 8, hy, hr, 0, 6.28);
        d.clip();
        d.fillStyle = shade(e.color, -30);
        d.beginPath();
        d.ellipse(sx + e.w - 8, hy + hr * 0.65, hr, hr * 0.6, 0, 0, 6.28);
        d.fill();
        d.restore();
      }
      d.fillStyle = flash ? '#fff' : shade(e.color, -45);
      d.beginPath();
      d.moveTo(sx + e.w - 8, hy - e.w * 0.2);
      d.lineTo(sx + e.w - 3, hy - e.w * 0.38);
      d.lineTo(sx + e.w - 1, hy - e.w * 0.12);
      d.closePath();
      d.fill(); // dorsal fin
      if (!flash) {
        d.fillStyle = 'rgba(255,255,255,0.28)';
        d.beginPath();
        d.ellipse(sx + e.w - 9, hy - hr * 0.45, hr * 0.42, hr * 0.24, -0.4, 0, 6.28);
        d.fill();
      } // the one head highlight
      d.fillStyle = flash ? '#fff' : '#0a2a2a';
      d.fillRect(sx + e.w - 1, hy, 4, 1.4); // jaw
      d.fillStyle = flash ? '#fff' : '#ffe060';
      d.fillRect(sx + e.w - 6, hy - 2, 2, 2);
      if (!flash) {
        d.fillStyle = '#2a1a00';
        d.fillRect(sx + e.w - 5.4, hy - 2, 0.9, 2);
        d.fillStyle = 'rgba(255,255,255,0.85)';
        d.fillRect(sx + e.w - 6, hy - 2, 1, 1);
      } // slit pupil + glint
      d.restore();
    },
  },
  dragon: {
    faces: true,
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const fl = Math.sin(e.wobble * 2) * 4,
        cx = sx + e.w / 2,
        rgb = rgbOf(e.color),
        fire = Math.sin(Date.now() / 90) * 0.5 + 0.5;
      d.save();
      if (e._faceL) {
        d.translate(cx * 2, 0);
        d.scale(-1, 1);
      } /* FACE LEFT: mirror about the wyrm's OWN centre (x -> 2cx-x), so the skull leads and the tail trails whichever way it flies. save/restore are UNCONDITIONAL and the flip only rides inside — one save, one restore on every path, so the pair can never come unbalanced (the headless Proxy canvas no-ops save/restore and would not catch it). Scoped to the ART only: restored before the [E] TAME label, and drawEnemy's shared hp bar / affix rings / mark pips / boss name all sit outside this branch entirely, so no text is ever mirrored. */
      const wing = flash ? '#fff' : shade(e.color, 0, 0.4),
        wrim = flash ? '#fff' : shade(e.color, 0, 0.2);
      d.fillStyle = wrim;
      d.beginPath();
      d.moveTo(sx - 9, sy + 10);
      d.lineTo(cx, sy - 3 - fl);
      d.lineTo(sx + 4, sy + e.h - 7);
      d.closePath();
      d.fill();
      d.beginPath();
      d.moveTo(sx + e.w + 9, sy + 10);
      d.lineTo(cx, sy - 3 - fl);
      d.lineTo(sx + e.w - 4, sy + e.h - 7);
      d.closePath();
      d.fill(); // wing rims
      d.fillStyle = wing;
      d.beginPath();
      d.moveTo(sx - 7, sy + 10.5);
      d.lineTo(cx, sy - 1.5 - fl);
      d.lineTo(sx + 4.5, sy + e.h - 8.5);
      d.closePath();
      d.fill();
      d.beginPath();
      d.moveTo(sx + e.w + 7, sy + 10.5);
      d.lineTo(cx, sy - 1.5 - fl);
      d.lineTo(sx + e.w - 4.5, sy + e.h - 8.5);
      d.closePath();
      d.fill(); // membranes
      if (!flash) {
        d.strokeStyle = wrim;
        d.lineWidth = 1.2; // wing ribs — they make the flap read
        for (let i = 0; i < 2; i++) {
          const t2 = 0.34 + i * 0.3;
          d.beginPath();
          d.moveTo(cx, sy - 1.5 - fl);
          d.lineTo(sx - 7 + 11.5 * (1 - t2) + t2 * 4.5, sy + 10.5 + (e.h - 19) * t2);
          d.stroke();
          d.beginPath();
          d.moveTo(cx, sy - 1.5 - fl);
          d.lineTo(sx + e.w + 7 - 11.5 * (1 - t2) - t2 * 4.5, sy + 10.5 + (e.h - 19) * t2);
          d.stroke();
        }
      }
      d.strokeStyle = flash ? '#fff' : shade(e.color, -70);
      d.lineWidth = 5;
      d.lineCap = 'round';
      d.beginPath();
      d.moveTo(sx + 10, sy + e.h - 8);
      d.quadraticCurveTo(sx - 6, sy + e.h - 2, sx - 11, sy + e.h - 10 - fl * 0.5);
      d.stroke();
      d.strokeStyle = flash ? '#fff' : e.color;
      d.lineWidth = 3;
      d.beginPath();
      d.moveTo(sx + 10, sy + e.h - 8);
      d.quadraticCurveTo(sx - 6, sy + e.h - 2, sx - 11, sy + e.h - 10 - fl * 0.5);
      d.stroke();
      d.lineCap = 'butt'; // tail
      d.fillStyle = flash ? '#fff' : shade(e.color, -70);
      d.fillRect(sx + 7, sy + 11, e.w - 14, e.h - 14);
      d.beginPath();
      d.arc(sx + e.w - 8, sy + 15, 9, 0, 6.28);
      d.fill();
      d.fillStyle = flash ? '#fff' : e.color;
      d.fillRect(sx + 8, sy + 12, e.w - 16, e.h - 16);
      d.beginPath();
      d.arc(sx + e.w - 8, sy + 15, 8, 0, 6.28);
      d.fill(); // body + head
      if (!flash) {
        d.fillStyle = shade(e.color, -42);
        d.fillRect(sx + 8, sy + e.h - 9, e.w - 16, 5); // belly shadow
        d.fillStyle = shade(e.color, 42);
        for (let i = 0; i < 3; i++) d.fillRect(sx + 11 + i * 6, sy + 14, 4, 2); // lit back scales
        d.save();
        d.beginPath();
        d.arc(sx + e.w - 8, sy + 15, 8, 0, 6.28);
        d.clip();
        d.fillStyle = shade(e.color, -42);
        d.beginPath();
        d.ellipse(sx + e.w - 6, sy + 21, 8, 5, 0, 0, 6.28);
        d.fill();
        d.restore();
        d.fillStyle = 'rgba(255,255,255,0.30)';
        d.beginPath();
        d.ellipse(sx + e.w - 11, sy + 11, 3, 2, -0.5, 0, 6.28);
        d.fill();
      } // the one highlight
      d.fillStyle = flash ? '#fff' : shade(e.color, -70);
      d.beginPath();
      d.moveTo(sx + e.w - 12, sy + 9);
      d.lineTo(sx + e.w - 15, sy + 2);
      d.lineTo(sx + e.w - 8, sy + 7);
      d.closePath();
      d.fill(); // horn
      d.fillStyle = flash ? '#fff' : shade(e.color, -30);
      d.fillRect(sx + e.w - 4, sy + 16, 7, 4); // snout
      d.fillStyle = flash ? '#fff' : '#ffe030';
      d.fillRect(sx + e.w - 6, sy + 12, 3, 3);
      if (!flash) {
        d.fillStyle = '#3a2000';
        d.fillRect(sx + e.w - 5, sy + 12, 1, 3);
        d.fillStyle = 'rgba(255,255,255,0.9)';
        d.fillRect(sx + e.w - 6, sy + 12, 1, 1); // slit pupil + glint
        d.fillStyle = 'rgba(255,120,40,' + (0.25 + fire * 0.3).toFixed(2) + ')';
        d.beginPath();
        d.arc(sx + e.w + 3, sy + 16.5, 5.5, 0, 6.28);
        d.fill();
      } // furnace glow at the maw
      d.fillStyle = flash ? '#fff' : '#ff6020';
      d.fillRect(sx + e.w - 1, sy + 15, 7, 3);
      if (!flash) {
        d.fillStyle = 'rgba(255,230,120,' + (0.55 + fire * 0.45).toFixed(2) + ')';
        d.fillRect(sx + e.w - 1, sy + 15.8, 5, 1.4);
      }
      d.restore(); // …and the wyrm is back in world space from here down
      if (e.subdued) {
        d.fillStyle = '#90ff90';
        d.font = 'bold 10px monospace';
        d.textAlign = 'center';
        d.fillText('[E] TAME', cx, sy + e.h + 13);
        d.textAlign = 'left';
        d.font = '10px monospace';
      }
    },
  },
  kraken: {
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const fl = Math.sin(e.wobble) * 3,
        cx = sx + e.w / 2,
        cy = sy + e.h / 2,
        hr = e.w * 0.36,
        arm = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * 6.28 + e.wobble * 0.25,
          wig = Math.sin(e.wobble * 2 + k) * 8;
        arm.push([
          cx + Math.cos(a) * e.w * 0.4 + wig,
          cy + Math.sin(a) * e.h * 0.4,
          cx + Math.cos(a) * e.w * 0.72,
          cy + Math.sin(a) * e.h * 0.72,
        ]);
      } // arm curves computed once, then stroked in passes — one fillStyle change per pass instead of per arm
      d.lineCap = 'round';
      d.strokeStyle = flash ? '#fff' : shade(e.color, 0, 0.34);
      d.lineWidth = 9;
      for (const t2 of arm) {
        d.beginPath();
        d.moveTo(cx, cy);
        d.quadraticCurveTo(t2[0], t2[1], t2[2], t2[3]);
        d.stroke();
      }
      d.strokeStyle = flash ? '#fff' : shade(e.color, -40);
      d.lineWidth = 6.5;
      for (const t2 of arm) {
        d.beginPath();
        d.moveTo(cx, cy);
        d.quadraticCurveTo(t2[0], t2[1], t2[2], t2[3]);
        d.stroke();
      } // rim then limb — tentacles read as flesh, not wires
      if (!flash) {
        d.strokeStyle = 'rgba(255,255,255,0.16)';
        d.lineWidth = 2;
        for (const t2 of arm) {
          d.beginPath();
          d.moveTo(cx, cy);
          d.quadraticCurveTo(t2[0], t2[1] - 1.5, t2[2], t2[3] - 1.5);
          d.stroke();
        }
      } // wet sheen
      d.lineCap = 'butt';
      d.fillStyle = flash ? '#fff' : shade(e.color, -62);
      d.beginPath();
      d.arc(cx, cy + fl, hr + 1.5, 0, 6.28);
      d.fill();
      d.fillStyle = flash ? '#fff' : e.color;
      d.beginPath();
      d.arc(cx, cy + fl, hr, 0, 6.28);
      d.fill(); // mantle
      if (!flash) {
        d.save();
        d.beginPath();
        d.arc(cx, cy + fl, hr, 0, 6.28);
        d.clip();
        d.fillStyle = shade(e.color, -34);
        d.beginPath();
        d.ellipse(cx, cy + fl + hr * 0.8, hr, hr * 0.75, 0, 0, 6.28);
        d.fill();
        d.restore();
        d.fillStyle = 'rgba(255,255,255,0.26)';
        d.beginPath();
        d.ellipse(cx - hr * 0.35, cy + fl - hr * 0.5, hr * 0.3, hr * 0.17, -0.5, 0, 6.28);
        d.fill();
      } // form + the one highlight
      d.fillStyle = flash ? '#fff' : shade(e.color, 0, 0.28);
      d.beginPath();
      d.ellipse(cx, cy + fl, e.w * 0.27, e.w * 0.2, 0, 0, 6.28);
      d.fill(); // brow band — the old flat inner disc, now shaped
      if (!flash) {
        d.fillStyle = 'rgba(255,64,64,0.18)';
        d.beginPath();
        d.arc(cx - 6, cy + fl, 7, 0, 6.28);
        d.fill();
        d.beginPath();
        d.arc(cx + 6, cy + fl, 7, 0, 6.28);
        d.fill();
      } // eye-glow
      d.fillStyle = flash ? '#fff' : '#ff4040';
      d.fillRect(cx - 9, cy - 3 + fl, 6, 6);
      d.fillRect(cx + 3, cy - 3 + fl, 6, 6);
      if (!flash) {
        d.fillStyle = 'rgba(255,190,190,0.9)';
        d.fillRect(cx - 9, cy - 3 + fl, 2, 2);
        d.fillRect(cx + 3, cy - 3 + fl, 2, 2);
      }
    },
  },
  boss: {
    draw(v: DrawView, e: EnemyDrawn) {
      const { g2d: d, sx, sy, flash, shade, rgbOf } = v;

      const float = Math.sin(e.wobble * 0.5) * 3,
        pulse = Math.sin(Date.now() / 260) * 0.5 + 0.5,
        cx = sx + e.w / 2,
        ay = sy + e.h / 2 + float,
        rgb = rgbOf(e.color),
        rot = Date.now() / 1800;
      d.fillStyle = 'rgba(0,0,0,' + (0.34 - float * 0.03).toFixed(2) + ')';
      d.beginPath();
      d.ellipse(cx, sy + e.h + 1, e.w / 2 - 2 - float * 0.5, 3.2, 0, 0, 6.28);
      d.fill(); // shadow shrinks as he rises
      if (!flash) {
        const g = d.createRadialGradient(cx, ay, e.w * 0.3, cx, ay, e.w * 0.86); // aura: a soft bloom + counter-rotating arcs (was one hard flat ring)
        g.addColorStop(0, 'rgba(' + rgb + ',' + (0.2 + pulse * 0.13).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + rgb + ',0)');
        d.fillStyle = g;
        d.beginPath();
        d.arc(cx, ay, e.w * 0.86, 0, 6.28);
        d.fill();
        d.lineWidth = 1.4;
        d.strokeStyle = 'rgba(' + rgb + ',' + (0.3 + pulse * 0.34).toFixed(2) + ')';
        d.beginPath();
        d.arc(cx, ay, e.w * 0.74, rot, rot + 2.1);
        d.stroke();
        d.beginPath();
        d.arc(cx, ay, e.w * 0.74, rot + 3.14, rot + 5.24);
        d.stroke();
        d.strokeStyle = 'rgba(' + rgb + ',' + (0.22 + pulse * 0.2).toFixed(2) + ')';
        d.beginPath();
        d.arc(cx, ay, e.w * 0.62, -rot * 1.5, -rot * 1.5 + 1.5);
        d.stroke();
      }
      d.fillStyle = flash ? '#fff' : shade(e.color, 0, 0.18);
      d.beginPath();
      d.moveTo(cx, sy - 1 + float);
      d.lineTo(sx + e.w + 1, sy + e.h + 1 + float);
      d.lineTo(sx - 1, sy + e.h + 1 + float);
      d.closePath();
      d.fill(); // robe rim
      d.fillStyle = flash ? '#fff' : shade(e.color, 0, 0.4);
      d.beginPath();
      d.moveTo(cx, sy + 1 + float);
      d.lineTo(sx + e.w - 1, sy + e.h + float);
      d.lineTo(sx + 1, sy + e.h + float);
      d.closePath();
      d.fill(); // robe body — MULTIPLIED down from e.color, never hardcoded: ×0.40 lands on the approved deep violet for Morthrax and still leaves The Pale Shepherd pale
      if (!flash) {
        d.strokeStyle = 'rgba(0,0,0,0.30)';
        d.lineWidth = 1; // folds DARKEN whatever robe is under them (works on a pale Shepherd too) instead of a near-black line that read as a hard spear
        d.beginPath();
        d.moveTo(cx - 5, sy + 26 + float);
        d.lineTo(cx - 8, sy + e.h - 1 + float);
        d.stroke();
        d.beginPath();
        d.moveTo(cx + 5, sy + 26 + float);
        d.lineTo(cx + 8, sy + e.h - 1 + float);
        d.stroke(); // cloth folds — start BELOW the head, not behind it
        d.strokeStyle = 'rgba(' + rgb + ',0.42)';
        d.lineWidth = 1.2;
        d.beginPath();
        d.moveTo(cx, sy + 2 + float);
        d.lineTo(sx + 2, sy + e.h - 1 + float);
        d.stroke();
      } // lit edge
      d.fillStyle = flash ? '#fff' : shade(e.color, 0, 0.26); // HORNS keep the shipped triangle geometry on purpose: the prototype's curved stroke was drawn with no head over it — behind this head it reads as a thin antenna. Tapered wedges read as horns at 44px; only the tone is derived.
      d.beginPath();
      d.moveTo(cx - 16, sy + 12 + float);
      d.lineTo(cx - 24, sy + 2 + float);
      d.lineTo(cx - 10, sy + 8 + float);
      d.closePath();
      d.fill();
      d.beginPath();
      d.moveTo(cx + 16, sy + 12 + float);
      d.lineTo(cx + 24, sy + 2 + float);
      d.lineTo(cx + 10, sy + 8 + float);
      d.closePath();
      d.fill();
      if (!flash) {
        d.strokeStyle = 'rgba(' + rgb + ',0.30)';
        d.lineWidth = 1; // one lit edge along each horn's leading rib
        d.beginPath();
        d.moveTo(cx - 16, sy + 12 + float);
        d.lineTo(cx - 24, sy + 2 + float);
        d.stroke();
        d.beginPath();
        d.moveTo(cx + 16, sy + 12 + float);
        d.lineTo(cx + 24, sy + 2 + float);
        d.stroke();
      }
      d.fillStyle = flash ? '#fff' : shade(e.color, -70);
      d.beginPath();
      d.arc(cx, sy + 14 + float, 12.5, 0, 6.28);
      d.fill(); // head rim
      d.fillStyle = flash ? '#fff' : e.color;
      d.beginPath();
      d.arc(cx, sy + 14 + float, 11.5, 0, 6.28);
      d.fill(); // head KEEPS e.color — it is the only thing that makes The Pale Shepherd pale and a Great Beast its own hue
      if (!flash) {
        d.save();
        d.beginPath();
        d.arc(cx, sy + 14 + float, 11.5, 0, 6.28);
        d.clip();
        d.fillStyle = shade(e.color, -52);
        d.beginPath();
        d.ellipse(cx + 5, sy + 20 + float, 10, 8, 0, 0, 6.28);
        d.fill();
        d.restore(); // form shadow, lower-right
        d.fillStyle = 'rgba(255,255,255,0.30)';
        d.beginPath();
        d.ellipse(cx - 4.5, sy + 8.5 + float, 3.6, 2.4, -0.5, 0, 6.28);
        d.fill(); // the one highlight
        d.fillStyle = 'rgba(10,5,14,0.55)';
        d.fillRect(cx - 8, sy + 11 + float, 6, 6);
        d.fillRect(cx + 2, sy + 11 + float, 6, 6);
      } // SOCKETS, one per eye — a single wide brow ellipse spanning both read as a mouth/visor
      d.fillStyle = flash ? '#fff' : 'rgba(255,40,40,' + (0.78 + pulse * 0.22).toFixed(2) + ')';
      d.fillRect(cx - 7, sy + 12 + float, 4, 4);
      d.fillRect(cx + 3, sy + 12 + float, 4, 4); // ember eyes
      if (!flash) {
        d.fillStyle = 'rgba(255,160,160,0.9)';
        d.fillRect(cx - 6, sy + 12 + float, 1, 1);
        d.fillRect(cx + 4, sy + 12 + float, 1, 1);
      }
      d.fillStyle = flash ? '#fff' : '#c9a52e';
      d.fillRect(cx - 10, sy + 4 + float, 20, 4);
      d.fillRect(cx - 8, sy + float, 2, 5);
      d.fillRect(cx - 1, sy - 1 + float, 2, 6);
      d.fillRect(cx + 6, sy + float, 2, 5); // crown: rim…
      if (!flash) {
        d.fillStyle = '#f0d050';
        d.fillRect(cx - 10, sy + 4 + float, 20, 2);
        d.fillRect(cx - 8, sy + float, 2, 3);
        d.fillRect(cx - 1, sy - 1 + float, 2, 3);
        d.fillRect(cx + 6, sy + float, 2, 3); // …then gold, lit from above. The crown stays GOLD (it is metal, not creature colour) and is the bright focal point that keeps a dark boss off the dungeon floor
        d.fillStyle = 'rgba(255,245,190,0.85)';
        d.fillRect(cx - 10, sy + 4 + float, 20, 1);
      }
    },
  },
};

/** Facing hysteresis half-band, px (was p20 FACE_DZ; p20 re-aliases it from
 * CONTENT.faceDz). Facing HOLDS while the hero is within ±6px of the creature's own
 * column, so a foe dead-level with you cannot strobe its heading every frame; it takes a
 * full 12px swing to actually turn it around. A bare sign() flips on float noise — a
 * strobing dragon is worse than a backwards one. */
export const FACE_DZ = 6;

/* WHICH CREATURES HAVE A FRONT (was the hand-kept p20 FACING map — now DERIVED from the
   entries' `faces` flag, so the registry is the one source of truth). Every sprite is
   drawn in ONE fixed orientation (facing right); dragon/serpent/charger have an
   unambiguous HEAD and TAIL, so drawn unmirrored they would swim/fly/run BACKWARDS when
   travelling left. Nothing else qualifies: a slime is a blob, a bat is symmetric,
   skeleton/archer/mage/healer/boss face the CAMERA, and the kraken is radial.
   updateEnemies reads this map (via the p20 alias) to decide whose facing it must track;
   the draw hooks read it implicitly via `e._faceL` (only ever set for these kinds). */
const facing: Partial<Record<EnemyKindKey | EnemyArtKey, 1>> = {};
for (const k of Object.keys(ENEMIES) as (EnemyKindKey | EnemyArtKey)[]) if (ENEMIES[k].faces) facing[k] = 1;
export const FACING: Readonly<Partial<Record<EnemyKindKey | EnemyArtKey, 1>>> = facing;

/** Wild-spawn type tables per ring/biome (p03:353-376 verbatim). Enemy TYPE is gated by
 * ring, not just player level: the Vale stays gentle even for veterans, the Frontier is
 * brutal at any level. makeWildEnemy keeps the ring/level branch (it reads RING_SAFE/
 * RING_MID and the party level) and hands `pick` the ONE r it already drew. */
export const WILD_SPAWN: {
  readonly tables: {
    /** biome === 2 (Cinderlands). */
    readonly lava: WildSpawnTable;
    /** biome === 1 (Frozen Wastes). */
    readonly frozen: WildSpawnTable;
    /** df < RING_SAFE — easy lowland, no chargers. */
    readonly vale: WildSpawnTable;
    /** df >= RING_MID — hardest, widest variety (ranged archers + healers appear here). */
    readonly frontier: WildSpawnTable;
    /** mid ring, party level < 3. */
    readonly midEarly: WildSpawnTable;
    /** mid ring, party level < 6. */
    readonly midCore: WildSpawnTable;
    /** mid ring, party level 6+. */
    readonly midLate: WildSpawnTable;
  };
  pick(r: number, table: WildSpawnTable): EnemyKindKey;
} = {
  tables: {
    lava: {
      rows: [
        { t: 0.3, kind: 'charger' },
        { t: 0.6, kind: 'skeleton' },
        { t: 0.85, kind: 'mage' },
      ],
      rest: 'bat',
    },
    frozen: {
      rows: [
        { t: 0.34, kind: 'skeleton' },
        { t: 0.62, kind: 'charger' },
        { t: 0.86, kind: 'mage' },
      ],
      rest: 'bat',
    },
    vale: {
      rows: [
        { t: 0.55, kind: 'slime' },
        { t: 0.9, kind: 'bat' },
      ],
      rest: 'skeleton',
    },
    frontier: {
      rows: [
        { t: 0.14, kind: 'slime' },
        { t: 0.34, kind: 'skeleton' },
        { t: 0.56, kind: 'charger' },
        { t: 0.7, kind: 'archer' },
        { t: 0.82, kind: 'mage' },
        { t: 0.92, kind: 'healer' },
      ],
      rest: 'bat',
    },
    midEarly: {
      rows: [
        { t: 0.5, kind: 'slime' },
        { t: 0.88, kind: 'bat' },
      ],
      rest: 'skeleton',
    },
    midCore: {
      rows: [
        { t: 0.38, kind: 'slime' },
        { t: 0.68, kind: 'bat' },
        { t: 0.9, kind: 'skeleton' },
      ],
      rest: 'charger',
    },
    midLate: {
      rows: [
        { t: 0.28, kind: 'slime' },
        { t: 0.52, kind: 'bat' },
        { t: 0.78, kind: 'skeleton' },
      ],
      rest: 'charger',
    },
  },
  // The old ternary chain, as a walk: first `r < t` row wins, else the trailing branch.
  // Same constants, same strict-< comparisons, same order — bit-identical selection.
  pick(r, table) {
    for (const row of table.rows) if (r < row.t) return row.kind;
    return table.rest;
  },
};
