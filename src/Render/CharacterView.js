// Representação 3D de um combatente: humanoide de caixas alinhado às hitboxes, com colete/capacete por time,
// arma na mão, ciclo de andar, agachar, morte e nome do aliado. Peças fundidas com cores por vértice
// (≈8 draw calls por personagem).
import * as THREE from 'three';
import { MODEL_KIND_BY_DEF, buildWeaponModel, makeSoftTexture } from './WeaponModels.js';
import { bakeGroup, mergeBoxSpecs } from './GeoUtil.js';

const TEAM_COLORS = {
  attack: { vest: 0xe08a2e, helmet: 0x3a3e45, band: 0xffc25a },
  defend: { vest: 0x2fa8cf, helmet: 0x2f353c, band: 0x8fe3ff },
};
const PANTS = 0x2b3038, SKIN = 0xc79a76, BOOT = 0x1a1c20, GEAR = 0x3b4148;

let flashTexture = null;
const partGeoCache = new Map();

function partGeo(key, build) {
  let g = partGeoCache.get(key);
  if (!g) { g = build(); partGeoCache.set(key, g); }
  return g;
}

export class CharacterView {
  constructor(combatant, scene) {
    this.c = combatant;
    this.scene = scene;
    this.root = new THREE.Group();
    this.walkPhase = 0;
    this.deathT = 0;
    this.hitFlash = 0;
    this.muzzleFlash = 0;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.weaponModels = new Map();
    this.currentWeaponId = null;
    this.muzzleObject = null;
    this.tag = null;
    this._build();
    scene.add(this.root);
  }

  _mesh(geo, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, this.material);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  _build() {
    const team = TEAM_COLORS[this.c.team];
    const legGeo = partGeo('leg', () => mergeBoxSpecs([
      { w: 0.22, h: 0.86, d: 0.24, color: PANTS, y: -0.43 },
      { w: 0.24, h: 0.12, d: 0.3, color: BOOT, y: -0.86, z: -0.03 },
    ]));
    this.legL = new THREE.Group(); this.legL.position.set(-0.12, 0.92, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.12, 0.92, 0);
    this._mesh(legGeo, this.legL);
    this._mesh(legGeo, this.legR);
    this.root.add(this.legL, this.legR);

    this.spine = new THREE.Group();
    this.spine.position.set(0, 0.92, 0);
    this.root.add(this.spine);
    const torsoGeo = partGeo(`torso-${this.c.team}`, () => mergeBoxSpecs([
      { w: 0.5, h: 0.6, d: 0.32, color: GEAR, y: 0.3 },
      { w: 0.52, h: 0.42, d: 0.34, color: team.vest, y: 0.36 },
      { w: 0.5, h: 0.08, d: 0.34, color: 0x22252a, y: 0.05 },
    ]));
    this._mesh(torsoGeo, this.spine);

    this.head = new THREE.Group();
    this.head.position.set(0, 0.74, 0);
    this.spine.add(this.head);
    const headGeo = partGeo(`head-${this.c.team}`, () => mergeBoxSpecs([
      { w: 0.24, h: 0.26, d: 0.24, color: SKIN },
      { w: 0.29, h: 0.13, d: 0.29, color: team.helmet, y: 0.11 },
      { w: 0.26, h: 0.07, d: 0.02, color: 0x0c1116, y: 0.02, z: -0.125 },
      { w: 0.3, h: 0.03, d: 0.3, color: team.band, y: 0.06 },
    ]));
    this._mesh(headGeo, this.head);

    const armGeo = partGeo(`arm-${this.c.team}`, () => mergeBoxSpecs([
      { w: 0.16, h: 0.5, d: 0.18, color: team.vest, y: -0.25 },
      { w: 0.13, h: 0.12, d: 0.14, color: SKIN, y: -0.54 },
    ]));
    this.armR = new THREE.Group(); this.armR.position.set(0.33, 0.55, 0);
    this.armL = new THREE.Group(); this.armL.position.set(-0.33, 0.55, 0);
    this._mesh(armGeo, this.armR);
    this._mesh(armGeo, this.armL);
    this.spine.add(this.armR, this.armL);
    this.armR.rotation.set(-1.25, 0.0, -0.15);
    this.armL.rotation.set(-1.35, 0.0, 0.5);

    this.weaponAnchor = new THREE.Group();
    this.weaponAnchor.position.set(0.17, 0.32, -0.3);
    this.spine.add(this.weaponAnchor);

    if (!flashTexture) flashTexture = makeSoftTexture('rgba(255,235,170,1)', 'rgba(255,160,40,0)');
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture, color: 0xffd48a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.55, 0.55, 1);
    this.flash.visible = false;
  }

  setNameTag(show) {
    if (!show) { if (this.tag) this.tag.visible = false; return; }
    if (!this.tag) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.font = '700 34px "Bahnschrift","Segoe UI",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,12,16,0.55)';
      ctx.fillRect(28, 6, 200, 50);
      ctx.fillStyle = '#9fe7ff';
      ctx.fillText(this.c.name.toUpperCase(), 128, 44);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true, fog: false }));
      this.tag.scale.set(0.9, 0.225, 1);
      this.tag.position.set(0, 2.15, 0);
      this.root.add(this.tag);
    }
    this.tag.visible = true;
  }

  _ensureWeapon(def) {
    if (!def || this.currentWeaponId === def.id) return;
    for (const m of this.weaponModels.values()) m.visible = false;
    let holder = this.weaponModels.get(def.id);
    if (!holder) {
      const model = buildWeaponModel(MODEL_KIND_BY_DEF[def.id] || 'rifle', def.kind);
      const geo = partGeo(`wpn-${def.id}`, () => bakeGroup(model.group, (o) => o === model.muzzle));
      holder = new THREE.Group();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.castShadow = true;
      holder.add(mesh);
      const muzzle = new THREE.Object3D();
      muzzle.position.copy(model.muzzle.position);
      holder.add(muzzle);
      holder.userData.muzzle = muzzle;
      this.weaponAnchor.add(holder);
      this.weaponModels.set(def.id, holder);
    }
    holder.visible = true;
    this.currentWeaponId = def.id;
    this.muzzleObject = holder.userData.muzzle;
    this.muzzleObject.add(this.flash);
    this.flash.visible = false;
  }

  onFired() { this.muzzleFlash = 0.05; }
  onHit() { this.hitFlash = 0.12; }

  /** Posição mundial do cano (para tracers). */
  getMuzzleWorld(out) {
    if (!this.muzzleObject) { out.set(this.c.pos.x, this.c.pos.y + 1.3, this.c.pos.z); return out; }
    this.muzzleObject.updateWorldMatrix(true, false);
    return this.muzzleObject.getWorldPosition(out);
  }

  update(dt, alpha, localTeam) {
    const c = this.c;
    const b = c.body;
    this.root.position.set(
      b.prev.x + (b.pos.x - b.prev.x) * alpha,
      b.prev.y + (b.pos.y - b.prev.y) * alpha,
      b.prev.z + (b.pos.z - b.prev.z) * alpha,
    );
    this.root.rotation.y = c.view.yaw;
    this._ensureWeapon(c.weapons.def);

    const speed = c.alive ? b.speedXZ : 0;
    this.walkPhase += speed * dt * 4.2;
    const swing = Math.sin(this.walkPhase) * Math.min(0.9, speed / 5) * (b.onGround ? 1 : 0.2);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;

    const pitch = c.view.pitch;
    this.spine.rotation.x = pitch * 0.35;
    this.head.rotation.x = pitch * 0.5;
    this.root.scale.y = c.alive && b.crouched ? 0.78 : 1;

    if (!c.alive) {
      this.deathT = Math.min(1, this.deathT + dt / 0.45);
      const e = 1 - (1 - this.deathT) * (1 - this.deathT);
      this.root.rotation.x = -e * (Math.PI / 2 - 0.05);
      this.root.position.y += e * 0.14;
    } else {
      this.deathT = 0;
      this.root.rotation.x = 0;
    }

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      const e = this.hitFlash > 0 ? 0.55 : 0;
      this.material.emissive.setRGB(e, e * 0.4, e * 0.3);
    }
    if (this.muzzleFlash > 0) {
      this.muzzleFlash -= dt;
      this.flash.visible = this.muzzleFlash > 0;
      this.flash.material.rotation = Math.random() * 6.28;
    } else this.flash.visible = false;

    if (this.tag) this.tag.visible = c.alive && c.team === localTeam && !c.isPlayer;
  }

  setVisible(v) { this.root.visible = v; }

  dispose() {
    this.scene.remove(this.root);
    this.material.dispose();
    if (this.tag) { this.tag.material.map.dispose(); this.tag.material.dispose(); }
    this.flash.material.dispose();
  }
}
