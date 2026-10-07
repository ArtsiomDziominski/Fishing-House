// Дорисовывает карту по бокам от картинки-образца: слева лес, справа луг с дорогой. С полем (field в world-shapes.mjs)
// вместо леса всюду трава — и по бокам, и на картинке выше поляны, и в полосе над картинкой.
// Река идёт через всю карту; ниже неё с полем — вода до нижнего края, с лесом — кусты. Вправо от поляны уходит дорога с
// плоскими камнями. План боков (берега, дорога, границы луга) — sides в world-shapes.mjs.
// Тем же способом зарастает место дома, когда он убран с карты: поляна и опушка за ней (план — glade там же).
//
// Листва не выдумывается: каждая крона и каждый куст собраны из кругов, снятых с настоящих крон и кустов картинки,
// под новым зубчатым контуром. Так бока получаются той же руки, что и середина. Деревья при этом разные:
// у каждого своя форма кроны (от одного круга до пяти под общим контуром), своя ширина и своя порода — оттенок листа.
// Стоят они на стволах, рядами, и на стыке с картинкой заходят на неё целыми кронами: по её краю ничего не обрезается.
// Вода, трава, дорога и стволы рисуются цветами картинки. Всё случайное идёт от одного зерна: сборка каждый раз
// даёт одну и ту же карту.

const hex = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];

function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const isWater = c => c[2] > c[0] + 45 && c[2] > c[1] + 8;

// Ломаная из плана [[x, y], …] → высота в точке x: между точками — плавно, за краями — как в крайней точке.
export const curveOf = pts => x => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], t = (x - x0) / (x1 - x0);
    return y0 + (y1 - y0) * t * t * (3 - 2 * t);
  }
  return pts[pts.length - 1][1];
};

// Круги листвы на картинке: x, y — середина, r — сколько вокруг неё чистой листвы.
const LEAVES = {
  crown: [{ x: 40, y: 37, r: 19 }, { x: 222, y: 52, r: 16 }],      // светлые кроны
  small: [{ x: 62, y: 56, r: 10 }],                                // малая светлая крона — нижний ярус большой
  olive: [{ x: 17, y: 74, r: 16 }],                                // жёлто-зелёная крона у левого края
  far: [{ x: 192, y: 24, r: 17 }, { x: 84, y: 22, r: 10 }, { x: 12, y: 10, r: 9 }],   // дальние, тёмные
  bush: [{ x: 24, y: 298, r: 13 }, { x: 215, y: 300, r: 15 }, { x: 226, y: 205, r: 10 }, { x: 12, y: 168, r: 11 }],   // кусты у воды и у опушки
  leafy: [{ x: 229, y: 127, r: 11 }],                              // куст с крупными листьями у забора
};

const C = {
  outline: hex('0e1c19'),                                          // контур листвы
  deep: ['17332e', '162a2a', '18322e', '19382b'].map(hex),         // тьма между кронами
  water: hex('4384a5'), waterDeep: hex('2f5881'), waterShade: hex('2d527c'), wave: hex('8ed0ef'), waveSoft: hex('6aa1bf'),
  grass: ['7a9632', '79952f', '7b9431', '7b952f'].map(hex), grassShade: ['3f6931', '40692f', '3e6932'].map(hex), grassEdge: hex('2a542a'),
  tuft: ['3d5e0d', '496a14'].map(hex), tuftLight: hex('8fae45'), petal: hex('fcf4b1'), heart: hex('e2bc4f'),
  trunk: hex('6c3725'), trunkLight: hex('783e27'), trunkDark: hex('48201a'), trunkEdge: hex('0a0303'),
};

// pic — картинка pw×h (RGB), уже без рыбака, ведра, рюкзака и дыма. plan — sides из world-shapes.mjs.
// Возвращает { w, buf, hedge }: карту шириной plan.left + pw + plan.right (RGB) и маску листвы изгороди над рекой —
// герой, зайдя в неё, должен скрываться за листьями. Координаты плана — как у картинки: левее неё x < 0, правее — x >= pw.
// glade — { hole, plan }, если дом убран: hole — пиксели картинки, откуда он вырезан, plan — glade из world-shapes.mjs.
// field — field из world-shapes.mjs, если вместо леса поле. Тогда в ответе есть и field: маска травы поля.
// Над картинкой карта выше на plan.top строк: там y < 0.
export function widen(pic, pw, h, plan, glade = null, field = null) {
  const S = plan.left, T = plan.top || 0, W = S + pw + plan.right, MH = T + h, out = Buffer.alloc(W * MH * 3);   // S, T — на сколько картинка сдвинута вправо и вниз
  const X0 = -S, X1 = pw + plan.right, Y0 = -T;                    // края карты в координатах картинки
  let seed = 0x5eed1e;                                             // mulberry32
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const range = (a, b) => a + rnd() * (b - a), pick = a => a[Math.floor(rnd() * a.length)];
  const noise = (x, y, s = 0) => { let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  // плавный шум: значения в узлах сетки, между ними — мягкий переход
  const soft = (x, y, sx, sy, s = 0) => {
    const gx = x / sx, gy = y / sy, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, kx = fx * fx * (3 - 2 * fx), ky = fy * fy * (3 - 2 * fy);
    const a = noise(ix, iy, s), b = noise(ix + 1, iy, s), c = noise(ix, iy + 1, s), d = noise(ix + 1, iy + 1, s);
    return a + (b - a) * kx + (c - a) * ky + (a - b - c + d) * kx * ky;
  };

  const onMap = (x, y) => x >= X0 && x < X1 && y >= Y0 && y < h;
  const onPic = (x, y) => x >= 0 && x < pw && y >= 0;
  const at = (x, y) => (y + T) * W + x + S;                       // точка в координатах картинки → номер пикселя карты
  const src = (x, y) => { const i = (y * pw + x) * 3; return [pic[i], pic[i + 1], pic[i + 2]]; };
  const water = new Uint8Array(W * MH);                            // где на боках вода — чтобы положить на неё тени
  const hedge = new Uint8Array(W * MH);                            // листва изгороди над рекой
  const sward = new Uint8Array(W * MH);                            // трава поля: по ней можно ходить
  // over — на сколько пикселей разрешено заходить на саму картинку (так листва закрывает шов); mark — это лист изгороди,
  // turf — трава поля
  let open = null;                                                 // где ещё картинку можно перерисовывать: пока дорисовывается поляна
  const put = (x, y, c, over = 0, mark = false, turf = false) => {
    if (!onMap(x, y) || (onPic(x, y) && !(x < over || x >= pw - over) && !(open && open(x, y)))) return;
    const i = at(x, y); out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; water[i] = 0; hedge[i] = mark ? 1 : 0; sward[i] = turf ? 1 : 0;
  };
  const grassAt = (x, y) => C.grass[Math.floor(soft(x, y, 5, 3, 9) * 3.99)];

  const riverTop = { left: curveOf(plan.river.left.top), right: curveOf(plan.river.right.top) };
  const riverBottom = { left: curveOf(plan.river.left.bottom), right: curveOf(plan.river.right.bottom) };
  const meadowTop = curveOf(plan.meadow.top), meadowBottom = curveOf(plan.meadow.bottom);
  const roadY = curveOf(plan.road.map(p => [p[0], p[1]])), roadHalf = curveOf(plan.road.map(p => [p[0], p[2]]));

  // ---------- картинка в середине, по бокам тьма леса или трава поля ----------
  for (let y = Y0; y < h; y++) for (let x = X0; x < X1; x++) {
    const i = at(x, y), c = onPic(x, y) ? src(x, y) : field ? grassAt(x, y) : C.deep[Math.floor(noise(x >> 2, y >> 1, 3) * C.deep.length)];
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; if (field && !onPic(x, y)) sward[i] = 1;
  }

  // ---------- листва ----------
  // Породы: тот же лист с картинки в другом оттенке — так в лесу стоят разные деревья.
  const BREEDS = {
    plain: null,
    lime: c => [c[0] * 1.14 + 6, c[1] * 1.07 + 4, c[2] * 0.78],          // молодая, жёлто-зелёная
    teal: c => [c[0] * 0.82, c[1] * 0.97, c[2] * 1.2 + 6],               // сизая
    moss: c => [c[0] * 0.92, c[1] * 0.86, c[2] * 0.8],                   // тёмная, приглушённая
  };
  // Формы кроны: [dx, dy, доля радиуса] кругов листвы от дальнего к ближнему. Чем больше кругов, тем шире дерево.
  const CROWNS = {
    single: [[0, 0, 1]],
    pair: [[0, 0, 1], [11, 12, 0.6]],
    wide: [[0, -7, 1], [-12, 3, 0.92], [12, 4, 0.92]],
    big: [[0, -13, 1], [-16, -3, 0.95], [16, -2, 0.95], [-8, 9, 0.9], [9, 10, 0.9]],
  };
  const HALF = { single: 17, pair: 20, wide: 29, big: 33 };         // примерная полуширина кроны каждой формы
  const chance = table => { let r = rnd(); for (const [v, p] of table) { if (r < p) return v; r -= p; } return table[0][0]; };
  const clampX = x => Math.max(0, Math.min(pw - 1, x)), clampY = y => Math.max(0, Math.min(h - 1, y));

  // Крона: круги листвы, снятые с картинки, под одним общим зубчатым контуром — как большие кроны на ней.
  // parts — [{ x, y, from, r }] от дальнего круга к ближнему. dark — насколько затемнить (дальние ряды), breed — порода.
  function crown(parts, { dark = 0, breed = 'plain', over = 0, mark = false } = {}) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) {
      p.x = Math.round(p.x); p.y = Math.round(p.y); p.r = Math.min(p.r, p.from.r);
      x0 = Math.min(x0, p.x - p.r - 5); x1 = Math.max(x1, p.x + p.r + 5); y0 = Math.min(y0, p.y - p.r - 5); y1 = Math.max(y1, p.y + p.r + 5);
    }
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
    const w = x1 - x0 + 1, owner = new Int8Array(w * (y1 - y0 + 1)).fill(-1);   // какой круг виден в точке
    parts.forEach((p, n) => {
      const teeth = Math.max(7, Math.round(2 * Math.PI * p.r / 6.5)), phase = rnd() * teeth, wob = rnd() * 6.283, tip = range(1.8, 2.6);
      p.id = Math.floor(rnd() * 1e6); p.phase = phase;
      const R = Math.ceil(p.r + 4);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const a = Math.atan2(dy, dx), u = ((a / 6.283 * teeth + phase) % teeth + teeth) % teeth, k = Math.floor(u), f = u - k;
        const leaf = (1 - Math.abs(2 * f - 1)) * (0.45 + 0.9 * noise(k, p.id, 5));   // зубцы-листья по краю, каждый своей длины
        if (Math.hypot(dx, dy) <= p.r - 2 + tip * leaf + 1.1 * Math.sin(a * 3 + wob)) owner[(p.y + dy - y0) * w + p.x + dx - x0] = n;
      }
    });
    const own = (x, y) => (x < x0 || y < y0 || x > x1 || y > y1 ? -1 : owner[(y - y0) * w + x - x0]);
    const tint = BREEDS[breed];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const n = own(x, y); if (n < 0) continue;
      const p = parts[n];
      let c = C.outline;
      if (own(x - 1, y) >= 0 && own(x + 1, y) >= 0 && own(x, y - 1) >= 0 && own(x, y + 1) >= 0) {   // не край кроны
        c = src(clampX(p.from.x + x - p.x), clampY(p.from.y + y - p.y));
        // стык кругов внутри кроны: ближний ярус листвы местами обведён, местами просто в тени — как на картинке
        let shade = dark + (parts.length - 1 - n) * 0.07;
        const up = own(x, y - 1), left = own(x - 1, y), right = own(x + 1, y);
        if ((up >= 0 && up < n) || (left >= 0 && left < n) || (right >= 0 && right < n)) {
          if (noise(Math.floor((Math.atan2(y - p.y, x - p.x) / 6.283 + 0.5) * 11 + p.phase), p.id, 6) < 0.6) c = C.outline; else shade += 0.45;
        }
        if (c !== C.outline) {
          if (tint) c = tint(c);
          c = [c[0] * (1 - 0.42 * shade), c[1] * (1 - 0.3 * shade), c[2] * (1 - 0.18 * shade)].map(v => Math.max(0, Math.min(255, Math.round(v))));   // в тени темнее и синее
        }
      }
      put(x, y, c, over, mark);
    }
  }
  // Одиночный круг листвы: куст.
  const lobe = (cx, cy, from, { r = from.r, ...opts } = {}) => crown([{ x: cx, y: cy, from, r }], opts);

  // Дерево: порода, форма и ширина кроны у каждого свои. near — насколько оно близко к опушке, 0..1: вдали темнее.
  function tree(cx, cy, near, { kind, shape, dark, over = 0 } = {}) {
    if (dark === undefined) dark = Math.min(0.85, (near > 0.75 ? range(0, 0.12) : near > 0.45 ? range(0.15, 0.4) : range(0.4, 0.7)) + Math.max(0, 0.45 - cy / 110));   // у верхнего края карты лес уходит в тень, как на картинке
    kind = kind || (near > 0.45 ? chance([['crown', 0.6], ['olive', 0.22], ['far', 0.18]]) : chance([['far', 0.5], ['crown', 0.32], ['olive', 0.18]]));
    shape = shape || chance([['big', 0.28], ['wide', 0.32], ['pair', 0.22], ['single', 0.18]]);
    const breed = kind === 'olive' ? chance([['plain', 0.7], ['lime', 0.3]]) : chance([['plain', 0.46], ['lime', 0.18], ['teal', 0.18], ['moss', 0.18]]);
    const roomy = LEAVES[kind].filter(s => s.r >= 15), flip = rnd() < 0.5 ? -1 : 1, size = roomy[0].r - range(0, 2);
    const parts = CROWNS[shape].map(([dx, dy, k], n) => {
      const from = shape === 'pair' && n === 1 && kind === 'crown' ? LEAVES.small[0] : pick(roomy);
      return { x: cx + flip * dx + range(-1.5, 1.5), y: cy + dy + range(-1.5, 1.5), from, r: size * k - range(0, 1.5) };
    });
    crown(parts, { dark, breed, over });
  }
  // Лес: деревья на стволах, рядами от линии front(x) вверх до края карты. Ряды стоят вразбежку, поэтому ствол дальнего
  // дерева виден в просвете между кронами ближних, а не тонет в сплошной листве; между стволами — тёмный подлесок,
  // за ними — дальний план из сплошных тёмных крон. Чем дальше ряд, тем он темнее.
  // first — с какого ряда начинать: нулевой, у самой линии, на лугу ставит опушка.
  // seam — шов с картинкой: { at, dir, limit } — столбец её края, в какую сторону от него лес (-1 — слева) и до какой
  // строки лесу можно на неё заходить. У шва ничего не обрезается по краю картинки: крона ложится на неё целиком, как
  // легла бы на соседнее дерево, — иначе стык читается как обрезанный рисунок. Дерево, которое задело бы картинку ниже
  // limit, не ставится вовсе: там шов закрывают заросли (seams.thicket в плане).
  const ROW = 30, STEP = 50;                                       // шаг рядов и шаг деревьев в ряду
  const REACH = 40;                                                // на сколько пикселей картинки лес может зайти у шва
  const DROP = { big: 46, wide: 40, pair: 37, single: 33 };        // на сколько середина кроны выше подножия ствола
  function forest(x0, x1, front, seam, first = 0) {
    // half — полуширина того, что ставим, bottom — его нижний край, gap — на сколько середина должна отстоять от картинки
    const fits = (x, bottom, half, gap) => { const away = (x - seam.at) * seam.dir; return away >= half + 2 || (away >= gap && bottom <= seam.limit); };
    const far = cy => ({ dark: range(0.34, 0.56) + Math.max(0, 0.3 - cy / 160) });
    open = x => (seam.dir < 0 ? x < REACH : x >= pw - REACH);
    for (let row = 0, y = -10; y < h; row++, y += 17) {             // дальний план: глубина леса, на её фоне стоят деревья
      for (let x = x0 - 14 + (row % 2) * 16 + range(-5, 5); x < x1 + 18; x += range(27, 38)) {
        const cy = y + range(-5, 5);
        if (cy <= front(x) - 26 && fits(x, cy + 28, REACH, 2)) tree(x, cy, 0.3, far(cy));
      }
      const cy = y + range(-5, 5), x = seam.at + seam.dir * range(4, 12);   // у самого шва — в каждом ряду: край картинки нигде не остаётся голым
      if (cy <= front(x) - 26 && cy + 28 <= seam.limit) tree(x, cy, 0.3, far(cy));
    }
    for (let j = Math.ceil((Math.max(front(x0), front(x1)) + 20) / ROW); j >= first; j--) {   // от дальнего ряда к ближнему
      const spots = [];
      for (let x = x0 - 24 + (j % 2) * STEP / 2 + range(-5, 5); x < x1 + 30; x += STEP + range(-7, 7)) {
        const lim = front(x), base = lim - j * ROW + range(-4, 4), near = 1 - (lim - base) / Math.max(60, lim);
        const shape = chance([['big', 0.22], ['wide', 0.38], ['pair', 0.24], ['single', 0.16]]);
        if (base < 2 || !fits(x, base, HALF[shape] + 6, 14)) continue;
        spots.push({ x, base, near, shade: near > 0.75 ? 0.05 : near > 0.45 ? 0.3 : 0.55, shape });
      }
      for (let x = x0 - 6 + range(0, 8); x < x1 + 8; x += range(11, 16)) {   // подлесок вдоль ряда: в просветах между кронами — листва, а не пустая тьма
        const lim = front(x), base = lim - j * ROW, near = 1 - (lim - base) / Math.max(60, lim);
        if (base >= 2 && fits(x, base + 6, 13, 2)) lobe(x, base - range(4, 9), pick(LEAVES.bush), { r: range(7, 10), dark: (near > 0.75 ? 0.05 : near > 0.45 ? 0.3 : 0.55) + 0.2 });
      }
      for (const t of spots) trunk(t.x, t.base - DROP[t.shape] + 6, t.base, t.shape === 'big' ? pick([9, 10]) : t.shape === 'wide' ? pick([8, 9]) : 7, t.shade);
      for (const t of spots) for (const side of [-1, 1]) {          // подлесок у подножия: ствол выходит из кустов, а не из пустоты
        const from = pick(LEAVES.bush);
        lobe(t.x + side * range(8, 13), t.base - range(3, 7), from, { r: range(6, 9), dark: t.shade + 0.15 });
      }
      for (const t of spots) tree(t.x + range(-2, 2), t.base - DROP[t.shape] + range(-3, 3), t.near, { shape: t.shape });
    }
    open = null;
  }
  // Кусты: несколько рядов листвы между линиями top(x) и bottom(x) — живая изгородь, заросший берег.
  function bushes(x0, x1, top, bottom, { kinds = ['bush'], step = [13, 19], mark = false } = {}) {
    for (let x = x0; x < x1; x++) for (let y = Math.round(top(x)) + 3; y < Math.min(h, bottom(x)); y++) put(x, y, C.deep[Math.floor(noise(x >> 2, y >> 1, 3) * C.deep.length)]);
    for (let row = 0; row < 40; row++) {
      let any = false;
      for (let x = x0 - 6 + (row % 2) * 8 + range(-3, 3); x < x1 + 8; x += range(step[0], step[1])) {
        const y = top(x) + 7 + row * 12 + range(-2.5, 2.5);
        if (y - 6 > bottom(x)) continue;
        any = true;
        const from = pick(LEAVES[pick(kinds)]);
        lobe(x, y, from, { r: from.r - range(0, 3), mark });
      }
      if (!any) break;
    }
  }

  // ---------- вода ----------
  // Полоса реки между берегами top(x) и bottom(x), с запасом: края потом закроет листва.
  function river(x0, x1, top, bottom) {
    for (let x = x0; x < x1; x++) {
      const t = top(x), b = bottom(x), deep = Math.max(0, Math.min(12, (b - t - 16) * 0.55));   // чем шире река, тем шире тёмная вода у нижнего берега
      for (let y = Math.floor(t) - 12; y <= b + 10; y++) {
        const edge = b - deep + (2.2 * Math.sin(x / 9) + 2.5 * (soft(x, y, 14, 5, 21) - 0.5)) * Math.min(1, deep / 4);
        put(x, y, deep > 0.5 && y >= edge ? C.waterDeep : C.water);
        if (onMap(x, y) && !onPic(x, y)) water[at(x, y)] = 1;
      }
    }
    // блики-штрихи: короткая светлая черта с хвостиком, как на картинке
    for (let n = Math.round((x1 - x0) * 0.2); n > 0; n--) {
      const x = Math.round(range(x0, x1 - 8)), y = Math.round(range(top(x) + 7, bottom(x) - 3)), len = Math.round(range(3, 8)), c = rnd() < 0.6 ? C.wave : C.waveSoft;
      for (let i = 0; i < len; i++) if (water[at(x + i, y)]) put(x + i, y, c), water[at(x + i, y)] = 1;
      if (rnd() < 0.6 && water[at(x - 1, y - 1)]) { put(x - 1, y - 1, c); water[at(x - 1, y - 1)] = 1; }
    }
  }
  // Тень на воде под нависшей листвой и камнями: несколько тёмных строк сразу под берегом.
  function shadeWater(x0, x1) {
    for (let x = x0; x < x1; x++) for (let y = 1; y < MH; y++) {     // y здесь — строка карты
      const i = y * W + x + S;
      if (!water[i] || water[i - W]) continue;
      for (let k = 0; k < 4 && y + k < h && water[i + k * W]; k++) { const o = (i + k * W) * 3; out[o] = C.waterShade[0]; out[o + 1] = C.waterShade[1]; out[o + 2] = C.waterShade[2]; }
    }
  }

  // ---------- луг и дорога ----------
  function meadow(x0, x1) {
    for (let x = x0; x < x1; x++) {
      const t = Math.round(meadowTop(x)), shade = t + 7 + 2.5 * Math.sin(x / 7) + 3 * (soft(x, 0, 9, 1, 31) - 0.5);
      for (let y = t - 8; y <= meadowBottom(x) + 12; y++) put(x, y, y < shade ? C.grassShade[Math.floor(noise(x >> 1, y, 8) * 3)] : C.grass[Math.floor(soft(x, y, 5, 3, 9) * 3.99)]);
    }
    for (let n = Math.round((x1 - x0) * 0.55); n > 0; n--) {       // пучки травы, изредка цветы
      const x = Math.round(range(x0 + 2, x1 - 3)), y = Math.round(range(meadowTop(x) + 10, meadowBottom(x) - 2)), kind = rnd();
      if (kind < 0.6) { const c = pick(C.tuft); put(x, y, c); put(x - 1, y - 1, c); put(x + 1, y - 1, c); if (rnd() < 0.5) put(x, y - 2, c); }
      else if (kind < 0.85) { put(x, y, C.tuftLight); put(x + 1, y - 1, C.tuftLight); }
      else { put(x, y, C.heart); put(x - 1, y, C.petal); put(x + 1, y, C.petal); put(x, y - 1, C.petal); put(x, y + 1, C.petal); put(x, y + 2, C.tuft[0]); }
    }
  }
  // Дорога — земля, как на тропинке у причала, с плоскими камнями, вросшими в неё. Над верхней кромкой — тень травы, первая
  // строка земли темнее; под нижней — тёмный край. Камень — серо-бежевая плитка со скруглённым верхом, тень от него ложится
  // вправо и вниз, как у камней тропинки. С полем по дороге можно ходить; trail — её пиксели: пучки травы на ней не растут.
  // Слева дорога вливается в тропинку картинки: землю и камни тропинки она не трогает.
  const ROAD = {
    dirt: ['b2743e', 'b17541', 'af733e', 'b3753f', 'b07440'].map(hex), dark: hex('a5643a'), shade: hex('8b5a32'), crack: hex('8c5129'),
    lip: hex('3e562e'), rim: hex('4b5219'),
    stoneTop: ['b09072', 'ae9574'].map(hex), stone: ['b39c7f', 'b5a085', 'b0987b'].map(hex), stoneShade: hex('765342'), stoneSide: hex('7b5331'),
  };
  const trail = new Uint8Array(W * MH);
  function road(x0, x1) {
    const earth = (x, y) => { if (!onMap(x, y) || trail[at(x, y)]) return false; const i = at(x, y) * 3; return out[i] > out[i + 1] + 15 && out[i] < 200; };   // без жёлтых цветов
    const pave = (x, y, c) => { if (earth(x, y)) return; put(x, y, c, 0, false, !!field); if (onMap(x, y)) trail[at(x, y)] = 1; };
    const edges = x => {
      const yc = roadY(x), hw = roadHalf(x);
      return [Math.round(yc - hw + 1.6 * (soft(x, 0, 6, 1, 41) - 0.5) * 2), Math.round(yc + hw + 1.6 * (soft(x, 0, 7, 1, 42) - 0.5) * 2)];
    };
    for (let x = x0; x < x1; x++) {
      const [top, bottom] = edges(x);
      pave(x, top - 1, ROAD.lip);
      for (let y = top; y <= bottom; y++) {
        let c = ROAD.dirt[Math.floor(soft(x, y, 4, 2, 45) * 4.99)];
        if (soft(x, y, 7, 3, 43) < 0.16) c = ROAD.dark;
        if (noise(x, y, 44) < 0.025) c = ROAD.crack;
        if (y === top) c = ROAD.shade; else if (y === bottom) c = ROAD.dark;
        pave(x, y, c);
      }
      pave(x, bottom + 1, ROAD.rim);
    }
    // камни вразбежку: то ближе к верхней кромке, то к нижней, не вплотную друг к другу
    const keep = seed; seed = 0x570e5;                              // у камней своё зерно: остальная карта от них не зависит
    const taken = [];
    for (let x = Math.round(x0 + range(2, 5)), up = rnd() < 0.5; x < x1 - 10; x += Math.round(range(6, 11)), up = !up) {
      const w = Math.round(range(5, 9)), hgt = rnd() < 0.25 ? 4 : 3, [t0, b0] = edges(x), [t1, b1] = edges(x + w + 1);
      const top = Math.max(t0, t1) + 2, room = Math.min(b0, b1) - 1 - hgt - top;
      if (room < 0) continue;
      const y = top + Math.round(up ? range(0, room * 0.45) : range(room * 0.55, room));
      if (taken.some(([tx, ty, tw, th]) => x <= tx + tw + 2 && tx <= x + w + 2 && y <= ty + th + 1 && ty <= y + hgt + 1)) continue;
      if (Array.from({ length: (w + 1) * hgt }, (_, k) => earth(x + k % (w + 1), y + Math.floor(k / (w + 1)))).some(Boolean)) continue;   // не на тропинке
      taken.push([x, y, w, hgt]);
      for (let r = 0; r < hgt - 1; r++) for (let i = 0; i < w; i++) {   // сама плитка; верхние углы срезаны
        if (r === 0 && (i === 0 || i === w - 1) && hgt > 2) continue;
        pave(x + i, y + r, r === 0 && hgt > 2 ? pick(ROAD.stoneTop) : pick(ROAD.stone));
      }
      for (let r = hgt > 2 ? 1 : 0; r < hgt - 1; r++) pave(x + w, y + r, ROAD.stoneSide);   // тень справа
      for (let i = 1; i <= w; i++) pave(x + i, y + hgt - 1, ROAD.stoneShade);               // и снизу
    }
    seed = keep;
  }
  // Ствол дерева: от кроны до земли, внизу чуть шире. dark — насколько он в тени (дальние ряды леса).
  function trunk(cx, top, base, w, dark = 0) {
    cx = Math.round(cx); base = Math.round(base);
    const tone = c => (dark ? c.map(v => Math.round(v * (1 - 0.5 * dark))) : c);
    for (let y = Math.round(top); y <= base; y++) {
      const half = Math.floor(w / 2) + (base - y < 3 ? 1 : 0);
      for (let dx = -half; dx <= half; dx++) {
        const side = dx === -half || dx === half, stripe = noise(cx + dx, (y / 5) | 0, 51);
        put(cx + dx, y, tone(side || y === base ? C.trunkEdge : dx === -half + 1 ? C.trunkLight : dx >= half - 2 || stripe < 0.25 ? C.trunkDark : C.trunk));
      }
    }
  }
  // Опушка: деревья на стволах над лугом и кусты между ними. Кроны разной ширины, поэтому и стоят они неровно.
  function edge(x0, x1) {
    const spots = [];
    for (let x = x0 + range(42, 50); x < x1 - 6; x += range(34, 50)) spots.push({ x, shape: chance([['big', 0.35], ['wide', 0.4], ['pair', 0.25]]), base: meadowTop(x) + range(0, 3) });
    for (const t of spots) trunk(t.x, t.base - 34, t.base, t.shape === 'pair' ? 7 : pick([8, 9, 10]));
    for (let x = x0 + 14; x < x1 + 6; x += range(11, 17)) {        // кусты у подножия — стволы видны между ними; у шва их заменяют заросли
      const from = pick(LEAVES[rnd() < 0.3 ? 'leafy' : 'bush']);
      lobe(x, meadowTop(x) - range(5, 9), from, { r: range(8, 11) });
    }
    for (const t of spots) tree(t.x + range(-2, 2), t.base - (t.shape === 'big' ? 46 : t.shape === 'wide' ? 40 : 37) + range(-3, 3), 1, { shape: t.shape, kind: rnd() < 0.25 ? 'olive' : 'crown' });
  }

  // ---------- поляна на месте дома ----------
  // Ниже линии опушки вырезанное место становится травой, выше — лесом: тьма, по ней кроны второго ряда, стволы,
  // кусты у подножия и кроны самой опушки. Листве можно ложиться и на соседние кроны картинки: обрежь её по силуэту
  // дома — от него остался бы след.
  function clearing({ hole, plan: g }) {
    const line = curveOf(g.edge), ground = [], corner = curveOf(g.shade), cornerEnd = g.shade[g.shade.length - 1][0];
    open = (x, y) => hole[y * pw + x] === 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < pw; x++) {
      if (!hole[y * pw + x]) continue;
      let shade = line(x) + 6 + 2.5 * Math.sin(x / 7) + 3 * (soft(x, 0, 9, 1, 61) - 0.5);   // под опушкой трава в тени, как на лугу
      if (x < cornerEnd) shade = Math.max(shade, corner(x) + 3 * (soft(x, y, 4, 3, 62) - 0.5));   // в углу тень глубже — как на траве картинки рядом
      const top = line(x);
      if (y < top - 1) put(x, y, C.deep[Math.floor(noise(x >> 2, y >> 1, 3) * C.deep.length)]);
      else { put(x, y, y < shade ? C.grassShade[Math.floor(noise(x >> 1, y, 8) * 3)] : C.grass[Math.floor(soft(x, y, 5, 3, 9) * 3.99)]); if (y > shade + 3) ground.push([x, y]); }
    }
    for (let n = Math.round(ground.length / 150); n > 0; n--) {      // пучки травы, изредка цветы — как на лугу
      const [x, y] = pick(ground), kind = rnd();
      if (kind < 0.6) { const c = pick(C.tuft); put(x, y, c); put(x - 1, y - 1, c); put(x + 1, y - 1, c); if (rnd() < 0.5) put(x, y - 2, c); }
      else if (kind < 0.88) { put(x, y, C.tuftLight); put(x + 1, y - 1, C.tuftLight); }
      else { put(x, y, C.heart); put(x - 1, y, C.petal); put(x + 1, y, C.petal); put(x, y - 1, C.petal); put(x, y + 1, C.petal); put(x, y + 2, C.tuft[0]); }
    }
    open = null;
    if (field) return;                                             // выше опушки будет поле — лес не нужен
    open = (x, y) => x >= g.span[0] && x <= g.span[1] && y < line(x) + 9;   // лес: всё, что выше опушки, с запасом на кусты у подножия
    for (const [x, y, shape, kind, dark] of g.back) tree(x, y, 0.6, { shape, kind, dark });
    const spots = g.trees.map(([x, shape, kind]) => ({ x, shape, kind, base: line(x) + range(0, 2) }));
    for (const t of spots) trunk(t.x, t.base - 36, t.base, t.shape === 'pair' ? 7 : pick([8, 9, 10]));
    for (let x = g.span[0] + range(2, 6); x < g.span[1]; x += range(11, 16)) {
      const from = pick(LEAVES[rnd() < 0.3 ? 'leafy' : 'bush']);
      lobe(x, line(x) - range(5, 9), from, { r: range(8, 11) });
    }
    for (const t of spots) tree(t.x + range(-2, 2), t.base - (t.shape === 'big' ? 46 : t.shape === 'wide' ? 40 : 37) + range(-3, 3), 1, { shape: t.shape, kind: t.kind });
    open = null;
  }
  if (glade) { const keep = seed; seed = 0x91ade5; clearing(glade); seed = keep; }   // у поляны своё зерно: бока от неё не зависят

  // ---------- поле на картинке: всё выше границы field.edge ----------
  // Граница чуть волнится, чтобы стык с травой картинки не читался прямой линией.
  if (field) {
    const edge = curveOf(field.edge);
    open = (x, y) => y < edge(x) + 2.5 * (soft(x, 0, 6, 1, 71) - 0.5);
    for (let y = 0; y < h; y++) for (let x = 0; x < pw; x++) if (open(x, y)) put(x, y, grassAt(x, y), 0, false, true);
    open = null;
    // кусты: зелёное внутри field.bushes становится травой; вода, камни и всё деревянное остаются
    const inBush = (x, y) => (field.bushes || []).some(p => inPoly(p, x + 0.5, y + 0.5));
    const pix = (x, y) => { const i = at(x, y) * 3; return [out[i], out[i + 1], out[i + 2]]; };
    const leafy = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < pw; x++) {
      if (!inBush(x, y)) continue;
      const c = pix(x, y);
      if (c[1] >= c[0] && !isWater(c)) leafy.push([x, y]);
    }
    open = () => true;
    for (const [x, y] of leafy) put(x, y, grassAt(x, y), 0, false, true);
    // край воды, где были кусты, — зубцами листьев: заливы в траву зарастают, мысы травы в воде смываются
    const near4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let pass = 0; pass < 2; pass++) {
      const turf = [], wash = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < pw - 1; x++) {
        if (!inBush(x, y)) continue;
        const i = at(x, y), c = pix(x, y);
        const grassN = near4.filter(([dx, dy]) => sward[at(x + dx, y + dy)]).length;
        const waterN = near4.filter(([dx, dy]) => isWater(pix(x + dx, y + dy)));
        if (!sward[i] && isWater(c) && grassN >= 3) turf.push([x, y]);
        else if (sward[i] && waterN.length >= 3) wash.push([x, y, pix(x + waterN[0][0], y + waterN[0][1])]);
      }
      for (const [x, y] of turf) put(x, y, grassAt(x, y), 0, false, true);
      for (const [x, y, c] of wash) put(x, y, c);
    }
    open = null;
    // цветы и мелочь, что росли в кустах, остались своего цвета — но по ним, как по траве вокруг, можно ходить
    for (let pass = 0; pass < 3; pass++) {                          // последним проходом — и серединки цветов в два пикселя
      const add = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < pw - 1; x++) {
        const i = at(x, y);
        if (sward[i] || !inBush(x, y) || isWater(pix(x, y))) continue;
        if (near4.filter(([dx, dy]) => sward[at(x + dx, y + dy)]).length >= (pass < 2 ? 3 : 2)) add.push(i);
      }
      for (const i of add) sward[i] = 1;
    }
  }
  // Берег над рекой на боках: трава, светлая кромка, тёмный контур и земляной обрыв к воде — цвета берега поляны.
  const BANK = { lip: ['98b434', '9ab338'].map(hex), outline: hex('110d00'), wall: ['7a4c38', '844632', '81401e', 'a46439', 'a26336', '8c4b2b', '5e2d20'].map(hex) };
  function highBank(x0, x1, top) {
    const n = BANK.wall.length;
    for (let x = x0; x < x1; x++) {
      const t = Math.round(top(x) + 1.5 * (soft(x, 0, 7, 1, 91) - 0.5));
      for (let y = Math.floor(top(x)) - 14; y < t - n - 3; y++) put(x, y, grassAt(x, y), 0, false, true);   // река легла с запасом — под ним трава
      for (let k = -3; k < n; k++) {
        let c = k < -1 ? BANK.lip[k + 3] : k === -1 ? BANK.outline : BANK.wall[k];
        if (k >= 0 && k < n - 2 && noise(x, k, 92) < 0.18) c = BANK.wall[k + 1];   // обрыв неровный
        put(x, t - n + k, c);
      }
    }
  }
  // Камень, срезанный краем картинки: недостающий бок — зеркально от края, по эллипсу, с тёмным контуром.
  function mendStone({ at: ex, dir, rows: [y0, y1], width }) {
    const pix = (x, y) => { const i = at(x, y) * 3; return [out[i], out[i + 1], out[i + 2]]; };
    const stone = c => !(c[1] > c[0] + 4) && !isWater(c);           // не трава и не вода
    let a = -1, b = -1;
    for (let y = y0; y <= y1; y++) if (stone(pix(ex, y))) { if (a < 0) a = y; b = y; }
    if (a < 0) return;
    const mid = (a + b) / 2, half = (b - a) / 2 + 0.5, cap = new Map(), ink = hex('1c1210');
    for (let y = a; y <= b; y++) {
      const t = (y - mid) / half, w = Math.round(width * Math.sqrt(Math.max(0, 1 - t * t)));
      for (let k = 1; k <= w; k++) cap.set(`${ex + dir * k},${y}`, pix(ex - dir * (k - 1), y));
    }
    const inCap = (x, y) => cap.has(`${x},${y}`);
    for (const [key, c] of cap) {
      const [x, y] = key.split(',').map(Number);
      const rim = !inCap(x + dir, y) || !inCap(x, y - 1) || !inCap(x, y + 1);   // край бока: снаружи, сверху или снизу
      put(x, y, rim ? ink : c);
    }
  }
  // Под рекой с полем — вода до самого края карты: от нижнего берега начинается глубина. На боках она дорисовывается целиком,
  // на картинке глубокой водой становится всё, что внутри field.sea и не вода (трава и кусты, что там росли): тёмная полоса
  // у прежнего нижнего берега так уходит в глубину, а светлая вода у причала остаётся мелководьем.
  const deep = new Uint8Array(W * MH);                             // глубокая вода, дорисованная сборкой: по ней потом — редкие светлые штрихи
  function sea(x0, x1, bottom) {
    for (let x = x0; x < x1; x++) for (let y = Math.round(bottom(x) - 1 + 3 * (soft(x, 0, 8, 1, 81) - 0.5)); y < h; y++) {
      put(x, y, C.waterDeep); if (onMap(x, y)) { water[at(x, y)] = 1; deep[at(x, y)] = 1; }
    }
  }
  if (field && field.sea) {
    const from = field.deepFrom ? curveOf(field.deepFrom) : () => Infinity;
    open = () => true;
    for (let y = 0; y < h; y++) for (let x = 0; x < pw; x++) {
      const i = at(x, y), wet = isWater([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]]);
      const below = y > from(x) + 4 * (soft(x, 0, 9, 1, 83) - 0.5);
      if ((!wet && field.sea.some(p => inPoly(p, x + 0.5, y + 0.5))) || (wet && below)) { put(x, y, C.waterDeep); deep[i] = 1; }
    }
    open = null;
  }
  // Старая тропинка справа на картинке зарастает травой: по её месту пройдёт дорога (sides.road начинается на картинке).
  if (field && field.trail) {
    open = () => true;
    for (let y = 0; y < h; y++) for (let x = 0; x < pw; x++) if (inPoly(field.trail, x + 0.5, y + 0.5)) put(x, y, grassAt(x, y), 0, false, true);
    open = null;
  }

  // ---------- левый бок: лес (или поле) до самой реки ----------
  if (!field) forest(X0, 0, x => riverTop.left(x) - 11, { at: 0, dir: -1, limit: plan.seams.left.forest });
  river(X0, 0, riverTop.left, riverBottom.left);
  if (!field) bushes(X0, 0, x => riverTop.left(x) - 14, x => riverTop.left(x) - 2);   // кусты над водой — в один ряд: над ними видны стволы
  if (field) { highBank(X0, 0, riverTop.left); sea(X0, 0, riverBottom.left); }
  else bushes(X0, 0, x => riverBottom.left(x) - 5, () => h + 8);

  // ---------- правый бок: лес, опушка, луг с дорогой, изгородь над рекой ----------
  if (!field) {
    forest(pw, X1, meadowTop, { at: pw - 1, dir: 1, limit: plan.seams.right.forest }, 1);   // ряд у самого луга ставит опушка — edge()
    meadow(pw, X1);
  }
  if (field) { open = () => true; road(Math.max(0, Math.round(plan.road[0][0])), X1); open = null; }   // с полем дорога начинается ещё на картинке
  else road(pw, X1);
  river(pw, X1, riverTop.right, riverBottom.right);
  if (!field) edge(pw, X1);
  if (field) highBank(pw, X1, riverTop.right);
  else bushes(pw, X1, x => meadowBottom(x) - 6, x => riverTop.right(x) - 2, { mark: true });
  if (field) sea(pw, X1, riverBottom.right); else bushes(pw, X1, x => riverBottom.right(x) - 5, () => h + 8);

  // ---------- швы ниже леса: заросли вдоль края картинки ----------
  // Выше лес сам заходит на картинку (см. forest). Здесь её край закрывают кусты в два столбца: ближний ложится на
  // картинку, дальний уводит заросли вглубь бока — получается куртина, а не полоска вдоль среза.
  const thickets = field ? field.seams : { left: plan.seams.left.thicket, right: plan.seams.right.thicket };
  for (const [x, out1, list] of [[0, -1, thickets.left], [pw - 1, 1, thickets.right]]) {
    for (const [y0, y1, kind, dark] of list) {
      const isHedge = out1 > 0 && y0 > meadowTop(pw) + 20 && y1 < h;   // кусты ниже тропинки — часть изгороди над рекой
      for (const [from0, to0] of [[14, 26], [-2, 8]]) {             // сначала дальний столбец, потом ближний — поверх него
        for (let y = y0 + 5; y < y1; y += range(8, 12)) {
          const from = pick(LEAVES[kind]);
          lobe(x + out1 * range(from0, to0), y, from, { r: Math.min(from.r, 15) - range(0, 3), dark, over: 13, mark: isHedge });
        }
      }
    }
  }

  for (const s of (field && field.stones) || []) mendStone(s);

  // ---------- кромка травы у воды: тёмная линия там, где поле подходит к реке ----------
  if (field) {
    const edge = [];
    for (let i = 0; i < W * MH; i++) {
      if (!sward[i]) continue;
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= W * MH || sward[j]) continue;
        if (isWater([out[j * 3], out[j * 3 + 1], out[j * 3 + 2]])) { edge.push(i); break; }
      }
    }
    for (const i of edge) { out[i * 3] = C.grassEdge[0]; out[i * 3 + 1] = C.grassEdge[1]; out[i * 3 + 2] = C.grassEdge[2]; sward[i] = 0; }
  }

  // ---------- пучки травы и цветы по полю — как на поляне ----------
  if (field) {
    const spots = []; for (let i = 0; i < W * MH; i++) if (sward[i] && !trail[i]) spots.push(i);
    open = (x, y) => sward[at(x, y)] === 1;                         // на картинке — только там, где уже поле
    const ok = (x, y) => onMap(x, y) && sward[at(x, y)] === 1 && !trail[at(x, y)];   // не на краю поля и не на дороге
    for (let n = Math.round(spots.length / 130); n > 0; n--) {
      const i = pick(spots), x = (i % W) - S, y = ((i / W) | 0) - T, kind = rnd();
      if (!ok(x - 1, y - 2) || !ok(x + 1, y - 2) || !ok(x - 1, y + 2) || !ok(x + 1, y + 2)) continue;   // не на краю поля
      const p = (px, py, c) => put(px, py, c, 0, false, true);
      if (kind < 0.6) { const c = pick(C.tuft); p(x, y, c); p(x - 1, y - 1, c); p(x + 1, y - 1, c); if (rnd() < 0.5) p(x, y - 2, c); }
      else if (kind < 0.88) { p(x, y, C.tuftLight); p(x + 1, y - 1, C.tuftLight); }
      else { p(x, y, C.heart); p(x - 1, y, C.petal); p(x + 1, y, C.petal); p(x, y - 1, C.petal); p(x, y + 1, C.petal); p(x, y + 2, C.tuft[0]); }
    }
    open = null;
  }

  // ---------- редкие светлые штрихи на глубокой воде ----------
  if (field) {
    const keep = seed; seed = 0xdee9;                               // своё зерно: остальная карта от штрихов не зависит
    const spots = []; for (let i = 0; i < W * MH; i++) if (deep[i]) spots.push(i);
    const ok = (x, y) => onMap(x, y) && deep[at(x, y)] === 1;
    for (let n = Math.round(spots.length / 260); n > 0; n--) {
      const i = pick(spots), x = (i % W) - S, y = ((i / W) | 0) - T, len = Math.round(range(2, 6)), c = rnd() < 0.8 ? C.water : C.waveSoft;
      let room = true;
      for (let k = -1; k <= len && room; k++) for (const dy of [-1, 0, 1]) if (!ok(x + k, y + dy)) { room = false; break; }
      if (!room) continue;
      for (let k = 0; k < len; k++) { const j = at(x + k, y) * 3; out[j] = c[0]; out[j + 1] = c[1]; out[j + 2] = c[2]; }   // мимо put: вода остаётся водой
    }
    seed = keep;
  }

  shadeWater(X0, 0); shadeWater(pw, X1);
  return { w: W, h: MH, buf: out, hedge, field: field ? sward : null };
}
