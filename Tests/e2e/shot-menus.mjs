// Menus: principal, configurações (todas as abas), controles, equipamento e áudio inicializado.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, startServer } from './browser.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const server = await startServer(5194);
const browser = await launch({ gpu: true, width: 1280, height: 720 });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(`${server.url}?nolock=1`, { waitUntil: 'load' });
await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'menu'", { timeout: 60000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800);
await page.screenshot({ path: join(out, 'menu_main.png') });

await page.click('#btn-settings'); await sleep(300);
await page.screenshot({ path: join(out, 'menu_settings_video.png') });
for (const tab of ['mouse', 'audio', 'gameplay', 'crosshair']) {
  await page.click(`.tab[data-tab="${tab}"]`); await sleep(200);
  await page.screenshot({ path: join(out, `menu_settings_${tab}.png`) });
}
// altera o crosshair e confere persistência local
await page.evaluate(`(() => { const el = document.querySelector('.set-row input[type=range]'); el.value = 12; el.dispatchEvent(new Event('input')); })()`);
const stored = await page.evaluate("JSON.parse(localStorage.getItem('pontozero.settings.v1')).crosshair.size");
console.log('crosshair.size salvo no localStorage:', stored);
await page.click('#set-back'); await sleep(200);
await page.click('#btn-controls'); await sleep(200);
await page.screenshot({ path: join(out, 'menu_controls.png') });
await page.click('#ctl-back'); await sleep(200);

await page.click('#btn-play');
await page.waitForFunction("window.__pz.state() === 'playing'", { timeout: 60000 });
const audio = await page.evaluate(`({ ready: window.__pz.game.audio.ready, state: window.__pz.game.audio.ctx && window.__pz.game.audio.ctx.state, sounds: window.__pz.game.audio.bank ? window.__pz.game.audio.bank.buffers.size : 0 })`);
console.log('áudio:', JSON.stringify(audio));
await sleep(600);
await page.evaluate("window.__pz.session.match.phase === 'freeze' && (window.__pz.game._onAction('loadout', true))");
await sleep(400);
await page.screenshot({ path: join(out, 'menu_loadout.png') });
console.log(logs.filter((l) => !/GPU stall|swiftshader|Failed to load resource/i.test(l)).slice(0, 20).join('\n'));
await browser.close();
server.stop();
