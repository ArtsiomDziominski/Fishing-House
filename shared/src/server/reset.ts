// Сносит базу DATABASE_URL до нуля и накатывает миграции заново: `npm run db:reset`. Пропадает всё — игроки, вещи, улов,
// холодильники; войти можно, только зарегистрировавшись снова. Только для разработки: в продакшене (NODE_ENV=production)
// отказывается. Игровой сервер держит землю в памяти — его перезапустить после сброса.

import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './db.ts';

if (process.env.NODE_ENV === 'production') {
  console.error('Сброс базы в продакшене запрещён (NODE_ENV=production)');
  process.exit(1);
}
const folder = process.env.MIGRATIONS_DIR || fileURLToPath(new URL('../../drizzle', import.meta.url));
const db = createDb(undefined, 1);
try {
  const [at] = await db.execute<{ db: string }>(sql`SELECT current_database() AS db`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);   // журнал применённых миграций
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrate(db, { migrationsFolder: folder });
  console.log(`База «${at?.db}» снесена и создана заново — пустая`);
} finally {
  await db.close();
}
