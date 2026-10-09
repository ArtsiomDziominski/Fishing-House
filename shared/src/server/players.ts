// Всё, что серверы делают с игроками в базе: регистрация, вход, прогресс, улов, публичный профиль.
// Сайт (Nuxt) и игровой сервер (Colyseus) пользуются одними и теми же функциями.

import { randomInt } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { FISH, type Catch } from '../fish.ts';
import { HUNGER } from '../hunger.ts';
import { emptyBag, type Bag } from '../protocol.ts';
import { PACKS } from '../packs.ts';
import { DIRS, startPack, type WorldState } from '../rules.ts';
import { World } from '../world.ts';
import { Indoor } from '../indoor.ts';
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

// Ведро игрока: сколько каких рыб, самые крупные, общий вес и три последние. В ведре — то, что ещё не вынуто (catches.gone);
// all — весь улов за всё время (для профиля).
export async function loadBag(db: Db, pid: string, all = false): Promise<Bag> {
  const bag = emptyBag(), mine = all ? eq(catches.playerId, pid) : and(eq(catches.playerId, pid), eq(catches.gone, false));
  const rows = await db.select({
    species: catches.species,
    n: sql<number>`count(*)::int`, best: sql<number>`max(${catches.grams})::int`, grams: sql<number>`sum(${catches.grams})::int`,
  }).from(catches).where(mine).groupBy(catches.species);
  for (const r of rows) {
    if (!FISH.byId[r.species]) continue;
    bag.counts[r.species] = r.n; bag.best[r.species] = r.best; bag.total += r.n; bag.grams += r.grams;
  }
  const last = await db.select({ species: catches.species }).from(catches)
    .where(mine).orderBy(desc(catches.caughtAt), desc(catches.id)).limit(3);
  bag.recent = last.map(r => r.species).filter(id => FISH.byId[id]).reverse();
  return bag;
}

// Сохранённое место героя и рюкзака; что не так — исправляем, чтобы игрок не застрял в стене.
// У тех, кто играл до появления рюкзаков, рюкзака в записи нет — он ждёт на своём месте.
// Места записаны при том положении картинки на карте, которое лежит в picX и picY (в старых записях их нет: карта
// тогда была одной картинкой или не росла вверх). Если карту с тех пор расширили, всё сдвигается вместе с картинкой.
// Голода в старых записях нет — герой сыт.
const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
export function cleanWorld(w: WorldState | null): WorldState | null {
  if (!w || typeof w.x !== 'number' || typeof w.y !== 'number') return null;
  const dx = World.pic.x - (typeof w.picX === 'number' ? w.picX : 0);
  const dy = World.pic.y - (typeof w.picY === 'number' ? w.picY : 0);
  const moved = (v: number | undefined, d: number, home: number) => (Math.round(v!) ? Math.round(v!) + d : home);
  // в доме — свой кадр (Indoor), картинка-образец его не двигает; там, где стоял, теперь мебель — встанет рядом или у порога
  const inside = (w as { inside?: boolean }).inside === true;
  const p = inside ? Indoor.nearestWalkable(w.x, w.y) || Indoor.door : World.nearestWalkable(w.x + dx, w.y + dy) || { x: World.seat.x, y: World.seat.y };
  const k = w.pack as Partial<WorldState['pack']> | undefined;
  return {
    x: p.x, y: p.y, dir: DIRS.includes(w.dir) ? w.dir : 'down', sitting: !!w.sitting && !inside, inside,
    pack: k ? { x: moved(k.x, dx, World.pack.baseX), y: moved(k.y, dy, World.pack.baseY), worn: !!k.worn, kind: PACKS.isKind(k.kind) ? k.kind : PACKS.DEFAULT } : startPack(),
    rest: false, bed: false,
    lamp: (w as { lamp?: boolean }).lamp !== false,   // в старых записях лампы нет — она зажжена
    picX: World.pic.x, picY: World.pic.y,
    food: num(w.food, HUNGER.MAX, 0, HUNGER.MAX), starve: num(w.starve, 0, 0, HUNGER.STARVE), sleep: num(w.sleep, 0, 0, Infinity),
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

// Герой уснул от голода: из ведра пропадает доля рыбы (HUNGER.lost), какая попадётся. Возвращает, сколько пропало.
export async function loseCatches(db: Db, pid: string): Promise<number> {
  return db.transaction(async tx => {
    const left = await tx.select({ id: catches.id }).from(catches).where(and(eq(catches.playerId, pid), eq(catches.gone, false))).for('update');
    const ids = left.map(r => r.id).sort(() => Math.random() - 0.5).slice(0, HUNGER.lost(left.length));
    if (ids.length) await tx.update(catches).set({ gone: true }).where(inArray(catches.id, ids));
    return ids.length;
  });
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
    bag: await loadBag(db, pid, true),
    latest: latest.map(c => ({ species: c.species, grams: c.grams, caughtAt: c.caughtAt.toISOString() })),
  };
}
