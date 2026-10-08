// Вещи в рюкзаке: удочки, сети, топор, лампа и мелочь для рыбалки. Каждая занимает прямоугольник клеток в сетке рюкзака:
// мелочь — одну клетку, сачок и топор — две, удочка и большие сети — четыре. Вещь можно повернуть на четверть
// оборота — ширина и высота меняются местами. Сколько клеток в рюкзаке, знает его вид (PACKS.grid).
// Вещи берут из рюкзака в руки и убирают обратно; в руках вещь клеток не занимает, но помнит, где лежала. Рук две,
// а вещи двух весов: лёгкую держат одной рукой, тяжёлую (сеть-накидку и невод) — только двумя. Ведро в руке тоже
// занимает руку. Значит, в руках либо две лёгкие вещи, либо одна тяжёлая, а с ведром — одна лёгкая.
// Лампу из руки можно поставить на землю и взять обратно; горит она только в руке или на земле. Где что лежит, решает и хранит сервер; клиент только просит переложить и по тем же правилам
// заранее подсвечивает, куда вещь встанет. Картинки — в app/app/game/items-art.ts.

import { PACKS, type PackKind } from './packs.ts';
import { REACH, dist, type PackState } from './rules.ts';
import type { Point } from './world.ts';

export const ITEM_KINDS = [
  'rod-willow', 'rod-bamboo', 'rod-tele', 'rod-carbon', 'rod-gold',
  'net-scoop', 'net-cast', 'net-seine',
  'axe', 'lamp',
  'worms', 'floats',
] as const;
export type ItemKind = typeof ITEM_KINDS[number];
export type ItemGroup = 'rod' | 'net' | 'tool' | 'tackle';

// Вещь в рюкзаке: id — её номер в базе, x и y — левая верхняя клетка, rot — повёрнута на четверть оборота.
export interface Item { id: number; kind: ItemKind; x: number; y: number; rot: boolean }
export interface Grid { w: number; h: number }
// Где вещь лежит, без номера: так её кладут впервые.
export type Place = Pick<Item, 'x' | 'y' | 'rot'>;

// Заглянуть в рюкзак можно, когда он на спине или лежит рядом с героем. slack — запас сервера на рывки сети.
export const packInReach = (hero: Point, pack: PackState, slack = 0) => pack.worn || dist(hero, pack) <= REACH + slack;

export const ITEMS = (() => {
  // w и h — клеток в ширину и в высоту, когда вещь не повёрнута; heavy — тяжёлая: её держат двумя руками; text — подпись в рюкзаке
  const BY_KIND: Record<ItemKind, { name: string; group: ItemGroup; w: number; h: number; heavy?: boolean; text: string }> = {
    'rod-willow': { name: 'Ивовая удочка', group: 'rod', w: 4, h: 1, text: 'Срезана у реки. Гнётся, но держит.' },
    'rod-bamboo': { name: 'Бамбуковая удочка', group: 'rod', w: 4, h: 1, text: 'Лёгкая и звонкая, с поплавком.' },
    'rod-tele': { name: 'Телескопическая удочка', group: 'rod', w: 4, h: 1, text: 'Складывается в три колена, с катушкой.' },
    'rod-carbon': { name: 'Карбоновая удочка', group: 'rod', w: 4, h: 1, text: 'Чёрная и упругая, с блесной.' },
    'rod-gold': { name: 'Золотая удочка', group: 'rod', w: 4, h: 1, text: 'Говорят, на неё клюёт сама золотая рыбка.' },
    'net-scoop': { name: 'Сачок', group: 'net', w: 2, h: 1, text: 'Подхватить рыбу у самой воды.' },
    'net-cast': { name: 'Сеть-накидка', group: 'net', w: 2, h: 2, heavy: true, text: 'Бросают кругом, по краю грузила.' },
    'net-seine': { name: 'Невод', group: 'net', w: 4, h: 1, heavy: true, text: 'Длинная сеть с поплавками и грузилами.' },
    'axe': { name: 'Топор', group: 'tool', w: 2, h: 1, text: 'Нарубить сучьев и наколоть дров.' },
    'lamp': { name: 'Походная лампа', group: 'tool', w: 1, h: 1, text: 'Керосиновая, с ручкой. Светит в руке или на земле, в рюкзаке — нет.' },
    'worms': { name: 'Банка червей', group: 'tackle', w: 1, h: 1, text: 'Свежие, с огорода.' },
    'floats': { name: 'Поплавки', group: 'tackle', w: 1, h: 1, text: 'Красный и синий, на запас.' },
  };
  // Что лежит в рюкзаке у нового игрока. Влезает в самый маленький рюкзак — кожаный, с которого все начинают.
  const STARTER: (Place & { kind: ItemKind })[] = [
    { kind: 'rod-willow', x: 0, y: 0, rot: false },
    { kind: 'net-scoop', x: 0, y: 1, rot: false },
    { kind: 'worms', x: 2, y: 1, rot: false },
    { kind: 'floats', x: 3, y: 1, rot: false },
  ];

  const isKind = (v: unknown): v is ItemKind => ITEM_KINDS.includes(v as ItemKind);
  const info = (kind: ItemKind) => BY_KIND[kind];
  // Сколько клеток вещь занимает так, как лежит.
  const size = (kind: ItemKind, rot: boolean) => (rot ? { w: BY_KIND[kind].h, h: BY_KIND[kind].w } : { w: BY_KIND[kind].w, h: BY_KIND[kind].h });
  const cells = (kind: ItemKind) => BY_KIND[kind].w * BY_KIND[kind].h;
  const grid = (pack: PackKind): Grid => PACKS.grid(pack);
  // Квадратная вещь при повороте не меняется — её не поворачиваем вовсе.
  const turns = (kind: ItemKind) => BY_KIND[kind].w !== BY_KIND[kind].h;

  // Встанет ли вещь в клетку x, y: целиком внутри сетки и ни на ком не лежит. skip — её собственный id, когда её перекладывают.
  function fits(g: Grid, items: readonly Item[], kind: ItemKind, x: number, y: number, rot: boolean, skip?: number): boolean {
    const { w, h } = size(kind, rot);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + w > g.w || y + h > g.h) return false;
    for (const it of items) {
      if (it.id === skip) continue;
      const o = size(it.kind, it.rot);
      if (x < it.x + o.w && it.x < x + w && y < it.y + o.h && it.y < y + h) return false;
    }
    return true;
  }
  // Первое свободное место: строка за строкой сверху, слева направо; сначала как есть, потом повёрнутой. null — некуда.
  function spot(g: Grid, items: readonly Item[], kind: ItemKind): Place | null {
    for (const rot of turns(kind) ? [false, true] : [false]) {
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (fits(g, items, kind, x, y, rot)) return { x, y, rot };
    }
    return null;
  }
  // Разложить вещи в другую сетку (сменили рюкзак). Сначала пробуем не трогать тех, кто и так влезает, остальных — на
  // свободные места, крупных первыми; не вышло — раскладываем всё заново, тоже от крупных. null — в этот рюкзак не влезает.
  function repack(g: Grid, items: readonly Item[]): Item[] | null {
    const big = (list: readonly Item[]) => [...list].sort((a, b) => cells(b.kind) - cells(a.kind) || a.id - b.id);
    const place = (keep: Item[], rest: readonly Item[]) => {
      const out = [...keep];
      for (const it of big(rest)) {
        const p = spot(g, out, it.kind);
        if (!p) return null;
        out.push({ ...it, ...p });
      }
      return out;
    };
    const keep: Item[] = [], rest: Item[] = [];
    for (const it of items) (fits(g, keep, it.kind, it.x, it.y, it.rot) ? keep : rest).push(it);
    return place(keep, rest) || place([], items);
  }
  // Вещи из базы — в сетку рюкзака: кто стоит правильно, остаётся; кто наехал на соседа или вылез за край (рюкзак
  // поменяли, размеры правил), ищет свободное место. moved — кого переложили (в базе они пока на старом месте); кому места нет,
  // в list не попадает, но в базе остаётся — появится снова, когда рюкзак станет просторнее.
  function settle(g: Grid, items: readonly Item[]): { list: Item[]; moved: Item[] } {
    const list: Item[] = [], moved: Item[] = [], rest: Item[] = [];
    for (const it of items) (fits(g, list, it.kind, it.x, it.y, it.rot) ? list : rest).push(it);
    for (const it of rest) {
      const p = spot(g, list, it.kind);
      if (!p) continue;
      const next = { ...it, ...p };
      list.push(next); moved.push(next);
    }
    return { list, moved };
  }
  // Удочка ли это: с удочкой в руке рыбачат. kind приходит и строкой из состояния комнаты — незнакомая не удочка.
  const isRod = (kind: string) => isKind(kind) && BY_KIND[kind].group === 'rod';
  // Какую вещь можно поставить из руки на землю. Пока только лампу. У вещи на земле x и y — место на карте, а не клетка.
  const stands = (kind: ItemKind) => kind === 'lamp';
  // Руки. Вес вещи — сколько рук она занимает: лёгкая одну, тяжёлая обе. kind приходит и строкой из состояния комнаты.
  const HANDS = 2;
  const weight = (kind: string) => (isKind(kind) && BY_KIND[kind].heavy ? 2 : 1);
  // Сколько рук занято: вещами и ведром, если оно в руке.
  const load = (hands: readonly { kind: string }[], bucket = false) => hands.reduce((n, it) => n + weight(it.kind), 0) + (bucket ? 1 : 0);
  // Хватит ли рук взять ещё и эту вещь.
  const canHold = (hands: readonly Item[], kind: string, bucket = false) => load(hands, bucket) + weight(kind) <= HANDS;
  // В руках вещи лежат по порядку номеров: какая в какой руке, не меняется от перезахода.
  const inOrder = (hands: Item[]) => hands.sort((a, b) => a.id - b.id);

  // Лампа светит, только когда она в руке или стоит на земле (и зажжена). В рюкзаке лампа не горит.
  const lampOut = (hands: readonly Item[], ground: Item | null) => hands.some(it => it.kind === 'lamp') || ground?.kind === 'lamp';
  // Зажечь и погасить лампу можно, когда она под рукой: в руке или стоит на земле рядом. slack — запас сервера на рывки сети.
  const lampNear = (hero: Point, hands: readonly Item[], ground: Item | null, slack = 0) => hands.some(it => it.kind === 'lamp') || ground?.kind === 'lamp' && dist(hero, ground) <= REACH + slack;

  // Взять вещь из рюкзака в руки; bucket — ведро в руке. Не хватает рук — прежние вещи уходят в рюкзак, начиная с первой,
  // пока новая не поместится: туда, где лежали, а занято — на место взятой или на первое свободное. back — они же
  // на новых местах. Отказ строкой: none — такой вещи нет, hands — тяжёлую не взять, пока рука занята ведром,
  // full — прежние вещи некуда деть.
  function take(g: Grid, items: readonly Item[], hands: readonly Item[], id: number, bucket = false): { list: Item[]; hands: Item[]; back: Item[] } | 'none' | 'hands' | 'full' {
    const it = items.find(i => i.id === id); if (!it) return 'none';
    if (weight(it.kind) + (bucket ? 1 : 0) > HANDS) return 'hands';
    const keep = [...hands], out: Item[] = [], back: Item[] = [];
    while (!canHold(keep, it.kind, bucket)) out.push(keep.shift()!);
    const list = items.filter(i => i !== it);
    for (const o of out) {
      const at = [{ x: o.x, y: o.y, rot: o.rot }, { x: it.x, y: it.y, rot: o.rot }].find(p => fits(g, list, o.kind, p.x, p.y, p.rot)) || spot(g, list, o.kind);
      if (!at) return 'full';
      const b = { ...o, ...at };
      list.push(b); back.push(b);
    }
    return { list, hands: inOrder([...keep, it]), back };
  }
  // Убрать вещь id из рук в рюкзак: в названную клетку (at) или, если её не назвали, туда, где лежала, а занято — на первое
  // свободное место. item — она же на новом месте. null — такой вещи в руках нет или она не встаёт.
  function stow(g: Grid, items: readonly Item[], hands: readonly Item[], id: number, at: Place | null = null): { list: Item[]; hands: Item[]; item: Item } | null {
    const it = hands.find(h => h.id === id); if (!it) return null;
    let p: Place | null;
    if (at) p = fits(g, items, it.kind, at.x, at.y, at.rot && turns(it.kind)) ? { x: at.x, y: at.y, rot: at.rot && turns(it.kind) } : null;
    else p = fits(g, items, it.kind, it.x, it.y, it.rot) ? { x: it.x, y: it.y, rot: it.rot } : spot(g, items, it.kind);
    if (!p) return null;
    const item = { ...it, ...p };
    return { list: [...items, item], hands: hands.filter(h => h !== it), item };
  }
  // Сколько клеток занято.
  const used = (items: readonly Item[]) => items.reduce((n, it) => n + cells(it.kind), 0);

  return { STARTER, isKind, info, size, cells, grid, turns, fits, spot, repack, settle, used, isRod, stands, HANDS, weight, load, canHold, inOrder, lampOut, lampNear, take, stow };
})();
