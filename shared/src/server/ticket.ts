// Билет на вход в игровой сервер. Сайт выдаёт его вошедшему игроку, игровой сервер проверяет.
// Это HMAC-подпись общим секретом GAME_SECRET: { pid, name, exp }. Живёт минуту — только чтобы войти в комнату;
// дальше соединение держит сам Colyseus (и переподключает по своему токену).

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface Ticket { pid: string; name: string; exp: number }

const TTL = 60;

function secret(): string {
  const s = process.env.GAME_SECRET;
  if (!s || s.length < 32) throw new Error('GAME_SECRET не задан или короче 32 символов — им подписываются билеты в игру');
  return s;
}
const sign = (body: string, key: string) => createHmac('sha256', key).update(body).digest('base64url');

export function issueTicket(pid: string, name: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ pid, name, exp: Math.floor(now / 1000) + TTL } satisfies Ticket)).toString('base64url');
  return body + '.' + sign(body, secret());
}

// null — подпись не сошлась, билет испорчен или просрочен.
export function verifyTicket(ticket: unknown, now = Date.now()): Ticket | null {
  if (typeof ticket !== 'string' || ticket.length > 1024) return null;
  const [body, sig] = ticket.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body, secret())), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString()) as Ticket;
    if (typeof t.pid !== 'string' || typeof t.name !== 'string' || typeof t.exp !== 'number') return null;
    return t.exp * 1000 >= now ? t : null;
  } catch { return null; }
}
