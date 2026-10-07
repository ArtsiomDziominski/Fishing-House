// Деревья поля: пять видов, нарисованных пиксель в пиксель (1 арт-пиксель = 1 пиксель карты, как герой 19×34).
// Каждый вид — спрайт RGBA с прозрачным фоном; ax, ay — середина подножия ствола: эта точка встаёт на место из
// world-shapes.mjs (trees), её строка — опора дерева (выше неё герой прячется за деревом). foot — полуоси овала
// у подножия, куда нельзя наступить: держит только ствол, под кроной ходить можно.
// Рисунок детерминирован: один и тот же вид всегда выходит одинаковым, а seed даёт ему вариант.

const hex = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const hash = (x, y, s = 0) => { let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

// Палитры сняты с крон и стволов картинки-образца; листва — от тени к свету.
const INK = hex('0e1c19');                                          // контур листвы, как у крон картинки
const LEAF = {
  oak: ['1b3a2c', '2b5232', '3f6a33', '5a8636', '78a23f', '9fc152'].map(hex),
  spruce: ['112a26', '173a31', '22503c', '316849', '4a8458', '6a9e66'].map(hex),
  birch: ['3a5a1f', '4f7524', '6b922b', '8aae35', 'a9c847', 'cde26e'].map(hex),
  apple: ['1d3d2a', '2f5a30', '467a35', '64983c', '86b548', 'aed05e'].map(hex),
  pine: ['10282a', '183a33', '24503b', '336544', '4b7f4d', '67975a'].map(hex),
};
const BARK = {                                                      // [контур, тень, основной, свет, полоса]
  oak: ['0a0303', '48201a', '6c3725', '8a4a2e', '5a2a1d'].map(hex),
  spruce: ['0a0303', '3c1d16', '5c2f22', '754030', '4a2419'].map(hex),
  birch: ['1c1a17', 'a8a593', 'dcd9c8', 'f4f1e2', '2a2622'].map(hex),
  apple: ['0a0303', '4a2a1c', '6e412b', '8c5838', '57301f'].map(hex),
  pine: ['0a0303', '6b3420', '9a4f2c', 'c06c3c', '7a3b22'].map(hex),
};
const APPLE = { body: hex('c0352b'), light: hex('ec6a4c'), dark: hex('7d1f1d') };

function canvas(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255; };
  const has = (x, y) => x >= 0 && y >= 0 && x < w && y < h && buf[(y * w + x) * 4 + 3] > 0;
  return { w, h, buf, put, has };
}

// Ствол: от top до base (base — строка подножия), шириной wid; внизу корни расходятся на пиксель в каждую сторону.
// Свет слева, тень справа, редкие тёмные полосы коры; у берёзы — чёрные чёрточки поперёк.
function trunk(cv, cx, top, base, wid, bark, { birch = false, seed = 0, lean = 0 } = {}) {
  const [edge, dark, mid, light, stripe] = bark;
  for (let y = top; y <= base; y++) {
    const flare = y >= base - 1 ? 2 : y >= base - 3 ? 1 : 0;
    const shift = Math.round(lean * (base - y) / Math.max(1, base - top));
    const half = wid / 2 + flare, x0 = Math.round(cx + shift - half), x1 = Math.round(cx + shift + half) - 1;
    for (let x = x0; x <= x1; x++) {
      const side = x === x0 || x === x1, t = (x - x0) / Math.max(1, x1 - x0);
      let c = side || y === base ? edge : t < 0.3 ? light : t > 0.68 ? dark : mid;
      if (!side && y !== base) {
        if (birch) { if (hash(Math.floor(y / 2), x > cx ? 1 : 0, seed + 3) < 0.22 && t > 0.15) c = stripe; }
        else if (hash(x, Math.floor(y / 3), seed + 5) < 0.18 && t > 0.2 && t < 0.85) c = stripe;
      }
      cv.put(x, y, c);
    }
  }
}

// Ветка: линия толщиной в пиксель от (x0, y0) к (x1, y1).
function branch(cv, x0, y0, x1, y1, c) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) cv.put(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c);
}

// Крона из кругов-«клубов». Клубы рисуются по порядку: следующий ложится поверх. Свет падает слева сверху;
// каждый клуб темнеет к низу и справа, его край на соседе — тёмная щель. Край кроны — зубчатый, как листва
// на картинке, поверх — пятна листьев: светлые на свету, тёмные в тени. holes — доля просветов у края (берёза).
function crown(cv, lobes, pal, { seed = 0, holes = 0, ink = INK, bias = 0 } = {}) {
  const { w, h } = cv, own = new Int16Array(w * h).fill(-1), lit = new Float32Array(w * h);
  lobes.forEach((l, k) => {
    for (let y = Math.floor(l.y - l.r - 2); y <= l.y + l.r + 2; y++) for (let x = Math.floor(l.x - l.r - 2); x <= l.x + l.r + 2; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const dx = x + 0.5 - l.x, dy = (y + 0.5 - l.y) / (l.sy || 1), a = Math.atan2(dy, dx);
      const bumps = Math.round(l.r * 0.9);                          // зубцы края: чем крупнее клуб, тем их больше
      const edge = l.r * (1 + 0.07 * Math.cos(a * bumps + k * 1.7 + seed)) - (hash(x, y, seed + k) < 0.25 ? 0.6 : 0);
      const d = Math.hypot(dx, dy);
      if (d > edge) continue;
      if (holes && d > edge - 2.2 && hash(x >> 1, y >> 1, seed + 9) < holes) continue;
      const i = y * w + x;
      own[i] = k;
      // свет: нормаль шара и общий спад к низу кроны
      const nx = dx / l.r, ny = dy / l.r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      lit[i] = (-0.55 * nx - 0.65 * ny + 0.5 * nz) * 0.8 + 0.25 - (l.shade || 0) + bias;
    }
  });
  const n = pal.length;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, k = own[i]; if (k < 0) continue;
    // щель между клубами: пиксель верхнего клуба, под которым (ниже или правее) уже другой, более ранний клуб
    const below = (xx, yy) => (xx >= 0 && yy >= 0 && xx < w && yy < h ? own[yy * w + xx] : -1);
    const seam = [below(x, y + 1), below(x + 1, y), below(x - 1, y)].some(o => o >= 0 && o < k) && lit[i] < 0.75;
    // листья: пятна 2×2 в шахматном порядке со сдвигом — свет и тень ложатся кучками, а не шумом
    const clump = hash((x + (y >> 1 & 1)) >> 1, y >> 1, seed + 1) - 0.5;
    let t = lit[i] + clump * 0.38;
    let c = Math.max(0, Math.min(n - 1, Math.floor(t * (n - 1) + 0.5)));
    if (seam) c = Math.max(0, Math.min(c, 1) - (hash(x, y, seed + 2) < 0.5 ? 1 : 0));
    // блик-листик: короткая светлая «галочка» на освещённой стороне
    if (lit[i] > 0.62 && hash(x, y, seed + 4) < 0.08) c = n - 1;
    cv.put(x, y, pal[c]);
  }
  // контур снаружи кроны
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (own[y * w + x] >= 0) continue;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < w && yy < h && own[yy * w + xx] >= 0; });
    if (nb) out.push([x, y]);
  }
  for (const [x, y] of out) cv.put(x, y, ink);
  return own;
}

// Ель: ярусы-юбки сверху вниз, каждый шире предыдущего, с пильчатым нижним краем. Нижние ярусы рисуются первыми,
// верхние ложатся на них и отбрасывают тень вдоль своего края.
function spruceBody(cv, cx, top, tiers, pal, seed) {
  const { w, h } = cv, own = new Int16Array(w * h).fill(-1), n = pal.length;
  for (let k = tiers.length - 1; k >= 0; k--) {
    const { y0, y1, half } = tiers[k], apex = k === 0 ? top : y0;
    for (let y = apex; y <= y1 + 2; y++) for (let x = Math.floor(cx - half - 2); x <= cx + half + 2; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const t = (y - apex) / Math.max(1, y1 - apex), hw = 1 + (half - 1) * Math.pow(t, 0.9);
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) > hw) continue;
      const saw = (Math.floor(Math.abs(dx) + seed + k * 2) % 4);                    // зубцы нижнего края
      if (y > y1 - (saw === 0 ? -2 : saw === 2 ? 0 : -1)) continue;
      own[y * w + x] = k;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, k = own[i]; if (k < 0) continue;
    const { half } = tiers[k], dx = (x + 0.5 - cx) / (half + 1);
    const under = y > 0 && own[i - w] >= 0 && own[i - w] < k;     // сразу под краем верхнего яруса — тень
    const under2 = y > 1 && own[i - 2 * w] >= 0 && own[i - 2 * w] < k;
    let t = 0.62 - dx * 0.55 + (hash(x >> 1, y, seed + 1) - 0.5) * 0.35 - k * 0.04;
    if (under) t = 0.02; else if (under2) t = Math.min(t, 0.25);
    const c = Math.max(0, Math.min(n - 1, Math.floor(t * (n - 1) + 0.5)));
    cv.put(x, y, pal[c]);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (own[y * w + x] >= 0) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < w && yy < h && own[yy * w + xx] >= 0; })) cv.put(x, y, INK);
  }
}

// Виды деревьев. size — [ширина, высота] спрайта, ax, ay — подножие ствола в нём.
const KINDS = {
  // Дуб: короткий толстый ствол, широкая крона из многих клубов.
  oak: {
    name: 'Дуб', size: [54, 62], ax: 27, ay: 60, foot: [6, 3],
    draw(cv, s) {
      trunk(cv, 27, 34, 60, 9, BARK.oak, { seed: s });
      branch(cv, 24, 42, 17, 34, BARK.oak[1]); branch(cv, 30, 41, 37, 33, BARK.oak[1]);
      crown(cv, [
        { x: 15, y: 30, r: 11, shade: 0.12 }, { x: 39, y: 29, r: 12, shade: 0.12 }, { x: 27, y: 17, r: 14 },
        { x: 14, y: 20, r: 10 }, { x: 40, y: 18, r: 10 }, { x: 26, y: 33, r: 12, shade: 0.15 },
        { x: 9, y: 37, r: 7, shade: 0.2 }, { x: 46, y: 37, r: 7, shade: 0.22 },
      ], LEAF.oak, { seed: s });
    },
  },
  // Ель: тёмная, узкая, ярусами; ствол виден только внизу.
  spruce: {
    name: 'Ель', size: [34, 60], ax: 17, ay: 58, foot: [3, 2],
    draw(cv, s) {
      trunk(cv, 17, 46, 58, 4, BARK.spruce, { seed: s });
      spruceBody(cv, 17, 2, [
        { y0: 2, y1: 12, half: 6 }, { y0: 8, y1: 21, half: 9 }, { y0: 16, y1: 31, half: 12 },
        { y0: 25, y1: 41, half: 14.5 }, { y0: 34, y1: 51, half: 16 },
      ], LEAF.spruce, s);
    },
  },
  // Берёза: тонкий белый ствол с чёрными чёрточками, светлая лёгкая крона с просветами.
  birch: {
    name: 'Берёза', size: [34, 62], ax: 17, ay: 60, foot: [3, 2],
    draw(cv, s) {
      trunk(cv, 17, 14, 60, 5, BARK.birch, { birch: true, seed: s, lean: 1 });
      branch(cv, 17, 30, 9, 22, BARK.birch[0]); branch(cv, 19, 26, 26, 18, BARK.birch[0]);
      crown(cv, [
        { x: 9, y: 24, r: 7, sy: 1.15, shade: 0.08 }, { x: 25, y: 22, r: 7.5, sy: 1.15, shade: 0.08 },
        { x: 17, y: 11, r: 9, sy: 1.1 }, { x: 11, y: 14, r: 6 }, { x: 23, y: 12, r: 6 },
        { x: 13, y: 34, r: 5, shade: 0.15 }, { x: 23, y: 33, r: 5.5, shade: 0.15 },
      ], LEAF.birch, { seed: s + 20, holes: 0.3, bias: 0.05 });
    },
  },
  // Яблоня: невысокая, круглая крона с красными яблоками.
  apple: {
    name: 'Яблоня', size: [40, 44], ax: 20, ay: 42, foot: [4, 2],
    draw(cv, s) {
      trunk(cv, 20, 24, 42, 6, BARK.apple, { seed: s, lean: -1 });
      branch(cv, 18, 30, 12, 24, BARK.apple[1]); branch(cv, 22, 29, 28, 23, BARK.apple[1]);
      crown(cv, [
        { x: 11, y: 22, r: 9, shade: 0.1 }, { x: 29, y: 21, r: 9.5, shade: 0.1 }, { x: 20, y: 13, r: 11.5 },
        { x: 20, y: 26, r: 8.5, shade: 0.14 },
      ], LEAF.apple, { seed: s + 40 });
      for (const [x, y] of [[9, 19], [17, 9], [26, 15], [31, 24], [14, 27], [23, 27], [6, 25], [33, 17]]) {
        cv.put(x, y, APPLE.body); cv.put(x + 1, y, APPLE.body); cv.put(x, y + 1, APPLE.body); cv.put(x + 1, y + 1, APPLE.dark); cv.put(x, y, APPLE.light);
      }
    },
  },
  // Сосна: высокий рыжий ствол, тёмные плоские шапки хвои наверху.
  pine: {
    name: 'Сосна', size: [40, 68], ax: 20, ay: 66, foot: [3, 2],
    draw(cv, s) {
      trunk(cv, 20, 14, 66, 6, BARK.pine, { seed: s, lean: 2 });
      branch(cv, 20, 27, 9, 21, BARK.pine[0]); branch(cv, 23, 21, 32, 15, BARK.pine[0]); branch(cv, 23, 37, 31, 32, BARK.pine[0]);
      crown(cv, [
        { x: 9, y: 21, r: 8, sy: 0.6, shade: 0.1 }, { x: 31, y: 15, r: 8, sy: 0.6, shade: 0.08 },
        { x: 20, y: 8, r: 10.5, sy: 0.62 }, { x: 13, y: 13, r: 8, sy: 0.6 }, { x: 29, y: 31, r: 7, sy: 0.6, shade: 0.12 },
        { x: 27, y: 7, r: 7, sy: 0.6 },
      ], LEAF.pine, { seed: s + 60 });
    },
  },
};

export const TREE_KINDS = Object.keys(KINDS);

// Спрайт вида: { kind, name, w, h, ax, ay, foot, buf } — buf в RGBA.
export function treeSprite(kind, seed = 0) {
  const k = KINDS[kind];
  if (!k) throw new Error(`Нет такого дерева: ${kind} (есть ${TREE_KINDS.join(', ')})`);
  const [w, h] = k.size, cv = canvas(w, h);
  k.draw(cv, seed);
  return { kind, name: k.name, w, h, ax: k.ax, ay: k.ay, foot: k.foot, buf: cv.buf };
}
