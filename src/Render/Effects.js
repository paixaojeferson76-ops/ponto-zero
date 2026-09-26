// Efeitos visuais pooled: tracers, decals de impacto, partículas (1 draw call), explosões, fumaça,
// granadas em voo e a carga. Limites por qualidade (LOW/MEDIUM/HIGH); nada é alocado por tiro.
import * as THREE from 'three';
import { GRENADES } from '../Config/Tuning.js';
import { WEAPONS } from '../Config/WeaponDefs.js';
import { surfaceOf } from '../Config/Surfaces.js';
import { RingBuffer } from '../Systems/ObjectPool.js';
import { makeSoftTexture } from './WeaponModels.js';

const HIDDEN_Y = -1000;

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, 'rgba(8,8,8,0.95)');
  g.addColorStop(0.35, 'rgba(12,12,12,0.85)');
  g.addColorStop(0.7, 'rgba(30,26,22,0.35)');
  g.addColorStop(1, 'rgba(30,26,22,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  /**
   * @param {import('./SceneManager.js').SceneManager} sm
   * @param {(shooter:object, out:THREE.Vector3)=>boolean} getMuzzle posição mundial do cano do atirador
   */
  constructor(sm, getMuzzle) {
    this.sm = sm;
    this.scene = sm.scene;
    this.getMuzzle = getMuzzle;
    this.preset = sm.preset;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // tracers
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.tracers = [];
    this.tracerCount = new Map();
    this._muzzle = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    // decals
    this.holeTex = holeTexture();
    this.decalGeo = new THREE.PlaneGeometry(0.13, 0.13);
    this.decalMat = new THREE.MeshBasicMaterial({ map: this.holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.decals = null;

    // partículas
    this.pCount = 0;
    this.particles = null;

    // explosão / luz de flash
    this.flashLight = new THREE.PointLight(0xffb060, 0, 14, 2);
    this.scene.add(this.flashLight);
    this.flashLightT = 0;
    this.flashLightPeak = 0;
    this.explosions = [];
    this.explosionGeo = new THREE.IcosahedronGeometry(1, 2);

    // fumaça
    this.smokeTex = makeSoftTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)', 96);
    this.smokes = new Map();

    // granadas e bomba
    this.grenadeMeshes = new Map();
    this.grenadeGeo = new THREE.SphereGeometry(0.06, 10, 8);
    this.grenadeMats = {
      frag: new THREE.MeshLambertMaterial({ color: 0x4a6b3a }),
      flash: new THREE.MeshLambertMaterial({ color: 0xd8d2b8 }),
      smoke: new THREE.MeshLambertMaterial({ color: 0x8b9096 }),
    };
    this.bomb = null;
    this.setQuality(sm.preset);
  }

  setQuality(preset) {
    this.preset = preset;
    for (const t of this.tracers) this.group.remove(t.mesh);
    this.tracers.length = 0;
    for (let i = 0; i < preset.maxTracers; i++) {
      const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.tracers.push({ mesh, age: 0, life: 0, active: false, len: 0, fx: 0, fy: 0, fz: 0, dx: 0, dy: 0, dz: 0 });
    }
    this.tracerIndex = 0;

    if (this.decals) for (const d of this.decals.items) this.group.remove(d);
    this.decals = new RingBuffer(preset.maxDecals, () => {
      const m = new THREE.Mesh(this.decalGeo, this.decalMat);
      m.visible = false;
      m.matrixAutoUpdate = true;
      this.group.add(m);
      return m;
    });

    if (this.particles) { this.group.remove(this.particles.points); this.particles.points.geometry.dispose(); }
    const n = preset.maxParticles;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3).fill(0);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = HIDDEN_Y;
    const col = new Float32Array(n * 3).fill(1);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: false, fog: true }));
    points.frustumCulled = false;
    this.group.add(points);
    this.particles = { points, pos, col, vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), n, next: 0, grav: new Float32Array(n) };
  }

  // ------------------------------------------------------------------ eventos

  onTrace(e, localPlayer) {
    const def = WEAPONS[e.weaponId];
    if (!def || !def.tracerEvery) return;
    const count = (this.tracerCount.get(e.shooter) || 0) + 1;
    this.tracerCount.set(e.shooter, count);
    if (def.tracerEvery > 1 && count % def.tracerEvery !== 0) return;
    const m = this._muzzle;
    if (!this.getMuzzle(e.shooter, m)) m.set(e.fromX, e.fromY - 0.1, e.fromZ);
    const dx = e.toX - m.x, dy = e.toY - m.y, dz = e.toZ - m.z;
    const len = Math.hypot(dx, dz, dy);
    if (len < 1) return;
    const t = this.tracers[this.tracerIndex];
    this.tracerIndex = (this.tracerIndex + 1) % this.tracers.length;
    t.active = true; t.age = 0; t.life = 0.09;
    t.fx = m.x; t.fy = m.y; t.fz = m.z;
    t.dx = dx / len; t.dy = dy / len; t.dz = dz / len; t.len = len;
    t.mesh.material.color.setHex(def.tracerColor || 0xffe0a0);
    t.mesh.visible = true;
    void localPlayer;
  }

  onImpact(e) {
    const surf = surfaceOf(e.surface);
    // decal
    const d = this.decals.take();
    d.visible = true;
    d.position.set(e.x + e.nx * 0.006, e.y + e.ny * 0.006, e.z + e.nz * 0.006);
    this._tmp.set(e.x + e.nx, e.y + e.ny, e.z + e.nz);
    d.lookAt(this._tmp);
    d.rotateZ(Math.random() * 6.28);
    const s = e.exit ? 0.8 : 1;
    d.scale.set(s, s, 1);
    // poeira/faíscas
    const metal = e.surface === 'metal';
    this.burst(e.x, e.y, e.z, e.nx, e.ny, e.nz, metal ? 0xffd27a : surf.dust, metal ? 6 : 8, metal ? 3.2 : 1.6, 0.45, metal ? 9 : 3);
  }

  onBodyHit(e) {
    this.burst(e.x, e.y, e.z, -e.dx, 0.2, -e.dz, e.part === 'head' ? 0xd23a2a : 0x9c2a1e, 10, 2.2, 0.5, 9);
  }

  onExplosion(x, y, z, radius = GRENADES.FRAG.RADIUS) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.explosionGeo, mat);
    mesh.position.set(x, y + 0.3, z);
    this.group.add(mesh);
    this.explosions.push({ mesh, age: 0, life: 0.45, radius });
    this.flashLight.position.set(x, y + 1.2, z);
    this.flashLight.distance = 28;
    this.flashLightPeak = 420;
    this.flashLightT = 0.5;
    this.burst(x, y + 0.4, z, 0, 1, 0, 0x6a625a, 26, 5.5, 1.1, 2);
    this.burst(x, y + 0.4, z, 0, 1, 0, 0xffb14a, 18, 7, 0.55, 6);
  }

  muzzleLight(x, y, z, intensity = 7) {
    if (!this.preset.muzzleLights) return;
    this.flashLight.position.set(x, y, z);
    this.flashLight.distance = 14;
    this.flashLightPeak = Math.max(this.flashLightPeak * (this.flashLightT > 0 ? 1 : 0), intensity * 6);
    this.flashLightT = Math.max(this.flashLightT, 0.05);
  }

  burst(x, y, z, nx, ny, nz, color, count, speed, life, gravity) {
    const p = this.particles;
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const k = p.next;
      p.next = (p.next + 1) % p.n;
      p.pos[k * 3] = x; p.pos[k * 3 + 1] = y; p.pos[k * 3 + 2] = z;
      const sp = speed * (0.4 + Math.random() * 0.8);
      p.vel[k * 3] = (nx + (Math.random() - 0.5) * 1.3) * sp;
      p.vel[k * 3 + 1] = (ny + (Math.random() - 0.3) * 1.3) * sp;
      p.vel[k * 3 + 2] = (nz + (Math.random() - 0.5) * 1.3) * sp;
      p.life[k] = p.max[k] = life * (0.6 + Math.random() * 0.6);
      p.grav[k] = gravity;
      p.col[k * 3] = c.r; p.col[k * 3 + 1] = c.g; p.col[k * 3 + 2] = c.b;
    }
    p.points.geometry.attributes.color.needsUpdate = true;
  }

  // ------------------------------------------------------------------ bomba

  plantBomb(x, y, z) {
    this.removeBomb();
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.28), new THREE.MeshLambertMaterial({ color: 0x3b4a33 }));
    body.position.y = 0.09;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    led.position.set(0.12, 0.2, 0);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.set(0.5, 0.5, 1);
    glow.position.copy(led.position);
    g.add(body, led, glow);
    g.position.set(x, y, z);
    this.group.add(g);
    this.bomb = { group: g, glow, blink: 0 };
  }

  beepBomb() {
    if (this.bomb) this.bomb.blink = 0.12;
  }

  removeBomb() {
    if (!this.bomb) return;
    this.group.remove(this.bomb.group);
    this.bomb = null;
  }

  // ------------------------------------------------------------------ frame

  update(dt, session) {
    // tracers: cabeça avança rápido; rastro de ~7 m
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.age += dt;
      const u = t.age / t.life;
      if (u >= 1) { t.active = false; t.mesh.visible = false; continue; }
      const head = Math.min(t.len, u * t.len * 1.4 + 2);
      const tail = Math.max(0, head - 7);
      const seg = Math.max(0.05, head - tail);
      const mid = (head + tail) / 2;
      t.mesh.position.set(t.fx + t.dx * mid, t.fy + t.dy * mid, t.fz + t.dz * mid);
      t.mesh.scale.set(0.018, 0.018, seg);
      this._tmp.set(t.fx + t.dx * head, t.fy + t.dy * head, t.fz + t.dz * head);
      t.mesh.lookAt(this._tmp);
      t.mesh.material.opacity = 0.9 * (1 - u);
    }

    // partículas
    const p = this.particles;
    let dirty = false;
    for (let i = 0; i < p.n; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) { p.pos[i * 3 + 1] = HIDDEN_Y; dirty = true; continue; }
      p.vel[i * 3 + 1] -= p.grav[i] * dt;
      p.pos[i * 3] += p.vel[i * 3] * dt;
      p.pos[i * 3 + 1] += p.vel[i * 3 + 1] * dt;
      p.pos[i * 3 + 2] += p.vel[i * 3 + 2] * dt;
      if (p.pos[i * 3 + 1] < 0.02) { p.pos[i * 3 + 1] = 0.02; p.vel[i * 3 + 1] *= -0.3; p.vel[i * 3] *= 0.6; p.vel[i * 3 + 2] *= 0.6; }
      dirty = true;
    }
    if (dirty) p.points.geometry.attributes.position.needsUpdate = true;

    // luz de flash
    if (this.flashLightT > 0) {
      this.flashLightT -= dt;
      const k = Math.max(0, this.flashLightT) / 0.5;
      this.flashLight.intensity = this.flashLightPeak * Math.min(1, k * (this.flashLightPeak > 100 ? 1 : 12));
    } else this.flashLight.intensity = 0;

    // explosões
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.age += dt;
      const u = e.age / e.life;
      if (u >= 1) { this.group.remove(e.mesh); e.mesh.material.dispose(); this.explosions.splice(i, 1); continue; }
      const s = (0.4 + 1.4 * (1 - (1 - u) * (1 - u))) * e.radius * 0.35;
      e.mesh.scale.setScalar(s);
      e.mesh.material.opacity = 0.9 * (1 - u) * (1 - u);
    }

    this._updateSmokes(dt, session);
    this._updateGrenades(session);

    if (this.bomb) {
      this.bomb.blink = Math.max(0, this.bomb.blink - dt);
      this.bomb.glow.visible = this.bomb.blink > 0;
    }
  }

  _updateSmokes(dt, session) {
    const live = new Set(session.world.smokes);
    for (const s of live) {
      let cl = this.smokes.get(s);
      if (!cl) {
        cl = { sprites: [], seeds: [] };
        const n = this.preset === undefined ? 10 : (this.preset.maxParticles > 200 ? 18 : this.preset.maxParticles > 100 ? 14 : 10);
        for (let i = 0; i < n; i++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: 0xcfd3d6, transparent: true, opacity: 0.9, depthWrite: false, fog: true }));
          this.group.add(sp);
          cl.sprites.push(sp);
          const a = Math.random() * 6.28, b = Math.acos(2 * Math.random() - 1), r = 0.25 + Math.random() * 0.6;
          cl.seeds.push({ x: Math.sin(b) * Math.cos(a) * r, y: Math.cos(b) * r * 0.7, z: Math.sin(b) * Math.sin(a) * r, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.3 });
        }
        this.smokes.set(s, cl);
      }
      const R = s.radius;
      for (let i = 0; i < cl.sprites.length; i++) {
        const sp = cl.sprites[i], sd = cl.seeds[i];
        sp.position.set(s.x + sd.x * R, s.y + sd.y * R * 0.85, s.z + sd.z * R);
        const size = R * (1.05 + 0.3 * sd.y);
        sp.scale.set(size * 1.5, size * 1.5, 1);
        sd.rot += sd.spin * dt;
        sp.material.rotation = sd.rot;
        sp.material.opacity = 0.9 * Math.min(1, R / (s.maxRadius * 0.6));
      }
    }
    for (const [s, cl] of this.smokes) {
      if (live.has(s)) continue;
      for (const sp of cl.sprites) { this.group.remove(sp); sp.material.dispose(); }
      this.smokes.delete(s);
    }
  }

  _updateGrenades(session) {
    const active = new Set();
    for (const g of session.grenades.list) {
      if (!g.active) continue;
      active.add(g);
      let m = this.grenadeMeshes.get(g);
      if (!m) {
        m = new THREE.Mesh(this.grenadeGeo, this.grenadeMats[g.kind]);
        m.scale.set(1, 1.25, 1);
        this.group.add(m);
        this.grenadeMeshes.set(g, m);
      }
      m.material = this.grenadeMats[g.kind];
      m.position.set(g.x, g.y, g.z);
      m.rotation.x += 0.2; m.rotation.z += 0.13;
    }
    for (const [g, m] of this.grenadeMeshes) {
      if (!active.has(g)) { this.group.remove(m); this.grenadeMeshes.delete(g); }
    }
  }

  /** Limpa efeitos persistentes (decals, fumaça, bomba) — chamado a cada round. */
  clearRound() {
    for (const d of this.decals.items) d.visible = false;
    for (const t of this.tracers) { t.active = false; t.mesh.visible = false; }
    this.removeBomb();
    const p = this.particles;
    p.life.fill(0);
    for (let i = 0; i < p.n; i++) p.pos[i * 3 + 1] = HIDDEN_Y;
    p.points.geometry.attributes.position.needsUpdate = true;
    for (const e of this.explosions) { this.group.remove(e.mesh); e.mesh.material.dispose(); }
    this.explosions.length = 0;
    this.tracerCount.clear();
  }

  dispose() {
    this.scene.remove(this.group);
    this.tracerGeo.dispose();
    this.decalGeo.dispose();
    this.holeTex.dispose();
    this.smokeTex.dispose();
    this.explosionGeo.dispose();
    this.grenadeGeo.dispose();
  }
}
