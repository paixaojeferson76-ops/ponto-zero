// Barramento de eventos mínimo. A simulação emite; Render/Áudio/HUD ouvem.
// Mantém baixo acoplamento: a simulação nunca importa código de apresentação.

export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) this.handlers.set(type, (list = []));
    list.push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(type, payload) {
    const list = this.handlers.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](payload);
      } catch (err) {
        // Um erro em quem ouve (áudio, efeitos, HUD) nunca pode derrubar a simulação.
        this.errors = (this.errors || 0) + 1;
        if (this.errors <= 20) console.error(`[EventBus] erro no handler de '${type}':`, err);
      }
    }
  }

  clear() {
    this.handlers.clear();
  }
}
