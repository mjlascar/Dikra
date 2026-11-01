// Arma la web en dist/web: lo que se publica para el iPhone y lo que va adentro del APK.
//
// Sin compilador ni empaquetador: Node le saca los tipos a cada .ts (stripTypeScriptTypes) y
// las importaciones pasan de .ts a .js. Por eso el código usa sólo TypeScript que se puede borrar.
//
// Uso: node scripts/armar-web.mjs            (versión: la de package.json + el commit)
//      DIKRA_VERSION=0.1.12 node scripts/...  (la que pone CI)
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'dist', 'web');

function version() {
  if (process.env.DIKRA_VERSION) return process.env.DIKRA_VERSION;
  const base = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version;
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `${base}-${commit}`;
  } catch {
    return `${base}-local`;
  }
}

const archivos = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? archivos(p) : [p];
});

const VERSION = version();
rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });

// El código: de .ts a .js
for (const ts of archivos(join(WEB, 'src')).filter((p) => p.endsWith('.ts'))) {
  let js = stripTypeScriptTypes(readFileSync(ts, 'utf8'), { mode: 'strip' });
  js = js.replace(/(\bfrom\s*['"])(\.{1,2}\/[^'"]+?)\.ts(['"])/g, '$1$2.js$3');
  js = js.replace(/'__VERSION__'/g, JSON.stringify(VERSION));
  const destino = join(SALIDA, relative(WEB, ts)).replace(/\.ts$/, '.js');
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, js);
}

// Lo demás, tal cual
for (const n of ['index.html', 'estilo.css', 'manifest.webmanifest', 'iconos', 'datos']) {
  cpSync(join(WEB, n), join(SALIDA, n), { recursive: true });
}

// El service worker guarda todo, menos los viajes de prueba (sólo los pide el modo simulado).
const lista = ['./', ...archivos(SALIDA).map((p) => relative(SALIDA, p)).filter((p) => p !== 'datos/demo.json').sort()];
const sw = readFileSync(join(WEB, 'sw.js'), 'utf8')
  .replace('__VERSION__', VERSION)
  .replace('__ARCHIVOS__', JSON.stringify(lista, null, 2));
writeFileSync(join(SALIDA, 'sw.js'), sw);

const peso = archivos(SALIDA).reduce((s, p) => s + statSync(p).size, 0);
console.log(`dist/web: Dikra ${VERSION}, ${lista.length} archivos, ${(peso / 1e6).toFixed(2)} MB`);
