// Balística hitscan: dispersão, raycast no mundo, hitboxes dos personagens, penetração e dano.
import { DAMAGE } from '../Config/Tuning.js';
import { WEAPON_TIMING } from '../Config/WeaponDefs.js';
import { surfaceOf } from '../Config/Surfaces.js';
import { RayHit } from '../Physics/PhysicsWorld.js';
import { HitboxHit } from '../Systems/Hitbox.js';
import { DEG, clamp } from '../Systems/MathUtil.js';

export function falloffMultiplier(def, distance) {
  const over = Math.max(0, distance - (def.falloffStart ?? 1e9));
  return clamp(1 - over * (def.falloffPerMeter ?? 0), def.falloffMin ?? 1, 1);
}

export class Ballistics {
  constructor(session) {
    this.session = session;
    this._wallHit = new RayHit();
    this._bodyHit = new HitboxHit();
    this._disk = { x: 0, y: 0 };
    this._best = new HitboxHit();
  }

  canHit(shooter, target) {
    return target !== shooter && target.alive && (DAMAGE.FRIENDLY_FIRE || target.team !== shooter.team);
  }

  /**
   * Dispara todos os projéteis de uma arma de fogo a partir de (ox,oy,oz) mirando (yaw,pitch) com spread em graus.
   */
  fire(shooter, def, ox, oy, oz, yaw, pitch, spreadDeg) {
    const rng = this.session.rng;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const rx = cy, rz = -sy;                       // direita (horizontal)
    // up = right × forward  (right=(rx,0,rz), forward=(fx,fy,fz))
    const upx = 0 * fz - rz * fy;
    const upy = rz * fx - rx * fz;
    const upz = rx * fy - 0 * fx;
    const spreadTan = Math.tan(spreadDeg * DEG);
    const pellets = def.pellets || 1;

    for (let i = 0; i < pellets; i++) {
      let dx = fx, dy = fy, dz = fz;
      if (spreadTan > 0) {
        rng.inDisk(this._disk);
        const a = this._disk.x * spreadTan, b = this._disk.y * spreadTan;
        dx += rx * a + upx * b;
        dy += upy * b;
        dz += rz * a + upz * b;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
      }
      this.trace(shooter, def, ox, oy, oz, dx, dy, dz, i);
    }
  }

  trace(shooter, def, ox, oy, oz, dx, dy, dz, pelletIndex) {
    const session = this.session;
    const world = session.world;
    const events = session.events;
    const combatants = session.combatants;
    let px = ox, py = oy, pz = oz;
    let remaining = def.range;
    let travelled = 0;
    let dmgMul = 1;
    let walls = 0;
    let endX = ox + dx * def.range, endY = oy + dy * def.range, endZ = oz + dz * def.range;
    let endKind = 'none';
    const wall = this._wallHit;
    const body = this._bodyHit;
    const best = this._best;

    for (let iter = 0; iter < WEAPON_TIMING.PENETRATION_MAX_WALLS + 2; iter++) {
      const wh = world.raycast(px, py, pz, dx, dy, dz, remaining, wall);
      let limit = wh ? wh.t : remaining;
      let victim = null;

      for (let i = 0; i < combatants.length; i++) {
        const c = combatants[i];
        if (!this.canHit(shooter, c)) continue;
        if (c.hitboxes.raycast(px, py, pz, dx, dy, dz, limit, body) && body.t < limit) {
          limit = body.t;
          victim = c;
          best.t = body.t; best.part = body.part; best.name = body.name;
          best.x = body.x; best.y = body.y; best.z = body.z;
          best.nx = body.nx; best.ny = body.ny; best.nz = body.nz;
        }
      }

      if (victim) {
        const distance = travelled + best.t;
        const mult = def.hitMult ? def.hitMult[best.part] ?? 1 : 1;
        const amount = def.damage * falloffMultiplier(def, distance) * mult * dmgMul;
        endX = best.x; endY = best.y; endZ = best.z;
        endKind = 'entity';
        const result = victim.receiveDamage({
          amount, type: 'bullet', attacker: shooter, weaponId: def.id, hitbox: best.part,
          armorPen: def.armorPen, penetrated: walls > 0,
          point: { x: best.x, y: best.y, z: best.z }, dir: { x: dx, y: dy, z: dz }, distance,
        });
        events.emit('bulletHit', {
          shooter, victim, part: best.part, x: best.x, y: best.y, z: best.z,
          nx: best.nx, ny: best.ny, nz: best.nz, dx, dy, dz, weaponId: def.id, result, distance,
        });
        break;
      }

      if (!wh) {
        break;
      }

      const hx = px + dx * wh.t, hy = py + dy * wh.t, hz = pz + dz * wh.t;
      const surface = surfaceOf(wh.collider.surface);
      events.emit('bulletImpact', {
        shooter, x: hx, y: hy, z: hz, nx: wh.nx, ny: wh.ny, nz: wh.nz, dx, dy, dz,
        surface: wh.collider.surface, weaponId: def.id, penetrated: walls > 0, exit: false,
      });
      endX = hx; endY = hy; endZ = hz; endKind = 'world';

      const thickness = wh.tExit - wh.t;
      const maxThick = (def.penetration || 0) * surface.penetrationDepth;
      const next = remaining - wh.t - thickness;
      if (maxThick > 0 && thickness <= maxThick && walls < WEAPON_TIMING.PENETRATION_MAX_WALLS && next > 1) {
        dmgMul *= 1 - WEAPON_TIMING.PENETRATION_DAMAGE_LOSS * (thickness / maxThick);
        walls++;
        const ex = px + dx * (wh.t + thickness), ey = py + dy * (wh.t + thickness), ez = pz + dz * (wh.t + thickness);
        events.emit('bulletImpact', {
          shooter, x: ex, y: ey, z: ez, nx: -wh.nx, ny: -wh.ny, nz: -wh.nz, dx, dy, dz,
          surface: wh.collider.surface, weaponId: def.id, penetrated: true, exit: true,
        });
        travelled += wh.t + thickness + 0.02;
        remaining = next - 0.02;
        px = ex + dx * 0.02; py = ey + dy * 0.02; pz = ez + dz * 0.02;
        continue;
      }
      break;
    }

    events.emit('bulletTrace', {
      shooter, weaponId: def.id, pellet: pelletIndex, walls,
      fromX: ox, fromY: oy, fromZ: oz, toX: endX, toY: endY, toZ: endZ, kind: endKind,
    });
  }

  /** Ataque corpo a corpo: leque de raios curtos à frente. */
  melee(shooter, def, alt) {
    const session = this.session;
    const range = alt ? def.altRange : def.range;
    const damage = alt ? def.altDamage : def.damage;
    const [ox, oy, oz] = shooter.eyeArray();
    const yaw = shooter.view.yaw, pitch = shooter.view.pitch;
    const events = session.events;
    let bestTarget = null, bestT = range, bestPart = 'torso';
    let bestPoint = null;

    const offsets = [[0, 0], [0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]];
    const body = this._bodyHit;
    for (const [oyaw, opitch] of offsets) {
      const cp = Math.cos(pitch + opitch), sp = Math.sin(pitch + opitch);
      const dx = -Math.sin(yaw + oyaw) * cp, dy = sp, dz = -Math.cos(yaw + oyaw) * cp;
      for (const c of session.combatants) {
        if (!this.canHit(shooter, c)) continue;
        if (c.hitboxes.raycast(ox, oy, oz, dx, dy, dz, bestT, body) && body.t < bestT) {
          bestT = body.t; bestTarget = c; bestPart = body.part;
          bestPoint = { x: body.x, y: body.y, z: body.z, dx, dy, dz };
        }
      }
    }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = -Math.sin(yaw) * cp, fy = sp, fz = -Math.cos(yaw) * cp;
    const wh = session.world.raycast(ox, oy, oz, fx, fy, fz, range, this._wallHit);
    if (bestTarget && (!wh || bestT <= wh.t + 0.3)) {
      // backstab: alvo virado na mesma direção do ataque
      const vfx = -Math.sin(bestTarget.view.yaw), vfz = -Math.cos(bestTarget.view.yaw);
      const dxz = Math.hypot(bestPoint.dx, bestPoint.dz) || 1;
      const facingAway = (vfx * bestPoint.dx + vfz * bestPoint.dz) / dxz > 0.55;
      const amount = damage * (facingAway ? def.backstabMul : 1);
      const result = bestTarget.receiveDamage({
        amount, type: 'melee', attacker: shooter, weaponId: def.id, hitbox: bestPart,
        armorPen: def.armorPen, point: bestPoint, dir: { x: bestPoint.dx, y: bestPoint.dy, z: bestPoint.dz }, distance: bestT,
      });
      events.emit('meleeHit', { shooter, victim: bestTarget, x: bestPoint.x, y: bestPoint.y, z: bestPoint.z, result, backstab: facingAway, alt });
      return true;
    }
    if (wh) {
      events.emit('meleeWall', {
        shooter, x: ox + fx * wh.t, y: oy + fy * wh.t, z: oz + fz * wh.t, nx: wh.nx, ny: wh.ny, nz: wh.nz,
        surface: wh.collider.surface,
      });
    }
    return false;
  }
}
