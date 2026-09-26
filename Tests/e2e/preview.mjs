// Gera Assets/preview.jpg (1200×630) — imagem que aparece quando o link é compartilhado (WhatsApp, Discord…).
//   node Tests/e2e/preview.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, startServer } from './browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = await startServer(5190);
const browser = await launch({ gpu: true, width: 1200, height: 630 });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630 });
await page.goto(`${server.url}?autostart=1&nolock=1&seed=7&quality=HIGH`, { waitUntil: 'load' });
await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'playing'", { timeout: 60000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.evaluate("window.__pz.game.settings.update((d) => { d.video.quality = 'HIGH'; d.video.showFps = false; }); window.__pz.game._settingsChanged('video', 'quality');");
// defensores enfileirados na sala de controle, vistos de frente, durante a preparação (com o aviso do round)
await page.evaluate('window.__pz.teleport(16, 3.6, -Math.PI / 2)');
await page.evaluate('window.__pz.aimAt(36, 1.25, -1.2)');
await sleep(1200);
await page.screenshot({ path: join(root, 'Assets', 'preview.jpg'), type: 'jpeg', quality: 84 });
console.log('Assets/preview.jpg gerado');
await browser.close();
server.stop();
