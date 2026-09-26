// Coordenação de time: plano do round (rota por lane, plantador, posições de defesa),
// reação à bomba (pós-plant / retake) e rotação de defensores com base em informação compartilhada.
import { TEAM } from '../Config/MatchRules.js';

/** Memória compartilhada: inimigos vistos/ouvidos por time. */
export class TeamIntel {
  constructor(session) {
    this.session = session;
    this.reports = { [TEAM.ATTACK]: new Map(), [TEAM.DEFEND]: new Map() };
  }

  clear() {
    this.reports[TEAM.ATTACK].clear();
    this.reports[TEAM.DEFEND].clear();
  }

  report(team, enemy, x, z) {
    this.reports[team].set(enemy, { x, z, time: this.session.time });
  }

  /** Inimigos distintos reportados perto de (x,z) nos últimos `maxAge` segundos. */
  threatNear(team, x, z, radius, maxAge = 6) {
    let n = 0;
    const now = this.session.time;
    for (const [enemy, r] of this.reports[team]) {
      if (!enemy.alive || now - r.time > maxAge) continue;
      if (Math.hypot(r.x - x, r.z - z) <= radius) n++;
    }
    return n;
  }
}

export class TeamCommander {
  constructor(session, team) {
    this.session = session;
    this.team = team;
    this.timer = 0;
    this.lastRotation = -Infinity;
    this.strategy = null;
    this.bombHandled = false;
  }

  get map() { return this.session.match.map; }

  bots() {
    return this.session.combatants.filter((c) => c.isBot && c.team === this.team);
  }

  planRound() {
    this.bombHandled = false;
    this.lastRotation = -Infinity;
    const bots = this.bots();
    for (const b of bots) b.plan = null;
    if (this.team === TEAM.ATTACK) this._planAttack(bots);
    else this._planDefense(bots);
  }

  // ------------------------------------------------------------------ ataque

  _planAttack(bots) {
    const rng = this.session.rng;
    const map = this.map;
    const roll = rng.next();
    const strategy = roll < 0.3 ? 'rushA' : roll < 0.6 ? 'rushB' : roll < 0.85 ? 'split' : 'mid';
    this.strategy = strategy;
    const laneOrder = {
      A: ['norte', 'meio', 'oficina'],
      B: ['sul', 'meio', 'deposito'],
    };
    const assignments = bots.map((b, i) => {
      let site;
      if (strategy === 'rushA') site = 'A';
      else if (strategy === 'rushB') site = 'B';
      else if (strategy === 'split') site = i % 2 === 0 ? 'A' : 'B';
      else site = this.session.rng.chance(0.5) ? 'A' : 'B';
      return { bot: b, site };
    });
    if (strategy === 'mid') {
      const site = assignments[0] ? assignments[0].site : 'A';
      assignments.forEach((a) => { a.site = site; a.lane = 'meio'; });
    }
    const counters = { A: 0, B: 0 };
    const planters = {};
    for (const a of assignments) {
      const site = a.site;
      const lanes = laneOrder[site];
      const lane = a.lane || lanes[counters[site] % lanes.length];
      counters[site]++;
      const route = map.routes[site][lane] || map.routes[site][lanes[0]];
      if (!planters[site]) planters[site] = a;
      const role = planters[site] === a ? 'planter' : counters[site] === 3 && strategy !== 'mid' ? 'lurk' : counters[site] % 2 ? 'entry' : 'support';
      a.bot.plan = {
        kind: 'attack', site, lane, route: route.map((p) => ({ x: p[0], z: p[1] })), role,
        startDelay: role === 'lurk' ? rng.range(6, 10) : rng.range(0, 1.5) + counters[site] * 0.25,
      };
    }
  }

  // ------------------------------------------------------------------ defesa

  _planDefense(bots) {
    const map = this.map;
    const order = ['A', 'B', 'mid', 'A', 'B', 'A', 'B'];
    const used = { A: 0, B: 0, mid: 0 };
    bots.forEach((b, i) => {
      const site = order[i % order.length];
      const list = map.holds[site];
      const hold = list[used[site] % list.length];
      used[site]++;
      b.plan = { kind: 'defend', site, hold: { ...hold }, role: 'hold', startDelay: 0 };
    });
  }

  // ------------------------------------------------------------------ reação ao vivo

  update(dt) {
    const match = this.session.match;
    if (!match || !match.isLive) return;
    this.timer += dt;
    if (this.timer < 0.5) return;
    this.timer = 0;

    const bomb = match.bomb;
    if (bomb.planted && !bomb.defused && !this.bombHandled) {
      this.bombHandled = true;
      if (this.team === TEAM.ATTACK) this._postPlant(bomb.site);
      else this._retake(bomb);
    }
    if (this.team === TEAM.DEFEND && !bomb.planted) this._rotateDefenders();
  }

  _postPlant(siteName) {
    const map = this.map;
    const spots = map.postPlant[siteName];
    this.bots().filter((b) => b.alive).forEach((b, i) => {
      const hold = spots[i % spots.length];
      b.plan = { kind: 'postplant', site: siteName, hold: { ...hold }, role: 'guard', startDelay: 0 };
      b.brain.onPlanChanged();
    });
  }

  _retake(bomb) {
    const alive = this.bots().filter((b) => b.alive);
    if (!alive.length) return;
    // defusador = o mais próximo da bomba
    alive.sort((a, b) => Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z) - Math.hypot(b.pos.x - bomb.x, b.pos.z - bomb.z));
    const holds = this.map.holds[bomb.site];
    alive.forEach((b, i) => {
      b.plan = {
        kind: 'retake', site: bomb.site, role: i === 0 ? 'defuser' : 'cover',
        hold: { ...holds[i % holds.length] }, startDelay: i === 0 ? 2.5 : 0,
      };
      b.brain.onPlanChanged();
    });
  }

  /** Um defensor de outro setor ajuda o sítio que está sob ataque. */
  _rotateDefenders() {
    const session = this.session;
    if (session.time - this.lastRotation < 5) return;
    const intel = session.intel;
    const bots = this.bots().filter((b) => b.alive && b.plan && b.plan.kind === 'defend');
    for (const [name, site] of Object.entries(this.map.sites)) {
      if (intel.threatNear(this.team, site.x, site.z, 22, 6) < 2) continue;
      const defendersThere = bots.filter((b) => b.plan.site === name).length;
      if (defendersThere >= 3) continue;
      const helper = bots.find((b) => b.plan.site !== name && b.plan.role === 'hold'
        && bots.filter((o) => o.plan.site === b.plan.site).length > 1);
      if (!helper) continue;
      const holds = this.map.holds[name];
      helper.plan = { kind: 'defend', site: name, hold: { ...holds[(defendersThere + 1) % holds.length] }, role: 'rotate', startDelay: 0 };
      helper.brain.onPlanChanged();
      this.lastRotation = session.time;
      return;
    }
  }
}
