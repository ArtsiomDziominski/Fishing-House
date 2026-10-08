// Схема базы (Drizzle). Миграции — в shared/drizzle: `npm run db:generate` после правки, `npm run db:migrate` чтобы применить.
//
// users   — учётные записи: имя для входа и хеш пароля. Наружу не отдаётся никогда.
// players — игровой профиль: публичный id, имя, деньги, где игрок оставил героя и рюкзак.
// catches — каждая пойманная рыба. Из неё собирается улов (панель ведра) и рекорды.
// items   — вещи игрока: что это и в какой клетке сетки рюкзака лежит, что она в руке или лежит на земле (правила — shared/src/items.ts).

import { sql } from 'drizzle-orm';
import { bigserial, boolean, index, integer, jsonb, pgTable, serial, smallint, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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
  kit: boolean('kit').notNull().default(false),                    // стартовые вещи уже положены в рюкзак
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

export const items = pgTable('items', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                                    // ITEM_KINDS; незнакомые при загрузке пропускаются
  x: smallint('x').notNull(),                                      // левая верхняя клетка в сетке рюкзака
  y: smallint('y').notNull(),
  rot: boolean('rot').notNull().default(false),                    // повёрнута на четверть оборота
  held: boolean('held').notNull().default(false),                  // в руке у героя, а не в рюкзаке; x, y, rot — где лежала до того
  leftHand: boolean('left_hand').notNull().default(false),         // в руке — в левой (иначе в правой; тяжёлая — в обеих, числится в правой)
  ground: boolean('ground').notNull().default(false),              // лежит на земле, общей для всех; тогда x, y — место на карте, а player_id — кто выложил
  lit: boolean('lit').notNull().default(false),                    // горит на земле (лампа); в руке горит ли лампа — players.world.lamp
  fish: text('fish').notNull().default(''),                        // ведро на земле: хвосты последних рыб в нём, id через запятую
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('items_player_idx').on(t.playerId), index('items_ground_idx').on(t.ground).where(sql`${t.ground}`)]);

export const schema = { users, players, catches, items };
