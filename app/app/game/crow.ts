// Ворона: летает над поляной из края в край и иногда садится на крышу дома. На землю и деревья не садится.
// Только картинка — на игру не влияет. Где она и что делает, считается от часов причала (их ведёт сервер),
// поэтому все игроки видят одну и ту же ворону. Пока она одна.
// Кадры — пиксельные карты 1:1 в арт-пикселях (буква — цвет из PAL, точка — пусто), клювом вправо; влево — отражение.

import { World } from '@fh/shared';

// Где она сидит на крыше: точки конька, от левого верха дома (house.png) — там стоят лапы.
const ROOF = [[88, 16], [100, 9], [112, 7]];

const PAL: Record<string, string> = { o: '12131a', b: '2a2d3a', d: '3f4456', k: '1c1e28', e: 'e8e4d0', n: '5a5e6e', f: '3a3c46' };
const SIT = { x: 6, y: 10 };       // точка опоры сидящей: между лапами
const FLY = { x: 8, y: 7 };        // летящей: середина тела
const FRAMES = {
  sit: [
    '......ooo...',
    '.....obbbo..',
    '.....obbebo.',
    '.....obbbbnn',
    '..oooobbbon.',
    '.oddddbbbbo.',
    'okddddbbbbbo',
    'okkdddbbbbbo',
    'ookkkdbbbbo.',
    'oo.ooooooo..',
    '.....f.f....',
  ],
  caw: [                           // каркает: клюв раскрыт
    '......ooo...',
    '.....obbbo..',
    '.....obbebnn',
    '.....obbbbo.',
    '..oooobbbonn',
    '.oddddbbbbo.',
    'okddddbbbbbo',
    'okkdddbbbbbo',
    'ookkkdbbbbo.',
    'oo.ooooooo..',
    '.....f.f....',
  ],
  up: [
    '...oo...........',
    '...oko..........',
    '...okdo.........',
    '....okdo........',
    '....odddo.......',
    '.....oddo.ooo...',
    '.oo..odboobbbo..',
    'okkoobbbbbbbebnn',
    '.oobdddbbbbbboo.',
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
    '.ooooooooobbbo..',
    'okkddddddbbbebnn',
    '.oobdddbbbbbboo.',
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
    '.oo...oooobbbo..',
    'okkooobbbbbbebnn',
    '.oobdddkdbbbboo.',
    '...ooodkkdooo...',
    '......okddo.....',
    '.......okko.....',
    '........oo......',
  ],
};
type Frame = keyof typeof FRAMES;

const PLAN = {
  turn: 22,                        // каждые столько секунд ворона решает, что дальше: сесть на крышу, сидеть или улететь
  roof: 0.18,                      // с какой вероятностью следующий отрезок она на крыше
  pass: 0.9,                       // если не на крыше, — с какой вероятностью пролетает над поляной
  speed: 62,                       // арт-пикселей в секунду
  flap: 3.2,                       // взмахов крыльями в секунду: машет реже и тяжелее чайки
  bend: 70,                        // насколько пролёт выгнут в сторону, пикселей
};
const OFF = 24;                    // за краем карты ворону не видно

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

interface Pt { x: number; y: number }

// Где ворона в конце отрезка n: номер места на крыше или -1 (не на крыше).
function goal(n: number) {
  if (hash(n, 41) >= PLAN.roof) return -1;
  return Math.floor(hash(n, 42) * ROOF.length);
}

// at(ms) — где ворона в этот миг (ms — часы причала) и каким кадром её рисовать; null — её нет на карте.
// Рисовать поверх всего: и сидя на коньке, и в полёте она выше героев и деревьев.
export function createCrowView() {
  const W = World.W, H = World.H;
  const art = {} as Record<Frame, [HTMLCanvasElement, HTMLCanvasElement]>;
  for (const k of Object.keys(FRAMES) as Frame[]) art[k] = [paint(FRAMES[k], false), paint(FRAMES[k], true)];
  const roof = ROOF.map(([x, y]) => ({ x: World.house.x + x!, y: World.house.y + y! }));
  // точка за краем карты: слева, справа или сверху — на любой высоте, ворона летает над всей поляной
  const offPoint = (n: number, s: number): Pt => {
    const r = hash(n, s);
    if (r < 0.25) return { x: 40 + Math.round(hash(n, s + 1) * (W - 80)), y: -OFF };
    return { x: r < 0.625 ? -OFF : W + OFF, y: Math.round(hash(n, s + 1) * (H - 60)) };
  };

  function at(ms: number): { img: HTMLCanvasElement; x: number; y: number } | null {
    const s = ms / 1000, n = Math.floor(s / PLAN.turn), u = s - n * PLAN.turn;
    const from = goal(n - 1), to = goal(n);
    const perch = (i: number): Pt | null => i >= 0 ? { x: roof[i]!.x, y: roof[i]!.y - (SIT.y - FLY.y) - 1 } : null;   // тело летящей там, где у сидящей
    let a = perch(from), b = perch(to);
    if (!a && !b) {                                  // пролёт над поляной: из края в край
      if (hash(n, 43) >= PLAN.pass) return null;
      a = offPoint(n, 44);
      b = a.y < 0 ? { x: hash(n, 46) < 0.5 ? -OFF : W + OFF, y: 60 + Math.round(hash(n, 47) * (H - 120)) } : { x: a.x < 0 ? W + OFF : -OFF, y: Math.round(hash(n, 47) * (H - 60)) };
    } else {
      a ??= offPoint(n, 44); b ??= offPoint(n, 48);
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y), dur = len / PLAN.speed, lift = u - (PLAN.turn - dur);   // летит в конце отрезка
    if (from === to && from >= 0 || lift < 0) {
      if (from < 0) return null;                     // ещё за краем — прилетит в конце отрезка
      const p = roof[from]!, c = s % 7;              // время от времени каркает: дважды подряд
      const face = hash(Math.floor(s / 4), 49) < 0.5 ? 0 : 1, frame: Frame = c < 0.9 && Math.floor(c / 0.3) !== 1 ? 'caw' : 'sit';
      const img = art[frame][face]!;
      return { img, x: p.x - (face ? img.width - 1 - SIT.x : SIT.x), y: p.y - SIT.y };
    }
    const k = lift / dur, land = from >= 0 || to >= 0, ease = land ? k * k * (3 - 2 * k) : k;   // у крыши разгоняется и тормозит, мимо летит ровно
    // с крыши и на крышу — дугой сверху; пролёт выгнут в сторону, чтобы путь не был прямой чертой
    const bend = land ? -Math.min(len * 0.3, 36) : (hash(n, 50) * 2 - 1) * PLAN.bend;
    const cx = (a.x + b.x) / 2, cy = (land ? Math.min(a.y, b.y) : (a.y + b.y) / 2) + bend;
    const x = (1 - ease) ** 2 * a.x + 2 * (1 - ease) * ease * cx + ease * ease * b.x;
    const y = (1 - ease) ** 2 * a.y + 2 * (1 - ease) * ease * cy + ease * ease * b.y;
    const face = b.x < a.x ? 1 : 0;
    // машет крыльями у крыши, а в пути то машет, то планирует
    const glide = (!land || k > 0.3 && k < 0.8) && Math.floor(lift / 1.6) % 2 === 1;
    const frame: Frame = glide ? 'mid' : (['up', 'mid', 'down', 'mid'] as Frame[])[Math.floor(lift * PLAN.flap * 4) % 4]!;
    const img = art[frame][face]!;
    return { img, x: Math.round(x) - (face ? img.width - 1 - FLY.x : FLY.x), y: Math.round(y) - FLY.y };
  }
  return { at };
}
