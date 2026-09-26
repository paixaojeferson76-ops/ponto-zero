// Isola efeitos: fumaça, explosão e flash — uma captura por efeito, com o jogador vivo e parado.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, startServer } from './browser.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const server = await startServer(5195);
const browser = await launch({ gpu: true, width: 1280, height: 720 });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(`${server.url}?autostart=1&nolock=1&seed=7&size=1`, { waitUntil: 'load' });
await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'playing'", { timeout: 60000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (f) => page.evaluate(f);
await sleep(500);
await ev('window.__pz.advance(6.5)');          // round vivo (sem bots atacantes/defensores com teamSize=1 → só 1 bot inimigo)
await ev('window.__pz.session.bots.forEach((b) => { b.think = () => {}; })');
await ev('window.__pz.player.receiver.invulnerable = true');

// praça aberta olhando para leste
await ev('window.__pz.teleport(-10, 0, -Math.PI / 2)');
await ev('window.__pz.player.view.pitch = 0.05');
await sleep(500);
await page.screenshot({ path: join(out, 'fx_0_base.png') });

await ev(`window.__pz.session.grenades.spawn(window.__pz.player, 'smoke', -3, 1, 0, 0, 0, 0)`);
await ev('window.__pz.advance(3.5)');
await sleep(600);
await page.screenshot({ path: join(out, 'fx_1_smoke.png') });

await ev(`window.__pz.session.world.smokes.length = 0`);
await ev(`window.__pz.session.grenades.spawn(window.__pz.player, 'frag', -3, 0.3, -3, 0, 0, 0)`);
await ev('window.__pz.advance(1.75)');
await sleep(120);
await page.screenshot({ path: join(out, 'fx_2_explosion.png') });

await ev(`window.__pz.session.grenades.spawn(window.__pz.bots ? window.__pz.player : window.__pz.player, 'flash', -6, 1.6, 0, 0, 0, 0)`);
await ev('window.__pz.advance(1.5)');
await sleep(100);
await page.screenshot({ path: join(out, 'fx_3_flash.png') });
console.log(logs.filter((l) => !/GPU stall|swiftshader|Failed to load resource/i.test(l)).slice(0, 20).join('\n'));
await browser.close();
server.stop();
