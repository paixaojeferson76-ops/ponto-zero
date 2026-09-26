// Percepção do bot: visão (FOV + distância + raycast + fumaça + acúmulo de consciência) e audição.
import { DEG, angleDelta, clamp } from '../Systems/MathUtil.js';
import { AI } from './AIConfig.js';

const SOUND_PRIORITY = {
  explosion: 4, gunshot: 3, plant: 3, flash: 2, melee: 2, land: 1, reload: 1, footstep: 1, jump: 1, smoke: 1, beep: 0,
};

export class EnemyRecord {
  constructor(enemy) {
    this.enemy = enemy;
    this.visible = false;
    this.spotted = false;
    this.awareness = 0;
    this.lastSeen = -Infinity;
    this.spottedAt = -Infinity;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vz = 0;
    this.dist = Infinity;
  }
}

export class Perception {
  constructor(bot) {
    this.bot = bot;
    this.records = new Map();
    this.timer = 0;
    this.heard = null;
    this.hurt = null;
    this.visibleList = [];
    this._offset = { x: 0, y: 0 };
  }

  reset() {
    this.records.clear();
    this.heard = null;
    this.hurt = null;
    this.visibleList.length = 0;
    this.timer = 0;
  }

  record(enemy) {
    let r = this.records.get(enemy);
    if (!r) this.records.set(enemy, (r = new EnemyRecord(enemy)));
    return r;
  }

  update(dt) {
    this.timer += dt;
    if (this.timer < AI.VISION_INTERVAL) return;
    const step = this.timer;
    this.timer = 0;
    this._scan(step);
  }

  _scan(dt) {
    const bot = this.bot;
    const session = bot.session;
    const world = session.world;
    const diff = bot.difficulty;
    const eye = bot.eyeArray();
    const ex = eye[0], ey = eye[1], ez = eye[2];
    const halfFov = (AI.FOV_DEG * DEG) / 2;
    const halfCenter = (AI.CENTER_FOV_DEG * DEG) / 2;
    this.visibleList.length = 0;

    for (const enemy of session.combatants) {
      if (enemy.team === bot.team) continue;
      const rec = this.record(enemy);
      if (!enemy.alive) { rec.visible = false; rec.spotted = false; rec.awareness = 0; continue; }
      const p = enemy.body.pos;
      const dx = p.x - ex, dz = p.z - ez;
      const dist = Math.hypot(dx, dz);
      rec.dist = dist;
      let visible = false;
      let angle = Math.PI;
      if (!bot.isBlind && dist <= AI.VIEW_DISTANCE) {
        angle = Math.abs(angleDelta(bot.view.yaw, Math.atan2(-dx, -dz)));
        if (angle <= halfFov || dist < 2.5) {
          const h = enemy.body.crouched ? 0.75 : 1;
          visible =
            world.hasLineOfSight(ex, ey, ez, p.x, p.y + 1.55 * h, p.z) ||
            world.hasLineOfSight(ex, ey, ez, p.x, p.y + 1.1 * h, p.z) ||
            world.hasLineOfSight(ex, ey, ez, p.x, p.y + 0.35 * h, p.z);
        }
      }
      if (visible) {
        rec.visible = true;
        rec.lastSeen = session.time;
        rec.x = p.x; rec.y = p.y; rec.z = p.z;
        rec.vx = enemy.body.vel.x; rec.vz = enemy.body.vel.z;
        const center = angle <= halfCenter ? 1.6 : 1;
        const distFactor = clamp(1.4 - dist / AI.VIEW_DISTANCE, 0.4, 1.4);
        const speed = enemy.body.speedXZ;
        const moveFactor = speed > 3 ? 1.35 : enemy.body.crouched ? 0.7 : 1;
        rec.awareness = Math.min(1, rec.awareness + diff.awarenessRate * center * distFactor * moveFactor * dt);
        if (dist < AI.NEAR_AWARE_DIST) rec.awareness = 1;
        if (rec.awareness >= 1 && !rec.spotted) {
          rec.spotted = true;
          rec.spottedAt = session.time;
          bot.onEnemySpotted(rec);
        }
        if (rec.spotted) this.visibleList.push(rec);
      } else {
        rec.visible = false;
        rec.awareness = Math.max(0, rec.awareness - AI.AWARE_DECAY * dt);
        if (rec.awareness === 0 && session.time - rec.lastSeen > 2) rec.spotted = false;
      }
    }
  }

  /** Inimigo visível mais próximo (registro), ou null. */
  nearestVisible() {
    let best = null;
    for (const r of this.visibleList) if (r.visible && (!best || r.dist < best.dist)) best = r;
    return best;
  }

  /** Registro do alvo atual se ainda visível. */
  isVisible(enemy) {
    const r = this.records.get(enemy);
    return !!r && r.visible && r.spotted;
  }

  /** Alguém do time inimigo (mesmo que fora de vista) foi visto há pouco? */
  lastKnown(enemy) {
    return this.records.get(enemy) || null;
  }

  onSound(e) {
    const bot = this.bot;
    if (!bot.alive) return;
    if (e.source && e.source.team === bot.team) return;
    const priority = SOUND_PRIORITY[e.type] ?? 1;
    if (priority <= 0) return;
    const eye = bot.eyeArray();
    const dx = e.x - eye[0], dy = (e.y - eye[1]) * 0.5, dz = e.z - eye[2];
    const d = Math.hypot(dx, dy, dz);
    let radius = e.radius * bot.difficulty.hearingMul;
    if (d > radius) return;
    if (bot.session.world.isBlocked(e.x, e.y + 1.2, e.z, eye[0], eye[1], eye[2])) radius *= AI.OCCLUDED_HEARING;
    if (d > radius) return;
    const cur = this.heard;
    if (cur && cur.priority > priority && bot.session.time - cur.time < AI.SOUND_MEMORY) return;
    const noise = d * AI.HEAR_NOISE_PER_METER;
    bot.session.rng.inDisk(this._offset);
    this.heard = {
      x: e.x + this._offset.x * noise, y: e.y, z: e.z + this._offset.y * noise,
      time: bot.session.time, type: e.type, priority, distance: d, source: e.source || null,
    };
  }

  onDamaged(attacker) {
    if (!attacker || attacker.team === this.bot.team) return;
    this.hurt = { attacker, time: this.bot.session.time };
    const r = this.record(attacker);
    const p = attacker.body.pos;
    r.x = p.x; r.y = p.y; r.z = p.z;
    r.lastSeen = this.bot.session.time;
    r.awareness = Math.max(r.awareness, 0.6);
  }
}
