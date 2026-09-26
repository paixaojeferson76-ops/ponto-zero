// Adaptador de entrada do navegador: teclado, mouse (com pointer lock e movimento bruto) e roda.
// Consulta AÇÕES (config de controles), nunca teclas — pronto para remapeamento.
import { ACTIONS, DEFAULT_BINDINGS } from '../Config/Controls.js';

const BLOCK_DEFAULT = new Set(['Tab', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'Space', 'AltLeft', 'AltRight']);

export class Input {
  /**
   * @param {HTMLElement} canvas elemento que recebe o pointer lock
   * @param {() => Record<string,string[]>} getBindings
   */
  constructor(canvas, getBindings = () => DEFAULT_BINDINGS) {
    this.canvas = canvas;
    this.getBindings = getBindings;
    this.held = new Set();
    this.pressed = new Set();       // bordas desde o último snapshot
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.fireLatch = false;
    this.locked = false;
    this.enabled = false;           // só captura jogo quando ativo
    this.rawInput = true;
    this.onLockChange = null;
    this.onAction = null;           // (action) => void para ações "de UI" (debug, placar…)
    this.lockFailedAt = 0;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => this._key(e, true), { capture: true });
    window.addEventListener('keyup', (e) => this._key(e, false), { capture: true });
    window.addEventListener('blur', () => { this.held.clear(); });
    window.addEventListener('mousedown', (e) => this._mouse(e, true));
    window.addEventListener('mouseup', (e) => this._mouse(e, false));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.held.clear(); this.fireLatch = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailedAt = performance.now(); });
    window.addEventListener('beforeunload', (e) => {
      // Ctrl+W (fechar) acidental durante a partida pede confirmação.
      if (this.enabled) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  _key(e, down) {
    if (!this.enabled && !this.locked) return;
    if (this.locked && BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    if (e.code === 'Tab') e.preventDefault();
    if (down) {
      if (!this.held.has(e.code)) {
        this.held.add(e.code);
        this.pressed.add(e.code);
        if (this.onAction) {
          for (const a of ['debug', 'debugMode', 'loadout']) {
            if (this._matches(a, e.code)) this.onAction(a, true);
          }
        }
      }
    } else {
      this.held.delete(e.code);
      if (this.onAction && this._matches('scoreboard', e.code)) this.onAction('scoreboard', false);
    }
    if (down && this.onAction && this._matches('scoreboard', e.code)) this.onAction('scoreboard', true);
  }

  _mouse(e, down) {
    if (!this.locked) return;
    const code = `Mouse${e.button}`;
    if (down) {
      this.held.add(code);
      this.pressed.add(code);
      if (e.button === 0) this.fireLatch = true;
    } else {
      this.held.delete(code);
    }
    e.preventDefault();
  }

  _matches(action, code) {
    const keys = this.getBindings()[action] || [];
    return keys.includes(code);
  }

  isHeld(action) {
    const keys = this.getBindings()[action] || [];
    for (const k of keys) if (this.held.has(k)) return true;
    return false;
  }

  wasPressed(action) {
    const keys = this.getBindings()[action] || [];
    for (const k of keys) if (this.pressed.has(k)) return true;
    return false;
  }

  async lock() {
    if (this.locked) return true;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: this.rawInput });
      if (p && p.then) await p;
    } catch {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.then) await p;
      } catch { /* o usuário precisa clicar de novo */ }
    }
    return document.pointerLockElement === this.canvas;
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Consome o movimento do mouse acumulado desde a última chamada. */
  takeLook(out) {
    out.dx = this.mouseDX;
    out.dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  /** Snapshot de entrada de UM frame de jogo (bordas são consumidas). */
  snapshot(out) {
    const axis = (pos, neg) => (this.isHeld(pos) ? 1 : 0) - (this.isHeld(neg) ? 1 : 0);
    out.moveX = axis('moveRight', 'moveLeft');
    out.moveZ = axis('moveForward', 'moveBack');
    out.run = this.isHeld('run');
    out.crouch = this.isHeld('crouch');
    out.jump = this.wasPressed('jump');
    out.fire = this.isHeld('fire') || this.fireLatch;
    out.alt = this.isHeld('altFire');
    out.use = this.isHeld('use');
    out.reload = this.wasPressed('reload');
    out.slot = this.wasPressed('slotPrimary') ? 'primary'
      : this.wasPressed('slotSecondary') ? 'secondary'
        : this.wasPressed('slotMelee') ? 'melee'
          : this.wasPressed('grenadeFrag') ? 'frag'
            : this.wasPressed('grenadeFlash') ? 'flash'
              : this.wasPressed('grenadeSmoke') ? 'smoke' : null;
    out.throwGrenade = this.wasPressed('throwGrenade') ? 'selected' : null;
    out.switchDelta = this.wheel;
    out.quickSwitch = this.pressed.has('KeyQ');
    this.wheel = 0;
    this.fireLatch = false;
    this.pressed.clear();
    return out;
  }

  clearState() {
    this.held.clear();
    this.pressed.clear();
    this.mouseDX = this.mouseDY = this.wheel = 0;
    this.fireLatch = false;
  }
}

export { ACTIONS };
