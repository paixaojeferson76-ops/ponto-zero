// Inventário + máquina de estados das armas de UM combatente.
// Fases: READY → (HOLSTER → EQUIP) na troca; RELOAD; WINDUP → RECOVER nas granadas.
// A cadência de tiro é independente da fase (nextFireAt).
import { WEAPONS, WEAPON_TIMING, GRENADE_ORDER } from '../Config/WeaponDefs.js';
import { approach, lerp } from '../Systems/MathUtil.js';
import { RecoilSystem } from './RecoilSystem.js';
import { computeSpread } from './Accuracy.js';

export const PHASE = {
  READY: 'ready',
  HOLSTER: 'holster',
  EQUIP: 'equip',
  RELOAD: 'reload',
  WINDUP: 'windup',
  RECOVER: 'recover',
};

const GUN_SLOTS = ['primary', 'secondary', 'melee'];

export class WeaponInstance {
  constructor(def) {
    this.def = def;
    this.ammo = def.magSize || 0;
    this.reserve = def.reserve || 0;
  }
}

export class WeaponSystem {
  constructor(owner) {
    this.owner = owner;
    this.slots = { primary: null, secondary: null, melee: null };
    this.grenades = { frag: 0, flash: 0, smoke: 0 };
    this.grenadeInstances = {};
    for (const k of GRENADE_ORDER) this.grenadeInstances[k] = new WeaponInstance(WEAPONS[k]);
    this.selectedGrenade = 'frag';
    this.active = null;
    this.activeKey = null;
    this.lastKey = null;
    this.pendingKey = null;
    this.autoThrow = null;
    this.phase = PHASE.READY;
    this.phaseT = 0;
    this.phaseDur = 0;
    this.reloadStage = null;
    this.time = 0;
    this.nextFireAt = 0;
    this.prevFire = false;
    this.prevAlt = false;
    this.adsAmount = 0;
    this.meleePending = null;
    this.pumpAt = -1;
    this.throwLob = false;
    this.recoil = new RecoilSystem();
  }

  // ------------------------------------------------------------------ inventário

  clear() {
    this.slots.primary = this.slots.secondary = this.slots.melee = null;
    for (const k of GRENADE_ORDER) this.grenades[k] = 0;
    this.active = null;
    this.activeKey = null;
    this.lastKey = null;
    this.pendingKey = null;
    this.autoThrow = null;
    this.meleePending = null;
  }

  give(defId) {
    const def = WEAPONS[defId];
    if (!def) throw new Error(`Arma desconhecida: ${defId}`);
    this.slots[def.slot] = new WeaponInstance(def);
    return this.slots[def.slot];
  }

  /** Troca a arma primária (menu de equipamento): munição cheia e saque imediato se ela estiver em uso. */
  setPrimary(defId) {
    const inst = this.give(defId);
    if (this.activeKey === 'primary') {
      this.active = inst;
      this.phase = PHASE.EQUIP;
      this.phaseT = 0;
      this.phaseDur = inst.def.equipTime;
      this.recoil.reset();
    }
    return inst;
  }

  addGrenade(kind, n = 1) {
    this.grenades[kind] = Math.min(2, this.grenades[kind] + n);
  }

  /** Equipa o kit inicial do round e saca a melhor arma imediatamente (sem animação de troca longa). */
  loadout({ primary = 'ar30', secondary = 'p9', melee = 'knife', grenades = {} } = {}) {
    this.clear();
    if (primary) this.give(primary);
    if (secondary) this.give(secondary);
    if (melee) this.give(melee);
    for (const k of GRENADE_ORDER) this.grenades[k] = grenades[k] || 0;
    this.recoil.reset();
    this.adsAmount = 0;
    this.phase = PHASE.READY;
    const first = this.slots.primary ? 'primary' : this.slots.secondary ? 'secondary' : 'melee';
    this.activeKey = first;
    this.active = this.slots[first];
    this.lastKey = this.slots.melee ? 'melee' : first;
    this.phase = PHASE.EQUIP;
    this.phaseT = 0;
    this.phaseDur = this.active.def.equipTime;
    this.nextFireAt = this.time;
  }

  instanceFor(key) {
    if (GUN_SLOTS.includes(key)) return this.slots[key];
    if (this.grenades[key] > 0) return this.grenadeInstances[key];
    return null;
  }

  get def() { return this.active ? this.active.def : null; }
  get isGrenade() { return !!this.active && this.active.def.slot === 'grenade'; }
  get isMelee() { return !!this.active && this.active.def.mode === 'melee'; }
  get isReady() { return this.phase === PHASE.READY; }
  get ads() { return this.adsAmount; }

  get moveSpeedMul() {
    const def = this.def;
    if (!def) return 1;
    let m = def.moveSpeedMul ?? 1;
    if (def.ads) m *= lerp(1, def.ads.moveMul, this.adsAmount);
    return m;
  }

  get currentSpread() {
    const def = this.def;
    if (!def || def.spreadBase === undefined) return 0;
    return computeSpread(def, this.owner.body, this.adsAmount, this.recoil.bloom) * (this.owner.accuracyMul ?? 1);
  }

  /** Progresso 0..1 da fase atual. */
  get phaseProgress() {
    return this.phaseDur > 0 ? Math.min(1, this.phaseT / this.phaseDur) : 1;
  }

  get ammoInfo() {
    const a = this.active;
    return {
      key: this.activeKey,
      def: a ? a.def : null,
      ammo: a ? a.ammo : 0,
      reserve: a ? a.reserve : 0,
      magSize: a ? a.def.magSize : 0,
      phase: this.phase,
    };
  }

  needsReload() {
    const a = this.active;
    return !!a && a.def.magSize > 0 && a.ammo < a.def.magSize && a.reserve > 0;
  }

  ammoFraction() {
    const a = this.active;
    return a && a.def.magSize > 0 ? a.ammo / a.def.magSize : 1;
  }

  totalAmmo() {
    const a = this.active;
    return a ? a.ammo + a.reserve : 0;
  }

  // ------------------------------------------------------------------ troca de arma

  requestSwitch(key) {
    if (!key) return false;
    if (GRENADE_ORDER.includes(key) && this.grenades[key] > 0) this.selectedGrenade = key;
    const inst = this.instanceFor(key);
    if (!inst) return false;
    if (this.phase === PHASE.WINDUP || this.phase === PHASE.RECOVER) return false;
    if (key === this.activeKey && this.phase !== PHASE.HOLSTER) return false;
    if (this.phase === PHASE.HOLSTER) {
      this.pendingKey = key;
      return true;
    }
    this.pendingKey = key;
    this.phase = PHASE.HOLSTER;
    this.phaseT = 0;
    this.phaseDur = WEAPON_TIMING.HOLSTER_TIME;
    this.adsAmount = 0;
    this.meleePending = null;
    this.reloadStage = null;   // recarga interrompida por troca
    this.owner.session.events.emit('weaponHolster', { owner: this.owner, def: this.def });
    return true;
  }

  cycle(delta) {
    const order = [...GUN_SLOTS.filter((k) => this.slots[k]), ...GRENADE_ORDER.filter((k) => this.grenades[k] > 0)];
    if (order.length < 2) return;
    const current = this.pendingKey || this.activeKey;
    let i = order.indexOf(current);
    if (i < 0) i = 0;
    const next = order[(i + (delta > 0 ? 1 : -1) + order.length) % order.length];
    this.requestSwitch(next);
  }

  quickSwitch() {
    if (this.lastKey) this.requestSwitch(this.lastKey);
  }

  _finishHolster() {
    let key = this.pendingKey;
    let inst = key ? this.instanceFor(key) : null;
    if (!inst) {
      key = this.slots.primary ? 'primary' : this.slots.secondary ? 'secondary' : 'melee';
      inst = this.slots[key];
    }
    this.lastKey = this.activeKey && this.activeKey !== key ? this.activeKey : this.lastKey;
    this.activeKey = key;
    this.active = inst;
    this.pendingKey = null;
    this.phase = PHASE.EQUIP;
    this.phaseT = 0;
    this.phaseDur = inst.def.equipTime;
    this.recoil.reset(true);
    this.owner.session.events.emit('weaponEquip', { owner: this.owner, def: inst.def, key });
  }

  // ------------------------------------------------------------------ frame

  update(dt, cmd, canAct = true) {
    this.time += dt;
    this.phaseT += dt;

    if (cmd.slot) this.requestSwitch(cmd.slot);
    if (cmd.switchDelta) this.cycle(cmd.switchDelta);
    if (cmd.quickSwitch) this.quickSwitch();
    if (cmd.throwGrenade && canAct) this._quickThrow(cmd.throwGrenade);

    this._advancePhase();

    const fireEdge = cmd.fire && !this.prevFire;
    const altEdge = cmd.alt && !this.prevAlt;
    this.prevFire = cmd.fire;
    this.prevAlt = cmd.alt;

    const def = this.def;
    const wantAds = canAct && !!def && !!def.ads && cmd.alt && this.phase === PHASE.READY;
    this.adsAmount = approach(this.adsAmount, wantAds ? 1 : 0, dt / ((def && def.ads && def.ads.time) || 0.12));

    if (canAct) {
      if (cmd.reload) this.tryReload();
      this._handleTrigger(cmd, fireEdge, altEdge);
    }

    if (this.meleePending && this.time >= this.meleePending.at) {
      const { alt } = this.meleePending;
      this.meleePending = null;
      this.owner.session.ballistics.melee(this.owner, this.def, alt);
    }
    if (this.pumpAt >= 0 && this.time >= this.pumpAt) {
      this.pumpAt = -1;
      this.owner.session.events.emit('weaponPump', { owner: this.owner, def: this.def });
    }

    this.recoil.update(dt, def && def.recoilPattern ? def : null);
  }

  _advancePhase() {
    switch (this.phase) {
      case PHASE.HOLSTER:
        if (this.phaseT >= this.phaseDur) this._finishHolster();
        break;
      case PHASE.EQUIP:
        if (this.phaseT >= this.phaseDur) {
          this.phase = PHASE.READY;
          if (this.autoThrow && this.autoThrow === this.activeKey) {
            this.autoThrow = null;
            this._startThrow(false);
          }
        }
        break;
      case PHASE.RELOAD:
        this._advanceReload();
        break;
      case PHASE.WINDUP:
        if (this.phaseT >= this.phaseDur) this._releaseGrenade();
        break;
      case PHASE.RECOVER:
        if (this.phaseT >= this.phaseDur) {
          this.phase = PHASE.READY;
          const back = this.lastKey && this.instanceFor(this.lastKey) && !GRENADE_ORDER.includes(this.lastKey)
            ? this.lastKey : (this.slots.primary ? 'primary' : 'secondary');
          this.requestSwitch(back);
        }
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ recarga

  tryReload() {
    const a = this.active;
    if (!a || this.phase !== PHASE.READY) return false;
    const def = a.def;
    if (!(def.magSize > 0) || a.ammo >= def.magSize || a.reserve <= 0) return false;
    this.phase = PHASE.RELOAD;
    this.phaseT = 0;
    this.adsAmount = 0;
    if (def.reloadStyle === 'shell') {
      this.reloadStage = 'start';
      this.phaseDur = def.reloadStart;
    } else {
      this.reloadStage = 'mag';
      this.phaseDur = a.ammo === 0 ? def.reloadTimeEmpty : def.reloadTime;
    }
    this.owner.session.events.emit('reloadStart', { owner: this.owner, def, empty: a.ammo === 0, duration: this.phaseDur });
    this.owner.session.emitSound(this.owner.body.pos, 9, 'reload', this.owner);
    return true;
  }

  _advanceReload() {
    if (this.phaseT < this.phaseDur) return;
    const a = this.active;
    const def = a.def;
    const events = this.owner.session.events;
    if (this.reloadStage === 'mag') {
      const take = Math.min(def.magSize - a.ammo, a.reserve);
      a.ammo += take;
      a.reserve -= take;
      this.phase = PHASE.READY;
      this.reloadStage = null;
      events.emit('reloadDone', { owner: this.owner, def });
    } else if (this.reloadStage === 'start') {
      this.reloadStage = 'insert';
      this.phaseT = 0;
      this.phaseDur = def.shellTime;
      events.emit('reloadShell', { owner: this.owner, def });
    } else if (this.reloadStage === 'insert') {
      a.ammo += 1;
      a.reserve -= 1;
      if (a.ammo < def.magSize && a.reserve > 0) {
        this.phaseT = 0;
        this.phaseDur = def.shellTime;
        events.emit('reloadShell', { owner: this.owner, def });
      } else {
        this.reloadStage = 'end';
        this.phaseT = 0;
        this.phaseDur = def.reloadEnd;
      }
    } else {
      this.phase = PHASE.READY;
      this.reloadStage = null;
      events.emit('reloadDone', { owner: this.owner, def });
    }
  }

  // ------------------------------------------------------------------ disparo

  _handleTrigger(cmd, fireEdge, altEdge) {
    const a = this.active;
    if (!a) return;
    const def = a.def;

    if (def.mode === 'melee') {
      if (this.phase !== PHASE.READY || this.time < this.nextFireAt) return;
      if (cmd.fire) this._startMelee(false);
      else if (altEdge) this._startMelee(true);
      return;
    }
    if (def.mode === 'grenade') {
      if (this.phase !== PHASE.READY) return;
      if (fireEdge) this._startThrow(false);
      else if (altEdge) this._startThrow(true);
      return;
    }

    // Recarga de espingarda pode ser interrompida atirando.
    if (this.phase === PHASE.RELOAD && def.reloadStyle === 'shell' && fireEdge && a.ammo > 0) {
      this.phase = PHASE.READY;
      this.reloadStage = null;
    }
    if (this.phase !== PHASE.READY || this.time < this.nextFireAt) return;
    const wants = def.mode === 'auto' ? cmd.fire : fireEdge;
    if (!wants) return;
    if (a.ammo > 0) {
      this._shoot();
    } else {
      this.nextFireAt = this.time + WEAPON_TIMING.DRY_FIRE_LOCKOUT;
      this.owner.session.events.emit('dryFire', { owner: this.owner, def });
      this.tryReload();
    }
  }

  _shoot() {
    const owner = this.owner;
    const session = owner.session;
    const a = this.active;
    const def = a.def;
    a.ammo -= 1;

    const spread = computeSpread(def, owner.body, this.adsAmount, this.recoil.bloom) * (owner.accuracyMul ?? 1);
    const eye = owner.eyeArray();
    session.ballistics.fire(owner, def, eye[0], eye[1], eye[2], owner.aimYaw(), owner.aimPitch(), spread);
    this.recoil.onShot(def, this.adsAmount, session.rng);

    if (this.time - this.nextFireAt > def.fireInterval) this.nextFireAt = this.time;
    this.nextFireAt += def.fireInterval;
    if (def.mode === 'pump') this.pumpAt = this.time + def.fireInterval * 0.45;

    session.events.emit('weaponFired', { owner, def, ammo: a.ammo, spread });
    session.emitSound(owner.body.pos, def.shotLoudness, 'gunshot', owner);
  }

  _startMelee(alt) {
    const def = this.def;
    this.nextFireAt = this.time + (alt ? def.altInterval : def.fireInterval);
    this.meleePending = { at: this.time + (alt ? def.altHitDelay : def.hitDelay), alt };
    this.recoil.camKick.roll += (alt ? 1 : -1) * def.camKickRoll;
    this.recoil.camKick.pitch += def.camKickPitch;
    this.recoil.camKickRecover = def.camKickRecover;
    this.recoil.shotCounter++;
    this.owner.session.events.emit('meleeSwing', { owner: this.owner, def, alt });
    this.owner.session.emitSound(this.owner.body.pos, def.shotLoudness, 'melee', this.owner);
  }

  // ------------------------------------------------------------------ granadas

  _quickThrow(kind) {
    let k = kind === 'selected' ? this.selectedGrenade : kind;
    if (!(this.grenades[k] > 0)) k = GRENADE_ORDER.find((g) => this.grenades[g] > 0);
    if (!k) return;
    this.selectedGrenade = k;
    if (this.activeKey === k && this.phase === PHASE.READY) {
      this._startThrow(false);
    } else if (this.phase !== PHASE.WINDUP && this.phase !== PHASE.RECOVER) {
      this.autoThrow = k;
      this.requestSwitch(k);
    }
  }

  _startThrow(lob) {
    const def = this.def;
    if (!def || def.mode !== 'grenade' || this.grenades[def.kind] <= 0) return;
    this.phase = PHASE.WINDUP;
    this.phaseT = 0;
    this.phaseDur = WEAPON_TIMING.GRENADE_WINDUP;
    this.throwLob = lob;
    this.owner.session.events.emit('grenadePrime', { owner: this.owner, kind: def.kind });
  }

  _releaseGrenade() {
    const kind = this.def.kind;
    if (this.grenades[kind] <= 0) { this.phase = PHASE.READY; return; }
    this.grenades[kind] -= 1;
    this.owner.session.grenades.throwFrom(this.owner, kind, this.throwLob);
    this.phase = PHASE.RECOVER;
    this.phaseT = 0;
    this.phaseDur = WEAPON_TIMING.GRENADE_RECOVER;
    this.owner.session.events.emit('grenadeThrown', { owner: this.owner, kind, lob: this.throwLob });
  }
}
