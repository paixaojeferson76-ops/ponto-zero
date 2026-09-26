// Mundo físico estático: colliders + grid espacial 2D (XZ) + raycast + linha de visão.
import { BoxCollider } from './Colliders.js';

export class RayHit {
  constructor() {
    this.hit = false;
    this.t = 0;          // distância até a entrada
    this.tExit = 0;      // distância até a saída (espessura = tExit - t)
    this.nx = 0; this.ny = 1; this.nz = 0;
    this.inside = false;
    this.collider = null;
  }
  copyFrom(o) {
    this.hit = o.hit; this.t = o.t; this.tExit = o.tExit;
    this.nx = o.nx; this.ny = o.ny; this.nz = o.nz;
    this.inside = o.inside; this.collider = o.collider;
    return this;
  }
}

export class PhysicsWorld {
  constructor() {
    this.colliders = [];
    this.smokes = [];       // { x, y, z, radius } — só bloqueiam visão, não movimento
    this.cell = 4;
    this.cells = null;
    this.gw = 0; this.gh = 0;
    this.minX = 0; this.minZ = 0; this.maxX = 0; this.maxZ = 0;
    this._stamp = 0;
    this._scratch = [];
    this._tmp = new RayHit();
    this._rayTmp = { t: 0, tExit: 0, nx: 0, ny: 0, nz: 0, inside: false };
  }

  add(collider) {
    this.colliders.push(collider);
    this.cells = null;
    return collider;
  }

  addBox(minX, minY, minZ, maxX, maxY, maxZ, surface, tag) {
    return this.add(new BoxCollider(minX, minY, minZ, maxX, maxY, maxZ, surface, tag));
  }

  /** Constrói o grid espacial. Chamado automaticamente na primeira consulta. */
  build(cell = 4) {
    this.cell = cell;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const c of this.colliders) {
      if (c.minX < minX) minX = c.minX;
      if (c.minZ < minZ) minZ = c.minZ;
      if (c.maxX > maxX) maxX = c.maxX;
      if (c.maxZ > maxZ) maxZ = c.maxZ;
    }
    if (!isFinite(minX)) { minX = minZ = 0; maxX = maxZ = 1; }
    this.minX = minX; this.minZ = minZ; this.maxX = maxX; this.maxZ = maxZ;
    this.gw = Math.max(1, Math.ceil((maxX - minX) / cell));
    this.gh = Math.max(1, Math.ceil((maxZ - minZ) / cell));
    this.cells = Array.from({ length: this.gw * this.gh }, () => []);
    for (const c of this.colliders) {
      const cx0 = this._cx(c.minX), cx1 = this._cx(c.maxX);
      const cz0 = this._cz(c.minZ), cz1 = this._cz(c.maxZ);
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) this.cells[cz * this.gw + cx].push(c);
      }
    }
    return this;
  }

  _cx(x) { const i = Math.floor((x - this.minX) / this.cell); return i < 0 ? 0 : i >= this.gw ? this.gw - 1 : i; }
  _cz(z) { const i = Math.floor((z - this.minZ) / this.cell); return i < 0 ? 0 : i >= this.gh ? this.gh - 1 : i; }

  /** Colliders cujo grid-cell toca o retângulo. O array retornado é reutilizado — consuma imediatamente. */
  collect(x0, z0, x1, z1) {
    if (!this.cells) this.build(this.cell);
    const out = this._scratch;
    out.length = 0;
    const stamp = ++this._stamp;
    const cx0 = this._cx(x0), cx1 = this._cx(x1), cz0 = this._cz(z0), cz1 = this._cz(z1);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells[cz * this.gw + cx];
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c.stamp !== stamp) { c.stamp = stamp; out.push(c); }
        }
      }
    }
    return out;
  }

  /**
   * Raio contra o mundo estático (dir precisa estar normalizada).
   * @param {RayHit} [hit] objeto reutilizável
   * @returns {RayHit|null} hit.hit === true se acertou
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, hit = this._tmp) {
    if (!this.cells) this.build(this.cell);
    hit.hit = false;
    let bestT = maxDist;
    const tmp = this._rayTmp;
    const stamp = ++this._stamp;
    const cell = this.cell;

    // DDA 2D (Amanatides & Woo) sobre o grid XZ; t é distância 3D pois a direção é unitária.
    let cx = this._cx(ox), cz = this._cz(oz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const nextBx = this.minX + (dx > 0 ? cx + 1 : cx) * cell;
    const nextBz = this.minZ + (dz > 0 ? cz + 1 : cz) * cell;
    let tMaxX = adx < 1e-12 ? Infinity : (nextBx - ox) / dx;
    let tMaxZ = adz < 1e-12 ? Infinity : (nextBz - oz) / dz;
    const tDeltaX = adx < 1e-12 ? Infinity : cell / adx;
    const tDeltaZ = adz < 1e-12 ? Infinity : cell / adz;

    for (let guard = 0; guard < 4096; guard++) {
      const list = this.cells[cz * this.gw + cx];
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.stamp === stamp) continue;
        c.stamp = stamp;
        if (c.raycast(ox, oy, oz, dx, dy, dz, tmp) && tmp.t < bestT) {
          bestT = tmp.t;
          hit.hit = true;
          hit.t = tmp.t; hit.tExit = tmp.tExit;
          hit.nx = tmp.nx; hit.ny = tmp.ny; hit.nz = tmp.nz;
          hit.inside = tmp.inside; hit.collider = c;
        }
      }
      const tNext = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (tNext > bestT || tNext > maxDist) break;
      if (tMaxX < tMaxZ) {
        cx += stepX; tMaxX += tDeltaX;
        if (cx < 0 || cx >= this.gw) break;
      } else {
        cz += stepZ; tMaxZ += tDeltaZ;
        if (cz < 0 || cz >= this.gh) break;
      }
    }
    return hit.hit ? hit : null;
  }

  /** Há geometria sólida entre A e B? (ignora fumaça) */
  isBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 1e-3) !== null;
  }

  /** Alguma fumaça intercepta o segmento A→B? */
  smokeBlocks(ax, ay, az, bx, by, bz) {
    const smokes = this.smokes;
    if (!smokes.length) return false;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    for (let i = 0; i < smokes.length; i++) {
      const s = smokes[i];
      if (s.radius < 0.5) continue;
      let t = len2 > 0 ? ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - s.x, py = ay + dy * t - s.y, pz = az + dz * t - s.z;
      if (px * px + py * py + pz * pz < s.radius * s.radius * 0.72) return true;
    }
    return false;
  }

  /** Visão livre: nem geometria nem fumaça no caminho. */
  hasLineOfSight(ax, ay, az, bx, by, bz) {
    return !this.isBlocked(ax, ay, az, bx, by, bz) && !this.smokeBlocks(ax, ay, az, bx, by, bz);
  }

  pointInSolid(x, y, z) {
    const list = this.collect(x - 0.01, z - 0.01, x + 0.01, z + 0.01);
    for (let i = 0; i < list.length; i++) if (list[i].containsPoint(x, y, z)) return true;
    return false;
  }
}
