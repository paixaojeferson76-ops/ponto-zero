// Vida, armadura e receptor de dano — módulos independentes, compostos por qualquer entidade.
import { DAMAGE } from '../Config/Tuning.js';

export class Health {
  constructor(max = 100) {
    this.max = max;
    this.current = max;
  }
  get alive() { return this.current > 0; }
  get fraction() { return this.max > 0 ? this.current / this.max : 0; }
  reset() { this.current = this.max; }
}

export class Armor {
  constructor(max = 100) {
    this.max = max;
    this.current = 0;
    this.helmet = false;
  }
  reset(value = 0) { this.current = Math.min(this.max, value); }
}

/**
 * @typedef {Object} DamageInfo
 * @property {number} amount       dano bruto (já com falloff/hitbox/penetração)
 * @property {'bullet'|'melee'|'explosion'|'fall'|'bomb'|'world'} type
 * @property {object|null} attacker  Combatant que causou o dano
 * @property {string} [weaponId]
 * @property {'head'|'torso'|'arm'|'leg'|null} [hitbox]
 * @property {number} [armorPen]   0..1 fração que ignora armadura
 * @property {boolean} [penetrated] atravessou parede
 * @property {{x:number,y:number,z:number}} [point]
 * @property {{x:number,y:number,z:number}} [dir]  direção do projétil
 */

export class DamageReceiver {
  constructor(owner, health, armor) {
    this.owner = owner;
    this.health = health;
    this.armor = armor;
    this.invulnerable = false;
    this.lastAttacker = null;
    this.lastHitbox = null;
    this.lastWeaponId = null;
    this.lastDamageAt = -Infinity;
    this.damageBy = new Map(); // atacante → dano total (para assistências)
    this.onDamaged = null;
    this.onKilled = null;
  }

  reset() {
    this.lastAttacker = null;
    this.lastHitbox = null;
    this.lastWeaponId = null;
    this.lastDamageAt = -Infinity;
    this.damageBy.clear();
  }

  /**
   * Aplica dano. Retorna { health, armor, killed, headshot } ou null se ignorado.
   * @param {DamageInfo} info
   * @param {number} time tempo da simulação (s)
   */
  receive(info, time = 0) {
    const { health, armor } = this;
    if (!health.alive || this.invulnerable || info.amount <= 0) return null;

    let amount = info.amount;
    let armorAbsorbed = 0;
    const ignoresArmor =
      info.type === 'fall' || info.type === 'bomb' ||
      (info.hitbox === 'head' && DAMAGE.HEADSHOT_IGNORES_ARMOR && !armor.helmet);
    if (armor.current > 0 && !ignoresArmor) {
      let absorbed = amount * DAMAGE.ARMOR_ABSORB * (1 - (info.armorPen ?? 0));
      let wear = absorbed * DAMAGE.ARMOR_WEAR;
      if (wear > armor.current) {
        wear = armor.current;
        absorbed = wear / DAMAGE.ARMOR_WEAR;
      }
      armor.current -= wear;
      amount -= absorbed;
      armorAbsorbed = absorbed;
    }

    const dealt = Math.min(amount, health.current);
    health.current = Math.max(0, health.current - amount);

    if (info.attacker && info.attacker !== this.owner) {
      this.lastAttacker = info.attacker;
      this.damageBy.set(info.attacker, (this.damageBy.get(info.attacker) || 0) + dealt);
    }
    this.lastHitbox = info.hitbox || null;
    this.lastWeaponId = info.weaponId || null;
    this.lastDamageAt = time;

    const result = {
      dealt,
      armorAbsorbed,
      killed: !health.alive,
      headshot: info.hitbox === 'head',
      info,
    };
    if (this.onDamaged) this.onDamaged(result);
    if (result.killed && this.onKilled) this.onKilled(result);
    return result;
  }

  /** Dano de fall damage, explosões etc. (sem hitbox). */
  environmental(amount, type, attacker = null, time = 0) {
    return this.receive({ amount, type, attacker, hitbox: null }, time);
  }
}
