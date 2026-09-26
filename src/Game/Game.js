// Controlador do jogo no navegador: liga simulação ↔ renderização ↔ áudio ↔ HUD ↔ menus.
// Loop com passo fixo (120 Hz) + interpolação; olhar aplicado por frame (sem input lag perceptível).
import * as THREE from 'three';
import { TEAM, TEAM_LABEL } from '../Config/MatchRules.js';
import { Settings } from '../Config/Settings.js';
import { SIM } from '../Config/Tuning.js';
import { surfaceOf } from '../Config/Surfaces.js';
import { WEAPONS } from '../Config/WeaponDefs.js';
import { AudioEngine } from '../Audio/AudioEngine.js';
import { PlayerCamera } from '../Player/PlayerCamera.js';
import { CharacterView } from '../Render/CharacterView.js';
import { DebugDraw } from '../Render/DebugDraw.js';
import { Effects } from '../Render/Effects.js';
import { MapRenderer } from '../Render/MapRenderer.js';
import { MaterialLibrary } from '../Render/Materials.js';
import { SceneManager } from '../Render/SceneManager.js';
import { ViewModel } from '../Render/ViewModel.js';
import { Input } from '../Systems/Input.js';
import { DebugOverlay } from '../UI/DebugOverlay.js';
import { HUD } from '../UI/HUD.js';
import { Menus } from '../UI/Menus.js';
import { Scoreboard } from '../UI/Scoreboard.js';
import { buildMap } from '../World/MapBuilder.js';
import { FORJA } from '../World/maps/Forja.js';
import { NavGrid } from '../World/NavGrid.js';
import { createGame } from './MatchSetup.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const REASONS = {
  eliminated: 'Todos os adversários foram eliminados',
  time: 'Tempo esgotado',
  exploded: 'A carga detonou',
  defused: 'A carga foi desarmada',
};

export class Game {
  constructor(query) {
    this.query = query;
    this.settings = new Settings();
    this.state = 'loading';
    this.session = null;
    this.match = null;
    this.player = null;
    this.views = new Map();
    this.opts = null;
    this.acc = 0;
    this.lastT = 0;
    this.fps = 60;
    this.tickMs = 0;
    this.cpuMs = 0;
    this.shake = 0;
    this.menuT = 0;
    this.spectate = null;
    this.snap = {};
    this.look = { dx: 0, dy: 0 };
    this.sfxThrottle = { impact: 0 };
    this.lastCountdown = -1;
    this.cameraPose = null;
    this.hurtCooldown = new Map();
  }

  // ------------------------------------------------------------------ inicialização

  async boot() {
    const menusLoading = (f, t) => { $('loading-bar').firstElementChild.style.width = `${Math.round(f * 100)}%`; $('loading-text').textContent = t; };
    const canvas = $('game');
    menusLoading(0.05, 'Iniciando renderizador…');
    await nextFrame();
    const s = this.settings;
    this.sm = new SceneManager(canvas, s.data.video);
    menusLoading(0.2, 'Gerando texturas…');
    await nextFrame();
    this.materials = new MaterialLibrary(Math.min(8, this.sm.renderer.capabilities.getMaxAnisotropy()));
    menusLoading(0.4, 'Construindo o mapa…');
    await nextFrame();
    this.built = buildMap(FORJA);
    this.mapRenderer = new MapRenderer(this.built, this.materials);
    this.sm.scene.add(this.mapRenderer.group);
    this.sm.setMapLights(FORJA.lights);
    menusLoading(0.65, 'Gerando malha de navegação…');
    await nextFrame();
    const seeds = [...FORJA.spawns.attack, ...FORJA.spawns.defend, ...Object.values(FORJA.sites)];
    this.nav = new NavGrid(this.built.world, FORJA.bounds).build(seeds);
    menusLoading(0.85, 'Preparando interface e áudio…');
    await nextFrame();

    this.input = new Input(canvas, () => this.settings.data.controls);
    this.input.rawInput = s.data.mouse.rawInput;
    this.input.onLockChange = (locked) => this._onLockChange(locked);
    this.input.onAction = (a, down) => this._onAction(a, down);
    this.audio = new AudioEngine();
    this.hud = new HUD();
    this.hud.crosshair.applySettings(s.data.crosshair);
    this.scoreboard = new Scoreboard($('scoreboard'));
    this.debug = new DebugOverlay($('debug'));
    this.debugDraw = new DebugDraw(this.sm.scene);
    this.viewModel = new ViewModel(this.sm);
    this.camera = new PlayerCamera();
    this.effects = new Effects(this.sm, (shooter, out) => this._muzzleWorld(shooter, out));
    this.menus = new Menus(s, {
      onPlay: (o) => this.startMatch(o, true),
      onResume: () => this.resume(),
      onRestart: () => this.startMatch(this.opts, true),
      onQuit: () => this.toMenu(),
      onPlayAgain: () => this.startMatch(this.opts, true),
      onLoadout: (id) => this._applyLoadout(id),
      onSettingsChanged: (sec, key) => this._settingsChanged(sec, key),
      onUiSound: (n) => { this.audio.init().then(() => { this.audio.ui(n, 0.5); if (this.state === 'menu') this.audio.startMusic(); }); },
    });
    s.onChange(() => {});
    canvas.addEventListener('click', () => { if (this.state === 'paused-lock') this.resume(); });
    $('click-to-play').addEventListener('click', () => this.resume());

    menusLoading(1, 'Pronto');
    window.addEventListener('error', (e) => this._fatal(e.error || e.message));
    window.addEventListener('unhandledrejection', (e) => this._fatal(e.reason));
    await nextFrame();
    $('loading').classList.add('hidden');

    requestAnimationFrame((t) => { this.lastT = t; this._frame(t); });

    if (this.query.get('autostart')) {
      await this.startMatch({
        side: this.query.get('side') || s.data.gameplay.playerSide,
        difficulty: this.query.get('difficulty') || s.data.gameplay.difficulty,
        teamSize: Number(this.query.get('size') || s.data.gameplay.teamSize),
        seed: Number(this.query.get('seed') || 0) || undefined,
      }, false);
    } else {
      this.toMenu();
    }
  }

  _fatal(err) {
    const el = $('fatal');
    el.classList.remove('hidden');
    el.textContent = `Erro fatal:\n${err && err.stack ? err.stack : err}`;
    console.error(err);
  }

  // ------------------------------------------------------------------ partida

  async startMatch(opts, lockPointer = true) {
    this.opts = opts;
    this._disposeMatch();
    await this.audio.init().catch(() => {});
    const g = this.settings.data.gameplay;
    const game = createGame({
      playerSide: opts.side || g.playerSide,
      teamSize: opts.teamSize || g.teamSize,
      difficulty: opts.difficulty || g.difficulty,
      roundsToWin: g.roundsToWin,
      primary: g.primary,
      seed: opts.seed || (Date.now() % 100000),
      prebuiltMap: this.built,
      prebuiltNav: this.nav,
    });
    this.session = game.session;
    this.match = game.match;
    this.player = game.player;
    this.session.mapDef = FORJA;
    this._applyLookSettings();
    this._wireEvents();

    for (const c of this.session.combatants) {
      if (c === this.player) continue;
      const v = new CharacterView(c, this.sm.scene);
      v.setNameTag(c.team === this.player.team);
      this.views.set(c, v);
    }
    this.viewModel.setTeam(this.player.team);
    this.effects.clearRound();
    this.hud.reset();
    this.hud.show(true);
    this.menus.hideAll();
    this.camera.onSpawn();
    this.spectate = null;
    this.acc = 0;
    this.match.start();
    this.audio.startAmbience();
    this.audio.stopMusic();
    if (this.settings.data.video.fullscreen) this._tryFullscreen();
    this.input.enabled = true;
    if (lockPointer && !this.query.get('nolock')) {
      this.state = 'paused-lock';
      const ok = await this.input.lock();
      if (ok) this._enterPlaying();
      else this._showClickToPlay();
    } else {
      // modo de teste/headless: sem pointer lock
      this.input.locked = true;
      this._enterPlaying();
    }
  }

  _enterPlaying() {
    this.state = 'playing';
    this.menus.hideAll();
    $('click-to-play').classList.add('hidden');
    this.input.clearState();
    this.lastT = performance.now();
  }

  _showClickToPlay() {
    this.state = 'paused-lock';
    $('click-to-play').classList.remove('hidden');
  }

  _disposeMatch() {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    if (this.session) this.session.events.clear();
  }

  toMenu() {
    this._disposeMatch();
    this.session = null; this.match = null; this.player = null;
    this.input.unlock();
    this.input.enabled = false;
    this.state = 'menu';
    this.hud.show(false);
    this.viewModel.hide();
    this.effects.clearRound();
    this.audio.stopAmbience();
    if (this.audio.ready) this.audio.startMusic();
    this.menus.showMain();
    $('click-to-play').classList.add('hidden');
    this.scoreboard.show(false);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.menus.showPause();
    this.scoreboard.show(false);
  }

  resume() {
    if (!this.session) return;
    this.menus.hideAll();
    this.input.clearState();
    this.input.lock().then((ok) => {
      if (ok || this.query.get('nolock')) this._enterPlaying();
      else this._showClickToPlay();
    });
  }

  _onLockChange(locked) {
    if (locked) {
      if (this.state === 'paused' || this.state === 'paused-lock') this._enterPlaying();
      return;
    }
    if (this.state === 'playing') this.pause();
  }

  _tryFullscreen() {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => {
          // Bloqueia atalhos do navegador (Ctrl+W etc.) enquanto estiver em tela cheia
          if (navigator.keyboard && navigator.keyboard.lock) {
            navigator.keyboard.lock(['ControlLeft', 'ControlRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyC', 'Tab', 'F3', 'F4']).catch(() => {});
          }
        }).catch(() => {});
      }
    } catch { /* ignorado */ }
  }

  // ------------------------------------------------------------------ ações de UI

  _onAction(action, down) {
    if (!this.session) return;
    if (action === 'debug' && down) this._setDebug(this.debug.level === 0 ? this.debug.lastLevel : 0);
    else if (action === 'debugMode' && down) { this.debug.cycle(); this._setDebug(this.debug.level); }
    else if (action === 'scoreboard') this.scoreboard.show(down);
    else if (action === 'loadout' && down && this.state === 'playing' && this.match.isFreeze) {
      this.state = 'paused';
      this.input.unlock();
      this.menus.showLoadout();
    }
  }

  _setDebug(level) {
    this.debug.setLevel(level);
    this.debugDraw.setLevel(level);
  }

  _applyLoadout(id) {
    if (!this.player || !this.match) return;
    if (this.match.isFreeze) this.player.weapons.setPrimary(id);
  }

  _applyLookSettings() {
    if (!this.player) return;
    const m = this.settings.data.mouse;
    Object.assign(this.player.lookSettings, { sensitivity: m.sensitivity, invertY: m.invertY, aimMultiplier: m.aimMultiplier });
  }

  _settingsChanged(section, key) {
    const s = this.settings.data;
    if (section === 'video' || key === null) {
      this.sm.applyVideo(s.video);
      this.effects.setQuality(this.sm.preset);
      this.mapRenderer.setShadows(this.sm.renderer.shadowMap.enabled);
    }
    if (section === 'mouse' || key === null) { this._applyLookSettings(); this.input.rawInput = s.mouse.rawInput; }
    if (section === 'audio' || key === null) this.audio.setVolumes(s.audio);
    if (section === 'crosshair' || key === null) this.hud.crosshair.applySettings(s.crosshair);
  }

  // ------------------------------------------------------------------ eventos da simulação

  _muzzleWorld(shooter, out) {
    if (shooter === this.player) {
      const pose = this.cameraPose;
      if (!pose) return false;
      // cano do viewmodel: à frente, ligeiramente à direita e abaixo da câmera
      out.set(
        pose.x - Math.sin(pose.yaw) * 0.75 + Math.cos(pose.yaw) * 0.16,
        pose.y - 0.14,
        pose.z - Math.cos(pose.yaw) * 0.75 - Math.sin(pose.yaw) * 0.16,
      );
      return true;
    }
    const v = this.views.get(shooter);
    if (v) { v.getMuzzleWorld(out); return true; }
    return false;
  }

  _listener() {
    return this.cameraPose || { x: 0, y: 0, z: 0 };
  }

  /** Toca um som no mundo com oclusão por paredes. `who` = origem (para decidir se é o jogador). */
  _sfx(name, x, y, z, o = {}) {
    if (!this.audio.ready) return;
    const L = this._listener();
    const d = Math.hypot(x - L.x, y - L.y, z - L.z);
    let occlusion = 0;
    if (d > 4 && this.session && this.session.world.isBlocked(L.x, L.y, L.z, x, y, z)) occlusion = 0.85;
    this.audio.play(name, { x, y, z, positional: true, occlusion, ...o });
  }

  _own(name, o = {}) {
    if (this.audio.ready) this.audio.play(name, { positional: false, ...o });
  }

  _wireEvents() {
    const ev = this.session.events;
    const me = () => this.player;
    const isMe = (c) => c === this.player;

    ev.on('bulletTrace', (e) => {
      this.effects.onTrace(e);
      if (this.debug.level >= 2) this.debugDraw.addRay(e.fromX, e.fromY, e.fromZ, e.toX, e.toY, e.toZ, isMe(e.shooter) ? 0xffff66 : 0xff8844);
    });
    ev.on('bulletImpact', (e) => {
      this.effects.onImpact(e);
      const now = performance.now();
      if (now - this.sfxThrottle.impact > 35 && !e.exit) {
        this.sfxThrottle.impact = now;
        this._sfx(`impact_${surfaceOf(e.surface).impact}`, e.x, e.y, e.z, { volume: 0.55, priority: 0 });
      }
    });
    ev.on('bulletHit', (e) => {
      this.effects.onBodyHit(e);
      const v = this.views.get(e.victim);
      if (v) v.onHit();
      if (isMe(e.shooter)) {
        this.hud.hitMarker(e.part === 'head' ? 'head' : '');
        this._own(e.part === 'head' ? 'hit_head' : 'hit_marker', { volume: 0.7, priority: 3 });
      }
    });
    ev.on('weaponFired', (e) => {
      const def = e.def;
      const o = e.owner;
      if (isMe(o)) {
        this.viewModel.onFired();
        this._own(def.sfx.fire, { volume: 0.9, priority: 3 });
        const p = this.cameraPose;
        if (p) this.effects.muzzleLight(p.x - Math.sin(p.yaw) * 0.8, p.y - 0.1, p.z - Math.cos(p.yaw) * 0.8);
      } else {
        const v = this.views.get(o);
        if (v) v.onFired();
        this._sfx(def.sfx.fire, o.pos.x, o.pos.y + 1.4, o.pos.z, { volume: 1, distanceScale: def.shotLoudness / 55, priority: 2 });
      }
    });
    ev.on('damage', (e) => {
      if (isMe(e.victim)) {
        this.hud.damageFrom(e.attacker);
        this._own('hurt', { volume: 0.7, priority: 3 });
        this.shake = Math.min(1, this.shake + Math.min(0.6, e.dealt / 60));
      } else {
        const last = this.hurtCooldown.get(e.victim) || 0;
        if (performance.now() - last > 350 && e.victim.alive) {
          this.hurtCooldown.set(e.victim, performance.now());
          this._sfx('hurt', e.victim.pos.x, e.victim.pos.y + 1.2, e.victim.pos.z, { volume: 0.5 });
        }
      }
    });
    ev.on('death', (e) => {
      this.hud.pushKill(e, this.player.team);
      this._sfx('death', e.victim.pos.x, e.victim.pos.y + 1, e.victim.pos.z, { volume: 0.8, priority: 2 });
      if (e.killer && isMe(e.killer) && e.victim !== this.player) this.hud.hitMarker('kill');
      if (isMe(e.victim)) {
        this.camera.deathT = 0;
        this.camera.deathSide = Math.random() < 0.5 ? -1 : 1;
        this.spectate = null;
      }
    });
    ev.on('reloadStart', (e) => {
      const n = e.def.sfx.reload;
      if (isMe(e.owner)) this._own(n, { volume: 0.7 });
      else this._sfx(n, e.owner.pos.x, e.owner.pos.y + 1, e.owner.pos.z, { volume: 0.5 });
    });
    ev.on('reloadShell', (e) => { if (isMe(e.owner)) this._own('reload_shell', { volume: 0.7 }); });
    ev.on('weaponPump', (e) => {
      if (isMe(e.owner)) this._own('shotgun_pump', { volume: 0.7 });
      else this._sfx('shotgun_pump', e.owner.pos.x, e.owner.pos.y + 1, e.owner.pos.z, { volume: 0.6 });
    });
    ev.on('weaponEquip', (e) => {
      const n = e.def.sfx.equip || 'equip_light';
      if (isMe(e.owner)) this._own(n, { volume: 0.55 });
      else this._sfx(n, e.owner.pos.x, e.owner.pos.y + 1, e.owner.pos.z, { volume: 0.35, priority: 0 });
    });
    ev.on('dryFire', (e) => { if (isMe(e.owner)) this._own('dry_click', { volume: 0.7 }); });
    ev.on('meleeSwing', (e) => {
      if (isMe(e.owner)) { this.viewModel.onMeleeSwing(e.alt); this._own('knife_swing', { volume: 0.7 }); }
      else this._sfx('knife_swing', e.owner.pos.x, e.owner.pos.y + 1, e.owner.pos.z, { volume: 0.6 });
    });
    ev.on('meleeHit', (e) => {
      this.effects.onBodyHit({ x: e.x, y: e.y, z: e.z, dx: 0, dz: 0, part: 'torso' });
      this._sfx('knife_hit', e.x, e.y, e.z, { volume: 0.9 });
      if (isMe(e.shooter)) this.hud.hitMarker(e.backstab ? 'head' : '');
    });
    ev.on('meleeWall', (e) => this._sfx('impact_metal', e.x, e.y, e.z, { volume: 0.5 }));
    ev.on('footstep', (e) => {
      const name = `step_${surfaceOf(e.surface).step}`;
      if (isMe(e.who)) this._own(name, { volume: e.running ? 0.32 : 0.2, priority: 0 });
      else this._sfx(name, e.x, e.y + 0.1, e.z, { volume: e.running ? 0.95 : 0.6, priority: 0 });
    });
    ev.on('jump', (e) => {
      if (isMe(e.who)) this._own('jump', { volume: 0.4, priority: 0 });
      else this._sfx('jump', e.who.pos.x, e.who.pos.y, e.who.pos.z, { volume: 0.4, priority: 0 });
    });
    ev.on('land', (e) => {
      if (isMe(e.who)) {
        this._own('land', { volume: Math.min(1, 0.3 + e.impact / 14), priority: 2 });
        this.camera.onLand(e.impact, this.settings.data.gameplay.cameraEffects);
      } else this._sfx('land', e.who.pos.x, e.who.pos.y, e.who.pos.z, { volume: Math.min(1, 0.3 + e.impact / 14) });
    });
    ev.on('grenadePrime', (e) => { if (isMe(e.owner)) this._own('grenade_pin', { volume: 0.6 }); });
    ev.on('grenadeThrown', (e) => { if (isMe(e.owner)) this.viewModel.onGrenadeThrown(); });
    ev.on('grenadeBounce', (e) => this._sfx('grenade_bounce', e.grenade.x, e.grenade.y, e.grenade.z, { volume: 0.7 }));
    ev.on('grenadeDetonate', (e) => {
      if (e.kind === 'frag') {
        this.effects.onExplosion(e.x, e.y, e.z);
        this._sfx('explosion', e.x, e.y, e.z, { volume: 1.2, distanceScale: 4, priority: 3 });
        const L = this._listener();
        this.shake = Math.min(1, this.shake + Math.max(0, 1 - Math.hypot(e.x - L.x, e.z - L.z) / 25));
      } else if (e.kind === 'flash') {
        this._sfx('flash_bang', e.x, e.y, e.z, { volume: 1, distanceScale: 3, priority: 3 });
        this.effects.burst(e.x, e.y, e.z, 0, 1, 0, 0xfff2c0, 14, 4, 0.5, 2);
      } else {
        this._sfx('smoke_pop', e.x, e.y, e.z, { volume: 0.9 });
      }
    });
    ev.on('flashed', (e) => {
      if (isMe(e.victim)) {
        this._own('flash_ring', { volume: Math.min(1, e.seconds / 3), priority: 3 });
        this.audio.duck(0.3, e.seconds * 0.8);
      }
    });

    // ---- partida
    ev.on('roundStart', (e) => {
      this.effects.clearRound();
      this.camera.onSpawn();
      this.spectate = null;
      this.hud.reset();
      this.hud.announce(`ROUND ${e.round}`, this.player.team === TEAM.ATTACK ? 'Você ataca — plante a carga' : 'Você defende — impeça a plantação', this.player.team === TEAM.ATTACK ? 'attack' : 'defend');
      this._own('round_start', { volume: 0.6, priority: 3 });
      this.lastCountdown = -1;
    });
    ev.on('roundLive', () => {
      this.hud.announce('VALENDO', '', 'win', 1100);
      this.effects.clearRound();
    });
    ev.on('roundEnd', (e) => {
      const won = e.winner === this.player.team;
      this.hud.announce(won ? 'ROUND VENCIDO' : 'ROUND PERDIDO', REASONS[e.reason] || '', won ? 'win' : 'lose', 3800);
      this._own(won ? 'round_win' : 'round_lose', { volume: 0.7, priority: 3 });
    });
    ev.on('bombPlanted', (e) => {
      this.effects.plantBomb(e.x, e.y, e.z);
      const atk = this.player.team === TEAM.ATTACK;
      this.hud.announce('CARGA PLANTADA', atk ? `Sítio ${e.site} — proteja a carga` : `Sítio ${e.site} — desarme!`, atk ? 'attack' : 'defend');
      this._own('bomb_planted', { volume: 0.8, priority: 3 });
    });
    ev.on('bombBeep', (e) => {
      this.effects.beepBomb();
      this._sfx('bomb_beep', e.x, e.y + 0.3, e.z, { volume: 0.8, distanceScale: 2.5, priority: 1 });
    });
    ev.on('bombDefused', () => {
      this.effects.removeBomb();
      this.hud.announce('CARGA DESARMADA', '', 'defend');
      this._own('bomb_defused', { volume: 0.8, priority: 3 });
    });
    ev.on('bombExploded', (e) => {
      this.effects.removeBomb();
      this.effects.onExplosion(e.x, e.y, e.z, 14);
      this._sfx('explosion', e.x, e.y, e.z, { volume: 1.4, distanceScale: 6, priority: 3 });
      this.shake = 1;
    });
    ev.on('matchEnd', (e) => {
      const won = e.winner === this.player.team;
      this.state = 'ended';
      this.input.unlock();
      this.menus.showEnd(TEAM_LABEL[e.winner], e.score, won);
    });
  }

  // ------------------------------------------------------------------ loop

  _frame(t) {
    requestAnimationFrame((tt) => this._frame(tt));
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;
    this.fps += (1 / dt - this.fps) * Math.min(1, dt * 2);
    this.debug.pushFrame(dt * 1000);
    const cpu0 = performance.now();
    try {
      if (this.session && (this.state === 'playing' || this.state === 'paused' || this.state === 'paused-lock' || this.state === 'ended')) this._frameGame(dt);
      else this._frameMenu(dt);
    } catch (err) {
      this._fatal(err);
    }
    this.cpuMs += (performance.now() - cpu0 - this.cpuMs) * 0.05;
  }

  _frameMenu(dt) {
    this.menuT += dt * 0.08;
    const R = 34;
    const pose = { x: Math.cos(this.menuT) * R, y: 9 + Math.sin(this.menuT * 0.7) * 2, z: Math.sin(this.menuT) * R * 0.7, yaw: 0, pitch: -0.32, roll: 0, fovV: 60 };
    pose.yaw = Math.atan2(-(0 - pose.x), -(0 - pose.z));
    this.viewModel.hide();
    this.sm.render(pose, dt, false);
  }

  _frameGame(dt) {
    const session = this.session, match = this.match, player = this.player;
    const playing = this.state === 'playing';
    const s = this.settings.data;

    if (playing) {
      this.input.takeLook(this.look);
      if (player.alive) player.applyLook(this.look.dx, this.look.dy);
      this.input.snapshot(this.snap);
      if (player.alive) player.applyInput(this.snap);
      else if (this.snap.fire && !this._fireWasDown) this._cycleSpectate(1);
      this._fireWasDown = !!this.snap.fire;

      this.acc += dt;
      const tick = 1 / SIM.TICK_RATE;
      let steps = 0;
      const t0 = performance.now();
      while (this.acc >= tick && steps < SIM.MAX_STEPS_PER_FRAME) {
        session.step(tick);
        this.acc -= tick;
        steps++;
      }
      if (steps >= SIM.MAX_STEPS_PER_FRAME) this.acc = 0;
      if (steps > 0) this.tickMs += ((performance.now() - t0) / steps - this.tickMs) * 0.1;

      // contagem regressiva da preparação
      if (match.isFreeze) {
        const c = Math.ceil(match.clock);
        if (c <= 3 && c !== this.lastCountdown && c > 0) { this.lastCountdown = c; this._own('countdown', { volume: 0.5 }); }
      }
    }
    const alpha = this.acc * SIM.TICK_RATE;

    // câmera
    const cam = this.camera;
    let pose;
    let target = null;
    if (player.alive) {
      pose = cam.updateFirstPerson(dt, alpha, player, { fov: s.video.fov, headBob: s.gameplay.headBob, headBobAmount: s.gameplay.headBobAmount, cameraEffects: s.gameplay.cameraEffects });
    } else {
      if (!this.spectate || !this.spectate.alive) this.spectate = this._pickSpectate();
      const deadFor = session.time - player.deathTime;
      if (this.spectate && deadFor > 1.6) {
        target = this.spectate;
        pose = cam.updateSpectate(dt, alpha, this.spectate, s.video.fov);
      } else {
        pose = cam.updateDead(dt, player, player.deathInfo ? player.deathInfo.killer : null);
      }
    }
    if (this.shake > 0.001) {
      const k = this.shake * 0.02 * s.gameplay.cameraEffects;
      pose = { ...pose, pitch: pose.pitch + (Math.random() - 0.5) * k, yaw: pose.yaw + (Math.random() - 0.5) * k, roll: pose.roll + (Math.random() - 0.5) * k * 1.5 };
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    this.cameraPose = pose;

    // views, efeitos
    for (const [c, v] of this.views) {
      v.setVisible(c !== target);        // não desenha o corpo de quem estamos espectando (câmera dentro da cabeça)
      v.update(dt, alpha, this.player.team);
    }
    this.viewModel.update(dt, player, player.alive && !target);
    this.effects.update(dt, session);
    this.debugDraw.update(dt, session);

    // áudio
    this.audio.setListener(pose.x, pose.y, pose.z, pose.yaw, pose.pitch);

    // smoke overlay: dentro de fumaça a tela fica branca
    let smokeAlpha = 0;
    for (const sm of session.world.smokes) {
      const d = Math.hypot(pose.x - sm.x, pose.y - sm.y, pose.z - sm.z);
      const inner = sm.radius * 0.85;
      if (d < inner) smokeAlpha = Math.max(smokeAlpha, 0.96 * (1 - d / inner * 0.5));
    }

    // HUD
    this.hud.update({
      dt, match, session, player, pose, settings: s, target, controls: s.controls,
      fpsText: `${this.fps.toFixed(0)} FPS`, smokeAlpha,
    });
    this.scoreboard.update(dt, session, match, player);
    this.debug.update(dt, { session, player, match, renderInfo: this.sm.renderInfo, tickMs: this.tickMs, cpuMs: this.cpuMs, fps: this.fps });

    this.sm.render(pose, dt, this.viewModel.root.visible);
    this._updateWaypoints(pose);
  }

  _updateWaypoints(pose) {
    const hud = this.hud, match = this.match;
    const cam = this.sm.camera;
    const v = this._wpVec || (this._wpVec = new THREE.Vector3());
    const show = (key, label, cls, x, y, z) => {
      v.set(x, y, z).project(cam);
      const dist = Math.hypot(x - pose.x, y - pose.y, z - pose.z);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) { hud.setWaypoint(key, label, cls, null); return; }
      hud.setWaypoint(key, label, cls, { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight }, dist);
    };
    const active = match.isFreeze || match.isLive;
    const b = match.bomb;
    for (const site of Object.values(this.session.map.sites)) {
      const hide = !active || (b.planted && b.site !== site.name);
      if (hide || (b.planted && b.site === site.name)) hud.setWaypoint(site.name, site.name, 'site', null);
      else show(site.name, site.name, 'site', site.x, 2.3, site.z);
    }
    if (b.planted && !b.defused && active) show('bomb', 'CARGA', 'bomb', b.x, b.y + 0.9, b.z);
    else hud.setWaypoint('bomb', '', 'bomb', null);
  }

  _pickSpectate() {
    const mates = this.session.combatants.filter((c) => c.alive && c.team === this.player.team && c !== this.player);
    return mates[0] || null;
  }

  _cycleSpectate(dir) {
    const mates = this.session.combatants.filter((c) => c.alive && c.team === this.player.team && c !== this.player);
    if (!mates.length) return;
    const i = Math.max(0, mates.indexOf(this.spectate));
    this.spectate = mates[(i + dir + mates.length) % mates.length];
  }

  /** Hooks para testes E2E. */
  api() {
    return {
      game: this,
      get session() { return this.game.session; },
      get player() { return this.game.player; },
      teleport: (x, z, yaw = 0) => { const p = this.player; p.body.teleport(x, 0, z); p.view.yaw = yaw; p.view.pitch = 0; },
      look: (dx, dy) => { this.input.mouseDX += dx; this.input.mouseDY += dy; },
      /** Avança a simulação sem renderizar (testes): segundos de tempo de jogo. */
      advance: (sec) => { const n = Math.round(sec * SIM.TICK_RATE); for (let i = 0; i < n; i++) this.session.step(1 / SIM.TICK_RATE); },
      aimAt: (x, y, z) => {
        const p = this.player, e = p.eyeArray();
        const dx = x - e[0], dy = y - e[1], dz = z - e[2];
        p.view.yaw = Math.atan2(-dx, -dz);
        p.view.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      },
      state: () => this.state,
    };
  }
}

export { THREE, WEAPONS };
