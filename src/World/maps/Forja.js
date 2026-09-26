// Mapa original "FORJA" — complexo industrial abandonado, 96 × 72 m.
//
//   Atacantes nascem na DOCA (oeste). Defensores na SALA DE CONTROLE (leste).
//   Sítio A (nordeste) e Sítio B (sudeste). Três lanes: NORTE (galpão), MEIO (praça) e SUL (galpão).
//
//   z-
//   ┌────────────────────────────────────────────────────────────┐
//   │  Corredor Norte ══ Galpão Norte ═══════╗  SÍTIO A  (camarote)│
//   │      ║      Oficina                    ║  ╔══ Passagem A ═══╣ │
//   │  DOCA ═ Saguão ═ PRAÇA (passarelas) ═ Corredor Central ═ SALA DE CONTROLE
//   │      ║      Depósito                   ║  ╚══ Passagem B ═══╣ │
//   │  Corredor Sul ═══ Galpão Sul ══════════╝  SÍTIO B  (mezanino)│
//   └────────────────────────────────────────────────────────────┘
//   z+
//
// O layout é dado por (1) retângulos "abertos" (carve) — todo o resto vira parede — e (2) props explícitos.
// Coordenadas em metros; x → leste, z → sul; y para cima. yaw 0 olha para -Z; yaw = -π/2 olha para +X.

const HALF_PI = Math.PI / 2;

export const FORJA = {
  id: 'forja',
  name: 'FORJA',
  bounds: { minX: -48, maxX: 48, minZ: -36, maxZ: 36 },
  wallHeight: 7,
  raster: 0.5,

  // Áreas abertas [x0, z0, x1, z1]. Sobreposições/adjacências se fundem.
  carve: {
    doca: [-45, -9, -33, 9],
    porta_doca_n: [-33, -7, -31, -4],
    porta_doca_m: [-33, -1.5, -31, 1.5],
    porta_doca_s: [-33, 4, -31, 7],
    saguao: [-31, -12, -25, 12],
    corr_norte: [-31, -30, -25, -12],
    galpao_norte: [-31, -31, 8, -24],
    corr_sul: [-31, 12, -25, 30],
    galpao_sul: [-31, 23, 8, 31],
    porta_praca_m: [-25, -2.5, -23, 2.5],
    porta_praca_n: [-25, -11, -23, -8],
    porta_praca_s: [-25, 8, -23, 11],
    praca: [-23, -13, -1, 13],
    oficina: [-18, -22, -8, -15],
    porta_oficina_n: [-14, -24, -11, -22],
    porta_oficina_s: [-14, -15, -11, -13],
    deposito: [-18, 15, -8, 22],
    porta_deposito_n: [-14, 13, -11, 15],
    porta_deposito_s: [-14, 22, -11, 23],
    corredor_central: [-1, -3, 14, 3],
    passagem_a: [-1, -13, 8, -10],
    passagem_b: [-1, 10, 8, 13],
    sitio_a: [8, -32, 40, -10],
    sitio_b: [8, 10, 40, 32],
    sala_controle: [14, -9, 44, 9],
    porta_a1: [20, -10.5, 25, -8.5],
    porta_a2: [34, -10.5, 38, -8.5],
    porta_b1: [20, 8.5, 25, 10.5],
    porta_b2: [34, 8.5, 38, 10.5],
  },

  // Tetos (y 4.6→5.0). Lacunas deixam entrar luz do sol (claraboias).
  roofs: [
    [-45, -9, -33, 9],                    // doca
    [-31, -12, -25, 12],                  // saguão
    [-31, -30, -25, -12],                 // corredor norte
    [-31, -31, -20, -24], [-16, -31, -6, -24], [-2, -31, 8, -24],   // galpão norte (2 claraboias)
    [-31, 12, -25, 30],                   // corredor sul
    [-31, 23, -20, 31], [-16, 23, -6, 31], [-2, 23, 8, 31],         // galpão sul
    [-18, -22, -8, -15],                  // oficina
    [-18, 15, -8, 22],                    // depósito
    [-1, -3, 14, 3],                      // corredor central
    [-1, -13, 8, -10], [-1, 10, 8, 13],   // passagens
    [14, -9, 30, 9], [34, -9, 44, 9],     // sala de controle (claraboia no meio)
  ],
  roofY: 4.6,
  roofThickness: 0.4,

  // Sólidos explícitos. t: box | ramp | stairs.
  // box: [x0,z0,x1,z1,h,tag,surface?,y0?]   ramp: [x0,z0,x1,z1,h,dir,tag]   stairs: [x0,z0,x1,z1,h,dir,steps,tag]
  props: [
    // ---------------- DOCA (spawn atacante)
    ['box', -44.5, -8.5, -42, -7, 1.4, 'lowwall'],
    ['box', -44.5, 7, -42, 8.5, 1.4, 'lowwall'],
    ['box', -37, -8.5, -35.2, -7.3, 1.2, 'crate'],
    ['box', -37, 7.3, -35.2, 8.5, 1.2, 'crate'],
    ['box', -35.6, -3.4, -34.6, -2.4, 7, 'pillar'],
    ['box', -35.6, 2.4, -34.6, 3.4, 7, 'pillar'],

    // ---------------- SAGUÃO
    ['box', -30.4, -4.5, -29, -3.2, 1.2, 'crate'],
    ['box', -30.4, 3.2, -29, 4.5, 1.2, 'crate'],
    ['box', -27, -0.6, -26, 0.6, 1.0, 'barrel', 'metal'],

    // ---------------- CORREDOR NORTE (lane)
    ['box', -30.5, -22, -29.2, -20.8, 1.2, 'crate'],
    ['box', -26.6, -17.5, -25.2, -16.2, 1.2, 'crate'],
    ['box', -30.5, -16, -29.6, -15.1, 1.0, 'barrel', 'metal'],
    ['box', -30.6, -30.4, -29.2, -29, 1.4, 'crate'],

    // ---------------- GALPÃO NORTE (39 m de linha reta) — cobertura ao longo da lane
    ['box', -22, -30.4, -20.2, -28.6, 2.4, 'crate'],
    ['box', -13.4, -27.8, -12.6, -27, 7, 'pillar'],
    ['box', -13.4, -30.4, -12.6, -29.6, 7, 'pillar'],
    ['box', -9, -26.4, -7.2, -24.6, 1.2, 'crate'],
    ['box', -5.4, -30.4, -3.6, -28.6, 1.2, 'crate'],
    ['box', -1, -27.6, 0.2, -26.4, 1.4, 'crate'],
    ['box', 2.6, -30.6, 4.4, -28.8, 2.4, 'crate'],
    ['box', 4, -25.8, 5.2, -24.6, 1.0, 'barrel', 'metal'],

    // ---------------- OFICINA
    ['box', -17.4, -21.4, -14.6, -20.2, 1.0, 'workbench'],
    ['box', -9.6, -21.4, -8.4, -20.2, 1.4, 'crate'],
    ['box', -9.4, -16.6, -8.4, -15.4, 1.0, 'barrel', 'metal'],
    ['box', -12, -19.2, -10.6, -17.8, 1.2, 'crate'],

    // ---------------- DEPÓSITO
    ['box', -17.4, 20.2, -14.6, 21.4, 1.0, 'workbench'],
    ['box', -9.6, 20.2, -8.4, 21.4, 1.4, 'crate'],
    ['box', -17.2, 15.6, -16.2, 16.6, 1.0, 'barrel', 'metal'],
    ['box', -13, 17.2, -11.6, 18.6, 2.4, 'crate'],

    // ---------------- CORREDOR SUL (lane)
    ['box', -30.5, 22, -29.2, 23.2, 1.2, 'crate'],
    ['box', -26.6, 16.2, -25.2, 17.5, 1.2, 'crate'],
    ['box', -30.5, 27, -29.6, 27.9, 1.0, 'barrel', 'metal'],
    ['box', -30.6, 29, -29.2, 30.4, 1.4, 'crate'],

    // ---------------- GALPÃO SUL
    ['box', -22, 29, -20.2, 30.8, 2.4, 'crate'],
    ['box', -13.4, 25.8, -12.6, 26.6, 7, 'pillar'],
    ['box', -13.4, 28.6, -12.6, 29.4, 7, 'pillar'],
    ['box', -9, 24.6, -7.2, 26.4, 1.2, 'crate'],
    ['box', -5.4, 28.6, -3.6, 30.4, 1.2, 'crate'],
    ['box', -1, 26.4, 0.2, 27.6, 1.4, 'crate'],
    ['box', 2.6, 28.8, 4.4, 30.6, 2.4, 'crate'],
    ['box', 4, 24.6, 5.2, 25.8, 1.0, 'barrel', 'metal'],

    // ---------------- PRAÇA
    ['box', -19.2, -1.8, -17.6, 1.8, 2.6, 'pillar'],                  // bloco alto: quebra a linha spawn→spawn pela porta do meio
    ['box', -14, -4.6, -12.6, -3.2, 1.2, 'crate'],
    ['box', -14, 3.2, -12.6, 4.6, 1.2, 'crate'],
    ['box', -4.6, -4.6, -3.6, -3.6, 1.0, 'barrel', 'metal'],
    ['box', -4.6, 3.6, -3.6, 4.6, 1.0, 'barrel', 'metal'],
    ['box', -22.6, -6, -21.4, -4.8, 1.2, 'crate'],
    ['box', -22.6, 4.8, -21.4, 6, 1.2, 'crate'],
    // plataforma norte + rampa
    ['box', -9, -9.5, -2, -6, 2.6, 'catwalk'],
    ['ramp', -16, -9.5, -9, -6, 2.6, '+x', 'catwalk'],
    ['box', -9, -6.2, -2, -5.95, 1.1, 'rail', 'thin', 2.6],
    // plataforma sul + escada
    ['box', -9, 6, -2, 9.5, 2.6, 'catwalk'],
    ['stairs', -14, 6, -9, 9.5, 2.6, '+x', 13, 'catwalk'],
    ['box', -9, 5.95, -2, 6.2, 1.1, 'rail', 'thin', 2.6],

    // ---------------- CORREDOR CENTRAL
    ['box', 3.4, -3, 3.9, -2.2, 1.0, 'pipe', 'metal'],
    ['box', 7.5, 2.2, 9, 3, 1.4, 'crate'],

    // ---------------- PASSAGENS
    ['box', 3, -13, 4.2, -12, 1.2, 'crate'],
    ['box', 3, 12, 4.2, 13, 1.2, 'crate'],

    // ---------------- SÍTIO A (nordeste): plantar em (22, -21)
    ['box', 12, -16.4, 13.4, -15.2, 1.2, 'crate'],
    ['box', 13.4, -16.4, 14.6, -15.2, 1.2, 'crate'],
    ['box', 12.4, -16.4, 13.6, -15.2, 2.4, 'crate', 'wood', 1.2],
    ['box', 15, -28.2, 21, -25.8, 2.4, 'container_red', 'metal'],
    ['box', 25.6, -25, 26.8, -23.8, 7, 'pillar'],
    ['box', 25.6, -18.2, 26.8, -17, 7, 'pillar'],
    ['box', 30.4, -18.2, 31.6, -17, 7, 'pillar'],
    ['box', 24.4, -14.6, 30.4, -14.2, 1.4, 'lowwall'],
    ['box', 17, -14.4, 18.4, -13.2, 1.4, 'crate'],
    ['box', 34.5, -22.5, 36.3, -20.7, 1.2, 'crate'],
    ['box', 34.5, -20.5, 36.3, -18.7, 2.4, 'crate'],
    ['box', 9.5, -20, 10.5, -19, 1.0, 'barrel', 'metal'],
    ['box', 9.5, -18.6, 10.5, -17.6, 1.0, 'barrel', 'metal'],
    // camarote elevado + rampa
    ['box', 32, -32, 40, -25, 2.4, 'catwalk'],
    ['ramp', 26, -32, 32, -27, 2.4, '+x', 'catwalk'],
    ['box', 32, -25.2, 40, -25, 1.1, 'rail', 'thin', 2.4],

    // ---------------- SÍTIO B (sudeste): plantar em (24, 21)
    ['box', 12, 15.2, 13.4, 16.4, 1.2, 'crate'],
    ['box', 12, 16.4, 13.4, 17.6, 1.0, 'crate'],
    ['box', 17, 23, 19.4, 25.4, 2.4, 'container_blue', 'metal'],
    ['box', 15.6, 25.4, 20.8, 27.8, 2.4, 'container_blue', 'metal'],
    ['box', 28.4, 23.8, 29.6, 25, 7, 'pillar'],
    ['box', 28.4, 15.4, 29.6, 16.6, 7, 'pillar'],
    ['box', 18, 14.6, 23, 15, 1.4, 'lowwall'],
    ['box', 34, 17, 35.4, 18.4, 1.4, 'crate'],
    ['box', 35.4, 17, 36.6, 18.2, 1.2, 'crate'],
    ['box', 9.5, 22, 10.5, 23, 1.0, 'barrel', 'metal'],
    ['box', 9.5, 24, 10.5, 25, 1.0, 'barrel', 'metal'],
    // mezanino elevado + escada
    ['box', 30, 26, 40, 32, 2.4, 'catwalk'],
    ['stairs', 30, 20, 33, 26, 2.4, '+z', 12, 'catwalk'],
    ['box', 33.4, 25.8, 40, 26, 1.1, 'rail', 'thin', 2.4],

    // ---------------- SALA DE CONTROLE (spawn defensor)
    ['box', 16.5, -6.5, 17.7, -5.3, 1.4, 'crate'],
    ['box', 16.5, 5.3, 17.7, 6.5, 1.4, 'crate'],
    ['box', 22, -1.4, 26, 1.4, 1.0, 'console', 'metal'],
    ['box', 30.4, -6.4, 31.6, -5.2, 7, 'pillar'],
    ['box', 30.4, 5.2, 31.6, 6.4, 7, 'pillar'],
    ['box', 41.6, -2, 43.6, 2, 2.4, 'container_red', 'metal'],
    ['box', 38, -7.6, 39.6, -6.4, 1.2, 'crate'],
    ['box', 38, 6.4, 39.6, 7.6, 1.2, 'crate'],
  ],

  spawns: {
    attack: [
      { x: -41, z: -6, yaw: -HALF_PI }, { x: -41, z: -3, yaw: -HALF_PI }, { x: -41, z: 0, yaw: -HALF_PI },
      { x: -41, z: 3, yaw: -HALF_PI }, { x: -41, z: 6, yaw: -HALF_PI },
    ],
    defend: [
      { x: 36, z: -5, yaw: HALF_PI }, { x: 36, z: -2.5, yaw: HALF_PI }, { x: 36, z: 0, yaw: HALF_PI },
      { x: 36, z: 2.5, yaw: HALF_PI }, { x: 36, z: 5, yaw: HALF_PI },
    ],
  },

  sites: {
    A: { name: 'A', x: 22, z: -21, radius: 4.5 },
    B: { name: 'B', x: 24, z: 21, radius: 4.5 },
  },

  // Rotas de aproximação (pontos de passagem no plano XZ) de cada spawn atacante até o sítio.
  routes: {
    A: {
      norte: [[-28, -8], [-28, -27], [-6, -27.5], [9, -27]],
      meio: [[-28, 0], [-20, -3], [-3, -11.5], [9, -11.5]],
      oficina: [[-28, -9.5], [-20, -12], [-12.5, -19], [-6, -27], [9, -26]],
    },
    B: {
      sul: [[-28, 8], [-28, 27], [-6, 27.5], [9, 27]],
      meio: [[-28, 0], [-20, 3], [-3, 11.5], [9, 11.5]],
      deposito: [[-28, 9.5], [-20, 12], [-12.5, 19], [-6, 27], [9, 26]],
    },
  },

  // Posições de defesa (x, z, yaw = direção do olhar) por sítio.
  holds: {
    A: [
      { x: 16, z: -12.5, yaw: HALF_PI + 0.35 }, { x: 12, z: -27, yaw: HALF_PI }, { x: 30, z: -13, yaw: HALF_PI },
      { x: 23, z: -18, yaw: HALF_PI }, { x: 36, z: -14, yaw: HALF_PI },
    ],
    B: [
      { x: 16, z: 12.5, yaw: HALF_PI - 0.35 }, { x: 12, z: 27, yaw: HALF_PI }, { x: 30, z: 13, yaw: HALF_PI },
      { x: 25, z: 18, yaw: HALF_PI }, { x: 36, z: 14, yaw: HALF_PI },
    ],
    mid: [
      { x: 16, z: 0, yaw: HALF_PI }, { x: 9, z: -1, yaw: HALF_PI },
    ],
  },

  // Onde os atacantes se posicionam depois de plantar (cobrindo a carga).
  postPlant: {
    A: [{ x: 14, z: -27, yaw: HALF_PI }, { x: 31, z: -20, yaw: HALF_PI }, { x: 14, z: -12, yaw: HALF_PI }, { x: 27, z: -15, yaw: HALF_PI }],
    B: [{ x: 14, z: 27, yaw: HALF_PI }, { x: 32, z: 20, yaw: HALF_PI }, { x: 14, z: 12, yaw: HALF_PI }, { x: 28, z: 16, yaw: HALF_PI }],
  },

  // Pontos livres para patrulha (modo treino / defensores ociosos).
  patrol: [
    [-28, 0], [-15, 0], [-6, 0], [6, 0], [-28, -22], [-10, -27.5], [-28, 22], [-10, 27.5],
    [22, 0], [33, 0], [14, -12], [14, 12], [24, -16], [26, 17],
  ],

  // Luzes pontuais de interior [x, y, z, cor, intensidade, alcance].
  lights: [
    [-39, 3.6, 0, 0xffd9a0, 1.0, 22],
    [-28, 3.6, 0, 0xfff0d0, 0.9, 20],
    [-28, 3.6, -20, 0xffd9a0, 0.8, 18],
    [-28, 3.6, 20, 0xffd9a0, 0.8, 18],
    [-25, 3.8, -27.5, 0xfff0d0, 0.9, 20],
    [-3, 3.8, -27.5, 0xfff0d0, 0.9, 20],
    [-25, 3.8, 27, 0xfff0d0, 0.9, 20],
    [-3, 3.8, 27, 0xfff0d0, 0.9, 20],
    [-13, 3.4, -18.5, 0xffe2b0, 0.9, 14],
    [-13, 3.4, 18.5, 0xffe2b0, 0.9, 14],
    [6, 3.4, 0, 0xfff0d0, 0.8, 18],
    [22, 3.8, 0, 0xffe6bd, 1.0, 24],
    [40, 3.8, 0, 0xffe6bd, 0.9, 20],
  ],

  // Decalques de chão: letras dos sítios e faixas de aviso.
  floorMarks: [
    { text: 'A', x: 22, z: -21, size: 6 },
    { text: 'B', x: 24, z: 21, size: 6 },
  ],
};
