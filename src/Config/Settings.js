// Configurações do usuário: valores padrão, validação e persistência local (localStorage).
import { CAMERA, CROSSHAIR_DEFAULTS, MOUSE } from './Tuning.js';
import { DEFAULT_BINDINGS } from './Controls.js';
import { QUALITY_LEVELS } from './Quality.js';

const STORAGE_KEY = 'pontozero.settings.v1';

export const DEFAULT_SETTINGS = {
  video: {
    resolution: 'native',
    fullscreen: false,
    quality: 'MEDIUM',
    shadows: true,
    fov: CAMERA.DEFAULT_FOV,
    showFps: true,
  },
  mouse: {
    sensitivity: MOUSE.DEFAULT_SENSITIVITY,
    invertY: false,
    aimMultiplier: 1.0,     // multiplica a sensibilidade enquanto mira (ADS)
    rawInput: true,
  },
  audio: { master: 0.8, sfx: 1.0, music: 0.35 },
  gameplay: {
    headBob: true,
    headBobAmount: 1.0,     // 0..1.5
    cameraEffects: 1.0,     // 0..1 — tilt, kick, dip
    difficulty: 'NORMAL',   // EASY | NORMAL | HARD
    playerSide: 'attack',   // attack | defend
    teamSize: 5,            // jogadores por time (inclui o humano)
    roundsToWin: 5,
    primary: 'ar30',        // arma primária preferida
  },
  crosshair: {
    size: CROSSHAIR_DEFAULTS.SIZE,
    thickness: CROSSHAIR_DEFAULTS.THICKNESS,
    gap: CROSSHAIR_DEFAULTS.GAP,
    color: CROSSHAIR_DEFAULTS.COLOR,
    opacity: CROSSHAIR_DEFAULTS.OPACITY,
    outline: CROSSHAIR_DEFAULTS.OUTLINE,
    dot: CROSSHAIR_DEFAULTS.DOT,
    dynamicMovement: CROSSHAIR_DEFAULTS.DYNAMIC_MOVEMENT,
    dynamicFiring: CROSSHAIR_DEFAULTS.DYNAMIC_FIRING,
  },
  touch: {
    sensitivity: 1.0,       // velocidade de giro ao arrastar (celular)
    stickyAim: 0.85,        // mira grudada no inimigo: 0 = desligada … 1 = muito forte
    autoFire: true,         // segurando MIRAR com a mira em cima do inimigo, atira sozinho
    buttonScale: 1.0,       // tamanho dos botões na tela
    easyV: 0,               // migração única: usuários de toque antigos passam para "Muito fácil"
  },
  controls: DEFAULT_BINDINGS,
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function deepMerge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra.slice() : base.slice();
  if (base && typeof base === 'object') {
    const out = {};
    for (const key of Object.keys(base)) {
      out[key] = extra && key in extra ? deepMerge(base[key], extra[key]) : clone(base[key]);
    }
    return out;
  }
  return typeof extra === typeof base ? extra : base;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function sanitize(s) {
  s.video.fov = clamp(s.video.fov, CAMERA.MIN_FOV, CAMERA.MAX_FOV);
  if (!QUALITY_LEVELS.includes(s.video.quality)) s.video.quality = 'MEDIUM';
  s.mouse.sensitivity = clamp(s.mouse.sensitivity, MOUSE.MIN_SENSITIVITY, MOUSE.MAX_SENSITIVITY);
  s.mouse.aimMultiplier = clamp(s.mouse.aimMultiplier, 0.2, 2);
  for (const k of ['master', 'sfx', 'music']) s.audio[k] = clamp(s.audio[k], 0, 1);
  s.gameplay.headBobAmount = clamp(s.gameplay.headBobAmount, 0, 1.5);
  s.gameplay.cameraEffects = clamp(s.gameplay.cameraEffects, 0, 1);
  s.gameplay.teamSize = clamp(Math.round(s.gameplay.teamSize), 1, 5);
  s.gameplay.roundsToWin = clamp(Math.round(s.gameplay.roundsToWin), 1, 15);
  if (!['CASUAL', 'EASY', 'NORMAL', 'HARD'].includes(s.gameplay.difficulty)) s.gameplay.difficulty = 'NORMAL';
  if (!['attack', 'defend'].includes(s.gameplay.playerSide)) s.gameplay.playerSide = 'attack';
  s.touch.sensitivity = clamp(s.touch.sensitivity, 0.3, 3);
  s.touch.stickyAim = clamp(s.touch.stickyAim, 0, 1);
  s.touch.autoFire = !!s.touch.autoFire;
  s.touch.buttonScale = clamp(s.touch.buttonScale, 0.7, 1.5);
  s.crosshair.size = clamp(s.crosshair.size, 0, 30);
  s.crosshair.thickness = clamp(s.crosshair.thickness, 1, 8);
  s.crosshair.gap = clamp(s.crosshair.gap, -4, 20);
  s.crosshair.opacity = clamp(s.crosshair.opacity, 0.1, 1);
  return s;
}

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class Settings {
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.data = this.load();
    this.listeners = new Set();
  }

  load() {
    let saved = null;
    this.firstRun = true;
    try {
      const raw = this.storage && this.storage.getItem(STORAGE_KEY);
      if (raw) { saved = JSON.parse(raw); this.firstRun = false; }
    } catch {
      saved = null;
    }
    return sanitize(deepMerge(DEFAULT_SETTINGS, saved));
  }

  save() {
    try {
      if (this.storage) this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* armazenamento indisponível: segue só em memória */
    }
  }

  /** Aplica alterações, valida, persiste e avisa os ouvintes. */
  update(mutator) {
    mutator(this.data);
    sanitize(this.data);
    this.save();
    for (const fn of this.listeners) fn(this.data);
  }

  reset(section) {
    this.update((d) => {
      if (section) d[section] = clone(DEFAULT_SETTINGS[section]);
      else Object.assign(d, clone(DEFAULT_SETTINGS));
    });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
