// Definição de dados das armas. Todo comportamento de arma é dirigido por estes campos.
// Convenções: ângulos em graus; tempos em segundos; distâncias em metros; dano em HP.
//
//  slot          'primary' | 'secondary' | 'melee' | 'grenade'
//  mode          'auto' | 'semi' | 'pump' | 'melee' | 'grenade'
//  damage        dano por projétil (bala/pelota) antes de multiplicadores
//  pellets       projéteis por disparo
//  hitMult       multiplicador de dano por hitbox {head, torso, arm, leg}
//  falloff*      dano × clamp(1 - max(0, dist - start) * perMeter, min, 1)
//  penetration   poder de penetração (× SURFACES[x].penetrationDepth = espessura máxima)
//  armorPen      fração do dano que ignora a armadura (0..1)
//  spread*       cone de dispersão (meio-ângulo): base + movimento + ar; × agachar × ADS; + bloom
//  recoil*       recoil de PRECISÃO: padrão determinístico [pitch↑, yaw→] por tiro (afeta a bala)
//  camKick*      recoil VISUAL da câmera (não afeta a mira)
//  vm*           recoil do MODELO da arma (mola visual do viewmodel)
//  ads           mira (botão direito): fovMul, moveMul, spreadMul, recoilMul, time
//  bot*          preferências de combate da IA

const lerp = (a, b, t) => a + (b - a) * t;

function buildPattern({ shots, pitch, peakAt, yawAmp, yawFreq, yawPhase = 0, yawDrift = 0 }) {
  const [start, peak, end] = pitch;
  const out = [];
  for (let i = 0; i < shots; i++) {
    const f = i / Math.max(1, shots - 1);
    const p = f < peakAt ? lerp(start, peak, f / peakAt) : lerp(peak, end, (f - peakAt) / (1 - peakAt));
    const ramp = Math.min(1, i / 6);
    const y = yawAmp * Math.sin(i * yawFreq + yawPhase) * ramp + yawDrift * ramp;
    out.push([p, y]);
  }
  return out;
}

const HIT_STD = { head: 4.0, torso: 1.0, arm: 0.8, leg: 0.75 };

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 SENTINELA', short: 'P9', slot: 'secondary', mode: 'semi', model: 'pistol',
    damage: 30, pellets: 1, hitMult: { ...HIT_STD },
    range: 90, falloffStart: 22, falloffPerMeter: 0.008, falloffMin: 0.45,
    penetration: 0.6, armorPen: 0.4,
    fireInterval: 0.14, magSize: 13, reserve: 39,
    reloadTime: 1.9, reloadTimeEmpty: 2.1, equipTime: 0.35,
    moveSpeedMul: 0.98,
    spreadBase: 0.05, spreadMove: 1.9, spreadAir: 3.4, spreadCrouchMul: 0.6, spreadPerShot: 0.7,
    spreadBloomMax: 2.4, spreadRecovery: 6.0,
    recoilPattern: buildPattern({ shots: 13, pitch: [0.9, 1.2, 0.8], peakAt: 0.3, yawAmp: 0.18, yawFreq: 1.2 }),
    recoilJitter: 0.05, recoilDecay: 4.6, recoilResetDelay: 0.22, recoilResetRate: 12,
    camKickPitch: 0.5, camKickRoll: 0.35, camKickRecover: 15,
    vmKickBack: 0.045, vmKickUp: 0.015, vmKickPitch: 5.0,
    ads: { fovMul: 0.88, moveMul: 0.85, spreadMul: 0.6, recoilMul: 0.85, time: 0.11 },
    shotLoudness: 48, tracerEvery: 1, tracerColor: 0xffe0a0,
    botIdealRange: [4, 26], botBurst: [1, 2], botBurstPause: [0.18, 0.32],
    sfx: { fire: 'fire_pistol', reload: 'reload_pistol', equip: 'equip_light', dry: 'dry_click' },
  },

  ar30: {
    id: 'ar30', name: 'AR-30 VANGUARDA', short: 'AR-30', slot: 'primary', mode: 'auto', model: 'rifle',
    damage: 33, pellets: 1, hitMult: { ...HIT_STD },
    range: 220, falloffStart: 45, falloffPerMeter: 0.004, falloffMin: 0.6,
    penetration: 1.2, armorPen: 0.6,
    fireInterval: 0.1, magSize: 30, reserve: 90,
    reloadTime: 2.4, reloadTimeEmpty: 2.9, equipTime: 0.55,
    moveSpeedMul: 0.9,
    spreadBase: 0.10, spreadMove: 2.6, spreadAir: 4.0, spreadCrouchMul: 0.62, spreadPerShot: 0.12,
    spreadBloomMax: 1.3, spreadRecovery: 3.5,
    recoilPattern: buildPattern({ shots: 30, pitch: [0.55, 0.95, 0.38], peakAt: 0.3, yawAmp: 0.34, yawFreq: 0.55, yawPhase: 0.4, yawDrift: 0.02 }),
    recoilJitter: 0.06, recoilDecay: 1.7, recoilResetDelay: 0.28, recoilResetRate: 20,
    camKickPitch: 0.3, camKickRoll: 0.22, camKickRecover: 16,
    vmKickBack: 0.032, vmKickUp: 0.011, vmKickPitch: 2.6,
    ads: { fovMul: 0.82, moveMul: 0.78, spreadMul: 0.55, recoilMul: 0.88, time: 0.13 },
    shotLoudness: 62, tracerEvery: 2, tracerColor: 0xffd890,
    botIdealRange: [10, 55], botBurst: [3, 7], botBurstPause: [0.18, 0.4],
    sfx: { fire: 'fire_rifle', reload: 'reload_rifle', equip: 'equip_heavy', dry: 'dry_click' },
  },

  smg9: {
    id: 'smg9', name: 'SM-9 TEMPESTADE', short: 'SM-9', slot: 'primary', mode: 'auto', model: 'smg',
    damage: 22, pellets: 1, hitMult: { ...HIT_STD, head: 3.4 },
    range: 110, falloffStart: 14, falloffPerMeter: 0.008, falloffMin: 0.4,
    penetration: 0.5, armorPen: 0.3,
    fireInterval: 0.0667, magSize: 35, reserve: 105,
    reloadTime: 2.0, reloadTimeEmpty: 2.3, equipTime: 0.5,
    moveSpeedMul: 0.97,
    spreadBase: 0.2, spreadMove: 1.6, spreadAir: 3.0, spreadCrouchMul: 0.7, spreadPerShot: 0.09,
    spreadBloomMax: 1.1, spreadRecovery: 4.0,
    recoilPattern: buildPattern({ shots: 35, pitch: [0.3, 0.52, 0.22], peakAt: 0.35, yawAmp: 0.42, yawFreq: 0.7, yawPhase: 1.1 }),
    recoilJitter: 0.09, recoilDecay: 2.5, recoilResetDelay: 0.2, recoilResetRate: 26,
    camKickPitch: 0.22, camKickRoll: 0.2, camKickRecover: 18,
    vmKickBack: 0.022, vmKickUp: 0.008, vmKickPitch: 1.8,
    ads: { fovMul: 0.86, moveMul: 0.85, spreadMul: 0.65, recoilMul: 0.9, time: 0.1 },
    shotLoudness: 52, tracerEvery: 3, tracerColor: 0xffe6a8,
    botIdealRange: [4, 30], botBurst: [4, 10], botBurstPause: [0.15, 0.3],
    sfx: { fire: 'fire_smg', reload: 'reload_smg', equip: 'equip_light', dry: 'dry_click' },
  },

  ps12: {
    id: 'ps12', name: 'PS-12 MARRETA', short: 'PS-12', slot: 'primary', mode: 'pump', model: 'shotgun',
    damage: 11, pellets: 8, hitMult: { ...HIT_STD, head: 2.2 },
    range: 50, falloffStart: 6, falloffPerMeter: 0.045, falloffMin: 0.12,
    penetration: 0.2, armorPen: 0.2,
    fireInterval: 0.85, magSize: 6, reserve: 30,
    reloadStyle: 'shell', reloadStart: 0.5, shellTime: 0.42, reloadEnd: 0.35,
    reloadTime: 2.9, reloadTimeEmpty: 2.9, equipTime: 0.6,
    moveSpeedMul: 0.93,
    spreadBase: 3.3, spreadMove: 0.8, spreadAir: 1.0, spreadCrouchMul: 0.85, spreadPerShot: 0,
    spreadBloomMax: 0, spreadRecovery: 4,
    recoilPattern: [[3.4, 0.3], [3.4, -0.3]],
    recoilJitter: 0.25, recoilDecay: 3.2, recoilResetDelay: 0.6, recoilResetRate: 4,
    camKickPitch: 1.1, camKickRoll: 0.8, camKickRecover: 9,
    vmKickBack: 0.09, vmKickUp: 0.03, vmKickPitch: 9.0,
    ads: { fovMul: 0.9, moveMul: 0.85, spreadMul: 0.82, recoilMul: 0.9, time: 0.14 },
    shotLoudness: 70, tracerEvery: 0, tracerColor: 0xffd090,
    botIdealRange: [2, 14], botBurst: [1, 1], botBurstPause: [0.35, 0.6],
    sfx: { fire: 'fire_shotgun', reload: 'reload_shell', pump: 'shotgun_pump', equip: 'equip_heavy', dry: 'dry_click' },
  },

  knife: {
    id: 'knife', name: 'FACA TÁTICA', short: 'FACA', slot: 'melee', mode: 'melee', model: 'knife',
    damage: 40, altDamage: 65, hitMult: { head: 1, torso: 1, arm: 1, leg: 1 },
    range: 1.9, altRange: 1.7, backstabMul: 2.6,
    fireInterval: 0.5, altInterval: 1.1, hitDelay: 0.14, altHitDelay: 0.3,
    magSize: 0, reserve: 0, equipTime: 0.4,
    moveSpeedMul: 1.0,
    shotLoudness: 10, penetration: 0, armorPen: 0.5,
    camKickPitch: 0.5, camKickRoll: 1.2, camKickRecover: 12,
    botIdealRange: [0, 2], botBurst: [1, 1], botBurstPause: [0.3, 0.5],
    sfx: { fire: 'knife_swing', hit: 'knife_hit', equip: 'equip_light' },
  },

  frag: {
    id: 'frag', name: 'GRANADA DE FRAGMENTAÇÃO', short: 'FRAG', slot: 'grenade', mode: 'grenade', model: 'grenade',
    kind: 'frag', magSize: 0, equipTime: 0.5, moveSpeedMul: 0.98, shotLoudness: 8,
    sfx: { equip: 'equip_light' },
  },
  flash: {
    id: 'flash', name: 'GRANADA CEGANTE', short: 'CEGANTE', slot: 'grenade', mode: 'grenade', model: 'grenade',
    kind: 'flash', magSize: 0, equipTime: 0.5, moveSpeedMul: 0.98, shotLoudness: 8,
    sfx: { equip: 'equip_light' },
  },
  smoke: {
    id: 'smoke', name: 'GRANADA DE FUMAÇA', short: 'FUMAÇA', slot: 'grenade', mode: 'grenade', model: 'grenade',
    kind: 'smoke', magSize: 0, equipTime: 0.5, moveSpeedMul: 0.98, shotLoudness: 8,
    sfx: { equip: 'equip_light' },
  },
};

export const GRENADE_ORDER = ['frag', 'flash', 'smoke'];
export const PRIMARY_CHOICES = ['ar30', 'smg9', 'ps12'];
export const SECONDARY_CHOICES = ['p9'];

export const WEAPON_TIMING = {
  HOLSTER_TIME: 0.16,        // tempo guardando a arma anterior antes de sacar a nova
  GRENADE_WINDUP: 0.28,      // s entre apertar e soltar a granada
  GRENADE_RECOVER: 0.45,     // s até voltar à arma anterior
  DRY_FIRE_LOCKOUT: 0.25,    // s entre cliques com o pente vazio
  DEFAULT_ADS_MOVE_MUL: 0.8,
  PENETRATION_MAX_WALLS: 2,
  PENETRATION_DAMAGE_LOSS: 0.5, // dano perdido na espessura máxima
  ACCURACY_MIN_SPEED: 1.0,   // m/s — abaixo disso, não há penalidade de movimento
  SPREAD_HARD_CAP: 7,        // graus
};

export function getWeaponDef(id) {
  const def = WEAPONS[id];
  if (!def) throw new Error(`Arma desconhecida: ${id}`);
  return def;
}
