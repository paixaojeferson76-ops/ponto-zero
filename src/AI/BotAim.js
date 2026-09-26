// Controle de mira do bot: giro limitado, erro angular que assenta com o tempo na mira,
// compensação parcial do recoil (a mesma que o jogador faz com o mouse).
import { DEG, angleDelta, clamp, lerp } from '../Systems/MathUtil.js';

export class BotAim {
  constructor(bot) {
    this.bot = bot;
    this.hasTarget = false;
    this.tracking = false;
    this.tx = 0; this.ty = 0; this.tz = 0;
    this.timeOnTarget = 0;
    this.errYaw = 0;
    this.errPitch = 0;
    this.errTimer = 0;
    this.turnRate = 150;         // graus/s para olhar livre
    this._disk = { x: 0, y: 0 };
    this.lastError = 99;         // graus entre a mira real e o alvo verdadeiro
  }

  reset() {
    this.hasTarget = false;
    this.tracking = false;
    this.timeOnTarget = 0;
    this.errYaw = this.errPitch = 0;
  }

  /** Olha para um ponto do mundo. `tracking` = mirando em inimigo (usa modelo de erro e recoil). */
  lookAt(x, y, z, tracking = false) {
    this.tx = x; this.ty = y; this.tz = z;
    this.hasTarget = true;
    if (tracking && !this.tracking) this.timeOnTarget = 0;
    this.tracking = tracking;
  }

  lookYaw(yaw, pitch = 0) {
    const eye = this.bot.eyeArray();
    this.tx = eye[0] - Math.sin(yaw) * 10;
    this.tz = eye[2] - Math.cos(yaw) * 10;
    this.ty = eye[1] + Math.tan(pitch) * 10;
    this.hasTarget = true;
    this.tracking = false;
  }

  update(dt) {
    if (!this.hasTarget) return;
    const bot = this.bot;
    const diff = bot.difficulty;
    const eye = bot.eyeArray();
    const dx = this.tx - eye[0], dy = this.ty - eye[1], dz = this.tz - eye[2];
    const horiz = Math.hypot(dx, dz);
    let desYaw = Math.atan2(-dx, -dz);
    let desPitch = Math.atan2(dy, horiz);
    const trueYaw = desYaw, truePitch = desPitch;

    let turnRate = this.turnRate;
    if (this.tracking) {
      turnRate = diff.aimTurnRate;
      this.timeOnTarget += dt;
      this.errTimer -= dt;
      if (this.errTimer <= 0) {
        this.errTimer = 0.18;
        const settle = clamp(this.timeOnTarget / diff.aimSettle, 0, 1);
        let mag = lerp(diff.aimError, diff.aimErrorMin, settle);
        if (bot.isBlind) mag *= 6;
        // alvos rápidos são mais difíceis
        mag *= 1 + clamp(bot.body.speedXZ / 6, 0, 0.6);
        bot.session.rng.inDisk(this._disk);
        this.errYaw = this._disk.x * mag * DEG;
        this.errPitch = this._disk.y * mag * DEG * 0.7;
      }
      const punch = bot.weapons.recoil.aimPunch;
      desYaw += diff.recoilControl * punch.yaw * DEG + this.errYaw;
      desPitch -= diff.recoilControl * punch.pitch * DEG - this.errPitch;
    }

    const dYaw = angleDelta(bot.view.yaw, desYaw);
    const dPitch = desPitch - bot.view.pitch;
    const maxStep = turnRate * DEG * dt;
    const k = 1 - Math.exp(-18 * dt);
    bot.view.yaw += clamp(dYaw * k, -maxStep, maxStep);
    bot.view.pitch = clamp(bot.view.pitch + clamp(dPitch * k, -maxStep, maxStep), -1.4, 1.4);

    // erro real (bala) em relação ao alvo verdadeiro
    const shotYaw = bot.aimYaw(), shotPitch = bot.aimPitch();
    const ey = angleDelta(shotYaw, trueYaw), ep = shotPitch - truePitch;
    this.lastError = Math.hypot(ey * Math.cos(truePitch), ep) / DEG;
  }
}
