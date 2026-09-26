// Copia a build do Three.js de node_modules para vendor/ para o jogo rodar sem npm.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'three');
const dst = join(root, 'vendor', 'three');

if (!existsSync(src)) {
  console.error('node_modules/three não encontrado. Rode `npm install` primeiro.');
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
for (const f of ['build/three.module.js', 'build/three.core.js']) {
  copyFileSync(join(src, f), join(dst, f.split('/').pop()));
}
copyFileSync(join(src, 'LICENSE'), join(dst, 'LICENSE'));
console.log('vendor/three atualizado.');
