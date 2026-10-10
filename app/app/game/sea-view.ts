// Открытый океан (SEA в shared/src/sea.ts) — свой кадр 640×360, общий для всех, как остров. Выше горизонта (SEA.horizon) —
// небо с облаками (в пасмурь их больше и они серее) и дальний берег в дымке с маяком; по горизонту изредка проходит парус.
// Ниже — море до самого края: у горизонта светлое от неба, к зрителю всё глубже и синее; волны в перспективе — вдали мелкие
// и частые, вблизи длиннее. Небо и море рисуются один раз; каждый кадр поверх — облака, парус, рябь и барашки (их больше на ветру).
// Каждый сидит в своей лодке: лодка сбоку и чуть сверху, двусторонняя (нос и корма острые — куда бы ни шла, выглядит верно).
// Дальний борт с банками рисуется до человека (boatBack), ближний борт и вёсла — после (boatFront): от сидящего видно только верх.
// Косяк (shoalAt) — тени рыб под водой, кипящая вода, выпрыгивающая рыбёшка; над ним кружат и ныряют чайки — его видно
// издалека. Всё случайное здесь считается от времени: у всех в комнате одно и то же, состояния нет. Только картинка — где
// лодки, косяк, рыбак и поплавок, решают числа SEA.

import { SEA, SPEED, shoalAt } from '@fh/shared';

type Ctx = CanvasRenderingContext2D;
const { W, H } = SEA, HZ = SEA.horizon;

const PAL = {
  sky: ['5d9fd3', '6eacda', '82b9e1', '98c7e8', 'b0d6ee', 'cae5f2', 'def0f5'],                     // от зенита к горизонту
  grey: ['8f9ba8', '9aa5b1', 'a6b0ba', 'b2bbc3', 'bec6cc', 'cad0d5', 'd5dade'],                     // то же под сплошными тучами
  sea: ['8bb9cf', '78abc5', '679ebc', '5891b3', '4c86aa', '437ca2', '3c729a', '366992', '31608a', '2d5882'],   // от горизонта к зрителю
  cloud: ['ffffff', 'eef4f7', 'd7e3ea', 'bdcbd6'], storm: ['d9dee3', 'c2c9d0', 'a9b2bb', '929ca7'],   // свет, тело, тень, низ
  far: ['b2cad7', 'c2d6e0'], near: ['93afc1', 'a5bfce'], surf: 'e8f4f8',                         // дальний берег в дымке: тело и кромка
};
// Краски поверх фона (для fillStyle): гребни ряби, пена и барашки, капли, тени рыб в косяке.
const INK = { crest: '#9fd0e8', foam: '#eef8fb', glint: '#d8f0f8', shadow: '#163a5a', deep: '#1d4468' };
// Лодка — те же дерево и смола, что у вёсельных лодок причала (BOAT_ART в boats.ts).
const WOOD: Record<string, string> = {
  o: '1c0806', T: 'f0b878', R: 'eab577', S: 'd69454', s: '8e4c27', A: 'c4824a', H: 'a8693a', h: '8e4f2d', p: '5e2d1b', d: '45200f',
  K: '673420', k: '2e1209', J: '4e2416', F: '57291a', O: 'e6b373', P: 'c88a4c',
  u: '4a5868', v: '3d4b5c', w: '2d527c', l: '9fd4e8', L: 'd8f0f8',   // под водой корпус синеет; у борта — пена
};
const GULL: Record<string, string> = { o: '2b2d3a', k: '2b2d3a', W: 'f6f6f0', w: 'cfd4da', g: '97a2b1', G: '5f6878', y: 'f2b632', r: 'd9502e' };
// Чайки над косяком — кадры как у чайки причала (gull.ts), клювом вправо; dive — сложила крылья и падает клювом вниз,
// swim — сидит на воде (лап не видно).
const GULLS = {
  up: ['...oo...........', '...oGo..........', '...oGgo.........', '....oGgo........', '....oggwo.......', '.....owwo.ooo...', '.oo..owWooWWWo..', 'owwooWWWWWWWkWyy', '.ooWwwwWWWWWWoo.', '...ooooooooo....'],
  mid: ['................', '................', '................', '................', '................', '..........ooo...', '.oooooooooWWWo..', 'oGGgggwwwWWWkWyy', '.ooWwwwWWWWWWoo.', '...ooooooooo....'],
  down: ['................', '................', '................', '................', '................', '..........ooo...', '.oo...ooooWWWo..', 'owwoooWWWWWWkWyy', '.ooWwwwgwWWWWoo.', '...ooowggwooo...', '......oGggo.....', '.......oGGo.....', '........oo......'],
  dive: ['.o.....o.', 'oGo...oGo', 'oGgo.ogGo', '.oggwggo.', '..owWWo..', '..oWWWo..', '..oWWWo..', '..oWkWo..', '...oWo...', '...oyo...', '....y....'],
  swim: ['......ooo...', '.....oWWWo..', '.....oWWkWo.', '.....oWWWWyy', '..oooowWWor.', '.oggggwWWWo.', 'oGggggwWWWWo', 'oGGgggwwWWwo'],
};
type GullFrame = keyof typeof GULLS;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);   // узор для пятна над косяком
const DUSK = [0.3, 0.46];          // темнота, с которой проступают звёзды и луна и с которой они в полную силу (как в night-view.ts)
const MOON = { x: Math.round(W * 0.8), y: 34 };         // над лунной дорожкой night-view.ts (она на 0.8 ширины кадра)
const LIGHTHOUSE = { x: 131, y: HZ - 17, every: 5 };   // маяк на мысу дальнего берега: ночью мигает раз в every секунд
const SAIL = { speed: 1.3, every: 900 };                // далёкий парус: пикселей в секунду и раз во сколько секунд проходит
// Облака: сколько их на небе в ясную погоду и в пасмурь, скорость дрейфа без ветра и на ветру (пикселей в секунду).
const CLOUDS = { n: 16, clear: 3, calm: 1.2, wind: 5 };
// Рябь поверх фона: живёт life секунд и гаснет; на ветру её больше, длиннее и с барашками.
const RIPPLE = { n: 320, calm: 150, life: [1.6, 3.6] as const, drift: 2.5, caps: 90 };
// Лодка сбоку: по x — от точки лодки (у смотрящей влево корма слева), по y — от воды. Размер холста и где в нём точка лодки.
const BOAT = { L: 33, T: 15, B: 6 };
const OAR = { lock: -2, len: 16, sweep: 9 };            // уключина ближнего борта (dx), насколько ниже воды у лодки лопасть, размах гребка
const ROWER = { dx: -4, dy: -5 };                       // гребец на средней банке: от точки лодки, смотрящей влево
const BOB = { period: 3.4, k: 0.035 };                  // покачивание: период и как быстро фаза меняется по месту (волна идёт к зрителю)
const STROKE = 1.15;                                    // секунд на гребок (stroke)
// Косяк: эллипс на воде (rx, ry) вокруг shoalAt, сколько рыб видно, раз во сколько секунд выпрыгивает рыбёшка.
const SHOAL = { rx: 34, ry: 12, fish: 36, jump: 3.3, gulls: 5 };

const hash = (x: number, y: number, s = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
function smooth(x: number, cw: number, s: number) {    // плавный шум по одной оси
  const g = x / cw, i = Math.floor(g), f = g - i, u = f * f * (3 - 2 * f);
  return hash(i, 0, s) + (hash(i + 1, 0, s) - hash(i, 0, s)) * u;
}
const make = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rgb = (hex: string) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] as const;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const frac = (v: number) => v - Math.floor(v);

// Пиксельная карта → холст (flip — отражённая).
function paint(rows: string[], pal: Record<string, string>, flip = false) {
  const w = rows[0]!.length, h = rows.length, c = make(w, h), x = c.getContext('2d')!, id = x.createImageData(w, h);
  rows.forEach((row, j) => { for (let i = 0; i < w; i++) {
    const hex = pal[row[i]!]; if (!hex) continue;
    const [r, g, b] = rgb(hex), o = (j * w + (flip ? w - 1 - i : i)) * 4;
    id.data[o] = r; id.data[o + 1] = g; id.data[o + 2] = b; id.data[o + 3] = 255;
  } });
  x.putImageData(id, 0, 0); return c;
}

export function createSeaView() {
  const water = new Uint8Array(W * H); water.fill(1, (HZ) * W);   // вода — всё ниже горизонта

  // ---------- небо: полосы от зенита к горизонту ----------
  // Цвет полосы в строке y: f(y) — дробный номер полосы. В первых трёх строках новой полосы прежний цвет редеет узором:
  // три четверти, половина, четверть — переход ступенчатый, пиксельный, без мягких градиентов.
  const MIX = [(x: number, y: number) => (x + 2 * (y & 1)) % 4 !== 0, (x: number, y: number) => ((x + y) & 1) === 1, (x: number, y: number) => (x + 2 * (y & 1)) % 4 === 2];
  const band = (list: string[], f: (y: number) => number, x: number, y: number) => {
    const i = Math.floor(f(y)), n = list.length - 1;
    for (let k = 0; k < 3; k++) if (Math.floor(f(y - k - 1)) < i) return list[clamp(MIX[k]!(x, y) ? i - 1 : i, 0, n)]!;
    return list[clamp(i, 0, n)]!;
  };
  const skyF = (list: string[]) => (y: number) => (clamp(y, 0, HZ - 1) / (HZ - 1)) ** 1.25 * (list.length - 0.01);
  const layer = (list: string[]) => {
    const c = make(W, HZ), x = c.getContext('2d')!, id = x.createImageData(W, HZ), f = skyF(list);
    for (let y = 0; y < HZ; y++) for (let i = 0; i < W; i++) {
      const [r, g, b] = rgb(band(list, f, i, y)), o = (y * W + i) * 4;
      id.data[o] = r; id.data[o + 1] = g; id.data[o + 2] = b; id.data[o + 3] = 255;
    }
    x.putImageData(id, 0, 0); return c;
  };
  const sky = layer(PAL.sky), overcast = layer(PAL.grey);

  // ---------- дальний берег и море — один холст поверх неба (облака проходят за берегом) ----------
  const bg = make(W, H), b = bg.getContext('2d')!, id = b.createImageData(W, H), px = id.data;
  const put = (x: number, y: number, hex: string) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const [r, g, bl] = rgb(hex), o = (y * W + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = bl; px[o + 3] = 255; };
  const land = new Uint8Array(W * HZ);                  // где на небе берег: там не горят звёзды
  // Берег слева: дальний хребет в дымке и холмы ближе, к краю кадра выше; мыс с маяком; справа — низкий островок у горизонта.
  const ridge = (x: number) => (x < 210 ? Math.round((5 + 9 * smooth(x, 46, 3)) * clamp((210 - x) / 90, 0, 1) ** 0.7) : 0);
  const hill = (x: number) => {
    if (x < 150) return Math.round((2 + 6 * smooth(x, 22, 4)) * clamp((150 - x) / 50, 0, 1) ** 0.6 + (x >= 120 && x < 142 ? 2 : 0));
    if (x >= 560 && x < 614) { const u = (x - 587) / 27; return Math.round(5 * (1 - u * u) * (0.8 + 0.3 * smooth(x, 8, 5))); }
    return 0;
  };
  for (let x = 0; x < W; x++) for (const [h, tone] of [[ridge(x), PAL.far], [hill(x), PAL.near]] as const) {
    for (let k = 1; k <= h; k++) { const y = HZ - k; land[y * W + x] = 1; put(x, y, k === h ? tone[1]! : tone[0]!); }
  }
  // маяк: белая башня с красным поясом, наверху фонарь
  {
    const { x: lx, y: ly } = LIGHTHOUSE;
    for (let j = 0; j < 9; j++) for (let i = 0; i < 2; i++) { put(lx + i, ly + 4 + j, j >= 3 && j <= 4 ? 'c9412d' : i ? 'dfe6e8' : 'f6f6f0'); land[(ly + 4 + j) * W + lx + i] = 1; }
    put(lx - 1, ly + 3, '6d7a86'); put(lx, ly + 3, '6d7a86'); put(lx + 1, ly + 3, '6d7a86'); put(lx + 2, ly + 3, '6d7a86');
    put(lx, ly + 2, 'f2d27a'); put(lx + 1, ly + 2, 'f2d27a'); put(lx, ly + 1, '6d7a86'); put(lx + 1, ly + 1, '6d7a86');
    for (let j = 1; j <= 3; j++) for (let i = -1; i <= 2; i++) land[(ly + j) * W + lx + i] = 1;
  }
  // Море: полосы от горизонта к зрителю, вдали тонкие — так оно уходит вдаль. depth — 0 у горизонта, 1 у нижнего края.
  const depth = (y: number) => clamp((y - HZ) / (H - 1 - HZ), 0, 1);
  const seaF = (y: number) => depth(y) ** 0.6 * (PAL.sea.length - 0.01);
  for (let y = HZ; y < H; y++) for (let x = 0; x < W; x++) put(x, y, y === HZ ? PAL.sea[0]! : band(PAL.sea, seaF, x, y));
  for (let x = 0; x < W; x++) if (hill(x) || ridge(x)) put(x, HZ, hash(x, 1, 7) < 0.5 ? PAL.surf : PAL.sea[0]!);   // прибой у дальнего берега
  // Штрихи волн: светлый гребень (вблизи под ним тёмная ложбинка); вдали короткие и частые, вблизи длинные.
  const shade = (y: number, k: number) => PAL.sea[clamp(Math.round(seaF(y) + k), 0, PAL.sea.length - 1)]!;
  for (let n = 0; n < 3400; n++) {
    const x = Math.floor(hash(n, 1, 11) * W), y = HZ + 2 + Math.floor(hash(n, 2, 11) ** 1.3 * (H - HZ - 2)), d = depth(y);
    if (hash(n, 4, 11) > 0.35 + d * 0.4) continue;
    const len = 1 + Math.round(d * 7 * (0.5 + hash(n, 3, 11)));
    for (let k = 0; k < len; k++) put(x + k, y, shade(y, -2.2));
    if (d > 0.5 && len > 3) for (let k = 1; k < len - 1; k++) put(x + k, y + 1, shade(y, 1.2));
  }
  b.putImageData(id, 0, 0);
  // небо у берега прозрачное: под ним — облака и небо
  const front = make(W, H), f = front.getContext('2d')!; f.drawImage(bg, 0, 0);
  { const d = f.getImageData(0, 0, W, HZ); for (let i = 0; i < W * HZ; i++) if (!land[i]) d.data[i * 4 + 3] = 0; f.putImageData(d, 0, 0); }

  // ---------- облака: кучевые, плоские снизу; свет сверху слева, тень снизу справа ----------
  // w — ширина; комки — круги на общей плоской подошве; свет падает слева сверху: у каждого комка верх слева светлый, низ справа в тени.
  function cloud(w: number, seed: number, pal: string[]) {
    const n = 3 + Math.floor(w / 15), lobes: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, r = w / n * (0.62 + 0.55 * Math.sin(u * Math.PI)) * (0.8 + 0.4 * hash(i, seed, 41));
      lobes.push([w * (0.1 + 0.8 * u) + (hash(i, seed, 42) - 0.5) * 4, 0, r]);
    }
    const top = Math.max(...lobes.map(l => l[2])), h = Math.ceil(top * 1.25) + 2, base = h - 1;
    for (const l of lobes) l[1] = base - l[2] * 0.75;
    const inside = (i: number, j: number) => j <= base && j >= 0 && (lobes.some(([cx, cy, r]) => (i - cx) ** 2 + (j - cy) ** 2 <= r * r) || j >= base - 1 && i >= w * 0.06 && i <= w * 0.94);
    const c = make(w, h), x = c.getContext('2d')!;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!inside(i, j)) continue;
      let best = lobes[0]!, deep = -1e9;               // в каком комке пиксель глубже всего — по нему и свет
      for (const l of lobes) { const v = l[2] - Math.hypot(i - l[0], j - l[1]); if (v > deep) { deep = v; best = l; } }
      const lit = (-(i - best[0]) * 0.6 - (j - best[1]) * 0.8) / best[2];   // свет слева сверху
      const tone = j >= base ? 3 : j >= base - 1 || lit < -0.35 ? 2 : !inside(i, j - 1) && lit > -0.2 || lit > 0.45 ? 0 : 1;
      x.fillStyle = '#' + pal[tone]; x.fillRect(i, j, 1, 1);
    }
    return c;
  }
  const clouds = Array.from({ length: CLOUDS.n }, (_, i) => {
    const high = hash(i, 1, 43) < 0.55, w = Math.round(high ? 36 + hash(i, 2, 43) * 50 : 18 + hash(i, 2, 43) * 26);
    const fair = cloud(w, i, PAL.cloud), storm = cloud(w, i, PAL.storm), h = fair.height;
    return { fair, storm, x0: hash(i, 3, 43) * (W + 120), y: Math.round(high ? 4 + hash(i, 4, 43) * 30 : 40 + hash(i, 4, 43) * (HZ - 52 - h)), w, h, k: high ? 1 : 0.6 };
  });
  const shown: { x: number; y: number; w: number; h: number }[] = [];   // где облака в этом кадре — ночью там не горят звёзды

  // ---------- блики и рябь ----------
  const sparkles: [number, number, number, number][] = [];
  for (let n = 0; sparkles.length < 100 && n < 4000; n++) {
    const y = HZ + 4 + Math.floor(Math.sqrt(hash(n, 2, 29)) * (H - HZ - 5)), d = depth(y);   // вблизи гуще
    sparkles.push([Math.floor(hash(n, 1, 29) * W), y, 2 + Math.round(d * 3 * hash(n, 3, 29)), hash(n, 4, 29)]);
  }
  // Рябь: у каждого штриха свой срок; когда он истёк, штрих встаёт в новое место (номер поколения — в хэш).
  const ripples = Array.from({ length: RIPPLE.n }, (_, i) => ({ life: RIPPLE.life[0] + hash(i, 1, 51) * (RIPPLE.life[1] - RIPPLE.life[0]), ph: hash(i, 2, 51) }));
  function drawWaves(ctx: Ctx, t: number, wind: number) {
    const live = Math.round(RIPPLE.calm + (RIPPLE.n - RIPPLE.calm) * wind), caps = Math.round(RIPPLE.caps * wind * wind);
    for (let i = 0; i < live; i++) {
      const r = ripples[i]!, g = Math.floor(t / r.life + r.ph), u = frac(t / r.life + r.ph);
      const y = HZ + 2 + Math.floor(hash(i, g, 53) ** 1.25 * (H - HZ - 3)), d = depth(y);
      const x = Math.floor(hash(i, g, 54) * (W + 20)) - 10 + Math.round(u * RIPPLE.drift * (1 + wind * 2) * (0.3 + d));
      const len = Math.max(1, Math.round((1 + d * 6) * (0.6 + hash(i, g, 55) * 0.8) * (1 + wind * 0.6)));
      const a = Math.sin(u * Math.PI); if (a < 0.25) continue;
      ctx.globalAlpha = a > 0.6 ? 0.85 : 0.45;           // две ступени яркости — без мягких градиентов
      const cap = i < caps && u > 0.3 && u < 0.7;        // барашек: белая пена на гребне
      ctx.fillStyle = cap ? INK.foam : INK.crest; ctx.fillRect(x, y, len, 1);
    }
    ctx.globalAlpha = 1;
  }

  // Далёкий парус: проходит по горизонту справа налево раз в SAIL.every секунд.
  function drawSail(ctx: Ctx, t: number) {
    const x = Math.round(W + 20 - frac(t / SAIL.every) * SAIL.every * SAIL.speed);
    if (x < -10 || x > W + 10) return;
    const y = HZ;
    ctx.fillStyle = '#f2efe4'; ctx.fillRect(x + 2, y - 7, 1, 5); ctx.fillRect(x + 3, y - 5, 1, 3); ctx.fillRect(x + 1, y - 4, 1, 2);
    ctx.fillStyle = '#d9d3c2'; ctx.fillRect(x + 4, y - 3, 1, 1);
    ctx.fillStyle = '#4a5463'; ctx.fillRect(x, y - 1, 6, 1); ctx.fillRect(x + 1, y, 4, 1);
  }

  // Весь фон: небо, тучи, облака, дальний берег, море, парус и рябь. clouds, wind — сила погоды, 0..1.
  let cloudy = 0;
  function draw(ctx: Ctx, t: number, o: { clouds: number; wind: number }) {
    cloudy = o.clouds;
    ctx.drawImage(sky, 0, 0);
    if (o.clouds > 0.01) { ctx.globalAlpha = Math.min(1, o.clouds * 0.95); ctx.drawImage(overcast, 0, 0); ctx.globalAlpha = 1; }
    const n = CLOUDS.clear + (CLOUDS.n - CLOUDS.clear) * o.clouds, v = CLOUDS.calm + CLOUDS.wind * o.wind;
    shown.length = 0;
    for (let i = 0; i < CLOUDS.n && i < n; i++) {
      const c = clouds[i]!, span = W + c.w + 60, x = Math.round(((c.x0 + t * v * c.k) % span + span) % span) - c.w - 30;
      ctx.globalAlpha = Math.min(1, n - i);              // следующее облако проступает плавно
      ctx.drawImage(c.fair, x, c.y);
      if (o.clouds > 0.01) { ctx.globalAlpha *= o.clouds; ctx.drawImage(c.storm, x, c.y); }
      shown.push({ x, y: c.y, w: c.w, h: c.h });
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(front, 0, 0);
    drawSail(ctx, t);
    drawWaves(ctx, t, o.wind);
  }

  // ---------- ночь: звёзды, луна, маяк — поверх ночного затемнения ----------
  const stars: [number, number, number, number][] = [];   // x, y, яркость, фаза
  for (let n = 0; stars.length < 90 && n < 3000; n++) {
    const x = Math.floor(hash(n, 1, 61) * W), y = Math.floor(hash(n, 2, 61) ** 1.3 * (HZ - 6));
    if (land[y * W + x] || Math.hypot(x - MOON.x, y - MOON.y) < 12) continue;
    stars.push([x, y, 0.4 + hash(n, 3, 61) * 0.6, hash(n, 4, 61) * 6.283]);
  }
  const moonArt = paint([
    '...oooo...', '..oMMMMo..', '.oMMMmMMo.', 'oMMmMMMMMo', 'oMMMMMMmMo', 'oMmmMMMMMo', 'oMMMMMMMMo', '.oMMMMmMo.', '..oMMMMo..', '...oooo...',
  ].map(r => r.replace(/o/g, 'c')), { M: 'f4f1dc', m: 'd8d4bc', c: 'c9cbbd' });
  // t — секунды, dark — насколько темно (0..1).
  function night(ctx: Ctx, t: number, dark: number) {
    const k = clamp((dark - DUSK[0]!) / (DUSK[1]! - DUSK[0]!), 0, 1); if (k <= 0) return;
    const clear = 1 - cloudy * 0.85;
    const hidden = (x: number, y: number) => shown.some(c => cloudy > 0.3 && x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
    ctx.fillStyle = '#eef5ff';
    for (const [x, y, v, ph] of stars) {
      const a = Math.sin(t * 0.9 * (0.6 + v) + ph); if (a < -0.3 || hidden(x, y)) continue;
      ctx.globalAlpha = k * clear * v * (a > 0.5 ? 1 : 0.55); ctx.fillRect(x, y, 1, 1);
    }
    // луна с ореолом: ореол складывается со светом, сама луна — краской
    ctx.fillStyle = '#dbe9ff';
    for (const [r, a] of [[11, 0.06], [8, 0.08]] as const) {   // ореол — пиксельные круги
      ctx.globalAlpha = k * clear * a;
      for (let j = -r; j <= r; j++) { const w = Math.floor(Math.sqrt(r * r - j * j)); ctx.fillRect(MOON.x - w, MOON.y + j, 2 * w + 1, 1); }
    }
    ctx.globalAlpha = k * (1 - cloudy * 0.6); ctx.drawImage(moonArt, MOON.x - 4, MOON.y - 4);
    // маяк: короткая вспышка, лучи в стороны
    const flash = frac(t / LIGHTHOUSE.every);
    if (flash < 0.16) {
      const p = Math.sin(flash / 0.16 * Math.PI), lx = LIGHTHOUSE.x, ly = LIGHTHOUSE.y + 2;
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#ffe9a8';
      ctx.globalAlpha = k * p; ctx.fillRect(lx, ly, 2, 1); ctx.fillRect(lx - 1, ly, 4, 1);
      ctx.globalAlpha = k * p * 0.35; ctx.fillRect(lx - 9, ly, 20, 1); ctx.fillRect(lx - 2, ly - 1, 6, 3);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  // ---------- лодка ----------
  // Ближний борт сверху: строка его кромки в столбце dx — к носу и корме поднимается (седловатость). Нос (справа) чуть выше.
  const sheer = (dx: number) => -7 - Math.round((dx < 0 ? 3 : 4) * Math.min(1, Math.abs(dx) / 29) ** 3.2);
  // Где кончается корпус в строке dy: штевни наклонены наружу, ниже воды скругляются к килю (под водой корпус закрывает
  // и сапоги рыбака с картинки — они у него до y+4).
  const end = (dy: number, bow: boolean) => { const k = Math.max(0, dy + 1); return bow ? 30 - 0.5 * (dy + 11) - 0.3 * k * k : 29 - 0.4 * (dy + 10) - 0.3 * k * k; };
  const post = (dx: number, dy: number) => dx >= -31 && dx <= -29 && dy >= -12 && dy < sheer(-29) || dx >= 29 && dx <= 31 && dy >= -13 && dy < sheer(29);   // головки штевней
  const hull = (dx: number, dy: number) => post(dx, dy) || dy >= sheer(dx) && dy <= 4 && dx >= -end(dy, false) && dx <= end(dy, true);
  const rim = (dx: number) => Math.round(5.6 * (1 - Math.min(1, Math.abs(dx) / 29) ** 4));   // сколько строк видно внутри над ближним бортом
  const inner = (dx: number, dy: number) => dy < sheer(dx) && dy >= sheer(dx) - rim(dx) && dx >= -end(sheer(dx), false) && dx <= end(sheer(dx), true);
  const THWARTS = [-15, -3, 13];                        // банки: на кормовой сидит рыбак, на средней — гребец
  const STRAKES = ['SAh', 'AHp', 'Hhp', 'hpd'];          // тона поясов обшивки сверху вниз: свет, тело, тень у нахлёста
  const boatMaps = () => {
    const back: string[] = [], front: string[] = [];
    for (let dy = -BOAT.T; dy <= BOAT.B; dy++) {
      let rb = '', rf = '';
      for (let dx = -BOAT.L; dx <= BOAT.L; dx++) {
        // внутри: дальний борт — кромка и тёмная обшивка, рёбра-шпангоуты, светлые банки поперёк
        if (inner(dx, dy) && !hull(dx, dy)) {
          const k = sheer(dx) - dy, top = rim(dx);       // k — строк над ближним бортом
          const th = THWARTS.find(x => dx >= x - 2 && dx <= x + 1);
          rb += k === top ? 'o' : k === top - 1 ? 'R' : th !== undefined && k <= top - 2 ? (dx === th + 1 ? 's' : 'S') : k === top - 2 ? 'k' : (dx + 40) % 5 === 0 ? 'J' : 'K';
        } else rb += '.';
        if (!hull(dx, dy)) { rf += '.'; continue; }
        const k = dy - sheer(dx), edge = !hull(dx - 1, dy) || !hull(dx + 1, dy) || !hull(dx, dy + 1);
        if (dy >= 2) rf += edge || dy === 4 ? 'w' : dy === 2 ? 'u' : 'v';            // под водой
        else if (edge && !(k === 0 && inner(dx, dy - 1))) rf += 'o';
        else if (dy === 1) rf += 'd';
        else if (k < 0) rf += 'R';                       // головка штевня
        else if (k === 0) rf += 'T';                     // планширь: светлая кромка
        else if (k === 1) rf += 'R';
        else if (k === 2) rf += 'p';                     // тень под планширем
        else if (dy === 0) rf += 'd';                    // у воды — смола
        else rf += STRAKES[Math.min(3, Math.floor((k - 3) / 3))]![(k - 3) % 3]!;   // пояса обшивки внахлёст: верх пояса на свету, низ в тени
      }
      back.push(rb); front.push(rf);
    }
    return { back, front };
  };
  const maps = boatMaps();
  const boatArt = { back: [paint(maps.back, WOOD), paint(maps.back, WOOD, true)], front: [paint(maps.front, WOOD), paint(maps.front, WOOD, true)] };
  const ox = (x: number) => x - BOAT.L;
  const S = (flip: boolean) => (flip ? -1 : 1);
  const dot = (ctx: Ctx, x: number, y: number, w = 1, h = 1) => ctx.fillRect(x, y, w, h);
  // Отрезок пикселями (Брезенхем).
  function seg(ctx: Ctx, x0: number, y0: number, x1: number, y1: number) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    for (let err = dx + dy; ;) { ctx.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) return; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  }

  // Часть лодки за человеком: дальний борт, обшивка изнутри, банки.
  function boatBack(ctx: Ctx, x: number, y: number, flip: boolean, _t: number) {
    ctx.drawImage(boatArt.back[flip ? 1 : 0]!, ox(x), y - BOAT.T);
  }
  // Ближний борт (закрывает ноги сидящего) и вёсла; row — фаза гребка 0..1 (null — вёсла сушат), anchored — канат с носа в воду.
  function boatFront(ctx: Ctx, x: number, y: number, flip: boolean, t: number, o: { row: number | null; anchored: boolean }) {
    const s = S(flip);
    ctx.drawImage(boatArt.front[flip ? 1 : 0]!, ox(x), y - BOAT.T);
    // пена у борта по ватерлинии: пятнами, бегут медленно
    ctx.fillStyle = '#' + WOOD.L!;
    for (let dx = -24; dx <= 24; dx += 1) if (hash(Math.floor(dx / 3), Math.floor(t * 1.6 + dx * 0.13), 71) < 0.3) dot(ctx, x + dx * s, y + 2);
    // уключина
    const lx = x + OAR.lock * s, ly = y + sheer(OAR.lock);
    ctx.fillStyle = '#' + WOOD.o!; dot(ctx, lx, ly - 2, 1, 2);
    if (o.row === null) {                               // вёсла сушат: лежат вдоль лодки на банках, лопасти торчат за носом
      oarAlong(ctx, x, y, s);
    } else {                                            // гребок: лопасть в воде идёт назад, рукоять — вперёд; потом лопасть над водой обратно
      const p = frac(o.row), drive = p < 0.55, u = drive ? p / 0.55 : (p - 0.55) / 0.45, e = u * u * (3 - 2 * u);
      const sw = (drive ? -1 + 2 * e : 1 - 2 * e) * OAR.sweep, lift = drive ? 0 : Math.round(Math.sin(u * Math.PI) * 2) + 3;
      oarRow(ctx, lx, ly - 1, lx - (5 + sw * 0.35) * s, ly - 4, lx + sw * s, y + OAR.len - 8 - lift, drive, t);
    }
    if (o.anchored) {                                   // якорный канат: с носа наискось в воду, у воды — круги
      const bx = x + 31 * s, by = y + sheer(29) - 2, ex = x + 38 * s, ey = y + 3;
      ctx.fillStyle = '#5a3a1e';
      for (let k = 0; k <= 16; k++) { const u = k / 16; dot(ctx, Math.round(bx + (ex - bx) * u), Math.round(by + (ey - by) * u + Math.sin(u * Math.PI) * 1.5)); }
      ctx.fillStyle = INK.crest; const w = Math.floor(t * 1.2) % 2;
      dot(ctx, ex - 1 - w, ey + 1, 3 + 2 * w, 1); if (w) { dot(ctx, ex - 3, ey, 1, 1); dot(ctx, ex + 3, ey, 1, 1); }
    }
  }
  // Вёсла сушат: лежат вдоль лодки на банках, лопастями к носу. Над ближним бортом видно ближнее — светлое на тёмной
  // обшивке, между ним и планширем полоса тени; у носа лопасть шире.
  function oarAlong(ctx: Ctx, x: number, y: number, s: number) {
    for (let dx = 1; dx <= 21; dx++) {
      const top = y + sheer(dx) - 2;
      ctx.fillStyle = '#' + (dx === 1 ? WOOD.P! : WOOD.O!); dot(ctx, x + dx * s, top);
      if (dx >= 14 && dx <= 20) { ctx.fillStyle = '#' + (dx === 14 ? WOOD.P! : WOOD.O!); dot(ctx, x + dx * s, top - 1); }
    }
  }
  // Весло в гребке: рукоять от уключины (x0, y0) к рукам (hx, hy), веретено — к лопасти (bx, by); wet — лопасть в воде.
  function oarRow(ctx: Ctx, x0: number, y0: number, hx: number, hy: number, bx: number, by: number, wet: boolean, t: number) {
    ctx.fillStyle = '#' + WOOD.o!; seg(ctx, x0 + 1, y0, bx + 1, by); seg(ctx, x0 - 1, y0, bx - 1, by); seg(ctx, x0, y0 - 1, hx, hy - 1);
    ctx.fillStyle = '#' + WOOD.O!; seg(ctx, x0, y0, bx, by); seg(ctx, x0, y0, hx, hy);
    const X = Math.round(bx), Y = Math.round(by);
    if (wet) {                                          // лопасть ушла в воду: видна верхушка, вокруг пена
      ctx.fillStyle = '#' + WOOD.o!; ctx.fillRect(X - 2, Y - 3, 5, 3);
      ctx.fillStyle = '#' + WOOD.P!; ctx.fillRect(X - 1, Y - 3, 3, 2);
      ctx.fillStyle = INK.foam; ctx.fillRect(X - 3, Y - 1, 7, 1); if (Math.floor(t * 8) % 2) { ctx.fillRect(X - 4, Y - 2, 1, 1); ctx.fillRect(X + 4, Y - 2, 1, 1); }
    } else {                                            // над водой лопасть плашмя, с неё капает
      ctx.fillStyle = '#' + WOOD.o!; ctx.fillRect(X - 3, Y - 1, 7, 3);
      ctx.fillStyle = '#' + WOOD.P!; ctx.fillRect(X - 2, Y, 5, 1);
      ctx.fillStyle = INK.glint; ctx.fillRect(X + (Math.floor(t * 6) % 3) - 1, Y + 3 + Math.floor(t * 9) % 3, 1, 1);
    }
  }

  // Покачивание лодки в (x, y): целые пиксели; волна идёт к зрителю, поэтому фаза — от места, и лодки качаются вразнобой.
  function bob(x: number, y: number, t: number, wind: number) {
    const a = Math.sin(t * 2 * Math.PI / BOB.period - y * BOB.k + x * BOB.k * 0.4) + 0.35 * Math.sin(t * 1.3 + x * 0.05);
    return Math.round(a * (0.75 + wind) * 0.8);
  }
  // Где сейчас гребок: фаза 0..1 по времени (seed — свой сдвиг у каждого гребца).
  const stroke = (t: number, seed = 0) => frac(t / STROKE + seed);
  // Гребец в гребке подаётся вперёд (к рукояти) и откидывается назад: сдвиг по x для смотрящего влево, -1..1 (вправо — зеркально).
  const lean = (row: number) => { const p = frac(row); return p < 0.15 || p > 0.85 ? 1 : p > 0.35 && p < 0.6 ? -1 : 0; };

  // След за идущей лодкой: flip — куда она идёт (false — влево, след тянется вправо); speed — 0..1 от полного хода на вёслах.
  function wake(ctx: Ctx, x: number, y: number, flip: boolean, t: number, speed: number, seed = 0) {
    if (speed < 0.05) return;
    const s = S(flip), v = SPEED * SEA.ROW * speed, back = s;   // назад — против хода: идёт влево — след вправо
    ctx.fillStyle = INK.foam;
    // усы: от переднего штевня расходятся назад штрихами, бегут назад вместе с водой и тают; ближний — вниз, дальний — вверх
    // (у корпуса его не видно — лодка его закрывает)
    const reach = 26 + 70 * speed, run = frac(t * v / 4) * 4;
    for (let d = run; d < reach; d += 4) {
      const fade = 1 - d / reach, k = Math.floor((t * v - d) / 4);
      if (hash(k, 1, 81) > 0.45 + fade) continue;
      ctx.globalAlpha = fade > 0.4 ? 0.9 : 0.5; ctx.fillStyle = hash(k, 2, 81) < 0.6 ? INK.foam : INK.crest;
      const bx = Math.round(x - s * 23 + back * d), len = fade > 0.5 ? 3 : 2;
      dot(ctx, back > 0 ? bx : bx - len + 1, Math.round(y + 3 + d * 0.13), len, 1);
      dot(ctx, back > 0 ? bx : bx - len + 1, Math.round(y - 3 - d * 0.08), len, 1);
    }
    // пенный след за кормой (той, что сзади по ходу): взбитая вода, дальше — реже
    for (let k = 0; k < 30 * speed; k++) {
      const d = k * 2 + frac(t * v / 2) * 2, fade = 1 - d / (60 * speed + 1); if (fade <= 0) continue;
      const jy = Math.round((hash(k, Math.floor(t * 3 + k), 82) - 0.5) * (2 + d * 0.08));
      ctx.globalAlpha = fade * 0.8; ctx.fillStyle = hash(k, 5, 83) < 0.5 ? INK.foam : INK.crest;
      dot(ctx, Math.round(x + back * (27 + d)) - (back < 0 ? 1 : 0), y + 1 + jy, 2, 1);
    }
    // круги от вёсел: лопасть вышла из воды — круг остаётся на месте и отстаёт от лодки
    const p = stroke(t, seed), age = p >= 0.55 ? (p - 0.55) * STROKE : (p + 0.45) * STROKE;
    const rx = Math.round(x + OAR.lock * s + OAR.sweep * s + back * v * age), ry = y + 8;
    const a = clamp(1 - age / (STROKE * 0.9), 0, 1);
    if (a > 0) {
      ctx.fillStyle = INK.crest; ctx.globalAlpha = a * 0.8;
      const r = 1 + Math.floor(age * 4);
      ctx.fillRect(rx - r, ry - 1, 2 * r + 1, 1); ctx.fillRect(rx - r - 1, ry, 1, 1); ctx.fillRect(rx + r + 1, ry, 1, 1); ctx.fillRect(rx - r, ry + 1, 2 * r + 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- косяк ----------
  const fish = Array.from({ length: SHOAL.fish }, (_, i) => ({ r: 0.2 + 0.8 * Math.sqrt(hash(i, 1, 91)), w: (0.3 + hash(i, 2, 91) * 0.4) * (hash(i, 3, 91) < 0.85 ? 1 : -1), ph: hash(i, 4, 91) * 6.283, deep: hash(i, 5, 91) < 0.35 }));
  // Тёмное пятно воды над стаей: рваный эллипс узором Байера — гуще в середине. Три кадра, сменяются: пятно дышит.
  const patches = [0, 1, 2].map(v => {
    const w = SHOAL.rx * 2 + 13, h = SHOAL.ry * 2 + 9, c = make(w, h), x = c.getContext('2d')!; x.fillStyle = INK.deep;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = (i - w / 2) / (SHOAL.rx + 5), q = (j - h / 2) / (SHOAL.ry + 3), a = Math.atan2(q, u);
      const r = Math.hypot(u, q) / (0.85 + 0.2 * Math.sin(a * 3 + v * 2.1) + 0.1 * Math.sin(a * 5 - v));
      if (r < 1 && BAYER[(j & 3) * 4 + (i & 3)]! < (r < 0.6 ? 1 : r < 0.82 ? 0.5 : 0.25)) x.fillRect(i, j, 1, 1);
    }
    return c;
  });
  // Тени рыб под водой, кипящая вода, серебро рыб у поверхности, выпрыгивающая рыбёшка. ms — часы сервера (по ним же shoalAt).
  function shoalBelow(ctx: Ctx, t: number, ms: number) {
    const c = shoalAt(ms), cx = Math.round(c.x), cy = Math.round(c.y);
    const pat = patches[Math.floor(t * 1.5) % 3]!; ctx.globalAlpha = 0.4; ctx.drawImage(pat, cx - (pat.width >> 1), cy - (pat.height >> 1));
    // рыбы кружат стаей: каждая по своему эллипсу; спина, хвост виляет
    ctx.fillStyle = INK.shadow;
    for (const f of fish) {
      const a = f.ph + t * f.w, fx = Math.round(cx + Math.cos(a) * SHOAL.rx * f.r), fy = Math.round(cy + Math.sin(a) * SHOAL.ry * f.r);
      const d = -Math.sin(a) * f.w > 0 ? 1 : -1, wag = Math.floor(t * 5 + f.ph) % 2;
      ctx.globalAlpha = f.deep ? 0.4 : 0.75;
      ctx.fillRect(fx - 2, fy, 4, 1); ctx.fillRect(fx - 1, fy - 1, 2, 1); ctx.fillRect(fx - 3 * d - (d < 0 ? 0 : 0), fy - wag, 1, 1); ctx.fillRect(fx - 3 * d, fy + 1 - wag, 1, 1);
    }
    // серебро: то одна, то другая рыба у самой поверхности поворачивается боком
    ctx.fillStyle = '#d6ecf4';
    for (let i = 0; i < 4; i++) {
      const f = fish[Math.floor(hash(i, Math.floor(t * 4), 92) * fish.length)]!; if (f.deep) continue;
      const a = f.ph + t * f.w; ctx.globalAlpha = 0.9;
      ctx.fillRect(Math.round(cx + Math.cos(a) * SHOAL.rx * f.r) - 1, Math.round(cy + Math.sin(a) * SHOAL.ry * f.r), 2, 1);
    }
    // вода кипит: всплески-кружки и пена то тут, то там
    ctx.fillStyle = INK.foam;
    for (let i = 0; i < 14; i++) {
      const per = 0.7 + hash(i, 1, 93) * 0.8, g = Math.floor(t / per + hash(i, 2, 93)), u = frac(t / per + hash(i, 2, 93));
      const a = hash(i, g, 94) * 6.283, r = Math.sqrt(hash(i, g, 95));
      const x = Math.round(cx + Math.cos(a) * SHOAL.rx * r), y = Math.round(cy + Math.sin(a) * SHOAL.ry * r);
      ctx.globalAlpha = u < 0.3 ? 0.95 : 0.6 * (1 - u);
      if (u < 0.3) { ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x - 1, y, 3, 1); }
      else { const w = 1 + Math.floor(u * 3); ctx.fillRect(x - w, y - 1, 2 * w + 1, 1); ctx.fillRect(x - w - 1, y, 1, 1); ctx.fillRect(x + w + 1, y, 1, 1); ctx.fillRect(x - w, y + 1, 2 * w + 1, 1); }
    }
    for (let i = 0; i < 22; i++) {                       // пенная крупа поверх стаи
      const g = Math.floor(t * 3 + hash(i, 1, 96)), r = Math.sqrt(hash(i, g, 97)), a = hash(i, g, 98) * 6.283;
      ctx.globalAlpha = 0.7; ctx.fillRect(Math.round(cx + Math.cos(a) * SHOAL.rx * 1.05 * r), Math.round(cy + Math.sin(a) * SHOAL.ry * 1.05 * r), hash(i, g, 99) < 0.4 ? 2 : 1, 1);
    }
    // рыбёшка выпрыгивает: дуга над водой, брызги на взлёте и на входе
    const js = ms / 1000 / SHOAL.jump, g = Math.floor(js), u = frac(js) * SHOAL.jump / 0.8;
    if (u < 1.4) {
      const a = hash(g, 1, 99) * 6.283, x0 = cx + Math.cos(a) * SHOAL.rx * 0.6, y0 = cy + Math.sin(a) * SHOAL.ry * 0.6, dir = hash(g, 2, 99) < 0.5 ? -1 : 1;
      if (u < 1) {
        const x = Math.round(x0 + dir * 12 * u), y = Math.round(y0 - Math.sin(u * Math.PI) * 10);
        ctx.globalAlpha = 1; ctx.fillStyle = '#c9d6dd'; ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillStyle = '#7d8f9c'; const tail = u < 0.4 ? 1 : u > 0.6 ? -1 : 0;   // хвост ниже на взлёте, выше на спуске
        ctx.fillRect(x - 2 * dir, y + tail, 1, 1); ctx.fillStyle = '#eef3f6'; ctx.fillRect(x + dir, y, 1, 1);
      }
      ctx.fillStyle = INK.foam;
      for (const [sx, k] of [[x0, u], [x0 + dir * 12, u - 1]] as const) {
        if (k < 0 || k > 0.4) continue;
        const sy = Math.round(y0), h = Math.round((1 - k / 0.4) * 3);
        ctx.globalAlpha = 0.9; ctx.fillRect(Math.round(sx) - 1, sy, 3, 1);
        if (h) { ctx.fillRect(Math.round(sx) - 2, sy - h, 1, 1); ctx.fillRect(Math.round(sx) + 2, sy - h, 1, 1); ctx.fillRect(Math.round(sx), sy - h - 1, 1, 1); }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- чайки над косяком ----------
  const gullArt = {} as Record<GullFrame, [HTMLCanvasElement, HTMLCanvasElement]>;
  for (const k of Object.keys(GULLS) as GullFrame[]) gullArt[k] = [paint(GULLS[k], GULL), paint(GULLS[k], GULL, true)];
  const DIVE = { fall: 0.55, under: 0.25, sit: 1.6, rise: 1.4 };   // секунд: падает, под водой, сидит на воде, взлетает к своему кругу
  const birds = Array.from({ length: SHOAL.gulls }, (_, i) => ({
    R: 22 + hash(i, 1, 101) * 36, h: 22 + hash(i, 2, 101) * 44, w: (0.45 + hash(i, 3, 101) * 0.35) * (i % 2 ? -1 : 1), ph: hash(i, 4, 101) * 6.283,
    every: 9 + hash(i, 5, 101) * 9, off: hash(i, 6, 101),
  }));
  // Чайки кружат над косяком и время от времени ныряют за рыбой. Рисуются поверх всего (до ночного затемнения).
  function shoalAbove(ctx: Ctx, t: number, ms: number) {
    const c = shoalAt(ms), s = ms / 1000;
    const spot = (b: typeof birds[number], tt: number) => { const a = b.ph + tt * b.w; return { x: c.x + Math.cos(a) * b.R, y: c.y - b.h + Math.sin(a) * b.R * 0.35, right: -Math.sin(a) * b.w > 0 }; };
    const blit = (frame: GullFrame, right: boolean, x: number, y: number, ax: number, ay: number) => {
      const img = gullArt[frame][right ? 0 : 1]!; ctx.drawImage(img, Math.round(x) - (right ? ax : img.width - 1 - ax), Math.round(y) - ay);
    };
    const wing = (i: number, tt: number): GullFrame => (Math.floor(tt / 1.3 + i * 0.7) % 3 === 0 ? (['up', 'mid', 'down', 'mid'] as GullFrame[])[Math.floor(tt * 14) % 4]! : 'mid');
    const splash = (x: number, y: number, k: number) => {   // k — 0..1 с удара о воду
      ctx.fillStyle = INK.foam; ctx.globalAlpha = k < 0.5 ? 1 : 0.6;
      const h = Math.round((1 - k) * 5), w = 1 + Math.floor(k * 4);
      ctx.fillRect(x - w, y, 2 * w + 1, 1);
      if (h > 0) { ctx.fillRect(x, y - h, 1, h); ctx.fillRect(x - 2, y - h + 2, 1, 1); ctx.fillRect(x + 2, y - h + 1, 1, 1); ctx.fillRect(x - 3, y - 1, 1, 1); ctx.fillRect(x + 3, y - 1, 1, 1); }
      ctx.globalAlpha = 1;
    };
    birds.forEach((b, i) => {
      const cyc = s / b.every + b.off, n = Math.floor(cyc), el = frac(cyc) * b.every;
      const total = DIVE.fall + DIVE.under + DIVE.sit + DIVE.rise;
      const hit = { x: c.x + (hash(n, i, 103) - 0.5) * SHOAL.rx * 1.2, y: c.y + (hash(n, i, 104) - 0.5) * SHOAL.ry };
      if (el >= total) { const p = spot(b, s); blit(wing(i, s), p.right, p.x, p.y, 8, 7); return; }
      const t0 = s - el, from = spot(b, t0);              // откуда нырнула — где была в начале нырка
      if (el < DIVE.fall) {                               // падает, всё быстрее
        const k = el / DIVE.fall, e = k * k;
        blit('dive', true, from.x + (hit.x - from.x) * e, from.y + (hit.y - from.y) * e, 4, 10); return;
      }
      if (el < DIVE.fall + DIVE.under) { splash(Math.round(hit.x), Math.round(hit.y), (el - DIVE.fall) / DIVE.under * 0.5); return; }
      if (el < DIVE.fall + DIVE.under + DIVE.sit) {       // сидит на воде с добычей, вокруг круги
        const k = (el - DIVE.fall - DIVE.under) / DIVE.sit;
        if (k < 0.5) splash(Math.round(hit.x), Math.round(hit.y), 0.5 + k);
        blit('swim', hit.x > c.x, hit.x, hit.y + 1, 6, 7); return;
      }
      const k = (el - DIVE.fall - DIVE.under - DIVE.sit) / DIVE.rise, to = spot(b, s), e = 1 - (1 - k) * (1 - k);   // взлетает к своему кругу, машет
      blit((['up', 'mid', 'down', 'mid'] as GullFrame[])[Math.floor(s * 14) % 4]!, to.x > hit.x, hit.x + (to.x - hit.x) * e, hit.y - 3 + (to.y - hit.y + 3) * e, 8, 7);
    });
  }

  // Попал ли клик (px, py) в лодку с точкой (x, y): корпус и сидящий в ней.
  const hit = (x: number, y: number, px: number, py: number) => Math.abs(px - x) <= 31 && py >= y - 13 && py <= y + 4 || Math.abs(px - x) <= 22 && py >= y - 34 && py < y - 13;

  return { water, sparkles, draw, night, bob, boatBack, boatFront, wake, shoalBelow, shoalAbove, hit, stroke, lean, ROWER };
}
