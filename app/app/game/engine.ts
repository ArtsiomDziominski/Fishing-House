// Игра в браузере: рыбак ходит по миру с картинки, носит ведро и рюкзак и ловит рыбу с края причала — вместе с другими игроками.
// Мир — карта 569×320 «арт-пикселей», ровно 16:9. Она вся в кадре: экран стоит на месте, ходит только герой.
// Кадр вписан в окно браузера целиком и на экране 16:9 занимает его весь.
//
// Сеть: свой герой ходит сразу (без ожидания сервера), шаги уходят на сервер раз в MOVE_EVERY.
// Сервер присылает «self», если с чем-то не согласен, — герой встаёт туда, где его видит сервер.
// Рыбалку ведёт сервер: клиент шлёт нажатия и показывает фазы по его событиям.
// Остальных игроков берём из состояния комнаты и плавно подтягиваем к их последнему месту.
// Время суток считаем по часам сервера: ночью кадр темнеет, а в окнах дома и в фонаре у двери загорается свет.

import type { Room } from '@colyseus/sdk';
import {
  World, FISH, PACKS, PACK_KINDS, MOVE_EVERY, SPEED, CARRY_SPEED, REACH, seat, nearSeat, standPoint, dist, dayHour, dayPart, clockText, skyAt, weatherText,
  type Bag, type Catch, type ClientMessages, type Dir, type PackKind, type PlayerView, type ServerMessages, type Sky, type WeatherKind, type WorldState,
} from '@fh/shared';
import { HERO } from './hero.ts';
import { createFishingView, drawBite, drawFishing, type FishArt } from './fishing-view.ts';
import { createRiverView } from './river-view.ts';
import { createWeatherView, HAZE } from './weather-view.ts';

export interface Actions { bucket: string | null; pack: string | null; fish: string | null; hot: boolean; stand: boolean }
// Время суток для интерфейса: подпись часов, насколько темно (0..1), минута игровых суток,
// разрешает ли сервер переводить часы и выставлять погоду (разработка), переведены ли часы сейчас;
// weather — погода словами, fixKind и fixWind — что из погоды выставлено вручную (null — идёт по расписанию).
export interface SkyInfo {
  label: string; dark: number; minutes: number; canSet: boolean; moved: boolean;
  weather: string; fixKind: WeatherKind | null; fixWind: boolean | null;
}
export type Tone = '' | 'good' | 'bad';

// Куда движок сообщает о том, что показывает интерфейс вокруг холста (его держит Pinia-хранилище).
export interface GameUI {
  bag(bag: Bag): void;
  pack(kind: PackKind): void;                           // какой рюкзак у героя сейчас
  sky(info: SkyInfo): void;                             // время суток: часы и темнота фона
  toast(text: string, tone?: Tone, fishId?: string | null): void;
  actions(a: Actions): void;
  moved(): void;                                        // первый шаг — подсказку можно приглушить
  debug(text: string | null): void;                     // строка отладки вместо подсказки; null — убрать
  online(players: { pid: string; name: string }[]): void;
}

export interface GameHandle {
  bucketAction(): void; packAction(): void; setPack(kind: PackKind): void; fishAction(): void; standUp(): void; destroy(): void;
  setClock(hour: number | null): void;                  // перевести часы причала на этот час (на сервере, у всех); null — настоящее время
  setWeather(kind: WeatherKind | null, wind: boolean | null): void;   // выставить погоду и ветер (на сервере, у всех); null — по расписанию
}

interface Hero { x: number; y: number; dir: Dir; sitting: boolean; moving: boolean; anim: number; path: { x: number; y: number }[] | null; then: 'sit' | 'pick' | 'wear' | null; stuck: number }
interface Ghost { x: number; y: number; anim: number; moving: boolean; blink: number; seen: number }
// pack — вид рюкзака на спине или null, если герой налегке
interface Drawn { x: number; y: number; dir: Dir; moving: boolean; anim: number; carrying: boolean; pack: PackKind | null; recent: ArrayLike<string>; blink: number }

const W = World.W, H = World.H, FW = HERO.FW, FH = HERO.FH;
const ANCHOR = 9;                     // столбец кадра героя над точкой опоры
const STEP_FPS = 8;                   // кадров шага в секунду
const { fisher, bucket: B, pack: P, rod } = World;
const packKind = (v: string): PackKind => (PACKS.isKind(v) ? v : PACKS.DEFAULT);   // вид из состояния комнаты — просто строка

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
  const sack = makeCanvas(P.w + 3, P.h + 3), sctx = ctx2d(sack);             // клетка рюкзака на земле: справа и снизу место под тень
  const dusk = makeCanvas(W, H), dctx = ctx2d(dusk);                         // слой темноты: цвет неба с дырами там, где горит свет

  const hero: Hero = { x: seat.x, y: seat.y, dir: 'down', sitting: true, moving: false, anim: 0, path: null, then: null, stuck: 0 };
  const bucket = { x: B.baseX, y: B.baseY, carried: false, home: true, blocked: null as number[] | null, pointed: false };
  const pack = { x: P.baseX, y: P.baseY, worn: false, kind: PACKS.DEFAULT, blocked: null as number[] | null };
  let bag: Bag = { counts: {}, best: {}, total: 0, grams: 0, recent: [] };
  let pendingBag: Bag | null = null;                                         // ведро после подсечки — покажем, когда рыба долетит
  const view = { k: 1 };                                                     // k — во сколько раз холст крупнее карты в арт-пикселях
  const keys = new Set<string>();
  const ghosts = new Map<string, Ghost>();
  let marker: { x: number; y: number; t: number } | null = null, moved = false, debug = params.has('debug');
  let debugLayer: HTMLCanvasElement | null = null, debugFor = -1, mapRev = 0, pointer: { x: number; y: number } | null = null;   // mapRev растёт, когда предмет ставят или поднимают
  let ready = false, sendIn = 0, lastSent = { x: hero.x, y: hero.y }, frameNo = 0, onlineKey = '', onlineIn = 0, actionsKey = '';
  let raf = 0, last = 0, alive = true;
  // Время суток: skew — на сколько часы причала (их ведёт сервер) впереди наших, мс; pier — можно ли их переводить
  // и переведены ли они; fixedHour — час из адреса (?hour=22): время тогда стоит, и только у нас.
  let skew = 0, pier = { canSet: false, moved: false }, fixedHour = params.has('hour') ? Number(params.get('hour')) : NaN, skyKey = '';
  let weather: ServerMessages['weather'] = { kind: 'clear', wind: false, fixKind: null, fixWind: null };   // погода — какой её назвал сервер
  // Перевод часов: wantHour — час, который ещё не ушёл на сервер (undefined — слать нечего), clockIn — пауза до следующей отправки.
  let wantHour: number | null | undefined, clockIn = 0;

  // Сервер шлёт «self» и ведро сразу при входе — пока грузятся картинки, складываем сообщения в очередь.
  // Часы и погода в очередь не идут: у часов важно, в какой момент они пришли, а погоде картинки не нужны.
  type Queued = Exclude<keyof ServerMessages, 'clock' | 'weather'>;
  type Inbox = { [K in Queued]: [K, ServerMessages[K]] }[Queued];
  let inbox: Inbox[] | null = [];
  const receive = (m: Inbox) => { if (inbox) inbox.push(m); else handle(m); };
  const offs = [
    room.onMessage('self', (m: ServerMessages['self']) => receive(['self', m])),
    room.onMessage('bag', (m: ServerMessages['bag']) => receive(['bag', m])),
    room.onMessage('fish', (m: ServerMessages['fish']) => receive(['fish', m])),
    room.onMessage('clock', (m: ServerMessages['clock']) => { skew = m.now - Date.now(); pier = { canSet: m.canSet, moved: m.moved }; }),
    room.onMessage('weather', (m: ServerMessages['weather']) => { weather = m; }),
  ];

  // ---------- картинки ----------
  const img: Record<'world' | 'fisher' | 'line' | 'bucket' | 'carry' | 'pack' | 'lights' | 'glow', HTMLImageElement> = {} as any;
  const files: Partial<Record<keyof typeof img, string>> = { world: 'world.png', fisher: 'fisher.png', line: 'line.png', bucket: 'bucket.png', carry: 'bucket-carry.png', pack: 'pack-ground.png' };
  if (World.lights) Object.assign(files, { lights: 'lights.png', glow: 'glow.png' });   // свет в окнах — только пока дом стоит на карте
  await Promise.all((Object.keys(files) as (keyof typeof img)[]).map(k => loadImage('/assets/' + files[k] + '?v=' + World.rev).then(im => { img[k] = im; })));
  const rigs = {} as Record<Dir, { arm: HTMLCanvasElement; x: number; y: number; bucket: [number, number] }>;
  const fishArt: Record<string, FishArt & { tail: [string, string] }> = {};
  for (const dir of ['down', 'up', 'left', 'right'] as const) {
    const rig = HERO.carryRig(dir); rigs[dir] = { arm: fromPixels(rig), x: rig.x, y: rig.y, bucket: rig.bucket };
  }
  // Кадры героя: налегке и с рюкзаком каждого вида, с ведром и без. Набор собирается, когда впервые понадобился.
  const frameSets = new Map<string, Record<Dir, HTMLCanvasElement[]>>();
  function heroFrames(carry: boolean, kind: PackKind | null) {
    const key = (carry ? '+' : '-') + (kind || '');
    let set = frameSets.get(key);
    if (!set) {
      const px = HERO.build(carry, kind && PACKS.tones(kind)); set = {} as Record<Dir, HTMLCanvasElement[]>;
      for (const dir of Object.keys(px) as Dir[]) set[dir] = px[dir].map(buf => fromPixels({ w: FW, h: FH, data: buf }));
      frameSets.set(key, set);
    }
    return set;
  }
  // Рюкзаки: кадр листа pack-ground.png на вид (на земле рюкзак вдвое меньше, чем на картинке) и накладка на спину сидящего рыбака.
  const packArt = {} as Record<PackKind, { ground: HTMLCanvasElement; seat: HTMLCanvasElement; seatX: number; seatY: number }>;
  PACK_KINDS.forEach((kind, i) => {
    const ground = makeCanvas(P.w, P.h); ctx2d(ground).drawImage(img.pack, i * P.w, 0, P.w, P.h, 0, 0, P.w, P.h);
    const s = HERO.seatPack(PACKS.tones(kind));
    packArt[kind] = { ground, seat: fromPixels(s), seatX: s.x, seatY: s.y };
  });
  for (const sp of FISH.SPECIES) {
    const s = FISH.sprite(sp), side = fromPixels(s);
    fishArt[sp.id] = { side, sideFlip: flipped(side), up: fromPixels(FISH.upright(s)), tail: sp.tail };
  }
  const pailBody = makeCanvas(B.w, B.h);                                     // ведро без тени — для любого места, кроме исходного
  { const px = ctx2d(pailBody); px.drawImage(img.bucket, 0, 0); for (const [dx, dy] of B.shadow) px.clearRect(dx!, dy!, 1, 1); }
  const river = createRiverView(img.world);                                  // где на карте вода и как она течёт
  const wx = createWeatherView(river.water);                                 // дождь, ветер, пасмурный свет

  // ---------- размер ----------
  // Карта — это и есть кадр: она 16:9 и вписывается в окно целиком. На экране 16:9 она занимает его весь, на любом
  // другом — и на вертикальном телефоне тоже — по краям остаются поля. Холст рисуется целым множителем (ближайшим
  // сверху к нужному размеру), а до точного размера его ужимает браузер: кадр встаёт в окно без щелей, пиксели ровные.
  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.min(window.innerWidth, window.innerHeight * 16 / 9)), height = width * 9 / 16;
    view.k = Math.max(1, Math.ceil(height * dpr / H - 0.01));
    canvas.width = W * view.k; canvas.height = H * view.k;
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.imageSmoothingEnabled = false;
  }

  // ---------- ведро ----------
  const canPick = () => !hero.sitting && !bucket.carried && dist(hero, bucket) <= REACH;
  // Можно ли поставить предмет дном в точку: под ним земля, место рыбака свободно, и герой не окажется внутри.
  // half — полуширина дна: 5 у ведра, 4 у рюкзака.
  function fits(x: number, y: number, half = 5) {
    if (!World.canWalk(x, y) || !World.canWalk(x - half, y) || !World.canWalk(x + half, y) || !World.canWalk(x, y - 2)) return false;
    if (x >= seat.x - 7 - half && x <= seat.x + 9 + half && y >= seat.y - 12 && y <= seat.y + 8) return false;
    const dx = (hero.x - x) / (half + 3.5), dy = (hero.y - (y - 1)) / 4.5;
    return hero.sitting || dx * dx + dy * dy > 1;
  }
  function settle(x: number, y: number) {                // ведро встаёт на землю и становится препятствием (для своего героя)
    bucket.x = Math.round(x); bucket.y = Math.round(y); bucket.carried = false;
    bucket.blocked = World.block(bucket.x, bucket.y - 1, 7, 3); mapRev++;
  }
  function lift() { if (bucket.blocked) World.unblock(bucket.blocked); bucket.blocked = null; mapRev++; }
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
    for (const [dx, dy] of [[26, -13], [31, -10], [22, -16], [36, -12], [41, -10], [30, -18], [44, -14]] as const) {   // места на настиле справа от рыбака
      const x = seat.x + dx, y = seat.y + dy;
      if (fits(x, y)) return { x, y };
    }
    return null;
  }
  function bucketAction() {
    if (hero.sitting) return;
    if (bucket.carried) putDown(); else pickUp();
  }

  // ---------- рюкзак ----------
  const canWear = () => !hero.sitting && !pack.worn && dist(hero, pack) <= REACH;
  function settlePack(x: number, y: number) {            // снятый рюкзак ложится на землю и, как ведро, становится препятствием
    pack.x = Math.round(x); pack.y = Math.round(y); pack.worn = false;
    pack.blocked = World.block(pack.x, pack.y - 1, 5, 2); mapRev++;
  }
  function liftPack() { if (pack.blocked) World.unblock(pack.blocked); pack.blocked = null; mapRev++; }
  function putOn() {
    if (!canWear()) return false;
    flushMove();
    liftPack(); pack.worn = true;
    hero.path = null; hero.then = null; marker = null;
    send('packOn');
    return true;
  }
  function takeOff() {
    if (!pack.worn || hero.sitting) return false;
    const side = hero.dir === 'left' ? 1 : hero.dir === 'right' ? -1 : hero.dir === 'down' ? 1 : -1;   // сбоку, со стороны свободной от ведра руки
    const spots = [[12 * side, 1], [-12 * side, 1], [0, 8], [12 * side, 6], [-12 * side, 6], [12 * side, -5], [-12 * side, -5], [0, -8], [17 * side, 1], [-17 * side, 1]];
    for (const [dx, dy] of spots) {
      const x = Math.round(hero.x + dx!), y = Math.round(hero.y + dy!);
      if (fits(x, y, 4)) { flushMove(); settlePack(x, y); send('packOff', { x, y }); return true; }
    }
    ui.toast('Здесь рюкзак не положить — тесно', 'bad');
    return false;
  }
  function packAction() {
    if (hero.sitting) return;
    if (pack.worn) takeOff(); else putOn();
  }
  function setPack(kind: PackKind) {                     // другой рюкзак — меняется и на спине, и на земле
    if (!ready || kind === pack.kind) return;
    pack.kind = kind; ui.pack(kind);
    send('packKind', { kind });
  }

  // ---------- герой ----------
  const nearSeatNow = () => !hero.sitting && nearSeat(hero);
  const onFishingSpot = (x: number, y: number) => x >= seat.x - 10 && x <= seat.x + 14 && y >= seat.y - 31 && y <= seat.y + 12;
  const onBucket = (x: number, y: number) => !bucket.carried && x >= bucket.x - 9 && x <= bucket.x + 9 && y >= bucket.y - 19 && y <= bucket.y + 2;
  const onPack = (x: number, y: number) => !pack.worn && x >= pack.x - 7 && x <= pack.x + 7 && y >= pack.y - 12 && y <= pack.y + 2;
  const onHero = (x: number, y: number) => Math.abs(x - hero.x) <= 10 && y <= hero.y + 2 && y >= hero.y - FH;
  // Река и причал с его сваями: всё непроходимое ниже линии берега. Линия снята с картинки; по бокам от неё берег свой.
  const bankY = (px: number) => (px < 0 ? 205 : px < 60 ? 226 : px < 132 ? 232 : px < World.pic.w ? 250 : 244);
  const inWater = (x: number, y: number) => !World.canWalk(x, y) && y >= bankY(x - World.pic.x);

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
  function walkTo(x: number, y: number, then?: 'sit' | 'pick' | 'wear') {
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
    else if (then === 'wear') putOn();
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
    lift(); liftPack();
    bucket.home = w.bucket.home;
    if (w.bucket.carried) bucket.carried = true; else settle(w.bucket.x, w.bucket.y);
    pack.kind = w.pack.kind; ui.pack(pack.kind);
    if (w.pack.worn) pack.worn = true; else settlePack(w.pack.x, w.pack.y);
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
      if (bucket.home) { ui.toast('Рыбу некуда класть. Принеси ведро — оно стоит на поляне'); bucket.pointed = true; }
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
    wx.update(dt, weather); river.update(dt, wx.st.rain);
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
    clockIn -= dt; flushClock();
    refreshActions(); refreshSky();
  }
  function refreshActions() {
    const ph = fishing.st.phase;
    const a: Actions = {
      bucket: hero.sitting ? null : bucket.carried ? 'Поставить ведро' : canPick() ? 'Взять ведро' : null,
      pack: hero.sitting ? null : pack.worn ? 'Снять рюкзак' : canWear() ? 'Надеть рюкзак' : null,
      fish: hero.sitting
        ? (ph === 'rest' ? 'Забросить' : ph === 'bite' ? 'Подсекай!' : ph === 'wait' || ph === 'cast' || ph === 'scare' ? 'Подсечь' : 'Есть!')
        : nearSeatNow() ? 'Сесть рыбачить' : null,
      hot: hero.sitting && ph === 'bite',
      stand: hero.sitting,
    };
    const key = JSON.stringify(a); if (key === actionsKey) return; actionsKey = key;
    ui.actions(a);
  }

  // ---------- время суток ----------
  // Час считаем сами, но по часам сервера — так у всех на причале одно время.
  const hourNow = () => (Number.isFinite(fixedHour) ? fixedHour : dayHour(Date.now() + skew));
  // Цвет, на который умножается кадр: небо по часам и погода. Ночью и так темно, поэтому тучи темнят тем слабее, чем темнее небо.
  function frameTint(sky: Sky): [number, number, number] {
    const w = wx.tint(), k = 1 - sky.dark;
    const mix = (i: 0 | 1 | 2) => Math.round(sky.tint[i] * (255 + (w[i] - 255) * k) / 255);
    return [mix(0), mix(1), mix(2)];
  }
  function refreshSky() {                               // часы и погода в интерфейсе, темнота фона вокруг холста
    const hour = hourNow(), label = dayPart(hour).name + ' · ' + clockText(hour), c = frameTint(skyAt(hour));
    const dark = Math.round((1 - (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255) * 20) / 20;
    const info: SkyInfo = { label, dark, minutes: Math.floor(((hour % 24) + 24) % 24 * 6) * 10, ...pier, weather: weatherText(weather), fixKind: weather.fixKind, fixWind: weather.fixWind };
    const key = JSON.stringify(info); if (key === skyKey) return; skyKey = key;
    ui.sky(info);
  }
  // Перевести часы причала: это делает сервер, и время меняется сразу у всех игроков (он разрешает это только в разработке).
  // Ползунок шлёт часы десятками в секунду, поэтому на сервер уходит последнее значение и не чаще, чем раз в CLOCK_EVERY.
  const CLOCK_EVERY = 0.1;
  function setClock(hour: number | null) { fixedHour = NaN; wantHour = hour; flushClock(); }
  function flushClock() {
    if (wantHour === undefined || clockIn > 0) return;
    send('clock', { hour: wantHour }); wantHour = undefined; clockIn = CLOCK_EVERY;
  }
  // Выставить погоду и ветер — тоже на сервере и тоже только в разработке. null — пусть идёт по расписанию.
  function setWeather(kind: WeatherKind | null, wind: boolean | null) { send('weather', { kind, wind }); }

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
  function drawPack(p: { x: number; y: number; kind: PackKind }) {   // рюкзак на земле
    sctx.clearRect(0, 0, sack.width, sack.height);
    for (const [dx, dy, a] of P.shadow) { sctx.fillStyle = `rgba(14, 26, 12, ${a! / 100})`; sctx.fillRect(dx!, dy!, 1, 1); }
    sctx.drawImage(packArt[p.kind].ground, 0, 0);
    blit(sack, sctx, p.x - (P.w >> 1), p.y - (P.h - 1), p.y);
  }
  function drawHero(a: Drawn, t: number) {
    const hx = Math.round(a.x), hy = Math.round(a.y);
    const f = a.moving ? 1 + (Math.floor(a.anim) % 4) : ((t + a.blink) % 3.7 < 0.14 ? 5 : 0);   // стоя иногда моргает
    cctx.clearRect(0, 0, CW, CH);
    cctx.fillStyle = 'rgba(18, 22, 10, 0.3)';         // тень под ногами
    cctx.fillRect(CX + 4, FH - 2, 11, 1); cctx.fillRect(CX + 2, FH - 1, 15, 2); cctx.fillRect(CX + 4, FH + 1, 11, 1);
    cctx.drawImage(heroFrames(a.carrying, a.pack)[a.dir][f]!, CX, 0);
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
  function drawSparkles(t: number, shine: number) {    // блики на воде — мерцают, как штрихи волн на картинке; shine — сколько солнца, 0..1
    if (shine < 0.03) return;
    for (const [x, y, len, ph] of World.sparkles) {
      const a = Math.sin(t * 0.9 + ph * 6.283);
      if (a < 0.72) continue;
      fctx.globalAlpha = (a - 0.72) / 0.28 * 0.85 * shine;
      fctx.fillStyle = SPARK[len & 1]!;
      fctx.fillRect(x, y, len, 1);
    }
    fctx.globalAlpha = 1;
  }
  // Дым из трубы: клубы один за другим выходят из устья, поднимаются, их сносит вправо, они растут и тают.
  // Всё считается от времени, без состояния: у клуба номер i своя доля пути u, у каждого нового — своя форма.
  const SMOKE = { n: 6, life: 9, light: '#d0bda4', shade: '#b3a08b' };
  const noise = (n: number, s: number) => { const v = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
  function disc(cx2: number, cy2: number, r: number) {  // пиксельный круг
    for (let j = Math.ceil(-r); j <= r; j++) { const half = Math.floor(Math.sqrt(r * r - j * j)); fctx.fillRect(Math.round(cx2) - half, Math.round(cy2) + j, half * 2 + 1, 1); }
  }
  function drawSmoke(t: number, wind: number) {        // wind — сила ветра, 0..1: дым стелется ниже и улетает дальше
    const mouth = World.smoke; if (!mouth) return;     // дома на карте нет — нет и трубы
    const puffs: { x: number; y: number; r: number; lobes: [number, number, number][] }[] = [];
    for (let i = 0; i < SMOKE.n; i++) {
      const phase = t / SMOKE.life + i / SMOKE.n, born = Math.floor(phase), u = phase - born, id = born * SMOKE.n + i;
      const rise = u < 0.2 ? u / 0.2 : 1, drift = u < 0.2 ? 0 : (u - 0.2) / 0.8;          // сначала вверх, потом по ветру
      const x = mouth.x + rise * 2 + drift * (40 + noise(id, 1) * 14) * (1 + wind * 0.9) + Math.sin(u * 9 + id) * 1.5;
      const y = mouth.y - rise * 9 - drift * (20 + noise(id, 2) * 10) * (1 - wind * 0.55);
      const r = u < 0.12 ? 1 + u * 20 : u < 0.6 ? 3.4 + (u - 0.12) * 4 : 5.3 * (1 - (u - 0.6) / 0.4);   // растёт, потом тает
      if (r < 0.8) continue;
      const spread = 0.3 + u * 1.1;                                                       // чем дальше от трубы, тем рыхлее клуб
      puffs.push({ x, y, r, lobes: [[0, 0, 1], [(noise(id, 3) - 0.2) * r * spread * 1.4, (noise(id, 4) - 0.6) * r * spread, 0.75], [-(noise(id, 5) + 0.2) * r * spread, (noise(id, 6) - 0.3) * r * spread, 0.65]] });
    }
    // у каждого клуба — тень снизу справа, свет сверху слева, как у нарисованного дыма на картинке
    for (const p of puffs) {
      fctx.fillStyle = SMOKE.shade; for (const [dx, dy, k] of p.lobes) disc(p.x + dx, p.y + dy, p.r * k);
      fctx.fillStyle = SMOKE.light; for (const [dx, dy, k] of p.lobes) if (p.r * k >= 1.5) disc(p.x + dx - 1, p.y + dy - 1, p.r * k - 1);
    }
  }
  // Вечер и ночь: слой цвета неба умножается на кадр, а свет из окон и фонаря проедает в нём дыры — возле дома светло.
  // Сверху тот же ореол кладётся тёплой добавкой. Днём (белое небо, свет погашен) кадр остаётся как есть.
  const GLOW_ADD = 0.3;                                 // доля тёплой добавки
  // tint — цвет неба с погодой, lit — горит ли свет в доме (0..1), haze — серая дымка под тучами (0..1).
  function drawNight(tint: number[], lit: number, haze: number) {
    const g = World.glow, lights = g ? lit : 0;        // без дома светить нечему: ночь тёмная везде
    if (!lights && haze < 0.004 && tint.every(v => v >= 254)) return;
    dctx.globalCompositeOperation = 'source-over'; dctx.globalAlpha = 1;
    dctx.fillStyle = `rgb(${tint.join(',')})`; dctx.fillRect(0, 0, W, H);
    if (g && lights) { dctx.globalCompositeOperation = 'destination-out'; dctx.globalAlpha = lights; dctx.drawImage(img.glow, g.x, g.y); }
    fctx.globalCompositeOperation = 'multiply'; fctx.drawImage(dusk, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    if (haze >= 0.004) { fctx.globalAlpha = haze; fctx.fillStyle = HAZE; fctx.fillRect(0, 0, W, H); }
    if (g && lights) { fctx.globalCompositeOperation = 'lighter'; fctx.globalAlpha = lights * GLOW_ADD; fctx.drawImage(img.glow, g.x, g.y); }
    fctx.globalCompositeOperation = 'source-over'; fctx.globalAlpha = 1;
  }
  function drawMarker() {                              // куда идём
    if (!marker) return;
    const p = Math.floor(marker.t * 5) % 2, x = marker.x, y = marker.y;
    fctx.fillStyle = 'rgba(244, 227, 193, 0.9)';
    for (const [dx, dy] of [[-3 - p, 0], [2 + p, 0], [0, -2 - p], [0, 1 + p]] as const) fctx.fillRect(x + dx, y + dy, dx ? 2 : 1, dx ? 1 : 2);
  }
  const GLYPH: Record<'E' | 'F' | 'Q', string[]> = { E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'], Q: ['.###.', '#...#', '#...#', '#..#.', '.##.#'] };   // Q в три пикселя шириной не читается
  function drawKeycap(letter: 'E' | 'F' | 'Q', cx2: number, top: number) {   // клавиша-подсказка над предметом
    const x0 = cx2 - 4;
    fctx.fillStyle = '#240702'; fctx.fillRect(x0 + 1, top, 7, 9); fctx.fillRect(x0, top + 1, 9, 7);
    fctx.fillStyle = '#f4e3c1'; fctx.fillRect(x0 + 1, top + 1, 7, 7);
    fctx.fillStyle = '#240702';
    GLYPH[letter].forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') fctx.fillRect(x0 + 4 - (row.length >> 1) + i, top + 2 + j, 1, 1); });
  }
  function drawPrompts(t: number) {
    const bob = Math.floor(t * 2.5) % 2;
    if (canPick() && !hero.moving) drawKeycap('E', bucket.x, bucket.y - 30 - bob);
    else if (bucket.pointed && !bucket.carried) {      // стрелка «ведро здесь»
      fctx.fillStyle = '#240702'; fctx.fillRect(bucket.x - 3, bucket.y - 28 - bob, 7, 3); fctx.fillRect(bucket.x - 2, bucket.y - 25 - bob, 5, 1); fctx.fillRect(bucket.x - 1, bucket.y - 24 - bob, 3, 1);
      fctx.fillStyle = '#f4e3c1'; fctx.fillRect(bucket.x - 2, bucket.y - 27 - bob, 5, 1); fctx.fillRect(bucket.x - 1, bucket.y - 26 - bob, 3, 1); fctx.fillRect(bucket.x, bucket.y - 25 - bob, 1, 1);
    }
    if (canWear() && !hero.moving) drawKeycap('Q', pack.x, pack.y - P.h - 13 - bob);
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
    if (!debugLayer || debugFor !== mapRev) { debugLayer = buildDebugLayer(); debugFor = mapRev; }   // проходимость меняется, когда ведро или рюкзак переставляют
    fctx.drawImage(debugLayer, 0, 0);
    fctx.fillStyle = '#f0f'; fctx.fillRect(Math.round(hero.x), Math.round(hero.y), 1, 1);
    if (hero.path) { fctx.fillStyle = '#0ff'; for (const p of hero.path) fctx.fillRect(p.x, p.y, 1, 1); }
    const px = pointer ? `  курсор ${pointer.x},${pointer.y}  ходить ${World.canWalk(pointer.x, pointer.y) ? 'да' : 'нет'}  опора ${World.depthAt(pointer.x, pointer.y)}` : '';
    ui.debug(`герой ${hero.x.toFixed(1)},${hero.y.toFixed(1)} ${hero.dir}${hero.sitting ? ' сидит' : ''}  рыбалка ${fishing.st.phase}  ведро ${bucket.carried ? 'в руке' : bucket.x + ',' + bucket.y}  рюкзак ${pack.kind} ${pack.worn ? 'на спине' : pack.x + ',' + pack.y}  игроков рядом ${ghosts.size}  масштаб ×${view.k}${px}`);
  }

  // Имена над чужими героями — уже на экранном холсте, чтобы текст был чётким при любом масштабе.
  function drawNames() {
    const all = players(); if (!all) return;
    const dpr = window.devicePixelRatio || 1, size = Math.round(clamp(view.k * 3, 11 * dpr, 15 * dpr));
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size / 4);
    const label = (text: string, x: number, y: number) => {
      const sx = x * view.k, sy = y * view.k;
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
    const sky = skyAt(hourNow());
    fctx.drawImage(img.world, 0, 0);
    if (sky.lights && World.lights) {                  // на карте свет погашен; горящие окна и фонарь — отдельной картинкой поверх
      fctx.globalAlpha = sky.lights; fctx.drawImage(img.lights, World.lights.x, World.lights.y); fctx.globalAlpha = 1;
    }
    river.draw(fctx); drawSparkles(t, 1 - 0.9 * wx.st.clouds); drawSmoke(t, wx.st.wind);
    // кто дальше от зрителя, тот рисуется раньше
    const queue: { y: number; draw: () => void }[] = [];
    // Все, кто сидит, — один рыбак с картинки; рюкзак ему рисуем свой, а если сидят только другие — первого из них.
    let someoneSits = hero.sitting, seatPack: PackKind | null = hero.sitting && pack.worn ? pack.kind : null;
    if (ready) {
      if (!hero.sitting) queue.push({ y: hero.y, draw: () => drawHero({ ...hero, carrying: bucket.carried, pack: pack.worn ? pack.kind : null, recent: bag.recent, blink: 0 }, t) });
      if (!bucket.carried) queue.push({ y: bucket.y, draw: () => drawBucket({ ...bucket, recent: bag.recent }) });
      if (!pack.worn) queue.push({ y: pack.y, draw: () => drawPack(pack) });
    }
    players()?.forEach((p, sid) => {
      if (sid === room.sessionId) return;
      const g = ghosts.get(sid); if (!g) return;
      const worn = p.wearing ? packKind(p.pack) : null;
      if (p.sitting) { if (!someoneSits) seatPack = worn; someoneSits = true; }
      else queue.push({ y: g.y, draw: () => drawHero({ x: g.x, y: g.y, dir: p.dir, moving: g.moving, anim: g.anim, carrying: p.carrying, pack: worn, recent: p.recent, blink: g.blink }, t) });
      if (!p.carrying) queue.push({ y: p.by - 0.5, draw: () => drawBucket({ x: p.bx, y: p.by, home: p.bucketHome, recent: p.recent }) });
      if (!p.wearing) queue.push({ y: p.py - 0.5, draw: () => drawPack({ x: p.px, y: p.py, kind: packKind(p.pack) }) });
    });
    if (someoneSits) queue.push({ y: seat.y, draw: () => {
      fctx.drawImage(img.fisher, fisher.x, fisher.y);
      if (seatPack) { const a = packArt[seatPack]; fctx.drawImage(a.seat, fisher.x + a.seatX, fisher.y + a.seatY); }
    } });
    queue.sort((a, b) => a.y - b.y);
    for (const q of queue) q.draw();
    const head = { x: seat.x + 2, y: fisher.y };       // макушка сидящего рыбака
    if (hero.sitting) drawFishing(fctx, fishing.st, t, {
      x: rod.x, tipY: rod.tipY, waterY: rod.waterY, head,
      bucket: bucket.carried ? null : { x: bucket.x, y: bucket.y - B.bodyH + 4 },
    }, { line: { img: img.line, x: World.line.x, y: World.line.y }, fish: fishArt });
    else if (someoneSits) fctx.drawImage(img.line, World.line.x, World.line.y);   // чужая удочка — леска в воде, как на картинке
    wx.draw(fctx);                                     // дождь, брызги, порывы ветра, листья — поверх мира и героев
    drawNight(frameTint(sky), sky.lights, wx.haze() * Math.max(0, 1 - sky.dark * 1.6));   // ночью дымка не нужна: она бы высветлила темноту
    // всё, что ниже, — подсказки: они не темнеют
    if (hero.sitting) drawBite(fctx, fishing.st, head);
    drawMarker(); drawPrompts(t);
    if (debug) drawDebug();
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    drawNames();
  }

  // ---------- управление ----------
  function toWorld(ev: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.floor((ev.clientX - r.left) / r.width * W), y: Math.floor((ev.clientY - r.top) / r.height * H) };
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
    else if (ev.code === 'KeyQ') packAction();
    else if (ev.code === 'Escape') standUp();
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
    else if (onPack(p.x, p.y)) { if (canWear()) putOn(); else walkTo(pack.x, pack.y + 5, 'wear'); }
    else if (onFishingSpot(p.x, p.y)) { if (nearSeatNow()) sitDown(); else walkTo(seat.x, seat.y, 'sit'); }
    else walkTo(p.x, p.y);
  });
  on<PointerEvent>(canvas, 'pointermove', ev => { pointer = toWorld(ev); });
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
  (window as any).FH_GAME = { hero, bucket, pack, view, keys, ghosts, fishing, room, sitDown, standUp, walkTo, pickUp, putDown, putOn, takeOff, setPack, fishAction, bucketAction, packAction,
    step: (dt: number, n = 1) => { for (let i = 0; i < n; i++) update(dt); render(performance.now() / 1000); },
    hourNow, setClock, setWeather, wx, river, setHour: (hour: number | null) => { fixedHour = hour ?? NaN; } };   // setHour(22) останавливает время на этом часе, setHour(null) — пускает снова

  return {
    bucketAction, packAction, setPack, fishAction, standUp, setClock, setWeather,
    destroy() {
      alive = false; cancelAnimationFrame(raf);
      for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
      for (const off of offs) off();
      lift(); liftPack();
      delete (window as any).FH_GAME;
    },
  };
}
