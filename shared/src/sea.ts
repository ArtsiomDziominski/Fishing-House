// Открытый океан — свой кадр 640×360, общий для всех игроков, как и остров (комната общих вод, SEA_ROOM в protocol.ts).
// Тут не ходят, а гребут: герой сидит в своей лодке (WorldState.sea; x, y — середина лодки у воды, dir — куда смотрит корма
// с рыбаком: влево или вправо). Стрелки и клик по воде ведут лодку — как шаг, только медленнее (SEA.ROW); F — бросить
// якорь и рыбачить (sitting), стрелка или клик — поднять якорь и грести дальше. Рыбачат с кормы: рыбак сидит лицом от
// лодки, поплавок ложится за кормой. Ведро стоит в лодке у ног — в руке или в рюкзаке на спине.
// По океану ходит косяк (shoalAt) — по часам сервера, у всех один и тот же: кто бросил якорь рядом с ним, у того клюёт чаще
// и крупнее (SEA.SHOAL). Над косяком кружат и ныряют чайки — его видно издалека.
// Рисует океан клиент (app/app/game/sea-view.ts) по этим же числам.

import { createGrid, type Point } from './grid.ts';

const W = 640, H = 360;

export const SEA = {
  W, H,
  horizon: 92,                                   // линия горизонта: выше — небо, ниже — вода
  // Где может стоять лодка (её точка — середина у воды): ниже горизонта с запасом, чтобы рыбак и удилище были в кадре, и выше
  // нижней кромки, где поверх кадра лежат кнопки действий (на причале там тоже ничего нет).
  box: { x0: 56, x1: 584, y0: 150, y1: 296 },
  ROW: 0.7,                                      // на вёслах лодка идёт во столько раз медленнее шага
  // Рыбак в лодке, смотрящий влево (вправо — зеркально по точке лодки): где он сидит (dx, dy от точки лодки), кончик
  // удилища и вода под поплавком — тоже от точки лодки. Рыбак с картинки (fisher.png) сидит так же, как на причале:
  // кончик удилища от места рыбака — на (-22, -15), леска падает отвесно до воды за кормой.
  seat: { dx: -14, dy: -6 },
  tip: { dx: -36, dy: -21 },
  waterDy: 3,                                    // поплавок — на 3 строки ниже точки лодки: на воде за кормой
  pail: { dx: 6, dy: -3 },                       // где в лодке стоит ведро (от точки лодки, для смотрящего влево)
  SPREAD: 46,                                    // приплывшему — место не ближе этого к чужим лодкам, если найдётся
  // Косяк: где он (shoalAt) — медленная петля по океану; рядом с ним (r) клюёт в pace раз чаще и рыба крупнее (rich).
  SHOAL: { r: 54, pace: 1.6, loop: [420, 610] as const },   // loop — за сколько секунд косяк проходит петлю по x и по y
};

const walk = new Uint8Array(W * H);
for (let y = SEA.box.y0; y <= SEA.box.y1; y++) walk.fill(1, y * W + SEA.box.x0, y * W + SEA.box.x1 + 1);
const grid = createGrid(W, H, walk);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// Где сидит рыбак, кончик удилища, строка воды под ним и куда в лодке встаёт ведро — у лодки в точке p, смотрящей влево
// или вправо (flip).
export interface BoatCast { seat: Point; tip: Point; waterY: number; pail: Point; flip: boolean }
export function boatCast(p: Point, dir?: string): BoatCast {
  const flip = dir === 'right', s = flip ? -1 : 1, x = Math.round(p.x), y = Math.round(p.y);
  return {
    seat: { x: x + SEA.seat.dx * s, y: y + SEA.seat.dy }, tip: { x: x + SEA.tip.dx * s, y: y + SEA.tip.dy },
    waterY: y + SEA.waterDy, pail: { x: x + SEA.pail.dx * s, y: y + SEA.pail.dy }, flip,
  };
}

// Косяк в мгновение ms (часы сервера): середина и радиус. Петля — фигура Лиссажу внутри box, у всех клиентов и на сервере одна.
export function shoalAt(ms: number): Point & { r: number } {
  const t = ms / 1000, b = SEA.box, [lx, ly] = SEA.SHOAL.loop;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, ax = (b.x1 - b.x0) / 2 - 40, ay = (b.y1 - b.y0) / 2 - 24;
  return { x: cx + ax * Math.sin(t * 2 * Math.PI / lx), y: cy + ay * Math.sin(t * 2 * Math.PI / ly + 1.3), r: SEA.SHOAL.r };
}
export const nearShoal = (p: Point, ms: number) => { const s = shoalAt(ms); return dist(p, s) <= s.r; };

// Куда встаёт лодка приплывшего: из мест на сетке — ближе к низу кадра, откуда приплывают, и к его середине; первое, что
// не ближе SPREAD ко всем чужим лодкам (taken). Такого нет — самое далёкое от них.
const SPOTS: Point[] = [];
for (let y = SEA.box.y1 - 20; y >= SEA.box.y0 + 20; y -= 28) {
  const row: Point[] = [];
  for (let x = SEA.box.x0 + 44; x <= SEA.box.x1 - 44; x += 44) row.push({ x, y });
  SPOTS.push(...row.sort((a, b) => Math.abs(a.x - W / 2) - Math.abs(b.x - W / 2)));
}
export function seaSpawn(taken: readonly Point[]): Point {
  let best = SPOTS[0]!, score = -1;
  for (const p of SPOTS) {
    const near = taken.length ? Math.min(...taken.map(t => dist(t, p))) : Infinity;
    if (near >= SEA.SPREAD) return { ...p };
    if (near > score) { score = near; best = p; }
  }
  return { ...best };
}

export const Sea = {
  W, H, walk, ...grid,
  depthAt: (_x: number, _y: number) => 0,        // лодки закрывают друг друга по очереди отрисовки
};
