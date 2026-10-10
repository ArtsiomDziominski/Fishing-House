// Правила мира, общие для клиента и сервера: скорости, расстояния, где можно рыбачить.
// Клиент по ним ведёт героя сразу, сервер по ним же проверяет, что прислал клиент.

import { HUNGER } from './hunger.ts';
import { ENTER_REACH, Indoor } from './indoor.ts';
import { BOAT_REACH, Isle, shoreCast } from './island.ts';
import { Sea } from './sea.ts';
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
// Голод (hunger.ts): food — сытость 0..100, starve — сколько секунд она уже на нуле, sleep — до какого мгновения (мс, часы сервера)
// герой спит от усталости (0 — не спит).
// inside — герой в доме (indoor.ts): x, y тогда — в кадре комнаты, а не карты; rest там — сидит в кресле у камина,
// bed — лежит в кровати (в базе не хранится, как и rest: войдя, герой стоит).
// isle — герой на общем острове (island.ts), sea — в своей лодке в открытом океане (sea.ts): x, y тогда — в кадре острова
// или океана; рюкзак, если он не на спине, остался лежать у причала. В базу ни то, ни другое не пишется: там — место дома
// (общие воды у всех одни, и место в них помнит только комната).
// seen — где герой уже бывал (AREAS): что не открыто, на карте мира скрыто темнотой.
export interface WorldState {
  x: number; y: number; dir: Dir; sitting: boolean; pack: PackState; lamp: boolean; rest: boolean; picX: number; picY: number;
  food: number; starve: number; sleep: number; inside: boolean; bed: boolean; isle: boolean; sea: boolean; seen: Area[];
}
// Места на карте мира: свой причал (открыт сразу), общий остров, открытый океан, чужие причалы (побывал в гостях).
export const AREAS = ['pier', 'isle', 'sea', 'guest'] as const;
export type Area = typeof AREAS[number];
// Где герой: в доме, на острове, в океане или у причала — по этому его место ищут в своей сетке (gridOf).
export interface Where { inside?: boolean; isle?: boolean; sea?: boolean }
export const gridOf = (w: Where) => (w.inside ? Indoor : w.isle ? Isle : w.sea ? Sea : World);

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const seat = World.seat;
// Место рыбака там, где герой: на краю причала или на мостках острова (isle). Радиус у обоих один.
export const seatOf = (isle = false) => (isle ? Isle.seat : seat);
export const nearSeat = (p: Point, isle = false) => dist(p, seatOf(isle)) <= seat.r;
// Рыбак сидит на берегу острова, а не на мостках: как он сидит (shoreCast в island.ts). null — сидит на месте рыбака или стоит.
export const shoreSit = (w: Point & Where & { sitting?: boolean; dir?: string }) => (w.isle && w.sitting && dist(w, Isle.seat) > 1 ? shoreCast(w, w.dir) : null);
// Где сидит рыбак: сидящий — там, где сидит (на месте рыбака или на берегу острова), стоящий — место рыбака там, где он.
export const fisherAt = (w: Point & Where & { sitting?: boolean }): Point => (w.sitting || w.sea ? { x: w.x, y: w.y } : seatOf(w.isle));   // в океане — у своей лодки
// Ведро (вещь на земле) стоит у рыбака, сидящего в точке at: в него можно класть улов.
export const bucketNearSeat = (b: Point, at: Point = seat) => dist(b, at) <= NEAR_PIER;
// Костёр у дома или на поляне острова.
export const fireOf = (isle = false) => (isle ? Isle.fire : World.fire);
// У костра садятся там, где стоят, — лишь бы недалеко от огня.
export const nearFire = (p: Point, isle = false) => dist(p, fireOf(isle)) <= fireOf(isle).sit;
// Куда смотрит сидящий у костра: на огонь.
export const faceFire = (p: Point, isle = false): Dir => {
  const f = fireOf(isle), dx = f.x - p.x, dy = f.y - p.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
};
// Лодка у причала (рисует её клиент — BERTHS в app/app/game/boats.ts): садятся в неё с края мостков, отсюда.
// На острове лодка вытащена на пляж — садятся у её носа (Isle.nearBoat); в океане герой и так в лодке. Плыть можно только стоя.
export const BOAT_AT = { x: 306, y: 291 };
export const nearBoat = (p: Point & Where) => (p.inside ? false : p.sea ? true : p.isle ? Isle.nearBoat(p) : dist(p, BOAT_AT) <= BOAT_REACH);
// Куда встаёт приплывший с острова: на край мостков у лодки.
export const boatPoint = (): Point => World.nearestWalkable(BOAT_AT.x, BOAT_AT.y) || BOAT_AT;
// Можно ли войти в дом: стоит у двери снаружи.
export const nearDoor = (p: Point) => dist(p, World.door) <= ENTER_REACH;
// Где просыпается герой, уснувший от голода, и куда выходят из дома: у крыльца.
export const homePoint = (): Point => World.nearestWalkable(World.door.x, World.door.y) || World.door;
// Куда встаёт герой, поднявшись с места рыбака (на острове — с мостков острова).
export const standPoint = (isle = false): Point => { const s = seatOf(isle); return (isle ? Isle : World).nearestWalkable(s.x, s.y) || { x: s.x, y: s.y }; };
// Куда встаёт сидящий рыбак: с места рыбака — рядом с ним, с берега острова — там же, где сидел.
// В океане — там же: лодка просто поднимает якорь.
export const standFrom = (w: Point & Where & { sitting?: boolean; dir?: string }): Point => (w.sea ? { x: w.x, y: w.y } : shoreSit(w) ? Isle.nearestWalkable(w.x, w.y) || { x: w.x, y: w.y } : standPoint(w.isle));

// Рюкзак на своём месте у угла дома — там же, где на картинке.
export const startPack = (): PackState => ({ x: World.pack.baseX, y: World.pack.baseY, worn: false, kind: PACKS.DEFAULT });

// Так игра начинается у нового игрока: рыбак сидит на причале с ведром (оно в стартовом наборе, ITEMS.STARTER), рюкзак — на своём месте с картинки.
export function startState(): WorldState {
  return { x: seat.x, y: seat.y, dir: 'down', sitting: true, pack: startPack(), lamp: true, rest: false, picX: World.pic.x, picY: World.pic.y, food: HUNGER.MAX, starve: 0, sleep: 0, inside: false, bed: false, isle: false, sea: false, seen: ['pier'] };
}
