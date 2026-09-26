// Desenho de debug (F3/F4): hitboxes, tiros/raycasts, visão dos bots, malha de navegação, caminhos e colliders.
import * as THREE from 'three';

const PART_COLOR = { head: 0xff4d4d, torso: 0xffa63d, arm: 0xffe14d, leg: 0x4dd8ff };

export class DebugDraw {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.boxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.boxes = new Map();          // combatente → LineSegments[]
    this.rays = [];
    this.rayIndex = 0;
    for (let i = 0; i < 48; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffff66, transparent: true, depthTest: false }));
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      this.rays.push({ line, life: 0 });
    }
    this.pathLines = new Map();
    this.nav = null;
    this.colliders = null;
    this.level = 0;
    this._worldBoxes = [];
    this.visionLines = [];
  }

  setLevel(level) {
    this.level = level;
    this.group.visible = level >= 2;
    if (this.nav) this.nav.visible = level >= 3;
    if (this.colliders) this.colliders.visible = level >= 4;
  }

  addRay(x0, y0, z0, x1, y1, z1, color = 0xffff66) {
    if (this.level < 2) return;
    const r = this.rays[this.rayIndex];
    this.rayIndex = (this.rayIndex + 1) % this.rays.length;
    const p = r.line.geometry.attributes.position;
    p.setXYZ(0, x0, y0, z0); p.setXYZ(1, x1, y1, z1);
    p.needsUpdate = true;
    r.line.material.color.setHex(color);
    r.line.visible = true;
    r.life = 1.6;
  }

  buildNav(session) {
    if (this.nav || !session.nav) return;
    const nav = session.nav;
    const pos = [];
    for (let i = 0; i < nav.count; i++) if (nav.reachable[i]) pos.push(nav.px[i], nav.py[i] + 0.06, nav.pz[i]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.nav = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x4dff9a, size: 0.09, sizeAttenuation: true, depthTest: true }));
    this.nav.visible = this.level >= 3;
    this.scene.add(this.nav);
  }

  buildColliders(session) {
    if (this.colliders) return;
    const pos = [];
    for (const c of session.world.colliders) {
      if (c.tag === 'floor') continue;
      const { minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1 } = c;
      const e = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) pos.push(...e[a], ...e[b]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.colliders = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8a6bff, transparent: true, opacity: 0.45 }));
    this.colliders.visible = this.level >= 4;
    this.scene.add(this.colliders);
  }

  update(dt, session) {
    if (this.level >= 3) { this.buildNav(session); }
    if (this.level >= 4) { this.buildColliders(session); }
    if (this.level < 2) return;

    for (const c of session.combatants) {
      let list = this.boxes.get(c);
      if (!list) {
        list = [];
        for (let i = 0; i < 6; i++) {
          const m = new THREE.LineSegments(this.boxGeo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
          m.rotation.order = 'YXZ';
          m.frustumCulled = false;
          this.group.add(m);
          list.push(m);
        }
        this.boxes.set(c, list);
      }
      c.hitboxes.worldBoxes(this._worldBoxes);
      for (let i = 0; i < 6; i++) {
        const b = this._worldBoxes[i], m = list[i];
        m.visible = c.alive && !c.isPlayer;
        m.position.set(b.x, b.y, b.z);
        m.scale.set(b.hx * 2, b.hy * 2, b.hz * 2);
        m.rotation.y = b.yaw;
        m.material.color.setHex(PART_COLOR[b.part]);
      }
    }
    for (const r of this.rays) {
      if (!r.line.visible) continue;
      r.life -= dt;
      if (r.life <= 0) r.line.visible = false;
      else r.line.material.opacity = Math.min(1, r.life / 0.8);
    }

    // caminhos e visão dos bots
    if (this.level >= 3) {
      for (const bot of session.bots) {
        let line = this.pathLines.get(bot);
        if (!line) {
          line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: bot.team === 'attack' ? 0xffb347 : 0x4fd0ff, depthTest: false }));
          line.frustumCulled = false;
          this.group.add(line);
          this.pathLines.set(bot, line);
        }
        const path = bot.navigator.path;
        if (!bot.alive || !path) { line.visible = false; continue; }
        const pts = [new THREE.Vector3(bot.pos.x, bot.pos.y + 0.3, bot.pos.z)];
        for (let i = bot.navigator.index; i < path.length; i++) pts.push(new THREE.Vector3(path[i].x, path[i].y + 0.3, path[i].z));
        line.geometry.setFromPoints(pts);
        line.visible = true;
      }
    }
    if (this.level >= 2) {
      for (const bot of session.bots) {
        if (!bot.alive) continue;
        for (const rec of bot.perception.visibleList) {
          if (!rec.visible) continue;
          const eye = bot.eyeArray();
          this.addRay(eye[0], eye[1], eye[2], rec.x, rec.y + 1.2, rec.z, 0x66ff66);
        }
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.nav) this.scene.remove(this.nav);
    if (this.colliders) this.scene.remove(this.colliders);
  }
}
