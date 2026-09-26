// Seguidor de caminho do bot sobre o NavGrid, com detecção de travamento e recuperação em etapas:
//   1) repath imediato + pulinho  2) repath evitando a região travada + passo lateral  3) meta alternativa.
import { AI } from './AIConfig.js';

export class BotNavigator {
  constructor(bot) {
    this.bot = bot;
    this.path = null;
    this.index = 0;
    this.goal = null;
    this.arrived = true;
    this.pending = false;       // aguardando orçamento de A*
    this.zones = [];            // zonas a evitar (onde travou): { x, z, r, cost, until }
    this.failed = false;        // sem caminho até a meta
    this.lastPathTime = -Infinity;
    this.anchor = { x: 0, z: 0 };
    this.anchorTime = 0;
    this.stuckCount = 0;
    this.lastStuckAt = -Infinity;
    this.sidestepUntil = 0;
    this.sidestepDir = 1;
    this.jumpNow = false;
    this.totalStuckEvents = 0;
    this.dir = { x: 0, z: 0 };
  }

  reset() {
    this.clear();
    this.zones.length = 0;
    this.stuckCount = 0;
    this.lastStuckAt = -Infinity;
    this.sidestepUntil = 0;
    this.totalStuckEvents = 0;
  }

  clear() {
    this.path = null;
    this.index = 0;
    this.goal = null;
    this.arrived = true;
    this.pending = false;
    this.failed = false;
  }

  _addZone(x, z, r, cost, ttl) {
    const until = this.bot.session.time + ttl;
    this.zones = this.zones.filter((zn) => zn.until > this.bot.session.time);
    this.zones.push({ x, z, r, cost, until });
    if (this.zones.length > 5) this.zones.shift();
  }

  /** Define a meta. Se for praticamente a mesma meta, mantém o caminho atual. */
  setGoal(x, y, z, force = false) {
    const g = this.goal;
    if (!force && g && Math.hypot(g.x - x, g.z - z) < 1.0 && (this.path || this.pending)) return;
    this.goal = { x, y, z };
    this.arrived = false;
    this.failed = false;
    this.pending = true;
    this.path = null;
    this.index = 0;
    this._resetAnchor();
  }

  _resetAnchor() {
    const p = this.bot.body.pos;
    this.anchor.x = p.x; this.anchor.z = p.z;
    this.anchorTime = this.bot.session.time;
  }

  _computePath() {
    const session = this.bot.session;
    if (session.pathBudget <= 0) return false;
    session.pathBudget--;
    const p = this.bot.body.pos;
    const g = this.goal;
    const now = session.time;
    const avoid = this.zones.length ? this.zones.filter((zn) => zn.until > now) : null;
    const path = session.nav.findPath(p.x, p.y, p.z, g.x, g.y, g.z, { avoid });
    this.lastPathTime = session.time;
    this.pending = false;
    if (!path) {
      this.failed = true;
      this.path = null;
      return true;
    }
    this.path = path;
    this.index = path.length > 1 ? 1 : 0;
    this.failed = false;
    this._resetAnchor();
    return true;
  }

  /** Distância horizontal restante até a meta (linha reta). */
  distanceToGoal() {
    if (!this.goal) return 0;
    const p = this.bot.body.pos;
    return Math.hypot(this.goal.x - p.x, this.goal.z - p.z);
  }

  /**
   * Avança um tick. Retorna true se há direção de movimento em this.dir.
   */
  update(dt) {
    this.jumpNow = false;
    const bot = this.bot;
    const session = bot.session;
    if (!this.goal || this.arrived) return false;
    if (this.pending && !this._computePath()) return false;
    if (this.failed || !this.path) return false;

    const p = bot.body.pos;
    const path = this.path;
    // avança waypoints alcançados
    while (this.index < path.length) {
      const w = path[this.index];
      const last = this.index === path.length - 1;
      const reach = last ? AI.ARRIVE_DIST : AI.WAYPOINT_DIST;
      if (Math.hypot(w.x - p.x, w.z - p.z) < reach && Math.abs(w.y - p.y) < 1.0) this.index++;
      else break;
    }
    if (this.index >= path.length) {
      this.arrived = true;
      return false;
    }

    this._checkStuck();

    const w = path[this.index];
    let dx = w.x - p.x, dz = w.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    if (session.time < this.sidestepUntil) {
      // passo lateral aleatório para destravar
      const sx = -dz * this.sidestepDir, sz = dx * this.sidestepDir;
      dx = dx * 0.35 + sx * 0.9; dz = dz * 0.35 + sz * 0.9;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
    }
    this.dir.x = dx;
    this.dir.z = dz;
    return true;
  }

  _checkStuck() {
    const bot = this.bot;
    const session = bot.session;
    const p = bot.body.pos;
    if (Math.hypot(p.x - this.anchor.x, p.z - this.anchor.z) > AI.STUCK_MIN_PROGRESS) {
      this.anchor.x = p.x; this.anchor.z = p.z;
      this.anchorTime = session.time;
      return;
    }
    if (session.time - this.anchorTime < AI.STUCK_TIME) return;

    // TRAVADO
    this.totalStuckEvents++;
    session.events.emit('botStuck', { bot, count: this.stuckCount + 1 });
    if (session.time - this.lastStuckAt > 10) this.stuckCount = 0;
    this.stuckCount++;
    this.lastStuckAt = session.time;
    this.anchor.x = p.x; this.anchor.z = p.z;
    this.anchorTime = session.time;

    // O obstáculo está logo à frente: marca a região e recalcula por outra rota.
    const ax = p.x + this.dir.x * 1.0, az = p.z + this.dir.z * 1.0;
    if (this.stuckCount === 1) {
      this.jumpNow = true;                                  // talvez seja um degrau baixo
      this._addZone(ax, az, 1.6, 250, 20);
      this.pending = true;
    } else if (this.stuckCount === 2) {
      this._addZone(ax, az, 2.4, 3000, 30);                 // bloqueio efetivo: obriga rota alternativa
      this.sidestepUntil = session.time + 0.4;
      this.sidestepDir = session.rng.sign();
      this.pending = true;
    } else {
      // meta alternativa: um nó qualquer perto da meta
      const g = this.goal;
      const near = session.nav.nodesInRadius(g.x, g.z, 7, this._scratch || (this._scratch = []), 2);
      if (near.length) {
        const n = near[session.rng.int(0, near.length - 1)];
        this.goal = { x: session.nav.px[n], y: session.nav.py[n], z: session.nav.pz[n] };
      }
      this._addZone(ax, az, 3.0, 8000, 40);
      this.sidestepUntil = session.time + 0.5;
      this.sidestepDir = session.rng.sign();
      this.pending = true;
      if (this.stuckCount >= 4) {
        this.stuckCount = 0;
        this.bot.brain.onNavFailed();
      }
    }
  }
}
