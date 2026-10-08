// Где можно копать червей: собирает shared/src/dig-data.ts по самой карте (app/public/assets/world.png).
// Копают на траве и на земле под ней — не на настиле причала, не на тропинках и дороге, не на камнях и не у воды.
// Поэтому годится точка, вокруг которой почти всё — трава (тропинки, настил и камни не зелёные), и вода не ближе WET
// пикселей. Что там ещё и ходить можно (не под домом, не в очаге, не в чаще), игра проверяет сама — по World.walk
// (WORMS.canDig в shared/src/worms.ts).
//
// Запуск после пересборки карты:  npm i --no-save sharp  &&  npm run build:dig  [-- --debug файл.png]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let sharp;
try { sharp = (await import('sharp')).default; } catch { console.error('Нужен пакет sharp:  npm i --no-save sharp'); process.exit(1); }

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = 3;            // окно вокруг точки: (2R+1)² пикселей
const SHARE = 0.85;     // какая доля окна должна быть травой (цветы и грибы в траве не мешают)
const WET = 12;         // ближе к воде — уже берег: не копаем

const { data, info } = await sharp(path.join(ROOT, 'app', 'public', 'assets', 'world.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = i => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
const grass = new Uint8Array(W * H), water = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const [r, g, b] = px(i);
  grass[i] = g > r + 6 && g > b + 12 ? 1 : 0;           // зелень: трава, листья
  water[i] = b > r + 25 && b >= g - 5 ? 1 : 0;          // синева: река
}
// Суммы по прямоугольникам — чтобы считать долю травы и есть ли вода в окне за одно сложение.
function sums(m) {
  const s = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s[(y + 1) * (W + 1) + x + 1] = m[y * W + x] + s[y * (W + 1) + x + 1] + s[(y + 1) * (W + 1) + x] - s[y * (W + 1) + x];
  return (x0, y0, x1, y1) => {                         // включительно, обрезано по карте
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
    return s[(y1 + 1) * (W + 1) + x1 + 1] - s[y0 * (W + 1) + x1 + 1] - s[(y1 + 1) * (W + 1) + x0] + s[y0 * (W + 1) + x0];
  };
}
const inGrass = sums(grass), inWater = sums(water);
const dig = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const n = (2 * R + 1) ** 2;
  dig[y * W + x] = inGrass(x - R, y - R, x + R, y + R) >= SHARE * n && !inWater(x - WET, y - WET, x + WET, y + WET) ? 1 : 0;
}

const runs = [];
for (let i = 0; i < dig.length; ) { let j = i; while (j < dig.length && dig[j] === dig[i]) j++; runs.push(dig[i], j - i); i = j; }
const js = `// Сгенерировано tools/build-dig.mjs из app/public/assets/world.png — руками не править.
// dig — растр ${W}×${H} парами [значение, длина]: трава, где можно копать червей (WORMS.canDig в worms.ts).
export const DIG_DATA = { w: ${W}, h: ${H}, dig: [${runs.join(',')}] };
`;
fs.writeFileSync(path.join(ROOT, 'shared', 'src', 'dig-data.ts'), js);
const debug = process.argv.includes('--debug') ? process.argv[process.argv.indexOf('--debug') + 1] : null;
if (debug) {
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { const c = dig[i] ? [255, 60, 255] : px(i).map(v => v * 0.6); out.set(c, i * 3); }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).resize(W * 3, H * 3, { kernel: 'nearest' }).png().toFile(debug);
}
console.log(`dig-data.ts: копать можно на ${dig.reduce((n, v) => n + v, 0)} px из ${W * H}; ${js.length} байт`);
