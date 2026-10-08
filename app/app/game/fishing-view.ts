// Рыбалка на экране. Правила ведёт сервер (@fh/shared/fishing.ts), здесь только фазы для картинки:
// событие сервера переключает фазу, а промежуточные шаги анимации (заброс → ожидание, вываживание → полёт → ведро)
// идут сами по таймерам TIME — тем же, что на сервере.

import { TIME, type Catch, type FishingEvent, type Phase } from '@fh/shared';
import { rodColors } from './held-art.ts';

export interface ViewState { phase: Phase; t: number; nibble: number; fish: Catch | null }

// landed(fish) — рыба долетела до ведра (или герой встал, пока она была на леске).
export function createFishingView(landed: (fish: Catch) => void) {
  const st: ViewState = { phase: 'off', t: 0, nibble: -1, fish: null };
  const set = (phase: Phase) => { st.phase = phase; st.t = 0; };
  function land() { const fish = st.fish; st.fish = null; if (fish) landed(fish); }

  function apply(ev: FishingEvent) {
    if (st.phase === 'off') return;                                  // уже встали — поздние события не нужны
    if (ev.e === 'cast') { if (st.fish) land(); st.nibble = -1; set('cast'); }
    else if (ev.e === 'nibble') st.nibble = st.t;
    else if (ev.e === 'bite') set('bite');
    else if (ev.e === 'early' || ev.e === 'miss') { st.fish = null; set('scare'); }
    else if (ev.e === 'rest') { if (st.fish) land(); set('rest'); }
    else if (ev.e === 'hook') { st.fish = ev.fish; set('pull'); }
  }
  function sit() { st.fish = null; set('rest'); }
  function leave() { if (st.phase === 'pull' || st.phase === 'fly') land(); st.fish = null; set('off'); }
  function update(dt: number) {
    st.t += dt;
    if (st.phase === 'cast' && st.t >= TIME.cast) set('wait');
    else if (st.phase === 'pull' && st.t >= TIME.pull) set('fly');
    else if (st.phase === 'fly' && st.t >= TIME.fly) { land(); set('pause'); }
  }
  return { st, apply, sit, leave, update };
}

// ---------- отрисовка ----------
const LINE = '#d6f0fa', FOAM = '#94d6f1', INK = '#240702';
const FLOAT = ['.o.', 'oRo', 'oRo', 'oWo', '.o.'], FLOAT_COL: Record<string, string> = { o: INK, R: '#c9412d', W: '#f4f0e6' };
const BANG = ['.ooooo.', 'oWWWWWo', 'oWWRWWo', 'oWWRWWo', 'oWWRWWo', 'oWWWWWo', 'oWWRWWo', 'oWWWWWo', '.ooooo.', '...o...'];
const BANG_COL: Record<string, string> = { o: INK, W: '#fff6d8', R: '#c9412d' };
type Ctx = CanvasRenderingContext2D;
function stampMap(ctx: Ctx, map: string[], col: Record<string, string>, x: number, y: number, maxY?: number) {
  for (let j = 0; j < map.length; j++) {
    if (maxY !== undefined && y + j > maxY) break;
    const row = map[j]!;
    for (let i = 0; i < row.length; i++) { const ch = row[i]!; if (ch === '.') continue; ctx.fillStyle = col[ch]!; ctx.fillRect(x + i, y + j, 1, 1); }
  }
}
function ripple(ctx: Ctx, x: number, y: number, r: number, alpha: number) {
  ctx.globalAlpha = alpha; ctx.fillStyle = FOAM;
  ctx.fillRect(x - r - 2, y, 2, 1); ctx.fillRect(x + r + 1, y, 2, 1);
  if (r > 1) { ctx.fillRect(x - r, y + 1, 2, 1); ctx.fillRect(x + r - 1, y + 1, 2, 1); }
  ctx.globalAlpha = 1;
}

// ---------- удочка ----------
// Удилище нарисовано прямо на fisher.png. Для подсечки оно отделяется от рыбака и поворачивается вокруг рук вверх.
// В пикселях fisher.png. Удилище — прямоугольник x 0..19, y 13..25, кроме угла справа сверху (x > 15, y < 20): там лицо.
// tipLen — сколько столбцов от кончика вершинка, gripX — с какого столбца рукоять (в руках рыбака).
const ROD = { pivotX: 18, pivotY: 24, tipX: 1, tipY: 14, minY: 13, maxX: 19, maxY: 25, faceX: 15, faceY: 20, tipLen: 2, gripX: 14 };
const LIFT = 0.6, PAD = 14;                                                       // подъём (рад, ~35°) и запас холста под поднятое удилище

// Угол удочки: при подсечке — резкий рывок вверх, удочка держится, пока рыба идёт по леске, и плавно опускается, пока рыба летит в ведро.
export function rodAngle(st: ViewState): number {
  if (st.phase === 'pull') { const k = Math.min(1, st.t / (TIME.pull * 0.25)); return LIFT * (1 - (1 - k) * (1 - k)); }
  if (st.phase === 'fly') { const k = Math.min(1, st.t / (TIME.fly * 0.7)); return LIFT * (1 - k * k * (3 - 2 * k)); }
  return 0;
}
// Кончик удочки на карте; geo.x, geo.tipY — кончик в покое.
function rodTip(x: number, tipY: number, a: number) {
  const px = x + ROD.pivotX - ROD.tipX, py = tipY + ROD.pivotY - ROD.tipY, vx = ROD.tipX - ROD.pivotX, vy = ROD.tipY - ROD.pivotY;
  return { x: Math.round(px + vx * Math.cos(a) - vy * Math.sin(a)), y: Math.round(py + vx * Math.sin(a) + vy * Math.cos(a)) };
}
// Сидящий рыбак: тело отдельно, удилище отдельно; повёрнутые кадры удилища кешируются. Удилище в руках — та самая удочка,
// что у рыбака в руке: оно рисуется её цветами (rodColors), как удочка в руке на ходу, — вершинка, бланк, у рук рукоять,
// по краям контур — по линии от кончика к рукам. Удочка незнакомая — остаётся удилище с картинки.
export function createRod(fisher: HTMLImageElement) {
  const w = fisher.width, h = fisher.height;
  const canvas = (cw: number, ch: number) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const body = canvas(w, h), bctx = body.getContext('2d')!;
  bctx.drawImage(fisher, 0, 0);
  const all = bctx.getImageData(0, 0, w, h), painted = new Uint8ClampedArray(all.data.length);
  const inRod = (x: number, y: number) => x >= 0 && x <= ROD.maxX && y >= ROD.minY && y <= ROD.maxY && !(x > ROD.faceX && y < ROD.faceY);
  for (let y = ROD.minY; y <= ROD.maxY; y++) for (let x = 0; x <= ROD.maxX; x++) {
    if (!inRod(x, y)) continue;
    const i = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) { painted[i + c] = all.data[i + c]!; all.data[i + c] = 0; }
  }
  bctx.putImageData(all, 0, 0);
  // Удилище удочки kind: кадр в покое, его пиксели (для поворота) и повёрнутые кадры.
  interface RodArt { still: HTMLCanvasElement; px: Uint8ClampedArray; turned: Map<number, HTMLCanvasElement> }
  const rods = new Map<string, RodArt>();
  function rodOf(kind: string) {
    let r = rods.get(kind);
    if (r) return r;
    const col = rodColors(kind), still = canvas(w, h), sx = still.getContext('2d')!;
    if (!col) { const img = sx.createImageData(w, h); img.data.set(painted); sx.putImageData(img, 0, 0); }
    else {
      const dot = (x: number, y: number, c: string) => { if (inRod(x, y)) { sx.fillStyle = c; sx.fillRect(x, y, 1, 1); } };
      const k = (ROD.pivotY + 0.5 - ROD.tipY) / (ROD.pivotX - ROD.tipX), at = (x: number) => Math.round(ROD.tipY + (x - ROD.tipX) * k);
      dot(ROD.tipX - 1, ROD.tipY, col.o);
      for (let x = ROD.tipX; x <= ROD.maxX; x++) { dot(x, at(x) - 1, col.o); dot(x, at(x) + 1, col.o); }   // контур — над бланком и под ним
      for (let x = ROD.tipX; x <= ROD.maxX; x++) dot(x, at(x), x < ROD.tipX + ROD.tipLen ? col.t : x >= ROD.gripX ? col.h : col.p);
    }
    r = { still, px: sx.getImageData(0, 0, w, h).data, turned: new Map() };
    rods.set(kind, r);
    return r;
  }
  function turned(r: RodArt, a: number) {         // поворот без сглаживания: каждый пиксель берём из ближайшего пикселя исходника
    let c = r.turned.get(a);
    if (c) return c;
    c = canvas(w + PAD * 2, h + PAD * 2); const cx = c.getContext('2d')!, out = cx.createImageData(c.width, c.height);
    const cos = Math.cos(a), sin = Math.sin(a), rod = r.px;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const vx = x - PAD + 0.5 - ROD.pivotX, vy = y - PAD + 0.5 - ROD.pivotY;
      const sx = Math.floor(ROD.pivotX + vx * cos + vy * sin), sy = Math.floor(ROD.pivotY - vx * sin + vy * cos);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const i = (sy * w + sx) * 4, o = (y * c.width + x) * 4;
      if (!rod[i + 3]) continue;
      for (let k = 0; k < 4; k++) out.data[o + k] = rod[i + k]!;
    }
    cx.putImageData(out, 0, 0); r.turned.set(a, c);
    return c;
  }
  return {
    // a — на сколько удилище поднято (рад); rod — какая удочка в руке: null — без удочки рыбак сидит с пустыми руками
    draw(ctx: Ctx, x: number, y: number, a: number, rod: string | null) {
      ctx.drawImage(body, x, y);
      if (!rod) return;
      const r = rodOf(rod);
      if (a <= 0) ctx.drawImage(r.still, x, y);
      else ctx.drawImage(turned(r, Math.round(a / 0.03) * 0.03), x - PAD, y - PAD);
    },
  };
}
// Леска из точки в точку, по пикселю.
function seg(ctx: Ctx, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  ctx.fillStyle = LINE;
  for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + (x1 - x0) * i / (n || 1)), Math.round(y0 + (y1 - y0) * i / (n || 1)), 1, 1);
}

export interface FishArt { side: HTMLCanvasElement; sideFlip: HTMLCanvasElement; up: HTMLCanvasElement }
export interface Geo { x: number; tipY: number; waterY: number; head: { x: number; y: number }; bucket: { x: number; y: number } | null }
export interface Art { line: { img: HTMLImageElement; x: number; y: number }; fish: Record<string, FishArt> }

// Знак «клюёт!» над героем. Рисуется отдельно от остального и после ночного затемнения: его должно быть видно в любой час.
export function drawBite(ctx: Ctx, st: ViewState, head: { x: number; y: number }) {
  if (st.phase !== 'bite') return;
  const bob = Math.floor(st.t * 8) % 2;
  stampMap(ctx, BANG, BANG_COL, head.x - 3, head.y - 13 - bob);
}

// geo: леска (столбец, кончик удилища, вода), макушка сидящего героя, край ведра (или null).
export function drawFishing(ctx: Ctx, st: ViewState, time: number, geo: Geo, art: Art) {
  const { x, tipY, waterY } = geo, phase = st.phase;
  if (phase === 'off') return;
  if (phase === 'rest') return;                   // сидит и ещё не забросил — лески в воде нет
  const line = (y0: number, y1: number) => { ctx.fillStyle = LINE; ctx.fillRect(x, y0, 1, Math.max(0, y1 - y0)); };
  const float = (dy: number) => stampMap(ctx, FLOAT, FLOAT_COL, x - 1, waterY - 3 + dy, waterY + 1);
  const splash = () => {                         // всплеск с картинки — нижняя часть её лески
    const top = waterY - 4 - art.line.y, im = art.line.img;
    ctx.drawImage(im, 0, top, im.width, im.height - top, art.line.x, waterY - 4, im.width, im.height - top);
  };

  if (phase === 'cast') {
    const k = Math.max(0, (st.t - 0.18) / (TIME.cast - 0.18));
    if (k > 0) line(tipY + 1, tipY + 1 + (waterY - 3 - tipY) * Math.min(1, k * 1.15));
    if (k > 0.8) { float(0); splash(); }
  } else if (phase === 'wait' || phase === 'scare') {
    const since = st.t - st.nibble, nib = phase === 'wait' && st.nibble >= 0 && since < 0.44;   // ложный тычок
    const dy = nib ? 1 + (Math.floor(st.t * 18) % 2) : (Math.sin(time * 3.1) > 0.35 ? 1 : 0);
    line(tipY + 1, waterY - 3 + dy); float(dy);
    const age = phase === 'scare' ? st.t * 1.6 : (time * 0.7) % 1.6;
    if (age < 1) ripple(ctx, x, waterY + 1, Math.floor(age * 5), 0.9 * (1 - age));
    if (nib) ripple(ctx, x, waterY + 1, 1, 0.9);
  } else if (phase === 'bite') {
    const jerk = Math.floor(st.t * 14) % 2;
    line(tipY + 1, waterY - 1 + jerk); float(2 + jerk);
    if (jerk) splash(); else ripple(ctx, x, waterY + 1, 3, 1);
  } else if (phase === 'pull' && st.fish) {
    const k = Math.min(1, st.t / TIME.pull), e = 1 - (1 - k) * (1 - k), tip = rodTip(x, tipY, rodAngle(st));   // удочка подсекла и тянет рыбу
    const s = art.fish[st.fish.id]!.up, fy = Math.round(waterY - 2 - (waterY - tip.y - 10) * e), fx = Math.round(x + (tip.x - x) * e);
    seg(ctx, tip.x, tip.y + 1, fx, fy);
    ctx.drawImage(s, fx - (s.width >> 1), fy);
    if (k < 0.5) splash();
    ripple(ctx, x, waterY + 1, Math.floor(k * 5), 1 - k);
  } else if (phase === 'fly' && st.fish && geo.bucket) {
    const k = Math.min(1, st.t / TIME.fly);
    const top = rodTip(x, tipY, LIFT), ax = top.x, ay = top.y + 8, bx = geo.bucket.x, by = geo.bucket.y, mx = (ax + bx) / 2, my = Math.min(ay, by) - 30;
    const px = (1 - k) * (1 - k) * ax + 2 * (1 - k) * k * mx + k * k * bx, py = (1 - k) * (1 - k) * ay + 2 * (1 - k) * k * my + k * k * by;
    const f = art.fish[st.fish.id]!, s = bx >= ax ? f.sideFlip : f.side;   // головой по ходу
    ctx.drawImage(s, Math.round(px - s.width / 2), Math.round(py - s.height / 2));
  } else if (phase === 'pause' && geo.bucket && st.t < 0.3) {                // брызги над ведром
    const k = st.t / 0.3, r = Math.round(2 + k * 4), up = Math.round(k * 5 - k * k * 4);
    ctx.fillStyle = FOAM; ctx.globalAlpha = 1 - k;
    ctx.fillRect(geo.bucket.x - r, geo.bucket.y - 2 - up, 1, 1); ctx.fillRect(geo.bucket.x + r, geo.bucket.y - 2 - up, 1, 1); ctx.fillRect(geo.bucket.x, geo.bucket.y - 4 - up, 1, 1);
    ctx.globalAlpha = 1;
  }
}
