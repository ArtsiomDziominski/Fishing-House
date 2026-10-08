// Вещь в руке героя — маленькие картинки в масштабе мира (герой 19×34), не те, что в клетках рюкзака (items-art.ts).
// Пиксельные карты, как у героя: буква — цвет, точка — пусто. Нарисованы для правой на экране руки: длинные вещи
// наклонены верхом вправо, от тела; для другой руки картинка отражается. grip — пиксель карты, который в кулаке
// (у того, что висит на руке, он выше карты: вещь начинается под кистью). Сбоку кисть посреди тела, и стоячий шест
// лёг бы поперёк лица — поэтому длинные вещи там несут наклонив вперёд: lean — на сколько пикселей в строку.

import type { ItemKind } from '@fh/shared';

interface HeldArt { pal?: Record<string, string>; map: string[]; grip: [number, number]; lean?: number }

const PAL: Record<string, string> = {
  o: '240702', k: '432115', w: 'c98a4b', M: 'b16f38',                 // контур, рукоять, дерево
  s: 'b5b9b8', S: 'e4e8e4', z: '6a6a78', g: '5b7381',                 // металл
  q: 'ecd585', Y: 'a8862e',                                           // сеть и её шнур
  G: 'f8c12a', f: 'f08a1c', a: 'e9d79a', r: 'c9532d', t: 'f4e3c1', B: '3f6f9a',   // огонь, стекло, поплавки
  E: '8a9a3c', C: 'ecd585', p: 'e88a8a', P: 'b85a6a',                 // банка и черви
};

// Удочка: комель в кулаке, вершинка у макушки. p — бланк, h — рукоять, t — вершинка; красная метка — поплавок на леске.
const ROD = [
  '...o.',
  '..oto',
  '..oto',
  '..oro',
  '..oro',
  '..opo',
  '..opo',
  '..opo',
  '..opo',
  '.opo.',
  '.opo.',
  '.opo.',
  '.opo.',
  '.opo.',
  '.opo.',
  '.opo.',
  '.opo.',
  '.opo.',
  'opo..',
  'opo..',
  'opo..',
  'opo..',
  'oho..',
  'oho..',
  'oho..',
  'oho..',
  'oho..',
  'oho..',
  '.o...',
];
const rod = (p: string, h: string, t: string): HeldArt => ({ pal: { p, h, t }, map: ROD, grip: [1, 24], lean: 0.6 });
// Свёрнутая сеть висит на руке: у накидки по краю грузила, у невода — поплавки.
const BUNDLE: [number, number] = [3, -1];

// Ведра здесь нет: его в руке рисует движок картинкой bucket-carry.png на руке героя (HERO.carryRig).
const HELD: Record<Exclude<ItemKind, 'bucket'>, HeldArt> = {
  'rod-willow': rod('8a9a3c', 'c98a4b', 'ecd585'),
  'rod-bamboo': rod('d9c36a', '8e3220', 'a8862e'),
  'rod-tele': rod('3f6f9a', '3a3a44', 'e4e8e4'),
  'rod-carbon': rod('3a3a44', 'd2a03a', 'f8c12a'),
  'rod-gold': rod('f8c12a', '7a3d20', 'fff6d8'),
  'net-scoop': {
    grip: [3, 17], lean: 0.5,
    map: [
      '...ooooo.',
      '..osqsqso',
      '..oqsqsqo',
      '..osqsqso',
      '..oqsqsqo',
      '..osqsqso',
      '...ooooo.',
      '....owo..',
      '....owo..',
      '....owo..',
      '...owo...',
      '...owo...',
      '...owo...',
      '...owo...',
      '..owo....',
      '..owo....',
      '..oko....',
      '..oko....',
      '..oko....',
      '...o.....',
    ],
  },
  'net-cast': {
    grip: BUNDLE,
    map: [
      '.ooooo.',
      'oqYqYqo',
      'oYqYqYo',
      'oqYqYqo',
      'oYqYqYo',
      'ogogogo',
      '.o.o.o.',
    ],
  },
  'net-seine': {
    grip: BUNDLE,
    map: [
      '.ooooo.',
      'ofqfqfo',
      'oYqYqYo',
      'oqYqYqo',
      'oYqYqYo',
      'oqYqYqo',
      '.ooooo.',
    ],
  },
  'axe': {
    grip: [1, 12], lean: 0.7,
    map: [
      '.ooooo.',
      'owzzzSo',
      'owzzzSo',
      'owzzSo.',
      'owooo..',
      'owo....',
      'owo....',
      'owo....',
      'owo....',
      'owo....',
      'owo....',
      'oko....',
      'oko....',
      'oko....',
      '.o.....',
    ],
  },
  'lamp': {
    grip: [2, -1],
    map: [
      '.ooo.',
      'o...o',
      'ozzzo',
      'oaGao',
      'oGfGo',
      'oaGao',
      'ozzzo',
      '.ooo.',
    ],
  },
  'worms': {
    grip: [2, -1],
    map: [
      '.ooo.',
      'opPpo',
      'osSso',
      'oEEEo',
      'oECEo',
      'osSso',
      '.ooo.',
    ],
  },
  'floats': {
    grip: [2, -1],
    map: [
      '.o.o.',
      'oroGo',
      'oroGo',
      'otoBo',
      'otoBo',
      'oMoMo',
      '.o.o.',
    ],
  },
};

// Один вид вещи: [как нарисована, отражённая], размер и где у неё кулак.
interface View { img: [HTMLCanvasElement, HTMLCanvasElement]; w: number; h: number; grip: [number, number] }
// front — для вида спереди и со спины, side — сбоку (у коротких вещей он тот же).
export interface HeldSprite { front: View; side: View }
// Погашенная лампа: та же картинка с тёмным стеклом. Так её рисуют и в руке, и на земле.
export const LAMP_OFF = 'lamp-off';
const EXTRA: Record<string, HeldArt> = { [LAMP_OFF]: { ...HELD.lamp, pal: { G: '6a6a78', f: '3a3a44', a: '8f97a3' } } };
const sprites = new Map<string, HeldSprite | null>();

// Наклонить карту вперёд: каждая строка сдвигается тем дальше, чем она выше кулака; ниже кулака — назад.
function leaned(art: HeldArt): HeldArt {
  const k = art.lean || 0; if (!k) return art;
  const shift = art.map.map((_, j) => Math.round((art.grip[1] - j) * k)), min = Math.min(...shift), w = art.map[0]!.length + Math.max(...shift) - min;
  return { ...art, grip: [art.grip[0] - min, art.grip[1]], map: art.map.map((row, j) => ('.'.repeat(shift[j]! - min) + row).padEnd(w, '.')) };
}
const view = (art: HeldArt): View => ({ img: [paint(art, false), paint(art, true)], w: art.map[0]!.length, h: art.map.length, grip: art.grip });

function paint(art: HeldArt, flip: boolean) {
  const w = art.map[0]!.length, h = art.map.length, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!, id = x.createImageData(w, h);
  art.map.forEach((row, j) => { for (let i = 0; i < w; i++) {
    const hex = art.pal?.[row[i]!] || PAL[row[i]!]; if (!hex) continue;
    const o = (j * w + (flip ? w - 1 - i : i)) * 4;
    id.data[o] = parseInt(hex.slice(0, 2), 16); id.data[o + 1] = parseInt(hex.slice(2, 4), 16); id.data[o + 2] = parseInt(hex.slice(4, 6), 16); id.data[o + 3] = 255;
  } });
  x.putImageData(id, 0, 0); return c;
}

// Картинка вещи в руке. kind приходит из состояния комнаты строкой; незнакомая или пустая — null.
// lit — горит ли лампа: погашенная рисуется с тёмным стеклом.
export function heldSprite(kind: string, lit = true): HeldSprite | null {
  if (kind === 'lamp' && !lit) kind = LAMP_OFF;
  let s = sprites.get(kind);
  if (s !== undefined) return s;
  const art = (HELD as Record<string, HeldArt | undefined>)[kind] || EXTRA[kind];
  s = art ? { front: view(art), side: art.lean ? view(leaned(art)) : view(art) } : null;
  sprites.set(kind, s);
  return s;
}

// Куда положить картинку, чтобы вещь оказалась в кулаке: hand — кисть в кадре героя (HERO.hand), side — герой стоит
// боком, floor — ниже этой строки вещь не опускается (висящая лампа не уходит под землю).
// Возвращает картинку, её размер и левый верхний угол в кадре.
export function heldPlace(s: HeldSprite, hand: { x: number; y: number; out: -1 | 1 }, side: boolean, floor: number) {
  const v = side ? s.side : s.front, flip = hand.out < 0, gx = flip ? v.w - 1 - v.grip[0] : v.grip[0];
  return { img: v.img[flip ? 1 : 0], w: v.w, h: v.h, x: hand.x - gx, y: Math.min(hand.y - v.grip[1], floor - v.h + 1) };
}

// Вещь на земле: лампа стоит, как в руке, а длинное (удочки, невод, топор) лежит плашмя — картинка руки, повёрнутая на
// четверть оборота. Низ картинки — то место, где вещь касается земли. lit — горит ли лампа.
export interface GroundSprite { img: HTMLCanvasElement; w: number; h: number }
const lying = new Map<string, GroundSprite | null>();
export function groundSprite(kind: string, lit = true): GroundSprite | null {
  const key = kind + (lit ? '' : '-off');
  let s = lying.get(key);
  if (s !== undefined) return s;
  const v = heldSprite(kind, lit)?.front;
  if (!v) s = null;
  else if (kind === 'lamp' || v.h <= v.w) s = { img: v.img[0], w: v.w, h: v.h };
  else {
    const c = document.createElement('canvas'); c.width = v.h; c.height = v.w;
    const x = c.getContext('2d')!; x.translate(v.h, 0); x.rotate(Math.PI / 2); x.drawImage(v.img[0], 0, 0);
    s = { img: c, w: v.h, h: v.w };
  }
  lying.set(key, s);
  return s;
}
