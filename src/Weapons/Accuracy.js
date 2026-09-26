// Cálculo da dispersão (cone de spread, em graus) a partir do estado do personagem.
import { MOVEMENT } from '../Config/Tuning.js';
import { WEAPON_TIMING } from '../Config/WeaponDefs.js';
import { clamp01, lerp } from '../Systems/MathUtil.js';

/**
 * spread = (base + movimento + ar) × agachar × ADS + bloom
 * @param {object} def definição da arma
 * @param {{speedXZ:number,onGround:boolean,crouched:boolean}} body
 * @param {number} ads 0..1 quanto está mirando
 * @param {number} bloom bloom acumulado pelos tiros anteriores (graus)
 */
export function computeSpread(def, body, ads, bloom) {
  if (def.spreadBase === undefined) return 0;
  const minSpeed = WEAPON_TIMING.ACCURACY_MIN_SPEED;
  const f = clamp01((body.speedXZ - minSpeed) / (MOVEMENT.RUN_SPEED - minSpeed));
  let s = def.spreadBase + def.spreadMove * f * f;
  if (!body.onGround) s += def.spreadAir;
  if (body.crouched) s *= def.spreadCrouchMul;
  if (def.ads) s *= lerp(1, def.ads.spreadMul, ads);
  s += bloom;
  return Math.min(s, WEAPON_TIMING.SPREAD_HARD_CAP);
}
