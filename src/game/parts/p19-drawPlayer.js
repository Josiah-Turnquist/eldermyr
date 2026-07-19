function drawPlayer() {
  const p = state.player,
    sx = p.x - state.camera.x,
    sy = p.y - state.camera.y;
  // v3.2.2 — i-frame SHIMMER (replaces the old hard on/off blink `Math.floor(p.invuln/4)%2` that
  // SKIPPED the sprite on alternating windows — a strobe). During invulnerability (dodge i-frames +
  // the post-hit grace) the hero draws at a gentle, softly-pulsing translucency instead: you still
  // read "invincible" without the flicker. Render-only, so it is outside the golden hash root; the
  // alpha is reset to 1 before the function returns (below the _clk block) so nothing else renders
  // translucent. The internal save/restore pairs (heat aura, creature art, _clk) all nest under it —
  // the first internal save captures this alpha and its restore returns to it, exactly like the
  // existing _clk 0.32 wrap does.
  const _iframe = p.invuln > 0;
  if (_iframe) ctx.globalAlpha = 0.55 + 0.15 * Math.sin(p.invuln * 0.45); // soft pulse ~0.4–0.7
  const bob =
    p.moving || p.sailing ? Math.sin(p.sailing ? Date.now() / 220 : p.animFrame * 1.57) * 2 : 0;
  const style = styleOf(equippedWeapon());
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(sx + p.w / 2, sy + p.h + 2, p.w / 2, 4, 0, 0, 6.28);
  ctx.fill();
  {
    const _hw = equippedWeapon(),
      _hel = style === 'magic' && _hw && _hw.element ? _hw.element : null,
      _hh = _hel ? Math.min(1, (p.heat || 0) / 100) : 0;
    if (_hh > 0) {
      const _rgb = elemRgb(_hel),
        _cx = sx + p.w / 2,
        _cy = sy + p.h / 2,
        _pz = 0.5 + 0.5 * Math.sin(Date.now() / (300 - 150 * _hh)),
        _rad = p.w * (0.6 + 0.55 * _hh) * (0.94 + 0.1 * _pz);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const _g = ctx.createRadialGradient(_cx, _cy, 0, _cx, _cy, _rad);
      _g.addColorStop(0, 'rgba(' + _rgb + ',' + ((0.12 + 0.34 * _hh) * (0.65 + 0.35 * _pz)).toFixed(3) + ')');
      _g.addColorStop(1, 'rgba(' + _rgb + ',0)');
      ctx.fillStyle = _g;
      ctx.beginPath();
      ctx.arc(_cx, _cy, _rad, 0, 6.28);
      ctx.fill();
      ctx.restore();
      if ((p.heat || 0) >= HEAT_AURA_MIN) {
        ctx.strokeStyle = 'rgba(' + _rgb + ',' + (0.3 + 0.4 * _pz).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(_cx, _cy, p.w * 0.82, 0, 6.28);
        ctx.stroke();
      }
    }
  } /* HEAT pulsate: an elemental staff makes the hero glow in the element's colour, intensity ∝ Heat; a live aura (Heat≥threshold) adds the ring */
  const _clk = !!p.cloaked;
  if (_clk) {
    ctx.save();
    ctx.globalAlpha = 0.32;
  } /* GRAVEWOOL CLOAK: the hero renders faint while cloaked; restored + a shimmer ring at the end of drawPlayer */
  if (p.sailing) {
    ctx.fillStyle = '#7a5230';
    ctx.beginPath();
    ctx.moveTo(sx - 5, sy + p.h - 3 + bob);
    ctx.lineTo(sx + p.w + 5, sy + p.h - 3 + bob);
    ctx.lineTo(sx + p.w + 1, sy + p.h + 7 + bob);
    ctx.lineTo(sx - 1, sy + p.h + 7 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9a7240';
    ctx.fillRect(sx - 3, sy + p.h - 4 + bob, p.w + 6, 2);
    ctx.fillStyle = '#d8c0a0';
    ctx.fillRect(sx + p.w / 2 - 1, sy + p.h - 16 + bob, 2, 13);
    ctx.fillStyle = '#e8e0d0';
    ctx.beginPath();
    ctx.moveTo(sx + p.w / 2 + 1, sy + p.h - 15 + bob);
    ctx.lineTo(sx + p.w / 2 + 9, sy + p.h - 9 + bob);
    ctx.lineTo(sx + p.w / 2 + 1, sy + p.h - 5 + bob);
    ctx.closePath();
    ctx.fill();
  }
  if (p.dragon && p.dragon.mounted) {
    /* YOUR STEED *IS* THE EMBERWYRM — the same creature as drawEnemy's e.type==='dragon' branch, built to the same
       recipe (dark RIM so it reads on any ground, TWO tones of shading for form, ONE highlight, a furnace maw, motion
       that sells weight) from the same PALETTE: every tone here derives from DRAGON_COLOR via shade(), the one const
       makeWildDragon also paints the wild wyrm with. That is the whole point — the steed used to hardcode its own
       '#e85020'/'#9a3015', so taming the wyrm turned it into a different animal, and a recolour of one would silently
       leave the other behind. Nothing below may reintroduce a literal wyrm tone.
       The COMPOSITION deliberately is NOT the enemy's: that one is a free-standing side view, this one has a RIDER on
       it. The hero draws AFTER this block and composites on top, so the barrel's middle is occluded by design — the
       wings, tail, neck and head are pushed out to read AROUND him, and that occlusion is what sells the ride.
       Everything rides `bob` with the hero (the ground shadow deliberately does not) so saddle and rider never drift
       apart, and the flap keeps its original `fl` driver. No `flash` branch: a hurt hero blinks out at the top of
       drawPlayer, mount and all. */
    const fl = Math.sin(Date.now() / 110) * 4,
      fire = Math.sin(Date.now() / 90) * 0.5 + 0.5,
      cx = sx + p.w / 2,
      dy = sy + bob;
    ctx.save();
    if (p.dir === 'left') {
      ctx.translate(cx * 2, 0);
      ctx.scale(-1, 1);
    } /* FACE LEFT: mirror about cx — the hero's own centre, which is also the steed's, so the wyrm turns under him without sliding sideways. `p.dir` is the RIGHT input and needs no new state: it is already sticky (only written while a key is held, and A/D override W/S, so it is 'left'/'right' whenever you have any horizontal input at all) which makes it jitter-free by construction; drawPlayer ALREADY reads it for the cape. It also reaches every render path for free — SP, MP's own hero, and MP teammates, whose `dir` lightPlayer already sends and drawOthers already Object.assigns onto its temp player. UP/DOWN deliberately keep the last-pressed side view rather than snapping: matching the cape, which likewise gives 'up'/'down' their own treatment instead of preserving a horizontal facing, and a top-down game has no honest head-on dragon pose to switch to. The restore fires BEFORE the rider: the hero's cape/body/armour/skin must composite on top in world space, unmirrored, or his gear would flip with his mount. */
    const rim = shade(DRAGON_COLOR, -70),
      belly = shade(DRAGON_COLOR, -42),
      lit = shade(DRAGON_COLOR, 42),
      wingC = shade(DRAGON_COLOR, 0, 0.4),
      wrim = shade(DRAGON_COLOR, 0, 0.2);
    const hx = sx + p.w + 10,
      hy = dy + 12,
      ay = dy + 2 - fl; // head centre — carried out front and UP on a real neck, clear of the barrel so the skull reads as a skull; and the wing hinge, set behind his back so the wings emerge from under him
    ctx.fillStyle = 'rgba(0,0,0,' + (0.22 - fl * 0.012).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(cx, sy + p.h + 9, p.w * 0.95 - fl * 0.5, 5 - fl * 0.18, 0, 0, 6.28);
    ctx.fill(); // the shadow SHRINKS on the upstroke (fl>0 = wings high = the wyrm rises) — same weight cue as the boss's float
    ctx.fillStyle = wrim;
    ctx.beginPath();
    ctx.moveTo(sx - 18, dy + 9);
    ctx.lineTo(cx, ay);
    ctx.lineTo(sx - 1, dy + 26);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx + p.w + 18, dy + 9);
    ctx.lineTo(cx, ay);
    ctx.lineTo(sx + p.w + 1, dy + 26);
    ctx.closePath();
    ctx.fill(); // wing rims. The trailing corners are tucked INSIDE the barrel (drawn later, over them) — pushed any lower they spike out under the belly and read as debris, not a wing
    ctx.fillStyle = wingC;
    ctx.beginPath();
    ctx.moveTo(sx - 16, dy + 10);
    ctx.lineTo(cx, ay + 2);
    ctx.lineTo(sx - 1.5, dy + 24.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx + p.w + 16, dy + 10);
    ctx.lineTo(cx, ay + 2);
    ctx.lineTo(sx + p.w + 1.5, dy + 24.5);
    ctx.closePath();
    ctx.fill(); // membranes
    ctx.strokeStyle = wrim;
    ctx.lineWidth = 1.2; // wing ribs — they make the flap read
    for (let i = 0; i < 2; i++) {
      const t2 = 0.34 + i * 0.32,
        rx2 = 14.5 * t2,
        ry2 = dy + 10 + 14.5 * t2; // endpoints LERP the membrane's own tip->trailing edge (14.5 on both axes). Mismatch these and the rib tips land outside the membrane and poke out as loose specks
      ctx.beginPath();
      ctx.moveTo(cx, ay + 2);
      ctx.lineTo(sx - 16 + rx2, ry2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, ay + 2);
      ctx.lineTo(sx + p.w + 16 - rx2, ry2);
      ctx.stroke();
    }
    ctx.strokeStyle = rim;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx + 4, dy + 23);
    ctx.quadraticCurveTo(sx - 10, dy + 30, sx - 18, dy + 21 - fl * 0.5);
    ctx.stroke();
    ctx.strokeStyle = DRAGON_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx + 4, dy + 23);
    ctx.quadraticCurveTo(sx - 10, dy + 30, sx - 18, dy + 21 - fl * 0.5);
    ctx.stroke();
    ctx.lineCap = 'butt'; // tail, sweeping back off the far side — head right, tail left, exactly as the wild wyrm reads
    ctx.fillStyle = rim;
    ctx.strokeStyle = rim;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round'; // RIM pass — neck, barrel and skull all go down in the rim tone FIRST (the enemy's exact build), so no dark edge is ever left crossing a lit surface
    ctx.beginPath();
    ctx.moveTo(sx + 13, dy + 21);
    ctx.quadraticCurveTo(sx + 25, dy + 21, hx - 4, hy + 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx - 2, dy + 23, 18, 7.5, 0, 0, 6.28);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx, hy, 8, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = DRAGON_COLOR;
    ctx.strokeStyle = DRAGON_COLOR;
    ctx.lineWidth = 6; // COLOUR pass, same order — each shape covers its own rim's interior and leaves the 1px edge standing
    ctx.beginPath();
    ctx.moveTo(sx + 13, dy + 21);
    ctx.quadraticCurveTo(sx + 25, dy + 21, hx - 4, hy + 3);
    ctx.stroke();
    ctx.lineCap = 'butt'; // NECK — long enough to actually look over, which is half of what "I am riding this" means; the barrel buries its root
    ctx.beginPath();
    ctx.ellipse(cx - 2, dy + 23, 17, 6.5, 0, 0, 6.28);
    ctx.fill(); // BARREL: round, not the enemy's rect (you sit ON this one, and a slab under a rider reads as furniture), and centred BEHIND the hero — a wyrm's bulk trails its shoulders, which is where a rider sits
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx - 2, dy + 23, 17, 6.5, 0, 0, 6.28);
    ctx.clip(); // clipped so the shading can never spill past the barrel and float
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(cx - 2, dy + 29.5, 17, 5, 0, 0, 6.28);
    ctx.fill(); // belly in shadow — the second tone
    ctx.fillStyle = lit;
    ctx.fillRect(sx - 6, dy + 20.2, 5, 2.3);
    ctx.fillRect(sx - 1, dy + 18.4, 5, 2.3);
    ctx.restore(); // lit scales on the HAUNCH — placed to sit on the barrel's curve, and clipped to it so they can never float free of the back
    ctx.fillStyle = lit;
    ctx.fillRect(sx + 18, dy + 17, 4.5, 2.3);
    ctx.fillRect(sx + 22.5, dy + 15.4, 4.5, 2.3); // …continuing as a DORSAL RIDGE up the neck. Together these are the wyrm's lit back scales, routed around the one thing its wild twin doesn't have on its spine: a passenger. The skull (next) caps the top one.
    ctx.fillStyle = DRAGON_COLOR;
    ctx.beginPath();
    ctx.arc(hx, hy, 7, 0, 6.28);
    ctx.fill(); // skull last of the colour pass — it caps the neck and the ridge
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, hy, 7, 0, 6.28);
    ctx.clip();
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(hx + 2, hy + 6, 7, 4.4, 0, 0, 6.28);
    ctx.fill();
    ctx.restore(); // jaw in shadow, clipped to the skull
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.beginPath();
    ctx.ellipse(hx - 3.5, hy - 4, 2.6, 1.8, -0.5, 0, 6.28);
    ctx.fill(); // the one highlight
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.moveTo(hx - 3.5, hy - 5.5);
    ctx.lineTo(hx - 6.5, hy - 12);
    ctx.lineTo(hx, hy - 7.5);
    ctx.closePath();
    ctx.fill(); // swept-back horn
    ctx.fillStyle = shade(DRAGON_COLOR, -30);
    ctx.fillRect(hx + 3, hy + 1, 7, 4); // snout
    ctx.fillStyle = '#ffe030';
    ctx.fillRect(hx + 1, hy - 3, 3, 3);
    ctx.fillStyle = '#3a2000';
    ctx.fillRect(hx + 2, hy - 3, 1, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(hx + 1, hy - 3, 1, 1); // gold eye, slit pupil, glint — the wyrm's exact eye
    ctx.fillStyle = 'rgba(255,120,40,' + (0.25 + fire * 0.3).toFixed(2) + ')';
    ctx.beginPath();
    ctx.arc(hx + 10, hy + 1.5, 5, 0, 6.28);
    ctx.fill(); // furnace glow at the maw
    ctx.fillStyle = '#ff6020';
    ctx.fillRect(hx + 6, hy, 7, 3);
    ctx.fillStyle = 'rgba(255,230,120,' + (0.55 + fire * 0.45).toFixed(2) + ')';
    ctx.fillRect(
      hx + 6,
      hy + 0.8,
      5,
      1.4,
    ); /* maw fire + hot core, on the same `fire` driver as the wild wyrm's */
    ctx.restore();
  } /* …steed done, transform dropped — the rider below is drawn in world space */
  const a = equippedArmor();
  const sk = (((p.skin | 0) % 5) + 5) % 5;
  const ARCH = [
    { cape: '#4060c0', hair: '#6a4a2a' }, // 0 KNIGHT — the classic hero
    { cape: '#2e6b3f', hood: '#245232' }, // 1 RANGER — hood up, forest cloak
    { robe: '#6a3fa0', hat: '#4a2c78' }, // 2 MAGE — violet robe + pointed hat
    { hair: '#241616', band: '#c03030', pauld: '#8a6a3a' }, // 3 BARBARIAN — headband + pauldrons, no cape
    { cape: '#3a4152', hair: '#1c1f2a', mask: '#2c3140', short: true }, // 4 ROGUE — masked, short slate cape
  ];
  const AR = ARCH[sk];
  let bodyColor = '#6b7086';
  if (a && a.name.includes('Tunic') && a.rarity > 0) bodyColor = '#8a6a3a';
  if (
    a &&
    (a.name.includes('Plate') ||
      a.name.includes('Mail') ||
      a.name.includes('Aegis') ||
      a.name.includes('Guardian'))
  )
    bodyColor = '#b0b0c0'; // v2.40.0: five DISTINCT hero archetypes (silhouettes, not palette swaps); the torso still shows your armor
  const lg = p.moving
    ? [
        [2, 0],
        [1, 1],
        [0, 2],
        [1, 1],
      ][p.animFrame % 4]
    : [1, 1];
  // CLOAK (knight/ranger/rogue): fabric that FOLLOWS the walk — trails opposite your travel
  // direction, flaps with each step, billows fuller when you face away, breathes idle.
  // LAYER: hangs off the BACK, so it draws BEHIND the body normally but ON TOP when you
  // face away (walking up = back to camera → the cape covers you).
  const drawCape = () => {
    const st2 = p.moving ? Math.sin(p.animFrame * 1.57) : 0; // step phase −1..1
    let trail = 0,
      flare = 0,
      lift = 0,
      wide = 0;
    if (p.moving) {
      if (p.dir === 'right')
        trail = -(2.5 + st2 * 1.4); // running right → cape streams left
      else if (p.dir === 'left') trail = 2.5 + st2 * 1.4;
      else if (p.dir === 'up')
        flare = st2 * 1.1; // back to camera → hem billows in/out around its size (oscillates, never grows)
      else {
        lift = 1.6 + st2;
        flare = st2 * 1.6;
      } // toward camera → hem kicks up + wags behind
    } else trail = Math.sin(Date.now() / 650) * 0.8; // idle breeze
    const up = p.dir === 'up',
      drop = up ? 5 : 0; // facing away → drape the WHOLE cape lower on the back (shoulders→feet), same length, just shifted down off the neck
    const hemY = (AR.short ? p.h - 8 : p.h - 3) - lift + drop,
      topY = (up ? 4 : 10) + drop;
    ctx.fillStyle = AR.cape;
    ctx.beginPath();
    ctx.moveTo(sx + 5 - wide, sy + topY + bob);
    ctx.lineTo(sx + p.w - 5 + wide, sy + topY + bob);
    ctx.lineTo(sx + p.w - 2 + wide + trail + flare, sy + hemY + bob);
    ctx.lineTo(sx + 2 - wide + trail - flare, sy + hemY + bob);
    ctx.closePath();
    ctx.fill();
    if (p.dir === 'up') {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(sx + p.w / 2 - 1, sy + topY + 2 + bob, 2, hemY - topY - 3);
    } // a center seam down the back
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(sx + 3 + trail * 0.6, sy + hemY - 2 + bob, p.w - 6, 2);
  };
  if (AR.cape && p.dir !== 'up') drawCape(); // facing toward/across camera → cape is behind the body
  ctx.fillStyle = '#2c3050';
  ctx.fillRect(sx + 7, sy + p.h - 6 + bob, 4, 4 + lg[0]);
  ctx.fillRect(sx + p.w - 11, sy + p.h - 6 + bob, 4, 4 + lg[1]);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(sx + 5, sy + 10 + bob, p.w - 10, p.h - 15);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(sx + 5, sy + 10 + bob, 3, p.h - 15);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(sx + p.w - 8, sy + 10 + bob, 3, p.h - 15);
  ctx.fillStyle = '#3a2c18';
  ctx.fillRect(sx + 5, sy + 15 + bob, p.w - 10, 2);
  ctx.fillStyle = '#c8a040';
  ctx.fillRect(sx + p.w / 2 - 1, sy + 15 + bob, 2, 2);
  ctx.fillStyle = '#e8c090';
  ctx.fillRect(sx + 6, sy + bob, p.w - 12, 11);
  if (AR.hair) {
    ctx.fillStyle = AR.hair;
    ctx.fillRect(sx + 6, sy + bob, p.w - 12, 4);
    ctx.fillRect(sx + 6, sy + bob, 2, 7);
  }
  // archetype signatures — silhouette pieces, not palette swaps
  if (AR.hood) {
    ctx.fillStyle = AR.hood;
    ctx.fillRect(sx + 5, sy - 1 + bob, p.w - 10, 5);
    ctx.fillRect(sx + 5, sy + 2 + bob, 2, 8);
    ctx.fillRect(sx + p.w - 7, sy + 2 + bob, 2, 8);
  }
  if (AR.hat) {
    ctx.fillStyle = AR.hat;
    ctx.beginPath();
    ctx.moveTo(sx + p.w / 2, sy - 8 + bob);
    ctx.lineTo(sx + p.w - 3, sy + 3 + bob);
    ctx.lineTo(sx + 3, sy + 3 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(sx + 4, sy + 2 + bob, p.w - 8, 1);
  }
  if (AR.robe) {
    ctx.fillStyle = AR.robe;
    ctx.beginPath();
    ctx.moveTo(sx + 5, sy + 12 + bob);
    ctx.lineTo(sx + p.w - 5, sy + 12 + bob);
    ctx.lineTo(sx + p.w - 3, sy + p.h + bob);
    ctx.lineTo(sx + 3, sy + p.h + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(sx + 4, sy + p.h - 2 + bob, p.w - 8, 2);
  }
  if (AR.band) {
    ctx.fillStyle = AR.band;
    ctx.fillRect(sx + 6, sy + 3 + bob, p.w - 12, 2);
  }
  if (AR.pauld) {
    ctx.fillStyle = AR.pauld;
    ctx.fillRect(sx + 3, sy + 10 + bob, 4, 4);
    ctx.fillRect(sx + p.w - 7, sy + 10 + bob, 4, 4);
  }
  if (AR.mask) {
    ctx.fillStyle = AR.mask;
    ctx.fillRect(sx + 6, sy + 7 + bob, p.w - 12, 4);
  }
  if (AR.cape && p.dir === 'up') drawCape(); // facing away → the cape drapes OVER the back, on top of the body
  ctx.fillStyle = '#000';
  if (p.dir === 'down') {
    ctx.fillRect(sx + 8, sy + 5 + bob, 2, 2);
    ctx.fillRect(sx + 13, sy + 5 + bob, 2, 2);
  }
  if (p.dir === 'left') ctx.fillRect(sx + 7, sy + 5 + bob, 2, 2);
  if (p.dir === 'right') ctx.fillRect(sx + 13, sy + 5 + bob, 2, 2);
  const acc = { melee: '#ff9060', ranged: '#90e060', magic: '#b070ff' }[style];
  ctx.fillStyle = acc;
  ctx.fillRect(sx + p.w - 7, sy + 9 + bob, 3, 8);
  if (p.whirl > 0) {
    const cx = sx + p.w / 2,
      cy = sy + p.h / 2,
      alpha = p.whirl / 16,
      r = 24 + (16 - p.whirl) * 1.6;
    ctx.strokeStyle = `rgba(160,220,255,${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 6.28);
    ctx.stroke();
    ctx.strokeStyle = `rgba(220,240,255,${alpha * 0.7})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.7, 0, 6.28);
    ctx.stroke();
  }
  if (style === 'melee' && p.attacking > 0 && p.whirl <= 0) {
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 3;
    const prog = 1 - p.attacking / 12;
    ctx.beginPath();
    const cx = sx + p.w / 2,
      cy = sy + p.h / 2;
    if (p.dir === 'right') ctx.arc(cx, cy, 22, -1 + prog * 2, -1 + prog * 2 + 0.5);
    else if (p.dir === 'left') ctx.arc(cx, cy, 22, 3.6 - prog * 2, 3.6 - prog * 2 + 0.5);
    else if (p.dir === 'up') ctx.arc(cx, cy, 22, -2.3 + prog * 1.5, -2.3 + prog * 1.5 + 0.5);
    else ctx.arc(cx, cy, 22, 0.8 + prog * 1.5, 0.8 + prog * 1.5 + 0.5);
    ctx.stroke();
  }
  if (p.fishing) {
    const bx = sx + p.w / 2 + (p.dir === 'left' ? -18 : p.dir === 'right' ? 18 : 0),
      by = sy + p.h / 2 + (p.dir === 'up' ? -16 : 12) + Math.sin(Date.now() / 220) * 2;
    ctx.strokeStyle = '#d8dee6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + p.w / 2, sy + 6);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = '#e85050';
    ctx.beginPath();
    ctx.arc(bx, by, 3, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx - 1, by - 2, 2, 1);
  }
  if (p.chillT > 0) {
    ctx.fillStyle = '#a6e2ff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('❄', sx + p.w / 2, sy - 9);
    ctx.textAlign = 'left';
  }
  if (_clk) {
    ctx.restore();
    const _ccx = sx + p.w / 2,
      _ccy = sy + p.h / 2,
      _cp = 0.3 + 0.2 * Math.sin(Date.now() / 260);
    ctx.strokeStyle = 'rgba(160,178,214,' + _cp.toFixed(2) + ')';
    if (ctx.setLineDash) ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(_ccx, _ccy, p.w * 0.78, 0, 6.28);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
  } /* GRAVEWOOL: undo the faint-alpha wrap opened before the sailing block, then draw a dashed shimmer ring so a cloaked hero reads clearly */
  if (_iframe) ctx.globalAlpha = 1; // v3.2.2 — close the i-frame shimmer so nothing after drawPlayer renders translucent
}
/* CREATURE ART — the recipe, applied to every branch below: a dark RIM so the silhouette reads on grass AND on dungeon
   stone, TWO tones of shading for form (never a flat fill), ONE highlight, and motion that sells weight (squash on the
   slime, a footfall bob on the skeleton, a float whose shadow shrinks on the boss). Drivers are the ones that already
   exist — e.wobble (updateEnemies, +0.1/frame) and Date.now(). Every tone DERIVES from e.color via shade(), because
   colour is DATA and later passes recolour these: a warlord is a RED skeleton (#ff2828), pinnacle adds are blue/pale
   skeletons, the Treasure Sprite is a GOLD bat, POI/raid mobs go red, and The Pale Shepherd is a near-WHITE boss
   (#d6e6f2). Hardcode a tone and you erase that identity. Every branch keeps its `flash` white-out: shading and
   highlight work sits behind `if(!flash)` so a struck foe reads as a clean white silhouette. */
