// Река течёт: по воде плывут светлые штрихи — те же волны, что нарисованы на картинке, только в движении.
// Русло снимается с самой карты: в каждом столбце — где вода начинается и где кончается. Штрих держится своей доли
// ширины русла, поэтому повторяет изгибы берегов и огибает причал; рисуется он только по воде — под мостками
// пропадает. Всё случайное здесь у каждого игрока своё, как и в погоде: штрихи никто не сверяет.

import { World } from '@fh/shared';

type Ctx = CanvasRenderingContext2D;
type Range = [number, number];
const W = World.W, H = World.H;

// Течёт слева направо — туда же, куда ветер сносит дым. speed — пикселей в секунду на стрежне там, где русло шириной
// wide: в узком месте вода бежит быстрее, в заводи у причала — тише (pace — пределы), у берегов — тоже (bank).
const FLOW = { n: 128, speed: 15, wide: 32, pace: [0.65, 1.4] as Range, bank: 0.45, life: [3, 6] as Range, len: [3, 7] as Range, alpha: 0.85, rain: 0.4 };
const LIGHT = '#8ed0ef', DIM = '#6aa1bf';              // штрих на обычной воде и на тёмной полосе под берегом
const SMOOTH = 10;                                     // на сколько столбцов в каждую сторону сглаживаются берега

interface Streak { x: number; f: number; len: number; age: number; life: number }   // x — голова штриха, f — доля ширины русла от верхнего берега

const rnd = ([a, b]: Range) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// Где на карте вода: синие пиксели, связанные с рекой у нижнего края. Так в воду не попадают синяя дверь и стёкла окон.
// deep — тёмная вода под берегом: светлый штрих на ней слишком ярок.
function findWater(map: CanvasImageSource) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d', { willReadFrequently: true })!; cx.drawImage(map, 0, 0);
  const px = cx.getImageData(0, 0, W, H).data, water = new Uint8Array(W * H), deep = new Uint8Array(W * H);
  const blue = (i: number) => px[i * 4 + 2]! > px[i * 4]! + 30 && px[i * 4 + 2]! > px[i * 4 + 1]! - 10;
  const stack: number[] = [];
  for (let i = W * (H - 40); i < W * H; i++) if (blue(i)) stack.push(i);     // река занимает низ карты — отсюда и растём
  while (stack.length) {
    const i = stack.pop()!; if (water[i] || !blue(i)) continue;
    water[i] = 1; deep[i] = px[i * 4 + 1]! < 110 ? 1 : 0;
    const x = i % W;
    if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W); if (i < W * (H - 1)) stack.push(i + W);
  }
  return { water, deep };
}

// Русло по столбцам: верхний и нижний край воды. Где реку закрыла листва и воды почти не видно, берега неизвестны —
// там они тянутся напрямую от соседних столбцов. Потом оба берега сглаживаются: зубцы листвы штрихам не нужны.
function findBed(water: Uint8Array) {
  const top = new Float32Array(W).fill(-1), bot = new Float32Array(W).fill(-1);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (water[y * W + x]) { if (top[x]! < 0) top[x] = y; bot[x] = y; }
  const span = Array.from({ length: W }, (_, x) => (top[x]! < 0 ? 0 : bot[x]! - top[x]! + 1));
  const known = span.map((s, x) => {                   // воды в столбце не меньше половины обычного по соседству
    const near = span.slice(Math.max(0, x - 40), x + 41).sort((a, b) => a - b);
    return s > 0 && s >= near[near.length >> 1]! * 0.5;
  });
  const bridge = (a: Float32Array) => {
    let last = -1;
    for (let x = 0; x < W; x++) {
      if (!known[x]) continue;
      for (let i = last + 1; i < x; i++) a[i] = last < 0 ? a[x]! : a[last]! + (a[x]! - a[last]!) * (i - last) / (x - last);
      last = x;
    }
    for (let i = last + 1; i < W; i++) a[i] = last < 0 ? 0 : a[last]!;
  };
  const smooth = (a: Float32Array) => {
    const out = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      let sum = 0, n = 0;
      for (let i = Math.max(0, x - SMOOTH); i <= Math.min(W - 1, x + SMOOTH); i++) { sum += a[i]!; n++; }
      out[x] = sum / n;
    }
    return out;
  };
  bridge(top); bridge(bot);
  return { top: smooth(top), bot: smooth(bot) };
}

// map — карта мира: по ней ищутся вода и русло.
export function createRiverView(map: CanvasImageSource) {
  const { water, deep } = findWater(map), { top, bot } = findBed(water);
  const cells: number[] = [];                          // все пиксели воды: штрих рождается в случайном из них, поэтому на широкой воде их больше
  for (let i = 0; i < W * H; i++) if (water[i]) cells.push(i);
  const streaks: Streak[] = [];
  const laneY = (x: number, f: number) => { const i = clamp(Math.round(x), 0, W - 1); return top[i]! + f * (bot[i]! - top[i]!); };

  function start(s: Streak, first: boolean) {
    const c = cells[Math.floor(Math.random() * cells.length)]!, x = c % W, y = (c - x) / W;
    s.x = x; s.f = clamp((y - top[x]!) / Math.max(1, bot[x]! - top[x]!), 0, 1);
    s.len = Math.round(rnd(FLOW.len)); s.life = rnd(FLOW.life);
    s.age = first ? Math.random() * s.life : 0;        // первые штрихи уже в пути: река не начинает течь с пустой воды
    return s;
  }
  if (cells.length) for (let i = 0; i < FLOW.n; i++) streaks.push(start({ x: 0, f: 0, len: 1, age: 0, life: 1 }, true));

  // rush — сила дождя, 0..1: в дождь река бежит быстрее.
  function update(dt: number, rush: number) {
    const step = FLOW.speed * (1 + FLOW.rain * rush) * dt;
    for (const s of streaks) {
      s.age += dt;
      if (s.age >= s.life || s.x - s.len >= W) { start(s, false); continue; }
      const i = clamp(Math.round(s.x), 0, W - 2), wide = Math.max(1, bot[i]! - top[i]!), mid = s.f * 2 - 1;
      const slope = laneY(i + 1, s.f) - laneY(i, s.f);  // на изгибе штрих идёт наискось — по руслу он не должен от этого ускоряться
      s.x += step * clamp(FLOW.wide / wide, FLOW.pace[0], FLOW.pace[1]) * (1 - FLOW.bank * mid * mid) / Math.sqrt(1 + slope * slope);
    }
  }

  // Рисует по карте, под героями и всем остальным.
  function draw(ctx: Ctx) {
    for (const s of streaks) {
      const a = s.age / s.life, power = Math.min(1, a * 4, (1 - a) * 3) * FLOW.alpha;   // появляется и тает плавно
      const hx = Math.floor(s.x), hy = Math.round(laneY(hx, s.f)), ty = Math.round(laneY(hx - s.len + 1, s.f));
      const bend = ty > hy ? 1 : ty < hy ? -1 : 0;     // на уклоне русла хвост штриха на пиксель выше или ниже головы — ступенькой, как у нарисованных волн
      for (let i = 0; i < s.len; i++) {
        const x = hx - i, y = hy + (i * 2 >= s.len ? bend : 0);
        if (x < 0 || x >= W || y < 0 || y >= H || !water[y * W + x]) continue;
        ctx.globalAlpha = power * (i === 0 || i === s.len - 1 ? 0.55 : 1);   // концы мягче середины
        ctx.fillStyle = deep[y * W + x] ? DIM : LIGHT;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  return { water, streaks, update, draw };
}
