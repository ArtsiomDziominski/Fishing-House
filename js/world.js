// Мир: проходимость, «глубина» предметов и поиск пути по карте 240×320.
// Растры лежат в js/world-data.js (собирает tools/build-world.js).

const World = ((DATA) => {
  const W = DATA.w, H = DATA.h;

  function unpack(runs, Type) {
    const out = new Type(W * H); let p = 0;
    for (let i = 0; i < runs.length; i += 2) { out.fill(runs[i], p, p + runs[i + 1]); p += runs[i + 1]; }
    return out;
  }
  const walk = unpack(DATA.walk, Uint8Array);
  const depth = unpack(DATA.depth, Uint16Array);

  function canWalk(x, y) {
    x = Math.round(x); y = Math.round(y);
    return x >= 0 && y >= 0 && x < W && y < H && walk[y * W + x] === 1;
  }
  // Строка-опора предмета в точке: если она ниже ступней героя, предмет его закрывает.
  function depthAt(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? 0 : depth[y * W + x]; }

  // Временное препятствие (поставленное ведро): закрывает овал клеток и возвращает их список, чтобы потом открыть.
  function block(cx, cy, rx, ry) {
    const changed = [];
    for (let y = Math.ceil(cy - ry); y <= cy + ry; y++) for (let x = Math.ceil(cx - rx); x <= cx + rx; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dx = (x - cx) / rx, dy = (y - cy) / ry, i = y * W + x;
      if (dx * dx + dy * dy <= 1 && walk[i]) { walk[i] = 0; changed.push(i); }
    }
    return changed;
  }
  function unblock(changed) { for (const i of changed) walk[i] = 1; }

  // Ближайшая проходимая клетка — обходом по расширяющимся квадратам.
  function nearestWalkable(x, y, maxR = 60) {
    x = Math.round(x); y = Math.round(y);
    if (canWalk(x, y)) return { x, y };
    let best = null, bestD = Infinity;
    for (let r = 1; r <= maxR && (!best || r * r <= bestD); r++) {
      for (let i = -r; i <= r; i++) {
        for (const [cx, cy] of [[x + i, y - r], [x + i, y + r], [x - r, y + i], [x + r, y + i]]) {
          if (!canWalk(cx, cy)) continue;
          const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
          if (d < bestD) { bestD = d; best = { x: cx, y: cy }; }
        }
      }
    }
    return best;
  }

  // Свободна ли прямая между двумя точками.
  function clear(x0, y0, x1, y1) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2);
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0;
      if (!canWalk(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  // A* по восьми соседям, без срезания углов; затем путь выпрямляется по прямой видимости.
  const gScore = new Float32Array(W * H), came = new Int32Array(W * H), state = new Uint8Array(W * H);
  function findPath(from, to) {
    const s = nearestWalkable(from.x, from.y), g = nearestWalkable(to.x, to.y, W + H);   // цель — хоть с другого края карты
    if (!s || !g) return null;
    if (clear(s.x, s.y, g.x, g.y)) return [g];
    state.fill(0);
    const start = s.y * W + s.x, goal = g.y * W + g.x;
    const heap = [], hF = [];
    const push = (n, f) => {
      let i = heap.length; heap.push(n); hF.push(f);
      while (i > 0) { const p = (i - 1) >> 1; if (hF[p] <= f) break; heap[i] = heap[p]; hF[i] = hF[p]; i = p; }
      heap[i] = n; hF[i] = f;
    };
    const pop = () => {
      const top = heap[0], n = heap.pop(), f = hF.pop();
      if (heap.length) {
        let i = 0; const len = heap.length;
        for (;;) {
          let c = 2 * i + 1; if (c >= len) break;
          if (c + 1 < len && hF[c + 1] < hF[c]) c++;
          if (hF[c] >= f) break;
          heap[i] = heap[c]; hF[i] = hF[c]; i = c;
        }
        heap[i] = n; hF[i] = f;
      }
      return top;
    };
    const heur = n => { const dx = Math.abs((n % W) - g.x), dy = Math.abs(((n / W) | 0) - g.y); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
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
        const cost = gScore[cur] + (dx && dy ? 1.4142 : 1);
        if (state[n] === 0 || cost < gScore[n]) { gScore[n] = cost; came[n] = cur; state[n] = 1; push(n, cost + heur(n)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let n = goal; n !== -1; n = came[n]) cells.push({ x: n % W, y: (n / W) | 0 });
    cells.reverse();
    const path = []; let anchor = 0;
    while (anchor < cells.length - 1) {
      let far = cells.length - 1;
      while (far > anchor + 1 && !clear(cells[anchor].x, cells[anchor].y, cells[far].x, cells[far].y)) far--;
      path.push(cells[far]); anchor = far;
    }
    return path;
  }

  return {
    W, H, walk, depth, canWalk, depthAt, nearestWalkable, findPath, block, unblock,
    fisher: DATA.fisher, line: DATA.line, rod: DATA.rod, seat: DATA.seat, bucket: DATA.bucket, sparkles: DATA.sparkles || [],
  };
})(typeof WORLD_DATA !== 'undefined' ? WORLD_DATA : require('./world-data.js'));

if (typeof module !== 'undefined') module.exports = World;
