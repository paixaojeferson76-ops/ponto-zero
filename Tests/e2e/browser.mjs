// Utilitário: sobe o servidor local em porta livre e abre o Chrome headless com puppeteer-core.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function findChrome() {
  const local = process.env.LOCALAPPDATA || '';
  return [
    process.env.BROWSER,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => p && existsSync(p));
}

export async function startServer(port) {
  const child = spawn(process.execPath, [join(ROOT, 'server', 'serve.mjs'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let url = null;
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('servidor não iniciou')), 8000);
    child.stdout.on('data', (d) => {
      const m = /servindo em (http:\/\/[^\s]+)/.exec(String(d));
      if (m) { url = m[1]; clearTimeout(to); resolve(); }
    });
    child.on('error', reject);
  });
  return { url, stop: () => child.kill() };
}

export async function launch({ gpu = true, width = 1280, height = 720, headed = false } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('Chrome/Edge não encontrado');
  const args = [
    `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--use-gl=angle',
  ];
  if (!gpu) args.push('--use-angle=swiftshader');
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-dev-shm-usage');
  const browser = await puppeteer.launch({ executablePath: exe, headless: headed ? false : 'new', args, defaultViewport: { width, height } });
  return browser;
}

export { http };
