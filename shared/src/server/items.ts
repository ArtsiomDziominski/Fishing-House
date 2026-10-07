// Вещи в рюкзаке — в базе: загрузить (новому игроку — со стартовым набором), положить новую, записать места, выбросить.
// Можно ли так сделать, проверяет игровой сервер по правилам ITEMS (shared/src/items.ts); здесь только запись.

import { and, asc, eq } from 'drizzle-orm';
import { ITEMS, type Item, type ItemKind, type Place } from '../items.ts';
import type { Db } from './db.ts';
import { items, players } from './schema.ts';

const columns = { id: items.id, kind: items.kind, x: items.x, y: items.y, rot: items.rot };

// Вещи игрока в том порядке, в каком он их получал. Кто ещё не получал стартовый набор, получает его здесь же:
// отметка kit и сами вещи пишутся одной транзакцией, так что две вкладки разом набор не задвоят.
export async function loadItems(db: Db, pid: string): Promise<Item[]> {
  const rows = await db.transaction(async tx => {
    const [fresh] = await tx.update(players).set({ kit: true }).where(and(eq(players.id, pid), eq(players.kit, false))).returning({ id: players.id });
    if (fresh) await tx.insert(items).values(ITEMS.STARTER.map(it => ({ playerId: pid, ...it })));
    return tx.select(columns).from(items).where(eq(items.playerId, pid)).orderBy(asc(items.id));
  });
  return rows.filter((r): r is Item => ITEMS.isKind(r.kind));
}

export async function addItem(db: Db, pid: string, kind: ItemKind, at: Place): Promise<Item> {
  const [row] = await db.insert(items).values({ playerId: pid, kind, ...at }).returning(columns);
  return row as Item;
}

// Записать, где лежат эти вещи (переложили одну или разложили весь рюкзак заново).
export async function placeItems(db: Db, pid: string, list: readonly Item[]): Promise<void> {
  if (!list.length) return;
  await db.transaction(async tx => {
    for (const it of list) await tx.update(items).set({ x: it.x, y: it.y, rot: it.rot }).where(and(eq(items.id, it.id), eq(items.playerId, pid)));
  });
}

export async function dropItem(db: Db, pid: string, id: number): Promise<void> {
  await db.delete(items).where(and(eq(items.id, id), eq(items.playerId, pid)));
}
