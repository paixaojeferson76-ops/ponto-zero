// "Mira grudada" para toque (estilo COD Mobile / Free Fire): enquanto o jogador atira ou mira, a visão ENCAIXA
// no inimigo mais próximo do centro e o ACOMPANHA se ele se mexer, compensando o recoil para as balas acertarem.
// Um arrasto rápido solta a trava (para fugir dela ou trocar de alvo). Pura (sem DOM) — testável no Node.
import { DEG, angleDelta, clamp, lerp } from '../Systems/MathUtil.js';

export const ASSIST = {
  CONE_MIN_DEG: 9,        // cone de captura com força mínima
  CONE_MAX_DEG: 30,       // …e com força máxima
  STICKY_CONE_MUL: 1.7,   // depois de travar, o alvo só é solto se sair de um cone maior (evita "escorregar")
  MAX_DIST: 65,           // m
  RATE_MIN: 7,            // 1/s — velocidade com que a mira encaixa (força mínima)
  RATE_MAX: 32,           // …e máxima (≈ encaixa em 80 ms)
  LOS_GRACE: 0.3,         // s — mantém a trava se o alvo sumir atrás de algo por pouco tempo
  BREAK_PX: 46,           // arrasto (px/frame) que solta a trava; cresce com a força
  BREAK_TIME: 0.32,       // s sem assistência depois de soltar
  TARGET_HEIGHT: 1.35,    // m — parte alta do tronco (bala pode pegar cabeça ou corpo)
  ALIGNED_DEG: 3.5,       // erro angular abaixo do qual o tiro automático dispara
};

export class AimAssist {
  constructor() {
    this.target = null;
    this.seenAt = 0;
    this.pausedUntil = 0;
    this.locked = false;     // true enquanto há alvo travado (usado pelo HUD)
    this.aligned = false;    // true quando a mira já está praticamente em cima do alvo (libera o tiro automático)
  }

  reset() {
    this.target = null;
    this.seenAt = 0;
    this.pausedUntil = 0;
    this.locked = false;
    this.aligned = false;
  }

  /** Ângulos verdadeiros até o alvo e se há linha de visão. */
  _evaluate(player, session, c, eye) {
    const p = c.body.pos;
    const h = c.body.crouched ? 0.75 : 1;
    const ty = p.y + ASSIST.TARGET_HEIGHT * h;
    const dx = p.x - eye[0], dy = ty - eye[1], dz = p.z - eye[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist > ASSIST.MAX_DIST || dist < 0.5) return null;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const dyaw = angleDelta(player.view.yaw, yaw);
    const dpitch = pitch - player.view.pitch;
    return {
      c, dist, dyaw, dpitch, cosP: Math.cos(pitch),
      ang: Math.hypot(dyaw * Math.cos(pitch), dpitch),
      los: session.world.hasLineOfSight(eye[0], eye[1], eye[2], p.x, ty, p.z),
    };
  }

  /**
   * Um passo por frame.
   * @param {{strength:number, dt:number, active:boolean, lookPx:number, time:number}} o
   *        active = atirando/mirando · lookPx = arrasto do dedo neste frame (px)
   * @returns {{dyaw:number, dpitch:number, k:number}|null} correção da visão (rad) e fração a aplicar agora
   */
  step(player, session, o) {
    const { strength, dt, active, lookPx, time } = o;
    this.locked = false;
    this.aligned = false;
    if (!(strength > 0) || !active || !player.alive) { this.target = null; return null; }

    // arrasto forte = jogador quer sair da trava / trocar de alvo
    const breakPx = ASSIST.BREAK_PX * (0.7 + 0.6 * strength);
    if (lookPx > breakPx) { this.pausedUntil = time + ASSIST.BREAK_TIME; this.target = null; }
    if (time < this.pausedUntil) return null;

    const eye = player.eyeArray();
    const cone = lerp(ASSIST.CONE_MIN_DEG, ASSIST.CONE_MAX_DEG, strength) * DEG;
    let cand = null;

    // 1) mantém o alvo atual enquanto ele continuar válido
    const cur = this.target;
    if (cur && cur.alive && cur.team !== player.team) {
      const e = this._evaluate(player, session, cur, eye);
      if (e && e.ang < cone * ASSIST.STICKY_CONE_MUL) {
        if (e.los) { this.seenAt = time; cand = e; } else if (time - this.seenAt < ASSIST.LOS_GRACE) cand = e;
      }
    }

    // 2) senão, escolhe o inimigo visível mais próximo do centro da mira
    if (!cand) {
      let bestScore = Infinity;
      for (const c of session.combatants) {
        if (c === player || !c.alive || c.team === player.team) continue;
        const e = this._evaluate(player, session, c, eye);
        if (!e || e.ang >= cone || !e.los) continue;
        const score = e.ang * (1 + e.dist / 120);
        if (score < bestScore) { bestScore = score; cand = e; }
      }
      if (cand) { this.seenAt = time; }
    }

    if (!cand) { this.target = null; return null; }
    this.target = cand.c;
    this.locked = true;

    // a BALA sai em (visão − punch): o alinhamento do tiro automático é medido nela, não na visão
    const punch = player.weapons.recoil.aimPunch;
    const bulletErr = Math.hypot((cand.dyaw + punch.yaw * DEG) * cand.cosP, cand.dpitch - punch.pitch * DEG);
    this.aligned = cand.los && bulletErr < ASSIST.ALIGNED_DEG * DEG;

    // compensa o recoil de precisão: a visão precisa ficar "à frente" do alvo para a BALA sair nele
    const dyaw = cand.dyaw + strength * punch.yaw * DEG;
    const dpitch = cand.dpitch - strength * punch.pitch * DEG;
    const k = 1 - Math.exp(-lerp(ASSIST.RATE_MIN, ASSIST.RATE_MAX, strength) * dt);
    return { dyaw, dpitch, k };
  }

  /** Aplica a correção calculada à visão do jogador. */
  static apply(player, a) {
    if (!a) return;
    player.view.yaw += a.dyaw * a.k;
    player.view.pitch = clamp(player.view.pitch + a.dpitch * a.k, -1.5, 1.5);
  }
}
