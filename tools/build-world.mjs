// Собирает мир из картинки-образца (art/reference.webp):
//   app/public/assets/world.png   — карта 240×320 без рыбака (причал под ним дорисован)
//   app/public/assets/fisher.png  — сидящий рыбак с удочкой, вырезанный с картинки пиксель в пиксель
//   app/public/assets/line.png    — его леска со всплеском (пока он не рыбачит, рисуется как на картинке)
//   app/public/assets/bucket.png, bucket-carry.png — ведро у дома: стоит на земле и в руке, ручкой вверх
//   app/public/assets/icon.png    — значок вкладки: лицо героя из app/app/game/hero.ts
//   shared/src/world-data.ts      — проходимость и «глубина» предметов из tools/world-shapes.mjs
//
// Игре этот скрипт не нужен — только чтобы пересобрать карту после правок.
// Запуск:  npm i --no-save sharp  &&  npm run build:world  [-- --debug папка]
// (через tsx — героя скрипт берёт прямо из исходника игры на TypeScript)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SHAPES from './world-shapes.mjs';
import { HERO } from '../app/app/game/hero.ts';

let sharp;
try { sharp = (await import('sharp')).default; } catch (e) { console.error('Нужен пакет sharp:  npm i --no-save sharp'); process.exit(1); }

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'app', 'public', 'assets');
const W = 240, H = 320;
const debugDir = process.argv.includes('--debug') ? process.argv[process.argv.indexOf('--debug') + 1] : null;

const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const hex = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const hash = (x, y, s = 0) => { let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

// ---------- 1. Картинка → пиксельная карта ----------
// Образец нарисован на сетке 240×320 «арт-пикселей» по 3,75 px и обрезан на 2 px слева и справа.
// Берём медиану из середины каждой клетки — так уходят размытые края и шум сжатия.
async function pixelize(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const SW = info.width, SH = info.height, P = 3.75, OX = -2;
  const at = (x, y) => { x = Math.min(SW - 1, Math.max(0, x)); y = Math.min(SH - 1, Math.max(0, y)); const i = (y * SW + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const med = a => { a.sort((u, v) => u - v); const n = a.length; return n % 2 ? a[(n - 1) / 2] : Math.round((a[n / 2 - 1] + a[n / 2]) / 2); };
  const out = Buffer.alloc(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const cx = OX + P * i + P / 2, cy = P * j + P / 2, xs = [], ys = [];
    for (let x = Math.floor(cx - 1.3); x <= Math.ceil(cx + 0.3); x++) if (Math.abs(x + 0.5 - cx) <= 1.0) xs.push(x);
    for (let y = Math.floor(cy - 1.3); y <= Math.ceil(cy + 0.3); y++) if (Math.abs(y + 0.5 - cy) <= 1.0) ys.push(y);
    const r = [], g = [], b = [];
    for (const y of ys) for (const x of xs) { const p = at(x, y); r.push(p[0]); g.push(p[1]); b.push(p[2]); }
    const o = (j * W + i) * 3; out[o] = med(r); out[o + 1] = med(g); out[o + 2] = med(b);
  }
  return out;
}

// ---------- 2. Где на карте рыбак ----------
function fisherMask(d) {
  const at = (x, y) => { const i = (y * W + x) * 3; return [d[i], d[i + 1], d[i + 2]]; };
  const body = new Uint8Array(W * H), rod = new Uint8Array(W * H), line = new Uint8Array(W * H);
  const X0 = 61, X1 = 83, Y0 = 224, Y1 = 266;
  // затравка: жёлтый плащ, кожа, синие штаны
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    const [r, g, b] = at(x, y);
    const yellow = r > 170 && g > 105 && b < 95 && r - b > 110;
    const skin = r > 165 && g > 115 && g < 195 && b > 85 && b < 160 && r - b > 50 && x >= 65 && x <= 76 && y >= 233 && y <= 253;
    const navy = b > r + 14 && lum([r, g, b]) < 90 && x >= 65 && x <= 77 && y >= 252 && y <= 259;
    if (yellow || skin || navy) body[y * W + x] = 1;
  }
  // сапоги того же цвета, что доски, поэтому заданы построчно
  const boots = { 259: [64, 74], 260: [64, 74], 261: [63, 74], 262: [64, 74], 263: [68, 74], 264: [69, 73] };
  for (const y in boots) for (let x = boots[y][0]; x <= boots[y][1]; x++) body[y * W + x] = 1;
  // тёмный контур вокруг, затем всё, что оказалось внутри фигуры (волосы, глаза)
  for (let pass = 0; pass < 2; pass++) {
    const add = [];
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      if (body[y * W + x] || lum(at(x, y)) > 52) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (body[(y + dy) * W + x + dx]) { near = true; break; }
      if (near) add.push(y * W + x);
    }
    for (const i of add) body[i] = 1;
  }
  const seen = new Uint8Array(W * H), st = [];
  for (let x = X0 - 1; x <= X1 + 1; x++) st.push([x, Y0 - 1], [x, Y1 + 1]);
  for (let y = Y0 - 1; y <= Y1 + 1; y++) st.push([X0 - 1, y], [X1 + 1, y]);
  while (st.length) {
    const [x, y] = st.pop(); if (x < X0 - 1 || x > X1 + 1 || y < Y0 - 1 || y > Y1 + 1) continue;
    const i = y * W + x; if (seen[i] || body[i]) continue; seen[i] = 1; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (!seen[y * W + x]) body[y * W + x] = 1;
  // не захватывать контуры сумки и ручки сачка, убрать оторванные пиксели
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (y < 225 || x > 81 || (y >= 246 && x > 80) || (y >= 257 && x > 76)) body[y * W + x] = 0;
  const keep = new Uint8Array(W * H), q = [[72, 240]];
  while (q.length) {
    const [x, y] = q.pop(); const i = y * W + x;
    if (x < X0 || x > X1 || y < Y0 || y > Y1 || keep[i] || !body[i]) continue; keep[i] = 1; q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  body.set(keep);
  // удилище: бурые и тёмные пиксели вдоль оси, левее фигуры
  for (let y = 237; y <= 252; y++) for (let x = 47; x <= 69; x++) {
    if (body[y * W + x]) continue;
    const cy = 240 + (x - 49) / (67 - 49) * 10; if (Math.abs(y - cy) > 2.6) continue;
    const [r, g, b] = at(x, y); if (r > b + 6 || lum([r, g, b]) < 40) rod[y * W + x] = 1;
  }
  // леска, кончик удилища и всплеск у воды
  for (let y = 238; y <= 283; y++) { const c = at(48, y); if (lum(c) > 150 || (y <= 240 && c[0] > 150)) line[y * W + 48] = 1; }
  for (let y = 274; y <= 287; y++) {
    const row = []; for (let x = 30; x <= 62; x++) row.push(lum(at(x, y))); row.sort((a, b) => a - b); const base = row[row.length >> 1];
    for (let x = 38; x <= 58; x++) if (lum(at(x, y)) > base + 14) line[y * W + x] = 1;
  }
  return { body, rod, line };
}

// ---------- 3. Что под рыбаком ----------
// Геометрия снята с картинки: настил — ромб на четырёх сваях, доски идут с наклоном 1:3,
// слева сзади к нему примыкает треугольный сачок, ручка которого лежит на берегу.
function repaint(d, m) {
  const out = Buffer.from(d);
  const at = (x, y) => { const i = (y * W + x) * 3; return [d[i], d[i + 1], d[i + 2]]; };
  const put = (x, y, c) => { const i = (y * W + x) * 3; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; };
  const hole = (x, y) => m.body[y * W + x] || m.rod[y * W + x] || m.line[y * W + x];
  const C = {
    outline: hex('140406'), gap: hex('4a2117'), gapSoft: hex('5e2c1c'),
    planks: [[hex('95502e'), hex('894c38'), 0.25], [hex('ab6a3a'), hex('ab6a3a'), 0], [hex('904b30'), hex('84432c'), 0.2],
      [hex('954f30'), hex('a05a33'), 0.18], [hex('a26334'), hex('8c4c2c'), 0.22], [hex('a46538'), hex('905034'), 0.2]],
    side: hex('6b3629'), sideB: hex('66372a'), dirtA: hex('a5643a'), dirtB: hex('86452e'), dirtC: hex('7a4835'),
    rail: hex('b0957f'), railHi: hex('c8b09a'),
  };
  const deckEdge = y => (y <= 250 ? 60 + (250 - y) * 0.75 : 60 - (y - 250) * 0.83);     // задняя левая кромка настила
  const frontEnd = x => Math.round(260 + (x - 62) * 0.364);                             // последняя строка верха настила
  const gaps = [x => 234 - (82 - x) / 3, x => 237 - (82 - x) / 3, x => 244.5 - (82 - x) / 3, x => 252.3 - (81 - x) / 3, x => 262 - (84 - x) / 3];
  const railX = y => 72 - (y - 224) * 0.3;                                              // правая дуга сачка
  const tri = (n, p) => { const q = ((n % (2 * p)) + 2 * p) % (2 * p); return q < p ? q : 2 * p - 1 - q; };
  const mesh = (x, y) => at(41 + tri(x - 41 + 3, 7), 245 + tri(y - 245 + 5, 11));         // сетка — зеркальной плиткой с чистого куска
  const pick = (x, y, a, b, t) => (hash((x + 3 * y) >> 2, Math.round(y - x / 3), 7) < t ? b : a);   // прожилки вдоль досок
  for (let y = 222; y <= 288; y++) for (let x = 36; x <= 84; x++) {
    if (!hole(x, y)) continue;
    const i = y * W + x; let c;
    if ((m.line[i] || m.rod[i]) && x <= 53 && y <= 241) {          // обод сачка под кончиком удилища — сдвиг вдоль обода
      c = !hole(x - 4, y + 2) ? at(x - 4, y + 2) : !hole(x + 4, y - 2) ? at(x + 4, y - 2) : mesh(x, y);
    } else if (m.line[i]) {                                        // леска и всплеск — ближайший пиксель воды или сетки слева
      let sx = x - 1; while (hole(sx, y)) sx--; c = at(sx, y);
    } else {
      const e = deckEdge(y);
      if (x < e - 0.5) {                                           // за настилом: сачок, его дуга, берег
        const r = Math.round(railX(y));
        if (y <= 239 && x === r) c = hash(x, y) < 0.3 ? C.railHi : C.rail;
        else if (y <= 239 && (x === r + 1 || x === r - 1) && x >= 66) c = C.outline;
        else if (x > r + 1 && y <= 230) c = y === 225 ? C.dirtC : pick(x, y, C.dirtA, C.dirtB, 0.4);
        else if (x > r + 1) c = C.gap;
        else c = mesh(x, y);
      } else if (Math.abs(x - e) <= 0.5) c = C.outline;
      else {
        const fe = frontEnd(x);
        if (y > fe + 3) c = y === fe + 4 ? C.outline : at(x - 14, y);
        else if (y > fe) c = pick(x, y, C.side, C.sideB, 0.35);
        else if (y <= 226) c = C.outline;
        else {
          const ys = gaps.map(g => g(x)); let band = 0; while (band < ys.length && y > ys[band] + 0.5) band++;
          if (ys.some(v => Math.round(v) === y)) c = hash(x, y, 3) < 0.25 ? C.gapSoft : C.gap;
          else { const p = C.planks[band]; c = pick(x, y, p[0], p[1], p[2]); }
        }
      }
    }
    put(x, y, c);
  }
  return out;
}

// ---------- 3б. Ведро у дома ----------
// Ведро вырезается в отдельную текстуру, а на карте под ним дорисовываются цоколь дома и трава.
const BUCKET_ROWS = {            // строка → [x0, x1] ведра вместе с контуром
  186: [154, 160], 187: [152, 162], 188: [151, 163], 189: [150, 164], 190: [150, 164], 191: [150, 164], 192: [150, 164],
  193: [150, 164], 194: [151, 164], 195: [151, 164], 196: [151, 163], 197: [151, 163], 198: [152, 163], 199: [152, 163],
  200: [152, 162], 201: [153, 161], 202: [155, 159],
};
function bucketMask(d) {
  const at = (x, y) => { const i = (y * W + x) * 3; return [d[i], d[i + 1], d[i + 2]]; };
  const body = new Uint8Array(W * H), shadow = new Uint8Array(W * H);
  for (const y in BUCKET_ROWS) for (let x = BUCKET_ROWS[y][0]; x <= BUCKET_ROWS[y][1]; x++) body[y * W + x] = 1;
  // собственная тень ведра на траве: всё у дна и справа, что заметно отличается от чистой травы
  const grass = hex('7a9632'), far = c => Math.abs(c[0] - grass[0]) + Math.abs(c[1] - grass[1]) + Math.abs(c[2] - grass[2]);
  for (let y = 198; y <= 204; y++) for (let x = 152; x <= 166; x++) if (!body[y * W + x] && far(at(x, y)) > 26) shadow[y * W + x] = 1;
  return { body, shadow };
}
function repaintBucket(buf, m) {
  const src = Buffer.from(buf);
  const at = (x, y) => { const i = (y * W + x) * 3; return [src[i], src[i + 1], src[i + 2]]; };
  const put = (x, y, c) => { const i = (y * W + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; };
  const C = { outline: hex('0d0502'), base: hex('37211e'), shadeA: hex('496d3b'), shadeB: hex('3c6123') };
  const wallFoot = x => 191.5 - (x - 149) * 0.58;                  // низ цоколя правой стены: уходит вверх вправо
  for (let y = 184; y <= 204; y++) for (let x = 148; x <= 167; x++) {
    const i = y * W + x; if (!m.body[i] && !m.shadow[i]) continue;
    const foot = wallFoot(x), d = y - foot; let c;
    if (x === 164 && y >= 189 && y <= 192) c = C.outline;          // левый край поленницы — общий контур с ведром
    else if (x === 163 && y === 188) c = C.outline;
    else if (d < -3) c = at(x, 182 + ((y - 182) % 4));             // цоколь: камень с видимых строк над ведром
    else if (d <= 0.5) c = C.base;                                 // тёмный низ цоколя
    else if (d <= 4.6 + hash(x, 7, 5) * 1.6) c = hash(x, y, 6) < 0.12 ? C.shadeB : C.shadeA;                    // тень от стены на траве
    else if (x >= 161 && y >= 193 && y <= 197 - Math.max(0, 164 - x)) c = hash(x, y, 8) < 0.3 ? C.shadeB : C.shadeA;   // тень от поленницы
    else c = at(x, 206 + (y % 3));                                 // трава
    put(x, y, c);
  }
}
// Ручка ведра, поднятая вверх: дуга от края до края над ободом. Возвращает высоту добавки сверху.
const HANDLE_UP = 5;
function drawHandle(buf, w, h) {                                    // buf — RGBA ведра, сдвинутого вниз на HANDLE_UP
  const dark = hex('0d0502'), steel = hex('656368'), light = hex('999594');
  const set = (x, y, c, force) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; if (buf[o + 3] && !force) return; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255; };
  const cx = 7, cy = HANDLE_UP + 4, rx = 6, ry = HANDLE_UP + 4;    // от ушек на ободе до вершины над ведром
  const pts = [];
  for (let a = 0; a <= 180; a += 2) { const t = a * Math.PI / 180; pts.push([Math.round(cx - rx * Math.cos(t)), Math.round(cy - ry * Math.sin(t))]); }
  for (const [x, y] of pts) if (y < HANDLE_UP + 1) { set(x, y, dark); set(x, y - 1, dark); }       // тёмная дуга в два пикселя
  for (const [x, y] of pts) if (y < HANDLE_UP + 1) set(x, y, Math.abs(x - cx) <= 2 ? light : steel, true);   // светлая жила по низу дуги
  for (const [x, y] of pts) if (y < HANDLE_UP + 1) { set(x - (x < cx ? 1 : 0) + (x > cx ? 1 : 0), y, dark); }
}

// ---------- 4. Разметка → растры ----------
function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function fillShape(shape, fn) {
  if (shape.rect) { const [x0, y0, x1, y1] = shape.rect; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(x, y); return; }
  const xs = shape.poly.map(p => p[0]), ys = shape.poly.map(p => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inPoly(shape.poly, x + 0.5, y + 0.5)) fn(x, y);
}
function bake(world) {
  const at = (x, y) => { const i = (y * W + x) * 3; return [world[i], world[i + 1], world[i + 2]]; };
  const walk = new Uint8Array(W * H);
  for (const poly of SHAPES.walk) fillShape({ poly }, (x, y) => { walk[y * W + x] = 1; });
  for (const s of SHAPES.solids) fillShape(s, (x, y) => { walk[y * W + x] = 0; });
  {                                                                // оставить только то, куда можно дойти от причала
    const reach = new Uint8Array(W * H), st = [SHAPES.points.seat.slice()];
    while (st.length) {
      const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x; if (reach[i] || !walk[i]) continue; reach[i] = 1; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    walk.set(reach);
  }

  // трава двора: заливка от затравок по зелёным пикселям — тёмные контуры кустов её останавливают
  const isGreen = c => c[1] > c[0] + 4 && c[1] > c[2] + 22;
  const isGrass = c => isGreen(c) && lum(c) > 58;
  const isTan = c => c[0] > c[1] + 28 && c[1] > c[2] + 22 && lum(c) > 100;
  let near = Uint8Array.from(walk);                                 // окрестность проходимой зоны
  for (let k = 0; k < 6; k++) {
    const nx = Uint8Array.from(near);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (!near[y * W + x]) {
      if (near[y * W + x - 1] || near[y * W + x + 1] || near[(y - 1) * W + x] || near[(y + 1) * W + x]) nx[y * W + x] = 1;
    }
    near = nx;
  }
  const grass = new Uint8Array(W * H), st = SHAPES.points.grassSeeds.map(p => p.slice());
  while (st.length) {
    const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = y * W + x; if (grass[i] || !near[i] || !isGrass(at(x, y))) continue;
    grass[i] = 1; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  const depth = new Uint16Array(W * H);
  for (const o of SHAPES.occluders) fillShape(o, (x, y) => {
    const i = y * W + x, c = at(x, y);
    if (o.carve === 'green' && isGreen(c)) return;
    if (o.carve === 'grass' && (grass[i] || (near[i] && isTan(c)))) return;
    if (o.base > depth[i]) depth[i] = o.base;
  });
  return { walk, depth, grass };
}
// Места для бликов на воде: [x, y, длина, фаза] — только там, где вокруг чистая вода.
function sparkles(world) {
  const at = (x, y) => { const i = (y * W + x) * 3; return [world[i], world[i + 1], world[i + 2]]; };
  const water = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const c = at(x, y), l = lum(c); return c[2] > c[0] + 45 && c[2] > c[1] + 8 && l > 55 && l < 125; };
  const out = [];
  for (let y = 222; y < H - 2; y++) for (let x = 2; x < W - 6; x++) {
    if (hash(x, y, 11) > 0.035) continue;
    const len = 2 + Math.floor(hash(x, y, 12) * 3);
    let ok = true;
    for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= len + 1; dx++) if (!water(x + dx, y + dy)) { ok = false; break; }
    if (ok && !out.some(s => Math.abs(s[0] - x) < 9 && Math.abs(s[1] - y) < 4)) out.push([x, y, len, Math.round(hash(x, y, 13) * 100) / 100]);
  }
  return out;
}
function rle(arr) {                                                  // [значение, длина, значение, длина, …]
  const out = []; let v = arr[0], n = 0;
  for (let i = 0; i < arr.length; i++) { if (arr[i] === v) n++; else { out.push(v, n); v = arr[i]; n = 1; } }
  out.push(v, n); return out;
}

// ---------- сборка ----------
(async () => {
  const src = await pixelize(path.join(ROOT, 'art', 'reference.webp'));
  const mask = fisherMask(src);
  const world = repaint(src, mask);
  const pail = bucketMask(src);
  repaintBucket(world, pail);
  fs.mkdirSync(ASSETS, { recursive: true });
  await sharp(world, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(ASSETS, 'world.png'));

  // Вырезка с картинки: пиксели под маской на прозрачном фоне. Возвращает прямоугольник и RGBA.
  const cut = (...masks) => {
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    const on = i => masks.some(m => m[i]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (on(y * W + x)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, buf = Buffer.alloc(w * h * 4);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x; if (!on(i)) continue;
      const o = ((y - y0) * w + (x - x0)) * 4; buf[o] = src[i * 3]; buf[o + 1] = src[i * 3 + 1]; buf[o + 2] = src[i * 3 + 2]; buf[o + 3] = 255;
    }
    return { x: x0, y: y0, w, h, buf };
  };
  const save = (name, w, h, buf) => sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(ASSETS, name));

  // сидящий рыбак с удочкой и отдельно леска со всплеском — так, как они на картинке
  const fisher = cut(mask.body, mask.rod), line = cut(mask.line);
  await save('fisher.png', fisher.w, fisher.h, fisher.buf);
  await save('line.png', line.w, line.h, line.buf);

  // ведро: стоит (с тенью, как на картинке) и в руке (ручка поднята, без тени)
  const stand = cut(pail.body, pail.shadow), bodyOnly = cut(pail.body);
  await save('bucket.png', stand.w, stand.h, stand.buf);
  const cw = bodyOnly.w, ch = bodyOnly.h + HANDLE_UP, carry = Buffer.alloc(cw * ch * 4);
  bodyOnly.buf.copy(carry, cw * HANDLE_UP * 4);
  drawHandle(carry, cw, ch);
  await save('bucket-carry.png', cw, ch, carry);
  // тень для ведра, переставленного в другое место: [dx, dy, плотность в %] — темнее там, где темнее на картинке
  const shadowPx = [];
  for (let y = stand.y; y < stand.y + stand.h; y++) for (let x = stand.x; x < stand.x + stand.w; x++) if (pail.shadow[y * W + x]) {
    const i = (y * W + x) * 3, dark = 1 - lum([src[i], src[i + 1], src[i + 2]]) / lum(hex('7a9632'));
    shadowPx.push([x - stand.x, y - stand.y, Math.round(Math.max(8, Math.min(60, dark * 115)))]);
  }
  const bucket = {
    x: stand.x, y: stand.y, w: stand.w, h: stand.h,                 // где текстура лежит на картинке
    baseX: bodyOnly.x + (bodyOnly.w >> 1), baseY: bodyOnly.y + bodyOnly.h - 1,   // точка опоры: середина дна
    bodyW: bodyOnly.w, bodyH: bodyOnly.h, handle: HANDLE_UP, shadow: shadowPx,
  };

  // значок вкладки: голова героя анфас, 19×19 → ×3
  const face = HERO.build().down[0], icon = Buffer.alloc(19 * 19 * 4);
  for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) for (let k = 0; k < 4; k++) icon[(y * 19 + x) * 4 + k] = face[(y * HERO.FW + x) * 4 + k];
  await sharp(icon, { raw: { width: 19, height: 19, channels: 4 } }).resize(57, 57, { kernel: 'nearest' }).png().toFile(path.join(ASSETS, 'icon.png'));

  const { walk, depth, grass } = bake(world);
  const tip = (() => { for (let y = 0; y < H; y++) if (mask.line[y * W + 48]) return y; return 239; })();
  const data = {
    w: W, h: H,
    fisher: { x: fisher.x, y: fisher.y, w: fisher.w, h: fisher.h },
    line: { x: line.x, y: line.y, w: line.w, h: line.h },
    rod: { x: 48, tipY: tip, waterY: SHAPES.points.waterY },         // леска: столбец, кончик удилища, уровень воды
    seat: { x: SHAPES.points.seat[0], y: SHAPES.points.seat[1], r: SHAPES.points.seatRadius },
    bucket,
    sparkles: sparkles(world),
    walk: rle(walk), depth: rle(depth),
  };
  const js = '// Сгенерировано tools/build-world.mjs из tools/world-shapes.mjs — руками не править.\n' +
    '// walk и depth — растры 240×320 парами [значение, длина]: проходимость и строка-опора предмета в точке.\n' +
    'export const WORLD_DATA = ' + JSON.stringify(data).replace(/,"(fisher|line|rod|seat|bucket|sparkles|walk|depth)"/g, ',\n  "$1"').replace('{"w"', '{\n  "w"').replace(/\}$/, '\n}') + ';\n';
  fs.writeFileSync(path.join(ROOT, 'shared', 'src', 'world-data.ts'), js);

  const count = a => a.reduce((s, v) => s + (v ? 1 : 0), 0);
  console.log(`world.png ${W}x${H}; fisher.png ${fisher.w}x${fisher.h} @ ${fisher.x},${fisher.y}; line.png ${line.w}x${line.h}; bucket.png ${stand.w}x${stand.h} @ ${stand.x},${stand.y}, опора ${bucket.baseX},${bucket.baseY}, тень ${shadowPx.length} px; bucket-carry.png ${cw}x${ch}; проходимо ${count(walk)} px; за предметами ${count(depth)} px; бликов ${data.sparkles.length}; world-data.ts ${js.length} байт`);

  if (debugDir) {                                                    // проверочные картинки: разметка поверх карты
    fs.mkdirSync(debugDir, { recursive: true });
    const S = 4, tint = (base, col, a) => base.map((v, k) => Math.round(v * (1 - a) + col[k] * a));
    const pal = [[255, 0, 0], [0, 200, 255], [255, 0, 255], [255, 255, 0], [0, 255, 120], [255, 140, 0], [140, 90, 255]];
    const levels = [...new Set(depth)].filter(v => v).sort((a, b) => a - b);
    const mk = async (name, fn) => {
      const b = Buffer.alloc(W * H * 3);
      for (let i = 0; i < W * H; i++) { const c = fn(i, [world[i * 3], world[i * 3 + 1], world[i * 3 + 2]]); b[i * 3] = c[0]; b[i * 3 + 1] = c[1]; b[i * 3 + 2] = c[2]; }
      await sharp(b, { raw: { width: W, height: H, channels: 3 } }).resize(W * S, H * S, { kernel: 'nearest' }).png().toFile(path.join(debugDir, name));
    };
    await mk('dbg_walk.png', (i, c) => (walk[i] ? tint(c, [255, 255, 255], 0.55) : c));
    await mk('dbg_depth.png', (i, c) => (depth[i] ? tint(c, pal[levels.indexOf(depth[i]) % pal.length], 0.6) : c));
    await mk('dbg_grass.png', (i, c) => (grass[i] ? tint(c, [255, 0, 255], 0.5) : c));
    await sharp(src, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(debugDir, 'dbg_source.png'));
    console.log('проверочные картинки →', debugDir);
  }
})();
