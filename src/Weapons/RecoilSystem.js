// Recoil em três camadas independentes:
//   1. PRECISÃO (aimPunch, bloom): altera a direção real das balas. É somado ao ângulo de mira; o jogador
//      compensa puxando o mouse. Padrão determinístico por arma + jitter pequeno.
//   2. CÂMERA (camKick): coice visual da câmera; NÃO afeta a mira.
//   3. ARMA (shotCounter): o viewmodel usa o contador para disparar sua própria mola de recuo.
import { lerp } from '../Systems/MathUtil.js';

const MAX_PUNCH_PITCH = 22;
const MAX_PUNCH_YAW = 14;

export class RecoilSystem {
  constructor() {
    this.aimPunch = { pitch: 0, yaw: 0 };   // graus; pitch↑ positivo, yaw→ positivo
    this.shotIndex = 0;
    this.sinceShot = 99;
    this.bloom = 0;                          // graus de dispersão acumulada
    this.camKick = { pitch: 0, roll: 0 };    // graus (visual)
    this.camKickRecover = 16;
    this.shotCounter = 0;
    this.lastShotDefId = null;
  }

  /** Limpa acúmulo ao trocar de arma / renascer (mantém o punch em decaimento se `keepPunch`). */
  reset(keepPunch = false) {
    this.shotIndex = 0;
    this.sinceShot = 99;
    this.bloom = 0;
    this.camKick.pitch = 0;
    this.camKick.roll = 0;
    if (!keepPunch) {
      this.aimPunch.pitch = 0;
      this.aimPunch.yaw = 0;
    }
  }

  onShot(def, ads, rng) {
    const pattern = def.recoilPattern;
    let idx = Math.floor(this.shotIndex);
    if (idx >= pattern.length) {
      const loop = Math.min(8, pattern.length);
      idx = pattern.length - loop + ((idx - pattern.length) % loop);
    }
    const [p, y] = pattern[idx];
    const mul = def.ads ? lerp(1, def.ads.recoilMul, ads) : 1;
    const j = def.recoilJitter;
    this.aimPunch.pitch = Math.min(MAX_PUNCH_PITCH, this.aimPunch.pitch + (p + rng.range(-j, j)) * mul);
    this.aimPunch.yaw = Math.max(-MAX_PUNCH_YAW, Math.min(MAX_PUNCH_YAW, this.aimPunch.yaw + (y + rng.range(-j, j)) * mul));
    this.shotIndex += 1;
    this.sinceShot = 0;
    this.bloom = Math.min(def.spreadBloomMax, this.bloom + def.spreadPerShot);

    this.camKick.pitch += def.camKickPitch;
    this.camKick.roll += rng.sign() * def.camKickRoll * rng.range(0.5, 1);
    this.camKickRecover = def.camKickRecover;
    this.shotCounter++;
    this.lastShotDefId = def.id;
  }

  update(dt, def) {
    this.sinceShot += dt;
    if (def && def.recoilDecay) {
      const settled = this.sinceShot > def.recoilResetDelay;
      const k = Math.exp(-def.recoilDecay * (settled ? 1.7 : 1) * dt);
      this.aimPunch.pitch *= k;
      this.aimPunch.yaw *= k;
      if (settled) this.shotIndex = Math.max(0, this.shotIndex - def.recoilResetRate * dt);
      this.bloom = Math.max(0, this.bloom - def.spreadRecovery * dt);
    } else {
      const k = Math.exp(-6 * dt);
      this.aimPunch.pitch *= k;
      this.aimPunch.yaw *= k;
      this.bloom = 0;
    }
    const kc = Math.exp(-this.camKickRecover * dt);
    this.camKick.pitch *= kc;
    this.camKick.roll *= kc;
    if (Math.abs(this.aimPunch.pitch) < 1e-4) this.aimPunch.pitch = 0;
    if (Math.abs(this.aimPunch.yaw) < 1e-4) this.aimPunch.yaw = 0;
  }
}
