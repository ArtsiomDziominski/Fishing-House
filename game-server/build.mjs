// Сборка игрового сервера в один файл dist/index.mjs (и dist/migrate.mjs для миграций).
// Общий код (@fh/shared) встраивается — он лежит исходниками TypeScript; остальные пакеты берутся из node_modules.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const deps = (p) => Object.keys(JSON.parse(readFileSync(new URL(p, import.meta.url))).dependencies || {});
const external = [...new Set([...deps('./package.json'), ...deps('../shared/package.json')])].filter(d => !d.startsWith('@fh/'));
// пакеты подтягивают свои подпути (colyseus/plugins/…, drizzle-orm/pg-core) — их тоже не встраиваем
const externalAll = external.flatMap(d => [d, d + '/*']);

await build({
  entryPoints: { index: 'src/index.ts', migrate: '../shared/src/server/migrate.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: externalAll,
  logLevel: 'info',
});
