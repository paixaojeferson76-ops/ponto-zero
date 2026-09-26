// Controles de toque (celular/tablet), no estilo dos FPS mobile: joystick virtual dinâmico à esquerda
// (empurrar até o limite = correr), arrastar à direita para olhar, botões de tiro/mira/pulo/agachar/recarga/
// troca/granada/usar. Pointer Events + multitoque (cada dedo tem seu papel). Sem dependências.

const DEAD = 0.12;       // zona morta do joystick (fração do raio)
const RUN_ON = 0.92;     // empurrou além disso → corre
const RUN_OFF = 0.8;     // histerese para parar de correr

/**
 * Converte o deslocamento do dedo no joystick em comando de movimento.
 * Abaixo do limite de corrida a velocidade é analógica (0…caminhada); além dele, corre.
 */
export function stickToMove(dx, dy, radius, wasRunning = false) {
  const len = Math.hypot(dx, dy);
  const m = Math.min(1, len / radius);
  if (m < DEAD) return { moveX: 0, moveZ: 0, run: false, magnitude: 0 };
  const run = wasRunning ? m > RUN_OFF : m > RUN_ON;
  const scale = run ? 1 : Math.min(1, (m - DEAD) / (RUN_ON - DEAD));
  return { moveX: (dx / len) * scale, moveZ: (-dy / len) * scale, run, magnitude: m };
}

const ICONS = {
  fire: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  ads: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.8"/>',
  jump: '<path d="M5 14l7-7 7 7"/><path d="M5 20l7-7 7 7" opacity=".55"/>',
  crouch: '<path d="M5 10l7 7 7-7"/><path d="M5 4l7 7 7-7" opacity=".55"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.5 3.5v5h-5"/>',
  swap: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  nade: '<circle cx="12" cy="14.5" r="6"/><path d="M12 8.5V4.5h4.5"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13" stroke-width="3"/>',
  score: '<path d="M4 6.5h16M4 12h16M4 17.5h10"/>',
};

function btn(cls, act, icon, label) {
  const svg = icon ? `<svg viewBox="0 0 24 24">${ICONS[icon]}</svg>` : '';
  return `<div class="tc-btn ${cls}" data-act="${act}">${svg}<span>${label}</span></div>`;
}

export class TouchControls {
  /** @param {HTMLElement} root contêiner #touch-ui */
  constructor(root) {
    this.root = root;
    this.active = false;
    this.scale = 1;
    this.onPause = null;
    this.onScoreboard = null;
    this.onLoadout = null;
    this.pointers = new Map();
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, run: false };
    this.s = this._blank();
    this.lookDX = 0;
    this.lookDY = 0;
    this._build();
    this._bind();
  }

  _blank() {
    return {
      moveX: 0, moveZ: 0, run: false, crouch: false, fire: false, fireLatch: false, alt: false, use: false,
      jump: false, reload: false, slot: null, switchDelta: 0, throwGrenade: false,
    };
  }

  _build() {
    this.root.innerHTML = `
      <div class="tc-stick"><i class="tc-knob"></i></div>
      ${btn('tc-fire', 'fire', 'fire', 'TIRO')}
      ${btn('tc-ads', 'ads', 'ads', 'MIRAR')}
      ${btn('tc-jump', 'jump', 'jump', 'PULAR')}
      ${btn('tc-crouch', 'crouch', 'crouch', 'AGACHAR')}
      ${btn('tc-reload', 'reload', 'reload', 'RECAR.')}
      ${btn('tc-swap', 'swap', 'swap', 'ARMA')}
      ${btn('tc-nade', 'nade', 'nade', 'GRANADA')}
      ${btn('tc-score', 'score', 'score', 'PLACAR')}
      ${btn('tc-pause', 'pause', 'pause', '')}
      ${btn('tc-loadout hidden', 'loadout', 'swap', 'EQUIP.')}
      ${btn('tc-use hidden', 'use', null, 'USAR')}`;
    this.stickEl = this.root.querySelector('.tc-stick');
    this.knobEl = this.root.querySelector('.tc-knob');
    this.useEl = this.root.querySelector('.tc-use');
    this.crouchEl = this.root.querySelector('.tc-crouch');
    this.loadoutEl = this.root.querySelector('.tc-loadout');
  }

  /** Botão de equipamento: só na fase de preparação. */
  setLoadout(show) {
    this.loadoutEl.classList.toggle('hidden', !show);
  }

  setScale(s) {
    this.scale = s;
    this.root.style.setProperty('--tc', String(s));
  }

  setActive(on) {
    this.active = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) this.releaseAll();
  }

  /** Mostra/oculta o botão contextual (plantar/desarmar). */
  setUse(show, label) {
    this.useEl.classList.toggle('hidden', !show);
    if (show && label && this.useEl.lastChild.textContent !== label) this.useEl.lastChild.textContent = label;
    if (!show && this.s.use) this.s.use = false;
  }

  releaseAll() {
    this.pointers.clear();
    this.stick.id = null;
    this.stickEl.style.display = 'none';
    const keepCrouch = this.s.crouch;
    this.s = this._blank();
    this.s.crouch = false;
    void keepCrouch;
    this.root.querySelectorAll('.tc-btn.down').forEach((b) => b.classList.remove('down'));
    this.crouchEl.classList.remove('on');
    this.lookDX = this.lookDY = 0;
  }

  // ------------------------------------------------------------------ eventos

  _bind() {
    const r = this.root;
    r.addEventListener('pointerdown', (e) => this._down(e));
    r.addEventListener('pointermove', (e) => this._move(e));
    const up = (e) => this._up(e);
    r.addEventListener('pointerup', up);
    r.addEventListener('pointercancel', up);
    r.addEventListener('lostpointercapture', up);
    r.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _radius() { return 62 * this.scale; }

  _down(e) {
    if (!this.active || e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const b = e.target.closest ? e.target.closest('.tc-btn') : null;
    if (!b) {
      // toque num ícone de arma/granada do HUD (que fica por baixo desta camada)
      const chip = (document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : []).find((el) => el.dataset && el.dataset.key);
      if (chip) { this.s.slot = chip.dataset.key; return; }
    }
    try { this.root.setPointerCapture(e.pointerId); } catch { /* ignorado */ }
    if (b) {
      const act = b.dataset.act;
      b.classList.add('down');
      this.pointers.set(e.pointerId, { role: 'btn', act, el: b, x: e.clientX, y: e.clientY });
      this._btnDown(act);
      return;
    }
    if (e.clientX < window.innerWidth * 0.46 && this.stick.id === null) {
      const R = this._radius();
      const ox = Math.max(R * 0.9, Math.min(window.innerWidth * 0.46 - R * 0.4, e.clientX));
      const oy = Math.max(R * 0.9, Math.min(window.innerHeight - R * 0.9, e.clientY));
      Object.assign(this.stick, { id: e.pointerId, ox, oy, x: e.clientX, y: e.clientY, run: false });
      this.pointers.set(e.pointerId, { role: 'stick' });
      this.stickEl.style.display = 'block';
      this.stickEl.style.left = `${ox}px`;
      this.stickEl.style.top = `${oy}px`;
      this._updateStick();
    } else {
      this.pointers.set(e.pointerId, { role: 'look', x: e.clientX, y: e.clientY });
    }
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.role === 'stick') {
      this.stick.x = e.clientX; this.stick.y = e.clientY;
      this._updateStick();
    } else if (p.role === 'look' || (p.role === 'btn' && (p.act === 'fire' || p.act === 'ads'))) {
      // arrastar a partir do botão de tiro/mira também gira a câmera (mira e atira ao mesmo tempo)
      this.lookDX += e.clientX - p.x;
      this.lookDY += e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
    }
  }

  _up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.role === 'stick') {
      this.stick.id = null;
      this.stickEl.style.display = 'none';
      this.s.moveX = this.s.moveZ = 0;
      this.s.run = false;
    } else if (p.role === 'btn') {
      p.el.classList.remove('down');
      this._btnUp(p.act);
    }
  }

  _updateStick() {
    const st = this.stick;
    const R = this._radius();
    const dx = st.x - st.ox, dy = st.y - st.oy;
    const m = stickToMove(dx, dy, R, st.run);
    st.run = m.run;
    this.s.moveX = m.moveX; this.s.moveZ = m.moveZ; this.s.run = m.run;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / R) * R;
    this.knobEl.style.transform = `translate(${(dx / len) * k}px, ${(dy / len) * k}px)`;
    this.stickEl.classList.toggle('run', m.run);
  }

  _btnDown(act) {
    const s = this.s;
    switch (act) {
      case 'fire': s.fire = true; s.fireLatch = true; break;
      case 'ads': s.alt = true; break;
      case 'jump': s.jump = true; break;
      case 'crouch': s.crouch = !s.crouch; this.crouchEl.classList.toggle('on', s.crouch); break;
      case 'reload': s.reload = true; break;
      case 'swap': s.switchDelta += 1; break;
      case 'nade': s.throwGrenade = true; break;
      case 'use': s.use = true; break;
      case 'score': if (this.onScoreboard) this.onScoreboard(true); break;
      case 'pause': if (this.onPause) this.onPause(); break;
      case 'loadout': if (this.onLoadout) this.onLoadout(); break;
      default: break;
    }
  }

  _btnUp(act) {
    const s = this.s;
    if (act === 'fire') s.fire = false;
    else if (act === 'ads') s.alt = false;
    else if (act === 'use') s.use = false;
    else if (act === 'score' && this.onScoreboard) this.onScoreboard(false);
  }

  /** Toque numa "chip" de arma/granada do HUD. */
  selectSlot(key) { this.s.slot = key; }

  // ------------------------------------------------------------------ consumo (Input)

  /** Soma o estado de toque em `out` (snapshot do frame) e consome as bordas. */
  mergeInto(out) {
    const s = this.s;
    out.moveX = clampAdd(out.moveX, s.moveX);
    out.moveZ = clampAdd(out.moveZ, s.moveZ);
    out.run = out.run || s.run;
    out.crouch = out.crouch || s.crouch;
    out.fire = out.fire || s.fire || s.fireLatch;
    out.alt = out.alt || s.alt;
    out.use = out.use || s.use;
    out.jump = out.jump || s.jump;
    out.reload = out.reload || s.reload;
    out.slot = out.slot || s.slot;
    out.switchDelta += s.switchDelta;
    out.throwGrenade = out.throwGrenade || (s.throwGrenade ? 'selected' : null);
    s.fireLatch = false; s.jump = false; s.reload = false; s.slot = null; s.switchDelta = 0; s.throwGrenade = false;
  }

  takeLook(out) {
    out.tdx = this.lookDX;
    out.tdy = this.lookDY;
    this.lookDX = 0;
    this.lookDY = 0;
  }
}

const clampAdd = (a, b) => Math.max(-1, Math.min(1, a + b));

/** Modo celular? (?touch=1/0 força; senão ponteiro "grosso" sem hover = celular/tablet). */
export function detectTouchMode(query) {
  const forced = query && query.get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (!window.matchMedia) return false;
  return matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches;
}
