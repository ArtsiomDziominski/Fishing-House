// Проверка игрового сервера целиком: бот заводит игрока в базе, входит по билету (ведро у него в руке), идёт за рюкзаком,
// перекладывает вещи в рюкзаке и берёт их в руку, ставит и поднимает ведро, выкладывает их на землю и поднимает (и чужие — в другой копии причала), несёт всё к причалу, садится и ловит рыбу;
// достаёт рыбу из ведра, жарит её у костра (в дождь костёр гаснет, и его разжигают) и съедает, выложенную на землю рыбу уносит чайка,
// а голодным засыпает и просыпается у дома;
// заодно проверяет, что телепорт сервер не принимает.
//
//   npm run smoke -w game-server            (нужны запущенные база и игровой сервер, .env с DATABASE_URL и GAME_SECRET)
//   GAME_URL=http://localhost:2567 npm run smoke -w game-server
//   npm run smoke:own -w game-server        (то же, но сервер бот поднимает сам — smoke-own.ts)

import { Client, type Room } from '@colyseus/sdk';
import { World, ITEMS, HUNGER, SCRAPS, FIRE, ROOM, DAY_LENGTH, WEATHERS, REACH, dayHour, weatherText, dist, seat, standPoint, homePoint, type Bag, type GroundView, type Item, type PlayerView, type ServerMessages, type WorldState } from '@fh/shared';
import { createDb, createAccount, issueTicket, getProfile, loadItems, loadGround, loadPlayer, saveWorld, recordCatch } from '@fh/shared/server';

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
let hunger: ServerMessages['hunger'] | null = null;
const food: ServerMessages['food'][] = [];
room.onMessage('hunger', (m: ServerMessages['hunger']) => { hunger = m; });
room.onMessage('food', (m: ServerMessages['food']) => { food.push(m); });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (what: string, ok: () => boolean, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return;
  throw new Error('не дождались: ' + what);
};
const check = (cond: unknown, what: string) => { if (!cond) throw new Error('не так: ' + what); console.log('  ✓', what); };

await until('себя и ведро', () => !!self && !!bag);
await until('вещи в рюкзаке', () => !!items);
const kit = items!.list, packed = ITEMS.STARTER.filter(st => !st.held);
check(kit.length === packed.length && packed.every(st => kit.some(it => it.kind === st.kind && it.x === st.x && it.y === st.y)), 'новому игроку в рюкзак положен стартовый набор');
const thing = (list: Item[], kind: string) => list.find(it => it.kind === kind)!;
const pail = items!.hands[0]!;
check(items!.hands.length === 1 && pail.kind === 'bucket' && pail.left, 'ведро у нового игрока — в левой руке');
await until('сытость', () => !!hunger);
check(hunger!.food === HUNGER.MAX && hunger!.sleep === 0, 'новый игрок сыт и не спит');
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
check(self!.sitting && !('bucket' in self!), 'новый игрок сидит на причале');
check(!self!.pack.worn && self!.pack.x === World.pack.baseX && self!.pack.kind === 'leather', 'кожаный рюкзак лежит на своём месте');

// удочка в рюкзаке, а не в руке — забросить нельзя (про ведро сервер скажет уже потом)
room.send('press');
await until('needRod', () => fish.some(f => f.e === 'needRod'));
check(!fish.some(f => f.e === 'needBucket' || f.e === 'cast'), 'без удочки в руке сервер не даёт забросить');

// встаём и идём к ведру шагами по 4 пикселя за 0,1 с — как настоящий клиент
room.send('stand');
const pos = { ...standPoint() };
// who и at — кто идёт и где он сейчас: по умолчанию наш бот; так же водим и второго игрока
async function walk(to: { x: number; y: number }, who: Room = room, at: { x: number; y: number } = pos) {
  const path = World.findPath(at, to)!;
  for (const p of path) {
    for (;;) {
      const dx = p.x - at.x, dy = p.y - at.y, d = Math.hypot(dx, dy);
      if (d < 0.5) break;
      const k = Math.min(1, 4 / d); at.x += dx * k; at.y += dy * k;
      who.send('move', { x: at.x, y: at.y, dir: 'down' });
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
await walk({ x: World.pack.baseX - 20, y: World.pack.baseY + 8 });
await sleep(300);
check(self === null, 'честные шаги сервер принимает без поправок');

// телепорт — сервер возвращает на место
room.send('move', { x: seat.x, y: seat.y - 20, dir: 'down' });
await until('поправку', () => !!self);
check(Math.hypot(self!.x - pos.x, self!.y - pos.y) < 1, 'телепорт не принят, сервер вернул героя');

// рюкзак: подойти, надеть, выбрать другой, снять рядом и надеть снова — остальным всё это видно в состоянии комнаты
const seen = () => (room.state as { players: { get(sid: string): PlayerView | undefined } }).players.get(room.sessionId);
// что лежит на земле — у всех одно; who — в какой копии причала смотреть
const onGround = (id: number, who: Room = room) => (who.state as { ground: { get(id: string): GroundView | undefined } }).ground.get(String(id));
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
const rod = thing(kit, 'rod-willow'), floats = thing(kit, 'floats');
const held = () => [seen()?.hand, seen()?.off].filter(Boolean).sort().join();
check((await asked()).hands.length === 1 && held() === 'bucket' && seen()?.off === 'bucket', 'в руках только ведро, в левой');
// ведро в левой — свободна одна правая: вещь помещается только одна, вторая заменяет её
room.send('itemTake', { id: worms.id });
await until('червей в руке', () => held() === 'bucket,worms');
room.send('itemTake', { id: floats.id });
await until('поплавки вместо червей', () => held() === 'bucket,floats');
let got = await asked();
check(got.hands.length === 2 && thing(got.list, 'worms').x === 5 && thing(got.list, 'worms').y === 4, 'с ведром в руке вторая вещь заменила первую — та вернулась в рюкзак на своё место');
// ставим ведро — оно вещь на земле, видна всем; свободны обе руки
const bucketAt = World.nearestWalkable(pos.x - 14, pos.y + 2)!;
room.send('itemPut', { ...bucketAt, left: true });
await until('ведро на земле', () => onGround(pail.id)?.kind === 'bucket' && held() === 'floats');
room.send('itemTake', { id: worms.id });
await until('две вещи в руках', () => held() === 'floats,worms');
await sleep(300);
room.send('itemPick', { id: pail.id });
await until('ведро в рюкзаке', () => !onGround(pail.id));
got = await asked();
check(got.list.some(it => it.id === pail.id) && held() === 'floats,worms', 'обе руки заняты — ведро с земли ушло в рюкзак: в морской 4×4 влезает');
room.send('itemDrop', { id: pail.id });
await until('ведро снова на земле', () => !!onGround(pail.id));
// руки две: поплавки в правой, черви в левой. Удочку — в левую (Q): черви уходят в рюкзак, поплавки остаются
got = await asked();
check(got.hands.find(h => !h.left)?.id === floats.id && got.hands.find(h => h.left)?.id === worms.id && seen()?.hand === 'floats' && seen()?.off === 'worms', 'вторая вещь легла в свободную левую руку');
room.send('itemTake', { id: rod.id, left: true });
await until('удочку и поплавки', () => held() === 'floats,rod-willow');
got = await asked();
check(got.hands.length === 2 && got.hands.find(h => h.left)?.id === rod.id && seen()?.off === 'rod-willow' && thing(got.list, 'worms').x === 5, 'удочка взята в левую руку вместо червей — в правой остались поплавки');
room.send('itemTake', { id: scoop.id, left: true });
await until('сачок и поплавки', () => held() === 'floats,net-scoop');
got = await asked();
check(thing(got.list, 'rod-willow').x === 0 && thing(got.list, 'rod-willow').y === 0, 'взял сачок — удочка из руки вернулась в рюкзак на своё место');
room.send('itemStow', { id: scoop.id, at: { x: 0, y: 2, rot: false } });
await until('одни поплавки', () => held() === 'floats');
room.send('itemStow', { id: floats.id, at: null });
await until('пустые руки', () => held() === '');
got = await asked();
check(got.hands.length === 0 && thing(got.list, 'net-scoop').x === 0 && thing(got.list, 'net-scoop').y === 2 && !thing(got.list, 'net-scoop').rot && thing(got.list, 'floats').x === 3, 'сачок убран из руки в названную клетку, поплавки — на своё место');
room.send('itemStow', { id: scoop.id, at: null });
got = await asked();
check(got.hands.length === 0 && got.list.length === kit.length, 'из пустых рук убирать нечего');
await sleep(300);
room.send('itemPick', { id: pail.id, left: true });                       // ведро — снова в левую руку: дальше несём его к причалу
await until('ведро в руке', () => seen()?.off === 'bucket' && !onGround(pail.id));
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
  // невод тяжёлый — его берут только в обе свободные руки: с ведром или с червями в руке нельзя
  items = null;
  room.send('itemTake', { id: seine.id });
  await until('отказ взять невод', () => !!items);
  check(items!.note === 'hands' && items!.hands.length === 1 && held() === 'bucket', 'с ведром в руке невод не взять — ему нужны обе свободные руки');
  room.send('itemPut', { ...bucketAt, left: true });
  await until('ведро на земле', () => !!onGround(pail.id) && held() === '');
  room.send('itemTake', { id: worms.id });
  await until('червей в руке', () => held() === 'worms');
  items = null;
  room.send('itemTake', { id: seine.id });
  await until('отказ взять невод', () => !!items);
  check(items!.note === 'hands' && held() === 'worms', 'и с червями в одной руке невод не взять — руки сначала освобождают');
  room.send('itemStow', { id: worms.id, at: null });
  await until('пустые руки', () => held() === '');
  room.send('itemTake', { id: seine.id });
  await until('невод в руках', () => held() === 'net-seine');
  got = await asked();
  check(got.hands.length === 1 && thing(got.list, 'worms').x === 5 && seen()?.off === '', 'в пустые руки невод взят — держат его обеими');
  room.send('itemStow', { id: seine.id, at: null });
  await until('пустые руки', () => held() === '');
  await sleep(300);
  room.send('itemPick', { id: pail.id, left: true });
  await until('ведро в руке', () => seen()?.off === 'bucket');
  self = null; items = null;
  room.send('packKind', { kind: 'leather' });
  await until('отказ сменить рюкзак', () => !!self && !!items);
  check(items!.note === 'tight' && self!.pack.kind === 'sailor', 'в кожаный рюкзак столько вещей не влезает — остался морской');
  // выложить на землю: вещь ложится у ног, её видят все в состоянии комнаты
  room.send('itemDrop', { id: seine.id });
  room.send('itemDrop', { id: net.id });
  await until('невод и накидку на земле', () => !!onGround(seine.id) && !!onGround(net.id));
  const s1 = onGround(seine.id)!, n1 = onGround(net.id)!;
  check(dist(pos, s1) <= REACH && dist(pos, n1) <= REACH && dist(s1, n1) >= 5 && World.canWalk(s1.x, s1.y), 'невод и накидка выложены на землю у ног, одна не на другой');
  items = null;
  room.send('itemGive', { kind: 'worms' });
  await until('ещё червей', () => !!items);
  check(items!.list.length === kit.length + 1 && !items!.list.some(it => it.kind === 'net-seine'), 'невод и накидка на земле, новая банка червей легла на их место в рюкзаке');
  const worms2 = items!.list.at(-1)!;
  room.send('itemDrop', { id: worms2.id });
  await until('червей на земле', () => !!onGround(worms2.id));
  await sleep(300);                                     // пока вещи запишутся в базу: до того их не поднять
  // поднять: в одной руке ведро — черви идут во вторую руку, тяжёлые сети — в рюкзак (он на спине)
  room.send('itemPick', { id: worms2.id });
  await until('червей в руке', () => held() === 'bucket,worms' && !onGround(worms2.id));
  check(seen()?.hand === 'worms' && seen()?.off === 'bucket', 'черви с земли — в правую руку: левая занята ведром');
  room.send('itemPick', { id: seine.id });
  room.send('itemPick', { id: net.id });
  await until('сети с земли', () => !onGround(seine.id) && !onGround(net.id));
  got = await asked();
  check(got.hands[0]?.id === worms2.id && got.list.some(it => it.id === seine.id) && got.list.some(it => it.id === net.id), 'с земли черви взяты в свободную руку, а сети, раз рука занята, — в рюкзак');
  room.send('itemStow', { id: worms2.id, at: null });
  await until('одно ведро в руках', () => held() === 'bucket');
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
  check(got.hands[0]?.id === lamp.id && !onGround(lamp.id), 'далеко от себя лампу не поставить');
  const spot = World.nearestWalkable(pos.x + 10, pos.y + 4)!;
  room.send('itemPut', spot);
  await until('лампу на земле', () => !!onGround(lamp.id) && seen()?.hand === '');
  check(onGround(lamp.id)!.x === spot.x && onGround(lamp.id)!.y === spot.y && onGround(lamp.id)!.lit && seen()?.lamp === false, 'лампа поставлена на землю и светит оттуда, а не из руки');
  await sleep(300);
  room.send('lamp', { on: false, id: lamp.id });
  await until('лампа на земле погашена', () => onGround(lamp.id)?.lit === false);
  room.send('lamp', { on: true, id: lamp.id });
  await until('лампа на земле зажжена', () => onGround(lamp.id)?.lit === true);
  check(true, 'лампу на земле можно погасить и зажечь');
  room.send('itemTake', { id: worms.id });              // в одной руке ведро, в другой черви — лампа с земли уйдёт в рюкзак
  await until('червей в руке', () => seen()?.hand === 'worms');
  room.send('itemPick', { id: lamp.id });
  await until('лампу в рюкзаке', () => !onGround(lamp.id));
  got = await asked();
  check(got.list.some(it => it.id === lamp.id) && seen()?.lamp === false, 'руки заняты — лампа с земли убрана в рюкзак и не светит');
  room.send('itemStow', { id: worms.id, at: null });     // черви — обратно в рюкзак, на своё место
  await until('пустую руку', () => seen()?.hand === '');
  room.send('itemTake', { id: lamp.id });
  await until('лампу в руке', () => seen()?.hand === 'lamp');
  room.send('itemPut', spot);
  await until('лампу на земле', () => !!onGround(lamp.id));
  await sleep(300);
  room.send('itemPick', { id: lamp.id });
  await until('лампу снова в руке', () => seen()?.hand === 'lamp' && !onGround(lamp.id));
  check(seen()?.lamp === true, 'пустой рукой лампа берётся с земли в руку');
  // земля одна на все копии причала: второй игрок входит в другую копию, видит там лампу и поднимает её — у вещи меняется хозяин
  room.send('itemPut', spot);
  await until('лампу на земле', () => !!onGround(lamp.id));
  await sleep(300);
  const guest = await createAccount(db, 'гость_' + Math.random().toString(36).slice(2, 8), 'не-для-входа');
  const other: Room = await client.create(ROOM, { ticket: issueTicket(guest.id, guest.name) });
  let theirs: ServerMessages['items'] | null = null, there: WorldState | null = null;
  other.onMessage('items', (m: ServerMessages['items']) => { theirs = m; });
  other.onMessage('self', (m: WorldState) => { there = m; });
  for (const type of ['bag', 'fish', 'clock', 'weather', 'hunger', 'food']) other.onMessage(type, () => {});
  await until('второго игрока', () => !!theirs && !!there);
  await until('лампу в другой копии', () => !!onGround(lamp.id, other));
  check(other.roomId !== room.roomId && onGround(lamp.id, other)!.x === spot.x, 'во второй копии причала лампа лежит там же — земля у всех одна');
  other.send('itemPick', { id: lamp.id });
  await sleep(300);
  check(!!onGround(lamp.id) && !!onGround(lamp.id, other), 'издалека чужую лампу не взять');
  other.send('stand');
  const step = { ...standPoint() };
  await walk(World.nearestWalkable(spot.x - 8, spot.y + 5)!, other, step);
  theirs = null;
  other.send('itemPick', { id: lamp.id });
  await until('лампу у второго игрока', () => !!theirs && theirs.hands[0]?.id === lamp.id && !onGround(lamp.id) && !onGround(lamp.id, other));
  got = await asked();
  check(!got.hands.some(it => it.id === lamp.id) && !got.list.some(it => it.id === lamp.id), 'второй игрок поднял лампу в своей копии причала — у первого её больше нет, с земли она пропала у обоих');
  await sleep(300);
  check((await loadItems(db, guest.id)).hands.some(it => it.id === lamp.id) && !(await loadItems(db, me.id)).list.some(it => it.id === lamp.id), 'в базе лампа перешла к новому хозяину и лежит у него в руке');
  // гость кладёт лампу и уходит из игры — она остаётся на земле, и первый игрок забирает её себе насовсем
  const spot2 = World.nearestWalkable(step.x + 6, step.y + 3)!;
  other.send('itemPut', spot2);
  await until('лампу гостя на земле', () => !!onGround(lamp.id));
  await sleep(300);
  await other.leave();
  await sleep(400);
  check(!!onGround(lamp.id) && (await loadGround(db)).some(g => g.id === lamp.id && g.owner === guest.id), 'гость ушёл из игры, а его лампа лежит на земле — и в базе тоже');
  await walk({ x: spot2.x, y: spot2.y + 4 });
  room.send('itemPick', { id: lamp.id });
  await until('лампу гостя в руке', () => seen()?.hand === 'lamp' && !onGround(lamp.id));
  await sleep(300);
  check((await loadItems(db, me.id)).hands.some(it => it.id === lamp.id) && !(await loadGround(db)).some(g => g.id === lamp.id), 'лампа гостя теперь у первого игрока — и в базе');
} else {
  items = null;
  room.send('itemGive', { kind: 'net-seine' });
  await sleep(400);
  check(items === null, 'вещи с клиента не кладутся — сервер это сообщение не слушает');
}

// с поплавками в руке — к причалу: рыбачить ими нельзя
room.send('itemTake', { id: floats.id });
await until('поплавки в руке', () => held() === 'bucket,floats');

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
// ведро — на настил рядом с рыбаком: так улов идёт в него, а руки свободны для удочки и червей
const bucketSpot = World.nearestWalkable(seat.x + 16, seat.y - 10)!;
room.send('itemPut', { ...bucketSpot, left: true });
await until('ведро у места рыбака', () => !!onGround(pail.id) && held() === 'floats');
await sleep(300);
room.send('sit');
await sleep(200);
fish.length = 0;
room.send('press');
await until('needRod у воды', () => fish.some(f => f.e === 'needRod'));
check(!fish.some(f => f.e === 'cast'), 'ведро рядом, но в руке поплавки, а не удочка — забросить нельзя');
// достаём удочку из рюкзака (он на спине) в свободную левую руку — поплавки остаются в правой
room.send('itemTake', { id: rod.id });
await until('удочку в левой руке', () => seen()?.off === 'rod-willow');
fish.length = 0;
room.send('press');
await until('needBait', () => fish.some(f => f.e === 'needBait'));
check(!fish.some(f => f.e === 'cast'), 'удочка в руке, но в другой поплавки, а не черви — забросить нельзя');
// черви — в правую руку вместо поплавков: те уходят в рюкзак. С удочкой и червями — до конца: после перезахода они должны остаться в руках
room.send('itemTake', { id: worms.id, left: false });
await until('червей в правой руке', () => held() === 'rod-willow,worms');
room.send('press');
await until('заброс', () => fish.some(f => f.e === 'cast'));
await until('поклёвку', () => fish.some(f => f.e === 'bite'), 12000);
room.send('press');
await until('подсечку', () => fish.some(f => f.e === 'hook'));
const hook = fish.find(f => f.e === 'hook')!;
check(hook.e === 'hook' && hook.bag?.total === 1, `поймана: ${hook.e === 'hook' ? hook.fish.id + ' ' + hook.fish.grams + ' г' : ''}`);
await until('хвост над ведром', () => onGround(pail.id)?.fish === (hook.e === 'hook' ? hook.fish.id : ''));
check(true, 'рыба легла в ведро на настиле — её хвост видят все');

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
again.onMessage('hunger', (m: ServerMessages['hunger']) => { hunger = m; });
again.onMessage('food', (m: ServerMessages['food']) => { food.push(m); });
items = null;
await until('себя после входа', () => !!self);
const pailNow = (await loadGround(db)).find(g => g.id === pail.id);
check(self!.sitting && pailNow?.x === bucketSpot.x && pailNow.fish === (hook.e === 'hook' ? hook.fish.id : ''), 'после перезахода герой на причале, ведро там, где поставили, с хвостом рыбы');
check(self!.pack.worn && self!.pack.kind === 'sailor', 'рюкзак после перезахода на спине, тот же морской');
check(bag!.total === 1, 'улов после перезахода тот же');
await until('вещи после входа', () => !!items);
check(items!.list.length === kit.length - 2 + (before.canSet ? 4 : 0) && thing(items!.list, 'floats').x === 5 && thing(items!.list, 'floats').y === 4 && thing(items!.list, 'net-scoop').rot, 'вещи после перезахода лежат там, куда их переложили (поплавки — на месте червей), стартовый набор не задвоился');
check(items!.hands.map(it => it.kind + (it.left ? ':левая' : ':правая')).join() === 'worms:правая,rod-willow:левая' && !items!.list.some(it => it.id === rod.id || it.id === worms.id), 'черви в правой руке, удочка в левой — и после перезахода');

// еда: рыбу достают из ведра в свободную руку, сырую в рюкзак не убрать, у костра она жарится, жареную съедают
const caught = hook.e === 'hook' ? hook.fish.id : '';
const hand = () => (again.state as { players: { get(sid: string): PlayerView | undefined } }).players.get(again.sessionId);
items = null;
again.send('fishTake', { species: caught });
await until('отказ достать рыбу', () => !!items);
check(items!.note === 'busy', 'обе руки заняты — рыбу из ведра не достать');
again.send('itemStow', { id: worms.id, at: null });
await until('свободную правую руку', () => hand()?.hand === '');
items = null;
again.send('fishTake', { species: caught });
await until('рыбу в руке', () => !!items && items.hands.some(it => it.kind === 'fish' && it.id > 0) && bag!.total === 0 && hand()?.hand === 'fish');
const raw = items!.hands.find(it => it.kind === 'fish')!;
check(raw.fish === caught && !raw.left, 'рыба из ведра — в правой руке, ведро опустело');
items = null;
again.send('fishTake', { species: caught });
await until('отказ — рыбы нет', () => !!items);
check(items!.note === 'empty', 'в пустом ведре рыбы не достать');
items = null;
again.send('itemStow', { id: raw.id, at: null });
await until('отказ убрать сырую рыбу', () => !!items);
check(items!.note === 'raw' && items!.hands.some(it => it.id === raw.id), 'сырую рыбу в рюкзак не убрать');
const bait = thing(items!.list, 'worms');
items = null;
again.send('itemTake', { id: bait.id, left: false });
await until('отказ взять червей в руку с рыбой', () => !!items);
check(items!.note === 'raw' && items!.hands.some(it => it.id === raw.id) && items!.list.some(it => it.id === bait.id), 'в руку с сырой рыбой другую вещь не взять — рыба в рюкзак не уходит');
again.send('stand');
const at = { ...standPoint() };
await walk(World.nearestWalkable(World.fire.x - 24, World.fire.y + 2)!, again, at);
const fireNow = () => (again.state as { fire?: boolean }).fire;
// костёр под дождём: через FIRE.douse с он гаснет у всех, у погасшего не жарят, под дождём его не разжечь; без дождя — разжигают
if (before.canSet) {
  again.send('weather', { kind: 'rain', wind: false });
  await until('костёр погас', () => fireNow() === false, (FIRE.douse + 3) * 1000);
  check(true, `дождь шёл ${FIRE.douse} с — костёр погас`);
  again.send('rest');
  await until('сел у погасшего костра', () => hand()?.rest === true);
  await sleep((HUNGER.COOK + 1) * 1000);
  check(hand()?.hand === 'fish', 'у погасшего костра рыба не жарится');
  again.send('kindle');
  await sleep(400);
  check(fireNow() === false, 'под дождём костёр не разжечь');
  again.send('weather', { kind: 'clear', wind: false });
  await sleep(300);
  again.send('kindle');
  await until('костёр горит', () => fireNow() === true);
  check(true, 'дождь кончился — костёр разожгли, он снова горит');
} else if (fireNow() === false) again.send('kindle');   // погас под дождём по расписанию — разжигаем, если дождь кончился
again.send('rest');
await until('сел у костра', () => hand()?.rest === true);
await until('рыба пожарилась', () => food.some(f => f.e === 'cooked') && hand()?.hand === 'fish-fried', (HUNGER.COOK + 4) * 1000);
check( food.find(f => f.e === 'cooked')!.fish === caught, `у костра рыба пожарилась за ${HUNGER.COOK} с`);
if (before.canSet) again.send('weather', { kind: was.fixKind, wind: was.fixWind });   // погода — как была
items = null;
again.send('eat', {});
await until('съел', () => food.some(f => f.e === 'ate') && !!items && hand()?.hand === '');
check(!items!.hands.some(it => ITEMS.isFish(it.kind)) && hunger!.food === HUNGER.MAX, 'жареную рыбу съел — в руке пусто, сыт');
await sleep(300);
check(!(await loadItems(db, me.id)).hands.some(it => ITEMS.isFish(it.kind)) && (await getProfile(db, me.id))!.bag.total === 1, 'в базе рыбы больше нет, а в профиле улов прежний');
await again.leave();
await sleep(500);

// жуёт рыбу HUNGER.EAT секунд — это в состоянии комнаты, его видят все; вторую рыбу в это время не съесть
{
  const eater = await createAccount(db, 'едок_' + Math.random().toString(36).slice(2, 8), 'не-для-входа');
  for (let i = 0; i < 2; i++) await recordCatch(db, eater.id, { id: 'roach', grams: 100 + i });
  const r: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(eater.id, eater.name) });
  let plate: ServerMessages['items'] | null = null;
  const ate: ServerMessages['food'][] = [];
  r.onMessage('items', (m: ServerMessages['items']) => { plate = m; });
  r.onMessage('food', (m: ServerMessages['food']) => { ate.push(m); });
  for (const type of ['self', 'bag', 'fish', 'clock', 'weather', 'hunger']) r.onMessage(type, () => {});
  const seen = () => (r.state as { players: { get(sid: string): PlayerView | undefined } }).players.get(r.sessionId);
  const take = async () => { plate = null; r.send('fishTake', { species: 'roach' }); await until('рыбу у едока', () => !!plate && plate.hands.some(it => it.kind === 'fish' && it.id > 0)); };
  await until('едока в комнате', () => !!plate && !!seen());
  await take();
  r.send('eat', {});
  await until('едок жуёт', () => seen()?.eat === 'fish');
  check(!seen()!.eatLeft && seen()!.hand === '' && ate.length === 1, 'съел сырую рыбу из правой руки — в комнате видно, что он жуёт');
  await take();
  r.send('eat', {});
  await sleep(200);
  check(seen()?.eat === 'fish' && seen()!.hand === 'fish' && ate.length === 1, 'пока жуёт, вторую рыбу не съесть — она остаётся в руке');
  await until('едок доел', () => seen()?.eat === '', (HUNGER.EAT + 2) * 1000);
  r.send('eat', {});
  await until('вторую съел', () => ate.length === 2 && seen()?.eat === 'fish');
  check(seen()!.hand === '', `через ${HUNGER.EAT} с доел — и вторую уже можно`);
  await r.leave();
  await sleep(300);
}

// рыба на земле (SCRAPS): чайка её уносит, кот съедает или она тает — и её нет ни на земле, ни в базе; подняли, пока за ней
// шли, — она у того, кто поднял. Когда за рыбой придут, сервер решает сам (SCRAPS.fate), а в разработке зовут сразу (scrap).
{
  const host = await createAccount(db, 'рыбак_' + Math.random().toString(36).slice(2, 8), 'не-для-входа');
  for (let i = 0; i < 3; i++) await recordCatch(db, host.id, { id: 'roach', grams: 100 + i });
  const r: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(host.id, host.name) });
  let plate: ServerMessages['items'] | null = null;
  r.onMessage('items', (m: ServerMessages['items']) => { plate = m; });
  for (const type of ['self', 'bag', 'fish', 'clock', 'weather', 'hunger', 'food']) r.onMessage(type, () => {});
  const lying = (id: number) => onGround(id, r);
  const stored = async (id: number) => (await loadGround(db)).some(g => g.id === id) || (await loadItems(db, host.id)).hands.some(it => it.id === id);
  await until('рыбака в комнате', () => !!plate);
  r.send('stand');
  await sleep(300);
  const drop = async () => {                             // рыбу из ведра — в руку и на землю у ног
    plate = null;
    r.send('fishTake', { species: 'roach' });
    await until('рыбу у рыбака', () => !!plate && plate.hands.some(it => it.kind === 'fish' && it.id > 0));
    const f = plate!.hands.find(it => it.kind === 'fish')!;
    r.send('itemDrop', { id: f.id });
    await until('рыбу на земле', () => lying(f.id)?.kind === 'fish');
    await sleep(300);                                    // записалась в базу: теперь её можно поднять
    return f;
  };
  const a = await drop();
  check(lying(a.id)!.end === '' && lying(a.id)!.fish === 'roach', 'рыба лежит на земле, за ней пока никто не пришёл');
  if (before.canSet) {
    r.send('scrap', { id: a.id, by: 'gull' });
    await until('чайку', () => lying(a.id)?.end === 'gull');
    check(await stored(a.id), 'за рыбой прилетела чайка — это видно всем, а рыба пока на месте');
    await until('чайка унесла', () => !lying(a.id), (SCRAPS.TAKE.gull + 3) * 1000);
    await sleep(300);
    check(!(await stored(a.id)), `через ${SCRAPS.TAKE.gull} с чайка унесла рыбу — её нет ни на земле, ни в базе`);
    const b = await drop();
    r.send('scrap', { id: b.id, by: 'cat' });
    await until('кота', () => lying(b.id)?.end === 'cat');
    plate = null;
    r.send('itemPick', { id: b.id });
    await until('рыбу снова в руке', () => !!plate && plate.hands.some(it => it.id === b.id));
    await sleep((SCRAPS.TAKE.cat + 1) * 1000);
    check(!lying(b.id) && (await loadItems(db, host.id)).hands.some(it => it.id === b.id), 'кот шёл за рыбой, но её подняли — она в руке и в базе, кот ушёл ни с чем');
    const pailId = plate!.hands.find(it => ITEMS.isBucket(it.kind))!.id;
    r.send('itemDrop', { id: pailId });
    await until('ведро на земле', () => !!lying(pailId));
    r.send('scrap', { id: pailId, by: 'fade' });
    await sleep(400);
    check(lying(pailId)?.end === '', 'не рыбу звери не трогают: ведро на земле лежит как лежало');
  } else {
    r.send('scrap', { id: a.id, by: 'gull' });
    await sleep(400);
    check(lying(a.id)?.end === '', 'звать зверя к рыбе с клиента нельзя — сервер не слушает');
  }
  await r.leave();
  await sleep(300);
}

// голод: сытость на нуле почти три минуты — входим, и герой засыпает; спит — ходить нельзя, треть рыбы из ведра пропадает
for (let i = 0; i < 10; i++) await recordCatch(db, me.id, { id: 'roach', grams: 100 + i });
const saved = (await loadPlayer(db, me.id))!.world!;
await saveWorld(db, me.id, { ...saved, sitting: false, food: 0, starve: HUNGER.STARVE - 0.5 });
async function enter() {
  const r: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(me.id, me.name) });
  self = null; hunger = null; bag = null;
  r.onMessage('self', (m: WorldState) => { self = m; });
  r.onMessage('bag', (m: Bag) => { bag = m; });
  r.onMessage('hunger', (m: ServerMessages['hunger']) => { hunger = m; });
  for (const type of ['fish', 'clock', 'weather', 'items', 'food']) r.onMessage(type, () => {});
  await until('себя после входа', () => !!self && !!hunger && !!bag);
  return r;
}
let hungry = await enter();
check(hunger!.food === 0 && hunger!.sleep === 0 && bag!.total === 10, 'вошёл голодным: сытость на нуле, в ведре десять рыб');
await until('уснул', () => !!hunger && hunger.sleep > 0, 3000);
check(hunger!.sleep > (HUNGER.SLEEP - 5) * 1000, `голодный уснул на ${HUNGER.SLEEP / 60} минуты`);
await until('рыба пропала', () => hunger?.lost !== undefined && bag!.total < 10);
check(hunger!.lost === 3 && bag!.total === 7, 'пока спит, из ведра пропало три рыбы из десяти');
const asleep = { ...self! };
self = null;
hungry.send('move', { x: asleep.x + 3, y: asleep.y, dir: 'down' });
await until('отказ идти во сне', () => !!self);
check(self!.x === asleep.x && self!.y === asleep.y, 'спящий не ходит — сервер возвращает его на место');
await hungry.leave();
await sleep(500);
check((await loadPlayer(db, me.id))!.world!.sleep > Date.now(), 'сон записан в базу: перезайти, чтобы не спать, не выйдет');
const home = homePoint();
const tired = (await loadPlayer(db, me.id))!.world!;
await saveWorld(db, me.id, { ...tired, sleep: Date.now() + 1500 });
hungry = await enter();
check(hunger!.sleep > 0, 'после перезахода герой всё ещё спит');
await until('проснулся', () => !!hunger && hunger.sleep === 0 && !!self && self.x === home.x, 5000);
check(self!.y === home.y && hunger!.food === HUNGER.MAX, 'выспался — проснулся у крыльца дома сытым');
await hungry.leave();
await sleep(500);
const late = (await loadPlayer(db, me.id))!.world!;
await saveWorld(db, me.id, { ...late, x: seat.x, y: seat.y - 30, sleep: Date.now() - 1000 });
hungry = await enter();
check(self!.x === home.x && self!.y === home.y && hunger!.food === HUNGER.MAX && hunger!.sleep === 0, 'сон кончился, пока игрока не было, — входит у дома, сытый');
await hungry.leave();
await db.close();
console.log('всё работает');
process.exit(0);
