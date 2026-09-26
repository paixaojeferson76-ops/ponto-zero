// Hitboxes por região do corpo (cabeça, tronco, braços, pernas), orientadas pelo yaw do personagem.
// Coordenadas locais: origem nos pés; -Z é a frente; caixa = centro + meio-tamanho.
import { PLAYER } from '../Config/Tuning.js';

export const HITBOX_PART = { HEAD: 'head', TORSO: 'torso', ARM: 'arm', LEG: 'leg' };

const STAND = [
  { name: 'head',  part: 'head',  cx: 0,     cy: 1.66, cz: 0, hx: 0.14, hy: 0.14, hz: 0.14 },
  { name: 'torso', part: 'torso', cx: 0,     cy: 1.22, cz: 0, hx: 0.25, hy: 0.30, hz: 0.16 },
  { name: 'armL',  part: 'arm',   cx: -0.35, cy: 1.20, cz: 0, hx: 0.10, hy: 0.30, hz: 0.11 },
  { name: 'armR',  part: 'arm',   cx: 0.35,  cy: 1.20, cz: 0, hx: 0.10, hy: 0.30, hz: 0.11 },
  { name: 'legL',  part: 'leg',   cx: -0.12, cy: 0.46, cz: 0, hx: 0.12, hy: 0.46, hz: 0.13 },
  { name: 'legR',  part: 'leg',   cx: 0.12,  cy: 0.46, cz: 0, hx: 0.12, hy: 0.46, hz: 0.13 },
];

const CROUCH_SCALE = PLAYER.HEIGHT_CROUCH / PLAYER.HEIGHT_STAND;

export class HitboxHit {
  constructor() {
    this.t = 0;
    this.part = null;
    this.name = null;
    this.x = 0; this.y = 0; this.z = 0;
    this.nx = 0; this.ny = 1; this.nz = 0;
    this.tExit = 0;
  }
}

export class HitboxSet {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0;
    this.scaleY = 1;
    this.enabled = true;
    this.boxes = STAND;
  }

  update(x, y, z, yaw, crouched) {
    this.x = x; this.y = y; this.z = z;
    this.yaw = yaw;
    this.scaleY = crouched ? CROUCH_SCALE : 1;
  }

  /** Caixas em coordenadas de mundo (centro/meio-tamanho + yaw) para debug/visualização. */
  worldBoxes(out = []) {
    out.length = 0;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    for (const b of this.boxes) {
      // local→mundo: rotação Y(+yaw)
      const wx = b.cx * cy + b.cz * sy;
      const wz = -b.cx * sy + b.cz * cy;
      out.push({
        name: b.name, part: b.part,
        x: this.x + wx, y: this.y + b.cy * this.scaleY, z: this.z + wz,
        hx: b.hx, hy: b.hy * this.scaleY, hz: b.hz, yaw: this.yaw,
      });
    }
    return out;
  }

  /**
   * Raio (direção unitária) contra as caixas. Retorna true e preenche `out` com o acerto mais próximo.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
    if (!this.enabled) return false;
    // Broadphase: cilindro/AABB envolvente grosseiro.
    const top = this.y + 1.9 * this.scaleY;
    if (!rayVsAabb(ox, oy, oz, dx, dy, dz, this.x - 0.55, this.y - 0.02, this.z - 0.55, this.x + 0.55, top, this.z + 0.55, maxDist)) return false;

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // mundo→local: rotação Y(-yaw)
    const px = ox - this.x, pz = oz - this.z;
    const lox = px * cy - pz * sy;
    const loz = px * sy + pz * cy;
    const loy = oy - this.y;
    const ldx = dx * cy - dz * sy;
    const ldz = dx * sy + dz * cy;

    let bestT = maxDist;
    let found = false;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      const hy = b.hy * this.scaleY;
      const cyy = b.cy * this.scaleY;
      const r = slab(lox, loy, loz, ldx, dy, ldz, b.cx - b.hx, cyy - hy, b.cz - b.hz, b.cx + b.hx, cyy + hy, b.cz + b.hz);
      if (r && slabT < bestT) {
        bestT = slabT;
        found = true;
        out.t = slabT;
        out.tExit = slabTExit;
        out.part = b.part;
        out.name = b.name;
        // normal local → mundo
        out.nx = slabNx * cy + slabNz * sy;
        out.ny = slabNy;
        out.nz = -slabNx * sy + slabNz * cy;
      }
    }
    if (found) {
      out.x = ox + dx * out.t;
      out.y = oy + dy * out.t;
      out.z = oz + dz * out.t;
    }
    return found;
  }
}

let slabT = 0, slabTExit = 0, slabNx = 0, slabNy = 0, slabNz = 0;

function slab(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity;
  let nx = 0, ny = 0, nz = 0;
  if (Math.abs(dx) < 1e-12) {
    if (ox < x0 || ox > x1) return false;
  } else {
    let t1 = (x0 - ox) / dx, t2 = (x1 - ox) / dx;
    const nn = dx > 0 ? -1 : 1;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) { tmin = t1; nx = nn; ny = 0; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < y0 || oy > y1) return false;
  } else {
    let t1 = (y0 - oy) / dy, t2 = (y1 - oy) / dy;
    const nn = dy > 0 ? -1 : 1;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = nn; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < z0 || oz > z1) return false;
  } else {
    let t1 = (z0 - oz) / dz, t2 = (z1 - oz) / dz;
    const nn = dz > 0 ? -1 : 1;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = nn; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (tmax < 0) return false;
  slabT = tmin < 0 ? 0 : tmin;
  slabTExit = tmax;
  slabNx = nx; slabNy = ny; slabNz = nz;
  return true;
}

function rayVsAabb(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxDist) {
  if (!slab(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1)) return false;
  return slabT <= maxDist;
}
