// Menus: principal, pausa, configurações (vídeo/mouse/áudio/jogabilidade/crosshair), controles,
// equipamento (loadout) e fim de partida. Tudo em DOM; alterações persistem via Settings.
import { ACTION_LABELS, prettyKey } from '../Config/Controls.js';
import { RESOLUTION_OPTIONS } from '../Config/Quality.js';
import { CAMERA, MOUSE } from '../Config/Tuning.js';
import { PRIMARY_CHOICES, WEAPONS } from '../Config/WeaponDefs.js';
import { Crosshair } from './Crosshair.js';

const $ = (id) => document.getElementById(id);

const SCHEMA = [
  { id: 'video', label: 'VÍDEO', rows: [
    { k: 'resolution', label: 'Resolução de renderização', type: 'select', options: RESOLUTION_OPTIONS.map((o) => [o.id, o.label]) },
    { k: 'fullscreen', label: 'Tela cheia', type: 'bool' },
    { k: 'quality', label: 'Qualidade gráfica', type: 'select', options: [['LOW', 'Baixa'], ['MEDIUM', 'Média'], ['HIGH', 'Alta']], note: 'Suavização de bordas (antialias) só muda ao recarregar a página.' },
    { k: 'shadows', label: 'Sombras', type: 'bool' },
    { k: 'fov', label: 'Campo de visão (FOV)', type: 'range', min: CAMERA.MIN_FOV, max: CAMERA.MAX_FOV, step: 1, fmt: (v) => `${v}°` },
    { k: 'showFps', label: 'Mostrar FPS', type: 'bool' },
  ] },
  { id: 'mouse', label: 'MOUSE', rows: [
    { k: 'sensitivity', label: 'Sensibilidade', type: 'range', min: MOUSE.MIN_SENSITIVITY, max: 6, step: 0.05, fmt: (v) => v.toFixed(2) },
    { k: 'aimMultiplier', label: 'Multiplicador ao mirar (botão direito)', type: 'range', min: 0.3, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { k: 'invertY', label: 'Inverter eixo vertical', type: 'bool' },
    { k: 'rawInput', label: 'Entrada bruta (sem aceleração do Windows)', type: 'bool' },
  ] },
  { id: 'audio', label: 'ÁUDIO', rows: [
    { k: 'master', label: 'Volume geral', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'sfx', label: 'Efeitos', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'music', label: 'Música', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  ] },
  { id: 'gameplay', label: 'JOGABILIDADE', rows: [
    { k: 'headBob', label: 'Balanço da câmera ao andar (head bob)', type: 'bool' },
    { k: 'headBobAmount', label: 'Intensidade do head bob', type: 'range', min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'cameraEffects', label: 'Efeitos de câmera (inclinação, coice, pouso)', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'difficulty', label: 'Dificuldade dos bots', type: 'select', options: [['EASY', 'Fácil'], ['NORMAL', 'Normal'], ['HARD', 'Difícil']], note: 'Vale a partir da próxima partida.' },
    { k: 'roundsToWin', label: 'Rounds para vencer', type: 'range', min: 1, max: 15, step: 1, fmt: (v) => String(v), note: 'Vale a partir da próxima partida.' },
  ] },
  { id: 'crosshair', label: 'CROSSHAIR', preview: true, rows: [
    { k: 'size', label: 'Tamanho', type: 'range', min: 0, max: 20, step: 1, fmt: (v) => `${v}px` },
    { k: 'thickness', label: 'Espessura', type: 'range', min: 1, max: 6, step: 1, fmt: (v) => `${v}px` },
    { k: 'gap', label: 'Abertura', type: 'range', min: -2, max: 14, step: 1, fmt: (v) => `${v}px` },
    { k: 'color', label: 'Cor', type: 'color' },
    { k: 'opacity', label: 'Opacidade', type: 'range', min: 0.1, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'outline', label: 'Contorno', type: 'bool' },
    { k: 'dot', label: 'Ponto central', type: 'bool' },
    { k: 'dynamicMovement', label: 'Abrir ao mover / pular', type: 'bool' },
    { k: 'dynamicFiring', label: 'Abrir ao atirar', type: 'bool' },
  ] },
];

const TOUCH_SECTION = { id: 'touch', label: 'TOQUE', rows: [
  { k: 'sensitivity', label: 'Sensibilidade ao arrastar', type: 'range', min: 0.3, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { k: 'aimAssist', label: 'Assistência de mira', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => (v === 0 ? 'Desligada' : `${Math.round(v * 100)}%`), note: 'Puxa levemente a mira para o inimigo enquanto você atira.' },
  { k: 'buttonScale', label: 'Tamanho dos botões', type: 'range', min: 0.7, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
] };

const SCREENS = ['loading', 'menu-main', 'menu-pause', 'menu-settings', 'menu-controls', 'menu-loadout', 'menu-end'];

export class Menus {
  /**
   * @param {import('../Config/Settings.js').Settings} settings
   * @param {{onPlay, onResume, onRestart, onQuit, onPlayAgain, onLoadout, onSettingsChanged, onUiSound}} cb
   */
  constructor(settings, cb) {
    this.settings = settings;
    this.cb = cb;
    this.current = null;
    this.returnTo = 'menu-main';
    this.tab = 'video';
    this._wireMain();
    this._wirePause();
    this._wireEnd();
    document.addEventListener('fullscreenchange', () => {
      const fs = !!document.fullscreenElement;
      if (this.settings.data.video.fullscreen !== fs) this.settings.update((d) => { d.video.fullscreen = fs; });
      if (this.current === 'menu-settings') this._renderSettings();
    });
  }

  _click(el, fn) {
    el.addEventListener('mouseenter', () => this.cb.onUiSound && this.cb.onUiSound('ui_hover'));
    el.addEventListener('click', () => { if (this.cb.onUiSound) this.cb.onUiSound('ui_click'); fn(); });
  }

  _wireMain() {
    this._click($('btn-play'), () => {
      const g = this.settings.data.gameplay;
      this.cb.onPlay({ side: g.playerSide, difficulty: g.difficulty, teamSize: g.teamSize });
    });
    this._click($('btn-settings'), () => this.showSettings('menu-main'));
    this._click($('btn-controls'), () => this.showControls('menu-main'));
    const g = this.settings.data.gameplay;
    const side = $('opt-side'), diff = $('opt-diff'), size = $('opt-size');
    side.value = g.playerSide; diff.value = g.difficulty; size.value = String(g.teamSize);
    side.onchange = () => this.settings.update((d) => { d.gameplay.playerSide = side.value; });
    diff.onchange = () => this.settings.update((d) => { d.gameplay.difficulty = diff.value; });
    size.onchange = () => this.settings.update((d) => { d.gameplay.teamSize = Number(size.value); });
  }

  _wirePause() {
    this._click($('btn-resume'), () => this.cb.onResume());
    this._click($('btn-pause-settings'), () => this.showSettings('menu-pause'));
    this._click($('btn-pause-controls'), () => this.showControls('menu-pause'));
    this._click($('btn-restart'), () => this.cb.onRestart());
    this._click($('btn-quit'), () => this.cb.onQuit());
  }

  _wireEnd() {
    this._click($('btn-again'), () => this.cb.onPlayAgain());
    this._click($('btn-end-menu'), () => this.cb.onQuit());
  }

  // ------------------------------------------------------------------ navegação

  show(id) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
    this.current = id;
  }

  hideAll() {
    for (const s of SCREENS) $(s).classList.add('hidden');
    this.current = null;
  }

  showMain() {
    const g = this.settings.data.gameplay;
    $('opt-side').value = g.playerSide;
    $('opt-diff').value = g.difficulty;
    $('opt-size').value = String(g.teamSize);
    this.show('menu-main');
  }
  showPause() { this.show('menu-pause'); }
  showEnd(winnerLabel, score, playerWon) {
    $('end-title').textContent = playerWon ? 'VITÓRIA' : 'DERROTA';
    $('end-title').style.color = playerWon ? 'var(--accent)' : 'var(--danger)';
    $('end-score').innerHTML = `<span style="color:var(--attack)">${score.attack}</span> <span style="color:var(--muted)">×</span> <span style="color:var(--defend)">${score.defend}</span><div style="font-size:14px;letter-spacing:.2em;color:var(--muted);margin-top:6px">${winnerLabel} venceram a partida</div>`;
    this.show('menu-end');
  }
  setLoading(fraction, text) {
    $('loading-bar').firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
    if (text) $('loading-text').textContent = text;
  }

  // ------------------------------------------------------------------ configurações

  /** Abas visíveis: a de toque só aparece no celular. */
  _schema() {
    return document.body.classList.contains('touch') ? [...SCHEMA, TOUCH_SECTION] : SCHEMA;
  }

  showSettings(from) {
    this.returnTo = from;
    this.show('menu-settings');
    this._renderSettings();
  }

  _renderSettings() {
    const root = $('menu-settings');
    const data = this.settings.data;
    root.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel settings';
    panel.innerHTML = `<h2>CONFIGURAÇÕES</h2><div class="tabs">${this._schema().map((t) => `<div class="tab ${t.id === this.tab ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>`).join('')}</div><div id="set-body"></div>
      <div class="foot"><button class="btn small" id="set-reset">RESTAURAR ESTA ABA</button><button class="btn small primary" id="set-back">VOLTAR</button></div>`;
    root.appendChild(panel);
    panel.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { this.tab = t.dataset.tab; this._renderSettings(); }));
    panel.querySelector('#set-back').onclick = () => { this.cb.onUiSound && this.cb.onUiSound('ui_click'); this.show(this.returnTo); };
    panel.querySelector('#set-reset').onclick = () => { this.settings.reset(this.tab); this.cb.onSettingsChanged(this.tab, null); this._renderSettings(); };

    const section = this._schema().find((t) => t.id === this.tab) || SCHEMA[0];
    const body = panel.querySelector('#set-body');
    let preview = null;
    if (section.preview) {
      body.insertAdjacentHTML('beforeend', '<div class="ch-preview"><div class="crosshair crosshair-preview" id="crosshair-preview"></div></div>');
      preview = new Crosshair(body.querySelector('#crosshair-preview'));
      preview.applySettings(data.crosshair);
    }
    for (const row of section.rows) {
      const cur = data[section.id][row.k];
      const div = document.createElement('div');
      div.className = 'set-row';
      const label = document.createElement('span');
      label.textContent = row.label;
      div.appendChild(label);
      let input; const valEl = document.createElement('span');
      valEl.className = 'val';
      const commit = (value) => {
        this.settings.update((d) => { d[section.id][row.k] = value; });
        if (row.type === 'range') valEl.textContent = row.fmt(this.settings.data[section.id][row.k]);
        if (preview) preview.applySettings(this.settings.data.crosshair);
        if (row.k === 'fullscreen') this._applyFullscreen(value);
        this.cb.onSettingsChanged(section.id, row.k);
      };
      if (row.type === 'select') {
        input = document.createElement('select');
        input.innerHTML = row.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        input.value = String(cur);
        input.onchange = () => commit(input.value);
      } else if (row.type === 'bool') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!cur;
        input.onchange = () => commit(input.checked);
      } else if (row.type === 'color') {
        input = document.createElement('input');
        input.type = 'color';
        input.value = cur;
        input.oninput = () => commit(input.value);
      } else {
        input = document.createElement('input');
        input.type = 'range';
        input.min = row.min; input.max = row.max; input.step = row.step;
        input.value = cur;
        valEl.textContent = row.fmt(cur);
        input.oninput = () => commit(Number(input.value));
      }
      div.appendChild(input);
      div.appendChild(valEl);
      body.appendChild(div);
      if (row.note) { const n = document.createElement('div'); n.className = 'set-note'; n.textContent = row.note; body.appendChild(n); }
    }
  }

  _applyFullscreen(on) {
    try {
      if (on && !document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      else if (!on && document.fullscreenElement) document.exitFullscreen();
    } catch { /* o navegador pode recusar sem gesto */ }
  }

  // ------------------------------------------------------------------ controles

  showControls(from) {
    this.returnTo = from;
    const root = $('menu-controls');
    if (document.body.classList.contains('touch')) {
      const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
      root.innerHTML = `<div class="panel settings"><h2>CONTROLES (TOQUE)</h2><table class="keys">
        ${row('Lado esquerdo', 'joystick: <b>mover</b> (empurre até o fim para <b>correr</b>)')}
        ${row('Lado direito', 'arraste para <b>olhar</b>')}
        ${row('TIRO', 'segure para atirar — arraste o dedo em cima dele para mirar e atirar juntos')}
        ${row('MIRAR', 'segure para dar zoom (mais preciso, mais lento)')}
        ${row('PULAR · AGACHAR', 'toque (agachar liga/desliga)')}
        ${row('RECAR. · ARMA · GRANADA', 'recarrega · troca de arma · joga a granada escolhida')}
        ${row('Ícones embaixo', 'toque em <b>1 / 2 / 3</b> para a arma e em <b>FRAG / CEGA / FUMA</b> para a granada')}
        ${row('USAR', 'aparece perto do sítio (plantar) ou da carga (desarmar): segure')}
        ${row('PLACAR · EQUIP.', 'segure para ver o placar · escolha a arma na preparação')}
      </table><div class="foot"><span></span><button class="btn small primary" id="ctl-back">VOLTAR</button></div></div>`;
      root.querySelector('#ctl-back').onclick = () => { this.cb.onUiSound && this.cb.onUiSound('ui_click'); this.show(this.returnTo); };
      this.show('menu-controls');
      return;
    }
    const b = this.settings.data.controls;
    const rows = Object.entries(ACTION_LABELS).filter(([k]) => b[k]).map(([k, label]) => `<tr><td>${label}</td><td>${b[k].map((c) => `<kbd>${prettyKey(c)}</kbd>`).join('')}</td></tr>`).join('');
    root.innerHTML = `<div class="panel settings"><h2>CONTROLES</h2><table class="keys">${rows}<tr><td>Pausar / menu</td><td><kbd>Esc</kbd></td></tr><tr><td>Roda do mouse</td><td>trocar de arma</td></tr></table>
      <div class="set-note touch-hide">Os atalhos são lidos de uma tabela de ações — pronto para remapeamento futuro. Dica: Ctrl+W fecha a aba do navegador; use <kbd>C</kbd> para agachar sem risco.</div>
      <div class="foot"><span></span><button class="btn small primary" id="ctl-back">VOLTAR</button></div></div>`;
    root.querySelector('#ctl-back').onclick = () => { this.cb.onUiSound && this.cb.onUiSound('ui_click'); this.show(this.returnTo); };
    this.show('menu-controls');
  }

  // ------------------------------------------------------------------ equipamento

  showLoadout() {
    const root = $('menu-loadout');
    const selected = this.settings.data.gameplay.primary;
    const norm = (v, max) => Math.min(100, (v / max) * 100);
    const cards = PRIMARY_CHOICES.map((id) => {
      const d = WEAPONS[id];
      return `<div class="card ${id === selected ? 'sel' : ''}" data-id="${id}"><h4>${d.name}</h4>
        <div class="stat">DANO<b><i style="width:${norm(d.damage * d.pellets * (d.pellets > 1 ? 0.5 : 1), 60)}%"></i></b></div>
        <div class="stat">CADÊNCIA<b><i style="width:${norm(1 / d.fireInterval, 15)}%"></i></b></div>
        <div class="stat">ALCANCE<b><i style="width:${norm(d.range, 220)}%"></i></b></div>
        <div class="stat">MOBILIDADE<b><i style="width:${norm(d.moveSpeedMul - 0.85, 0.15)}%"></i></b></div>
        <div class="stat">PENTE<b><i style="width:${norm(d.magSize, 35)}%"></i></b></div></div>`;
    }).join('');
    root.innerHTML = `<div class="panel"><h2>EQUIPAMENTO</h2><div class="cards">${cards}</div><div class="set-note">Escolha a arma primária. A troca vale na hora durante a preparação e no próximo round.</div>
      <div class="foot"><span></span><button class="btn small primary" id="lo-close">FECHAR</button></div></div>`;
    root.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => {
      this.settings.update((d) => { d.gameplay.primary = c.dataset.id; });
      if (this.cb.onUiSound) this.cb.onUiSound('ui_click');
      this.cb.onLoadout(c.dataset.id);
      this.showLoadout();
    }));
    root.querySelector('#lo-close').onclick = () => this.cb.onResume();
    this.show('menu-loadout');
  }
}
