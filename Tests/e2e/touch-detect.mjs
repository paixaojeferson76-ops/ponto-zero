// E2E da DETECÇÃO de celular em cenários difíceis: navegador que mente sobre o ponteiro ("site para computador"),
// primeiro toque de dedo (plano B), preferência manual e seletor "Controles" do menu.
//   node Tests/e2e/touch-detect.mjs [--gpu]
import { launch, startServer } from './browser.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const gpu = process.argv.includes('--gpu');

const server = await startServer(5187);
const errors = [];

async function open(browser, { touchDevice, ua, patch, pref }) {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|GPU stall/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setUserAgent(ua || DESKTOP_UA);
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, hasTouch: !!touchDevice, isMobile: false, isLandscape: true });
  if (patch) {
    // faz o navegador "mentir": diz que o ponteiro principal é um mouse com hover (como alguns aparelhos/modos fazem)
    await page.evaluateOnNewDocument(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        const lie = { '(pointer: coarse)': false, '(hover: none)': false, '(pointer: fine)': true, '(hover: hover)': true, '(any-pointer: coarse)': false };
        if (q in lie) return { matches: lie[q], media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
        return real(q);
      };
    });
  }
  if (pref) await page.evaluateOnNewDocument((p) => localStorage.setItem('pontozero.inputMode', p), pref);
  await page.goto(server.url, { waitUntil: 'load' });
  await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'menu'", { timeout: 60000 });
  return page;
}
const isTouchMode = (page) => page.evaluate("document.body.classList.contains('touch')");
const center = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

const browser = await launch({ gpu, width: 844, height: 390 });
try {
  // 1) aparelho que mente totalmente (UA de PC + "mouse"): começa em modo PC, mas o 1º toque de dedo liga o modo celular
  let page = await open(browser, { touchDevice: true, patch: true });
  check('aparelho que mente começa reconhecido como PC (antes do 1º toque)', !(await isTouchMode(page)));
  const c = await center(page, '#btn-play');
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForFunction("window.__pz.state() === 'playing'", { timeout: 30000 });
  check('1º toque de dedo liga o modo celular automaticamente (plano B)', await isTouchMode(page));
  check('botões de toque aparecem na partida', await page.evaluate("!document.getElementById('touch-ui').classList.contains('hidden') && document.querySelectorAll('.tc-btn').length >= 9"));
  await page.evaluate('window.__pz.advance(6.5)');
  const s = await page.touchscreen.touchStart(100, 300);
  await s.move(100, 230); await sleep(800);
  check('e o joystick move o jogador', (await page.evaluate('window.__pz.player.body.speedXZ')) > 1.5);
  await s.end();
  await page.close();

  // 2) PC de verdade (mouse): clicar não liga o modo celular
  page = await open(browser, { touchDevice: false });
  check('PC comum: modo teclado e mouse', !(await isTouchMode(page)));
  await page.click('#btn-play');
  await page.waitForFunction("window.__pz.state() === 'paused-lock' || window.__pz.state() === 'playing'", { timeout: 30000 });
  check('PC: clicar com o mouse NÃO liga o modo celular', !(await isTouchMode(page)));
  await page.close();

  // 3) notebook com tela de toque: mouse primeiro → continua PC mesmo tocando depois
  page = await open(browser, { touchDevice: true, patch: true });
  await page.mouse.move(300, 200); await page.mouse.down(); await page.mouse.up();
  await sleep(100);
  const c3 = await center(page, '#btn-settings');
  await page.touchscreen.tap(c3.x, c3.y); await sleep(200);
  check('notebook com toque: se já usou o mouse, o toque não muda o modo', !(await isTouchMode(page)));
  await page.close();

  // 4) preferência manual "Toque" força o modo celular em qualquer aparelho
  page = await open(browser, { touchDevice: false, pref: 'touch' });
  check('preferência manual "Toque (celular)" força o modo de toque', await isTouchMode(page));
  check('o menu mostra o modo atual', /TOQUE/.test(await page.evaluate("document.getElementById('input-mode-note').textContent")));
  await page.close();

  // 5) preferência "Teclado e mouse" impede o modo celular mesmo com toque
  page = await open(browser, { touchDevice: true, patch: false, ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36', pref: 'desktop' });
  check('preferência "Teclado e mouse" desliga o modo celular', !(await isTouchMode(page)));
  await page.close();

  // 6) seletor "Controles" do menu principal alterna e recarrega
  page = await open(browser, { touchDevice: false });
  await page.select('#opt-input', 'touch');
  await page.waitForFunction("document.body.classList.contains('touch')", { timeout: 15000 });
  await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'menu'", { timeout: 60000 });
  check('seletor "Controles → Toque" recarrega já em modo celular', await isTouchMode(page) && (await page.evaluate("document.getElementById('opt-input').value")) === 'touch');
  await page.select('#opt-input', 'auto');
  await page.waitForFunction("!document.body.classList.contains('touch')", { timeout: 15000 });
  check('voltar para "Automático" restaura o PC', true);
  await page.close();

  check('nenhum erro de console durante o teste', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  check('execução do teste', false, String((e && e.stack) || e));
}
await browser.close();
server.stop();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
process.exit(failed.length ? 1 : 0);
