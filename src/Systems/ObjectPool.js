// Pool simples para evitar alocações por tiro/impacto (tracers, decals, partículas).

export class ObjectPool {
  /**
   * @param {() => any} factory cria um objeto novo
   * @param {(obj:any)=>void} [reset] chamado ao devolver ao pool
   * @param {number} [prewarm]
   */
  constructor(factory, reset = null, prewarm = 0) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
    for (let i = 0; i < prewarm; i++) this.free.push(factory());
  }

  acquire() {
    return this.free.length ? this.free.pop() : this.factory();
  }

  release(obj) {
    if (this.reset) this.reset(obj);
    this.free.push(obj);
  }
}

/** Anel de tamanho fixo: reutiliza sempre o item mais antigo (ideal para decals). */
export class RingBuffer {
  constructor(size, factory) {
    this.items = Array.from({ length: size }, factory);
    this.next = 0;
  }
  take() {
    const item = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    return item;
  }
  get size() { return this.items.length; }
}
