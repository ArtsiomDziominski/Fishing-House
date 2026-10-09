// Погода на экране: пасмурный свет, дождь с брызгами, туман и ветер — порывы и летящие листья.
// Какая сейчас погода, решает сервер (@fh/shared/weather.ts), здесь только картинка. Сила каждого явления плавно
// догоняет цель, поэтому погода не меняется рывком. Всё случайное здесь у каждого игрока своё: капли никто не сверяет.

import { World, type Weather } from '@fh/shared';

type Ctx = CanvasRenderingContext2D;
type Range = [number, number];
const W = World.W, H = World.H;

const EASE = 0.8;                                   // как быстро сила явления догоняет цель, 1/с
// Капля летит к своей точке на земле с высоты fall и там разбивается. slant — наклон без ветра, windSlant — добавка от ветра.
const RAIN = { drops: 260, speed: 310, fall: [46, 84] as Range, len: [4, 8] as Range, slant: 0.14, windSlant: 0.55, color: '#c2dcee', alpha: 0.55 };
const SPLASH = { life: 0.42, max: 600, water: '#b4e2f6', land: '#d5e3ee' };
// Порыв — светлая лента, бегущая по волнистой дорожке слева направо (туда же сносит дым).
const GUST = { every: 0.14, life: [0.9, 1.3] as Range, len: [18, 34] as Range, speed: [110, 165] as Range, amp: [1.5, 3] as Range, color: '#f2f8f9', alpha: 0.85 };
const LEAF = { every: 0.07, life: [1.8, 2.6] as Range, speed: [75, 125] as Range, colors: ['#b9d04a', '#d9b23c', '#c06a2a', '#e6dc8a'] };
const CLOUD = [198, 207, 220], STORM = [164, 178, 204];   // на эти цвета умножается кадр в пасмурную погоду и в дождь
export const HAZE = '#b4bcc6';                           // цвет дымки под тучами
// Туман — два слоя шума разной крупности, каждый ползёт со своей скоростью (ветер гонит оба вправо, туда же, куда порывы).
// Их сумма раскладывается на несколько ступеней прозрачности с узором Байера между ними: туман остаётся пиксельным, без
// мягких градиентов. veil — ровная пелена везде, banks — полосы поверх неё; полосы гуще над водой и вдали (вверху кадра).
// Шум повторяется по x через period, поэтому слои можно сдвигать по кругу без конца. fps — как часто перерисовывать слой.
const FOG = { color: [223, 229, 232], steps: 6, veil: 0.18, banks: 0.55, fps: 15, period: 1024,
  far: { cell: [64, 20] as Range, calm: 3, wind: 16 }, near: { cell: [32, 12] as Range, calm: -2, wind: 26 } };
const FOG_LIGHT = [226, 230, 234];                       // в туман свет белёсый: ровнее и светлее, чем просто под тучами
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);

// Круги на воде от капли: [dx, dy, ширина] — маленький и расходящийся, с разрывами сверху и снизу.
const RING_SMALL = [[-1, -1, 3], [-2, 0, 1], [2, 0, 1], [-1, 1, 3]] as const;
const RING_WIDE = [[-2, -1, 2], [1, -1, 2], [-3, 0, 1], [3, 0, 1], [-2, 1, 2], [1, 1, 2]] as const;

interface Drop { x: number; y: number; h: number; len: number; t: number; wait: number; live: boolean }   // x, y — куда упадёт, h — с какой высоты, len — длина штриха, t — доля пути
interface Splash { x: number; y: number; age: number; water: boolean }
interface Gust { x: number; y: number; age: number; life: number; len: number; amp: number; phase: number; speed: number }
interface Leaf { x: number; y: number; age: number; life: number; speed: number; amp: number; freq: number; phase: number; fall: number; color: string }

const rnd = ([a, b]: Range) => a + Math.random() * (b - a);

// Гладкий шум 0..1 шириной FOG.period и высотой с карту: крупные пятна cell и мелкие вдвое меньше поверх.
function fogNoise([cw, ch]: Range): Float32Array {
  const P = FOG.period, out = new Float32Array(P * H), s = (t: number) => t * t * (3 - 2 * t);
  for (const [k, w] of [[1, 0.7], [0.5, 0.3]] as const) {
    const sx = cw * k, sy = ch * k, gx = P / sx, gy = Math.ceil(H / sy) + 1;
    const grid = Float32Array.from({ length: gx * gy }, () => Math.random());
    for (let y = 0; y < H; y++) {
      const j = Math.floor(y / sy), v = s(y / sy - j);
      for (let x = 0; x < P; x++) {
        const i = Math.floor(x / sx), u = s(x / sx - i), i1 = (i + 1) % gx;
        const a = grid[j * gx + i]!, b = grid[j * gx + i1]!, c = grid[(j + 1) * gx + i]!, d = grid[(j + 1) * gx + i1]!;
        const top = a + (b - a) * u;
        out[y * P + x]! += w * (top + (c + (d - c) * u - top) * v);
      }
    }
  }
  return out;
}

// Где полосы тумана гуще, 0..1: над водой (маска размыта, чтобы у берега туман редел плавно) и вдали.
function fogDensity(water: Uint8Array): Float32Array {
  const R = 10, n = 2 * R + 1, tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const row = new Float32Array(W + 1), col = new Float32Array(H + 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) row[x + 1] = row[x]! + water[y * W + x]!;
    for (let x = 0; x < W; x++) tmp[y * W + x] = (row[Math.min(W, x + R + 1)]! - row[Math.max(0, x - R)]!) / n;
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) col[y + 1] = col[y]! + tmp[y * W + x]!;
    for (let y = 0; y < H; y++) {
      const wet = (col[Math.min(H, y + R + 1)]! - col[Math.max(0, y - R)]!) / n;
      out[y * W + x] = Math.min(1, 0.45 + 0.45 * wet + 0.25 * (1 - y / H));
    }
  }
  return out;
}

// water — где на карте вода (её находит river-view.ts): капля там оставляет круги, а не брызги. На острове вода своя — useWater.
export function createWeatherView(water: Uint8Array) {
  const st = { clouds: 0, rain: 0, wind: 0, fog: 0 };   // сила явлений сейчас, 0..1
  const drops: Drop[] = Array.from({ length: RAIN.drops }, () => ({ x: 0, y: 0, h: 1, len: 1, t: 0, wait: 0, live: false }));
  const splashes: Splash[] = [], gusts: Gust[] = [], leaves: Leaf[] = [];
  let gustIn = 0, leafIn = 0;
  // Слой тумана — отдельный холст размером с карту. Шум и плотность считаются, только когда туман впервые понадобился.
  let fog: { far: Float32Array; near: Float32Array; dens: Float32Array; canvas: HTMLCanvasElement; ctx: Ctx; img: ImageData } | null = null;
  let farX = 0, nearX = 0, fogIn = 0;

  function paintFog() {
    if (!fog) {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!, img = ctx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) img.data.set(FOG.color, i * 4);
      fog = { far: fogNoise(FOG.far.cell), near: fogNoise(FOG.near.cell), dens: fogDensity(water), canvas, ctx, img };
    }
    const { far, near, dens, img } = fog, a = img.data, P = FOG.period;
    const fx = ((Math.floor(farX) % P) + P) % P, nx = ((Math.floor(nearX) % P) + P) % P;   // слои сдвигаются целыми пикселями
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, n = 0.6 * far[y * P + (x - fx + P) % P]! + 0.4 * near[y * P + (x - nx + P) % P]!;
      const bank = Math.min(1, Math.max(0, (n - 0.38) / 0.4));   // ниже порога — между полосами чисто, только пелена
      const v = st.fog * (FOG.veil + FOG.banks * bank * dens[i]!);
      a[i * 4 + 3] = Math.min(255, Math.floor(v * FOG.steps + BAYER[(y & 3) * 4 + (x & 3)]!) / FOG.steps * 255);
    }
    fog.ctx.putImageData(img, 0, 0);
  }

  function aim(d: Drop, first: boolean) {             // новая капля: куда упадёт и с какой высоты
    d.x = Math.floor(Math.random() * W); d.y = Math.floor(Math.random() * H);
    d.h = rnd(RAIN.fall); d.len = Math.floor(rnd(RAIN.len)); d.t = 0; d.live = true;
    d.wait = first ? Math.random() * 0.3 : Math.random() * 0.04;   // первые капли начинают вразнобой
  }
  function ease(now: number, goal: number, k: number) { const v = now + (goal - now) * k; return Math.abs(v - goal) < 0.002 ? goal : v; }

  function update(dt: number, goal: Weather) {
    const k = 1 - Math.exp(-dt * EASE);
    st.clouds = ease(st.clouds, goal.kind === 'clear' ? 0 : 1, k);
    st.rain = ease(st.rain, goal.kind === 'rain' ? 1 : 0, k);
    st.wind = ease(st.wind, goal.wind ? 1 : 0, k);
    st.fog = ease(st.fog, goal.kind === 'fog' ? 1 : 0, k);

    if (st.fog > 0) {                                  // туман и наплывает плавно: с силой растут и пелена, и полосы
      farX += dt * (FOG.far.calm + FOG.far.wind * st.wind); nearX += dt * (FOG.near.calm + FOG.near.wind * st.wind);
      fogIn -= dt; if (fogIn <= 0) { fogIn = 1 / FOG.fps; paintFog(); }
    }

    const active = Math.round(RAIN.drops * st.rain);   // чем сильнее дождь, тем больше капель в воздухе
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i]!;
      if (!d.live) { if (i < active) aim(d, true); continue; }
      if (d.wait > 0) { d.wait -= dt; continue; }
      d.t += dt * RAIN.speed / d.h;
      if (d.t < 1) continue;
      if (splashes.length < SPLASH.max) splashes.push({ x: d.x, y: d.y, age: 0, water: water[d.y * W + d.x] === 1 });
      if (i < active) aim(d, false); else d.live = false;
    }
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i]!; s.age += dt;
      if (s.age >= SPLASH.life) { splashes[i] = splashes[splashes.length - 1]!; splashes.pop(); }
    }

    gustIn -= dt * st.wind; leafIn -= dt * st.wind;    // чем слабее ветер, тем реже порывы и листья
    if (st.wind > 0.05 && gustIn <= 0) {
      gustIn = GUST.every * (0.6 + Math.random() * 0.8);
      gusts.push({ x: -20 + Math.random() * (W * 0.75), y: 8 + Math.random() * (H - 16), age: 0, life: rnd(GUST.life), len: Math.round(rnd(GUST.len)), amp: rnd(GUST.amp), phase: Math.random() * 6.28, speed: rnd(GUST.speed) });
    }
    if (st.wind > 0.05 && leafIn <= 0) {
      leafIn = LEAF.every * (0.6 + Math.random() * 0.8);
      leaves.push({ x: -4 + Math.random() * (W * 0.6), y: Math.random() * (H * 0.8), age: 0, life: rnd(LEAF.life), speed: rnd(LEAF.speed), amp: 3 + Math.random() * 5, freq: 3 + Math.random() * 3, phase: Math.random() * 6.28, fall: 6 + Math.random() * 14, color: LEAF.colors[Math.floor(Math.random() * LEAF.colors.length)]! });
    }
    for (let i = gusts.length - 1; i >= 0; i--) {
      const g = gusts[i]!; g.age += dt; g.x += g.speed * dt;
      if (g.age >= g.life) { gusts[i] = gusts[gusts.length - 1]!; gusts.pop(); }
    }
    for (let i = leaves.length - 1; i >= 0; i--) {
      const l = leaves[i]!; l.age += dt; l.x += l.speed * dt;
      if (l.age >= l.life) { leaves[i] = leaves[leaves.length - 1]!; leaves.pop(); }
    }
  }

  // Рисует поверх мира и героев: туман, брызги, капли, порывы ветра, листья.
  function draw(ctx: Ctx) {
    if (fog && st.fog > 0) ctx.drawImage(fog.canvas, 0, 0);
    for (const s of splashes) {
      const a = s.age / SPLASH.life;
      if (s.water) {                                   // на воде: всплеск, потом круг, который расходится и тает
        ctx.fillStyle = SPLASH.water;
        if (a < 0.3) {
          ctx.globalAlpha = 0.9;
          ctx.fillRect(s.x - 1, s.y, 3, 1); ctx.fillRect(s.x, s.y - 1 - Math.floor(a * 10), 1, 1);
        } else {
          const wide = a >= 0.62;
          ctx.globalAlpha = wide ? 0.55 * (1 - (a - 0.62) / 0.38) : 0.75;
          for (const [dx, dy, w] of wide ? RING_WIDE : RING_SMALL) ctx.fillRect(s.x + dx, s.y + dy, w, 1);
        }
      } else if (a < 0.5) {                            // на земле, крыше и листве: две брызги в стороны
        const fly = Math.floor(a * 4);
        ctx.fillStyle = SPLASH.land; ctx.globalAlpha = 0.55 * (1 - a * 2);
        if (!fly) ctx.fillRect(s.x, s.y, 1, 1);
        ctx.fillRect(s.x - 1 - fly, s.y - 1, 1, 1); ctx.fillRect(s.x + 1 + fly, s.y - 1, 1, 1);
      }
    }

    if (st.rain > 0) {
      const sx = RAIN.slant + RAIN.windSlant * st.wind;
      ctx.fillStyle = RAIN.color; ctx.globalAlpha = RAIN.alpha;
      for (const d of drops) {
        if (!d.live || d.wait > 0) continue;
        const left = (1 - d.t) * d.h, x = d.x - sx * left, y = d.y - left;
        for (let i = 0; i < d.len; i++) ctx.fillRect(Math.round(x - sx * i), Math.round(y - i), 1, 1);
      }
    }

    ctx.fillStyle = GUST.color;
    for (const g of gusts) {
      const power = Math.sin(Math.PI * g.age / g.life) * GUST.alpha * st.wind;
      for (let s = 0; s < g.len; s++) {                // голова ярче, хвост тает
        const x = g.x - s;
        ctx.globalAlpha = power * Math.sqrt(1 - s / g.len);
        ctx.fillRect(Math.round(x), Math.round(g.y + Math.sin(x * 0.11 + g.phase) * g.amp), 1, 1);
      }
    }
    for (const l of leaves) {
      const a = l.age / l.life, swing = l.age * l.freq + l.phase, flat = Math.cos(swing * 1.7) > 0;
      ctx.globalAlpha = Math.min(1, a * 6, (1 - a) * 4);
      ctx.fillStyle = l.color;
      ctx.fillRect(Math.round(l.x), Math.round(l.y + l.fall * l.age + Math.sin(swing) * l.amp), flat ? 2 : 1, flat ? 1 : 2);   // лист вертится: то плашмя, то ребром
    }
    ctx.globalAlpha = 1;
  }

  // Цвет, на который умножается кадр: в пасмурную погоду свет серее и холоднее, в дождь — ещё темнее, в туман — белёсый.
  function tint(): [number, number, number] {
    const mix = (i: number) => { let c = 255 + (CLOUD[i]! - 255) * st.clouds; c += (STORM[i]! - c) * st.rain; return c + (FOG_LIGHT[i]! - c) * st.fog; };
    return [mix(0), mix(1), mix(2)];
  }

  // Серая дымка поверх кадра, 0..1: под тучами свет ровный, краски бледнее.
  const haze = () => 0.1 * st.clouds + 0.05 * st.rain;

  // Другой кадр — другая вода (остров): круги от капель и гуще туман — над ней.
  function useWater(w: Uint8Array) {
    if (w === water) return;
    water = w; splashes.length = 0;
    if (fog) fog.dens = fogDensity(w);
  }

  return { st, update, draw, tint, haze, useWater };
}
