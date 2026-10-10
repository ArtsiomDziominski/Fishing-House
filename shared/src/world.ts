// Мир: проходимость, «глубина» предметов и поиск пути по карте.
// Растры и размер карты лежат в world-data.ts (собирает tools/build-world.mjs).
// Один экземпляр на процесс: клиент ставит в него своё ведро как препятствие, сервер карту не меняет.

import { WORLD_DATA as DATA } from './world-data.ts';
import { HOUSE } from './house.ts';
import { FIRE } from './campfire.ts';
import { createGrid, type Point, type Box } from './grid.ts';

export type { Point, Box } from './grid.ts';

const W = DATA.w, H = DATA.h;

function unpack<T extends Uint8Array | Uint16Array>(runs: number[], out: T): T {
  let p = 0;
  for (let i = 0; i < runs.length; i += 2) { out.fill(runs[i]!, p, p + runs[i + 1]!); p += runs[i + 1]!; }
  return out;
}
const walk = unpack(DATA.walk, new Uint8Array(W * H));
const depth = unpack(DATA.depth, new Uint16Array(W * H));

// Дом стоит на карте отдельным предметом (shared/src/house.ts): его контур вычеркнут из проходимости.
const onMap = (x: number, y: number): Point => ({ x: x + DATA.pic.x, y: y + DATA.pic.y });
{
  const poly = HOUSE.outline.map(([x, y]) => onMap(x, y));
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  // Герой — не точка: ступни в середине, а плечи на HOUSE.clear.side пикселей в каждую сторону. Поэтому вокруг контура
  // ещё полоса: по бокам — на полширины героя (иначе плечо уходит за угол, столб или поленницу, которые стоят ближе его ступней),
  // спереди — на HOUSE.clear.front строк, чтобы ступни не вставали на нижний край стены.
  const { side, front } = HOUSE.clear;
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!inside(x + 0.5, y + 0.5)) continue;
    for (let dy = 0; dy <= front; dy++) for (let dx = -side; dx <= side; dx++) {
      const bx = x + dx, by = y + dy;
      if (bx >= 0 && by >= 0 && bx < W && by < H) walk[by * W + bx] = 0;
    }
  }
}
// Костёр у дома (shared/src/campfire.ts): очаг тоже вычеркнут из проходимости.
const fire = { ...onMap(...FIRE.at), rx: FIRE.rx, ry: FIRE.ry, sit: FIRE.sit };
for (let y = Math.ceil(fire.y - fire.ry); y <= fire.y + fire.ry; y++) for (let x = Math.ceil(fire.x - fire.rx); x <= fire.x + fire.rx; x++) {
  const dx = (x - fire.x) / fire.rx, dy = (y - fire.y) / fire.ry;
  if (x >= 0 && y >= 0 && x < W && y < H && dx * dx + dy * dy <= 1) walk[y * W + x] = 0;
}
const box = ([x, y, w, h]: readonly [number, number, number, number]): Box => ({ ...onMap(x, y), w, h });

// Строка-опора предмета в точке: если она ниже ступней героя, предмет его закрывает.
function depthAt(x: number, y: number): number { return (x < 0 || y < 0 || x >= W || y >= H) ? 0 : depth[y * W + x]!; }

// Ходить, искать путь и ставить временные препятствия (ведро, снятый рюкзак) — по общей сетке (grid.ts).
const { canWalk, nearestWalkable, findPath, wall, block, unblock } = createGrid(W, H, walk);

export const World = {
  W, H, rev: DATA.rev, pic: DATA.pic, walk, depth, canWalk, depthAt, nearestWalkable, findPath, wall, block, unblock,
  fisher: DATA.fisher, line: DATA.line, rod: DATA.rod, seat: DATA.seat, bucket: DATA.bucket, pack: DATA.pack, sparkles: DATA.sparkles as [number, number, number, number][],
  // Дом — отдельная картинка поверх карты (house.png), где он стоит: левый верх и размер.
  house: box([...HOUSE.at, ...HOUSE.size]),
  // Костёр у дома: середина очага, его размер и расстояние, с которого можно сесть у огня.
  fire,
  // Перед дверью дома: здесь просыпается тот, кто уснул от голода (homePoint в rules.ts), и отсюда входят в дом.
  door: onMap(...HOUSE.door),
  // Дверь дома с крыльцом: клик по ней — подойти и войти (indoor.ts).
  entry: box(HOUSE.entry),
  // Дом: устье трубы, горящие окна и ореол вокруг них. Если сборка запекла дом в карту (house.onMap в tools/world-shapes.mjs),
  // они берутся из world-data.ts, иначе — у дома, стоящего поверх карты.
  smoke: (DATA.smoke as Point | null) ?? onMap(...HOUSE.smoke) as Point | null,
  lights: (DATA.lights as Box | null) ?? box(HOUSE.lights) as Box | null,
  glow: (DATA.glow as Box | null) ?? box(HOUSE.glow) as Box | null,
};
