// HUD em DOM: vida/colete, munição/arma, placar e relógio, objetivo, kill feed, indicador de dano,
// hit marker, companheiros, interação (plantar/desarmar), mensagens centrais e painel de morte.
import { MATCH_RULES, TEAM } from '../Config/MatchRules.js';
import { WEAPONS } from '../Config/WeaponDefs.js';
import { prettyKey } from '../Config/Controls.js';
import { Crosshair } from './Crosshair.js';

const $ = (id) => document.getElementById(id);

function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      fps: $('fps'), scoreA: $('score-attack'), scoreD: $('score-defend'), aliveA: $('alive-attack'), aliveD: $('alive-defend'),
      clock: $('clock'), round: $('round-label'), objective: $('objective'), killfeed: $('killfeed'), mates: $('teammates'),
      announce: $('announce'), interact: $('interact'), interactText: $('interact-text'), interactBar: $('interact-bar').firstElementChild,
      hit: $('hitmarker'), dmg: $('dmg-indicators'), vDamage: $('vignette-damage'), vLow: $('vignette-low'),
      flash: $('overlay-flash'), smoke: $('overlay-smoke'),
      hpNum: $('hp-num'), hpBar: $('hp-bar'), arNum: $('ar-num'), arBar: $('ar-bar'), hpBox: document.querySelector('.vital.hp'),
      wName: $('weapon-name'), ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-reserve'), reload: $('reload-bar'),
      grenades: $('grenades'), slots: $('slots'),
      death: $('death-panel'), dpKiller: $('dp-killer'), dpDetail: $('dp-detail'), dpSpec: $('dp-spectate'),
      loadoutHint: $('loadout-hint'),
      waypoints: $('waypoints'),
    };
    this.wps = new Map();
    this.crosshair = new Crosshair($('crosshair'));
    this.cache = {};
    this.arcs = [];
    this.mateEls = new Map();
    this.kills = [];
    this.announceTimer = 0;
    this.hitTimer = 0;
    this.vDamage = 0;
    this.lastAliveKey = '';
    this.interactShow = false;
    this.useLabel = 'USAR';
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  reset() {
    this.el.killfeed.innerHTML = '';
    this.el.dmg.innerHTML = '';
    this.arcs.length = 0;
    this.el.mates.innerHTML = '';
    this.mateEls.clear();
    this.cache = {};
    this.vDamage = 0;
    this.el.death.classList.add('hidden');
    this.el.announce.classList.remove('show');
  }

  _set(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  // ------------------------------------------------------------------ eventos

  announce(main, sub = '', cls = '', ms = MATCH_RULES.ANNOUNCE_TIME * 1000) {
    const a = this.el.announce;
    a.className = `show ${cls}`;
    a.innerHTML = `<div class="a-main">${main}</div>${sub ? `<div class="a-sub">${sub}</div>` : ''}`;
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => a.classList.remove('show'), ms);
  }

  hitMarker(kind) {
    const h = this.el.hit;
    h.className = '';
    void h.offsetWidth;
    h.className = `hit ${kind || ''}`;
  }

  pushKill(e, localTeam) {
    const div = document.createElement('div');
    const kt = e.killer ? (e.killer.team === TEAM.ATTACK ? 'atk' : 'def') : 'def';
    const vt = e.victim.team === TEAM.ATTACK ? 'atk' : 'def';
    const w = e.weaponId && WEAPONS[e.weaponId] ? WEAPONS[e.weaponId].short : e.type === 'fall' ? 'QUEDA' : e.type === 'bomb' ? 'CARGA' : '';
    const mine = e.killer && e.killer.isPlayer;
    div.className = `kill${mine ? ' me' : ''}`;
    div.innerHTML = `${e.killer ? `<span class="${kt}">${e.killer.name}</span>` : ''}<span class="wpn">${w}${e.penetrated ? ' ▸' : ''}</span>${e.headshot ? '<span class="hs">◉</span>' : ''}<span class="${vt}">${e.victim.name}</span>`;
    this.el.killfeed.appendChild(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.removeChild(this.el.killfeed.firstChild);
    setTimeout(() => div.remove(), 6500);
    void localTeam;
  }

  damageFrom(attacker) {
    if (!attacker) { this.vDamage = Math.min(1, this.vDamage + 0.5); return; }
    this.vDamage = Math.min(1, this.vDamage + 0.6);
    const el = document.createElement('div');
    el.className = 'dmg-arc';
    this.el.dmg.appendChild(el);
    this.arcs.push({ el, x: attacker.pos.x, z: attacker.pos.z, life: 1.4 });
    if (this.arcs.length > 4) { const old = this.arcs.shift(); old.el.remove(); }
  }

  /** Marcador de objetivo em coordenadas de tela (px).  esconde. */
  setWaypoint(key, label, cls, screen, dist) {
    let w = this.wps.get(key);
    if (!w) {
      const div = document.createElement('div');
      div.innerHTML = '<b></b><span></span>';
      this.el.waypoints.appendChild(div);
      w = { div, b: div.firstChild, s: div.lastChild, label: '', cls: '' };
      this.wps.set(key, w);
    }
    if (!screen) { w.div.style.display = 'none'; return; }
    if (w.label !== label) { w.b.textContent = label; w.label = label; }
    if (w.cls !== cls) { w.div.className = 'wp ' + cls; w.cls = cls; }
    w.s.textContent = dist ? Math.round(dist) + ' m' : '';
    w.div.style.display = 'block';
    w.div.style.transform = 'translate(' + screen.x.toFixed(0) + 'px,' + screen.y.toFixed(0) + 'px) translate(-50%,-50%)';
  }

  // ------------------------------------------------------------------ frame

  /**
   * @param {object} s { dt, match, session, player, pose, settings, target (combatente exibido), fps, controls }
   */
  update(s) {
    const { dt, match, session, player, pose, target } = s;
    const e = this.el;
    const shown = target || player;

    // placar / relógio
    this._set('sa', e.scoreA, 'textContent', String(match.score[TEAM.ATTACK]));
    this._set('sd', e.scoreD, 'textContent', String(match.score[TEAM.DEFEND]));
    const clock = match.clock;
    this._set('clock', e.clock, 'textContent', fmtClock(clock));
    const urgent = (match.bomb.planted && clock <= 10) || (!match.bomb.planted && match.isLive && clock <= 10);
    e.clock.classList.toggle('urgent', urgent);
    this._set('round', e.round, 'textContent', match.bomb.planted ? `CARGA · SÍTIO ${match.bomb.site}` : match.isFreeze ? `PREPARAÇÃO · ROUND ${match.round}` : `ROUND ${match.round}`);
    const alive = (team) => {
      const list = session.combatants.filter((c) => c.team === team);
      return list.map((c) => (c.alive ? '<i></i>' : '<i class="dead"></i>')).join('');
    };
    const key = session.combatants.map((c) => (c.alive ? 1 : 0)).join('');
    if (key !== this.lastAliveKey) {
      this.lastAliveKey = key;
      e.aliveA.innerHTML = alive(TEAM.ATTACK);
      e.aliveD.innerHTML = alive(TEAM.DEFEND);
    }

    this._objective(s);
    this._interact(s);

    // vida / colete
    const hp = Math.ceil(shown.health.current), ar = Math.ceil(shown.armor.current);
    this._set('hp', e.hpNum, 'textContent', String(hp));
    e.hpBar.style.width = `${clamp01(shown.health.fraction) * 100}%`;
    e.hpBox.classList.toggle('low', hp <= 30);
    this._set('ar', e.arNum, 'textContent', String(ar));
    e.arBar.style.width = `${clamp01(shown.armor.current / shown.armor.max) * 100}%`;

    // arma / munição
    this._weapon(shown);

    // efeitos de tela
    this.vDamage = Math.max(0, this.vDamage - dt * 1.1);
    e.vDamage.style.opacity = String(this.vDamage * 0.9);
    const low = shown.alive && hp <= 25 ? 0.35 + 0.25 * Math.sin(performance.now() * 0.008) : 0;
    e.vLow.style.opacity = String(low);
    e.flash.style.opacity = String(target ? 0 : Math.min(1, player.blindAmount * 1.4));
    e.smoke.style.opacity = String(s.smokeAlpha || 0);

    // arcos de dano
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life -= dt;
      if (a.life <= 0) { a.el.remove(); this.arcs.splice(i, 1); continue; }
      const dx = a.x - pose.x, dz = a.z - pose.z;
      const fx = -Math.sin(pose.yaw), fz = -Math.cos(pose.yaw);
      const rx = Math.cos(pose.yaw), rz = -Math.sin(pose.yaw);
      const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) * 180 / Math.PI;
      a.el.style.transform = `rotate(${ang}deg)`;
      a.el.style.opacity = String(Math.min(1, a.life / 0.6));
    }

    this._mates(s);
    this._death(s);
    if (s.settings.video.showFps) this._set('fps', e.fps, 'textContent', s.fpsText || '');
    else this._set('fps', e.fps, 'textContent', '');

    // crosshair
    const w = shown.weapons;
    const showCh = !target && player.alive && !!w.def && w.def.slot !== 'melee' && w.def.slot !== 'grenade';
    this.crosshair.setVisible(!target && player.alive);
    if (showCh) {
      const bloom = w.recoil.bloom;
      const total = w.currentSpread;
      this.crosshair.update(dt, Math.max(0, total - bloom), bloom, pose.fovV);
    } else this.crosshair.update(dt, 0, 0, pose.fovV);
  }

  _objective(s) {
    const { match, player } = s;
    let text = '';
    const atk = player.team === TEAM.ATTACK;
    if (match.phase === 'freeze') text = atk ? 'PREPARAÇÃO · plante a carga no sítio A ou B' : 'PREPARAÇÃO · defenda os sítios A e B';
    else if (match.phase === 'live') {
      if (match.bomb.planted) text = atk ? `PROTEJA A CARGA · SÍTIO ${match.bomb.site}` : `DESARME A CARGA · SÍTIO ${match.bomb.site}`;
      else text = atk ? 'PLANTE A CARGA EM A OU B' : 'IMPEÇA A PLANTAÇÃO DA CARGA';
    } else if (match.phase === 'ended') text = 'FIM DE PARTIDA';
    this._set('obj', this.el.objective, 'textContent', text);
  }

  _interact(s) {
    const { match, player, controls } = s;
    const el = this.el;
    const useKey = prettyKey((controls.use && controls.use[0]) || 'KeyE');
    let text = '', progress = 0, show = false;
    if (match.interaction) {
      show = true;
      progress = match.interaction.progress;
      text = match.interaction.kind === 'plant' ? 'PLANTANDO…' : 'DESARMANDO…';
    } else if (player.alive && match.isLive) {
      if (player.team === TEAM.ATTACK && !match.bomb.planted && match.siteAt(player.pos)) { show = true; text = `SEGURE [${useKey}] PARA PLANTAR`; }
      else if (player.team === TEAM.DEFEND && match.bomb.planted && Math.hypot(player.pos.x - match.bomb.x, player.pos.z - match.bomb.z) <= MATCH_RULES.USE_RADIUS) { show = true; text = `SEGURE [${useKey}] PARA DESARMAR`; }
    }
    this.interactShow = show;
    this.useLabel = match.interaction ? (match.interaction.kind === 'plant' ? 'PLANTANDO' : 'DESARMANDO') : (text.includes('DESARMAR') ? 'DESARMAR' : 'PLANTAR');
    // no toque o botão USAR já diz o que fazer: só mostramos a barra enquanto está plantando/desarmando
    const box = document.body.classList.contains('touch') ? !!match.interaction : show;
    el.interact.classList.toggle('show', box);
    this._set('itxt', el.interactText, 'textContent', text);
    el.interactBar.style.width = `${progress * 100}%`;
  }

  _weapon(shown) {
    const e = this.el;
    const w = shown.weapons;
    const info = w.ammoInfo;
    const def = info.def;
    this._set('wname', e.wName, 'textContent', def ? def.name : '—');
    const isGun = def && def.magSize > 0;
    if (isGun) {
      this._set('mag', e.ammoMag, 'textContent', String(info.ammo));
      this._set('res', e.ammoRes, 'textContent', String(info.reserve));
      e.ammo.style.visibility = 'visible';
      e.ammo.classList.toggle('low', info.ammo <= Math.ceil(info.magSize * 0.2));
    } else if (def && def.slot === 'grenade') {
      this._set('mag', e.ammoMag, 'textContent', String(w.grenades[def.kind]));
      this._set('res', e.ammoRes, 'textContent', '');
      e.ammo.style.visibility = 'visible';
    } else {
      this._set('mag', e.ammoMag, 'textContent', '—');
      this._set('res', e.ammoRes, 'textContent', '');
      e.ammo.style.visibility = 'visible';
    }
    const reloading = w.phase === 'reload';
    e.reload.classList.toggle('show', reloading);
    if (reloading) e.reload.firstElementChild.style.width = `${w.phaseProgress * 100}%`;

    const gk = `${w.grenades.frag}${w.grenades.flash}${w.grenades.smoke}${w.selectedGrenade}${w.activeKey}${!!w.slots.primary}`;
    if (this.cache.gk !== gk) {
      this.cache.gk = gk;
      const names = { frag: 'FRAG', flash: 'CEGA', smoke: 'FUMA' };
      e.grenades.innerHTML = ['frag', 'flash', 'smoke'].map((k) => `<span data-key="${k}" class="gren ${w.grenades[k] > 0 ? 'has' : ''} ${w.selectedGrenade === k && w.grenades[k] > 0 ? 'sel' : ''}">${names[k]} ${w.grenades[k]}</span>`).join('');
      const slot = (key, n, label) => (w.slots[key] ? `<span data-key="${key}" class="slot ${w.activeKey === key ? 'active' : ''}">${n} ${label}</span>` : '');
      e.slots.innerHTML = slot('primary', 1, w.slots.primary ? w.slots.primary.def.short : '') + slot('secondary', 2, w.slots.secondary ? w.slots.secondary.def.short : '') + slot('melee', 3, 'FACA');
    }
  }

  _mates(s) {
    const { session, player } = s;
    const mates = session.combatants.filter((c) => c.team === player.team && c !== player);
    const ids = mates.map((m) => m.id).join(',');
    if (this.cache.mates !== ids) {
      this.cache.mates = ids;
      this.el.mates.innerHTML = '';
      this.mateEls.clear();
      for (const m of mates) {
        const div = document.createElement('div');
        div.className = `mate ${m.team}`;
        div.innerHTML = `<div class="row"><span class="n"></span><span class="wp"></span></div><div class="bar"><i></i></div>`;
        this.el.mates.appendChild(div);
        this.mateEls.set(m, { div, n: div.querySelector('.n'), wp: div.querySelector('.wp'), bar: div.querySelector('.bar i') });
      }
    }
    for (const [m, r] of this.mateEls) {
      r.n.textContent = `${m.name} · ${Math.ceil(m.health.current)}`;
      r.wp.textContent = m.weapons.def ? m.weapons.def.short : '';
      r.bar.style.width = `${clamp01(m.health.fraction) * 100}%`;
      r.div.classList.toggle('dead', !m.alive);
    }
  }

  _death(s) {
    const { player, target } = s;
    const e = this.el;
    const dead = !player.alive;
    e.death.classList.toggle('hidden', !dead);
    if (!dead) return;
    const info = player.deathInfo;
    if (info && this.cache.dk !== player.deathTime) {
      this.cache.dk = player.deathTime;
      const k = info.killer;
      const w = info.weaponId && WEAPONS[info.weaponId] ? WEAPONS[info.weaponId].name : info.type === 'fall' ? 'QUEDA' : info.type === 'bomb' ? 'EXPLOSÃO DA CARGA' : '';
      e.dpKiller.textContent = k ? `Eliminado por ${k.name}` : info.type === 'fall' ? 'Você caiu de muito alto' : 'Você foi eliminado';
      const extras = [w, info.headshot ? 'HEADSHOT' : '', info.penetrated ? 'atravessou parede' : '', info.distance > 1 ? `${info.distance.toFixed(0)} m` : '', k ? `vida restante: ${Math.ceil(k.health.current)}` : ''].filter(Boolean);
      e.dpDetail.textContent = extras.join('  ·  ');
    }
    e.dpSpec.textContent = target ? `Espectando: ${target.name}` : 'Aguardando o próximo round…';
  }
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
