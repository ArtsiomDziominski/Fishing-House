// Правила мира, общие для клиента и сервера: скорости, расстояния, где можно рыбачить.
// Клиент по ним ведёт героя сразу, сервер по ним же проверяет, что прислал клиент.

import { PACKS, type PackKind } from './packs.ts';
import { World, type Point } from './world.ts';

export const SPEED = 44, CARRY_SPEED = 38;   // арт-пикселей в секунду: налегке и с ведром
export const RUN = 1.5;                      // бег (Shift или двойной клик) во столько раз быстрее шага, и с ведром тоже
export const REACH = 18;                     // с какого расстояния можно взять вещь с земли или рюкзак
export const NEAR_PIER = 62;                 // ближе этого к месту рыбака ведро считается «рядом» (весь причал и край берега)
export const PUT_REACH = 24;                 // как далеко от героя можно положить вещь или рюкзак

export const DIRS = ['down', 'up', 'left', 'right'] as const;
export type Dir = typeof DIRS[number];

// Рюкзак: на спине (worn) или лежит в точке x, y; kind — какой из рюкзаков игрок выбрал.
export interface PackState { x: number; y: number; worn: boolean; kind: PackKind }
// Что игрок оставил в мире, когда вышел: хранится в базе и приходит ему при входе.
// picX, picY — где стояла картинка-образец на карте (World.pic), когда записывались координаты. Карту расширяют,
// картинка сдвигается вправо и вниз — по этим числам сохранённые места переносятся на новую карту (см. cleanWorld).
// lamp — лампа зажжена (светит, только если она лежит в рюкзаке). rest — сидит у костра (в базе не хранится: войдя, герой стоит).
export interface WorldState { x: number; y: number; dir: Dir; sitting: boolean; pack: PackState; lamp: boolean; rest: boolean; picX: number; picY: number }

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const seat = World.seat;
export const nearSeat = (p: Point) => dist(p, seat) <= seat.r;
// Ведро (вещь на земле) стоит у места рыбака: в него можно класть улов.
export const bucketNearSeat = (b: Point) => dist(b, seat) <= NEAR_PIER;
// У костра садятся там, где стоят, — лишь бы недалеко от огня.
export const nearFire = (p: Point) => dist(p, World.fire) <= World.fire.sit;
// Куда смотрит сидящий у костра: на огонь.
export const faceFire = (p: Point): Dir => {
  const dx = World.fire.x - p.x, dy = World.fire.y - p.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
};
// Куда встаёт герой, поднявшись с места рыбака.
export const standPoint = (): Point => World.nearestWalkable(seat.x, seat.y) || { x: seat.x, y: seat.y };

// Рюкзак на своём месте у угла дома — там же, где на картинке.
export const startPack = (): PackState => ({ x: World.pack.baseX, y: World.pack.baseY, worn: false, kind: PACKS.DEFAULT });

// Так игра начинается у нового игрока: рыбак сидит на причале с ведром (оно в стартовом наборе, ITEMS.STARTER), рюкзак — на своём месте с картинки.
export function startState(): WorldState {
  return { x: seat.x, y: seat.y, dir: 'down', sitting: true, pack: startPack(), lamp: true, rest: false, picX: World.pic.x, picY: World.pic.y };
}
