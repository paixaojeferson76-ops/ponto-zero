// Smoke E2E: abre o jogo no Chrome, joga de verdade (teclado/mouse simulados) e valida o essencial.
//   node Tests/e2e/smoke.mjs [--gpu]
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, startServer } from './browser.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer(5197);
const browser = await launch({ gpu: process.argv.includes('--gpu'), width: 1280, height: 720 });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|GPU stall/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack || ''}`));

const ev = (fn) => page.evaluate(fn);

try {
  await page.goto(`${server.url}?autostart=1&nolock=1&seed=7`, { waitUntil: 'load' });
  await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'playing'", { timeout: 60000 });
  check('o jogo inicia e entra na partida', true);

  await page.waitForFunction("document.getElementById('weapon-name').textContent !== '—'", { timeout: 20000 });
  const info = await ev(`(() => { const s = window.__pz.session; return { combatants: s.combatants.length, bots: s.bots.length, phase: s.match.phase, hasPlayer: !!window.__pz.player, hp: document.getElementById('hp-num').textContent, weapon: document.getElementById('weapon-name').textContent }; })()`);
  check('jogador + bots criados (5×5)', info.combatants === 10 && info.bots === 9 && info.hasPlayer, JSON.stringify(info));
  check('HUD mostra vida e arma', info.hp === '100' && /AR-30/.test(info.weapon), `${info.hp} / ${info.weapon}`);
  check('partida começa em preparação', info.phase === 'freeze');

  // preparação: movimento travado
  const p0 = await ev('({x: window.__pz.player.pos.x, z: window.__pz.player.pos.z})');
  await page.keyboard.down('KeyW'); await sleep(600); await page.keyboard.up('KeyW');
  const p1 = await ev('({x: window.__pz.player.pos.x, z: window.__pz.player.pos.z})');
  check('movimento travado na preparação', Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05);

  // segue até o round valer
  await page.waitForFunction("window.__pz.session.match.phase === 'live'", { timeout: 30000 });
  check('round fica valendo após a preparação', true);

  // movimento: WASD, shift, pulo, agachar
  const before = await ev('({x: window.__pz.player.pos.x, y: window.__pz.player.pos.y, z: window.__pz.player.pos.z})');
  await page.keyboard.down('KeyD'); await sleep(700); await page.keyboard.up('KeyD');
  const afterD = await ev('({x: window.__pz.player.pos.x, z: window.__pz.player.pos.z, speed: window.__pz.player.body.speedXZ})');
  check('andar (D) move o jogador', Math.hypot(afterD.x - before.x, afterD.z - before.z) > 0.8, `Δ=${Math.hypot(afterD.x - before.x, afterD.z - before.z).toFixed(2)} m`);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await sleep(700);
  const runSpeed = await ev('window.__pz.player.body.speedXZ');
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  check('correr (Shift+W) é mais rápido que andar', runSpeed > 4.5, `${runSpeed.toFixed(2)} m/s`);
  await page.keyboard.press('Space'); await sleep(150);
  const inAir = await ev('!window.__pz.player.body.onGround');
  check('pular tira do chão', inAir);
  await sleep(900);
  await page.keyboard.down('ControlLeft'); await sleep(400);
  const crouched = await ev('window.__pz.player.body.crouched');
  await page.keyboard.up('ControlLeft');
  check('agachar (Ctrl) funciona', crouched);

  // olhar com o mouse
  const yaw0 = await ev('window.__pz.player.view.yaw');
  await ev('window.__pz.look(200, 0)'); await sleep(200);
  const yaw1 = await ev('window.__pz.player.view.yaw');
  check('mouse look gira a visão', Math.abs(yaw1 - yaw0) > 0.05, `Δyaw=${(yaw1 - yaw0).toFixed(3)} rad`);

  // tiro: mira numa parede
  await ev('window.__pz.teleport(-41, 0, 0, -Math.PI / 2)');
  await ev(`window.__counts = { impacts: 0, traces: 0, shots: 0 }; const e = window.__pz.session.events; e.on('bulletImpact', () => window.__counts.impacts++); e.on('bulletTrace', () => window.__counts.traces++); e.on('weaponFired', () => window.__counts.shots++);`);
  const ammo0 = await ev('window.__pz.player.weapons.active.ammo');
  await page.mouse.down({ button: 'left' }); await sleep(500);
  await page.screenshot({ path: join(out, 'smoke_firing.png') });
  await sleep(300); await page.mouse.up({ button: 'left' });
  const c = await ev('window.__counts');
  const ammo1 = await ev('window.__pz.player.weapons.active.ammo');
  check('atirar consome munição e gera impactos/tracers', ammo1 < ammo0 && c.shots > 3 && c.impacts > 0 && c.traces > 0, JSON.stringify({ ammo0, ammo1, ...c }));
  const punch = await ev('window.__pz.player.weapons.recoil.aimPunch.pitch');
  check('recoil de precisão acumula durante a rajada', punch > 0.5, `${punch.toFixed(2)}°`);
  await sleep(300);
  await ev('window.__pz.player.cmd.reload = true');
  await page.keyboard.press('KeyR'); await sleep(400);
  const phase = await ev('window.__pz.player.weapons.phase');
  check('recarregar (R) inicia a recarga', phase === 'reload', phase);
  await sleep(2800);
  const ammo2 = await ev('window.__pz.player.weapons.active.ammo');
  check('recarga completa restaura o pente', ammo2 === 30, `${ammo2}`);

  // troca de arma
  await page.keyboard.press('Digit2'); await sleep(900);
  const w2 = await ev('window.__pz.player.weapons.activeKey');
  await page.keyboard.press('Digit3'); await sleep(900);
  const w3 = await ev('window.__pz.player.weapons.activeKey');
  await page.keyboard.press('Digit1'); await sleep(900);
  const w1 = await ev('window.__pz.player.weapons.activeKey');
  check('trocar de arma (1/2/3)', w2 === 'secondary' && w3 === 'melee' && w1 === 'primary', `${w2},${w3},${w1}`);

  // bots: estados variados e movimento
  await ev('window.__pz.advance(25)');
  const bots = await ev(`window.__pz.session.bots.map((b) => ({ n: b.name, s: b.aiState, alive: b.alive, hp: b.health.current }))`);
  const states = new Set(bots.map((b) => b.s));
  check('bots ativos (estados de IA em uso)', states.size >= 2, [...states].join(','));

  // dano no jogador
  await ev(`window.__pz.player.receiveDamage({ amount: 20, type: 'bullet', attacker: window.__pz.session.bots.find((b) => b.team !== window.__pz.player.team), hitbox: 'torso', armorPen: 0.5 })`);
  await sleep(200);
  const hp = await ev('window.__pz.player.health.current');
  check('jogador recebe dano (vida/colete)', hp < 100, `vida ${hp.toFixed(0)}`);

  // scoreboard, debug, menus
  await page.keyboard.down('Tab'); await sleep(400);
  await page.screenshot({ path: join(out, 'smoke_scoreboard.png') });
  const sbVisible = await ev(`!document.getElementById('scoreboard').classList.contains('hidden')`);
  await page.keyboard.up('Tab');
  check('placar (Tab) aparece', sbVisible);
  await page.keyboard.press('F3'); await sleep(500);
  await page.keyboard.press('F4'); await sleep(300);
  const dbgText = await ev(`document.getElementById('debug').textContent`);
  await page.screenshot({ path: join(out, 'smoke_debug.png') });
  check('debug F3/F4 mostra FPS, posição, bots', /FPS/.test(dbgText) && /JOGADOR/.test(dbgText) && /BOTS/.test(dbgText));
  await page.keyboard.press('F3');
  await page.keyboard.press('F3'); await page.keyboard.press('F3');

  // objetivo: plantar e vencer/perder round
  const site = await ev('window.__pz.session.map.sites.A');
  // inimigos congelados: com bots reais no sítio o jogador podia morrer durante os 3,6 s do plantio (teste instável)
  await ev('for (const b of window.__pz.session.bots) if (b.team !== window.__pz.player.team) b.frozen = true');
  await ev(`window.__pz.player.health.reset(); window.__pz.teleport(${site.x}, ${site.z}, 0)`);
  await page.keyboard.down('KeyE'); await sleep(500);
  const interact = await ev(`document.getElementById('interact').classList.contains('show')`);
  await page.screenshot({ path: join(out, 'smoke_plant.png') });
  await ev('window.__pz.advance(3.6)');
  await page.keyboard.up('KeyE');
  const planted = await ev('window.__pz.session.match.bomb.planted');
  check('plantar a carga no sítio (segurar E)', planted && interact, `interact HUD=${interact}`);

  // morte do jogador + espectar
  await ev(`window.__pz.player.receiveDamage({ amount: 999, type: 'bullet', attacker: window.__pz.session.bots.find((b) => b.team !== window.__pz.player.team), hitbox: 'head', weaponId: 'ar30', armorPen: 1 })`);
  await sleep(2500);
  await page.screenshot({ path: join(out, 'smoke_dead.png') });
  const dead = await ev(`({ alive: window.__pz.player.alive, panel: !document.getElementById('death-panel').classList.contains('hidden') })`);
  check('morte: controle bloqueado e painel de morte', !dead.alive && dead.panel);

  // pausa / menus
  await ev('window.__pz.game.pause()'); await sleep(300);
  await page.screenshot({ path: join(out, 'smoke_pause.png') });
  const pauseVisible = await ev(`!document.getElementById('menu-pause').classList.contains('hidden')`);
  await page.click('#btn-pause-settings'); await sleep(200);
  await page.screenshot({ path: join(out, 'smoke_settings.png') });
  const settingsBuilt = await ev(`document.querySelectorAll('#menu-settings .set-row').length`);
  check('menu de pausa e configurações', pauseVisible && settingsBuilt >= 5, `${settingsBuilt} opções`);

  // FPS e memória (renderização software é lenta; medimos o custo relativo)
  await ev('window.__pz.game.resume()'); await sleep(300);
  const perf = await page.evaluate(async () => {
    const t0 = performance.now(); let frames = 0;
    await new Promise((res) => { const f = () => { frames++; if (performance.now() - t0 > 3000) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    return { fps: frames / ((performance.now() - t0) / 1000), heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0, tickMs: window.__pz.game.tickMs };
  });
  check('performance medida (software render)', perf.fps > 5, `${perf.fps.toFixed(1)} FPS · heap ${perf.heapMB.toFixed(0)} MB · sim ${perf.tickMs.toFixed(2)} ms/tick`);

  check('nenhum erro de console/exceção durante o teste', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('execução do teste', false, String(e && e.stack || e));
}

await browser.close();
server.stop();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
process.exit(failed.length ? 1 : 0);
