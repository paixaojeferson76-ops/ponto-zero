// Parâmetros de gameplay centralizados. Unidades: metros, segundos, graus (salvo indicado).
// Nada de valores mágicos espalhados pelo código: ajuste aqui (ou pelo painel F3 em runtime).

export const SIM = {
  TICK_RATE: 120,          // passos físicos por segundo
  MAX_FRAME_TIME: 0.1,     // s — evita espiral da morte após travadas
  MAX_STEPS_PER_FRAME: 8,
};

export const MOVEMENT = {
  WALK_SPEED: 4.0,         // m/s — velocidade base
  RUN_SPEED: 5.8,          // m/s — segurando SHIFT
  CROUCH_SPEED: 2.1,       // m/s — segurando CTRL
  ACCELERATION: 8.0,       // ×wishspeed por segundo (tração no chão)
  DECELERATION: 8.0,       // atrito aplicado quando NÃO há input (parada curta)
  FRICTION: 5.5,           // atrito aplicado com input (corrige excesso de velocidade)
  STOP_SPEED: 2.0,         // m/s — abaixo disso o atrito vira linear (evita "arrastar")
  AIR_ACCELERATION: 14.0,  // tração no ar
  AIR_SPEED_CAP: 1.2,      // m/s — teto de wish-speed no ar (air-strafe leve)
  AIR_CONTROL: 0.35,       // 0..1 — quanto o jogador consegue curvar a trajetória no ar
  GRAVITY: 20.0,           // m/s²
  JUMP_FORCE: 6.9,         // m/s — velocidade vertical inicial (apogeu ≈ 1,19 m)
  JUMP_SPEED_CAP: 1.12,    // × RUN_SPEED — limite horizontal ao pular (anti-bhop)
  JUMP_BUFFER: 0.1,        // s — aperta pulo um pouco antes de pousar e ainda pula
  TERMINAL_VELOCITY: 60,   // m/s
  STEP_HEIGHT: 0.45,       // m — obstáculo máximo "subível" andando
  MAX_SLOPE_DEG: 46,       // rampas mais íngremes viram parede
  CROUCH_TIME: 0.16,       // s — transição visual da câmera
  FALL_DAMAGE_SPEED: 12.5, // m/s — impacto acima disso causa dano (≈ queda de 4 m)
  FALL_DAMAGE_PER_MS: 8,   // dano por m/s acima do limite
  LAND_SLOWDOWN_SPEED: 8,  // m/s — pouso forte reduz velocidade horizontal
  LAND_SLOWDOWN_FACTOR: 0.6,
};

export const PLAYER = {
  RADIUS: 0.4,             // meia-largura do hull (AABB)
  HEIGHT_STAND: 1.8,
  HEIGHT_CROUCH: 1.35,
  EYE_STAND: 1.62,
  EYE_CROUCH: 1.17,
  MAX_HEALTH: 100,
  MAX_ARMOR: 100,
  RESPAWN_DELAY: 0,        // respawn só no início do round (regras da partida)
};

export const MOUSE = {
  YAW_DEG_PER_COUNT: 0.022,   // como o m_yaw de FPS clássicos: graus por count × sensibilidade
  PITCH_DEG_PER_COUNT: 0.022,
  DEFAULT_SENSITIVITY: 1.6,
  MIN_SENSITIVITY: 0.1,
  MAX_SENSITIVITY: 8,
};

export const CAMERA = {
  DEFAULT_FOV: 100,           // FOV horizontal (16:9) em graus
  MIN_FOV: 70,
  MAX_FOV: 120,
  MAX_PITCH: 89,
  MIN_PITCH: -89,
  BOB_VERTICAL: 0.012,        // m
  BOB_LATERAL: 0.008,         // m
  BOB_FREQUENCY: 1.45,        // ciclos por metro percorrido
  BOB_RUN_SCALE: 1.35,
  BOB_CROUCH_SCALE: 0.6,
  TILT_MAX_DEG: 0.9,          // inclinação lateral ao andar de lado
  TILT_SPEED: 14,             // suavização (1/s)
  LAND_DIP_PER_MS: 0.006,     // m de afundamento por m/s de impacto
  LAND_DIP_MAX: 0.09,
  LAND_RECOVER: 11,           // 1/s
  STEP_SMOOTH_RATE: 20,       // 1/s — suaviza sobe-degrau só visualmente
  RUN_FOV_KICK: 1.6,          // graus extras ao correr
  FOV_SMOOTH: 10,
  DEATH_CAM_DISTANCE: 2.4,
};

export const CROSSHAIR_DEFAULTS = {
  SIZE: 7,             // comprimento de cada linha (px)
  THICKNESS: 2,        // px
  GAP: 3,              // abertura base (px)
  COLOR: '#7dffb6',
  OPACITY: 0.95,
  OUTLINE: true,
  DOT: false,
  DYNAMIC_MOVEMENT: true,  // abre ao mover/pular
  DYNAMIC_FIRING: true,    // abre ao atirar
};

export const DAMAGE = {
  ARMOR_ABSORB: 0.5,        // fração do dano que a armadura absorve
  ARMOR_WEAR: 0.5,          // armadura perdida por ponto absorvido
  FRIENDLY_FIRE: false,
  HEADSHOT_IGNORES_ARMOR: true,
};

export const GRENADES = {
  THROW_SPEED: 17,           // m/s
  LOB_SPEED: 8,              // m/s (botão direito)
  INHERIT_VELOCITY: 0.45,
  GRAVITY: 20,
  RESTITUTION: 0.42,
  TANGENT_FRICTION: 0.72,
  RADIUS: 0.09,
  REST_SPEED: 0.6,
  FRAG: { FUSE: 1.65, RADIUS: 7.5, MAX_DAMAGE: 98, MIN_DAMAGE: 8 },
  FLASH: { FUSE: 1.35, RADIUS: 26, MAX_BLIND: 4.2, MIN_BLIND: 0.6 },
  SMOKE: { FUSE: 2.4, RADIUS: 4.6, GROW_TIME: 1.0, DURATION: 17 },
};
