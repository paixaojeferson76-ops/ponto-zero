// Placar (TAB): duas tabelas por time com abates, mortes, assistências, dano e situação.
import { TEAM, TEAM_LABEL } from '../Config/MatchRules.js';

export class Scoreboard {
  constructor(el) {
    this.el = el;
    this.visible = false;
    this.timer = 0;
  }

  show(v) {
    this.visible = v;
    this.el.classList.toggle('hidden', !v);
    this.timer = 0;
  }

  update(dt, session, match, player) {
    if (!this.visible) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const table = (team) => {
      const rows = session.combatants
        .filter((c) => c.team === team)
        .sort((a, b) => b.stats.score - a.stats.score || b.stats.kills - a.stats.kills)
        .map((c) => `<tr class="${c === player ? 'me' : ''} ${c.alive ? '' : 'dead'}"><td>${c.name}</td><td>${c.stats.kills}</td><td>${c.stats.deaths}</td><td>${c.stats.assists}</td><td>${Math.round(c.stats.damage)}</td><td>${c.alive ? Math.ceil(c.health.current) : '†'}</td></tr>`)
        .join('');
      return `<h3><span class="tname ${team}">${TEAM_LABEL[team]}</span><span>${match.score[team]}</span></h3>
        <table><thead><tr><th>JOGADOR</th><th>ABATES</th><th>MORTES</th><th>ASSIST.</th><th>DANO</th><th>VIDA</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    this.el.innerHTML = `${table(TEAM.ATTACK)}${table(TEAM.DEFEND)}<h3><span>ROUND ${match.round}</span><span>PRIMEIRO A ${match.roundsToWin}</span></h3>`;
  }
}
