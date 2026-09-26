import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVEMENT, PLAYER } from '../src/Config/Tuning.js';
import { makeWorld, makeBody, box, ramp, cmd, run, DT } from './helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} esperado ${b} ± ${tol}, obtido ${a}`);

test('andar: acelera até WALK_SPEED e mantém velocidade estável', () => {
  const w = makeWorld();
  const b = makeBody(w);
  run(b, cmd({ moveZ: 1 }), 1.0);
  near(b.speedXZ, MOVEMENT.WALK_SPEED, 0.01, 'velocidade de caminhada');
  assert.ok(b.pos.z < -3.0, 'avançou para -Z (yaw 0 olha para -Z)');
  assert.ok(b.onGround);
});

test('correr (Shift) atinge RUN_SPEED; agachar limita a CROUCH_SPEED', () => {
  const w = makeWorld();
  const b = makeBody(w);
  run(b, cmd({ moveZ: 1, run: true }), 1.0);
  near(b.speedXZ, MOVEMENT.RUN_SPEED, 0.01, 'corrida');
  run(b, cmd({ moveZ: 1, run: true, crouch: true }), 1.0);
  near(b.speedXZ, MOVEMENT.CROUCH_SPEED, 0.05, 'agachado ignora shift');
});

test('aceleração: chega a 90% da velocidade em menos de 0.25 s (sem sensação de deslizar)', () => {
  const w = makeWorld();
  const b = makeBody(w);
  let t90 = null;
  run(b, cmd({ moveZ: 1, run: true }), 0.6, {
    onTick: (bb, i) => { if (t90 === null && bb.speedXZ >= MOVEMENT.RUN_SPEED * 0.9) t90 = (i + 1) * DT; },
  });
  assert.ok(t90 !== null && t90 < 0.25, `t90=${t90}`);
});

test('parar de correr: velocidade zera em menos de 0.35 s', () => {
  const w = makeWorld();
  const b = makeBody(w);
  run(b, cmd({ moveZ: 1, run: true }), 1.0);
  let tStop = null;
  run(b, cmd(), 0.6, { onTick: (bb, i) => { if (tStop === null && bb.speedXZ < 0.05) tStop = (i + 1) * DT; } });
  assert.ok(tStop !== null && tStop < 0.35, `tStop=${tStop}`);
});

test('mudar rapidamente de direção (counter-strafe): inverte em menos de 0.22 s', () => {
  const w = makeWorld();
  const b = makeBody(w);
  run(b, cmd({ moveX: 1, run: true }), 0.8);
  assert.ok(b.vel.x > 5.5);
  let tFlip = null;
  run(b, cmd({ moveX: -1, run: true }), 0.6, { onTick: (bb, i) => { if (tFlip === null && bb.vel.x < 0) tFlip = (i + 1) * DT; } });
  assert.ok(tFlip !== null && tFlip < 0.22, `tFlip=${tFlip}`);
});

test('diagonal não é mais rápida que reta (input normalizado)', () => {
  const w = makeWorld();
  const b = makeBody(w);
  run(b, cmd({ moveX: 1, moveZ: 1, run: true }), 1.0);
  near(b.speedXZ, MOVEMENT.RUN_SPEED, 0.02, 'diagonal');
});

test('multiplicador de velocidade da arma reduz a velocidade máxima', () => {
  const w = makeWorld();
  const b = makeBody(w);
  run(b, cmd({ moveZ: 1, run: true }), 1.0, { speedMul: 0.9 });
  near(b.speedXZ, MOVEMENT.RUN_SPEED * 0.9, 0.02);
});

test('parede: andar contra parede para o personagem sem atravessar', () => {
  const w = makeWorld((ww) => box(ww, -5, 0, -10, 5, 4, -9));
  const b = makeBody(w, 0, 0, 0);
  run(b, cmd({ moveZ: 1, run: true }), 4.0);
  const wallFace = -9 + PLAYER.RADIUS;
  assert.ok(b.pos.z >= wallFace - 1e-3, `z=${b.pos.z}`);
  assert.ok(b.pos.z < wallFace + 0.05, 'encostou (sem grande vão)');
  near(b.speedXZ, 0, 0.01, 'velocidade zerada contra a parede');
});

test('parede: movimento diagonal contra parede desliza ao longo dela', () => {
  const w = makeWorld((ww) => box(ww, -20, 0, -10, 20, 4, -9));
  const b = makeBody(w, 0, 0, -5);
  run(b, cmd({ moveZ: 1, moveX: 1, run: true }), 2.0);
  assert.ok(b.pos.x > 4, `deslizou em X: ${b.pos.x}`);
  assert.ok(b.pos.z >= -9 + PLAYER.RADIUS - 1e-3);
});

test('cantos: contorna quina de pilar sem travar', () => {
  const w = makeWorld((ww) => box(ww, -1, 0, -6, 1, 3, -4));
  const b = makeBody(w, -0.9, 0, 0);
  run(b, cmd({ moveZ: 1, moveX: -0.2, run: true }), 2.5);
  assert.ok(b.pos.z < -6.5, `passou pelo pilar: z=${b.pos.z}`);
});

test('subir pequenos obstáculos: degrau de 0.30 m é subido sem pular', () => {
  const w = makeWorld((ww) => box(ww, -5, 0, -6, 5, 0.3, -4));
  const b = makeBody(w, 0, 0, 0);
  run(b, cmd({ moveZ: 1 }), 1.5);
  near(b.pos.y, 0.3, 1e-6, 'em cima do degrau');
  assert.ok(b.pos.z < -4.5);
  assert.ok(b.onGround);
});

test('obstáculo alto: 0.80 m bloqueia andando, mas pulando sobe', () => {
  const w = makeWorld((ww) => box(ww, -5, 0, -6, 5, 0.8, -4));
  const b = makeBody(w, 0, 0, 0);
  run(b, cmd({ moveZ: 1 }), 2.0);
  const face = -4 + PLAYER.RADIUS;
  assert.ok(b.pos.z >= face - 1e-3 && b.pos.z < face + 0.05, `bloqueado: z=${b.pos.z}`);
  assert.equal(b.pos.y, 0);

  const b2 = makeBody(w, 0, 0, 0);
  run(b2, cmd({ moveZ: 1, run: true }), 0.3);                       // corrida de aproximação
  run(b2, cmd({ moveZ: 1, run: true, jump: true }), 0.62, { jumpFirst: true });
  run(b2, cmd(), 1.0);
  near(b2.pos.y, 0.8, 1e-6, 'pousou em cima da caixa de 0.8');
  assert.ok(b2.onGround);
});

test('escada: sequência de degraus de 0.2 m é subida continuamente', () => {
  const w = makeWorld((ww) => {
    for (let i = 0; i < 10; i++) box(ww, -2, 0, -3.4 - i * 0.4, 2, 0.2 * (i + 1), -3 - i * 0.4);
    box(ww, -2, 0, -12, 2, 2.0, -7.4);
  });
  const b = makeBody(w, 0, 0, 0);
  run(b, cmd({ moveZ: 1, run: true }), 1.8);
  near(b.pos.y, 2.0, 1e-6, 'topo da escada');
  assert.ok(b.onGround);
});

test('descer escada mantém o personagem no chão (sem cair a cada degrau)', () => {
  const w = makeWorld((ww) => {
    for (let i = 0; i < 10; i++) box(ww, -2, 0, -3.4 - i * 0.4, 2, 2.0 - 0.2 * i, -3 - i * 0.4);
  });
  const b = makeBody(w, 0, 2.0, -3.2);
  assert.ok(b.onGround);
  let airTicks = 0;
  run(b, cmd({ moveZ: 1, run: true }), 1.2, { onTick: (bb) => { if (!bb.onGround) airTicks++; } });
  assert.equal(airTicks, 0, 'nunca ficou no ar descendo a escada');
  near(b.pos.y, 0, 1e-6);
});

test('rampa: sobe rampa de 16° mantendo velocidade e colado ao chão', () => {
  const w = makeWorld((ww) => ramp(ww, -3, 0, -10, 3, 2.3, -2, '-z'));
  const b = makeBody(w, 0, 0, 0);
  let airTicks = 0;
  run(b, cmd({ moveZ: 1, run: true }), 1.6, { onTick: (bb) => { if (!bb.onGround) airTicks++; } });
  assert.equal(airTicks, 0);
  assert.ok(b.pos.y > 1.5, `subiu: y=${b.pos.y}`);
  assert.ok(b.speedXZ > MOVEMENT.RUN_SPEED * 0.95);
});

test('rampa: descer rampa não faz o personagem "voar"', () => {
  const w = makeWorld((ww) => ramp(ww, -3, 0, -10, 3, 2.3, -2, '-z'));
  const b = makeBody(w, 0, 2.1, -9);
  assert.ok(b.onGround, 'nasceu apoiado na rampa');
  let airTicks = 0;
  run(b, cmd({ moveZ: -1, run: true }), 1.5, { onTick: (bb) => { if (!bb.onGround) airTicks++; } });
  assert.equal(airTicks, 0);
  assert.ok(b.pos.y < 0.5);
});

test('rampa muito íngreme (>46°) é tratada como parede', () => {
  const w = makeWorld((ww) => ramp(ww, -3, 0, -6, 3, 3, -4, '-z'));
  const b = makeBody(w, 0, 0, 0);
  run(b, cmd({ moveZ: 1, run: true }), 2.0);
  assert.ok(b.pos.y < 0.5, `não subiu: y=${b.pos.y}`);
});

test('pular: apogeu ≈ v²/2g e tempo de voo ≈ 2v/g', () => {
  const w = makeWorld();
  const b = makeBody(w);
  let apex = 0, air = 0;
  run(b, cmd({ jump: true }), 1.2, { jumpFirst: true, onTick: (bb) => { apex = Math.max(apex, bb.pos.y); if (!bb.onGround) air++; } });
  const expectedApex = (MOVEMENT.JUMP_FORCE ** 2) / (2 * MOVEMENT.GRAVITY);
  near(apex, expectedApex, 0.03, 'apogeu');
  near(air * DT, (2 * MOVEMENT.JUMP_FORCE) / MOVEMENT.GRAVITY, 0.05, 'tempo no ar');
  assert.ok(b.onGround);
});

test('buffer de pulo: apertar pulo logo antes de pousar ainda pula', () => {
  const w = makeWorld();
  const b = makeBody(w);
  run(b, cmd({ jump: true }), DT, { jumpFirst: true });
  let guard = 0;
  while (!(b.vel.y < 0 && b.pos.y < 0.12) && guard++ < 2000) run(b, cmd(), DT);
  assert.ok(!b.onGround, 'ainda no ar');
  run(b, cmd({ jump: true }), DT); // 1 tick de "pulo" antes de pousar
  run(b, cmd(), 0.06);
  assert.ok(b.vel.y > 3 || b.pos.y > 0.05, 'pulou ao pousar');
});

test('cair: pouso registra impacto e reduz velocidade horizontal em queda alta', () => {
  const w = makeWorld();
  const b = makeBody(w, 0, 6, 0);
  assert.equal(b.onGround, false);
  b.vel.set(4, 0, 0);
  let impact = 0;
  run(b, cmd(), 2.0, { onTick: (bb) => { if (bb.landed) impact = bb.landImpact; } });
  near(impact, Math.sqrt(2 * MOVEMENT.GRAVITY * 6), 0.4, 'impacto');
  assert.ok(b.onGround);
  assert.ok(b.speedXZ < 4 * 0.7, 'pouso forte reduz velocidade');
});

test('cair de plataforma: personagem cai até o chão e para em y=0', () => {
  const w = makeWorld((ww) => box(ww, -2, 0, -2, 2, 2, 2));
  const b = makeBody(w, 0, 2, 0);
  assert.ok(b.onGround);
  run(b, cmd({ moveX: 1, run: true }), 2.0);
  near(b.pos.y, 0, 1e-6);
  assert.ok(b.pos.x > 2.5);
});

test('agachar: reduz hull e velocidade; teto baixo impede levantar', () => {
  const w = makeWorld((ww) => box(ww, -3, 1.5, -6, 3, 3, 0.5));
  const b = makeBody(w, 0, 0, 3);
  run(b, cmd({ crouch: true }), 0.3);
  assert.equal(b.crouched, true);
  near(b.height, PLAYER.HEIGHT_CROUCH, 1e-9);
  run(b, cmd({ crouch: true, moveZ: 1 }), 2.4);
  assert.ok(b.pos.z < -1.5 && b.pos.z > -5, `passou sob a viga: z=${b.pos.z}`);

  const b2 = makeBody(w, 0, 0, -1);
  b2.setCrouched(true);
  run(b2, cmd({ crouch: false }), 0.3);
  assert.equal(b2.crouched, true, 'continua agachado sob teto baixo');
  b2.pos.z = 4;
  run(b2, cmd({ crouch: false }), 0.1);
  assert.equal(b2.crouched, false);
});

test('em pé não passa sob teto baixo (1.5 m)', () => {
  const w = makeWorld((ww) => box(ww, -3, 1.5, -6, 3, 3, -2));
  const b = makeBody(w, 0, 0, 0);
  run(b, cmd({ moveZ: 1 }), 3.0);
  assert.ok(b.pos.z > -2 + PLAYER.RADIUS - 0.02, `barrado: z=${b.pos.z}`);
});

test('pular sob teto baixo: cabeça bate e velocidade vertical zera', () => {
  const w = makeWorld((ww) => box(ww, -3, 2.0, -3, 3, 3, 3));
  const b = makeBody(w, 0, 0, 0);
  let maxHead = 0;
  run(b, cmd({ jump: true }), 1.0, { jumpFirst: true, onTick: (bb) => { maxHead = Math.max(maxHead, bb.pos.y + bb.height); } });
  assert.ok(maxHead <= 2.0 + 1e-6, `cabeça=${maxHead}`);
});

test('controle aéreo: dá para corrigir levemente a trajetória, sem ganhar velocidade extra', () => {
  const w = makeWorld();
  const b = makeBody(w);
  run(b, cmd({ moveZ: 1, run: true }), 1.0);
  run(b, cmd({ moveZ: 1, run: true, jump: true }), 0.02, { jumpFirst: true });
  const speedTakeoff = b.speedXZ;
  const vx0 = b.vel.x;
  run(b, cmd({ moveX: 1, run: true }), 0.3);
  assert.ok(b.vel.x > vx0 + 0.15, 'strafe no ar altera trajetória');
  assert.ok(b.speedXZ <= speedTakeoff * 1.08, `sem ganho explosivo: ${b.speedXZ} vs ${speedTakeoff}`);
});

test('anti-bhop: pular repetidamente com strafe não ultrapassa o teto de velocidade', () => {
  const w = makeWorld();
  const b = makeBody(w);
  let maxSpeed = 0;
  const n = Math.round(6 / DT);
  for (let i = 0; i < n; i++) {
    // yaw girando (estilo strafe-jump) para tentar ganhar velocidade
    const c = cmd({ moveX: 1, run: true, jump: b.onGround, yaw: i * 0.002 });
    run(b, c, DT);
    maxSpeed = Math.max(maxSpeed, b.speedXZ);
  }
  assert.ok(maxSpeed <= MOVEMENT.RUN_SPEED * MOVEMENT.JUMP_SPEED_CAP * 1.01, `maxSpeed=${maxSpeed}`);
});

test('nunca atravessa parede fina mesmo em velocidade altíssima', () => {
  const w = makeWorld((ww) => box(ww, 3, 0, -5, 3.1, 4, 5));
  const b = makeBody(w, 0, 0, 0);
  b.vel.set(60, 0, 0);
  run(b, cmd({ moveX: 1, run: true }), 0.5);
  assert.ok(b.pos.x < 3, `x=${b.pos.x}`);
});

test('raycast: acerta caixa com normal correta e mede espessura', () => {
  const w = makeWorld((ww) => box(ww, 5, 0, -1, 6, 3, 1));
  const hit = w.raycast(0, 1, 0, 1, 0, 0, 100);
  assert.ok(hit);
  near(hit.t, 5, 1e-6);
  near(hit.tExit - hit.t, 1, 1e-6, 'espessura');
  assert.equal(hit.nx, -1);
});

test('raycast: rampa — topo inclinado e normal correta', () => {
  const w = makeWorld((ww) => ramp(ww, 0, 0, -2, 4, 2, 2, '+x'));
  const hit = w.raycast(2, 5, 0, 0, -1, 0, 100);
  assert.ok(hit);
  near(5 - hit.t, 1.0, 1e-6, 'y do topo em x=2');
  assert.ok(hit.nx < 0 && hit.ny > 0, 'normal aponta para cima e para trás');
  const h2 = w.raycast(-1, 1.5, 0, 1, 0, 0, 100);
  assert.ok(h2);
  near(h2.t, 4, 1e-6, 'raio horizontal entra onde a superfície cruza y=1.5 (x=3)');
});

test('raycast: linha de visão bloqueada por parede e livre sem ela', () => {
  const w = makeWorld((ww) => box(ww, -0.2, 0, -5, 0.2, 4, 5));
  assert.equal(w.hasLineOfSight(-3, 1.6, 0, 3, 1.6, 0), false);
  assert.equal(w.hasLineOfSight(-3, 1.6, 6, 3, 1.6, 6), true);
});

test('fumaça bloqueia linha de visão sem bloquear movimento', () => {
  const w = makeWorld();
  w.smokes.push({ x: 0, y: 1.5, z: 0, radius: 4 });
  assert.equal(w.hasLineOfSight(-8, 1.6, 0, 8, 1.6, 0), false);
  assert.equal(w.isBlocked(-8, 1.6, 0, 8, 1.6, 0), false);
});
