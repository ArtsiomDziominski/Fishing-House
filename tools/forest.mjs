// Лес вокруг поляны: деревья и кусты, вырезанные с картинки-образца (art/reference.webp) пиксель в пиксель.
// Кроны не рисуются заново: каждая снята с настоящей кроны картинки заливкой по листве до её тёмного контура.
// Край картинки и соседние кроны срезают у них кусок — его даёт зеркальная половина той же кроны.
// Виды (их имена идут в список trees в world-shapes.mjs, как у деревьев из tools/trees.mjs):
//   crown — светлая крона слева сверху, olive — жёлто-зелёная у левого края, green — крона у правого края;
//   far, farOlive — те же кроны в тени, для дальних рядов (как тёмный лес за домом на картинке);
//   canopy, canopyOlive — они же без ствола: сплошной полог дальнего леса, где стволов не видно (как над домом на картинке);
//   bush — куст у левого края поляны (за ним на картинке ствол жёлто-зелёного дерева);
//   shrub, shrubR — заросли у воды из левого и правого нижних углов картинки: их срезанный рамкой бок ставится к краю карты.
// У каждого дерева ствол цветами стволов картинки; ax, ay — середина подножия (у полога — низ кроны), foot — овал, куда
// нельзя наступить, leaf — маска листвы (1 — листва, 0 — ствол).
// block — овал земли под кроной [rx, ry, сдвиг вверх]: сомкнутые, они дают чащу, куда герой не заходит.

const hex = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const hash = (x, y, s = 0) => { let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const INK = hex('0e1c19');                                          // контур листвы
const BARK = ['0a0303', '3e1b17', '5a2a22', '6c3725', '8a4a2e'].map(hex);   // ствол картинки: контур, тень, основной, свет, блик

// Где на картинке (240×320) какая крона: seed — точка внутри листвы, box — рамка поиска, oval — [cx, cy, rx, ry] предел заливки,
// mirror — столбец оси: всё, чего у кроны нет по одну сторону оси, берётся зеркально с другой;
// drop — многоугольник, куда заливка не идёт: там за кроной видна соседняя, а контур между ними прерывается.
const CUTS = {
  crown: { seed: [45, 40], box: [0, 0, 100, 100], oval: [45, 47, 38, 35], mirror: 45, drop: [[59, 0], [100, 0], [100, 33], [74, 31], [68, 26], [62, 20], [59, 16]] },
  olive: { seed: [15, 75], box: [0, 40, 60, 125], oval: [8, 80, 40, 36], mirror: 4 },
  green: { seed: [225, 50], box: [195, 10, 240, 120], oval: [236, 55, 38, 40], mirror: 237 },
  bush: { seed: [12, 175], box: [0, 142, 34, 196], oval: [0, 173, 29, 23], mirror: 0, drop: [[22, 140], [40, 140], [40, 200], [30, 200], [30, 176], [28, 168], [24, 162], [20, 158]] },
  shrub: { seed: [20, 295], box: [0, 252, 92, 320], oval: [30, 320, 62, 66] },
  shrubR: { seed: [225, 300], box: [180, 260, 240, 320], oval: [240, 320, 60, 60] },
};

// Заливка листвы от seed: светлее th и не вода; потом швы листвы смыкаются, дыры в ней закрываются.
function cutMask(src, W, H, { seed, box, oval, drop }, th = 45) {
  const [x0, y0, x1, y1] = box, bw = x1 - x0, bh = y1 - y0;
  const at = (x, y) => { const i = (y * W + x) * 3; return [src[i], src[i + 1], src[i + 2]]; };
  const ok = (x, y) => {
    if (x < x0 || y < y0 || x >= x1 || y >= y1 || x >= W || y >= H) return false;
    const dx = (x - oval[0]) / oval[2], dy = (y - oval[1]) / oval[3]; if (dx * dx + dy * dy > 1) return false;
    if (drop && inPoly(drop, x + 0.5, y + 0.5)) return false;
    const c = at(x, y); return lum(c) >= th && !(c[2] > c[0] + 40 && c[2] > c[1] + 5);
  };
  let m = new Uint8Array(bw * bh); const st = [seed];
  while (st.length) {
    const [x, y] = st.pop(); if (!ok(x, y)) continue;
    const i = (y - y0) * bw + (x - x0); if (m[i]) continue; m[i] = 1; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const grow = (m, on) => {                                         // on=1 — нарастить на пиксель, on=0 — срезать
    const o = Uint8Array.from(m);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const n = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].map(([u, v]) => (u < 0 || v < 0 || u >= bw || v >= bh) ? (on ? 0 : 1) : m[v * bw + u]);
      if (on && !m[y * bw + x] && n.some(Boolean)) o[y * bw + x] = 1;
      if (!on && m[y * bw + x] && !n.every(Boolean)) o[y * bw + x] = 0;
    }
    return o;
  };
  for (let k = 0; k < 2; k++) m = grow(m, 1);
  for (let k = 0; k < 2; k++) m = grow(m, 0);
  const out = new Uint8Array(bw * bh); const st2 = [];               // дыры: всё, до чего не дойти снаружи рамки
  for (let x = 0; x < bw; x++) st2.push([x, 0], [x, bh - 1]);
  for (let y = 0; y < bh; y++) st2.push([0, y], [bw - 1, y]);
  while (st2.length) {
    const [x, y] = st2.pop(); if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
    const i = y * bw + x; if (out[i] || m[i]) continue; out[i] = 1; st2.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i] ? 0 : 1;
  return { m: out, x0, y0, bw, bh };
}

// Крона как RGBA: листва картинки, дополненная зеркалом, в контуре INK.
function cutCrown(src, W, H, cut) {
  const { m, x0, y0, bw, bh } = cutMask(src, W, H, cut);
  const px = new Map();                                             // "x,y" (координаты картинки) → цвет
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (m[y * bw + x]) { const i = ((y + y0) * W + x + x0) * 3; px.set(`${x + x0},${y + y0}`, [src[i], src[i + 1], src[i + 2]]); }
  if (cut.mirror !== undefined) {
    for (const [k, c] of [...px]) {
      const [x, y] = k.split(',').map(Number), mx = 2 * cut.mirror - x;
      if (!px.has(`${mx},${y}`)) px.set(`${mx},${y}`, c);
    }
  }
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  for (const k of px.keys()) { const [x, y] = k.split(',').map(Number); X0 = Math.min(X0, x); X1 = Math.max(X1, x); Y0 = Math.min(Y0, y); Y1 = Math.max(Y1, y); }
  const w = X1 - X0 + 3, h = Y1 - Y0 + 3, buf = Buffer.alloc(w * h * 4);
  for (const [k, c] of px) { const [x, y] = k.split(',').map(Number), o = ((y - Y0 + 1) * w + x - X0 + 1) * 4; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255; }
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && buf[(y * w + x) * 4 + 3] === 255;
  const ink = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1))) ink.push([x, y]);
  for (const [x, y] of ink) { const o = (y * w + x) * 4; buf[o] = INK[0]; buf[o + 1] = INK[1]; buf[o + 2] = INK[2]; buf[o + 3] = 254; }
  return { w, h, buf, x0: X0 - 1, y0: Y0 - 1 };                    // x0, y0 — где левый верх кроны на картинке
}

// Тень дальних рядов: листва темнеет и уходит в холодную зелень, как лес за домом на картинке.
function shade(crown) {
  const buf = Buffer.from(crown.buf);
  for (let o = 0; o < buf.length; o += 4) if (buf[o + 3]) {
    buf[o] = Math.round(buf[o] * 0.5 + 6); buf[o + 1] = Math.round(buf[o + 1] * 0.62 + 10); buf[o + 2] = Math.round(buf[o + 2] * 0.62 + 12);
  }
  return { ...crown, buf };
}
function flip(crown) {
  const { w, h } = crown, buf = Buffer.alloc(crown.buf.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) crown.buf.copy(buf, (y * w + w - 1 - x) * 4, (y * w + x) * 4, (y * w + x) * 4 + 4);
  return { ...crown, buf };
}

// Ствол шириной wid от верха top до подножия base; внизу корни расходятся, свет слева, тень справа.
function drawTrunk(put, cx, top, base, wid, seed) {
  const [edge, dark, mid, light, shine] = BARK;
  for (let y = top; y <= base; y++) {
    const down = base - y, flare = down <= 1 ? 4 : down <= 3 ? 2 : down <= 5 ? 1 : 0;
    const half = Math.floor(wid / 2) + flare, x0 = cx - half, x1 = cx + half;
    for (let x = x0; x <= x1; x++) {
      const t = (x - x0) / Math.max(1, x1 - x0);
      let c = t < 0.22 ? light : t < 0.62 ? mid : dark;
      if (t > 0.25 && t < 0.3 && hash(x, y, seed) < 0.5) c = shine;
      if (hash(x >> 1, y >> 2, seed + 3) < 0.12 && t > 0.3) c = dark;
      put(x, y, x === x0 || x === x1 || y === base ? edge : c);
    }
  }
}

// Готовые виды: crown/olive/green — дерево (крона на стволе), far/farOlive — они же в тени, canopy/canopyOlive — тень без ствола,
// shrub/shrubR — кусты без ствола.
export const FOREST_KINDS = ['crown', 'olive', 'green', 'far', 'farOlive', 'canopy', 'canopyOlive', 'bush', 'shrub', 'shrubR'];
const TREE_OF = { crown: ['crown', false], olive: ['olive', false], green: ['green', false], far: ['crown', true], farOlive: ['olive', true] };
const CANOPY_OF = { canopy: 'crown', canopyOlive: 'olive' };
const allLeaf = sp => ({ ...sp, leaf: Uint8Array.from({ length: sp.w * sp.h }, (_, i) => (sp.buf[i * 4 + 3] ? 1 : 0)) });

export function forestKit(src, W, H) {
  const crowns = {};
  for (const [k, cut] of Object.entries(CUTS)) crowns[k] = cutCrown(src, W, H, cut);
  const cache = new Map();
  return function forestSprite(kind, seed = 0) {
    const key = `${kind}:${seed & 1}`;
    if (cache.has(key)) return cache.get(key);
    let sp;
    if (kind === 'bush') {
      let c = crowns[kind]; if (seed & 1) c = flip(c);
      sp = allLeaf({ ...c, ax: Math.floor(c.w / 2), ay: c.h - 2, foot: [Math.round(c.w * 0.36), 4], block: null, name: 'Куст' });
    } else if (kind === 'shrub' || kind === 'shrubR') {
      let c = crowns[kind]; if (seed & 1) c = flip(c);
      sp = allLeaf({ ...c, ax: Math.floor(c.w / 2), ay: c.h - 1, foot: [0, 0], block: null, name: 'Заросли у воды' });
    } else if (CANOPY_OF[kind]) {
      let c = shade(crowns[CANOPY_OF[kind]]); if (seed & 1) c = flip(c);
      sp = allLeaf({ ...c, ax: Math.floor(c.w / 2), ay: c.h - 1, foot: [0, 0], block: [Math.round(c.w * 0.42), 12, 4], name: 'Полог леса' });
    } else {
      const [base, dim] = TREE_OF[kind];
      let c = crowns[base]; if (dim) c = shade(c); if (seed & 1) c = flip(c);
      const stem = 16, w = c.w, h = c.h + stem - 6, buf = Buffer.alloc(w * h * 4), ax = Math.floor(w / 2) + (seed & 1 ? -2 : 2), ay = h - 1;
      const put = (x, y, col) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255; };
      drawTrunk((x, y, col) => put(x, y, dim ? col.map(v => Math.round(v * 0.6)) : col), ax, c.h - 20, ay, 13, seed);
      const leaf = new Uint8Array(w * h);
      for (let y = 0; y < c.h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4; if (!c.buf[o + 3]) continue;
        buf[(y * w + x) * 4] = c.buf[o]; buf[(y * w + x) * 4 + 1] = c.buf[o + 1]; buf[(y * w + x) * 4 + 2] = c.buf[o + 2]; buf[(y * w + x) * 4 + 3] = 255;
        leaf[y * w + x] = 1;
      }
      sp = { w, h, buf, leaf, ax, ay, foot: [7, 3], block: [Math.round(w * 0.42), 12, 10], name: dim ? 'Дерево в тени' : 'Дерево' };
    }
    if (!(seed & 1) && !CANOPY_OF[kind]) sp.home = [crowns[TREE_OF[kind]?.[0] ?? kind].x0 + sp.ax, crowns[TREE_OF[kind]?.[0] ?? kind].y0 + sp.ay];   // куда встать, чтобы крона легла как на картинке
    cache.set(key, sp);
    return sp;
  };
}
