const _shadeC = new Map();
function shade(hex, amt, mul){   // amt = additive, mul = multiplicative (mul darkens toward black, which additive can't do for saturated hues); memoised because this runs per-enemy per-frame and the colour set is tiny + fixed
  const m = (mul === undefined ? 1 : mul), k = hex + '|' + amt + '|' + m;
  const hit = _shadeC.get(k); if(hit !== undefined) return hit;
  let out = hex;
  if(typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)){
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round(((n>>16)&255)*m + amt)));
    const g = Math.max(0, Math.min(255, Math.round(((n>>8)&255)*m + amt)));
    const b = Math.max(0, Math.min(255, Math.round((n&255)*m + amt)));
    out = '#' + ((1<<24) + (r<<16) + (g<<8) + b).toString(16).slice(1);
  }
  if(_shadeC.size < 400) _shadeC.set(k, out);   // bounded: colours are a fixed set, but never let a tint pass grow this without limit
  return out;
}
const _rgbC = new Map();
function rgbOf(hex){   // '192,128,255' — for auras/glows that need a live alpha; only the PARSE is memoised, so the alpha stays free to pulse without poisoning the cache
  const hit = _rgbC.get(hex); if(hit !== undefined) return hit;
  let out = '160,160,160';
  if(typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)){
    const n = parseInt(hex.slice(1), 16);
    out = ((n>>16)&255) + ',' + ((n>>8)&255) + ',' + (n&255);
  }
  if(_rgbC.size < 400) _rgbC.set(hex, out);
  return out;
}
/* WHICH CREATURES HAVE A FRONT. Every sprite in this game is drawn in ONE fixed orientation (facing
   right) — invisible for years because the hero is front-facing and most foes are blobs, skulls and
   robes with no readable head. These four have an unambiguous HEAD and TAIL, so drawn unmirrored they
   swim/fly/run BACKWARDS whenever they travel left. Nothing else qualifies: a slime is a blob, a bat
   is symmetric, skeleton/archer/mage/healer/boss face the CAMERA, and the kraken is radial.
   This map is the ONE source of truth — updateEnemies reads it to decide whose facing it must track,
   drawEnemy reads it implicitly via `e._faceL` (only ever set for these types). Same lesson as
   DRAGON_COLOR: one const, so the sim and the renderer can never drift apart on who has a front. */
const FACING={dragon:1,serpent:1,charger:1};
const FACE_DZ=6;   // hysteresis half-band, px. Facing HOLDS while the hero is within ±6px of the creature's own column, so a foe dead-level with you cannot strobe its heading every frame; it takes a full 12px swing to actually turn it around. A bare sign() flips on float noise — a strobing dragon is worse than a backwards one.
function drawEnemy(e){ const sx=e.x-state.camera.x,sy=e.y-state.camera.y; const flash=(e.hitFlash>0&&Math.floor(e.hitFlash/2)%2===0)||(e.tele&&e.tele.t<10&&Math.floor(e.tele.t/2)%2===0); if(e.type!=='boss'){ ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sx+e.w/2,sy+e.h+1,e.w/2,3,0,0,6.28); ctx.fill(); }/* the boss draws its OWN shadow — it shrinks as he rises, which is what sells the float */ ctx.fillStyle=flash?'#ffffff':e.color;
  if(e.type==='slime'){ const sq=Math.sin(e.wobble)*2.2, cx=sx+e.w/2, cy=sy+e.h/2+sq/2, rx=e.w/2+Math.max(0,sq)*0.35, ry=e.h/2-sq/2;   // squash & stretch: it widens as it flattens, so it reads as jelly with weight
    ctx.fillStyle=flash?'#fff':shade(e.color,-52); ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,6.28); ctx.fill();                    // rim
    ctx.fillStyle=flash?'#fff':e.color; ctx.beginPath(); ctx.ellipse(cx,cy,rx-1,ry-1,0,0,6.28); ctx.fill();                           // body
    if(!flash){ ctx.save(); ctx.beginPath(); ctx.ellipse(cx,cy,rx-1,ry-1,0,0,6.28); ctx.clip();
      ctx.fillStyle=shade(e.color,-26); ctx.beginPath(); ctx.ellipse(cx,cy+ry*0.75,rx,ry*0.7,0,0,6.28); ctx.fill();                   // underside shadow — form, not a flat disc
      ctx.fillStyle=shade(e.color,-14); ctx.beginPath(); ctx.ellipse(cx,cy+ry*0.25,rx*0.42,ry*0.34,0,0,6.28); ctx.fill(); ctx.restore(); // translucent core
      ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(cx-rx*0.34,cy-ry*0.45,rx*0.24,ry*0.16,-0.5,0,6.28); ctx.fill(); } // the one highlight
    const ey=cy-ry*0.12, er=1.9+Math.max(0,-sq)*0.12;
    ctx.fillStyle='#141018'; ctx.beginPath(); ctx.ellipse(cx-3.6,ey,er,er*1.15,0,0,6.28); ctx.fill(); ctx.beginPath(); ctx.ellipse(cx+3.6,ey,er,er*1.15,0,0,6.28); ctx.fill();   // eyes stay dark through the flash — they're what keeps it readable as a face
    if(!flash){ ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fillRect(cx-4.3,ey-1.2,1,1); ctx.fillRect(cx+2.9,ey-1.2,1,1); } }
  else if(e.type==='bat'){ const flap=Math.sin(e.wobble*3), cx=sx+e.w/2, cy=sy+e.h/2, br=e.w/3, wt=cy-flap*4;   // only 18px — the wingbeat IS the read, so it gets the detail and the body stays simple
    const rim=flash?'#fff':shade(e.color,-58), mem=flash?'#fff':shade(e.color,-32);
    ctx.fillStyle=rim; ctx.beginPath(); ctx.moveTo(cx-3,cy-2); ctx.quadraticCurveTo(cx-8,wt-4,sx-3,wt); ctx.quadraticCurveTo(cx-7,cy+3,cx-2,cy+4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx+3,cy-2); ctx.quadraticCurveTo(cx+8,wt-4,sx+e.w+3,wt); ctx.quadraticCurveTo(cx+7,cy+3,cx+2,cy+4); ctx.closePath(); ctx.fill();                       // wing rims
    if(!flash){ ctx.fillStyle=mem;
      ctx.beginPath(); ctx.moveTo(cx-3,cy-1); ctx.quadraticCurveTo(cx-8,wt-3,sx-1.6,wt-0.4); ctx.quadraticCurveTo(cx-6.6,cy+2.4,cx-2,cy+3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx+3,cy-1); ctx.quadraticCurveTo(cx+8,wt-3,sx+e.w+1.6,wt-0.4); ctx.quadraticCurveTo(cx+6.6,cy+2.4,cx+2,cy+3); ctx.closePath(); ctx.fill();           // membranes
      ctx.strokeStyle=rim; ctx.lineWidth=0.8; ctx.beginPath(); ctx.moveTo(cx-2,cy+1); ctx.lineTo(sx-1,wt+0.6); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx+2,cy+1); ctx.lineTo(sx+e.w+1,wt+0.6); ctx.stroke(); }   // one rib each
    ctx.fillStyle=rim; ctx.beginPath(); ctx.moveTo(cx-3.4,cy-br+1); ctx.lineTo(cx-4.6,cy-br-3.4); ctx.lineTo(cx-1,cy-br-0.4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx+3.4,cy-br+1); ctx.lineTo(cx+4.6,cy-br-3.4); ctx.lineTo(cx+1,cy-br-0.4); ctx.closePath(); ctx.fill();                                               // ears — cheap, and they carry the silhouette
    ctx.beginPath(); ctx.arc(cx,cy,br+1,0,6.28); ctx.fill();
    ctx.fillStyle=flash?'#fff':e.color; ctx.beginPath(); ctx.arc(cx,cy,br,0,6.28); ctx.fill();
    if(!flash){ ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,br,0,6.28); ctx.clip(); ctx.fillStyle=shade(e.color,-30); ctx.beginPath(); ctx.ellipse(cx,cy+br*0.85,br,br*0.7,0,0,6.28); ctx.fill(); ctx.restore();
      ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(cx-br*0.35,cy-br*0.45,br*0.3,br*0.2,-0.5,0,6.28); ctx.fill(); }
    ctx.fillStyle='#f04040'; ctx.fillRect(cx-3.5,cy-1,2,2); ctx.fillRect(cx+1.5,cy-1,2,2);
    if(!flash){ ctx.fillStyle='rgba(255,210,210,0.9)'; ctx.fillRect(cx-3.5,cy-1,1,1); ctx.fillRect(cx+1.5,cy-1,1,1); } }
  else if(e.type==='skeleton'){ const step=Math.sin(e.wobble*2), st2=step>0?1:0, bob=Math.abs(step)*0.6, oy=sy-bob;   // the bob puts weight on each footfall
    const bone=flash?'#fff':e.color, dark=flash?'#fff':shade(e.color,-115), mid=flash?'#fff':shade(e.color,-30);      // rim derives from e.color: warlords are RED skeletons, pinnacle adds blue/pale
    ctx.fillStyle=dark; ctx.fillRect(sx+6,oy+e.h-7+st2,4,7-st2); ctx.fillRect(sx+e.w-10,oy+e.h-6-st2,4,6+st2);
    ctx.fillStyle=bone; ctx.fillRect(sx+7,oy+e.h-7+st2,2,6-st2); ctx.fillRect(sx+e.w-9,oy+e.h-6-st2,2,5+st2);         // legs
    ctx.fillStyle=dark; ctx.fillRect(sx+1,oy+9,3,9); ctx.fillRect(sx+e.w-4,oy+9,3,9);
    ctx.fillStyle=bone; ctx.fillRect(sx+2,oy+9,1,8); ctx.fillRect(sx+e.w-3,oy+9,1,8);                                  // arms
    ctx.fillStyle=dark; ctx.fillRect(sx+4,oy+8,e.w-8,e.h-13); ctx.fillStyle=bone; ctx.fillRect(sx+5,oy+8,e.w-10,e.h-14);
    if(!flash){ ctx.strokeStyle='rgba(20,16,14,0.5)'; ctx.lineWidth=1;
      for(let i=0;i<3;i++){ ctx.beginPath(); ctx.arc(sx+e.w/2,oy+11+i*3-2.4,4.6+i*0.3,0.35,3.14-0.35); ctx.stroke(); } // real curved ribs
      ctx.fillStyle='rgba(20,16,14,0.42)'; ctx.fillRect(sx+e.w/2-0.5,oy+9,1,e.h-15);                                   // spine
      ctx.fillStyle=mid; ctx.fillRect(sx+e.w-6,oy+9,1,e.h-15); }                                                       // form shadow, one side
    ctx.fillStyle=dark; ctx.fillRect(sx+3,oy-1,e.w-6,11); ctx.fillStyle=bone; ctx.fillRect(sx+4,oy,e.w-8,9);           // skull: rim + dome
    if(!flash){ ctx.fillStyle=mid; ctx.fillRect(sx+e.w-6,oy,2,9); ctx.fillStyle='rgba(20,16,14,0.35)'; ctx.fillRect(sx+6,oy+7,e.w-12,1); }   // side shading + jaw line
    ctx.fillStyle='#0d0b0e'; ctx.fillRect(sx+6,oy+2,4,4); ctx.fillRect(sx+e.w-10,oy+2,4,4);                            // deep sockets
    if(!flash){ ctx.fillStyle='rgba(255,190,90,0.55)'; ctx.fillRect(sx+7,oy+3,2,2); ctx.fillRect(sx+e.w-9,oy+3,2,2); } }  // the faintest ember
  else if(e.type==='mage'){ const float=Math.sin(e.wobble)*1.5, cx=sx+e.w/2, orb=Math.sin(Date.now()/180)*0.5+0.5, rgb=rgbOf(e.color);
    ctx.fillStyle=flash?'#fff':shade(e.color,0,0.22); ctx.beginPath(); ctx.moveTo(cx,sy+2+float); ctx.lineTo(sx+e.w-1,sy+e.h+1+float); ctx.lineTo(sx+1,sy+e.h+1+float); ctx.closePath(); ctx.fill();   // robe rim
    ctx.fillStyle=flash?'#fff':shade(e.color,0,0.45); ctx.beginPath(); ctx.moveTo(cx,sy+3.5+float); ctx.lineTo(sx+e.w-2,sy+e.h+float); ctx.lineTo(sx+2,sy+e.h+float); ctx.closePath(); ctx.fill();      // robe — derived, so a Dread-raid mage (#c83030) wears RED, not the old hardcoded navy
    if(!flash){ ctx.strokeStyle=shade(e.color,0,0.16); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(cx-3,sy+14+float); ctx.lineTo(cx-5,sy+e.h+float); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx+3,sy+14+float); ctx.lineTo(cx+5,sy+e.h+float); ctx.stroke();
      ctx.strokeStyle='rgba('+rgb+',0.40)'; ctx.lineWidth=1.1; ctx.beginPath(); ctx.moveTo(cx,sy+4+float); ctx.lineTo(sx+2.5,sy+e.h-1+float); ctx.stroke(); }                                            // folds + lit edge
    ctx.fillStyle=flash?'#fff':shade(e.color,-70); ctx.beginPath(); ctx.arc(cx,sy+8+float,7.6,0,6.28); ctx.fill();
    ctx.fillStyle=flash?'#fff':e.color; ctx.beginPath(); ctx.arc(cx,sy+8+float,6.8,0,6.28); ctx.fill();                                                                                                  // cowl keeps e.color
    if(!flash){ ctx.fillStyle='rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(cx-3,sy+4.6+float,2.4,1.5,-0.5,0,6.28); ctx.fill(); }                                                               // the one highlight
    ctx.fillStyle=flash?'#fff':shade(e.color,0,0.10); ctx.beginPath(); ctx.arc(cx,sy+9+float,5,0,6.28); ctx.fill();                                                                                      // the void under the hood
    ctx.fillStyle=flash?'#fff':shade(e.color,70); ctx.fillRect(cx-3,sy+8+float,2,2); ctx.fillRect(cx+1,sy+8+float,2,2);                                                                                  // eyes
    if(!flash){ ctx.fillStyle='rgba('+rgb+',0.22)'; ctx.beginPath(); ctx.arc(sx+e.w-1,sy+10+float+orb*0.6,6.5,0,6.28); ctx.fill(); }                                                                     // orb glow
    ctx.fillStyle=flash?'#fff':'rgba('+rgb+','+(0.55+orb*0.45).toFixed(2)+')'; ctx.beginPath(); ctx.arc(sx+e.w-1,sy+10+float+orb*0.6,4,0,6.28); ctx.fill();
    if(!flash){ ctx.fillStyle='rgba(255,255,255,'+(0.35+orb*0.4).toFixed(2)+')'; ctx.beginPath(); ctx.arc(sx+e.w-2.2,sy+8.8+float+orb*0.6,1.4,0,6.28); ctx.fill(); } }                                   // orb core
  else if(e.type==='charger'){ const wind=e.chargeState===1, crouch=wind?3:0, run=e.chargeState===2?Math.sin(e.wobble*4):Math.sin(e.wobble*1.6), by=sy+e.h*0.42+crouch, bh=e.h*0.4-crouch;
    const base=flash?'#fff':(wind?shade(e.color,55):e.color), rim=flash?'#fff':shade(e.color,-72);   // the windup tint DERIVES now — a recoloured hound still flushes as it winds up
    ctx.save(); if(e._faceL){ ctx.translate((sx+e.w/2)*2,0); ctx.scale(-1,1); }/* FACE LEFT: a four-legged hound with a snout, an ear and one eye at the front and a tail at the back — the most COMMON creature with a real front, so this is the flip you'll see most. Same unconditional save/restore as the wyrm; the windup ring at the end is centred on the mirror axis, so it renders identically either way and needs no special care. */
    if(e.chargeState===2){ ctx.fillStyle='rgba('+rgbOf(e.color)+',0.35)'; ctx.fillRect(sx-Math.abs(e.dvx)*2,sy+e.h*0.45,e.w,e.h*0.35); }                          // speed smear. Math.abs because inside the mirror the hound ALWAYS runs "right", so its smear always trails to local-left; the old raw -e.dvx pushed the smear in FRONT of a left-running hound (a latent bug that only ever looked like a bad sneeze) and mirroring it would have doubled the error.
    ctx.fillStyle=rim; ctx.fillRect(sx+4,sy+e.h-6+run*1.2,3,6-run*1.2); ctx.fillRect(sx+e.w-9,sy+e.h-6-run*1.2,3,6+run*1.2);                                      // far legs (behind, darker = depth)
    ctx.fillStyle=rim; ctx.fillRect(sx+1,by-1,e.w-2,bh+2); ctx.beginPath(); ctx.arc(sx+e.w-4,sy+e.h*0.55+crouch,6,0,6.28); ctx.fill();                            // silhouette: body + head in one rim pass
    ctx.fillStyle=base; ctx.fillRect(sx+2,by,e.w-4,bh); ctx.beginPath(); ctx.arc(sx+e.w-4,sy+e.h*0.55+crouch,5,0,6.28); ctx.fill();
    if(!flash){ ctx.fillStyle=wind?shade(e.color,10):shade(e.color,-34); ctx.fillRect(sx+2,by+bh*0.55,e.w-4,bh*0.45);                                             // belly shadow
      ctx.fillStyle='rgba(255,255,255,0.22)'; ctx.fillRect(sx+3,by+0.5,e.w-7,1.2); }                                                                              // lit back — the one highlight
    ctx.fillStyle=rim; ctx.beginPath(); ctx.moveTo(sx+e.w-7,sy+e.h*0.55+crouch-5); ctx.lineTo(sx+e.w-9.5,sy+e.h*0.4+crouch-1); ctx.lineTo(sx+e.w-4,sy+e.h*0.5+crouch-4.5); ctx.closePath(); ctx.fill();   // ear
    ctx.fillStyle=base; ctx.fillRect(sx+e.w-3,sy+e.h*0.58+crouch,4,3);                                                                                            // snout
    ctx.strokeStyle=rim; ctx.lineWidth=2; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(sx+2,by+2); ctx.quadraticCurveTo(sx-4,by-1+run,sx-3,by+5+run); ctx.stroke(); ctx.lineCap='butt';   // tail
    ctx.fillStyle=base; ctx.fillRect(sx+5,sy+e.h-5-run*1.2,3,5+run*1.2); ctx.fillRect(sx+e.w-8,sy+e.h-5+run*1.2,3,5-run*1.2);                                     // near legs — four legs and a gait: it reads as a running animal now, not a brick
    ctx.fillStyle=flash?'#fff':'#ff3018'; ctx.fillRect(sx+e.w-4,sy+e.h*0.5+crouch,2,2);
    if(!flash){ ctx.fillStyle='rgba(255,190,150,0.9)'; ctx.fillRect(sx+e.w-4,sy+e.h*0.5+crouch,1,1); }
    if(wind){ const pl=Math.sin(Date.now()/50)*0.4+0.6; ctx.strokeStyle=`rgba(255,60,30,${pl})`; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(sx+e.w/2,sy+e.h/2,e.w*0.7,0,6.28); ctx.stroke(); }
    ctx.restore(); }
  else if(e.type==='archer'){ const step=Math.sin(e.wobble*2), st2=step>0?1:0, bob=Math.abs(step)*0.5, oy=sy-bob;   // same bone language as the skeleton, so a Bone Archer reads as its kin
    const bone=flash?'#fff':e.color, dark=flash?'#fff':shade(e.color,-115), mid=flash?'#fff':shade(e.color,-30);
    ctx.fillStyle=dark; ctx.fillRect(sx+6,oy+e.h-6+st2,3,6-st2); ctx.fillRect(sx+e.w-10,oy+e.h-5-st2,3,5+st2);
    ctx.fillStyle=mid; ctx.fillRect(sx+7,oy+e.h-6+st2,1,5-st2); ctx.fillRect(sx+e.w-9,oy+e.h-5-st2,1,4+st2);                                   // legs
    ctx.fillStyle=flash?'#fff':'#3a2410'; ctx.fillRect(sx,oy+6,5,11);
    ctx.fillStyle=flash?'#fff':'#5a3a1a'; ctx.fillRect(sx+1,oy+7,3,10);                                                                        // quiver
    if(!flash){ ctx.fillStyle='#e8d8a0'; ctx.fillRect(sx+2,oy+3,1,5); ctx.fillRect(sx+4,oy+2,1,6); ctx.fillStyle='#c04030'; ctx.fillRect(sx+1.6,oy+3,2,1.6); ctx.fillRect(sx+3.6,oy+2,2,1.6); }   // arrows + fletching
    ctx.fillStyle=dark; ctx.fillRect(sx+4,oy+6,e.w-9,e.h-11); ctx.fillStyle=bone; ctx.fillRect(sx+5,oy+7,e.w-11,e.h-13);
    if(!flash){ ctx.strokeStyle='rgba(20,16,14,0.5)'; ctx.lineWidth=1; for(let i=0;i<2;i++){ ctx.beginPath(); ctx.arc(sx+e.w/2-1,oy+10+i*3.4-2,3.8,0.4,3.14-0.4); ctx.stroke(); }
      ctx.fillStyle=mid; ctx.fillRect(sx+e.w-7,oy+8,1,e.h-14); }                                                                               // ribs + form shadow
    ctx.fillStyle=dark; ctx.fillRect(sx+3,oy-1,e.w-7,11); ctx.fillStyle=bone; ctx.fillRect(sx+4,oy,e.w-9,9);
    if(!flash){ ctx.fillStyle=mid; ctx.fillRect(sx+e.w-7,oy,2,9); ctx.fillStyle='rgba(20,16,14,0.35)'; ctx.fillRect(sx+6,oy+7,e.w-14,1); }     // side shading + jaw line
    ctx.fillStyle='#0d0b0e'; ctx.fillRect(sx+6,oy+2,3,3); ctx.fillRect(sx+e.w-10,oy+2,3,3);
    if(!flash){ ctx.fillStyle='rgba(255,190,90,0.55)'; ctx.fillRect(sx+6.6,oy+2.6,1.6,1.6); ctx.fillRect(sx+e.w-9.4,oy+2.6,1.6,1.6); }         // sockets + ember
    ctx.strokeStyle=flash?'#fff':'#3d2c14'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(sx+e.w-1,oy+e.h/2,7,-1.3,1.3); ctx.stroke();
    ctx.strokeStyle=flash?'#fff':'#7a5a2a'; ctx.lineWidth=1.6; ctx.beginPath(); ctx.arc(sx+e.w-1,oy+e.h/2,7,-1.3,1.3); ctx.stroke();           // bow: rim then wood
    if(!flash){ ctx.strokeStyle='rgba(220,190,120,0.5)'; ctx.lineWidth=0.7; ctx.beginPath(); ctx.arc(sx+e.w-1.6,oy+e.h/2,7,-1.2,1.2); ctx.stroke(); }   // lit edge on the limb
    ctx.strokeStyle=flash?'#fff':'#d8d0c0'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(sx+e.w-1,oy+e.h/2-6.7); ctx.lineTo(sx+e.w-1,oy+e.h/2+6.7); ctx.stroke(); }
  else if(e.type==='healer'){ const hf=Math.sin(e.wobble)*1.5, cx=sx+e.w/2, aura=Math.sin(Date.now()/220)*0.3+0.5, rgb=rgbOf(e.color);
    if(!flash){ const g=ctx.createRadialGradient(cx,sy+e.h/2+hf,e.w*0.22,cx,sy+e.h/2+hf,e.w*0.8);                                              // aura: a soft bloom instead of a flat disc
      g.addColorStop(0,'rgba('+rgb+','+(0.26*aura).toFixed(3)+')'); g.addColorStop(1,'rgba('+rgb+',0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,sy+e.h/2+hf,e.w*0.8,0,6.28); ctx.fill(); }
    ctx.fillStyle=flash?'#fff':shade(e.color,0,0.24); ctx.beginPath(); ctx.moveTo(cx,sy+2+hf); ctx.lineTo(sx+e.w-1,sy+e.h+1+hf); ctx.lineTo(sx+1,sy+e.h+1+hf); ctx.closePath(); ctx.fill();
    ctx.fillStyle=flash?'#fff':shade(e.color,0,0.46); ctx.beginPath(); ctx.moveTo(cx,sy+3.5+hf); ctx.lineTo(sx+e.w-2,sy+e.h+hf); ctx.lineTo(sx+2,sy+e.h+hf); ctx.closePath(); ctx.fill();   // robe rim + body
    if(!flash){ ctx.strokeStyle=shade(e.color,0,0.17); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(cx-3,sy+13+hf); ctx.lineTo(cx-5,sy+e.h+hf); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx+3,sy+13+hf); ctx.lineTo(cx+5,sy+e.h+hf); ctx.stroke();
      ctx.strokeStyle='rgba('+rgb+',0.40)'; ctx.lineWidth=1.1; ctx.beginPath(); ctx.moveTo(cx,sy+4+hf); ctx.lineTo(sx+2.5,sy+e.h-1+hf); ctx.stroke(); }                                    // folds + lit edge
    ctx.fillStyle=flash?'#fff':shade(e.color,-70); ctx.beginPath(); ctx.arc(cx,sy+8+hf,6.7,0,6.28); ctx.fill();
    ctx.fillStyle=flash?'#fff':e.color; ctx.beginPath(); ctx.arc(cx,sy+8+hf,5.9,0,6.28); ctx.fill();                                                                                       // cowl
    if(!flash){ ctx.save(); ctx.beginPath(); ctx.arc(cx,sy+8+hf,5.9,0,6.28); ctx.clip(); ctx.fillStyle=shade(e.color,-46); ctx.beginPath(); ctx.ellipse(cx+3,sy+12+hf,5,4,0,0,6.28); ctx.fill(); ctx.restore();
      ctx.fillStyle='rgba(255,255,255,0.30)'; ctx.beginPath(); ctx.ellipse(cx-2.6,sy+5.4+hf,2.1,1.4,-0.5,0,6.28); ctx.fill(); }                                                            // form shadow + the one highlight
    ctx.fillStyle=flash?'#fff':shade(e.color,0,0.12); ctx.fillRect(cx-2.6,sy+7+hf,5.2,3);                                                                                                  // shadowed face
    if(!flash){ ctx.fillStyle='rgba(255,255,255,'+(0.30+aura*0.45).toFixed(2)+')'; ctx.fillRect(cx-2,sy+e.h/2-1+hf,4,11); ctx.fillRect(cx-4.5,sy+e.h/2+1+hf,9,4); }                        // cross glow
    ctx.fillStyle=flash?'#fff':'#eafff2'; ctx.fillRect(cx-1,sy+e.h/2+hf,2,8); ctx.fillRect(cx-3,sy+e.h/2+2+hf,6,2); }
  else if(e.type==='serpent'){ const und=e.wobble*2, hy=sy+e.h/2+Math.sin(und)*3, hr=e.w*0.22;
    ctx.save(); if(e._faceL){ ctx.translate((sx+e.w/2)*2,0); ctx.scale(-1,1); }/* FACE LEFT: NOT symmetrical — the head (jaw, slit-pupil eye, dorsal fin) leads at sx+e.w-8 and four shrinking coils trail left, so a serpent swimming left swims tail-first. Same unconditional save/restore as the wyrm; this branch is pure art (no text), so the restore sits at its very end. */
    const seg=(i)=>({ x:sx+e.w/2-4-i*4.5, y:sy+e.h/2+Math.sin(und+i*1.1)*4, r:Math.max(3,e.w*0.17-i*0.9) });
    ctx.fillStyle=flash?'#fff':shade(e.color,-62); for(let i=3;i>=1;i--){ const s3=seg(i); ctx.beginPath(); ctx.arc(s3.x,s3.y,s3.r+1,0,6.28); ctx.fill(); }
    ctx.beginPath(); ctx.arc(sx+e.w-8,hy,hr+1,0,6.28); ctx.fill();                                                                             // one rim pass over the whole body — the undulating coil reads as ONE animal, not five discs
    ctx.fillStyle=flash?'#fff':e.color; for(let i=3;i>=1;i--){ const s3=seg(i); ctx.beginPath(); ctx.arc(s3.x,s3.y,s3.r,0,6.28); ctx.fill(); }
    ctx.beginPath(); ctx.arc(sx+e.w-8,hy,hr,0,6.28); ctx.fill();
    if(!flash){ ctx.fillStyle=shade(e.color,-30); for(let i=3;i>=1;i--){ const s3=seg(i); ctx.beginPath(); ctx.ellipse(s3.x,s3.y+s3.r*0.5,s3.r*0.85,s3.r*0.5,0,0,6.28); ctx.fill(); }        // underside on every segment
      ctx.fillStyle='rgba(255,255,255,0.30)'; for(let i=3;i>=1;i--){ const s3=seg(i); ctx.beginPath(); ctx.ellipse(s3.x-s3.r*0.2,s3.y-s3.r*0.5,s3.r*0.45,s3.r*0.22,-0.3,0,6.28); ctx.fill(); }   // wet backlit sheen
      ctx.save(); ctx.beginPath(); ctx.arc(sx+e.w-8,hy,hr,0,6.28); ctx.clip(); ctx.fillStyle=shade(e.color,-30); ctx.beginPath(); ctx.ellipse(sx+e.w-8,hy+hr*0.65,hr,hr*0.6,0,0,6.28); ctx.fill(); ctx.restore(); }
    ctx.fillStyle=flash?'#fff':shade(e.color,-45); ctx.beginPath(); ctx.moveTo(sx+e.w-8,hy-e.w*0.2); ctx.lineTo(sx+e.w-3,hy-e.w*0.38); ctx.lineTo(sx+e.w-1,hy-e.w*0.12); ctx.closePath(); ctx.fill();   // dorsal fin
    if(!flash){ ctx.fillStyle='rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(sx+e.w-9,hy-hr*0.45,hr*0.42,hr*0.24,-0.4,0,6.28); ctx.fill(); }                                        // the one head highlight
    ctx.fillStyle=flash?'#fff':'#0a2a2a'; ctx.fillRect(sx+e.w-1,hy,4,1.4);                                                                                                                  // jaw
    ctx.fillStyle=flash?'#fff':'#ffe060'; ctx.fillRect(sx+e.w-6,hy-2,2,2);
    if(!flash){ ctx.fillStyle='#2a1a00'; ctx.fillRect(sx+e.w-5.4,hy-2,0.9,2); ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fillRect(sx+e.w-6,hy-2,1,1); }                                    // slit pupil + glint
    ctx.restore(); }
  else if(e.type==='dragon'){ const fl=Math.sin(e.wobble*2)*4, cx=sx+e.w/2, rgb=rgbOf(e.color), fire=Math.sin(Date.now()/90)*0.5+0.5;
    ctx.save(); if(e._faceL){ ctx.translate(cx*2,0); ctx.scale(-1,1); }/* FACE LEFT: mirror about the wyrm's OWN centre (x -> 2cx-x), so the skull leads and the tail trails whichever way it flies. save/restore are UNCONDITIONAL and the flip only rides inside — one save, one restore on every path, so the pair can never come unbalanced (the headless Proxy canvas no-ops save/restore and would not catch it). Scoped to the ART only: restored before the [E] TAME label, and drawEnemy's shared hp bar / affix rings / mark pips / boss name all sit outside this branch entirely, so no text is ever mirrored. */
    const wing=flash?'#fff':shade(e.color,0,0.40), wrim=flash?'#fff':shade(e.color,0,0.20);
    ctx.fillStyle=wrim; ctx.beginPath(); ctx.moveTo(sx-9,sy+10); ctx.lineTo(cx,sy-3-fl); ctx.lineTo(sx+4,sy+e.h-7); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx+e.w+9,sy+10); ctx.lineTo(cx,sy-3-fl); ctx.lineTo(sx+e.w-4,sy+e.h-7); ctx.closePath(); ctx.fill();                       // wing rims
    ctx.fillStyle=wing; ctx.beginPath(); ctx.moveTo(sx-7,sy+10.5); ctx.lineTo(cx,sy-1.5-fl); ctx.lineTo(sx+4.5,sy+e.h-8.5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx+e.w+7,sy+10.5); ctx.lineTo(cx,sy-1.5-fl); ctx.lineTo(sx+e.w-4.5,sy+e.h-8.5); ctx.closePath(); ctx.fill();               // membranes
    if(!flash){ ctx.strokeStyle=wrim; ctx.lineWidth=1.2;                                                                                                   // wing ribs — they make the flap read
      for(let i=0;i<2;i++){ const t2=0.34+i*0.3; ctx.beginPath(); ctx.moveTo(cx,sy-1.5-fl); ctx.lineTo(sx-7+(11.5)*(1-t2)+t2*4.5,sy+10.5+(e.h-19)*t2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx,sy-1.5-fl); ctx.lineTo(sx+e.w+7-(11.5)*(1-t2)-t2*4.5,sy+10.5+(e.h-19)*t2); ctx.stroke(); } }
    ctx.strokeStyle=flash?'#fff':shade(e.color,-70); ctx.lineWidth=5; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(sx+10,sy+e.h-8); ctx.quadraticCurveTo(sx-6,sy+e.h-2,sx-11,sy+e.h-10-fl*0.5); ctx.stroke();
    ctx.strokeStyle=flash?'#fff':e.color; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(sx+10,sy+e.h-8); ctx.quadraticCurveTo(sx-6,sy+e.h-2,sx-11,sy+e.h-10-fl*0.5); ctx.stroke(); ctx.lineCap='butt';   // tail
    ctx.fillStyle=flash?'#fff':shade(e.color,-70); ctx.fillRect(sx+7,sy+11,e.w-14,e.h-14); ctx.beginPath(); ctx.arc(sx+e.w-8,sy+15,9,0,6.28); ctx.fill();
    ctx.fillStyle=flash?'#fff':e.color; ctx.fillRect(sx+8,sy+12,e.w-16,e.h-16); ctx.beginPath(); ctx.arc(sx+e.w-8,sy+15,8,0,6.28); ctx.fill();             // body + head
    if(!flash){ ctx.fillStyle=shade(e.color,-42); ctx.fillRect(sx+8,sy+e.h-9,e.w-16,5);                                                                    // belly shadow
      ctx.fillStyle=shade(e.color,42); for(let i=0;i<3;i++) ctx.fillRect(sx+11+i*6,sy+14,4,2);                                                             // lit back scales
      ctx.save(); ctx.beginPath(); ctx.arc(sx+e.w-8,sy+15,8,0,6.28); ctx.clip(); ctx.fillStyle=shade(e.color,-42); ctx.beginPath(); ctx.ellipse(sx+e.w-6,sy+21,8,5,0,0,6.28); ctx.fill(); ctx.restore();
      ctx.fillStyle='rgba(255,255,255,0.30)'; ctx.beginPath(); ctx.ellipse(sx+e.w-11,sy+11,3,2,-0.5,0,6.28); ctx.fill(); }                                 // the one highlight
    ctx.fillStyle=flash?'#fff':shade(e.color,-70); ctx.beginPath(); ctx.moveTo(sx+e.w-12,sy+9); ctx.lineTo(sx+e.w-15,sy+2); ctx.lineTo(sx+e.w-8,sy+7); ctx.closePath(); ctx.fill();   // horn
    ctx.fillStyle=flash?'#fff':shade(e.color,-30); ctx.fillRect(sx+e.w-4,sy+16,7,4);                                                                       // snout
    ctx.fillStyle=flash?'#fff':'#ffe030'; ctx.fillRect(sx+e.w-6,sy+12,3,3);
    if(!flash){ ctx.fillStyle='#3a2000'; ctx.fillRect(sx+e.w-5,sy+12,1,3); ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fillRect(sx+e.w-6,sy+12,1,1);        // slit pupil + glint
      ctx.fillStyle='rgba(255,120,40,'+(0.25+fire*0.3).toFixed(2)+')'; ctx.beginPath(); ctx.arc(sx+e.w+3,sy+16.5,5.5,0,6.28); ctx.fill(); }               // furnace glow at the maw
    ctx.fillStyle=flash?'#fff':'#ff6020'; ctx.fillRect(sx+e.w-1,sy+15,7,3);
    if(!flash){ ctx.fillStyle='rgba(255,230,120,'+(0.55+fire*0.45).toFixed(2)+')'; ctx.fillRect(sx+e.w-1,sy+15.8,5,1.4); }
    ctx.restore();                                                                                                                                             // …and the wyrm is back in world space from here down
    if(e.subdued){ ctx.fillStyle='#90ff90'; ctx.font='bold 10px monospace'; ctx.textAlign='center'; ctx.fillText('[E] TAME',cx,sy+e.h+13); ctx.textAlign='left'; ctx.font='10px monospace'; } }
  else if(e.type==='kraken'){ const fl=Math.sin(e.wobble)*3, cx=sx+e.w/2, cy=sy+e.h/2, hr=e.w*0.36, arm=[];
    for(let k=0;k<6;k++){ const a=(k/6)*6.28+e.wobble*0.25, wig=Math.sin(e.wobble*2+k)*8;
      arm.push([cx+Math.cos(a)*e.w*0.4+wig, cy+Math.sin(a)*e.h*0.4, cx+Math.cos(a)*e.w*0.72, cy+Math.sin(a)*e.h*0.72]); }   // arm curves computed once, then stroked in passes — one fillStyle change per pass instead of per arm
    ctx.lineCap='round';
    ctx.strokeStyle=flash?'#fff':shade(e.color,0,0.34); ctx.lineWidth=9; for(const t2 of arm){ ctx.beginPath(); ctx.moveTo(cx,cy); ctx.quadraticCurveTo(t2[0],t2[1],t2[2],t2[3]); ctx.stroke(); }
    ctx.strokeStyle=flash?'#fff':shade(e.color,-40); ctx.lineWidth=6.5; for(const t2 of arm){ ctx.beginPath(); ctx.moveTo(cx,cy); ctx.quadraticCurveTo(t2[0],t2[1],t2[2],t2[3]); ctx.stroke(); }   // rim then limb — tentacles read as flesh, not wires
    if(!flash){ ctx.strokeStyle='rgba(255,255,255,0.16)'; ctx.lineWidth=2; for(const t2 of arm){ ctx.beginPath(); ctx.moveTo(cx,cy); ctx.quadraticCurveTo(t2[0],t2[1]-1.5,t2[2],t2[3]-1.5); ctx.stroke(); } }   // wet sheen
    ctx.lineCap='butt';
    ctx.fillStyle=flash?'#fff':shade(e.color,-62); ctx.beginPath(); ctx.arc(cx,cy+fl,hr+1.5,0,6.28); ctx.fill();
    ctx.fillStyle=flash?'#fff':e.color; ctx.beginPath(); ctx.arc(cx,cy+fl,hr,0,6.28); ctx.fill();                                                                                    // mantle
    if(!flash){ ctx.save(); ctx.beginPath(); ctx.arc(cx,cy+fl,hr,0,6.28); ctx.clip();
      ctx.fillStyle=shade(e.color,-34); ctx.beginPath(); ctx.ellipse(cx,cy+fl+hr*0.8,hr,hr*0.75,0,0,6.28); ctx.fill(); ctx.restore();
      ctx.fillStyle='rgba(255,255,255,0.26)'; ctx.beginPath(); ctx.ellipse(cx-hr*0.35,cy+fl-hr*0.5,hr*0.3,hr*0.17,-0.5,0,6.28); ctx.fill(); }                                        // form + the one highlight
    ctx.fillStyle=flash?'#fff':shade(e.color,0,0.28); ctx.beginPath(); ctx.ellipse(cx,cy+fl,e.w*0.27,e.w*0.2,0,0,6.28); ctx.fill();                                                  // brow band — the old flat inner disc, now shaped
    if(!flash){ ctx.fillStyle='rgba(255,64,64,0.18)'; ctx.beginPath(); ctx.arc(cx-6,cy+fl,7,0,6.28); ctx.fill(); ctx.beginPath(); ctx.arc(cx+6,cy+fl,7,0,6.28); ctx.fill(); }         // eye-glow
    ctx.fillStyle=flash?'#fff':'#ff4040'; ctx.fillRect(cx-9,cy-3+fl,6,6); ctx.fillRect(cx+3,cy-3+fl,6,6);
    if(!flash){ ctx.fillStyle='rgba(255,190,190,0.9)'; ctx.fillRect(cx-9,cy-3+fl,2,2); ctx.fillRect(cx+3,cy-3+fl,2,2); } }
  else if(e.type==='boss'){ const float=Math.sin(e.wobble*0.5)*3, pulse=Math.sin(Date.now()/260)*0.5+0.5, cx=sx+e.w/2, ay=sy+e.h/2+float, rgb=rgbOf(e.color), rot=Date.now()/1800;
    ctx.fillStyle='rgba(0,0,0,'+(0.34-float*0.03).toFixed(2)+')'; ctx.beginPath(); ctx.ellipse(cx,sy+e.h+1,e.w/2-2-float*0.5,3.2,0,0,6.28); ctx.fill();   // shadow shrinks as he rises
    if(!flash){ const g=ctx.createRadialGradient(cx,ay,e.w*0.30,cx,ay,e.w*0.86);                                        // aura: a soft bloom + counter-rotating arcs (was one hard flat ring)
      g.addColorStop(0,'rgba('+rgb+','+(0.20+pulse*0.13).toFixed(3)+')'); g.addColorStop(1,'rgba('+rgb+',0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,ay,e.w*0.86,0,6.28); ctx.fill();
      ctx.lineWidth=1.4; ctx.strokeStyle='rgba('+rgb+','+(0.30+pulse*0.34).toFixed(2)+')';
      ctx.beginPath(); ctx.arc(cx,ay,e.w*0.74,rot,rot+2.1); ctx.stroke(); ctx.beginPath(); ctx.arc(cx,ay,e.w*0.74,rot+3.14,rot+5.24); ctx.stroke();
      ctx.strokeStyle='rgba('+rgb+','+(0.22+pulse*0.2).toFixed(2)+')'; ctx.beginPath(); ctx.arc(cx,ay,e.w*0.62,-rot*1.5,-rot*1.5+1.5); ctx.stroke(); }
    ctx.fillStyle=flash?'#fff':shade(e.color,0,0.18); ctx.beginPath(); ctx.moveTo(cx,sy-1+float); ctx.lineTo(sx+e.w+1,sy+e.h+1+float); ctx.lineTo(sx-1,sy+e.h+1+float); ctx.closePath(); ctx.fill();   // robe rim
    ctx.fillStyle=flash?'#fff':shade(e.color,0,0.40); ctx.beginPath(); ctx.moveTo(cx,sy+1+float); ctx.lineTo(sx+e.w-1,sy+e.h+float); ctx.lineTo(sx+1,sy+e.h+float); ctx.closePath(); ctx.fill();       // robe body — MULTIPLIED down from e.color, never hardcoded: ×0.40 lands on the approved deep violet for Morthrax and still leaves The Pale Shepherd pale
    if(!flash){ ctx.strokeStyle='rgba(0,0,0,0.30)'; ctx.lineWidth=1;                                                     // folds DARKEN whatever robe is under them (works on a pale Shepherd too) instead of a near-black line that read as a hard spear
      ctx.beginPath(); ctx.moveTo(cx-5,sy+26+float); ctx.lineTo(cx-8,sy+e.h-1+float); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx+5,sy+26+float); ctx.lineTo(cx+8,sy+e.h-1+float); ctx.stroke();   // cloth folds — start BELOW the head, not behind it
      ctx.strokeStyle='rgba('+rgb+',0.42)'; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(cx,sy+2+float); ctx.lineTo(sx+2,sy+e.h-1+float); ctx.stroke(); }                                     // lit edge
    ctx.fillStyle=flash?'#fff':shade(e.color,0,0.26);                                                                    // HORNS keep the shipped triangle geometry on purpose: the prototype's curved stroke was drawn with no head over it — behind this head it reads as a thin antenna. Tapered wedges read as horns at 44px; only the tone is derived.
    ctx.beginPath(); ctx.moveTo(cx-16,sy+12+float); ctx.lineTo(cx-24,sy+2+float); ctx.lineTo(cx-10,sy+8+float); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx+16,sy+12+float); ctx.lineTo(cx+24,sy+2+float); ctx.lineTo(cx+10,sy+8+float); ctx.closePath(); ctx.fill();
    if(!flash){ ctx.strokeStyle='rgba('+rgb+',0.30)'; ctx.lineWidth=1;                                                   // one lit edge along each horn's leading rib
      ctx.beginPath(); ctx.moveTo(cx-16,sy+12+float); ctx.lineTo(cx-24,sy+2+float); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx+16,sy+12+float); ctx.lineTo(cx+24,sy+2+float); ctx.stroke(); }
    ctx.fillStyle=flash?'#fff':shade(e.color,-70); ctx.beginPath(); ctx.arc(cx,sy+14+float,12.5,0,6.28); ctx.fill();     // head rim
    ctx.fillStyle=flash?'#fff':e.color; ctx.beginPath(); ctx.arc(cx,sy+14+float,11.5,0,6.28); ctx.fill();                // head KEEPS e.color — it is the only thing that makes The Pale Shepherd pale and a Great Beast its own hue
    if(!flash){ ctx.save(); ctx.beginPath(); ctx.arc(cx,sy+14+float,11.5,0,6.28); ctx.clip();
      ctx.fillStyle=shade(e.color,-52); ctx.beginPath(); ctx.ellipse(cx+5,sy+20+float,10,8,0,0,6.28); ctx.fill(); ctx.restore();                                    // form shadow, lower-right
      ctx.fillStyle='rgba(255,255,255,0.30)'; ctx.beginPath(); ctx.ellipse(cx-4.5,sy+8.5+float,3.6,2.4,-0.5,0,6.28); ctx.fill();                                    // the one highlight
      ctx.fillStyle='rgba(10,5,14,0.55)'; ctx.fillRect(cx-8,sy+11+float,6,6); ctx.fillRect(cx+2,sy+11+float,6,6); }                                                 // SOCKETS, one per eye — a single wide brow ellipse spanning both read as a mouth/visor
    ctx.fillStyle=flash?'#fff':'rgba(255,40,40,'+(0.78+pulse*0.22).toFixed(2)+')'; ctx.fillRect(cx-7,sy+12+float,4,4); ctx.fillRect(cx+3,sy+12+float,4,4);          // ember eyes
    if(!flash){ ctx.fillStyle='rgba(255,160,160,0.9)'; ctx.fillRect(cx-6,sy+12+float,1,1); ctx.fillRect(cx+4,sy+12+float,1,1); }
    ctx.fillStyle=flash?'#fff':'#c9a52e'; ctx.fillRect(cx-10,sy+4+float,20,4); ctx.fillRect(cx-8,sy+float,2,5); ctx.fillRect(cx-1,sy-1+float,2,6); ctx.fillRect(cx+6,sy+float,2,5);   // crown: rim…
    if(!flash){ ctx.fillStyle='#f0d050'; ctx.fillRect(cx-10,sy+4+float,20,2); ctx.fillRect(cx-8,sy+float,2,3); ctx.fillRect(cx-1,sy-1+float,2,3); ctx.fillRect(cx+6,sy+float,2,3);    // …then gold, lit from above. The crown stays GOLD (it is metal, not creature colour) and is the bright focal point that keeps a dark boss off the dungeon floor
      ctx.fillStyle='rgba(255,245,190,0.85)'; ctx.fillRect(cx-10,sy+4+float,20,1); } }
  if(e.isBoss&&e.tele){ const fr=1-e.tele.t/e.tele.max, cx=sx+e.w/2, cy=sy+e.h/2, nm=e.tele.name;
    if(nm==='slam'){ ctx.strokeStyle=`rgba(255,150,50,${0.4+0.5*fr})`; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(cx,cy,e.tele.radius*fr,0,6.28); ctx.stroke(); ctx.fillStyle=`rgba(255,120,30,${0.12*fr})`; ctx.beginPath(); ctx.arc(cx,cy,e.tele.radius*fr,0,6.28); ctx.fill(); }
    else if(nm==='charge'){ const a=Math.atan2(e.tele.aimY-(e.y+e.h/2),e.tele.aimX-(e.x+e.w/2)); ctx.strokeStyle=`rgba(255,80,80,${0.5+0.4*fr})`; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(a)*200*fr,cy+Math.sin(a)*200*fr); ctx.stroke(); }
    else if(nm==='nova'){ ctx.strokeStyle=`rgba(255,110,180,${0.4+0.5*fr})`; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(cx,cy,e.w*0.7+fr*34,0,6.28); ctx.stroke(); }
    else if(nm==='summon'){ ctx.fillStyle=`rgba(192,128,255,${0.3*fr})`; ctx.beginPath(); ctx.arc(cx,cy,e.w*0.85,0,6.28); ctx.fill(); }
    else if(nm==='pullunder'){ const rr=e.tele.radius*(1-fr*0.7); ctx.strokeStyle=`rgba(60,150,205,${0.45+0.5*fr})`; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(cx,cy,rr,0,6.28); ctx.stroke(); ctx.fillStyle=`rgba(47,127,176,${0.14*fr})`; ctx.beginPath(); ctx.arc(cx,cy,rr,0,6.28); ctx.fill(); for(let s=0;s<6;s++){ const a=s/6*6.28+fr*3.4; ctx.strokeStyle=`rgba(120,210,235,${0.5*fr})`; ctx.beginPath(); ctx.arc(cx,cy,rr,a,a+0.5); ctx.stroke(); } }/* undertow: a closing whirlpool ring */
    else if(nm==='raiseadds'){ ctx.fillStyle=`rgba(150,190,225,${0.28*fr})`; ctx.beginPath(); ctx.arc(cx,cy,e.w*0.95,0,6.28); ctx.fill(); ctx.strokeStyle=`rgba(190,215,240,${0.4+0.5*fr})`; ctx.lineWidth=2; for(let s=0;s<3;s++){ const a=s/3*6.28+e.wobble; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(a)*e.w*0.9*fr,cy+Math.sin(a)*e.w*0.9*fr); ctx.stroke(); } } }
  if(e.isPinnacle&&e.arenaR){ const lcx=(e._lairTx!=null?e._lairTx*TILE+16:e.x+e.w/2)-state.camera.x, lcy=(e._lairTy!=null?e._lairTy*TILE+16:e.y+e.h/2)-state.camera.y; const isKing=e.pinKey==='drownedking'; const pulse=0.5+Math.sin(Date.now()/300)*0.5; ctx.strokeStyle=isKing?`rgba(47,127,176,${0.3+pulse*0.28})`:`rgba(206,216,238,${0.3+pulse*0.28})`; ctx.lineWidth=2; if(ctx.setLineDash) ctx.setLineDash([8,7]); ctx.beginPath(); ctx.arc(lcx,lcy,e.arenaR,0,6.28); ctx.stroke(); if(ctx.setLineDash) ctx.setLineDash([]); }/* the shrinking safe arena — dry ground (King) / lantern light (Shepherd); beyond it lies drowning / the killing dark */
  if(e.frost&&e.chillT<=0){ ctx.fillStyle='rgba(150,200,255,0.13)'; ctx.fillRect(sx,sy,e.w,e.h); }
  if(e.lava){ ctx.fillStyle='rgba(255,90,30,0.16)'; ctx.fillRect(sx,sy,e.w,e.h); }
  if(e.windup>0){ const wf=Math.sin(Date.now()/40)*0.4+0.6; ctx.strokeStyle=`rgba(255,70,40,${wf})`; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(sx+e.w/2,sy+e.h/2,e.w*0.72,0,6.28); ctx.stroke(); ctx.fillStyle=`rgba(255,80,40,${0.16*wf})`; ctx.fillRect(sx,sy,e.w,e.h); ctx.fillStyle=`rgba(255,210,90,${wf})`; ctx.font='bold 13px monospace'; ctx.textAlign='center'; ctx.fillText('!',sx+e.w/2,sy-11); ctx.textAlign='left'; }
  if(e.chillT>0){ ctx.fillStyle='rgba(150,210,255,0.30)'; ctx.fillRect(sx,sy,e.w,e.h); } if(e.burnT>0&&Math.floor(Date.now()/80)%2===0){ ctx.fillStyle='rgba(255,130,40,0.22)'; ctx.fillRect(sx,sy,e.w,e.h); }
  if(e.hp<e.maxHp){ const bw=e.isBoss?60:e.w,bx=sx+e.w/2-bw/2; ctx.fillStyle='#000'; ctx.fillRect(bx-1,sy-7,bw+2,5); ctx.fillStyle='#e03030'; ctx.fillRect(bx,sy-6,bw*(e.hp/e.maxHp),3); }
  if(e.elite&&!e.isBoss&&!e.isNemesis){ const ep=Math.sin(Date.now()/300)*0.25+0.6; ctx.strokeStyle=`rgba(255,210,90,${ep})`; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(sx+e.w/2,sy+e.h/2,e.w*0.66,0,6.28); ctx.stroke(); ctx.fillStyle='#ffd24a'; ctx.font='9px monospace'; ctx.textAlign='center'; ctx.fillText(e.afxTag||'★ ELITE',sx+e.w/2,sy-8); ctx.textAlign='left'; }/* afxTag is precomputed at roll time — no per-frame string building */
  if(e._afxN){ const acx=sx+e.w/2, acy=sy+e.h/2;   // elite-affix indicators: one cheap ring/mote per affix
    if(e.afxShield&&e.shieldMax>0&&e.shieldHp>0){ ctx.strokeStyle='rgba(126,210,255,0.85)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(acx,acy,e.w*0.8,-1.57,-1.57+6.283*(e.shieldHp/e.shieldMax)); ctx.stroke(); }
    if(e.afxVamp){ const vp=Math.sin(Date.now()/260)*0.18+0.4; ctx.strokeStyle=`rgba(225,50,90,${vp})`; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(acx,acy,e.w*0.55,0,6.28); ctx.stroke(); }
    if(e.afxSplit){ const sa=Date.now()/380; ctx.fillStyle='#9be24a'; for(let k2=0;k2<2;k2++){ const a2=sa+k2*3.14; ctx.beginPath(); ctx.arc(acx+Math.cos(a2)*e.w*0.72,acy+Math.sin(a2)*e.w*0.72,2.4,0,6.28); ctx.fill(); } }
    if(e.afxWard&&e.wardT>0){ const wp=0.55+Math.sin(Date.now()/90)*0.35; ctx.strokeStyle=`rgba(158,203,255,${wp})`; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(acx,acy,e.w*0.95,0,6.28); ctx.stroke(); ctx.fillStyle='rgba(158,203,255,0.10)'; ctx.beginPath(); ctx.arc(acx,acy,e.w*0.95,0,6.28); ctx.fill(); } }
  if(e._markN>0&&(e._markBy===state.player||(e._markById!=null&&state.player&&e._markById===state.player.id))){ const _mn=Math.min(3,e._markN),_mg=7,_my=sy-((e.isBoss||e.isNemesis||e.elite)?24:15),_mx0=sx+e.w/2-(_mn-1)*_mg/2; for(let _i=0;_i<_mn;_i++){ const _px=_mx0+_i*_mg; ctx.fillStyle='#2a0a0a'; ctx.beginPath(); ctx.moveTo(_px,_my-4); ctx.lineTo(_px+3.4,_my); ctx.lineTo(_px,_my+4); ctx.lineTo(_px-3.4,_my); ctx.closePath(); ctx.fill(); ctx.fillStyle='#ff4d4d'; ctx.beginPath(); ctx.moveTo(_px,_my-2.7); ctx.lineTo(_px+2.3,_my); ctx.lineTo(_px,_my+2.7); ctx.lineTo(_px-2.3,_my); ctx.closePath(); ctx.fill(); } }/* QUARRY MARKS made VISIBLE: up to 3 red pips over a foe YOU'VE marked (red = targeted/marked, distinct from poison green) — O(1) draw-path read (no scan). SP: _markBy is your player obj; MP: server packs _markById (the obj ref is dropped by packScalar) → each viewer sees only their OWN marks */
  if(e.isBoss||e.isNemesis){ ctx.fillStyle=e.isNemesis?'#ff6060':e.color; ctx.font='10px monospace'; ctx.textAlign='center'; ctx.fillText((e.isNemesis?'☠ ':'')+e.name.toUpperCase(),sx+e.w/2,sy-10); ctx.textAlign='left'; }
}
