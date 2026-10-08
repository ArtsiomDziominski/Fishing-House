// Мир: проходимость, «глубина» предметов и поиск пути по карте.
// Растры и размер карты лежат в world-data.ts (собирает tools/build-world.mjs).
// Один экземпляр на процесс: клиент ставит в него своё ведро как препятствие, сервер карту не меняет.

import { WORLD_DATA as DATA } from './world-data.ts';
import { FIRE, HOUSE } from './house.ts';

export interface Point { x: number; y: number }
export interface Box extends Point { w: number; h: number }

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
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++)
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(W - 1, Math.ceil(Math.max(...xs))); x++)
      if (inside(x + 0.5, y + 0.5)) walk[y * W + x] = 0;
}
// Костёр у дома: очаг тоже вычеркнут из проходимости.
const fire = { ...onMap(...FIRE.at), rx: FIRE.rx, ry: FIRE.ry, sit: FIRE.sit };
for (let y = Math.ceil(fire.y - fire.ry); y <= fire.y + fire.ry; y++) for (let x = Math.ceil(fire.x - fire.rx); x <= fire.x + fire.rx; x++) {
  const dx = (x - fire.x) / fire.rx, dy = (y - fire.y) / fire.ry;
  if (x >= 0 && y >= 0 && x < W && y < H && dx * dx + dy * dy <= 1) walk[y * W + x] = 0;
}
const box = ([x, y, w, h]: readonly [number, number, number, number]): Box => ({ ...onMap(x, y), w, h });

function canWalk(x: number, y: number): boolean {
  x = Math.round(x); y = Math.round(y);
  return x >= 0 && y >= 0 && x < W && y < H && walk[y * W + x] === 1;
}
// Строка-опора предмета в точке: если она ниже ступней героя, предмет его закрывает.
function depthAt(x: number, y: number): number { return (x < 0 || y < 0 || x >= W || y >= H) ? 0 : depth[y * W + x]!; }

// Временное препятствие (поставленное ведро, снятый рюкзак): закрывает овал клеток и возвращает их список, чтобы потом открыть.
function block(cx: number, cy: number, rx: number, ry: number): number[] {
  const changed: number[] = [];
  for (let y = Math.ceil(cy - ry); y <= cy + ry; y++) for (let x = Math.ceil(cx - rx); x <= cx + rx; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const dx = (x - cx) / rx, dy = (y - cy) / ry, i = y * W + x;
    if (dx * dx + dy * dy <= 1 && walk[i]) { walk[i] = 0; changed.push(i); }
  }
  return changed;
}
function unblock(changed: number[]): void { for (const i of changed) walk[i] = 1; }

// Ближайшая проходимая клетка — обходом по расширяющимся квадратам.
function nearestWalkable(x: number, y: number, maxR = 60): Point | null {
  x = Math.round(x); y = Math.round(y);
  if (canWalk(x, y)) return { x, y };
  let best: Point | null = null, bestD = Infinity;
  for (let r = 1; r <= maxR && (!best || r * r <= bestD); r++) {
    for (let i = -r; i <= r; i++) {
      for (const [cx, cy] of [[x + i, y - r], [x + i, y + r], [x - r, y + i], [x + r, y + i]] as const) {
        if (!canWalk(cx, cy)) continue;
        const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
        if (d < bestD) { bestD = d; best = { x: cx, y: cy }; }
      }
    }
  }
  return best;
}

// Свободна ли прямая между двумя точками.
function clear(x0: number, y0: number, x1: number, y1: number): boolean {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2);
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    if (!canWalk(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

// A* по восьми соседям, без срезания углов; затем путь выпрямляется по прямой видимости.
const gScore = new Float32Array(W * H), came = new Int32Array(W * H), state = new Uint8Array(W * H);
function findPath(from: Point, to: Point): Point[] | null {
  const s = nearestWalkable(from.x, from.y), g = nearestWalkable(to.x, to.y, W + H);   // цель — хоть с другого края карты
  if (!s || !g) return null;
  if (clear(s.x, s.y, g.x, g.y)) return [g];
  state.fill(0);
  const start = s.y * W + s.x, goal = g.y * W + g.x;
  const heap: number[] = [], hF: number[] = [];
  const push = (n: number, f: number) => {
    let i = heap.length; heap.push(n); hF.push(f);
    while (i > 0) { const p = (i - 1) >> 1; if (hF[p]! <= f) break; heap[i] = heap[p]!; hF[i] = hF[p]!; i = p; }
    heap[i] = n; hF[i] = f;
  };
  const pop = () => {
    const top = heap[0]!, n = heap.pop()!, f = hF.pop()!;
    if (heap.length) {
      let i = 0; const len = heap.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= len) break;
        if (c + 1 < len && hF[c + 1]! < hF[c]!) c++;
        if (hF[c]! >= f) break;
        heap[i] = heap[c]!; hF[i] = hF[c]!; i = c;
      }
      heap[i] = n; hF[i] = f;
    }
    return top;
  };
  const heur = (n: number) => { const dx = Math.abs((n % W) - g.x), dy = Math.abs(((n / W) | 0) - g.y); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
  gScore[start] = 0; came[start] = -1; state[start] = 1; push(start, heur(start));
  let found = false;
  while (heap.length) {
    const cur = pop(); if (state[cur] === 2) continue; state[cur] = 2;
    if (cur === goal) { found = true; break; }
    const cx = cur % W, cy = (cur / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx; if (!walk[n] || state[n] === 2) continue;
      if (dx && dy && (!walk[cy * W + nx] || !walk[ny * W + cx])) continue;
      const cost = gScore[cur]! + (dx && dy ? 1.4142 : 1);
      if (state[n] === 0 || cost < gScore[n]!) { gScore[n] = cost; came[n] = cur; state[n] = 1; push(n, cost + heur(n)); }
    }
  }
  if (!found) return null;
  const cells: Point[] = [];
  for (let n = goal; n !== -1; n = came[n]!) cells.push({ x: n % W, y: (n / W) | 0 });
  cells.reverse();
  const path: Point[] = []; let anchor = 0;
  while (anchor < cells.length - 1) {
    let far = cells.length - 1;
    while (far > anchor + 1 && !clear(cells[anchor]!.x, cells[anchor]!.y, cells[far]!.x, cells[far]!.y)) far--;
    path.push(cells[far]!); anchor = far;
  }
  return path;
}

export const World = {
  W, H, rev: DATA.rev, pic: DATA.pic, walk, depth, canWalk, depthAt, nearestWalkable, findPath, block, unblock,
  fisher: DATA.fisher, line: DATA.line, rod: DATA.rod, seat: DATA.seat, bucket: DATA.bucket, pack: DATA.pack, sparkles: DATA.sparkles as [number, number, number, number][],
  // Дом — отдельная картинка поверх карты (house.png), где он стоит: левый верх и размер.
  house: box([...HOUSE.at, ...HOUSE.size]),
  // Костёр у дома: середина очага, его размер и расстояние, с которого можно сесть у огня.
  fire,
  // Дом: устье трубы, горящие окна и ореол вокруг них. Если сборка запекла дом в карту (house.onMap в tools/world-shapes.mjs),
  // они берутся из world-data.ts, иначе — у дома, стоящего поверх карты.
  smoke: (DATA.smoke as Point | null) ?? onMap(...HOUSE.smoke) as Point | null,
  lights: (DATA.lights as Box | null) ?? box(HOUSE.lights) as Box | null,
  glow: (DATA.glow as Box | null) ?? box(HOUSE.glow) as Box | null,
};
