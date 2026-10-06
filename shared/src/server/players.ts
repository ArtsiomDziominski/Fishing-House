// Всё, что серверы делают с игроками в базе: регистрация, вход, прогресс, улов, публичный профиль.
// Сайт (Nuxt) и игровой сервер (Colyseus) пользуются одними и теми же функциями.

import { randomInt } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { FISH, type Catch } from '../fish.ts';
import { emptyBag, type Bag } from '../protocol.ts';
import { DIRS, type WorldState } from '../rules.ts';
import { World } from '../world.ts';
import { loginKey } from '../account.ts';
import type { Db } from './db.ts';
import { catches, players, users } from './schema.ts';

export interface PlayerRef { id: string; name: string }

export class NameTakenError extends Error { constructor() { super('Это имя уже занято'); } }

const ID_ABC = 'abcdefghijkmnopqrstuvwxyz0123456789';
export function newPlayerId(): string { let s = ''; for (let i = 0; i < 10; i++) s += ID_ABC[randomInt(ID_ABC.length)]; return s; }

// Ошибка Postgres «нарушена уникальность» — драйвер иногда прячет её в cause.
function isUnique(err: unknown, constraint?: string): boolean {
  for (let e: any = err; e; e = e.cause) if (e.code === '23505' && (!constraint || e.constraint_name === constraint)) return true;
  return false;
}

// Новый игрок: учётная запись и профиль одной транзакцией. passwordHash считает вызывающий.
export async function createAccount(db: Db, name: string, passwordHash: string): Promise<PlayerRef> {
  name = name.trim();
  try {
    return await db.transaction(async tx => {
      const [user] = await tx.insert(users).values({ login: loginKey(name), passwordHash }).returning({ id: users.id });
      const id = newPlayerId();
      await tx.insert(players).values({ id, userId: user!.id, name });
      return { id, name };
    });
  } catch (err) {
    if (isUnique(err, 'users_login_idx')) throw new NameTakenError();
    throw err;
  }
}

export async function findAccount(db: Db, name: string): Promise<(PlayerRef & { passwordHash: string }) | null> {
  const [row] = await db.select({ id: players.id, name: players.name, passwordHash: users.passwordHash })
    .from(users).innerJoin(players, eq(players.userId, users.id))
    .where(eq(users.login, loginKey(name))).limit(1);
  return row || null;
}

// Ведро игрока: сколько каких рыб, самые крупные, общий вес и три последние.
export async function loadBag(db: Db, pid: string): Promise<Bag> {
  const bag = emptyBag();
  const rows = await db.select({
    species: catches.species,
    n: sql<number>`count(*)::int`, best: sql<number>`max(${catches.grams})::int`, grams: sql<number>`sum(${catches.grams})::int`,
  }).from(catches).where(eq(catches.playerId, pid)).groupBy(catches.species);
  for (const r of rows) {
    if (!FISH.byId[r.species]) continue;
    bag.counts[r.species] = r.n; bag.best[r.species] = r.best; bag.total += r.n; bag.grams += r.grams;
  }
  const last = await db.select({ species: catches.species }).from(catches)
    .where(eq(catches.playerId, pid)).orderBy(desc(catches.caughtAt), desc(catches.id)).limit(3);
  bag.recent = last.map(r => r.species).filter(id => FISH.byId[id]).reverse();
  return bag;
}

// Сохранённое место героя и ведра; что не так — исправляем, чтобы игрок не застрял в стене.
function cleanWorld(w: WorldState | null): WorldState | null {
  if (!w || typeof w.x !== 'number' || typeof w.y !== 'number' || !w.bucket) return null;
  const p = World.nearestWalkable(w.x, w.y) || { x: World.seat.x, y: World.seat.y };
  const b = w.bucket;
  return {
    x: p.x, y: p.y, dir: DIRS.includes(w.dir) ? w.dir : 'down', sitting: !!w.sitting,
    bucket: { x: Math.round(b.x) || World.bucket.baseX, y: Math.round(b.y) || World.bucket.baseY, carried: !!b.carried && !w.sitting, home: !!b.home },
  };
}

// Игрок входит в игру: берём его прогресс и отмечаем, что он был в игре сейчас.
export async function loadPlayer(db: Db, pid: string): Promise<(PlayerRef & { world: WorldState | null; bag: Bag }) | null> {
  const [row] = await db.update(players).set({ lastSeenAt: new Date() }).where(eq(players.id, pid))
    .returning({ id: players.id, name: players.name, world: players.world });
  if (!row) return null;
  return { id: row.id, name: row.name, world: cleanWorld(row.world), bag: await loadBag(db, pid) };
}

export async function saveWorld(db: Db, pid: string, world: WorldState): Promise<void> {
  await db.update(players).set({ world, lastSeenAt: new Date() }).where(eq(players.id, pid));
}

export async function recordCatch(db: Db, pid: string, fish: Catch): Promise<void> {
  await db.insert(catches).values({ playerId: pid, species: fish.id, grams: fish.grams });
}

export interface Profile {
  id: string; name: string; money: number; createdAt: string; lastSeenAt: string | null;
  bag: Bag; latest: { species: string; grams: number; caughtAt: string }[];
}

// Публичный профиль — всё, что про игрока может увидеть любой, кто знает его id.
export async function getProfile(db: Db, pid: string): Promise<Profile | null> {
  const [row] = await db.select({ id: players.id, name: players.name, money: players.money, createdAt: players.createdAt, lastSeenAt: players.lastSeenAt })
    .from(players).where(eq(players.id, pid)).limit(1);
  if (!row) return null;
  const latest = await db.select({ species: catches.species, grams: catches.grams, caughtAt: catches.caughtAt })
    .from(catches).where(eq(catches.playerId, pid)).orderBy(desc(catches.caughtAt), desc(catches.id)).limit(10);
  return {
    id: row.id, name: row.name, money: row.money,
    createdAt: row.createdAt.toISOString(), lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    bag: await loadBag(db, pid),
    latest: latest.map(c => ({ species: c.species, grams: c.grams, caughtAt: c.caughtAt.toISOString() })),
  };
}
