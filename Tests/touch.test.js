import test from 'node:test';
import assert from 'node:assert/strict';
import { stickToMove } from '../src/Systems/TouchControls.js';
import { computeAssist, ASSIST } from '../src/Player/AimAssist.js';
import { createGame } from '../src/Game/MatchSetup.js';
import { MOVEMENT } from '../src/Config/Tuning.js';
import { buildMap } from '../src/World/MapBuilder.js';
import { FORJA } from '../src/World/maps/Forja.js';
import { NavGrid } from '../src/World/NavGrid.js';
import { makeBody, makeWorld, cmd, run } from './helpers.js';

const R = 62;

test('joystick: zona morta, direção e escala analógica', () => {
  assert.deepEqual(stickToMove(3, 2, R), { moveX: 0, moveZ: 0, run: false, magnitude: 0 }, 'zona morta');
  const fwd = stickToMove(0, -40, R);
  assert.ok(fwd.moveZ > 0 && Math.abs(fwd.moveX) < 1e-9, 'dedo para cima = frente');
  const back = stickToMove(0, 40, R);
  assert.ok(back.moveZ < 0, 'dedo para baixo = trás');
  const right = stickToMove(40, 0, R);
  assert.ok(right.moveX > 0 && Math.abs(right.moveZ) < 1e-9, 'dedo para a direita = direita');
  const half = stickToMove(0, -R * 0.5, R);
  const most = stickToMove(0, -R * 0.85, R);
  assert.ok(half.moveZ > 0 && half.moveZ < most.moveZ && most.moveZ <= 1, 'velocidade cresce com o deslocamento');
  assert.equal(half.run, false);
});

test('joystick: empurrar até o limite corre; histerese evita oscilação', () => {
  assert.equal(stickToMove(0, -R * 0.99, R).run, true);
  assert.equal(stickToMove(0, -R * 0.99, R).moveZ, 1);
  assert.equal(stickToMove(0, -R * 0.86, R, false).run, false, 'sem estar correndo, 86% ainda caminha');
  assert.equal(stickToMove(0, -R * 0.86, R, true).run, true, 'já correndo, 86% continua correndo');
  assert.equal(stickToMove(0, -R * 0.7, R, true).run, false, 'abaixo de 80% para de correr');
  // muito além do raio: satura em 1
  const far = stickToMove(500, 0, R);
  assert.ok(Math.hypot(far.moveX, far.moveZ) <= 1.0001);
});

test('joystick + física: caminhar analógico chega perto de WALK_SPEED e correr em RUN_SPEED', () => {
  const world = makeWorld();
  const body = makeBody(world);
  const m = stickToMove(0, -R * 0.9, R);
  run(body, cmd({ moveX: m.moveX, moveZ: m.moveZ, run: m.run }), 1.0);
  assert.ok(body.speedXZ > MOVEMENT.WALK_SPEED * 0.9 && body.speedXZ <= MOVEMENT.WALK_SPEED + 0.01, `caminhada ${body.speedXZ}`);
  const r = stickToMove(0, -R, R);
  run(body, cmd({ moveX: r.moveX, moveZ: r.moveZ, run: r.run }), 1.0);
  assert.ok(Math.abs(body.speedXZ - MOVEMENT.RUN_SPEED) < 0.05, `corrida ${body.speedXZ}`);
});

// ---------------------------------------------------------------- assistência de mira

const built = buildMap(FORJA);
const nav = new NavGrid(built.world, FORJA.bounds).build([...FORJA.spawns.attack, ...FORJA.spawns.defend, ...Object.values(FORJA.sites)]);

function scene() {
  const g = createGame({ playerSide: 'attack', teamSize: 2, seed: 3, prebuiltMap: built, prebuiltNav: nav });
  g.match.start();
  for (const b of g.session.bots) b.think = () => {};
  const p = g.player;
  const enemy = g.session.bots.find((b) => b.team === 'defend');
  const mate = g.session.bots.find((b) => b.team === 'attack');
  // corredor longo e livre (galpão norte, z ≈ -25.5): jogador olhando para leste
  p.body.teleport(-28, 0, -25.5);
  p.view.yaw = -Math.PI / 2; p.view.pitch = 0;
  mate.body.teleport(-41, 0, 8);
  for (const b of g.session.bots) if (b !== enemy && b !== mate) b.body.teleport(36, 0, 0);
  return { g, p, enemy, mate };
}

const placeEnemy = (e, x, z) => { e.body.teleport(x, 0, z); e.hitboxes.update(x, 0, z, 0, false); };
const LOS = (g, x, z) => g.session.world.hasLineOfSight(-28, 1.62, -25.5, x, 1.15, z);

test('assistência de mira: puxa em direção ao inimigo visível dentro do cone', () => {
  const { g, p, enemy } = scene();
  placeEnemy(enemy, -10, -26.7);      // ≈ 3,8° do centro
  assert.equal(LOS(g, -10, -26.7), true, 'premissa: visível');
  const a = computeAssist(p, g.session);
  assert.ok(a, 'achou alvo');
  assert.ok(a.weight > 0 && a.weight <= 1);
  const before = Math.abs(a.dyaw) + Math.abs(a.dpitch);
  // aplica correções sucessivas (como o jogo faz a cada frame): o erro angular diminui
  for (let i = 0; i < 40; i++) {
    const c = computeAssist(p, g.session);
    if (!c) break;
    const k = 0.6 * c.weight * (1 - Math.exp(-ASSIST.RATE / 60));
    p.view.yaw += c.dyaw * k;
    p.view.pitch += c.dpitch * k;
  }
  const after = computeAssist(p, g.session);
  assert.ok(after, 'segue no cone');
  assert.ok(Math.abs(after.dyaw) + Math.abs(after.dpitch) < before * 0.5, 'a mira convergiu para o inimigo');
});

test('assistência de mira: ignora inimigo fora do cone, atrás, atrás de parede, morto e aliados', () => {
  const { g, p, enemy, mate } = scene();
  placeEnemy(enemy, -10, -30.4);                               // ≈ 15° do centro: fora do cone
  assert.equal(computeAssist(p, g.session), null, 'fora do cone');

  placeEnemy(enemy, -30.2, -25.5);                             // atrás de você
  assert.equal(computeAssist(p, g.session), null, 'atrás');

  placeEnemy(enemy, -8, -28.0);                                // dentro do cone (≈7°) mas atrás de um pilar
  assert.equal(LOS(g, -8, -28.0), false, 'premissa: pilar no meio');
  assert.equal(computeAssist(p, g.session), null, 'parede/pilar bloqueia');

  placeEnemy(enemy, -10, -26.7);
  assert.ok(computeAssist(p, g.session), 'visível de novo');
  placeEnemy(mate, -14, -25.5);                                // aliado no centro da mira
  assert.ok(computeAssist(p, g.session).weight < 1, 'aliado não é alvo (o inimigo mais afastado do centro é)');
  enemy.receiveDamage({ amount: 999, type: 'world', attacker: null });
  assert.equal(computeAssist(p, g.session), null, 'morto não conta e aliado não conta');
});

test('assistência de mira: escolhe o inimigo mais próximo do centro', () => {
  const { g, p, enemy } = scene();
  const other = g.session.bots.find((b) => b.team === 'defend' && b !== enemy);
  assert.ok(other, 'há um segundo inimigo');
  placeEnemy(enemy, -8, -26.2);                                // ≈ 2° do centro
  placeEnemy(other, -14, -25.5);                               // exatamente no centro
  const a = computeAssist(p, g.session);
  assert.ok(a, 'achou alvo');
  assert.ok(Math.abs(a.dyaw) < 0.002, `escolheu o alvo central (correção lateral ${(a.dyaw * 57.3).toFixed(2)}°)`); // o outro exigiria ≈ 2°
});
