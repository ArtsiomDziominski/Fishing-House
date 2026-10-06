// Игра в браузере: рыбак ходит по миру с картинки, носит ведро и ловит рыбу с края причала — вместе с другими игроками.
// Кадр собирается в буфере 240×320 («арт-пиксели») и выводится на экран целым множителем,
// поэтому пиксели остаются ровными при любом размере окна.
//
// Сеть: свой герой ходит сразу (без ожидания сервера), шаги уходят на сервер раз в MOVE_EVERY.
// Сервер присылает «self», если с чем-то не согласен, — герой встаёт туда, где его видит сервер.
// Рыбалку ведёт сервер: клиент шлёт нажатия и показывает фазы по его событиям.
// Остальных игроков берём из состояния комнаты и плавно подтягиваем к их последнему месту.

import type { Room } from '@colyseus/sdk';
import {
  World, FISH, MOVE_EVERY, SPEED, CARRY_SPEED, REACH, seat, nearSeat, standPoint, dist,
  type Bag, type Catch, type ClientMessages, type Dir, type PlayerView, type ServerMessages, type WorldState,
} from '@fh/shared';
import { HERO } from './hero.ts';
import { createFishingView, drawFishing, type FishArt } from './fishing-view.ts';

export interface Actions { bucket: string | null; fish: string | null; hot: boolean; stand: boolean }
export type Tone = '' | 'good' | 'bad';

// Куда движок сообщает о том, что показывает интерфейс вокруг холста (его держит Pinia-хранилище).
export interface GameUI {
  bag(bag: Bag): void;
  toast(text: string, tone?: Tone, fishId?: string | null): void;
  actions(a: Actions): void;
  moved(): void;                                        // первый шаг — подсказку можно приглушить
  debug(text: string | null): void;                     // строка отладки вместо подсказки; null — убрать
  zoom(canIn: boolean, canOut: boolean): void;
  online(players: { pid: string; name: string }[]): void;
}

export interface GameHandle {
  bucketAction(): void; fishAction(): void; standUp(): void; zoom(step: number): void; destroy(): void;
}

interface Hero { x: number; y: number; dir: Dir; sitting: boolean; moving: boolean; anim: number; path: { x: number; y: number }[] | null; then: 'sit' | 'pick' | null; stuck: number }
interface Ghost { x: number; y: number; anim: number; moving: boolean; blink: number; seen: number }
interface Drawn { x: number; y: number; dir: Dir; moving: boolean; anim: number; carrying: boolean; recent: ArrayLike<string>; blink: number }

const W = World.W, H = World.H, FW = HERO.FW, FH = HERO.FH;
const ANCHOR = 9;                     // столбец кадра героя над точкой опоры
const STEP_FPS = 8;                   // кадров шага в секунду
const { fisher, bucket: B, rod } = World;

const loadImage = (src: string) => new Promise<HTMLImageElement>((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => fail(new Error('не загрузилось: ' + src)); im.src = src; });
const makeCanvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d')!;
const fromPixels = (s: { w: number; h: number; data: Uint8ClampedArray }) => { const c = makeCanvas(s.w, s.h), x = ctx2d(c), id = x.createImageData(s.w, s.h); id.data.set(s.data); x.putImageData(id, 0, 0); return c; };
const flipped = (src: HTMLCanvasElement) => { const c = makeCanvas(src.width, src.height), x = ctx2d(c); x.translate(src.width, 0); x.scale(-1, 1); x.drawImage(src, 0, 0); return c; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export async function startGame(canvas: HTMLCanvasElement, room: Room, ui: GameUI): Promise<GameHandle> {
  const ctx = ctx2d(canvas);
  const params = new URLSearchParams(location.search);
  const send = <K extends keyof ClientMessages>(type: K, ...msg: ClientMessages[K] extends void ? [] : [ClientMessages[K]]) => room.send(type as string, msg[0]);

  const frame = makeCanvas(W, H), fctx = ctx2d(frame);                        // кадр мира целиком
  const CW = 41, CX = (CW - FW) >> 1, CH = FH + 6;                            // клетка героя: кадр по центру, по бокам место под ведро
  const cell = makeCanvas(CW, CH), cctx = ctx2d(cell);
  const TOP = 3;                                                             // запас над ведром под хвосты рыб
  const pail = makeCanvas(B.w, B.h + TOP), pctx = ctx2d(pail);               // клетка ведра на земле

  const hero: Hero = { x: seat.x, y: seat.y, dir: 'down', sitting: true, moving: false, anim: 0, path: null, then: null, stuck: 0 };
  const bucket = { x: B.baseX, y: B.baseY, carried: false, home: true, blocked: null as number[] | null, pointed: false };
  let bag: Bag = { counts: {}, best: {}, total: 0, grams: 0, recent: [] };
  let pendingBag: Bag | null = null;                                         // ведро после подсечки — покажем, когда рыба долетит
  const view = { k: 1, zoom: 0, w: W, h: H, camX: 0, camY: 0 };
  const keys = new Set<string>();
  const ghosts = new Map<string, Ghost>();
  let marker: { x: number; y: number; t: number } | null = null, moved = false, debug = params.has('debug');
  let debugLayer: HTMLCanvasElement | null = null, debugFor: number[] | null | undefined, pointer: { x: number; y: number } | null = null;
  let ready = false, sendIn = 0, lastSent = { x: hero.x, y: hero.y }, frameNo = 0, onlineKey = '', onlineIn = 0, actionsKey = '';
  let raf = 0, last = 0, alive = true;

  // Сервер шлёт «self» и ведро сразу при входе — пока грузятся картинки, складываем сообщения в очередь.
  type Inbox = { [K in keyof ServerMessages]: [K, ServerMessages[K]] }[keyof ServerMessages];
  let inbox: Inbox[] | null = [];
  const receive = (m: Inbox) => { if (inbox) inbox.push(m); else handle(m); };
  const offs = [
    room.onMessage('self', (m: ServerMessages['self']) => receive(['self', m])),
    room.onMessage('bag', (m: ServerMessages['bag']) => receive(['bag', m])),
    room.onMessage('fish', (m: ServerMessages['fish']) => receive(['fish', m])),
  ];

  // ---------- картинки ----------
  const img: Record<'world' | 'fisher' | 'line' | 'bucket' | 'carry', HTMLImageElement> = {} as any;
  const files = { world: 'world.png', fisher: 'fisher.png', line: 'line.png', bucket: 'bucket.png', carry: 'bucket-carry.png' } as const;
  await Promise.all((Object.keys(files) as (keyof typeof files)[]).map(k => loadImage('/assets/' + files[k]).then(im => { img[k] = im; })));
  const heroFrames = {} as Record<Dir, HTMLCanvasElement[]>, carryFrames = {} as Record<Dir, HTMLCanvasElement[]>;
  const rigs = {} as Record<Dir, { arm: HTMLCanvasElement; x: number; y: number; bucket: [number, number] }>;
  const fishArt: Record<string, FishArt & { tail: [string, string] }> = {};
  const plain = HERO.build(false), busy = HERO.build(true);
  for (const dir of Object.keys(plain) as Dir[]) {
    heroFrames[dir] = plain[dir].map(buf => fromPixels({ w: FW, h: FH, data: buf }));
    carryFrames[dir] = busy[dir].map(buf => fromPixels({ w: FW, h: FH, data: buf }));
    const rig = HERO.carryRig(dir); rigs[dir] = { arm: fromPixels(rig), x: rig.x, y: rig.y, bucket: rig.bucket };
  }
  for (const sp of FISH.SPECIES) {
    const s = FISH.sprite(sp), side = fromPixels(s);
    fishArt[sp.id] = { side, sideFlip: flipped(side), up: fromPixels(FISH.upright(s)), tail: sp.tail };
  }
  const pailBody = makeCanvas(B.w, B.h);                                     // ведро без тени — для любого места, кроме исходного
  { const px = ctx2d(pailBody); px.drawImage(img.bucket, 0, 0); for (const [dx, dy] of B.shadow) px.clearRect(dx!, dy!, 1, 1); }

  // ---------- размер и камера ----------
  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const aw = Math.max(1, Math.floor(window.innerWidth * dpr)), ah = Math.max(1, Math.floor(window.innerHeight * dpr));
    const auto = Math.max(1, Math.floor(Math.min(aw / W, ah / H) + 0.35));   // крупнейший целый множитель, при котором мир почти весь в окне
    view.k = clamp(auto + view.zoom, 1, Math.max(auto, 12));
    view.zoom = view.k - auto;
    view.w = Math.min(W, Math.floor(aw / view.k));
    view.h = Math.min(H, Math.floor(ah / view.k));
    canvas.width = view.w * view.k; canvas.height = view.h * view.k;
    canvas.style.width = canvas.width / dpr + 'px'; canvas.style.height = canvas.height / dpr + 'px';
    ctx.imageSmoothingEnabled = false;
    ui.zoom(view.k < Math.max(auto, 12), view.k > 1);
    const t = cameraTarget(); view.camX = t.x; view.camY = t.y;
  }
  function cameraTarget() {
    return { x: clamp(hero.x - view.w / 2, 0, W - view.w), y: clamp(hero.y - FH / 2 - view.h / 2, 0, H - view.h) };
  }
  function zoom(step: number) { view.zoom += step; layout(); }

  // ---------- ведро ----------
  const canPick = () => !hero.sitting && !bucket.carried && dist(hero, bucket) <= REACH;
  // Можно ли поставить ведро дном в точку: под ним земля, место рыбака свободно, и герой не окажется внутри.
  function fits(x: number, y: number) {
    if (!World.canWalk(x, y) || !World.canWalk(x - 5, y) || !World.canWalk(x + 5, y) || !World.canWalk(x, y - 2)) return false;
    if (x >= seat.x - 12 && x <= seat.x + 14 && y >= seat.y - 12 && y <= seat.y + 8) return false;
    const dx = (hero.x - x) / 8.5, dy = (hero.y - (y - 1)) / 4.5;
    return hero.sitting || dx * dx + dy * dy > 1;
  }
  function settle(x: number, y: number) {                // ведро встаёт на землю и становится препятствием (для своего героя)
    bucket.x = Math.round(x); bucket.y = Math.round(y); bucket.carried = false;
    bucket.blocked = World.block(bucket.x, bucket.y - 1, 7, 3);
  }
  function lift() { if (bucket.blocked) World.unblock(bucket.blocked); bucket.blocked = null; }
  function pickUp() {
    if (!canPick()) return false;
    flushMove();
    lift(); bucket.carried = true; bucket.home = false; bucket.pointed = false;
    hero.path = null; hero.then = null; marker = null;
    send('pick');
    return true;
  }
  function putDown() {
    if (!bucket.carried) return false;
    const side = hero.dir === 'left' ? -1 : hero.dir === 'right' ? 1 : hero.dir === 'down' ? -1 : 1;   // с той стороны, где оно в руке
    const spots = [[13 * side, 1], [-13 * side, 1], [0, 9], [0, -8], [13 * side, 6], [13 * side, -5], [-13 * side, 6], [-13 * side, -5], [18 * side, 1], [-18 * side, 1]];
    for (const [dx, dy] of spots) {
      const x = Math.round(hero.x + dx!), y = Math.round(hero.y + dy!);
      if (fits(x, y)) { flushMove(); settle(x, y); send('put', { x, y }); return true; }
    }
    ui.toast('Здесь ведро не поставить — тесно', 'bad');
    return false;
  }
  function spotBySeat() {                                // садясь рыбачить с ведром в руке, герой ставит его рядом
    for (const [x, y] of [[96, 241], [101, 244], [92, 238], [106, 242], [111, 244], [100, 236], [114, 240]] as const) if (fits(x, y)) return { x, y };
    return null;
  }
  function bucketAction() {
    if (hero.sitting) return;
    if (bucket.carried) putDown(); else pickUp();
  }

  // ---------- герой ----------
  const nearSeatNow = () => !hero.sitting && nearSeat(hero);
  const onFishingSpot = (x: number, y: number) => x >= seat.x - 10 && x <= seat.x + 14 && y >= seat.y - 31 && y <= seat.y + 12;
  const onBucket = (x: number, y: number) => !bucket.carried && x >= bucket.x - 9 && x <= bucket.x + 9 && y >= bucket.y - 19 && y <= bucket.y + 2;
  const onHero = (x: number, y: number) => Math.abs(x - hero.x) <= 10 && y <= hero.y + 2 && y >= hero.y - FH;
  const inWater = (x: number, y: number) => !World.canWalk(x, y) && y >= (x < 60 ? 226 : x < 132 ? 232 : 250);   // река и причал с его сваями

  function standUp() {
    if (!hero.sitting) return;
    fishing.leave();
    const p = standPoint();
    hero.sitting = false; hero.x = p.x; hero.y = p.y; hero.dir = 'down'; lastSent = { x: p.x, y: p.y };
    send('stand');
  }
  function sitDown() {
    if (hero.sitting) return;
    let put: { x: number; y: number } | undefined;
    if (bucket.carried) {
      const spot = spotBySeat();
      if (!spot) { ui.toast('Сначала поставь ведро', 'bad'); return; }
      put = spot;
    }
    flushMove();
    if (put) settle(put.x, put.y);
    hero.sitting = true; hero.path = null; hero.then = null; hero.moving = false; hero.x = seat.x; hero.y = seat.y; marker = null;
    lastSent = { x: seat.x, y: seat.y };
    fishing.sit();
    send('sit', put ? { put } : {});
  }
  function fishAction() {                               // F, пробел: сесть, забросить, подсечь
    if (hero.sitting) send('press'); else if (nearSeatNow()) sitDown();
  }
  function walkTo(x: number, y: number, then?: 'sit' | 'pick') {
    if (hero.sitting) standUp();
    const path = World.findPath(hero, { x, y });
    if (!path || !path.length) { hero.path = null; marker = null; return; }
    hero.path = path; hero.then = then || null; hero.stuck = 0;
    const end = path[path.length - 1]!; marker = then ? null : { x: end.x, y: end.y, t: 0 };
    noteMoved();
  }
  function arrive() {
    const then = hero.then; hero.path = null; hero.then = null; marker = null;
    if (then === 'sit' && nearSeatNow()) sitDown();
    else if (then === 'pick') pickUp();
  }
  function noteMoved() { if (!moved) { moved = true; ui.moved(); } }

  // Шаг со скольжением вдоль стен: сначала как есть, потом по осям, потом наискосок вдоль пологой кромки.
  function tryMove(mx: number, my: number) {
    const tries = [[mx, my], [mx, 0], [0, my]];
    if (mx && !my) tries.push([mx, Math.abs(mx)], [mx, -Math.abs(mx)]);
    if (my && !mx) tries.push([Math.abs(my), my], [-Math.abs(my), my]);
    for (const [ax, ay] of tries) {
      if (!ax && !ay) continue;
      if (World.canWalk(hero.x + ax!, hero.y + ay!)) { hero.x += ax!; hero.y += ay!; return true; }
    }
    return false;
  }

  // ---------- сеть ----------
  function flushMove() {                                // сервер должен знать, где мы, прежде чем мы что-то возьмём или сядем
    if (hero.sitting || (hero.x === lastSent.x && hero.y === lastSent.y)) return;
    const x = round2(hero.x), y = round2(hero.y);
    send('move', { x, y, dir: hero.dir }); lastSent = { x: hero.x, y: hero.y }; sendIn = MOVE_EVERY;
  }
  // Сервер говорит, где мы на самом деле: при входе и когда не принял наш ход.
  function applySelf(w: WorldState) {
    hero.x = w.x; hero.y = w.y; hero.dir = w.dir; hero.path = null; hero.then = null; marker = null;
    if (w.sitting && (!hero.sitting || fishing.st.phase === 'off')) { hero.sitting = true; fishing.sit(); }   // в т.ч. первый вход сидя
    else if (!w.sitting && hero.sitting) { hero.sitting = false; fishing.leave(); }
    if (hero.sitting) { hero.x = seat.x; hero.y = seat.y; }
    lift();
    bucket.home = w.bucket.home;
    if (w.bucket.carried) bucket.carried = true; else settle(w.bucket.x, w.bucket.y);
    lastSent = { x: hero.x, y: hero.y };
    if (!ready) { ready = true; layout(); }
  }
  const fishing = createFishingView(landed);
  function landed(fish: Catch) {                        // рыба в ведре: показываем, что сервер уже засчитал
    const sp = FISH.byId[fish.id]!, first = !bag.counts[fish.id], record = !first && fish.grams > (bag.best[fish.id] || 0);
    if (pendingBag) { bag = pendingBag; pendingBag = null; ui.bag(bag); }
    ui.toast(`${sp.name} · ${FISH.weightText(fish.grams)}${first ? ' — новый вид!' : record ? ' — крупнее прежних!' : ''}`, 'good', fish.id);
  }
  function handle([type, m]: Inbox) {
    if (type === 'self') applySelf(m);
    else if (type === 'bag') { bag = m; pendingBag = null; ui.bag(bag); }
    else if (m.e === 'needBucket') {
      if (bucket.home) { ui.toast('Рыбу некуда класть. Принеси ведро — оно стоит у дома'); bucket.pointed = true; }
      else ui.toast('Ведро далеко. Поставь его у причала');
    } else {
      if (m.e === 'early') ui.toast('Рано дёрнул — рыба ушла', 'bad');
      else if (m.e === 'miss') ui.toast('Сорвалась…', 'bad');
      else if (m.e === 'hook' && m.bag) pendingBag = m.bag;
      fishing.apply(m);
    }
  }

  // ---------- другие игроки ----------
  const players = () => (room.state as { players?: { forEach(cb: (p: PlayerView, sid: string) => void): void } } | undefined)?.players;
  function updateGhosts(dt: number) {
    frameNo++;
    players()?.forEach((p, sid) => {
      if (sid === room.sessionId) return;
      let g = ghosts.get(sid);
      if (!g) { g = { x: p.x, y: p.y, anim: 0, moving: false, blink: Math.random() * 3.7, seen: 0 }; ghosts.set(sid, g); }
      const dx = p.x - g.x, dy = p.y - g.y, d = Math.hypot(dx, dy);
      if (p.sitting || d > 48) { g.x = p.x; g.y = p.y; }                    // сел или прыгнул далеко — без плавности
      else { const k = 1 - Math.exp(-dt * 12); g.x += dx * k; g.y += dy * k; }
      g.moving = !p.sitting && d > 0.6;
      g.anim = g.moving ? g.anim + dt * STEP_FPS : 0;
      g.seen = frameNo;
    });
    for (const [sid, g] of ghosts) if (g.seen !== frameNo) ghosts.delete(sid);
    onlineIn -= dt;
    if (onlineIn <= 0) {
      onlineIn = 0.5;
      const list: { pid: string; name: string }[] = [];
      players()?.forEach(p => list.push({ pid: p.pid, name: p.name }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      const key = list.map(p => p.pid).join(',');
      if (key !== onlineKey) { onlineKey = key; ui.online(list); }
    }
  }

  // ---------- обновление ----------
  const DIRS: Record<string, [number, number]> = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  function update(dt: number) {
    updateGhosts(dt);
    if (!ready) return;
    let dx = 0, dy = 0, passed = false;
    const step = (bucket.carried ? CARRY_SPEED : SPEED) * dt;
    for (const code of keys) { dx += DIRS[code]![0]; dy += DIRS[code]![1]; }
    if (dx || dy) {                                   // клавиши важнее пути
      if (hero.sitting) standUp();
      hero.path = null; hero.then = null; marker = null; noteMoved();
    } else if (hero.path && hero.path.length) {
      const t = hero.path[0]!, vx = t.x - hero.x, vy = t.y - hero.y, d = Math.hypot(vx, vy);
      if (d <= Math.max(0.5, step)) {
        hero.x = t.x; hero.y = t.y; hero.path.shift();
        if (hero.path.length) passed = true; else arrive();
      } else { dx = vx / d; dy = vy / d; }
    }
    hero.moving = passed;
    if ((dx || dy) && !hero.sitting) {
      const len = Math.hypot(dx, dy); dx /= len; dy /= len;
      if (Math.abs(dx) >= Math.abs(dy) * 0.95) hero.dir = dx < 0 ? 'left' : 'right'; else hero.dir = dy < 0 ? 'up' : 'down';
      hero.moving = tryMove(dx * step, dy * step);
      if (hero.path) {                                // упёрлись на пути — бросаем его
        hero.stuck = hero.moving ? 0 : hero.stuck + dt;
        if (hero.stuck > 0.35) { hero.path = null; marker = null; hero.then = null; }
      }
    }
    hero.anim = hero.moving ? hero.anim + dt * STEP_FPS : 0;
    if (marker) marker.t += dt;
    fishing.update(dt);

    sendIn -= dt;
    if (sendIn <= 0) flushMove();

    const tgt = cameraTarget(), ease = 1 - Math.exp(-dt * 7);
    view.camX += (tgt.x - view.camX) * ease; view.camY += (tgt.y - view.camY) * ease;
    refreshActions();
  }
  function refreshActions() {
    const ph = fishing.st.phase;
    const a: Actions = {
      bucket: hero.sitting ? null : bucket.carried ? 'Поставить ведро' : canPick() ? 'Взять ведро' : null,
      fish: hero.sitting
        ? (ph === 'rest' ? 'Забросить' : ph === 'bite' ? 'Подсекай!' : ph === 'wait' || ph === 'cast' || ph === 'scare' ? 'Подсечь' : 'Есть!')
        : nearSeatNow() ? 'Сесть рыбачить' : null,
      hot: hero.sitting && ph === 'bite',
      stand: hero.sitting,
    };
    const key = JSON.stringify(a); if (key === actionsKey) return; actionsKey = key;
    ui.actions(a);
  }

  // ---------- отрисовка ----------
  // Из клетки стираются пиксели, закрытые предметами, которые стоят ближе к зрителю
  // (их строка-опора ниже base), потом клетка кладётся в кадр.
  function blit(c: HTMLCanvasElement, cx2: CanvasRenderingContext2D, ox: number, oy: number, base: number) {
    for (let j = 0; j < c.height; j++) {
      let run = -1;
      for (let i = 0; i <= c.width; i++) {
        const hidden = i < c.width && World.depthAt(ox + i, oy + j) > base;
        if (hidden && run < 0) run = i;
        else if (!hidden && run >= 0) { cx2.clearRect(run, j, i - run, 1); run = -1; }
      }
    }
    fctx.drawImage(c, ox, oy);
  }
  // Хвосты последних пойманных рыб над краем ведра; (ox, oy) — левый верх ведра в холсте.
  const TAIL_SLOTS = [[4, -1], [9, 0], [7, -2]] as const;
  function drawTails(c: CanvasRenderingContext2D, ox: number, oy: number, recent: ArrayLike<string>) {
    for (let i = 0; i < Math.min(3, recent.length); i++) {
      const art = fishArt[recent[i]!]; if (!art) continue;
      const [tx, ty] = TAIL_SLOTS[i]!, [fin, body] = art.tail, x = ox + tx, y = oy + ty;
      c.fillStyle = '#' + fin; c.fillRect(x - 1, y, 1, 1); c.fillRect(x + 1, y, 1, 1); c.fillRect(x, y + 1, 1, 1);
      c.fillStyle = '#' + body; c.fillRect(x, y + 2, 1, 2);
    }
  }
  function drawBucket(b: { x: number; y: number; home: boolean; recent: ArrayLike<string> }) {   // ведро на земле
    const ox = b.x - (B.baseX - B.x), oy = b.y - (B.baseY - B.y) - TOP;
    pctx.clearRect(0, 0, pail.width, pail.height);
    if (b.home) pctx.drawImage(img.bucket, 0, TOP);                // на своём месте — в точности как на картинке, с её тенью
    else {
      for (const [dx, dy, a] of B.shadow) { pctx.fillStyle = `rgba(14, 26, 12, ${a! / 100})`; pctx.fillRect(dx!, dy! + TOP, 1, 1); }
      pctx.drawImage(pailBody, 0, TOP);
    }
    drawTails(pctx, 0, TOP, b.recent);
    blit(pail, pctx, ox, oy, b.y);
  }
  function drawHero(a: Drawn, t: number) {
    const hx = Math.round(a.x), hy = Math.round(a.y);
    const f = a.moving ? 1 + (Math.floor(a.anim) % 4) : ((t + a.blink) % 3.7 < 0.14 ? 5 : 0);   // стоя иногда моргает
    cctx.clearRect(0, 0, CW, CH);
    cctx.fillStyle = 'rgba(18, 22, 10, 0.3)';         // тень под ногами
    cctx.fillRect(CX + 4, FH - 2, 11, 1); cctx.fillRect(CX + 2, FH - 1, 15, 2); cctx.fillRect(CX + 4, FH + 1, 11, 1);
    cctx.drawImage((a.carrying ? carryFrames : heroFrames)[a.dir][f]!, CX, 0);
    if (a.carrying) {                                 // ведро в руке качается вместе с плечом
      const rig = rigs[a.dir], side = a.dir === 'left' || a.dir === 'right';
      const sway = side ? (f === 2 || f === 4 ? -1 : 0) : (f === 1 || f === 3 ? 1 : 0);
      const bx = CX + ANCHOR + rig.bucket[0] - (img.carry.width >> 1), by = FH - 1 + rig.bucket[1] - (img.carry.height - 1) + sway;
      cctx.drawImage(img.carry, bx, by);
      drawTails(cctx, bx, by + B.handle, a.recent);
      cctx.drawImage(rig.arm, CX + rig.x, rig.y + sway);
    }
    blit(cell, cctx, hx - ANCHOR - CX, hy - (FH - 1), hy);
  }

  const SPARK = ['#8abdd0', '#94d6f1'];
  function drawSparkles(t: number) {                   // блики на воде — мерцают, как штрихи волн на картинке
    for (const [x, y, len, ph] of World.sparkles) {
      const a = Math.sin(t * 0.9 + ph * 6.283);
      if (a < 0.72) continue;
      fctx.globalAlpha = (a - 0.72) / 0.28 * 0.85;
      fctx.fillStyle = SPARK[len & 1]!;
      fctx.fillRect(x, y, len, 1);
    }
    fctx.globalAlpha = 1;
  }
  function drawMarker() {                              // куда идём
    if (!marker) return;
    const p = Math.floor(marker.t * 5) % 2, x = marker.x, y = marker.y;
    fctx.fillStyle = 'rgba(244, 227, 193, 0.9)';
    for (const [dx, dy] of [[-3 - p, 0], [2 + p, 0], [0, -2 - p], [0, 1 + p]] as const) fctx.fillRect(x + dx, y + dy, dx ? 2 : 1, dx ? 1 : 2);
  }
  const GLYPH: Record<'E' | 'F', string[]> = { E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'] };
  function drawKeycap(letter: 'E' | 'F', cx2: number, top: number) {   // клавиша-подсказка над предметом
    const x0 = cx2 - 4;
    fctx.fillStyle = '#240702'; fctx.fillRect(x0 + 1, top, 7, 9); fctx.fillRect(x0, top + 1, 9, 7);
    fctx.fillStyle = '#f4e3c1'; fctx.fillRect(x0 + 1, top + 1, 7, 7);
    fctx.fillStyle = '#240702';
    GLYPH[letter].forEach((row, j) => { for (let i = 0; i < 3; i++) if (row[i] === '#') fctx.fillRect(x0 + 3 + i, top + 2 + j, 1, 1); });
  }
  function drawPrompts(t: number) {
    const bob = Math.floor(t * 2.5) % 2;
    if (canPick() && !hero.moving) drawKeycap('E', bucket.x, bucket.y - 30 - bob);
    else if (bucket.pointed && !bucket.carried) {      // стрелка «ведро здесь»
      fctx.fillStyle = '#240702'; fctx.fillRect(bucket.x - 3, bucket.y - 28 - bob, 7, 3); fctx.fillRect(bucket.x - 2, bucket.y - 25 - bob, 5, 1); fctx.fillRect(bucket.x - 1, bucket.y - 24 - bob, 3, 1);
      fctx.fillStyle = '#f4e3c1'; fctx.fillRect(bucket.x - 2, bucket.y - 27 - bob, 5, 1); fctx.fillRect(bucket.x - 1, bucket.y - 26 - bob, 3, 1); fctx.fillRect(bucket.x, bucket.y - 25 - bob, 1, 1);
    }
    if (nearSeatNow() && !hero.moving) drawKeycap('F', Math.round(hero.x), Math.round(hero.y) - FH - 11 - bob);
  }

  function buildDebugLayer() {
    const c = makeCanvas(W, H), x = ctx2d(c), id = x.createImageData(W, H);
    const pal = [[255, 0, 0], [0, 200, 255], [255, 0, 255], [255, 255, 0], [0, 255, 120], [255, 140, 0], [140, 90, 255]];
    for (let i = 0; i < W * H; i++) {
      const o = i * 4, d = World.depth[i]!;
      if (d) { const p = pal[d % pal.length]!; id.data[o] = p[0]!; id.data[o + 1] = p[1]!; id.data[o + 2] = p[2]!; id.data[o + 3] = 130; }
      else if (World.walk[i]) { id.data[o] = id.data[o + 1] = id.data[o + 2] = 255; id.data[o + 3] = 90; }
    }
    x.putImageData(id, 0, 0); return c;
  }
  function drawDebug() {
    if (!debugLayer || debugFor !== bucket.blocked) { debugLayer = buildDebugLayer(); debugFor = bucket.blocked; }   // проходимость меняется, когда ведро переставляют
    fctx.drawImage(debugLayer, 0, 0);
    fctx.fillStyle = '#f0f'; fctx.fillRect(Math.round(hero.x), Math.round(hero.y), 1, 1);
    if (hero.path) { fctx.fillStyle = '#0ff'; for (const p of hero.path) fctx.fillRect(p.x, p.y, 1, 1); }
    const px = pointer ? `  курсор ${pointer.x},${pointer.y}  ходить ${World.canWalk(pointer.x, pointer.y) ? 'да' : 'нет'}  опора ${World.depthAt(pointer.x, pointer.y)}` : '';
    ui.debug(`герой ${hero.x.toFixed(1)},${hero.y.toFixed(1)} ${hero.dir}${hero.sitting ? ' сидит' : ''}  рыбалка ${fishing.st.phase}  ведро ${bucket.carried ? 'в руке' : bucket.x + ',' + bucket.y}  игроков рядом ${ghosts.size}  масштаб ×${view.k}${px}`);
  }

  // Имена над чужими героями — уже на экранном холсте, чтобы текст был чётким при любом масштабе.
  function drawNames(cx: number, cy: number) {
    const all = players(); if (!all) return;
    const dpr = window.devicePixelRatio || 1, size = Math.round(clamp(view.k * 3, 11 * dpr, 15 * dpr));
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size / 4);
    const label = (text: string, x: number, y: number) => {
      const sx = (x - cx) * view.k, sy = (y - cy) * view.k;
      if (sx < -80 || sy < 0 || sx > canvas.width + 80 || sy > canvas.height + 20) return;
      ctx.strokeStyle = 'rgba(36, 7, 2, 0.85)'; ctx.strokeText(text, sx, sy);
      ctx.fillStyle = '#f4e3c1'; ctx.fillText(text, sx, sy);
    };
    const sitters: string[] = [];
    all.forEach((p, sid) => {
      if (sid === room.sessionId) return;
      if (p.sitting) { sitters.push(p.name); return; }
      const g = ghosts.get(sid); if (g) label(p.name, g.x, g.y - FH - 2);
    });
    if (sitters.length) label(sitters[0] + (sitters.length > 1 ? ` и ещё ${sitters.length - 1}` : ''), seat.x, fisher.y - 3);
  }

  function render(t: number) {
    fctx.drawImage(img.world, 0, 0);
    drawSparkles(t);
    // кто дальше от зрителя, тот рисуется раньше
    const queue: { y: number; draw: () => void }[] = [];
    let someoneSits = hero.sitting;
    if (ready) {
      if (!hero.sitting) queue.push({ y: hero.y, draw: () => drawHero({ ...hero, carrying: bucket.carried, recent: bag.recent, blink: 0 }, t) });
      if (!bucket.carried) queue.push({ y: bucket.y, draw: () => drawBucket({ ...bucket, recent: bag.recent }) });
    }
    players()?.forEach((p, sid) => {
      if (sid === room.sessionId) return;
      const g = ghosts.get(sid); if (!g) return;
      if (p.sitting) someoneSits = true;
      else queue.push({ y: g.y, draw: () => drawHero({ x: g.x, y: g.y, dir: p.dir, moving: g.moving, anim: g.anim, carrying: p.carrying, recent: p.recent, blink: g.blink }, t) });
      if (!p.carrying) queue.push({ y: p.by - 0.5, draw: () => drawBucket({ x: p.bx, y: p.by, home: p.bucketHome, recent: p.recent }) });
    });
    if (someoneSits) queue.push({ y: seat.y, draw: () => fctx.drawImage(img.fisher, fisher.x, fisher.y) });
    queue.sort((a, b) => a.y - b.y);
    for (const q of queue) q.draw();
    if (hero.sitting) drawFishing(fctx, fishing.st, t, {
      x: rod.x, tipY: rod.tipY, waterY: rod.waterY, head: { x: seat.x + 2, y: fisher.y },
      bucket: bucket.carried ? null : { x: bucket.x, y: bucket.y - B.bodyH + 4 },
    }, { line: { img: img.line, x: World.line.x, y: World.line.y }, fish: fishArt });
    else if (someoneSits) fctx.drawImage(img.line, World.line.x, World.line.y);   // чужая удочка — леска в воде, как на картинке
    drawMarker(); drawPrompts(t);
    if (debug) drawDebug();
    const cx = Math.round(clamp(view.camX, 0, W - view.w)), cy = Math.round(clamp(view.camY, 0, H - view.h));
    ctx.drawImage(frame, cx, cy, view.w, view.h, 0, 0, canvas.width, canvas.height);
    drawNames(cx, cy);
  }

  // ---------- управление ----------
  function toWorld(ev: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.floor(clamp(view.camX, 0, W - view.w) + (ev.clientX - r.left) / r.width * view.w),
      y: Math.floor(clamp(view.camY, 0, H - view.h) + (ev.clientY - r.top) / r.height * view.h),
    };
  }
  const listeners: [EventTarget, string, (ev: any) => void, AddEventListenerOptions?][] = [];
  const on = <E extends Event>(target: EventTarget, type: string, fn: (ev: E) => void, opts?: AddEventListenerOptions) => { target.addEventListener(type, fn as EventListener, opts); listeners.push([target, type, fn, opts]); };

  on<KeyboardEvent>(window, 'keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if ((ev.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    if (DIRS[ev.code]) { keys.add(ev.code); ev.preventDefault(); return; }
    if (ev.repeat) return;
    if (ev.code === 'KeyF' || ev.code === 'Space' || ev.code === 'Enter') { fishAction(); ev.preventDefault(); }
    else if (ev.code === 'KeyE') bucketAction();
    else if (ev.code === 'Escape') standUp();
    else if (ev.code === 'Equal' || ev.code === 'NumpadAdd') zoom(1);
    else if (ev.code === 'Minus' || ev.code === 'NumpadSubtract') zoom(-1);
    else if (ev.code === 'F2') { debug = !debug; if (!debug) ui.debug(null); ev.preventDefault(); }
  });
  on<KeyboardEvent>(window, 'keyup', ev => keys.delete(ev.code));
  on(window, 'blur', () => keys.clear());
  on<PointerEvent>(canvas, 'pointerdown', ev => {
    if (ev.button > 0 || !ready) return;
    ev.preventDefault();
    const p = toWorld(ev);
    if (hero.sitting && (onFishingSpot(p.x, p.y) || inWater(p.x, p.y))) fishAction();   // сидя: клик по рыбаку или воде — рыбалка
    else if (bucket.carried && onHero(p.x, p.y)) putDown();
    else if (onBucket(p.x, p.y)) { if (canPick()) pickUp(); else walkTo(bucket.x, bucket.y + 5, 'pick'); }
    else if (onFishingSpot(p.x, p.y)) { if (nearSeatNow()) sitDown(); else walkTo(seat.x, seat.y, 'sit'); }
    else walkTo(p.x, p.y);
  });
  on<PointerEvent>(canvas, 'pointermove', ev => { pointer = toWorld(ev); });
  let wheelAt = 0;
  on<WheelEvent>(canvas, 'wheel', ev => {
    ev.preventDefault();
    if (ev.timeStamp - wheelAt < 160 || !ev.deltaY) return;
    wheelAt = ev.timeStamp; zoom(ev.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  on(canvas, 'contextmenu', ev => ev.preventDefault());
  on(window, 'resize', layout);

  // ---------- запуск ----------
  function tick(now: number) {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
    update(dt); render(now / 1000);
    raf = requestAnimationFrame(tick);
  }
  layout();
  for (const m of inbox) handle(m);
  inbox = null;
  if (debug) ui.debug('');
  raf = requestAnimationFrame(tick);

  // для отладки из консоли; step(dt, n) прокручивает игру вручную
  (window as any).FH_GAME = { hero, bucket, view, keys, ghosts, fishing, room, sitDown, standUp, walkTo, zoom, pickUp, putDown, fishAction, bucketAction,
    step: (dt: number, n = 1) => { for (let i = 0; i < n; i++) update(dt); render(performance.now() / 1000); } };

  return {
    bucketAction, fishAction, standUp, zoom,
    destroy() {
      alive = false; cancelAnimationFrame(raf);
      for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
      for (const off of offs) off();
      lift();
      delete (window as any).FH_GAME;
    },
  };
}
