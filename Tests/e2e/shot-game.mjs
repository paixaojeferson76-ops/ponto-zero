// Abre o jogo de verdade (autostart, sem pointer lock), captura screenshots e mostra erros do console.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, startServer } from './browser.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const server = await startServer(5198);
const browser = await launch({ gpu: process.argv.includes('--gpu'), width: 1280, height: 720 });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(`${server.url}?autostart=1&nolock=1&seed=7`, { waitUntil: 'load' });
try {
  await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'playing'", { timeout: 40000 });
} catch (e) {
  console.log('não entrou em playing:', await page.evaluate("window.__pz && window.__pz.state && window.__pz.state()"));
}
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: join(out, 'game_start.png') });
console.log('estado:', await page.evaluate('window.__pz.state()'));
console.log(logs.filter((l) => !/GPU stall|swiftshader|Failed to load resource/i.test(l)).slice(0, 30).join('\n'));
await browser.close();
server.stop();
