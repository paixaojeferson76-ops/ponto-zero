// Cérebro do bot: máquina de estados IDLE · PATROL · INVESTIGATE · SEARCH · COMBAT · TAKE_COVER ·
// RELOAD · RETREAT · ATTACK_OBJECTIVE · DEFEND_OBJECTIVE · DEAD.
// Produz um UserCmd por tick (movimento, mira, disparo, recarga, uso) — igual a um jogador humano.
import { TEAM } from '../Config/MatchRules.js';
import { DEG, clamp } from '../Systems/MathUtil.js';
import { AI, BOT_STATE as S } from './AIConfig.js';

const PLAN_BASE_STATE = {
  attack: S.ATTACK_OBJECTIVE,
  retake: S.ATTACK_OBJECTIVE,
  defend: S.DEFEND_OBJECTIVE,
  postplant: S.DEFEND_OBJECTIVE,
};
const INTERRUPTIBLE = new Set([S.IDLE, S.PATROL, S.ATTACK_OBJECTIVE, S.DEFEND_OBJECTIVE, S.INVESTIGATE, S.SEARCH]);

export class BotBrain {
  constructor(bot) {
    this.bot = bot;
    this.session = bot.session;
    this.thinkTimer = (bot.id * 0.037) % AI.THINK_INTERVAL;
    this.reset();
  }

  reset() {
    this.state = S.IDLE;
    this.stateTime = 0;
    this.baseState = S.PATROL;
    this.wp = 0;
    this.target = null;
    this.reactionUntil = 0;
    this.lastVisibleAt = -Infinity;
    this.aimHead = false;
    this.aimRerollAt = 0;
    this.burstLeft = 0;
    this.burstPauseUntil = 0;
    this.lastAmmo = 0;
    this.fireToggle = false;
    this.strafes = false;
    this.strafeDir = 1;
    this.strafePhase = 'move';
    this.strafeUntil = 0;
    this.investigate = null;
    this.search = null;
    this.cover = null;
    this.coverReason = null;
    this.coverArrivedAt = 0;
    this.retreatUntil = 0;
    this.lastRetreatAt = -Infinity;
    this.patrolPoint = null;
    this.patrolWaitUntil = 0;
    this.lookYawTarget = 0;
    this.lookChangeAt = 0;
    this.alerts = [];
    this.lastEnemySeenAt = -Infinity;
    this.utilityCooldownUntil = 0;
    this.wasBlind = false;
  }

  // ------------------------------------------------------------------ utilidades

  _setState(next) {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    this.stateTime = 0;
    this.session.events.emit('botState', { bot: this.bot, from: prev, to: next });
  }

  _returnToBase() {
    this.target = null;
    this.cover = null;
    this.investigate = null;
    this.search = null;
    this.bot.navigator.clear();
    this._setState(this.baseState);
  }

  _syncBaseState() {
    const plan = this.bot.plan;
    this.baseState = plan ? PLAN_BASE_STATE[plan.kind] || S.PATROL : S.PATROL;
  }

  onPlanChanged() {
    this.wp = 0;
    this._syncBaseState();
    if (INTERRUPTIBLE.has(this.state)) this._returnToBase();
  }

  onNavFailed() {
    this.patrolPoint = null;
    this.wp = Math.min(this.wp + 1, (this.bot.plan && this.bot.plan.route ? this.bot.plan.route.length : 0));
    if (this.state !== S.COMBAT) this._returnToBase();
  }

  /** Aviso de companheiro: posição de um inimigo visto. */
  receiveAlert(x, z) {
    this.alerts.push({ x, z, at: this.session.time + AI.TEAM_ALERT_DELAY });
  }

  onEnemySpotted(rec) {
    const bot = this.bot;
    const session = this.session;
    session.intel.report(bot.team, rec.enemy, rec.x, rec.z);
    for (const mate of session.bots) {
      if (mate === bot || !mate.alive || mate.team !== bot.team) continue;
      if (Math.hypot(mate.pos.x - bot.pos.x, mate.pos.z - bot.pos.z) <= AI.TEAM_ALERT_RADIUS) mate.brain.receiveAlert(rec.x, rec.z);
    }
  }

  _steer(dx, dz, magnitude = 1) {
    const cmd = this.bot.cmd;
    const yaw = this.bot.view.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    cmd.moveZ = (dx * fx + dz * fz) * magnitude;
    cmd.moveX = (dx * rx + dz * rz) * magnitude;
  }

  /** Vai até (x,y,z) pela malha de navegação. Retorna true se já chegou. */
  _goTo(x, y, z, dt, run = true, arrive = AI.ARRIVE_DIST) {
    const bot = this.bot;
    const nav = bot.navigator;
    if (Math.hypot(bot.pos.x - x, bot.pos.z - z) < arrive && Math.abs(bot.pos.y - y) < 1.5) {
      nav.clear();
      return true;
    }
    nav.setGoal(x, y, z);
    if (nav.update(dt)) {
      this._steer(nav.dir.x, nav.dir.z);
      bot.cmd.run = run;
      if (nav.jumpNow) bot.cmd.jump = true;
      this._lookAhead(nav);
    } else if (nav.arrived) {
      return true;
    }
    return false;
  }

  _lookAhead(nav) {
    const bot = this.bot;
    const path = nav.path;
    if (!path) return;
    const w = path[Math.min(path.length - 1, nav.index + 1)] || path[path.length - 1];
    const eye = bot.eyeArray();
    const scan = Math.sin(this.session.time * 1.1 + bot.id) * 0.5;
    const yaw = Math.atan2(-(w.x - eye[0]), -(w.z - eye[2])) + scan * 0.35;
    bot.aim.lookYaw(yaw, 0);
  }

  _holdLook(yaw, sweep = AI.HOLD_LOOK_SWEEP) {
    const t = this.session.time;
    this.bot.aim.lookYaw(yaw + Math.sin(t * 0.55 + this.bot.id * 1.7) * sweep, -0.02);
  }

  _idleLook() {
    const bot = this.bot;
    const now = this.session.time;
    if (now >= this.lookChangeAt) {
      this.lookChangeAt = now + this.session.rng.range(1.5, 3.5);
      this.lookYawTarget = bot.view.yaw + this.session.rng.range(-1.2, 1.2);
    }
    bot.aim.lookYaw(this.lookYawTarget, 0);
  }

  // ------------------------------------------------------------------ ciclo

  update(dt) {
    const bot = this.bot;
    const session = this.session;
    const cmd = bot.cmd;
    cmd.fire = false; cmd.alt = false; cmd.use = false; cmd.crouch = false; cmd.run = false;
    cmd.moveX = 0; cmd.moveZ = 0;
    if (!bot.alive) { this.state = S.DEAD; return; }
    this.stateTime += dt;

    const match = session.match;
    if (!match || !match.isLive) {
      if (this.state !== S.IDLE) this._setState(S.IDLE);
      this._idleLook();
      bot.aim.update(dt);
      return;
    }
    if (this.state === S.IDLE || this.state === S.DEAD) { this._syncBaseState(); this._setState(this.baseState); }

    bot.perception.update(dt);
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer += AI.THINK_INTERVAL;
      this._decide();
    }
    this._tick(dt);
    bot.aim.update(dt);
  }

  _decide() {
    const bot = this.bot;
    const session = this.session;
    const perc = bot.perception;
    const now = session.time;
    this._syncBaseState();

    // cegado: perde alvo e para de agir com precisão
    if (bot.isBlind) this.wasBlind = true;

    // reação a dano
    if (perc.hurt && now - perc.hurt.time < 0.5 && INTERRUPTIBLE.has(this.state)) {
      const att = perc.hurt.attacker;
      const rec = perc.record(att);
      if (att.alive) {
        if (perc.isVisible(att)) this._enterCombat(rec);
        else this._startInvestigate(att.pos.x, att.pos.y, att.pos.z, true);
      }
      perc.hurt = null;
    }

    // alertas de companheiros
    while (this.alerts.length && this.alerts[0].at <= now) {
      const a = this.alerts.shift();
      if (INTERRUPTIBLE.has(this.state) && this.state !== S.INVESTIGATE && !this._objectiveCritical()) {
        perc.heard = perc.heard && perc.heard.priority >= 2 ? perc.heard
          : { x: a.x, y: 0, z: a.z, time: now, type: 'callout', priority: 2, distance: 0, source: null };
      }
    }

    // inimigo visível?
    const vis = perc.nearestVisible();
    if (vis) {
      this.lastEnemySeenAt = now;
      if (INTERRUPTIBLE.has(this.state)) this._enterCombat(vis);
      else if (this.state === S.COMBAT && this.target && this.target.enemy !== vis.enemy) {
        const cur = this.target;
        if (!cur.visible || vis.dist < cur.dist * 0.6) this.target = vis;
      } else if ((this.state === S.TAKE_COVER || this.state === S.RETREAT) && vis.dist < 5) {
        this._enterCombat(vis);
      }
    } else if (perc.heard && INTERRUPTIBLE.has(this.state)) {
      this._reactToSound(perc.heard);
      perc.heard = null;
    }

    this._maintainWeapon(vis);
    this._maybeUseUtility(vis);
  }

  _objectiveCritical() {
    const bot = this.bot;
    return bot.useProgress > 0.3;
  }

  _reactToSound(h) {
    const bot = this.bot;
    const now = this.session.time;
    if (now - h.time > 1.0) return;
    if (this._objectiveCritical()) return;
    const dist = Math.hypot(h.x - bot.pos.x, h.z - bot.pos.z);
    const plan = bot.plan;
    // defensores parados só reagem a sons altos; atacantes em rota ignoram passos
    if (h.priority < 2 && (this.state === S.DEFEND_OBJECTIVE || this.state === S.ATTACK_OBJECTIVE)) return;
    if (this.state === S.DEFEND_OBJECTIVE && plan && plan.role === 'hold' && dist > 32 && h.priority < 4) return;
    if (this.state === S.ATTACK_OBJECTIVE && plan && plan.role === 'planter' && bot.session.match.bomb.planted) return;
    if (this.state === S.INVESTIGATE && this.investigate && h.priority < this.investigate.priority) return;
    this._startInvestigate(h.x, h.y, h.z, false, h.priority);
  }

  _startInvestigate(x, y, z, urgent = false, priority = 2) {
    this.investigate = { x, y: y || 0, z, until: this.session.time + AI.INVESTIGATE_TIMEOUT, urgent, priority };
    this.bot.navigator.clear();
    this._setState(S.INVESTIGATE);
  }

  _enterCombat(rec) {
    const bot = this.bot;
    const now = this.session.time;
    const rng = this.session.rng;
    const diff = bot.difficulty;
    this.target = rec;
    this.reactionUntil = now + rng.range(diff.reaction[0], diff.reaction[1]);
    this.lastVisibleAt = now;
    this.aimHead = rng.chance(diff.headChance);
    this.aimRerollAt = now + 1.5;
    this.strafes = rng.chance(diff.strafeChance);
    this.strafePhase = 'stop';
    this.strafeUntil = now + rng.range(0.2, 0.5);
    this.strafeDir = rng.sign();
    this.burstLeft = 0;
    this.burstPauseUntil = 0;
    this.lastAmmo = bot.weapons.active ? bot.weapons.active.ammo : 0;
    bot.navigator.clear();
    this._setState(S.COMBAT);
  }

  _maintainWeapon(vis) {
    const bot = this.bot;
    const w = bot.weapons;
    const cmd = bot.cmd;
    if (vis || this.state === S.COMBAT || w.phase !== 'ready') return;
    const key = w.activeKey;
    if (key === 'melee' || key === 'frag' || key === 'flash' || key === 'smoke') {
      cmd.slot = w.slots.primary && w.slots.primary.ammo + w.slots.primary.reserve > 0 ? 'primary' : 'secondary';
      return;
    }
    if (key === 'secondary' && w.slots.primary && w.slots.primary.ammo + w.slots.primary.reserve > 0) {
      cmd.slot = 'primary';
      return;
    }
    if (w.needsReload() && w.ammoFraction() < 0.7) cmd.reload = true;
  }

  _maybeUseUtility(vis) {
    const bot = this.bot;
    const now = this.session.time;
    if (!vis || this.state !== S.COMBAT || now < this.utilityCooldownUntil || now < this.reactionUntil) return;
    const w = bot.weapons;
    if (w.grenades.frag <= 0 || w.phase !== 'ready') return;
    if (vis.dist < 9 || vis.dist > 24) return;
    if (!this.session.rng.chance(bot.difficulty.utilityChance * 0.15)) return;
    // só se o inimigo estiver parado/abrigado (difícil de acertar com balas): arremessa fragmentação
    this.utilityCooldownUntil = now + 14;
    bot.cmd.throwGrenade = 'frag';
    this.throwAim = { x: vis.x, z: vis.z, until: now + 1.2 };
  }

  // ------------------------------------------------------------------ ticks por estado

  _tick(dt) {
    switch (this.state) {
      case S.PATROL: this._tickPatrol(dt); break;
      case S.INVESTIGATE: this._tickInvestigate(dt); break;
      case S.SEARCH: this._tickSearch(dt); break;
      case S.COMBAT: this._tickCombat(dt); break;
      case S.TAKE_COVER: this._tickCover(dt); break;
      case S.RELOAD: this._tickReload(dt); break;
      case S.RETREAT: this._tickRetreat(dt); break;
      case S.ATTACK_OBJECTIVE: this._tickAttack(dt); break;
      case S.DEFEND_OBJECTIVE: this._tickDefend(dt); break;
      default: this._idleLook(); break;
    }
  }

  _tickPatrol(dt) {
    const bot = this.bot;
    const map = this.session.match.map;
    const now = this.session.time;
    if (!this.patrolPoint) {
      const list = map.patrol;
      const pick = list[this.session.rng.int(0, list.length - 1)];
      this.patrolPoint = { x: pick[0], z: pick[1] };
    }
    if (now < this.patrolWaitUntil) { this._idleLook(); return; }
    const arrived = this._goTo(this.patrolPoint.x, 0, this.patrolPoint.z, dt, false, 1.2);
    if (arrived) {
      this.patrolWaitUntil = now + this.session.rng.range(1.0, 2.6);
      this.patrolPoint = null;
    }
    void bot;
  }

  _tickInvestigate(dt) {
    const inv = this.investigate;
    const now = this.session.time;
    if (!inv || now > inv.until) { this._returnToBase(); return; }
    const dist = Math.hypot(inv.x - this.bot.pos.x, inv.z - this.bot.pos.z);
    const arrived = this._goTo(inv.x, inv.y, inv.z, dt, dist > 22 || inv.urgent, 2.2);
    if (arrived) {
      this.search = { origin: { x: inv.x, z: inv.z }, points: [], idx: 0, until: now + AI.SEARCH_TIME, waitUntil: 0 };
      this._buildSearchPoints();
      this.investigate = null;
      this._setState(S.SEARCH);
    }
  }

  _buildSearchPoints() {
    const s = this.search;
    const nav = this.session.nav;
    const list = nav.nodesInRadius(s.origin.x, s.origin.z, 8, this._nodeScratch || (this._nodeScratch = []), 3);
    const rng = this.session.rng;
    s.points = [];
    for (let i = 0; i < 3 && list.length; i++) {
      const n = list[rng.int(0, list.length - 1)];
      s.points.push({ x: nav.px[n], y: nav.py[n], z: nav.pz[n] });
    }
  }

  _tickSearch(dt) {
    const s = this.search;
    const now = this.session.time;
    if (!s || now > s.until) { this._returnToBase(); return; }
    if (now < s.waitUntil) { this._idleLook(); return; }
    if (s.idx >= s.points.length) { this._returnToBase(); return; }
    const p = s.points[s.idx];
    if (this._goTo(p.x, p.y, p.z, dt, false, 1.4)) {
      s.idx++;
      s.waitUntil = now + this.session.rng.range(0.6, 1.4);
    }
  }

  // ---- COMBATE

  _tickCombat(dt) {
    const bot = this.bot;
    const session = this.session;
    const now = session.time;
    const diff = bot.difficulty;
    const w = bot.weapons;
    const cmd = bot.cmd;
    let rec = this.target;

    if (!rec || !rec.enemy.alive) {
      const next = bot.perception.nearestVisible();
      if (next) { this.target = next; rec = next; } else { this._afterCombat(); return; }
    }
    const enemy = rec.enemy;
    const visible = bot.perception.isVisible(enemy);
    if (visible) this.lastVisibleAt = now;
    else if (now - this.lastVisibleAt > AI.LOSE_TARGET_TIME + (this.wasBlind ? 1 : 0)) {
      this.search = { origin: { x: rec.x, z: rec.z }, points: [], idx: 0, until: now + AI.SEARCH_TIME, waitUntil: 0 };
      this._buildSearchPoints();
      // segue na direção em que o inimigo estava indo
      this.search.points.unshift({ x: rec.x + rec.vx * 0.6, y: rec.y, z: rec.z + rec.vz * 0.6 });
      this.target = null;
      this._setState(S.SEARCH);
      return;
    }

    const eye = bot.eyeArray();
    const dist = Math.hypot(rec.x - eye[0], rec.z - eye[2]);
    const crouchScale = enemy.body.crouched ? 0.75 : 1;
    if (now >= this.aimRerollAt) { this.aimHead = session.rng.chance(diff.headChance); this.aimRerollAt = now + 1.5; }
    const aimY = rec.y + (this.aimHead ? 1.62 : 1.12) * crouchScale;
    bot.aim.lookAt(rec.x + rec.vx * 0.08, aimY, rec.z + rec.vz * 0.08, true);

    // saúde baixa → recuar
    if (bot.health.fraction < diff.retreatHealth && now - this.lastRetreatAt > 15 && dist > 5) {
      if (this._tryRetreat(rec)) return;
    }

    // munição / arma
    const active = w.active;
    if (active && active.def.magSize > 0) {
      if (active.ammo === 0 && w.phase === 'ready') {
        const other = active.def.slot === 'primary' ? w.slots.secondary : w.slots.primary;
        if (other && other.ammo > 0 && dist < 26) { cmd.slot = active.def.slot === 'primary' ? 'secondary' : 'primary'; }
        else if (visible && dist > 4 && this._tryCover(rec, 'reload')) return;
        else { this._setState(S.RELOAD); return; }
      } else if (w.phase === 'reload' || w.phase === 'holster' || w.phase === 'equip') {
        // recarregando/trocando no meio da luta: mexe-se para dificultar a mira
      }
    } else if (active && active.def.slot === 'melee' && dist > 3 && w.phase === 'ready') {
      cmd.slot = w.slots.primary ? 'primary' : 'secondary';
    }

    const def = w.def;
    const ideal = (def && def.botIdealRange) || [8, 40];
    const weaponReady = w.phase === 'ready';

    // ---- movimento
    let moving = false;
    if (dist < ideal[0] && def && def.slot !== 'melee') {
      // muito perto: recua/lateraliza
      moving = this._strafe(now, true);
    } else if (dist > ideal[1] * 1.15 || (def && def.slot === 'melee' && dist > 1.4)) {
      // longe demais: aproxima usando a malha (evita bater em parede)
      moving = this._advance(rec, dt, def && def.slot === 'melee');
    } else if (this.strafes) {
      moving = this._strafe(now, false);
    } else if (dist > 22 && !this.strafes) {
      cmd.crouch = this.session.rng.chance(0.002) ? true : cmd.crouch;
    }
    if (!moving && dist > 20 && def && def.ads && dist < 90) cmd.alt = true;

    // ---- disparo
    const reactionOk = now >= this.reactionUntil;
    const threshold = Math.max(0.9, Math.atan2(0.32, Math.max(1, dist)) / DEG);
    const onTarget = bot.aim.lastError <= threshold;
    const speed = bot.body.speedXZ;
    const steady = speed < 2.6 || (def && def.id === 'smg9') || dist < 6;
    let wantsFire = visible && reactionOk && onTarget && steady && weaponReady && !bot.isBlind && active && (active.ammo > 0 || def.slot === 'melee');
    if (def && def.slot === 'melee') wantsFire = wantsFire && dist < 2.0;
    if (wantsFire) this._pullTrigger(now, def, active);
    else if (this.burstLeft > 0 && !visible) this.burstLeft = 0;
    this.lastAmmo = active ? active.ammo : 0;

    if (this.throwAim && now < this.throwAim.until) {
      const eye2 = bot.eyeArray();
      const d = Math.hypot(this.throwAim.x - eye2[0], this.throwAim.z - eye2[2]);
      bot.aim.lookAt(this.throwAim.x, eye2[1] + d * 0.42, this.throwAim.z, false);
    }
    if (bot.isBlind) { cmd.moveX = this.strafeDir; cmd.moveZ = 0; }
  }

  _pullTrigger(now, def, active) {
    const bot = this.bot;
    const rng = this.session.rng;
    const diff = bot.difficulty;
    // consome a contagem de tiros da rajada
    if (active.ammo < this.lastAmmo) this.burstLeft -= this.lastAmmo - active.ammo;
    if (this.burstLeft <= 0) {
      if (now < this.burstPauseUntil) return;
      const b = def.botBurst || [3, 6];
      this.burstLeft = Math.max(1, Math.round(rng.range(b[0], b[1] + 0.99) * diff.burstMul));
      const p = def.botBurstPause || [0.2, 0.4];
      this.burstPauseUntil = now + rng.range(p[0], p[1]);
      return;
    }
    if (def.mode === 'auto') {
      bot.cmd.fire = true;
    } else {
      this.fireToggle = !this.fireToggle;
      bot.cmd.fire = this.fireToggle;
    }
    if (this.burstLeft === 1 && def.mode === 'auto') {
      // última bala da rajada: solta no próximo ciclo
    }
  }

  _strafe(now, retreatBack) {
    const bot = this.bot;
    const rng = this.session.rng;
    const cmd = bot.cmd;
    if (now >= this.strafeUntil) {
      if (this.strafePhase === 'move') {
        this.strafePhase = 'stop';
        this.strafeUntil = now + rng.range(0.35, 0.8);
      } else {
        this.strafePhase = 'move';
        this.strafeUntil = now + rng.range(0.3, 0.8);
        this.strafeDir = rng.sign();
      }
    }
    if (this.strafePhase === 'stop' && !retreatBack) {
      cmd.moveX = 0; cmd.moveZ = 0;
      return false;
    }
    // não se joga contra parede
    const yaw = bot.view.yaw;
    const dirx = Math.cos(yaw) * this.strafeDir, dirz = -Math.sin(yaw) * this.strafeDir;
    const eye = bot.eyeArray();
    if (this.session.world.raycast(eye[0], eye[1] - 0.6, eye[2], dirx, 0, dirz, 1.3)) this.strafeDir = -this.strafeDir;
    cmd.moveX = this.strafeDir;
    if (retreatBack) {
      const bx = Math.sin(yaw), bz = Math.cos(yaw);
      if (!this.session.world.raycast(eye[0], eye[1] - 0.6, eye[2], bx, 0, bz, 1.6)) cmd.moveZ = -1;
    }
    return true;
  }

  _advance(rec, dt, melee) {
    const bot = this.bot;
    const nav = bot.navigator;
    nav.setGoal(rec.x, rec.y, rec.z);
    if (nav.update(dt)) {
      this._steer(nav.dir.x, nav.dir.z);
      bot.cmd.run = melee;
      if (nav.jumpNow) bot.cmd.jump = true;
      return true;
    }
    return false;
  }

  _afterCombat() {
    const bot = this.bot;
    this.target = null;
    this.burstLeft = 0;
    // munição fraca depois da luta? recarrega antes de seguir
    if (bot.weapons.needsReload() && bot.weapons.ammoFraction() < 0.5) { this._setState(S.RELOAD); return; }
    this._returnToBase();
  }

  // ---- COBERTURA / RECARGA / RECUO

  _tryCover(rec, reason) {
    const bot = this.bot;
    const spot = this.session.cover.find(bot.pos, { x: rec.x, y: rec.y, z: rec.z }, { radius: AI.COVER_RADIUS, samples: AI.COVER_SAMPLES });
    if (!spot) return false;
    this.cover = spot;
    this.coverReason = reason;
    this.coverArrivedAt = 0;
    bot.navigator.clear();
    this._setState(S.TAKE_COVER);
    return true;
  }

  _tryRetreat(rec) {
    const bot = this.bot;
    const spot = this.session.cover.find(bot.pos, { x: rec.x, y: rec.y, z: rec.z }, {
      radius: 24, samples: 28, minThreatDist: 8, fullCover: true, preferFar: true, awayBias: 1.4,
    });
    if (!spot) return false;
    this.cover = spot;
    this.retreatUntil = this.session.time + AI.RETREAT_TIME;
    this.lastRetreatAt = this.session.time;
    bot.navigator.clear();
    this._setState(S.RETREAT);
    return true;
  }

  _tickCover(dt) {
    const bot = this.bot;
    const now = this.session.time;
    const cmd = bot.cmd;
    const w = bot.weapons;
    const spot = this.cover;
    if (!spot || this.stateTime > 9) { this._afterCombat(); return; }
    const rec = this.target;
    if (rec && rec.enemy.alive) bot.aim.lookAt(rec.x, rec.y + 1.1, rec.z, false);
    if (!this.coverArrivedAt) {
      const arrived = this._goTo(spot.x, spot.y, spot.z, dt, true, 0.8);
      if (arrived) this.coverArrivedAt = now;
      return;
    }
    cmd.crouch = true;
    if (this.coverReason === 'reload' && w.needsReload() && w.phase === 'ready') cmd.reload = true;
    const reloading = w.phase === 'reload';
    if (!reloading && now - this.coverArrivedAt > this.session.rng.range(0.6, 1.5)) {
      if (rec && rec.enemy.alive && bot.perception.isVisible(rec.enemy)) this._enterCombat(rec);
      else if (rec && rec.enemy.alive) {
        this.search = { origin: { x: rec.x, z: rec.z }, points: [], idx: 0, until: now + AI.SEARCH_TIME, waitUntil: 0 };
        this._buildSearchPoints();
        this.target = null;
        this._setState(S.SEARCH);
      } else this._returnToBase();
    }
  }

  _tickReload(dt) {
    const bot = this.bot;
    const w = bot.weapons;
    const cmd = bot.cmd;
    if (w.phase === 'ready' && w.needsReload()) cmd.reload = true;
    cmd.crouch = this.stateTime > 0.2;
    if (!w.needsReload() && w.phase === 'ready') { this._returnToBase(); return; }
    if (this.stateTime > 6) this._returnToBase();
    void dt;
  }

  _tickRetreat(dt) {
    const bot = this.bot;
    const now = this.session.time;
    const spot = this.cover;
    if (!spot || now > this.retreatUntil + 4) { this._returnToBase(); return; }
    const rec = this.target;
    if (rec && rec.enemy.alive) bot.aim.lookAt(rec.x, rec.y + 1.1, rec.z, false);
    const arrived = this._goTo(spot.x, spot.y, spot.z, dt, true, 0.9);
    if (arrived) {
      bot.cmd.crouch = true;
      if (bot.weapons.needsReload()) bot.cmd.reload = true;
      if (now > this.retreatUntil) this._returnToBase();
    }
  }

  // ---- OBJETIVO

  _tickAttack(dt) {
    const bot = this.bot;
    const session = this.session;
    const match = session.match;
    const plan = bot.plan;
    const bomb = match.bomb;
    if (!plan) { this._setState(S.PATROL); return; }
    const map = match.map;
    const now = session.time;
    const clear = now - this.lastEnemySeenAt > 1.2;

    if (plan.kind === 'attack') {
      if (bomb.planted) { this._holdLook(0, 0.3); return; }
      if (match.liveTime < plan.startDelay) { this._holdLook(bot.view.yaw, 0.2); return; }
      const route = plan.route;
      if (this.wp < route.length) {
        const w = route[this.wp];
        const arrived = this._goTo(w.x, 0, w.z, dt, this.wp < route.length - 1 || bot.health.fraction > 0.5, 1.6);
        if (arrived) this.wp++;
        return;
      }
      const site = map.sites[plan.site];
      // se o plantador morreu, alguém assume
      if (plan.role !== 'planter' && !session.bots.some((b) => b.alive && b.team === bot.team && b.plan && b.plan.role === 'planter')) {
        if (this._isFirstAliveOf(plan)) plan.role = 'planter';
      }
      if (plan.role === 'planter') {
        const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
        if (d > 1.0) { this._goTo(site.x, 0, site.z, dt, false, 0.8); return; }
        bot.navigator.clear();
        this._holdLook(bot.view.yaw, 0.4);
        if (clear) bot.cmd.use = true;
      } else {
        const spots = map.postPlant[plan.site];
        const spot = spots[(bot.id + 1) % spots.length];
        const arrived = this._goTo(spot.x, 0, spot.z, dt, false, 1.2);
        if (arrived) this._holdLook(spot.yaw, 0.6);
      }
      return;
    }

    if (plan.kind === 'retake') {
      if (!bomb.planted || bomb.defused) return;
      const dBomb = Math.hypot(bomb.x - bot.pos.x, bomb.z - bot.pos.z);
      const timeLive = match.liveTime - (bomb.timeLeft > 0 ? 0 : 0);
      void timeLive;
      if (plan.role === 'defuser' && this.stateTime > plan.startDelay) {
        if (dBomb > 1.4) { this._goTo(bomb.x, bomb.y, bomb.z, dt, true, 1.2); return; }
        bot.navigator.clear();
        this._holdLook(bot.view.yaw, 0.3);
        if (clear) bot.cmd.use = true;
      } else {
        const h = plan.hold;
        const arrived = this._goTo(h.x, 0, h.z, dt, true, 1.2);
        if (arrived) {
          this._holdLook(h.yaw, 0.5);
          // depois de um tempo, todo mundo avança para cobrir o defusador
          if (this.stateTime > 9 && dBomb > 6) this._goTo(bomb.x, bomb.y, bomb.z, dt, false, 4);
        }
      }
    }
  }

  _isFirstAliveOf(plan) {
    const mates = this.session.bots.filter((b) => b.alive && b.team === this.bot.team && b.plan && b.plan.kind === 'attack' && b.plan.site === plan.site);
    return mates.length > 0 && mates[0] === this.bot;
  }

  _tickDefend(dt) {
    const bot = this.bot;
    const plan = bot.plan;
    if (!plan || !plan.hold) { this._setState(S.PATROL); return; }
    const h = plan.hold;
    const now = this.session.time;
    const arrived = this._goTo(h.x, 0, h.z, dt, plan.role === 'rotate' || plan.kind === 'postplant', 1.0);
    if (arrived) {
      this._holdLook(h.yaw, AI.HOLD_LOOK_SWEEP);
      // agachar de vez em quando (cobertura baixa)
      bot.cmd.crouch = Math.floor(now / 3 + bot.id) % 3 === 0;
    }
  }
}

export { clamp };
