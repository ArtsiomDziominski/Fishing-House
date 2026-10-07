// Вещи в рюкзаке: удочки, сети, топор и мелочь для рыбалки. Каждая занимает прямоугольник клеток в сетке рюкзака:
// мелочь — одну клетку, сачок и топор — две, удочка и большие сети — четыре. Вещь можно повернуть на четверть
// оборота — ширина и высота меняются местами. Сколько клеток в рюкзаке, знает его вид (PACKS.grid).
// Где что лежит, решает и хранит сервер; клиент только просит переложить и по тем же правилам заранее подсвечивает,
// куда вещь встанет. Картинки — в app/app/game/items-art.ts.

import { PACKS, type PackKind } from './packs.ts';
import { REACH, dist, type PackState } from './rules.ts';
import type { Point } from './world.ts';

export const ITEM_KINDS = [
  'rod-willow', 'rod-bamboo', 'rod-tele', 'rod-carbon', 'rod-gold',
  'net-scoop', 'net-cast', 'net-seine',
  'axe',
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
  // w и h — клеток в ширину и в высоту, когда вещь не повёрнута; text — подпись в рюкзаке
  const BY_KIND: Record<ItemKind, { name: string; group: ItemGroup; w: number; h: number; text: string }> = {
    'rod-willow': { name: 'Ивовая удочка', group: 'rod', w: 4, h: 1, text: 'Срезана у реки. Гнётся, но держит.' },
    'rod-bamboo': { name: 'Бамбуковая удочка', group: 'rod', w: 4, h: 1, text: 'Лёгкая и звонкая, с поплавком.' },
    'rod-tele': { name: 'Телескопическая удочка', group: 'rod', w: 4, h: 1, text: 'Складывается в три колена, с катушкой.' },
    'rod-carbon': { name: 'Карбоновая удочка', group: 'rod', w: 4, h: 1, text: 'Чёрная и упругая, с блесной.' },
    'rod-gold': { name: 'Золотая удочка', group: 'rod', w: 4, h: 1, text: 'Говорят, на неё клюёт сама золотая рыбка.' },
    'net-scoop': { name: 'Сачок', group: 'net', w: 2, h: 1, text: 'Подхватить рыбу у самой воды.' },
    'net-cast': { name: 'Сеть-накидка', group: 'net', w: 2, h: 2, text: 'Бросают кругом, по краю грузила.' },
    'net-seine': { name: 'Невод', group: 'net', w: 4, h: 1, text: 'Длинная сеть с поплавками и грузилами.' },
    'axe': { name: 'Топор', group: 'tool', w: 2, h: 1, text: 'Нарубить сучьев и наколоть дров.' },
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
  // Сколько клеток занято.
  const used = (items: readonly Item[]) => items.reduce((n, it) => n + cells(it.kind), 0);

  return { STARTER, isKind, info, size, cells, grid, turns, fits, spot, repack, settle, used };
})();
