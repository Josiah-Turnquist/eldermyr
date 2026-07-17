const _shadeC = new Map();
function shade(hex, amt, mul) {
  // amt = additive, mul = multiplicative (mul darkens toward black, which additive can't do for saturated hues); memoised because this runs per-enemy per-frame and the colour set is tiny + fixed
  const m = mul === undefined ? 1 : mul,
    k = hex + '|' + amt + '|' + m;
  const hit = _shadeC.get(k);
  if (hit !== undefined) return hit;
  let out = hex;
  if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * m + amt)));
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * m + amt)));
    const b = Math.max(0, Math.min(255, Math.round((n & 255) * m + amt)));
    out = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  if (_shadeC.size < 400) _shadeC.set(k, out); // bounded: colours are a fixed set, but never let a tint pass grow this without limit
  return out;
}
const _rgbC = new Map();
function rgbOf(hex) {
  // '192,128,255' — for auras/glows that need a live alpha; only the PARSE is memoised, so the alpha stays free to pulse without poisoning the cache
  const hit = _rgbC.get(hex);
  if (hit !== undefined) return hit;
  let out = '160,160,160';
  if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const n = parseInt(hex.slice(1), 16);
    out = ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  }
  if (_rgbC.size < 400) _rgbC.set(hex, out);
  return out;
}
/* WHICH CREATURES HAVE A FRONT — registry data since P3/S3: `faces: true` on the entry
   in src/content/enemies.ts (CONTENT.facing is derived from the entries at chunk load;
   the hysteresis half-band rides CONTENT.faceDz). Positional aliases so updateEnemies'
   reads (p17) keep their bindings, same declaration position, zero call-site churn —
   still ONE source of truth for who has a front, it just lives with the art now. */
const FACING = CONTENT.facing;
const FACE_DZ = CONTENT.faceDz;
/* The DrawView handed to the content draw hooks (src/content/types.ts): the live 2D
   surface (g2d — content never names the ambient `ctx`, the purity grep keeps its
   teeth) plus the per-call prelude values and the two memoised tint helpers above. ONE
   module-level object, re-stamped per call — the render loop allocates nothing per enemy
   per frame (plan risk #8). */
const _DV = { g2d: null, sx: 0, sy: 0, flash: false, shade: shade, rgbOf: rgbOf };
function drawEnemy(e) {
  const sx = e.x - state.camera.x,
    sy = e.y - state.camera.y;
  const flash =
    (e.hitFlash > 0 && Math.floor(e.hitFlash / 2) % 2 === 0) ||
    (e.tele && e.tele.t < 10 && Math.floor(e.tele.t / 2) % 2 === 0);
  if (e.type !== 'boss') {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx + e.w / 2, sy + e.h + 1, e.w / 2, 3, 0, 0, 6.28);
    ctx.fill();
  }
  /* the boss draws its OWN shadow — it shrinks as he rises, which is what sells the float */ ctx.fillStyle =
    flash ? '#ffffff' : e.color;
  const _ek = CONTENT.enemies[e.type];
  if (_ek) {
    /* P3/S3: the 11 per-kind art branches live on the registry entries
       (src/content/enemies.ts, entry.draw) — moved verbatim, guarded op-for-op by
       tests/battery/facing-noregress.js. The dispatch, the shadow/flash prelude above and
       everything below (telegraph chain, arena ring, tints, hp bar, elite/affix rings,
       quarry marks, boss name) stay in-part. */
    _DV.g2d = ctx;
    _DV.sx = sx;
    _DV.sy = sy;
    _DV.flash = flash;
    _ek.draw(_DV, e);
  }
  if (e.isBoss && e.tele) {
    /* P3/S4: the six telegraph branches (slam/charge/nova/summon/pullunder/raiseadds — the
       undertow whirlpool ring and the raised-court rays included) are
       CONTENT.specials[name].drawTele hooks (src/content/specials.ts) — moved VERBATIM
       through the S3 DrawView surface (_DV, its g2d/sx/sy re-stamped for the boss). The
       dispatch, the arena ring, the frost/lava tints and the hp/elite/quarry/name chrome
       below all stay in-part. A name with no drawTele simply paints nothing (was the
       fall-through of the old if/else-if chain). */
    const sp = CONTENT.specials[e.tele.name];
    if (sp && sp.drawTele) {
      _DV.g2d = ctx;
      _DV.sx = sx;
      _DV.sy = sy;
      sp.drawTele(_DV, e);
    }
  }
  if (e.isPinnacle && e.arenaR) {
    const lcx = (e._lairTx != null ? e._lairTx * TILE + 16 : e.x + e.w / 2) - state.camera.x,
      lcy = (e._lairTy != null ? e._lairTy * TILE + 16 : e.y + e.h / 2) - state.camera.y;
    const isKing = e.pinKey === 'drownedking';
    const pulse = 0.5 + Math.sin(Date.now() / 300) * 0.5;
    ctx.strokeStyle = isKing
      ? `rgba(47,127,176,${0.3 + pulse * 0.28})`
      : `rgba(206,216,238,${0.3 + pulse * 0.28})`;
    ctx.lineWidth = 2;
    if (ctx.setLineDash) ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.arc(lcx, lcy, e.arenaR, 0, 6.28);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
  } /* the shrinking safe arena — dry ground (King) / lantern light (Shepherd); beyond it lies drowning / the killing dark */
  if (e.frost && e.chillT <= 0) {
    ctx.fillStyle = 'rgba(150,200,255,0.13)';
    ctx.fillRect(sx, sy, e.w, e.h);
  }
  if (e.lava) {
    ctx.fillStyle = 'rgba(255,90,30,0.16)';
    ctx.fillRect(sx, sy, e.w, e.h);
  }
  if (e.windup > 0) {
    const wf = Math.sin(Date.now() / 40) * 0.4 + 0.6;
    ctx.strokeStyle = `rgba(255,70,40,${wf})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx + e.w / 2, sy + e.h / 2, e.w * 0.72, 0, 6.28);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,80,40,${0.16 * wf})`;
    ctx.fillRect(sx, sy, e.w, e.h);
    ctx.fillStyle = `rgba(255,210,90,${wf})`;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('!', sx + e.w / 2, sy - 11);
    ctx.textAlign = 'left';
  }
  if (e.chillT > 0) {
    ctx.fillStyle = 'rgba(150,210,255,0.30)';
    ctx.fillRect(sx, sy, e.w, e.h);
  }
  if (e.burnT > 0 && Math.floor(Date.now() / 80) % 2 === 0) {
    ctx.fillStyle = 'rgba(255,130,40,0.22)';
    ctx.fillRect(sx, sy, e.w, e.h);
  }
  if (e.hp < e.maxHp) {
    const bw = e.isBoss ? 60 : e.w,
      bx = sx + e.w / 2 - bw / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(bx - 1, sy - 7, bw + 2, 5);
    ctx.fillStyle = '#e03030';
    ctx.fillRect(bx, sy - 6, bw * (e.hp / e.maxHp), 3);
  }
  if (e.elite && !e.isBoss && !e.isNemesis) {
    const ep = Math.sin(Date.now() / 300) * 0.25 + 0.6;
    ctx.strokeStyle = `rgba(255,210,90,${ep})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx + e.w / 2, sy + e.h / 2, e.w * 0.66, 0, 6.28);
    ctx.stroke();
    ctx.fillStyle = '#ffd24a';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(e.afxTag || '★ ELITE', sx + e.w / 2, sy - 8);
    ctx.textAlign = 'left';
  } /* afxTag is precomputed at roll time — no per-frame string building */
  if (e._afxN) {
    const acx = sx + e.w / 2,
      acy = sy + e.h / 2; // elite-affix indicators: one cheap ring/mote per affix
    if (e.afxShield && e.shieldMax > 0 && e.shieldHp > 0) {
      ctx.strokeStyle = 'rgba(126,210,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(acx, acy, e.w * 0.8, -1.57, -1.57 + 6.283 * (e.shieldHp / e.shieldMax));
      ctx.stroke();
    }
    if (e.afxVamp) {
      const vp = Math.sin(Date.now() / 260) * 0.18 + 0.4;
      ctx.strokeStyle = `rgba(225,50,90,${vp})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(acx, acy, e.w * 0.55, 0, 6.28);
      ctx.stroke();
    }
    if (e.afxSplit) {
      const sa = Date.now() / 380;
      ctx.fillStyle = '#9be24a';
      for (let k2 = 0; k2 < 2; k2++) {
        const a2 = sa + k2 * 3.14;
        ctx.beginPath();
        ctx.arc(acx + Math.cos(a2) * e.w * 0.72, acy + Math.sin(a2) * e.w * 0.72, 2.4, 0, 6.28);
        ctx.fill();
      }
    }
    if (e.afxWard && e.wardT > 0) {
      const wp = 0.55 + Math.sin(Date.now() / 90) * 0.35;
      ctx.strokeStyle = `rgba(158,203,255,${wp})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(acx, acy, e.w * 0.95, 0, 6.28);
      ctx.stroke();
      ctx.fillStyle = 'rgba(158,203,255,0.10)';
      ctx.beginPath();
      ctx.arc(acx, acy, e.w * 0.95, 0, 6.28);
      ctx.fill();
    }
  }
  if (
    e._markN > 0 &&
    (e._markBy === state.player || (e._markById != null && state.player && e._markById === state.player.id))
  ) {
    const _mn = Math.min(3, e._markN),
      _mg = 7,
      _my = sy - (e.isBoss || e.isNemesis || e.elite ? 24 : 15),
      _mx0 = sx + e.w / 2 - ((_mn - 1) * _mg) / 2;
    for (let _i = 0; _i < _mn; _i++) {
      const _px = _mx0 + _i * _mg;
      ctx.fillStyle = '#2a0a0a';
      ctx.beginPath();
      ctx.moveTo(_px, _my - 4);
      ctx.lineTo(_px + 3.4, _my);
      ctx.lineTo(_px, _my + 4);
      ctx.lineTo(_px - 3.4, _my);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath();
      ctx.moveTo(_px, _my - 2.7);
      ctx.lineTo(_px + 2.3, _my);
      ctx.lineTo(_px, _my + 2.7);
      ctx.lineTo(_px - 2.3, _my);
      ctx.closePath();
      ctx.fill();
    }
  } /* QUARRY MARKS made VISIBLE: up to 3 red pips over a foe YOU'VE marked (red = targeted/marked, distinct from poison green) — O(1) draw-path read (no scan). SP: _markBy is your player obj; MP: server packs _markById (the obj ref is dropped by packScalar) → each viewer sees only their OWN marks */
  if (e.isBoss || e.isNemesis) {
    ctx.fillStyle = e.isNemesis ? '#ff6060' : e.color;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText((e.isNemesis ? '☠ ' : '') + e.name.toUpperCase(), sx + e.w / 2, sy - 10);
    ctx.textAlign = 'left';
  }
  // v3.1.0 — EVERY foe wears its level, so players read danger straight off the map (was apex-only in
  // #121/#123). Gated on e.level truthiness only. facing-noregress NORMALIZES e.level=0 before drawing
  // (its probe stays art-only), and the golden hashes {state,maps}, never draw ops — so this broadening
  // touches neither gate. Sits ABOVE the boss/nemesis name (sy-22) or just over a plain foe (sy-11).
  if (e.level) {
    ctx.fillStyle = e.color;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Lv ' + e.level, sx + e.w / 2, sy - (e.isBoss || e.isNemesis ? 22 : 11));
    ctx.textAlign = 'left';
  }
}
