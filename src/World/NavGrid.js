// Malha de navegação gerada do mundo físico (equivalente a um navmesh): grid de 0,5 m com múltiplas
// camadas de altura (plataformas), arestas validadas por varredura do hull, A* e suavização de caminho.
import { MOVEMENT, PLAYER } from '../Config/Tuning.js';
import { resolveHull, supportBelow } from '../Physics/CharacterBody.js';

const BLOCKED_LIMIT = -1e8;
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

class MinHeap {
  constructor() { this.ids = []; this.keys = []; }
  get size() { return this.ids.length; }
  clear() { this.ids.length = 0; this.keys.length = 0; }
  push(id, key) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop() {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop(), lastKey = keys.pop();
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c]; keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}

export class NavGrid {
  /**
   * @param {import('../Physics/PhysicsWorld.js').PhysicsWorld} world
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
   * @param {{res?:number, nodeRadius?:number, sweepRadius?:number, height?:number}} [opts]
   */
  constructor(world, bounds, opts = {}) {
    this.world = world;
    this.bounds = bounds;
    this.res = opts.res ?? 0.5;
    this.nodeRadius = opts.nodeRadius ?? 0.5;
    this.sweepRadius = opts.sweepRadius ?? 0.46;
    this.height = opts.height ?? PLAYER.HEIGHT_STAND;
    this.stepH = MOVEMENT.STEP_HEIGHT;
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / this.res);
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / this.res);
    this.count = 0;
    this.px = null; this.py = null; this.pz = null;
    this.cellOf = null;       // nó → índice de célula
    this.cellStart = null;    // CSR: cell → início em cellNodes
    this.cellNodes = null;
    this.adj = null;
    this.adjCost = null;
    this.clearance = null;
    this.reachable = null;
    this._g = null; this._parent = null; this._stamp = null; this._closed = null;
    this._curStamp = 0;
    this._heap = new MinHeap();
  }

  // ------------------------------------------------------------------ construção

  build(seeds = []) {
    const { nx, nz, res } = this;
    const { minX, minZ } = this.bounds;
    const xs = [], ys = [], zs = [], cells = [];
    const perCell = new Array(nx * nz);
    const r = this.nodeRadius;
    const h = this.height;

    for (let cz = 0; cz < nz; cz++) {
      for (let cx = 0; cx < nx; cx++) {
        const x = minX + (cx + 0.5) * res, z = minZ + (cz + 0.5) * res;
        const list = this.world.collect(x - r, z - r, x + r, z + r);
        const cand = [];
        for (let i = 0; i < list.length; i++) {
          const top = list[i].maxTopOver(x - r, x + r, z - r, z + r);
          if (top > -0.5 && top < 3.2) cand.push(top);   // só alturas caminháveis (plataformas ≤ 2,6 m)
        }
        cand.sort((a, b) => a - b);
        let prev = -99;
        const here = [];
        for (const y of cand) {
          if (y - prev < 0.05) continue;
          prev = y;
          const ny = resolveHull(this.world, x, y, z, r, h, false, 0);
          if (ny < BLOCKED_LIMIT || Math.abs(ny - y) > 1e-6) continue;
          const id = xs.length;
          xs.push(x); ys.push(y); zs.push(z); cells.push(cz * nx + cx);
          here.push(id);
        }
        if (here.length) perCell[cz * nx + cx] = here;
      }
    }

    this.count = xs.length;
    this.px = Float32Array.from(xs);
    this.py = Float32Array.from(ys);
    this.pz = Float32Array.from(zs);
    this.cellOf = Int32Array.from(cells);

    // CSR célula → nós
    this.cellStart = new Int32Array(nx * nz + 1);
    for (let c = 0; c < nx * nz; c++) this.cellStart[c + 1] = this.cellStart[c] + (perCell[c] ? perCell[c].length : 0);
    this.cellNodes = new Int32Array(this.count);
    for (let c = 0; c < nx * nz; c++) if (perCell[c]) this.cellNodes.set(perCell[c], this.cellStart[c]);

    // Arestas
    this.adj = new Int32Array(this.count * 8).fill(-1);
    this.adjCost = new Float32Array(this.count * 8);
    for (let n = 0; n < this.count; n++) {
      const c = this.cellOf[n];
      const cx = c % nx, cz = (c / nx) | 0;
      for (let d = 0; d < 8; d++) {
        const ncx = cx + DIRS[d][0], ncz = cz + DIRS[d][1];
        if (ncx < 0 || ncz < 0 || ncx >= nx || ncz >= nz) continue;
        const nc = ncz * nx + ncx;
        let best = -1, bestDy = Infinity;
        for (let k = this.cellStart[nc]; k < this.cellStart[nc + 1]; k++) {
          const m = this.cellNodes[k];
          const dy = Math.abs(this.py[m] - this.py[n]);
          if (dy <= this.stepH + 0.02 && dy < bestDy) { best = m; bestDy = dy; }
        }
        if (best < 0) continue;
        if (!this._edgeWalkable(n, best)) continue;
        this.adj[n * 8 + d] = best;
      }
    }

    this._computeClearance();
    for (let n = 0; n < this.count; n++) {
      for (let d = 0; d < 8; d++) {
        const m = this.adj[n * 8 + d];
        if (m < 0) continue;
        const dist = Math.hypot(this.px[m] - this.px[n], this.py[m] - this.py[n], this.pz[m] - this.pz[n]);
        const cl = Math.min(this.clearance[n], this.clearance[m]);
        const penalty = cl < 0.75 ? 0.9 : cl < 1.25 ? 0.35 : 0;
        this.adjCost[n * 8 + d] = dist * (1 + penalty);
      }
    }

    // Alcançabilidade a partir das sementes (spawns/sítios)
    this.reachable = null;                       // nearestNode não filtra enquanto a inundação roda
    const reach = new Uint8Array(this.count);
    const stack = [];
    for (const s of seeds) {
      const id = this.nearestNode(s.x, s.y ?? 0, s.z, 3);
      if (id >= 0 && !reach[id]) { reach[id] = 1; stack.push(id); }
    }
    while (stack.length) {
      const n = stack.pop();
      for (let d = 0; d < 8; d++) {
        const m = this.adj[n * 8 + d];
        if (m >= 0 && !reach[m]) { reach[m] = 1; stack.push(m); }
      }
    }
    if (seeds.length === 0) reach.fill(1);
    this.reachable = reach;

    this._g = new Float32Array(this.count);
    this._parent = new Int32Array(this.count);
    this._stamp = new Uint32Array(this.count);
    this._closed = new Uint32Array(this.count);
    return this;
  }

  _edgeWalkable(a, b) {
    // Nós vizinhos na mesma altura, ambos com hull livre (raio > meia distância): o trecho entre eles está
    // dentro da união dos dois hulls, logo é livre — dispensa a varredura.
    if (Math.abs(this.py[a] - this.py[b]) < 0.005) return true;
    return this.walkLine(this.px[a], this.py[a], this.pz[a], this.px[b], this.pz[b], this.py[b], this.stepH);
  }

  /**
   * O hull consegue ir em linha reta de (ax,ay,az) até (bx,bz), terminando em ~by?
   */
  walkLine(ax, ay, az, bx, bz, by, tolerance = 0.2) {
    const dx = bx - ax, dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 0.12));
    let y = ay;
    const r = this.sweepRadius, h = this.height;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + dx * t, z = az + dz * t;
      const ny = resolveHull(this.world, x, y, z, r, h, true, this.stepH);
      if (ny < BLOCKED_LIMIT) return false;
      y = ny;
      const s = supportBelow(this.world, x, y, z, r, this.stepH);
      if (s.top === -Infinity) return false;
      y = s.top;
    }
    return Math.abs(y - by) <= tolerance;
  }

  _computeClearance() {
    // Distância (em células, máx. 4) até a célula "não navegável" mais próxima → penaliza rotas coladas em parede.
    const { nx, nz } = this;
    const has = new Uint8Array(nx * nz);
    for (let c = 0; c < nx * nz; c++) has[c] = this.cellStart[c + 1] > this.cellStart[c] ? 1 : 0;
    this.clearance = new Float32Array(this.count);
    for (let n = 0; n < this.count; n++) {
      const c = this.cellOf[n];
      const cx = c % nx, cz = (c / nx) | 0;
      let best = 4;
      for (let dz = -3; dz <= 3 && best > 1; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= nx || z >= nz || !has[z * nx + x]) {
            const d = Math.hypot(dx, dz);
            if (d < best) best = d;
          }
        }
      }
      this.clearance[n] = best * this.res;
    }
  }

  // ------------------------------------------------------------------ consultas

  cellIndex(x, z) {
    const cx = Math.floor((x - this.bounds.minX) / this.res);
    const cz = Math.floor((z - this.bounds.minZ) / this.res);
    if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return -1;
    return cz * this.nx + cx;
  }

  /** Nó mais próximo (por distância horizontal, desempate por altura) dentro de `maxDist` metros. */
  nearestNode(x, y, z, maxDist = 4) {
    const cell = this.cellIndex(x, z);
    const ring = Math.ceil(maxDist / this.res);
    const cx0 = Math.floor((x - this.bounds.minX) / this.res);
    const cz0 = Math.floor((z - this.bounds.minZ) / this.res);
    let best = -1, bestScore = Infinity;
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        const cx = cx0 + dx, cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
        const c = cz * this.nx + cx;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const n = this.cellNodes[k];
          if (this.reachable && !this.reachable[n]) continue;
          const h = Math.hypot(this.px[n] - x, this.pz[n] - z);
          const v = Math.abs(this.py[n] - y);
          if (h > maxDist || v > 1.6) continue;
          const score = h + v * 2;
          if (score < bestScore) { bestScore = score; best = n; }
        }
      }
    }
    void cell;
    return best;
  }

  /** Nós dentro de um raio horizontal (para busca de cobertura). Preenche `out`. */
  nodesInRadius(x, z, radius, out, stride = 1) {
    out.length = 0;
    const ring = Math.ceil(radius / this.res);
    const cx0 = Math.floor((x - this.bounds.minX) / this.res);
    const cz0 = Math.floor((z - this.bounds.minZ) / this.res);
    for (let dz = -ring; dz <= ring; dz += stride) {
      for (let dx = -ring; dx <= ring; dx += stride) {
        const cx = cx0 + dx, cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
        const c = cz * this.nx + cx;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const n = this.cellNodes[k];
          if (!this.reachable[n]) continue;
          if (Math.hypot(this.px[n] - x, this.pz[n] - z) <= radius) out.push(n);
        }
      }
    }
    return out;
  }

  /**
   * A* + suavização.
   * @param {{avoid?: Array<{x:number,z:number,r:number,cost:number}>, maxExpand?: number, smooth?: boolean}} [opts]
   * @returns {Array<{x:number,y:number,z:number}>|null}
   */
  findPath(sx, sy, sz, gx, gy, gz, opts = {}) {
    const start = this.nearestNode(sx, sy, sz, 3);
    const goal = this.nearestNode(gx, gy, gz, 4);
    if (start < 0 || goal < 0) return null;
    const raw = this._astar(start, goal, opts);
    if (!raw) return null;
    const pts = opts.smooth === false ? raw.map((n) => this._pt(n)) : this._smooth(raw);
    return pts;
  }

  _pt(n) {
    return { x: this.px[n], y: this.py[n], z: this.pz[n] };
  }

  _astar(start, goal, opts) {
    const stamp = ++this._curStamp;
    const g = this._g, parent = this._parent, seen = this._stamp, closed = this._closed;
    const heap = this._heap;
    heap.clear();
    const gx = this.px[goal], gy = this.py[goal], gz = this.pz[goal];
    const avoid = opts.avoid || null;
    const maxExpand = opts.maxExpand ?? 60000;
    g[start] = 0; parent[start] = -1; seen[start] = stamp;
    heap.push(start, Math.hypot(this.px[start] - gx, this.pz[start] - gz));
    let expanded = 0;
    while (heap.size) {
      const n = heap.pop();
      if (closed[n] === stamp) continue;
      closed[n] = stamp;
      if (n === goal) break;
      if (++expanded > maxExpand) return null;
      for (let d = 0; d < 8; d++) {
        const m = this.adj[n * 8 + d];
        if (m < 0 || !this.reachable[m] || closed[m] === stamp) continue;
        let cost = this.adjCost[n * 8 + d];
        if (avoid) {
          for (let a = 0; a < avoid.length; a++) {
            const av = avoid[a];
            const dd = Math.hypot(this.px[m] - av.x, this.pz[m] - av.z);
            if (dd < av.r) cost += av.cost * (1 - dd / av.r);
          }
        }
        const ng = g[n] + cost;
        if (seen[m] !== stamp || ng < g[m]) {
          seen[m] = stamp;
          g[m] = ng;
          parent[m] = n;
          heap.push(m, ng + Math.hypot(this.px[m] - gx, this.py[m] - gy, this.pz[m] - gz));
        }
      }
    }
    if (closed[goal] !== stamp) return null;
    const path = [];
    for (let n = goal; n !== -1; n = parent[n]) path.push(n);
    path.reverse();
    return path;
  }

  /** Puxa o caminho: pula nós intermediários quando o hull consegue andar em linha reta. */
  _smooth(nodes) {
    if (nodes.length <= 2) return nodes.map((n) => this._pt(n));
    const out = [this._pt(nodes[0])];
    let i = 0;
    const MAX_AHEAD = 18;
    while (i < nodes.length - 1) {
      let j = Math.min(nodes.length - 1, i + MAX_AHEAD);
      for (; j > i + 1; j--) {
        if (this.walkLine(this.px[nodes[i]], this.py[nodes[i]], this.pz[nodes[i]], this.px[nodes[j]], this.pz[nodes[j]], this.py[nodes[j]], 0.06)) break;
      }
      out.push(this._pt(nodes[j]));
      i = j;
    }
    return out;
  }

  pathLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    return len;
  }
}
