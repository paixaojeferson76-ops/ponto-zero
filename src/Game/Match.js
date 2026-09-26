// Regras da partida "Sabotagem": rounds, preparação, plantar/desarmar carga, condições de vitória e placar.
import { MATCH_RULES, TEAM } from '../Config/MatchRules.js';

export const ROUND_PHASE = { FREEZE: 'freeze', LIVE: 'live', POST: 'post', ENDED: 'ended' };

export class Match {
  /**
   * @param {import('./GameSession.js').GameSession} session
   * @param {{map:object, roundsToWin?:number, loadoutFor:(c:object)=>object, onRoundSetup?:()=>void}} opts
   */
  constructor(session, opts) {
    this.session = session;
    this.map = opts.map;
    this.roundsToWin = opts.roundsToWin ?? MATCH_RULES.ROUNDS_TO_WIN;
    this.loadoutFor = opts.loadoutFor;
    this.onRoundSetup = opts.onRoundSetup || null;
    this.phase = ROUND_PHASE.ENDED;
    this.phaseTime = 0;
    this.liveTime = 0;
    this.round = 0;
    this.score = { [TEAM.ATTACK]: 0, [TEAM.DEFEND]: 0 };
    this.lastResult = null;       // { winner, reason }
    this.matchWinner = null;
    this.bomb = this._newBomb();
    this.interaction = null;      // { who, kind, progress } — para o HUD
    session.match = this;
  }

  _newBomb() {
    return { planted: false, defused: false, exploded: false, site: null, x: 0, y: 0, z: 0, timeLeft: 0, planter: null, defuser: null };
  }

  get isLive() { return this.phase === ROUND_PHASE.LIVE; }
  get isFreeze() { return this.phase === ROUND_PHASE.FREEZE; }

  /** Segundos restantes do relógio principal (preparação, round ou carga). */
  get clock() {
    if (this.phase === ROUND_PHASE.FREEZE) return Math.max(0, MATCH_RULES.FREEZE_TIME - this.phaseTime);
    if (this.phase === ROUND_PHASE.LIVE) {
      return this.bomb.planted ? Math.max(0, this.bomb.timeLeft) : Math.max(0, MATCH_RULES.ROUND_TIME - this.liveTime);
    }
    return 0;
  }

  start() {
    this.score[TEAM.ATTACK] = 0;
    this.score[TEAM.DEFEND] = 0;
    this.round = 0;
    this.matchWinner = null;
    this.lastResult = null;
    for (const c of this.session.combatants) { c.stats.kills = c.stats.deaths = c.stats.assists = c.stats.damage = c.stats.score = c.stats.headshots = 0; }
    this.startRound();
  }

  restart() {
    this.start();
  }

  siteAt(pos) {
    for (const site of Object.values(this.map.sites)) {
      if (Math.hypot(pos.x - site.x, pos.z - site.z) <= site.radius) return site;
    }
    return null;
  }

  aliveCount(team) {
    let n = 0;
    for (const c of this.session.combatants) if (c.team === team && c.alive) n++;
    return n;
  }

  startRound() {
    const session = this.session;
    this.round++;
    this.phase = ROUND_PHASE.FREEZE;
    this.phaseTime = 0;
    this.liveTime = 0;
    this.bomb = this._newBomb();
    this.interaction = null;
    this.lastResult = null;
    session.grenades.clear();

    const spawnsByTeam = {
      [TEAM.ATTACK]: this.map.spawns.attack.slice(),
      [TEAM.DEFEND]: this.map.spawns.defend.slice(),
    };
    // O humano fica no ponto do meio; os demais embaralham.
    for (const team of [TEAM.ATTACK, TEAM.DEFEND]) {
      const members = session.combatants.filter((c) => c.team === team);
      const player = members.find((c) => c.isPlayer);
      const list = spawnsByTeam[team];
      const others = members.filter((c) => !c.isPlayer);
      const middle = list.splice(2, 1)[0];
      session.rng.shuffle(list);
      if (player) list.unshift(middle);
      else list.push(middle);
      const ordered = player ? [player, ...others] : others;
      ordered.forEach((c, i) => {
        const sp = list[i % list.length];
        c.spawn(sp.x, 0, sp.z, sp.yaw);
        c.frozen = true;
        c.useProgress = 0;
        c.weapons.loadout(this.loadoutFor(c));
      });
    }
    if (this.onRoundSetup) this.onRoundSetup();
    session.events.emit('roundStart', { round: this.round, score: { ...this.score } });
  }

  update(dt) {
    switch (this.phase) {
      case ROUND_PHASE.FREEZE:
        this.phaseTime += dt;
        if (this.phaseTime >= MATCH_RULES.FREEZE_TIME) this._goLive();
        break;
      case ROUND_PHASE.LIVE:
        this.liveTime += dt;
        this._updateInteractions(dt);
        this._updateBomb(dt);
        this._checkRoundEnd();
        break;
      case ROUND_PHASE.POST:
        this.phaseTime += dt;
        if (this.phaseTime >= MATCH_RULES.POST_ROUND_TIME) {
          if (this.matchWinner) this._endMatch();
          else this.startRound();
        }
        break;
      default:
        break;
    }
  }

  _goLive() {
    this.phase = ROUND_PHASE.LIVE;
    this.phaseTime = 0;
    for (const c of this.session.combatants) c.frozen = false;
    this.session.events.emit('roundLive', { round: this.round });
  }

  // ------------------------------------------------------------------ plantar / desarmar

  _updateInteractions(dt) {
    const b = this.bomb;
    let hud = null;
    for (const c of this.session.combatants) {
      if (!c.alive) { c.useProgress = 0; continue; }
      let progressing = false;
      const still = c.body.onGround && c.body.speedXZ < 0.6;
      if (c.team === TEAM.ATTACK && !b.planted) {
        const site = this.siteAt(c.pos);
        if (c.cmd.use && site && still && c.weapons.phase !== 'windup') {
          progressing = true;
          c.useProgress += dt;
          hud = this._hudFor(c, 'plant', c.useProgress / MATCH_RULES.PLANT_TIME, hud);
          if (c.useProgress >= MATCH_RULES.PLANT_TIME) { c.useProgress = 0; this._plant(c, site); }
        }
      } else if (c.team === TEAM.DEFEND && b.planted && !b.defused) {
        const near = Math.hypot(c.pos.x - b.x, c.pos.z - b.z) <= MATCH_RULES.USE_RADIUS;
        if (c.cmd.use && near && still) {
          progressing = true;
          c.useProgress += dt;
          b.defuser = c;
          hud = this._hudFor(c, 'defuse', c.useProgress / MATCH_RULES.DEFUSE_TIME, hud);
          if (c.useProgress >= MATCH_RULES.DEFUSE_TIME) { c.useProgress = 0; this._defuse(c); }
        }
      }
      if (!progressing) {
        if (c.useProgress > 0) this.session.events.emit('interactionCancel', { who: c });
        c.useProgress = 0;
        if (b.defuser === c) b.defuser = null;
      }
    }
    this.interaction = hud;
  }

  _hudFor(c, kind, progress, current) {
    if (c.isPlayer) return { who: c, kind, progress: Math.min(1, progress) };
    return current;
  }

  _plant(c, site) {
    const b = this.bomb;
    b.planted = true;
    b.site = site.name;
    b.x = c.pos.x; b.y = c.pos.y; b.z = c.pos.z;
    b.timeLeft = MATCH_RULES.BOMB_TIMER;
    b.planter = c;
    c.stats.score += 2;
    this.session.events.emit('bombPlanted', { site: site.name, x: b.x, y: b.y, z: b.z, planter: c });
    this.session.emitSound(b, 40, 'plant', c);
  }

  _defuse(c) {
    const b = this.bomb;
    b.defused = true;
    b.defuser = c;
    c.stats.score += 2;
    this.session.events.emit('bombDefused', { by: c });
    this._endRound(TEAM.DEFEND, 'defused');
  }

  _updateBomb(dt) {
    const b = this.bomb;
    if (!b.planted || b.defused || b.exploded) return;
    const before = b.timeLeft;
    b.timeLeft -= dt;
    // bipes acelerando
    const beepInterval = b.timeLeft > 10 ? 1.0 : b.timeLeft > 5 ? 0.5 : 0.22;
    if (Math.floor(before / beepInterval) !== Math.floor(b.timeLeft / beepInterval)) {
      this.session.events.emit('bombBeep', { timeLeft: b.timeLeft, x: b.x, y: b.y, z: b.z });
      this.session.emitSound(b, 22, 'beep', null);
    }
    if (b.timeLeft <= 0) {
      b.exploded = true;
      this._blast();
      this.session.events.emit('bombExploded', { x: b.x, y: b.y, z: b.z });
      this._endRound(TEAM.ATTACK, 'exploded');
    }
  }

  _blast() {
    const b = this.bomb;
    for (const c of this.session.combatants) {
      if (!c.alive) continue;
      const d = Math.hypot(c.pos.x - b.x, c.pos.z - b.z);
      if (d > MATCH_RULES.BOMB_BLAST_RADIUS) continue;
      const amount = MATCH_RULES.BOMB_BLAST_DAMAGE * (1 - d / MATCH_RULES.BOMB_BLAST_RADIUS) ** 0.6;
      c.receiveDamage({ amount, type: 'bomb', attacker: null, hitbox: null });
    }
  }

  // ------------------------------------------------------------------ fim de round

  _checkRoundEnd() {
    if (this.phase !== ROUND_PHASE.LIVE) return;
    const b = this.bomb;
    const atk = this.aliveCount(TEAM.ATTACK), def = this.aliveCount(TEAM.DEFEND);
    if (def === 0 && !b.defused) return this._endRound(TEAM.ATTACK, 'eliminated');
    if (atk === 0 && !b.planted) return this._endRound(TEAM.DEFEND, 'eliminated');
    if (!b.planted && this.liveTime >= MATCH_RULES.ROUND_TIME) return this._endRound(TEAM.DEFEND, 'time');
    return undefined;
  }

  _endRound(winner, reason) {
    if (this.phase !== ROUND_PHASE.LIVE) return;
    this.phase = ROUND_PHASE.POST;
    this.phaseTime = 0;
    this.interaction = null;
    this.score[winner]++;
    this.lastResult = { winner, reason };
    if (this.score[winner] >= this.roundsToWin) this.matchWinner = winner;
    this.session.events.emit('roundEnd', { winner, reason, score: { ...this.score }, round: this.round, matchOver: !!this.matchWinner });
  }

  _endMatch() {
    this.phase = ROUND_PHASE.ENDED;
    this.phaseTime = 0;
    for (const c of this.session.combatants) c.frozen = true;
    this.session.events.emit('matchEnd', { winner: this.matchWinner, score: { ...this.score } });
  }
}
