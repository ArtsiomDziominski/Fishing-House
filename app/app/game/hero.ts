// Герой — рыбак в жёлтом плаще с картинки-образца.
// Голова в три четверти (ракурсы «влево»/«вправо») снята с картинки пиксель в пиксель,
// вид спереди, со спины и туловище с ногами дорисованы той же палитрой.
// Кадр 19×34, точка опоры (ступни) — середина нижней строки.
// Рюкзак на спине — накладка поверх туловища, своя для каждого ракурса; её тона задаёт вид рюкзака.
// У костра герой сидит: кадр собирается из стоячего (seated).

import type { Hand } from '@fh/shared';

export type Dir = 'down' | 'up' | 'left' | 'right';
export type Pixels = Uint8ClampedArray;
export interface Patch { w: number; h: number; data: Pixels; x: number; y: number }
export interface Rig extends Patch { bucket: [number, number] }

export const HERO = (() => {
  const PAL: Record<string, string> = {
    o: '240702', D: '19141d', n: '481e0c', N: '743d27', b: '9d613b',   // контур, тёмное, волосы и сапоги
    h: '1d3f56', k: '2c5a7a',                                          // штаны
    R: '904c07', H: 'c27709', r: 'ca8523', O: 'eda50b', s: 'e7a62c',   // тени плаща
    Y: 'e1b054', Z: 'f6c12a', W: 'fac708',                             // свет плаща
    y: 'e9a37c', S: 'cd8d68',                                          // кожа
    g: 'fdcf6a',                                                       // пряжка рюкзака
  };
  const FW = 19, FH = 34;

  const HEAD: Record<'down' | 'up' | 'left', string[]> = {
    down: [
      '.....ooooooooo.....',
      '...oorsZZZZZsroo...',
      '..osZWWWWWWWWWZso..',
      '.oZWWWWWWWWWWWWWZo.',
      '.oWWWsooooooosWWWo.',
      'oZWWonnNNNNNnnoWZso',
      'oWWZonNNNNNNNnoZZso',
      'oWWZonNnNNNnNnoZsOo',
      'oWWZonnSnNnSnnoZsOo',
      'oWZYoSSyyyyySSoYsOo',
      'oWZYoyyoyyyoyyoYsOo',
      'oOZYoyyoyyyoyyoYOOo',
      'oOZsoSyyyyyyySosOro',
      '.oOZoSyyyyyyySoOro.',
      '.oOZsoSSyyySSosOro.',
      '..oOZsooooooosOro..',
      '...oOOZZsssZOOro...',
    ],
    up: [
      '.....ooooooooo.....',
      '...oorsZZZZZsroo...',
      '..osZWWWWWWWWWZso..',
      '.oZWWWWWWWWWWWWZso.',
      '.oWWWWWWWWWWWWWZso.',
      'oZWWWWWWWZWWWWWZsOo',
      'oWWWWWWWWZWWWWWZsOo',
      'oWWWWWWWWZWWWWWZsOo',
      'oWWWWWWWWZWWWWZZsOo',
      'oWWWWWWWWsWWWWZsOOo',
      'oZWWWWWWWsWWWZZsOOo',
      'oZWWWWWWWsWWWZsOOro',
      'oOZWWWWWWsWWZZsOOro',
      '.oOZZWWWWsWZZsOOro.',
      '.oOOsZZZZsZssOOrro.',
      '..oOOOsssssOOOrro..',
      '...ooOOOOOOOrroo...',
    ],
    left: [                      // с картинки
      '.....oooooooooo....',
      '...ooorrssZZZro....',
      '...osZWWWWWWWWso...',
      '..oYWZZZWWWWWWWZo..',
      '.orsYoobZWWWWWWWso.',
      '.osYoonnnZWWWWWWZo.',
      '.oYnnNNNNoOWWWWWWso',
      '.oNnnnNNNNorWWWWWso',
      '.onnnnnNoNNoZWWWWso',
      '.onooSnnSnnnHWWWOso',
      '.oYoSSyySSyonZWWOso',
      '.oYoSoyySoSSoOWOOso',
      '.oYoyoyyyoyynOWOOYo',
      '..oSybyyyoyynOOOso.',
      '..oYoyyyyyyynZOso..',
      '...oYoSSyyynZZro...',
      '....oYnnnnnZOHHo...',
    ],
  };

  // Туловище: 11 строк (17..27). У вида спереди и сзади руки отдельно — они качаются при ходьбе.
  const BODY: Record<'down' | 'up' | 'left', string[]> = {
    down: [
      '....ooOZZsZZOoo....',
      '....oZWWWHWWWZo....',
      '....oWWWWHWWWWo....',
      '....oWWWWHWWWWo....',
      '....oZWWWHWWWZo....',
      '....oZWWWHWWWZo....',
      '....oZZWWHWWZZo....',
      '....oOZZWHWZZOo....',
      '....oOOZZHZZOOo....',
      '....ooOOOHOOOoo....',
      '.....ooooooooo.....',
    ],
    up: [
      '....ooOZZsZZOoo....',
      '....oZWWWsWWZso....',
      '....oWWWWsWWWZo....',
      '....oWWWWsWWWZo....',
      '....oZWWWsWWZso....',
      '....oZWWWsWWZso....',
      '....oZZWWsWWZso....',
      '....oOZZWsWZZOo....',
      '....oOOZZsZZOOo....',
      '....ooOOOsOOOoo....',
      '.....ooooooooo.....',
    ],
    left: [
      '....ooYRbRZWOOsRo..',
      '.....orZROWWWWWZo..',
      '....osHZHWWWWWWWo..',
      '....osHZHWWWWWWWo..',
      '....oOsZHWWWWWWZo..',
      '....oOsZHWWWWWWZo..',
      '....oOsZHWWWWWZso..',
      '....oOOZHZWWWZZso..',
      '....oOOOHZZZZZsOo..',
      '....ooOOHOOOOOOoo..',
      '.....ooooooooooo...',
    ],
  };

  // Рукав с кистью, 3×9. Рисуется поверх туловища, сдвигается по кадрам.
  const ARM = ['oZo', 'oWo', 'oWo', 'oZo', 'oZo', 'oOo', 'oOo', 'oyo', 'ooo'];
  const ARM_SIDE = ['.ooo.', 'oZWZo', 'oWWZo', 'oWWZo', 'oZWso', 'oZZso', 'oOZso', 'oyySo', '.ooo.'];

  // Ведро в руке. bucket — куда встаёт середина дна ведра относительно точки опоры героя,
  // arm — рука, которая держит ручку: карта и её место в координатах кадра (может выходить за кадр).
  const CARRY: Record<'down' | 'up' | 'left', { bucket: [number, number]; arm: { at: [number, number]; map: string[] } }> = {
    down: {
      bucket: [-11, 2],
      arm: { at: [1, 15], map: ['.oo.', 'oyyo', '.oZZ', '..oW'] },
    },
    up: {
      bucket: [11, 2],
      arm: { at: [14, 15], map: ['.oo.', 'oyyo', 'ZZo.', 'Wo..'] },
    },
    left: {
      bucket: [-9, 3],
      arm: { at: [1, 15], map: ['.oo.......', 'oyyooooo..', 'oyyZWWWZo.', '.ooZZWWZo.', '...ooooo..'] },
    },
  };

  // Рюкзак на спине. Цифры 1..5 — тона его расцветки от света к тени, at — место накладки относительно туловища.
  // Спереди видны только лямки, со спины — весь рюкзак, сбоку он выступает за спину (кадр «влево»: спина справа).
  const PACK: Record<'down' | 'up' | 'left', { at: [number, number]; map: string[] }> = {
    down: { at: [6, 0], map: ['23...32', '23...32', '23...32', '34...43', '34...43', '34...43', '.4...4.'] },
    up: {
      at: [6, 0],
      map: [
        '.3...3.',
        '.ooooo.',
        'o11112o',
        'o12223o',
        'o44g44o',
        'o23334o',
        'o23334o',
        'o33445o',
        '.ooooo.',
      ],
    },
    left: {
      at: [12, 1],
      map: [
        '.4.ooo.',
        '.4o112o',
        '4.o123o',
        '4.o444o',
        '.4o234o',
        '..o234o',
        '..o345o',
        '...ooo.',
      ],
    },
  };

  // Сидящий рыбак вырезан с картинки (assets/fisher.png) и сидит спиной вправо — как кадр «влево».
  // Рюкзак ему кладётся той же накладкой; здесь её место на этом спрайте.
  const SEAT_PACK: [number, number] = [31, 18];

  // Ноги: 6 строк (28..33). stand — обе на земле, step — одна приподнята.
  const LEGS = {
    front: {
      stand: [
        '.....ohhhohhho.....',
        '.....ohkhohkho.....',
        '.....ohhhohhho.....',
        '.....oNNNoNNNo.....',
        '....oNbNNoNNbNo....',
        '....ooooooooooo....',
      ],
      step: [                      // правая на экране нога приподнята
        '.....ohhhohhho.....',
        '.....ohkhohkho.....',
        '.....ohhhoNNNo.....',
        '.....oNNNoNbNo.....',
        '....oNbNNooooo.....',
        '....oooooo.........',
      ],
    },
    back: {
      stand: [
        '.....ohhhohhho.....',
        '.....ohhhohhho.....',
        '.....ohhhohhho.....',
        '.....oNNNoNNNo.....',
        '....oNNNNoNNNNo....',
        '....ooooooooooo....',
      ],
      step: [
        '.....ohhhohhho.....',
        '.....ohhhohhho.....',
        '.....ohhhoNNNo.....',
        '.....oNNNoNNNo.....',
        '....oNNNNooooo.....',
        '....oooooo.........',
      ],
    },
    side: {
      stand: [
        '......ohhhhho......',
        '......ohkhhho......',
        '......ohhhhho......',
        '.....oNNNNNNo......',
        '....oNbNNNNNo......',
        '....ooooooooo......',
      ],
      stride: [                    // ноги врозь
        '......ohhhhho......',
        '.....ohkhohhho.....',
        '....ohhho.ohhho....',
        '...oNNNo..oNNNo....',
        '..oNbNNo..oNNNo....',
        '..oooooo..ooooo....',
      ],
      pass: [                      // ноги вместе, задняя приподнята
        '......ohhhhho......',
        '......ohkhhho......',
        '......ohhhhho......',
        '.....oNNNNNo.......',
        '....oNbNNNo........',
        '....ooooooo........',
      ],
    },
  };

  function rgb(hex: string) { return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]; }
  const COLORS: Record<string, number[]> = {}; for (const k in PAL) COLORS[k] = rgb(PAL[k]!);

  function blank() { return new Uint8ClampedArray(FW * FH * 4); }
  function stamp(buf: Pixels, map: string[], ox: number, oy: number, colors = COLORS) {
    for (let j = 0; j < map.length; j++) {
      const row = map[j]!;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]!; if (ch === '.') continue;
        const x = ox + i, y = oy + j; if (x < 0 || y < 0 || x >= FW || y >= FH) continue;
        const c = colors[ch]; if (!c) throw new Error('hero: нет цвета "' + ch + '"');
        const o = (y * FW + x) * 4; buf[o] = c[0]!; buf[o + 1] = c[1]!; buf[o + 2] = c[2]!; buf[o + 3] = 255;
      }
    }
  }
  function mirror(buf: Pixels) {
    const out = blank();
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const a = (y * FW + x) * 4, b = (y * FW + (FW - 1 - x)) * 4;
      out[b] = buf[a]!; out[b + 1] = buf[a + 1]!; out[b + 2] = buf[a + 2]!; out[b + 3] = buf[a + 3]!;
    }
    return out;
  }
  function mirrorMap(map: string[]) { return map.map(r => r.split('').reverse().join('')); }

  // Кадры: 0 — стоит, 1..4 — шаг (1 и 3 — опора на разные ноги, 2 и 4 — проход), 5 — стоит, моргнув.
  // Закрытые глаза: [строка, столбец] зрачков в карте головы.
  const EYES: Partial<Record<'down' | 'up' | 'left', [number, number][]>> = { down: [[10, 7], [11, 7], [10, 11], [11, 11]], left: [[11, 5], [12, 5], [13, 5], [11, 9], [12, 9], [13, 9]] };
  function blinkHead(dir: 'down' | 'up' | 'left') {
    const rows = HEAD[dir].map(r => r.split(''));
    const mid = dir === 'down' ? 11 : 12;
    for (const [r, c] of EYES[dir] || []) rows[r]![c] = r === mid ? 'N' : 'y';
    return rows.map(r => r.join(''));
  }
  type Tones = Record<string, number[]> | null;
  // carry — какая рука держит ведро: правая лицом к нам — слева на экране, со спины — справа; левая — наоборот.
  function frontFrame(dir: 'down' | 'up', f: number, blink: boolean, carry: Hand | false, pack: Tones) {
    const buf = blank();
    const step = f === 1 || f === 3, dip = step ? 1 : 0;
    const legs = LEGS[dir === 'down' ? 'front' : 'back'];
    let lmap = step ? legs.step : legs.stand; if (f === 3) lmap = mirrorMap(lmap);
    stamp(buf, lmap, 0, 28);
    stamp(buf, BODY[dir], 0, 17 + dip);
    if (pack) stamp(buf, PACK[dir].map, PACK[dir].at[0], 17 + dip + PACK[dir].at[1], pack);
    // руки: противоход ногам
    const swing = f === 1 ? 1 : f === 3 ? -1 : 0;
    const busy = !carry ? '' : (dir === 'down') === (carry === 'right') ? 'left' : 'right';   // эта сторона держит ведро и не качается
    if (busy !== 'left') stamp(buf, ARM, 2, 18 + dip - (swing > 0 ? 0 : swing < 0 ? 1 : 0) + (swing > 0 ? 1 : 0));
    if (busy !== 'right') stamp(buf, ARM, 14, 18 + dip - (swing < 0 ? 0 : swing > 0 ? 1 : 0) + (swing < 0 ? 1 : 0));
    stamp(buf, blink ? blinkHead(dir) : HEAD[dir], 0, dip);
    return buf;
  }
  // carry — ведро в ближней руке (в дальней оно за телом, а ближняя рука качается как обычно).
  function sideFrame(f: number, blink: boolean, carry: boolean, pack: Tones) {
    const buf = blank();
    const lift = f === 2 || f === 4 ? -1 : 0;                 // на проходе тело чуть выше
    const lmap = f === 0 ? LEGS.side.stand : (f === 1 || f === 3) ? LEGS.side.stride : LEGS.side.pass;
    stamp(buf, lmap, 0, 28);
    stamp(buf, BODY.left, 0, 17 + lift + 1);
    if (pack) stamp(buf, PACK.left.map, PACK.left.at[0], 17 + lift + 1 + PACK.left.at[1], pack);   // рука — поверх рюкзака
    const armX = f === 1 ? 7 : f === 3 ? 11 : 9;              // рука вперёд / назад
    if (!carry) stamp(buf, ARM_SIDE, armX, 19 + lift + 1);
    stamp(buf, blink ? blinkHead('left') : HEAD.left, 0, lift + 1);
    return buf;
  }

  const withPack = (tones: number[][]): Record<string, number[]> => ({ ...COLORS, 1: tones[0]!, 2: tones[1]!, 3: tones[2]!, 4: tones[3]!, 5: tones[4]! });
  // Карта → RGBA: накладка, которую игра рисует отдельно от кадра.
  function pixels(map: string[], colors = COLORS) {
    const w = map[0]!.length, h = map.length, data = new Uint8ClampedArray(w * h * 4);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const ch = map[j]![i]!; if (ch === '.') continue;
      const c = colors[ch]!, o = (j * w + i) * 4; data[o] = c[0]!; data[o + 1] = c[1]!; data[o + 2] = c[2]!; data[o + 3] = 255;
    }
    return { w, h, data };
  }

  // carry — те же кадры без руки, занятой ведром (её рисует игра поверх ведра): 'right' или 'left'; false — ведра нет.
  // Сбоку ведро в дальней руке висит за телом, и ближняя рука остаётся на месте: смотрит влево — ближе к нам левая, вправо — правая.
  // tones — пять тонов [r, g, b] рюкзака на спине от света к тени; без них герой налегке.
  function build(carry: Hand | false = false, tones: number[][] | null = null): Record<Dir, Pixels[]> {
    const pack: Tones = tones && withPack(tones);
    const frames: Record<Dir, Pixels[]> = { down: [], up: [], left: [], right: [] };
    for (let f = 0; f < 5; f++) {
      frames.down.push(frontFrame('down', f, false, carry, pack));
      frames.up.push(frontFrame('up', f, false, carry, pack));
      frames.left.push(sideFrame(f, false, carry === 'left', pack));
      frames.right.push(mirror(sideFrame(f, false, carry === 'right', pack)));
    }
    frames.down.push(frontFrame('down', 0, true, carry, pack)); frames.up.push(frames.up[0]!);   // кадр 5 — моргнул
    frames.left.push(sideFrame(0, true, carry === 'left', pack)); frames.right.push(mirror(sideFrame(0, true, carry === 'right', pack)));
    return frames;
  }

  // Сидит у костра: тот же кадр, но на REST строк ниже — без подола плаща и штанов, сапоги сразу под плащом.
  const REST = 8, BOOTS = 3;
  function seated(buf: Pixels): Pixels {
    const out = blank(), row = FW * 4;
    out.set(buf.subarray(0, (FH - REST - BOOTS) * row), REST * row);
    out.set(buf.subarray((FH - BOOTS) * row), (FH - BOOTS) * row);
    return out;
  }

  // Где кисть руки side в кадре f (в координатах кадра) и в какую сторону от тела она смотрит (out: -1 — влево, 1 — вправо).
  // Руки настоящие, а не как в зеркале: лицом к нам правая — слева на экране, со спины — справа; сбоку ближе к нам та, в
  // сторону которой он смотрит, а другая — по ту сторону тела (far): вещь в ней рисуют до героя, чуть позади ближней руки,
  // и качается она в противоход. По ним игра кладёт герою в руку вещь (held-art.ts). Числа — те же, что у рукавов
  // в frontFrame и sideFrame: кисть в седьмой строке рукава. Сидя у костра рука лежит на коленях.
  function fist(dir: Dir, side: Hand, f: number, rest: boolean): { x: number; y: number; out: -1 | 1; far: boolean } {
    if (rest) f = 0;
    const lap = rest ? 2 : 0;
    if (dir === 'down' || dir === 'up') return (dir === 'down') === (side === 'right')
      ? { x: 3, y: 25 + lap + (f === 1 ? 2 : 0), out: -1, far: false }        // левый рукав на экране
      : { x: 15, y: 25 + lap + (f === 3 ? 2 : 0), out: 1, far: false };       // правый
    const far = (dir === 'right') !== (side === 'right'), g = far ? (f === 1 ? 3 : f === 3 ? 1 : f) : f;
    const x = (g === 1 ? 7 : g === 3 ? 11 : 9) + 2 + (far ? 3 : 0), y = 27 + (g === 2 || g === 4 ? -1 : 0);
    return dir === 'left' ? { x, y, out: -1, far } : { x: FW - 1 - x, y, out: 1, far };
  }
  const hand = (dir: Dir, f: number, rest = false) => fist(dir, 'right', f, rest);    // правая
  const hand2 = (dir: Dir, f: number, rest = false) => fist(dir, 'left', f, rest);    // левая

  // Рука с ведром для стороны dir: { w, h, data (RGBA), x, y } в координатах кадра и место дна ведра (от столбца-опоры ANCHOR).
  // Спереди и со спины нарисована правая, левая — та же, отражённая на другой бок; сбоку — ближняя рука, а в дальней
  // (far) ведро то же, но на три пикселя дальше за спиной: игра рисует его до героя, и тело его закрывает.
  const ANCHOR = 9;
  function carryRig(dir: Dir, hand: Hand = 'left'): Rig & { far: boolean } {
    const front = dir === 'down' || dir === 'up', far = !front && (dir === 'right') !== (hand === 'right');
    const src = CARRY[dir === 'right' ? 'left' : dir], flip = front ? hand === 'left' : dir === 'right';
    const px = pixels(flip ? mirrorMap(src.arm.map) : src.arm.map), back = far ? (dir === 'left' ? 3 : -3) : 0;
    const x = (flip ? FW - src.arm.at[0] - px.w : src.arm.at[0]) + back;
    return { ...px, x, y: src.arm.at[1], bucket: [(flip ? FW - 1 - 2 * ANCHOR - src.bucket[0] : src.bucket[0]) + back, src.bucket[1]], far };
  }
  // Рюкзак на спине сидящего рыбака: накладка и её место на спрайте fisher.png.
  function seatPack(tones: number[][]): Patch {
    return { ...pixels(PACK.left.map, withPack(tones)), x: SEAT_PACK[0], y: SEAT_PACK[1] };
  }

  return { FW, FH, PAL, REST, build, seated, hand, hand2, carryRig, seatPack };
})();
