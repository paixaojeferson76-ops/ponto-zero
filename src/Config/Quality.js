// Presets de qualidade gráfica. Aplicados pelo SceneManager; valores lidos em runtime.

export const QUALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];

export const QUALITY_PRESETS = {
  LOW: {
    shadows: false, shadowMapSize: 512, shadowRadius: 25,
    pixelRatioCap: 0.85, antialias: false,
    maxDecals: 24, maxTracers: 16, maxParticles: 60,
    fogFar: 90, drawDistance: 110, muzzleLights: false, floorAO: false,
  },
  MEDIUM: {
    shadows: true, shadowMapSize: 1024, shadowRadius: 32,
    pixelRatioCap: 1.0, antialias: true,
    maxDecals: 64, maxTracers: 32, maxParticles: 160,
    fogFar: 130, drawDistance: 160, muzzleLights: true, floorAO: true,
  },
  HIGH: {
    shadows: true, shadowMapSize: 2048, shadowRadius: 40,
    pixelRatioCap: 1.25, antialias: true,
    maxDecals: 128, maxTracers: 64, maxParticles: 320,
    fogFar: 170, drawDistance: 220, muzzleLights: true, floorAO: true,
  },
};

// Resoluções internas de renderização (o canvas é esticado para a janela).
export const RESOLUTION_OPTIONS = [
  { id: 'native', label: 'Nativa da janela', w: 0, h: 0 },
  { id: '1080', label: '1920 × 1080', w: 1920, h: 1080 },
  { id: '900', label: '1600 × 900', w: 1600, h: 900 },
  { id: '720', label: '1280 × 720', w: 1280, h: 720 },
  { id: '540', label: '960 × 540', w: 960, h: 540 },
];
