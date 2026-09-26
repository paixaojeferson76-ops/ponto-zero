import test from 'node:test';
import assert from 'node:assert/strict';
import { FORJA } from '../src/World/maps/Forja.js';
import { buildMap } from '../src/World/MapBuilder.js';
import { NavGrid } from '../src/World/NavGrid.js';
import { CharacterBody } from '../src/Physics/CharacterBody.js';
import { stepMovement } from '../src/Physics/MovementModel.js';
import { DT } from './helpers.js';

const map = buildMap(FORJA);
const seeds = [...FORJA.spawns.attack, ...FORJA.spawns.defend, FORJA.sites.A, FORJA.sites.B];
const nav = new NavGrid(map.world, FORJA.bounds).build(seeds);

function allPoints() {
  const pts = [];
  for (const s of [...FORJA.spawns.attack, ...FORJA.spawns.defend]) pts.push(['spawn', s.x, s.z]);
  for (const [k, s] of Object.entries(FORJA.sites)) pts.push([`site ${k}`, s.x, s.z]);
  for (const [k, arr] of Object.entries(FORJA.holds)) arr.forEach((h) => pts.push([`hold ${k}`, h.x, h.z]));
  for (const [k, arr] of Object.entries(FORJA.postPlant)) arr.forEach((h) => pts.push([`postPlant ${k}`, h.x, h.z]));
  for (const [site, lanes] of Object.entries(FORJA.routes)) {
    for (const [lane, wps] of Object.entries(lanes)) wps.forEach(([x, z]) => pts.push([`rota ${site}/${lane}`, x, z]));
  }
  FORJA.patrol.forEach(([x, z]) => pts.push(['patrulha', x, z]));
  return pts;
}

/** Faz um CharacterBody real andar pelo caminho usando o modelo de movimento. */
function walk(path, maxSeconds = 60) {
  const body = new CharacterBody(map.world);
  body.teleport(path[0].x, path[0].y, path[0].z);
  let i = 1, t = 0;
  const cmd = { moveX: 0, moveZ: 1, yaw: 0, jump: false, crouch: false, run: true };
  while (i < path.length && t < maxSeconds) {
    const p = path[i];
    const dx = p.x - body.pos.x, dz = p.z - body.pos.z;
    if (Math.hypot(dx, dz) < 0.45) { i++; continue; }
    cmd.yaw = Math.atan2(-dx, -dz);
    stepMovement(body, cmd, DT, 1);
    t += DT;
  }
  return { arrived: i >= path.length, time: t, body };
}

test('mapa: geometria construída (paredes mescladas, props, chão)', () => {
  assert.ok(map.solids.length > 100 && map.solids.length < 400, `colliders=${map.solids.length}`);
  assert.ok(map.solids.some((c) => c.kind === 'ramp'), 'tem rampas');
  assert.ok(map.solids.some((c) => c.stair), 'tem escadas');
});

test('mapa: todos os spawns/sítios/posições/rotas/patrulhas estão em terreno navegável e alcançável', () => {
  for (const [label, x, z] of allPoints()) {
    const n = nav.nearestNode(x, 0, z, 1.2);
    assert.ok(n >= 0, `${label} (${x}, ${z}) fora da malha navegável`);
  }
});

test('mapa: spawns e sítios não estão dentro de sólidos', () => {
  for (const [label, x, z] of allPoints()) {
    for (const y of [0.3, 0.9, 1.7]) assert.equal(map.world.pointInSolid(x, y, z), false, `${label} (${x}, ${z}) y=${y} dentro de sólido`);
  }
});

test('navegação: a partir de todos os spawns atacantes existe caminho até A e B (e dos defensores também)', () => {
  for (const s of [...FORJA.spawns.attack, ...FORJA.spawns.defend]) {
    for (const [k, site] of Object.entries(FORJA.sites)) {
      const p = nav.findPath(s.x, 0, s.z, site.x, 0, site.z);
      assert.ok(p, `sem caminho de (${s.x}, ${s.z}) até o sítio ${k}`);
    }
  }
});

test('navegação: caminhos são rápidos (< 15 ms) e razoáveis (não muito mais longos que a linha reta)', () => {
  const s = FORJA.spawns.attack[2];
  for (const site of Object.values(FORJA.sites)) {
    const t0 = performance.now();
    const p = nav.findPath(s.x, 0, s.z, site.x, 0, site.z);
    const ms = performance.now() - t0;
    assert.ok(ms < 15, `A* levou ${ms.toFixed(1)} ms`);
    const straight = Math.hypot(site.x - s.x, site.z - s.z);
    const len = nav.pathLength(p);
    assert.ok(len < straight * 1.7, `caminho ${len.toFixed(1)} m vs reta ${straight.toFixed(1)} m`);
  }
});

test('mapa não tem corredor único obrigatório: bloqueando uma lane ainda há rota alternativa para cada sítio', () => {
  const s = FORJA.spawns.attack[2];
  const blockers = {
    norte: { x: -28, z: -20, r: 4.5 },     // corredor norte
    saguaoMeio: { x: -20, z: 0, r: 6 },    // praça
    sul: { x: -28, z: 20, r: 4.5 },        // corredor sul
  };
  const check = (site, blocked) => {
    const b = blockers[blocked];
    const p = nav.findPath(s.x, 0, s.z, site.x, 0, site.z, { avoid: [{ ...b, cost: 1e6 }], smooth: false });
    assert.ok(p, `sem rota para ${site.name} bloqueando ${blocked}`);
    const through = p.some((q) => Math.hypot(q.x - b.x, q.z - b.z) < b.r * 0.8);
    assert.equal(through, false, `rota para ${site.name} ainda passa por ${blocked}`);
  };
  check(FORJA.sites.A, 'norte');
  check(FORJA.sites.A, 'saguaoMeio');
  check(FORJA.sites.B, 'sul');
  check(FORJA.sites.B, 'saguaoMeio');
});

test('rotas por lane: cada rota do mapa é contínua e as lanes são realmente diferentes', () => {
  const s = FORJA.spawns.attack[2];
  const lanePaths = {};
  for (const [site, lanes] of Object.entries(FORJA.routes)) {
    for (const [lane, wps] of Object.entries(lanes)) {
      let from = { x: s.x, z: s.z };
      const pts = [];
      for (const [x, z] of wps) {              // só a aproximação (sem o trecho final até o sítio)
        const p = nav.findPath(from.x, 0, from.z, x, 0, z);
        assert.ok(p, `trecho quebrado em ${site}/${lane} → (${x}, ${z})`);
        pts.push(...p);
        from = { x, z };
      }
      const last = nav.findPath(from.x, 0, from.z, FORJA.sites[site].x, 0, FORJA.sites[site].z);
      assert.ok(last, `sem caminho final ${site}/${lane} até o sítio`);
      lanePaths[`${site}/${lane}`] = pts;
    }
  }
  const zMin = (pts) => Math.min(...pts.map((p) => p.z));
  const zMax = (pts) => Math.max(...pts.map((p) => p.z));
  assert.ok(zMin(lanePaths['A/norte']) < -26, 'lane norte passa pelo galpão norte');
  assert.ok(zMax(lanePaths['B/sul']) > 26, 'lane sul passa pelo galpão sul');
  assert.ok(zMin(lanePaths['A/meio']) > -14, 'lane meio não vai ao galpão norte');
});

test('física real: um personagem consegue percorrer os caminhos (portas, rampas, escadas, plataformas)', () => {
  const s = FORJA.spawns.attack[0];
  const goals = [
    ['sítio A', FORJA.sites.A.x, FORJA.sites.A.z],
    ['sítio B', FORJA.sites.B.x, FORJA.sites.B.z],
    ['topo da plataforma norte (rampa)', -4, -8],
    ['topo da plataforma sul (escada)', -4, 8],
    ['camarote A (rampa)', 36, -29],
    ['mezanino B (escada)', 36, 29],
    ['sala de controle', 36, 0],
  ];
  for (const [label, x, z] of goals) {
    const y = ['topo da plataforma norte (rampa)', 'topo da plataforma sul (escada)'].includes(label) ? 2.6 : label.includes('camarote') || label.includes('mezanino') ? 2.4 : 0;
    const p = nav.findPath(s.x, 0, s.z, x, y, z);
    assert.ok(p, `sem caminho para ${label}`);
    const r = walk(p);
    assert.ok(r.arrived, `personagem não completou o caminho até ${label} (t=${r.time.toFixed(1)}s, pos=${r.body.pos.x.toFixed(1)},${r.body.pos.z.toFixed(1)})`);
    assert.ok(Math.abs(r.body.pos.y - y) < 0.3, `${label}: altura final ${r.body.pos.y.toFixed(2)} esperada ~${y}`);
  }
});

test('plataformas elevadas realmente existem no mapa e são alcançáveis (rampa e escada)', () => {
  const high = nav.nearestNode(-4, 2.6, -8, 1);
  assert.ok(high >= 0 && nav.py[high] > 2.4, 'plataforma norte alcançável');
  const high2 = nav.nearestNode(36, 2.4, 29, 1);
  assert.ok(high2 >= 0 && nav.py[high2] > 2.2, 'mezanino B alcançável');
});

test('linhas de visão: existem longas (rifle) e curtas (corpo a corpo); paredes bloqueiam entre áreas', () => {
  const w = map.world;
  // longa: ao longo do galpão norte (35 m livres em z=-25.5) e cobertura alta quebrando outra faixa
  assert.equal(w.hasLineOfSight(-29, 1.6, -25.5, 6, 1.6, -25.5), true, 'linha longa de 35 m para rifles');
  assert.equal(w.hasLineOfSight(-29, 1.6, -27.5, 6, 1.6, -27.5), false, 'pilares quebram a linha (cobertura)');
  // da doca para a sala de controle: parede no meio
  assert.equal(w.hasLineOfSight(-41, 1.6, 0, 36, 1.6, 0), false);
  // linha da praça pelo corredor central (rifle de longa distância, defensor → praça)
  assert.equal(w.hasLineOfSight(30, 1.6, 1, 6, 1.6, 1), true, 'sala de controle enxerga o corredor central');
});

test('sítios A e B estão a céu aberto (sem teto) para leitura clara e sol', () => {
  for (const s of Object.values(FORJA.sites)) {
    assert.equal(map.world.isBlocked(s.x, 1, s.z, s.x, 20, s.z), false);
  }
});

test('salas interiores têm teto (mapa fechado) e claraboias deixam luz entrar', () => {
  assert.equal(map.world.isBlocked(-38, 1, 0, -38, 20, 0), true, 'doca coberta');
  assert.equal(map.world.isBlocked(-18, 1, -27.5, -18, 20, -27.5), false, 'claraboia no galpão norte');
});

test('construção rápida: mapa + navegação em menos de 1.5 s', () => {
  const t0 = performance.now();
  const m = buildMap(FORJA);
  new NavGrid(m.world, FORJA.bounds).build(seeds);
  assert.ok(performance.now() - t0 < 1500);
});
