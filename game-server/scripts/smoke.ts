// Проверка игрового сервера целиком: бот заводит игрока в базе, входит по билету, идёт за ведром и рюкзаком,
// несёт их к причалу, садится и ловит рыбу; заодно проверяет, что телепорт сервер не принимает.
//
//   npm run smoke -w game-server            (нужны запущенные база и игровой сервер, .env с DATABASE_URL и GAME_SECRET)
//   GAME_URL=http://localhost:2567 npm run smoke -w game-server

import { Client, type Room } from '@colyseus/sdk';
import { World, ROOM, DAY_LENGTH, WEATHERS, dayHour, weatherText, seat, standPoint, type Bag, type PlayerView, type ServerMessages, type WorldState } from '@fh/shared';
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
check(self!.sitting && self!.bucket.home, 'новый игрок сидит на причале, ведро у дома');
check(!self!.pack.worn && self!.pack.x === World.pack.baseX && self!.pack.kind === 'leather', 'кожаный рюкзак лежит у дома');

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

await walk({ x: seat.x, y: seat.y });
room.send('sit', { put: { x: 96, y: 241 } });
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
await until('себя после входа', () => !!self);
check(self!.sitting && !self!.bucket.home && self!.bucket.x === 96, 'после перезахода герой на причале, ведро там, где поставили');
check(self!.pack.worn && self!.pack.kind === 'sailor', 'рюкзак после перезахода на спине, тот же морской');
check(bag!.total === 1, 'ведро после перезахода с той же рыбой');
await again.leave();
await db.close();
console.log('всё работает');
process.exit(0);
