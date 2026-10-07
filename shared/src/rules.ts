// Правила мира, общие для клиента и сервера: скорости, расстояния, где можно рыбачить.
// Клиент по ним ведёт героя сразу, сервер по ним же проверяет, что прислал клиент.

import { PACKS, type PackKind } from './packs.ts';
import { World, type Point } from './world.ts';

export const SPEED = 44, CARRY_SPEED = 38;   // арт-пикселей в секунду: налегке и с ведром
export const REACH = 18;                     // с какого расстояния можно взять ведро или рюкзак
export const NEAR_PIER = 62;                 // ближе этого к месту рыбака ведро считается «рядом» (весь причал и край берега)
export const PUT_REACH = 24;                 // как далеко от героя можно поставить ведро или положить рюкзак

export const DIRS = ['down', 'up', 'left', 'right'] as const;
export type Dir = typeof DIRS[number];

export interface BucketState { x: number; y: number; carried: boolean; home: boolean }
// Рюкзак: на спине (worn) или лежит в точке x, y; kind — какой из рюкзаков игрок выбрал.
export interface PackState { x: number; y: number; worn: boolean; kind: PackKind }
// Что игрок оставил в мире, когда вышел: хранится в базе и приходит ему при входе.
export interface WorldState { x: number; y: number; dir: Dir; sitting: boolean; bucket: BucketState; pack: PackState }

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const seat = World.seat;
export const nearSeat = (p: Point) => dist(p, seat) <= seat.r;
export const bucketNearSeat = (b: BucketState) => !b.carried && dist(b, seat) <= NEAR_PIER;
// Куда встаёт герой, поднявшись с места рыбака.
export const standPoint = (): Point => World.nearestWalkable(seat.x, seat.y) || { x: seat.x, y: seat.y };

// Рюкзак на своём месте у угла дома — там же, где на картинке.
export const startPack = (): PackState => ({ x: World.pack.baseX, y: World.pack.baseY, worn: false, kind: PACKS.DEFAULT });

// Так игра начинается у нового игрока: рыбак сидит на причале, ведро и рюкзак — у дома, кадр как на картинке.
export function startState(): WorldState {
  return { x: seat.x, y: seat.y, dir: 'down', sitting: true, bucket: { x: World.bucket.baseX, y: World.bucket.baseY, carried: false, home: true }, pack: startPack() };
}
