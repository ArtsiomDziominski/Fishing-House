// Утки и рыбы с картинки-образца. Только картинка — на клёв и улов не влияют.
// Рыба иногда выпрыгивает из воды с брызгами или показывает спину и снова уходит вглубь; утки плавают, ныряют за едой
// и время от времени улетают, а потом возвращаются. Что и где происходит, считается от часов причала (их ведёт сервер),
// поэтому все игроки видят одно и то же. Спугнуть утку, подойдя к ней, можно только у себя: она улетит и вернётся позже.
// Кадры — пиксельные карты 1:1 в арт-пикселях (буква — цвет из PAL, точка — пусто), головой вправо; влево — отражение.
// Размер — как на образце рядом с людьми (человек там ≈ 32 пикселя): утка 12×9 вместе с рябью при герое 19×34, рыба 13×6.

type Ctx = CanvasRenderingContext2D;
interface Pt { x: number; y: number }

// Где живность не появляется: причал и обе лодки у него (BERTHS в boats.ts) — по x от и до. Рыбак тоже там закидывает.
const PIER = [175, 400] as const;

const PAL: Record<string, string> = {
  o: '1b1f1a', G: '3f8a3c', g: '7fb069', k: '10200f', y: 'e8a06a', Y: 'b8703e',   // утка: контур, голова, глаз, клюв
  b: '7a6440', B: '4f3f26', c: 'd9a27a', C: 'a8744c', t: '2a2a22',               // бока, спина, грудка, хвост
  f: '1a2a3a', s: 'c8dde6', S: '8fb0c0', d: '5a7d90', e: '0e1a24',               // рыба: контур, серебро, спина, глаз
  u: '3d7593', U: '2f5f7c',                                                        // рыба под водой
  W: 'f6fbfc', w: 'a8dcef',                                                        // брызги и рябь
};

// Утка. a — точка на воде (у плывущей — середина ряби под ней), у летящей — середина тела.
const DUCK = {
  swim: { a: [6, 8], rows: [
    '.....ooo....',
    '....oGGgo...',
    '....oGkGyyo.',
    '.o..oGGoYo..',
    'oto.ogGo....',
    'otooobbboo..',
    '.obcccbbbbo.',
    '.woBBBBBBow.',
    'w.wwwwwwww.w',
  ] },
  paddle: { a: [6, 8], rows: [               // гребёт: рябь шире, чем у стоящей
    '.....ooo....',
    '....oGGgo...',
    '....oGkGyyo.',
    '.o..oGGoYo..',
    'oto.ogGo....',
    'otooobbboo..',
    '.obcccbbbbo.',
    'woBBBBBBBow.',
    '.wwwwwwwww.w',
  ] },
  dip: { a: [6, 8], rows: [                  // голова под водой, хвост кверху
    '............',
    '............',
    '.oo.........',
    'otto........',
    '.otbooo.....',
    '..obbbbboo..',
    '..obcccbbbo.',
    '.woBBBBBBGow',
    'w.wwwwwwwww.',
  ] },
  up: { a: [7, 6], rows: [                   // крылья вверху
    '...ooo..........',
    '...oBBoo........',
    '....oBBBo.......',
    '....obBBBo..ooo.',
    '.....obBBo.oGGgo',
    '.oo...obbooGkGyy',
    'otoooobbbbbGGoo.',
    '.otbcccccbbo....',
    '..oooooooooo....',
    '................',
    '................',
  ] },
  mid: { a: [7, 6], rows: [
    '................',
    '................',
    '................',
    '............ooo.',
    '...........oGGgo',
    '.oo.oooooooGkGyy',
    'otooBBBBBBbGGoo.',
    '.otbcccccbbo....',
    '..oooooooooo....',
    '................',
    '................',
  ] },
  down: { a: [7, 6], rows: [                 // крылья внизу
    '................',
    '................',
    '................',
    '............ooo.',
    '...........oGGgo',
    '.oo.oooooooGkGyy',
    'otoobbbbbbbGGoo.',
    '.otbccBBBBbo....',
    '..oocoBBBBoo....',
    '.....oBBBo......',
    '......ooo.......',
  ] },
};
type DuckFrame = keyof typeof DUCK;

// Рыба. a — у прыгающей середина тела; у той, что показала спину, — точка на воде.
const FISH = {
  flat: { a: [6, 3], rows: [
    '......fff....',
    '.f..ffdddff..',
    'fSffSsssssSf.',
    'fSSsssssWseSf',
    'fSffdssssssf.',
    '.f..ffSSSff..',
  ] },
  up: { a: [5, 5], rows: [                    // нос вверх: из воды
    '.........ff',
    '.......ffef',
    '......fsWsf',
    '.....fsssSf',
    '...ffdsssf.',
    '..fSsssSf..',
    'ffSsssff...',
    'fSSff......',
    '.ff........',
  ] },
  down: { a: [5, 3], rows: [                  // нос вниз: обратно в воду
    '.ff........',
    'fSSff......',
    'ffSsssff...',
    '..fSssdff..',
    '...fssssSf.',
    '.....fsWsf.',
    '......fsef.',
    '.......fff.',
  ] },
  back: { a: [6, 5], rows: [                  // показала спину, как на образце: низ уже под водой
    '......fff....',
    '.f..ffdddff..',
    'fSffSsssssSf.',
    'fSSsssssWseSf',
    'wuUUuuuuuuuUw',
    '.wwwuuuuuuww.',
  ] },
};
type FishFrame = keyof typeof FISH;

const SPLASH = {
  small: { a: [3, 3], rows: [
    'W.....W',
    '.W...W.',
    '.wW.Ww.',
    '..www..',
  ] },
  big: { a: [6, 5], rows: [                   // всплеск буквой V, как на образце
    'W...........W',
    'WW.........WW',
    '.WW.......WW.',
    '..WW.....WW..',
    '...WWw.wWW...',
    '....wwwww....',
  ] },
};

const DUCKS = [                               // у каждой утки своя полоса воды, чтобы они не наплывали друг на друга
  { from: 12, to: 100 },
  { from: 100, to: 172 },
  { from: 405, to: 630 },
];
const PLAN = {
  stay: 120,          // каждые столько секунд утка решает: остаться и переплыть на новое место или улететь
  away: 0.3,          // с какой вероятностью её не будет весь следующий срок
  leg: 9,             // каждые столько секунд — к новой точке рядом
  swim: 5,            // плывёт столько из них, остальное отдыхает или ныряет за едой
  roam: [26, 9] as const,   // насколько далеко от своего места по x и y
  dip: 0.35,          // как часто ныряет на отдыхе
  fly: 50,            // скорость полёта, арт-пикселей в секунду
  flap: 5,            // взмахов в секунду
  scare: 48,          // ближе этого подходить нельзя — улетит (утки держатся от берега, а герой стоит на нём)
  scareFly: 70,       // спугнутая летит быстрее
};
const FISHES = {
  every: 2.5,         // раз в столько секунд — может быть рыба
  chance: 0.4,
  jump: 0.55,         // доля прыжков, остальное — показала спину
  hop: [16, 12] as const,   // прыжок: длина и высота
};
const RING = '#d6f1fb';

const hash = (n: number, s: number) => { let h = (n * 374761393 + s * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const ease = (k: number) => k * k * (3 - 2 * k);

interface Art { a: number[]; img: [HTMLCanvasElement, HTMLCanvasElement] }
function paint(rows: string[], flip: boolean) {
  const w = rows[0]!.length, h = rows.length, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!, id = x.createImageData(w, h);
  rows.forEach((row, j) => { for (let i = 0; i < w; i++) {
    const hex = PAL[row[i]!]; if (!hex) continue;
    const o = (j * w + (flip ? w - 1 - i : i)) * 4;
    id.data[o] = parseInt(hex.slice(0, 2), 16); id.data[o + 1] = parseInt(hex.slice(2, 4), 16); id.data[o + 2] = parseInt(hex.slice(4, 6), 16); id.data[o + 3] = 255;
  } });
  x.putImageData(id, 0, 0); return c;
}
function sheet<K extends string>(src: Record<K, { a: number[]; rows: string[] }>) {
  const out = {} as Record<K, Art>;
  for (const k of Object.keys(src) as K[]) out[k] = { a: src[k].a, img: [paint(src[k].rows, false), paint(src[k].rows, true)] };
  return out;
}
// Рисует кадр так, чтобы его точка a встала в (x, y); left — головой влево. rows — сколько верхних рядов видно (рыба выныривает).
function put(ctx: Ctx, art: Art, x: number, y: number, left: boolean, rows = Infinity) {
  const img = art.img[left ? 1 : 0], ax = left ? img.width - 1 - art.a[0]! : art.a[0]!;
  const h = Math.min(img.height, Math.max(0, Math.floor(rows)));
  if (!h) return;
  const dy = img.height - h;                    // видна только верхушка — она и стоит внизу, у воды
  ctx.drawImage(img, 0, 0, img.width, h, Math.round(x) - ax, Math.round(y) - art.a[1]! + dy, img.width, h);
}

// W, H — размер карты; water — маска воды (1 — вода), в ней уже вычеркнуты лодки; avoid — где по x живности не бывать
// (причал или мостки острова: там рыбачат).
export function createWildlifeView(W: number, H: number, water: Uint8Array, avoid: readonly [number, number] = PIER) {
  const duckArt = sheet(DUCK), fishArt = sheet(FISH), splashArt = sheet(SPLASH);
  const wet = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && water[y * W + x] === 1;
  const clear = (x: number, y: number, dx: number, up: number, down: number) => {   // вокруг точки — только вода, и не у причала
    if (x + dx >= avoid[0] && x - dx <= avoid[1]) return false;
    for (let j = y - up; j <= y + down; j++) for (let i = x - dx; i <= x + dx; i++) if (!wet(i, j)) return false;
    return true;
  };
  // Места, где может быть утка или рыба: вокруг них вода, чтобы картинка не легла на берег или лодку.
  const spots = (dx: number, up: number, down: number, from = 0, to = W) => {
    const out: Pt[] = [];
    for (let y = 0; y < H; y += 2) for (let x = from; x < to; x += 2) if (clear(x, y, dx, up, down)) out.push({ x, y });
    return out;
  };
  const duckSpots = DUCKS.map(d => spots(8, 10, 3, d.from, d.to));
  const fishSpots = spots(FISHES.hop[0] + 6, FISHES.hop[1] + 3, 4);

  // ---------- утки ----------
  const here = (d: number, m: number) => duckSpots[d]!.length > 0 && hash(m, 11 + d * 7) >= PLAN.away;
  const home = (d: number, m: number) => { const s = duckSpots[d]!; return s[Math.floor(hash(m, 12 + d * 7) * s.length)]!; };
  // Точка k срока m: рядом с местом этого срока; если там не вода — само место.
  function point(d: number, m: number, k: number): Pt {
    const h = home(d, m);
    if (k <= 0) return h;
    const p = { x: Math.round(h.x + (hash(m * 64 + k, 13 + d * 7) * 2 - 1) * PLAN.roam[0]), y: Math.round(h.y + (hash(m * 64 + k, 14 + d * 7) * 2 - 1) * PLAN.roam[1]) };
    if (!clear(p.x, p.y, 8, 10, 3)) return h;
    for (let i = 1; i <= 8; i++) {              // и путь туда — по воде, а не через лодку
      const q = { x: Math.round(h.x + (p.x - h.x) * i / 8), y: Math.round(h.y + (p.y - h.y) * i / 8) };
      if (!clear(q.x, q.y, 6, 4, 2)) return h;
    }
    return p;
  }
  const legs = Math.floor((PLAN.stay - 12) / PLAN.leg);   // последние секунды срока — на перелёт
  const offPoint = (d: number, m: number, s: number, from: Pt): Pt => ({ x: from.x + (hash(m, s + d * 7) < 0.5 ? -1 : 1) * (140 + hash(m, s + 1 + d * 7) * 80), y: -24 });
  // Полёт в конце срока m: откуда и куда (null — не летит) и сколько он длится. gone — у этого игрока утку спугнули.
  function flight(d: number, m: number, gone = false) {
    const a = here(d, m) && !gone, b = here(d, m + 1);
    if (!a && !b) return null;
    const from = a ? point(d, m, legs - 1) : offPoint(d, m, 15, home(d, m + 1));
    const to = b ? home(d, m + 1) : offPoint(d, m, 17, from);
    if (a && b && from.x === to.x && from.y === to.y) return null;
    return { from, to, t0: (m + 1) * PLAN.stay - Math.hypot(to.x - from.x, to.y - from.y) / PLAN.fly, dur: Math.hypot(to.x - from.x, to.y - from.y) / PLAN.fly, arc: 40 };
  }

  interface Fly { from: Pt; to: Pt; t0: number; dur: number; arc: number }
  // Где летящая утка в миг s: по дуге — взлёт вверх, посадка сверху.
  function flyAt(f: Fly, s: number) {
    const k = clamp((s - f.t0) / f.dur, 0, 1), len = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y);
    const cx = (f.from.x + f.to.x) / 2, cy = Math.min(f.from.y, f.to.y) - Math.min(len * 0.3, f.arc), e = ease(k);
    return { x: (1 - e) ** 2 * f.from.x + 2 * (1 - e) * e * cx + e * e * f.to.x, y: (1 - e) ** 2 * f.from.y + 2 * (1 - e) * e * cy + e * e * f.to.y, k };
  }
  const flyFrame = (t: number): DuckFrame => (['up', 'mid', 'down', 'mid'] as DuckFrame[])[Math.floor(t * PLAN.flap * 4) % 4]!;
  const LIFT = 4;                               // у летящей точка — середина тела: над водой она на столько выше

  // Спугнутые у этого игрока: до конца срока m утки нет. Это видит только он — у других она плавает дальше.
  const scared: ({ m: number; fly: Fly } | null)[] = DUCKS.map(() => null);

  type Shown = { kind: 'water'; y: number; draw: (ctx: Ctx) => void } | { kind: 'air'; draw: (ctx: Ctx) => void };
  const flying = (out: Shown[], f: Fly, s: number) => {
    const p = flyAt(f, s), left = f.to.x < f.from.x;
    if (p.k < 1) out.push({ kind: 'air', draw: ctx => put(ctx, duckArt[flyFrame(s - f.t0)], p.x, p.y - LIFT, left) });
  };

  // s — секунды по часам причала, у каждой утки свои: сдвинуты, чтобы они не прилетали и не улетали разом.
  function duck(d: number, s: number, near: Pt[], out: Shown[]) {
    const m = Math.floor(s / PLAN.stay), u = s - m * PLAN.stay;
    if (scared[d] && scared[d]!.m < m) scared[d] = null;   // срок прошёл — утка снова со всеми
    const gone = scared[d];
    if (gone) {                                 // спугнута: улетает и брызги на месте взлёта
      flying(out, gone.fly, s);
      const v = s - gone.fly.t0;
      if (v < 1.6) out.push({ kind: 'water', y: gone.fly.from.y, draw: ctx => splash(ctx, gone.fly.from, v, Math.round(gone.fly.t0)) });
    }
    const fl = flight(d, m, !!gone);
    if (fl && s >= fl.t0) {                     // перелёт в конце срока: на новое место или прочь с карты
      flying(out, fl, s);
      const v = s - fl.t0, w = s - fl.t0 - fl.dur;
      if (!gone && here(d, m) && v < 1.6) out.push({ kind: 'water', y: fl.from.y, draw: ctx => splash(ctx, fl.from, v, m) });
      if (here(d, m + 1) && w > -0.15) out.push({ kind: 'water', y: fl.to.y, draw: ctx => splash(ctx, fl.to, w + 0.15, m + 1) });
      return;
    }
    if (gone || !here(d, m)) return;
    // на воде: от точки к точке, потом отдых
    const k = Math.min(legs - 1, Math.floor(u / PLAN.leg)), v = u - k * PLAN.leg;
    const from = point(d, m, k - 1), b = point(d, m, k), go = clamp(v / PLAN.swim, 0, 1);
    const x = from.x + (b.x - from.x) * ease(go), y = from.y + (b.y - from.y) * ease(go);
    const moving = go < 1 && (b.x !== from.x || b.y !== from.y);
    const left = b.x !== from.x ? b.x < from.x : hash(m * 64 + k, 19 + d * 7) < 0.5;
    const close = near.filter(p => Math.hypot(p.x - x, p.y - y) < PLAN.scare);
    if (close.length) {                         // кто-то подошёл — взлетает прочь от него
      const p = close[0]!, to = { x: x + (x < p.x ? -1 : 1) * 160, y: -24 };
      scared[d] = { m, fly: { from: { x: Math.round(x), y: Math.round(y) }, to, t0: s, dur: Math.hypot(to.x - x, to.y - y) / PLAN.scareFly, arc: 60 } };
      return duck(d, s, [], out);
    }
    const last = flight(d, m - 1);              // только что села — ещё расходятся круги
    if (u < 1.45 && last && here(d, m)) out.push({ kind: 'water', y, draw: ctx => splash(ctx, home(d, m), u + 0.15, m) });
    const bob = Math.floor(s * 1.3 + d) % 2;    // покачивается на воде на пиксель
    const feed = !moving && hash(m * 64 + k, 20 + d * 7) < PLAN.dip && v > PLAN.swim + 1 && v < PLAN.swim + 2.6;
    const frame: DuckFrame = feed ? 'dip' : moving && Math.floor(s * 3) % 2 ? 'paddle' : 'swim';
    out.push({ kind: 'water', y, draw: ctx => {
      if (moving) wake(ctx, x, y, left, s);
      put(ctx, duckArt[frame], x, y + (frame === 'dip' ? 0 : bob), left);
    } });
  }

  // ---------- рябь ----------
  // Пунктирный круг на воде, сплюснутый в перспективе. r — радиус по x, power — яркость.
  function ring(ctx: Ctx, cx: number, cy: number, r: number, power: number) {
    if (power <= 0 || r < 2.5) return;            // совсем маленький круг — просто квадратик, его не рисуем
    const rx = Math.max(1, Math.round(r)), ry = Math.max(1, Math.round(r * 0.4)), seen = new Set<number>(), dots: number[] = [];
    const n = Math.ceil(rx * 16);
    for (let i = 0; i < n; i++) {               // обходим эллипс по кругу и собираем его пиксели по порядку
      const t = i / n * Math.PI * 2, x = Math.round(cx + Math.cos(t) * rx), y = Math.round(cy + Math.sin(t) * ry), key = y * W + x;
      if (!seen.has(key)) { seen.add(key); dots.push(key); }
    }
    ctx.fillStyle = RING; ctx.globalAlpha = clamp(power, 0, 1);
    dots.forEach((key, i) => {
      if (rx > 3 && i % 2) return;              // большой круг — пунктиром, как на образце
      const x = key % W, y = (key - x) / W;
      if (wet(x, y)) ctx.fillRect(x, y, 1, 1);
    });
    ctx.globalAlpha = 1;
  }
  // След за плывущей уткой: две расходящиеся черты позади.
  function wake(ctx: Ctx, x: number, y: number, left: boolean, s: number) {
    const back = left ? 1 : -1, ph = Math.floor(s * 4) % 3;
    ctx.fillStyle = RING;
    for (let i = 0; i < 3; i++) {
      const bx = Math.round(x) + back * (6 + i * 2 + ph), a = 0.7 - i * 0.2;
      ctx.globalAlpha = a;
      if (wet(bx, Math.round(y) - 1 - i)) ctx.fillRect(bx, Math.round(y) - 1 - i, 1, 1);
      if (wet(bx, Math.round(y) + 1 + i)) ctx.fillRect(bx, Math.round(y) + 1 + i, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  // Брызги: капли разлетаются и падают обратно. n — номер всплеска, чтобы у всех игроков капли летели одинаково.
  function drops(ctx: Ctx, x: number, y: number, t: number, n: number) {
    ctx.fillStyle = '#' + PAL.W;
    for (let i = 0; i < 6; i++) {
      const vx = (hash(n * 8 + i, 31) * 2 - 1) * 14, vy = -18 - hash(n * 8 + i, 32) * 14;
      const px = Math.round(x + vx * t), py = Math.round(y + vy * t + 70 * t * t);
      if (py <= y) ctx.fillRect(px, py, 1, 1);
    }
  }

  // Взлёт или посадка утки: круг по воде и капли. v — секунд с того мига.
  function splash(ctx: Ctx, p: Pt, v: number, n: number) {
    if (v < 0 || v > 1.6) return;
    ring(ctx, p.x, p.y, 3 + v * 7, 1 - v / 1.6);
    if (v < 0.45) drops(ctx, p.x, p.y, v, n);
  }

  // ---------- рыбы ----------
  function fish(s: number, out: Shown[]) {
    if (!fishSpots.length) return;
    const now = Math.floor(s / FISHES.every);
    for (let n = now - 1; n <= now; n++) {      // всплеск прошлой рыбы ещё может расходиться кругами
      if (hash(n, 21) >= FISHES.chance) continue;
      const u = s - n * FISHES.every, p = fishSpots[Math.floor(hash(n, 22) * fishSpots.length)]!;
      const left = hash(n, 23) < 0.5, dir = left ? -1 : 1;
      if (hash(n, 24) < FISHES.jump) {
        const [len, high] = FISHES.hop, ex = p.x + dir * len;
        if (u > 3) continue;
        out.push({ kind: 'water', y: p.y, draw: ctx => {
          ring(ctx, p.x, p.y, 1 + u * 5, u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 1.6);                // где вынырнула
          if (u > 1) { ring(ctx, ex, p.y, 2 + (u - 1) * 5, 1 - (u - 1) / 1.6); ring(ctx, ex, p.y, 1 + (u - 1.3) * 4, 0.8 - (u - 1.3) / 1.2); }
          if (u > 0.3 && u < 0.5) put(ctx, splashArt.small, p.x, p.y, left);
          if (u > 1 && u < 1.25) put(ctx, splashArt.big, ex, p.y, left);
          if (u > 1.15 && u < 1.6) drops(ctx, ex, p.y, u - 1.15, n);
        } });
        if (u > 0.3 && u < 1) {                 // сам прыжок — над водой, по дуге
          const k = (u - 0.3) / 0.7, x = p.x + dir * len * k, y = p.y - 2 - high * 4 * k * (1 - k);
          const f: FishFrame = k < 0.32 ? 'up' : k < 0.68 ? 'flat' : 'down';
          out.push({ kind: 'water', y: p.y + 0.5, draw: ctx => put(ctx, fishArt[f], x, y, left) });
        }
      } else {
        if (u > 3.2) continue;
        const show = clamp(u - 0.35, 0, 2.2), x = p.x + dir * 4 * show / 2.2;
        out.push({ kind: 'water', y: p.y, draw: ctx => {
          ring(ctx, p.x, p.y, 1 + u * 3.5, u < 0.35 ? u / 0.35 : 1 - u / 3.2);
          if (u > 1.2) ring(ctx, x, p.y, 2 + (u - 1.2) * 4, 0.7 - (u - 1.2) / 2);
          // поднимается из воды по ряду, держится и уходит вглубь; на уходе — всплеск хвостом
          const rows = u < 0.35 ? 0 : u < 0.8 ? (u - 0.35) * 14 : u < 2.25 ? 99 : (2.55 - u) * 20;
          put(ctx, fishArt.back, x, p.y, left, rows);
          if (u > 2.25 && u < 2.5) put(ctx, splashArt.small, x - dir * 6, p.y, left);
        } });
      }
    }
  }

  // ms — часы причала; near — где стоят игроки (ступни): уток можно спугнуть.
  // water — то, что лежит на воде: рисовать в общей очереди по y; air — летящие утки: поверх всего.
  function at(ms: number, near: Pt[]) {
    const s = ms / 1000, shown: Shown[] = [];
    fish(s, shown);
    DUCKS.forEach((_, d) => duck(d, s + d * 41, near, shown));
    return {
      water: shown.flatMap(e => e.kind === 'water' ? [{ y: e.y, draw: e.draw }] : []),
      air: shown.flatMap(e => e.kind === 'air' ? [e.draw] : []),
    };
  }
  return { at };
}
