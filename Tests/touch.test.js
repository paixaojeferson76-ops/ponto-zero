import test from 'node:test';
import assert from 'node:assert/strict';
import { stickToMove, decideTouch } from '../src/Systems/TouchControls.js';
import { AimAssist, ASSIST } from '../src/Player/AimAssist.js';
import { DIFFICULTY } from '../src/AI/AIConfig.js';
import { DEG, angleDelta } from '../src/Systems/MathUtil.js';
import { createGame } from '../src/Game/MatchSetup.js';
import { MOVEMENT } from '../src/Config/Tuning.js';
import { buildMap } from '../src/World/MapBuilder.js';
import { FORJA } from '../src/World/maps/Forja.js';
import { NavGrid } from '../src/World/NavGrid.js';
import { makeBody, makeWorld, cmd, run } from './helpers.js';

const R = 62;

// ---------------------------------------------------------------- detecção de celular

const DEV = (o) => ({ maxTouchPoints: 0, ontouchstart: false, mobileUA: false, uaDataMobile: false, iPadOS: false, coarse: false, fine: true, hover: true, ...o });

test('detecção: PC sem toque e notebook com tela de toque continuam em teclado e mouse', () => {
  assert.equal(decideTouch(DEV({})), false, 'PC');
  assert.equal(decideTouch(DEV({ maxTouchPoints: 10, ontouchstart: true })), false, 'notebook com tela de toque (mouse é o ponteiro principal)');
});

test('detecção: celulares e tablets ligam o modo de toque, mesmo quando o navegador reporta mal', () => {
  assert.equal(decideTouch(DEV({ maxTouchPoints: 5, mobileUA: true, coarse: true, fine: false, hover: false })), true, 'Android normal');
  assert.equal(decideTouch(DEV({ maxTouchPoints: 5, ontouchstart: true, coarse: true, fine: false, hover: false })), true, 'modo "site para computador" (UA de PC, mas ponteiro grosso)');
  assert.equal(decideTouch(DEV({ maxTouchPoints: 5, mobileUA: true })), true, 'UA de celular mesmo reportando mouse (fine+hover)');
  assert.equal(decideTouch(DEV({ maxTouchPoints: 5, uaDataMobile: true })), true, 'Client Hints dizem mobile');
  assert.equal(decideTouch(DEV({ maxTouchPoints: 5, iPadOS: true })), true, 'iPad se apresentando como Mac');
  assert.equal(decideTouch(DEV({ maxTouchPoints: 5, fine: false, hover: false })), true, 'sem mouse como ponteiro principal');
  assert.equal(decideTouch(DEV({ mobileUA: true, coarse: true })), false, 'sem suporte a toque não liga (ex.: emulador sem toque)');
});

test('detecção: o caso que mente totalmente (UA de PC + ponteiro "mouse") fica para o plano B do primeiro toque', () => {
  // aqui a decisão automática é "PC"; o jogo liga o modo de toque no primeiro pointerdown do tipo touch (testado no E2E)
  assert.equal(decideTouch(DEV({ maxTouchPoints: 5, ontouchstart: true })), false);
});

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


// ---------------------------------------------------------------- mira grudada

const built = buildMap(FORJA);
const nav = new NavGrid(built.world, FORJA.bounds).build([...FORJA.spawns.attack, ...FORJA.spawns.defend, ...Object.values(FORJA.sites)]);

function scene(difficulty = 'NORMAL') {
  const g = createGame({ playerSide: 'attack', teamSize: 2, difficulty, seed: 3, prebuiltMap: built, prebuiltNav: nav });
  g.match.start();
  for (const b of g.session.bots) b.think = () => {};
  const p = g.player;
  const enemy = g.session.bots.find((b) => b.team === 'defend');
  const other = g.session.bots.find((b) => b.team === 'defend' && b !== enemy);
  const mate = g.session.bots.find((b) => b.team === 'attack');
  // corredor longo e livre (galpão norte, z ≈ -25.5): jogador olhando para leste
  p.body.teleport(-28, 0, -25.5);
  p.hitboxes.update(-28, 0, -25.5, -Math.PI / 2, false);
  p.view.yaw = -Math.PI / 2; p.view.pitch = 0;
  mate.body.teleport(-41, 0, 8);
  other.body.teleport(36, 0, 0);
  return { g, p, enemy, other, mate };
}

const placeEnemy = (e, x, z) => { e.body.teleport(x, 0, z); e.hitboxes.update(x, 0, z, 0, false); };
const LOS = (g, x, z) => g.session.world.hasLineOfSight(-28, 1.62, -25.5, x, 1.15, z);

let clock = 100;
const DT60 = 1 / 60;

/** Roda `n` frames da assistência como o jogo faz (step + apply). Retorna o resultado do último step. */
function frames(assist, p, g, n, o = {}) {
  let last = null;
  for (let i = 0; i < n; i++) {
    clock += DT60;
    last = assist.step(p, g.session, { strength: 0.85, dt: DT60, active: true, lookPx: 0, time: clock, ...o });
    AimAssist.apply(p, last);
  }
  return last;
}

/** Ângulos verdadeiros (rad) do olho do jogador até o ponto de mira do alvo. */
function trueAim(p, c) {
  const e = p.eyeArray(), q = c.body.pos;
  const dx = q.x - e[0], dy = q.y + ASSIST.TARGET_HEIGHT - e[1], dz = q.z - e[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Erro angular (graus) entre a VISÃO e o alvo. */
function viewErr(p, c) {
  const t = trueAim(p, c);
  return Math.hypot(angleDelta(p.view.yaw, t.yaw) * Math.cos(t.pitch), t.pitch - p.view.pitch) / DEG;
}

test('mira grudada: encaixa no inimigo em poucos frames e só então libera o tiro automático', () => {
  const { g, p, enemy } = scene();
  placeEnemy(enemy, -10, -26.7);
  assert.equal(LOS(g, -10, -26.7), true, 'premissa: visível');
  p.view.yaw += 12 * DEG;                                  // mira ≈ 16° fora do inimigo
  const assist = new AimAssist();
  const first = frames(assist, p, g, 1);
  assert.ok(first, 'achou alvo');
  assert.equal(assist.locked, true);
  assert.equal(assist.aligned, false, 'longe demais para atirar sozinho');
  const start = viewErr(p, enemy);
  frames(assist, p, g, 7);
  assert.ok(viewErr(p, enemy) < 1.5, `convergiu em 8 frames (${start.toFixed(1)}° → ${viewErr(p, enemy).toFixed(2)}°)`);
  frames(assist, p, g, 1);
  assert.equal(assist.aligned, true, 'alinhado: libera o tiro automático');
  assert.equal(assist.target, enemy);
});

test('mira grudada: força 0, sem atirar/mirar ou jogador morto não puxam nada', () => {
  const { g, p, enemy } = scene();
  placeEnemy(enemy, -10, -26.7);
  const assist = new AimAssist();
  assert.equal(frames(assist, p, g, 1, { strength: 0 }), null);
  assert.equal(assist.locked, false);
  assert.equal(frames(assist, p, g, 1, { active: false }), null, 'só age enquanto atira/mira');
  assert.equal(assist.locked, false);
  p.receiveDamage({ amount: 999, type: 'world', attacker: null });
  assert.equal(frames(assist, p, g, 1), null, 'morto');
});

test('mira grudada: acompanha o alvo em movimento e não troca de alvo depois de travar', () => {
  const { g, p, enemy, other } = scene();
  placeEnemy(enemy, -10, -26.7);
  const assist = new AimAssist();
  frames(assist, p, g, 12);
  assert.equal(assist.target, enemy);
  placeEnemy(other, -14, -25.5);                           // outro inimigo bem no centro da mira
  let worst = 0;
  for (let i = 0; i < 60; i++) {                           // o alvo anda 3 m de lado (≈ 9,5°)
    placeEnemy(enemy, -10, -26.7 + i * 0.05);
    frames(assist, p, g, 1);
    worst = Math.max(worst, viewErr(p, enemy));
  }
  assert.equal(assist.target, enemy, 'continua no alvo travado');
  assert.ok(worst < 3.2, `acompanhou o movimento (pior erro ${worst.toFixed(2)}°)`);
});

test('mira grudada: arrasto rápido solta a trava por um instante; arrasto leve não', () => {
  const { g, p, enemy } = scene();
  placeEnemy(enemy, -10, -26.7);
  const assist = new AimAssist();
  frames(assist, p, g, 12);
  assert.equal(assist.locked, true);
  frames(assist, p, g, 1, { lookPx: 10 });
  assert.equal(assist.locked, true, 'ajuste fino não solta');
  assert.equal(frames(assist, p, g, 1, { lookPx: 220 }), null, 'flick forte solta');
  assert.equal(assist.locked, false);
  frames(assist, p, g, 8);
  assert.equal(assist.locked, false, 'fica solta durante BREAK_TIME');
  frames(assist, p, g, 20);
  assert.equal(assist.locked, true, 'depois volta a travar');
});

test('mira grudada: cone de captura cresce com a força; depois de travar o cone é maior', () => {
  const { g, p, enemy } = scene();
  placeEnemy(enemy, -14, -30);                             // ≈ 18° do centro (visível)
  assert.equal(LOS(g, -14, -30), true, 'premissa: visível');
  assert.equal(new AimAssist().step(p, g.session, { strength: 0.1, dt: DT60, active: true, lookPx: 0, time: ++clock }), null, 'fraca: fora do cone');
  assert.ok(new AimAssist().step(p, g.session, { strength: 1, dt: DT60, active: true, lookPx: 0, time: ++clock }), 'forte: dentro do cone');

  placeEnemy(enemy, -10, -26.7);                           // ≈ 4°: a força fraca trava
  const assist = new AimAssist();
  const weak = { strength: 0.1 };
  assert.ok(assist.step(p, g.session, { ...weak, dt: DT60, active: true, lookPx: 0, time: ++clock }));
  placeEnemy(enemy, -14, -30);                             // sai para 18°: ainda dentro do cone "grudado" (11° × 1,7 ≈ 19°)
  assert.ok(assist.step(p, g.session, { ...weak, dt: DT60, active: true, lookPx: 0, time: ++clock }), 'mantém a trava');
  placeEnemy(enemy, -14, -32);                             // 25°: passou até do cone grudado
  assert.equal(assist.step(p, g.session, { ...weak, dt: DT60, active: true, lookPx: 0, time: ++clock }), null);
  assert.equal(assist.target, null);
});

test('mira grudada: ignora quem está atrás, atrás de parede, aliados e mortos', () => {
  const { g, p, enemy, mate } = scene();
  const probe = () => { const a = new AimAssist(); frames(a, p, g, 1); return a; };

  placeEnemy(enemy, -30.2, -25.5);                         // atrás de você
  assert.equal(probe().target, null, 'atrás');

  placeEnemy(enemy, -8, -28.0);                            // dentro do cone (≈ 7°) mas atrás de um pilar
  assert.equal(LOS(g, -8, -28.0), false, 'premissa: pilar no meio');
  assert.equal(probe().target, null, 'parede/pilar bloqueia');

  placeEnemy(enemy, -10, -26.7);
  placeEnemy(mate, -14, -25.5);                            // aliado no centro exato da mira
  assert.equal(probe().target, enemy, 'aliado não é alvo');

  enemy.receiveDamage({ amount: 999, type: 'world', attacker: null });
  assert.equal(probe().target, null, 'morto não conta');
});

test('mira grudada: escolhe o inimigo mais próximo do centro', () => {
  const { g, p, enemy, other } = scene();
  placeEnemy(enemy, -8, -26.2);                            // ≈ 2° do centro
  placeEnemy(other, -14, -25.5);                           // exatamente no centro
  const a = new AimAssist();
  frames(a, p, g, 1);
  assert.equal(a.target, other);
});

test('mira grudada: compensa o recoil — a BALA sai no alvo e o tiro automático mede a bala', () => {
  const { g, p, enemy } = scene();
  placeEnemy(enemy, -10, -26.7);
  const t = trueAim(p, enemy);
  p.view.yaw = t.yaw; p.view.pitch = t.pitch;              // visão exatamente no alvo…
  p.weapons.recoil.aimPunch.pitch = 4;                     // …mas o recoil joga a bala 4° para cima
  p.weapons.recoil.aimPunch.yaw = 1.5;
  const assist = new AimAssist();
  frames(assist, p, g, 1, { strength: 1 });
  assert.equal(assist.aligned, false, 'a bala está 4° fora: não atira sozinho ainda');
  frames(assist, p, g, 20, { strength: 1 });
  const after = trueAim(p, enemy);
  const bulletErr = Math.hypot(angleDelta(p.aimYaw(), after.yaw) * Math.cos(after.pitch), p.aimPitch() - after.pitch) / DEG;
  assert.ok(bulletErr < 0.35, `a bala ficou a ${bulletErr.toFixed(2)}° do alvo`);
  frames(assist, p, g, 1, { strength: 1 });
  assert.equal(assist.aligned, true);
});

test('modo toque: accuracyMul reduz a dispersão real do disparo', () => {
  const { p } = scene();
  const base = p.weapons.currentSpread;
  assert.ok(base > 0);
  p.accuracyMul = 0.5;
  assert.ok(Math.abs(p.weapons.currentSpread - base * 0.5) < 1e-9);
});

// ---------------------------------------------------------------- dificuldade "Muito fácil"

test('dificuldade Muito fácil: bot causa menos dano ao mesmo tiro', () => {
  const dmg = (difficulty) => {
    const { g, p, enemy } = scene(difficulty);
    placeEnemy(enemy, -10, -26.7);
    p.armor.current = 0;
    const e = enemy.eyeArray();
    const dx = -28 - e[0], dy = 1.2 - e[1], dz = -25.5 - e[2];
    const def = enemy.weapons.def;
    assert.ok(def && def.magSize > 0, 'o bot tem arma de fogo');
    g.session.ballistics.fire(enemy, def, e[0], e[1], e[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), 0);
    return p.health.max - p.health.current;
  };
  const normal = dmg('NORMAL'), casual = dmg('CASUAL');
  assert.ok(normal > 0, 'o tiro acertou');
  assert.ok(Math.abs(casual / normal - DIFFICULTY.CASUAL.damageMul) < 1e-6, `razão ${(casual / normal).toFixed(3)}`);
});
