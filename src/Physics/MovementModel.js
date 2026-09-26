// Modelo de movimento estilo FPS tático (tração + atrito com stopspeed; ar com teto de wish-speed).
// Puro: recebe o corpo, o comando e dt. Serve ao jogador humano e aos bots.
import { MOVEMENT } from '../Config/Tuning.js';

/**
 * @typedef {Object} MoveCmd
 * @property {number} moveX   -1..1 (direita positivo)
 * @property {number} moveZ   -1..1 (frente positivo)
 * @property {number} yaw     rad — define o referencial do movimento
 * @property {boolean} jump   pulo pressionado (borda); um buffer curto o mantém válido
 * @property {boolean} crouch
 * @property {boolean} run
 */

export function maxSpeedFor(cmd, crouched) {
  if (crouched) return MOVEMENT.CROUCH_SPEED;
  return cmd.run ? MOVEMENT.RUN_SPEED : MOVEMENT.WALK_SPEED;
}

export function stepMovement(body, cmd, dt, speedMul = 1) {
  const vel = body.vel;
  body.prev.copy(body.pos);
  body.jumped = false;

  body.setCrouched(cmd.crouch);

  if (cmd.jump) body.jumpBuffer = MOVEMENT.JUMP_BUFFER;
  else if (body.jumpBuffer > 0) body.jumpBuffer = Math.max(0, body.jumpBuffer - dt);

  // Direção desejada no plano XZ (referencial do yaw).
  let mx = cmd.moveX, mz = cmd.moveZ;
  const inputLen = Math.hypot(mx, mz);
  if (inputLen > 1) { mx /= inputLen; mz /= inputLen; }
  const sy = Math.sin(cmd.yaw), cy = Math.cos(cmd.yaw);
  // frente = (-sin, -cos); direita = (cos, -sin)
  let wx = -sy * mz + cy * mx;
  let wz = -cy * mz - sy * mx;
  const wl = Math.hypot(wx, wz);
  const hasInput = wl > 1e-4;
  if (hasInput) { wx /= wl; wz /= wl; }
  const magnitude = Math.min(1, inputLen);
  const wishSpeed = hasInput ? maxSpeedFor(cmd, body.crouched) * speedMul * magnitude : 0;

  if (body.onGround) {
    if (body.jumpBuffer > 0 && cmd.allowJump !== false) {
      vel.y = MOVEMENT.JUMP_FORCE;
      body.onGround = false;
      body.groundCollider = null;
      body.jumpBuffer = 0;
      body.fallStartY = body.pos.y;
      body.jumped = true;
      capJumpSpeed(vel);
      airMove(vel, wx, wz, wishSpeed, hasInput, cmd, dt);
    } else {
      applyFriction(vel, hasInput, dt);
      if (hasInput) accelerate(vel, wx, wz, wishSpeed, MOVEMENT.ACCELERATION * wishSpeed, dt);
    }
  } else {
    airMove(vel, wx, wz, wishSpeed, hasInput, cmd, dt);
  }

  body.move(dt);

  if (body.landed && body.landImpact > MOVEMENT.LAND_SLOWDOWN_SPEED) {
    vel.x *= MOVEMENT.LAND_SLOWDOWN_FACTOR;
    vel.z *= MOVEMENT.LAND_SLOWDOWN_FACTOR;
  }
}

function applyFriction(vel, hasInput, dt) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 1e-4) { vel.x = 0; vel.z = 0; return; }
  const friction = hasInput ? MOVEMENT.FRICTION : MOVEMENT.DECELERATION;
  const control = Math.max(speed, MOVEMENT.STOP_SPEED);
  const newSpeed = Math.max(0, speed - control * friction * dt);
  const k = newSpeed / speed;
  vel.x *= k;
  vel.z *= k;
}

function accelerate(vel, wx, wz, wishSpeed, accelPerSec, dt) {
  const current = vel.x * wx + vel.z * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const gain = Math.min(accelPerSec * dt, add);
  vel.x += wx * gain;
  vel.z += wz * gain;
}

function airMove(vel, wx, wz, wishSpeed, hasInput, cmd, dt) {
  airSteer(vel, wx, wz, wishSpeed, hasInput, cmd, dt);
  // Teto duro de velocidade horizontal no ar: air-strafe muda a direção, nunca acelera sem limite.
  const limit = MOVEMENT.RUN_SPEED * MOVEMENT.JUMP_SPEED_CAP;
  const speed = Math.hypot(vel.x, vel.z);
  if (speed > limit) {
    const k = limit / speed;
    vel.x *= k;
    vel.z *= k;
  }
}

function airSteer(vel, wx, wz, wishSpeed, hasInput, cmd, dt) {
  if (!hasInput) return;
  const capped = Math.min(wishSpeed, MOVEMENT.AIR_SPEED_CAP);
  const current = vel.x * wx + vel.z * wz;
  const add = capped - current;
  if (add > 0) {
    const gain = Math.min(MOVEMENT.AIR_ACCELERATION * wishSpeed * dt, add);
    vel.x += wx * gain;
    vel.z += wz * gain;
  }
  // Controle aéreo: só "frente" pura curva a trajetória sem ganhar velocidade.
  if (MOVEMENT.AIR_CONTROL > 0 && Math.abs(cmd.moveX) < 0.01 && cmd.moveZ > 0.01) {
    const speed = Math.hypot(vel.x, vel.z);
    if (speed > 0.5) {
      const dot = (vel.x * wx + vel.z * wz) / speed;
      if (dot > 0) {
        const k = MOVEMENT.AIR_CONTROL * 3.0 * dot * dot * dt;
        let nx = vel.x / speed + wx * k;
        let nz = vel.z / speed + wz * k;
        const nl = Math.hypot(nx, nz) || 1;
        vel.x = (nx / nl) * speed;
        vel.z = (nz / nl) * speed;
      }
    }
  }
}

function capJumpSpeed(vel) {
  const cap = MOVEMENT.RUN_SPEED * MOVEMENT.JUMP_SPEED_CAP;
  const speed = Math.hypot(vel.x, vel.z);
  if (speed > cap) {
    const k = cap / speed;
    vel.x *= k;
    vel.z *= k;
  }
}
