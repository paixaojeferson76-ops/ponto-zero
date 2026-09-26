// Arma em primeira pessoa (viewmodel): braços + modelo com sway, bob, mira (ADS), recuo por mola,
// animações de recarga/troca/faca/granada, flash do cano. Renderizada em cena/câmera próprias.
import * as THREE from 'three';
import { MODEL_KIND_BY_DEF, buildWeaponModel, makeSoftTexture } from './WeaponModels.js';
import { PHASE } from '../Weapons/WeaponSystem.js';
import { clamp, damp, lerp, wrapPi } from '../Systems/MathUtil.js';

// pose base (câmera de viewmodel olha para -Z; unidades em metros)
const POSES = {
  rifle:   { pos: [0.11, -0.128, -0.35], ads: [0.0, -0.092, -0.27], rot: [0, 0.02, 0], scale: 0.6 },
  smg:     { pos: [0.11, -0.118, -0.33], ads: [0.0, -0.088, -0.25], rot: [0, 0.02, 0], scale: 0.68 },
  pistol:  { pos: [0.1, -0.1, -0.27], ads: [0.0, -0.078, -0.23], rot: [0, 0.02, 0], scale: 0.85 },
  shotgun: { pos: [0.11, -0.128, -0.35], ads: [0.0, -0.094, -0.27], rot: [0, 0.02, 0], scale: 0.62 },
  knife:   { pos: [0.16, -0.13, -0.3], ads: [0.16, -0.13, -0.3], rot: [0.1, -0.35, 0.25], scale: 0.9 },
  grenade: { pos: [0.13, -0.12, -0.3], ads: [0.13, -0.12, -0.3], rot: [0, 0, 0], scale: 1.15 },
};

const SLEEVE = { attack: 0x9b5d1f, defend: 0x1c6f8c };
let flashTex = null;

export class ViewModel {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.root = new THREE.Group();
    this.holder = new THREE.Group();          // recebe sway/recuo/animações
    this.root.add(this.holder);
    sceneManager.vmScene.add(this.root);
    this.models = new Map();
    this.currentId = null;
    this.current = null;
    this.arms = [];
    this.armMat = new THREE.MeshLambertMaterial({ color: SLEEVE.attack });
    this.gloveMat = new THREE.MeshLambertMaterial({ color: 0x1b1d21 });
    this._buildArms();
    if (!flashTex) flashTex = makeSoftTexture('rgba(255,240,190,1)', 'rgba(255,170,60,0)');
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffd08a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.34, 0.34, 1);
    this.flash.visible = false;
    this.flashT = 0;

    this.bobT = 0;
    this.bobAmp = 0;
    this.swayYaw = 0;
    this.swayPitch = 0;
    this.lastYaw = 0;
    this.lastPitch = 0;
    this.kick = { back: 0, up: 0, pitch: 0, vb: 0, vu: 0, vp: 0 };
    this.lastShotCounter = 0;
    this.swingT = 1;
    this.swingAlt = false;
    this.throwT = 1;
    this.equipBlend = 0;
    this.visible = true;
    this.sizeMul = 1;             // < 1 no celular (tela pequena)
    this.root.visible = false;
  }

  _buildArms() {
    // dois antebraços simples: de baixo da tela até as mãos
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), this.armMat);
      sleeve.position.z = 0.25;
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.09), this.gloveMat);
      g.add(sleeve, glove);
      this.holder.add(g);
      this.arms.push(g);
    }
  }

  setTeam(team) {
    this.armMat.color.setHex(SLEEVE[team] || SLEEVE.attack);
  }

  _ensureModel(def) {
    if (!def || this.currentId === def.id) return;
    if (this.current) this.current.group.visible = false;
    let m = this.models.get(def.id);
    if (!m) {
      const kind = MODEL_KIND_BY_DEF[def.id] || 'rifle';
      m = buildWeaponModel(kind, def.kind);
      m.kind = kind;
      const pose = POSES[kind] || POSES.rifle;
      m.group.scale.setScalar(pose.scale);
      m.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      this.holder.add(m.group);
      this.models.set(def.id, m);
    }
    m.group.visible = true;
    this.current = m;
    this.currentId = def.id;
    m.muzzle.add(this.flash);
    this.flash.visible = false;
  }

  onFired() {
    this.flashT = 0.045;
  }

  onMeleeSwing(alt) {
    this.swingT = 0;
    this.swingAlt = alt;
  }

  onGrenadeThrown() {
    this.throwT = 0;
  }

  /**
   * @param {number} dt
   * @param {import('../Player/Combatant.js').Combatant} p jogador
   * @param {{yaw:number,pitch:number}} view ângulos atuais (para sway)
   * @param {boolean} show mostra (vivo, primeira pessoa)
   */
  update(dt, p, show) {
    this.root.visible = show && !!p.weapons.def;
    if (!this.root.visible) return;
    const w = p.weapons;
    const def = w.def;
    this._ensureModel(def);
    this.setTeam(p.team);
    const m = this.current;
    const pose = POSES[m.kind] || POSES.rifle;
    const body = p.body;
    m.group.scale.setScalar(pose.scale * this.sizeMul);

    // recuo por mola (impulso a cada tiro)
    const rec = w.recoil;
    if (rec.shotCounter !== this.lastShotCounter) {
      this.lastShotCounter = rec.shotCounter;
      const k = this.kick;
      k.vb += (def.vmKickBack || 0.03) * 38;
      k.vu += (def.vmKickUp || 0.01) * 38;
      k.vp += ((def.vmKickPitch || 2) * Math.PI / 180) * 38;
    }
    const k = this.kick;
    const stiff = 190, damping = 19;
    k.vb += (-stiff * k.back - damping * k.vb) * dt; k.back += k.vb * dt;
    k.vu += (-stiff * k.up - damping * k.vu) * dt; k.up += k.vu * dt;
    k.vp += (-stiff * k.pitch - damping * k.vp) * dt; k.pitch += k.vp * dt;

    // bob e sway
    const speed = body.onGround ? body.speedXZ : 0;
    this.bobT += speed * dt * 1.6;
    this.bobAmp = damp(this.bobAmp, clamp(speed / 6, 0, 1), 9, dt);
    const ads = w.adsAmount;
    const dYaw = wrapPi(p.view.yaw - this.lastYaw);
    const dPitch = p.view.pitch - this.lastPitch;
    this.lastYaw = p.view.yaw;
    this.lastPitch = p.view.pitch;
    this.swayYaw = damp(this.swayYaw + clamp(dYaw, -0.15, 0.15) * -0.9, 0, 9, dt);
    this.swayPitch = damp(this.swayPitch + clamp(dPitch, -0.15, 0.15) * -0.9, 0, 9, dt);
    const damp2 = lerp(1, 0.25, ads);

    let x = lerp(pose.pos[0], pose.ads[0], ads);
    let y = lerp(pose.pos[1], pose.ads[1], ads);
    let z = lerp(pose.pos[2], pose.ads[2], ads);
    x += Math.sin(this.bobT) * 0.008 * this.bobAmp * damp2 + this.swayYaw * 0.05;
    y += Math.abs(Math.sin(this.bobT)) * 0.007 * this.bobAmp * damp2 - Math.sin(performance.now() * 0.0016) * 0.0012 + this.swayPitch * 0.04;
    z += k.back;
    y += k.up;
    let rx = pose.rot[0] + k.pitch + this.swayPitch * 0.5;
    let ry = pose.rot[1] + this.swayYaw * 0.6;
    let rz = pose.rot[2] + this.swayYaw * 0.4 - (body.vel.x * Math.cos(p.view.yaw) - body.vel.z * Math.sin(p.view.yaw)) * 0.004 * damp2;

    // troca de arma
    if (w.phase === PHASE.HOLSTER) {
      const t = clamp(w.phaseProgress, 0, 1);
      y -= 0.34 * t; rx -= 0.9 * t;
    } else if (w.phase === PHASE.EQUIP) {
      const t = 1 - clamp(w.phaseProgress, 0, 1);
      y -= 0.34 * t * t; rx -= 0.9 * t * t;
    }

    // recarga
    if (m.mag) { m.mag.position.y = m.mag.userData.baseY ?? (m.mag.userData.baseY = m.mag.position.y); m.mag.visible = true; }
    if (w.phase === PHASE.RELOAD) this._reloadAnim(w, m, def, (v) => { x += v.x || 0; y += v.y || 0; z += v.z || 0; rx += v.rx || 0; ry += v.ry || 0; rz += v.rz || 0; });
    else if (m.pump) m.pump.position.z = m.pump.userData.baseZ ?? (m.pump.userData.baseZ = m.pump.position.z);

    // bombeada da espingarda
    if (m.pump) {
      const base = m.pump.userData.baseZ ?? (m.pump.userData.baseZ = m.pump.position.z);
      if (w.phase !== PHASE.RELOAD) {
        const since = w.time - (w.nextFireAt - (def.fireInterval || 0.85));
        const t = clamp(since / (def.fireInterval || 0.85), 0, 1);
        m.pump.position.z = base + Math.sin(clamp((t - 0.2) / 0.5, 0, 1) * Math.PI) * 0.09;
      }
    }

    // faca
    if (m.kind === 'knife' && this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt / (this.swingAlt ? 0.5 : 0.32));
      const t = this.swingT;
      const s = Math.sin(t * Math.PI);
      if (this.swingAlt) { z -= 0.32 * s; y += 0.03 * s; rx += 0.2 * s; }
      else { x -= 0.3 * s; ry += 1.0 * s - 0.4 * t; rz -= 0.9 * s; y += 0.04 * s; }
    }
    // granada
    if (m.kind === 'grenade') {
      if (w.phase === PHASE.WINDUP) { const t = clamp(w.phaseProgress, 0, 1); z += 0.12 * t; y += 0.06 * t; rx += 0.5 * t; }
      if (this.throwT < 1) {
        this.throwT = Math.min(1, this.throwT + dt / 0.35);
        const s = Math.sin(this.throwT * Math.PI);
        z -= 0.2 * s; y -= 0.05 * s; rx -= 0.6 * s;
      }
      m.group.visible = w.phase !== PHASE.RECOVER && this.throwT >= 0.6 || w.phase === PHASE.WINDUP || this.throwT < 0.5;
    } else m.group.visible = true;

    m.group.position.set(x, y, z);
    m.group.rotation.set(rx, ry, rz);
    this._placeArms(m, def);

    // flash do cano
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = this.flashT > 0 && m.kind !== 'knife';
      this.flash.material.rotation = Math.random() * 6.28;
      const s = 0.22 + Math.random() * 0.2;
      this.flash.scale.set(s, s, 1);
      this.sm.vmFlash.intensity = 6 * (this.flashT / 0.045);
    } else {
      this.flash.visible = false;
      this.sm.vmFlash.intensity = 0;
    }
  }

  _reloadAnim(w, m, def, add) {
    const p = clamp(w.phaseProgress, 0, 1);
    if (def.reloadStyle === 'shell') {
      const t = Math.sin(p * Math.PI * 6) * 0.5 + 0.5;
      add({ y: -0.04, rx: 0.25, rz: -0.35, x: -0.02 * t });
      return;
    }
    const bump = Math.sin(clamp(p / 0.85, 0, 1) * Math.PI);          // sobe e volta
    add({ y: -0.06 * bump, rx: 0.5 * bump, rz: -0.55 * bump, x: -0.03 * bump });
    if (m.mag) {
      const base = m.mag.userData.baseY;
      if (p < 0.3) m.mag.position.y = base;
      else if (p < 0.45) { m.mag.position.y = base - ((p - 0.3) / 0.15) * 0.22; }
      else if (p < 0.6) m.mag.visible = false;
      else if (p < 0.8) { m.mag.position.y = base - 0.22 + ((p - 0.6) / 0.2) * 0.22; }
    }
  }

  _placeArms(m, def) {
    const g = m.group;
    g.updateMatrix();
    const right = m.handR.clone().applyMatrix4(g.matrix);
    const left = m.handL.clone().applyMatrix4(g.matrix);
    const targets = [right, left];
    const hideLeft = m.kind === 'pistol' && false;
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i];
      const t = targets[i];
      arm.position.copy(t);
      // aponta o antebraço para baixo/atrás da tela
      const from = new THREE.Vector3(i === 0 ? 0.28 : -0.2, -0.42, 0.15);
      arm.lookAt(from);
      arm.visible = !(i === 1 && (m.kind === 'knife' || hideLeft || (m.kind === 'grenade' && false)));
      if (m.kind === 'knife' && i === 1) arm.visible = false;
    }
    void def;
  }

  hide() { this.root.visible = false; }
}
