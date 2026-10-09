// Дом рыбака изнутри (INDOOR в shared/src/indoor.ts): та же палитра, что у дома снаружи, — дощатые стены, синяя дверь,
// окна в рыжих рамах с голубыми стёклами, каменный низ, вывеска-рыба. Камин в задней стене: огонь в нём горит всегда,
// по бокам — два кресла. В углу кровать, рядом — холодильник, посередине стол с табуретками, у стен бочки, ящик и сундук.
// Только картинка: где стены и мебель, решают числа INDOOR, по ним же ходят клиент и сервер.
// Комната рисуется один раз в фон (стены, пол, окна, ковёр); мебель — отдельными картинками, их движок ставит в общую
// очередь по нижнему краю (base): кто стоит выше этого края, того мебель закрывает.

import { INDOOR } from '@fh/shared';

type Ctx = CanvasRenderingContext2D;
const { W, H, room: R, doorway: DW, blocks: BL, chairs: CHAIRS } = INDOOR;
const DY = R.top - 30;                                  // украшения стены нарисованы для потолка на 30-й строке — сдвигаются вместе с ним

const PAL = {
  void: '140c07',
  plank: ['8a5530', '7c4a28', '946038', '83502c'], seam: '4e2c16', grain: '6b3f20',
  beam: '5a3418', beamLit: '7c4a28', post: '5e3a1e', postLit: '7a4a28',
  floor: ['a8743f', '9c6a38', 'b07c45'], floorSeam: '6b4322', floorDark: '8a5a30',
  stone: ['8d8a80', 'a5a196', '7c796f'], mortar: '5d5a52', soot: '2a1c14',
  frame: 'c27c3a', frameDark: '6b3d1a', glassDay: ['8cc6e8', 'b9def2'], glassNight: ['1f2f4f', '2c4268'],
  blue: '2f5f8f', blueLit: '3d7ab0', blueDark: '1f3f63', tan: 'd79b5e', tanDark: 'a86f3a', cream: 'e8e0d0', creamDark: 'c4b8a2',
  red: 'a8402e', redDark: '7a2a1e', gold: 'c9a15a', goldDark: '8f6d34', iron: '6f6c64', ironDark: '45433e',
  green: '4f7a32', greenDark: '35561f', grass: '6b9a3a',
  flame: { red: 'e8641a', orange: 'f8a11c', yellow: 'ffe07a', ember: 'c8401a' }, log: '6b3d1e', logDark: '3f2212',
};

const noise = (n: number, s: number) => { const v = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
const make = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// Картинка мебели: рисуется в своих координатах (левый верх — ox, oy в кадре), base — её нижний край для очереди.
export interface Piece { img: HTMLCanvasElement; x: number; y: number; base: number }

export function createInteriorView() {
  const bg = make(W, H), b = bg.getContext('2d')!;
  let c: Ctx = b;
  const fill = (hex: string, x: number, y: number, w: number, h: number) => { c.fillStyle = '#' + hex; c.fillRect(x, y, w, h); };

  // ---------- стены и пол ----------
  fill(PAL.void, 0, 0, W, H);
  // задняя стена: вертикальные доски с щелями и сучками, сверху потолочная балка, посередине поперечина, внизу плинтус
  for (let x = R.x0, i = 0; x < R.x1; x += 10, i++) {
    fill(PAL.plank[i % PAL.plank.length]!, x, R.top, 10, R.floor - R.top);
    fill(PAL.seam, x, R.top, 1, R.floor - R.top);
    for (let k = 0; k < 5; k++) { const gy = R.top + 8 + Math.floor(noise(i, k) * (R.floor - R.top - 16)); fill(PAL.grain, x + 2 + Math.floor(noise(i, k + 9) * 6), gy, 1, 3 + Math.floor(noise(k, i) * 5)); }
    if (noise(i, 31) < 0.3) { const ky = R.top + 20 + Math.floor(noise(i, 32) * 70); fill(PAL.seam, x + 4, ky, 2, 2); fill(PAL.grain, x + 3, ky - 1, 4, 1); }
  }
  fill(PAL.beam, R.x0, R.top, R.x1 - R.x0, 10); fill(PAL.beamLit, R.x0, R.top + 8, R.x1 - R.x0, 2); fill(PAL.seam, R.x0, R.top + 10, R.x1 - R.x0, 1);
  fill(PAL.beam, R.x0, DY + 100, R.x1 - R.x0, 5); fill(PAL.beamLit, R.x0, DY + 100, R.x1 - R.x0, 1); fill(PAL.seam, R.x0, DY + 105, R.x1 - R.x0, 1);
  // низ стены — каменный, как у дома снаружи
  for (let y = R.floor - 14, row = 0; y < R.floor; y += 7, row++) for (let x = R.x0 - (row % 2) * 6, i = 0; x < R.x1; x += 12, i++) {
    fill(PAL.stone[(i + row) % 3]!, Math.max(R.x0, x), y, Math.min(11, R.x1 - Math.max(R.x0, x)), 6);
    fill(PAL.mortar, Math.max(R.x0, x), y + 6, Math.min(12, R.x1 - Math.max(R.x0, x)), 1);
  }
  // пол: доски поперёк, стыки вразбежку
  for (let y = R.floor, row = 0; y < R.bottom; y += 8, row++) {
    fill(PAL.floor[row % 3]!, R.x0, y, R.x1 - R.x0, 8); fill(PAL.floorSeam, R.x0, y + 7, R.x1 - R.x0, 1);
    for (let x = R.x0 + 20 + (row * 37) % 50; x < R.x1; x += 52 + (row % 3) * 6) { fill(PAL.floorSeam, x, y, 1, 7); fill(PAL.floorDark, x + 1, y, 1, 7); }
    for (let k = 0; k < 6; k++) fill(PAL.floorDark, R.x0 + Math.floor(noise(row, k) * (R.x1 - R.x0 - 8)), y + 2 + (k % 4), 4 + Math.floor(noise(k, row) * 6), 1);
  }
  // тень от задней стены на полу
  c.fillStyle = 'rgba(20, 10, 4, 0.25)'; c.fillRect(R.x0, R.floor, R.x1 - R.x0, 4);
  // боковые стены — толстые брёвна от потолка до пола; нижняя стена с дверным проёмом
  for (const x of [R.x0 - 12, R.x1]) {
    fill(PAL.post, x, R.top - 6, 12, R.bottom + 14 - R.top + 6); fill(PAL.postLit, x + (x < R.x0 ? 9 : 1), R.top - 6, 2, R.bottom + 14 - R.top + 6);
    for (let y = R.top; y < R.bottom + 14; y += 16) fill(PAL.seam, x, y, 12, 1);
  }
  fill(PAL.post, R.x0 - 12, R.top - 6, R.x1 - R.x0 + 24, 6); fill(PAL.postLit, R.x0 - 12, R.top - 2, R.x1 - R.x0 + 24, 1);
  fill(PAL.post, R.x0 - 12, R.bottom, R.x1 - R.x0 + 24, 14); fill(PAL.postLit, R.x0 - 12, R.bottom, R.x1 - R.x0 + 24, 2); fill(PAL.seam, R.x0 - 12, R.bottom + 13, R.x1 - R.x0 + 24, 1);
  // дверной проём: снаружи трава и свет, по бокам синие косяки, на полу — коврик
  fill(PAL.grass, DW.x0, R.bottom, DW.x1 - DW.x0, 14); fill(PAL.green, DW.x0, R.bottom + 8, DW.x1 - DW.x0, 6);
  fill(PAL.stone[1]!, DW.x0, R.bottom, DW.x1 - DW.x0, 3); fill(PAL.mortar, DW.x0, R.bottom + 3, DW.x1 - DW.x0, 1);
  for (const x of [DW.x0 - 4, DW.x1]) { fill(PAL.blueDark, x, R.bottom - 2, 4, 16); fill(PAL.blueLit, x + 1, R.bottom - 2, 2, 16); }
  { const mx = DW.x0 - 2, my = R.bottom - 15, mw = DW.x1 - DW.x0 + 4;
    fill(PAL.goldDark, mx, my, mw, 12); fill(PAL.gold, mx + 1, my + 1, mw - 2, 10);
    for (let k = 0; k < 4; k++) fill(PAL.tanDark, mx + 2, my + 2 + k * 2 + (k > 1 ? 1 : 0), mw - 4, 1); }

  // ---------- стена: окна, вывеска, удочки, фонарь, плащ ----------
  // окна: рыжая рама, крестовина; стёкла рисуются каждый кадр (днём голубые, ночью тёмные) — здесь только рама
  const WINDOWS = [[262, DY + 52], [338, DY + 52]] as const, WIN = { w: 30, h: 32 };
  for (const [x, y] of WINDOWS) {
    fill(PAL.frameDark, x - 2, y - 2, WIN.w + 4, WIN.h + 4); fill(PAL.frame, x - 1, y - 1, WIN.w + 2, WIN.h + 2);
    fill(PAL.frameDark, x - 4, y + WIN.h + 1, WIN.w + 8, 3); fill(PAL.frame, x - 4, y + WIN.h + 1, WIN.w + 8, 1);   // подоконник
  }
  // вывеска-рыба между окнами (как над дверью снаружи)
  { const x = 300, y = DY + 62;
    fill(PAL.iron, x + 8, y - 8, 1, 7); fill(PAL.iron, x + 20, y - 8, 1, 7); fill(PAL.iron, x + 7, y - 9, 15, 1);
    for (let i = 0; i < 26; i++) {                     // тело рыбы: толще посередине, к хвосту сужается
      const half = Math.round(5.5 * Math.sin(Math.PI * Math.min(1, (i + 2) / 26)));
      fill(PAL.tanDark, x + i, y + 6 - half - 1, 1, half * 2 + 2); fill(PAL.tan, x + i, y + 6 - half, 1, half * 2);
    }
    fill(PAL.tanDark, x + 26, y + 3, 2, 6); fill(PAL.tan, x + 28, y - 1, 4, 5); fill(PAL.tan, x + 28, y + 7, 4, 5); fill(PAL.tanDark, x + 31, y - 1, 1, 13);
    fill('f0c08a', x + 4, y + 2, 14, 2); fill(PAL.seam, x + 4, y + 4, 2, 2); fill(PAL.tanDark, x + 9, y + 1, 1, 10); fill(PAL.tanDark, x + 14, y + 2, 1, 8);
    fill(PAL.tanDark, x + 12, y - 2, 6, 2); fill(PAL.tanDark, x + 13, y + 11, 5, 2); }
  // две удочки на крюках под окнами
  for (const [y, reel] of [[DY + 112, 'c9a15a'], [DY + 122, '8cc6e8']] as const) {
    const x0 = 258;
    fill(PAL.ironDark, x0 + 16, y - 3, 2, 4); fill(PAL.ironDark, x0 + 98, y - 3, 2, 4);
    fill(PAL.frameDark, x0, y, 112, 2); fill(PAL.tan, x0, y, 92, 1); fill('432115', x0, y - 1, 14, 3);    // удилище с рукоятью
    fill(PAL.cream, x0 + 112, y, 1, 6); fill(PAL.iron, x0 + 111, y + 6, 3, 2);                             // леска с грузилом
    fill(reel, x0 + 18, y + 2, 4, 4); fill(PAL.seam, x0 + 19, y + 3, 2, 2);
  }
  // фонарь на цепи у левого окна (не горит: свет даёт камин)
  { const x = 206, y = DY + 41;
    fill(PAL.iron, x + 3, y, 1, 10); fill(PAL.ironDark, x, y + 10, 7, 2); fill(PAL.ironDark, x, y + 12, 1, 8); fill(PAL.ironDark, x + 6, y + 12, 1, 8);
    fill(PAL.glassNight[1]!, x + 1, y + 12, 5, 8); fill(PAL.ironDark, x, y + 20, 7, 2); }
  // крючки у правой стены: шляпа и плащ, как у рыбака
  { const x = 470, y = DY + 56;
    fill(PAL.iron, x, y, 2, 2); fill(PAL.iron, x + 10, y, 2, 2);
    fill('c27709', x - 3, y + 2, 9, 24); fill('eda50b', x - 2, y + 2, 4, 22); fill('904c07', x - 3, y + 24, 9, 2);
    fill('c27709', x + 6, y - 1, 10, 3); fill('eda50b', x + 8, y - 4, 6, 3); }
  // камин: каменная кладка от пола до потолка, полка, тёмный зев (огонь рисуется каждый кадр)
  const FX = BL.hearth![0], FW2 = BL.hearth![2], fire = INDOOR.fire;
  for (let y = R.top + 2, row = 0; y < R.floor; y += 7, row++) {
    const narrow = y < DY + 92 ? 10 : 0;   // труба уже, чем очаг
    for (let x = FX + 4 + narrow - (row % 2) * 5, i = 0; x < FX + FW2 - 4 - narrow; x += 11, i++) {
      const x0 = Math.max(FX + 4 + narrow, x), w = Math.min(10, FX + FW2 - 4 - narrow - x0);
      if (w > 0) { fill(PAL.stone[(i * 7 + row) % 3]!, x0, y, w, 6); fill(PAL.mortar, x0, y + 6, w + 1, 1); fill(PAL.mortar, x0 + w, y, 1, 6); }
    }
  }
  fill(PAL.frameDark, FX, DY + 92, FW2, 5); fill(PAL.frame, FX, DY + 92, FW2, 2); fill(PAL.seam, FX + 2, DY + 97, FW2 - 4, 1);   // полка над очагом
  fill(PAL.cream, FX + 8, DY + 85, 3, 7); fill(PAL.flame.yellow, FX + 9, DY + 83, 1, 2);                                  // свеча
  fill(PAL.tanDark, FX + 56, DY + 84, 10, 8); fill(PAL.tan, FX + 57, DY + 85, 8, 2);                                        // горшок
  fill(PAL.iron, FX + 30, DY + 86, 18, 2); fill(PAL.ironDark, FX + 31, DY + 88, 2, 4); fill(PAL.ironDark, FX + 45, DY + 88, 2, 4);   // сковорода
  const MOUTH = { x: fire.x - 20, y: DY + 108, w: 40, h: R.floor - DY - 108 };
  fill(PAL.mortar, MOUTH.x - 2, MOUTH.y - 3, MOUTH.w + 4, MOUTH.h + 3);
  fill(PAL.soot, MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h); fill(PAL.soot, MOUTH.x + 3, MOUTH.y - 2, MOUTH.w - 6, 2);
  fill('1a100a', MOUTH.x + 4, MOUTH.y + 2, MOUTH.w - 8, MOUTH.h - 4);
  // ковёр посреди комнаты
  { const x = 300, y = DY + 244, w = 92, h = 44;
    fill(PAL.goldDark, x, y, w, h); fill(PAL.gold, x + 1, y + 1, w - 2, h - 2); fill(PAL.blueDark, x + 4, y + 4, w - 8, h - 8); fill(PAL.blue, x + 5, y + 5, w - 10, h - 10);
    for (let k = 0; k < 5; k++) { fill(PAL.gold, x + 14 + k * 16, y + 14, 6, 2); fill(PAL.gold, x + 16 + k * 16, y + 12, 2, 6); fill(PAL.redDark, x + 16 + k * 16, y + 14, 2, 2); }
    fill(PAL.blueLit, x + 6, y + 6, w - 12, 1); fill(PAL.blueLit, x + 6, y + h - 10, w - 12, 1);
    for (let k = 0; k < w; k += 3) { fill(PAL.gold, x + k, y - 2, 1, 2); fill(PAL.gold, x + k, y + h, 1, 2); } }

  // ---------- мебель ----------
  const piece = (box: [number, number, number, number], top: number, draw: (x0: number, y0: number) => void, extraBelow = 0): Piece => {
    const [x, y, w, h] = box, y0 = y - top, img = make(w + 4, h + top + extraBelow);
    c = img.getContext('2d')!;
    draw(-x + 2, -y0);
    c = b;
    return { img, x: x - 2, y: y0, base: y + h };
  };
  const at = (ox: number, oy: number) => (hex: string, x: number, y: number, w: number, h: number) => fill(hex, x + ox, y + oy, w, h);
  const shadow = (x: number, y: number, w: number) => { c.fillStyle = 'rgba(20, 10, 4, 0.3)'; c.fillRect(x, y, w, 3); };

  // камин спереди: каменный под и решётка — перед ним стоят и сидят
  const hearth = piece(BL.hearth!, 0, (ox, oy) => {
    const f = at(ox, oy), [x, y, w, h] = BL.hearth!;
    for (let k = 0; k < 3; k++) { f(PAL.stone[k]!, x + k * (w / 3), y, w / 3 - 1, h - 2); f(PAL.stone[(k + 1) % 3]!, x + 2 + k * (w / 3), y + 2, w / 3 - 5, 4); }
    f(PAL.mortar, x, y + h - 2, w, 2); f(PAL.stone[1]!, x, y, w, 1);
    for (let k = 0; k < 6; k++) f(PAL.ironDark, MOUTH.x + 3 + k * 7, y + 2, 2, 6);   // решётка
    for (const [lx, ly] of [[x + 4, y + 10], [x + 2, y + 13], [x + 8, y + 13], [x + 5, y + 16]] as const) {   // поленница слева
      f(PAL.logDark, lx, ly, 12, 3); f(PAL.log, lx + 1, ly, 10, 2); f('c9965a', lx, ly, 2, 3); f(PAL.tanDark, lx, ly + 1, 1, 1);
    }
    f(PAL.ironDark, MOUTH.x + 2, y + 7, MOUTH.w - 4, 1);
    f(PAL.log, x + w - 16, y + 8, 12, 3); f(PAL.logDark, x + w - 16, y + 11, 12, 1); f(PAL.log, x + w - 14, y + 4, 10, 3);   // поленья наготове
  });
  // кровать: изголовье у стены, белая подушка, лоскутное одеяло
  const bed = piece(BL.bed!, 24, (ox, oy) => {
    const f = at(ox, oy), [x, y, w, h] = BL.bed!;
    f(PAL.frameDark, x, y - 24, w, 26); f(PAL.frame, x + 2, y - 22, w - 4, 3); f(PAL.frameDark, x + 4, y - 18, 2, 18); f(PAL.frameDark, x + w - 6, y - 18, 2, 18);
    f(PAL.frameDark, x, y, w, h); f(PAL.creamDark, x + 3, y + 1, w - 6, 12); f(PAL.cream, x + 6, y + 2, w - 12, 9); f(PAL.creamDark, x + 8, y + 9, w - 16, 1);
    f(PAL.redDark, x + 2, y + 13, w - 4, h - 19);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) f([PAL.red, PAL.gold, PAL.blue, PAL.tan][(i + j * 3) % 4]!, x + 4 + i * 12, y + 15 + j * 9, 11, 8);
    f(PAL.cream, x + 3, y + 13, w - 6, 2);
    f(PAL.frameDark, x, y + h - 8, w, 8); f(PAL.frame, x + 1, y + h - 8, w - 2, 2); f(PAL.seam, x, y + h - 1, w, 1);
    shadow(x + ox, y + h + oy, w);
  }, 3);
  // стол на ножках, на нём тарелка с жареной рыбой и кружка; две табуретки
  const table = piece(BL.table!, 18, (ox, oy) => {
    const f = at(ox, oy), [x, y, w] = BL.table!;
    c.fillStyle = 'rgba(20, 10, 4, 0.3)'; c.fillRect(x + ox + 2, y + oy + 15, w - 4, 3);
    f(PAL.frameDark, x + 3, y, 3, 18); f(PAL.frameDark, x + w - 6, y, 3, 18);
    f(PAL.frameDark, x, y - 18, w, 20); f(PAL.frame, x, y - 18, w, 16); f(PAL.tan, x + 1, y - 17, w - 2, 1);
    for (let k = 0; k < 3; k++) f(PAL.tanDark, x + 2, y - 13 + k * 5, w - 4, 1);
    f(PAL.cream, x + 10, y - 15, 18, 9); f(PAL.creamDark, x + 10, y - 7, 18, 1);
    f('b5652a', x + 13, y - 13, 12, 4); f('8a4a1e', x + 24, y - 14, 3, 6); f('d9893f', x + 14, y - 13, 6, 1);
    f(PAL.blueDark, x + 40, y - 17, 7, 9); f(PAL.blueLit, x + 41, y - 16, 2, 6); f(PAL.blueDark, x + 47, y - 15, 2, 4);
  }, 2);
  const sy = BL.table![1] + 14;                         // табуретки — у края стола, ближе к нам
  const stool = (sx: number): Piece => piece([sx, sy, 14, 6], 8, (ox, oy) => {
    const f = at(ox, oy);
    c.fillStyle = 'rgba(20, 10, 4, 0.3)'; c.fillRect(sx + ox + 1, sy + oy + 5, 12, 2);
    f(PAL.frameDark, sx + 2, sy - 4, 2, 9); f(PAL.frameDark, sx + 10, sy - 4, 2, 9);
    f(PAL.frameDark, sx, sy - 8, 14, 5); f(PAL.frame, sx, sy - 8, 14, 3);
  }, 2);
  // бочки у правой стены — как у дома снаружи
  const barrels = piece(BL.barrels!, 14, (ox, oy) => {
    const f = at(ox, oy), [x, y, w, h] = BL.barrels!;
    for (const [bx, by] of [[x - 2, y - 10], [x + 8, y + 4]] as const) {   // дальняя бочка выше, ближняя — ниже и поверх
      const bh = 26, bw = 20;
      for (let j = 0; j < bh; j++) {                    // бочка пузатая: посередине шире
        const bulge = Math.round(2 * Math.sin(Math.PI * j / (bh - 1))), x0 = bx + 2 - bulge, w2 = bw - 4 + bulge * 2;
        f(PAL.seam, x0, by + j, w2, 1); f(PAL.plank[0]!, x0 + 1, by + j, w2 - 2, 1); f(PAL.plank[2]!, x0 + 3, by + j, 3, 1); f(PAL.grain, x0 + w2 - 5, by + j, 2, 1);
        if (j === 5 || j === 6 || j === bh - 7 || j === bh - 6) f(PAL.ironDark, x0, by + j, w2, 1);
      }
      f(PAL.seam, bx + 2, by - 3, bw - 4, 4); f(PAL.plank[1]!, bx + 3, by - 2, bw - 6, 2); f(PAL.plank[3]!, bx + 5, by - 2, bw - 10, 1);
    }
    c.fillStyle = 'rgba(20, 10, 4, 0.3)'; c.fillRect(x + ox, y + h + oy - 2, w, 3);
  }, 2);
  // ящик у двери
  const crate = piece(BL.crate!, 12, (ox, oy) => {
    const f = at(ox, oy), [x, y, w, h] = BL.crate!;
    c.fillStyle = 'rgba(20, 10, 4, 0.3)'; c.fillRect(x + ox, y + h + oy - 1, w, 3);
    f(PAL.frameDark, x, y - 12, w, h + 12); f(PAL.floor[2]!, x + 2, y - 10, w - 4, h + 8);
    for (let k = 0; k < w - 4; k++) { f(PAL.tanDark, x + 2 + k, y - 10 + Math.round(k * (h + 8) / (w - 4)), 2, 1); f(PAL.tanDark, x + 2 + k, y - 2 + h - Math.round(k * (h + 8) / (w - 4)), 2, 1); }
    f(PAL.frameDark, x + 2, y - 2 - 2 + (h >> 1), w - 4, 2);
    f(PAL.tan, x + 1, y - 11, w - 2, 1);
  }, 2);
  // сундук у левой стены: обитый железом, с медным замком
  const chest = piece(BL.chest!, 10, (ox, oy) => {
    const f = at(ox, oy), [x, y, w, h] = BL.chest!;
    c.fillStyle = 'rgba(20, 10, 4, 0.3)'; c.fillRect(x + ox, y + h + oy - 1, w, 3);
    f(PAL.seam, x, y - 10, w, h + 10); f(PAL.plank[2]!, x + 1, y - 9, w - 2, 9); f(PAL.plank[0]!, x + 1, y + 1, w - 2, h - 2);
    f(PAL.ironDark, x + 5, y - 10, 3, h + 10); f(PAL.ironDark, x + w - 8, y - 10, 3, h + 10); f(PAL.seam, x, y, w, 1);
    f(PAL.gold, x + (w >> 1) - 2, y - 2, 5, 6); f(PAL.goldDark, x + (w >> 1), y + 1, 1, 2);
  }, 2);
  // холодильник: пузатый, кремовый, как в старых домах, — морозилка сверху, хромовые ручки, магнит-рыбка
  const FR = BL.fridge!, FTOP = 60;                     // высота над полом: дверцы и крышка
  const fridge = piece(FR, FTOP, (ox, oy) => {
    const f = at(ox, oy), [x, y, w, h] = FR, top = y - FTOP + 2, face = top + 8, base = y + h;
    c.fillStyle = 'rgba(20, 10, 4, 0.3)'; c.fillRect(x + ox - 1, base + oy - 2, w + 3, 3);
    f(PAL.seam, x, top + 1, w, base - top - 1); f(PAL.seam, x + 1, top, w - 2, 1);   // контур со скруглёнными углами
    f(PAL.creamDark, x + 1, top + 1, w - 2, 7); f('f4eee2', x + 3, top + 2, w - 6, 3);   // крышка: видно, что он глубокий
    f(PAL.cream, x + 1, face, w - 2, base - face - 3); f(PAL.creamDark, x + w - 4, face, 3, base - face - 3);   // дверцы, справа тень
    f('f6f1e6', x + 2, face + 1, 2, base - face - 6);                                     // блик слева
    const split = face + 20;
    f(PAL.seam, x + 1, split, w - 2, 1); f(PAL.creamDark, x + 1, split + 1, w - 2, 1);    // морозилка и холодильник
    for (const [hy, hh] of [[face + 6, 9], [split + 6, 16]] as const) {                  // хромовые ручки
      f(PAL.ironDark, x + w - 8, hy, 3, hh); f('d8d8d0', x + w - 8, hy, 1, hh - 1); f('a8a8a0', x + w - 7, hy + 1, 1, hh - 2);
    }
    f(PAL.red, x + 6, face + 3, 9, 3); f(PAL.gold, x + 7, face + 4, 7, 1);                // табличка
    { const mx = x + 6, my = split + 14;                                                // магнит-рыбка
      f(PAL.blue, mx, my + 1, 6, 3); f(PAL.blueLit, mx + 1, my + 1, 3, 1); f(PAL.blue, mx + 6, my, 2, 5); f(PAL.seam, mx + 1, my + 2, 1, 1); }
    f(PAL.ironDark, x + 2, base - 3, w - 4, 2); for (let k = 0; k < w - 6; k += 2) f(PAL.iron, x + 3 + k, base - 3, 1, 1);   // решётка внизу
    f(PAL.ironDark, x + 2, base - 1, 3, 1); f(PAL.ironDark, x + w - 5, base - 1, 3, 1);  // ножки
  }, 2);
  // кресла у камина — боком к нам, лицом к огню: спинка и дальний подлокотник позади сидящего (back), ближний подлокотник —
  // перед ним (front). Бархат цвета вывески, деревянные ножки.
  const CH = { red: '9c3a2a', redLit: 'b8503a', redDark: '6e2418', wood: PAL.frameDark };
  const chairPieces = CHAIRS.flatMap((ch, i): Piece[] => {
    const box = (i ? BL.chairR : BL.chairL)!, [x, y, w, h] = box, toRight = ch.dir === 'right';
    // нарисовано для кресла лицом вправо (спинка слева); лицом влево — отражено
    const mirror = (bx: number, bw: number) => (toRight ? bx : x + w - (bx - x) - bw);
    const behind = piece([x, ch.y - 2, w, 1], ch.y - 2 - y + 30, (ox, oy) => {
      const f = at(ox, oy), g = (bx: number, by: number, bw: number, bh: number, col: string) => f(col, mirror(bx, bw), by, bw, bh);
      c.fillStyle = 'rgba(20, 10, 4, 0.3)'; c.fillRect(x + ox - 1, y + h + oy - 2, w + 2, 3);
      g(x + 2, y + h - 4, 2, 4, CH.wood); g(x + w - 4, y + h - 4, 2, 4, CH.wood);   // ножки
      g(x, ch.y - 30, 8, 36, CH.redDark); g(x + 1, ch.y - 29, 6, 33, CH.red); g(x + 2, ch.y - 28, 2, 28, CH.redLit);   // высокая спинка
      g(x, ch.y - 31, 8, 2, CH.redDark);
      g(x + 6, ch.y - 15, w - 6, 7, CH.redDark); g(x + 7, ch.y - 15, w - 8, 3, CH.redLit);   // дальний подлокотник
      g(x + 6, ch.y - 8, w - 6, 9, CH.redDark); g(x + 7, ch.y - 8, w - 8, 4, CH.red); g(x + 8, ch.y - 8, w - 12, 1, CH.redLit);   // сиденье с подушкой
    }, y + h + 3 - (ch.y - 1));
    const before = piece([x, ch.y + 2, w, 1], ch.y + 2 - y + 6, (ox, oy) => {
      const f = at(ox, oy), g = (bx: number, by: number, bw: number, bh: number, col: string) => f(col, mirror(bx, bw), by, bw, bh);
      g(x + 2, y + h - 2, 2, 3, CH.wood); g(x + w - 4, y + h - 2, 2, 3, CH.wood);
      g(x, ch.y - 7, w, 10, CH.redDark); g(x + 1, ch.y - 6, w - 2, 7, CH.red);      // ближний подлокотник и бок кресла
      g(x + 1, ch.y - 7, w - 2, 2, CH.redLit); g(x + w - 4, ch.y - 9, 4, 5, CH.redDark); g(x + w - 3, ch.y - 8, 2, 3, CH.redLit);   // валик спереди
      g(x + 3, ch.y - 2, w - 6, 1, PAL.gold);                                        // кант
    }, y + h + 3 - (ch.y + 3));
    return [behind, before];
  });
  const pieces: Piece[] = [hearth, bed, fridge, ...chairPieces, table, stool(BL.table![0] - 16), stool(BL.table![0] + BL.table![2] + 2), barrels, crate, chest];

  // ---------- то, что меняется ----------
  // Окна: днём голубое небо, ночью тёмное (dark — 0..1), в дождь по стеклу бегут капли (rain — 0..1).
  function drawWindows(ctx: Ctx, t: number, dark: number, rain: number) {
    const mix = (a: string, z: string) => { const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16); return `rgb(${[0, 2, 4].map(i => Math.round(p(a, i) + (p(z, i) - p(a, i)) * dark)).join(',')})`; };
    for (const [x, y] of WINDOWS) {
      ctx.fillStyle = mix(PAL.glassDay[0]!, PAL.glassNight[0]!); ctx.fillRect(x, y, WIN.w, WIN.h);
      ctx.fillStyle = mix(PAL.glassDay[1]!, PAL.glassNight[1]!); ctx.fillRect(x + 2, y + 2, 4, 8); ctx.fillRect(x + 17, y + 18, 3, 6);
      if (rain > 0.05) for (let i = 0; i < 6; i++) {
        const u = (t * (0.4 + noise(i, 3) * 0.3) + noise(i, 1)) % 1;
        ctx.globalAlpha = rain * 0.7; ctx.fillStyle = '#d8ecf6'; ctx.fillRect(x + 2 + Math.floor(noise(i, 2) * (WIN.w - 4)), y + Math.floor(u * WIN.h), 1, 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#' + PAL.frame; ctx.fillRect(x + (WIN.w >> 1) - 1, y, 2, WIN.h); ctx.fillRect(x, y + (WIN.h >> 1) - 1, WIN.w, 2);
    }
  }
  // Огонь в камине: поленья, угли и пламя — столбцы от краёв к середине выше, каждый дрожит; искры уходят в трубу.
  function drawFire(ctx: Ctx, t: number) {
    const fx = fire.x, fy = R.floor - 3;
    ctx.fillStyle = '#' + PAL.logDark; ctx.fillRect(fx - 12, fy, 25, 3);
    ctx.fillStyle = '#' + PAL.log; ctx.fillRect(fx - 12, fy - 1, 11, 3); ctx.fillRect(fx + 2, fy - 1, 11, 3); ctx.fillRect(fx - 5, fy - 4, 10, 3);
    ctx.fillStyle = '#' + PAL.flame.ember; ctx.fillRect(fx - 9, fy + 1, 19, 1);
    for (let i = -9; i <= 9; i++) {
      const edge = 1 - Math.abs(i) / 10, flick = 0.5 + 0.25 * Math.sin(t * 11 + i * 1.7) + 0.25 * Math.sin(t * 17.3 + i * 2.9);
      const h = Math.max(1, Math.round(26 * edge * (0.6 + 0.5 * flick))), lean = Math.round(Math.sin(t * 2.3) * edge);
      for (let j = 0; j < h; j++) {
        const k = j / h, core = edge * (1 - k);
        ctx.fillStyle = '#' + (core > 0.6 ? PAL.flame.yellow : core > 0.3 ? PAL.flame.orange : PAL.flame.red);
        ctx.fillRect(fx + i + (k > 0.6 ? lean : 0), fy - 2 - j, 1, 1);
      }
    }
    for (let i = 0; i < 4; i++) {
      const phase = t / 1.4 + i / 4, born = Math.floor(phase), u = phase - born, id = born * 4 + i;
      if (noise(id, 2) < 0.3) continue;
      ctx.globalAlpha = 1 - u; ctx.fillStyle = '#ffd27a';
      ctx.fillRect(Math.round(fx + (noise(id, 3) - 0.5) * 18), Math.round(fy - 20 - u * 18), 1, 1);
    }
    ctx.globalAlpha = 1;
    // отсвет на поду перед камином
    ctx.globalAlpha = 0.18 + 0.06 * Math.sin(t * 7); ctx.fillStyle = '#ffb45a'; ctx.fillRect(MOUTH.x - 6, R.floor + 1, MOUTH.w + 12, 18); ctx.globalAlpha = 1;
  }

  return {
    pieces,
    // Свет камина ночью (для слоя темноты): чуть выше огня, шире лампы.
    light: { x: fire.x, y: R.floor - 10, k: 3.2 },
    // Дверь изнутри — проём с ковриком: клик по ней ведёт на улицу.
    onDoor: (x: number, y: number) => x >= DW.x0 - 6 && x <= DW.x1 + 6 && y >= R.bottom - 20 && y <= R.bottom + 14,
    // Кресло под указателем (вместе со спинкой): его номер в INDOOR.chairs; -1 — не кресло.
    onChair: (x: number, y: number) => CHAIRS.findIndex((ch, i) => { const [bx, , bw, bh] = (i ? BL.chairR : BL.chairL)!, by = BL.chairL![1]; return x >= bx - 1 && x <= bx + bw + 1 && y >= ch.y - 32 && y <= by + bh; }),
    onBed: (x: number, y: number) => x >= BL.bed![0] && x <= BL.bed![0] + BL.bed![2] && y >= BL.bed![1] - 24 && y <= BL.bed![1] + BL.bed![3],
    onChest: (x: number, y: number) => x >= BL.chest![0] && x <= BL.chest![0] + BL.chest![2] && y >= BL.chest![1] - 10 && y <= BL.chest![1] + BL.chest![3],
    onFridge: (x: number, y: number) => x >= FR[0] && x <= FR[0] + FR[2] && y >= FR[1] - FTOP && y <= FR[1] + FR[3],
    // Как уложить спящего в кровать: голова на подушке (её ставит движок), а одеяло подтягивается до подбородка.
    pillow: { x: BL.bed![0] + (BL.bed![2] >> 1), y: BL.bed![1] + 1 },
    tuck(ctx: Ctx) { const [x, y, w] = BL.bed!; ctx.fillStyle = '#' + PAL.redDark; ctx.fillRect(x + 2, y + 13, w - 4, 3); ctx.fillStyle = '#' + PAL.cream; ctx.fillRect(x + 3, y + 13, w - 6, 2); },
    // Камин: клик по нему — подойти и сесть погреться.
    onHearth: (x: number, y: number) => x >= BL.hearth![0] && x <= BL.hearth![0] + BL.hearth![2] && y >= DY + 92 && y <= BL.hearth![1] + BL.hearth![3],
    // Фон комнаты с окнами и огнём — до всех, кто в ней стоит.
    draw(ctx: Ctx, t: number, dark: number, rain: number) {
      ctx.drawImage(bg, 0, 0);
      drawWindows(ctx, t, dark, rain);
      drawFire(ctx, t);
    },
  };
}
