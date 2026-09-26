// Sessão de jogo: mundo, combatentes, eventos e o passo fixo de simulação.
// Não conhece DOM/WebGL — roda em Node (testes) e no navegador (mesma lógica).
import { PLAYER } from '../Config/Tuning.js';
import { AI } from '../AI/AIConfig.js';
import { CoverFinder } from '../AI/CoverFinder.js';
import { TeamIntel } from '../AI/TeamCommander.js';
import { resolveHull } from '../Physics/CharacterBody.js';
import { EventBus } from '../Systems/EventBus.js';
import { Rng } from '../Systems/Rng.js';
import { Ballistics } from '../Weapons/Ballistics.js';
import { GrenadeSystem } from '../Weapons/Grenades.js';

export class GameSession {
  /**
   * @param {{world: import('../Physics/PhysicsWorld.js').PhysicsWorld, seed?: number}} opts
   */
  constructor({ world, seed = 12345 } = {}) {
    this.world = world;
    this.events = new EventBus();
    this.rng = new Rng(seed);
    this.time = 0;
    this.tick = 0;
    this.combatants = [];
    this.ballistics = new Ballistics(this);
    this.grenades = new GrenadeSystem(this);
    this.match = null;        // preenchido por Game/Match
    this.nav = null;          // preenchido pelo carregamento do mapa
    this.map = null;
    this.bots = [];
    this.player = null;
    this.thinkers = [];       // objetos com update(dt) executados antes dos combatentes (IA de time etc.)
    this.intel = new TeamIntel(this);
    this.cover = new CoverFinder(this);
    this.pathBudget = AI.MAX_REPATHS_PER_TICK;
  }

  add(combatant) {
    this.combatants.push(combatant);
    if (combatant.isBot) this.bots.push(combatant);
    if (combatant.isPlayer) this.player = combatant;
    return combatant;
  }

  /** Emite um evento sonoro para a IA (passos, tiros, explosões). `pos` = {x,y,z}. */
  emitSound(pos, radius, type, source) {
    this.events.emit('sound', { x: pos.x, y: pos.y, z: pos.z, radius, type, source, time: this.time });
  }

  step(dt) {
    this.time += dt;
    this.tick++;
    this.pathBudget = AI.MAX_REPATHS_PER_TICK;
    for (let i = 0; i < this.thinkers.length; i++) this.thinkers[i].update(dt);
    const cs = this.combatants;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.think) c.think(dt);
      c.update(dt);
    }
    this._separate();
    this.grenades.update(dt);
    if (this.match) this.match.update(dt);
  }

  /** Empurra personagens sobrepostos para longe uns dos outros (sem atravessar paredes). */
  _separate() {
    const cs = this.combatants;
    const minDist = PLAYER.RADIUS * 1.7;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (!b.alive) continue;
        const pa = a.body.pos, pb = b.body.pos;
        if (Math.abs(pa.y - pb.y) > 1.5) continue;
        const dx = pb.x - pa.x, dz = pb.z - pa.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minDist * minDist) continue;
        const d = Math.sqrt(d2) || 0.001;
        const push = (minDist - d) * 0.5;
        const nx = d > 0.001 ? dx / d : 1, nz = d > 0.001 ? dz / d : 0;
        this._nudge(a, -nx * push, -nz * push);
        this._nudge(b, nx * push, nz * push);
      }
    }
  }

  _nudge(c, dx, dz) {
    const b = c.body;
    const y = resolveHull(this.world, b.pos.x + dx, b.pos.y, b.pos.z + dz, b.radius, b.height, b.onGround, 0.05);
    if (y > -1e8) {
      b.pos.x += dx;
      b.pos.z += dz;
      if (y > b.pos.y) b.pos.y = y;
    }
  }
}
