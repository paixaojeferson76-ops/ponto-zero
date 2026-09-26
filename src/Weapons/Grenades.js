// Granadas: física simples (gravidade, ricochete, atrito) + detonação (explosiva, cegante, fumaça).
import { GRENADES } from '../Config/Tuning.js';
import { RayHit } from '../Physics/PhysicsWorld.js';
import { clamp } from '../Systems/MathUtil.js';

class Grenade {
  constructor() { this.reset(); }
  reset() {
    this.active = false;
    this.kind = 'frag';
    this.owner = null;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.fuse = 0;
    this.age = 0;
    this.resting = false;
    this.bounces = 0;
  }
}

export class GrenadeSystem {
  constructor(session) {
    this.session = session;
    this.list = [];
    this._hit = new RayHit();
  }

  /** Arremessa a partir dos olhos do combatente na direção da mira. */
  throwFrom(owner, kind, lob) {
    const eye = owner.eyeArray();
    const yaw = owner.view.yaw, pitch = owner.view.pitch + 0.09;   // leve arco para cima
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
    const speed = lob ? GRENADES.LOB_SPEED : GRENADES.THROW_SPEED;
    const v = owner.body.vel;
    return this.spawn(owner, kind,
      eye[0] + dx * 0.4, eye[1] - 0.15 + dy * 0.4, eye[2] + dz * 0.4,
      dx * speed + v.x * GRENADES.INHERIT_VELOCITY,
      dy * speed + v.y * GRENADES.INHERIT_VELOCITY * 0.3,
      dz * speed + v.z * GRENADES.INHERIT_VELOCITY);
  }

  spawn(owner, kind, x, y, z, vx, vy, vz) {
    let g = this.list.find((e) => !e.active);
    if (!g) { g = new Grenade(); this.list.push(g); }
    g.reset();
    g.active = true;
    g.kind = kind;
    g.owner = owner;
    g.x = x; g.y = y; g.z = z;
    g.vx = vx; g.vy = vy; g.vz = vz;
    g.fuse = kind === 'frag' ? GRENADES.FRAG.FUSE : kind === 'flash' ? GRENADES.FLASH.FUSE : GRENADES.SMOKE.FUSE;
    // Origem dentro de parede → começa na posição do dono.
    if (this.session.world.pointInSolid(x, y, z)) {
      const eye = owner.eyeArray();
      g.x = eye[0]; g.y = eye[1]; g.z = eye[2];
      g.vx *= 0.2; g.vz *= 0.2;
    }
    this.session.events.emit('grenadeSpawn', { grenade: g });
    return g;
  }

  update(dt) {
    const session = this.session;
    const world = session.world;
    const hit = this._hit;
    for (let i = 0; i < this.list.length; i++) {
      const g = this.list[i];
      if (!g.active) continue;
      g.age += dt;
      if (!g.resting) {
        g.vy -= GRENADES.GRAVITY * dt;
        const sx = g.vx * dt, sy = g.vy * dt, sz = g.vz * dt;
        const len = Math.hypot(sx, sy, sz);
        if (len > 1e-9) {
          const dx = sx / len, dy = sy / len, dz = sz / len;
          const h = world.raycast(g.x, g.y, g.z, dx, dy, dz, len + GRENADES.RADIUS, hit);
          if (h && h.t - GRENADES.RADIUS <= len) {
            const travel = Math.max(0, h.t - GRENADES.RADIUS);
            g.x += dx * travel; g.y += dy * travel; g.z += dz * travel;
            // reflete a velocidade
            const vn = g.vx * h.nx + g.vy * h.ny + g.vz * h.nz;
            const tx = g.vx - vn * h.nx, ty = g.vy - vn * h.ny, tz = g.vz - vn * h.nz;
            g.vx = tx * GRENADES.TANGENT_FRICTION - vn * h.nx * GRENADES.RESTITUTION;
            g.vy = ty * GRENADES.TANGENT_FRICTION - vn * h.ny * GRENADES.RESTITUTION;
            g.vz = tz * GRENADES.TANGENT_FRICTION - vn * h.nz * GRENADES.RESTITUTION;
            g.bounces++;
            if (vn < -2.5) session.events.emit('grenadeBounce', { grenade: g, speed: -vn });
            if (h.ny > 0.6 && Math.hypot(g.vx, g.vy, g.vz) < GRENADES.REST_SPEED * 2) {
              g.resting = true;
              g.vx = g.vy = g.vz = 0;
            }
          } else {
            g.x += sx; g.y += sy; g.z += sz;
          }
        }
      }
      g.fuse -= dt;
      if (g.fuse <= 0) this._detonate(g);
    }
    // fumaça: cresce e expira
    const smokes = world.smokes;
    for (let i = smokes.length - 1; i >= 0; i--) {
      const s = smokes[i];
      s.age += dt;
      s.radius = s.maxRadius * clamp(s.age / GRENADES.SMOKE.GROW_TIME, 0, 1) * (s.age > s.duration - 2 ? clamp((s.duration - s.age) / 2, 0, 1) : 1);
      if (s.age >= s.duration) {
        smokes.splice(i, 1);
        session.events.emit('smokeEnd', { smoke: s });
      }
    }
  }

  _detonate(g) {
    g.active = false;
    const session = this.session;
    if (g.kind === 'frag') this._explode(g);
    else if (g.kind === 'flash') this._flash(g);
    else this._smoke(g);
    session.events.emit('grenadeDetonate', { kind: g.kind, x: g.x, y: g.y, z: g.z, owner: g.owner });
  }

  _explode(g) {
    const session = this.session;
    const cfg = GRENADES.FRAG;
    session.emitSound({ x: g.x, y: g.y, z: g.z }, 70, 'explosion', g.owner);
    for (const c of session.combatants) {
      if (!c.alive) continue;
      const cx = c.body.pos.x, cy = c.body.pos.y + 0.9, cz = c.body.pos.z;
      const d = Math.hypot(cx - g.x, cy - g.y, cz - g.z);
      if (d > cfg.RADIUS) continue;
      // Precisa de linha de visão do centro da explosão até o corpo (peito ou pés).
      const visible = !session.world.isBlocked(g.x, g.y + 0.1, g.z, cx, cy, cz)
        || !session.world.isBlocked(g.x, g.y + 0.1, g.z, cx, c.body.pos.y + 0.2, cz)
        || !session.world.isBlocked(g.x, g.y + 0.1, g.z, cx, c.body.pos.y + 1.5, cz);
      if (!visible) continue;
      const f = 1 - d / cfg.RADIUS;
      const amount = cfg.MIN_DAMAGE + (cfg.MAX_DAMAGE - cfg.MIN_DAMAGE) * f * f;
      const dirx = (cx - g.x) / (d || 1), dirz = (cz - g.z) / (d || 1);
      c.receiveDamage({
        amount, type: 'explosion', attacker: g.owner, weaponId: 'frag', hitbox: 'torso', armorPen: 0.5,
        point: { x: cx, y: cy, z: cz }, dir: { x: dirx, y: 0, z: dirz }, distance: d,
      });
    }
  }

  _flash(g) {
    const session = this.session;
    const cfg = GRENADES.FLASH;
    for (const c of session.combatants) {
      if (!c.alive) continue;
      const eye = c.eyeArray();
      const dx = g.x - eye[0], dy = g.y - eye[1], dz = g.z - eye[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > cfg.RADIUS) continue;
      if (session.world.isBlocked(eye[0], eye[1], eye[2], g.x, g.y, g.z)) continue;
      // Quanto mais de frente para a granada, mais tempo cego.
      const cp = Math.cos(c.view.pitch);
      const fx = -Math.sin(c.view.yaw) * cp, fy = Math.sin(c.view.pitch), fz = -Math.cos(c.view.yaw) * cp;
      const facing = (fx * dx + fy * dy + fz * dz) / (d || 1);   // 1 = olhando para a granada
      const facingFactor = clamp((facing + 0.35) / 1.35, 0.12, 1);
      const distFactor = 1 - clamp(d / cfg.RADIUS, 0, 1) * 0.7;
      const seconds = cfg.MIN_BLIND + (cfg.MAX_BLIND - cfg.MIN_BLIND) * facingFactor * distFactor;
      c.blind(seconds);
      session.events.emit('flashed', { victim: c, seconds, source: g.owner });
    }
    session.emitSound({ x: g.x, y: g.y, z: g.z }, 30, 'flash', g.owner);
  }

  _smoke(g) {
    const cfg = GRENADES.SMOKE;
    const smoke = { x: g.x, y: g.y + 0.6, z: g.z, radius: 0.1, maxRadius: cfg.RADIUS, age: 0, duration: cfg.DURATION };
    this.session.world.smokes.push(smoke);
    this.session.events.emit('smokeStart', { smoke });
    this.session.emitSound({ x: g.x, y: g.y, z: g.z }, 14, 'smoke', g.owner);
  }

  clear() {
    for (const g of this.list) g.active = false;
    this.session.world.smokes.length = 0;
  }
}
