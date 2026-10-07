// drizzle-kit: `npm run db:generate` сравнивает схему с прошлыми миграциями и пишет новую в shared/drizzle.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './shared/src/server/schema.ts',
  out: './shared/drizzle',
  dbCredentials: { url: process.env.DATABASE_URL || 'postgres://fishing:fishing@localhost:5432/fishing' },
});
