function drawNPC(n) {
  const sx = n.x - state.camera.x,
    sy = n.y - state.camera.y;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(sx + n.w / 2, sy + n.h + 1, n.w / 2, 3, 0, 0, 6.28);
  ctx.fill();
  ctx.fillStyle = n.color;
  ctx.fillRect(sx + 4, sy + 10, n.w - 8, n.h - 8);
  ctx.fillStyle = '#e8c090';
  ctx.fillRect(sx + 5, sy, n.w - 10, 11);
  ctx.fillStyle = '#000';
  ctx.fillRect(sx + 8, sy + 4, 2, 2);
  ctx.fillRect(sx + 13, sy + 4, 2, 2);
  if (rectDist(state.player, n) < 40) {
    const bob = Math.sin(Date.now() / 200) * 2;
    ctx.fillStyle = '#f0d050';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(n.id === 'shop' ? '$' : n.id === 'smith' ? '🔨' : '!', sx + n.w / 2, sy - 6 + bob);
    ctx.textAlign = 'left';
  }
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  const nw = n.name.length * 5.4 + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(sx + n.w / 2 - nw / 2, sy - 20, nw, 11);
  ctx.fillStyle = '#fff';
  ctx.fillText(n.name, sx + n.w / 2, sy - 12);
  ctx.textAlign = 'left';
}
function drawShrine(s) {
  const sx = s.x - state.camera.x;
  let sy = s.y - state.camera.y;
  const b = BLESS[s.type] || { color: '#fff', name: '' };
  const ready = s.cd <= 0 && !s.sinking;
  const gy = sy + s.h;
  if (s.sinking) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - (s.sinkT || 0) / 55);
    sy += (s.sinkT || 0) * 0.5;
    if ((s.sinkT || 0) < 10 && Math.random() < 0.5)
      spawnBurst(s.x + s.w / 2, s.y + s.h - 2, 1, {
        color: '#8a7a5a',
        speed: 0.8,
        up: 0.6,
        decay: 0.05,
        size: 2,
      });
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(sx + s.w / 2, gy, s.w / 2, 4, 0, 0, 6.28);
  ctx.fill();
  ctx.fillStyle = '#6a6478';
  ctx.fillRect(sx + 4, sy + 12, s.w - 8, s.h - 12);
  ctx.fillStyle = '#534e60';
  ctx.fillRect(sx + 2, sy + s.h - 4, s.w - 4, 5);
  const pulse = ready ? 0.55 + Math.sin(Date.now() / 250) * 0.35 : 0.16;
  ctx.globalAlpha = Math.max(0, pulse);
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.arc(sx + s.w / 2, sy + 8, 8, 0, 6.28);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = ready ? b.color : '#555';
  ctx.beginPath();
  ctx.arc(sx + s.w / 2, sy + 8, 4.5, 0, 6.28);
  ctx.fill();
  if (!s.sinking && rectDist(state.player, s) < 40) {
    const bob = Math.sin(Date.now() / 200) * 2;
    ctx.fillStyle = ready ? '#f0d050' : '#888';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ready ? '!' : '…', sx + s.w / 2, sy - 4 + bob);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#cfcfe0';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Shrine of ' + b.name, sx + s.w / 2, sy - 14);
  ctx.textAlign = 'left';
  if (s.sinking) ctx.restore();
}
function drawPickup(pk) {
  if (pk.collected) return;
  const sx = pk.x - state.camera.x,
    sy = pk.y - state.camera.y;
  pk.bob += 0.08;
  const bob = Math.sin(pk.bob) * 3;
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(sx + 8, sy + 18, 8, 3, 0, 0, 6.28);
  ctx.fill();
  if (pk.kind === 'gold') {
    ctx.fillStyle = '#f0d050';
    ctx.beginPath();
    ctx.arc(sx + 8, sy + 8 + bob, 7, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = '#c0a020';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('$', sx + 8, sy + 11 + bob);
    ctx.textAlign = 'left';
  } else if (pk.kind === 'potion') {
    ctx.fillStyle = '#e04040';
    ctx.fillRect(sx + 4, sy + 6 + bob, 8, 10);
    ctx.fillStyle = '#a02020';
    ctx.fillRect(sx + 6, sy + 3 + bob, 4, 4);
    ctx.fillStyle = '#ff8080';
    ctx.fillRect(sx + 5, sy + 8 + bob, 2, 4);
  } else if (pk.kind === 'key') {
    ctx.fillStyle = '#f0d050';
    ctx.beginPath();
    ctx.arc(sx + 6, sy + 6 + bob, 4, 0, 6.28);
    ctx.fill();
    ctx.fillRect(sx + 5, sy + 8 + bob, 2, 8);
    ctx.fillRect(sx + 5, sy + 14 + bob, 5, 2);
    const sp = Math.sin(Date.now() / 200) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(255,255,200,${sp})`;
    ctx.fillRect(sx + 11, sy + 2 + bob, 2, 2);
  } else if (pk.kind === 'chest') {
    ctx.fillStyle = '#8a5a2a';
    ctx.fillRect(sx + 1, sy + 6 + bob, 14, 10);
    ctx.fillStyle = '#6a4a2a';
    ctx.fillRect(sx + 1, sy + 4 + bob, 14, 4);
    ctx.fillStyle = '#f0d050';
    ctx.fillRect(sx + 6, sy + 8 + bob, 4, 4);
  } else if (pk.kind === 'loot') {
    const it = pk.value.weapon || pk.value.armor;
    const col = rarityColor(it.rarity || 0);
    const pulse = Math.sin(Date.now() / 150) * 0.4 + 0.6;
    ctx.globalAlpha = pulse * 0.5;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx + 8, sy + 8 + bob, 10, 0, 6.28);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(sx + 8, sy + 1 + bob);
    ctx.lineTo(sx + 14, sy + 8 + bob);
    ctx.lineTo(sx + 8, sy + 15 + bob);
    ctx.lineTo(sx + 2, sy + 8 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    ctx.fillRect(sx + 6, sy + 5 + bob, 3, 3);
  } else if (pk.kind === 'forage') {
    const ic = INGR[pk.value] || { color: '#9d6' };
    ctx.fillStyle = ic.color;
    if (pk.value === 'herb') {
      ctx.fillRect(sx + 7, sy + 8 + bob, 2, 8);
      ctx.beginPath();
      ctx.arc(sx + 5, sy + 8 + bob, 3, 0, 6.28);
      ctx.arc(sx + 11, sy + 8 + bob, 3, 0, 6.28);
      ctx.fill();
    } else if (pk.value === 'mushroom') {
      ctx.fillRect(sx + 7, sy + 10 + bob, 2, 5);
      ctx.beginPath();
      ctx.arc(sx + 8, sy + 9 + bob, 5, 3.14, 6.28);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(sx + 6, sy + 9 + bob, 3, 0, 6.28);
      ctx.arc(sx + 11, sy + 9 + bob, 3, 0, 6.28);
      ctx.arc(sx + 8, sy + 12 + bob, 3, 0, 6.28);
      ctx.fill();
    }
  }
}
function nearInteractable() {
  const p = state.player;
  for (const n of state.npcs) if (rectDist(p, n) < 40) return true;
  for (const s of state.shrines) if (rectDist(p, s) < 40) return true;
  for (const s of state.loreStones || []) if (rectDist(p, s) < 44) return true;
  const tx = Math.floor((p.x + p.w / 2) / TILE),
    ty = Math.floor((p.y + p.h / 2) / TILE);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const t = getTile(state.map, tx + dx, ty + dy);
      if (t === T.DUNGEON_ENTRANCE || t === T.D_DESCEND || t === T.D_EXIT || t === T.D_DOOR) return true;
    }
  if (state.map === 'overworld' && !state.sailing && state.fishCd <= 0 && nearWater()) return true;
  return false;
}
function drawProjectile(pr, camX, camY) {
  const sx = pr.x - camX,
    sy = pr.y - camY;
  const el = pr.element;
  const a = Math.atan2(pr.vy, pr.vx);
  if (el === 'fire') {
    const fl = 0.85 + Math.sin(state.time * 0.6 + pr.x) * 0.15;
    for (let i = 2; i >= 1; i--) {
      ctx.fillStyle = i === 2 ? 'rgba(255,90,20,0.28)' : 'rgba(255,140,40,0.5)';
      ctx.beginPath();
      ctx.arc(sx - pr.vx * i * 0.55, sy - pr.vy * i * 0.55, pr.r * (0.85 - i * 0.18), 0, 6.28);
      ctx.fill();
    }
    ctx.fillStyle = '#ff6a20';
    ctx.beginPath();
    ctx.arc(sx, sy, pr.r * 1.1 * fl, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = '#ffe070';
    ctx.beginPath();
    ctx.arc(sx, sy, pr.r * 0.55, 0, 6.28);
    ctx.fill();
  } else if (el === 'frost') {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(a);
    ctx.fillStyle = '#bfe9ff';
    ctx.beginPath();
    ctx.moveTo(pr.r * 1.35, 0);
    ctx.lineTo(0, pr.r * 0.7);
    ctx.lineTo(-pr.r, 0);
    ctx.lineTo(0, -pr.r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, pr.r * 0.35, 0, 6.28);
    ctx.fill();
    ctx.restore();
  } else if (el === 'shock') {
    ctx.strokeStyle = '#fff060';
    ctx.lineWidth = 2;
    const ex = sx + Math.cos(a) * pr.r * 1.6,
      ey = sy + Math.sin(a) * pr.r * 1.6,
      bx = sx - Math.cos(a) * pr.r * 1.6,
      by = sy - Math.sin(a) * pr.r * 1.6;
    const mx = sx + Math.sin(state.time) * 0.5 * 5,
      my = sy + Math.cos(state.time * 1.3) * 0.5 * 5;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(mx, my);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = '#ffffe0';
    ctx.beginPath();
    ctx.arc(sx, sy, pr.r * 0.5, 0, 6.28);
    ctx.fill();
  } else if (el === 'poison') {
    ctx.fillStyle = 'rgba(120,200,60,0.35)';
    ctx.beginPath();
    ctx.arc(sx - pr.vx * 0.5, sy - pr.vy * 0.5, pr.r * 0.8, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = '#7bc234';
    ctx.beginPath();
    ctx.arc(sx, sy, pr.r, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = 'rgba(200,245,140,0.8)';
    ctx.beginPath();
    ctx.arc(sx - pr.r * 0.3, sy - pr.r * 0.3, pr.r * 0.38, 0, 6.28);
    ctx.fill();
  } else if (pr.kind === 'arrow') {
    ctx.strokeStyle = pr.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(a) * 7, sy - Math.sin(a) * 7);
    ctx.lineTo(sx + Math.cos(a) * 7, sy + Math.sin(a) * 7);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sx + Math.cos(a) * 7, sy + Math.sin(a) * 7, 2, 0, 6.28);
    ctx.fill();
  } else {
    ctx.fillStyle = pr.color;
    ctx.beginPath();
    ctx.arc(sx, sy, pr.r, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(sx, sy, pr.r * 0.45, 0, 6.28);
    ctx.fill();
  }
}
// ================= MINIMAP =================
__g.minimapBase = null;
__g.minimapBaseWinter = false;
function buildMinimapBase() {
  if (!maps.overworld) return;
  const c = document.createElement('canvas');
  c.width = OW_W;
  c.height = OW_H;
  const x = c.getContext('2d');
  const m = maps.overworld;
  for (let ty = 0; ty < OW_H; ty++)
    for (let tx = 0; tx < OW_W; tx++) {
      const t = m[ty][tx];
      let col;
      if (t === T.WATER) col = isWinter() ? '#cfe2ee' : '#2a5a9a';
      else if (t === T.MOUNTAIN) col = '#5e5e66';
      else if (t === T.TREE) col = '#2c5430';
      else if (t === T.HOUSE) col = '#caa060';
      else if (t === T.PATH || t === T.BRIDGE) col = '#8a6a3a';
      else if (t === T.DUNGEON_ENTRANCE) col = '#9050c0';
      else {
        const b = tileBiome(tx, ty);
        col = b === 1 ? '#cfe2ee' : b === 2 ? '#7a3018' : '#3e7a40';
      }
      x.fillStyle = col;
      x.fillRect(tx, ty, 1, 1);
    }
  __g.minimapBase = c;
  __g.minimapBaseWinter = isWinter();
}
function drawMapMarkers(x, W, H) {
  const sx = W / OW_W,
    sy = H / OW_H,
    k = Math.max(1, W / 150);
  for (let i = 0; i < __g.townZones.length; i++) {
    const c = townCenter(__g.townZones[i]);
    if (__g.townZones[i].besieged) {
      x.strokeStyle = '#ff4040';
      x.lineWidth = 1.5 * k;
      x.beginPath();
      x.arc(c.x * sx, c.y * sy, 3.6 * k, 0, 6.28);
      x.stroke();
    }
    x.fillStyle = '#f0d050';
    x.fillRect(c.x * sx - 1.8 * k, c.y * sy - 1.8 * k, 3.6 * k, 3.6 * k);
  }
  if (state.shrines)
    for (const s of state.shrines) {
      x.fillStyle = '#a0e0ff';
      x.beginPath();
      x.arc(((s.x + s.w / 2) / TILE) * sx, ((s.y + s.h / 2) / TILE) * sy, 1.5 * k, 0, 6.28);
      x.fill();
    }
  if (state.pois)
    for (const poi of state.pois) {
      if (poi.cleared) continue;
      x.fillStyle = POI_KINDS[poi.kind].mark;
      const mx = poi.tx * sx,
        my = poi.ty * sy;
      if (poi.kind === 'keep') {
        x.fillRect(mx - 1.7 * k, my - 1.7 * k, 3.4 * k, 3.4 * k);
      } else if (poi.kind === 'camp') {
        x.beginPath();
        x.moveTo(mx, my - 2.3 * k);
        x.lineTo(mx - 2 * k, my + 1.8 * k);
        x.lineTo(mx + 2 * k, my + 1.8 * k);
        x.closePath();
        x.fill();
      } else {
        x.beginPath();
        x.arc(mx, my, 1.8 * k, 0, 6.28);
        x.fill();
      }
    }
  if (state.holdings)
    for (let i = 0; i < HOLD_SITES.length; i++) {
      const hd = state.holdings[i];
      if (!hd) continue;
      const hsite = HOLD_SITES[i];
      const mx = hsite.tx * sx,
        my = hsite.ty * sy;
      if (hd.built) {
        x.fillStyle = hd.besieged ? '#ff4040' : '#f0d050';
        x.fillRect(mx - 2 * k, my - 2 * k, 4 * k, 4 * k);
        if (hd.besieged) {
          x.strokeStyle = '#ff4040';
          x.lineWidth = 1.2 * k;
          x.beginPath();
          x.arc(mx, my, 3.8 * k, 0, 6.28);
          x.stroke();
        }
      } else {
        x.fillStyle = hd.liberated ? '#c8c8d8' : '#d04040';
        x.fillRect(mx - 1.6 * k, my - 1.6 * k, 3.2 * k, 3.2 * k);
      }
    }
  if (typeof GREAT_HUNTS !== 'undefined')
    for (const h of GREAT_HUNTS) {
      if (!(state.huntsSlain || []).includes(h.key)) {
        x.save();
        x.translate(h.lair.tx * sx, h.lair.ty * sy);
        x.rotate(0.785);
        x.fillStyle = '#7ad0a0';
        x.fillRect(-2 * k, -2 * k, 4 * k, 4 * k);
        x.restore();
      }
    }
  {
    const ps = state.pinnacleSlain || [];
    if (state.drownedLair && !ps.includes('drownedking')) {
      x.save();
      x.translate(state.drownedLair.tx * sx, state.drownedLair.ty * sy);
      x.rotate(0.785);
      x.fillStyle = '#2f7fb0';
      x.fillRect(-2.5 * k, -2.5 * k, 5 * k, 5 * k);
      x.restore();
    }
    if (
      state.shepherdLair &&
      !ps.includes('paleshepherd') &&
      (state.enemies || []).some((e) => e.isPinnacle && e.pinKey === 'paleshepherd')
    ) {
      x.save();
      x.translate(state.shepherdLair.tx * sx, state.shepherdLair.ty * sy);
      x.rotate(0.785);
      x.fillStyle = '#d6e6f2';
      x.fillRect(-2.5 * k, -2.5 * k, 5 * k, 5 * k);
      x.restore();
    }
  } /* Pinnacle-lair markers (mirror the hunt diamond): King persistent until slain; Shepherd only while risen (night) */
  if (state.dungeonEntrance) {
    x.fillStyle = '#c080ff';
    x.beginPath();
    x.arc(state.dungeonEntrance.tx * sx, state.dungeonEntrance.ty * sy, 2 * k, 0, 6.28);
    x.fill();
  }
  {
    const lq = state.quests.legion;
    if (lq && lq.stage === 'overlord' && lq.seatRegion >= 0) {
      const rcx = (((lq.seatRegion % 3) + 0.5) * OW_W) / 3,
        rcy = ((Math.floor(lq.seatRegion / 3) + 0.5) * OW_H) / 3;
      const mx = rcx * sx,
        my = rcy * sy;
      const pl = 0.5 + Math.sin(Date.now() / 240) * 0.5;
      x.globalAlpha = 0.4 + pl * 0.5;
      x.strokeStyle = '#ff2838';
      x.lineWidth = 1.6 * k;
      x.beginPath();
      x.arc(mx, my, 4.2 * k, 0, 6.28);
      x.stroke();
      x.globalAlpha = 1;
      x.fillStyle = '#ff2838';
      x.beginPath();
      x.moveTo(mx, my - 2.8 * k);
      x.lineTo(mx + 2.8 * k, my);
      x.lineTo(mx, my + 2.8 * k);
      x.lineTo(mx - 2.8 * k, my);
      x.closePath();
      x.fill();
    }
  }
  if (state.wayfind !== false && typeof currentObjective === 'function') {
    const o = currentObjective();
    if (o) {
      const pl = 0.5 + Math.sin(Date.now() / 260) * 0.5;
      x.globalAlpha = 0.45 + pl * 0.5;
      x.strokeStyle = '#ffd24a';
      x.lineWidth = 1.4 * k;
      x.beginPath();
      x.arc(o.tx * sx, o.ty * sy, 4.6 * k, 0, 6.28);
      x.stroke();
      x.globalAlpha = 1;
    }
  }
  const p = state.player;
  const ptx = ((p.x + p.w / 2) / TILE) * sx,
    pty = ((p.y + p.h / 2) / TILE) * sy;
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.moveTo(ptx, pty - 3.4 * k);
  x.lineTo(ptx - 2.6 * k, pty + 2.6 * k);
  x.lineTo(ptx + 2.6 * k, pty + 2.6 * k);
  x.closePath();
  x.fill();
}
function drawMinimapTo(canvas) {
  if (!canvas) return;
  const x = canvas.getContext('2d');
  const W = canvas.width,
    H = canvas.height;
  x.clearRect(0, 0, W, H);
  if (state.map !== 'overworld') return;
  if (!__g.minimapBase || __g.minimapBaseWinter !== isWinter()) buildMinimapBase();
  if (__g.minimapBase) {
    x.imageSmoothingEnabled = false;
    x.drawImage(__g.minimapBase, 0, 0, W, H);
  }
  drawMapMarkers(x, W, H);
}
function updateMinimap() {
  const mm = document.getElementById('minimap');
  if (!mm) return;
  if (!mm._wired) {
    mm._wired = true;
    mm.onclick = openFullMap;
  }
  if (state.map === 'overworld' && state.scene !== 'map') {
    mm.style.display = 'block';
    drawMinimapTo(mm);
  } else mm.style.display = 'none';
}
function openFullMap() {
  if (state.scene !== 'play' || state.map !== 'overworld') return;
  state.scene = 'map';
  document.getElementById('fullmap').style.display = 'block';
  const leg = document.getElementById('fullmap-legend');
  if (leg)
    leg.innerHTML =
      '<span style="color:#f0d050">■ town</span> · <span style="color:#ff5555">◉ besieged</span> · <span style="color:#7ad0a0">◆ hunt</span> · <span style="color:#c080ff">● dungeon</span> · <span style="color:#a0e0ff">● shrine</span> · <span style="color:#fff">▲ you</span>';
  drawMinimapTo(document.getElementById('fullmap-canvas'));
}
function closeFullMap() {
  document.getElementById('fullmap').style.display = 'none';
  state.scene = 'play';
}
// ================= MENU HUB ([Tab]) =================
const HUB_TABS = [
  { sc: 'inventory', label: 'Items', icon: '🎒', open: () => toggleInventory() },
  { sc: 'skills', label: 'Skills', icon: '✦', open: () => toggleSkills() },
  { sc: 'factions', label: 'Standing', icon: '⚜', open: () => openFactions() },
  { sc: 'legion', label: 'Legion', icon: '☠', open: () => openLegion() },
  { sc: 'hunts', label: 'Hunts', icon: '⊹', open: () => openHunts() },
  { sc: 'trophy', label: 'Trophy', icon: '🏆', open: () => openTrophy() },
  { sc: 'cook', label: 'Cook', icon: '🍲', open: () => openCook() },
];
function hubIdxOfScene() {
  return HUB_TABS.findIndex((t) => t.sc === state.scene);
}
function closeHubPanels() {
  ['inventory', 'skills', 'factions', 'legion', 'hunts', 'trophy', 'cook'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  state.scene = 'play';
}
function openHub(idx) {
  if (hubIdxOfScene() >= 0) closeHubPanels();
  else if (state.scene !== 'play') return;
  idx = ((idx % HUB_TABS.length) + HUB_TABS.length) % HUB_TABS.length;
  state.hubTab = idx;
  HUB_TABS[idx].open();
}
function switchHubTab(dir) {
  const cur = hubIdxOfScene();
  if (cur < 0) return;
  openHub(cur + dir);
}
function updateHubTabs() {
  const el = document.getElementById('hubtabs');
  if (!el) return;
  const cur = hubIdxOfScene();
  const ng = document.getElementById('newgame-btn');
  if (ng) ng.style.display = cur >= 0 ? 'none' : 'block';
  if (cur < 0) {
    if (el.style.display !== 'none') {
      el.style.display = 'none';
      el._active = -1;
    }
    return;
  }
  el.style.display = 'flex';
  if (el._active !== cur) {
    el._active = cur;
    el.innerHTML = HUB_TABS.map(
      (t, i) =>
        `<button data-i="${i}" class="${i === cur ? 'on' : ''}" title="${t.label}"><span class="ic">${t.icon}</span><span class="lb">${t.label}</span></button>`,
    ).join('');
    el.querySelectorAll('button').forEach((b) => {
      b.onclick = () => openHub(parseInt(b.dataset.i));
    });
  }
}
/* VIEWPORT CULL. The world holds ~130 enemies and the draw loop was handing EVERY one of them to drawEnemy on every
   frame — at boot, 128 of 130 are off-screen (measured). They cost real time: canvas still transforms/clips each op.
   drawEnemy is a pure draw (e.wobble is advanced in updateEnemies, never here), so skipping it is safe — the ONLY
   things that must survive the cull are the overlays drawn far from the enemy's own body:
     - a pinnacle boss's arena ring is centred on its LAIR at up to PIN_ARENA_START(360)px — it tells you where the
       safe ground is, so it must draw while you stand in the ring and the boss is off-screen;
     - a boss telegraph ('charge' lays a 200px lane) must be readable before the boss itself comes on-screen.
   Margin is per-enemy (sprite + its aura/label overhead) because sizes run 18px → 62px. */
function enemyVisible(e) {
  if (e.tele || (e.isPinnacle && e.arenaR)) return true;
  const m = 48 + e.w,
    sx = e.x - state.camera.x,
    sy = e.y - state.camera.y;
  return !(sx < -m || sx > __g.VIEW_W + m || sy < -m || sy > __g.VIEW_H + m);
}
function renderWorld() {
  const m = maps[state.map],
    camX = state.camera.x,
    camY = state.camera.y;
  const startTx = Math.floor(camX / TILE),
    startTy = Math.floor(camY / TILE),
    endTx = Math.ceil((camX + __g.VIEW_W) / TILE),
    endTy = Math.ceil((camY + __g.VIEW_H) / TILE);
  ctx.fillStyle = state.map === 'dungeon' ? '#0a080e' : '#3a6a9a';
  ctx.fillRect(0, 0, __g.VIEW_W, __g.VIEW_H);
  for (let ty = startTy; ty < endTy; ty++)
    for (let tx = startTx; tx < endTx; tx++) {
      if (ty < 0 || tx < 0 || ty >= m.length || tx >= m[0].length) continue;
      drawTile(
        m[ty][tx],
        tx * TILE - camX,
        ty * TILE - camY,
        state.map === 'overworld' ? tileBiome(tx, ty) : 0,
      );
    }
  if (state.map === 'overworld' && state.fires.length) drawFires(camX, camY);
  if (state.map === 'overworld' && state.pois) for (const poi of state.pois) drawPOI(poi);
  if (state.map === 'overworld') for (let i = 0; i < HOLD_SITES.length; i++) drawHolding(i);
  const ents = [
    ...state.pickups.filter((p) => !p.collected).map((e) => ({ type: 'pickup', o: e, y: e.y })),
    ...(state.map === 'overworld' ? state.shrines.map((e) => ({ type: 'shrine', o: e, y: e.y })) : []),
    ...(state.map === 'overworld'
      ? (state.loreStones || []).map((e) => ({ type: 'lore', o: e, y: e.y }))
      : []),
    ...state.npcs.map((e) => ({ type: 'npc', o: e, y: e.y })),
    ...(state.allies || []).map((e) => ({ type: 'ally', o: e, y: e.y })),
    ...(state.companions || [])
      .filter((c) => c.alive && !(c.postedAt != null && state.map !== 'overworld'))
      .map((c) => ({ type: 'companion', o: c, y: c.y })),
    ...state.enemies.filter(enemyVisible).map((e) => ({ type: 'enemy', o: e, y: e.y })),
    { type: 'player', o: state.player, y: state.player.y },
  ].sort((a, b) => a.y - b.y);
  for (const ent of ents) {
    if (ent.type === 'pickup') drawPickup(ent.o);
    else if (ent.type === 'shrine') drawShrine(ent.o);
    else if (ent.type === 'lore') drawLoreStone(ent.o);
    else if (ent.type === 'npc') drawNPC(ent.o);
    else if (ent.type === 'ally') drawAlly(ent.o);
    else if (ent.type === 'companion') drawCompanion(ent.o);
    else if (ent.type === 'enemy') drawEnemy(ent.o);
    else drawPlayer();
  }
  for (const pr of state.projectiles) drawProjectile(pr, camX, camY);
  drawParticles(camX, camY);
  drawArcs(camX, camY);
  drawShockwaves(camX, camY);
  if (state.map === 'overworld') {
    drawSeasonTint();
    drawMoodTint();
  }
  if (state.map === 'overworld') {
    drawLighting(camX, camY);
    drawWeather();
  }
  if (state.map === 'overworld') {
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (const tz of __g.townZones) {
      const wx = (tz.x + tz.w / 2) * TILE - camX,
        wy = (tz.y - 1) * TILE - camY;
      if (wx > -60 && wx < __g.VIEW_W + 60 && wy > -10 && wy < __g.VIEW_H) {
        const sg = tz.besieged;
        const lbl = (sg ? '⚔ ' : '⌂ ') + tz.name;
        ctx.fillStyle = sg ? 'rgba(80,12,12,0.72)' : 'rgba(0,0,0,0.5)';
        ctx.fillRect(wx - lbl.length * 3.2 - 6, wy - 10, lbl.length * 6.4 + 12, 13);
        ctx.fillStyle = sg ? '#ff8080' : '#f0e0a0';
        ctx.fillText(lbl, wx, wy);
      }
    }
    {
      const fx = 123 * TILE - camX,
        fy = 34 * TILE - camY;
      if (fx > -90 && fx < __g.VIEW_W + 90 && fy > -10 && fy < __g.VIEW_H) {
        ctx.fillStyle = 'rgba(20,32,52,0.5)';
        ctx.fillRect(fx - 54, fy - 10, 108, 13);
        ctx.fillStyle = '#bfe0ff';
        ctx.fillText('❄ Frozen Wastes', fx, fy);
      }
    }
    {
      const lx = 274 * TILE - camX,
        ly = 224 * TILE - camY;
      if (lx > -90 && lx < __g.VIEW_W + 90 && ly > -10 && ly < __g.VIEW_H) {
        ctx.fillStyle = 'rgba(50,20,10,0.55)';
        ctx.fillRect(lx - 52, ly - 10, 104, 13);
        ctx.fillStyle = '#ff9050';
        ctx.fillText('🔥 The Emberwaste', lx, ly);
      }
    }
    if (state.krakenArena && !state.flags.krakenDead) {
      const kx = state.krakenArena.tx * TILE - camX,
        ky = (state.krakenArena.ty - 5) * TILE - camY;
      if (kx > -100 && kx < __g.VIEW_W + 100 && ky > -10 && ky < __g.VIEW_H) {
        ctx.fillStyle = 'rgba(20,20,40,0.55)';
        ctx.fillRect(kx - 58, ky - 10, 116, 13);
        ctx.fillStyle = '#a0b0e0';
        ctx.fillText('Kraken Roost', kx, ky);
      }
    }
    ctx.textAlign = 'left';
  }
  if (state.scene === 'play' && nearInteractable()) {
    const sx = state.player.x - camX + state.player.w / 2,
      sy = state.player.y - camY - 16,
      b = Math.sin(Date.now() / 200) * 2;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('[E]', sx, sy + b);
    ctx.textAlign = 'left';
  }
  if (state.map === 'dungeon') {
    const p = state.player,
      px = p.x - camX + p.w / 2,
      py = p.y - camY + p.h / 2;
    const grad = ctx.createRadialGradient(px, py, 40, px, py, 260);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, __g.VIEW_W, __g.VIEW_H);
  }
  if (__g.hurtFlash > 0) {
    const vg = ctx.createRadialGradient(
      __g.VIEW_W / 2,
      __g.VIEW_H / 2,
      __g.VIEW_H * 0.32,
      __g.VIEW_W / 2,
      __g.VIEW_H / 2,
      __g.VIEW_H * 0.72,
    );
    vg.addColorStop(0, 'rgba(170,0,0,0)');
    vg.addColorStop(1, 'rgba(170,0,0,' + (__g.hurtFlash * 0.5).toFixed(3) + ')');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, __g.VIEW_W, __g.VIEW_H);
  }
}

// ================= HUD =================
