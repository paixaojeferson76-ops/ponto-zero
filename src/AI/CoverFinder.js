// Busca de cobertura: nós próximos escondidos da ameaça (a altura dos olhos agachado e/ou em pé).
const CROUCH_EYE = 1.17;
const STAND_EYE = 1.62;

export class CoverFinder {
  constructor(session) {
    this.session = session;
    this._nodes = [];
  }

  /**
   * @param {{x:number,y:number,z:number}} from posição do bot
   * @param {{x:number,y:number,z:number}} threat posição da ameaça
   * @param {{radius?:number, samples?:number, minThreatDist?:number, fullCover?:boolean, awayBias?:number}} [o]
   * @returns {{x:number,y:number,z:number,hiddenStanding:boolean}|null}
   */
  find(from, threat, o = {}) {
    const { nav, world, rng } = this.session;
    const radius = o.radius ?? 14;
    const samples = o.samples ?? 22;
    const minThreatDist = o.minThreatDist ?? 4;
    const fullCover = !!o.fullCover;
    const awayBias = o.awayBias ?? 0.8;
    const nodes = nav.nodesInRadius(from.x, from.z, radius, this._nodes, 2);
    if (!nodes.length) return null;
    const botToThreat = Math.hypot(from.x - threat.x, from.z - threat.z);
    const ty = threat.y + STAND_EYE;

    let best = null, bestScore = Infinity;
    const n = Math.min(samples, nodes.length);
    let idx = rng.int(0, nodes.length - 1);
    const stride = Math.max(1, Math.floor(nodes.length / n));
    for (let i = 0; i < n; i++) {
      const id = nodes[idx % nodes.length];
      idx += stride + (i & 1);
      const px = nav.px[id], py = nav.py[id], pz = nav.pz[id];
      const dThreat = Math.hypot(px - threat.x, pz - threat.z);
      if (dThreat < minThreatDist) continue;
      const hiddenStanding = world.isBlocked(threat.x, ty, threat.z, px, py + STAND_EYE, pz);
      if (fullCover && !hiddenStanding) continue;
      const hiddenCrouch = hiddenStanding || world.isBlocked(threat.x, ty, threat.z, px, py + CROUCH_EYE, pz);
      if (!hiddenCrouch) continue;
      const dBot = Math.hypot(px - from.x, pz - from.z);
      let score = dBot + Math.max(0, botToThreat - dThreat) * awayBias - (hiddenStanding ? 3 : 0);
      if (o.preferFar) score -= dThreat * 0.5;
      score += rng.next() * 1.5;
      if (score < bestScore) { bestScore = score; best = { x: px, y: py, z: pz, hiddenStanding }; }
    }
    return best;
  }
}
