// Рыбалка на экране. Правила ведёт сервер (@fh/shared/fishing.ts), здесь только фазы для картинки:
// событие сервера переключает фазу, а промежуточные шаги анимации (заброс → ожидание, вываживание → полёт → ведро)
// идут сами по таймерам TIME — тем же, что на сервере.

import { TIME, type Catch, type FishingEvent, type Phase } from '@fh/shared';

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
  if (phase === 'rest') { ctx.drawImage(art.line.img, art.line.x, art.line.y); return; }
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
    const k = Math.min(1, st.t / TIME.pull), e = 1 - (1 - k) * (1 - k);
    const s = art.fish[st.fish.id]!.up, fy = Math.round(waterY - 2 - (waterY - tipY - 10) * e);
    line(tipY + 1, fy);
    ctx.drawImage(s, x - (s.width >> 1), fy);
    if (k < 0.5) splash();
    ripple(ctx, x, waterY + 1, Math.floor(k * 5), 1 - k);
  } else if (phase === 'fly' && st.fish && geo.bucket) {
    const k = Math.min(1, st.t / TIME.fly);
    const ax = x, ay = tipY + 8, bx = geo.bucket.x, by = geo.bucket.y, mx = (ax + bx) / 2, my = Math.min(ay, by) - 30;
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
