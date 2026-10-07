// Применяет миграции из shared/drizzle к базе DATABASE_URL: `npm run db:migrate`.

import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './db.ts';

const folder = process.env.MIGRATIONS_DIR || fileURLToPath(new URL('../../drizzle', import.meta.url));
const db = createDb(undefined, 1);
try {
  await migrate(db, { migrationsFolder: folder });
  console.log('База обновлена:', folder);
} finally {
  await db.close();
}
