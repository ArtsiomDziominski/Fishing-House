// Рюкзак изнутри: кожаная рамка в цвет рюкзака, сетка клеток 24×24 и вещи в ней. Рисуется 1:1 в арт-пикселях
// на своём маленьком холсте, а CSS увеличивает его целым множителем без сглаживания — как и сам мир.
// Тянуть вещи и решать, куда они встанут, — забота окна рюкзака (components/GameBackpack.vue); здесь только картинка.

import { ITEMS, PACKS, type Grid, type Item, type ItemKind, type PackKind } from '@fh/shared';
import { itemSprite } from './items-art.ts';

export const CELL = 24;                 // клетка рюкзака, арт-пикселей
export const EDGE = 7;                  // кожаная рамка вокруг сетки

// Вещь, которую сейчас тянут: x, y — где её левый верхний угол (арт-пиксели холста), at — клетка, куда она встанет, ok — встанет ли.
export interface Drag { id: number; kind: ItemKind; rot: boolean; x: number; y: number; at: { x: number; y: number } | null; ok: boolean }
export interface BackpackScene { pack: PackKind; grid: Grid; items: readonly Item[]; selected: number | null; hover: number | null; drag: Drag | null }

export const backpackSize = (g: Grid) => ({ w: EDGE * 2 + g.w * CELL, h: EDGE * 2 + g.h * CELL });

type RGB = readonly number[];
const css = (c: RGB, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const mix = (a: RGB, b: RGB, t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t));
const INK: RGB = [36, 7, 2], BLACK: RGB = [0, 0, 0], COAT: RGB = [250, 199, 8], GOOD: RGB = [138, 189, 90], BAD: RGB = [201, 83, 45];
const BRASS: RGB = [217, 195, 106], BRASS_DARK: RGB = [168, 134, 46];

export function drawBackpack(ctx: CanvasRenderingContext2D, s: BackpackScene) {
  const { w: W, h: H } = backpackSize(s.grid), t = PACKS.tones(s.pack);
  const fill = (x: number, y: number, w: number, h: number, c: RGB, a = 1) => { ctx.fillStyle = css(c, a); ctx.fillRect(x, y, w, h); };
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);

  // рамка: контур со скруглёнными углами, кожа с бликом сверху, строчка и шов внутрь
  fill(1, 0, W - 2, H, INK); fill(0, 1, W, H - 2, INK);
  fill(1, 1, W - 2, H - 2, t[1]!);
  fill(2, 1, W - 4, 1, t[0]!); fill(1, 2, 1, H - 4, t[0]!);
  fill(2, H - 2, W - 4, 1, t[2]!); fill(W - 2, 2, 1, H - 4, t[2]!);
  for (let x = 5; x < W - 5; x += 4) { fill(x, 3, 2, 1, t[0]!); fill(x, H - 4, 2, 1, t[0]!); }
  for (let y = 5; y < H - 5; y += 4) { fill(3, y, 1, 2, t[0]!); fill(W - 4, y, 1, 2, t[0]!); }
  fill(EDGE - 1, EDGE - 1, W - EDGE * 2 + 2, H - EDGE * 2 + 2, mix(t[4]!, BLACK, 0.6));
  // пряжка ремешка посередине сверху
  const bx = (W >> 1) - 5;
  fill(bx, 0, 10, 6, INK); fill(bx + 1, 1, 8, 4, BRASS); fill(bx + 3, 2, 4, 2, BRASS_DARK); fill(bx + 1, 1, 8, 1, mix(BRASS, [255, 246, 216], 0.6));

  // пустые клетки: углублены — тень сверху и слева, светлый край снизу и справа
  const base = mix(t[4]!, BLACK, 0.3), shade = mix(t[4]!, BLACK, 0.62), lip = mix(t[3]!, t[4]!, 0.5);
  for (let cy = 0; cy < s.grid.h; cy++) for (let cx = 0; cx < s.grid.w; cx++) {
    const x = EDGE + cx * CELL, y = EDGE + cy * CELL;
    fill(x, y, CELL, CELL, base);
    fill(x, y, CELL, 1, shade); fill(x, y, 1, CELL, shade);
    fill(x, y + CELL - 1, CELL, 1, lip); fill(x + CELL - 1, y, 1, CELL, lip);
  }

  const d = s.drag;
  // вещи: подложка во весь их прямоугольник клеток, картинка по центру
  const block = (it: { kind: ItemKind; rot: boolean }, x: number, y: number, ring: RGB | null, a: number) => {
    const z = ITEMS.size(it.kind, it.rot), w = z.w * CELL, h = z.h * CELL;
    ctx.globalAlpha = a;
    fill(x + 1, y + 1, w - 2, h - 2, t[3]!);
    fill(x + 1, y + 1, w - 2, 1, t[2]!);
    if (ring) { fill(x, y, w, 1, ring); fill(x, y + h - 1, w, 1, ring); fill(x, y, 1, h, ring); fill(x + w - 1, y, 1, h, ring); }
    const img = itemSprite(it.kind, it.rot);
    ctx.drawImage(img, x + ((w - img.width) >> 1), y + ((h - img.height) >> 1));
    ctx.globalAlpha = 1;
  };
  for (const it of s.items) {
    const dragged = d?.id === it.id;
    const ring = dragged ? null : s.selected === it.id ? COAT : s.hover === it.id ? t[0]! : null;
    block(it, EDGE + it.x * CELL, EDGE + it.y * CELL, ring, dragged ? 0.3 : 1);
  }
  // куда встанет вещь, которую тянут: зелёным — встанет, красным — нет (поверх соседей, чтобы было видно, на кого легла)
  if (d?.at) {
    const z = ITEMS.size(d.kind, d.rot);
    fill(EDGE + d.at.x * CELL, EDGE + d.at.y * CELL, z.w * CELL, z.h * CELL, d.ok ? GOOD : BAD, 0.45);
  }
  if (d) block(d, d.x, d.y, COAT, 0.92);
}
