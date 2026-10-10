// Проверка игрового сервера целиком: бот заводит игрока в базе, входит по билету (ведро у него в руке), идёт за рюкзаком,
// перекладывает вещи в рюкзаке и берёт их в руку, ставит и поднимает ведро, выкладывает их на землю и поднимает (и чужие — в другой копии причала), несёт всё к причалу, садится и ловит рыбу
// в ведро на настиле; достаёт рыбу из ведра, жарит её у костра (в дождь костёр гаснет, и его разжигают) и съедает, выложенную на землю рыбу уносит чайка,
// сосед достаёт рыбу из чужого ведра на земле и уносит ведро вместе с уловом,
// входит в дом и выходит из него, садится в кресло у камина (второй игрок там жарит рыбу, кладёт улов в холодильник и
// достаёт его, спит в кровати), плывёт на лодке в общие воды — на общий остров и в открытый океан (третий игрок ловит там
// рыбу в ведро в лодке) и обратно, а голодным засыпает (у него крадут часть вещей) и просыпается у дома;
// заодно проверяет, что телепорт сервер не принимает.
//
//   npm run smoke -w game-server            (нужны запущенные база и игровой сервер, .env с DATABASE_URL и GAME_SECRET)
//   GAME_URL=http://localhost:2567 npm run smoke -w game-server
//   npm run smoke:own -w game-server        (то же, но сервер бот поднимает сам — smoke-own.ts)

import { Client, type Room } from '@colyseus/sdk';
import { World, Indoor, Isle, SEA, SEA_ROOM, ISLE_PLACE, BOAT_AT, boatPoint, boatPlace, shoreToward, ITEMS, FISH, HUNGER, SCRAPS, FIRE, ROOM, pierPlace, DAY_LENGTH, WEATHERS, REACH, dayHour, weatherText, dist, WORMS, seat, standPoint, homePoint, haulOf, type GroundView, type Item, type PlayerView, type ServerMessages, type WorldState } from '@fh/shared';
import { createDb, createAccount, issueTicket, getProfile, loadItems, loadGround, loadBags, loadPlayer, saveWorld, recordCatch, loadFridge, loadChest, robItems } from '@fh/shared/server';

const url = process.env.GAME_URL || 'http://localhost:2567';
const db = createDb(undefined, 2);
const name = 'бот_' + Math.random().toString(36).slice(2, 8);
const me = await createAccount(db, name, 'не-для-входа');
console.log('игрок', me.name, me.id);

const client = new Client(url);
const room: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(me.id, me.name), pier: me.id });
console.log('в комнате', room.roomId, 'сессия', room.sessionId);

let self: WorldState | null = null, bags: ServerMessages['bags'] | null = null;   // вёдра в руках и что в них
const fish: ServerMessages['fish'][] = [];
room.onMessage('self', (m: WorldState) => { self = m; });
room.onMessage('bags', (m: ServerMessages['bags']) => { bags = m; });
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
const worm: ServerMessages['worms'][] = [];
room.onMessage('worms', (m: ServerMessages['worms']) => { worm.push(m); });
room.onMessage('fridge', () => {});
room.onMessage('chest', () => {});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (what: string, ok: () => boolean, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return;
  throw new Error('не дождались: ' + what);
};
const check = (cond: unknown, what: string) => { if (!cond) throw new Error('не так: ' + what); console.log('  ✓', what); };

await until('себя и ведро', () => !!self && !!bags);
await until('вещи в рюкзаке', () => !!items);
const kit = items!.list, packed = ITEMS.STARTER.filter(st => !st.held);
check(kit.length === packed.length && packed.every(st => kit.some(it => it.kind === st.kind && it.x === st.x && it.y === st.y)), 'новому игроку в рюкзак положен стартовый набор');
const thing = (list: Item[], kind: string) => list.find(it => it.kind === kind)!;
const pail = items!.hands[0]!;
check(items!.hands.length === 1 && pail.kind === 'bucket' && pail.left, 'ведро у нового игрока — в левой руке');
check(bags!.length === 1 && bags![0]!.id === pail.id && bags![0]!.left && bags![0]!.bag.total === 0, 'ведро в руке пустое — сервер сказал, что в нём');
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
// Трава, где копают червей: место рядом с from, откуда лопата (герой смотрит вниз) втыкается в траву; не у ямки away.
function lawnNear(from: { x: number; y: number }, away?: { x: number; y: number }) {
  for (let r = 4; r < 200; r += 2) for (let a = 0; a < 32; a++) {
    const p = { x: Math.round(from.x + r * Math.cos(a * Math.PI / 16)), y: Math.round(from.y + r * Math.sin(a * Math.PI / 16)) };
    if (World.canWalk(p.x, p.y) && WORMS.canDig(WORMS.spot(p, 'down')) && (!away || dist(WORMS.spot(p, 'down'), away) > WORMS.NEAR * 2) && World.findPath(from, p)) return p;
  }
  return null;
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
room.send('itemMove', { id: thing(kit, 'shovel-old').id, x: 4, y: 1, rot: true });   // лопата — стоймя: слева место ведру 4×4
await sleep(300);
check(items === null, 'черви переложены в угол, сачок и лопата повёрнуты стоймя — сервер согласен молча');
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
  // земля одна на все копии причала: второй игрок приходит в гости в другую копию, видит там лампу и поднимает её — у вещи меняется хозяин
  room.send('itemPut', spot);
  await until('лампу на земле', () => !!onGround(lamp.id));
  await sleep(300);
  const guest = await createAccount(db, 'гость_' + Math.random().toString(36).slice(2, 8), 'не-для-входа');
  const other: Room = await client.create(ROOM, { ticket: issueTicket(guest.id, guest.name), pier: me.id });
  let theirs: ServerMessages['items'] | null = null, there: WorldState | null = null;
  other.onMessage('items', (m: ServerMessages['items']) => { theirs = m; });
  other.onMessage('self', (m: WorldState) => { there = m; });
  for (const type of ['bags', 'fish', 'clock', 'weather', 'hunger', 'food', 'fridge', 'chest']) other.onMessage(type, () => {});
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
  check(!!onGround(lamp.id) && (await loadGround(db, pierPlace(me.id))).some(g => g.id === lamp.id && g.owner === guest.id), 'гость ушёл из игры, а его лампа лежит на земле — и в базе тоже');
  await walk({ x: spot2.x, y: spot2.y + 4 });
  room.send('itemPick', { id: lamp.id });
  await until('лампу гостя в руке', () => seen()?.hand === 'lamp' && !onGround(lamp.id));
  await sleep(300);
  check((await loadItems(db, me.id)).hands.some(it => it.id === lamp.id) && !(await loadGround(db, pierPlace(me.id))).some(g => g.id === lamp.id), 'лампа гостя теперь у первого игрока — и в базе');
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
fish.length = 0;
room.send('press');
await until('заброс со стартовыми червями', () => fish.some(f => f.e === 'cast'));
const STARTER_WORMS = ITEMS.STARTER.find(it => it.kind === 'worms')!.worms ?? 0;
check(STARTER_WORMS > 0, `в стартовой банке ${STARTER_WORMS} червей — забросить можно сразу, не копая`);
// копаем: встаём, пока не клюнуло (червь цел), лопата — в левую руку вместо удочки, идём на траву
room.send('stand');
Object.assign(pos, standPoint());
await sleep(200);
room.send('itemTake', { id: thing(kit, 'shovel-old').id, left: true });
await until('лопату и червей', () => held() === 'shovel-old,worms');
const lawn1 = lawnNear(pos)!;
check(!!lawn1, 'у причала есть трава, где копают');
await walk(lawn1);
await sleep(300);
worm.length = 0;
room.send('dig');
await until('копает', () => seen()?.dig === true);
await until('накопал', () => worm.some(w => w.e === 'dug'), (WORMS.DIG + 3) * 1000);
const dug1 = worm.find(w => w.e === 'dug')!;
check(dug1.e === 'dug' && dug1.id === worms.id && dug1.got >= 1 && dug1.n === STARTER_WORMS + dug1.got && !dug1.lost, `накопал к стартовым: червей ${dug1.e === 'dug' ? dug1.n + (dug1.wet ? ' (после дождя вдвое)' : '') : 0}`);
const wormsAfterDig = dug1.e === 'dug' ? dug1.n : 0;
// обратно к воде: удочка — в левую руку вместо лопаты
room.send('itemTake', { id: rod.id, left: true });
await until('удочку и червей', () => held() === 'rod-willow,worms');
await walk({ x: seat.x, y: seat.y });
await sleep(300);
room.send('sit');
await sleep(200);
fish.length = 0;
room.send('press');
await until('заброс', () => fish.some(f => f.e === 'cast'));
await until('поклёвку', () => fish.some(f => f.e === 'bite'), 12000);
room.send('press');
await until('подсечку', () => fish.some(f => f.e === 'hook'));
const hook = fish.find(f => f.e === 'hook')!;
check(hook.e === 'hook' && hook.pail?.id === pail.id && hook.pail.n === 1 && hook.pail.size === ITEMS.capacity('bucket') && hook.first === true, `поймана в ведро на настиле: ${hook.e === 'hook' ? hook.fish.id + ' ' + hook.fish.grams + ' г' : ''}`);
await until('хвост над ведром', () => onGround(pail.id)?.fish === (hook.e === 'hook' ? hook.fish.id : ''));
check(onGround(pail.id)?.haul === `${hook.e === 'hook' ? hook.fish.id : ''}:1`, 'рыба легла в ведро на настиле — её хвост и сколько рыбы в ведре видят все');
await until('червя на крючке', () => worm.some(w => w.e === 'used'));
check(worm.some(w => w.e === 'used' && w.id === worms.id && w.n === wormsAfterDig - 1), 'рыба клюнула — из банки ушёл один червь');

await sleep(300);
await room.leave();
await sleep(500);
const profile = await getProfile(db, me.id);
check(profile?.bag.total === 1 && profile.latest.length === 1, 'улов записан в базу и виден в профиле');

// второй вход: место и ведро сохранились. again — комната, где бот сейчас: на лодке он переходит в общие воды и обратно,
// и listen вешает те же обработчики на новую комнату.
let voyage: ServerMessages['voyage'] | null = null;
const listen = (r: Room) => {
  r.onMessage('self', (m: WorldState) => { self = m; });
  r.onMessage('bags', (m: ServerMessages['bags']) => { bags = m; });
  r.onMessage('items', (m: ServerMessages['items']) => { items = m; });
  r.onMessage('hunger', (m: ServerMessages['hunger']) => { hunger = m; });
  r.onMessage('food', (m: ServerMessages['food']) => { food.push(m); });
  r.onMessage('worms', (m: ServerMessages['worms']) => { worm.push(m); });
  r.onMessage('voyage', (m: ServerMessages['voyage']) => { voyage = m; });
  for (const type of ['fish', 'chest', 'clock', 'weather', 'fridge']) r.onMessage(type, () => {});
  return r;
};
self = null;
worm.length = 0;
let again: Room = listen(await client.joinOrCreate(ROOM, { ticket: issueTicket(me.id, me.name), pier: me.id }));
items = null;
await until('себя после входа', () => !!self);
const pailNow = (await loadGround(db, pierPlace(me.id))).find(g => g.id === pail.id);
await until('ведро после входа', () => !!onGround(pail.id, again));
check(self!.sitting && pailNow?.x === bucketSpot.x && onGround(pail.id, again)!.fish === (hook.e === 'hook' ? hook.fish.id : ''), 'после перезахода герой на причале, ведро там, где поставили, с хвостом рыбы');
check(self!.pack.worn && self!.pack.kind === 'sailor', 'рюкзак после перезахода на спине, тот же морской');
check(haulOf(onGround(pail.id, again)?.haul ?? '')[hook.e === 'hook' ? hook.fish.id : ''] === 1, 'улов в ведре после перезахода тот же');
await until('вещи после входа', () => !!items);
check(items!.list.length === kit.length - 2 + (before.canSet ? 4 : 0) && thing(items!.list, 'floats').x === 5 && thing(items!.list, 'floats').y === 4 && thing(items!.list, 'net-scoop').rot, 'вещи после перезахода лежат там, куда их переложили (поплавки — на месте червей), стартовый набор не задвоился');
check(items!.hands.map(it => it.kind + (it.left ? ':левая' : ':правая')).join() === 'worms:правая,rod-willow:левая' && !items!.list.some(it => it.id === rod.id || it.id === worms.id), 'черви в правой руке, удочка в левой — и после перезахода');
check(items!.hands.find(it => it.id === worms.id)?.worms === wormsAfterDig - 1, 'червей в банке после перезахода столько же — их считает сервер');

// еда: рыбу достают из ведра в свободную руку, сырую в рюкзак не убрать, у костра она жарится, жареную съедают
const caught = hook.e === 'hook' ? hook.fish.id : '';
const hand = () => (again.state as { players: { get(sid: string): PlayerView | undefined } }).players.get(again.sessionId);
items = null;
again.send('fishTake', { species: caught, pail: pail.id });
await until('отказ достать рыбу', () => !!items);
check(items!.note === 'busy', 'обе руки заняты — рыбу из ведра не достать');
again.send('itemStow', { id: worms.id, at: null });
await until('свободную правую руку', () => hand()?.hand === '');
items = null;
again.send('fishTake', { species: caught, pail: pail.id });
await until('рыбу в руке', () => !!items && items.hands.some(it => it.kind === 'fish' && it.id > 0) && onGround(pail.id, again)?.haul === '' && hand()?.hand === 'fish');
const raw = items!.hands.find(it => it.kind === 'fish')!;
check(raw.fish === caught && !raw.left, 'рыба из ведра — в правой руке, ведро опустело');
items = null;
again.send('fishTake', { species: caught, pail: pail.id });
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

// дом: войти можно только от двери, внутри свой кадр (Indoor), на пол ничего не кладут, в кресла у камина садятся по одному,
// в кровати спят, в холодильнике у каждого своя полка; выйти — от порога
{
  again.send('stand');
  await until('встал от костра', () => hand()?.rest === false && !hand()?.eat, (HUNGER.EAT + 2) * 1000);
  self = null;
  again.send('enter');
  await until('отказ войти издалека', () => !!self);
  check(!self!.inside && hand()?.inside === false, 'издалека в дом не войти');
  await walk(homePoint(), again, at);
  self = null;
  again.send('enter');
  await until('вошёл в дом', () => !!self && hand()?.inside === true);
  check(self!.inside && self!.x === Indoor.door.x && self!.y === Indoor.door.y, 'у двери вошёл в дом — стоит на пороге внутри, и это видно всем');
  const inAt = { x: self!.x, y: self!.y };
  const walkIn = async (to: { x: number; y: number }, who: Room = again, p: { x: number; y: number } = inAt) => {
    for (const q of Indoor.findPath(p, to)!) for (;;) {
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy); if (d < 0.5) break;
      const k = Math.min(1, 4 / d); p.x += dx * k; p.y += dy * k;
      who.send('move', { x: p.x, y: p.y, dir: 'up' }); await sleep(100);
    }
  };
  const [chairL, chairR] = Indoor.chairs as [typeof Indoor.chairs[0], typeof Indoor.chairs[0]];
  await walkIn(chairL.stand);
  await sleep(300);
  check(hand()?.inside === true && Math.abs(hand()!.x - inAt.x) < 1 && Math.abs(hand()!.y - inAt.y) < 1, 'по дому ходят по его собственной проходимости');
  self = null;
  again.send('exit');
  await until('отказ выйти от камина', () => !!self);
  check(self!.inside, 'от камина из дома не выйти — только от порога');
  again.send('rest');
  await until('сел в кресло', () => hand()?.rest === true);
  check(hand()!.x === chairL.x && hand()!.y === chairL.y && hand()!.dir === chairL.dir, 'сел в кресло у камина — лицом к огню');

  // второй игрок с уловом в ведре: дом у каждого свой — садится в то же кресло, где сидит первый; улов — в холодильник, рыбу оттуда — в руку, во втором кресле
  // она жарится, жареную — обратно на полку; потом поспать в кровати
  {
    const cook = await createAccount(db, 'повар_' + Math.random().toString(36).slice(2, 8), 'не-для-входа');
    const cookPail = (await loadItems(db, cook.id)).hands.find(it => ITEMS.isBucket(it.kind))!.id;   // стартовый набор кладёт первый же loadItems
    for (const [id, grams] of [['perch', 300], ['roach', 120], ['pike', 1500]] as const) await recordCatch(db, cook.id, { id, grams }, cookPail);
    const c: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(cook.id, cook.name), pier: cook.id });
    let cSelf: WorldState | null = null, cItems: ServerMessages['items'] | null = null, cFridge: ServerMessages['fridge'] | null = null, cBags: ServerMessages['bags'] | null = null, cChest: ServerMessages['chest'] | null = null;
    c.onMessage('chest', (m: ServerMessages['chest']) => { cChest = m; });
    const cFood: ServerMessages['food'][] = [];
    c.onMessage('self', (m: WorldState) => { cSelf = m; });
    c.onMessage('items', (m: ServerMessages['items']) => { cItems = m; });
    c.onMessage('fridge', (m: ServerMessages['fridge']) => { cFridge = m; });
    c.onMessage('bags', (m: ServerMessages['bags']) => { cBags = m; });
    const cBag = () => cBags?.find(b => b.id === cookPail)?.bag;
    c.onMessage('food', (m: ServerMessages['food']) => { cFood.push(m); });
    for (const type of ['fish', 'clock', 'weather', 'hunger']) c.onMessage(type, () => {});
    const seen = () => (c.state as { players: { get(sid: string): PlayerView | undefined } }).players.get(c.sessionId);
    const shelf = async (send: () => void, what: string, ok: (f: ServerMessages['fridge']) => boolean = () => true) => { cFridge = null; send(); await until(what, () => !!cFridge && ok(cFridge)); return cFridge!; };
    await until('повара в комнате', () => !!cSelf && !!cItems && !!cFridge && !!cBag() && !!seen());
    check(cFridge!.list.length === 0 && cBag()!.total === 3 && cItems!.hands.some(it => it.id === cookPail), 'у нового игрока холодильник пуст, в ведре три рыбы, ведро в руке');
    c.send('stand');
    const cAt = { ...standPoint() };
    await walk({ x: World.pack.baseX, y: World.pack.baseY + 6 }, c, cAt);   // рюкзак — на спину: из него вещи пойдут в сундук
    c.send('packOn');
    await until('рюкзак повара на спине', () => !!seen()?.wearing);
    await walk(homePoint(), c, cAt);
    check((await shelf(() => c.send('fridgeStock'), 'отказ снаружи')).note === 'far', 'с улицы до холодильника не дотянуться');
    c.send('enter');
    await until('повар в доме', () => cSelf?.inside === true);
    const cIn = { x: cSelf!.x, y: cSelf!.y };
    await walkIn(Indoor.chest, c, cIn);   // ведро с уловом в сундук не убрать: рыбе место в холодильнике
    cChest = null; c.send('chestPut', { id: cookPail, at: null });
    await until('отказ — ведро с уловом', () => cChest?.note === 'catch');
    check(cBag()!.total === 3 && !cChest!.list.length, 'ведро с уловом в сундук не положить — рыба в нём, сундук пуст');
    await walkIn(chairL.stand, c, cIn);
    c.send('rest');
    await until('повар в кресле, где сидит первый', () => seen()?.rest === true);
    check(seen()!.x === chairL.x && hand()?.rest === true, 'дом у каждого свой: в кресло, где сидит другой игрок в своём доме, садятся');
    c.send('stand');
    await until('повар встал из кресла', () => seen()?.rest === false);
    Object.assign(cIn, chairL.stand);
    await walkIn(Indoor.fridge, c, cIn);
    const stocked = await shelf(() => c.send('fridgeStock'), 'улов в холодильнике', f => f.stocked !== undefined || !!f.note);
    check(stocked.stocked === 3 && stocked.list.length === 3 && cBag()!.total === 0, 'улов из ведра в руке переложен в холодильник — ведро пустое');
    check((await shelf(() => c.send('fridgeStock'), 'отказ — ведро пустое')).note === 'empty', 'из пустого ведра перекладывать нечего');
    const perch = stocked.list.find(f => f.fish === 'perch')!;
    cItems = null;
    await shelf(() => c.send('fridgeTake', { id: perch.id }), 'окунь из холодильника', f => !f.list.some(x => x.id === perch.id));
    await until('окунь в руке', () => !!cItems && cItems.hands.some(it => it.id === perch.id) && seen()?.hand === 'fish');   // руки в состоянии комнаты приходят чуть позже личного сообщения
    check(!cItems!.hands.find(it => it.id === perch.id)!.left && seen()?.hand === 'fish', 'рыбу из холодильника достал в свободную руку');
    check((await shelf(() => c.send('fridgeTake', { id: perch.id }), 'отказ — окуня уже нет')).note === 'empty', 'вынутую рыбу второй раз не достать');
    await walkIn(chairR.stand, c, cIn);
    c.send('rest');
    await until('повар во втором кресле', () => seen()?.rest === true);
    check(seen()!.x === chairR.x && seen()!.dir === chairR.dir, 'во второе кресло сел — лицом к огню');
    await until('окунь пожарился', () => cFood.some(f => f.e === 'cooked') && seen()?.hand === 'fish-fried', (HUNGER.COOK + 4) * 1000);
    check(cFood.find(f => f.e === 'cooked')!.fish === 'perch', `у камина рыба пожарилась за ${HUNGER.COOK} с — дождь ему не страшен`);
    c.send('stand');
    await until('повар встал', () => seen()?.rest === false);
    check(seen()!.x === chairR.stand.x && seen()!.y === chairR.stand.y, 'из кресла встал рядом с ним');
    Object.assign(cIn, chairR.stand);
    await walkIn(Indoor.fridge, c, cIn);
    const back = await shelf(() => c.send('fridgePut', {}), 'окунь на полке', f => f.list.length === 3);
    await until('руки повара пусты', () => seen()?.hand === '');
    check(back.list.some(f => f.id === perch.id && f.kind === 'fish-fried'), 'жареную рыбу положил обратно в холодильник');
    check((await shelf(() => c.send('fridgePut', {}), 'отказ — в руках нет рыбы')).note === 'empty', 'без рыбы в руках класть нечего');
    await sleep(300);
    check((await loadFridge(db, cook.id)).some(f => f.id === perch.id && f.kind === 'fish-fried') && !(await loadItems(db, cook.id)).hands.some(it => ITEMS.isFish(it.kind)), 'в базе жареный окунь — на полке, а не в руке');
    await walkIn(Indoor.bed.stand, c, cIn);
    c.send('bed');
    await until('повар в кровати', () => seen()?.bed === true);
    check(seen()!.x === Indoor.bed.x && seen()!.y === Indoor.bed.y, 'лёг спать в кровать — это видно всем');
    c.send('stand');
    await until('повар встал с кровати', () => seen()?.bed === false);
    check(seen()!.x === Indoor.bed.stand.x && seen()!.y === Indoor.bed.stand.y, 'с кровати встал рядом с ней');
    // сундук: положить из рюкзака (на свободное место и в названную клетку), переложить, сменить сундук на большой, вынуть
    // обратно; издалека не выйдет, а украсть из сундука во сне нельзя
    const chest = async (send: () => void, what: string, ok: (m: ServerMessages['chest']) => boolean = () => true) => { cChest = null; send(); await until(what, () => !!cChest && ok(cChest)); return cChest!; };
    const floats = cItems!.list.find(it => it.kind === 'floats')!, shovel = cItems!.list.find(it => it.kind === 'shovel-old')!;
    check(cChest!.kind === 'box' && cChest!.list.length === 0, 'у нового игрока в доме пустой сундучок');
    check((await chest(() => c.send('chestPut', { id: floats.id, at: null }), 'отказ издалека')).note === 'far', 'от кровати до сундука не дотянуться');
    check((await chest(() => c.send('chestKind', { kind: 'chest' }), 'отказ сменить сундук издалека')).note === 'far', 'сундук меняют, только стоя у него');
    await walkIn(Indoor.chest, c, cIn);
    cItems = null;
    let box = await chest(() => c.send('chestPut', { id: floats.id, at: null }), 'поплавки в сундуке', m => m.list.some(it => it.id === floats.id));
    await until('рюкзак без поплавков', () => !!cItems && !cItems.list.some(it => it.id === floats.id));
    check(box.list.find(it => it.id === floats.id)!.x === 0, 'поплавки из рюкзака легли в сундук на первое свободное место');
    box = await chest(() => c.send('chestPut', { id: shovel.id, at: { x: 1, y: 2, rot: false } }), 'лопата в сундуке', m => m.list.some(it => it.id === shovel.id));
    check(box.list.find(it => it.id === shovel.id)!.y === 2, 'лопата легла в сундук в ту клетку, куда её положили');
    c.send('chestMove', { id: floats.id, x: 4, y: 3, rot: false });
    box = await chest(() => c.send('chestKind', { kind: 'trunk' }), 'большой сундук', m => m.kind === 'trunk');
    check(box.list.find(it => it.id === floats.id)!.x === 4, 'поплавки переложены в сундуке, а сам он теперь — большой сундук');
    await sleep(300);
    const kept = await loadChest(db, cook.id);
    check(kept.kind === 'trunk' && kept.list.some(it => it.id === floats.id && it.x === 4 && it.y === 3) && !(await loadItems(db, cook.id)).list.some(it => it.id === floats.id), 'в базе сундук большой, поплавки в нём, а в рюкзаке их нет');
    check((await robItems(db, cook.id, [floats.id])).length === 0, 'из сундука во сне не украсть — вещи в нём целы');
    cItems = null;
    box = await chest(() => c.send('chestTake', { id: floats.id, at: null }), 'поплавки из сундука', m => !m.list.some(it => it.id === floats.id));
    await until('поплавки в рюкзаке', () => !!cItems && cItems.list.some(it => it.id === floats.id));
    check(box.list.length === 1, 'поплавки вынуты из сундука в рюкзак, лопата осталась');
    await c.leave();
    await sleep(300);
    const cWorld = (await loadPlayer(db, cook.id))!.world!;
    check(cWorld.inside && !cWorld.bed && !cWorld.rest, 'вышел из игры в доме — в доме и войдёт, стоя');
  }

  again.send('stand');
  await until('встал из кресла', () => hand()?.rest === false);
  check(hand()!.x === chairL.stand.x && hand()!.y === chairL.stand.y, 'встал из кресла рядом с ним');
  Object.assign(inAt, chairL.stand);
  items = null;
  again.send('itemDrop', { id: rod.id });
  await until('отказ положить на пол', () => !!items);
  check(items!.note === 'indoor' && items!.hands.some(it => it.id === rod.id), 'в доме на пол ничего не кладут');
  worm.length = 0;
  again.send('dig');
  await until('отказ копать в доме', () => worm.length > 0);
  check(worm[0]!.e === 'ground', 'в доме не копают');
  await walkIn(Indoor.door);
  self = null;
  again.send('exit');
  await until('вышел из дома', () => !!self && hand()?.inside === false);
  check(!self!.inside && dist(self!, homePoint()) < 1, 'от порога вышел из дома — стоит у крыльца');
  at.x = self!.x; at.y = self!.y;
}

// общие воды: у лодки на мостках — выбор, куда плыть; общий остров и открытый океан — одна комната на всех (pier = SEA_ROOM),
// туда браузер переходит сам по «voyage». На острове свой кадр (Isle) и общая земля, копать и снимать рюкзак нельзя.
{
  self = null;
  again.send('sail', { to: 'isle' });
  await until('отказ отплыть от крыльца', () => !!self);
  check(!self!.isle && hand()?.isle === false && !voyage, 'от крыльца не уплыть — только от лодки');
  await walk(BOAT_AT, again, at);
  self = null;
  again.send('sail', { to: 'home' });
  await until('отказ плыть домой от причала', () => !!self);
  check(!voyage && !self!.isle && !self!.sea, 'от причала домой не плывут — только на остров или в океан');
  self = null;
  again.send('sail');
  await until('отказ без «куда»', () => !!self);
  check(!voyage && again.connection.isOpen, 'sail без «куда» (вкладка старше общих вод) не выкидывает из игры — герой просто остаётся у лодки');
  self = null;
  again.send('sail', { to: 'isle' });
  await until('лодку на остров', () => !!voyage && !!self);
  check(voyage!.to === 'isle' && dist(self!, boatPoint()) < 1 && !self!.isle, 'у лодки сел в неё — сервер ставит героя к лодке и отпускает на общий остров');
  await again.leave();
  self = null; voyage = null;
  again = listen(await client.joinOrCreate(ROOM, { ticket: issueTicket(me.id, me.name), pier: SEA_ROOM, to: 'isle' }));
  await until('приплыл на остров', () => !!self && hand()?.isle === true);
  check(self!.isle && !self!.sea && self!.x === Isle.landing.x && self!.y === Isle.landing.y, 'приплыл на общий остров — стоит на пляже, и это видно всем');
  check((again.state as { owner: string }).owner === SEA_ROOM && self!.seen.includes('isle') && self!.seen.includes('pier'), 'общие воды — без хозяина; остров теперь открыт на карте мира');
  const isAt = { x: self!.x, y: self!.y };
  const walkIsle = async (to: { x: number; y: number }) => {
    for (const q of Isle.findPath(isAt, to)!) for (;;) {
      const dx = q.x - isAt.x, dy = q.y - isAt.y, d = Math.hypot(dx, dy); if (d < 0.5) break;
      const k = Math.min(1, 4 / d); isAt.x += dx * k; isAt.y += dy * k;
      again.send('move', { x: isAt.x, y: isAt.y, dir: 'up' }); await sleep(100);
    }
  };
  worm.length = 0;
  again.send('dig');
  await until('отказ копать на острове', () => worm.length > 0);
  check(worm[0]!.e === 'ground', 'на острове червей не копают');
  const wearing = hand()!.wearing;
  self = null;
  again.send('packOff', { x: isAt.x + 12, y: isAt.y });
  await until('отказ снять рюкзак', () => !!self);
  check(self!.isle && self!.pack.worn === wearing, 'на острове рюкзак не снимают');
  // земля острова общая на всех (ISLE_PLACE): удочка, положенная тут, лежит там, а не у причала
  const rodLeft = !!(await loadItems(db, me.id)).hands.find(it => it.id === rod.id)?.left;
  again.send('itemDrop', { id: rod.id });
  await until('удочка на земле острова', () => onGround(rod.id, again)?.isle === true);
  await sleep(400);
  check((await loadGround(db, ISLE_PLACE)).some(g => g.id === rod.id) && !(await loadGround(db, pierPlace(me.id))).some(g => g.id === rod.id), 'удочка лежит на общем острове — в базе у острова, не у причала');
  again.send('itemPick', { id: rod.id, left: rodLeft });
  await until('удочка снова в руке', () => !onGround(rod.id, again) && [hand()?.hand, hand()?.off].includes(rod.kind));
  check(true, 'с земли острова удочку подняли обратно');
  await walkIsle(standPoint(true));
  again.send('sit');
  await until('сел на мостках острова', () => hand()?.sitting === true);
  check(hand()!.x === Isle.seat.x && hand()!.y === Isle.seat.y, 'на мостках острова садятся рыбачить на их место рыбака');
  again.send('stand');
  await until('встал с мостков', () => hand()?.sitting === false);
  Object.assign(isAt, standPoint(true));
  // с берега острова тоже рыбачат: там, где удилище достаёт до воды, садятся, где стоят, лицом к ней; посреди острова — нет
  await walkIsle(Isle.nearestWalkable(330, 222)!);
  self = null;
  again.send('sit');
  await until('отказ сесть посреди острова', () => !!self);
  check(!self!.sitting && hand()?.sitting === false, 'посреди острова с удочкой не сесть');
  const bank = shoreToward(140, 200, isAt)!;
  await walkIsle(bank);
  again.send('move', { x: bank.x, y: bank.y, dir: 'down' });
  again.send('sit');
  await until('сел на берегу острова', () => hand()?.sitting === true);
  check(hand()!.x === bank.x && hand()!.y === bank.y && hand()!.dir === 'left', 'на западном берегу острова сел, где стоял, лицом к воде');
  again.send('stand');
  await until('встал с берега', () => hand()?.sitting === false);
  check(hand()!.x === bank.x && hand()!.y === bank.y, 'с берега встал там же, где сидел');
  // перезагрузил страницу на острове — снова на острове, у лодки на пляже (место в общих водах не хранится)
  await again.leave();
  self = null;
  again = listen(await client.joinOrCreate(ROOM, { ticket: issueTicket(me.id, me.name), pier: SEA_ROOM, to: 'isle' }));
  await until('снова на острове', () => !!self && hand()?.isle === true);
  check(self!.x === Isle.landing.x && self!.y === Isle.landing.y && (await loadPlayer(db, me.id))!.world!.isle === false, 'перезашёл в общие воды — снова у лодки на пляже; дома в базе он по-прежнему у своего причала');
  Object.assign(isAt, Isle.landing);
  self = null;
  again.send('sail', { to: 'isle' });
  await until('отказ плыть туда, где он есть', () => !!self);
  check(!voyage && self!.isle, 'на остров с острова не плывут');
  self = null;
  again.send('sail', { to: 'home' });
  await until('лодку домой', () => !!voyage);
  check(voyage!.to === 'home' && !voyage!.slept, 'с пляжа острова отчалил домой — сервер отпускает к причалу, откуда приплыл');
  await again.leave();
  self = null; voyage = null;
  again = listen(await client.joinOrCreate(ROOM, { ticket: issueTicket(me.id, me.name), pier: me.id, to: 'home' }));
  await until('приплыл обратно', () => !!self && hand()?.isle === false);
  check(!self!.isle && !self!.sea && dist(self!, boatPoint()) < 1 && self!.seen.includes('isle'), 'приплыл обратно — стоит на мостках у лодки, остров на карте остался открыт');
  at.x = self!.x; at.y = self!.y;
}

// черви: копают лопатой на траве, держа банку в другой руке; в полную банку не копают
{
  again.send('stand');
  await until('встал и дожевал', () => hand()?.rest === false && !hand()?.eat, (HUNGER.EAT + 2) * 1000);
  const asks = async (what: string) => { worm.length = 0; again.send('dig'); await until(what, () => worm.length > 0); return worm[0]!; };
  check((await asks('отказ копать на тропинке')).e === 'shovel', 'без лопаты в руке не накопать');
  again.send('itemTake', { id: thing(kit, 'shovel-old').id, left: false });
  await until('лопату в правой руке', () => hand()?.hand === 'shovel-old');
  check((await asks('отказ копать без банки')).e === 'jar', 'с лопатой, но без банки в другой руке не накопать');
  again.send('itemTake', { id: worms.id, left: true });
  await until('банку в левой руке', () => hand()?.off === 'worms');
  // трава рядом с костром — не там, где копали у причала (то место ещё пустое)
  const lawn = lawnNear(at, WORMS.spot(lawn1, 'down'));
  check(!!lawn, 'рядом с костром есть трава, где копают');
  await walk(lawn!, again, at);
  await sleep(300);
  worm.length = 0;
  again.send('dig');
  await until('копает', () => hand()?.dig === true);
  await until('накопал', () => worm.some(w => w.e === 'dug'), (WORMS.DIG + 3) * 1000);
  const d = worm.find(w => w.e === 'dug')!;
  check(d.e === 'dug' && d.id === worms.id && d.got >= 1 && d.n === wormsAfterDig - 1 + d.got && !d.lost, `накопал: червей +${d.e === 'dug' ? d.got + (d.wet ? ' (после дождя вдвое)' : '') : 0}`);
  await until('перестал копать', () => hand()?.dig === false);
  const holes = (again.state as { holes: { forEach(f: (h: { x: number; y: number }) => void): void } }).holes;
  let hole = false; holes.forEach(h => { if (dist(h, WORMS.spot(lawn!, 'down')) < 1) hole = true; });
  check(hole, 'на месте копки ямка — её видят все');
  await until('встал с лопатой', () => hand()?.dig === false);
  worm.length = 0;
  again.send('dig');
  await until('пустое место', () => worm.some(w => w.e === 'none'), (WORMS.DIG + 3) * 1000);
  check(true, 'вскопанное место пустое — тут червей нет');
  await sleep(300);
  check((await loadItems(db, me.id)).hands.find(it => it.id === worms.id)?.worms === (d.e === 'dug' ? d.n : -1), 'сколько червей в банке — записано в базу');
}
await again.leave();
await sleep(500);

// открытый океан: новичок с ведром в руке и удочкой в рюкзаке плывёт в океан и бросает якорь — ведро само встаёт в лодку (в
// кожаный рюкзак оно не влезает, а руки нужны под удочку и червей), удочка и черви — в руки; ловит рыбу в ведро в лодке; сходит на остров — черви в рюкзак,
// ведро из лодки — в руку;
// плывёт домой с ведром в лодке — дома оно у него в руке. Копать и класть в воду что-то, кроме ведра, нельзя.
{
  const sailor = await createAccount(db, 'моряк_' + Math.random().toString(36).slice(2, 8), 'не-для-входа');
  const box = { self: null as WorldState | null, items: null as ServerMessages['items'] | null, bags: null as ServerMessages['bags'] | null, voyage: null as ServerMessages['voyage'] | null, fish: [] as ServerMessages['fish'][], worms: [] as ServerMessages['worms'][] };
  const hear = (r: Room) => {
    r.onMessage('self', (m: WorldState) => { box.self = m; });
    r.onMessage('items', (m: ServerMessages['items']) => { box.items = m; });
    r.onMessage('bags', (m: ServerMessages['bags']) => { box.bags = m; });
    r.onMessage('voyage', (m: ServerMessages['voyage']) => { box.voyage = m; });
    r.onMessage('fish', (m: ServerMessages['fish']) => { box.fish.push(m); });
    r.onMessage('worms', (m: ServerMessages['worms']) => { box.worms.push(m); });
    for (const type of ['clock', 'weather', 'hunger', 'food', 'fridge', 'chest']) r.onMessage(type, () => {});
    return r;
  };
  const board = async (to: 'isle' | 'sea' | 'home') => {
    await r.leave();
    box.self = null; box.items = null; box.voyage = null;
    r = hear(await client.joinOrCreate(ROOM, { ticket: issueTicket(sailor.id, sailor.name), ...(to === 'home' ? { pier: sailor.id, to } : { pier: SEA_ROOM, to }) }));
    await until('вход после переправы', () => !!box.self && !!box.items && !!view());
  };
  let r = hear(await client.joinOrCreate(ROOM, { ticket: issueTicket(sailor.id, sailor.name), pier: sailor.id }));
  const view = () => (r.state as { players: { get(sid: string): PlayerView | undefined } }).players.get(r.sessionId);
  await until('моряка на причале', () => !!box.self && !!box.items && !!box.bags && !!view());
  const pailId = box.items!.hands.find(it => ITEMS.isBucket(it.kind))!.id, sKit = box.items!.list;
  r.send('stand');
  const sAt = { ...standPoint() };
  await walk({ x: World.pack.baseX, y: World.pack.baseY + 6 }, r, sAt);
  r.send('packOn');
  await until('рюкзак моряка на спине', () => !!view()?.wearing);
  await walk(BOAT_AT, r, sAt);
  r.send('sail', { to: 'sea' });
  await until('лодку в океан', () => !!box.voyage);
  check(box.voyage!.to === 'sea', 'у лодки выбрал открытый океан — сервер отпускает туда');
  await board('sea');
  const b = SEA.box;
  check(box.self!.sea && !box.self!.isle && view()!.sea && box.self!.x >= b.x0 && box.self!.x <= b.x1 && box.self!.y >= b.y0 && box.self!.y <= b.y1, 'приплыл в открытый океан — в своей лодке, на воде, и это видно всем');
  check(box.self!.seen.includes('sea') && !box.self!.seen.includes('isle'), 'океан открыт на карте мира, остров — ещё нет');
  box.worms.length = 0;
  r.send('dig');
  await until('отказ копать в океане', () => box.worms.length > 0);
  check(box.worms[0]!.e === 'ground', 'в океане не копают');
  // гребут: шаг по воде принят, как шаг по земле (медленнее — SEA.ROW), за горизонт не уплыть
  const sea0 = { x: box.self!.x, y: box.self!.y };
  box.self = null;
  r.send('move', { x: sea0.x + 2, y: sea0.y, dir: 'right' });
  await sleep(300);
  check(!box.self && view()!.x === sea0.x + 2 && view()!.dir === 'right', 'на вёслах лодка идёт по воде');
  r.send('move', { x: sea0.x + 2, y: SEA.horizon - 10, dir: 'up' });
  await until('отказ за горизонт', () => !!box.self);
  check(box.self!.y >= b.y0, 'за горизонт на лодке не уплыть');
  // якорь: руки готовятся к рыбалке сами — ведро из руки встаёт в лодку, удочка и черви из рюкзака — в руки
  box.items = null;
  r.send('sit');
  await until('бросил якорь', () => view()?.sitting === true && !!box.items?.moved);
  check(view()!.x === sea0.x + 2 && view()!.y === sea0.y, 'якорь бросают там, где лодка');
  check(box.items!.moved!.join() === 'boat,rod,bait' && view()!.boat === 'bucket' && view()!.hand === 'rod-willow' && view()!.off === 'worms', 'бросил якорь — ведро само встало в лодку, удочка и черви из рюкзака — в руки');
  await until('ведро в лодке среди вёдер', () => !!box.bags?.some(x => x.id === pailId && x.boat));
  await sleep(300);
  check((await loadGround(db, boatPlace(sailor.id))).some(g => g.id === pailId), 'ведро, само вставшее в лодку, записано в базу — в месте лодки игрока');
  const rigged = await loadItems(db, sailor.id);
  check(rigged.hands.some(it => it.kind === 'rod-willow') && rigged.hands.some(it => it.kind === 'worms') && !rigged.list.some(it => it.kind === 'rod-willow' || it.kind === 'worms') && !rigged.hands.some(it => it.id === pailId), 'удочка и черви, взятые на якоре, записаны в базу — в руках, а не в рюкзаке');
  r.send('stand');
  await until('поднял якорь', () => view()?.sitting === false);
  check(view()!.x === sea0.x + 2 && view()!.y === sea0.y && view()!.off === 'worms', 'якорь поднят — лодка там же, черви в руке');
  // в воду ничего, кроме ведра, не положить: удочка «утонет» — сервер не даёт
  box.items = null;
  r.send('itemDrop', { id: thing(sKit, 'rod-willow').id });
  await until('отказ положить удочку в воду', () => !!box.items);
  check(box.items!.note === 'sea' && box.items!.hands.some(it => it.kind === 'rod-willow'), 'в океане удочку на землю не положить — некуда');
  // ведро из лодки — только в свободную руку; руками его ставят обратно (Q, E)
  box.items = null;
  r.send('itemPick', { id: pailId });
  await until('отказ взять ведро занятыми руками', () => !!box.items);
  check(box.items!.note === 'busy' && view()!.boat === 'bucket', 'руки заняты удочкой и червями — ведро из лодки не взять');
  r.send('itemStow', { id: thing(sKit, 'worms').id, at: null });
  await until('черви в рюкзаке', () => view()?.off === '');
  r.send('itemPick', { id: pailId });
  await until('ведро из лодки в руке', () => view()?.boat === '' && view()?.off === 'bucket');
  box.items = null;
  r.send('itemPut', { x: sea0.x, y: sea0.y, left: true });
  await until('ведро в лодке', () => view()?.boat === 'bucket' && !!box.items);
  check(!box.items!.hands.some(it => it.id === pailId) && box.bags!.some(x => x.id === pailId && x.boat) && !box.items!.moved, 'ведро поставлено в лодку руками — у ног, и это видно всем');
  box.items = null;
  r.send('sit');
  await until('снова на якоре', () => view()?.sitting === true && !!box.items?.moved);
  check(box.items!.moved!.join() === 'bait' && view()!.off === 'worms', 'ведро уже в лодке — якорь взял из рюкзака только червей');
  box.fish.length = 0;
  r.send('press');
  await until('заброс в океане', () => box.fish.some(f => f.e === 'cast'));
  await until('поклёвку в океане', () => box.fish.some(f => f.e === 'bite'), 40000);
  r.send('press');
  await until('подсечку в океане', () => box.fish.some(f => f.e === 'hook'));
  const got = box.fish.find(f => f.e === 'hook')!;
  check(got.e === 'hook' && got.pail?.id === pailId && got.pail.n === 1 && FISH.where(FISH.SPECIES.find(sp => sp.id === got.fish.id)!).includes('sea'), `поймана морская рыба в ведро в лодке: ${got.e === 'hook' ? got.fish.id + ' ' + got.fish.grams + ' г' : ''}`);
  await until('хвост над ведром в лодке', () => (view()?.recent.length ?? 0) > 0);
  check(true, 'хвост рыбы над ведром в лодке видят все');
  // сходит на остров с удочкой и червями в руках: в кожаный рюкзак ведро не влезает — черви уходят в рюкзак, а ведро из лодки — в руку
  box.self = null;
  r.send('sail', { to: 'isle' });
  await until('к острову', () => !!box.self && box.self.isle && view()?.isle === true);
  check(!box.self!.sea && box.self!.x === Isle.landing.x && box.self!.y === Isle.landing.y && box.self!.seen.includes('isle'), 'из океана приплыл к острову — на пляж, в той же комнате');
  await until('ведро из лодки в руке на острове', () => view()?.boat === '' && view()?.off === 'bucket');
  check(view()!.hand === 'rod-willow' && box.items!.list.some(it => it.kind === 'worms') && box.bags!.some(x => x.id === pailId && !x.boat && x.bag.total === 1), 'сошёл на остров — черви сами ушли в рюкзак, ведро с уловом из лодки — в руке');
  // снова в океан, ведро — в лодку, и домой: дома ведро из лодки опять в руке
  r.send('sail', { to: 'sea' });
  await until('снова в океане', () => view()?.sea === true);
  r.send('itemPut', { x: view()!.x, y: view()!.y, left: true });
  await until('ведро снова в лодке', () => view()?.boat === 'bucket');
  await sleep(300);
  check((await loadGround(db, boatPlace(sailor.id))).some(g => g.id === pailId), 'ведро в лодке записано в базу — в месте лодки игрока');
  // перезашёл в океан — ведро так и стоит в лодке
  await board('sea');
  check(view()!.sea && view()!.boat === 'bucket' && box.bags!.some(x => x.id === pailId && x.boat && x.bag.total === 1), 'перезашёл в океан — ведро с уловом всё так же в лодке');
  box.voyage = null;
  r.send('sail', { to: 'home' });
  await until('лодку домой из океана', () => !!box.voyage);
  check(box.voyage!.to === 'home', 'из океана отпускают домой');
  await board('home');
  check(!box.self!.sea && !box.self!.isle && dist(box.self!, boatPoint()) < 1 && box.self!.pack.worn, 'приплыл домой — стоит у лодки на мостках, рюкзак на спине');
  await until('ведро дома в руке', () => view()?.off === 'bucket' && view()?.boat === '');
  await sleep(400);
  check(box.bags!.some(x => x.id === pailId && !x.boat && x.bag.total === 1) && !(await loadGround(db, boatPlace(sailor.id))).length, 'дома ведро с морской рыбой у него в руке, лодка пуста');
  await r.leave();
  await sleep(500);
  // уснувший от голода в общие воды не попадёт — сервер сразу отправляет его домой
  const tired = (await loadPlayer(db, sailor.id))!.world!;
  await saveWorld(db, sailor.id, { ...tired, sleep: Date.now() + 60_000 });
  box.self = null; box.voyage = null;
  r = hear(await client.joinOrCreate(ROOM, { ticket: issueTicket(sailor.id, sailor.name), pier: SEA_ROOM, to: 'sea' }));
  await until('домой спящим', () => !!box.voyage);
  check(box.voyage!.to === 'home' && box.voyage!.slept === true, 'спящий в общие воды не попадает — сервер сразу отправляет его домой, к крыльцу');
  await r.leave();
}
await sleep(300);

// жуёт рыбу HUNGER.EAT секунд — это в состоянии комнаты, его видят все; вторую рыбу в это время не съесть
{
  const eater = await createAccount(db, 'едок_' + Math.random().toString(36).slice(2, 8), 'не-для-входа');
  const eaterPail = (await loadItems(db, eater.id)).hands.find(it => ITEMS.isBucket(it.kind))!.id;
  for (let i = 0; i < 2; i++) await recordCatch(db, eater.id, { id: 'roach', grams: 100 + i }, eaterPail);
  const r: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(eater.id, eater.name), pier: eater.id });
  let plate: ServerMessages['items'] | null = null;
  const ate: ServerMessages['food'][] = [];
  r.onMessage('items', (m: ServerMessages['items']) => { plate = m; });
  r.onMessage('food', (m: ServerMessages['food']) => { ate.push(m); });
  for (const type of ['self', 'bags', 'fish', 'clock', 'weather', 'hunger', 'fridge', 'chest']) r.onMessage(type, () => {});
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
  const hostPail = (await loadItems(db, host.id)).hands.find(it => ITEMS.isBucket(it.kind))!.id;
  for (let i = 0; i < 4; i++) await recordCatch(db, host.id, { id: 'roach', grams: 100 + i }, hostPail);
  const r: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(host.id, host.name), pier: host.id });
  let plate: ServerMessages['items'] | null = null;
  r.onMessage('items', (m: ServerMessages['items']) => { plate = m; });
  for (const type of ['self', 'bags', 'fish', 'clock', 'weather', 'hunger', 'food', 'fridge', 'chest']) r.onMessage(type, () => {});
  const lying = (id: number) => onGround(id, r);
  const stored = async (id: number) => (await loadGround(db, pierPlace(host.id))).some(g => g.id === id) || (await loadItems(db, host.id)).hands.some(it => it.id === id);
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
    r.send('itemDrop', { id: hostPail });
    await until('ведро на земле', () => !!lying(hostPail));
    r.send('scrap', { id: hostPail, by: 'fade' });
    await sleep(400);
    check(lying(hostPail)?.end === '', 'не рыбу звери не трогают: ведро на земле лежит как лежало');
  } else {
    r.send('scrap', { id: a.id, by: 'gull' });
    await sleep(400);
    check(lying(a.id)?.end === '', 'звать зверя к рыбе с клиента нельзя — сервер не слушает');
    r.send('itemDrop', { id: hostPail });
    await until('ведро на земле', () => !!lying(hostPail));
  }
  // ведро на земле — общее: сосед приходит в гости, достаёт из него рыбу, а потом уносит его — и улов уходит вместе с ведром
  await sleep(300);
  const left = haulOf(lying(hostPail)!.haul).roach ?? 0;
  check(left >= 1, `в ведре рыбака на земле ${left} ${left === 1 ? 'рыба' : 'рыбы'} — это видят все`);
  await r.leave();
  await sleep(300);
  const nb = await createAccount(db, 'сосед_' + Math.random().toString(36).slice(2, 8), 'не-для-входа');
  const n: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(nb.id, nb.name), pier: host.id });
  let nItems: ServerMessages['items'] | null = null, nBags: ServerMessages['bags'] | null = null, nSelf: WorldState | null = null, nPiers: ServerMessages['piers'] | null = null;
  n.onMessage('items', (m: ServerMessages['items']) => { nItems = m; });
  n.onMessage('bags', (m: ServerMessages['bags']) => { nBags = m; });
  n.onMessage('self', (m: WorldState) => { nSelf = m; });
  n.onMessage('piers', (m: ServerMessages['piers']) => { nPiers = m; });
  for (const type of ['fish', 'clock', 'weather', 'hunger', 'food', 'fridge', 'worms', 'chest']) n.onMessage(type, () => {});
  const nSeen = () => (n.state as { players: { get(sid: string): PlayerView | undefined } }).players.get(n.sessionId);
  const pierOf = (who: Room) => who.state as unknown as { owner: string; ownerName: string };
  await until('соседа в комнате', () => !!nItems && !!nBags && !!onGround(hostPail, n) && !!nSeen());
  check(pierOf(n).owner === host.id && pierOf(n).ownerName === host.name, 'сосед пришёл в гости на причал рыбака — это видно в комнате');
  {   // хозяин вернулся, пока гость у него: они в одной комнате и видят друг друга
    const h = await client.joinOrCreate(ROOM, { ticket: issueTicket(host.id, host.name), pier: host.id });
    for (const type of ['self', 'items', 'bags', 'fish', 'clock', 'weather', 'hunger', 'food', 'fridge', 'worms', 'chest']) h.onMessage(type, () => {});
    const count = (who: Room) => (who.state as { players?: { size: number } } | undefined)?.players?.size ?? 0;   // состояние приходит не сразу
    await until('хозяина и гостя вместе', () => count(h) === 2 && count(n) === 2);
    check(h.roomId === n.roomId, 'хозяин и гость на одном причале — в одной комнате и видят друг друга');
    await h.leave();
    await until('хозяин ушёл', () => count(n) === 1);
  }
  check(nSeen()!.x === standPoint().x && !nSeen()!.wearing && nSeen()!.px === -1000, 'гость стоит у места рыбака, а его рюкзак остался дома — здесь его нет');
  const own = nItems!.hands.find(it => ITEMS.isBucket(it.kind))!;
  const nAt = { ...standPoint() }, g = onGround(hostPail, n)!;
  await walk(World.nearestWalkable(g.x, g.y + 4)!, n, nAt);
  await sleep(300);
  nItems = null;
  n.send('fishTake', { species: 'roach', pail: hostPail });
  await until('рыбу у соседа', () => !!nItems && nItems.hands.some(it => it.kind === 'fish' && it.id > 0));
  await until('ведро рыбака стало легче', () => (haulOf(onGround(hostPail, n)?.haul ?? '').roach ?? 0) === left - 1);
  check(!nItems!.hands.find(it => it.kind === 'fish')!.left, 'сосед достал рыбу из чужого ведра на земле в свободную руку — в ведре стало на одну меньше');
  const fishId = nItems!.hands.find(it => it.kind === 'fish')!.id;
  n.send('itemDrop', { id: own.id });             // своё ведро — на землю: левая рука для чужого
  await until('своё ведро на земле', () => !!onGround(own.id, n) && nBags!.every(b => b.id !== own.id));
  await sleep(300);
  n.send('itemPick', { id: hostPail, left: true });
  await until('ведро рыбака у соседа', () => !onGround(hostPail, n) && !!nBags?.some(b => b.id === hostPail && b.bag.total === left - 1));
  check(true, `сосед унёс ведро рыбака — с ним и ${left - 1} ${left - 1 === 1 ? 'рыба' : 'рыбы'} в нём`);
  await sleep(300);
  const [nStored, hStored] = await Promise.all([loadItems(db, nb.id), loadItems(db, host.id)]);
  check(nStored.hands.some(it => it.id === hostPail) && !hStored.hands.some(it => it.id === hostPail) && !hStored.list.some(it => it.id === hostPail), 'в базе ведро теперь соседа, у рыбака его нет');
  check(nItems!.hands.some(it => it.id === fishId), 'рыба, которую он достал раньше, — по-прежнему у него в руке');
  // в чужой дом гостю не войти
  await walk(homePoint(), n, nAt);
  nSelf = null;
  n.send('enter');
  await until('отказ войти в чужой дом', () => !!nSelf);
  check(!nSelf!.inside && nSeen()?.inside === false, 'в чужой дом гостю не войти — дверь открывается только хозяину');
  // на каком причале сейчас кто-то есть — свой виден, этот (где он сам) — нет
  const lone = await createAccount(db, 'одиночка_' + Math.random().toString(36).slice(2, 8), 'не-для-входа');
  const l: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(lone.id, lone.name), pier: lone.id });
  for (const type of ['self', 'items', 'bags', 'fish', 'clock', 'weather', 'hunger', 'food', 'fridge', 'worms', 'chest']) l.onMessage(type, () => {});
  await until('одиночку на его причале', () => pierOf(l).owner === lone.id);
  n.send('piers');
  await until('список причалов', () => !!nPiers);
  check(nPiers!.list.some(p => p.owner === lone.id && p.name === lone.name && p.players === 1) && !nPiers!.list.some(p => p.owner === host.id), 'в списке причалов есть причал одиночки с одним игроком, а причала, где сосед сейчас, нет');
  check(!onGround(own.id, l) && l.roomId !== n.roomId, 'ведро, оставленное соседом на причале рыбака, на чужом причале не видно');
  await l.leave();
  await n.leave();
  await sleep(300);
  const [hostGround, nbGround] = await Promise.all([loadGround(db, pierPlace(host.id)), loadGround(db, pierPlace(nb.id))]);
  check(hostGround.some(it => it.id === own.id) && !nbGround.some(it => it.id === own.id), 'в базе ведро соседа лежит на причале рыбака, а не у него дома');
  const nbWorld = (await loadPlayer(db, nb.id))!.world!;
  check(nbWorld.x === seat.x && nbWorld.y === seat.y && nbWorld.sitting && !nbWorld.pack.worn, 'дома у соседа всё как было: из гостей он вернётся на своё место рыбака, рюкзак дома');
  // у себя дома сосед видит свою землю — пустую
  const nHome: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(nb.id, nb.name), pier: nb.id });
  for (const type of ['self', 'items', 'bags', 'fish', 'clock', 'weather', 'hunger', 'food', 'fridge', 'worms', 'chest']) nHome.onMessage(type, () => {});
  await until('соседа дома', () => pierOf(nHome).owner === nb.id);
  await sleep(300);
  check(!onGround(own.id, nHome) && !onGround(hostPail, nHome), 'дома у соседа на земле нет вещей с причала рыбака');
  await nHome.leave();
  await sleep(300);
}

// голод: сытость на нуле почти три минуты — входим, и герой засыпает; спит — ходить нельзя, из рюкзака и рук крадут
// часть вещей (HUNGER.lost), а что на земле и в холодильнике — не трогают; проснувшись, он узнаёт, что мог что-то потерять
for (let i = 0; i < 10; i++) await recordCatch(db, me.id, { id: 'roach', grams: 100 + i }, pail.id);   // ведро — на земле у причала
const kept = await loadItems(db, me.id), had = kept.list.length + kept.hands.length;
const saved = (await loadPlayer(db, me.id))!.world!;
await saveWorld(db, me.id, { ...saved, sitting: false, food: 0, starve: HUNGER.STARVE - 0.5 });
async function enter() {
  const r: Room = await client.joinOrCreate(ROOM, { ticket: issueTicket(me.id, me.name), pier: me.id });
  self = null; hunger = null; items = null; woke = false;
  r.onMessage('self', (m: WorldState) => { self = m; });
  r.onMessage('hunger', (m: ServerMessages['hunger']) => { hunger = m; if (m.woke) woke = true; });
  r.onMessage('items', (m: ServerMessages['items']) => { items = m; });
  for (const type of ['fish', 'bags', 'clock', 'weather', 'food', 'fridge', 'worms', 'chest']) r.onMessage(type, () => {});
  await until('себя после входа', () => !!self && !!hunger && !!items);
  return r;
}
let woke = false;
let hungry = await enter();
check(hunger!.food === 0 && hunger!.sleep === 0 && items!.list.length + items!.hands.length === had, `вошёл голодным: сытость на нуле, вещей ${had}`);
await until('уснул', () => !!hunger && hunger.sleep > 0, 3000);
check(hunger!.sleep > (HUNGER.SLEEP - 5) * 1000 && !woke, `голодный уснул на ${HUNGER.SLEEP / 60} минуты`);
await until('вещи пропали', () => !!items && items.list.length + items.hands.length < had);
check(items!.list.length + items!.hands.length === had - HUNGER.lost(had), `пока спит, из рюкзака и рук украли ${HUNGER.lost(had)} из ${had} вещей`);
await sleep(500);
const robbed = await loadItems(db, me.id);
check(robbed.list.length + robbed.hands.length === had - HUNGER.lost(had), 'кража записана в базу');
check((await loadBags(db, [pail.id])).get(pail.id)!.counts.roach === 10 && (await loadGround(db, pierPlace(me.id))).some(g => g.id === pail.id), 'ведро на земле не тронули — в нём все десять рыб');
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
check(self!.y === home.y && hunger!.food === HUNGER.MAX && woke, 'выспался — проснулся у крыльца дома сытым, и ему сказали, что пока он спал, могли украсть вещи');
await hungry.leave();
await sleep(500);
const late = (await loadPlayer(db, me.id))!.world!;
await saveWorld(db, me.id, { ...late, x: seat.x, y: seat.y - 30, sleep: Date.now() - 1000 });
hungry = await enter();
check(self!.x === home.x && self!.y === home.y && hunger!.food === HUNGER.MAX && hunger!.sleep === 0 && woke, 'сон кончился, пока игрока не было, — входит у дома, сытый, и узнаёт о возможной краже');
await hungry.leave();
await db.close();
console.log('всё работает');
process.exit(0);
