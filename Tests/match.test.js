import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/Game/MatchSetup.js';
import { ROUND_PHASE } from '../src/Game/Match.js';
import { MATCH_RULES, TEAM } from '../src/Config/MatchRules.js';
import { buildMap } from '../src/World/MapBuilder.js';
import { FORJA } from '../src/World/maps/Forja.js';
import { NavGrid } from '../src/World/NavGrid.js';
import { DT } from './helpers.js';

const built = buildMap(FORJA);
const nav = new NavGrid(built.world, FORJA.bounds).build([...FORJA.spawns.attack, ...FORJA.spawns.defend, ...Object.values(FORJA.sites)]);

function run(session, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) session.step(DT);
}

/** Jogador atacante + 1 defensor "manequim" (não pensa). */
function game(opts = {}) {
  const g = createGame({ playerSide: TEAM.ATTACK, teamSize: 2, seed: 4, prebuiltMap: built, prebuiltNav: nav, ...opts });
  for (const b of g.session.bots) b.think = () => {};      // bots estáticos: isola as regras
  g.match.start();
  return g;
}

const events = (session, type) => { const a = []; session.events.on(type, (e) => a.push(e)); return a; };

test('início: FREEZE com todos vivos, congelados e armados; round 1', () => {
  const { session, match, player } = game();
  assert.equal(match.phase, ROUND_PHASE.FREEZE);
  assert.equal(match.round, 1);
  for (const c of session.combatants) {
    assert.equal(c.alive, true);
    assert.equal(c.frozen, true);
    assert.ok(c.weapons.active, 'tem arma');
  }
  assert.equal(match.clock, MATCH_RULES.FREEZE_TIME);
  assert.equal(player.team, TEAM.ATTACK);
});

test('preparação: jogador não se move nem atira; depois do tempo o round fica LIVE e libera', () => {
  const { session, match, player } = game();
  const live = events(session, 'roundLive');
  const start = { x: player.pos.x, z: player.pos.z };
  player.cmd.moveZ = 1;
  player.cmd.fire = true;
  run(session, MATCH_RULES.FREEZE_TIME - 0.5);
  assert.equal(Math.hypot(player.pos.x - start.x, player.pos.z - start.z) < 0.01, true, 'não se moveu');
  assert.equal(match.phase, ROUND_PHASE.FREEZE);
  run(session, 1.0);
  assert.equal(match.phase, ROUND_PHASE.LIVE);
  assert.equal(live.length, 1);
  assert.equal(player.frozen, false);
  run(session, 1);
  assert.ok(Math.hypot(player.pos.x - start.x, player.pos.z - start.z) > 1, 'agora se move');
});

test('vitória por eliminação: matar todos os defensores dá o round aos atacantes; próximo round reinicia', () => {
  const { session, match } = game();
  const ends = events(session, 'roundEnd');
  run(session, MATCH_RULES.FREEZE_TIME + 0.1);
  for (const c of session.combatants.filter((x) => x.team === TEAM.DEFEND)) c.receiveDamage({ amount: 999, type: 'world', attacker: null });
  run(session, 0.1);
  assert.equal(ends.length, 1);
  assert.equal(ends[0].winner, TEAM.ATTACK);
  assert.equal(ends[0].reason, 'eliminated');
  assert.equal(match.score[TEAM.ATTACK], 1);
  assert.equal(match.phase, ROUND_PHASE.POST);
  run(session, MATCH_RULES.POST_ROUND_TIME + 0.1);
  assert.equal(match.round, 2);
  assert.equal(match.phase, ROUND_PHASE.FREEZE);
  assert.ok(session.combatants.every((c) => c.alive && c.frozen), 'todos renascem');
  assert.ok(session.combatants.every((c) => c.health.current === 100));
});

test('vitória dos defensores: atacantes eliminados sem bomba plantada', () => {
  const { session, match } = game();
  const ends = events(session, 'roundEnd');
  run(session, MATCH_RULES.FREEZE_TIME + 0.1);
  for (const c of session.combatants.filter((x) => x.team === TEAM.ATTACK)) c.receiveDamage({ amount: 999, type: 'world', attacker: null });
  run(session, 0.1);
  assert.equal(ends[0].winner, TEAM.DEFEND);
  assert.equal(match.score[TEAM.DEFEND], 1);
});

test('tempo esgotado sem plantar: defensores vencem', () => {
  const { session, match } = game();
  const ends = events(session, 'roundEnd');
  run(session, MATCH_RULES.FREEZE_TIME + MATCH_RULES.ROUND_TIME + 1);
  assert.equal(ends.length, 1);
  assert.equal(ends[0].winner, TEAM.DEFEND);
  assert.equal(ends[0].reason, 'time');
  assert.equal(match.phase, ROUND_PHASE.POST);
});

function goPlant(g, site = 'A') {
  const { session, player } = g;
  run(session, MATCH_RULES.FREEZE_TIME + 0.1);
  const s = FORJA.sites[site];
  player.body.teleport(s.x, 0, s.z);
  player.cmd.use = true;
  return s;
}

test('plantar: segurar E dentro do sítio por PLANT_TIME planta a carga; sair do sítio cancela', () => {
  const g = game();
  const planted = events(g.session, 'bombPlanted');
  goPlant(g, 'A');
  run(g.session, MATCH_RULES.PLANT_TIME - 0.5);
  assert.equal(planted.length, 0);
  assert.ok(g.match.interaction && g.match.interaction.kind === 'plant' && g.match.interaction.progress > 0.7, 'HUD mostra progresso');
  run(g.session, 0.7);
  assert.equal(planted.length, 1);
  assert.equal(planted[0].site, 'A');
  assert.equal(g.match.bomb.planted, true);

  // cancelamento ao sair do sítio
  const g2 = game({ seed: 5 });
  goPlant(g2, 'B');
  run(g2.session, 1.5);
  g2.player.body.teleport(-20, 0, 0);
  run(g2.session, 3);
  assert.equal(g2.match.bomb.planted, false);
  assert.equal(g2.player.useProgress, 0);
});

test('plantar exige ficar parado (movimento zera o progresso)', () => {
  const g = game();
  goPlant(g, 'A');
  run(g.session, 1.0);
  g.player.cmd.moveZ = 1;
  run(g.session, 0.5);
  assert.equal(g.player.useProgress, 0);
});

test('bomba plantada: contagem regressiva, explosão dá o round aos atacantes', () => {
  const g = game();
  const ends = events(g.session, 'roundEnd');
  const boom = events(g.session, 'bombExploded');
  const beeps = events(g.session, 'bombBeep');
  goPlant(g, 'A');
  run(g.session, MATCH_RULES.PLANT_TIME + 0.2);
  g.player.cmd.use = false;
  g.player.body.teleport(-40, 0, 0);       // sai da zona da explosão
  assert.ok(g.match.clock <= MATCH_RULES.BOMB_TIMER && g.match.clock > MATCH_RULES.BOMB_TIMER - 1, 'relógio mostra o tempo da carga');
  run(g.session, MATCH_RULES.BOMB_TIMER + 0.5);
  assert.equal(boom.length, 1);
  assert.equal(ends[0].winner, TEAM.ATTACK);
  assert.equal(ends[0].reason, 'exploded');
  assert.ok(beeps.length > 20, `bipes: ${beeps.length}`);
});

test('desarmar: defensor segura E por DEFUSE_TIME perto da carga e vence o round', () => {
  const g = game();
  const ends = events(g.session, 'roundEnd');
  const defused = events(g.session, 'bombDefused');
  const s = goPlant(g, 'A');
  run(g.session, MATCH_RULES.PLANT_TIME + 0.2);
  g.player.cmd.use = false;
  const defender = g.session.bots.find((b) => b.team === TEAM.DEFEND);
  defender.body.teleport(s.x + 1, 0, s.z);
  defender.cmd.use = true;
  run(g.session, MATCH_RULES.DEFUSE_TIME - 1);
  assert.equal(defused.length, 0);
  run(g.session, 1.3);
  assert.equal(defused.length, 1);
  assert.equal(ends[0].winner, TEAM.DEFEND);
  assert.equal(ends[0].reason, 'defused');
});

test('com a bomba plantada, atacantes mortos NÃO encerram o round (defensores precisam desarmar)', () => {
  const g = game();
  const ends = events(g.session, 'roundEnd');
  goPlant(g, 'A');
  run(g.session, MATCH_RULES.PLANT_TIME + 0.2);
  g.player.cmd.use = false;
  for (const c of g.session.combatants.filter((x) => x.team === TEAM.ATTACK)) c.receiveDamage({ amount: 999, type: 'world', attacker: null });
  run(g.session, 2);
  assert.equal(ends.length, 0, 'round segue');
  run(g.session, MATCH_RULES.BOMB_TIMER);
  assert.equal(ends[0].reason, 'exploded');
});

test('placar e fim de partida: primeiro a ROUNDS_TO_WIN vence; restart zera tudo', () => {
  const g = game({ roundsToWin: 2 });
  const { session, match } = g;
  const matchEnd = events(session, 'matchEnd');
  const winRound = () => {
    run(session, MATCH_RULES.FREEZE_TIME + 0.1);
    for (const c of session.combatants.filter((x) => x.team === TEAM.DEFEND)) c.receiveDamage({ amount: 999, type: 'world', attacker: null });
    run(session, MATCH_RULES.POST_ROUND_TIME + 0.2);
  };
  winRound();
  assert.equal(match.score[TEAM.ATTACK], 1);
  assert.equal(match.phase, ROUND_PHASE.FREEZE);
  winRound();
  assert.equal(matchEnd.length, 1);
  assert.equal(matchEnd[0].winner, TEAM.ATTACK);
  assert.equal(match.phase, ROUND_PHASE.ENDED);
  match.restart();
  assert.equal(match.round, 1);
  assert.equal(match.score[TEAM.ATTACK], 0);
  assert.equal(match.phase, ROUND_PHASE.FREEZE);
  assert.ok(session.combatants.every((c) => c.alive));
});

test('estatísticas: abates, mortes e headshots são contabilizados', () => {
  const g = game();
  run(g.session, MATCH_RULES.FREEZE_TIME + 0.1);
  const [a, b] = [g.player, g.session.bots.find((x) => x.team === TEAM.DEFEND)];
  b.receiveDamage({ amount: 500, type: 'bullet', attacker: a, hitbox: 'head', weaponId: 'ar30' });
  assert.equal(a.stats.kills, 1);
  assert.equal(a.stats.headshots, 1);
  assert.equal(b.stats.deaths, 1);
  assert.equal(b.deathInfo.killer, a);
  assert.equal(b.deathInfo.headshot, true);
});

test('morte do jogador: não controla mais o personagem morto; renasce no próximo round', () => {
  const g = game();
  run(g.session, MATCH_RULES.FREEZE_TIME + 0.1);
  const p = g.player;
  p.receiveDamage({ amount: 500, type: 'bullet', attacker: g.session.bots[0], hitbox: 'torso', weaponId: 'ar30' });
  assert.equal(p.alive, false);
  const at = { x: p.pos.x, z: p.pos.z };
  p.applyInput({ moveX: 0, moveZ: 1, crouch: false, run: true, fire: true, alt: false, use: false, jump: true });
  run(g.session, 1.5);
  assert.ok(Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < 0.5, 'cadáver não anda');
  assert.equal(p.weapons.recoil.shotCounter, 0, 'não atirou');
});

test('cair de grande altura causa dano; queda pequena não', () => {
  const g = game();
  run(g.session, MATCH_RULES.FREEZE_TIME + 0.1);
  const p = g.player;
  p.body.teleport(-40, 3, 0);      // 3 m — abaixo do limite
  p.body.onGround = false;
  run(g.session, 1);
  assert.equal(p.health.current, 100);
  p.body.teleport(-40, 12, 0);     // ~15 m/s de impacto
  p.body.onGround = false;
  run(g.session, 2);
  assert.ok(p.health.current < 100, `dano de queda: ${p.health.current}`);
});

test('granada de fragmentação causa dano com linha de visão e não atravessa parede', () => {
  const g = game();
  run(g.session, MATCH_RULES.FREEZE_TIME + 0.1);
  const thrower = g.player;
  const victim = g.session.bots.find((b) => b.team === TEAM.DEFEND);
  victim.body.teleport(-9, 0, 0);
  victim.hitboxes.update(-9, 0, 0, 0, false);
  g.session.grenades.spawn(thrower, 'frag', -8, 1, 0, 0, 0, 0);
  run(g.session, 2.2);
  assert.ok(victim.health.current < 60, `dano explosão: ${victim.health.current}`);

  // parede grossa entre a explosão e o alvo: sem dano
  const v2 = g.session.bots.find((b) => b.team === TEAM.DEFEND);
  v2.receiver.reset();
  v2.health.reset();
  v2.armor.reset(0);
  v2.body.teleport(-34, 0, 8);
  v2.hitboxes.update(-34, 0, 8, 0, false);
  g.session.grenades.spawn(thrower, 'frag', -30, 1, 8, 0, 0, 0);
  run(g.session, 2.2);
  assert.equal(v2.health.current, 100, 'parede protege');
});

test('granada cegante cega quem olha; fumaça cria volume que bloqueia visão e expira', () => {
  const g = game();
  run(g.session, MATCH_RULES.FREEZE_TIME + 0.1);
  const p = g.player;
  p.body.teleport(-30, 0, 0);
  p.view.yaw = -Math.PI / 2;            // olhando para +X
  g.session.grenades.spawn(g.session.bots[0], 'flash', -26, 1.5, 0, 0, 0, 0);
  run(g.session, 1.6);
  assert.ok(p.blindTimer > 1.5, `cego por ${p.blindTimer.toFixed(1)} s`);

  g.session.grenades.spawn(p, 'smoke', -30, 1, 4, 0, 0, 0);
  run(g.session, 4);
  assert.equal(g.session.world.smokes.length, 1);
  assert.equal(g.session.world.hasLineOfSight(-30, 1.6, 4, -24, 1.6, 4), false, 'fumaça bloqueia visão');
  run(g.session, 20);
  assert.equal(g.session.world.smokes.length, 0, 'fumaça expirou');
});

test('granada: ricocheteia em parede, sofre gravidade e detona após o tempo', () => {
  const g = game();
  run(g.session, MATCH_RULES.FREEZE_TIME + 0.1);
  const bounces = [];
  g.session.events.on('grenadeBounce', (e) => bounces.push(e));
  const det = events(g.session, 'grenadeDetonate');
  // lança contra a parede oeste da doca
  const gr = g.session.grenades.spawn(g.player, 'frag', -42, 1.5, 0, -12, 3, 0);
  run(g.session, 0.2);
  assert.ok(gr.vy < 3, 'gravidade atua');
  run(g.session, 2);
  assert.ok(bounces.length >= 1, 'quicou');
  assert.equal(det.length, 1);
  assert.equal(det[0].kind, 'frag');
});
