// Texturas e materiais 100% procedurais (canvas 2D) — sem assets externos, sem licenças.
import * as THREE from 'three';

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function makeCanvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  return c;
}

function grain(ctx, size, amount, rnd) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(canvas, aniso = 4) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------------------------------------------------------------- receitas de textura

const RECIPES = {
  wall: { size: 4, draw: (ctx, s, r) => {
    ctx.fillStyle = '#8a8d90'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 26, r);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 2;
    for (const x of [0, s / 2]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke(); }
    for (const y of [s * 0.25, s * 0.75]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
    // manchas de umidade
    for (let i = 0; i < 9; i++) {
      const x = r() * s, w = 6 + r() * 16;
      const g = ctx.createLinearGradient(0, s * 0.2, 0, s);
      g.addColorStop(0, 'rgba(40,36,30,0)'); g.addColorStop(1, 'rgba(40,36,30,0.28)');
      ctx.fillStyle = g; ctx.fillRect(x, s * 0.2, w, s * 0.8);
    }
    // rodapé escuro + faixa de segurança no rodapé
    ctx.fillStyle = 'rgba(30,30,32,0.55)'; ctx.fillRect(0, s - 26, s, 26);
    ctx.fillStyle = '#c9a227'; ctx.fillRect(0, s - 30, s, 4);
  } },
  floor: { size: 4, draw: (ctx, s, r) => {
    ctx.fillStyle = '#5b5e62'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 30, r);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, s - 2, s - 2);
    ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(20,20,20,0.35)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); let x = r() * s, y = r() * s; ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const g = ctx.createRadialGradient(r() * s, r() * s, 2, r() * s, r() * s, 30 + r() * 30);
      g.addColorStop(0, 'rgba(20,18,15,0.22)'); g.addColorStop(1, 'rgba(20,18,15,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    }
  } },
  crate: { size: 1.2, draw: (ctx, s, r) => {
    ctx.fillStyle = '#a67c52'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 34, r);
    ctx.strokeStyle = 'rgba(60,35,15,0.55)'; ctx.lineWidth = 2;
    for (let y = s / 5; y < s; y += s / 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
    ctx.lineWidth = 14; ctx.strokeStyle = '#6f4b2a'; ctx.strokeRect(7, 7, s - 14, s - 14);
    ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(s - 10, s - 10); ctx.moveTo(s - 10, 10); ctx.lineTo(10, s - 10); ctx.stroke();
  } },
  container_red: { size: 2.4, draw: (ctx, s, r) => corrugated(ctx, s, r, '#a8402f', '#8c3325') },
  container_blue: { size: 2.4, draw: (ctx, s, r) => corrugated(ctx, s, r, '#2f6a9c', '#255580') },
  metal: { size: 2, draw: (ctx, s, r) => {
    ctx.fillStyle = '#5d646b'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 24, r);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, s - 4, s - 4);
    ctx.fillStyle = 'rgba(20,20,22,0.6)';
    for (const [x, y] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14]]) { ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.3); ctx.fill(); }
  } },
  catwalk: { size: 1, draw: (ctx, s, r) => {
    ctx.fillStyle = '#3a3f45'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 18, r);
    ctx.strokeStyle = 'rgba(160,168,176,0.55)'; ctx.lineWidth = 3;
    for (let i = 0; i <= s; i += s / 8) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke(); }
    ctx.fillStyle = '#c9a227'; ctx.fillRect(0, 0, s, 6);
  } },
  pillar: { size: 3, draw: (ctx, s, r) => {
    ctx.fillStyle = '#787b7e'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 26, r);
    hazard(ctx, s, s - 58, 58);
    ctx.fillStyle = 'rgba(30,30,32,0.35)'; ctx.fillRect(0, 0, s, 8);
  } },
  lowwall: { size: 2, draw: (ctx, s, r) => {
    ctx.fillStyle = '#8f9295'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 26, r);
    hazard(ctx, s, 0, 40);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3; ctx.strokeRect(1, 1, s - 2, s - 2);
  } },
  roof: { size: 4, draw: (ctx, s, r) => {
    ctx.fillStyle = '#6b6f75'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 20, r);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(120,124,130,0.35)'; ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * s / 4, 0); ctx.lineTo(i * s / 4, s); ctx.stroke(); }
  } },
  barrel: { size: 1, draw: (ctx, s, r) => {
    ctx.fillStyle = '#2f5b7a'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 26, r);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const y of [s * 0.12, s * 0.5, s * 0.86]) ctx.fillRect(0, y, s, 8);
    ctx.fillStyle = 'rgba(160,80,30,0.25)';
    for (let i = 0; i < 6; i++) ctx.fillRect(r() * s, r() * s, 10 + r() * 24, 3);
  } },
  workbench: { size: 1.5, draw: (ctx, s, r) => {
    ctx.fillStyle = '#7a5b3d'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 30, r);
    ctx.fillStyle = '#4a5057'; ctx.fillRect(0, 0, s, s * 0.22);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3;
    for (let x = s / 4; x < s; x += s / 4) { ctx.beginPath(); ctx.moveTo(x, s * 0.22); ctx.lineTo(x, s); ctx.stroke(); }
  } },
  console: { size: 1.5, draw: (ctx, s, r) => {
    ctx.fillStyle = '#464c54'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 20, r);
    ctx.fillStyle = '#0e1a22'; ctx.fillRect(s * 0.08, s * 0.1, s * 0.84, s * 0.36);
    ctx.fillStyle = '#39d5a0'; for (let i = 0; i < 9; i++) ctx.fillRect(s * 0.12 + i * 24, s * 0.16 + (i % 3) * 18, 12, 6);
    ctx.fillStyle = '#c94a3d'; ctx.beginPath(); ctx.arc(s * 0.2, s * 0.7, 9, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#e0b83a'; ctx.beginPath(); ctx.arc(s * 0.35, s * 0.7, 9, 0, 6.3); ctx.fill();
  } },
  pipe: { size: 1, draw: (ctx, s, r) => {
    ctx.fillStyle = '#7a8088'; ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 18, r);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, s * 0.45, s, 6);
  } },
  rail: { size: 1, draw: (ctx, s) => { ctx.fillStyle = '#d9a91f'; ctx.fillRect(0, 0, s, s); ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, s * 0.42, s, s * 0.16); } },
  stairs: { size: 2, draw: (ctx, s, r) => { ctx.fillStyle = '#4b5057'; ctx.fillRect(0, 0, s, s); grain(ctx, s, 22, r); } },
};

function corrugated(ctx, s, r, base, dark) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 16) { ctx.fillStyle = dark; ctx.fillRect(x, 0, 8, s); }
  grain(ctx, s, 26, r);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, s - 8, s - 8);
  ctx.fillStyle = 'rgba(210,190,150,0.25)'; ctx.fillRect(s * 0.15, s * 0.08, s * 0.7, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 5; i++) ctx.fillRect(r() * s, r() * s, 4, 20 + r() * 50);
}

function hazard(ctx, s, y0, h) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, y0, s, h); ctx.clip();
  ctx.fillStyle = '#d8a80f'; ctx.fillRect(0, y0, s, h);
  ctx.fillStyle = '#1a1a1a';
  for (let x = -h; x < s + h; x += h) {
    ctx.beginPath(); ctx.moveTo(x, y0 + h); ctx.lineTo(x + h * 0.5, y0 + h); ctx.lineTo(x + h * 1.5, y0); ctx.lineTo(x + h, y0); ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- API

export class MaterialLibrary {
  constructor(anisotropy = 4) {
    this.materials = new Map();
    this.worldSize = new Map();
    this.textures = [];
    let seed = 1000;
    for (const [tag, def] of Object.entries(RECIPES)) {
      const canvas = makeCanvas(256, (ctx, s) => def.draw(ctx, s, lcg(seed++)));
      const tex = toTexture(canvas, anisotropy);
      this.textures.push(tex);
      this.materials.set(tag, new THREE.MeshLambertMaterial({ map: tex }));
      this.worldSize.set(tag, def.size);
    }
    this.materials.set('floor_ao', null);
  }

  get(tag) {
    return this.materials.get(tag) || this.materials.get('wall');
  }

  sizeOf(tag) {
    return this.worldSize.get(tag) || 4;
  }

  /** Textura da letra do sítio (decalque no chão). */
  static siteMark(letter) {
    const c = makeCanvas(512, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(232,190,40,0.9)'; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([26, 18]); ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(232,190,40,0.92)';
      ctx.font = `900 ${s * 0.46}px "Bahnschrift","Arial Black",Impact,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(letter, s / 2, s / 2 + s * 0.02);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  dispose() {
    for (const m of this.materials.values()) if (m) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
