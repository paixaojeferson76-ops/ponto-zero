// Monta a pasta _site/ com SÓ o que o jogo precisa no navegador (sem testes, servidor, docs ou node_modules).
// Usada pelo GitHub Pages (.github/workflows/deploy.yml) e útil para testar a versão publicada localmente.
//
// Carimbo de versão: todos os endereços de módulos/estilos ganham "?v=<versão>". Assim, depois de uma nova
// publicação o navegador (principalmente o do celular, que guarda cache por ~10 min no GitHub Pages) nunca mistura
// arquivos velhos com novos: cada versão é um conjunto de URLs próprio e consistente.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const version = (process.env.GITHUB_SHA || String(Date.now())).slice(0, 10);

if (!existsSync(join(root, 'vendor', 'three', 'three.module.js'))) {
  console.error('vendor/three/three.module.js ausente — rode `npm install && npm run vendor`.');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const item of ['index.html', 'src', 'vendor', 'Assets', 'LICENSE']) {
  cpSync(join(root, item), join(out, item), { recursive: true });
}
writeFileSync(join(out, '.nojekyll'), '');

// ---- carimba as importações relativas dos módulos (from './x.js', import './x.js')
const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+?\.js)\2/g;
let stamped = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.js')) continue;
    const src = readFileSync(p, 'utf8');
    const next = src.replace(IMPORT_RE, (_, kw, q, path) => { stamped++; return `${kw}${q}${path}?v=${version}${q}`; });
    if (next !== src) writeFileSync(p, next);
  }
})(join(out, 'src'));

// ---- carimba as referências do index.html (script, estilos e o import map do three)
const htmlPath = join(out, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
const before = html;
html = html
  .replace(/(src="src\/main\.js)"/, `$1?v=${version}"`)
  .replace(/(href="src\/UI\/[a-z]+\.css)"/g, `$1?v=${version}"`)
  .replace(/("three":\s*"\.\/vendor\/three\/three\.module\.js)"/, `$1?v=${version}"`);
if (html === before) { console.error('index.html: nenhuma referência foi carimbada — o formato mudou?'); process.exit(1); }
writeFileSync(htmlPath, html);

let files = 0, bytes = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p); else { files++; bytes += st.size; }
  }
})(out);
console.log(`_site pronto (versão ${version}): ${files} arquivos, ${(bytes / 1048576).toFixed(2)} MB, ${stamped} importações carimbadas`);
