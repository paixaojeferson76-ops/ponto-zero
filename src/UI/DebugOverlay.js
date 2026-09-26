// Painel de debug (F3): FPS, posição/velocidade/estado do jogador, estados dos bots, custo de simulação,
// draw calls/triângulos e memória. F4 alterna o nível de detalhe (info → hitboxes/raycasts → navegação → colliders).
export const DEBUG_LEVELS = ['DESLIGADO', 'INFO', 'INFO + HITBOXES + RAYCASTS', '+ NAVEGAÇÃO / CAMINHOS', '+ COLLIDERS'];

export class DebugOverlay {
  constructor(el) {
    this.el = el;
    this.level = 0;
    this.lastLevel = 2;
    this.timer = 0;
    this.frameTimes = new Float32Array(120);
    this.fi = 0;
  }

  setLevel(l) {
    this.level = Math.max(0, Math.min(DEBUG_LEVELS.length - 1, l));
    if (this.level > 0) this.lastLevel = this.level;
    this.el.classList.toggle('hidden', this.level === 0);
  }

  toggle() { this.setLevel(this.level === 0 ? this.lastLevel : 0); }
  cycle() { this.setLevel(this.level === 0 ? 1 : (this.level % (DEBUG_LEVELS.length - 1)) + 1); }

  pushFrame(ms) {
    this.frameTimes[this.fi] = ms;
    this.fi = (this.fi + 1) % this.frameTimes.length;
  }

  update(dt, c) {
    if (this.level === 0) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    const { session, player, match, renderInfo, tickMs, cpuMs, fps } = c;
    const ft = this.frameTimes;
    let sum = 0, max = 0;
    for (let i = 0; i < ft.length; i++) { sum += ft[i]; if (ft[i] > max) max = ft[i]; }
    const avg = sum / ft.length;
    const f = (v, d = 2) => v.toFixed(d);
    const lines = [];
    lines.push(`[F3] DEBUG · nível ${this.level}: ${DEBUG_LEVELS[this.level]}  (F4 alterna)`);
    lines.push(`FPS ${fps.toFixed(0)}  frame ${f(avg, 1)} ms (pior ${f(max, 1)})  sim ${f(tickMs, 2)} ms/tick  cpu/frame ${f(cpuMs || 0, 2)} ms`);
    if (renderInfo) lines.push(`draw calls ${renderInfo.calls}  tris ${renderInfo.tris}  geos ${renderInfo.geometries}  tex ${renderInfo.textures}  res×${renderInfo.pixelRatio.toFixed(2)}`);
    if (performance.memory) lines.push(`memória JS ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB`);
    if (player) {
      const b = player.body;
      lines.push(`JOGADOR pos (${f(b.pos.x)}, ${f(b.pos.y)}, ${f(b.pos.z)})  vel ${f(b.speedXZ)} m/s  vy ${f(b.vel.y)}`);
      lines.push(`estado ${player.state}  chão ${b.onGround ? 'sim' : 'não'}  agachado ${b.crouched ? 'sim' : 'não'}  yaw ${f(player.view.yaw * 57.2958, 1)}°  pitch ${f(player.view.pitch * 57.2958, 1)}°`);
      const w = player.weapons;
      lines.push(`arma ${w.def ? w.def.short : '-'}  fase ${w.phase}  spread ${f(w.currentSpread)}°  punch (${f(w.recoil.aimPunch.pitch)}, ${f(w.recoil.aimPunch.yaw)})°  bloom ${f(w.recoil.bloom)}°  tiro# ${f(w.recoil.shotIndex, 1)}`);
    }
    lines.push(`PARTIDA fase ${match.phase}  round ${match.round}  relógio ${f(match.clock, 1)}  bomba ${match.bomb.planted ? `plantada em ${match.bomb.site} (${f(match.bomb.timeLeft, 1)}s)` : 'não plantada'}`);
    lines.push('BOTS');
    for (const bot of session.bots) {
      const nav = bot.navigator;
      const tgt = bot.brain.target ? bot.brain.target.enemy.name : '-';
      lines.push(` ${bot.name.padEnd(9)} ${bot.team === 'attack' ? 'ATQ' : 'DEF'} ${bot.aiState.padEnd(17)} vida ${String(Math.ceil(bot.health.current)).padStart(3)}  alvo ${tgt.padEnd(8)} ${bot.plan ? bot.plan.kind : '-'}${bot.plan && bot.plan.role ? `/${bot.plan.role}` : ''}  path ${nav.path ? `${nav.index}/${nav.path.length}` : '-'}  travou ${nav.totalStuckEvents}`);
    }
    this.el.textContent = lines.join('\n');
  }
}
