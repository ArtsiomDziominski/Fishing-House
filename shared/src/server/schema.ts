// Схема базы (Drizzle). Миграции — в shared/drizzle: `npm run db:generate` после правки, `npm run db:migrate` чтобы применить.
//
// users   — учётные записи: имя для входа и хеш пароля. Наружу не отдаётся никогда.
// players — игровой профиль: публичный id, имя, деньги, где игрок оставил героя и ведро.
// catches — каждая пойманная рыба. Из неё собирается ведро и рекорды.

import { sql } from 'drizzle-orm';
import { bigserial, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { WorldState } from '../rules.ts';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  login: text('login').notNull(),                                  // имя в нижнем регистре — по нему ищем при входе
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('users_login_idx').on(t.login)]);

export const players = pgTable('players', {
  id: text('id').primaryKey(),                                     // публичный id: /player/<id>
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),                                    // имя, как его ввели при регистрации
  money: integer('money').notNull().default(0),
  world: jsonb('world').$type<WorldState>(),                       // null — ещё не играл
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, t => [uniqueIndex('players_user_idx').on(t.userId)]);

export const catches = pgTable('catches', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  species: text('species').notNull(),
  grams: integer('grams').notNull(),
  caughtAt: timestamp('caught_at', { withTimezone: true }).notNull().default(sql`now()`),
}, t => [index('catches_player_idx').on(t.playerId, t.caughtAt)]);

export const schema = { users, players, catches };
