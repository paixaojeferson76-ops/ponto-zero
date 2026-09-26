// Utilitários de geometria: funde caixas/meshes em UMA geometria com cores por vértice
// (menos draw calls por personagem e por arma).
import * as THREE from 'three';

/** specs: [{w,h,d,color,x,y,z}] → BufferGeometry com atributo `color`. */
export function mergeBoxSpecs(specs) {
  const pos = [], nor = [], col = [], idx = [];
  const c = new THREE.Color();
  for (const s of specs) {
    const g = new THREE.BoxGeometry(s.w, s.h, s.d);
    g.translate(s.x || 0, s.y || 0, s.z || 0);
    c.set(s.color);
    const p = g.attributes.position, n = g.attributes.normal, base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/** Funde todos os meshes de um grupo (com suas transformações locais) em uma geometria colorida. */
export function bakeGroup(root, skip = null) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pos = [], nor = [], col = [], idx = [];
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || (skip && skip(o))) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    nm.getNormalMatrix(m);
    const g = o.geometry;
    const p = g.attributes.position, n = g.attributes.normal, base = pos.length / 3;
    const color = o.material.color || new THREE.Color(0xffffff);
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nm).normalize();
      nor.push(v.x, v.y, v.z);
      col.push(color.r, color.g, color.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
