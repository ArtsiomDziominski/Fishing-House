// Простой ограничитель попыток (вход, регистрация) в памяти процесса: не больше max за окно.
// Когда процессов сайта станет несколько, счётчики стоит перенести в Redis.

import type { H3Event } from 'h3';

const hits = new Map<string, { n: number; until: number }>();

export function limit(event: H3Event, scope: string, max: number, windowSec: number) {
  const key = scope + ':' + (getRequestIP(event, { xForwardedFor: true }) || 'unknown');
  const now = Date.now(), h = hits.get(key);
  if (!h || h.until < now) { hits.set(key, { n: 1, until: now + windowSec * 1000 }); return; }
  if (++h.n > max) {
    throw createError({ statusCode: 429, message: 'Слишком много попыток — подождите немного и попробуйте снова' });
  }
}

// чистим старые записи, чтобы карта не росла бесконечно
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.until < now) hits.delete(k); }, 60_000).unref?.();
