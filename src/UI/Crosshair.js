// Crosshair configurável (tamanho, espessura, abertura, cor, opacidade, contorno, ponto) com abertura
// dinâmica ligada à dispersão real da arma (movimento / disparo).
import { DEG, damp } from '../Systems/MathUtil.js';

export class Crosshair {
  constructor(el) {
    this.el = el;
    el.innerHTML = '<i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><i class="d"></i>';
    this.gap = 4;
    this.settings = null;
  }

  applySettings(cs) {
    this.settings = cs;
    const s = this.el.style;
    s.setProperty('--len', `${cs.size}px`);
    s.setProperty('--th', `${cs.thickness}px`);
    s.setProperty('--color', cs.color);
    s.setProperty('--op', String(cs.opacity));
    this.el.classList.toggle('outline', !!cs.outline);
    this.el.classList.toggle('dot', !!cs.dot);
    this.el.classList.toggle('hidden-ch', cs.size <= 0 && !cs.dot);
    this.baseGap = cs.gap;
    this.gap = cs.gap;
    s.setProperty('--gap', `${cs.gap}px`);
  }

  setVisible(v) {
    this.el.style.display = v ? '' : 'none';
  }

  /**
   * @param {number} dt
   * @param {number} moveSpreadDeg dispersão por movimento/ar (graus)
   * @param {number} fireSpreadDeg bloom por disparos (graus)
   * @param {number} fovV FOV vertical atual (graus)
   */
  update(dt, moveSpreadDeg, fireSpreadDeg, fovV) {
    const cs = this.settings;
    if (!cs) return;
    const pxPerDeg = (window.innerHeight / 2) / Math.tan((fovV * DEG) / 2) * DEG;
    let extra = 0;
    if (cs.dynamicMovement) extra += moveSpreadDeg * pxPerDeg;
    if (cs.dynamicFiring) extra += fireSpreadDeg * pxPerDeg;
    const target = this.baseGap + Math.min(extra, 60);
    this.gap = damp(this.gap, target, 24, dt);
    this.el.style.setProperty('--gap', `${this.gap.toFixed(2)}px`);
  }
}
