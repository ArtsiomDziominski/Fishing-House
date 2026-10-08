// Кот и собака: бродят по поляне, садятся, ложатся, прыгают; кот иногда дремлет, собака что-то вынюхивает.
// Ночью оба спят у крыльца дома: вечером приходят туда, утром уходят бродить снова.
// Только картинка — героя не задерживают и на игру не влияют. Где они и что делают, считается от часов причала
// (их ведёт сервер), поэтому все игроки видят одних и тех же зверей в одних и тех же местах.
// Ходят только там, где может ходить герой: карту проходимости берём из игры при создании (World.walk), маршруты
// ищем по ней сами — так лес, река и дом им тоже не по пути, а поставленное ведро у каждого своё и пути не меняет.
// Кадры — пиксельные карты 1:1 в арт-пикселях (буква — цвет из PAL, точка — пусто), мордой вправо; влево — отражение.
// Размер под героя 19×34: кот 12×9, собака 16×11. a — точка опоры: середина лап на нижнем ряду.

import { World, DAY_LENGTH, NIGHT_HOURS, dayPart } from '@fh/shared';

type Ctx = CanvasRenderingContext2D;
interface Pt { x: number; y: number }
interface Map1 { a: number[]; rows: string[] }

const PAL: Record<string, string> = {
  o: '2a1a12',                                                                    // контур
  O: 'b4561a', r: 'e0842f', y: 'f2b36a', w: 'f4ecdc', e: '5b7a1e', p: 'e88a8a',   // кот: полоски, шерсть, светлое, белое, глаз, нос
  B: '5e3418', b: '9a5a2a', l: 'd29a5c', L: 'ecc58e', n: '1a1210', k: '1a1210',   // собака: ухо и хвост, шерсть, живот, морда, нос, глаз
};

const CAT = {
  walk1: { a: [5, 8], rows: [
    '.o.....o..o.',
    'O.....orooro',
    'O.....orrrro',
    '.Oooooorrero',
    '.orOrOrryyyp',
    '.orOrOrrwwo.',
    '.oryyyywo...',
    '..r.r.w.w...',
    '..o.o.o.o...',
  ] },
  walk2: { a: [5, 8], rows: [
    '.o.....o..o.',
    'O.....orooro',
    'O.....orrrro',
    '.Oooooorrero',
    '.orOrOrryyyp',
    '.orOrOrrwwo.',
    '.oryyyywo...',
    '...rr..ww...',
    '...oo..oo...',
  ] },
  sit: { a: [4, 9], rows: [
    '....o..o.',
    '...orooro',
    '...orrrro',
    '...orrero',
    '..oorryyp',
    '.orOrrwwo',
    '.orOrrwo.',
    'orrOrrwo.',
    'orrrrywo.',
    'Ooooooww.',
  ] },
  lie: { a: [6, 6], rows: [
    '........o..o.',
    '.......orooro',
    '..ooooo.rrrro',
    '.orOrOrorrrro',
    'OorOrOrrooryp',
    'Ooryyyyywwwwo',
    '.OOooooooooo.',
  ] },
  jump: { a: [6, 7], rows: [
    '........o..o',
    '.......orooro',
    'OO.....orrrro',
    '..Ooooooorero',
    '..orOrOrryyyp',
    '.orrOrOrrwwo.',
    'oroyyyyyw.ww.',
    'o.........oo.',
  ] },
};
const DOG = {
  walk1: { a: [7, 10], rows: [
    '..........ooo...',
    '.o.......oBbbo..',
    '.Bo......oBbkbo.',
    '..Bo.....oBblLLn',
    '...Bbooooobblllo',
    '...obbbbbbbbloo.',
    '...obbbbbbbbLo..',
    '...oblllllllbo..',
    '...bb.....bb....',
    '..bo.......bo...',
    '..oo.......oo...',
  ] },
  walk2: { a: [7, 10], rows: [
    '..........ooo...',
    '.o.......oBbbo..',
    '.Bo......oBbkbo.',
    '..Bo.....oBblLLn',
    '...Bbooooobblllo',
    '...obbbbbbbbloo.',
    '...obbbbbbbbLo..',
    '...oblllllllbo..',
    '....bb....bb....',
    '....bo....bo....',
    '....oo....oo....',
  ] },
  sniff: { a: [7, 10], rows: [
    '................',
    '.o..............',
    '.Bo.......ooo...',
    '..Bo.....oBbbo..',
    '...Bboooo.Bbkbo.',
    '...obbbbbbBblLLo',
    '...obbbbbbbblLLn',
    '...oblllllllbooo',
    '...bb.....bb....',
    '...bo.....bo....',
    '...oo.....oo....',
  ] },
  sit: { a: [5, 10], rows: [
    '....ooo...',
    '...oBbbo..',
    '...oBbkbo.',
    '...oBblLLn',
    '..obbblllo',
    '.obbbbLLo.',
    '.obbbbLLo.',
    'oBobbbLLo.',
    'oBbbbblbo.',
    '.Bbbbbl.b.',
    '.oooooo.oo',
  ] },
  lie: { a: [10, 6], rows: [
    '..............ooo...',
    '.............oBbbo..',
    '.............oBbkbo.',
    '..oooooooooo.oBblLLn',
    '.obbbbbbbbbbobbblllo',
    'oBbbbbbbbbbbbbblLLo.',
    'Bobllllllllllloooo..',
  ] },
  jump: { a: [8, 9], rows: [
    '...........ooo...',
    '..........oBbbo..',
    '.o........oBbkbo.',
    '.Bo.......oBblLLn',
    '..Bbooooooobblllo',
    '..obbbbbbbbbloo.',
    '..obbbbbbbbbLo..',
    '.bbllllllllbbb..',
    'bo..........obo.',
    'o............oo.',
  ] },
};
type CatFrame = keyof typeof CAT;
type DogFrame = keyof typeof DOG;
type Act = 'sit' | 'lie' | 'jump' | 'sniff';

// turn — каждые столько секунд зверь идёт на новое место и там чем-то занят до конца срока;
// speed — шаг, арт-пикселей в секунду (герой ходит 44); если место далеко, бежит, но не быстрее run.
// r — полширины лап: столько места нужно по бокам от точки опоры. acts — чем заняться на месте и как часто.
const PETS = [
  { art: CAT, turn: 24, speed: 16, run: 46, step: 6, r: 3, seed: 101, shadow: 9,
    acts: [['lie', 0.45], ['sit', 0.35], ['jump', 0.2]] as [Act, number][] },
  { art: DOG, turn: 16, speed: 24, run: 58, step: 7, r: 4, seed: 202, shadow: 12,
    acts: [['sniff', 0.4], ['sit', 0.25], ['lie', 0.15], ['jump', 0.2]] as [Act, number][] },
];
const CHAIN = 12;                  // столько сроков подряд зверь выбирает место поближе к прошлому, потом — где угодно
const NEAR = [24, 130];            // «поближе»: не ближе и не дальше стольких пикселей
const GRID = 2;                    // шаг сетки для поиска пути, арт-пикселей
const AWAY = 26;                   // от костра, места рыбака, ведра и рюкзака держатся на таком расстоянии
const BED = { x: 62, y: 8, gap: 20 };   // ночлег: у крыльца — на столько правее левого края дома и ниже его низа; друг от друга не ближе gap

const hash = (n: number, s: number) => { let h = (n * 374761393 + s * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const ease = (k: number) => k * k * (3 - 2 * k);

function paint(rows: string[], flip: boolean) {
  const w = Math.max(...rows.map(r => r.length)), h = rows.length, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!, id = x.createImageData(w, h);
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) {
    const hex = PAL[row[i]!]; if (!hex) continue;
    const o = (j * w + (flip ? w - 1 - i : i)) * 4;
    id.data[o] = parseInt(hex.slice(0, 2), 16); id.data[o + 1] = parseInt(hex.slice(2, 4), 16); id.data[o + 2] = parseInt(hex.slice(4, 6), 16); id.data[o + 3] = 255;
  } });
  x.putImageData(id, 0, 0); return c;
}
type Art = { a: number[]; img: [HTMLCanvasElement, HTMLCanvasElement] };
function sheet(src: Record<string, Map1>) {
  const out: Record<string, Art> = {};
  for (const k of Object.keys(src)) out[k] = { a: src[k]!.a, img: [paint(src[k]!.rows, false), paint(src[k]!.rows, true)] };
  return out;
}

// Где зверь может стоять: под лапами и чуть выше — проходимо. Только у зверя этого размера.
export function petRoom(walk: Uint8Array, W: number, H: number, r: number) {
  const room = new Uint8Array(W * H);
  for (let y = 1; y < H; y++) for (let x = r; x < W - r; x++) {
    let ok = walk[(y - 1) * W + x] === 1;
    for (let dx = -r; ok && dx <= r; dx++) ok = walk[y * W + x + dx] === 1;
    if (ok) room[y * W + x] = 1;
  }
  return room;
}

// Маршруты одного зверя: места, куда он ходит, и пути между ними. Всё считается от номера срока n,
// поэтому у всех игроков одно и то же. Без DOM — так это можно проверить и вне браузера.
export function petPlanner(room: Uint8Array, W: number, H: number, seed: number, avoid: Pt[]) {
  const GW = Math.ceil(W / GRID), GH = Math.ceil(H / GRID);
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && room[y * W + x] === 1;
  const cellOk = (gx: number, gy: number) => gx >= 0 && gy >= 0 && gx < GW && gy < GH && ok(gx * GRID, gy * GRID);
  // Самый большой связный кусок поляны: остальные — островки, куда не дойти (например, за деревом).
  const comp = new Int32Array(GW * GH).fill(-1), queue = new Int32Array(GW * GH);
  let best = -1, bestSize = 0, id = 0;
  for (let c0 = 0; c0 < GW * GH; c0++) {
    if (comp[c0] !== -1 || !cellOk(c0 % GW, (c0 / GW) | 0)) continue;
    let head = 0, tail = 0; queue[tail++] = c0; comp[c0] = id;
    while (head < tail) {
      const c = queue[head++]!, cx = c % GW, cy = (c / GW) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy, nc = ny * GW + nx;
        if ((dx || dy) && cellOk(nx, ny) && comp[nc] === -1) { comp[nc] = id; queue[tail++] = nc; }
      }
    }
    if (tail > bestSize) { bestSize = tail; best = id; }
    id++;
  }
  const inside = (gx: number, gy: number) => gx >= 0 && gy >= 0 && gx < GW && gy < GH && comp[gy * GW + gx] === best;
  const spots: Pt[] = [];
  for (let y = 8; y < H - 4; y += 8) for (let x = 8; x < W - 8; x += 8) {
    if (!inside(x / GRID, y / GRID)) continue;
    if (avoid.some(p => Math.hypot(p.x - x, p.y - y) < AWAY)) continue;
    spots.push({ x, y });
  }

  // Место в конце срока n: в начале цепочки — любое, дальше — одно из нескольких случайных, недалеко от прошлого.
  const spotMemo = new Map<number, Pt>();
  function spot(n: number): Pt {
    const hit = spotMemo.get(n); if (hit) return hit;
    if (spotMemo.size > 400) spotMemo.clear();
    const pick = (k: number) => spots[Math.floor(hash(n * 8 + k, seed) * spots.length)]!;
    let p = pick(0);
    if (n - Math.floor(n / CHAIN) * CHAIN !== 0) {
      const prev = spot(n - 1);
      let near: Pt | null = null, closest = p, cd = Infinity;
      for (let k = 0; k < 8; k++) {
        const q = pick(k), d = Math.hypot(q.x - prev.x, q.y - prev.y);
        if (!near && d >= NEAR[0]! && d <= NEAR[1]!) near = q;
        if (d >= NEAR[0]! && d < cd) { cd = d; closest = q; }
      }
      p = near ?? closest;
    }
    spotMemo.set(n, p); return p;
  }

  // Свободна ли прямая для зверя.
  function clear(a: Pt, b: Pt) {
    const n = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2);
    for (let i = 0; i <= n; i++) { const t = n ? i / n : 0; if (!ok(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t))) return false; }
    return true;
  }
  // Путь по сетке поиском в ширину, потом выпрямляется по прямой видимости. Первая точка — откуда.
  const came = new Int32Array(GW * GH);
  function route(a: Pt, b: Pt): Pt[] {
    if (clear(a, b)) return [a, b];
    const s = (a.y / GRID) * GW + a.x / GRID, g = (b.y / GRID) * GW + b.x / GRID;
    came.fill(-2); came[s] = -1;
    let head = 0, tail = 0; queue[tail++] = s;
    while (head < tail) {
      const c = queue[head++]!; if (c === g) break;
      const cx = c % GW, cy = (c / GW) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy, nc = ny * GW + nx;
        if (!(dx || dy) || !inside(nx, ny) || came[nc] !== -2) continue;
        if (dx && dy && (!inside(cx + dx, cy) || !inside(cx, cy + dy))) continue;
        came[nc] = c; queue[tail++] = nc;
      }
    }
    if (came[g] === -2) return [a, b];
    const cells: Pt[] = [];
    for (let c = g; c !== -1; c = came[c]!) cells.push({ x: (c % GW) * GRID, y: ((c / GW) | 0) * GRID });
    cells.reverse();
    const path: Pt[] = [cells[0]!]; let at = 0;
    while (at < cells.length - 1) {
      let far = cells.length - 1;
      while (far > at + 1 && !clear(cells[at]!, cells[far]!)) far--;
      path.push(cells[far]!); at = far;
    }
    return path;
  }
  // Путь из a в b и его длина. key — под каким именем его запомнить.
  const legMemo = new Map<string, Leg>();
  function way(key: string, a: Pt, b: Pt): Leg {
    const hit = legMemo.get(key); if (hit) return hit;
    if (legMemo.size > 8) legMemo.clear();
    const path = route(a, b), len = [0];
    for (let i = 1; i < path.length; i++) len.push(len[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y));
    const out = { path, len, total: len[len.length - 1]! };
    legMemo.set(key, out); return out;
  }
  // Переход в начале срока n: из места срока n-1 в место срока n.
  const leg = (n: number) => way('n' + n, spot(n - 1), spot(n));
  // Ночлег: место, ближайшее к точке p, из тех, что годятся (fit). Вечером зверь идёт туда с места срока n, утром — оттуда.
  function bedAt(p: Pt, fit: (q: Pt) => boolean): Pt | null {
    let best: Pt | null = null, bd = Infinity;
    for (const q of spots) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd && fit(q)) { bd = d; best = q; }
    }
    return best;
  }
  const toBed = (n: number, bed: Pt) => way('to' + n, spot(n), bed);
  const fromBed = (n: number, bed: Pt) => way('from' + n, bed, spot(n));
  return { spots, spot, leg, ok, bedAt, toBed, fromBed };
}
interface Leg { path: Pt[]; len: number[]; total: number }

// Когда звери спят. ms — часы причала; fixed — час, на котором время остановлено (?hour=22), иначе его нет.
// night — сейчас ночь; sleep и wake — секунды по часам причала, когда она началась (эта или будущая, если ещё день)
// и когда кончилась сегодня. Считаются от начала суток, поэтому не дрожат от кадра к кадру.
export function petNight(ms: number, fixed?: number) {
  const day = DAY_LENGTH * 1000, hourMs = day / 24, d0 = Math.floor(ms / day) * day, h = (ms - d0) / hourMs;
  if (fixed !== undefined) return { night: dayPart(fixed).id === 'night', still: true, sleep: 0, wake: 0 };
  const night = h >= NIGHT_HOURS.from || h < NIGHT_HOURS.to;
  const sleep = d0 + (h < NIGHT_HOURS.to ? NIGHT_HOURS.from - 24 : NIGHT_HOURS.from) * hourMs;
  return { night, still: false, sleep: sleep / 1000, wake: (d0 + NIGHT_HOURS.to * hourMs) / 1000 };
}

// at(ms) — что нарисовать в этот миг (ms — часы причала): по штуке на зверя, класть в общую очередь по y (лапы).
export function createPetsView() {
  const W = World.W, H = World.H, walk = World.walk.slice();
  const avoid = [{ x: World.fire.x, y: World.fire.y }, { x: World.seat.x, y: World.seat.y }, { x: World.bucket.baseX, y: World.bucket.baseY }, { x: World.pack.baseX, y: World.pack.baseY }];
  const beds: Pt[] = [], porch = { x: World.house.x + BED.x, y: World.house.y + World.house.h + BED.y };
  // Спящего должно быть видно целиком: ничто из стоящего ближе к зрителю (крыльцо, бочки, кусты) его не закрывает.
  const open = (q: Pt) => { for (let j = -8; j <= 0; j++) for (let i = -12; i <= 12; i++) if (World.depthAt(q.x + i, q.y + j) > q.y) return false; return true; };
  const pets = PETS.map(p => {
    const plan = petPlanner(petRoom(walk, W, H, p.r), W, H, p.seed, avoid);
    const bed = plan.bedAt(porch, q => open(q) && !beds.some(o => Math.hypot(o.x - q.x, o.y - q.y) < BED.gap));
    if (bed) beds.push(bed);
    return { ...p, sheet: sheet(p.art as Record<string, Map1>), plan, bed };
  });
  const cell = document.createElement('canvas'); cell.width = 32; cell.height = 24;
  const cctx = cell.getContext('2d')!;

  // Кадр с тенью кладётся так, чтобы точка опоры встала в (x, y); то, что закрыто деревьями и домом ближе к зрителю, стирается.
  function put(ctx: Ctx, art: Art, x: number, y: number, left: boolean, lift: number, shadow: number) {
    const img = art.img[left ? 1 : 0]!, ax = left ? img.width - 1 - art.a[0]! : art.a[0]!;
    const ox = Math.round(x) - 12, oy = Math.round(y) - 20, fx = 12 - ax, fy = 20 - art.a[1]! - lift;
    cctx.clearRect(0, 0, cell.width, cell.height);
    cctx.fillStyle = 'rgba(18, 22, 10, 0.3)';                       // тень под лапами — на земле, даже в прыжке
    const sw = Math.max(3, shadow - Math.round(lift / 2));
    cctx.fillRect(12 - (sw >> 1) + 1, 20, sw - 2, 1); cctx.fillRect(12 - (sw >> 1), 21, sw, 1);
    cctx.drawImage(img, fx, fy);
    const base = Math.round(y);
    for (let j = 0; j < cell.height; j++) for (let i = 0; i < cell.width; i++) if (World.depthAt(ox + i, oy + j) > base) cctx.clearRect(i, j, 1, 1);
    ctx.drawImage(cell, ox, oy);
  }
  function zzz(ctx: Ctx, x: number, y: number, s: number) {         // дремлет: над головой всплывают «z»
    const k = (s % 2.4) / 2.4; if (k > 0.85) return;
    ctx.globalAlpha = 1 - k; ctx.fillStyle = '#f4ecdc';
    const zx = Math.round(x + 5 + k * 4), zy = Math.round(y - 9 - k * 7);
    ctx.fillRect(zx, zy, 3, 1); ctx.fillRect(zx + 1, zy + 1, 1, 1); ctx.fillRect(zx, zy + 2, 3, 1);
    ctx.globalAlpha = 1;
  }

  // fixed — час, на котором время остановлено у этого игрока (?hour=22): тогда ночью звери просто спят на месте.
  function at(ms: number, fixed?: number) {
    const s = ms / 1000, out: { y: number; draw: (ctx: Ctx) => void }[] = [], dark = petNight(ms, fixed);
    pets.forEach((p, i) => {
      if (!p.plan.spots.length) return;
      const shift = i * 7.3, t = s + shift, n = Math.floor(t / p.turn);
      // bed — зверь у ночлега или идёт к нему. Вечером он доживает свой срок как обычно и с его места идёт спать;
      // утром спит до начала первого целого срока и с ночлега идёт на место этого срока.
      let u = t - n * p.turn, leg = p.plan.leg(n), bed = false;
      if (p.bed && dark.still) { if (dark.night) { bed = true; u = Infinity; } }
      else if (p.bed && dark.night) {
        const n0 = Math.floor((dark.sleep + shift) / p.turn);
        if (n > n0) { bed = true; leg = p.plan.toBed(n0, p.bed); u = t - (n0 + 1) * p.turn; }
      } else if (p.bed) {
        const n1 = Math.ceil((dark.wake + shift) / p.turn);
        if (n < n1) { bed = true; u = Infinity; } else if (n === n1) leg = p.plan.fromBed(n1, p.bed);
      }
      const fast = leg.total / p.speed > p.turn * 0.7, speed = fast ? Math.min(p.run, leg.total / (p.turn * 0.7)) : p.speed;
      const go = leg.total / speed;
      let x: number, y: number, left: boolean, frame: string, lift = 0, nap = false;
      const last = leg.path.length - 1;
      const endFace = leg.path[last]!.x !== leg.path[last - 1]?.x ? leg.path[last]!.x < leg.path[last - 1]!.x : hash(n, p.seed + 3) < 0.5;
      if (u < go) {                                                    // идёт или бежит
        const d = u * speed; let k = 1;
        while (k < last && leg.len[k]! < d) k++;
        const a = leg.path[k - 1]!, b = leg.path[k]!, f = (d - leg.len[k - 1]!) / Math.max(0.001, leg.len[k]! - leg.len[k - 1]!);
        x = a.x + (b.x - a.x) * f; y = a.y + (b.y - a.y) * f;
        left = Math.abs(b.x - a.x) >= 1 ? b.x < a.x : endFace;
        const pace = p.step * speed / p.speed;
        frame = Math.floor(u * pace) % 2 ? 'walk2' : 'walk1';
        if (fast) lift = Math.floor(u * pace) % 2;                     // бегом — вприпрыжку
      } else {                                                         // на месте
        const e = bed ? p.bed! : spot(p, n), v = u - go;
        x = e.x; y = e.y; left = endFace;
        const r = hash(n, p.seed + 1); let act: Act = p.acts[0]![0], acc = 0;
        for (const [a, w] of p.acts) { acc += w; if (r < acc) { act = a; break; } }
        frame = 'walk2';
        if (bed) {                                                     // пришёл на ночлег: сел, лёг, уснул
          left = beds.some(b => b !== e && b.x < e.x);                 // спят мордами друг к другу
          if (v > 0.6) frame = v < 1.8 ? 'sit' : 'lie';
          nap = v > 3.5;
        } else if (v > 0.6) {
          if (act === 'jump') {                                        // прыгает на месте: подскок, пауза
            const c = (v - 0.6) % 1.3, k = c / 0.5;
            if (k < 1) { lift = Math.round(Math.sin(k * Math.PI) * 6); frame = lift > 1 ? 'jump' : 'walk2'; }
            if (Math.floor((v - 0.6) / 1.3) % 3 === 2) { lift = 0; frame = 'sit'; }   // каждый третий раз — передышка
          } else if (act === 'sniff') {                                // нюхает землю, иногда поднимает голову и переступает
            const c = Math.floor(v * 1.5);
            frame = hash(n * 64 + c, p.seed + 4) < 0.7 ? 'sniff' : 'walk2';
            if (hash(n * 64 + Math.floor(v / 3), p.seed + 5) < 0.3) left = !left;
          } else if (act === 'lie') {
            frame = v < 1.2 ? 'sit' : 'lie';
            nap = v > 3 && p.art === CAT;
          } else frame = 'sit';
        }
      }
      const art = p.sheet[frame]!, fx = x, fy = y, fl = left, fz = lift, sleepy = nap;
      out.push({ y: fy, draw: ctx => {
        put(ctx, art, fx, fy, fl, fz, p.shadow);
        if (sleepy) zzz(ctx, fl ? fx - 10 : fx, fy, s);
      } });
    });
    return out;
  }
  const spot = (p: typeof pets[number], n: number) => p.plan.spot(n);
  return { at };
}
