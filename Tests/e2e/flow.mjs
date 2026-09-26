// E2E de fluxo: menu → jogar (lado/dificuldade/tamanho) → pausar → reiniciar → menu → nova partida →
// vitória de partida → tela final → jogar de novo; troca de qualidade gráfica em runtime; marcadores de objetivo.
//   node Tests/e2e/flow.mjs [--gpu]
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, startServer } from './browser.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer(5193);
const browser = await launch({ gpu: process.argv.includes('--gpu'), width: 1280, height: 720 });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|GPU stall/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack || ''}`));
const ev = (f) => page.evaluate(f);
const state = () => ev('window.__pz.state()');

try {
  await page.goto(`${server.url}?nolock=1`, { waitUntil: 'load' });
  await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'menu'", { timeout: 60000 });
  check('menu principal aparece depois do carregamento', true);

  await page.select('#opt-side', 'defend');
  await page.select('#opt-diff', 'EASY');
  await page.select('#opt-size', '3');
  await page.click('#btn-play');
  await page.waitForFunction("window.__pz.state() === 'playing'", { timeout: 30000 });
  let info = await ev('({ team: window.__pz.player.team, n: window.__pz.session.combatants.length, bots: window.__pz.session.bots.every((b) => b.difficultyName === "EASY") })');
  check('opções do menu (defensor, fácil, 3×3) aplicadas', info.team === 'defend' && info.n === 6 && info.bots, JSON.stringify(info));

  await ev('window.__pz.advance(20)');
  await ev('window.__pz.game.pause()'); await sleep(200);
  check('pausa mostra o menu de pausa', (await state()) === 'paused' && await ev("!document.getElementById('menu-pause').classList.contains('hidden')"));
  await page.click('#btn-restart');
  await page.waitForFunction("window.__pz.state() === 'playing'", { timeout: 30000 });
  info = await ev('({ round: window.__pz.session.match.round, score: window.__pz.session.match.score, team: window.__pz.player.team })');
  check('reiniciar partida volta ao round 1 com placar zerado', info.round === 1 && info.score.attack === 0 && info.score.defend === 0, JSON.stringify(info));

  // marcadores de objetivo (sítio A) aparecem quando olhando para eles
  await ev('window.__pz.advance(6.5)');
  const site = await ev('window.__pz.session.map.sites.A');
  await ev(`window.__pz.teleport(8.5, -11.5, 0); window.__pz.aimAt(${site.x}, 2.3, ${site.z})`);
  await sleep(500);
  const wp = await ev(`(() => { const els = [...document.querySelectorAll('#waypoints .wp')].filter((e) => e.style.display === 'block'); return els.map((e) => e.textContent); })()`);
  await page.screenshot({ path: join(out, 'flow_waypoint.png') });
  check('marcador do sítio A é exibido com distância', wp.some((t) => t.startsWith('A')), JSON.stringify(wp));

  // qualidade gráfica em runtime
  for (const q of ['LOW', 'HIGH', 'MEDIUM']) {
    await ev(`window.__pz.game.settings.update((d) => { d.video.quality = '${q}'; }); window.__pz.game._settingsChanged('video', 'quality');`);
    await sleep(400);
    const r = await ev('window.__pz.game.sm.renderInfo');
    check(`qualidade ${q} aplicada sem erros`, r.calls > 0, `${r.calls} draw calls, ${r.tris} tris`);
  }
  await ev(`window.__pz.game.settings.update((d) => { d.video.resolution = '540'; }); window.__pz.game._settingsChanged('video', 'resolution');`);
  await sleep(300);
  check('resolução de renderização menor reduz o pixel ratio', (await ev('window.__pz.game.sm.renderInfo.pixelRatio')) < 1);
  await ev(`window.__pz.game.settings.update((d) => { d.video.resolution = 'native'; }); window.__pz.game._settingsChanged('video', 'resolution');`);

  // menu principal e nova partida como atacante
  await ev('window.__pz.game.pause()'); await sleep(150);
  await page.click('#btn-quit');
  await sleep(300);
  check('menu principal via "Menu principal"', (await state()) === 'menu');
  await page.select('#opt-side', 'attack'); await page.select('#opt-size', '2');
  await ev('window.__pz.game.settings.update((d) => { d.gameplay.roundsToWin = 1; })');
  await page.click('#btn-play');
  await page.waitForFunction("window.__pz.state() === 'playing'", { timeout: 30000 });
  await ev('window.__pz.advance(6.5)');
  await ev(`window.__pz.session.combatants.filter((c) => c.team === 'defend').forEach((c) => c.receiveDamage({ amount: 999, type: 'world', attacker: window.__pz.player }))`);
  await ev('window.__pz.advance(0.2)');
  await sleep(300);
  await ev('window.__pz.advance(5.5)');
  await sleep(500);
  await page.waitForFunction("window.__pz.state() === 'ended'", { timeout: 10000 }).catch(() => {});
  await page.screenshot({ path: join(out, 'flow_end.png') });
  check('fim de partida mostra a tela de resultado', (await state()) === 'ended' && await ev("!document.getElementById('menu-end').classList.contains('hidden')"), await ev("document.getElementById('end-title').textContent"));
  await page.click('#btn-again');
  await page.waitForFunction("window.__pz.state() === 'playing'", { timeout: 30000 });
  info = await ev('({ round: window.__pz.session.match.round, alive: window.__pz.session.combatants.every((c) => c.alive) })');
  check('jogar novamente inicia outra partida', info.round === 1 && info.alive);

  // muitos rounds seguidos sem exceções (bot × bot no lugar do jogador)
  await ev('window.__pz.advance(400)');
  check('400 s de jogo simulado sem erros', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  check('execução do fluxo', false, String((e && e.stack) || e));
}
await browser.close();
server.stop();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
process.exit(failed.length ? 1 : 0);
