// Parâmetros da IA dos bots (dificuldade + constantes de percepção/navegação).

export const BOT_STATE = {
  IDLE: 'IDLE',
  PATROL: 'PATROL',
  INVESTIGATE: 'INVESTIGATE',
  SEARCH: 'SEARCH',
  COMBAT: 'COMBAT',
  TAKE_COVER: 'TAKE_COVER',
  RELOAD: 'RELOAD',
  RETREAT: 'RETREAT',
  ATTACK_OBJECTIVE: 'ATTACK_OBJECTIVE',
  DEFEND_OBJECTIVE: 'DEFEND_OBJECTIVE',
  DEAD: 'DEAD',
};

export const AI = {
  THINK_INTERVAL: 0.1,        // s — decisões de alto nível (movimento/mira rodam todo tick)
  VISION_INTERVAL: 0.1,       // s — varredura de visão
  VIEW_DISTANCE: 80,          // m
  FOV_DEG: 118,               // campo de visão horizontal total
  CENTER_FOV_DEG: 45,         // cone central: percepção mais rápida
  NEAR_AWARE_DIST: 4.5,       // m — inimigo visível tão perto é notado na hora
  AWARE_DECAY: 0.7,           // /s
  LOSE_TARGET_TIME: 0.8,      // s sem ver antes de considerar perdido
  ARRIVE_DIST: 0.7,           // m
  WAYPOINT_DIST: 0.55,
  STUCK_CHECK_INTERVAL: 0.4,
  STUCK_MIN_PROGRESS: 0.3,    // m em STUCK_TIME
  STUCK_TIME: 1.2,
  REPATH_MIN_INTERVAL: 0.6,
  HEAR_NOISE_PER_METER: 0.1,  // erro de posição do som por metro
  OCCLUDED_HEARING: 0.55,     // parede entre fonte e bot reduz o alcance
  SOUND_MEMORY: 8,            // s
  INVESTIGATE_TIMEOUT: 14,
  SEARCH_TIME: 6,
  COVER_RADIUS: 14,
  COVER_SAMPLES: 22,
  RETREAT_HEALTH: 0.28,
  RETREAT_TIME: 7,
  TEAM_ALERT_RADIUS: 45,
  TEAM_ALERT_DELAY: 0.6,
  MAX_REPATHS_PER_TICK: 2,    // orçamento de A* por tick da simulação
  HOLD_LOOK_SWEEP: 0.55,      // rad — varredura lateral ao segurar posição
};

/**
 * reaction: atraso (s) entre notar o inimigo e começar a atirar
 * aimTurnRate: velocidade máx. de giro (graus/s)  aimError → aimErrorMin: erro angular (graus) que decai com o tempo na mira
 * recoilControl: fração do recoil que o bot compensa  headChance: chance de mirar na cabeça
 */
export const DIFFICULTY = {
  // damageMul: fração do dano que os tiros deste bot causam (deixa você sobreviver mais)
  CASUAL: {
    label: 'MUITO FÁCIL',
    reaction: [0.95, 1.6], aimTurnRate: 105, aimError: 6.5, aimErrorMin: 3.4, aimSettle: 2.4,
    recoilControl: 0.05, headChance: 0.03, hearingMul: 0.5, awarenessRate: 1.0,
    strafeChance: 0.12, burstMul: 0.6, retreatHealth: 0.5, utilityChance: 0.02, damageMul: 0.55,
  },
  EASY: {
    label: 'FÁCIL',
    reaction: [0.55, 0.95], aimTurnRate: 170, aimError: 4.0, aimErrorMin: 1.8, aimSettle: 1.6,
    recoilControl: 0.25, headChance: 0.1, hearingMul: 0.75, awarenessRate: 1.6,
    strafeChance: 0.35, burstMul: 0.8, retreatHealth: 0.35, utilityChance: 0.1, damageMul: 0.85,
  },
  NORMAL: {
    label: 'NORMAL',
    reaction: [0.3, 0.6], aimTurnRate: 270, aimError: 2.6, aimErrorMin: 0.8, aimSettle: 1.1,
    recoilControl: 0.55, headChance: 0.25, hearingMul: 1.0, awarenessRate: 2.4,
    strafeChance: 0.55, burstMul: 1.0, retreatHealth: 0.28, utilityChance: 0.25, damageMul: 1,
  },
  HARD: {
    label: 'DIFÍCIL',
    reaction: [0.16, 0.34], aimTurnRate: 420, aimError: 1.5, aimErrorMin: 0.35, aimSettle: 0.7,
    recoilControl: 0.82, headChance: 0.4, hearingMul: 1.2, awarenessRate: 3.4,
    strafeChance: 0.75, burstMul: 1.2, retreatHealth: 0.22, utilityChance: 0.4, damageMul: 1,
  },
};

export function getDifficulty(name) {
  return DIFFICULTY[name] || DIFFICULTY.NORMAL;
}
