// Игровой сервер. Один процесс держит несколько комнат-причалов; процессов может быть несколько —
// тогда они находят друг друга через Redis (REDIS_URL), а браузер подключается к нужному по PUBLIC_ADDRESS.
//
//   GAME_PORT       порт этого процесса (по умолчанию 2567)
//   REDIS_URL       пусто — один процесс без Redis
//   PUBLIC_ADDRESS  как браузер дойдёт до этого процесса, например fishing.example.com/game/1 (за Caddy)
//   DEV_TOOLS       1 — из игры можно переводить часы причала и выставлять погоду (см. sky.ts); по умолчанию — везде, кроме продакшена

import { defineServer, defineRoom, RedisPresence, RedisDriver } from 'colyseus';
import { ROOM } from '@fh/shared';
import { PierRoom } from './PierRoom.ts';
import { db } from './db.ts';

for (const key of ['DATABASE_URL', 'GAME_SECRET']) {
  if (!process.env[key]) { console.error(`Не задан ${key} — см. .env.example`); process.exit(1); }
}

const port = Number(process.env.GAME_PORT) || 2567;
const redis = process.env.REDIS_URL || '';

const server = defineServer({
  rooms: { [ROOM]: defineRoom(PierRoom) },
  ...(redis ? { presence: new RedisPresence(redis), driver: new RedisDriver(redis) } : {}),
  ...(process.env.PUBLIC_ADDRESS ? { publicAddress: process.env.PUBLIC_ADDRESS } : {}),
  greet: false,
});
server.onShutdown(() => db.close());

await server.listen(port);
console.log(`Игровой сервер: ws://localhost:${port}${redis ? ' (Redis: ' + redis + ')' : ''}${process.env.PUBLIC_ADDRESS ? ', снаружи ' + process.env.PUBLIC_ADDRESS : ''}`);
