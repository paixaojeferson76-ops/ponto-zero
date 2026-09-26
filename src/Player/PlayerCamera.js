// Câmera FPS: posição interpolada, olhar (com recoil de precisão aplicado), bob, tilt, dip de pouso,
// suavização visual de degraus, FOV dinâmico, câmera de morte e de espectador.
// Matemática pura: produz uma pose; o Render só a copia para a câmera Three.
import { CAMERA, MOVEMENT, PLAYER } from '../Config/Tuning.js';
import { DEG, clamp, damp, lerp, wrapPi } from '../Systems/MathUtil.js';

export class CameraPose {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.fovV = 70;         // vertical, graus
    this.mode = 'first';
  }
}

/** FOV horizontal (referência 16:9) → vertical constante em graus. */
export function verticalFov(horizontalDeg) {
  return 2 * Math.atan(Math.tan((horizontalDeg * DEG) / 2) / (16 / 9)) / DEG;
}

export class PlayerCamera {
  constructor() {
    this.pose = new CameraPose();
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.landDip = 0;
    this.roll = 0;
    this.eyeHeight = PLAYER.EYE_STAND;
    this.smoothY = null;
    this.fovKick = 0;
    this.adsFov = 1;
    this.deathT = 0;
    this.deathSide = 1;
    this.spectateYaw = 0;
    this.spectatePitch = 0;
  }

  onLand(impact, effects = 1) {
    this.landDip = Math.min(CAMERA.LAND_DIP_MAX, impact * CAMERA.LAND_DIP_PER_MS) * effects;
  }

  onSpawn() {
    this.smoothY = null;
    this.deathT = 0;
    this.landDip = 0;
    this.roll = 0;
    this.bobAmp = 0;
  }

  /**
   * Pose do jogador vivo, em primeira pessoa.
   * @param {number} dt tempo do frame (s)
   * @param {number} alpha fração do tick físico (interpolação)
   * @param {import('./Combatant.js').Combatant} p
   * @param {{fov:number, headBob:boolean, headBobAmount:number, cameraEffects:number}} s
   */
  updateFirstPerson(dt, alpha, p, s) {
    const body = p.body;
    const pose = this.pose;
    const fx = s.cameraEffects;

    const ix = lerp(body.prev.x, body.pos.x, alpha);
    let iy = lerp(body.prev.y, body.pos.y, alpha);
    const iz = lerp(body.prev.z, body.pos.z, alpha);

    // Suaviza sobe-degrau só visualmente (a física continua exata).
    if (this.smoothY === null || !body.onGround || Math.abs(iy - this.smoothY) > 1.2) this.smoothY = iy;
    else this.smoothY = damp(this.smoothY, iy, CAMERA.STEP_SMOOTH_RATE, dt);
    iy = this.smoothY;

    this.eyeHeight = damp(this.eyeHeight, body.eyeOffset, 3 / MOVEMENT.CROUCH_TIME, dt);
    this.landDip = damp(this.landDip, 0, CAMERA.LAND_RECOVER, dt);

    // Bob por distância percorrida.
    const speed = body.onGround ? body.speedXZ : 0;
    const speedFactor = clamp(speed / MOVEMENT.RUN_SPEED, 0, 1);
    this.bobAmp = damp(this.bobAmp, s.headBob ? speedFactor : 0, 10, dt);
    this.bobPhase += speed * dt * CAMERA.BOB_FREQUENCY * Math.PI * 2;
    const runScale = speed > MOVEMENT.WALK_SPEED + 0.6 ? CAMERA.BOB_RUN_SCALE : 1;
    const crouchScale = body.crouched ? CAMERA.BOB_CROUCH_SCALE : 1;
    const amp = this.bobAmp * s.headBobAmount * runScale * crouchScale;
    const bobY = Math.sin(this.bobPhase * 2) * CAMERA.BOB_VERTICAL * amp;
    const bobX = Math.sin(this.bobPhase) * CAMERA.BOB_LATERAL * amp;

    // Tilt lateral conforme a velocidade de strafe.
    const cy = Math.cos(p.view.yaw), sy = Math.sin(p.view.yaw);
    const strafe = body.vel.x * cy - body.vel.z * sy;       // componente ao longo do vetor "direita"
    const rollTarget = -clamp(strafe / MOVEMENT.RUN_SPEED, -1, 1) * CAMERA.TILT_MAX_DEG * DEG * fx;
    this.roll = damp(this.roll, rollTarget, CAMERA.TILT_SPEED, dt);

    const recoil = p.weapons.recoil;
    pose.x = ix + cy * bobX;
    pose.z = iz - sy * bobX;
    pose.y = iy + this.eyeHeight + bobY - this.landDip;
    pose.yaw = p.view.yaw - recoil.aimPunch.yaw * DEG;
    pose.pitch = clamp(p.view.pitch + recoil.aimPunch.pitch * DEG + recoil.camKick.pitch * DEG * fx, -1.55, 1.55);
    pose.roll = this.roll + recoil.camKick.roll * DEG * fx;

    // FOV: base + kick ao correr; ADS estreita.
    const running = speed > MOVEMENT.WALK_SPEED + 0.6 && !body.crouched;
    this.fovKick = damp(this.fovKick, running ? CAMERA.RUN_FOV_KICK * fx : 0, CAMERA.FOV_SMOOTH, dt);
    const def = p.weapons.def;
    const adsMul = def && def.ads ? lerp(1, def.ads.fovMul, p.weapons.adsAmount) : 1;
    pose.fovV = (verticalFov(s.fov) + this.fovKick) * adsMul;
    pose.mode = 'first';
    return pose;
  }

  /** Câmera de morte: cai, inclina e vira para o matador. */
  updateDead(dt, p, killer) {
    const pose = this.pose;
    this.deathT += dt;
    const t = clamp(this.deathT / 0.6, 0, 1);
    const ease = 1 - (1 - t) * (1 - t);
    const eye = lerp(this.eyeHeight, 0.32, ease);
    pose.x = p.body.pos.x;
    pose.z = p.body.pos.z;
    pose.y = p.body.pos.y + eye;
    pose.roll = this.deathSide * 1.15 * ease;
    let targetYaw = pose.yaw;
    let targetPitch = -0.15;
    if (killer) {
      const dx = killer.body.pos.x - p.body.pos.x, dz = killer.body.pos.z - p.body.pos.z;
      targetYaw = Math.atan2(-dx, -dz);
      const dy = killer.body.pos.y + 1.4 - pose.y;
      targetPitch = Math.atan2(dy, Math.hypot(dx, dz)) * 0.6;
    }
    if (this.deathT < dt * 1.5) pose.yaw = p.view.yaw - p.weapons.recoil.aimPunch.yaw * DEG;
    pose.yaw += wrapPi(targetYaw - pose.yaw) * (1 - Math.exp(-4 * dt));
    pose.pitch = lerp(pose.pitch, targetPitch, 1 - Math.exp(-4 * dt));
    return pose;
  }

  /** Espectador: segue os olhos de outro combatante (com suavização leve). */
  updateSpectate(dt, alpha, target, fov) {
    const pose = this.pose;
    const b = target.body;
    pose.x = lerp(b.prev.x, b.pos.x, alpha);
    pose.y = lerp(b.prev.y, b.pos.y, alpha) + b.eyeOffset;
    pose.z = lerp(b.prev.z, b.pos.z, alpha);
    this.spectateYaw += wrapPi(target.view.yaw - this.spectateYaw) * (1 - Math.exp(-14 * dt));
    this.spectatePitch = lerp(this.spectatePitch, target.view.pitch, 1 - Math.exp(-14 * dt));
    pose.yaw = this.spectateYaw;
    pose.pitch = this.spectatePitch;
    pose.roll = 0;
    pose.fovV = verticalFov(fov);
    pose.mode = 'spectate';
    return pose;
  }
}
