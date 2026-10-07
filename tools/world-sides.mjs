// Дорисовывает карту по бокам от картинки-образца: слева лес, справа луг с дорогой.
// Река и кусты у нижнего края идут через всю карту. План боков (берега, дорога, границы луга) — sides в world-shapes.mjs.
// Тем же способом зарастает место дома, когда он убран с карты: поляна и опушка за ней (план — glade там же).
//
// Листва не выдумывается: каждая крона и каждый куст собраны из кругов, снятых с настоящих крон и кустов картинки,
// под новым зубчатым контуром. Так бока получаются той же руки, что и середина. Деревья при этом разные:
// у каждого своя форма кроны (от одного круга до пяти под общим контуром), своя ширина и своя порода — оттенок листа.
// Стоят они на стволах, рядами, и на стыке с картинкой заходят на неё целыми кронами: по её краю ничего не обрезается.
// Вода, трава, дорога и стволы рисуются цветами картинки. Всё случайное идёт от одного зерна: сборка каждый раз
// даёт одну и ту же карту.

const hex = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];

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
  dirt: ['af7242', 'a4754a', 'ac7c54', 'a36936'].map(hex), dirtDark: ['96592e', '86452e'].map(hex), dirtEdge: hex('5d3a22'), pebble: ['b89a78', '9a7f66'].map(hex),
  trunk: hex('6c3725'), trunkLight: hex('783e27'), trunkDark: hex('48201a'), trunkEdge: hex('0a0303'),
};

// pic — картинка pw×h (RGB), уже без рыбака, ведра, рюкзака и дыма. plan — sides из world-shapes.mjs.
// Возвращает { w, buf, hedge }: карту шириной plan.left + pw + plan.right (RGB) и маску листвы изгороди над рекой —
// герой, зайдя в неё, должен скрываться за листьями. Координаты плана — как у картинки: левее неё x < 0, правее — x >= pw.
// glade — { hole, plan }, если дом убран: hole — пиксели картинки, откуда он вырезан, plan — glade из world-shapes.mjs.
export function widen(pic, pw, h, plan, glade = null) {
  const S = plan.left, W = S + pw + plan.right, out = Buffer.alloc(W * h * 3);   // S — на сколько картинка сдвинута вправо
  const X0 = -S, X1 = pw + plan.right;                             // края карты в координатах картинки
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

  const onMap = (x, y) => x >= X0 && x < X1 && y >= 0 && y < h;
  const onPic = x => x >= 0 && x < pw;
  const src = (x, y) => { const i = (y * pw + x) * 3; return [pic[i], pic[i + 1], pic[i + 2]]; };
  const water = new Uint8Array(W * h);                             // где на боках вода — чтобы положить на неё тени
  const hedge = new Uint8Array(W * h);                             // листва изгороди над рекой
  // over — на сколько пикселей разрешено заходить на саму картинку (так листва закрывает шов); mark — это лист изгороди
  let open = null;                                                 // где ещё картинку можно перерисовывать: пока дорисовывается поляна
  const put = (x, y, c, over = 0, mark = false) => {
    if (!onMap(x, y) || (onPic(x) && !(x < over || x >= pw - over) && !(open && open(x, y)))) return;
    const i = y * W + x + S; out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; water[i] = 0; hedge[i] = mark ? 1 : 0;
  };

  const riverTop = { left: curveOf(plan.river.left.top), right: curveOf(plan.river.right.top) };
  const riverBottom = { left: curveOf(plan.river.left.bottom), right: curveOf(plan.river.right.bottom) };
  const meadowTop = curveOf(plan.meadow.top), meadowBottom = curveOf(plan.meadow.bottom);
  const roadY = curveOf(plan.road.map(p => [p[0], p[1]])), roadHalf = curveOf(plan.road.map(p => [p[0], p[2]]));

  // ---------- картинка в середине, тьма леса по бокам ----------
  for (let y = 0; y < h; y++) for (let x = X0; x < X1; x++) {
    const i = (y * W + x + S) * 3, c = onPic(x) ? src(x, y) : C.deep[Math.floor(noise(x >> 2, y >> 1, 3) * C.deep.length)];
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
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
        if (onMap(x, y) && !onPic(x)) water[y * W + x + S] = 1;
      }
    }
    // блики-штрихи: короткая светлая черта с хвостиком, как на картинке
    for (let n = Math.round((x1 - x0) * 0.2); n > 0; n--) {
      const x = Math.round(range(x0, x1 - 8)), y = Math.round(range(top(x) + 7, bottom(x) - 3)), len = Math.round(range(3, 8)), c = rnd() < 0.6 ? C.wave : C.waveSoft;
      for (let i = 0; i < len; i++) if (water[y * W + x + i + S]) put(x + i, y, c), water[y * W + x + i + S] = 1;
      if (rnd() < 0.6 && water[(y - 1) * W + x - 1 + S]) { put(x - 1, y - 1, c); water[(y - 1) * W + x - 1 + S] = 1; }
    }
  }
  // Тень на воде под нависшей листвой и камнями: несколько тёмных строк сразу под берегом.
  function shadeWater(x0, x1) {
    for (let x = x0; x < x1; x++) for (let y = 1; y < h; y++) {
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
  function road(x0, x1) {
    for (let x = x0; x < x1; x++) {
      const yc = roadY(x), hw = roadHalf(x);
      const top = Math.round(yc - hw + 1.6 * (soft(x, 0, 6, 1, 41) - 0.5) * 2), bottom = Math.round(yc + hw + 1.6 * (soft(x, 0, 7, 1, 42) - 0.5) * 2);
      for (let y = top; y <= bottom; y++) {
        const n = soft(x, y, 7, 3, 43), speck = noise(x, y, 44);
        let c = n < 0.22 ? C.dirtDark[0] : n > 0.8 ? C.dirt[2] : C.dirt[Math.floor(soft(x, y, 11, 4, 45) * 2.99) === 1 ? 1 : 0];
        if (speck < 0.03) c = C.dirtDark[1]; else if (speck > 0.985) c = C.dirt[3];
        if (y === top) c = C.grassEdge; else if (y === bottom) c = C.dirtEdge;   // кромки: сверху тень травы, снизу тёмная земля
        put(x, y, c);
      }
    }
    for (let n = Math.round((x1 - x0) * 0.09); n > 0; n--) {       // плоские камешки в колее
      const x = Math.round(range(x0 + 4, x1 - 6)), hw = roadHalf(x);
      if (hw < 6) continue;
      const y = Math.round(roadY(x) + range(-hw + 3, hw - 3)), len = Math.round(range(2, 4));
      for (let i = 0; i < len; i++) put(x + i, y, C.pebble[0]);
      for (let i = 0; i < len; i++) put(x + i, y + 1, C.pebble[1]);
    }
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

  // ---------- левый бок: лес до самой реки ----------
  forest(X0, 0, x => riverTop.left(x) - 11, { at: 0, dir: -1, limit: plan.seams.left.forest });
  river(X0, 0, riverTop.left, riverBottom.left);
  bushes(X0, 0, x => riverTop.left(x) - 14, x => riverTop.left(x) - 2);                // кусты над водой — в один ряд: над ними видны стволы
  bushes(X0, 0, x => riverBottom.left(x) - 5, () => h + 8);

  // ---------- правый бок: лес, опушка, луг с дорогой, изгородь над рекой ----------
  forest(pw, X1, meadowTop, { at: pw - 1, dir: 1, limit: plan.seams.right.forest }, 1);   // ряд у самого луга ставит опушка — edge()
  meadow(pw, X1);
  road(pw, X1);
  river(pw, X1, riverTop.right, riverBottom.right);
  edge(pw, X1);
  bushes(pw, X1, x => meadowBottom(x) - 6, x => riverTop.right(x) - 2, { mark: true });
  bushes(pw, X1, x => riverBottom.right(x) - 5, () => h + 8);

  // ---------- швы ниже леса: заросли вдоль края картинки ----------
  // Выше лес сам заходит на картинку (см. forest). Здесь её край закрывают кусты в два столбца: ближний ложится на
  // картинку, дальний уводит заросли вглубь бока — получается куртина, а не полоска вдоль среза.
  for (const [x, out1, list] of [[0, -1, plan.seams.left.thicket], [pw - 1, 1, plan.seams.right.thicket]]) {
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

  shadeWater(X0, 0); shadeWater(pw, X1);
  return { w: W, buf: out, hedge };
}
