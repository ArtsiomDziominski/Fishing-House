// Чайка с картинки-образца: летает над водой и садится на столбы причала. Только картинка — на игру не влияет.
// Где она и что делает, считается от часов причала (их ведёт сервер), поэтому все игроки видят одну и ту же чайку.
// Подойдёшь к столбу, на котором она сидит или куда садится, — улетит и вернётся позже. Спугивают её у каждого игрока свои
// глаза: кто стоит рядом, клиент видит сам, так что у всех в комнате она улетает почти разом. Сидящего рыбака не боится.
// Кадры — пиксельные карты 1:1 в арт-пикселях (буква — цвет из PAL, точка — пусто), клювом вправо; влево — отражение.

// Столбы, на которые садится чайка: x, y — середина шляпки, где стоят лапы; base — низ столба у воды (по нему решаем, кто кого заслоняет).
export const POSTS = [
  { x: 288, y: 262, base: 271 },   // дальний, у берега
  { x: 326, y: 274, base: 295 },   // правый
  { x: 252, y: 291, base: 310 },   // левый
  { x: 287, y: 305, base: 324 },   // ближний, у края причала
];

const PAL: Record<string, string> = { o: '2b2d3a', k: '2b2d3a', W: 'f6f6f0', w: 'cfd4da', g: '97a2b1', G: '5f6878', y: 'f2b632', r: 'd9502e', f: 'e0913f' };
const SIT = { x: 6, y: 10 };       // точка опоры сидящей: между лапами
const FLY = { x: 8, y: 7 };        // летящей: середина тела
const FRAMES = {
  sit: [
    '......ooo...',
    '.....oWWWo..',
    '.....oWWkWo.',
    '.....oWWWWyy',
    '..oooowWWor.',
    '.oggggwWWWo.',
    'oGggggwWWWWo',
    'oGGgggwwWWwo',
    '.oGGGgwwwwo.',
    '..oooooooo..',
    '.....f.f....',
  ],
  look: [                          // приоткрыла клюв
    '......ooo...',
    '.....oWWWo..',
    '.....oWWoWo.',
    '.....oWWWWyy',
    '..oooowWWoy.',
    '.oggggwWWWo.',
    'oGggggwWWWWo',
    'oGGgggwwWWwo',
    '.oGGGgwwwwo.',
    '..oooooooo..',
    '.....f.f....',
  ],
  up: [
    '...oo...........',
    '...oGo..........',
    '...oGgo.........',
    '....oGgo........',
    '....oggwo.......',
    '.....owwo.ooo...',
    '.oo..owWooWWWo..',
    'owwooWWWWWWWkWyy',
    '.ooWwwwWWWWWWoo.',
    '...ooooooooo....',
    '................',
    '................',
    '................',
  ],
  mid: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..........ooo...',
    '.oooooooooWWWo..',
    'oGGgggwwwWWWkWyy',
    '.ooWwwwWWWWWWoo.',
    '...ooooooooo....',
    '................',
    '................',
    '................',
  ],
  down: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..........ooo...',
    '.oo...ooooWWWo..',
    'owwoooWWWWWWkWyy',
    '.ooWwwwgwWWWWoo.',
    '...ooowggwooo...',
    '......oGggo.....',
    '.......oGGo.....',
    '........oo......',
  ],
};
type Frame = keyof typeof FRAMES;

const PLAN = {
  turn: 20,                        // каждые столько секунд чайка решает, куда дальше: на столб, сидеть дальше или улететь
  away: 0.3,                       // с какой вероятностью улетает с карты
  pass: 0.5,                       // если её нет, — с какой вероятностью пролетает над водой мимо
  speed: 55,                       // арт-пикселей в секунду
  flap: 4,                         // взмахов крыльями в секунду
  arc: 0.35,                       // насколько дуга полёта выше прямой (доля пути)
  arcMax: 40,                      // но не выше стольких пикселей: дальний перелёт идёт полого
  scare: 30,                       // ближе этого к её столбу не подойти — улетит
  scareSpeed: 90,                  // спугнутая летит быстрее
};
const OFF = 24;                    // за краем карты чайку не видно

const hash = (n: number, s: number) => { let h = (n * 374761393 + s * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function paint(rows: string[], flip: boolean) {
  const w = rows[0]!.length, h = rows.length, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!, id = x.createImageData(w, h);
  rows.forEach((row, j) => { for (let i = 0; i < w; i++) {
    const hex = PAL[row[i]!]; if (!hex) continue;
    const o = (j * w + (flip ? w - 1 - i : i)) * 4;
    id.data[o] = parseInt(hex.slice(0, 2), 16); id.data[o + 1] = parseInt(hex.slice(2, 4), 16); id.data[o + 2] = parseInt(hex.slice(4, 6), 16); id.data[o + 3] = 255;
  } });
  x.putImageData(id, 0, 0); return c;
}

// Куда чайка летит в конце отрезка n: номер столба или -1 (нет на карте).
function goal(n: number) {
  if (hash(n, 1) < PLAN.away) return -1;
  return Math.floor(hash(n, 2) * POSTS.length);
}

interface Pt { x: number; y: number }
const offPoint = (n: number, s: number, W: number): Pt => ({ x: hash(n, s) < 0.5 ? -OFF : W + OFF, y: 40 + Math.round(hash(n, s + 1) * 160) });

// W — ширина карты. at(ms, near) — где чайка в этот миг (ms — часы причала) и каким кадром её рисовать; null — её нет на карте.
// near — где стоят игроки (ступни): они её спугивают. perched — сидит на столбе: тогда её рисуют в общей очереди по base, иначе — поверх всего.
export function createGullView(W: number) {
  const art = {} as Record<Frame, [HTMLCanvasElement, HTMLCanvasElement]>;
  for (const k of Object.keys(FRAMES) as Frame[]) art[k] = [paint(FRAMES[k], false), paint(FRAMES[k], true)];

  interface Shot { img: HTMLCanvasElement; x: number; y: number; perched: boolean; base: number }
  // Летит из a в b по дуге: взлёт вверх, посадка сверху. lift — секунд в полёте, k — какая часть пути позади.
  function flying(a: Pt, b: Pt, k: number, lift: number): Shot & { at: Pt } {
    const len = Math.hypot(b.x - a.x, b.y - a.y), ease = k * k * (3 - 2 * k);
    const cx = (a.x + b.x) / 2, cy = Math.min(a.y, b.y) - Math.min(len * PLAN.arc, PLAN.arcMax);
    const x = (1 - ease) ** 2 * a.x + 2 * (1 - ease) * ease * cx + ease * ease * b.x;
    const y = (1 - ease) ** 2 * a.y + 2 * (1 - ease) * ease * cy + ease * ease * b.y;
    const face = b.x < a.x ? 1 : 0;
    // машет крыльями на взлёте и при посадке, в середине пути то машет, то планирует
    const glide = k > 0.35 && k < 0.8 && Math.floor(lift / 1.2) % 2 === 1;
    const frame: Frame = glide ? 'mid' : (['up', 'mid', 'down', 'mid'] as Frame[])[Math.floor(lift * PLAN.flap * 4) % 4]!;
    const img = art[frame][face]!;
    return { img, x: Math.round(x) - (face ? img.width - 1 - FLY.x : FLY.x), y: Math.round(y) - FLY.y, perched: false, base: 0, at: { x, y } };
  }
  const perch = (i: number): Pt | null => i >= 0 ? { x: POSTS[i]!.x, y: POSTS[i]!.y - (SIT.y - FLY.y) - 1 } : null;   // тело летящей там, где у сидящей
  // Кто стоит слишком близко к столбу i (меряем от середины столба: ступни героя — на досках рядом с ним).
  const scarer = (i: number, near: Pt[]) => { const p = POSTS[i]!; return near.find(q => Math.hypot(q.x - p.x, q.y - (p.y + p.base) / 2) < PLAN.scare); };

  // Спугнутая: улетает за край и не возвращается, пока по расписанию сама не прилетит из-за края (отрезок, перед которым её нет на карте).
  let scared: { n: number; from: Pt; to: Pt; t0: number; dur: number } | null = null;

  function at(ms: number, near: Pt[] = []): Shot | null {
    const s = ms / 1000, n = Math.floor(s / PLAN.turn), u = s - n * PLAN.turn;
    const from = goal(n - 1), to = goal(n);
    if (scared && (s < scared.t0 || n > scared.n && from < 0)) scared = null;
    if (scared) { const k = (s - scared.t0) / scared.dur; return k < 1 ? flying(scared.from, scared.to, k, s - scared.t0) : null; }
    const flee = (p: Pt, who: Pt) => {              // прочь от того, кто подошёл, и вверх
      const end = { x: p.x < who.x ? -OFF : W + OFF, y: p.y - 50 - Math.round(hash(Math.floor(s), 10) * 60) };
      scared = { n, from: p, to: end, t0: s, dur: Math.hypot(end.x - p.x, end.y - p.y) / PLAN.scareSpeed };
      return at(ms);
    };
    // откуда и куда: столб или точка за краем; два раза «нет на карте» — иногда пролёт мимо
    let a = perch(from), b = perch(to);
    if (!a && !b) {
      if (hash(n, 3) >= PLAN.pass) return null;
      a = offPoint(n, 4, W); b = { x: a.x < 0 ? W + OFF : -OFF, y: 40 + Math.round(hash(n, 6) * 160) };
    } else {
      a ??= offPoint(n, 4, W); b ??= offPoint(n, 7, W);
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y), dur = len / PLAN.speed, lift = u - (PLAN.turn - dur);   // летит в конце отрезка
    if (from === to && from >= 0 || lift < 0) {
      if (from < 0) return null;                     // ещё за краем — прилетит в конце отрезка
      const who = scarer(from, near); if (who) return flee(perch(from)!, who);
      const p = POSTS[from]!, look = Math.floor(s / 3);
      const face = hash(look, 8) < 0.5 ? 0 : 1, frame: Frame = hash(Math.floor(s * 2), 9) < 0.08 ? 'look' : 'sit';
      const img = art[frame][face]!;
      return { img, x: p.x - (face ? img.width - 1 - SIT.x : SIT.x), y: p.y - SIT.y, perched: true, base: p.base };
    }
    const shot = flying(a, b, lift / dur, lift);
    const who = to >= 0 && lift / dur > 0.5 ? scarer(to, near) : undefined;   // садится туда, где кто-то стоит, — отворачивает на подлёте
    return who ? flee(shot.at, who) : shot;
  }
  return { at };
}
