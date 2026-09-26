import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, PRIMARY_CHOICES, SECONDARY_CHOICES, GRENADE_ORDER, getWeaponDef } from '../src/Config/WeaponDefs.js';
import { ACTIONS, DEFAULT_BINDINGS, ACTION_LABELS } from '../src/Config/Controls.js';
import { MOVEMENT, PLAYER, CAMERA, MOUSE, SIM } from '../src/Config/Tuning.js';
import { QUALITY_LEVELS, QUALITY_PRESETS } from '../src/Config/Quality.js';
import { DEFAULT_SETTINGS, Settings } from '../src/Config/Settings.js';
import { SURFACES } from '../src/Config/Surfaces.js';
import { DIFFICULTY } from '../src/AI/AIConfig.js';
import { FORJA } from '../src/World/maps/Forja.js';

const GUN_FIELDS = ['damage', 'pellets', 'hitMult', 'range', 'falloffStart', 'falloffPerMeter', 'falloffMin', 'penetration', 'armorPen',
  'fireInterval', 'magSize', 'reserve', 'reloadTime', 'equipTime', 'moveSpeedMul', 'spreadBase', 'spreadMove', 'spreadAir',
  'spreadCrouchMul', 'spreadPerShot', 'spreadBloomMax', 'spreadRecovery', 'recoilPattern', 'recoilJitter', 'recoilDecay',
  'recoilResetDelay', 'recoilResetRate', 'camKickPitch', 'camKickRoll', 'camKickRecover', 'vmKickBack', 'vmKickUp', 'vmKickPitch',
  'ads', 'shotLoudness', 'sfx', 'botIdealRange', 'botBurst', 'botBurstPause'];

test('armas de fogo: todos os parâmetros exigidos existem e são coerentes', () => {
  for (const def of Object.values(WEAPONS).filter((d) => d.magSize > 0)) {
    for (const f of GUN_FIELDS) assert.ok(def[f] !== undefined, `${def.id} sem campo ${f}`);
    assert.ok(def.damage > 0 && def.range > 0 && def.fireInterval > 0 && def.magSize > 0, def.id);
    assert.ok(def.recoilPattern.length >= 2 && def.recoilPattern.every((p) => p.length === 2 && p.every(Number.isFinite)), `${def.id} padrão de recoil`);
    for (const part of ['head', 'torso', 'arm', 'leg']) assert.ok(def.hitMult[part] > 0, `${def.id} multiplicador ${part}`);
    assert.ok(def.hitMult.head > def.hitMult.torso || def.id === 'ps12', `${def.id}: headshot maior que corpo`);
    assert.ok(def.botBurst[0] <= def.botBurst[1] && def.botIdealRange[0] < def.botIdealRange[1]);
    for (const k of ['fire', 'reload', 'equip', 'dry']) assert.ok(def.sfx[k], `${def.id} sfx.${k}`);
  }
});

test('as cinco armas pedidas existem, com papéis distintos', () => {
  assert.ok(WEAPONS.p9 && WEAPONS.ar30 && WEAPONS.smg9 && WEAPONS.ps12 && WEAPONS.knife);
  assert.equal(WEAPONS.p9.mode, 'semi');
  assert.equal(WEAPONS.ar30.mode, 'auto');
  assert.equal(WEAPONS.ar30.magSize, 30);
  assert.ok(WEAPONS.smg9.fireInterval < WEAPONS.ar30.fireInterval, 'SMG mais rápida');
  assert.ok(WEAPONS.smg9.damage < WEAPONS.ar30.damage, 'SMG dano menor');
  assert.ok(WEAPONS.smg9.moveSpeedMul > WEAPONS.ar30.moveSpeedMul, 'SMG mais móvel');
  assert.ok(WEAPONS.ps12.pellets > 1 && WEAPONS.ps12.range < WEAPONS.ar30.range, 'espingarda: vários projéteis e alcance curto');
  assert.equal(WEAPONS.knife.mode, 'melee');
  assert.ok(WEAPONS.knife.damage >= 40 && WEAPONS.knife.range < 3);
  assert.deepEqual(GRENADE_ORDER.slice().sort(), ['flash', 'frag', 'smoke']);
});

test('escolhas de equipamento referenciam armas reais e o slot correto', () => {
  for (const id of PRIMARY_CHOICES) assert.equal(getWeaponDef(id).slot, 'primary');
  for (const id of SECONDARY_CHOICES) assert.equal(getWeaponDef(id).slot, 'secondary');
  assert.throws(() => getWeaponDef('inexistente'));
});

test('parâmetros de movimento centralizados existem e são plausíveis', () => {
  for (const k of ['WALK_SPEED', 'RUN_SPEED', 'CROUCH_SPEED', 'ACCELERATION', 'DECELERATION', 'AIR_ACCELERATION', 'AIR_CONTROL', 'GRAVITY', 'JUMP_FORCE', 'FRICTION']) {
    assert.ok(Number.isFinite(MOVEMENT[k]) && MOVEMENT[k] > 0, k);
  }
  assert.ok(MOVEMENT.CROUCH_SPEED < MOVEMENT.WALK_SPEED && MOVEMENT.WALK_SPEED < MOVEMENT.RUN_SPEED);
  assert.ok(Number.isFinite(MOUSE.DEFAULT_SENSITIVITY));
  assert.ok(PLAYER.HEIGHT_CROUCH < PLAYER.HEIGHT_STAND && PLAYER.EYE_CROUCH < PLAYER.EYE_STAND);
  assert.ok(CAMERA.MIN_FOV < CAMERA.DEFAULT_FOV && CAMERA.DEFAULT_FOV < CAMERA.MAX_FOV);
  assert.ok(SIM.TICK_RATE >= 60);
});

test('controles: toda ação tem atalho padrão e rótulo (pronto para remapeamento)', () => {
  for (const a of ACTIONS) {
    assert.ok(Array.isArray(DEFAULT_BINDINGS[a]) && DEFAULT_BINDINGS[a].length > 0, `sem atalho: ${a}`);
    assert.ok(ACTION_LABELS[a], `sem rótulo: ${a}`);
  }
  const all = Object.entries(DEFAULT_BINDINGS).flatMap(([a, ks]) => ks.map((k) => [a, k]));
  const seen = new Map();
  for (const [a, k] of all) {
    if (seen.has(k) && seen.get(k) !== a) assert.fail(`tecla ${k} duplicada em ${seen.get(k)} e ${a}`);
    seen.set(k, a);
  }
  // atalhos pedidos
  assert.deepEqual(DEFAULT_BINDINGS.moveForward, ['KeyW']);
  assert.ok(DEFAULT_BINDINGS.run.includes('ShiftLeft') && DEFAULT_BINDINGS.crouch.includes('ControlLeft') && DEFAULT_BINDINGS.jump.includes('Space'));
  assert.ok(DEFAULT_BINDINGS.fire.includes('Mouse0') && DEFAULT_BINDINGS.altFire.includes('Mouse2') && DEFAULT_BINDINGS.reload.includes('KeyR'));
  assert.ok(DEFAULT_BINDINGS.throwGrenade.includes('KeyG') && DEFAULT_BINDINGS.scoreboard.includes('Tab') && DEFAULT_BINDINGS.debug.includes('F3'));
});

test('presets de qualidade LOW/MEDIUM/HIGH escalam de forma monotônica', () => {
  assert.deepEqual(QUALITY_LEVELS, ['LOW', 'MEDIUM', 'HIGH']);
  const [l, m, h] = QUALITY_LEVELS.map((q) => QUALITY_PRESETS[q]);
  assert.ok(l.shadowMapSize <= m.shadowMapSize && m.shadowMapSize <= h.shadowMapSize);
  assert.ok(l.maxDecals < m.maxDecals && m.maxDecals < h.maxDecals);
  assert.ok(l.maxParticles < m.maxParticles && m.maxParticles < h.maxParticles);
  assert.equal(l.shadows, false);
});

test('materiais de superfície: penetração coerente (concreto bloqueia, madeira fina atravessa)', () => {
  assert.ok(SURFACES.thin.penetrationDepth > SURFACES.wood.penetrationDepth && SURFACES.wood.penetrationDepth > SURFACES.concrete.penetrationDepth);
});

test('dificuldades: DIFÍCIL reage mais rápido, gira mais rápido e erra menos que FÁCIL', () => {
  const { EASY, NORMAL, HARD } = DIFFICULTY;
  assert.ok(HARD.reaction[1] < EASY.reaction[0]);
  assert.ok(EASY.aimTurnRate < NORMAL.aimTurnRate && NORMAL.aimTurnRate < HARD.aimTurnRate);
  assert.ok(EASY.aimErrorMin > NORMAL.aimErrorMin && NORMAL.aimErrorMin > HARD.aimErrorMin);
});

test('mapa: definição tem tudo que o jogo espera (spawns, sítios, rotas, posições)', () => {
  assert.equal(FORJA.spawns.attack.length, 5);
  assert.equal(FORJA.spawns.defend.length, 5);
  assert.deepEqual(Object.keys(FORJA.sites).sort(), ['A', 'B']);
  for (const site of ['A', 'B']) {
    assert.ok(Object.keys(FORJA.routes[site]).length >= 3, `rotas do sítio ${site}`);
    assert.ok(FORJA.holds[site].length >= 3 && FORJA.postPlant[site].length >= 3);
  }
});

// ---------------------------------------------------------------- Settings

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), _m: m };
}

test('configurações: padrões, persistência e recarga', () => {
  const store = fakeStorage();
  const a = new Settings(store);
  assert.equal(a.data.video.quality, 'MEDIUM');
  a.update((d) => { d.mouse.sensitivity = 2.5; d.video.quality = 'HIGH'; d.crosshair.color = '#ff0000'; });
  const b = new Settings(store);
  assert.equal(b.data.mouse.sensitivity, 2.5);
  assert.equal(b.data.video.quality, 'HIGH');
  assert.equal(b.data.crosshair.color, '#ff0000');
});

test('configurações: valores inválidos são corrigidos; dados corrompidos caem nos padrões', () => {
  const store = fakeStorage();
  const s = new Settings(store);
  s.update((d) => { d.video.fov = 999; d.mouse.sensitivity = -5; d.audio.master = 7; d.video.quality = 'ULTRA'; d.gameplay.teamSize = 99; });
  assert.ok(s.data.video.fov <= 120 && s.data.mouse.sensitivity > 0 && s.data.audio.master <= 1);
  assert.equal(s.data.video.quality, 'MEDIUM');
  assert.equal(s.data.gameplay.teamSize, 5);
  store.setItem('pontozero.settings.v1', '{isso não é json');
  const c = new Settings(store);
  assert.deepEqual(c.data.video, DEFAULT_SETTINGS.video);
});

test('configurações: chaves novas ganham padrão ao carregar um arquivo antigo (compatibilidade)', () => {
  const store = fakeStorage();
  store.setItem('pontozero.settings.v1', JSON.stringify({ video: { fov: 90 } }));
  const s = new Settings(store);
  assert.equal(s.data.video.fov, 90);
  assert.equal(s.data.video.quality, 'MEDIUM');
  assert.ok(s.data.controls.moveForward);
});

test('configurações: restaurar seção volta aos padrões e notifica ouvintes', () => {
  const s = new Settings(fakeStorage());
  let calls = 0;
  s.onChange(() => calls++);
  s.update((d) => { d.mouse.sensitivity = 4; });
  s.reset('mouse');
  assert.equal(s.data.mouse.sensitivity, DEFAULT_SETTINGS.mouse.sensitivity);
  assert.equal(calls, 2);
});
