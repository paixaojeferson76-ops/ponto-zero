// Converte a definição de um mapa (dados) em colliders + mundo físico.
// Paredes: rasteriza os retângulos "abertos" (carve); tudo que não é aberto vira parede, mesclada em caixas.
import { BoxCollider, RampCollider } from '../Physics/Colliders.js';
import { PhysicsWorld } from '../Physics/PhysicsWorld.js';

// Superfície física padrão por tag visual.
const TAG_SURFACE = {
  wall: 'concrete', roof: 'concrete', floor: 'floor', pillar: 'concrete', lowwall: 'concrete',
  crate: 'wood', workbench: 'wood', barrel: 'metal', container_red: 'metal', container_blue: 'metal',
  catwalk: 'metal', console: 'metal', pipe: 'metal', rail: 'thin', stairs: 'concrete',
};

export function surfaceForTag(tag, override) {
  return override || TAG_SURFACE[tag] || 'concrete';
}

/** Raster de células abertas (true = aberto). */
export function rasterizeOpen(def) {
  const { minX, maxX, minZ, maxZ } = def.bounds;
  const res = def.raster;
  const nx = Math.round((maxX - minX) / res);
  const nz = Math.round((maxZ - minZ) / res);
  const open = new Uint8Array(nx * nz);
  for (const rect of Object.values(def.carve)) {
    const [x0, z0, x1, z1] = rect;
    const cx0 = Math.max(0, Math.round((x0 - minX) / res));
    const cx1 = Math.min(nx, Math.round((x1 - minX) / res));
    const cz0 = Math.max(0, Math.round((z0 - minZ) / res));
    const cz1 = Math.min(nz, Math.round((z1 - minZ) / res));
    for (let cz = cz0; cz < cz1; cz++) for (let cx = cx0; cx < cx1; cx++) open[cz * nx + cx] = 1;
  }
  return { open, nx, nz, res, minX, minZ };
}

/** Mescla células sólidas em retângulos: [x0,z0,x1,z1] em metros. */
export function mergeSolidCells(raster) {
  const { open, nx, nz, res, minX, minZ } = raster;
  const rects = [];
  let active = new Map();       // "cx0-cx1" → { cx0, cx1, cz0, cz1 }
  for (let cz = 0; cz <= nz; cz++) {
    const seen = new Set();
    if (cz < nz) {
      let cx = 0;
      while (cx < nx) {
        if (open[cz * nx + cx]) { cx++; continue; }
        const start = cx;
        while (cx < nx && !open[cz * nx + cx]) cx++;
        const key = `${start}-${cx}`;
        seen.add(key);
        const prev = active.get(key);
        if (prev) prev.cz1 = cz + 1;
        else active.set(key, { cx0: start, cx1: cx, cz0: cz, cz1: cz + 1 });
      }
    }
    for (const [key, r] of active) {
      if (!seen.has(key)) {
        rects.push([minX + r.cx0 * res, minZ + r.cz0 * res, minX + r.cx1 * res, minZ + r.cz1 * res]);
        active.delete(key);
      }
    }
  }
  return rects;
}

function addStairs(world, out, p) {
  const [, x0, z0, x1, z1, h, dir, steps, tag] = p;
  const alongX = dir[1] === 'x';
  const sign = dir[0] === '+' ? 1 : -1;
  const len = alongX ? x1 - x0 : z1 - z0;
  const run = len / steps;
  for (let i = 0; i < steps; i++) {
    const a = sign > 0 ? i * run : len - (i + 1) * run;
    const b = a + run;
    const top = (h * (i + 1)) / steps;
    const c = alongX
      ? new BoxCollider(x0 + a, 0, z0, x0 + b, top, z1, surfaceForTag(tag), tag)
      : new BoxCollider(x0, 0, z0 + a, x1, top, z0 + b, surfaceForTag(tag), tag);
    c.stair = true;
    out.push(world.add(c));
  }
}

/**
 * @returns {{world: PhysicsWorld, colliders: BoxCollider[], def: object}}
 */
export function buildMap(def) {
  const world = new PhysicsWorld();
  const solids = [];
  const { minX, maxX, minZ, maxZ } = def.bounds;

  solids.push(world.add(new BoxCollider(minX - 2, -1, minZ - 2, maxX + 2, 0, maxZ + 2, 'floor', 'floor')));

  const raster = rasterizeOpen(def);
  for (const [x0, z0, x1, z1] of mergeSolidCells(raster)) {
    solids.push(world.add(new BoxCollider(x0, 0, z0, x1, def.wallHeight, z1, 'concrete', 'wall')));
  }

  for (const [x0, z0, x1, z1] of def.roofs || []) {
    solids.push(world.add(new BoxCollider(x0, def.roofY, z0, x1, def.roofY + def.roofThickness, z1, 'concrete', 'roof')));
  }

  for (const p of def.props) {
    const kind = p[0];
    if (kind === 'box') {
      const [, x0, z0, x1, z1, h, tag, surface, y0 = 0] = p;
      solids.push(world.add(new BoxCollider(x0, y0, z0, x1, y0 + h, z1, surfaceForTag(tag, surface), tag)));
    } else if (kind === 'ramp') {
      const [, x0, z0, x1, z1, h, dir, tag] = p;
      solids.push(world.add(new RampCollider(x0, 0, z0, x1, h, z1, dir, surfaceForTag(tag), tag)));
    } else if (kind === 'stairs') {
      addStairs(world, solids, p);
    } else {
      throw new Error(`Prop desconhecido: ${kind}`);
    }
  }

  world.build(4);
  return { world, solids, def, raster };
}

/** Desenho ASCII (debug): '#' parede, '.' aberto, 'o' prop, 'A'/'B' sítios, 's' spawns. */
export function asciiMap(map, step = 1) {
  const { def, raster, world } = map;
  const { nx, nz, res, minX, minZ, open } = raster;
  const lines = [];
  for (let cz = 0; cz < nz; cz += 2 * step) {
    let line = '';
    for (let cx = 0; cx < nx; cx += step) {
      const x = minX + (cx + 0.5) * res, z = minZ + (cz + 0.5) * res;
      let ch = open[cz * nx + cx] ? '.' : '#';
      if (open[cz * nx + cx]) {
        const list = world.collect(x - 0.01, z - 0.01, x + 0.01, z + 0.01);
        for (const c of list) {
          if (c.tag !== 'floor' && c.tag !== 'wall' && c.tag !== 'roof' && c.topAt(x, z) > 0.05) { ch = c.topAt(x, z) > 2 ? 'H' : 'o'; break; }
        }
      }
      lines.push;
      line += ch;
    }
    lines.push(line);
  }
  return lines.join('\n');
}
