// Servidor estático local sem dependências. Só escuta em 127.0.0.1.
//   node server/serve.mjs [--port 5173] [--open] [--app-size 1600x900]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const wantsOpen = args.includes('--open');
const startPort = Number(argValue('--port', process.env.PORT || 5173));
const appSize = argValue('--app-size', '1600x900');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const BLOCKED_DIRS = ['node_modules', 'server', 'Tests', 'tools', 'docs', '.git', '.chrome-profile'];

async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const full = normalize(join(ROOT, rel));
    if (full !== ROOT && !full.startsWith(ROOT + sep)) return send(res, 403, 'Forbidden');
    const top = full.slice(ROOT.length + 1).split(sep)[0];
    if (BLOCKED_DIRS.includes(top)) return send(res, 404, 'Not found');
    const info = await stat(full).catch(() => null);
    if (!info || !info.isFile()) return send(res, 404, 'Not found');
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    res.end(body);
  } catch (err) {
    send(res, 500, String(err && err.message));
  }
}

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function listen(port, attemptsLeft) {
  const server = http.createServer(handle);
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) listen(port + 1, attemptsLeft - 1);
    else { console.error('Falha ao iniciar servidor:', err.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`PONTO ZERO servindo em ${url}  (Ctrl+C para encerrar)`);
    if (wantsOpen) openGame(url);
  });
}

function findBrowser() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

function openGame(url) {
  const exe = findBrowser();
  if (!exe) {
    console.log('Chrome/Edge não encontrado. Abra manualmente:', url);
    return;
  }
  const profile = join(ROOT, '.chrome-profile');
  const startedAt = Date.now();
  const child = spawn(exe, [
    `--app=${url}`,
    `--window-size=${appSize.replace('x', ',')}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
  ], { stdio: 'ignore' });
  // Fechou a janela do jogo → encerra o servidor (só se o navegador viveu o bastante para ser a janela real).
  child.on('exit', () => {
    if (Date.now() - startedAt > 5000) {
      console.log('Janela do jogo fechada — encerrando o servidor.');
      process.exit(0);
    }
  });
}

listen(startPort, 20);
