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
import { Isle } from '../island.ts';
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

// Весь улов игрока за всё время — для профиля: сколько каких рыб, самые крупные, общий вес и три последние. Рекорды
// остаются, даже когда рыбу съели или унесли вместе с ведром.
export async function loadBag(db: Db, pid: string): Promise<Bag> {
  const bag = emptyBag(), mine = eq(catches.playerId, pid);
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

// Что лежит в этих вёдрах (id вещей-вёдер): рыба, которую в них поймали и ещё не вынули (catches.gone), кто бы её ни поймал.
// В ответе есть каждое ведро из ids, пустое — с пустым уловом. Двумя запросами на все вёдра разом: по видам и три последние.
export async function loadBags(db: Db, ids: readonly number[]): Promise<Map<number, Bag>> {
  const out = new Map<number, Bag>(), want = [...new Set(ids)].filter(id => id > 0);
  for (const id of want) out.set(id, emptyBag());
  if (!want.length) return out;
  const inside = and(inArray(catches.bucketId, want), eq(catches.gone, false));
  const rows = await db.select({
    bucket: catches.bucketId, species: catches.species,
    n: sql<number>`count(*)::int`, best: sql<number>`max(${catches.grams})::int`, grams: sql<number>`sum(${catches.grams})::int`,
  }).from(catches).where(inside).groupBy(catches.bucketId, catches.species);
  for (const r of rows) {
    const bag = out.get(r.bucket!); if (!bag || !FISH.byId[r.species]) continue;
    bag.counts[r.species] = r.n; bag.best[r.species] = r.best; bag.total += r.n; bag.grams += r.grams;
  }
  const nth = sql<number>`row_number() over (partition by ${catches.bucketId} order by ${catches.caughtAt} desc, ${catches.id} desc)`.as('nth');
  const ranked = db.select({ bucket: catches.bucketId, species: catches.species, nth }).from(catches).where(inside).as('ranked');
  const last = await db.select().from(ranked).where(sql`${ranked.nth} <= 3`).orderBy(ranked.bucket, desc(ranked.nth));
  for (const r of last) { const bag = out.get(r.bucket!); if (bag && FISH.byId[r.species]) bag.recent.push(r.species); }
  return out;
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
  // в доме и на острове — свой кадр (Indoor, Isle), картинка-образец его не двигает; там, где стоял, теперь мебель или
  // дерево — встанет рядом (или у порога, у лодки)
  const inside = (w as { inside?: boolean }).inside === true, isle = !inside && (w as { isle?: boolean }).isle === true;
  const p = inside ? Indoor.nearestWalkable(w.x, w.y) || Indoor.door : isle ? Isle.nearestWalkable(w.x, w.y) || Isle.landing
    : World.nearestWalkable(w.x + dx, w.y + dy) || { x: World.seat.x, y: World.seat.y };
  const k = w.pack as Partial<WorldState['pack']> | undefined;
  return {
    x: p.x, y: p.y, dir: DIRS.includes(w.dir) ? w.dir : 'down', sitting: !!w.sitting && !inside, inside, isle,
    pack: k ? { x: moved(k.x, dx, World.pack.baseX), y: moved(k.y, dy, World.pack.baseY), worn: !!k.worn, kind: PACKS.isKind(k.kind) ? k.kind : PACKS.DEFAULT } : startPack(),
    rest: false, bed: false,
    lamp: (w as { lamp?: boolean }).lamp !== false,   // в старых записях лампы нет — она зажжена
    picX: World.pic.x, picY: World.pic.y,
    food: num(w.food, HUNGER.MAX, 0, HUNGER.MAX), starve: num(w.starve, 0, 0, HUNGER.STARVE), sleep: num(w.sleep, 0, 0, Infinity),
  };
}

// Имя игрока по id; null — такого нет (сессия сайта живёт в cookie и переживает сброс базы; к кому идут в гости — тоже проверяем).
export async function playerName(db: Db, pid: string): Promise<string | null> {
  const [row] = await db.select({ name: players.name }).from(players).where(eq(players.id, pid)).limit(1);
  return row?.name ?? null;
}
export const hasPlayer = async (db: Db, pid: string) => (await playerName(db, pid)) !== null;

// Игрок входит в игру: берём его прогресс и отмечаем, что он был в игре сейчас. Улов — в вёдрах (loadBags).
export async function loadPlayer(db: Db, pid: string): Promise<(PlayerRef & { world: WorldState | null }) | null> {
  const [row] = await db.update(players).set({ lastSeenAt: new Date() }).where(eq(players.id, pid))
    .returning({ id: players.id, name: players.name, world: players.world });
  if (!row) return null;
  return { id: row.id, name: row.name, world: cleanWorld(row.world) };
}

export async function saveWorld(db: Db, pid: string, world: WorldState): Promise<void> {
  await db.update(players).set({ world, lastSeenAt: new Date() }).where(eq(players.id, pid));
}
// Игрок в гостях: дома меняется только то, что он носит с собой (patch — поля мира, packKind — вид рюкзака), а место героя
// и рюкзака остаются, какими их записал дом, — даже если дом сохранил их позже, чем гость вошёл. Мира в базе ещё нет — home целиком.
export async function saveAway(db: Db, pid: string, patch: Partial<WorldState>, packKind: string, home: WorldState): Promise<void> {
  const merged = sql`jsonb_set(${players.world} || ${JSON.stringify(patch)}::jsonb, '{pack,kind}', to_jsonb(${packKind}::text))`;
  await db.update(players).set({ world: sql`case when ${players.world} is null then ${JSON.stringify(home)}::jsonb else ${merged} end`, lastSeenAt: new Date() }).where(eq(players.id, pid));
}

// Игрок pid поймал рыбу, и она легла в ведро bucket (null — ведро ещё пишется в базу или его нет: рыба только в рекордах).
export async function recordCatch(db: Db, pid: string, fish: Catch, bucket: number | null = null): Promise<void> {
  await db.insert(catches).values({ playerId: pid, species: fish.id, grams: fish.grams, bucketId: bucket });
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
