// Colliders estáticos do mundo: caixa (AABB) e rampa (cunha com topo inclinado analítico).
// Todo collider expõe o mesmo contrato, usado por movimento, raycast e navegação:
//   overlapsXZ(x0,x1,z0,z1)     — sobreposição estrita no plano horizontal
//   maxTopOver(x0,x1,z0,z1)     — maior altura do topo dentro do retângulo (-Infinity se não sobrepõe)
//   raycast(o, d, out)          — interseção com raio; preenche t, tExit, n, inside
import { MOVEMENT } from '../Config/Tuning.js';

export const EPS = 1e-4;
let nextId = 1;

export class BoxCollider {
  constructor(minX, minY, minZ, maxX, maxY, maxZ, surface = 'concrete', tag = '') {
    this.id = nextId++;
    this.kind = 'box';
    this.minX = minX; this.minY = minY; this.minZ = minZ;
    this.maxX = maxX; this.maxY = maxY; this.maxZ = maxZ;
    this.surface = surface;
    this.tag = tag;
    this.walkable = true;
    this.stamp = 0;
  }

  overlapsXZ(x0, x1, z0, z1) {
    return x1 > this.minX + EPS && x0 < this.maxX - EPS && z1 > this.minZ + EPS && z0 < this.maxZ - EPS;
  }

  maxTopOver(x0, x1, z0, z1) {
    return this.overlapsXZ(x0, x1, z0, z1) ? this.maxY : -Infinity;
  }

  topAt(x, z) {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ ? this.maxY : -Infinity;
  }

  containsPoint(x, y, z) {
    return x > this.minX && x < this.maxX && y > this.minY && y < this.maxY && z > this.minZ && z < this.maxZ
      && y <= this.topAt(x, z);
  }

  /** Teste de slab. Preenche out.{t,tExit,nx,ny,nz,inside}. Retorna false se não acerta à frente da origem. */
  raycast(ox, oy, oz, dx, dy, dz, out) {
    let tmin = -Infinity;
    let tmax = Infinity;
    let nx = 0, ny = 0, nz = 0;

    if (Math.abs(dx) < 1e-12) {
      if (ox < this.minX || ox > this.maxX) return false;
    } else {
      const inv = 1 / dx;
      let t1 = (this.minX - ox) * inv;
      let t2 = (this.maxX - ox) * inv;
      const nn = dx > 0 ? -1 : 1;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) { tmin = t1; nx = nn; ny = 0; nz = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (Math.abs(dy) < 1e-12) {
      if (oy < this.minY || oy > this.maxY) return false;
    } else {
      const inv = 1 / dy;
      let t1 = (this.minY - oy) * inv;
      let t2 = (this.maxY - oy) * inv;
      const nn = dy > 0 ? -1 : 1;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) { tmin = t1; nx = 0; ny = nn; nz = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (Math.abs(dz) < 1e-12) {
      if (oz < this.minZ || oz > this.maxZ) return false;
    } else {
      const inv = 1 / dz;
      let t1 = (this.minZ - oz) * inv;
      let t2 = (this.maxZ - oz) * inv;
      const nn = dz > 0 ? -1 : 1;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = nn; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    return this._finishRay(tmin, tmax, nx, ny, nz, dx, dy, dz, out);
  }

  _finishRay(tmin, tmax, nx, ny, nz, dx, dy, dz, out) {
    if (tmax < 0) return false;
    if (tmin < 0) {
      out.inside = true;
      out.t = 0;
      out.nx = -dx; out.ny = -dy; out.nz = -dz;
    } else {
      out.inside = false;
      out.t = tmin;
      out.nx = nx; out.ny = ny; out.nz = nz;
    }
    out.tExit = tmax;
    return true;
  }
}

export class RampCollider extends BoxCollider {
  /**
   * @param {'+x'|'-x'|'+z'|'-z'} dir direção em que a rampa SOBE
   * @param {number} lowRise altura do "lábio" na borda baixa (normalmente 0)
   */
  constructor(minX, minY, minZ, maxX, maxY, maxZ, dir, surface = 'concrete', tag = '', lowRise = 0) {
    super(minX, minY, minZ, maxX, maxY, maxZ, surface, tag);
    this.kind = 'ramp';
    this.dir = dir;
    this.axis = dir[1];
    this.sign = dir[0] === '+' ? 1 : -1;
    const alongX = this.axis === 'x';
    this.length = alongX ? maxX - minX : maxZ - minZ;
    this.lowEdge = alongX ? (this.sign > 0 ? minX : maxX) : (this.sign > 0 ? minZ : maxZ);
    this.c0 = minY + lowRise;
    this.slope = (maxY - minY - lowRise) / this.length;
    this.slopeDeg = Math.atan(this.slope) * 180 / Math.PI;
    this.walkable = this.slopeDeg <= MOVEMENT.MAX_SLOPE_DEG;
    const inv = 1 / Math.hypot(this.slope, 1);
    this.surfNormalAxis = -this.slope * this.sign * inv;
    this.surfNormalY = inv;
  }

  _heightAtCoord(c) {
    let u = this.sign * (c - this.lowEdge);
    if (u < 0) u = 0; else if (u > this.length) u = this.length;
    return this.c0 + this.slope * u;
  }

  topAt(x, z) {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return -Infinity;
    return this._heightAtCoord(this.axis === 'x' ? x : z);
  }

  maxTopOver(x0, x1, z0, z1) {
    if (!this.overlapsXZ(x0, x1, z0, z1)) return -Infinity;
    if (this.axis === 'x') {
      const ix0 = Math.max(x0, this.minX), ix1 = Math.min(x1, this.maxX);
      return this._heightAtCoord(this.sign > 0 ? ix1 : ix0);
    }
    const iz0 = Math.max(z0, this.minZ), iz1 = Math.min(z1, this.maxZ);
    return this._heightAtCoord(this.sign > 0 ? iz1 : iz0);
  }

  containsPoint(x, y, z) {
    return x > this.minX && x < this.maxX && y > this.minY && z > this.minZ && z < this.maxZ && y <= this.topAt(x, z);
  }

  raycast(ox, oy, oz, dx, dy, dz, out) {
    // Reaproveita o slab da caixa e recorta com o plano do topo.
    if (!super.raycast(ox, oy, oz, dx, dy, dz, out)) return false;
    let tmin = out.inside ? -Infinity : out.t;
    let tmax = out.tExit;
    let nx = out.nx, ny = out.ny, nz = out.nz;

    const alongX = this.axis === 'x';
    const oc = alongX ? ox : oz;
    const dc = alongX ? dx : dz;
    const f0 = oy - this.c0 - this.slope * this.sign * (oc - this.lowEdge);
    const f1 = dy - this.slope * this.sign * dc;

    if (Math.abs(f1) < 1e-12) {
      if (f0 > 0) return false;
    } else {
      const tp = -f0 / f1;
      if (f1 > 0) {
        if (tp < tmin) return false;
        if (tp < tmax) tmax = tp;
      } else {
        if (tp > tmax) return false;
        if (tp > tmin) {
          tmin = tp;
          nx = alongX ? this.surfNormalAxis : 0;
          ny = this.surfNormalY;
          nz = alongX ? 0 : this.surfNormalAxis;
        }
      }
    }
    if (tmin > tmax) return false;
    return this._finishRay(tmin, tmax, nx, ny, nz, dx, dy, dz, out);
  }
}
