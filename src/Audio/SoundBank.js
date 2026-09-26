// Banco de sons 100% procedural: cada efeito é sintetizado em AudioBuffers no início (ruído filtrado,
// senoides com envelopes, cliques ressonantes). Sem arquivos de áudio → sem licenças de terceiros.

const TAU = Math.PI * 2;

function rnd(seedRef) {
  seedRef.s = (Math.imul(seedRef.s, 1664525) + 1013904223) >>> 0;
  return (seedRef.s / 4294967296) * 2 - 1;
}

export class SoundBank {
  constructor(ctx) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    this.buffers = new Map();       // nome → AudioBuffer[]
    this.seed = { s: 0x1234abcd };
    this._build();
  }

  get(name) {
    const list = this.buffers.get(name);
    if (!list) return null;
    return list.length === 1 ? list[0] : list[Math.floor(Math.random() * list.length)];
  }

  // ---------------------------------------------------------------- primitivas

  _make(seconds, fill) {
    const n = Math.max(1, Math.floor(seconds * this.sr));
    const buf = this.ctx.createBuffer(1, n, this.sr);
    const d = buf.getChannelData(0);
    fill(d, n, this.sr);
    let peak = 0;
    for (let i = 0; i < n; i++) if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
    if (peak > 0.98) for (let i = 0; i < n; i++) d[i] /= peak / 0.98;
    return buf;
  }

  _add(name, buf) {
    if (!this.buffers.has(name)) this.buffers.set(name, []);
    this.buffers.get(name).push(buf);
  }

  _noise() { return rnd(this.seed); }

  /** ruído passa-baixa de um polo com corte variável (Hz ou função de t). */
  _lpNoise(d, n, cutoff, gainFn, start = 0) {
    let y = 0;
    for (let i = start; i < n; i++) {
      const t = (i - start) / this.sr;
      const fc = typeof cutoff === 'function' ? cutoff(t) : cutoff;
      const a = 1 - Math.exp(-TAU * fc / this.sr);
      y += a * (this._noise() - y);
      d[i] += y * gainFn(t);
    }
  }

  _hpNoise(d, n, gainFn, start = 0) {
    let prev = 0;
    for (let i = start; i < n; i++) {
      const t = (i - start) / this.sr;
      const x = this._noise();
      d[i] += (x - prev) * 0.5 * gainFn(t);
      prev = x;
    }
  }

  _sine(d, n, freqFn, gainFn, start = 0) {
    let ph = 0;
    for (let i = start; i < n; i++) {
      const t = (i - start) / this.sr;
      ph += TAU * (typeof freqFn === 'function' ? freqFn(t) : freqFn) / this.sr;
      d[i] += Math.sin(ph) * gainFn(t);
    }
  }

  /** clique metálico ressonante em t0. */
  _click(d, n, t0, freq, gain = 0.6, decay = 0.02) {
    const start = Math.floor(t0 * this.sr);
    this._sine(d, n, freq, (t) => gain * Math.exp(-t / decay), start);
    this._sine(d, n, freq * 2.7, (t) => gain * 0.4 * Math.exp(-t / (decay * 0.6)), start);
    this._hpNoise(d, n, (t) => gain * 0.9 * Math.exp(-t / (decay * 0.5)), start);
  }

  _rustle(d, n, t0, t1, gain = 0.12) {
    const s0 = Math.floor(t0 * this.sr), s1 = Math.min(n, Math.floor(t1 * this.sr));
    let y = 0;
    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / (s1 - s0);
      y += 0.35 * (this._noise() - y);
      d[i] += y * gain * Math.sin(Math.PI * t) * (0.6 + 0.4 * Math.sin(t * 40));
    }
  }

  static env(t, a, dec) { return t < a ? t / a : Math.exp(-(t - a) / dec); }

  _softclip(d, n, k = 1.6) {
    for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i] * k);
  }

  // ---------------------------------------------------------------- catálogo

  _build() {
    const E = SoundBank.env;
    const gun = (name, { len, crack, body, thump, thumpF, tail, tailF, k = 1.8 }) => {
      for (let v = 0; v < 3; v++) {
        this._add(name, this._make(len, (d, n) => {
          this._hpNoise(d, n, (t) => crack * E(t, 0.0004, 0.010 + v * 0.001));
          this._lpNoise(d, n, 2400, (t) => body * E(t, 0.0008, 0.05));
          this._sine(d, n, (t) => thumpF * Math.exp(-t * 20) + 42, (t) => thump * E(t, 0.001, 0.09));
          this._lpNoise(d, n, tailF, (t) => tail * E(t, 0.01, 0.22));
          this._softclip(d, n, k);
        }));
      }
    };
    gun('fire_rifle', { len: 0.75, crack: 1.1, body: 0.9, thump: 0.9, thumpF: 130, tail: 0.38, tailF: 500 });
    gun('fire_pistol', { len: 0.45, crack: 1.2, body: 0.7, thump: 0.6, thumpF: 150, tail: 0.28, tailF: 700 });
    gun('fire_smg', { len: 0.32, crack: 1.0, body: 0.8, thump: 0.5, thumpF: 170, tail: 0.18, tailF: 900 });
    gun('fire_shotgun', { len: 1.0, crack: 1.2, body: 1.2, thump: 1.4, thumpF: 90, tail: 0.5, tailF: 380, k: 2.2 });

    // recargas
    this._add('reload_rifle', this._make(2.6, (d, n) => {
      this._click(d, n, 0.28, 900, 0.5); this._rustle(d, n, 0.4, 1.2);
      this._click(d, n, 1.35, 620, 0.85, 0.03);
      this._click(d, n, 2.05, 1200, 0.7, 0.025); this._click(d, n, 2.2, 800, 0.6);
    }));
    this._add('reload_pistol', this._make(2.0, (d, n) => {
      this._click(d, n, 0.2, 1000, 0.45); this._rustle(d, n, 0.3, 0.9, 0.08);
      this._click(d, n, 1.0, 700, 0.8, 0.025);
      this._click(d, n, 1.55, 1300, 0.7, 0.02);
    }));
    this._add('reload_smg', this._make(2.1, (d, n) => {
      this._click(d, n, 0.25, 1000, 0.5); this._rustle(d, n, 0.35, 1.0, 0.1);
      this._click(d, n, 1.15, 680, 0.8, 0.028);
      this._click(d, n, 1.75, 1250, 0.65, 0.022);
    }));
    this._add('reload_shell', this._make(0.3, (d, n) => { this._click(d, n, 0.02, 520, 0.7, 0.03); this._click(d, n, 0.11, 900, 0.4); }));
    this._add('shotgun_pump', this._make(0.5, (d, n) => { this._click(d, n, 0.02, 420, 0.9, 0.035); this._click(d, n, 0.22, 560, 0.9, 0.03); }));
    this._add('equip_light', this._make(0.25, (d, n) => { this._click(d, n, 0.02, 1100, 0.5); this._rustle(d, n, 0.02, 0.2, 0.08); }));
    this._add('equip_heavy', this._make(0.32, (d, n) => { this._click(d, n, 0.03, 620, 0.8, 0.03); this._rustle(d, n, 0.02, 0.3, 0.1); }));
    this._add('dry_click', this._make(0.1, (d, n) => { this._click(d, n, 0.005, 1500, 0.7, 0.012); }));

    // faca
    this._add('knife_swing', this._make(0.28, (d, n) => {
      let y = 0;
      for (let i = 0; i < n; i++) {
        const t = i / this.sr;
        const a = 1 - Math.exp(-TAU * (600 + 3800 * Math.sin(Math.PI * Math.min(1, t / 0.26))) / this.sr);
        y += a * (this._noise() - y);
        d[i] += y * 0.5 * Math.sin(Math.PI * Math.min(1, t / 0.26));
      }
    }));
    this._add('knife_hit', this._make(0.22, (d, n) => {
      this._sine(d, n, 180, (t) => 0.8 * Math.exp(-t / 0.05));
      this._click(d, n, 0.0, 2200, 0.4, 0.03);
      this._lpNoise(d, n, 1200, (t) => 0.5 * Math.exp(-t / 0.04));
    }));

    // impactos
    for (let v = 0; v < 3; v++) {
      this._add('impact_concrete', this._make(0.28, (d, n) => {
        this._hpNoise(d, n, (t) => 0.7 * E(t, 0.0005, 0.012));
        this._lpNoise(d, n, 3200, (t) => 0.6 * E(t, 0.001, 0.05 + v * 0.01));
        this._sine(d, n, 130, (t) => 0.3 * Math.exp(-t / 0.04));
      }));
      this._add('impact_metal', this._make(0.5, (d, n) => {
        this._hpNoise(d, n, (t) => 0.6 * E(t, 0.0004, 0.01));
        this._sine(d, n, 1350 + v * 90, (t) => 0.45 * Math.exp(-t / 0.16));
        this._sine(d, n, 2280 + v * 130, (t) => 0.3 * Math.exp(-t / 0.11));
        this._sine(d, n, 3650, (t) => 0.15 * Math.exp(-t / 0.07));
      }));
      this._add('impact_wood', this._make(0.3, (d, n) => {
        this._lpNoise(d, n, 900, (t) => 0.8 * E(t, 0.001, 0.05));
        this._sine(d, n, 170 + v * 20, (t) => 0.6 * Math.exp(-t / 0.07));
        this._hpNoise(d, n, (t) => 0.3 * E(t, 0.0005, 0.008));
      }));
    }

    // passos (3 variações por superfície)
    for (let v = 0; v < 3; v++) {
      this._add('step_concrete', this._make(0.22, (d, n) => {
        this._sine(d, n, (t) => 95 * Math.exp(-t * 14) + 45, (t) => 0.9 * E(t, 0.002, 0.045));
        this._lpNoise(d, n, 1500 + v * 300, (t) => 0.5 * E(t, 0.001, 0.03));
        this._hpNoise(d, n, (t) => 0.12 * E(t, 0.0005, 0.01));
      }));
      this._add('step_metal', this._make(0.4, (d, n) => {
        this._sine(d, n, (t) => 110 * Math.exp(-t * 12) + 60, (t) => 0.7 * E(t, 0.002, 0.04));
        this._sine(d, n, 820 + v * 70, (t) => 0.22 * Math.exp(-t / 0.12));
        this._sine(d, n, 1490 + v * 110, (t) => 0.12 * Math.exp(-t / 0.08));
        this._hpNoise(d, n, (t) => 0.25 * E(t, 0.0005, 0.012));
      }));
      this._add('step_wood', this._make(0.24, (d, n) => {
        this._sine(d, n, 150 + v * 15, (t) => 0.8 * Math.exp(-t / 0.06));
        this._lpNoise(d, n, 800, (t) => 0.5 * E(t, 0.001, 0.04));
      }));
    }
    this._add('jump', this._make(0.16, (d, n) => { this._rustle(d, n, 0, 0.15, 0.25); this._sine(d, n, 90, (t) => 0.3 * Math.exp(-t / 0.05)); }));
    this._add('land', this._make(0.32, (d, n) => {
      this._sine(d, n, (t) => 80 * Math.exp(-t * 10) + 38, (t) => 1.0 * E(t, 0.002, 0.08));
      this._lpNoise(d, n, 1100, (t) => 0.6 * E(t, 0.001, 0.06));
    }));

    // feedback
    this._add('hit_marker', this._make(0.09, (d, n) => { this._sine(d, n, 1900, (t) => 0.55 * Math.exp(-t / 0.018)); this._sine(d, n, 3100, (t) => 0.2 * Math.exp(-t / 0.012)); }));
    this._add('hit_head', this._make(0.16, (d, n) => {
      this._sine(d, n, 2300, (t) => 0.6 * Math.exp(-t / 0.02));
      this._sine(d, n, 3300, (t) => 0.6 * Math.exp(-t / 0.02), Math.floor(0.05 * this.sr));
    }));
    this._add('hurt', this._make(0.35, (d, n) => {
      this._sine(d, n, (t) => 140 * Math.exp(-t * 6) + 60, (t) => 0.8 * E(t, 0.003, 0.12));
      this._lpNoise(d, n, 1600, (t) => 0.5 * E(t, 0.002, 0.08));
    }));
    this._add('death', this._make(1.0, (d, n) => {
      this._sine(d, n, (t) => 200 * Math.exp(-t * 2.5) + 40, (t) => 0.6 * E(t, 0.01, 0.4));
      this._lpNoise(d, n, 900, (t) => 0.5 * E(t, 0.005, 0.15));
      this._sine(d, n, (t) => 70 * Math.exp(-t * 8) + 35, (t) => 0.9 * E(t, 0.3, 0.2), Math.floor(0.3 * this.sr));
    }));

    // granadas / explosões
    this._add('explosion', this._make(2.4, (d, n) => {
      this._lpNoise(d, n, (t) => 4000 * Math.exp(-t * 2.4) + 120, (t) => 1.3 * E(t, 0.002, 0.5));
      this._sine(d, n, (t) => 70 * Math.exp(-t * 2) + 28, (t) => 1.4 * E(t, 0.004, 0.55));
      this._hpNoise(d, n, (t) => 0.8 * E(t, 0.0005, 0.03));
      this._softclip(d, n, 1.6);
    }));
    this._add('flash_bang', this._make(0.7, (d, n) => {
      this._hpNoise(d, n, (t) => 1.2 * E(t, 0.0005, 0.06));
      this._lpNoise(d, n, 3000, (t) => 0.9 * E(t, 0.001, 0.15));
      this._softclip(d, n, 2);
    }));
    this._add('flash_ring', this._make(3.5, (d, n) => {
      this._sine(d, n, 3900, (t) => 0.25 * Math.exp(-t / 1.4));
      this._sine(d, n, 5200, (t) => 0.12 * Math.exp(-t / 1.0));
    }));
    this._add('smoke_pop', this._make(1.6, (d, n) => {
      this._lpNoise(d, n, 2000, (t) => 0.4 * E(t, 0.002, 0.05));
      this._hpNoise(d, n, (t) => 0.35 * E(t, 0.05, 0.6));
    }));
    this._add('grenade_bounce', this._make(0.16, (d, n) => { this._click(d, n, 0, 1800, 0.6, 0.03); this._sine(d, n, 260, (t) => 0.4 * Math.exp(-t / 0.03)); }));
    this._add('grenade_pin', this._make(0.2, (d, n) => { this._click(d, n, 0.0, 2000, 0.6, 0.03); this._click(d, n, 0.08, 1500, 0.4); }));

    // objetivo / partida
    const beep = (f, len, gain = 0.5) => this._make(len, (d, n) => this._sine(d, n, f, (t) => gain * E(t, 0.002, len * 0.4)));
    this._add('bomb_beep', beep(1050, 0.12, 0.7));
    this._add('plant_tick', beep(720, 0.06, 0.45));
    this._add('interact_tick', beep(560, 0.05, 0.35));
    this._add('bomb_planted', this._make(1.2, (d, n) => {
      for (let i = 0; i < 3; i++) this._sine(d, n, 900 - i * 120, (t) => 0.55 * E(t, 0.002, 0.08), Math.floor(i * 0.16 * this.sr));
      this._sine(d, n, 60, (t) => 0.7 * E(t, 0.01, 0.3), Math.floor(0.5 * this.sr));
    }));
    this._add('bomb_defused', this._make(1.0, (d, n) => {
      [660, 880, 1320].forEach((f, i) => this._sine(d, n, f, (t) => 0.5 * E(t, 0.004, 0.16), Math.floor(i * 0.1 * this.sr)));
    }));
    this._add('round_start', this._make(0.7, (d, n) => {
      this._sine(d, n, 520, (t) => 0.5 * E(t, 0.005, 0.1)); this._sine(d, n, 520, (t) => 0.5 * E(t, 0.005, 0.1), Math.floor(0.22 * this.sr));
      this._sine(d, n, 780, (t) => 0.55 * E(t, 0.005, 0.2), Math.floor(0.44 * this.sr));
    }));
    this._add('round_win', this._make(1.1, (d, n) => { [523, 659, 784, 1046].forEach((f, i) => this._sine(d, n, f, (t) => 0.45 * E(t, 0.004, 0.22), Math.floor(i * 0.13 * this.sr))); }));
    this._add('round_lose', this._make(1.2, (d, n) => { [392, 330, 262, 196].forEach((f, i) => this._sine(d, n, f, (t) => 0.5 * E(t, 0.004, 0.28), Math.floor(i * 0.16 * this.sr))); }));
    this._add('countdown', beep(880, 0.15, 0.5));

    // UI
    this._add('ui_click', this._make(0.06, (d, n) => { this._sine(d, n, 1200, (t) => 0.35 * Math.exp(-t / 0.012)); this._hpNoise(d, n, (t) => 0.12 * Math.exp(-t / 0.005)); }));
    this._add('ui_hover', this._make(0.04, (d, n) => { this._sine(d, n, 1800, (t) => 0.15 * Math.exp(-t / 0.01)); }));

    // ambiente (loop contínuo sem emenda: períodos inteiros + crossfade)
    this._add('ambience', this._make(8, (d, n) => {
      const len = n / this.sr;
      this._sine(d, n, 55, () => 0.10);
      this._sine(d, n, 110.0, (t) => 0.05 + 0.02 * Math.sin(TAU * 2 * t / len));
      this._sine(d, n, 165.0, () => 0.02);
      let y = 0;
      const tmp = new Float32Array(n);
      for (let i = 0; i < n; i++) { y += 0.02 * (this._noise() - y); tmp[i] = y; }
      const xf = Math.floor(0.6 * this.sr);
      for (let i = 0; i < xf; i++) {
        const a = i / xf;
        tmp[i] = tmp[i] * a + tmp[n - xf + i] * (1 - a);
      }
      for (let i = 0; i < n; i++) d[i] += tmp[i] * 1.8 * (0.7 + 0.3 * Math.sin(TAU * 3 * i / n));
      // estalos metálicos distantes
      for (let k = 0; k < 4; k++) {
        const t0 = 0.8 + k * 1.7 + (this._noise() * 0.3);
        this._click(d, n, t0, 420 + k * 60, 0.05, 0.05);
      }
    }));
  }
}
