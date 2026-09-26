// Modelos 3D procedurais das armas (caixas/cilindros). Origem na empunhadura, cano aponta para -Z.
// Compartilhados pelo viewmodel (primeira pessoa) e pelos personagens (terceira pessoa).
import * as THREE from 'three';

const cache = new Map();
function mat(color, rough = 1) {
  const key = `${color}|${rough}`;
  let m = cache.get(key);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); cache.set(key, m); }
  return m;
}

const METAL = 0x2c3037, DARK = 0x15171a, STEEL = 0x6a7078, POLY = 0x23262b, WOOD = 0x6e4a2c, BRASS = 0xb8912e;

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}

function cyl(r, len, color, x = 0, y = 0, z = 0, segments = 8) {
  const g = new THREE.CylinderGeometry(r, r, len, segments);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat(color));
  m.position.set(x, y, z);
  return m;
}

/**
 * @returns {{group:THREE.Group, muzzle:THREE.Object3D, mag:THREE.Object3D|null, pump:THREE.Object3D|null,
 *            handR:THREE.Vector3, handL:THREE.Vector3}}
 */
export function buildWeaponModel(kind, grenadeKind = 'frag') {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  let mag = null, pump = null;
  const handR = new THREE.Vector3(0, -0.05, 0.02);
  const handL = new THREE.Vector3(0, -0.03, -0.3);

  switch (kind) {
    case 'rifle': {
      g.add(box(0.055, 0.085, 0.4, METAL, 0, 0.02, -0.06));            // receptor
      g.add(box(0.05, 0.06, 0.3, POLY, 0, 0.015, -0.42));              // guarda-mão
      g.add(cyl(0.011, 0.26, DARK, 0, 0.022, -0.72));                  // cano
      g.add(cyl(0.017, 0.05, DARK, 0, 0.022, -0.86));                  // quebra-chamas
      g.add(box(0.045, 0.1, 0.26, POLY, 0, 0.0, 0.3));                 // coronha
      g.add(box(0.04, 0.11, 0.05, POLY, 0, -0.085, 0.07));             // empunhadura
      g.add(box(0.03, 0.03, 0.14, STEEL, 0, 0.08, -0.12));             // trilho/mira
      g.add(box(0.012, 0.03, 0.012, DARK, 0, 0.08, -0.62));            // maçã de mira
      mag = box(0.038, 0.17, 0.07, DARK, 0, -0.13, -0.1);
      mag.rotation.x = -0.18;
      g.add(mag);
      muzzle.position.set(0, 0.022, -0.9);
      handR.set(0, -0.08, 0.07); handL.set(0, -0.03, -0.42);
      break;
    }
    case 'smg': {
      g.add(box(0.05, 0.08, 0.3, METAL, 0, 0.02, -0.05));
      g.add(box(0.045, 0.055, 0.2, POLY, 0, 0.012, -0.28));
      g.add(cyl(0.011, 0.18, DARK, 0, 0.02, -0.5));
      g.add(box(0.04, 0.08, 0.16, POLY, 0, 0.0, 0.22));
      g.add(box(0.036, 0.1, 0.05, POLY, 0, -0.075, 0.05));
      g.add(box(0.026, 0.026, 0.1, STEEL, 0, 0.072, -0.08));
      mag = box(0.032, 0.2, 0.05, DARK, 0, -0.16, -0.12);
      g.add(mag);
      muzzle.position.set(0, 0.02, -0.6);
      handR.set(0, -0.07, 0.05); handL.set(0, -0.04, -0.28);
      break;
    }
    case 'pistol': {
      g.add(box(0.032, 0.045, 0.2, STEEL, 0, 0.03, -0.08));             // ferrolho
      g.add(box(0.03, 0.03, 0.18, DARK, 0, 0.0, -0.06));                // armação
      g.add(box(0.032, 0.1, 0.05, POLY, 0, -0.06, 0.02));               // empunhadura
      g.add(box(0.008, 0.012, 0.008, DARK, 0, 0.058, -0.17));
      mag = box(0.026, 0.06, 0.04, DARK, 0, -0.1, 0.02);
      g.add(mag);
      muzzle.position.set(0, 0.03, -0.19);
      handR.set(0, -0.06, 0.03); handL.set(0, -0.055, 0.0);
      break;
    }
    case 'shotgun': {
      g.add(box(0.055, 0.08, 0.32, METAL, 0, 0.01, -0.04));
      g.add(cyl(0.02, 0.62, DARK, 0, 0.03, -0.5));                      // cano
      g.add(cyl(0.017, 0.5, STEEL, 0, -0.012, -0.44));                  // tubo do carregador
      pump = box(0.05, 0.05, 0.16, WOOD, 0, -0.005, -0.42);
      g.add(pump);
      g.add(box(0.05, 0.1, 0.3, WOOD, 0, -0.005, 0.3));
      g.add(box(0.036, 0.1, 0.05, POLY, 0, -0.08, 0.08));
      muzzle.position.set(0, 0.03, -0.84);
      handR.set(0, -0.08, 0.08); handL.set(0, -0.03, -0.42);
      break;
    }
    case 'knife': {
      const blade = box(0.012, 0.036, 0.22, 0xc9ced3, 0, 0.0, -0.17);
      g.add(blade);
      g.add(box(0.014, 0.012, 0.22, 0x9ba1a8, 0, 0.016, -0.17));        // lombo
      g.add(box(0.05, 0.02, 0.012, DARK, 0, 0.0, -0.05));               // guarda
      g.add(box(0.03, 0.04, 0.12, POLY, 0, -0.005, 0.02));              // cabo
      muzzle.position.set(0, 0, -0.3);
      handR.set(0, -0.02, 0.02); handL.set(0, -0.2, 0.2);
      break;
    }
    default: { // granada
      const color = grenadeKind === 'frag' ? 0x4a6b3a : grenadeKind === 'flash' ? 0xd8d2b8 : 0x8b9096;
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat(color));
      body.scale.set(1, 1.2, 1);
      g.add(body);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.035, 8), mat(STEEL));
      cap.position.set(0, 0.062, 0);
      g.add(cap);
      const lever = box(0.008, 0.07, 0.012, STEEL, 0.03, 0.03, 0);
      g.add(lever);
      handR.set(0, -0.02, 0.02); handL.set(0.1, -0.1, 0.1);
      muzzle.position.set(0, 0, 0);
    }
  }
  g.add(muzzle);
  return { group: g, muzzle, mag, pump, handR, handL };
}

export const MODEL_KIND_BY_DEF = {
  p9: 'pistol', ar30: 'rifle', smg9: 'smg', ps12: 'shotgun', knife: 'knife', frag: 'grenade', flash: 'grenade', smoke: 'grenade',
};

/** Textura suave (radial) para fumaça, flash de cano e faíscas. */
export function makeSoftTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, outer);
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
