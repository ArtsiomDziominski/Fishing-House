// Погода на экране: пасмурный свет, дождь с брызгами и ветер — порывы и летящие листья.
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

// Круги на воде от капли: [dx, dy, ширина] — маленький и расходящийся, с разрывами сверху и снизу.
const RING_SMALL = [[-1, -1, 3], [-2, 0, 1], [2, 0, 1], [-1, 1, 3]] as const;
const RING_WIDE = [[-2, -1, 2], [1, -1, 2], [-3, 0, 1], [3, 0, 1], [-2, 1, 2], [1, 1, 2]] as const;

interface Drop { x: number; y: number; h: number; len: number; t: number; wait: number; live: boolean }   // x, y — куда упадёт, h — с какой высоты, len — длина штриха, t — доля пути
interface Splash { x: number; y: number; age: number; water: boolean }
interface Gust { x: number; y: number; age: number; life: number; len: number; amp: number; phase: number; speed: number }
interface Leaf { x: number; y: number; age: number; life: number; speed: number; amp: number; freq: number; phase: number; fall: number; color: string }

const rnd = ([a, b]: Range) => a + Math.random() * (b - a);

// Где на карте вода: синие пиксели, связанные с рекой у нижнего края. Так в воду не попадают синяя дверь и стёкла окон.
function findWater(map: CanvasImageSource): Uint8Array {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d', { willReadFrequently: true })!; cx.drawImage(map, 0, 0);
  const px = cx.getImageData(0, 0, W, H).data, water = new Uint8Array(W * H);
  const blue = (i: number) => px[i * 4 + 2]! > px[i * 4]! + 30 && px[i * 4 + 2]! > px[i * 4 + 1]! - 10;
  const stack: number[] = [];
  for (let i = W * (H - 40); i < W * H; i++) if (blue(i)) stack.push(i);     // река занимает низ карты — отсюда и растём
  while (stack.length) {
    const i = stack.pop()!; if (water[i] || !blue(i)) continue;
    water[i] = 1;
    const x = i % W;
    if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W); if (i < W * (H - 1)) stack.push(i + W);
  }
  return water;
}

// map — карта мира (по ней ищется вода).
export function createWeatherView(map: CanvasImageSource) {
  const water = findWater(map);
  const st = { clouds: 0, rain: 0, wind: 0 };        // сила явлений сейчас, 0..1
  const drops: Drop[] = Array.from({ length: RAIN.drops }, () => ({ x: 0, y: 0, h: 1, len: 1, t: 0, wait: 0, live: false }));
  const splashes: Splash[] = [], gusts: Gust[] = [], leaves: Leaf[] = [];
  let gustIn = 0, leafIn = 0;

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

  // Рисует поверх мира и героев: брызги, капли, порывы ветра, листья.
  function draw(ctx: Ctx) {
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

  // Цвет, на который умножается кадр: в пасмурную погоду свет серее и холоднее, в дождь — ещё темнее.
  function tint(): [number, number, number] {
    const mix = (i: number) => { const c = 255 + (CLOUD[i]! - 255) * st.clouds; return c + (STORM[i]! - c) * st.rain; };
    return [mix(0), mix(1), mix(2)];
  }

  // Серая дымка поверх кадра, 0..1: под тучами свет ровный, краски бледнее.
  const haze = () => 0.1 * st.clouds + 0.05 * st.rain;

  return { st, update, draw, tint, haze };
}
