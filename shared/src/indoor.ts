// Дом рыбака изнутри: одна комната на всех, как и причал, — кто вошёл, видит там всех, кто внутри. Комната — свой кадр
// того же размера, что карта (640×360), со своей сеткой проходимости (grid.ts); координаты героя внутри — в этом кадре,
// а WorldState.inside говорит, в каком он из двух. Рисует комнату клиент (app/app/game/interior.ts) по этим же числам.
// Вход — у двери снаружи (World.door, ENTER_REACH), выход — у порога внутри (INDOOR.door, EXIT_REACH).
// Мебель, с которой что-то делают: два кресла у камина — в них садятся (rest) и жарят рыбу, как у костра, только камин
// не заливает дождь; кровать — в ней спят (WorldState.bed), и сытость тает вдвое медленнее; холодильник — в нём у каждого
// своя полка для рыбы (FRIDGE, items.fridge в базе). В кресле и в кровати — по одному.

import { createGrid, type Point } from './grid.ts';
import type { Dir } from './rules.ts';

const W = 640, H = 360;

export const INDOOR = {
  W, H,
  // Стены: задняя от верха комнаты (top) до пола (floor), по бокам — x0 и x1, пол кончается нижней стеной на bottom.
  // Комната сдвинута к верху кадра: внизу экрана — кнопки действий, дверь не должна под ними прятаться.
  room: { x0: 150, x1: 490, top: 6, floor: 122, bottom: 294 },
  // Дверной проём в нижней стене: с x0 до x1. Под ним — порог.
  doorway: { x0: 306, x1: 334 },
  // Порог изнутри: здесь появляется вошедший, отсюда выходят (EXIT_REACH).
  door: { x: 320, y: 288 },
  // Камин в задней стене: середина огня (fire) — от неё светит и трещит.
  fire: { x: 420, y: 126 },
  // Кресла у камина: где сидит герой (x, y — внутри кресла), куда смотрит (на огонь) и куда встаёт (stand).
  chairs: [
    { x: 356, y: 150, dir: 'right' as Dir, stand: { x: 356, y: 168 } },
    { x: 478, y: 150, dir: 'left' as Dir, stand: { x: 476, y: 168 } },
  ],
  // Кровать: где лежит спящий (голова на подушке) и куда он встаёт — к её боку.
  bed: { x: 186, y: 150, stand: { x: 226, y: 160 } },
  // Холодильник: где стоят, открыв его, — перед дверцей.
  fridge: { x: 235, y: 147 },
  // Мебель, сквозь которую не пройти, — прямоугольники «под ногами» [x, y, ширина, высота]; base — нижний край, по нему
  // клиент решает, кто перед ней, а кто за ней.
  blocks: {
    hearth: [380, 122, 80, 22],             // камин с каменным подом
    bed: [158, 122, 56, 60],                // кровать в углу у задней стены
    fridge: [220, 122, 30, 16],             // холодильник у задней стены, рядом с кроватью
    chairL: [344, 140, 24, 18],             // кресло слева от камина
    chairR: [466, 140, 22, 18],             // кресло справа от камина
    table: [232, 198, 60, 18],              // стол посреди комнаты
    barrels: [458, 196, 30, 28],            // бочки у правой стены
    crate: [444, 262, 28, 18],              // ящик у двери
    chest: [160, 246, 34, 20],              // сундук у левой стены
  } as Record<string, [number, number, number, number]>,
};

// Где внутри можно ходить: пол между стенами (с запасом на ширину героя), шаг в дверной проём — и без мебели.
const walk = new Uint8Array(W * H);
{
  const r = INDOOR.room, fill = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) walk.fill(v, y * W + Math.max(0, x0), y * W + Math.min(W, x1));
  };
  fill(r.x0 + 8, r.floor + 12, r.x1 - 8, r.bottom - 3, 1);
  fill(INDOOR.doorway.x0 + 4, r.bottom - 3, INDOOR.doorway.x1 - 4, r.bottom + 2, 1);
  for (const [x, y, w, h] of Object.values(INDOOR.blocks)) fill(x, y, x + w, y + h, 0);
}

const grid = createGrid(W, H, walk);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
// Как далеко точка от прямоугольника мебели (0 — внутри): к кровати и холодильнику подходят с любого открытого бока.
const off = (p: Point, [x, y, w, h]: [number, number, number, number]) => Math.hypot(Math.max(x - p.x, 0, p.x - x - w), Math.max(y - p.y, 0, p.y - y - h));

export const ENTER_REACH = 20;              // с какого расстояния от двери снаружи можно войти
export const EXIT_REACH = 16;               // с какого расстояния от порога внутри можно выйти
export const USE_REACH = 14;                // с какого расстояния от кресла, кровати, холодильника ими пользуются

// Холодильник: у каждого игрока своя полка — рыба в нём (сырая и жареная) лежит, сколько угодно, и не портится.
// MAX — сколько рыб влезает на полку.
export const FRIDGE = { MAX: 40 };

export const Indoor = {
  W, H, walk, ...grid,
  door: INDOOR.door,
  fire: INDOOR.fire,
  chairs: INDOOR.chairs,
  bed: INDOOR.bed,
  fridge: INDOOR.fridge,
  depthAt: (_x: number, _y: number) => 0,   // за мебелью герой прячется по очереди отрисовки, а не по карте глубины
  nearExit: (p: Point) => dist(p, INDOOR.door) <= EXIT_REACH,
  // Кресло, в которое можно сесть отсюда: ближайшее из тех, до которых рукой подать; -1 — ни одного рядом.
  chairNear(p: Point) {
    let best = -1, d = USE_REACH;
    [INDOOR.blocks.chairL!, INDOOR.blocks.chairR!].forEach((b, i) => { const k = off(p, b); if (k <= d) { best = i; d = k; } });
    return best;
  },
  nearBed: (p: Point) => off(p, INDOOR.blocks.bed!) <= USE_REACH,
  nearFridge: (p: Point) => off(p, INDOOR.blocks.fridge!) <= USE_REACH,
  // Кто сидит в кресле i или лежит в кровати, тот стоит ровно в её точке (x, y внутри мебели).
  inChair: (p: Point) => INDOOR.chairs.findIndex(c => dist(p, c) < 1),
  inBed: (p: Point) => dist(p, INDOOR.bed) < 1,
};
