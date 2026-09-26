// Captura o mapa renderizado (visão de cima + primeira pessoa em pontos-chave) para revisão visual.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, startServer } from './browser.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const quality = process.argv[2] || 'MEDIUM';

const server = await startServer(5199);
const browser = await launch({ gpu: process.argv.includes('--gpu') });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${server.url}dev/mapview.html?quality=${quality}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });
console.log('build ms', await page.evaluate('window.__buildMs'));

const shots = [
  ['top', [0, 105, 0.01, 0, -Math.PI / 2, 46]],
  ['doca', [-42, 1.62, 0, -Math.PI / 2, 0, 68]],
  ['saguao', [-28, 1.62, 0, -Math.PI / 2, 0, 68]],
  ['praca', [-24, 1.62, 0, -Math.PI / 2, -0.02, 68]],
  ['galpao_norte', [-29, 1.62, -27.5, -Math.PI / 2, 0, 68]],
  ['sitio_a', [8.5, 1.62, -11.5, -Math.PI / 2 - 0.5, 0, 68]],
  ['sitio_b', [9, 1.62, 27, -Math.PI / 2 + 0.7, -0.05, 68]],
  ['sala_controle', [40, 1.62, 0, Math.PI / 2, 0, 68]],
];
for (const [name, cam] of shots) {
  const info = await page.evaluate((c) => window.setCam(...c), cam);
  await new Promise((r) => setTimeout(r, 150));
  await page.screenshot({ path: join(out, `map_${name}.png`) });
  console.log(name, JSON.stringify(info));
}
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 20).join('\n'));
await browser.close();
server.stop();
