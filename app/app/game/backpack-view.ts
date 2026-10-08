// Рюкзак изнутри: кожаная рамка в цвет рюкзака, сетка клеток 24×24 и вещи в ней, а рядом — сам рыбак и то, что у него
// в руках. Рисуется 1:1 в арт-пикселях на своём маленьком холсте, а CSS увеличивает его целым множителем без сглаживания —
// как и сам мир. Тянуть вещи и решать, куда они встанут, — забота окна рюкзака (components/GameBackpack.vue); здесь только картинка.

import { ITEMS, PACKS, type Grid, type Hand, type Item, type ItemKind, type PackKind } from '@fh/shared';
import { HERO } from './hero.ts';
import { heldPlace, heldSprite } from './held-art.ts';
import { itemSprite } from './items-art.ts';

export const CELL = 24;                 // клетка рюкзака, арт-пикселей
export const EDGE = 7;                  // кожаная рамка вокруг сетки
// Панель рыбака: он сам (крупнее вдвое) и рядом — два высоких гнезда, по одному на руку: длинная вещь стоит в гнезде
// стоймя. Левое гнездо — левая рука (Q), правое — правая (E). Тяжёлая вещь лежит в гнезде правой руки, а левое тогда
// закрыто: её держат двумя руками.
export const PANE = { w: 106, h: 112, gap: 4 };
const MAN = { x: 7, y: 31, k: 2 };                       // где на панели стоит рыбак и во сколько раз он крупнее
const SLOT = { x: 48, y: 7, w: 25, h: 98, gap: 2 };      // гнездо руки на панели; второе — правее на w + gap

export interface Rect { x: number; y: number; w: number; h: number }
// Где что на холсте: рюкзак, справа от него панель рыбака с гнёздами рук (slots — левое и правое на экране: левая рука
// и правая). На узком экране панель стоит над рюкзаком (stacked).
export interface Layout { w: number; h: number; pane: Rect; slots: [Rect, Rect]; label: Rect; grid: Rect }
export function backpackLayout(g: Grid, stacked: boolean): Layout {
  const gw = EDGE * 2 + g.w * CELL, gh = EDGE * 2 + g.h * CELL;
  const w = stacked ? Math.max(gw, PANE.w) : PANE.w + PANE.gap + gw, h = stacked ? PANE.h + PANE.gap + gh : Math.max(gh, PANE.h);
  const px = stacked ? (w - PANE.w) >> 1 : gw + PANE.gap, py = stacked ? 0 : (h - PANE.h) >> 1;
  const slot = (i: number): Rect => ({ x: px + SLOT.x + i * (SLOT.w + SLOT.gap), y: py + SLOT.y, w: SLOT.w, h: SLOT.h });
  return {
    w, h,
    pane: { x: px, y: py, w: PANE.w, h: PANE.h },
    slots: [slot(0), slot(1)],
    label: { x: px + MAN.x, y: py + 8, w: HERO.FW * MAN.k, h: MAN.y - 10 },      // подпись над рыбаком — её пишет окно
    grid: stacked ? { x: (w - gw) >> 1, y: PANE.h + PANE.gap, w: gw, h: gh } : { x: 0, y: (h - gh) >> 1, w: gw, h: gh },
  };
}
// Гнездо руки: левая — левое на экране (Q), правая — правое (E).
export const slotOf = (L: Layout, side: Hand) => L.slots[side === 'left' ? 0 : 1];
// В каком гнезде какая вещь из рук; тяжёлая — в гнезде правой руки (левое при ней закрыто, см. bothHands).
export function handSlots(L: Layout, hands: readonly Item[]): { it: Item; at: Rect }[] {
  return hands.map(it => ({ it, at: slotOf(L, ITEMS.weight(it.kind) > 1 ? 'right' : ITEMS.sideOf(it)) }));
}
// Держит ли он тяжёлую вещь — тогда гнездо левой руки закрыто.
export const bothHands = (hands: readonly Item[]) => hands.some(it => ITEMS.weight(it.kind) > 1);
// Над каким гнездом указатель: правая рука, левая или ни та ни другая.
export function slotAt(L: Layout, x: number, y: number): Hand | undefined {
  const inside = (r: Rect) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  return inside(slotOf(L, 'left')) ? 'left' : inside(slotOf(L, 'right')) ? 'right' : undefined;
}

// Вещь, которую сейчас тянут: x, y — где её левый верхний угол (арт-пиксели холста); from — откуда её взяли;
// at — клетка, куда она встанет, hand — её несут в руки (держат над панелью рыбака), side — над гнездом какой руки; ok — выйдет ли.
export interface Drag { id: number; kind: ItemKind; rot: boolean; x: number; y: number; from: 'pack' | 'hand'; at: { x: number; y: number } | null; hand: boolean; side?: Hand; ok: boolean }
// hands — вещи в руках; hold — вещь, которую держат нажатой, и сколько осталось до срабатывания (k: 0..1).
export interface BackpackScene {
  pack: PackKind; grid: Grid; layout: Layout; items: readonly Item[]; hands: readonly Item[];
  selected: number | null; hover: number | null; drag: Drag | null; hold: { id: number; k: number } | null;
}

type RGB = readonly number[];
const css = (c: RGB, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const mix = (a: RGB, b: RGB, t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t));
const INK: RGB = [36, 7, 2], BLACK: RGB = [0, 0, 0], COAT: RGB = [250, 199, 8], GOOD: RGB = [138, 189, 90], BAD: RGB = [201, 83, 45];
const BRASS: RGB = [217, 195, 106], BRASS_DARK: RGB = [168, 134, 46];
const WOOD: RGB = [74, 44, 24], WOOD_LIGHT: RGB = [112, 70, 40], WOOD_DARK: RGB = [46, 25, 13], PAPER: RGB = [244, 227, 193];
const STEEL: RGB = [139, 143, 152], STEEL_DARK: RGB = [93, 96, 105], STEEL_LIGHT: RGB = [180, 184, 191], WATER: RGB = [38, 130, 181];

let man: HTMLCanvasElement | null = null;
// Рыбак лицом к зрителю, без рюкзака: тот раскрыт перед ним.
function manSprite() {
  if (man) return man;
  man = document.createElement('canvas'); man.width = HERO.FW; man.height = HERO.FH;
  man.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(HERO.build().down[0]!), HERO.FW, HERO.FH), 0, 0);
  return man;
}

export function drawBackpack(ctx: CanvasRenderingContext2D, s: BackpackScene) {
  const L = s.layout, t = PACKS.tones(s.pack), d = s.drag;
  const fill = (x: number, y: number, w: number, h: number, c: RGB, a = 1) => { ctx.fillStyle = css(c, a); ctx.fillRect(x, y, w, h); };
  const ring = (r: Rect, c: RGB) => { fill(r.x, r.y, r.w, 1, c); fill(r.x, r.y + r.h - 1, r.w, 1, c); fill(r.x, r.y, 1, r.h, c); fill(r.x + r.w - 1, r.y, 1, r.h, c); };
  // сколько осталось держать вещь нажатой: полоска растёт по её нижнему краю
  const holding = (id: number, r: Rect) => { if (s.hold?.id === id) fill(r.x + 1, r.y + r.h - 3, Math.round((r.w - 2) * s.hold.k), 2, COAT); };
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, L.w, L.h);

  // ---------- рыбак и его руки ----------
  {
    const p = L.pane, held = handSlots(L, s.hands), both = bothHands(s.hands);
    fill(p.x + 1, p.y, p.w - 2, p.h, INK); fill(p.x, p.y + 1, p.w, p.h - 2, INK);
    fill(p.x + 1, p.y + 1, p.w - 2, p.h - 2, WOOD);
    fill(p.x + 2, p.y + 1, p.w - 4, 1, WOOD_LIGHT); fill(p.x + 1, p.y + 2, 1, p.h - 4, WOOD_LIGHT);
    fill(p.x + 2, p.y + p.h - 2, p.w - 4, 1, WOOD_DARK); fill(p.x + p.w - 2, p.y + 2, 1, p.h - 4, WOOD_DARK);
    // рыбак: тень под ногами, он сам и то, что у него в руках, — как в мире
    const mx = p.x + MAN.x, my = p.y + MAN.y, mw = HERO.FW * MAN.k, mh = HERO.FH * MAN.k;
    fill(mx + 6, my + mh - 3, mw - 12, 5, BLACK, 0.28); fill(mx + 2, my + mh - 2, mw - 4, 3, BLACK, 0.28);
    ctx.drawImage(manSprite(), mx, my, mw, mh);
    s.hands.forEach(it => {
      const art = heldSprite(it.kind); if (!art) return;
      const at = heldPlace(art, it.left ? HERO.hand2('down', 0) : HERO.hand('down', 0), false, HERO.FH - 1);
      ctx.drawImage(at.img, mx + at.x * MAN.k, my + at.y * MAN.k, at.w * MAN.k, at.h * MAN.k);
    });
    // гнёзда рук: углублены, как клетки рюкзака. С тяжёлой вещью гнездо левой руки закрыто — заштриховано (подпись пишет окно).
    const recess = (q: Rect) => {
      fill(q.x, q.y, q.w, q.h, mix(WOOD, BLACK, 0.45));
      fill(q.x, q.y, q.w, 1, mix(WOOD, BLACK, 0.7)); fill(q.x, q.y, 1, q.h, mix(WOOD, BLACK, 0.7));
      fill(q.x, q.y + q.h - 1, q.w, 1, WOOD_LIGHT); fill(q.x + q.w - 1, q.y, 1, q.h, WOOD_LIGHT);
    };
    const empty = (q: Rect) => {                         // пусто — пунктир: сюда можно взять вещь
      for (let x = q.x + 4; x < q.x + q.w - 5; x += 4) { fill(x, q.y + 4, 2, 1, PAPER, 0.22); fill(x, q.y + q.h - 5, 2, 1, PAPER, 0.22); }
      for (let y = q.y + 5; y < q.y + q.h - 6; y += 4) { fill(q.x + 4, y, 1, 2, PAPER, 0.22); fill(q.x + q.w - 5, y, 1, 2, PAPER, 0.22); }
    };
    L.slots.forEach(recess);
    const pail = (q: Rect) => {                          // ведро в гнезде — маленькое, в гнездо целиком оно не влезет (k — во сколько крупнее)
      const k = 2, bx = q.x + ((q.w - 11 * k) >> 1), by = q.y + ((q.h - 11 * k) >> 1), f = (x: number, y: number, w: number, h: number, c: RGB) => fill(bx + x * k, by + y * k, w * k, h * k, c);
      f(3, 0, 5, 1, STEEL_DARK); f(2, 1, 1, 2, STEEL_DARK); f(8, 1, 1, 2, STEEL_DARK);
      f(0, 3, 11, 1, STEEL_LIGHT); f(0, 4, 11, 5, STEEL); f(1, 9, 9, 1, STEEL_DARK); f(2, 10, 7, 1, STEEL_DARK);
      f(1, 4, 1, 5, STEEL_LIGHT); f(8, 4, 2, 5, STEEL_DARK); f(1, 3, 9, 1, WATER);
    };
    for (const { it, at: q } of held) {
      ctx.globalAlpha = d?.id === it.id ? 0.3 : 1;
      if (ITEMS.isBucket(it.kind)) pail(q);
      else {
        const img = itemSprite(it.kind, false, it.fish), up = img.width >= img.height * 2;   // длинная вещь стоит стоймя, рукоятью вниз
        const wide = (up ? img.height : img.width) > q.w - 1, z = wide ? 0.5 : 1;   // широкая (накидка) не влезает — вдвое мельче
        const w = (up ? img.height : img.width) * z, h = (up ? img.width : img.height) * z, x = q.x + Math.round((q.w - w) / 2), y = q.y + Math.round((q.h - h) / 2);
        if (up) { ctx.save(); ctx.translate(x, y + h); ctx.rotate(-Math.PI / 2); ctx.drawImage(img, 0, 0, h, w); ctx.restore(); } else ctx.drawImage(img, x, y, w, h);
      }
      ctx.globalAlpha = 1;
      if (d?.id !== it.id) { if (s.selected === it.id) ring(q, COAT); else if (s.hover === it.id) ring(q, WOOD_LIGHT); }
      holding(it.id, q);
    }
    for (const side of ['left', 'right'] as const) {
      const q = slotOf(L, side);
      if (held.some(h => h.at === q)) continue;
      if (both) {                                        // тяжёлая вещь в обеих руках: левое гнездо закрыто штриховкой
        fill(q.x + 1, q.y + 1, q.w - 2, q.h - 2, BLACK, 0.3);
        for (let y = q.y + 2; y < q.y + q.h - 2; y += 4) fill(q.x + 2, y, q.w - 4, 1, WOOD_DARK);
      } else empty(q);
    }
    if (d?.hand) {                                       // вещь из рюкзака несут в руки: тяжёлую — в обе, лёгкую — в эту руку или в свободную
      const qs = ITEMS.weight(d.kind) > 1 ? L.slots : d.side ? [slotOf(L, d.side)] : [];
      for (const q of qs) fill(q.x, q.y, q.w, q.h, d.ok ? GOOD : BAD, 0.45);
    }
  }

  // ---------- рюкзак ----------
  const X = L.grid.x, Y = L.grid.y, W = L.grid.w, H = L.grid.h;
  // рамка: контур со скруглёнными углами, кожа с бликом сверху, строчка и шов внутрь
  fill(X + 1, Y, W - 2, H, INK); fill(X, Y + 1, W, H - 2, INK);
  fill(X + 1, Y + 1, W - 2, H - 2, t[1]!);
  fill(X + 2, Y + 1, W - 4, 1, t[0]!); fill(X + 1, Y + 2, 1, H - 4, t[0]!);
  fill(X + 2, Y + H - 2, W - 4, 1, t[2]!); fill(X + W - 2, Y + 2, 1, H - 4, t[2]!);
  for (let x = 5; x < W - 5; x += 4) { fill(X + x, Y + 3, 2, 1, t[0]!); fill(X + x, Y + H - 4, 2, 1, t[0]!); }
  for (let y = 5; y < H - 5; y += 4) { fill(X + 3, Y + y, 1, 2, t[0]!); fill(X + W - 4, Y + y, 1, 2, t[0]!); }
  fill(X + EDGE - 1, Y + EDGE - 1, W - EDGE * 2 + 2, H - EDGE * 2 + 2, mix(t[4]!, BLACK, 0.6));
  // пряжка ремешка посередине сверху
  const bx = X + (W >> 1) - 5;
  fill(bx, Y, 10, 6, INK); fill(bx + 1, Y + 1, 8, 4, BRASS); fill(bx + 3, Y + 2, 4, 2, BRASS_DARK); fill(bx + 1, Y + 1, 8, 1, mix(BRASS, [255, 246, 216], 0.6));

  // пустые клетки: углублены — тень сверху и слева, светлый край снизу и справа
  const base = mix(t[4]!, BLACK, 0.3), shade = mix(t[4]!, BLACK, 0.62), lip = mix(t[3]!, t[4]!, 0.5);
  for (let cy = 0; cy < s.grid.h; cy++) for (let cx = 0; cx < s.grid.w; cx++) {
    const x = X + EDGE + cx * CELL, y = Y + EDGE + cy * CELL;
    fill(x, y, CELL, CELL, base);
    fill(x, y, CELL, 1, shade); fill(x, y, 1, CELL, shade);
    fill(x, y + CELL - 1, CELL, 1, lip); fill(x + CELL - 1, y, 1, CELL, lip);
  }

  // вещи: подложка во весь их прямоугольник клеток, картинка по центру
  const block = (it: { kind: ItemKind; rot: boolean; fish?: string }, x: number, y: number, edge: RGB | null, a: number) => {
    const z = ITEMS.size(it.kind, it.rot), w = z.w * CELL, h = z.h * CELL;
    ctx.globalAlpha = a;
    fill(x + 1, y + 1, w - 2, h - 2, t[3]!);
    fill(x + 1, y + 1, w - 2, 1, t[2]!);
    if (edge) ring({ x, y, w, h }, edge);
    const img = itemSprite(it.kind, it.rot, it.fish);
    ctx.drawImage(img, x + ((w - img.width) >> 1), y + ((h - img.height) >> 1));
    ctx.globalAlpha = 1;
  };
  for (const it of s.items) {
    const dragged = d?.id === it.id, x = X + EDGE + it.x * CELL, y = Y + EDGE + it.y * CELL;
    block(it, x, y, dragged ? null : s.selected === it.id ? COAT : s.hover === it.id ? t[0]! : null, dragged ? 0.3 : 1);
    const z = ITEMS.size(it.kind, it.rot);
    holding(it.id, { x, y, w: z.w * CELL, h: z.h * CELL });
  }
  // куда встанет вещь, которую тянут: зелёным — встанет, красным — нет (поверх соседей, чтобы было видно, на кого легла)
  if (d?.at) {
    const z = ITEMS.size(d.kind, d.rot);
    fill(X + EDGE + d.at.x * CELL, Y + EDGE + d.at.y * CELL, z.w * CELL, z.h * CELL, d.ok ? GOOD : BAD, 0.45);
  }
  if (d) block(d, d.x, d.y, COAT, 0.92);
}
