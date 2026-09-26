// Constrói as malhas do mapa a partir dos colliders: geometria em lote por (material × chunk de 16 m)
// para culling eficiente, UVs em coordenadas de mundo (textura consistente), chão com AO pré-calculado.
import * as THREE from 'three';
import { MaterialLibrary } from './Materials.js';

const CHUNK = 16;

class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }

  _vert(x, y, z, n, u, v) {
    this.pos.push(x, y, z);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  /** Quad CCW visto de fora. uvFn(x,y,z) → [u,v]. */
  quad(a, b, c, d, n, uvFn) {
    const i0 = this._vert(a[0], a[1], a[2], n, ...uvFn(a));
    const i1 = this._vert(b[0], b[1], b[2], n, ...uvFn(b));
    const i2 = this._vert(c[0], c[1], c[2], n, ...uvFn(c));
    const i3 = this._vert(d[0], d[1], d[2], n, ...uvFn(d));
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /** Triângulo com normal de referência (corrige o enrolamento se necessário). */
  tri(a, b, c, hint, uvFn) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { const t = b; b = c; c = t; }
    const i0 = this._vert(a[0], a[1], a[2], hint, ...uvFn(a));
    const i1 = this._vert(b[0], b[1], b[2], hint, ...uvFn(b));
    const i2 = this._vert(c[0], c[1], c[2], hint, ...uvFn(c));
    this.idx.push(i0, i1, i2);
  }

  append(geo, tx, ty, tz) {
    const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i) + tx, p.getY(i) + ty, p.getZ(i) + tz);
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.uv.push(u.getX(i), u.getY(i));
    }
    const index = geo.index;
    for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx.length > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function boxFaces(gb, c, sc, tag) {
  const { minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1 } = c;
  const uvX = (p) => [p[2] * sc, p[1] * sc];      // faces ±X → (z, y)
  const uvZ = (p) => [p[0] * sc, p[1] * sc];      // faces ±Z → (x, y)
  const uvY = (p) => [p[0] * sc, p[2] * sc];      // faces ±Y → (x, z)
  const skipTop = tag === 'wall' || tag === 'roof';
  const skipBottom = tag !== 'roof' && c.minY < 0.01;
  gb.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uvX);
  gb.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uvX);
  gb.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uvZ);
  gb.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uvZ);
  if (!skipTop) gb.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], uvY);
  if (!skipBottom) gb.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], uvY);
}

function rampFaces(gb, c, sc) {
  const { minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1 } = c;
  const uv = (p) => [(p[0] + p[2]) * sc, p[1] * sc];
  const along = c.axis === 'x';
  const P = (u, v, h) => (along
    ? [c.sign > 0 ? x0 + u : x1 - u, h, z0 + v]
    : [x0 + v, h, c.sign > 0 ? z0 + u : z1 - u]);
  const len = c.length;
  const wid = along ? z1 - z0 : x1 - x0;
  const yl = c.c0;
  // topo inclinado
  gb.tri(P(0, 0, yl), P(len, 0, y1), P(len, wid, y1), [c.surfNormalAxis * (along ? 1 : 0), c.surfNormalY, c.surfNormalAxis * (along ? 0 : 1)], uv);
  gb.tri(P(0, 0, yl), P(len, wid, y1), P(0, wid, yl), [c.surfNormalAxis * (along ? 1 : 0), c.surfNormalY, c.surfNormalAxis * (along ? 0 : 1)], uv);
  // faces laterais (triângulos)
  const sideN = along ? [0, 0, -1] : [-1, 0, 0];
  gb.tri(P(0, 0, y0), P(len, 0, y0), P(len, 0, y1), sideN, uv);
  const sideP = along ? [0, 0, 1] : [1, 0, 0];
  gb.tri(P(0, wid, y0), P(len, wid, y0), P(len, wid, y1), sideP, uv);
  // face alta (vertical)
  const hi = along ? [c.sign, 0, 0] : [0, 0, c.sign];
  gb.tri(P(len, 0, y0), P(len, wid, y0), P(len, wid, y1), hi, uv);
  gb.tri(P(len, 0, y0), P(len, wid, y1), P(len, 0, y1), hi, uv);
}

export class MapRenderer {
  /**
   * @param {{solids:object[], def:object, raster:object}} mapData resultado de buildMap()
   * @param {MaterialLibrary} materials
   */
  constructor(mapData, materials) {
    this.mapData = mapData;
    this.materials = materials;
    this.group = new THREE.Group();
    this.group.name = 'map';
    this.meshes = [];
    this._geos = [];
    this._build();
  }

  _build() {
    const { solids, def } = this.mapData;
    const batches = new Map();
    for (const c of solids) {
      if (c.tag === 'floor') continue;
      const tag = c.tag || 'wall';
      const key = `${tag}|${Math.floor((c.minX + c.maxX) / 2 / CHUNK)}|${Math.floor((c.minZ + c.maxZ) / 2 / CHUNK)}`;
      let b = batches.get(key);
      if (!b) batches.set(key, (b = { tag, gb: new GeoBuilder() }));
      const sc = 1 / this.materials.sizeOf(tag);
      if (c.kind === 'ramp') rampFaces(b.gb, c, sc);
      else if (tag === 'barrel') {
        const w = (c.maxX - c.minX) / 2, h = c.maxY - c.minY;
        const geo = new THREE.CylinderGeometry(w * 0.96, w * 0.96, h, 12);
        b.gb.append(geo, (c.minX + c.maxX) / 2, c.minY + h / 2, (c.minZ + c.maxZ) / 2);
        geo.dispose();
      } else boxFaces(b.gb, c, sc, tag);
    }
    for (const { tag, gb } of batches.values()) {
      const geo = gb.build();
      this._geos.push(geo);
      const mesh = new THREE.Mesh(geo, this.materials.get(tag));
      mesh.castShadow = true;
      mesh.receiveShadow = tag !== 'rail';
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    this._buildFloor(def);
    this._buildFixtures(def);
    this._buildFloorMarks(def);
  }

  _buildFloor(def) {
    const { minX, maxX, minZ, maxZ } = def.bounds;
    const w = maxX - minX, h = maxZ - minZ;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const sc = 1 / this.materials.sizeOf('floor');
    const uv1 = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) * sc, pos.getZ(i) * sc);
      uv1[i * 2] = (pos.getX(i) - minX) / w;
      uv1[i * 2 + 1] = (pos.getZ(i) - minZ) / h;
    }
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    const mat = this.materials.get('floor').clone();
    this.aoTexture = this._makeAOTexture();
    mat.aoMap = this.aoTexture;
    mat.aoMapIntensity = 1.0;
    this.floorMaterial = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this._geos.push(geo);
    this.group.add(mesh);
    this.meshes.push(mesh);
  }

  /** AO do chão: escurece perto das paredes (mapa de sólidos borrado). */
  _makeAOTexture() {
    const { raster } = this.mapData;
    const { open, nx, nz } = raster;
    const w = 512, h = Math.round((512 * nz) / nx);
    const mask = document.createElement('canvas');
    mask.width = nx; mask.height = nz;
    const mctx = mask.getContext('2d');
    const img = mctx.createImageData(nx, nz);
    for (let i = 0; i < nx * nz; i++) {
      const v = open[i] ? 255 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const octx = out.getContext('2d');
    octx.fillStyle = '#000'; octx.fillRect(0, 0, w, h);
    octx.filter = 'blur(7px)';
    octx.imageSmoothingEnabled = true;
    octx.drawImage(mask, 0, 0, w, h);
    octx.filter = 'none';
    // realça o contraste: perto de parede fica ~0.45, longe 1.0
    const d = octx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.min(255, 105 + d.data[i] * 0.6);
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    }
    octx.putImageData(d, 0, 0);
    const t = new THREE.CanvasTexture(out);
    t.channel = 1;
    return t;
  }

  _buildFixtures(def) {
    const geo = new THREE.BoxGeometry(1.8, 0.08, 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff1cf });
    this._geos.push(geo);
    this._fixtureMat = mat;
    for (const [x, y, z] of def.lights) {
      if (y < 3.2) continue;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, def.roofY - 0.06, z);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.group.add(m);
    }
  }

  _buildFloorMarks(def) {
    this._markMats = [];
    for (const mk of def.floorMarks || []) {
      const tex = MaterialLibrary.siteMark(mk.text);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const geo = new THREE.PlaneGeometry(mk.size, mk.size);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(mk.x, 0.015, mk.z);
      mesh.renderOrder = 1;
      this._geos.push(geo);
      this._markMats.push(mat, tex);
      this.group.add(mesh);
    }
  }

  setShadows(enabled) {
    for (const m of this.meshes) m.castShadow = enabled;
  }

  dispose() {
    for (const g of this._geos) g.dispose();
    if (this.floorMaterial) this.floorMaterial.dispose();
    if (this.aoTexture) this.aoTexture.dispose();
    if (this._fixtureMat) this._fixtureMat.dispose();
    for (const m of this._markMats) m.dispose();
  }
}
