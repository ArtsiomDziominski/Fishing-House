// Та же проверка, что smoke.ts, но со своим игровым сервером: поднимает его на свободном порту, прогоняет бота и гасит.
// Нужна только база с миграциями — запущенный `npm run dev` не нужен и не задевается: часы и погоду бот переводит
// у своего процесса, а не у того, где сейчас играют. Так проверку гоняет и CI.
//
//   npm run smoke:own -w game-server        (.env с DATABASE_URL и GAME_SECRET)

import { spawn } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const freePort = () => new Promise<number>((resolve, reject) => {
  const probe = createServer().once('error', reject).listen(0, () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => resolve(port));
  });
});
const listening = (port: number) => new Promise<boolean>(resolve => {
  const sock = connect(port, 'localhost').once('connect', () => { sock.destroy(); resolve(true); }).once('error', () => resolve(false));
});

const port = await freePort();
// Без Redis: иначе матчмейкер увёл бы бота в комнату соседнего процесса — того, что запущен для разработки.
const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, GAME_PORT: String(port), REDIS_URL: '', PUBLIC_ADDRESS: '' },
  stdio: 'inherit',
});
let gone = false;
server.once('exit', () => { gone = true; });
process.once('exit', () => { server.kill(); });   // бот в конце зовёт process.exit — сервер гасим и тогда

for (const end = Date.now() + 30_000; !(await listening(port)); await new Promise(r => setTimeout(r, 100))) {
  if (gone) throw new Error('игровой сервер не запустился — см. вывод выше');
  if (Date.now() > end) throw new Error('игровой сервер не ответил за 30 секунд');
}

process.env.GAME_URL = `http://localhost:${port}`;
await import('./smoke.ts');
