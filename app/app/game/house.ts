// Дом рыбака на карте — отдельной картинкой поверх world.png (где он стоит — World.house, из shared/src/house.ts).
// Герой прячется за домом так же, как за предметами карты: каждый пиксель дома пишет в World.depth строку-опору —
// нижний край дома в своём столбце. Кто стоит выше этого края, того дом закрывает; кто ниже — стоит перед домом.
// Деревья карты, которые растут ближе дома (их опора ниже), рисуются поверх него ещё раз — своими же пикселями карты.

import { World } from '@fh/shared';

export function createHouseView(house: HTMLImageElement, world: HTMLImageElement) {
  const { x: X, y: Y } = World.house, w = house.width, h = house.height;
  const canvas = (draw: (c: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true })!; draw(cx); return { c, cx };
  };
  const own = canvas(cx => cx.drawImage(house, 0, 0)).cx.getImageData(0, 0, w, h).data;
  const base = new Int32Array(w).fill(-1);                    // нижний край дома в каждом столбце, в строках карты
  for (let x = 0; x < w; x++) for (let y = h - 1; y >= 0; y--) if (own[(y * w + x) * 4 + 3]) { base[x] = Y + y; break; }
  const front = canvas(cx => cx.drawImage(world, -X, -Y)), px = front.cx.getImageData(0, 0, w, h);
  let any = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, mx = X + x, my = Y + y;
    const keep = own[o + 3] && mx >= 0 && my >= 0 && mx < World.W && my < World.H && World.depth[my * World.W + mx]! > base[x]!;
    if (keep) { any = true; continue; }                     // дерево карты стоит ближе дома — остаётся поверх него
    px.data[o + 3] = 0;
    if (own[o + 3] && mx >= 0 && my >= 0 && mx < World.W && my < World.H) World.depth[my * World.W + mx] = base[x]!;
  }
  front.cx.putImageData(px, 0, 0);
  return {
    draw(ctx: CanvasRenderingContext2D) {
      ctx.drawImage(house, X, Y);
      if (any) ctx.drawImage(front.c, X, Y);
    },
  };
}
