// Проверка игрового сервера целиком: бот заводит игрока в базе, входит по билету, идёт за ведром,
// несёт его к причалу, садится и ловит рыбу; заодно проверяет, что телепорт сервер не принимает.
//
//   npm run smoke -w game-server            (нужны запущенные база и игровой сервер, .env с DATABASE_URL и GAME_SECRET)
//   GAME_URL=http://localhost:2567 npm run smoke -w game-server

import { Client, type Room } from '@colyseus/sdk';
import { World, ROOM, seat, standPoint, type Bag, type ServerMessages, type WorldState } from '@fh/shared';
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (what: string, ok: () => boolean, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return;
  throw new Error('не дождались: ' + what);
};
const check = (cond: unknown, what: string) => { if (!cond) throw new Error('не так: ' + what); console.log('  ✓', what); };

await until('себя и ведро', () => !!self && !!bag);
check(self!.sitting && self!.bucket.home, 'новый игрок сидит на причале, ведро у дома');

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
self = null;
await walk({ x: World.bucket.baseX, y: World.bucket.baseY + 6 });
await sleep(300);
check(self === null, 'честные шаги сервер принимает без поправок');

// телепорт — сервер возвращает на место
room.send('move', { x: seat.x, y: seat.y - 20, dir: 'down' });
await until('поправку', () => !!self);
check(Math.hypot(self!.x - pos.x, self!.y - pos.y) < 1, 'телепорт не принят, сервер вернул героя');

room.send('pick');
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
await until('себя после входа', () => !!self);
check(self!.sitting && !self!.bucket.home && self!.bucket.x === 96, 'после перезахода герой на причале, ведро там, где поставили');
check(bag!.total === 1, 'ведро после перезахода с той же рыбой');
await again.leave();
await db.close();
console.log('всё работает');
process.exit(0);
