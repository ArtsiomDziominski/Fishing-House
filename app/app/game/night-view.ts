// Вечер и ночь: над поляной летают светлячки, на реке дрожит свет из окон дома и лунная дорожка, в воде мерцают звёзды.
// Тот же вид — и у острова (свои вода и суша, окон там нет).
// Только картинка. Рисуется поверх ночного затемнения — иначе огоньки потемнели бы вместе с кадром.
// Всё случайное здесь у каждого игрока своё, как в погоде и в реке: огоньки никто не сверяет.

import { World, type Box } from '@fh/shared';

type Ctx = CanvasRenderingContext2D;
const W = World.W, H = World.H;

const FLIES = { n: 40, roam: [14, 6], lift: [5, 13], color: '#d9ff6e' };   // roam — насколько далеко от своего места по x и y; lift — высота над травой
const WINDOWS = { n: 64, reach: 46, pad: 10, color: '#ffb84e' };           // reach — на сколько пикселей от берега тянется отсвет; pad — шире окон в стороны
const MOON = { n: 44, x: 0.8, wide: [8, 30], color: '#dbe9ff' };           // x — где дорожка, доля ширины карты; wide — её ширина у дальнего берега и у края
const STARS = { n: 70, color: '#eef5ff' };
const DUSK = [0.3, 0.46];          // темнота, с которой всё это проступает и с которой горит в полную силу

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface Fly { x: number; y: number; lift: number; a: number; b: number; p: number; q: number; blink: number }
interface Dash { x: number; y: number; len: number; ph: number; k: number }   // k — яркость по месту, 0..1

// water — маска воды (1 — вода), та же, что у реки; walk — где светлячкам летать (над тем, где ходит герой); lights — окна дома
// (их отсвет на воде; null — окон нет).
export function createNightView(water: Uint8Array, walk: (x: number, y: number) => boolean = World.canWalk, L: Box | null = World.lights) {
  const wet = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && water[y * W + x] === 1;
  const bank = (x: number) => { for (let y = 0; y < H; y++) if (wet(x, y)) return y; return -1; };   // где в столбце начинается вода

  // Светлячки живут над травой, где ходит герой: в лесу их закрыли бы кроны, а над водой им делать нечего.
  const flies: Fly[] = [];
  for (let i = 0; i < 4000 && flies.length < FLIES.n; i++) {
    const x = Math.floor(rnd(8, W - 8)), y = Math.floor(rnd(8, H - 8));
    if (!walk(x, y) || wet(x, y)) continue;
    flies.push({ x, y, lift: rnd(FLIES.lift[0]!, FLIES.lift[1]!), a: rnd(0.25, 0.6), b: rnd(0.4, 0.9), p: rnd(0, 6.283), q: rnd(0, 6.283), blink: rnd(0.9, 1.7) });
  }

  // Отсвет окон: штрихи на воде под домом, чем дальше от берега — тем слабее.
  const windows: Dash[] = [];
  if (L) for (let i = 0; i < 2000 && windows.length < WINDOWS.n; i++) {
    const x = Math.floor(rnd(L.x - WINDOWS.pad, L.x + L.w + WINDOWS.pad)), top = bank(x); if (top < 0) continue;
    const d = Math.floor(rnd(1, WINDOWS.reach) * Math.random());              // ближе к берегу — гуще
    if (wet(x, top + d)) windows.push({ x, y: top + d, len: Math.round(rnd(3, 7)), ph: rnd(0, 6.283), k: 1 - d / WINDOWS.reach });
  }
  // Лунная дорожка: от дальнего берега к зрителю, расширяясь.
  const moon: Dash[] = [], mx = Math.round(W * MOON.x), mTop = bank(mx);
  if (mTop >= 0) for (let i = 0; i < 2000 && moon.length < MOON.n; i++) {
    const y = Math.floor(rnd(mTop + 2, H)), f = (y - mTop) / Math.max(1, H - mTop), half = (MOON.wide[0]! + (MOON.wide[1]! - MOON.wide[0]!) * f) / 2;
    const x = Math.round(mx + rnd(-half, half) * Math.random());              // к середине дорожки — гуще
    if (wet(x, y)) moon.push({ x, y, len: Math.round(rnd(2, 4 + f * 3)), ph: rnd(0, 6.283), k: 0.6 + 0.4 * Math.random() });
  }
  const stars: Dash[] = [];
  for (let i = 0; i < 4000 && stars.length < STARS.n; i++) {
    const x = Math.floor(rnd(0, W)), y = Math.floor(rnd(0, H));
    if (wet(x, y)) stars.push({ x, y, len: 1, ph: rnd(0, 6.283), k: rnd(0.5, 1) });
  }

  // Мерцающие штрихи по воде: speed — как быстро дрожат, gate — какую долю времени штриха не видно.
  function dashes(ctx: Ctx, list: Dash[], t: number, color: string, power: number, speed: number, gate: number) {
    if (power < 0.02) return;
    ctx.fillStyle = color;
    for (const d of list) {
      const a = Math.sin(t * speed * (0.7 + d.k * 0.5) + d.ph); if (a < gate) continue;
      const sway = Math.round(Math.sin(t * 0.8 + d.ph * 2));                  // воду покачивает — штрих гуляет на пиксель
      ctx.globalAlpha = (a - gate) / (1 - gate) * d.k * power;
      for (let i = 0; i < d.len; i++) if (wet(d.x + sway + i, d.y)) ctx.fillRect(d.x + sway + i, d.y, 1, 1);
    }
  }

  // t — секунды; dark — насколько темно (0..1), lit — горит ли свет в доме (0..1); st — сила погоды: тучи, дождь, ветер, туман.
  function draw(ctx: Ctx, t: number, dark: number, lit: number, st: { clouds: number; rain: number; wind: number; fog: number }) {
    const night = clamp((dark - DUSK[0]!) / (DUSK[1]! - DUSK[0]!), 0, 1);
    if (night <= 0 && lit <= 0) return;
    ctx.globalCompositeOperation = 'lighter';
    const sky = night * (1 - st.clouds) * (1 - st.fog * 0.7);                 // луну и звёзды закрывают тучи и туман
    dashes(ctx, stars, t, STARS.color, sky * 0.7, 0.9, 0.8);
    dashes(ctx, moon, t, MOON.color, sky * 0.6, 2.2, 0.1);
    ctx.globalCompositeOperation = 'source-over';                             // тёплый отсвет кладётся краской: в сложении с синей водой он бы побелел
    dashes(ctx, windows, t, WINDOWS.color, lit * night * 0.8 * (1 - st.rain * 0.5), 1.6, -0.5);
    ctx.globalCompositeOperation = 'lighter';
    // светлячки: в дождь прячутся, на ветру их меньше
    const out = night * (1 - st.rain) * (1 - st.wind * 0.6);
    if (out > 0.02) {
      ctx.fillStyle = FLIES.color;
      flies.forEach((f, i) => {
        if (i >= flies.length * out) return;                                  // в сумерках загораются по одному
        const glow = clamp(Math.sin(t * f.blink + f.p) * 1.4 + 0.3, 0, 1) * clamp(Math.sin(t * 0.21 + f.q) + 0.8, 0, 1);   // мигает, а временами гаснет надолго
        if (glow < 0.05) return;
        const x = Math.round(f.x + Math.sin(t * f.a + f.p) * FLIES.roam[0]! + Math.sin(t * f.b + f.q) * 3);
        const y = Math.round(f.y - f.lift + Math.sin(t * f.b + f.p) * FLIES.roam[1]! + Math.cos(t * f.a * 2 + f.q) * 2);
        ctx.globalAlpha = glow * 0.14; ctx.fillRect(x - 2, y - 1, 5, 3); ctx.fillRect(x - 1, y - 2, 3, 5);   // ореол
        ctx.globalAlpha = glow * 0.4; ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3);
        ctx.globalAlpha = glow; ctx.fillRect(x, y, 1, 1);
      });
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  return { draw };
}
