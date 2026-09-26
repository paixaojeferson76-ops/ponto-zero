// Helpers compartilhados pelos testes da simulação (Node, sem navegador).
import { PhysicsWorld } from '../src/Physics/PhysicsWorld.js';
import { BoxCollider, RampCollider } from '../src/Physics/Colliders.js';
import { CharacterBody } from '../src/Physics/CharacterBody.js';
import { stepMovement } from '../src/Physics/MovementModel.js';
import { SIM } from '../src/Config/Tuning.js';

export const DT = 1 / SIM.TICK_RATE;

/** Mundo com chão plano 100×100 m. */
export function makeWorld(build) {
  const w = new PhysicsWorld();
  w.add(new BoxCollider(-50, -2, -50, 50, 0, 50, 'floor', 'floor'));
  if (build) build(w);
  w.build();
  return w;
}

export const box = (w, x0, y0, z0, x1, y1, z1, surface = 'concrete') => w.add(new BoxCollider(x0, y0, z0, x1, y1, z1, surface));
export const ramp = (w, x0, y0, z0, x1, y1, z1, dir, surface = 'concrete') => w.add(new RampCollider(x0, y0, z0, x1, y1, z1, dir, surface));

export function makeBody(world, x = 0, y = 0, z = 0) {
  const b = new CharacterBody(world);
  b.teleport(x, y, z);
  return b;
}

export const cmd = (o = {}) => ({ moveX: 0, moveZ: 0, yaw: 0, jump: false, crouch: false, run: false, ...o });

/** Roda `seconds` de simulação; `jumpFirst` só aplica o pulo no primeiro tick. Retorna o histórico opcional. */
export function run(body, c, seconds, { jumpFirst = false, onTick = null, speedMul = 1 } = {}) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const cc = jumpFirst ? { ...c, jump: c.jump && i === 0 } : c;
    stepMovement(body, cc, DT, speedMul);
    if (onTick) onTick(body, i);
  }
}
