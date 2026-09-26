// Jogador humano: converte entrada (mouse/teclado) em olhar e UserCmd.
import { CAMERA, MOUSE } from '../Config/Tuning.js';
import { DEG, clamp, lerp } from '../Systems/MathUtil.js';
import { Combatant } from './Combatant.js';

export class PlayerController extends Combatant {
  constructor(session, opts) {
    super(session, { ...opts, isPlayer: true });
    this.lookSettings = { sensitivity: MOUSE.DEFAULT_SENSITIVITY, invertY: false, aimMultiplier: 1 };
  }

  /** Mouse look — chamado por frame (não por tick) para latência mínima. Recebe counts brutos do mouse. */
  applyLook(dx, dy) {
    if (!this.alive || this.frozenLook) return;
    const s = this.lookSettings;
    let sens = s.sensitivity;
    const def = this.weapons.def;
    if (def && def.ads && this.weapons.adsAmount > 0) {
      sens *= lerp(1, s.aimMultiplier * def.ads.fovMul, this.weapons.adsAmount);
    }
    this.view.yaw -= dx * MOUSE.YAW_DEG_PER_COUNT * sens * DEG;
    const sign = s.invertY ? -1 : 1;
    this.view.pitch -= dy * MOUSE.PITCH_DEG_PER_COUNT * sens * DEG * sign;
    this.view.pitch = clamp(this.view.pitch, CAMERA.MIN_PITCH * DEG, CAMERA.MAX_PITCH * DEG);
  }

  /**
   * Copia um snapshot de entrada para o cmd do próximo tick. Campos de borda são OR-ados para
   * que um clique curto entre dois ticks não se perca.
   */
  applyInput(input) {
    const c = this.cmd;
    c.moveX = input.moveX;
    c.moveZ = input.moveZ;
    c.crouch = input.crouch;
    c.run = input.run;
    c.fire = input.fire;
    c.alt = input.alt;
    c.use = input.use;
    if (input.jump) c.jump = true;
    if (input.reload) c.reload = true;
    if (input.slot) c.slot = input.slot;
    if (input.switchDelta) c.switchDelta = input.switchDelta;
    if (input.quickSwitch) c.quickSwitch = true;
    if (input.throwGrenade) c.throwGrenade = input.throwGrenade;
  }
}
