// E2E com janela real (não headless): pointer lock de verdade, mouse look, pausa por ESC (saída do lock),
// retomada por clique e FPS/CPU medidos durante uma luta com bots.   node Tests/e2e/lock.mjs
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, startServer } from './browser.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer(5192);
const browser = await launch({ gpu: true, headed: true, width: 1280, height: 760 });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|GPU stall/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack || ''}`));
const ev = (f) => page.evaluate(f);

try {
  await page.goto(server.url, { waitUntil: 'load' });
  await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'menu'", { timeout: 60000 });
  await page.click('#btn-play');
  await page.waitForFunction("window.__pz.state() === 'playing'", { timeout: 20000 }).catch(() => {});
  const locked = await ev("document.pointerLockElement === document.getElementById('game')");
  check('JOGAR ativa o pointer lock real e entra na partida', locked && (await ev('window.__pz.state()')) === 'playing', `state=${await ev('window.__pz.state()')}`);

  await sleep(6500);
  const yaw0 = await ev('window.__pz.player.view.yaw');
  await page.mouse.move(640, 360); await page.mouse.move(760, 360); await page.mouse.move(900, 380);
  await sleep(200);
  const yaw1 = await ev('window.__pz.player.view.yaw');
  console.log(`  mouse look: yaw ${yaw0.toFixed(3)} → ${yaw1.toFixed(3)} (movementX via CDP pode não ser gerado)`);

  await page.keyboard.down('KeyW'); await sleep(900); await page.keyboard.up('KeyW');
  const speed = await ev('window.__pz.player.body.speedXZ');
  check('teclado (W) move o jogador com pointer lock ativo', (await ev('window.__pz.player.pos.x')) !== -41 || speed > 0, `x=${(await ev('window.__pz.player.pos.x')).toFixed(2)}`);

  // luta com bots: mede FPS e CPU por frame
  await ev('window.__pz.advance(15)');
  const perf = await page.evaluate(async () => {
    const g = window.__pz.game;
    const times = [];
    let last = performance.now();
    await new Promise((res) => { const f = () => { const t = performance.now(); times.push(t - last); last = t; if (times.length > 300) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    times.shift();
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return { avgMs: avg, fps: 1000 / avg, p99: times[Math.floor(times.length * 0.99)], cpu: g.cpuMs, tick: g.tickMs, heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0, info: g.sm.renderInfo };
  });
  check('FPS sustentado (janela real, GPU)', perf.fps > 45, `${perf.fps.toFixed(0)} FPS · frame p99 ${perf.p99.toFixed(1)} ms · CPU/frame ${perf.cpu.toFixed(2)} ms · sim ${perf.tick.toFixed(3)} ms/tick · ${perf.info.calls} draw calls · heap ${perf.heap.toFixed(0)} MB`);

  // ESC (saída do pointer lock) → pausa; retomar com clique
  await ev('document.exitPointerLock()');
  await sleep(400);
  check('sair do pointer lock (ESC) pausa o jogo e mostra o menu', (await ev('window.__pz.state()')) === 'paused' && await ev("!document.getElementById('menu-pause').classList.contains('hidden')"));
  const tPause = await ev('window.__pz.session.time');
  await sleep(600);
  check('a simulação fica parada durante a pausa', (await ev('window.__pz.session.time')) === tPause);
  await sleep(1500);            // o Chrome bloqueia relock imediato após ESC
  await page.click('#btn-resume');
  await sleep(800);
  const st = await ev('window.__pz.state()');
  if (st !== 'playing') {
    await page.click('#click-to-play').catch(() => {});
    await sleep(600);
  }
  check('CONTINUAR volta ao jogo com pointer lock', (await ev('window.__pz.state()')) === 'playing' && await ev("document.pointerLockElement === document.getElementById('game')"), `state=${await ev('window.__pz.state()')}`);
  await page.screenshot({ path: join(out, 'lock_playing.png') });
  check('nenhum erro durante o teste com janela real', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  check('execução do teste', false, String((e && e.stack) || e));
}
await browser.close();
server.stop();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
process.exit(failed.length ? 1 : 0);
