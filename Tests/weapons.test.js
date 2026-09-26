import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, WEAPON_TIMING } from '../src/Config/WeaponDefs.js';
import { MOVEMENT, PLAYER } from '../src/Config/Tuning.js';
import { GameSession } from '../src/Game/GameSession.js';
import { Combatant } from '../src/Player/Combatant.js';
import { computeSpread } from '../src/Weapons/Accuracy.js';
import { falloffMultiplier } from '../src/Weapons/Ballistics.js';
import { PHASE } from '../src/Weapons/WeaponSystem.js';
import { makeWorld, box, DT } from './helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} esperado ${b} ± ${tol}, obtido ${a}`);

function setup({ build, target = [0, 0, -10], loadout = {}, seed = 7 } = {}) {
  const world = makeWorld(build);
  const session = new GameSession({ world, seed });
  const shooter = new Combatant(session, { id: 1, name: 'Atirador', team: 'attack' });
  const enemy = new Combatant(session, { id: 2, name: 'Alvo', team: 'defend' });
  session.add(shooter);
  session.add(enemy);
  shooter.spawn(0, 0, 0, 0);
  enemy.spawn(target[0], target[1], target[2], Math.PI);
  shooter.weapons.loadout({ primary: 'ar30', secondary: 'p9', melee: 'knife', grenades: { frag: 1, flash: 1, smoke: 1 }, ...loadout });
  enemy.armor.reset(0);
  run(session, 1.0); // termina de sacar a arma
  return { world, session, shooter, enemy };
}

function run(session, seconds, onTick) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    session.step(DT);
    if (onTick) onTick(i);
  }
}

/** Ajusta o olhar do atirador para o centro de uma parte do corpo do alvo. */
function aimAt(shooter, enemy, part = 'torso', name = null) {
  const boxes = enemy.hitboxes.worldBoxes();
  const b = boxes.find((x) => (name ? x.name === name : x.part === part));
  const eye = shooter.eyeArray();
  const dx = b.x - eye[0], dy = b.y - eye[1], dz = b.z - eye[2];
  shooter.view.yaw = Math.atan2(-dx, -dz);
  shooter.view.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

function collect(session, type) {
  const arr = [];
  session.events.on(type, (e) => arr.push(e));
  return arr;
}

const tap = (shooter) => { shooter.cmd.fire = true; };
const release = (shooter) => { shooter.cmd.fire = false; };

// ---------------------------------------------------------------- cadência / munição

test('rifle automático: ~10 tiros/s (600 RPM) segurando o gatilho', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  const shots = collect(session, 'weaponFired');
  tap(shooter);
  run(session, 1.0);
  release(shooter);
  assert.ok(shots.length >= 9 && shots.length <= 11, `tiros=${shots.length}`);
  assert.equal(shooter.weapons.active.ammo, WEAPONS.ar30.magSize - shots.length);
});

test('pistola semiautomática: segurar o gatilho dá um único tiro; novo clique dá outro', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  shooter.weapons.requestSwitch('secondary');
  run(session, 1.0);
  const shots = collect(session, 'weaponFired');
  tap(shooter);
  run(session, 1.0);
  assert.equal(shots.length, 1);
  release(shooter);
  run(session, 0.3);
  tap(shooter);
  run(session, 0.05);
  assert.equal(shots.length, 2);
});

test('munição: chega a zero, clica em seco e recarrega automaticamente', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  const dry = collect(session, 'dryFire');
  const reloads = collect(session, 'reloadStart');
  shooter.weapons.active.ammo = 2;
  tap(shooter);
  run(session, 0.5);
  assert.equal(shooter.weapons.active.ammo, 0);
  assert.ok(dry.length >= 1, 'clique em seco');
  assert.equal(reloads.length, 1, 'recarga automática ao tentar atirar sem munição');
  assert.equal(shooter.weapons.phase, PHASE.RELOAD);
});

// ---------------------------------------------------------------- recarga

test('recarga: tempo correto, transfere munição e atualiza reserva', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  const a = shooter.weapons.active;
  a.ammo = 10;
  const reserve0 = a.reserve;
  const done = collect(session, 'reloadDone');
  shooter.cmd.reload = true;
  run(session, 0.05);
  assert.equal(shooter.weapons.phase, PHASE.RELOAD);
  run(session, WEAPONS.ar30.reloadTime - 0.15);
  assert.equal(done.length, 0, 'ainda não terminou');
  run(session, 0.3);
  assert.equal(done.length, 1);
  assert.equal(a.ammo, WEAPONS.ar30.magSize);
  assert.equal(a.reserve, reserve0 - 20);
});

test('recarga vazia é mais longa que recarga com munição', () => {
  assert.ok(WEAPONS.ar30.reloadTimeEmpty > WEAPONS.ar30.reloadTime);
});

test('recarga não passa da reserva disponível', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  const a = shooter.weapons.active;
  a.ammo = 5;
  a.reserve = 7;
  shooter.cmd.reload = true;
  run(session, 3);
  assert.equal(a.ammo, 12);
  assert.equal(a.reserve, 0);
});

test('trocar de arma durante a recarga a interrompe (progresso perdido)', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  const a = shooter.weapons.active;
  a.ammo = 5;
  shooter.cmd.reload = true;
  run(session, 1.0);
  shooter.cmd.slot = 'secondary';
  run(session, 2.0);
  assert.equal(a.ammo, 5, 'recarga cancelada, munição inalterada');
  assert.equal(shooter.weapons.activeKey, 'secondary');
});

test('espingarda: recarga por cartucho e pode ser interrompida atirando', () => {
  const { session, shooter } = setup({ loadout: { primary: 'ps12' }, target: [30, 0, 0] });
  const a = shooter.weapons.active;
  assert.equal(a.def.id, 'ps12');
  a.ammo = 2;
  const shells = collect(session, 'reloadShell');
  shooter.cmd.reload = true;
  run(session, 0.05);
  run(session, a.def.reloadStart + a.def.shellTime * 1.5);
  assert.ok(a.ammo >= 3, `inseriu cartucho: ${a.ammo}`);
  const before = a.ammo;
  tap(shooter);
  run(session, 0.05);
  assert.equal(shooter.weapons.phase, PHASE.READY, 'interrompeu recarga para atirar');
  assert.equal(a.ammo, before - 1);
  assert.ok(shells.length >= 1);
});

// ---------------------------------------------------------------- troca de arma

test('troca: 1/2/3 alternam armas com tempo de transição (holster + equip)', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  const w = shooter.weapons;
  assert.equal(w.activeKey, 'primary');
  shooter.cmd.slot = 'secondary';
  run(session, 0.05);
  assert.equal(w.phase, PHASE.HOLSTER);
  // não pode atirar durante a troca
  const shots = collect(session, 'weaponFired');
  tap(shooter);
  run(session, WEAPON_TIMING.HOLSTER_TIME);
  assert.equal(w.activeKey, 'secondary');
  assert.equal(w.phase, PHASE.EQUIP);
  release(shooter);
  assert.equal(shots.length, 0, 'não atirou durante a troca');
  run(session, WEAPONS.p9.equipTime + 0.05);
  assert.equal(w.phase, PHASE.READY);
  shooter.cmd.slot = 'melee';
  run(session, WEAPON_TIMING.HOLSTER_TIME + WEAPONS.knife.equipTime + 0.1);
  assert.equal(w.activeKey, 'melee');
});

test('roda do mouse percorre as armas em ciclo', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  const w = shooter.weapons;
  shooter.cmd.switchDelta = 1;
  run(session, 0.5);
  assert.equal(w.activeKey, 'secondary');
  shooter.cmd.switchDelta = 1;
  run(session, 0.6);
  assert.equal(w.activeKey, 'melee');
  shooter.cmd.switchDelta = -1;
  run(session, 0.6);
  assert.equal(w.activeKey, 'secondary');
});

// ---------------------------------------------------------------- dano e hitboxes

test('hitboxes: acertos por altura resolvem cabeça / tronco / pernas', () => {
  const { enemy } = setup({ target: [0, 0, -10] });
  const out = { t: 0 };
  const probe = (y) => (enemy.hitboxes.raycast(0, y, -5, 0, 0, -1, 20, out) ? out.part : null);
  assert.equal(probe(1.66), 'head');
  assert.equal(probe(1.2), 'torso');
  assert.equal(probe(0.4), 'leg');
  const armHit = enemy.hitboxes.raycast(0.35, 1.2, -5, 0, 0, -1, 20, out);
  assert.ok(armHit && out.part === 'arm');
});

test('agachar reduz as hitboxes (cabeça mais baixa)', () => {
  const { enemy } = setup({ target: [0, 0, 0] });
  const out = { t: 0 };
  enemy.hitboxes.update(0, 0, 0, Math.PI, true);
  assert.equal(enemy.hitboxes.raycast(0, 1.66, 5, 0, 0, -1, 20, out), false, 'cabeça em pé não está mais lá');
  assert.ok(enemy.hitboxes.raycast(0, 1.66 * 0.75, 5, 0, 0, -1, 20, out) && out.part === 'head');
});

test('tiro no tronco: dano base do rifle; perna e braço com multiplicadores', () => {
  for (const [name, part, mult] of [['torso', 'torso', 1], ['legL', 'leg', 0.75], ['armR', 'arm', 0.8]]) {
    const { session, shooter, enemy } = setup({ target: [0, 0, -10] });
    aimAt(shooter, enemy, part, name);
    tap(shooter);
    run(session, 0.03);
    release(shooter);
    near(100 - enemy.health.current, 33 * mult, 0.5, `${name}`);
  }
});

test('headshot do rifle mata alvo sem armadura com um tiro e registra o matador', () => {
  const { session, shooter, enemy } = setup({ target: [0, 0, -10] });
  const deaths = collect(session, 'death');
  aimAt(shooter, enemy, 'head');
  tap(shooter);
  run(session, 0.03);
  release(shooter);
  assert.equal(enemy.alive, false);
  assert.equal(deaths.length, 1);
  assert.equal(deaths[0].killer, shooter);
  assert.equal(deaths[0].headshot, true);
  assert.equal(shooter.stats.kills, 1);
  assert.equal(shooter.stats.headshots, 1);
  assert.equal(enemy.stats.deaths, 1);
});

test('armadura absorve parte do dano no corpo, mas não em headshot', () => {
  const a = setup({ target: [0, 0, -10] });
  a.enemy.armor.reset(100);
  aimAt(a.shooter, a.enemy, 'torso');
  tap(a.shooter); run(a.session, 0.03); release(a.shooter);
  const dmgArmored = 100 - a.enemy.health.current;
  assert.ok(dmgArmored < 33 && dmgArmored > 20, `dano com armadura=${dmgArmored}`);
  assert.ok(a.enemy.armor.current < 100, 'armadura foi consumida');

  const b = setup({ target: [0, 0, -10] });
  b.enemy.armor.reset(100);
  aimAt(b.shooter, b.enemy, 'head');
  tap(b.shooter); run(b.session, 0.03); release(b.shooter);
  assert.equal(b.enemy.alive, false, 'headshot ignora armadura sem capacete');
});

test('fogo amigo desligado: tiro passa por companheiro de time', () => {
  const { session, shooter, enemy } = setup({ target: [0, 0, -10] });
  enemy.team = 'attack';
  aimAt(shooter, enemy, 'torso');
  tap(shooter); run(session, 0.03); release(shooter);
  assert.equal(enemy.health.current, 100);
});

test('falloff: dano cai com a distância e respeita o mínimo', () => {
  const d = WEAPONS.ar30;
  assert.equal(falloffMultiplier(d, 10), 1);
  assert.ok(falloffMultiplier(d, 100) < 1);
  assert.equal(falloffMultiplier(d, 5000), d.falloffMin);
  assert.ok(falloffMultiplier(WEAPONS.smg9, 40) < falloffMultiplier(WEAPONS.ar30, 40));
});

test('espingarda: 8 projéteis; dano alto de perto, quase nulo de longe', () => {
  const close = setup({ loadout: { primary: 'ps12' }, target: [0, 0, -3] });
  aimAt(close.shooter, close.enemy, 'torso');
  tap(close.shooter); run(close.session, 0.03); release(close.shooter);
  const dmgClose = 100 - close.enemy.health.current;
  assert.ok(dmgClose > 55, `dano de perto=${dmgClose}`);

  const far = setup({ loadout: { primary: 'ps12' }, target: [0, 0, -40] });
  aimAt(far.shooter, far.enemy, 'torso');
  tap(far.shooter); run(far.session, 0.03); release(far.shooter);
  const dmgFar = 100 - far.enemy.health.current;
  assert.ok(dmgFar < dmgClose * 0.3, `dano de longe=${dmgFar}`);
});

test('espingarda emite um traço por projétil', () => {
  const { session, shooter } = setup({ loadout: { primary: 'ps12' }, target: [30, 0, 0] });
  const traces = collect(session, 'bulletTrace');
  tap(shooter); run(session, 0.03);
  assert.equal(traces.length, WEAPONS.ps12.pellets);
});

// ---------------------------------------------------------------- paredes / penetração

test('concreto bloqueia o tiro; divisória fina de madeira é atravessada com dano reduzido', () => {
  const wall = setup({ target: [0, 0, -10], build: (w) => box(w, -3, 0, -6.5, 3, 4, -6, 'concrete') });
  aimAt(wall.shooter, wall.enemy, 'torso');
  tap(wall.shooter); run(wall.session, 0.03); release(wall.shooter);
  assert.equal(wall.enemy.health.current, 100, 'concreto bloqueou');

  const thin = setup({ target: [0, 0, -10], build: (w) => box(w, -3, 0, -6.2, 3, 4, -6, 'thin') });
  aimAt(thin.shooter, thin.enemy, 'torso');
  tap(thin.shooter); run(thin.session, 0.03); release(thin.shooter);
  const dmg = 100 - thin.enemy.health.current;
  assert.ok(dmg > 0 && dmg < 33, `dano atravessando divisória=${dmg}`);
});

test('impactos e traços são emitidos para efeitos visuais/sonoros', () => {
  const { session, shooter } = setup({ target: [30, 0, 0], build: (w) => box(w, -20, 0, -12, 20, 4, -11, 'concrete') });
  const impacts = collect(session, 'bulletImpact');
  shooter.view.pitch = 0; shooter.view.yaw = 0;
  tap(shooter); run(session, 0.03); release(shooter);
  assert.equal(impacts.length, 1);
  near(impacts[0].z, -11, 0.05);
  assert.equal(impacts[0].surface, 'concrete');
});

// ---------------------------------------------------------------- spread e recoil

test('spread: parado < andando < correndo < no ar; agachado e ADS reduzem', () => {
  const def = WEAPONS.ar30;
  const body = (o) => ({ speedXZ: 0, onGround: true, crouched: false, ...o });
  const still = computeSpread(def, body({}), 0, 0);
  const walk = computeSpread(def, body({ speedXZ: MOVEMENT.WALK_SPEED }), 0, 0);
  const run_ = computeSpread(def, body({ speedXZ: MOVEMENT.RUN_SPEED }), 0, 0);
  const air = computeSpread(def, body({ onGround: false }), 0, 0);
  assert.ok(still < walk && walk < run_, `${still} ${walk} ${run_}`);
  assert.ok(air > still * 10);
  assert.ok(computeSpread(def, body({ crouched: true }), 0, 0) < still);
  assert.ok(computeSpread(def, body({}), 1, 0) < still);
  assert.ok(computeSpread(def, body({}), 0, 1) > still, 'bloom aumenta a dispersão');
});

test('recoil de precisão: as balas realmente sobem ao longo da rajada', () => {
  const { session, shooter } = setup({ target: [30, 0, 0], build: (w) => box(w, -30, 0, -40, 30, 30, -39, 'concrete') });
  const impacts = collect(session, 'bulletImpact');
  shooter.view.yaw = 0; shooter.view.pitch = 0;
  tap(shooter);
  run(session, 1.05);
  release(shooter);
  assert.ok(impacts.length >= 9, `impactos=${impacts.length}`);
  const first = impacts[0].y, tenth = impacts[9].y;
  assert.ok(tenth - first > 1.5, `subida em 40 m: ${first.toFixed(2)} → ${tenth.toFixed(2)}`);
});

test('recoil é controlável: puxar o mouse para baixo mantém as balas agrupadas', () => {
  const { session, shooter } = setup({ target: [30, 0, 0], build: (w) => box(w, -30, 0, -40, 30, 30, -39, 'concrete') });
  const impacts = collect(session, 'bulletImpact');
  shooter.view.yaw = 0; shooter.view.pitch = 0;
  tap(shooter);
  const n = Math.round(1.05 / DT);
  for (let i = 0; i < n; i++) {
    session.step(DT);
    // compensação ideal: cancela o punch atual
    shooter.view.pitch = -shooter.weapons.recoil.aimPunch.pitch * Math.PI / 180;
    shooter.view.yaw = shooter.weapons.recoil.aimPunch.yaw * Math.PI / 180;
  }
  release(shooter);
  const ys = impacts.map((i) => i.y);
  const spread = Math.max(...ys) - Math.min(...ys);
  assert.ok(spread < 1.2, `agrupamento vertical=${spread.toFixed(2)} m em 40 m`);
});

test('recoil é determinístico (mesma semente → mesmos impactos) e cada arma tem padrão próprio', () => {
  const runOnce = (seed, primary) => {
    const { session, shooter } = setup({ seed, loadout: { primary }, target: [30, 0, 0], build: (w) => box(w, -30, 0, -40, 30, 30, -39, 'concrete') });
    const impacts = collect(session, 'bulletImpact');
    shooter.view.yaw = 0; shooter.view.pitch = 0;
    tap(shooter); run(session, 0.6); release(shooter);
    return impacts.map((i) => `${i.x.toFixed(4)},${i.y.toFixed(4)}`).join('|');
  };
  assert.equal(runOnce(5, 'ar30'), runOnce(5, 'ar30'));
  assert.notEqual(runOnce(5, 'ar30'), runOnce(5, 'smg9'));
  assert.notEqual(WEAPONS.ar30.recoilPattern[3].join(), WEAPONS.smg9.recoilPattern[3].join());
});

test('o punch decai depois de parar de atirar e o padrão reinicia', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  tap(shooter); run(session, 0.8); release(shooter);
  const peak = shooter.weapons.recoil.aimPunch.pitch;
  assert.ok(peak > 2, `punch pico=${peak}`);
  run(session, 2.5);
  assert.ok(shooter.weapons.recoil.aimPunch.pitch < peak * 0.1, 'recuperou');
  assert.ok(shooter.weapons.recoil.shotIndex < 1, 'padrão reiniciou');
});

test('recoil da câmera (visual) é independente do recoil de precisão', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  tap(shooter); run(session, 0.05); release(shooter);
  const r = shooter.weapons.recoil;
  assert.ok(r.camKick.pitch > 0, 'kick visual aplicado');
  assert.ok(r.aimPunch.pitch > 0, 'punch de precisão aplicado');
  run(session, 0.5);
  assert.ok(r.camKick.pitch < 0.01, 'kick visual some rápido');
  assert.ok(r.aimPunch.pitch > 0.05, 'punch de precisão persiste mais tempo');
});

// ---------------------------------------------------------------- faca / granada

test('faca: dano corpo a corpo com alcance curto; backstab causa mais dano', () => {
  const front = setup({ target: [0, 0, -1.5] });
  front.shooter.weapons.requestSwitch('melee');
  run(front.session, 1.0);
  aimAt(front.shooter, front.enemy, 'torso');
  tap(front.shooter); run(front.session, 0.4); release(front.shooter);
  near(100 - front.enemy.health.current, 40, 0.5, 'frontal');

  const back = setup({ target: [0, 0, -1.5] });
  back.enemy.view.yaw = 0;             // de costas para o atacante (ambos olham para -Z)
  back.enemy.hitboxes.update(0, 0, -1.5, 0, false);
  back.shooter.weapons.requestSwitch('melee');
  run(back.session, 1.0);
  aimAt(back.shooter, back.enemy, 'torso');
  tap(back.shooter); run(back.session, 0.4); release(back.shooter);
  assert.equal(back.enemy.alive, false, 'backstab (40×2.6) mata');

  const far = setup({ target: [0, 0, -4] });
  far.shooter.weapons.requestSwitch('melee');
  run(far.session, 1.0);
  aimAt(far.shooter, far.enemy, 'torso');
  tap(far.shooter); run(far.session, 0.4); release(far.shooter);
  assert.equal(far.enemy.health.current, 100, 'fora do alcance');
});

test('granada: quick-throw (G) saca, arremessa e volta à arma anterior', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  const thrown = collect(session, 'grenadeThrown');
  shooter.cmd.throwGrenade = 'flash';
  run(session, 2.0);
  assert.equal(thrown.length, 1);
  assert.equal(shooter.weapons.grenades.flash, 0);
  assert.equal(shooter.weapons.activeKey, 'primary', 'voltou para a arma anterior');
});

test('velocidade de movimento depende da arma (faca > rifle) e diminui ao mirar', () => {
  const { session, shooter } = setup({ target: [30, 0, 0] });
  const w = shooter.weapons;
  const rifle = w.moveSpeedMul;
  w.requestSwitch('melee');
  run(session, 1.0);
  assert.ok(w.moveSpeedMul > rifle);
  w.requestSwitch('primary');
  run(session, 1.2);
  shooter.cmd.alt = true;
  run(session, 0.4);
  assert.ok(w.moveSpeedMul < rifle, 'ADS reduz velocidade');
});
