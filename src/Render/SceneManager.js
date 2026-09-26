// Renderer, cena, iluminação (sol com sombra seguindo o jogador + pool de luzes pontuais), céu, névoa,
// qualidade gráfica (LOW/MEDIUM/HIGH), resolução de renderização e passe separado do viewmodel.
import * as THREE from 'three';
import { QUALITY_PRESETS, RESOLUTION_OPTIONS } from '../Config/Quality.js';

const SUN_DIR = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();

export class SceneManager {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.preset = QUALITY_PRESETS[video.quality] || QUALITY_PRESETS.MEDIUM;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.preset.antialias, powerPreference: 'high-performance', stencil: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.autoClear = false;
    r.info.autoReset = false;
    r.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1c2128);
    this.scene.fog = new THREE.Fog(0x2b323a, 30, 140);
    this.camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.06, 520);
    this.camera.rotation.order = 'YXZ';

    this.hemi = new THREE.HemisphereLight(0xd3e2ff, 0x8d8474, 2.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 3.6);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    this._buildSky();

    // viewmodel: cena/câmera próprias (não atravessa paredes, FOV estável)
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 6);
    this.vmScene.add(new THREE.HemisphereLight(0xdfe8ff, 0x50463c, 2.6));
    const vmSun = new THREE.DirectionalLight(0xfff2dc, 2.4);
    vmSun.position.set(-1, 2, 1.5);
    this.vmScene.add(vmSun);
    this.vmFlash = new THREE.PointLight(0xffc070, 0, 4, 2);
    this.vmFlash.position.set(0.15, -0.05, -0.7);
    this.vmScene.add(this.vmFlash);

    this.pool = [];
    this.mapLights = [];
    this._lastLightUpdate = 0;
    this.lightAssign = [];
    this._fovApplied = 0;
    this._pixelRatio = 1;
    this.applyVideo(video);
    window.addEventListener('resize', () => this.resize());
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(300, 24, 14);
    const colors = [];
    const pos = geo.attributes.position;
    const top = new THREE.Color(0x4f7fb8), mid = new THREE.Color(0xa9bbcc), hor = new THREE.Color(0xd6c4a2), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 300;
      if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
      else c.copy(hor).lerp(mid, Math.max(0, y / 0.25));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  /** Registra as luzes de interior do mapa e cria o pool de PointLights. */
  setMapLights(lights) {
    this.mapLights = lights.map(([x, y, z, color, intensity, range]) => ({ x, y, z, color: new THREE.Color(color), intensity, range }));
    this._rebuildPool();
  }

  _poolSize() {
    return this.preset === QUALITY_PRESETS.LOW ? 3 : this.preset === QUALITY_PRESETS.MEDIUM ? 5 : 7;
  }

  _rebuildPool() {
    for (const l of this.pool) { this.scene.remove(l.light); l.light.dispose?.(); }
    this.pool = [];
    for (let i = 0; i < this._poolSize(); i++) {
      const light = new THREE.PointLight(0xffffff, 0, 24, 2);
      light.castShadow = false;
      this.scene.add(light);
      this.pool.push({ light, index: -1, target: 0 });
    }
    this.lightAssign = new Array(this.pool.length).fill(-1);
  }

  _updateLightPool(cam, dt) {
    const n = this.mapLights.length;
    if (!n || !this.pool.length) return;
    const now = performance.now();
    if (now - this._lastLightUpdate > 250) {
      this._lastLightUpdate = now;
      const order = [];
      for (let i = 0; i < n; i++) {
        const l = this.mapLights[i];
        order.push([Math.hypot(l.x - cam.x, l.z - cam.z), i]);
      }
      order.sort((a, b) => a[0] - b[0]);
      const wanted = order.slice(0, this.pool.length).map((o) => o[1]);
      // mantém luzes já atribuídas; redistribui as demais
      const free = this.pool.filter((p) => !wanted.includes(p.index));
      for (const idx of wanted) {
        if (this.pool.some((p) => p.index === idx)) continue;
        const slot = free.shift();
        if (!slot) break;
        const ml = this.mapLights[idx];
        slot.index = idx;
        slot.light.position.set(ml.x, ml.y, ml.z);
        slot.light.color.copy(ml.color);
        slot.light.distance = ml.range;
        slot.light.intensity = 0;
      }
      for (const p of this.pool) p.target = wanted.includes(p.index) ? this.mapLights[p.index].intensity * 34 : 0;
    }
    const k = 1 - Math.exp(-8 * dt);
    for (const p of this.pool) p.light.intensity += (p.target - p.light.intensity) * k;
  }

  // ------------------------------------------------------------------ qualidade / resolução

  applyVideo(video) {
    this.video = video;
    this.preset = QUALITY_PRESETS[video.quality] || QUALITY_PRESETS.MEDIUM;
    const shadows = this.preset.shadows && video.shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const size = this.preset.shadowMapSize;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    const R = this.preset.shadowRadius;
    const cam = this.sun.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 1; cam.far = 160;
    cam.updateProjectionMatrix();
    this.scene.fog.far = this.preset.fogFar;
    this.scene.fog.near = this.preset.fogFar * 0.3;
        if (this.mapLights.length) this._rebuildPool();
    this.resize();
    // materiais precisam recompilar quando o shadowMap liga/desliga
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const res = RESOLUTION_OPTIONS.find((o) => o.id === this.video.resolution) || RESOLUTION_OPTIONS[0];
    const dpr = window.devicePixelRatio || 1;
    let pr = Math.min(dpr, this.preset.pixelRatioCap);
    if (res.h > 0) pr = Math.min(1.5, res.h / h);
    this._pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  get renderInfo() {
    const i = this.renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, pixelRatio: this._pixelRatio };
  }

  // ------------------------------------------------------------------ frame

  updateSun(cx, cz) {
    const R = this.preset.shadowRadius;
    const size = this.sun.shadow.mapSize.x || 1024;
    const texel = (2 * R) / size;
    const dir = SUN_DIR;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const p = new THREE.Vector3(cx, 0, cz);
    const sr = Math.round(p.dot(right) / texel) * texel;
    const su = Math.round(p.dot(up) / texel) * texel;
    const center = right.multiplyScalar(sr).addScaledVector(up, su).addScaledVector(dir, p.dot(dir));
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(dir, 70);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * @param {{x,y,z,yaw,pitch,roll,fovV}} pose
   * @param {number} dt
   * @param {THREE.Object3D|null} viewmodel raiz do viewmodel (na vmScene) ou null
   */
  render(pose, dt, hasViewmodel) {
    const cam = this.camera;
    cam.position.set(pose.x, pose.y, pose.z);
    cam.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
    if (Math.abs(this._fovApplied - pose.fovV) > 0.01) {
      cam.fov = pose.fovV;
      cam.updateProjectionMatrix();
      this._fovApplied = pose.fovV;
    }
    this.sky.position.copy(cam.position);
    this.updateSun(pose.x, pose.z);
    this._updateLightPool(cam.position, dt);
    const r = this.renderer;
    r.info.reset();
    r.clear();
    r.render(this.scene, cam);
    if (hasViewmodel) {
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
    }
  }

  dispose() {
    this.renderer.dispose();
  }
}
