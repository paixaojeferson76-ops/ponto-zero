// Visualizador de mapa para desenvolvimento: câmera livre via window.setCam(...) (usado nas capturas automáticas).
import { FORJA } from '../src/World/maps/Forja.js';
import { buildMap } from '../src/World/MapBuilder.js';
import { NavGrid } from '../src/World/NavGrid.js';
import { MaterialLibrary } from '../src/Render/Materials.js';
import { MapRenderer } from '../src/Render/MapRenderer.js';
import { SceneManager } from '../src/Render/SceneManager.js';
import { DEFAULT_SETTINGS } from '../src/Config/Settings.js';

const canvas = document.getElementById('c');
const q = new URLSearchParams(location.search);
const video = { ...DEFAULT_SETTINGS.video, quality: (q.get('quality') || 'MEDIUM').toUpperCase() };
const t0 = performance.now();
const built = buildMap(FORJA);
const sm = new SceneManager(canvas, video);
const mats = new MaterialLibrary(4);
const mapR = new MapRenderer(built, mats);
sm.scene.add(mapR.group);
sm.setMapLights(FORJA.lights);
window.__ready = true;
window.__buildMs = performance.now() - t0;

const pose = { x: 0, y: 1.62, z: 0, yaw: 0, pitch: 0, roll: 0, fovV: 68 };
window.setCam = (x, y, z, yaw = 0, pitch = 0, fov = 68) => {
  Object.assign(pose, { x, y, z, yaw, pitch, fovV: fov });
  sm.render(pose, 0.5, false);
  sm.render(pose, 0.5, false);
  sm.render(pose, 0.5, false);
  const i = sm.renderInfo;
  document.getElementById('info').textContent = `draw calls ${i.calls} · tris ${i.tris} · geos ${i.geometries} · tex ${i.textures}`;
  return i;
};
window.__nav = () => {
  const nav = new NavGrid(built.world, FORJA.bounds).build([...FORJA.spawns.attack, ...FORJA.spawns.defend]);
  return { nodes: nav.count };
};
window.setCam(-41, 1.62, 0, -Math.PI / 2, 0);
