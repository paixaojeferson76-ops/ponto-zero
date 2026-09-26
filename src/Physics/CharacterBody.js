// Corpo cinemático de um personagem (jogador ou bot) + motor de colisão.
// Modelo: hull AABB vertical. Movimento horizontal por eixo (desliza em paredes), step-up de
// degraus/rampas, snap ao chão ao descer, teto/agachar, pouso por varredura vertical.
import { MOVEMENT, PLAYER } from '../Config/Tuning.js';
import { Vec3 } from '../Systems/MathUtil.js';
import { EPS } from './Colliders.js';

const BLOCKED = -1e9;
const MAX_SUBSTEP = 0.02;
const tops = new Float64Array(512);

export class CharacterBody {
  constructor(world, opts = {}) {
    this.world = world;
    this.radius = opts.radius ?? PLAYER.RADIUS;
    this.heightStand = opts.heightStand ?? PLAYER.HEIGHT_STAND;
    this.heightCrouch = opts.heightCrouch ?? PLAYER.HEIGHT_CROUCH;
    this.pos = new Vec3();
    this.vel = new Vec3();
    this.prev = new Vec3();
    this.height = this.heightStand;
    this.crouched = false;
    this.onGround = false;
    this.groundCollider = null;
    this.landed = false;      // verdadeiro no tick em que pousou
    this.jumped = false;      // verdadeiro no tick em que pulou
    this.landImpact = 0;      // m/s do pouso
    this.airTime = 0;
    this.fallStartY = 0;
    this.jumpBuffer = 0;
    this.stepped = 0;         // altura subida no último tick (para suavizar câmera)
    this.hitWall = false;
  }

  teleport(x, y, z) {
    this.pos.set(x, y, z);
    this.prev.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.crouched = false;
    this.height = this.heightStand;
    this.onGround = false;
    this.airTime = 0;
    this.jumpBuffer = 0;
    this.groundCollider = null;
    this.settle();
  }

  /** Cola no chão logo abaixo (usado ao nascer). */
  settle() {
    const s = supportBelow(this.world, this.pos.x, this.pos.y + 0.05, this.pos.z, this.radius, 3);
    if (s.top > -Infinity) {
      this.pos.y = s.top;
      this.prev.y = s.top;
      this.onGround = true;
      this.groundCollider = s.collider;
    }
  }

  get speedXZ() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get groundSurface() {
    return this.groundCollider ? this.groundCollider.surface : 'concrete';
  }

  /** Há espaço para ficar em pé na posição atual? */
  canStand() {
    if (!this.crouched) return true;
    return resolveHull(this.world, this.pos.x, this.pos.y, this.pos.z, this.radius, this.heightStand, false, 0) !== BLOCKED;
  }

  setCrouched(want) {
    if (want === this.crouched) return;
    if (want) {
      this.crouched = true;
      this.height = this.heightCrouch;
    } else if (this.canStand()) {
      this.crouched = false;
      this.height = this.heightStand;
    }
  }

  /** Altura dos olhos acima dos pés (sem suavização). */
  get eyeOffset() {
    return this.crouched ? PLAYER.EYE_CROUCH : PLAYER.EYE_STAND;
  }

  /** Integra colisão + gravidade por dt usando a velocidade atual. */
  move(dt) {
    this.landed = false;
    this.stepped = 0;
    this.hitWall = false;
    const startY = this.pos.y;
    this._moveHorizontal(dt);
    this._moveVertical(dt);
    if (this.onGround) this.airTime = 0; else this.airTime += dt;
    const dy = this.pos.y - startY;
    if (this.onGround && dy > 0.005) this.stepped = dy;
  }

  _moveHorizontal(dt) {
    const { pos, vel, world, radius: r, height: h } = this;
    const dist = Math.hypot(vel.x, vel.z) * dt;
    if (dist < 1e-9) return;
    const n = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
    const sx = (vel.x * dt) / n;
    const sz = (vel.z * dt) / n;
    const canStep = this.onGround;
    const stepH = MOVEMENT.STEP_HEIGHT;
    for (let i = 0; i < n; i++) {
      const xFirst = (i & 1) === 0;
      for (let pass = 0; pass < 2; pass++) {
        const doX = xFirst ? pass === 0 : pass === 1;
        if (doX) {
          if (sx === 0) continue;
          const nx = pos.x + sx;
          const ny = resolveHull(world, nx, pos.y, pos.z, r, h, canStep, stepH);
          if (ny !== BLOCKED) { pos.x = nx; pos.y = ny; } else { vel.x = 0; this.hitWall = true; }
        } else {
          if (sz === 0) continue;
          const nz = pos.z + sz;
          const ny = resolveHull(world, pos.x, pos.y, nz, r, h, canStep, stepH);
          if (ny !== BLOCKED) { pos.z = nz; pos.y = ny; } else { vel.z = 0; this.hitWall = true; }
        }
      }
    }
  }

  _moveVertical(dt) {
    const { pos, vel, world, radius: r, height: h } = this;
    if (this.onGround && vel.y <= 0) {
      const s = supportBelow(world, pos.x, pos.y, pos.z, r, MOVEMENT.STEP_HEIGHT);
      if (s.top > -Infinity) {
        pos.y = s.top;
        vel.y = 0;
        this.groundCollider = s.collider;
        return;
      }
      this.onGround = false;
      this.groundCollider = null;
      this.fallStartY = pos.y;
    }

    // No ar
    vel.y -= MOVEMENT.GRAVITY * dt;
    if (vel.y < -MOVEMENT.TERMINAL_VELOCITY) vel.y = -MOVEMENT.TERMINAL_VELOCITY;
    const yOld = pos.y;
    const yNew = yOld + vel.y * dt;

    if (vel.y <= 0) {
      const s = landingSupport(world, pos.x, pos.z, r, yOld, yNew);
      if (s.top > -Infinity) {
        this.landImpact = -vel.y;
        pos.y = s.top;
        vel.y = 0;
        this.onGround = true;
        this.groundCollider = s.collider;
        this.landed = true;
        return;
      }
      pos.y = yNew;
    } else {
      const c = lowestCeiling(world, pos.x, pos.z, r, yOld + h, yNew + h);
      if (c < Infinity) {
        pos.y = c - h;
        vel.y = 0;
      } else {
        pos.y = yNew;
      }
    }
  }
}

/**
 * Testa o hull em (x,y,z). Retorna a nova altura dos pés (degrau/rampa permitido) ou BLOCKED.
 */
export function resolveHull(world, x, y, z, r, h, canStep, stepH) {
  const x0 = x - r, x1 = x + r, z0 = z - r, z1 = z + r;
  const list = world.collect(x0, z0, x1, z1);
  const n = Math.min(list.length, tops.length);
  let newY = y;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const top = c.maxTopOver(x0, x1, z0, z1);
    tops[i] = top;
    if (top === -Infinity) continue;
    if (c.minY >= y + h - EPS) continue;          // acima da cabeça
    if (top <= y + EPS) continue;                  // abaixo/na altura dos pés
    if (canStep && c.walkable && top - y <= stepH) {
      if (top > newY) newY = top;
      continue;
    }
    return BLOCKED;
  }
  if (newY > y) {
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (tops[i] === -Infinity) continue;
      if (c.minY >= newY + h - EPS) continue;
      if (tops[i] <= newY + EPS) continue;
      return BLOCKED;
    }
  }
  return newY;
}

const support = { top: -Infinity, collider: null };

/** Maior superfície sob os pés dentro de [y - maxDrop, y]. */
export function supportBelow(world, x, y, z, r, maxDrop) {
  const x0 = x - r, x1 = x + r, z0 = z - r, z1 = z + r;
  const list = world.collect(x0, z0, x1, z1);
  support.top = -Infinity;
  support.collider = null;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const top = c.maxTopOver(x0, x1, z0, z1);
    if (top <= y + EPS && top >= y - maxDrop - EPS && top > support.top) {
      support.top = top;
      support.collider = c;
    }
  }
  return support;
}

/** Superfície atravessada ao cair de yOld para yNew. */
function landingSupport(world, x, z, r, yOld, yNew) {
  const x0 = x - r, x1 = x + r, z0 = z - r, z1 = z + r;
  const list = world.collect(x0, z0, x1, z1);
  support.top = -Infinity;
  support.collider = null;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const top = c.maxTopOver(x0, x1, z0, z1);
    if (top <= yOld + EPS && top >= yNew - EPS && top > support.top) {
      support.top = top;
      support.collider = c;
    }
  }
  return support;
}

/** Menor teto que a cabeça atravessa subindo de headOld para headNew. */
function lowestCeiling(world, x, z, r, headOld, headNew) {
  const x0 = x - r, x1 = x + r, z0 = z - r, z1 = z + r;
  const list = world.collect(x0, z0, x1, z1);
  let best = Infinity;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.minY >= headOld - EPS && c.minY <= headNew + EPS && c.overlapsXZ(x0, x1, z0, z1) && c.minY < best) best = c.minY;
  }
  return best;
}
