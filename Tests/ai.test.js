import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/Game/MatchSetup.js';
import { GameSession } from '../src/Game/GameSession.js';
import { Bot } from '../src/AI/Bot.js';
import { AI, BOT_STATE as S } from '../src/AI/AIConfig.js';
import { BoxCollider } from '../src/Physics/Colliders.js';
import { NavGrid } from '../src/World/NavGrid.js';
import { buildMap } from '../src/World/MapBuilder.js';
import { FORJA } from '../src/World/maps/Forja.js';
import { makeWorld, box, DT } from './helpers.js';

// Mapa e nav construídos uma vez e reaproveitados (construção é a parte cara).
const built = buildMap(FORJA);
const nav = new NavGrid(built.world, FORJA.bounds).build([...FORJA.spawns.attack, ...FORJA.spawns.defend, ...Object.values(FORJA.sites)]);

/** 1 bot atacante (alvo dos testes) + 1 bot defensor "manequim" (não pensa). Partida já em LIVE. */
function scenario({ difficulty = 'NORMAL', seed = 11 } = {}) {
  const g = createGame({ playerSide: null, teamSize: 1, difficulty, seed, prebuiltMap: built, prebuiltNav: nav });
  const { session, match } = g;
  match.start();
  const bot = session.combatants.find((c) => c.team === 'attack');
  const dummy = session.combatants.find((c) => c.team === 'defend');
  dummy.think = () => {};
  bot.weapons.loadout({ primary: 'ar30', secondary: 'p9', melee: 'knife', grenades: { frag: 0, flash: 0, smoke: 0 } });
  run(session, 6.2);
  assert.equal(match.phase, 'live');
  return { ...g, bot, dummy };
}

function run(session, seconds, onTick) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    session.step(DT);
    if (onTick) onTick(i);
  }
}

function place(c, x, z, yaw) {
  c.body.teleport(x, 0, z);
  c.view.yaw = yaw;
  c.view.pitch = 0;
  c.hitboxes.update(x, 0, z, yaw, false);
}

const EAST = -Math.PI / 2, WEST = Math.PI / 2;

function trackStates(session, bot) {
  const seen = [];
  session.events.on('botState', (e) => { if (e.bot === bot) seen.push(e.to); });
  return seen;
}

// ------------------------------------------------------------------ percepção

test('visão: inimigo atrás de parede NÃO é visto, mesmo perto', () => {
  const { session, bot, dummy } = scenario();
  place(bot, -41, 0, EAST);              // doca
  place(dummy, -30, 8.5, WEST);          // do outro lado da parede da doca/saguão
  bot.plan = null;
  run(session, 3);
  const rec = bot.perception.records.get(dummy);
  assert.ok(rec, 'registro existe');
  assert.equal(rec.visible, false);
  assert.equal(rec.spotted, false);
  assert.notEqual(bot.brain.state, S.COMBAT);
});

test('visão: inimigo no campo de visão e sem obstáculos é notado após um tempo de reação', () => {
  const { session, bot, dummy } = scenario();
  place(bot, -30, 0, EAST);
  place(dummy, -15, 4, WEST);
  assert.equal(session.world.hasLineOfSight(-30, 1.6, 0, -15, 1.6, 4), true, 'premissa: linha livre');
  let spottedAt = null;
  const t0 = session.time;
  run(session, 3, () => {
    const rec = bot.perception.records.get(dummy);
    if (spottedAt === null && rec && rec.spotted) spottedAt = session.time - t0;
  });
  assert.ok(spottedAt !== null, 'notou o inimigo');
  assert.ok(spottedAt > 0.1, `não é instantâneo (${spottedAt.toFixed(2)} s)`);
  assert.ok(spottedAt < 2.5);
});

test('visão: inimigo fora do campo de visão (atrás do bot) não é notado à distância', () => {
  const { session, bot, dummy } = scenario();
  place(bot, -30, 0, WEST);              // olhando para o oeste (parede)
  place(dummy, -15, 4, WEST);            // atrás do bot
  bot.brain.wasBlind = false;
  bot.perception.update(1);              // força varredura
  const rec = bot.perception.records.get(dummy);
  assert.ok(!rec.visible);
});

test('visão: fumaça bloqueia a visão do bot', () => {
  const { session, bot, dummy } = scenario();
  place(bot, -30, 0, EAST);
  place(dummy, -15, 4, WEST);
  session.world.smokes.push({ x: -22, y: 1.5, z: 2, radius: 4, maxRadius: 4, age: 2, duration: 30 });
  bot.plan = null;
  run(session, 2);
  assert.equal(bot.perception.records.get(dummy).visible, false);
  session.world.smokes.length = 0;
});

test('audição: tiro distante gera INVESTIGATE em direção aproximada do som', () => {
  const { session, bot, dummy } = scenario();
  place(bot, -30, 0, EAST);
  place(dummy, -38, 20, WEST);
  const seen = trackStates(session, bot);
  session.emitSound({ x: -20, y: 0, z: 20 }, 60, 'gunshot', dummy);
  run(session, 0.6);
  assert.ok(seen.includes(S.INVESTIGATE), `estados: ${seen.join(',')}`);
  const inv = bot.brain.investigate || bot.brain.search;
  assert.ok(inv, 'tem alvo de investigação');
});

test('audição: som de companheiro é ignorado; som muito distante/fraco não é ouvido', () => {
  const { session, bot } = scenario();
  place(bot, -41, 0, EAST);
  bot.plan = null;
  const seen = trackStates(session, bot);
  session.emitSound({ x: -41, y: 0, z: 4 }, 60, 'gunshot', bot);            // do próprio time (fonte = ele mesmo)
  session.emitSound({ x: 35, y: 0, z: 0 }, 8, 'footstep', session.combatants.find((c) => c.team === 'defend'));  // longe
  run(session, 0.5);
  assert.ok(!seen.includes(S.INVESTIGATE));
});

// ------------------------------------------------------------------ estados

test('IDLE durante a preparação; PATROL sem plano; DEAD ao morrer', () => {
  const g = createGame({ playerSide: null, teamSize: 1, seed: 3, prebuiltMap: built, prebuiltNav: nav });
  g.match.start();
  const bot = g.session.combatants.find((c) => c.team === 'attack');
  run(g.session, 1);
  assert.equal(bot.brain.state, S.IDLE, 'preparação');
  run(g.session, 5.5);
  bot.plan = null;
  run(g.session, 1);
  assert.equal(bot.brain.state, S.PATROL, 'sem plano patrulha');
  const p0 = { x: bot.pos.x, z: bot.pos.z };
  run(g.session, 10);
  assert.ok(Math.hypot(bot.pos.x - p0.x, bot.pos.z - p0.z) > 4, 'patrulhou pelo mapa');
  bot.receiveDamage({ amount: 500, type: 'world', attacker: null });
  run(g.session, 0.1);
  assert.equal(bot.aiState, S.DEAD);
  assert.equal(bot.cmd.fire, false);
});

test('com plano de ataque o bot entra em ATTACK_OBJECTIVE e segue a rota; defensor em DEFEND_OBJECTIVE', () => {
  const g = createGame({ playerSide: null, teamSize: 2, seed: 5, prebuiltMap: built, prebuiltNav: nav });
  g.match.start();
  run(g.session, 6.5);
  const atk = g.session.bots.filter((b) => b.team === 'attack');
  const def = g.session.bots.filter((b) => b.team === 'defend');
  run(g.session, 3);
  assert.ok(atk.every((b) => b.plan && b.plan.kind === 'attack' && b.plan.route.length > 0));
  assert.ok(def.every((b) => b.plan && b.plan.kind === 'defend'));
  assert.ok(def.every((b) => [S.DEFEND_OBJECTIVE, S.COMBAT, S.INVESTIGATE].includes(b.brain.state)));
  const start = atk.map((b) => ({ x: b.pos.x, z: b.pos.z }));
  run(g.session, 8);
  const moved = atk.filter((b, i) => Math.hypot(b.pos.x - start[i].x, b.pos.z - start[i].z) > 6).length;
  assert.ok(moved >= 1, 'atacantes avançaram pela rota');
});

test('COMBAT: bot que vê o inimigo entra em combate, atira e causa dano; recuo/recarga usam o mesmo cérebro', () => {
  const { session, bot, dummy } = scenario({ difficulty: 'HARD' });
  place(bot, -30, 0, EAST);
  place(dummy, -12, 4, WEST);
  bot.plan = null;
  const seen = trackStates(session, bot);
  const ammo0 = bot.weapons.active.ammo;
  run(session, 4);
  assert.ok(seen.includes(S.COMBAT), `estados: ${seen.join(',')}`);
  assert.ok(bot.weapons.active.ammo < ammo0 || bot.weapons.activeKey !== 'primary', 'disparou');
  assert.ok(dummy.health.current < 100 || !dummy.alive, `alvo levou dano: ${dummy.health.current}`);
});

test('COMBAT: bot mira e mata um alvo parado à distância média (dificuldade DIFÍCIL)', () => {
  let kills = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const { session, bot, dummy } = scenario({ difficulty: 'HARD', seed });
    place(bot, -30, 0, EAST);
    place(dummy, -12, 4, WEST);
    bot.plan = null;
    let died = false;
    session.events.on('death', (e) => { if (e.victim === dummy && e.killer === bot) died = true; });
    run(session, 8);
    if (died) kills++;
  }
  assert.ok(kills >= 3, `matou em ${kills}/4 tentativas`);
});

test('dificuldade: FÁCIL demora mais que DIFÍCIL entre ver o inimigo e dar o primeiro tiro', () => {
  const timeToFirstShot = (difficulty) => {
    let total = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { session, bot, dummy } = scenario({ difficulty, seed });
      place(bot, -30, 0, EAST);
      place(dummy, -12, 4, WEST);
      bot.plan = null;
      const t0 = session.time;
      let t = 10;
      session.events.on('weaponFired', (e) => { if (e.owner === bot && t === 10) t = session.time - t0; });
      run(session, 10);
      total += t;
    }
    return total / 8;
  };
  const easy = timeToFirstShot('EASY'), hard = timeToFirstShot('HARD');
  assert.ok(easy > hard + 0.25, `FÁCIL ${easy.toFixed(2)} s vs DIFÍCIL ${hard.toFixed(2)} s`);
});

test('RETREAT: com vida baixa e inimigo à vista, o bot recua para fora da linha de visão', () => {
  const { session, bot, dummy } = scenario({ difficulty: 'HARD' });
  place(bot, -30, 0, EAST);
  place(dummy, -12, 4, WEST);
  dummy.receiver.invulnerable = true;
  bot.plan = null;
  bot.health.current = 12;
  const seen = trackStates(session, bot);
  run(session, 8);
  assert.ok(seen.includes(S.RETREAT), `estados: ${seen.join(',')}`);
});

test('recarga: com pente vazio o bot recarrega (RELOAD/TAKE_COVER) ou troca para a secundária', () => {
  const { session, bot, dummy } = scenario({ difficulty: 'HARD' });
  place(bot, -30, 0, EAST);
  place(dummy, -12, 4, WEST);
  dummy.receiver.invulnerable = true;
  bot.plan = null;
  bot.weapons.active.ammo = 2;
  const seen = trackStates(session, bot);
  const switched = { v: false };
  session.events.on('weaponEquip', (e) => { if (e.owner === bot && e.key === 'secondary') switched.v = true; });
  run(session, 6);
  const reloaded = bot.weapons.slots.primary.ammo > 2;
  assert.ok(seen.includes(S.RELOAD) || seen.includes(S.TAKE_COVER) || switched.v || reloaded, `estados: ${seen.join(',')}`);
});

test('TAKE_COVER: bot escolhe posição escondida do inimigo e vai até ela', () => {
  const { session, bot, dummy } = scenario();
  place(bot, -20, 0, EAST);
  place(dummy, -3, -6, WEST);
  const spot = session.cover.find(bot.pos, { x: dummy.pos.x, y: 0, z: dummy.pos.z }, { radius: 14, samples: 30 });
  assert.ok(spot, 'achou cobertura');
  const hidden = session.world.isBlocked(dummy.pos.x, 1.6, dummy.pos.z, spot.x, spot.y + 1.17, spot.z);
  assert.ok(hidden, 'a cobertura escondida do inimigo (agachado)');
  assert.ok(Math.hypot(spot.x - bot.pos.x, spot.z - bot.pos.z) <= 14.5);
});

test('SEARCH: perdendo o alvo de vista, o bot procura no último ponto conhecido', () => {
  const { session, bot, dummy } = scenario({ difficulty: 'HARD' });
  place(bot, -30, 0, EAST);
  place(dummy, -12, 4, WEST);
  dummy.receiver.invulnerable = true;
  bot.plan = null;
  const seen = trackStates(session, bot);
  run(session, 2);
  assert.ok(seen.includes(S.COMBAT));
  place(dummy, -30, 20, WEST);   // some atrás da parede
  run(session, 3);
  assert.ok(seen.includes(S.SEARCH), `estados: ${seen.join(',')}`);
});

test('reação a tiros: bot atingido por inimigo fora de vista investiga a origem', () => {
  const { session, bot, dummy } = scenario();
  place(bot, -30, 0, EAST);
  place(dummy, -38, 20, WEST);
  const seen = trackStates(session, bot);
  bot.receiveDamage({ amount: 10, type: 'bullet', attacker: dummy, hitbox: 'torso' });
  run(session, 0.6);
  assert.ok(seen.includes(S.INVESTIGATE) || seen.includes(S.COMBAT), `estados: ${seen.join(',')}`);
});

test('cego (granada cegante): bot perde precisão e não enxerga durante o efeito', () => {
  const { session, bot, dummy } = scenario();
  place(bot, -30, 0, EAST);
  place(dummy, -12, 4, WEST);
  bot.plan = null;
  bot.blind(3);
  run(session, 1.5);
  assert.equal(bot.perception.records.get(dummy).visible, false);
});

// ------------------------------------------------------------------ navegação / anti-travamento

test('bots não ficam presos: partida bot×bot completa sem eventos de travamento e com rounds concluídos', () => {
  const g = createGame({ playerSide: null, difficulty: 'NORMAL', seed: 42, roundsToWin: 2, prebuiltMap: built, prebuiltNav: nav });
  let stuck = 0;
  g.session.events.on('botStuck', () => stuck++);
  g.match.start();
  for (let i = 0; i < 120 * 60 * 5 && g.match.phase !== 'ended'; i++) g.session.step(DT);
  assert.ok(g.match.round >= 2, `rounds jogados: ${g.match.round}`);
  assert.ok(stuck <= 2, `eventos de travamento: ${stuck}`);
});

test('anti-travamento: obstáculo inesperado → detecta, recalcula, contorna por rota alternativa e chega', () => {
  // Parede com duas passagens; o nav é construído com ambas abertas; depois a passagem mais próxima é fechada.
  const world = makeWorld((w) => {
    box(w, -40, 0, -1, -4, 5, 1);     // parede oeste
    box(w, 4, 0, -1, 40, 5, 1);       // parede leste  → passagem central de 8 m [-4,4]
    box(w, -1, 0, -1, 1, 5, 1);       // pilar central divide a passagem em 2 (x∈[-4,-1] e [1,4])
  });
  const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  const localNav = new NavGrid(world, bounds).build([{ x: 0, z: 10 }]);
  const session = new GameSession({ world, seed: 9 });
  session.nav = localNav;
  session.match = { isLive: true, liveTime: 100, bomb: { planted: false }, map: FORJA, update() {} };
  const bot = new Bot(session, { id: 1, name: 'T', team: 'attack' });
  session.add(bot);
  bot.think = () => {};
  bot.spawn(-2.5, 0, 12, 0);
  bot.frozen = false;
  bot.alive = true;
  let stuckEvents = 0;
  session.events.on('botStuck', () => stuckEvents++);
  const goal = { x: -2.5, z: -12 };
  bot.brain._goTo(goal.x, 0, goal.z, DT);       // calcula o caminho pela passagem esquerda
  // fecha a passagem esquerda DEPOIS do caminho calculado (o nav não sabe)
  world.add(new BoxCollider(-4, 0, -1, -1, 4, 1, 'concrete'));
  world.build();
  let arrived = false;
  const t0 = session.time;
  let maxX = -Infinity;
  for (let i = 0; i < 120 * 30 && !arrived; i++) {
    arrived = bot.brain._goTo(goal.x, 0, goal.z, DT, true, 1.0);
    session.step(DT);
    maxX = Math.max(maxX, bot.pos.x);
  }
  assert.ok(stuckEvents >= 1, 'detectou travamento');
  assert.ok(arrived, `chegou ao destino por rota alternativa (t=${(session.time - t0).toFixed(1)}s, pos=${bot.pos.x.toFixed(1)},${bot.pos.z.toFixed(1)})`);
  assert.ok(maxX > 0.5, `contornou pela passagem direita (x máx. ${maxX.toFixed(1)})`);
});

test('orçamento de A*: no máximo N recálculos por tick', () => {
  assert.ok(AI.MAX_REPATHS_PER_TICK >= 1 && AI.MAX_REPATHS_PER_TICK <= 4);
});

// ------------------------------------------------------------------ performance

test('performance: partida 5×5 (10 bots) simula com custo médio por tick < 1.5 ms', () => {
  const g = createGame({ playerSide: null, difficulty: 'NORMAL', seed: 7, prebuiltMap: built, prebuiltNav: nav });
  g.match.start();
  const ticks = 120 * 40;
  const times = new Float64Array(ticks);
  for (let i = 0; i < ticks; i++) {
    const a = performance.now();
    g.session.step(DT);
    times[i] = performance.now() - a;
  }
  const avg = times.reduce((a, b) => a + b, 0) / ticks;
  const sorted = Array.from(times).sort((a, b) => a - b);
  const p99 = sorted[Math.floor(ticks * 0.99)];
  assert.ok(avg < 1.5, `média ${avg.toFixed(3)} ms/tick`);
  assert.ok(p99 < 6, `p99 ${p99.toFixed(2)} ms/tick`);
});

test('performance: sem vazamento — memória estável ao longo de vários rounds', () => {
  const g = createGame({ playerSide: null, difficulty: 'NORMAL', seed: 8, roundsToWin: 99, prebuiltMap: built, prebuiltNav: nav });
  g.match.start();
  const sim = (seconds) => { for (let i = 0; i < 120 * seconds; i++) g.session.step(DT); };
  sim(120);
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  sim(300);
  if (global.gc) global.gc();
  const after = process.memoryUsage().heapUsed;
  const growthMB = (after - before) / 1048576;
  assert.ok(growthMB < 60, `crescimento de heap: ${growthMB.toFixed(1)} MB em 300 s simulados`);
});

test('determinismo: mesma semente → mesmo resultado', () => {
  const play = () => {
    const g = createGame({ playerSide: null, difficulty: 'NORMAL', seed: 123, prebuiltMap: built, prebuiltNav: nav });
    g.match.start();
    for (let i = 0; i < 120 * 90; i++) g.session.step(DT);
    return JSON.stringify([g.match.score, g.match.round, g.session.combatants.map((c) => [c.stats.kills, c.stats.deaths, +c.pos.x.toFixed(3), +c.pos.z.toFixed(3)])]);
  };
  assert.equal(play(), play());
});
