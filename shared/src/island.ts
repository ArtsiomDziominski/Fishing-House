// Остров посреди реки: к нему плывут на лодке от причала (сообщение sail у лодки — nearBoat в rules.ts), обратно — на ней же
// от пляжа острова. У каждого причала свой остров, общий для хозяина и гостей: своя земля (items.place = islePlace(хозяин)),
// свой костёр. Кадр — свой, 640×360, как у дома (indoor.ts): где герой — говорит WorldState.isle, x, y тогда в кадре острова.
// На острове: мостки с местом рыбака и берега, откуда удилище достаёт до воды (shoreCast), — тут клюют лещ и сом, которых у причала нет (FISH, isle), — костёр на
// поляне, деревья и песчаный пляж, на который вытащена лодка. Червей тут не копают (песок и корни), рюкзак не снимают:
// место рюкзака — на причале, и до лежащего там с острова не дотянуться (packInReach).
// Рисует остров клиент (app/app/game/island-view.ts) по этим же числам; за деревьями герой прячется по очереди отрисовки.

import { createGrid, type Point } from './grid.ts';
import { World } from './world.ts';

const W = 640, H = 360;

// Место рыбака на мостках. Мостки — те же, что у причала (картинка и проходимость сняты с карты), только сдвинутые:
// всё, что у причала стоит относительно места рыбака (рыбак, леска, удилище, мостки), здесь стоит так же.
const SEAT = { x: 262, y: 266 };
const dx = SEAT.x - World.seat.x, dy = SEAT.y - World.seat.y;
const shift = <T extends Point>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
// Мостки на карте причала: картинка (app/app/assets/island/pier.png) лежала здесь, настил — ниже линии берега bank.
const PIER_PIC = { x: 246, y: 259, w: 87, h: 69 };
const pierBank = (x: number) => 250 + (x - 240) / 3;   // линия берега у причала на карте: выше — трава, ниже — вода и настил

// Деревья — те же, что растут вокруг причала (tools/trees.mjs и лесные виды tools/forest.mjs, картинки — в app/app/assets/island/):
// ax, ay — где на картинке подножие ствола, foot — полуоси овала у подножия, сквозь который не пройти.
export const ISLE_TREES = {
  oak: { ax: 27, ay: 60, foot: [6, 3] },
  spruce: { ax: 17, ay: 58, foot: [3, 2] },
  birch: { ax: 17, ay: 60, foot: [3, 2] },
  apple: { ax: 20, ay: 42, foot: [4, 2] },
  pine: { ax: 20, ay: 66, foot: [3, 2] },
  green: { ax: 39, ay: 77, foot: [7, 3] },
  crown: { ax: 40, ay: 74, foot: [7, 3] },
  bush: { ax: 28, ay: 40, foot: [21, 4] },
} as const satisfies Record<string, { ax: number; ay: number; foot: readonly [number, number] }>;
export type IsleTree = keyof typeof ISLE_TREES;

export const ISLE = {
  W, H,
  // Край суши (верх берега), по часовой стрелке от западного мыса. На юге край — обрыв: под ним клиент рисует земляной
  // откос. Южный берег у мостков идёт той же линией, что берег у причала (pierBank), — мостки к нему пристают так же.
  shore: [
    [150, 190], [170, 202], [200, 211], [233, 222], [290, 241], [345, 259], [372, 266], [404, 270], [436, 268], [462, 260],
    [484, 248], [502, 230], [514, 208], [518, 184], [512, 160], [498, 138], [476, 118], [448, 102], [414, 90], [376, 84],
    [336, 84], [298, 88], [262, 98], [230, 112], [202, 130], [178, 150], [160, 170],
  ] as [number, number][],
  // Песчаный пляж на юго-востоке: к нему пристаёт лодка. Многоугольник поверх травы (заходит за край суши — лишнее отрежет берег).
  beach: [[352, 268], [362, 250], [384, 240], [414, 236], [446, 230], [474, 222], [494, 214], [510, 226], [500, 252], [470, 272], [420, 280], [370, 280]] as [number, number][],
  seat: { ...SEAT, r: World.seat.r },
  fisher: shift(World.fisher),          // сидящий рыбак (fisher.png): левый верх
  line: shift(World.line),              // леска с картинки (line.png): левый верх
  rod: { x: World.rod.x + dx, tipY: World.rod.tipY + dy, waterY: World.rod.waterY + dy },
  pier: shift(PIER_PIC),                // картинка мостков: левый верх и размер
  // Лодка, вытащенная на пляж (BOAT_ART 2 в app/app/game/boats.ts, носом к берегу — flip): середина нижнего края картинки.
  boat: { x: 472, y: 298, flip: true },
  // Где выходят из лодки и садятся в неё — на песке у её носа.
  landing: { x: 440, y: 252 },
  // Костёр на поляне посреди острова: середина очага, очаг (сквозь него не пройти) и с какого расстояния садятся у огня.
  fire: { x: 322, y: 184, rx: 12, ry: 6, sit: 34 },
  // Деревья и кусты: вид (ISLE_TREES) и где подножие ствола. Кто стоит выше подножия, того крона закрывает.
  trees: [
    ['green', 226, 140], ['spruce', 262, 118], ['pine', 292, 106], ['bush', 314, 124], ['spruce', 352, 104], ['crown', 404, 118],
    ['pine', 450, 128], ['birch', 480, 152], ['oak', 494, 190], ['birch', 194, 166], ['bush', 172, 190], ['apple', 372, 160],
  ] as [IsleTree, number, number][],
  // Камни и брёвна-скамейки у костра: овалы [x, y, rx, ry], сквозь которые не пройти. Клиент рисует их там же.
  rocks: [[506, 216, 9, 5], [392, 258, 4, 2]] as [number, number, number, number][],
  logs: [[300, 204, 10, 3], [350, 202, 10, 3]] as [number, number, number, number][],
};

const inPoly = (poly: [number, number][], x: number, y: number) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i]!, [bx, by] = poly[j]!;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) c = !c;
  }
  return c;
};
export const onIsle = (x: number, y: number) => inPoly(ISLE.shore, x, y);
export const onBeach = (x: number, y: number) => onIsle(x, y) && inPoly(ISLE.beach, x, y);

// Где можно ходить: суша с запасом от края (плечи героя — по 5 пикселей в стороны, ступни не на обрыве), мостки — как
// у причала, без стволов, камней, брёвен и очага. Остаётся только то, что связано с пляжем: в отрезанный угол не забрести.
const walk = new Uint8Array(W * H);
{
  const land = (x: number, y: number) => onIsle(x, y) && onIsle(x - 5, y) && onIsle(x + 5, y) && onIsle(x, y + 3) && onIsle(x, y - 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (land(x + 0.5, y + 0.5)) walk[y * W + x] = 1;
  // настил мостков: клетки причала ниже его линии берега (и чуть выше — чтобы настил сошёлся с сушей), там, где у причала можно ходить
  for (let y = PIER_PIC.y; y < PIER_PIC.y + PIER_PIC.h; y++) for (let x = PIER_PIC.x; x < PIER_PIC.x + PIER_PIC.w; x++) {
    const up = y - pierBank(x);
    if (up < -8 || !World.canWalk(x, y)) continue;
    const ix = x + dx, iy = y + dy;
    if (up > 0 || onIsle(ix, iy)) walk[iy * W + ix] = 1;
  }
  const oval = (cx: number, cy: number, rx: number, ry: number) => {
    for (let y = Math.ceil(cy - ry); y <= cy + ry; y++) for (let x = Math.ceil(cx - rx); x <= cx + rx; x++) {
      const u = (x - cx) / rx, v = (y - cy) / ry;
      if (x >= 0 && y >= 0 && x < W && y < H && u * u + v * v <= 1) walk[y * W + x] = 0;
    }
  };
  for (const [kind, x, y] of ISLE.trees) { const [rx, ry] = ISLE_TREES[kind].foot; oval(x, y - 1, rx + 2, ry + 1); }   // плечо героя не входит в ствол
  for (const [x, y, rx, ry] of [...ISLE.rocks, ...ISLE.logs]) oval(x, y, rx + 2, ry + 1);
  oval(ISLE.fire.x, ISLE.fire.y, ISLE.fire.rx, ISLE.fire.ry);
  // связное с пляжем — заливкой от места высадки
  const keep = new Uint8Array(W * H), stack = [ISLE.landing.y * W + ISLE.landing.x];
  while (stack.length) {
    const i = stack.pop()!; if (keep[i] || !walk[i]) continue;
    keep[i] = 1; const x = i % W;
    if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1); if (i >= W) stack.push(i - W); if (i < W * (H - 1)) stack.push(i + W);
  }
  walk.set(keep);
}

const grid = createGrid(W, H, walk);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export const BOAT_REACH = 18;             // с какого расстояния от лодки (места посадки) можно отплыть

export const Isle = {
  W, H, walk, ...grid,
  seat: ISLE.seat, fisher: ISLE.fisher, line: ISLE.line, rod: ISLE.rod,
  fire: ISLE.fire, landing: ISLE.landing,
  depthAt: (_x: number, _y: number) => 0,   // за деревьями герой прячется по очереди отрисовки, а не по карте глубины
  nearBoat: (p: Point) => dist(p, ISLE.landing) <= BOAT_REACH,
};

// ---------- рыбалка с берега ----------
// С удочкой садятся не только на мостках, но и на берегу — там, где удилище достаёт до воды. Рыбак с картинки (fisher.png)
// сидит лицом влево, отражённый — лицом вправо; кончик удилища стоит от места рыбака так же, как у мостков (World.rod от
// World.seat), только у отражённого — с другой стороны. Леска висит с кончика отвесно: кончик — над тем же рядом, где сидит
// рыбак, а вода ниже суши на высоту откоса, поэтому поплавок ложится на воду на SHORE.drop строк ниже места рыбака — или ещё
// ниже (до SHORE.deep строк), если там пока откос и его тень. Под кончиком до поплавка не должно быть суши, а сам поплавок —
// на открытой воде: не на мостках, не у лодки и не у камня. С северного берега не порыбачишь: рыбак смотрит вбок, а там
// вдоль берега — суша. У мостков (ближе SHORE.pier к месту рыбака и на настиле) садятся на их место рыбака, на камни — не садятся.
export const SHORE = { drop: 6, deep: 14, pier: 34 };
const TIP = { x: World.rod.x - World.seat.x, y: World.rod.tipY - World.seat.y };   // кончик удилища от места рыбака лицом влево
const ABOVE = 10;                                       // над поплавком: откос (до 7 строк) и сам поплавок (3 строки) — не на суше
// Куда сидящий на берегу ставит ведро из руки: за спину, на сушу (смещения — для сидящего лицом влево).
const PAIL_AT = [[16, -4], [14, -9], [18, 1], [10, -12], [20, -8]] as const;
// Где сидит рыбак (x, y — целые), смотрит ли он вправо (flip), кончик удилища, строка воды под ним и куда встаёт ведро из руки.
export interface ShoreCast { x: number; y: number; flip: boolean; tip: Point; waterY: number; pail: Point }

const landAt = (x: number, y: number) => onIsle(x + 0.5, y + 0.5);
function openWater(x: number, y: number) {
  for (let k = 0; k <= ABOVE; k++) if (landAt(x, y - k)) return false;
  const p = ISLE.pier, b = ISLE.boat;
  if (x >= p.x - 4 && x < p.x + p.w + 4 && y >= p.y - 4 && y < p.y + p.h + 4) return false;
  if (Math.abs(x - b.x) <= 30 && y >= b.y - 40 && y <= b.y + 4) return false;
  for (const [cx, cy, rx, ry] of ISLE.rocks) if (((x - cx) / (rx + 5)) ** 2 + ((y - cy) / (ry + 4)) ** 2 <= 1) return false;
  return true;
}
function castFrom(x: number, y: number, flip: boolean): ShoreCast | null {
  const s = flip ? -1 : 1, tip = { x: x + TIP.x * s, y: y + TIP.y };
  let waterY = -1;
  for (let r = y + SHORE.drop; r <= y + SHORE.drop + SHORE.deep && waterY < 0; r++) if (openWater(tip.x - 1, r) && openWater(tip.x, r) && openWater(tip.x + 1, r)) waterY = r;
  if (waterY < 0) return null;
  for (let r = y; r < waterY; r++) if (landAt(tip.x, r)) return null;   // леска не идёт через сушу
  const at = PAIL_AT.find(([dx, dy]) => [-5, 0, 5].every(k => Isle.canWalk(x + dx * s + k, y + dy))) ?? PAIL_AT[0];
  return { x, y, flip, tip, waterY, pail: { x: x + at[0] * s, y: y + at[1] } };
}
// На камнях у воды не сидят: камень ниже рыбака нарисован бы поверх него (камень — ISLE.rocks, высотой в 2,2 полуоси).
const byRock = (x: number, y: number) => ISLE.rocks.some(([cx, cy, rx, ry]) => Math.abs(x - cx) <= rx + 8 && y >= cy - ry * 3.2 - 4 && y <= cy + ry + 2);
const casts = new Map<number, ShoreCast | null>();
// Можно ли сесть рыбачить там, где стоит герой (p — в кадре острова), и как он сядет. dir — куда он смотрит: если вода есть
// с обеих сторон, сядет лицом туда (вправо — только если смотрит вправо). null — тут с удочкой не сесть.
export function shoreCast(p: Point, dir?: string): ShoreCast | null {
  const x = Math.round(p.x), y = Math.round(p.y), right = dir === 'right', key = (y * W + x) * 2 + (right ? 1 : 0);
  if (casts.has(key)) return casts.get(key)!;
  let c: ShoreCast | null = null;
  const pier = ISLE.pier;
  if (Isle.canWalk(x, y) && !byRock(x, y) && Math.hypot(x - ISLE.seat.x, y - ISLE.seat.y) > SHORE.pier && !(x >= pier.x && x < pier.x + pier.w && y >= pier.y && y < pier.y + pier.h)) {
    c = castFrom(x, y, right) ?? castFrom(x, y, !right);
  }
  if (casts.size > 50000) casts.clear();
  casts.set(key, c);
  return c;
}
// Закрывает ли сидящего здесь крона дерева: деревья, растущие ниже него, рисуются поверх.
const underCrown = (x: number, y: number) => ISLE.trees.some(([kind, tx, ty]) => { const t = ISLE_TREES[kind]; return ty > y && Math.abs(x - tx) < t.ax && y > ty - t.ay + 8; });
// Куда сесть на берегу, чтобы поплавок лёг поближе к точке (x, y) на воде (клик по воде): из мест, откуда поплавок
// ложится не дальше 16 пикселей от неё, — ближнее к точке, а при равных — к герою (from); под кроной дерева, где рыбака
// не видно, — только если больше негде. null — отсюда до этой воды не достать.
export function shoreToward(x: number, y: number, from: Point): ShoreCast | null {
  let best: ShoreCast | null = null, score = Infinity;
  const tx = Math.abs(TIP.x), top = Math.round(y - SHORE.drop - SHORE.deep - 16), bottom = Math.round(y - SHORE.drop + 16);
  for (let sy = top; sy <= bottom; sy++) for (let sx = Math.round(x - tx - 16); sx <= Math.round(x + tx + 16); sx++) {
    if (!Isle.canWalk(sx, sy)) continue;
    for (const dir of ['left', 'right']) {
      const c = shoreCast({ x: sx, y: sy }, dir); if (!c) continue;
      const d = Math.hypot(c.tip.x - x, c.waterY - y);
      if (d > 16) continue;
      const v = d + Math.hypot(c.x - from.x, c.y - from.y) * 0.05 + (underCrown(c.x, c.y) ? 100 : 0);
      if (v < score) { score = v; best = c; }
    }
  }
  return best;
}
