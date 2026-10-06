// Герой — рыбак в жёлтом плаще с картинки-образца.
// Голова в три четверти (ракурсы «влево»/«вправо») снята с картинки пиксель в пиксель,
// вид спереди, со спины и туловище с ногами дорисованы той же палитрой.
// Кадр 19×34, точка опоры (ступни) — середина нижней строки.

const HERO = (() => {
  const PAL = {
    o: '240702', D: '19141d', n: '481e0c', N: '743d27', b: '9d613b',   // контур, тёмное, волосы и сапоги
    h: '1d3f56', k: '2c5a7a',                                          // штаны
    R: '904c07', H: 'c27709', r: 'ca8523', O: 'eda50b', s: 'e7a62c',   // тени плаща
    Y: 'e1b054', Z: 'f6c12a', W: 'fac708',                             // свет плаща
    y: 'e9a37c', S: 'cd8d68',                                          // кожа
  };
  const FW = 19, FH = 34;

  const HEAD = {
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
  const BODY = {
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
  const CARRY = {
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

  function rgb(hex) { return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]; }
  const COLORS = {}; for (const k in PAL) COLORS[k] = rgb(PAL[k]);

  function blank() { return new Uint8ClampedArray(FW * FH * 4); }
  function stamp(buf, map, ox, oy) {
    for (let j = 0; j < map.length; j++) {
      const row = map[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]; if (ch === '.') continue;
        const x = ox + i, y = oy + j; if (x < 0 || y < 0 || x >= FW || y >= FH) continue;
        const c = COLORS[ch]; if (!c) throw new Error('hero: нет цвета "' + ch + '"');
        const o = (y * FW + x) * 4; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
      }
    }
  }
  function mirror(buf) {
    const out = blank();
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const a = (y * FW + x) * 4, b = (y * FW + (FW - 1 - x)) * 4;
      out[b] = buf[a]; out[b + 1] = buf[a + 1]; out[b + 2] = buf[a + 2]; out[b + 3] = buf[a + 3];
    }
    return out;
  }
  function mirrorMap(map) { return map.map(r => r.split('').reverse().join('')); }

  // Кадры: 0 — стоит, 1..4 — шаг (1 и 3 — опора на разные ноги, 2 и 4 — проход), 5 — стоит, моргнув.
  // Закрытые глаза: [строка, столбец] зрачков в карте головы.
  const EYES = { down: [[10, 7], [11, 7], [10, 11], [11, 11]], left: [[11, 5], [12, 5], [13, 5], [11, 9], [12, 9], [13, 9]] };
  function blinkHead(dir) {
    const rows = HEAD[dir].map(r => r.split(''));
    const mid = dir === 'down' ? 11 : 12;
    for (const [r, c] of EYES[dir] || []) rows[r][c] = r === mid ? 'N' : 'y';
    return rows.map(r => r.join(''));
  }
  function frontFrame(dir, f, blink, carry) {
    const buf = blank();
    const step = f === 1 || f === 3, dip = step ? 1 : 0;
    const legs = LEGS[dir === 'down' ? 'front' : 'back'];
    let lmap = step ? legs.step : legs.stand; if (f === 3) lmap = mirrorMap(lmap);
    stamp(buf, lmap, 0, 28);
    stamp(buf, BODY[dir], 0, 17 + dip);
    // руки: противоход ногам
    const swing = f === 1 ? 1 : f === 3 ? -1 : 0;
    const busy = carry ? (dir === 'down' ? 'left' : 'right') : '';     // эта рука держит ведро и не качается
    if (busy !== 'left') stamp(buf, ARM, 2, 18 + dip - (swing > 0 ? 0 : swing < 0 ? 1 : 0) + (swing > 0 ? 1 : 0));
    if (busy !== 'right') stamp(buf, ARM, 14, 18 + dip - (swing < 0 ? 0 : swing > 0 ? 1 : 0) + (swing < 0 ? 1 : 0));
    stamp(buf, blink ? blinkHead(dir) : HEAD[dir], 0, dip);
    return buf;
  }
  function sideFrame(f, blink, carry) {
    const buf = blank();
    const lift = f === 2 || f === 4 ? -1 : 0;                 // на проходе тело чуть выше
    const lmap = f === 0 ? LEGS.side.stand : (f === 1 || f === 3) ? LEGS.side.stride : LEGS.side.pass;
    stamp(buf, lmap, 0, 28);
    stamp(buf, BODY.left, 0, 17 + lift + 1);
    const armX = f === 1 ? 7 : f === 3 ? 11 : 9;              // рука вперёд / назад
    if (!carry) stamp(buf, ARM_SIDE, armX, 19 + lift + 1);
    stamp(buf, blink ? blinkHead('left') : HEAD.left, 0, lift + 1);
    return buf;
  }

  // carry = true — те же кадры без руки, занятой ведром (её рисует игра поверх ведра).
  function build(carry) {
    const frames = { down: [], up: [], left: [], right: [] };
    for (let f = 0; f < 5; f++) {
      frames.down.push(frontFrame('down', f, false, carry));
      frames.up.push(frontFrame('up', f, false, carry));
      const side = sideFrame(f, false, carry);
      frames.left.push(side);
      frames.right.push(mirror(side));
    }
    const wink = sideFrame(0, true, carry);                 // кадр 5 — моргнул
    frames.down.push(frontFrame('down', 0, true, carry)); frames.up.push(frames.up[0]);
    frames.left.push(wink); frames.right.push(mirror(wink));
    return frames;
  }

  // Рука с ведром для стороны dir: { w, h, data (RGBA), x, y } в координатах кадра и место дна ведра.
  function carryRig(dir) {
    const src = CARRY[dir === 'right' ? 'left' : dir], flip = dir === 'right';
    const map = flip ? mirrorMap(src.arm.map) : src.arm.map, w = map[0].length, hgt = map.length;
    const data = new Uint8ClampedArray(w * hgt * 4);
    for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
      const ch = map[j][i]; if (ch === '.') continue;
      const c = COLORS[ch], o = (j * w + i) * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
    const x = flip ? FW - src.arm.at[0] - w : src.arm.at[0];
    return { w, h: hgt, data, x, y: src.arm.at[1], bucket: [flip ? -src.bucket[0] : src.bucket[0], src.bucket[1]] };
  }

  return { FW, FH, PAL, build, carryRig };
})();

if (typeof module !== 'undefined') module.exports = HERO;
