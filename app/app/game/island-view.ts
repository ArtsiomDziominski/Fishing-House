// Остров посреди реки (ISLE в shared/src/island.ts) — свой кадр, как дом изнутри (interior.ts). Палитра та же, что у карты
// причала: трава с тёмными пучками и цветами, светлая кромка и земляной откос над водой, тёмная полоса воды под ним, блики.
// На юго-западе — мостки с местом рыбака (та же картинка, что у причала), на юго-востоке — песчаный пляж с вытащенной
// лодкой, на поляне — костёр с брёвнами-скамейками, по северному краю — деревья, у берегов камыш и кувшинки.
// Только картинка: где суша, мостки, деревья и лодка, решают числа ISLE, по ним же ходят клиент и сервер.
// Остров рисуется один раз в фон; деревья, камни, брёвна и лодка — отдельными картинками (pieces), их движок ставит в
// общую очередь по нижнему краю (base): кто стоит выше этого края, того они закрывают.

import { ISLE, ISLE_TREES, onBeach, onIsle, type IsleTree } from '@fh/shared';
import { paintBoat } from './boats.ts';
import pierUrl from '../assets/island/pier.png';
import oakUrl from '../assets/island/oak.png';
import spruceUrl from '../assets/island/spruce.png';
import birchUrl from '../assets/island/birch.png';
import appleUrl from '../assets/island/apple.png';
import pineUrl from '../assets/island/pine.png';
import greenUrl from '../assets/island/green.png';
import crownUrl from '../assets/island/crown.png';
import bushUrl from '../assets/island/bush.png';

// Картинки острова: мостки (сняты с карты причала) и деревья (те же, что растут вокруг причала). Грузит их движок.
export type IsleArt = 'pier' | IsleTree;
export const ISLE_ART: Record<IsleArt, string> = {
  pier: pierUrl, oak: oakUrl, spruce: spruceUrl, birch: birchUrl, apple: appleUrl, pine: pineUrl, green: greenUrl, crown: crownUrl, bush: bushUrl,
};

type Ctx = CanvasRenderingContext2D;
const { W, H } = ISLE;

const PAL = {
  grass: ['7b9431', '79952f', '7a9632', '7b952f'], grassDark: '718b2b', tuft: ['496a14', '3d5e0d'], shine: '8fae45', lip: ['98b434', '9ab338'],
  flower: 'fcf4b1', flowerMid: 'e8b93a', pink: 'e59ab0', shade: '62802a',
  sand: ['e3c788', 'dcc07f', 'e8cf93'], speck: 'c9a866', shell: 'f6efe0', wetSand: 'c8a868', sandLip: 'f1dca5',
  path: ['b2743e', 'b0753e', 'af733c'], pathDark: '8c5a32',
  ink: '110d00', bank: ['a46439', '8c4b2b', 'a26336'], bankLow: ['844632', '7a4c38', '81401e'], bankFoot: '5e2d20',
  water: '4384a5', deep: '2f5881', shadow: '2d527c', streak: '8ed0ef', dim: '6aa1bf', foam: 'd8f0f8',
  reed: ['4e6e22', '5a7a2a', '7b9431'], cattail: '6b3d1e', pad: '4f7a32', padLit: '6b9a3a', lotus: 'f0b0c8',
  rock: { dark: '614d4b', mid: '856a58', lit: 'a89474' }, log: { body: '6b3d1e', top: '8c5a32', cut: 'c49a64', ring: '8a5a30', ink: '2a1208' },
};

const hash = (x: number, y: number, s = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
// Плавный шум: значения в узлах сетки cw×ch, между ними — по прямой.
function smooth(x: number, y: number, cw: number, ch: number, s: number) {
  const gx = x / cw, gy = y / ch, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const make = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rgb = (hex: string) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] as const;
const pick = <T>(list: readonly T[], x: number, y: number, s = 0) => list[Math.floor(hash(x, y, s) * list.length)]!;

// Картинка в общей очереди: левый верх (x, y) и нижний край base.
export interface Piece { img: CanvasImageSource; x: number; y: number; base: number }

export function createIslandView(img: Record<IsleArt, HTMLImageElement>) {
  // ---------- суша, пляж, откос ----------
  const land = new Uint8Array(W * H), sand = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { land[y * W + x] = onIsle(x + 0.5, y + 0.5) ? 1 : 0; sand[y * W + x] = onBeach(x + 0.5, y + 0.5) ? 1 : 0; }
  const L = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && land[y * W + x] === 1;
  const S = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && sand[y * W + x] === 1;
  // Откос под южным краем: сколько строк он спускается к воде в этом столбце (у пляжа — песок полого уходит в воду).
  const cliff = (x: number) => 5 + Math.round(smooth(x, 0, 14, 1, 3) * 2);
  // Сколько строк над пикселем до суши (1..cliff+3), 0 — суши над ним рядом нет.
  const under = (x: number, y: number) => { for (let k = 1; k <= 10; k++) if (L(x, y - k)) return k; return 0; };

  // Вода: насколько далеко до берега — чтобы у берега была тень и рябь, а вдали глубина темнее.
  const far = new Uint16Array(W * H).fill(999);
  {
    const q: number[] = [];
    for (let i = 0; i < W * H; i++) if (land[i]) { far[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!, x = i % W, d = far[i]! + 1; if (d > 80) continue;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && far[j]! > d) { far[j] = d; q.push(j); }
    }
  }

  const bg = make(W, H), b = bg.getContext('2d')!, id = b.createImageData(W, H), px = id.data;
  const water = new Uint8Array(W * H);                   // где вода — для дождя, уток и ночных бликов
  const put = (x: number, y: number, hex: string) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const [r, g, bl] = rgb(hex), o = (y * W + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = bl; px[o + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (land[i]) {
      if (sand[i]) {                                     // пляж: песок с крапинами, у самой воды светлее
        put(x, y, !L(x, y + 1) ? PAL.sandLip : hash(x, y, 9) < 0.05 ? PAL.speck : pick(PAL.sand, x, y, 1));
      } else if (!L(x, y + 1) || !L(x, y + 2)) put(x, y, pick(PAL.lip, x, y, 2));   // светлая кромка над откосом
      else if (!L(x, y - 1) || !L(x - 1, y) || !L(x + 1, y)) put(x, y, PAL.tuft[0]!);   // край суши сверху и с боков — тёмный
      else put(x, y, smooth(x, y, 26, 18, 31) > 0.62 && hash(x, y, 32) < 0.8 ? PAL.grassDark : pick(PAL.grass, x, y, 3));   // трава пятнами темнее
      continue;
    }
    const k = under(x, y), top = k ? sand[(y - k) * W + x] : 0, c = cliff(x);
    if (k && top) {                                      // песок полого уходит в воду: мокрая полоса, пена, мель
      if (k === 1) { put(x, y, PAL.wetSand); continue; }
      if (k === 2) { put(x, y, hash(x, y, 4) < 0.7 ? PAL.foam : PAL.dim); water[i] = 1; continue; }
      if (k <= 4) { put(x, y, PAL.dim); water[i] = 1; continue; }
    } else if (k && k <= c) {                            // земляной откос: тёмный край, светлая земля, ниже — темнее
      put(x, y, k === 1 ? PAL.ink : k <= 3 ? pick(PAL.bank, x, y, 5) : k < c ? pick(PAL.bankLow, x, y, 6) : PAL.bankFoot);
      continue;
    } else if (k && k <= c + 3) { put(x, y, PAL.shadow); water[i] = 1; continue; }   // тень откоса на воде
    water[i] = 1;
    if (L(x - 1, y) || L(x + 1, y) || L(x, y + 1)) { put(x, y, PAL.ink); water[i] = 0; continue; }   // край суши сбоку и сверху
    const d = far[i]!;
    if (d === 2 && hash(x >> 1, y, 7) < 0.45) { put(x, y, PAL.streak); continue; }   // рябь у самого берега
    // как у причала: светлое мелководье полосой вдоль берега, дальше — глубина; край полосы волнистый, с редкими зубцами
    const edge = 21 + 14 * smooth(x, y * 2, 52, 52, 8) + (hash(x >> 1, y, 10) < 0.18 ? 2 : 0);
    put(x, y, d > edge ? PAL.deep : PAL.water);
  }
  // штрихи волн на открытой воде — как на карте у причала
  for (let n = 0; n < 2600; n++) {
    const x = Math.floor(hash(n, 1, 11) * W), y = Math.floor(hash(n, 2, 11) * H), len = 3 + Math.floor(hash(n, 3, 11) * 5);
    let ok = true; for (let k = -1; k <= len; k++) if (!water[y * W + x + k] || far[y * W + x + k]! < 5) ok = false;
    if (!ok || hash(n, 4, 11) > 0.16) continue;
    const deep = px[(y * W + x) * 4 + 1]! < 0x70;
    for (let k = 0; k < len; k++) put(x + k, y, deep ? PAL.dim : PAL.streak);
  }

  // ---------- трава: пучки, цветы, тропинки, тени ----------
  const grassAt = (x: number, y: number) => L(x, y) && L(x, y + 3) && L(x - 2, y) && L(x + 2, y) && !S(x, y) && L(x, y - 2);
  // тропинки: от пляжа к костру и от костра к мосткам
  const paths: [number, number][][] = [
    [[416, 238], [392, 224], [366, 210], [342, 198]],
    [[306, 200], [298, 214], [292, 228], [288, 238]],
  ];
  const near = new Float32Array(W * H).fill(9);          // насколько пиксель далёк от середины тропинки (меньше 1 — на ней)
  for (const line of paths) for (let s = 0; s < line.length - 1; s++) {
    const [ax, ay] = line[s]!, [bx, by] = line[s + 1]!, n = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let k = 0; k <= n; k++) {
      const cx = ax + (bx - ax) * k / n, cy = ay + (by - ay) * k / n;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = Math.round(cx + dx), y = Math.round(cy + dy); if (x < 0 || y < 0 || x >= W || y >= H) continue;
        near[y * W + x] = Math.min(near[y * W + x]!, Math.hypot((x - cx) / 5, (y - cy) / 3.4));
      }
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = near[y * W + x]! + (hash(x, y, 13) - 0.5) * 0.4;
    if (r > 1 || !grassAt(x, y)) continue;
    put(x, y, r > 0.8 ? PAL.shade : hash(x, y, 14) < 0.07 ? PAL.pathDark : pick(PAL.path, x, y, 15));
  }
  const isPath = (x: number, y: number) => { const o = (y * W + x) * 4; return px[o]! > 0xa0 && px[o + 1]! < 0x80; };
  // тени деревьев на траве: свет слева сверху — тень вправо
  for (const [kind, tx, ty] of ISLE.trees) {
    const sp = ISLE_TREES[kind], rx = Math.max(8, Math.round(img[kind].width * 0.32)), ry = kind === 'bush' ? 4 : 5;
    for (let y = ty - ry; y <= ty + ry; y++) for (let x = tx - rx + 4; x <= tx + rx + 4; x++) {
      const u = (x - tx - 4) / rx, v = (y - ty) / ry;
      if (u * u + v * v <= 1 && grassAt(x, y) && !isPath(x, y) && (hash(x, y, 16) < 0.85 || u * u + v * v < 0.6)) put(x, y, PAL.shade);
    }
    void sp;
  }
  // пучки травы, блики и цветы
  for (let n = 0; n < 5200; n++) {
    const x = Math.floor(hash(n, 1, 17) * W), y = Math.floor(hash(n, 2, 17) * H);
    if (!grassAt(x, y) || isPath(x, y)) continue;
    const r = hash(n, 3, 17);
    if (r < 0.55) { const c = pick(PAL.tuft, n, 4, 17); put(x, y, c); put(x + 2, y, c); put(x + 1, y + 1, c); }   // пучок «V»
    else if (r < 0.8) put(x, y, PAL.shine);
    else if (r < 0.88 && y > 120) { const c = hash(n, 5, 17) < 0.8 ? PAL.flower : PAL.pink; put(x, y - 1, c); put(x - 1, y, c); put(x + 1, y, c); put(x, y + 1, c); put(x, y, PAL.flowerMid); }
  }
  // песок: ракушки и камешки
  for (let n = 0; n < 500; n++) {
    const x = Math.floor(hash(n, 1, 19) * W), y = Math.floor(hash(n, 2, 19) * H);
    if (!S(x, y) || !S(x, y + 2)) continue;
    if (hash(n, 3, 19) < 0.3) { put(x, y, PAL.shell); put(x + 1, y, PAL.speck); } else put(x, y, PAL.speck);
  }

  // ---------- у берега: камыш и кувшинки ----------
  const wet = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && water[y * W + x] === 1;
  const REEDS: [number, number, number][] = [[146, 214, 7], [162, 222, 6], [186, 140, 5], [204, 230, 6], [522, 172, 5], [508, 244, 4]];
  for (const [cx, cy, n] of REEDS) for (let k = 0; k < n * 3; k++) {
    const x = Math.round(cx + (hash(k, cx, 21) - 0.5) * n * 4), y = Math.round(cy + (hash(k, cy, 22) - 0.5) * 6), h = 5 + Math.floor(hash(k, x, 23) * 6);
    if (!wet(x, y) || !wet(x, y - h)) continue;
    put(x - 1, y + 1, PAL.dim); put(x + 1, y + 1, PAL.dim);
    for (let j = 0; j < h; j++) put(x + (j > h - 3 && hash(k, 7, 24) < 0.5 ? 1 : 0), y - j, j === 0 ? PAL.reed[0]! : pick(PAL.reed, x, y - j, 25));
    if (hash(k, 9, 26) < 0.45) { put(x, y - h, PAL.cattail); put(x, y - h - 1, PAL.cattail); }
  }
  const PADS: [number, number, boolean][] = [[204, 252, true], [222, 266, false], [186, 242, false], [196, 274, false], [536, 214, true], [128, 204, false]];
  for (const [cx, cy, lotus] of PADS) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -4; dx <= 4; dx++) {
      if ((dx / 4.4) ** 2 + (dy / 2.4) ** 2 > 1 || !wet(cx + dx, cy + dy)) continue;
      if (dx >= 0 && dx <= 2 && dy === -1 + (dx >> 1)) continue;   // вырез у листа
      put(cx + dx, cy + dy, dy < 0 && dx < 1 ? PAL.padLit : PAL.pad);
    }
    if (lotus) { put(cx - 1, cy - 1, PAL.lotus); put(cx, cy - 2, PAL.lotus); put(cx + 1, cy - 1, PAL.lotus); put(cx, cy - 1, PAL.flowerMid); }
  }
  b.putImageData(id, 0, 0);

  // мостки — та же картинка, что у причала; под ними не вода
  const pier = ISLE.pier;
  b.drawImage(img.pier, pier.x, pier.y);
  {
    const c = make(pier.w, pier.h), x = c.getContext('2d')!; x.drawImage(img.pier, 0, 0);
    const d = x.getImageData(0, 0, pier.w, pier.h).data;
    for (let j = 0; j < pier.h; j++) for (let i = 0; i < pier.w; i++) if (d[(j * pier.w + i) * 4 + 3]) water[(pier.y + j) * W + pier.x + i] = 0;
  }

  // ---------- деревья, камни, брёвна, лодка ----------
  const pieces: Piece[] = [];
  for (const [kind, x, y] of ISLE.trees) { const sp = ISLE_TREES[kind]; pieces.push({ img: img[kind], x: x - sp.ax, y: y - sp.ay, base: y }); }
  // камень: бок, освещённый верх, тёмный низ и обводка; у воды — рябь
  for (const [cx, cy, rx, ry] of ISLE.rocks) {
    const hgt = Math.round(ry * 2.2), c = make(rx * 2 + 5, ry * 2 + hgt + 5), x = c.getContext('2d')!, ox = rx + 2, oy = hgt + 2;
    const dot = (i: number, j: number, hex: string) => { x.fillStyle = '#' + hex; x.fillRect(ox + i, oy + j, 1, 1); };
    const inRock = (i: number, j: number) => { const v = j > 0 ? j / ry : j / (ry + hgt * 0.8); return (i / rx) ** 2 + v * v <= 1; };
    for (let j = -ry - hgt; j <= ry; j++) for (let i = -rx; i <= rx; i++) {
      if (!inRock(i, j)) continue;
      const edge = !inRock(i - 1, j) || !inRock(i + 1, j) || !inRock(i, j - 1) || !inRock(i, j + 1);
      dot(i, j, edge ? PAL.ink : j < -hgt * 0.45 && i < rx * 0.4 ? PAL.rock.lit : j > ry * 0.2 || i > rx * 0.5 ? PAL.rock.dark : PAL.rock.mid);
    }
    if (wet(cx + rx + 1, cy) || wet(cx - rx - 1, cy)) for (let i = -rx - 1; i <= rx + 1; i += 2) if (wet(cx + i, cy + ry + 1)) put(cx + i, cy + ry + 1, PAL.streak);
    pieces.push({ img: c, x: cx - ox, y: cy - oy, base: cy + ry });
  }
  // бревно-скамейка у костра: лежит поперёк, круглое — сверху светлее, снизу темнее, кора полосками; с торца спил с кольцами
  for (const [cx, cy, rx, ry] of ISLE.logs) {
    const w = rx * 2 + 2, h = ry * 2 + 3, c = make(w + 2, h + 2), x = c.getContext('2d')!;
    const fill = (hex: string, i: number, j: number, ww: number, hh: number) => { x.fillStyle = '#' + hex; x.fillRect(i, j, ww, hh); };
    x.fillStyle = 'rgba(18, 22, 10, 0.3)'; x.fillRect(2, h, w - 1, 2);   // тень
    fill(PAL.log.ink, 1, 0, w - 4, h); fill(PAL.log.ink, 0, 1, w - 3, h - 2);
    for (let j = 1; j < h - 1; j++) fill(j < 2 ? PAL.log.top : j > h - 3 ? PAL.log.ring : PAL.log.body, 1, j, w - 5, 1);
    for (let i = 3; i < w - 6; i += 4) fill(PAL.log.ring, i + (i % 3), 2 + (i % 2), 2, 1);   // кора
    fill(PAL.log.ink, w - 5, 0, 4, h); fill(PAL.log.ink, w - 6, 1, 6, h - 2);   // торец — овал
    fill(PAL.log.cut, w - 5, 1, 4, h - 2); fill(PAL.log.cut, w - 6, 2, 1, h - 4); fill(PAL.log.ring, w - 4, 2, 2, h - 4); fill(PAL.log.cut, w - 4, 3, 1, Math.max(1, h - 6));
    pieces.push({ img: c, x: cx - rx - 1, y: cy - ry - 2, base: cy + ry });
  }
  // лодка, вытащенная носом на пляж: её пиксели — уже не вода
  const boatImg = paintBoat(2, ISLE.boat.flip), boat = { x: Math.round(ISLE.boat.x - boatImg.width / 2), y: ISLE.boat.y - boatImg.height, w: boatImg.width, h: boatImg.height };
  {
    const d = boatImg.getContext('2d')!.getImageData(0, 0, boat.w, boat.h).data;
    for (let j = 0; j < boat.h; j++) for (let i = 0; i < boat.w; i++) if (d[(j * boat.w + i) * 4 + 3]) water[(boat.y + j) * W + boat.x + i] = 0;
  }
  pieces.push({ img: boatImg, x: boat.x, y: boat.y, base: ISLE.boat.y });
  // колышек на пляже, к нему привязана лодка
  {
    const c = make(3, 8), x = c.getContext('2d')!; x.fillStyle = '#' + PAL.log.ink; x.fillRect(0, 0, 3, 8); x.fillStyle = '#' + PAL.log.top; x.fillRect(1, 1, 1, 6);
    const sx = ISLE.landing.x + 12, sy = ISLE.landing.y - 8;
    pieces.push({ img: c, x: sx - 1, y: sy - 7, base: sy });
    const rope = (x0: number, y0: number, x1: number, y1: number) => {   // верёвка провисает к лодке
      b.fillStyle = '#9a7a4a';
      for (let k = 0; k <= 20; k++) { const u = k / 20; b.fillRect(Math.round(x0 + (x1 - x0) * u), Math.round(y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * 3), 1, 1); }
    };
    rope(sx + 1, sy - 5, boat.x + (ISLE.boat.flip ? 6 : boat.w - 6), boat.y + 6);
  }

  // блики на воде: [x, y, длина, фаза] — мерцают, как у причала (World.sparkles)
  const sparkles: [number, number, number, number][] = [];
  for (let n = 0; n < 4000 && sparkles.length < 90; n++) {
    const x = Math.floor(hash(n, 1, 29) * W), y = Math.floor(hash(n, 2, 29) * H), len = 2 + Math.floor(hash(n, 3, 29) * 3);
    let ok = true; for (let k = 0; k < len; k++) if (!water[y * W + x + k] || far[y * W + x + k]! < 6) ok = false;
    if (ok) sparkles.push([x, y, len, hash(n, 4, 29)]);
  }

  const box = (r: { x: number; y: number; w: number; h: number }) => (x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  return {
    bg, water, pieces, sparkles,
    boat,                                                  // где картинка лодки на пляже: над ней — подсказка H
    onBoat: box(boat),                                     // клик по лодке — плыть обратно
    draw(ctx: Ctx) { ctx.drawImage(bg, 0, 0); },
    // вода ли здесь (клик сидящего рыбака по воде — рыбалка)
    wet: (x: number, y: number) => wet(Math.round(x), Math.round(y)) || (!L(x, y) && !land[Math.round(y) * W + Math.round(x)] && far[Math.round(y) * W + Math.round(x)]! > 0 && under(x, y) > 0),
  };
}
