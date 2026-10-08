// Игра в браузере: рыбак ходит по миру с картинки, носит ведро и рюкзак и ловит рыбу с края причала — вместе с другими игроками.
// Мир — карта 569×320 «арт-пикселей», ровно 16:9. Она вся в кадре: экран стоит на месте, ходит только герой.
// Кадр вписан в окно браузера целиком и на экране 16:9 занимает его весь.
//
// Сеть: свой герой ходит сразу (без ожидания сервера), шаги уходят на сервер раз в MOVE_EVERY.
// Сервер присылает «self», если с чем-то не согласен, — герой встаёт туда, где его видит сервер.
// Рыбалку ведёт сервер: клиент шлёт нажатия и показывает фазы по его событиям.
// Остальных игроков берём из состояния комнаты и плавно подтягиваем к их последнему месту.
// Время суток считаем по часам сервера: ночью кадр темнеет, а в окнах дома и в фонаре у двери загорается свет.
// Голод ведёт сервер: присылает сытость и сон; голодный ходит медленнее, спящий не ходит вовсе (экран чёрный — GameSleep).

import type { Room } from '@colyseus/sdk';
import {
  World, FISH, ITEMS, HUNGER, PACKS, PACK_KINDS, MOVE_EVERY, SPEED, CARRY_SPEED, RUN, REACH, seat, nearSeat, standPoint, dist, nearFire, faceFire, bucketNearSeat, packInReach, dayHour, dayPart, clockText, skyAt, weatherText,
  type Bag, type Catch, type ClientMessages, type Dir, type GroundView, type Hand, type PackKind, type PlayerView, type ServerMessages, type Sky, type WeatherKind, type WorldState,
} from '@fh/shared';
import { HERO } from './hero.ts';
import { createFishingView, drawBite, drawFishing, createRod, rodAngle, type FishArt } from './fishing-view.ts';
import { createRiverView } from './river-view.ts';
import { createWeatherView, HAZE } from './weather-view.ts';
import { createBoatsView } from './boats.ts';
import { createGullView } from './gull.ts';
import { createCrowView } from './crow.ts';
import { createNightView } from './night-view.ts';
import { createSoundView } from './sound.ts';
import { createFireView } from './campfire.ts';
import { LIGHT, createLightView, type LightSpot } from './light.ts';
import { groundSprite, heldPlace, heldSprite } from './held-art.ts';
import { createWildlifeView } from './wildlife.ts';
import { createHouseView } from './house.ts';
import { createPetsView } from './pets.ts';

// left и right — что сделает левая рука (Q) и правая (E): положить, что в ней (и ведро тоже), или поднять то, что рядом;
// pack — надеть или снять рюкзак (B); open — рюкзак на спине или рядом: в него можно заглянуть (I);
// light — зажечь или погасить лампу (L), когда она в руке или стоит на земле рядом; eat — еда (X): съесть рыбу из рук или достать её из ведра
export interface Actions { left: string | null; right: string | null; pack: string | null; fish: string | null; hot: boolean; stand: boolean; open: boolean; light: string | null; eat: string | null }
// Голод для интерфейса: food — сытость 0..100; until — когда герой проснётся (мс, наши часы; 0 — не спит);
// lost — сколько рыб пропало из ведра, пока он спал (null — ещё неизвестно).
export interface HungerInfo { food: number; until: number; lost: number | null }
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
  hunger(info: HungerInfo): void;
}

export interface GameHandle {
  handAction(side: Hand): void; packAction(): void; lampAction(): void; setPack(kind: PackKind): void; fishAction(): void; standUp(): void; destroy(): void;
  eatAction(): void;                                    // X: съесть рыбу из рук, а нет её — достать из ведра
  takeFish(species: string): void;                      // достать из ведра рыбу этого вида в свободную руку
  setClock(hour: number | null): void;                  // перевести часы причала на этот час (на сервере, у всех); null — настоящее время
  setWeather(kind: WeatherKind | null, wind: boolean | null): void;   // выставить погоду и ветер (на сервере, у всех); null — по расписанию
  setSound(on: boolean): void;                          // включить или выключить звук
}

// rest — сидит у костра
interface Hero { x: number; y: number; dir: Dir; sitting: boolean; rest: boolean; moving: boolean; anim: number; path: { x: number; y: number }[] | null; then: 'sit' | 'wear' | 'rest' | 'lift' | null; stuck: number; run: boolean }
interface Ghost { x: number; y: number; anim: number; moving: boolean; blink: number; seen: number }
// pack — вид рюкзака на спине или null, если герой налегке
// carrying — в какой руке ведро (null — ведра в руках нет); hands — виды других вещей в руках: в правой и в левой; lit — его лампа горит
interface Drawn { x: number; y: number; dir: Dir; rest: boolean; moving: boolean; anim: number; carrying: Hand | null; pack: PackKind | null; hands: string[]; lit: boolean; recent: ArrayLike<string>; blink: number }

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

  const hero: Hero = { x: seat.x, y: seat.y, dir: 'down', sitting: true, rest: false, moving: false, anim: 0, path: null, then: null, stuck: 0, run: false };
  const pack = { x: P.baseX, y: P.baseY, worn: false, kind: PACKS.DEFAULT, blocked: null as number[] | null };
  let bag: Bag = { counts: {}, best: {}, total: 0, grams: 0, recent: [] };
  let pendingBag: Bag | null = null;                                         // ведро после подсечки — покажем, когда рыба долетит
  let food: number = HUNGER.MAX, sleepUntil = 0, lost: number | null = null;   // сытость и сон — как их назвал сервер (HungerInfo)
  const view = { k: 1 };                                                     // k — во сколько раз холст крупнее карты в арт-пикселях
  const keys = new Set<string>();
  let shift = false, lastDown = { t: -1e9, x: 0, y: 0 };   // Shift зажат; прошлый клик — для двойного
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
  // Вещи в рюкзаке движок не рисует — их принимает страница игры и показывает окно рюкзака.
  type Queued = Exclude<keyof ServerMessages, 'clock' | 'weather' | 'items'>;
  type Inbox = { [K in Queued]: [K, ServerMessages[K]] }[Queued];
  let inbox: Inbox[] | null = [];
  const receive = (m: Inbox) => { if (inbox) inbox.push(m); else handle(m); };
  const offs = [
    room.onMessage('self', (m: ServerMessages['self']) => receive(['self', m])),
    room.onMessage('bag', (m: ServerMessages['bag']) => receive(['bag', m])),
    room.onMessage('fish', (m: ServerMessages['fish']) => receive(['fish', m])),
    room.onMessage('hunger', (m: ServerMessages['hunger']) => receive(['hunger', m])),
    room.onMessage('food', (m: ServerMessages['food']) => receive(['food', m])),
    room.onMessage('clock', (m: ServerMessages['clock']) => { skew = m.now - Date.now(); pier = { canSet: m.canSet, moved: m.moved }; }),
    room.onMessage('weather', (m: ServerMessages['weather']) => { weather = m; }),
  ];

  // ---------- картинки ----------
  const img: Record<'world' | 'fisher' | 'line' | 'bucket' | 'carry' | 'pack' | 'house' | 'lights' | 'glow', HTMLImageElement> = {} as any;
  const files: Partial<Record<keyof typeof img, string>> = { world: 'world.png', fisher: 'fisher.png', line: 'line.png', bucket: 'bucket.png', carry: 'bucket-carry.png', pack: 'pack-ground.png', house: 'house.png' };
  if (World.lights) Object.assign(files, { lights: 'lights.png', glow: 'glow.png' });   // свет в окнах — только пока дом стоит на карте
  await Promise.all((Object.keys(files) as (keyof typeof img)[]).map(k => loadImage('/assets/' + files[k] + '?v=' + World.rev).then(im => { img[k] = im; })));
  const rigs = {} as Record<string, { arm: HTMLCanvasElement; x: number; y: number; bucket: [number, number] }>;   // ключ — сторона и рука: 'down:left'
  const fishArt: Record<string, FishArt & { tail: [string, string] }> = {};
  const rodArt = createRod(img.fisher);
  for (const dir of ['down', 'up', 'left', 'right'] as const) {
    for (const hand of ['left', 'right'] as const) { const rig = HERO.carryRig(dir, hand); rigs[dir + ':' + hand] = { arm: fromPixels(rig), x: rig.x, y: rig.y, bucket: rig.bucket }; }
  }
  // Кадры героя: налегке и с рюкзаком каждого вида, с ведром и без. Набор собирается, когда впервые понадобился.
  const frameSets = new Map<string, Record<Dir, HTMLCanvasElement[]>>();
  // rest — кадры сидящего у костра
  function heroFrames(carry: Hand | null, kind: PackKind | null, rest = false) {
    const key = (carry || '-') + (kind || '') + (rest ? '~' : '');
    let set = frameSets.get(key);
    if (!set) {
      const px = HERO.build(carry || false, kind && PACKS.tones(kind)); set = {} as Record<Dir, HTMLCanvasElement[]>;
      for (const dir of Object.keys(px) as Dir[]) set[dir] = px[dir].map(buf => fromPixels({ w: FW, h: FH, data: rest ? HERO.seated(buf) : buf }));
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
  const boats = createBoatsView(W, H, river.water);                          // лодки у причала; их пиксели — уже не вода
  const nightLife = createNightView(river.water);                                // светлячки, отсвет окон и лунная дорожка на воде
  const campfire = createFireView(), fire = World.fire;                      // костёр у дома: у него можно посидеть
  const sound = createSoundView();                                           // дождь, ветер, ночной хор, костёр, рыбалка — звук
  let heard = '';                                                            // фаза рыбалки, о которой звук уже сказал
  const crow = createCrowView();                                             // ворона над поляной и на крыше дома
  const gull = createGullView(W);                                            // чайка над водой и на столбах причала
  const life = createWildlifeView(W, H, river.water);                        // утки и рыбы на открытой воде, в стороне от лодок
  const home = createHouseView(img.house, img.world);                        // дом поверх карты: за ним можно спрятаться
  const pets = createPetsView();                                             // кот и собака бродят по поляне; создаём после дома — он им тоже не по пути
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
  // Можно ли поставить предмет дном в точку: под ним земля, место рыбака свободно, и герой не окажется внутри.
  // half — полуширина дна: 5 у ведра, 4 у рюкзака.
  function fits(x: number, y: number, half = 5) {
    if (!World.canWalk(x, y) || !World.canWalk(x - half, y) || !World.canWalk(x + half, y) || !World.canWalk(x, y - 2)) return false;
    if (x >= seat.x - 7 - half && x <= seat.x + 9 + half && y >= seat.y - 12 && y <= seat.y + 8) return false;
    const dx = (hero.x - x) / (half + 3.5), dy = (hero.y - (y - 1)) / 4.5;
    return hero.sitting || dx * dx + dy * dy > 1;
  }
  // Ведро — вещь: его носят в любой руке и ставят на землю, как всё остальное (Q и E). Сидящему рыбаку ведро из руки
  // рисуем рядом на настиле — улов летит туда.
  const SEAT_PAIL = { x: seat.x + 26, y: seat.y - 13 };
  // В какой руке ведро у игрока с такими руками; null — ведра в руках нет.
  const pailHand = (p: { hand: string; off: string }): Hand | null => (ITEMS.isBucket(p.hand) ? 'right' : ITEMS.isBucket(p.off) ? 'left' : null);
  // Что ещё в руках, кроме ведра: [правая, левая].
  const otherHands = (p: { hand: string; off: string }) => [ITEMS.isBucket(p.hand) ? '' : p.hand, ITEMS.weight(p.hand) > 1 || ITEMS.isBucket(p.off) ? '' : p.off];
  // Ведро на земле у места рыбака — ближайшее; в него идёт улов, если своего в руке нет.
  const pailBySeat = () => groundItems().filter(g => ITEMS.isBucket(g.kind) && bucketNearSeat(g)).sort((a, b) => dist(a, seat) - dist(b, seat))[0] || null;
  const ownPail = () => { const me = ownView(); return me ? pailHand(me) : null; };

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
  const onPack = (x: number, y: number) => !pack.worn && x >= pack.x - 7 && x <= pack.x + 7 && y >= pack.y - 12 && y <= pack.y + 2;
  const onHero = (x: number, y: number) => Math.abs(x - hero.x) <= 10 && y <= hero.y + 2 && y >= hero.y - FH;
  // Река и причал с его сваями: всё непроходимое ниже линии берега. Линия снята с картинки; по бокам от неё берег свой.
  const bankY = (px: number) => (px < 0 ? 205 : px < 60 ? 226 : px < 132 ? 232 : px < World.pic.w ? 250 : 244);
  const inWater = (x: number, y: number) => !World.canWalk(x, y) && y >= bankY(x - World.pic.x) + World.pic.y;

  function standUp() {
    if (hero.rest) { hero.rest = false; send('stand'); return; }
    if (!hero.sitting) return;
    fishing.leave();
    const p = standPoint();
    hero.sitting = false; hero.x = p.x; hero.y = p.y; hero.dir = 'down'; lastSent = { x: p.x, y: p.y };
    send('stand');
  }
  function sitDown() {
    if (hero.sitting) return;
    flushMove();
    hero.sitting = true; hero.path = null; hero.then = null; hero.moving = false; hero.x = seat.x; hero.y = seat.y; marker = null;
    lastSent = { x: seat.x, y: seat.y };
    fishing.sit();
    send('sit');
  }
  // У костра садятся там, где стоят, лицом к огню. Встают кнопкой, Esc или просто уходят.
  const nearFireNow = () => !hero.sitting && !hero.rest && nearFire(hero);
  const onFire = (x: number, y: number) => Math.abs(x - fire.x) <= 13 && y >= fire.y - 22 && y <= fire.y + 8;
  function restDown() {
    if (!nearFireNow()) return;
    flushMove();
    hero.dir = faceFire(hero);
    hero.rest = true; hero.path = null; hero.then = null; hero.moving = false; marker = null;
    send('rest');
    if (ownHands().includes('fish')) ui.toast(`Рыба жарится — посиди у огня ${HUNGER.COOK} секунд`);
  }
  function fishAction() {                               // F, пробел: сесть, забросить, подсечь
    if (hero.sitting) send('press'); else if (nearSeatNow()) sitDown(); else restDown();
  }
  function walkTo(x: number, y: number, then?: 'sit' | 'wear' | 'rest' | 'lift', run = false) {
    if (hero.sitting || hero.rest) standUp();
    const path = World.findPath(hero, { x, y });
    if (!path || !path.length) { hero.path = null; marker = null; return; }
    hero.path = path; hero.then = then || null; hero.stuck = 0; hero.run = run;
    const end = path[path.length - 1]!; marker = then ? null : { x: end.x, y: end.y, t: 0 };
    noteMoved();
  }
  function arrive() {
    const then = hero.then; hero.path = null; hero.then = null; marker = null;
    if (then === 'sit' && nearSeatNow()) sitDown();
    else if (then === 'wear') putOn();
    else if (then === 'rest') restDown();
    else if (then === 'lift') liftUp();
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
    hero.rest = !!w.rest && !hero.sitting;
    liftPack();
    pack.kind = w.pack.kind; ui.pack(pack.kind);
    if (w.pack.worn) pack.worn = true; else settlePack(w.pack.x, w.pack.y);
    lastSent = { x: hero.x, y: hero.y };
    if (!ready) { ready = true; layout(); }
  }
  const fishing = createFishingView(landed);
  function landed(fish: Catch) {                        // рыба в ведре: показываем, что сервер уже засчитал
    const sp = FISH.byId[fish.id]!, first = !bag.counts[fish.id], record = !first && fish.grams > (bag.best[fish.id] || 0);
    if (pendingBag) { bag = pendingBag; pendingBag = null; ui.bag(bag); }
    sound.cue('catch');
    ui.toast(`${sp.name} · ${FISH.weightText(fish.grams)}${first ? ' — новый вид!' : record ? ' — крупнее прежних!' : ''}`, 'good', fish.id);
  }
  function handle([type, m]: Inbox) {
    if (type === 'self') applySelf(m);
    else if (type === 'bag') { bag = m; pendingBag = null; ui.bag(bag); }
    else if (type === 'hunger') hungerNews(m);
    else if (type === 'food') {
      const name = ITEMS.title({ kind: m.e === 'cooked' || !m.raw ? 'fish-fried' : 'fish', fish: m.fish });
      if (m.e === 'cooked') { sound.cue('catch'); ui.toast(`${name} — готово! Съесть — X`, 'good', m.fish); }
      else ui.toast(m.gain ? `Съедено: ${name.toLowerCase()} · сытость +${m.gain}` : `Съедено: ${name.toLowerCase()} — ты и так сыт`, 'good', m.fish);
    }
    else if (m.e === 'needRod') {                       // рыбачат удочкой в руке; заодно скажем и про ведро, чтобы не ходить дважды
      ui.toast(ownPail() || pailBySeat() ? 'Нужна удочка: возьми её из рюкзака в руку' : 'Нужна удочка в руке и ведро — в руке или рядом. Удочка — в рюкзаке', 'bad');
    }
    else if (m.e === 'needBucket') ui.toast('Рыбу некуда класть. Возьми ведро в руку или поставь его у причала');
    else {
      if (m.e === 'early') ui.toast('Рано дёрнул — рыба ушла', 'bad');
      else if (m.e === 'miss') ui.toast('Сорвалась…', 'bad');
      else if (m.e === 'hook' && m.bag) pendingBag = m.bag;
      if (m.e === 'early' || m.e === 'miss') sound.cue('miss');
      fishing.apply(m);
    }
  }

  // ---------- голод ----------
  const asleep = () => sleepUntil > 0;
  function hungerNews(m: ServerMessages['hunger']) {
    const was = food, slept = asleep();
    food = m.food; sleepUntil = m.sleep > 0 ? Date.now() + m.sleep : 0;
    if (m.lost !== undefined) lost = m.lost; else if (asleep() && !slept) lost = null;
    if (asleep()) { keys.clear(); hero.path = null; hero.then = null; marker = null; hero.moving = false; }
    if (slept && !asleep()) ui.toast('Ты выспался у своего дома — сыт и полон сил', 'good');
    else if (!asleep() && food === 0 && was > 0) ui.toast('Ты голоден — поешь! Достань рыбу из ведра (X) и пожарь у костра', 'bad');
    else if (food <= HUNGER.LOW && was > HUNGER.LOW && food > 0) ui.toast('Хочется есть — пожарь рыбу на костре');
    ui.hunger({ food, until: sleepUntil, lost });
  }
  // Еда (X): что-то съедобное в руках — съесть (жареную первой); нет — достать рыбу из ведра в свободную руку.
  const mealInHand = () => { const h = ownHands(); return h.includes('fish-fried') ? 'fish-fried' : h.includes('fish') ? 'fish' : null; };
  // Ведро под рукой: в руке; у сидящего — у места рыбака; у стоящего — на земле рядом (чьё угодно: улов у каждого свой).
  const pailNear = () => !!ownPail() || (hero.sitting ? !!pailBySeat() : !!ITEMS.nearest(hero, groundItems().filter(g => ITEMS.isBucket(g.kind))));
  const handFree = () => !inHand('right') || !inHand('left');
  const firstFish = () => FISH.SPECIES.find(sp => bag.counts[sp.id])?.id ?? null;   // самую простую — первой
  function takeFish(species: string) {
    if (!ready || asleep()) return;
    if (!bag.counts[species]) { ui.toast('Такой рыбы в ведре нет', 'bad'); return; }
    if (!pailNear()) { ui.toast('Ведро далеко — подойди к нему или возьми его в руку', 'bad'); return; }
    if (!handFree()) { ui.toast('Руки заняты — освободи одну, чтобы достать рыбу', 'bad'); return; }
    flushMove(); send('fishTake', { species });
  }
  function eatAction() {
    if (!ready || asleep()) return;
    if (mealInHand()) { send('eat', {}); return; }
    const sp = firstFish();
    if (sp) takeFish(sp); else if (pailNear()) ui.toast('В ведре пусто — сначала налови рыбы', 'bad');
  }
  const eatText = () => {
    const meal = mealInHand();
    if (meal) return meal === 'fish' ? 'Съесть сырую рыбу' : 'Съесть жареную рыбу';
    return firstFish() && pailNear() && handFree() ? 'Достать рыбу из ведра' : null;
  };

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
    if (asleep()) { keys.clear(); hero.path = null; }   // спящий не ходит
    let dx = 0, dy = 0, passed = false;
    for (const code of keys) { dx += DIRS[code]![0]; dy += DIRS[code]![1]; }
    const running = shift || (!dx && !dy && hero.run && !!hero.path);   // клавишами бежим с Shift, по клику — с Shift или двойным кликом
    const pace = (running ? RUN : 1) * HUNGER.pace(food), step = (ownPail() ? CARRY_SPEED : SPEED) * pace * dt;   // голодный еле плетётся
    if (dx || dy) {                                   // клавиши важнее пути
      if (hero.sitting || hero.rest) standUp();
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
    hero.anim = hero.moving ? hero.anim + dt * STEP_FPS * pace : 0;
    if (marker) marker.t += dt;
    fishing.update(dt);
    const ph = fishing.st.phase;                       // заброс и поклёвку слышно
    if (ph !== heard) { if (ph === 'cast' || ph === 'bite') sound.cue(ph); heard = ph; }
    sound.update(dt, { dark: skyAt(hourNow()).dark, ...wx.st, walk: hero.moving ? (running ? 2 : 1) : 0, fire: Math.max(0, 1 - dist(hero, fire) / 110) });

    sendIn -= dt;
    if (sendIn <= 0) flushMove();
    clockIn -= dt; flushClock();
    refreshActions(); refreshSky();
  }
  // Что у героя в руке, где стоит его лампа и горит ли она — по состоянию комнаты: там то, что решил сервер и что видят остальные.
  const ownView = () => { let me: PlayerView | null = null; players()?.forEach((p, sid) => { if (sid === room.sessionId) me = p; }); return me as PlayerView | null; };
  const ownHands = () => { const me = ownView(); return me ? [me.hand, me.off].filter(Boolean) : []; };
  // Что в правой и в левой руке (тяжёлая — в обеих), как это видит сервер; '' — рука пуста.
  const inHand = (side: Hand) => { const me = ownView(); if (!me) return ''; return side === 'right' || ITEMS.weight(me.hand) > 1 ? me.hand : me.off; };
  const leftFree = () => !inHand('left');
  // Вещи на земле — общие для всех: что, где и горит ли (лампа). Поднять можно любую, до которой дотянешься, — она станет твоей.
  type Lying = GroundView & { id: number };
  const groundItems = () => {
    const out: Lying[] = [];
    (room.state as { ground?: { forEach(cb: (g: GroundView, key: string) => void): void } } | undefined)?.ground?.forEach((g, key) => out.push({ id: Number(key), kind: g.kind, x: g.x, y: g.y, lit: g.lit, fish: g.fish }));
    return out;
  };
  const groundInReach = () => (hero.sitting ? null : ITEMS.nearest(hero, groundItems()));
  // На какую вещь на земле показали: по её картинке, с запасом в пиксель; из нескольких — ближайшая к точке.
  const groundAt = (x: number, y: number) => groundItems().filter(g => {
    if (ITEMS.isBucket(g.kind)) return x >= g.x - 9 && x <= g.x + 9 && y >= g.y - 19 && y <= g.y + 2;
    const art = groundSprite(g.kind, g.lit); if (!art) return false;
    return Math.abs(x - g.x) <= (art.w >> 1) + 2 && y >= g.y - art.h - 1 && y <= g.y + 3;
  }).sort((a, b) => dist(a, { x, y }) - dist(b, { x, y }))[0] || null;
  // Какую лампу зажигать и гасить: ту, что в руке, а нет её — ближайшую на земле (любую, свою или чужую).
  const lampNear = () => ITEMS.lampNear(hero, ownHands().map(kind => ({ kind })), hero.sitting ? [] : groundItems());
  function lampAction() {
    const l = lampNear(); if (!l) return;
    if (l === 'hand') send('lamp', { on: !ownView()?.lamp }); else send('lamp', { on: !l.lit, id: l.id });
  }
  // Поднять ближайшую вещь с земли — в эту руку (не назвали — в свободную; занята — сервер уберёт вещь в рюкзак, если он рядом).
  function liftUp(side?: Hand) {
    const g = groundInReach(); if (!ready || !g) return;
    flushMove(); send('itemPick', { id: g.id, ...(side && { left: side === 'left' }) });
  }
  // Кладём то, что в этой руке, рядом с собой, с её стороны, — туда, где вещь видно и где не лежит другая.
  function layDown(side: Hand) {
    const out = (side === 'left' ? HERO.hand2(hero.dir, 0) : HERO.hand(hero.dir, 0)).out, lying = groundItems();
    const pail = ITEMS.isBucket(inHand(side)), k = pail ? 1.45 : 1, room = pail ? 11 : 5;   // ведро шире — ставим дальше и просторнее
    const spots = [[9 * out, 2], [-9 * out, 2], [0, 7], [9 * out, 6], [-9 * out, 6], [0, -7], [14 * out, 2], [-14 * out, 2]];
    for (const [dx, dy] of spots) {
      const x = Math.round(hero.x + dx! * k), y = Math.round(hero.y + dy! * (pail && dy! < 0 ? 1.2 : 1));
      const seen = [0, 3, 6].every(up => World.depthAt(x, y - up) <= y);   // не за вывеской и не под кроной: вещь должно быть видно
      if (fits(x, y, pail ? 5 : 2) && seen && lying.every(g => dist(g, { x, y }) >= room)) { flushMove(); send('itemPut', { x, y, left: side === 'left' }); return; }
    }
    ui.toast('Здесь не положить — тесно', 'bad');
  }
  // E — правая рука, Q — левая. В руке что-то есть (и ведро тоже) — кладём на землю; пусто — поднимаем ближайшую вещь.
  function handTarget(side: Hand): 'drop' | 'lift' | null {
    if (hero.sitting) return null;
    if (inHand(side)) return 'drop';
    return groundInReach() ? 'lift' : null;
  }
  function handAction(side: Hand) {
    if (!ready) return;
    const what = handTarget(side);
    if (what === 'drop') layDown(side); else if (what === 'lift') liftUp(side);
  }
  const handText = (side: Hand) => {
    const what = handTarget(side); if (!what) return null;
    const hand = side === 'left' ? 'левой' : 'правой';
    if (what === 'drop') return ITEMS.isBucket(inHand(side)) ? 'Поставить ведро' : 'Положить из ' + hand;
    return ITEMS.isBucket(groundInReach()!.kind) ? 'Взять ведро ' + hand : 'Поднять ' + hand;
  };
  // Горит ли лампа под рукой; null — лампы под рукой нет.
  const lampOn = () => { const l = lampNear(); return l === 'hand' ? !!ownView()?.lamp : l ? l.lit : null; };
  function refreshActions() {
    const ph = fishing.st.phase;
    const a: Actions = {
      left: handText('left'), right: handText('right'),
      pack: hero.sitting ? null : pack.worn ? 'Снять рюкзак' : canWear() ? 'Надеть рюкзак' : null,
      fish: hero.sitting
        ? (ph === 'rest' ? 'Забросить' : ph === 'bite' ? 'Подсекай!' : ph === 'wait' || ph === 'cast' || ph === 'scare' ? 'Подсечь' : 'Есть!')
        : nearSeatNow() ? 'Сесть рыбачить' : nearFireNow() ? 'Сесть у костра' : null,
      hot: hero.sitting && ph === 'bite',
      stand: hero.sitting || hero.rest,
      open: packInReach(hero, pack),
      light: lampOn() === null ? null : lampOn() ? 'Погасить лампу' : 'Зажечь лампу',
      eat: asleep() ? null : eatText(),
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
  function drawBucket(b: { x: number; y: number; recent: ArrayLike<string> }) {   // ведро на земле
    const ox = b.x - (B.baseX - B.x), oy = b.y - (B.baseY - B.y) - TOP;
    pctx.clearRect(0, 0, pail.width, pail.height);
    if (b.x === B.baseX && b.y === B.baseY) pctx.drawImage(img.bucket, 0, TOP);                // на своём месте — в точности как на картинке, с её тенью
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
  // Вещь на земле: та же маленькая картинка, что в руке (длинная лежит плашмя), и тень под ней. x, y — где она лежит.
  function drawGround(kind: string, lit: boolean, x: number, y: number) {
    const art = groundSprite(kind, lit); if (!art || art.w + 2 > CW) return;
    cctx.clearRect(0, 0, CW, CH);
    cctx.fillStyle = 'rgba(18, 22, 10, 0.3)';
    cctx.fillRect(1, art.h - 1, art.w, 1); cctx.fillRect(2, art.h, art.w - 2, 1);
    cctx.drawImage(art.img, 1, 0);
    blit(cell, cctx, x - 1 - (art.w >> 1), y - (art.h - 1), y);
  }
  function drawHero(a: Drawn, t: number) {
    const hx = Math.round(a.x), hy = Math.round(a.y);
    const f = a.moving && !a.rest ? 1 + (Math.floor(a.anim) % 4) : ((t + a.blink) % 3.7 < 0.14 ? 5 : 0);   // стоя иногда моргает
    cctx.clearRect(0, 0, CW, CH);
    cctx.fillStyle = 'rgba(18, 22, 10, 0.3)';         // тень под ногами
    cctx.fillRect(CX + 4, FH - 2, 11, 1); cctx.fillRect(CX + 2, FH - 1, 15, 2); cctx.fillRect(CX + 4, FH + 1, 11, 1);
    // вещи в руках: первая — в правой, вторая — в левой. Они сбоку от тела и видны с любой стороны, поэтому рисуются
    // поверх героя; только сбоку левая рука — дальняя, и вещь в ней тело закрывает. Ведро висит на своей руке (rigs)
    const side = a.dir === 'left' || a.dir === 'right', first = heldSprite(a.hands[0] || '', a.lit), second = heldSprite(a.hands[1] || '', a.lit);
    const off = second && HERO.hand2(a.dir, f, a.rest);
    const put = (art: NonNullable<typeof first>, at: { x: number; y: number; out: -1 | 1 }) => { const p = heldPlace(art, at, side, FH - 1); cctx.drawImage(p.img, CX + p.x, p.y); };
    if (second && off && off.far) put(second, off);
    cctx.drawImage(heroFrames(a.carrying, a.pack, a.rest)[a.dir][f]!, CX, 0);
    if (first) put(first, HERO.hand(a.dir, f, a.rest));
    if (second && off && !off.far) put(second, off);
    if (a.carrying) {                                 // ведро в руке качается вместе с плечом
      const rig = rigs[a.dir + ':' + a.carrying]!, side = a.dir === 'left' || a.dir === 'right';
      const sway = side ? (f === 2 || f === 4 ? -1 : 0) : (f === 1 || f === 3 ? 1 : 0);
      const bx = CX + ANCHOR + rig.bucket[0] - (img.carry.width >> 1), by = FH - 1 + rig.bucket[1] - (img.carry.height - 1) + sway;
      cctx.drawImage(img.carry, bx, by);
      drawTails(cctx, bx, by + B.handle, a.recent);
      cctx.drawImage(rig.arm, CX + rig.x, rig.y + sway + (a.rest ? HERO.REST : 0));   // сидя плечо ниже
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
  // Где сейчас горит огонь: костёр и зажжённые лампы — в руке у героя (тогда свет при нём) и на земле, чьи бы они ни были.
  // В рюкзаке лампа не горит. Так сказал сервер.
  const light = createLightView();
  function lampSpots() {
    const out: LightSpot[] = [{ x: fire.x, y: fire.y - 4, k: 1.5 }];   // костёр горит всегда и светит дальше лампы
    for (const g of groundItems()) if (g.kind === 'lamp' && g.lit) out.push({ x: g.x, y: g.y - 4 });
    players()?.forEach((p, sid) => {
      if (!p.lamp || p.hand !== 'lamp' && p.off !== 'lamp') return;
      const mine = sid === room.sessionId, g = mine ? (ready ? hero : null) : ghosts.get(sid); if (!g) return;
      if (mine ? hero.sitting : p.sitting) out.push({ x: seat.x, y: seat.y - 12 }); else out.push({ x: g.x, y: g.y - 14 });
    });
    return out;
  }
  // tint — цвет неба с погодой, lit — горит ли свет в доме (0..1), haze — серая дымка под тучами (0..1).
  // lamps — где горят костёр и лампы игроков, lamp — в какую силу (днём 0), t — секунды: огонь дрожит.
  function drawNight(tint: number[], lit: number, haze: number, lamps: LightSpot[], lamp: number, t: number) {
    const g = World.glow, lights = g ? lit : 0;        // без дома светить нечему: ночь тёмная везде
    if (!lights && haze < 0.004 && tint.every(v => v >= 254)) return;
    if (lamp <= 0) lamps = [];
    dctx.globalCompositeOperation = 'source-over'; dctx.globalAlpha = 1;
    dctx.fillStyle = `rgb(${tint.join(',')})`; dctx.fillRect(0, 0, W, H);
    if (g && lights) { dctx.globalCompositeOperation = 'destination-out'; dctx.globalAlpha = lights; dctx.drawImage(img.glow, g.x, g.y); }
    if (lamps.length) { dctx.globalCompositeOperation = 'destination-out'; light.beam(dctx, lamps, LIGHT.hole * lamp, t); }
    fctx.globalCompositeOperation = 'multiply'; fctx.drawImage(dusk, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    if (haze >= 0.004) { fctx.globalAlpha = haze; fctx.fillStyle = HAZE; fctx.fillRect(0, 0, W, H); }
    if (g && lights) { fctx.globalCompositeOperation = 'lighter'; fctx.globalAlpha = lights * GLOW_ADD; fctx.drawImage(img.glow, g.x, g.y); }
    if (lamps.length) { fctx.globalCompositeOperation = 'lighter'; light.beam(fctx, lamps, LIGHT.warm * lamp, t); }
    fctx.globalCompositeOperation = 'source-over'; fctx.globalAlpha = 1;
  }
  function drawMarker() {                              // куда идём
    if (!marker) return;
    const p = Math.floor(marker.t * 5) % 2, x = marker.x, y = marker.y;
    fctx.fillStyle = 'rgba(244, 227, 193, 0.9)';
    for (const [dx, dy] of [[-3 - p, 0], [2 + p, 0], [0, -2 - p], [0, 1 + p]] as const) fctx.fillRect(x + dx, y + dy, dx ? 2 : 1, dx ? 1 : 2);
  }
  const GLYPH: Record<'E' | 'F' | 'Q' | 'B', string[]> = { E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'], Q: ['.###.', '#...#', '#...#', '#..#.', '.##.#'], B: ['##.', '#.#', '##.', '#.#', '##.'] };   // Q — в пять пикселей шириной: уже не читается
  function drawKeycap(letter: 'E' | 'F' | 'Q' | 'B', cx2: number, top: number) {   // клавиша-подсказка над предметом
    const x0 = cx2 - 4;
    fctx.fillStyle = '#240702'; fctx.fillRect(x0 + 1, top, 7, 9); fctx.fillRect(x0, top + 1, 9, 7);
    fctx.fillStyle = '#f4e3c1'; fctx.fillRect(x0 + 1, top + 1, 7, 7);
    fctx.fillStyle = '#240702';
    GLYPH[letter].forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') fctx.fillRect(x0 + 4 - (row.length >> 1) + i, top + 2 + j, 1, 1); });
  }
  // Над спящим от голода — «z z», уплывают вверх.
  const ZED = ['####', '..#.', '.#..', '####'];
  function drawSleepers(t: number) {
    const heads: { x: number; y: number }[] = [];
    players()?.forEach((p, sid) => {
      if (!p.sleep) return;
      const g = sid === room.sessionId ? (ready ? hero : null) : ghosts.get(sid);
      if (g) heads.push({ x: Math.round(g.x) + 4, y: Math.round(g.y) - FH - 2 });
    });
    for (const h of heads) for (let i = 0; i < 2; i++) {
      const u = (t * 0.6 + i * 0.5) % 1, x = h.x + i * 5 + Math.round(Math.sin(u * 6) * 1.5), y = h.y - Math.round(u * 10);
      fctx.globalAlpha = 1 - u * 0.8; fctx.fillStyle = '#f4e3c1';
      ZED.forEach((row, j) => { for (let k = 0; k < row.length; k++) if (row[k] === '#') fctx.fillRect(x + k, y + j, 1, 1); });
    }
    fctx.globalAlpha = 1;
  }
  function drawPrompts(t: number) {
    drawSleepers(t);
    const bob = Math.floor(t * 2.5) % 2;
    if (canWear() && !hero.moving) drawKeycap('B', pack.x, pack.y - P.h - 13 - bob);
    const lying = groundInReach(), tall = lying && (ITEMS.isBucket(lying.kind) ? B.bodyH + 2 : groundSprite(lying.kind, lying.lit)?.h);   // чем поднять: правой, а занята — левой
    const key = handTarget('right') === 'lift' ? 'E' : handTarget('left') === 'lift' ? 'Q' : null;
    if (lying && tall && key && !hero.moving) drawKeycap(key, lying.x, lying.y - tall - 10 - bob);
    if ((nearSeatNow() || nearFireNow()) && !hero.moving) drawKeycap('F', Math.round(hero.x), Math.round(hero.y) - FH - 11 - bob);
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
    ui.debug(`герой ${hero.x.toFixed(1)},${hero.y.toFixed(1)} ${hero.dir}${hero.sitting ? ' сидит' : ''}  рыбалка ${fishing.st.phase}  ведро ${ownPail() ?? 'не в руке'}  рюкзак ${pack.kind} ${pack.worn ? 'на спине' : pack.x + ',' + pack.y}  игроков рядом ${ghosts.size}  масштаб ×${view.k}${px}`);
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
    fctx.drawImage(img.world, 0, 0); home.draw(fctx);
    if (sky.lights && World.lights) {                  // на карте свет погашен; горящие окна и фонарь — отдельной картинкой поверх
      fctx.globalAlpha = sky.lights; fctx.drawImage(img.lights, World.lights.x, World.lights.y); fctx.globalAlpha = 1;
    }
    river.draw(fctx); drawSparkles(t, 1 - 0.9 * wx.st.clouds); drawSmoke(t, wx.st.wind);
    // кто дальше от зрителя, тот рисуется раньше
    const queue: { y: number; draw: () => void }[] = [];
    for (const b of boats) queue.push({ y: b.y, draw: () => b.draw(fctx, t) });
    queue.push({ y: fire.y, draw: () => campfire.draw(fctx, t) });
    for (const g of groundItems()) queue.push({ y: g.y - 0.5, draw: () => (ITEMS.isBucket(g.kind) ? drawBucket({ x: g.x, y: g.y, recent: g.fish ? g.fish.split(',') : [] }) : drawGround(g.kind, g.lit, g.x, g.y)) });   // вещи на земле — свои и чужие
    const people = [...(ready ? [hero] : []), ...ghosts.values()];
    const afoot: { x: number; y: number }[] = ready && !hero.sitting ? [hero] : [];// кто на ногах: сидящего рыбака чайка не боится
    players()?.forEach((p, sid) => { const g = ghosts.get(sid); if (g && !p.sitting && sid !== room.sessionId) afoot.push(g); });
    const bird = gull.at(Date.now() + skew, afoot);  // сидящая — в очереди по низу столба, летящая — поверх всех
    if (bird?.perched) queue.push({ y: bird.base, draw: () => fctx.drawImage(bird.img, bird.x, bird.y) });
    const wild = life.at(Date.now() + skew, people);   // кто подойдёт близко, спугнёт утку
    for (const w of wild.water) queue.push({ y: w.y, draw: () => w.draw(fctx) });
    for (const p of pets.at(Date.now() + skew, Number.isFinite(fixedHour) ? fixedHour : undefined)) queue.push({ y: p.y, draw: () => p.draw(fctx) });   // кот и собака — как все, по лапам
    // Все, кто сидит, — один рыбак с картинки; рюкзак ему рисуем свой, а если сидят только другие — первого из них.
    let someoneSits = hero.sitting, seatPack: PackKind | null = hero.sitting && pack.worn ? pack.kind : null;
    let seatRod = hero.sitting && ownHands().some(ITEMS.isRod);   // у сидящего удочка в руках, только если она у него и правда в руке
    let seatPail: ArrayLike<string> | null = hero.sitting && ownPail() ? bag.recent : null;   // ведро в руке сидящего — рядом на настиле
    if (ready) {
      const me = ownView() ?? { hand: '', off: '' };
      if (!hero.sitting) queue.push({ y: hero.y, draw: () => drawHero({ ...hero, carrying: pailHand(me), pack: pack.worn ? pack.kind : null, hands: otherHands(me), lit: !!ownView()?.lamp, recent: bag.recent, blink: 0 }, t) });
      if (!pack.worn) queue.push({ y: pack.y, draw: () => drawPack(pack) });
    }
    players()?.forEach((p, sid) => {
      if (sid === room.sessionId) return;
      const g = ghosts.get(sid); if (!g) return;
      const worn = p.wearing ? packKind(p.pack) : null;
      if (p.sitting) { if (!someoneSits) seatPack = worn; someoneSits = true; seatRod ||= ITEMS.isRod(p.hand) || ITEMS.isRod(p.off); if (!seatPail && pailHand(p)) seatPail = p.recent; }
      else queue.push({ y: g.y, draw: () => drawHero({ x: g.x, y: g.y, dir: p.dir, rest: p.rest, moving: g.moving, anim: g.anim, carrying: pailHand(p), pack: worn, hands: otherHands(p), lit: p.lamp, recent: p.recent, blink: g.blink }, t) });
      if (!p.wearing) queue.push({ y: p.py - 0.5, draw: () => drawPack({ x: p.px, y: p.py, kind: packKind(p.pack) }) });
    });
    if (seatPail) { const recent = seatPail; queue.push({ y: SEAT_PAIL.y, draw: () => drawBucket({ ...SEAT_PAIL, recent }) }); }
    if (someoneSits) queue.push({ y: seat.y, draw: () => {
      rodArt.draw(fctx, fisher.x, fisher.y, hero.sitting ? rodAngle(fishing.st) : 0, seatRod);   // при подсечке удочка поднимается
      if (seatPack) { const a = packArt[seatPack]; fctx.drawImage(a.seat, fisher.x + a.seatX, fisher.y + a.seatY); }
    } });
    queue.sort((a, b) => a.y - b.y);
    for (const q of queue) q.draw();
    if (bird && !bird.perched) fctx.drawImage(bird.img, bird.x, bird.y);
    const rook = crow.at(Date.now() + skew);           // ворона — над всеми: и в полёте, и на коньке крыши
    if (rook) fctx.drawImage(rook.img, rook.x, rook.y);
    for (const draw of wild.air) draw(fctx);           // летящие утки — тоже поверх всех
    const head = { x: seat.x + 2, y: fisher.y };       // макушка сидящего рыбака
    if (hero.sitting) drawFishing(fctx, fishing.st, t, {
      x: rod.x, tipY: rod.tipY, waterY: rod.waterY, head,
      bucket: ((b) => b && { x: b.x, y: b.y - B.bodyH + 4 })(ownPail() ? SEAT_PAIL : pailBySeat()),
    }, { line: { img: img.line, x: World.line.x, y: World.line.y }, fish: fishArt });
    wx.draw(fctx);                                     // дождь, брызги, порывы ветра, листья — поверх мира и героев
    drawNight(frameTint(sky), sky.lights, wx.haze() * Math.max(0, 1 - sky.dark * 1.6), lampSpots(), Math.min(1, Math.max(0, (sky.dark - 0.15) / 0.25)), t);   // ночью дымка не нужна: она бы высветлила темноту
    nightLife.draw(fctx, t, sky.dark, sky.lights, wx.st);  // огоньки ночи — поверх темноты
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

  on(window, 'pointerdown', () => sound.wake());       // браузер даёт звучать только после первого нажатия
  on(window, 'keydown', () => sound.wake());
  on<KeyboardEvent>(window, 'keydown', ev => {
    if (ev.key === 'Shift') shift = true;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if ((ev.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    if (asleep()) return;                              // спящий ничего не делает
    if (DIRS[ev.code]) { keys.add(ev.code); ev.preventDefault(); return; }
    if (ev.repeat) return;
    if (ev.code === 'KeyF' || ev.code === 'Space' || ev.code === 'Enter') { fishAction(); ev.preventDefault(); }
    else if (ev.code === 'KeyE') handAction('right');
    else if (ev.code === 'KeyQ') handAction('left');
    else if (ev.code === 'KeyB') packAction();
    else if (ev.code === 'KeyL') lampAction();
    else if (ev.code === 'KeyX') eatAction();
    else if (ev.code === 'Escape') standUp();
    else if (ev.code === 'F2') { debug = !debug; if (!debug) ui.debug(null); ev.preventDefault(); }
  });
  on<KeyboardEvent>(window, 'keyup', ev => { keys.delete(ev.code); if (ev.key === 'Shift') shift = false; });
  on(window, 'blur', () => { keys.clear(); shift = false; });
  on<PointerEvent>(canvas, 'pointerdown', ev => {
    if (ev.button > 0 || !ready || asleep()) return;
    ev.preventDefault();
    const p = toWorld(ev);
    const dbl = ev.timeStamp - lastDown.t < 350 && Math.hypot(p.x - lastDown.x, p.y - lastDown.y) <= 12;
    lastDown = dbl ? { t: -1e9, x: 0, y: 0 } : { t: ev.timeStamp, x: p.x, y: p.y };
    const run = dbl || ev.shiftKey;                    // двойной клик или клик с Shift — бегом
    if (hero.sitting && (onFishingSpot(p.x, p.y) || inWater(p.x, p.y))) fishAction();   // сидя: клик по рыбаку или воде — рыбалка
    else if (onPack(p.x, p.y)) { if (canWear()) putOn(); else walkTo(pack.x, pack.y + 5, 'wear', run); }
    else if (!hero.sitting && groundAt(p.x, p.y)) { const g = groundAt(p.x, p.y)!; if (dist(hero, g) <= REACH) { flushMove(); send('itemPick', { id: g.id }); } else walkTo(g.x, g.y + 5, 'lift', run); }   // клик по вещи на земле, своей или чужой: подойти и поднять
    else if (onFire(p.x, p.y)) {                        // клик по костру: подойти с ближней стороны и сесть
      if (nearFireNow()) restDown();
      else if (!hero.rest) { const d = Math.max(1, dist(hero, fire)), at = World.nearestWalkable(fire.x + (hero.x - fire.x) / d * 24, fire.y + (hero.y - fire.y) / d * 14); if (at) walkTo(at.x, at.y, 'rest', run); }
    }
    else if (onFishingSpot(p.x, p.y)) { if (nearSeatNow()) sitDown(); else walkTo(seat.x, seat.y, 'sit', run); }
    else walkTo(p.x, p.y, undefined, run);
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
  (window as any).FH_GAME = { hero, pack, view, keys, ghosts, fishing, room, sitDown, standUp, walkTo, putOn, takeOff, setPack, fishAction, handAction, packAction,
    step: (dt: number, n = 1) => { for (let i = 0; i < n; i++) update(dt); render(performance.now() / 1000); },
    hourNow, setClock, setWeather, wx, river, setHour: (hour: number | null) => { fixedHour = hour ?? NaN; } };   // setHour(22) останавливает время на этом часе, setHour(null) — пускает снова

  return {
    handAction, packAction, lampAction, setPack, fishAction, standUp, eatAction, takeFish, setClock, setWeather, setSound: sound.setOn,
    destroy() {
      sound.destroy();
      alive = false; cancelAnimationFrame(raf);
      for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
      for (const off of offs) off();
      liftPack();
      delete (window as any).FH_GAME;
    },
  };
}
