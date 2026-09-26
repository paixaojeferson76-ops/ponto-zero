// Captura: bots vistos de perto (modelos, armas, hitboxes) e efeitos (fumaça/explosão/flash).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, startServer } from './browser.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const server = await startServer(5196);
const browser = await launch({ gpu: true, width: 1280, height: 720 });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(`${server.url}?autostart=1&nolock=1&seed=7`, { waitUntil: 'load' });
await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'playing'", { timeout: 60000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (f) => page.evaluate(f);
await sleep(800);

// defensores parados na sala de controle (preparação): olha para eles
await ev('window.__pz.teleport(22, 0, -Math.PI / 2)');
await ev('window.__pz.aimAt(36, 1.3, 0)');
await sleep(700);
await page.screenshot({ path: join(out, 'bots_front.png') });
await page.keyboard.press('F3'); await page.keyboard.press('F4'); await sleep(50);
await page.keyboard.press('F4'); await sleep(50); // nível 2 (hitboxes)
await ev('window.__pz.game._setDebug(2)');
await sleep(600);
await page.screenshot({ path: join(out, 'bots_hitboxes.png') });
await ev('window.__pz.game._setDebug(0)');

// granadas: fumaça e explosão
await ev('window.__pz.advance(6.2)');
await ev(`window.__pz.session.grenades.spawn(window.__pz.player, 'smoke', 28, 1, 0, 0, 0, 0)`);
await ev(`window.__pz.session.grenades.spawn(window.__pz.player, 'frag', 30, 1, -4, 0, 0, 0)`);
await ev('window.__pz.advance(0.05)');
await sleep(300);
for (let i = 0; i < 4; i++) { await ev('window.__pz.advance(0.4)'); await sleep(250); }
await page.screenshot({ path: join(out, 'fx_explosion.png') });
await sleep(1200);
await page.screenshot({ path: join(out, 'fx_smoke.png') });
console.log(logs.filter((l) => !/GPU stall|swiftshader|Failed to load resource/i.test(l)).slice(0, 20).join('\n'));
await browser.close();
server.stop();
