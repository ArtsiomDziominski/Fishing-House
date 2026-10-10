// Карта мира (M или кнопка «Карта» — components/GameMap.vue): старая лоцманская карта в деревянной рамке, в палитре игры.
// Слева вверху в лесу бьёт родник, река петляет вниз направо и у моря разливается в широкое устье; на её северном берегу —
// свой причал с жёлтым домом и лодкой, выше по течению — причалы соседей, в устье — общий остров, за устьем — открытый океан
// с косяком и чайками. Где герой ещё не бывал (seen), лежит тёмный туман с рваным краем — новичок видит только свой причал.
// Холст — MAP.W×MAP.H арт-пикселей; окно увеличивает его целым множителем без сглаживания. Земля, лес и вода собираются
// один раз (base), туман — когда меняется seen; каждый кадр поверх — течение, прибой, косяк, чайки, дым из трубы и булавка
// «ты здесь». Подписи мест окно ставит HTML-ом по MAP_SPOTS. Только картинка: где что на самом деле, решают кадры мест.

import type { Area } from '@fh/shared';

type Ctx = CanvasRenderingContext2D;
export type MapSpot = Area | 'house';
export const MAP = { W: 320, H: 180 };
const { W, H } = MAP;
const IN = 8;                                          // рамка с краю: дерево и шкала старой карты; внутри неё — сама карта

// Места на карте: булавка «ты здесь» встаёт в (x, y), подпись окна — серединой верхнего края в (lx, ly); name — как место
// зовут, hidden — как его открыть, пока оно под туманом (свой причал с домом открыт всегда).
export const MAP_SPOTS: Record<MapSpot, { x: number; y: number; lx: number; ly: number; name: string; hidden: string }> = {
  pier: { x: 176, y: 96, lx: 178, ly: 103, name: 'Твой причал', hidden: '' },
  house: { x: 150, y: 80, lx: 134, ly: 69, name: 'Дом', hidden: '' },
  guest: { x: 101, y: 46, lx: 86, ly: 64, name: 'Причалы соседей', hidden: 'Не открыто — сходи в гости' },
  isle: { x: 224, y: 136, lx: 224, ly: 149, name: 'Общий остров', hidden: 'Не открыто — сядь в лодку у мостков' },
  sea: { x: 284, y: 72, lx: 284, ly: 80, name: 'Открытый океан', hidden: 'Не открыто — сядь в лодку у мостков' },
};

const PAL = {
  grass: ['79952f', '7b9431', '7a9632', '7b952f'], grassDark: '718b2b', tuft: '496a14', lip: '98b434', flower: 'fcf4b1', wet: '62802a',
  sand: ['e3c788', 'dcc07f', 'e8cf93'], speck: 'c9a866', wetSand: 'c8a868',
  path: ['b2743e', 'af733c'], pathDark: '8c5a32',
  bank: ['a46439', '8c4b2b'],
  water: '4384a5', deep: '2f5881', shadow: '2d527c', sea: ['2f5881', '2b5179', '284b72', '24446a'], shoal: '1d3a5e', fishBack: '142b47', scale: 'cfe3ee', fin: '8aa0b0', crest: '5b9cc0', streak: '8ed0ef', foam: 'd8f0f8',
  // кроны: контур, тело, полутень, блик — зелёные, тёмные еловые и жёлто-оливковые, как в лесу вокруг причала
  trees: [
    { ink: '17332e', body: '44632b', mid: '4b7231', lit: '688d35' },
    { ink: '19382b', body: '3f6931', mid: '597d30', lit: '79952f' },
    { ink: '0d1b1c', body: '18322e', mid: '2d5235', lit: '40692f' },
    { ink: '2e3514', body: '506025', mid: '948b28', lit: 'b0a23a' },
  ],
  treeShade: '5d7a28', floor: '2f4a1e',
  ink: '1c0806', paper: 'f4e3c1', parch: 'e8cf93', parchDark: 'c9a866',
  wood: { lit: 'c4824a', mid: '8e4c27', dark: '5e2d1b', deep: '45200f', grain: '7a3f22', plank: ['b2743e', '9c6235'], post: '5e2d20' },
  brass: { lit: 'fac708', mid: 'c27709', dark: '6b3d0a' },
  roof: { own: ['f6ca00', 'ea9b00'], red: ['d9653a', 'a8432a'], blue: ['6d8fa6', '4d6c80'], green: ['7fa03e', '5a7a2a'] },
  wall: 'a8693a', door: '421b1c', glass: '4d6c80',
  rock: ['8a8178', '6a625c', 'b0a89c'],
  pin: { ink: '240702', red: 'e0502c', dark: 'a8341c', lit: 'ffd9a8' },
  ring: 'fac708',
  gull: { white: 'f6f6f0', grey: 'b8c0ca' },
  lighthouse: { white: 'f2ede0', red: 'c9532d' }, hay: { ink: '8a6a20', lit: 'e8c860', mid: 'c9a43a' },
  fire: ['fac708', 'f08a1e', 'd9502e'], smoke: ['e8e4dc', 'c9c4bb'],
  // туман: от глубокого к светлому краю; знак вопроса в нём едва виден
  fog: ['0b1018', '0e1520', '111a27', '15202f'], fogEdge: '1c2a3d', fogMark: '2c3d57',
};

const hash = (x: number, y: number, s = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
// Плавный шум: значения в узлах сетки cw×ch, между ними — по прямой (как в island-view.ts).
function smooth(x: number, y: number, cw: number, ch: number, s: number) {
  const gx = x / cw, gy = y / ch, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const bay = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)]!;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rgb = (hex: string) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] as const;
const pick = <T>(list: readonly T[], x: number, y: number, s = 0) => list[Math.floor(hash(x, y, s) * list.length)]!;
const make = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
const dot = (c: Ctx, x: number, y: number, hex: string, w = 1, h = 1) => { c.fillStyle = '#' + hex; c.fillRect(Math.round(x), Math.round(y), w, h); };
// Залитый эллипс строками — без сглаживания, как всё в игре.
function blob(c: Ctx, x: number, y: number, rx: number, ry: number, hex: string) {
  if (rx < 0.5 || ry < 0.5) { dot(c, x, y, hex); return; }
  c.fillStyle = '#' + hex;
  for (let dy = -Math.floor(ry); dy <= Math.floor(ry); dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.35)) ** 2)));
    c.fillRect(Math.round(x) - half, Math.round(y) + dy, half * 2 + 1, 1);
  }
}
// Картинка из строк: символ — цвет из pal, '.' — пусто.
function sprite(c: Ctx, rows: readonly string[], pal: Record<string, string>, x: number, y: number) {
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') dot(c, x + i, y + j, pal[row[i]!]!); });
}

// ---------- география ----------

// Русло: середина и полуширина — от родника в лесу (слева вверху) к устью (справа внизу), где река уходит в океан.
const RIVER: readonly (readonly [number, number, number])[] = [
  [25, 21, 1.6], [29, 28, 1.8], [26, 35, 2], [31, 43, 2.2], [42, 50, 2.5], [56, 57, 2.8], [72, 60, 3], [88, 56, 3.2],
  [102, 49, 3.4], [116, 49, 3.6], [128, 56, 3.9], [135, 67, 4.2], [140, 79, 4.5], [150, 90, 4.8], [164, 95, 5.2],
  [180, 96, 5.8], [194, 100, 6.5], [203, 110, 7.5], [206, 122, 9], [212, 132, 12], [226, 138, 16], [244, 142, 20],
  [266, 145, 25], [290, 147, 30],
];
const SPRING = { x: 24, y: 18, rx: 6, ry: 4 };          // озерцо-родник в лесу, откуда она начинается
const ISLE_AT = { x: 225, y: 137, rx: 11, ry: 5 };      // общий остров в устье
const coast = (y: number) => 283 - 0.3 * y + (smooth(0, y, 1, 16, 9) - 0.5) * 8;   // берег океана: правее него — вода
const HOME = { x: 150, y: 78 };                         // свой дом (дверь); мостки — правее, в реку (MAP_SPOTS.pier)
// Соседи выше по течению: дом (дверь), мостки (откуда и куда — к воде), цвет крыши; лодка — у мостков.
const NEIGHBOURS = [
  { x: 95, y: 40, pier: { x: 100, y: 44, dx: 0, dy: 1 }, roof: 'red' },
  { x: 64, y: 72, pier: { x: 69, y: 63, dx: 0, dy: -1 }, roof: 'blue' },
  { x: 42, y: 39, pier: { x: 35, y: 42, dx: -1, dy: 0 }, roof: 'green' },
] as const;
// Чья это земля: каждая точка принадлежит месту с ближайшим зерном (расстояние множится на вес k — у причала он меньше,
// поэтому его клочок — круглое пятно вокруг дома). Не открыто место — весь его клочок под туманом.
const SEEDS: { area: Area; x: number; y: number; k: number }[] = [
  { area: 'pier', x: 164, y: 86, k: 0.62 },
  { area: 'guest', x: 100, y: 44, k: 1 }, { area: 'guest', x: 64, y: 66, k: 1 }, { area: 'guest', x: 36, y: 40, k: 1 },
  { area: 'guest', x: 40, y: 120, k: 1 }, { area: 'guest', x: 160, y: 16, k: 1 }, { area: 'guest', x: 120, y: 145, k: 1.1 },
  { area: 'isle', x: 224, y: 136, k: 1 }, { area: 'isle', x: 210, y: 108, k: 1 }, { area: 'isle', x: 196, y: 162, k: 1 }, { area: 'isle', x: 226, y: 66, k: 1.2 },
  { area: 'isle', x: 160, y: 160, k: 1.1 }, { area: 'isle', x: 204, y: 40, k: 1.1 }, { area: 'sea', x: 252, y: 22, k: 1 },
  { area: 'sea', x: 298, y: 40, k: 1 }, { area: 'sea', x: 292, y: 110, k: 1 }, { area: 'sea', x: 280, y: 162, k: 1 },
];

interface Geo {
  water: Uint8Array;        // 0 — суша, 1 — река, 2 — океан
  sand: Uint8Array;         // песок у моря и пляж острова
  toLand: Uint16Array;      // у воды — сколько до суши
  toSea: Uint16Array;       // у суши — сколько до океана
  toWater: Uint16Array;     // у суши — сколько до любой воды (лес к ней не подходит)
  isle: Uint8Array;         // суша острова
  foam: number[];           // вода у песка — по ней бежит прибой
  path: { x: number; y: number }[];   // середина русла с шагом в пиксель — по ней плывут штрихи течения
}

const at = (x: number, y: number) => y * W + x;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
function riverAt(x: number, y: number) {
  let best = Infinity, hw = 1;
  for (let i = 0; i + 1 < RIVER.length; i++) {
    const [ax, ay, ah] = RIVER[i]!, [bx, by, bh] = RIVER[i + 1]!, dx = bx - ax, dy = by - ay;
    const t = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)), d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    const h = ah + (bh - ah) * t;
    if (d - h < best) { best = d - h; hw = h; }
  }
  return { d: best, hw };
}
const onIsle = (x: number, y: number) => ((x - ISLE_AT.x) / ISLE_AT.rx) ** 2 + ((y - ISLE_AT.y) / ISLE_AT.ry) ** 2 + (smooth(x, y, 4, 3, 21) - 0.5) * 0.5 < 1;

// Расстояние до ближайшей клетки, где src(i) верно, — волной по восьми соседям, не дальше cap.
function spread(src: (i: number) => boolean, cap: number) {
  const out = new Uint16Array(W * H).fill(cap), q: number[] = [];
  for (let i = 0; i < W * H; i++) if (src(i)) { out[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!, x = i % W, y = (i - x) / W, d = out[i]! + 1; if (d >= cap) continue;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox, ny = y + oy; if (!inside(nx, ny)) continue;
      const j = at(nx, ny); if (out[j]! > d) { out[j] = d; q.push(j); }
    }
  }
  return out;
}

function buildGeo(): Geo {
  const water = new Uint8Array(W * H), isle = new Uint8Array(W * H), sand = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = at(x, y), wob = (smooth(x, y, 6, 5, 1) - 0.5) * 1.6;
    if (x > coast(y)) water[i] = 2;
    else if (riverAt(x, y).d < wob || ((x - SPRING.x) / SPRING.rx) ** 2 + ((y - SPRING.y) / SPRING.ry) ** 2 < 1) water[i] = 1;
    if (onIsle(x, y)) { water[i] = 0; isle[i] = 1; }
  }
  const toLand = spread(i => !water[i], 60), toSea = spread(i => water[i] === 2, 40), toWater = spread(i => water[i]! > 0, 20);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = at(x, y); if (water[i]) continue;
    // песок: полоса вдоль океана (шире на мысах у устья) и южный пляж острова
    if (toSea[i]! <= 3 + smooth(x, y, 9, 7, 4) * 4) sand[i] = 1;
    else if (isle[i] && y >= ISLE_AT.y - 1 && toLand[i] === 0 && ((y + 1 < H && water[at(x, y + 1)]) || (y + 2 < H && water[at(x, y + 2)]) || (x + 1 < W && water[at(x + 1, y)]))) sand[i] = 1;
  }
  const foam: number[] = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = at(x, y); if (!water[i]) continue;
    if ([at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some(j => sand[j])) foam.push(i);
  }
  const path: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < RIVER.length - 2; i++) {
    const [ax, ay] = RIVER[i]!, [bx, by] = RIVER[i + 1]!, n = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let k = 0; k < n; k++) path.push({ x: ax + (bx - ax) * k / n, y: ay + (by - ay) * k / n });
  }
  return { water, sand, toLand, toSea, toWater, isle, foam, path };
}

// ---------- фон: земля, вода, лес, дома ----------

function paintGround(g: Geo, c: Ctx) {
  const id = c.createImageData(W, H), px = id.data;
  const put = (i: number, hex: string) => { const [r, gg, b] = rgb(hex), o = i * 4; px[o] = r; px[o + 1] = gg; px[o + 2] = b; px[o + 3] = 255; };
  const isWater = (x: number, y: number) => inside(x, y) && g.water[at(x, y)]! > 0;
  const isLand = (x: number, y: number) => inside(x, y) && !g.water[at(x, y)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = at(x, y), wt = g.water[i]!;
    if (!wt) {
      if (g.sand[i]) {
        const wetEdge = isWater(x, y + 1) || isWater(x + 1, y) || isWater(x - 1, y);
        put(i, wetEdge ? PAL.wetSand : hash(x, y, 5) < 0.08 ? PAL.speck : pick(PAL.sand, x, y, 6));
        continue;
      }
      let col = pick(PAL.grass, x, y, 1);
      if (smooth(x, y, 11, 8, 2) < 0.32 && bay(x, y) < 0.6) col = PAL.grassDark;
      const h = hash(x, y, 3);
      if (h < 0.03) col = PAL.tuft; else if (h > 0.9985) col = PAL.flower;
      if (forestAt(g, x, y) > 0.75 && bay(x, y) < 0.75) col = PAL.floor;   // под густым лесом — тёмная подстилка
      if (isWater(x, y + 1)) col = PAL.lip;                // светлая кромка над откосом
      else if (isWater(x, y - 1)) col = PAL.wet;           // южный берег уходит в воду полого
      put(i, col);
      continue;
    }
    // Откос под северным берегом: земля сверху — строка-две бурого обрыва, под ним — тень на воде.
    const sandy = (k: number) => inside(x, y - k) && g.sand[at(x, y - k)] === 1;
    const wide = g.toLand[i]! >= 2 || wt === 2;
    if (isLand(x, y - 1) && !sandy(1)) { put(i, PAL.bank[hash(x, y, 7) < 0.3 ? 1 : 0]!); continue; }
    if (isLand(x, y - 2) && !sandy(2) && wide) { put(i, PAL.bank[1]!); continue; }
    if ((isLand(x, y - 2) && !sandy(2)) || (isLand(x, y - 3) && !sandy(3) && wide)) { put(i, PAL.shadow); continue; }
    const d = g.toLand[i]!;
    let col: string;
    if (wt === 1) col = d >= 3 && !(d === 3 && bay(x, y) < 0.5) ? PAL.deep : PAL.water;
    else {
      // океан: у берега светлее, дальше — всё глубже, полосы глубины переходят друг в друга сеткой точек
      const depth = d < 2 ? -1 : (d - 4) / 9 + (smooth(x, y, 14, 10, 8) - 0.5) * 0.8, k = Math.floor(depth), f = depth - k;
      const band = depth < 0 ? -1 : Math.min(PAL.sea.length - 1, k + (f > bay(x, y) ? 1 : 0));
      col = band < 0 ? PAL.water : PAL.sea[band]!;
    }
    if (wt === 1 && d >= 2 && hash(x, y, 9) < 0.012) col = PAL.streak;   // блик неба на реке
    put(i, col);
  }
  c.putImageData(id, 0, 0);
  // волны на открытой воде — короткие гребешки, как на старых картах
  for (let y = IN + 2; y < H - IN - 2; y += 6) for (let x = IN + 2; x < W - IN - 4; x += 9) {
    const wx = x + Math.floor(hash(x, y, 11) * 6), wy = y + Math.floor(hash(x, y, 12) * 4);
    if (!inside(wx + 3, wy + 1) || g.water[at(wx, wy)] !== 2 || g.toLand[at(wx, wy)]! < 5 || hash(x, y, 13) < 0.35) continue;
    dot(c, wx + 1, wy, PAL.crest, 2); dot(c, wx, wy + 1, PAL.crest); dot(c, wx + 3, wy + 1, PAL.crest);
  }
}

// Где лес: гуще всего слева вверху и вдоль верхнего края, по полям — рощами; у воды, на песке, у домов и тропинок — пусто.
function forestAt(g: Geo, x: number, y: number) {
  const i = at(x, y);
  if (g.water[i] || g.sand[i] || g.isle[i] || g.toLand[i]! > 0 || inField(x, y, 4)) return 0;
  if (g.toWater[i]! < 3) return 0;
  let f = (smooth(x, y, 24, 18, 5) - 0.45) * 1.4;
  f += clamp01((62 - y) / 40) * 0.75 + clamp01((120 - x) / 70) * clamp01((110 - y) / 60) * 0.55;
  f -= clamp01((g.toSea[i]! < 40 ? 14 - g.toSea[i]! : 0) / 10) * 0.6;   // к морю лес редеет
  for (const c of CLEARINGS) { const d = Math.hypot(x - c.x, y - c.y); if (d < c.r) return 0; if (d < c.r + 7) f *= (d - c.r) / 7; }
  return f;
}
// Поля на южном лугу — лоскутами, полосами борозд: пшеница, зелень и вспаханная земля.
const FIELDS = [
  { x: 104, y: 118, w: 22, h: 11, rows: ['dcbc4c', 'c39a34'] },
  { x: 128, y: 121, w: 15, h: 13, rows: ['6f9a32', '5a7f28'] },
  { x: 106, y: 131, w: 19, h: 9, rows: ['9c6a3c', '8c5a32'] },
] as const;
const inField = (x: number, y: number, pad = 0) => FIELDS.some(f => x >= f.x - pad && x < f.x + f.w + pad && y >= f.y - pad && y < f.y + f.h + pad);
function paintFields(c: Ctx) {
  for (const f of FIELDS) {
    for (let y = 0; y < f.h; y++) dot(c, f.x, f.y + y, f.rows[Math.floor(y / 2) % 2]!, f.w, 1);
    // межа — низкая живая изгородь, с кустиками по ней
    dot(c, f.x - 1, f.y + f.h, PAL.tuft, f.w + 2, 1); dot(c, f.x + f.w, f.y - 1, PAL.tuft, 1, f.h + 1); dot(c, f.x - 1, f.y - 1, PAL.lip, f.w + 1, 1); dot(c, f.x - 1, f.y, PAL.lip, 1, f.h);
    for (let k = 3; k < f.w; k += 7) { dot(c, f.x + k, f.y + f.h, PAL.trees[0]!.mid, 2, 1); dot(c, f.x + k, f.y + f.h + 1, PAL.trees[0]!.ink, 2, 1); }
  }
  sprite(c, ['.oo.', 'oYYo', 'oYyo'], { o: PAL.hay.ink, Y: PAL.hay.lit, y: PAL.hay.mid }, 98, 124);   // стог у поля
}
const CLEARINGS = [
  { x: HOME.x + 1, y: HOME.y - 3, r: 13 }, { x: MAP_SPOTS.pier.x - 8, y: 86, r: 9 },
  ...NEIGHBOURS.map(n => ({ x: n.x + 1, y: n.y - 2, r: 8 })),
];

function tree(c: Ctx, x: number, y: number, r: number, p: typeof PAL.trees[number]) {
  const ry = Math.max(2, r * 0.82);
  blob(c, x + 1, y + 2, r, ry, PAL.treeShade);         // тень на траве — справа внизу, как от солнца в игре
  blob(c, x, y + 0.6, r, ry, p.ink);
  blob(c, x, y - 0.4, r - 0.8, ry - 0.8, p.body);
  blob(c, x - 0.5, y - 1, r - 1.8, ry - 1.8, p.mid);
  if (r >= 3.5) blob(c, x - 1.5, y - 2, r - 3.2, ry - 3, p.lit);
}

function paintForest(g: Geo, c: Ctx) {
  const list: { x: number; y: number; r: number; p: typeof PAL.trees[number] }[] = [];
  for (let gy = 0; gy < H / 4; gy++) for (let gx = 0; gx < W / 5; gx++) {
    const x = Math.round(gx * 5 + (gy % 2) * 2.5 + hash(gx, gy, 31) * 3), y = Math.round(gy * 4 + hash(gx, gy, 32) * 3);
    if (!inside(x, y)) continue;
    const f = forestAt(g, x, y);
    if (f <= 0 || hash(gx, gy, 33) > f) continue;
    const dark = smooth(x, y, 30, 22, 34), r = 3 + hash(gx, gy, 35) * 2.2 + clamp01(f - 0.7) * 1.5;
    if (g.toWater[at(x, y)]! < r + 1) continue;         // крона не нависает над водой
    const p = PAL.trees[dark < 0.3 ? 2 : hash(gx, gy, 36) < 0.08 ? 3 : dark > 0.62 ? 1 : 0]!;
    list.push({ x, y, r, p });
  }
  list.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const t of list) tree(c, t.x, t.y, t.r, t.p);
}

// Тропинки — пунктиром, как дороги на старых картах: от своего дома к мосткам и вверх по берегу к соседям.
const TRAILS = [
  [[HOME.x + 2, HOME.y + 2], [160, 84], [170, 87], [MAP_SPOTS.pier.x - 1, 89]],
  [[HOME.x - 5, HOME.y - 1], [146, 70], [140, 60], [130, 48], [118, 42], [104, 39], [100, 38]],
] as const;
function paintTrail(c: Ctx) {
  for (const trail of TRAILS) for (let i = 0, step = 0; i + 1 < trail.length; i++) {
    const [ax, ay] = trail[i]!, [bx, by] = trail[i + 1]!, n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let k = 0; k < n; k++, step++) {
      if (step % 3 === 2) continue;
      const x = Math.round(ax + (bx - ax) * k / n), y = Math.round(ay + (by - ay) * k / n);
      dot(c, x, y + 1, PAL.pathDark); dot(c, x, y, pick(PAL.path, x, y, 41));
    }
  }
}

const HOUSE_BIG = [
  '...ooooooo...',
  '..oYYYYYYYo..',
  '.oYYYYYYYYYo.',
  'oYYYYYYYYYYYo',
  'oyyyyyyyyyyyo',
  '.oWWWWWWWWWo.',
  '.oWggWWDDWWo.',
  '.oWggWWDDWWo.',
  '.ooooooooooo.',
];
const HOUSE_SMALL = [
  '..ooooo..',
  '.oYYYYYo.',
  'oYYYYYYYo',
  'oyyyyyyyo',
  '.oWWWWWo.',
  '.oWgWDWo.',
  '.ooooooo.',
];
const BOAT = ['.ooooo.', 'oAsssAo', '.ooooo.'];
const BOAT_UP = ['.o.', 'oAo', 'oso', 'oso', 'oAo', '.o.'];
function house(c: Ctx, rows: readonly string[], x: number, y: number, roof: readonly [string, string]) {
  // (x, y) — дверь: низ середины стены
  const w = rows[0]!.length, door = rows.findIndex(r => r.includes('D'));
  const dx = door >= 0 ? rows[door]!.indexOf('D') : Math.floor(w / 2);
  sprite(c, rows, { o: PAL.ink, Y: roof[0], y: roof[1], W: PAL.wall, g: PAL.glass, D: PAL.door }, x - dx, y - rows.length + 1);
}
// Мостки: доски от берега в воду на len пикселей по (dx, dy), сваи на конце.
function pier(c: Ctx, x: number, y: number, dx: number, dy: number, len: number) {
  for (let k = 0; k < len; k++) {
    const px = x + dx * k, py = y + dy * k;
    if (dy) { dot(c, px - 1, py, PAL.ink); dot(c, px, py, PAL.wood.plank[k % 2]!, 2); dot(c, px + 2, py, PAL.ink); }
    else { dot(c, px, py - 1, PAL.ink); dot(c, px, py, PAL.wood.plank[k % 2]!, 1, 2); dot(c, px, py + 2, PAL.ink); }
  }
  const ex = x + dx * len, ey = y + dy * len;
  if (dy) { dot(c, ex - 1, ey, PAL.wood.post); dot(c, ex + 2, ey, PAL.wood.post); }
  else { dot(c, ex, ey - 1, PAL.wood.post); dot(c, ex, ey + 2, PAL.wood.post); }
}
const boatPal = { o: PAL.ink, A: PAL.wood.lit, s: PAL.wood.mid };

function paintPlaces(g: Geo, c: Ctx) {
  paintTrail(c);
  // свой дом, мостки к воде и лодка у них — на ней уплывают на остров и в океан
  house(c, HOUSE_BIG, HOME.x, HOME.y, PAL.roof.own as [string, string]);
  pier(c, MAP_SPOTS.pier.x - 1, 89, 0, 1, 8);
  sprite(c, BOAT, boatPal, MAP_SPOTS.pier.x + 3, 95);
  for (const n of NEIGHBOURS) {
    house(c, HOUSE_SMALL, n.x, n.y, PAL.roof[n.roof] as [string, string]);
    const p = n.pier;
    pier(c, p.x, p.y, p.dx, p.dy, p.dy ? 4 : 3);
    if (p.dy) sprite(c, BOAT, boatPal, p.x + 3, p.y + (p.dy > 0 ? 2 : -2));
    else sprite(c, BOAT_UP, boatPal, p.x - 2, p.y + 2);
  }
  // остров: пара деревьев, мостки на юго-запад, кострище на поляне, лодка на пляже
  tree(c, ISLE_AT.x - 4, ISLE_AT.y - 3, 3.2, PAL.trees[1]!);
  tree(c, ISLE_AT.x + 3, ISLE_AT.y - 3, 2.6, PAL.trees[0]!);
  pier(c, ISLE_AT.x - 9, ISLE_AT.y + 2, -1, 0, 3);
  dot(c, ISLE_AT.x + 1, ISLE_AT.y + 1, PAL.rock[1]!, 3); dot(c, ISLE_AT.x + 2, ISLE_AT.y + 1, PAL.wood.deep);
  sprite(c, BOAT, boatPal, ISLE_AT.x + 3, ISLE_AT.y + 3);
  // камни у берегов
  for (const [x, y] of [[50, 50], [124, 62], [190, 104], [214, 119], [200, 128], [236, 156]] as const) {
    if (g.water[at(x, y)]) continue;
    dot(c, x, y, PAL.rock[1]!, 2); dot(c, x, y - 1, PAL.rock[2]!); dot(c, x + 1, y - 1, PAL.rock[0]!);
  }
  // маяк на мысу у устья
  const lx = LIGHT.x, ly = LIGHT.y;
  sprite(c, ['.o.', 'oyo', 'ooo', 'oWo', 'oRo', 'oWo', 'oRo', 'oWo', 'ooo'], { o: PAL.ink, y: PAL.fire[0]!, W: PAL.lighthouse.white, R: PAL.lighthouse.red }, lx - 1, ly - 8);
}
const LIGHT = { x: 240, y: 121 };

// ---------- рамка, шкала, роза ветров ----------

function paintChrome(c: Ctx) {
  const ring = (k: number, hex: string) => { dot(c, k, k, hex, W - 2 * k, 1); dot(c, k, H - 1 - k, hex, W - 2 * k, 1); dot(c, k, k, hex, 1, H - 2 * k); dot(c, W - 1 - k, k, hex, 1, H - 2 * k); };
  ring(0, PAL.ink); ring(1, PAL.wood.lit); ring(2, PAL.wood.mid); ring(3, PAL.wood.dark); ring(4, PAL.ink);
  // волокна дерева
  for (let x = 2; x < W - 2; x++) for (const y of [2, H - 3]) if (hash(x, y, 51) < 0.22) dot(c, x, y, PAL.wood.grain, 2);
  for (let y = 2; y < H - 2; y++) for (const x of [2, W - 3]) if (hash(x, y, 52) < 0.22) dot(c, x, y, PAL.wood.grain, 1, 2);
  // шкала старой карты: светлые и тёмные отрезки по краю
  const SEG = 10;
  for (let x = 5; x < W - 5; x++) { const hex = Math.floor((x - 5) / SEG) % 2 ? PAL.wood.deep : PAL.parch; dot(c, x, 5, hex, 1, 2); dot(c, x, H - 7, hex, 1, 2); }
  for (let y = 7; y < H - 7; y++) { const hex = Math.floor((y - 5) / SEG) % 2 ? PAL.wood.deep : PAL.parch; dot(c, 5, y, hex, 2, 1); dot(c, W - 7, y, hex, 2, 1); }
  ring(7, PAL.ink);
  // медные заклёпки по углам
  for (const [x, y] of [[1, 1], [W - 4, 1], [1, H - 4], [W - 4, H - 4]] as const) {
    dot(c, x, y, PAL.brass.dark, 3, 3); dot(c, x, y, PAL.brass.mid, 2, 2); dot(c, x, y, PAL.brass.lit);
  }
  compass(c, ROSE.x, ROSE.y);
}
const ROSE = { x: 296, y: 30 };
// Роза ветров: четыре луча, у каждого светлая и тёмная половина; северный — красный, над ним «С».
function compass(c: Ctx, x: number, y: number) {
  const L = 7;
  for (const [dx, dy, lit, dark] of [[0, -1, PAL.pin.red, PAL.pin.dark], [1, 0, PAL.paper, PAL.parchDark], [0, 1, PAL.paper, PAL.parchDark], [-1, 0, PAL.paper, PAL.parchDark]] as const) {
    for (let k = 0; k <= L; k++) {
      const w = Math.round((L - k) / L * 2);
      for (let s = -w; s <= w; s++) {
        const px = x + dx * k + (dy ? s : 0), py = y + dy * k + (dx ? s : 0);
        dot(c, px, py, s < 0 ? lit : s > 0 ? dark : (k === L ? PAL.ink : lit));
      }
    }
  }
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) for (let k = 1; k <= 3; k++) dot(c, x + dx * k, y + dy * k, k === 3 ? PAL.ink : PAL.parchDark);
  dot(c, x, y, PAL.ink);
  text(c, 'С', x - 1, y - L - 7, PAL.paper);
}

// ---------- пиксельные буквы ----------

const GLYPHS: Record<string, readonly string[]> = {
  'Т': ['###', '.#.', '.#.', '.#.', '.#.'],
  'Ы': ['#...#', '#...#', '###.#', '#.#.#', '###.#'],
  'З': ['##.', '..#', '.#.', '..#', '##.'],
  'Д': ['.###.', '.#.#.', '.#.#.', '#####', '#...#'],
  'Е': ['###', '#..', '##.', '#..', '###'],
  'С': ['.##', '#..', '#..', '#..', '.##'],
  'Ь': ['#..', '#..', '##.', '#.#', '##.'],
  '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
  ' ': ['.', '.', '.', '.', '.'],
};
const textWidth = (s: string, k = 1) => [...s].reduce((w, ch) => w + ((GLYPHS[ch]?.[0]!.length ?? 3) + 1) * k, -k);
function text(c: Ctx, s: string, x: number, y: number, hex: string, k = 1) {
  c.fillStyle = '#' + hex;
  for (const ch of s) {
    const g = GLYPHS[ch]; if (!g) { x += 4 * k; continue; }
    g.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') c.fillRect(x + i * k, y + j * k, k, k); });
    x += (g[0]!.length + 1) * k;
  }
}

// ---------- туман ----------

// Туман над тем, что не открыто: m — насколько точка глубже в открытом, чем в закрытом (по весам SEEDS, с шумом для
// рваного края). Глубоко в закрытом — сплошная мгла с разводами, у края — сеткой точек, а открытое у самого края чуть темнеет.
function paintFog(seen: readonly Area[], c: Ctx) {
  const open = (a: Area) => a === 'pier' || seen.includes(a);
  if (SEEDS.every(s => open(s.area))) return;
  const id = c.createImageData(W, H), px = id.data;
  const put = (i: number, hex: string, a = 255) => { const [r, g, b] = rgb(hex), o = i * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let dOpen = Infinity, dShut = Infinity;
    for (const s of SEEDS) { const d = Math.hypot(x - s.x, y - s.y) * s.k; if (open(s.area)) dOpen = Math.min(dOpen, d); else dShut = Math.min(dShut, d); }
    const m = dShut - dOpen + (smooth(x, y, 10, 8, 61) - 0.5) * 12 + (smooth(x, y, 4, 3, 62) - 0.5) * 4, i = at(x, y);
    if (m < -5) {
      const v = smooth(x + y * 0.4, y, 18, 9, 63) * 3.2, k = Math.floor(v), f = v - k;
      put(i, PAL.fog[Math.min(3, k + (f > bay(x, y) ? 1 : 0))]!);
    } else if (m < 2) {
      if ((2 - m) / 7 > bay(x, y)) put(i, m < -2.5 ? PAL.fog[2]! : PAL.fogEdge);
      else put(i, PAL.fog[0]!, 120);
    } else if (m < 6 && ((6 - m) / 4) * 0.55 > bay(x + 1, y + 2)) put(i, PAL.fog[0]!, 110);
  }
  c.putImageData(id, 0, 0);
  for (const a of ['guest', 'isle', 'sea'] as const) {
    if (open(a)) continue;
    const s = MAP_SPOTS[a];
    text(c, '?', s.x - 2, s.y - 7, PAL.fog[0]!); text(c, '?', s.x - 3, s.y - 8, PAL.fogMark);   // с тенью — как выдавлен в тумане
  }
}

// ---------- то, что движется ----------

function paintLive(g: Geo, c: Ctx, t: number) {
  // течение: штрихи плывут по середине русла вниз, каждый со своим сдвигом поперёк
  const n = g.path.length;
  for (let k = 0; k < 26; k++) {
    const s = (k / 26 + t * 0.011 * (0.8 + hash(k, 1, 71) * 0.4)) % 1, j = Math.floor(s * (n - 2)), p = g.path[j]!, q = g.path[j + 1]!;
    const tx = q.x - p.x, ty = q.y - p.y, side = (hash(k, 2, 72) - 0.5) * 2 * riverAt(p.x, p.y).hw * 0.7;
    const x = Math.round(p.x - ty * side), y = Math.round(p.y + tx * side);
    if (!inside(x, y) || g.water[at(x, y)] !== 1 || g.toLand[at(x, y)]! < 1) continue;
    const fade = Math.sin(s * Math.PI * 9 + k);
    if (fade < -0.2) continue;
    dot(c, x, y, fade > 0.5 ? PAL.streak : PAL.crest);
    if (inside(x - 1, y) && g.water[at(x - 1, y)] === 1) dot(c, x - 1, y, PAL.crest);
  }
  // прибой: полосы пены бегут вдоль песка
  for (const i of g.foam) {
    const x = i % W, y = (i - x) / W;
    if (Math.sin(t * 1.6 - x * 0.35 + y * 0.2) > 0.25) dot(c, x, y, PAL.foam);
  }
  // гребешки на море поблёскивают
  for (let k = 0; k < 18; k++) {
    const x = Math.floor(240 + hash(k, 3, 73) * 72), y = Math.floor(IN + 4 + hash(k, 4, 74) * (H - 2 * IN - 8));
    if (!inside(x + 2, y) || g.water[at(x, y)] !== 2 || g.toLand[at(x, y)]! < 4) continue;
    const v = Math.sin(t * (0.7 + hash(k, 5, 75)) + k * 2.1);
    if (v > 0.55) { dot(c, x, y, PAL.streak, 2); if (v > 0.85) dot(c, x + 1, y - 1, PAL.foam); }
  }
  // косяк: светлое пятно кипящей воды, спины и искры рыбьих боков, выпрыгивающая рыбка; над ним кружат чайки, одна ныряет
  const sx = Math.round(SHOAL.x + Math.sin(t / 9) * 5), sy = Math.round(SHOAL.y + Math.cos(t / 7) * 2);
  for (let dy = -4; dy <= 4; dy++) for (let dx = -10; dx <= 10; dx++) {
    const x = sx + dx, y = sy + dy, e = (dx / 10.5) ** 2 + (dy / 4.4) ** 2;
    if (e > 1 || !inside(x, y) || g.water[at(x, y)] !== 2) continue;
    if (e > 0.7 && bay(x, y) > 0.5) continue;           // край пятна — сеткой, чтобы оно не было резким
    dot(c, x, y, e < 0.35 ? PAL.crest : PAL.water);     // над косяком вода светлее — рыба поднялась к самой поверхности
    const h = hash(x, y, 76);                           // и кипит: то тут, то там вспыхивают брызги
    if (h < 0.3 && Math.sin(t * 6 + h * 90) > 0.6) dot(c, x, y, h < 0.12 ? PAL.foam : PAL.streak);
  }
  for (let k = 0; k < 5; k++) {                         // спины рыб под водой
    const fx = sx + Math.round(Math.sin(t * 0.9 + k * 1.7) * 6), fy = sy - 2 + k % 4;
    dot(c, fx, fy, PAL.shoal, 2); dot(c, fx + (Math.sin(t * 0.9 + k * 1.7 + 0.3) > Math.sin(t * 0.9 + k * 1.7) ? 2 : -1), fy, PAL.fishBack);
    if (Math.sin(t * 4 + k * 2) > 0.8) dot(c, fx, fy, PAL.scale);
  }
  const jump = (t % 3.3) / 3.3;                         // рыбка выпрыгивает раз в несколько секунд
  if (jump < 0.22) { const a = jump / 0.22, jx = sx - 5 + Math.round(a * 6), jy = sy - Math.round(Math.sin(a * Math.PI) * 4); dot(c, jx, jy, PAL.scale, 2); dot(c, jx + (a < 0.5 ? 2 : -1), jy + 1, PAL.fin); }
  else if (jump < 0.32) { dot(c, sx + 1, sy, PAL.foam); dot(c, sx - 1, sy, PAL.foam); }
  for (let k = 0; k < 2; k++) {
    const a = t * 1.1 + k * Math.PI;
    gull(c, sx + Math.round(Math.cos(a) * 10), sy - 9 + Math.round(Math.sin(a) * 3), Math.floor(t * 3 + k * 1.5) % 2 === 0);
  }
  const dive = (t % 7) / 7;
  if (dive < 0.2) { const a = dive / 0.2; gull(c, sx + 4, sy - 16 + Math.round(a * a * 15), false, true); }
  else if (dive < 0.27) { dot(c, sx + 3, sy - 1, PAL.foam); dot(c, sx + 5, sy - 1, PAL.foam); dot(c, sx + 4, sy - 2, PAL.foam); }
  // дым из трубы своего дома и огонёк на острове
  for (let k = 0; k < 3; k++) {
    const ph = (t * 0.35 + k / 3) % 1, x = HOME.x + 3 + Math.round(Math.sin(ph * 5 + k) * 1.2 + ph * 3), y = HOME.y - 10 - Math.round(ph * 9);
    if (ph < 0.85 || bay(x, y) < 0.5) dot(c, x, y, PAL.smoke[ph < 0.4 ? 0 : 1]!, ph < 0.5 ? 2 : 1);
  }
  const fl = Math.floor(t * 8) % 3;
  dot(c, ISLE_AT.x + 2, ISLE_AT.y, PAL.fire[fl]!); if (fl !== 2) dot(c, ISLE_AT.x + 2, ISLE_AT.y - 1, PAL.fire[0]!);
  // маяк мигает
  if (Math.floor(t * 1.2) % 3 === 0) { dot(c, LIGHT.x - 3, LIGHT.y - 7, PAL.fire[0]!, 2); dot(c, LIGHT.x + 2, LIGHT.y - 7, PAL.fire[0]!, 2); }
}
const SHOAL = { x: 288, y: 138 };
function gull(c: Ctx, x: number, y: number, up: boolean, fall = false) {
  if (fall) { dot(c, x, y, PAL.gull.white); dot(c, x, y - 1, PAL.gull.grey); dot(c, x - 1, y - 2, PAL.gull.white); dot(c, x + 1, y - 2, PAL.gull.white); dot(c, x, y + 1, PAL.fire[0]!); return; }
  if (up) { dot(c, x - 2, y - 1, PAL.gull.grey); dot(c, x - 1, y, PAL.gull.white); dot(c, x, y + 1, PAL.gull.white); dot(c, x + 1, y, PAL.gull.white); dot(c, x + 2, y - 1, PAL.gull.grey); }
  else { dot(c, x - 2, y + 1, PAL.gull.grey); dot(c, x - 1, y, PAL.gull.white); dot(c, x, y, PAL.gull.white); dot(c, x + 1, y, PAL.gull.white); dot(c, x + 2, y + 1, PAL.gull.grey); dot(c, x, y + 1, PAL.gull.white); }
}

// Булавка «ты здесь»: от точки на земле расходятся жёлтые круги, булавка покачивается, над ней — табличка.
const PIN = ['.ooooo.', 'oRLRRRo', 'oLRRRro', 'oRRRRro', 'oRRRrro', '.oRrro.', '..oro..', '...o...'];
function marker(c: Ctx, x: number, y: number, t: number) {
  for (let k = 0; k < 2; k++) {
    const ph = (t / 1.6 + k / 2) % 1, rx = 2 + ph * 8, ry = rx * 0.45;
    for (let a = 0; a < 64; a++) {
      const px = Math.round(x + Math.cos(a / 64 * Math.PI * 2) * rx), py = Math.round(y + Math.sin(a / 64 * Math.PI * 2) * ry);
      if ((1 - ph) * 1.4 > bay(px, py)) dot(c, px, py, PAL.ring);
    }
  }
  c.fillStyle = 'rgba(20, 8, 4, 0.45)'; c.fillRect(x - 1, y, 3, 1);
  const bob = Math.round((Math.sin(t * 3.4) + 1) * 1);
  sprite(c, PIN, { o: PAL.pin.ink, R: PAL.pin.red, r: PAL.pin.dark, L: PAL.pin.lit }, x - 3, y - PIN.length - bob);
  const label = 'ТЫ ЗДЕСЬ', tw = textWidth(label), bw = tw + 6, bh = 9;
  const bx = Math.max(IN + 1, Math.min(W - IN - 1 - bw, x - Math.floor(bw / 2))), by = y - PIN.length - 4 - bh - bob;
  dot(c, bx, by, PAL.pin.ink, bw, bh); dot(c, bx + 1, by + 1, PAL.paper, bw - 2, bh - 2); dot(c, bx + 1, by + bh - 2, PAL.parch, bw - 2, 1);
  text(c, label, bx + 3, by + 2, PAL.pin.ink);
  dot(c, x - 1, by + bh, PAL.pin.ink, 3); dot(c, x, by + bh + 1, PAL.pin.ink);   // хвостик таблички к булавке
}

// ---------- кадр ----------

let art: { geo: Geo; base: HTMLCanvasElement; chrome: HTMLCanvasElement } | null = null;
let fog: { key: string; canvas: HTMLCanvasElement } | null = null;

// Нарисовать карту на холсте MAP.W×MAP.H: seen — где герой бывал (остальное в тумане), here — где он сейчас, t — секунды.
export function drawWorldMap(ctx: Ctx, o: { seen: readonly Area[]; here: MapSpot; t: number }) {
  if (!art) {
    const geo = buildGeo(), base = make(), b = base.getContext('2d')!, chrome = make();
    paintGround(geo, b); paintFields(b); paintForest(geo, b); paintPlaces(geo, b); paintChrome(chrome.getContext('2d')!);
    art = { geo, base, chrome };
  }
  const key = [...o.seen].sort().join();
  if (fog?.key !== key) { const canvas = make(); paintFog(o.seen, canvas.getContext('2d')!); fog = { key, canvas }; }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(art.base, 0, 0);
  paintLive(art.geo, ctx, o.t);
  ctx.drawImage(fog.canvas, 0, 0);
  ctx.drawImage(art.chrome, 0, 0);
  const s = MAP_SPOTS[o.here];
  marker(ctx, s.x, s.y, o.t);
}
