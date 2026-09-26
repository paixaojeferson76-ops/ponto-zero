// Motor de áudio (WebAudio): barramentos master/sfx/música, sons posicionais (PannerNode HRTF),
// atenuação por distância/oclusão (passa-baixa), limite de vozes, ambiente em loop e música procedural.
import { SoundBank } from './SoundBank.js';

const MAX_VOICES = 32;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.bank = null;
    this.master = null;
    this.sfx = null;
    this.music = null;
    this.ambience = null;
    this.voices = 0;
    this.volumes = { master: 0.8, sfx: 1.0, music: 0.35 };
    this._sfxBase = 1.0;
    this.ambienceSource = null;
    this.duckUntil = 0;
    this.ready = false;
    this.musicNodes = null;
    this.musicTimer = 0;
  }

  /** Cria o contexto (precisa de gesto do usuário). Seguro chamar várias vezes. */
  async init() {
    if (this.ready) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.ambience = ctx.createGain();
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 4;
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.ambience.connect(this.master);
    this.master.connect(this.compressor);
    this.compressor.connect(ctx.destination);
    this.bank = new SoundBank(ctx);
    this.applyVolumes();
    this.ready = true;
    if (ctx.state === 'suspended') ctx.resume();   // sem await: só resolve após um gesto do usuário
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  applyVolumes() {
    this._sfxBase = this.volumes.sfx;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.03);
    this.music.gain.setTargetAtTime(this.volumes.music * 0.5, t, 0.03);
    this.ambience.gain.setTargetAtTime(this.volumes.sfx * 0.35, t, 0.03);
    if (t >= this.duckUntil) this.sfx.gain.setTargetAtTime(this._sfxBase, t, 0.03);
  }

  setListener(x, y, z, yaw, pitch = 0) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(x, t); l.positionY.setValueAtTime(y, t); l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /**
   * Toca um som.
   * @param {string} name
   * @param {{x?:number,y?:number,z?:number,volume?:number,rate?:number,positional?:boolean,occlusion?:number,priority?:number,delay?:number,distanceScale?:number}} [o]
   */
  play(name, o = {}) {
    if (!this.ready || this.ctx.state !== 'running') return null;
    const buf = this.bank.get(name);
    if (!buf) return null;
    const priority = o.priority ?? 1;
    if (this.voices >= MAX_VOICES && priority < 2) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (0.96 + Math.random() * 0.08);
    const gain = ctx.createGain();
    gain.gain.value = o.volume ?? 1;
    let node = src;
    node.connect(gain);
    node = gain;

    if (o.positional && o.x !== undefined) {
      const occlusion = o.occlusion || 0;
      if (occlusion > 0) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900 + (1 - occlusion) * 9000;
        node.connect(lp);
        node = lp;
        gain.gain.value *= 1 - occlusion * 0.55;
      }
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 3 * (o.distanceScale ?? 1);
      p.rolloffFactor = 1.25;
      p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = o.x; p.positionY.value = o.y ?? 0; p.positionZ.value = o.z; }
      else p.setPosition(o.x, o.y ?? 0, o.z);
      node.connect(p);
      node = p;
    }
    node.connect(o.bus === 'ui' ? this.master : this.sfx);
    this.voices++;
    src.onended = () => { this.voices = Math.max(0, this.voices - 1); try { gain.disconnect(); } catch { /* já desconectado */ } };
    src.start(ctx.currentTime + (o.delay || 0));
    return src;
  }

  ui(name, volume = 0.6) {
    return this.play(name, { volume, bus: 'ui', priority: 3 });
  }

  /** Reduz o volume dos efeitos por `seconds` (ex.: granada cegante → zumbido). */
  duck(amount, seconds) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.duckUntil = t + seconds;
    this.sfx.gain.cancelScheduledValues(t);
    this.sfx.gain.setTargetAtTime(this._sfxBase * amount, t, 0.05);
    this.sfx.gain.setTargetAtTime(this._sfxBase, t + seconds, 0.4);
  }

  startAmbience() {
    if (!this.ready || this.ambienceSource) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.bank.get('ambience');
    src.loop = true;
    src.connect(this.ambience);
    src.start();
    this.ambienceSource = src;
  }

  stopAmbience() {
    if (this.ambienceSource) { try { this.ambienceSource.stop(); } catch { /* ignore */ } this.ambienceSource = null; }
  }

  // ---------------------------------------------------------------- música procedural

  startMusic() {
    if (!this.ready || this.musicNodes) return;
    this.musicNodes = { running: true };
    this._scheduleChord(0);
  }

  stopMusic() {
    if (this.musicNodes) this.musicNodes.running = false;
    this.musicNodes = null;
    clearTimeout(this.musicTimer);
  }

  _scheduleChord(i) {
    if (!this.musicNodes || !this.musicNodes.running || !this.ready) return;
    const ctx = this.ctx;
    const progression = [
      [110.0, 164.81, 220.0, 261.63],    // Am
      [87.31, 130.81, 174.61, 261.63],   // F
      [130.81, 196.0, 261.63, 329.63],   // C
      [98.0, 146.83, 196.0, 293.66],     // G
    ];
    const chord = progression[i % progression.length];
    const now = ctx.currentTime;
    const dur = 8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, now);
    lp.frequency.linearRampToValueAtTime(1100, now + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(450, now + dur);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.5, now + 2.5);
    out.gain.linearRampToValueAtTime(0.0, now + dur + 1.5);
    lp.connect(out);
    out.connect(this.music);
    for (const f of chord) {
      for (const detune of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = 0.06;
        o.connect(g);
        g.connect(lp);
        o.start(now);
        o.stop(now + dur + 1.6);
      }
    }
    this.musicTimer = setTimeout(() => this._scheduleChord(i + 1), dur * 1000 - 200);
  }
}
