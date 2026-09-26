// Assistência de mira para toque: puxa levemente a mira para o inimigo visível mais próximo do centro
// da tela enquanto o jogador atira/mira. Pura (sem DOM) — testável no Node.
import { DEG, angleDelta } from '../Systems/MathUtil.js';

export const ASSIST = {
  CONE_DEG: 9,          // só ajuda quando o inimigo está a menos que isso do centro da mira
  MAX_DIST: 55,         // m
  RATE: 7,              // 1/s — velocidade de aproximação (× força × peso)
  HEAD_BIAS: 0.0,       // 0 = tronco; 1 = cabeça
};

/**
 * Calcula a correção (radianos) rumo ao melhor alvo. Retorna { dyaw, dpitch, weight } ou null.
 * `weight` (0..1) é maior quanto mais perto do centro está o alvo.
 */
export function computeAssist(player, session, cfg = ASSIST) {
  const eye = player.eyeArray();
  const world = session.world;
  const cone = cfg.CONE_DEG * DEG;
  let best = null;
  let bestAng = cone;
  for (const c of session.combatants) {
    if (c === player || !c.alive || c.team === player.team) continue;
    const p = c.body.pos;
    const h = c.body.crouched ? 0.75 : 1;
    const ty = p.y + (1.15 + (1.6 - 1.15) * cfg.HEAD_BIAS) * h;
    const dx = p.x - eye[0], dy = ty - eye[1], dz = p.z - eye[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist > cfg.MAX_DIST || dist < 0.5) continue;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const dyaw = angleDelta(player.view.yaw, yaw);
    const dpitch = pitch - player.view.pitch;
    const ang = Math.hypot(dyaw * Math.cos(pitch), dpitch);
    if (ang >= bestAng) continue;
    if (!world.hasLineOfSight(eye[0], eye[1], eye[2], p.x, ty, p.z)) continue;
    bestAng = ang;
    best = { dyaw, dpitch, weight: 1 - ang / cone };
  }
  return best;
}
