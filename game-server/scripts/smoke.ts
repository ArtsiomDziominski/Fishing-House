// Проверка игрового сервера целиком: бот заводит игрока в базе, входит по билету, идёт за ведром и рюкзаком,
// перекладывает вещи в рюкзаке и берёт их в руку, несёт всё к причалу, садится и ловит рыбу; заодно проверяет, что телепорт сервер не принимает.
//
//   npm run smoke -w game-server            (нужны запущенные база и игровой сервер, .env с DATABASE_URL и GAME_SECRET)
//   GAME_URL=http://localhost:2567 npm run smoke -w game-server

import { Client, type Room } from '@colyseus/sdk';
import { World, ITEMS, ROOM, DAY_LENGTH, WEATHERS, dayHour, weatherText, seat, standPoint, type Bag, type Item, type PlayerView, type ServerMessages, type WorldState } from '@fh/shared';
import { createDb, createAccount, issueTicket, getProfile } from '@fh/shared/server';

const url = process.env.GAME_URL || 'http://localhost:2567';
const db = createDb(undefined, 2);
const name = 'бот_' + Math.random().toString(36).slice(2, 8);
const me = await createAccount(db, name, 'не-для-входа');
console.log('игрок', me.name, me.id);

const client = new Client(url);
const room: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(me.id, me.name) });
console.log('в комнате', room.roomId, 'сессия', room.sessionId);

let self: WorldState | null = null, bag: Bag | null = null;
const fish: ServerMessages['fish'][] = [];
room.onMessage('self', (m: WorldState) => { self = m; });
room.onMessage('bag', (m: Bag) => { bag = m; });
room.onMessage('fish', (m: ServerMessages['fish']) => { fish.push(m); });
let items: ServerMessages['items'] | null = null;
room.onMessage('items', (m: ServerMessages['items']) => { items = m; });
let clock: (ServerMessages['clock'] & { skew: number }) | null = null;   // skew — на сколько часы причала впереди наших
room.onMessage('clock', (m: ServerMessages['clock']) => { clock = { ...m, skew: m.now - Date.now() }; });
let weather: ServerMessages['weather'] | null = null;
room.onMessage('weather', (m: ServerMessages['weather']) => { weather = m; });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (what: string, ok: () => boolean, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return;
  throw new Error('не дождались: ' + what);
};
const check = (cond: unknown, what: string) => { if (!cond) throw new Error('не так: ' + what); console.log('  ✓', what); };

await until('себя и ведро', () => !!self && !!bag);
await until('вещи в рюкзаке', () => !!items);
const kit = items!.list;
check(kit.length === ITEMS.STARTER.length && ITEMS.STARTER.every(st => kit.some(it => it.kind === st.kind && it.x === st.x && it.y === st.y)), 'новому игроку в рюкзак положен стартовый набор');
const thing = (list: Item[], kind: string) => list.find(it => it.kind === kind)!;
await until('часы причала', () => !!clock);
check(Math.abs(clock!.skew) < DAY_LENGTH * 1000 + 60_000, 'сервер прислал часы причала — по ним у всех одно время суток');
await until('погоду', () => !!weather);
check(WEATHERS.includes(weather!.kind), `сервер прислал погоду: ${weatherText(weather!).toLowerCase()}`);

// Часы и погода причала: в разработке сервер выставляет их сразу у всех, в продакшене — не слушает.
// После проверки возвращаем как было.
const before = clock!, was = weather!;
if (before.canSet) {
  const kind = was.kind === 'rain' ? 'cloudy' : 'rain', wind = !was.wind;   // не ту, что сейчас, — иначе сообщать будет нечего
  weather = null;
  room.send('weather', { kind, wind });
  await until('новую погоду', () => !!weather);
  check(weather!.kind === kind && weather!.wind === wind && weather!.fixKind === kind && weather!.fixWind === wind, `погода выставлена: ${weatherText(weather!).toLowerCase()} — сервер сообщил её всем`);
  weather = null;
  room.send('weather', { kind: was.fixKind, wind: was.fixWind });
  await until('возврат погоды', () => !!weather);
  check(weather!.fixKind === was.fixKind && weather!.fixWind === was.fixWind && weather!.kind === was.kind && weather!.wind === was.wind, 'погода возвращена');

  clock = null;
  room.send('clock', { hour: 22 });
  await until('перевод часов', () => !!clock);
  check(clock!.moved && Math.abs(dayHour(clock!.now) - 22) < 0.05, 'часы причала переведены на 22:00 — сервер сообщил новое время');
  clock = null;
  room.send('clock', { hour: before.moved ? dayHour(Date.now() + before.skew) : null });
  await until('возврат часов', () => !!clock);
  const drift = Math.abs(dayHour(Date.now() + clock!.skew) - dayHour(Date.now() + before.skew));   // сдвиг мог смениться на целые сутки — час тот же
  check(clock!.moved === before.moved && Math.min(drift, 24 - drift) < 0.05, 'часы причала возвращены на прежнее время');
} else {
  clock = null; weather = null;
  room.send('clock', { hour: 22 });
  room.send('weather', { kind: was.kind === 'rain' ? 'cloudy' : 'rain', wind: !was.wind });
  await sleep(400);
  check(clock === null && weather === null, 'часы и погода с клиента не выставляются — сервер их не слушает');
}
check(self!.sitting && self!.bucket.home, 'новый игрок сидит на причале, ведро на своём месте');
check(!self!.pack.worn && self!.pack.x === World.pack.baseX && self!.pack.kind === 'leather', 'кожаный рюкзак лежит на своём месте');

// ведро далеко — забросить нельзя
room.send('press');
await until('needBucket', () => fish.some(f => f.e === 'needBucket'));
check(true, 'без ведра рядом сервер не даёт забросить');

// встаём и идём к ведру шагами по 4 пикселя за 0,1 с — как настоящий клиент
room.send('stand');
const pos = { ...standPoint() };
async function walk(to: { x: number; y: number }) {
  const path = World.findPath(pos, to)!;
  for (const p of path) {
    for (;;) {
      const dx = p.x - pos.x, dy = p.y - pos.y, d = Math.hypot(dx, dy);
      if (d < 0.5) break;
      const k = Math.min(1, 4 / d); pos.x += dx * k; pos.y += dy * k;
      room.send('move', { x: pos.x, y: pos.y, dir: 'down' });
      await sleep(100);
    }
  }
}
// рюкзак далеко — надеть нельзя
self = null;
room.send('packOn');
await until('отказ надеть рюкзак', () => !!self);
check(!self!.pack.worn, 'издалека рюкзак не надеть');
items = null;
room.send('itemMove', { id: thing(kit, 'worms').id, x: 0, y: 2, rot: false });
await until('отказ переложить издалека', () => !!items);
check(items!.note === 'far' && thing(items!.list, 'worms').y === 1, 'издалека вещи в рюкзаке не переложить');

self = null;
await walk({ x: World.bucket.baseX, y: World.bucket.baseY + 6 });
await sleep(300);
check(self === null, 'честные шаги сервер принимает без поправок');

// телепорт — сервер возвращает на место
room.send('move', { x: seat.x, y: seat.y - 20, dir: 'down' });
await until('поправку', () => !!self);
check(Math.hypot(self!.x - pos.x, self!.y - pos.y) < 1, 'телепорт не принят, сервер вернул героя');

room.send('pick');

// рюкзак: подойти, надеть, выбрать другой, снять рядом и надеть снова — остальным всё это видно в состоянии комнаты
const seen = () => (room.state as { players: { get(sid: string): PlayerView | undefined } }).players.get(room.sessionId);
await walk({ x: World.pack.baseX, y: World.pack.baseY + 6 });
self = null;
room.send('packOn');
room.send('packKind', { kind: 'sailor' });
await until('рюкзак на спине', () => !!seen()?.wearing && seen()!.pack === 'sailor');
check(self === null, 'рюкзак надет и сменён на морской');
const spot = World.nearestWalkable(pos.x + 15, pos.y + 1)!;
room.send('packOff', spot);
await until('рюкзак на земле', () => seen()?.wearing === false);
check(seen()!.px === spot.x && seen()!.py === spot.y, 'рюкзак снят и лежит рядом');
room.send('packOn');
await until('рюкзак снова на спине', () => !!seen()?.wearing);
check(self === null, 'рюкзак надет снова, без поправок от сервера');

// вещи в морском рюкзаке (6×5): переложить, повернуть, не положить на соседа
const worms = thing(kit, 'worms'), scoop = thing(kit, 'net-scoop');
items = null;
room.send('itemMove', { id: worms.id, x: 5, y: 4, rot: false });
room.send('itemMove', { id: scoop.id, x: 5, y: 0, rot: true });
await sleep(300);
check(items === null, 'черви переложены в угол, сачок повёрнут стоймя — сервер согласен молча');
room.send('itemMove', { id: worms.id, x: 1, y: 0, rot: false });   // там удочка
await until('отказ положить на удочку', () => !!items);
check(thing(items!.list, 'worms').x === 5 && !items!.note, 'на удочку червей не положить — сервер прислал, как всё лежит');
// рука: взять вещь из рюкзака, сменить её другой, убрать обратно. Сервер, когда согласен, молчит — как всё лежит,
// спрашиваем отказом: просим переложить вещь, которой нет.
const asked = async () => { items = null; room.send('itemMove', { id: 0, x: 0, y: 0, rot: false }); await until('как лежат вещи', () => !!items); return items!; };
const rod = thing(kit, 'rod-willow');
check((await asked()).hand === null && seen()?.hand === '', 'в руке пусто');
room.send('itemTake', { id: rod.id });
await until('удочку в руке', () => seen()?.hand === 'rod-willow');
let got = await asked();
check(got.hand?.id === rod.id && !got.list.some(it => it.id === rod.id) && got.list.length === kit.length - 1, 'удочка взята из рюкзака в руку — это видно всем');
room.send('itemTake', { id: scoop.id });
await until('сачок в руке', () => seen()?.hand === 'net-scoop');
got = await asked();
check(got.hand?.id === scoop.id && thing(got.list, 'rod-willow').x === 0 && thing(got.list, 'rod-willow').y === 0, 'взял сачок — удочка из руки вернулась в рюкзак на своё место');
room.send('itemStow', { at: { x: 0, y: 2, rot: false } });
await until('пустую руку', () => seen()?.hand === '');
got = await asked();
check(got.hand === null && thing(got.list, 'net-scoop').x === 0 && thing(got.list, 'net-scoop').y === 2 && !thing(got.list, 'net-scoop').rot, 'сачок убран из руки в названную клетку');
room.send('itemStow', { at: null });
got = await asked();
check(got.hand === null && got.list.length === kit.length, 'из пустой руки убирать нечего');
room.send('itemMove', { id: scoop.id, x: 5, y: 0, rot: true });           // сачок — обратно стоймя в угол
items = null;
if (before.canSet) {
  // в разработке вещи можно положить; две вещи по 4 клетки, и в кожаный рюкзак (4×3) уже не влезть
  items = null;
  room.send('itemGive', { kind: 'net-seine' });
  await until('невод', () => !!items && items.list.length === kit.length + 1);
  room.send('itemGive', { kind: 'net-cast' });
  await until('накидку', () => !!items && items.list.length === kit.length + 2);
  const seine = thing(items!.list, 'net-seine'), net = thing(items!.list, 'net-cast');
  check(seine.id > 0 && net.id > 0 && ITEMS.fits(ITEMS.grid('sailor'), items!.list, seine.kind, seine.x, seine.y, seine.rot, seine.id), 'невод и накидка легли на свободные клетки');
  self = null; items = null;
  room.send('packKind', { kind: 'leather' });
  await until('отказ сменить рюкзак', () => !!self && !!items);
  check(items!.note === 'tight' && self!.pack.kind === 'sailor', 'в кожаный рюкзак столько вещей не влезает — остался морской');
  room.send('itemDrop', { id: seine.id });
  room.send('itemDrop', { id: net.id });
  items = null;
  room.send('itemGive', { kind: 'worms' });
  await until('ещё червей', () => !!items);
  check(items!.list.length === kit.length + 1 && !items!.list.some(it => it.kind === 'net-seine'), 'невод и накидка выброшены, новая банка червей легла на их место');
  room.send('itemDrop', { id: items!.list.at(-1)!.id });
  // лампа светит, только когда она в руке или стоит на земле; свет виден всем в состоянии комнаты
  check(seen()?.lamp === false, 'без лампы света нет');
  items = null;
  room.send('itemGive', { kind: 'lamp' });
  await until('лампу', () => !!items && items.list.some(it => it.kind === 'lamp' && it.id > 0));
  const lamp = thing(items!.list, 'lamp');
  room.send('lamp', { on: false }); room.send('lamp', { on: true });
  await sleep(300);
  check(seen()?.lamp === false && self!.lamp !== false, 'лампа в рюкзаке не светит, и зажечь её там нельзя');
  room.send('itemTake', { id: lamp.id });
  await until('лампу в руке', () => seen()?.hand === 'lamp' && seen()?.lamp === true);
  room.send('lamp', { on: false });
  await until('лампа погашена', () => seen()?.lamp === false);
  room.send('lamp', { on: true });
  await until('лампа зажжена снова', () => seen()?.lamp === true);
  check(true, 'лампа в руке светит, её можно погасить и зажечь');
  // на землю и обратно
  room.send('itemPut', { x: pos.x + 300, y: pos.y });
  got = await asked();
  check(got.hand?.id === lamp.id && got.ground === null, 'далеко от себя лампу не поставить');
  const spot = World.nearestWalkable(pos.x + 10, pos.y + 4)!;
  room.send('itemPut', spot);
  await until('лампу на земле', () => seen()?.ground === 'lamp' && seen()?.hand === '');
  check(seen()!.gx === spot.x && seen()!.gy === spot.y && seen()?.lamp === true, 'лампа поставлена на землю и светит оттуда');
  room.send('lamp', { on: false });
  await until('лампа на земле погашена', () => seen()?.lamp === false);
  room.send('lamp', { on: true });
  await until('лампа на земле зажжена', () => seen()?.lamp === true);
  room.send('itemTake', { id: rod.id });                // рука занята удочкой — лампа с земли уйдёт в рюкзак
  await until('удочку в руке', () => seen()?.hand === 'rod-willow');
  room.send('itemPick');
  await until('лампу в рюкзаке', () => seen()?.ground === '');
  got = await asked();
  check(got.ground === null && got.list.some(it => it.id === lamp.id) && seen()?.lamp === false, 'рука занята — лампа с земли убрана в рюкзак и погасла');
  room.send('itemStow', { at: null });                   // удочку — обратно в рюкзак, на свободное место
  await until('пустую руку', () => seen()?.hand === '');
  room.send('itemTake', { id: lamp.id });
  await until('лампу в руке', () => seen()?.hand === 'lamp');
  room.send('itemPut', spot);
  await until('лампу на земле', () => seen()?.ground === 'lamp');
  room.send('itemPick');
  await until('лампу снова в руке', () => seen()?.hand === 'lamp' && seen()?.ground === '');
  check(seen()?.lamp === true, 'пустой рукой лампа берётся с земли в руку');
  room.send('itemDrop', { id: lamp.id });
  await until('свет погас', () => seen()?.lamp === false && seen()?.hand === '');
  check(true, 'выброшенная лампа не светит');
} else {
  items = null;
  room.send('itemGive', { kind: 'net-seine' });
  await sleep(400);
  check(items === null, 'вещи с клиента не кладутся — сервер это сообщение не слушает');
}

// с поплавками в руке — до конца: после перезахода они должны остаться в руке
room.send('itemTake', { id: thing(kit, 'floats').id });
await until('поплавки в руке', () => seen()?.hand === 'floats');

// костёр у дома: сесть можно только рядом с ним, а шаг в сторону поднимает
room.send('rest');
await sleep(300);
check(seen()?.rest === false, 'вдали от костра не сесть');
await walk(World.nearestWalkable(World.fire.x - 24, World.fire.y + 2)!);
room.send('rest');
await until('сел у костра', () => seen()?.rest === true);
room.send('stand');
await until('встал от костра', () => seen()?.rest === false);
room.send('rest');
await until('сел у костра снова', () => seen()?.rest === true);
await walk({ x: pos.x - 6, y: pos.y });
await until('ушёл от костра', () => seen()?.rest === false);
check(!World.canWalk(World.fire.x, World.fire.y), 'у костра можно посидеть и встать, сквозь очаг не пройти');

await walk({ x: seat.x, y: seat.y });
const bucketSpot = { x: seat.x + 26, y: seat.y - 13 };   // место на настиле рядом с рыбаком
room.send('sit', { put: bucketSpot });
await sleep(200);
room.send('press');
await until('заброс', () => fish.some(f => f.e === 'cast'));
await until('поклёвку', () => fish.some(f => f.e === 'bite'), 12000);
room.send('press');
await until('подсечку', () => fish.some(f => f.e === 'hook'));
const hook = fish.find(f => f.e === 'hook')!;
check(hook.e === 'hook' && hook.bag?.total === 1, `поймана: ${hook.e === 'hook' ? hook.fish.id + ' ' + hook.fish.grams + ' г' : ''}`);

await sleep(300);
await room.leave();
await sleep(500);
const profile = await getProfile(db, me.id);
check(profile?.bag.total === 1 && profile.latest.length === 1, 'улов записан в базу и виден в профиле');

// второй вход: место и ведро сохранились
const again: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(me.id, me.name) });
self = null;
again.onMessage('self', (m: WorldState) => { self = m; });
again.onMessage('bag', (m: Bag) => { bag = m; });
again.onMessage('fish', () => {});
again.onMessage('clock', () => {});
again.onMessage('weather', () => {});
again.onMessage('items', (m: ServerMessages['items']) => { items = m; });
items = null;
await until('себя после входа', () => !!self);
check(self!.sitting && !self!.bucket.home && self!.bucket.x === bucketSpot.x, 'после перезахода герой на причале, ведро там, где поставили');
check(self!.pack.worn && self!.pack.kind === 'sailor', 'рюкзак после перезахода на спине, тот же морской');
check(bag!.total === 1, 'ведро после перезахода с той же рыбой');
await until('вещи после входа', () => !!items);
check(items!.list.length === kit.length - 1 && thing(items!.list, 'worms').x === 5 && thing(items!.list, 'net-scoop').rot, 'вещи после перезахода лежат там, куда их переложили, стартовый набор не задвоился');
check(items!.hand?.kind === 'floats' && !items!.list.some(it => it.kind === 'floats'), 'поплавки после перезахода по-прежнему в руке');
await again.leave();
await db.close();
console.log('всё работает');
process.exit(0);
