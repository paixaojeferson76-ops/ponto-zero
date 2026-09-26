// PRNG determinístico (mulberry32). Usado em spread, jitter de recoil e decisões da IA
// para que testes e replays sejam reproduzíveis.

export class Rng {
  constructor(seed = 1) {
    this.state = seed >>> 0 || 1;
  }

  /** Float em [0,1). */
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) { return min + (max - min) * this.next(); }
  int(min, maxInclusive) { return Math.floor(this.range(min, maxInclusive + 1)); }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** Ponto uniforme dentro de um disco unitário → out.x/out.y. */
  inDisk(out) {
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(this.next());
    out.x = Math.cos(a) * r;
    out.y = Math.sin(a) * r;
    return out;
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
