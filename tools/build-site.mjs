// Monta a pasta _site/ com SÓ o que o jogo precisa no navegador (sem testes, servidor, docs ou node_modules).
// Usada pelo GitHub Pages (.github/workflows/deploy.yml) e útil para testar a versão publicada localmente.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');

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

let files = 0, bytes = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p); else { files++; bytes += st.size; }
  }
})(out);
console.log(`_site pronto: ${files} arquivos, ${(bytes / 1048576).toFixed(2)} MB`);
