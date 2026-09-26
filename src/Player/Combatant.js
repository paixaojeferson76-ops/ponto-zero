// Base de qualquer participante (jogador humano ou bot): corpo, olhar, vida/armadura, hitboxes, armas.
// Tudo é dirigido por um UserCmd — o mesmo formato para humanos e bots.
import { MOVEMENT, PLAYER } from '../Config/Tuning.js';
import { MATCH_RULES } from '../Config/MatchRules.js';
import { CharacterBody } from '../Physics/CharacterBody.js';
import { stepMovement } from '../Physics/MovementModel.js';
import { Armor, DamageReceiver, Health } from '../Systems/Damage.js';
import { HitboxSet } from '../Systems/Hitbox.js';
import { WeaponSystem } from '../Weapons/WeaponSystem.js';
import { DEG, clamp } from '../Systems/MathUtil.js';

export const PLAYER_STATE = {
  IDLE: 'IDLE', WALK: 'WALK', RUN: 'RUN', CROUCH: 'CROUCH', CROUCH_WALK: 'CROUCH_WALK', AIR: 'AIR', DEAD: 'DEAD',
};

/** Comando de entrada de um tick. Campos "borda" (jump, reload, slot…) valem só para um tick. */
export function makeCmd() {
  return {
    moveX: 0, moveZ: 0,
    jump: false, crouch: false, run: false,
    fire: false, alt: false, reload: false, use: false,
    slot: null,            // 'primary' | 'secondary' | 'melee' | 'frag' | 'flash' | 'smoke'
    switchDelta: 0,        // roda do mouse
    quickSwitch: false,
    throwGrenade: null,    // 'selected' | 'frag' | ...
  };
}

export class Combatant {
  constructor(session, { id, name, team, isPlayer = false }) {
    this.session = session;
    this.id = id;
    this.name = name;
    this.team = team;
    this.isPlayer = isPlayer;
    this.isBot = false;

    this.body = new CharacterBody(session.world);
    this.view = { yaw: 0, pitch: 0 };
    this.cmd = makeCmd();
    this._moveCmd = { moveX: 0, moveZ: 0, yaw: 0, jump: false, crouch: false, run: false };

    this.health = new Health(PLAYER.MAX_HEALTH);
    this.armor = new Armor(PLAYER.MAX_ARMOR);
    this.receiver = new DamageReceiver(this, this.health, this.armor);
    this.hitboxes = new HitboxSet();
    this.weapons = new WeaponSystem(this);

    this.alive = false;
    this.frozen = false;            // fase de preparação: sem mover/atirar
    this.state = PLAYER_STATE.DEAD;
    this.stateTime = 0;
    this.deathTime = -1;
    this.deathInfo = null;
    this.stats = { kills: 0, deaths: 0, assists: 0, damage: 0, score: 0, headshots: 0 };

    this.blindTimer = 0;
    this.blindTotal = 0;
    this.stepAcc = 0;
    this.useProgress = 0;           // segundos segurando "usar" (plantar/desarmar)
    this._eye = [0, 0, 0];
  }

  get pos() { return this.body.pos; }

  spawn(x, y, z, yaw) {
    this.body.teleport(x, y, z);
    this.view.yaw = yaw;
    this.view.pitch = 0;
    this.cmd = makeCmd();
    this.alive = true;
    this.health.reset();
    this.armor.reset(MATCH_RULES.STARTING_ARMOR);
    this.receiver.reset();
    this.hitboxes.enabled = true;
    this.hitboxes.update(x, y, z, yaw, false);
    this.blindTimer = 0;
    this.blindTotal = 0;
    this.stepAcc = 0;
    this.deathInfo = null;
    this.deathTime = -1;
    this.weapons.recoil.reset();
    this.state = PLAYER_STATE.IDLE;
    this.stateTime = 0;
  }

  eyeArray() {
    const b = this.body;
    this._eye[0] = b.pos.x;
    this._eye[1] = b.pos.y + b.eyeOffset;
    this._eye[2] = b.pos.z;
    return this._eye;
  }

  aimYaw() {
    return this.view.yaw - this.weapons.recoil.aimPunch.yaw * DEG;
  }

  aimPitch() {
    return clamp(this.view.pitch + this.weapons.recoil.aimPunch.pitch * DEG, -1.5, 1.5);
  }

  get isBlind() { return this.blindTimer > 0; }
  get blindAmount() { return this.blindTotal > 0 ? clamp(this.blindTimer / this.blindTotal, 0, 1) : 0; }

  blind(seconds) {
    if (seconds > this.blindTimer) {
      this.blindTimer = seconds;
      this.blindTotal = seconds;
    }
  }

  /** Um tick de simulação. */
  update(dt) {
    this.stateTime += dt;
    if (!this.alive) {
      this._updateDead(dt);
      return;
    }
    if (this.blindTimer > 0) this.blindTimer = Math.max(0, this.blindTimer - dt);

    const cmd = this.cmd;
    const mc = this._moveCmd;
    const frozen = this.frozen;
    mc.moveX = frozen ? 0 : cmd.moveX;
    mc.moveZ = frozen ? 0 : cmd.moveZ;
    mc.jump = frozen ? false : cmd.jump;
    mc.crouch = cmd.crouch;
    mc.run = cmd.run;
    mc.yaw = this.view.yaw;

    stepMovement(this.body, mc, dt, this.weapons.moveSpeedMul);
    this.weapons.update(dt, cmd, !frozen);
    this.hitboxes.update(this.body.pos.x, this.body.pos.y, this.body.pos.z, this.view.yaw, this.body.crouched);
    this._gameplayEvents(dt);
    this._updateState();

    // Bordas de um tick: limpar após uso.
    cmd.jump = false;
    cmd.reload = false;
    cmd.slot = null;
    cmd.switchDelta = 0;
    cmd.quickSwitch = false;
    cmd.throwGrenade = null;
  }

  _updateDead(dt) {
    this.state = PLAYER_STATE.DEAD;
    const v = this.body.vel;
    const k = Math.exp(-6 * dt);
    v.x *= k; v.z *= k;
    if (this.body.speedXZ > 0.05 || !this.body.onGround) this.body.move(dt);
    this.weapons.recoil.update(dt, null);
  }

  _updateState() {
    const b = this.body;
    const speed = b.speedXZ;
    let s;
    if (!b.onGround) s = PLAYER_STATE.AIR;
    else if (b.crouched) s = speed > 0.6 ? PLAYER_STATE.CROUCH_WALK : PLAYER_STATE.CROUCH;
    else if (speed > MOVEMENT.WALK_SPEED + 0.6) s = PLAYER_STATE.RUN;
    else if (speed > 0.6) s = PLAYER_STATE.WALK;
    else s = PLAYER_STATE.IDLE;
    if (s !== this.state) { this.state = s; this.stateTime = 0; }
  }

  _gameplayEvents(dt) {
    const b = this.body;
    const session = this.session;
    if (b.jumped) {
      session.events.emit('jump', { who: this });
      session.emitSound(b.pos, 7, 'jump', this);
    }
    if (b.landed) {
      session.events.emit('land', { who: this, impact: b.landImpact, surface: b.groundSurface });
      if (b.landImpact > 4) session.emitSound(b.pos, Math.min(20, 6 + b.landImpact), 'land', this);
      if (b.landImpact > MOVEMENT.FALL_DAMAGE_SPEED) {
        this.receiveDamage({
          amount: (b.landImpact - MOVEMENT.FALL_DAMAGE_SPEED) * MOVEMENT.FALL_DAMAGE_PER_MS,
          type: 'fall', attacker: null, hitbox: null,
        });
      }
    }
    if (b.onGround && !this.frozen) {
      const speed = b.speedXZ;
      if (speed > 1.2) {
        this.stepAcc += speed * dt;
        const stride = b.crouched ? 2.6 : speed > MOVEMENT.WALK_SPEED + 0.6 ? 2.15 : 1.85;
        if (this.stepAcc >= stride) {
          this.stepAcc -= stride;
          const running = speed > MOVEMENT.WALK_SPEED + 0.6;
          session.events.emit('footstep', {
            who: this, x: b.pos.x, y: b.pos.y, z: b.pos.z, surface: b.groundSurface,
            running, crouched: b.crouched, speed,
          });
          if (!b.crouched) session.emitSound(b.pos, running ? 15 : 8, 'footstep', this);
        }
      } else {
        this.stepAcc = 0;
      }
    }
  }

  /** Ponto de entrada para todo dano. Retorna o resultado ou null. */
  receiveDamage(info) {
    if (!this.alive) return null;
    const session = this.session;
    const res = this.receiver.receive(info, session.time);
    if (!res) return null;
    session.events.emit('damage', { victim: this, attacker: info.attacker || null, ...res });
    if (info.attacker && info.attacker !== this) info.attacker.stats.damage += res.dealt;
    if (res.killed) this._die(res);
    return res;
  }

  _die(res) {
    const info = res.info;
    this.alive = false;
    this.state = PLAYER_STATE.DEAD;
    this.deathTime = this.session.time;
    this.hitboxes.enabled = false;
    this.stats.deaths++;
    const killer = info.attacker && info.attacker !== this ? info.attacker : null;
    if (killer) {
      killer.stats.kills++;
      killer.stats.score += killer.team === this.team ? -1 : 1;
      if (res.headshot) killer.stats.headshots++;
    }
    // Assistências: quem causou ≥ 30 de dano além do matador.
    for (const [who, dmg] of this.receiver.damageBy) {
      if (who !== killer && dmg >= 30 && who.team !== this.team) who.stats.assists++;
    }
    if (info.dir) {
      this.body.vel.x = info.dir.x * 1.8;
      this.body.vel.z = info.dir.z * 1.8;
    }
    this.deathInfo = {
      killer, weaponId: info.weaponId || null, headshot: res.headshot, type: info.type,
      penetrated: !!info.penetrated, distance: info.distance || 0, hitbox: info.hitbox || null,
    };
    this.session.events.emit('death', { victim: this, killer, ...this.deathInfo });
  }
}
