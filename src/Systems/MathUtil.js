// Utilidades matemáticas puras (sem alocação em caminhos quentes).

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};

/** Aproximação exponencial independente de framerate. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Move `current` em direção a `target` no máximo `maxDelta`. */
export const approach = (current, target, maxDelta) => {
  const d = target - current;
  return Math.abs(d) <= maxDelta ? target : current + Math.sign(d) * maxDelta;
};

/** Normaliza ângulo para (-PI, PI]. */
export const wrapPi = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

/** Menor diferença angular (radianos) de a para b. */
export const angleDelta = (a, b) => wrapPi(b - a);

/** Vetor "frente" a partir de yaw/pitch (rad). Convenção Three.js: yaw 0 olha para -Z, yaw+ vira à esquerda. */
export function forwardFromAngles(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

/** yaw/pitch (rad) que apontam de (0,0,0) para (dx,dy,dz). */
export function anglesFromDirection(dx, dy, dz, out) {
  const horiz = Math.hypot(dx, dz);
  out.yaw = Math.atan2(-dx, -dz);
  out.pitch = Math.atan2(dy, horiz);
  return out;
}

export const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const dist3D = (ax, ay, az, bx, by, bz) => Math.hypot(ax - bx, ay - by, az - bz);

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthXZ() { return Math.hypot(this.x, this.z); }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  normalize() {
    const l = this.length();
    if (l > 1e-9) this.scale(1 / l);
    return this;
  }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
}
