// Testa o SITE MONTADO (npm run build → _site/), servido dentro de uma subpasta como no GitHub Pages
// (/ponto-zero/): carrega no PC e num celular emulado, inicia a partida e confere o carimbo de versão.
//   node Tests/e2e/site.mjs [--gpu]
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, '_site');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`); };

if (!process.argv.includes('--no-build')) {     // no CI o site já foi montado (com a versão real) no passo anterior
  const build = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-site.mjs')], { encoding: 'utf8', env: { ...process.env, GITHUB_SHA: 'abc1234567def' } });
  check('build do site conclui', build.status === 0, (build.stdout || build.stderr || '').trim().split('\n').pop());
}
const VERSION = (/\?v=([a-z0-9]+)/.exec(readFileSync(join(SITE, 'index.html'), 'utf8')) || [])[1];
check('index.html carimbado com uma versão', !!VERSION, VERSION);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.md': 'text/plain', '.txt': 'text/plain' };
const requested = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  requested.push(url.pathname + url.search);
  if (!url.pathname.startsWith('/ponto-zero/')) { res.writeHead(404); return res.end('fora da subpasta'); }
  let rel = decodeURIComponent(url.pathname.slice('/ponto-zero/'.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const full = normalize(join(SITE, rel));
  if (!full.startsWith(SITE)) { res.writeHead(403); return res.end(); }
  const st = await stat(full).catch(() => null);
  if (!st || !st.isFile()) { res.writeHead(404); return res.end('nao existe'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
  res.end(await readFile(full));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/ponto-zero/`;

const browser = await launch({ gpu: process.argv.includes('--gpu'), width: 1280, height: 720 });
const errors = [], failed = [];
const track = (page) => {
  page.on('console', (m) => { if (m.type() === 'error' && !/GPU stall/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
};

try {
  // ---- PC
  let page = await browser.newPage();
  track(page);
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'menu'", { timeout: 60000 });
  check('site montado abre o menu dentro da subpasta /ponto-zero/', true);
  const stamped = requested.filter((u) => u.includes('.js')).every((u) => u.includes(`?v=${VERSION}`) || u.includes('three.core.js'));
  check('todos os módulos foram pedidos com o carimbo de versão', stamped, `${requested.filter((u) => u.includes('?v=')).length} URLs carimbadas`);
  await page.click('#btn-play');
  await page.waitForFunction("window.__pz.state() === 'paused-lock' || window.__pz.state() === 'playing'", { timeout: 30000 });
  await page.close();

  // ---- celular emulado (autodetecção, sem parâmetros)
  page = await browser.newPage();
  track(page);
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36');
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction("window.__pz && window.__pz.state && window.__pz.state() === 'menu'", { timeout: 60000 });
  const c = await page.$eval('#btn-play', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForFunction("window.__pz.state() === 'playing'", { timeout: 30000 });
  check('celular emulado: modo toque + botões na tela no site montado', await page.evaluate("document.body.classList.contains('touch') && !document.getElementById('touch-ui').classList.contains('hidden')"));
  await page.evaluate('window.__pz.advance(20)');
  await page.close();

  check('nenhum arquivo faltando (404) e nenhum erro de console', failed.length === 0 && errors.length === 0, [...failed, ...errors].slice(0, 3).join(' | '));
} catch (e) {
  check('execução do teste', false, String((e && e.stack) || e));
}
await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} verificações OK`);
process.exit(bad.length ? 1 : 0);
