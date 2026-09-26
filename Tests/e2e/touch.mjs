// E2E de celular: emula um Android deitado (844×390, multitoque) e joga só com toques.
//   node Tests/e2e/touch.mjs [--gpu]
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, startServer } from './browser.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer(5189);
const browser = await launch({ gpu: process.argv.includes('--gpu'), width: 844, height: 390 });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|GPU stall/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack || ''}`));
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const LAND = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true };
await page.setUserAgent(UA);
await page.setViewport(LAND);
const ev = (f) => page.evaluate(f);
const center = async (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, visible: r.width > 0 }; });
const tap = async (sel) => { const c = await center(sel); await page.touchscreen.tap(c.x, c.y); };
const hold = async (sel, ms) => { const c = await center(sel); const t = await page.touchscreen.touchStart(c.x, c.y); await sleep(ms); await t.end(); };

try {
  await page.goto(`${server.url}?touch=1`, { waitUntil: 'load' });
  await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'menu'", { timeout: 60000 });
  check('modo celular ativado (classe touch, menu carregado)', await ev("document.body.classList.contains('touch')"));
  await sleep(500);
  await page.screenshot({ path: join(out, 'touch_menu.png') });

  await tap('#btn-play');
  await page.waitForFunction("window.__pz.state() === 'playing'", { timeout: 30000 });
  check('tocar em JOGAR inicia a partida (sem pointer lock)', true);
  const defaults = await ev('({ q: window.__pz.game.settings.data.video.quality, d: window.__pz.game.settings.data.gameplay.difficulty, ph: window.__pz.game.sm.renderInfo.pixelRatio })');
  check('padrões de celular na 1ª vez (qualidade baixa, bots fáceis)', defaults.q === 'LOW' && defaults.d === 'EASY', JSON.stringify(defaults));
  check('camada de botões visível durante a partida', await ev("!document.getElementById('touch-ui').classList.contains('hidden') && document.querySelectorAll('.tc-btn').length >= 9"));
  await ev('window.__pz.advance(6.5)');
  await sleep(600);
  await page.screenshot({ path: join(out, 'touch_playing.png') });

  // ---- joystick (mover / correr)
  const p0 = await ev('({x: window.__pz.player.pos.x, z: window.__pz.player.pos.z})');
  const stick = await page.touchscreen.touchStart(100, 300);
  await stick.move(100, 254); await sleep(900);
  const walk = await ev('window.__pz.player.body.speedXZ');
  await stick.move(100, 220); await sleep(900);
  const runSpeed = await ev('window.__pz.player.body.speedXZ');
  await page.screenshot({ path: join(out, 'touch_stick.png') });
  await stick.end(); await sleep(400);
  const p1 = await ev('({x: window.__pz.player.pos.x, z: window.__pz.player.pos.z})');
  check('joystick move o jogador (caminha com meio deslocamento)', walk > 1.5 && walk < 4.3, `${walk.toFixed(2)} m/s`);
  check('empurrar o joystick até o fim faz correr', runSpeed > 5.2, `${runSpeed.toFixed(2)} m/s`);
  check('soltar o joystick para o personagem', (await ev('window.__pz.player.body.speedXZ')) < 0.3 && Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2);

  // ---- arrastar para olhar
  const yaw0 = await ev('window.__pz.player.view.yaw');
  const look = await page.touchscreen.touchStart(560, 140);
  await look.move(660, 140); await sleep(150); await look.end(); await sleep(150);
  const yaw1 = await ev('window.__pz.player.view.yaw');
  check('arrastar no lado direito gira a visão', Math.abs(yaw1 - yaw0) > 0.15, `Δyaw=${(yaw1 - yaw0).toFixed(3)} rad`);
  const pitch0 = await ev('window.__pz.player.view.pitch');
  const look2 = await page.touchscreen.touchStart(560, 200);
  await look2.move(560, 240); await sleep(150); await look2.end(); await sleep(100);
  check('arrastar para baixo abaixa a mira (eixo vertical)', (await ev('window.__pz.player.view.pitch')) < pitch0 - 0.05);

  // ---- multitoque: andar + olhar ao mesmo tempo
  const s2 = await page.touchscreen.touchStart(100, 300); await s2.move(100, 230);
  const l2 = await page.touchscreen.touchStart(560, 140); await l2.move(640, 140);
  await sleep(500);
  const both = await ev('({ speed: window.__pz.player.body.speedXZ })');
  await l2.end(); await s2.end(); await sleep(300);
  check('multitoque: andar e olhar ao mesmo tempo', both.speed > 2, `${both.speed.toFixed(2)} m/s`);

  // ---- botões
  await ev('window.__pz.teleport(-41, 0, 0, -Math.PI / 2)');
  await ev(`window.__counts = { shots: 0 }; window.__pz.session.events.on('weaponFired', (e) => { if (e.owner === window.__pz.player) window.__counts.shots++; });`);
  const ammo0 = await ev('window.__pz.player.weapons.active.ammo');
  await hold('.tc-fire', 500);
  const shots = await ev('window.__counts.shots');
  check('botão TIRO atira enquanto pressionado (e para ao soltar)', shots > 3 && (await ev('window.__pz.player.weapons.active.ammo')) < ammo0, `${shots} tiros`);
  await sleep(300);
  const afterRelease = await ev('window.__counts.shots');
  await sleep(300);
  check('soltar o TIRO interrompe o disparo', (await ev('window.__counts.shots')) === afterRelease);

  await tap('.tc-jump'); await sleep(200);
  check('botão PULAR tira do chão', await ev('!window.__pz.player.body.onGround'));
  await sleep(900);
  await tap('.tc-crouch'); await sleep(350);
  const crouched = await ev('window.__pz.player.body.crouched');
  await tap('.tc-crouch'); await sleep(350);
  check('botão AGACHAR liga e desliga', crouched && !(await ev('window.__pz.player.body.crouched')));
  await hold('.tc-ads', 500);
  const c = await center('.tc-ads');
  const adsT = await page.touchscreen.touchStart(c.x, c.y); await sleep(450);
  const ads = await ev('window.__pz.player.weapons.adsAmount');
  await adsT.end();
  check('botão MIRAR aproxima a mira (ADS)', ads > 0.5, `ads=${ads.toFixed(2)}`);
  await sleep(300);
  await tap('.tc-reload'); await sleep(300);
  check('botão RECAR. inicia a recarga', (await ev('window.__pz.player.weapons.phase')) === 'reload');
  await ev('window.__pz.advance(3.2)'); await sleep(200);
  await tap('.tc-swap'); await sleep(200);
  await ev('window.__pz.advance(1)'); await sleep(200);
  check('botão ARMA troca de arma', (await ev('window.__pz.player.weapons.activeKey')) === 'secondary', await ev('window.__pz.player.weapons.activeKey'));
  const slot = await center('.slot[data-key="primary"]').catch(() => null);
  if (slot) { await page.touchscreen.tap(slot.x, slot.y); await ev('window.__pz.advance(1)'); await sleep(200); }
  check('tocar no ícone "1" do HUD escolhe a arma primária', (await ev('window.__pz.player.weapons.activeKey')) === 'primary');
  await tap('.tc-nade'); await sleep(200);
  await ev('window.__pz.advance(2)'); await sleep(200);
  check('botão GRANADA arremessa a granada selecionada', (await ev('window.__pz.player.weapons.grenades.frag')) === 0);

  // ---- plantar com o botão USAR
  const site = await ev('window.__pz.session.map.sites.A');
  await ev(`window.__pz.player.health.reset(); window.__pz.teleport(${site.x}, ${site.z}, 0)`);
  await sleep(600);
  const useVisible = await ev("!document.querySelector('.tc-use').classList.contains('hidden')");
  await page.screenshot({ path: join(out, 'touch_use.png') });
  const uc = await center('.tc-use');
  const useT = await page.touchscreen.touchStart(uc.x, uc.y); await sleep(300);
  await ev('window.__pz.advance(3.6)'); await sleep(200);
  await useT.end();
  check('botão USAR aparece no sítio e planta a carga', useVisible && (await ev('window.__pz.session.match.bomb.planted')), `visível=${useVisible}`);

  // ---- pausa / retomar
  await tap('.tc-pause'); await sleep(300);
  check('botão de pausa abre o menu e esconde os controles', (await ev('window.__pz.state()')) === 'paused' && (await ev("document.getElementById('touch-ui').classList.contains('hidden')")));
  await page.screenshot({ path: join(out, 'touch_pause.png') });
  await tap('#btn-pause-settings'); await sleep(300);
  const hasTouchTab = await ev("!!document.querySelector('.tab[data-tab=\"touch\"]')");
  await page.evaluate("document.querySelector('.tab[data-tab=\"touch\"]').click()"); await sleep(250);
  await page.screenshot({ path: join(out, 'touch_settings.png') });
  check('configurações têm a aba TOQUE (sensibilidade, assistência de mira, tamanho)', hasTouchTab && (await ev("document.querySelectorAll('#menu-settings .set-row').length")) === 3);
  await tap('#set-back'); await sleep(200);
  await tap('#btn-resume'); await sleep(400);
  check('CONTINUAR volta ao jogo com os controles', (await ev('window.__pz.state()')) === 'playing' && (await ev("!document.getElementById('touch-ui').classList.contains('hidden')")));

  // ---- retrato: pausa sozinho e mostra o aviso
  await page.setViewport({ ...LAND, width: 390, height: 844, isLandscape: false });
  await sleep(600);
  check('em retrato: mostra "gire o celular" e pausa o jogo', (await ev("getComputedStyle(document.getElementById('rotate-hint')).display")) === 'flex' && (await ev('window.__pz.state()')) === 'paused');
  await page.screenshot({ path: join(out, 'touch_portrait.png') });
  await page.setViewport(LAND); await sleep(400);

  check('nenhum erro de console durante o teste', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  check('execução do teste', false, String((e && e.stack) || e));
}
await browser.close();
server.stop();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
process.exit(failed.length ? 1 : 0);
