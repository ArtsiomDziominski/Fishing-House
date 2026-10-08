// Костёр на лужайке у дома (где он — World.fire): камни кругом, поленья, живое пламя и искры.
// Только картинка: сесть у огня разрешает сервер, а свет от него кладёт движок вместе с лампами.
// Пламя считается от времени, без состояния: у каждого столбца своя высота, она дрожит.

import { World } from '@fh/shared';

type Ctx = CanvasRenderingContext2D;

const PAL = { stone: '8b8f98', stoneDark: '5d6069', stoneLight: 'b4b8bf', log: '6b3d1e', logDark: '3f2212', ember: 'c8401a', red: 'e8641a', orange: 'f8a11c', yellow: 'ffe07a', spark: 'ffd27a', shadow: 'rgba(18, 22, 10, 0.3)' };
// Камни очага: [dx, dy, ширина] от середины костра; ближние к зрителю рисуются поверх поленьев.
const STONES: [number, number, number][] = [[-12, -1, 3], [-9, -4, 4], [-4, -6, 4], [1, -6, 4], [6, -4, 4], [10, -1, 3], [-12, 2, 3], [10, 2, 3], [-9, 4, 4], [-4, 5, 4], [1, 5, 4], [6, 4, 4]];
const FLAME = { half: 6, high: 18, sparks: 5, sparkLife: 1.6 };

const noise = (n: number, s: number) => { const v = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };

export function createFireView() {
  const fx = World.fire.x, fy = World.fire.y;
  const stone = (ctx: Ctx, [dx, dy, w]: [number, number, number]) => {
    ctx.fillStyle = '#' + PAL.stoneDark; ctx.fillRect(fx + dx, fy + dy, w, 2);
    ctx.fillStyle = '#' + PAL.stone; ctx.fillRect(fx + dx, fy + dy - 1, w, 2);
    ctx.fillStyle = '#' + PAL.stoneLight; ctx.fillRect(fx + dx, fy + dy - 1, w - 1, 1);
  };

  // t — секунды. Рисовать в общей очереди по y = World.fire.y: кто стоит за костром, того пламя закрывает.
  function draw(ctx: Ctx, t: number) {
    ctx.fillStyle = PAL.shadow; ctx.fillRect(fx - 12, fy + 5, 25, 2); ctx.fillRect(fx - 9, fy + 7, 19, 1);
    for (const s of STONES) if (s[1] < 0) stone(ctx, s);                    // дальние камни — за огнём
    // поленья шалашиком и угли под ними
    ctx.fillStyle = '#' + PAL.logDark; ctx.fillRect(fx - 8, fy, 17, 3);
    ctx.fillStyle = '#' + PAL.log; ctx.fillRect(fx - 8, fy - 1, 8, 3); ctx.fillRect(fx + 1, fy - 1, 8, 3); ctx.fillRect(fx - 4, fy - 5, 3, 5); ctx.fillRect(fx + 2, fy - 5, 3, 5);
    ctx.fillStyle = '#' + PAL.ember; ctx.fillRect(fx - 5, fy + 1, 11, 1);
    if (Math.floor(t * 3) % 2) { ctx.fillStyle = '#' + PAL.orange; ctx.fillRect(fx - 1 + Math.floor(noise(Math.floor(t * 3), 1) * 3), fy, 1, 1); }
    // пламя: столбцы от краёв к середине всё выше, каждый дрожит по-своему; снаружи красное, внутри жёлтое
    for (let i = -FLAME.half; i <= FLAME.half; i++) {
      const edge = 1 - Math.abs(i) / (FLAME.half + 1);
      const flick = 0.5 + 0.25 * Math.sin(t * 11 + i * 1.7) + 0.25 * Math.sin(t * 17.3 + i * 2.9);
      const h = Math.max(1, Math.round(FLAME.high * edge * (0.65 + 0.5 * flick)));
      const lean = Math.round(Math.sin(t * 2.3) * edge);                    // верхушка покачивается
      for (let j = 0; j < h; j++) {
        const k = j / h, core = edge * (1 - k);
        ctx.fillStyle = '#' + (core > 0.6 ? PAL.yellow : core > 0.3 ? PAL.orange : PAL.red);
        ctx.fillRect(fx + i + (k > 0.6 ? lean : 0), fy - 2 - j, 1, 1);
      }
    }
    // искры: взлетают над огнём и гаснут
    for (let i = 0; i < FLAME.sparks; i++) {
      const phase = t / FLAME.sparkLife + i / FLAME.sparks, born = Math.floor(phase), u = phase - born, id = born * FLAME.sparks + i;
      if (noise(id, 2) < 0.35) continue;
      ctx.globalAlpha = 1 - u; ctx.fillStyle = '#' + PAL.spark;
      ctx.fillRect(Math.round(fx + (noise(id, 3) - 0.5) * 12 + Math.sin(u * 7 + id) * 2), Math.round(fy - 14 - u * 26), 1, 1);
    }
    ctx.globalAlpha = 1;
    for (const s of STONES) if (s[1] >= 0) stone(ctx, s);                   // ближние камни — перед огнём
  }
  return { draw };
}
