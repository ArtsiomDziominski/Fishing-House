// Вещи игрока — в базе: загрузить (новому игроку — со стартовым набором), положить новую, записать места и что в руке.
// Земля общая: вещи на ней (items.ground) принадлежат тому, кто их выложил, пока их не поднимет кто-нибудь — тогда у вещи
// меняется хозяин. Можно ли так сделать, проверяет игровой сервер по правилам ITEMS (shared/src/items.ts); здесь только запись.

import { and, asc, eq } from 'drizzle-orm';
import { ITEMS, type GroundItem, type Item, type ItemKind, type Place } from '../items.ts';
import type { Db } from './db.ts';
import { items, players } from './schema.ts';

const columns = { id: items.id, kind: items.kind, x: items.x, y: items.y, rot: items.rot };
// Вещь и где она: held — в руке (тогда x, y, rot — где она лежала в рюкзаке до того, left — в левой ли). Иначе — лежит в рюкзаке.
export type Stored = Item & { held?: boolean };
// Вещь на земле и кто её выложил (owner — публичный id игрока).
export type Dropped = GroundItem & { owner: string };

// Вещи игрока в том порядке, в каком он их получал: list — в рюкзаке, hands — в руках. Выложенных на землю здесь нет —
// они в loadGround. Кто ещё не получал стартовый набор, получает его здесь же: отметка kit и сами вещи пишутся одной
// транзакцией, так что две вкладки разом набор не задвоят.
// Хватает ли рук на всё, что отмечено «в руках», решает игровой сервер.
export async function loadItems(db: Db, pid: string): Promise<{ list: Item[]; hands: Item[] }> {
  const rows = await db.transaction(async tx => {
    const [fresh] = await tx.update(players).set({ kit: true }).where(and(eq(players.id, pid), eq(players.kit, false))).returning({ id: players.id });
    if (fresh) await tx.insert(items).values(ITEMS.STARTER.map(({ left, ...it }) => ({ playerId: pid, ...it, leftHand: !!left })));
    return tx.select({ ...columns, held: items.held, left: items.leftHand }).from(items).where(and(eq(items.playerId, pid), eq(items.ground, false))).orderBy(asc(items.id));
  });
  const list: Item[] = [], hands: Item[] = [];
  for (const { held, left, ...it } of rows) if (ITEMS.isKind(it.kind)) { if (held) hands.push({ ...it, left } as Item); else list.push(it as Item); }
  return { list, hands };
}

// Всё, что лежит на земле, — у всех игроков разом: его видят во всех копиях причала, даже когда хозяина нет в игре.
export async function loadGround(db: Db): Promise<Dropped[]> {
  const rows = await db.select({ id: items.id, kind: items.kind, x: items.x, y: items.y, lit: items.lit, fish: items.fish, owner: items.playerId }).from(items).where(eq(items.ground, true)).orderBy(asc(items.id));
  return rows.filter((r): r is Dropped => ITEMS.isKind(r.kind));
}

export async function addItem(db: Db, pid: string, kind: ItemKind, at: Place): Promise<Item> {
  const [row] = await db.insert(items).values({ playerId: pid, kind, ...at }).returning(columns);
  return row as Item;
}

// Записать, где теперь эти вещи: в какой клетке рюкзака или в руке (переложили одну, взяли в руку, разложили весь рюкзак заново).
// Всё одной транзакцией: вещь из руки и вещь, занявшая её место, не разойдутся.
export async function placeItems(db: Db, pid: string, list: readonly Stored[]): Promise<void> {
  if (!list.length) return;
  await db.transaction(async tx => {
    for (const it of list) await tx.update(items).set({ x: it.x, y: it.y, rot: it.rot, held: !!it.held, leftHand: !!it.held && !!it.left, ground: false }).where(and(eq(items.id, it.id), eq(items.playerId, pid)));
  });
}

// Выложить свою вещь на землю: x, y — место на карте, lit — горит ли (лампа), fish — хвосты рыб (ведро).
export async function dropItem(db: Db, pid: string, it: GroundItem): Promise<void> {
  await db.update(items).set({ x: it.x, y: it.y, rot: false, held: false, leftHand: false, ground: true, lit: it.lit, fish: it.fish }).where(and(eq(items.id, it.id), eq(items.playerId, pid)));
}

// Поднять вещь с земли: она становится вещью игрока to и сразу ложится к нему в руку или в рюкзак (at). Чья она была, не важно,
// важно лишь, что она ещё на земле: поднять одну вещь в двух копиях причала разом выйдет только у одного — false у второго.
export async function claimItem(db: Db, to: string, at: Stored): Promise<boolean> {
  const rows = await db.update(items).set({ playerId: to, x: at.x, y: at.y, rot: at.rot, held: !!at.held, leftHand: !!at.held && !!at.left, ground: false, lit: false, fish: '' })
    .where(and(eq(items.id, at.id), eq(items.ground, true))).returning({ id: items.id });
  return rows.length > 0;
}

// Зажечь или погасить лампу на земле — это может любой, кто рядом.
export async function lightItem(db: Db, id: number, lit: boolean): Promise<void> {
  await db.update(items).set({ lit }).where(and(eq(items.id, id), eq(items.ground, true)));
}

// В ведро на земле легла рыба: его хвосты (fish) — последние рыбы того, кто рыбачит рядом.
export async function fishItem(db: Db, id: number, fish: string): Promise<void> {
  await db.update(items).set({ fish }).where(and(eq(items.id, id), eq(items.ground, true)));
}
