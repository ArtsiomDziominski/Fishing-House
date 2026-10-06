// Подключение к Postgres. Одно на процесс: пул соединений внутри.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from './schema.ts';

export function createDb(url = process.env.DATABASE_URL, max = Number(process.env.DATABASE_POOL) || 10) {
  if (!url) throw new Error('Не задан DATABASE_URL — адрес базы, например postgres://fishing:fishing@localhost:5432/fishing');
  const client = postgres(url, { max, onnotice: () => {} });
  return Object.assign(drizzle(client, { schema }), { close: () => client.end({ timeout: 5 }) });
}

export type Db = ReturnType<typeof createDb>;
