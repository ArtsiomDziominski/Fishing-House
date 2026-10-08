// Вещи игрока — в базе: загрузить (новому игроку — со стартовым набором), положить новую, записать места и что в руке, выбросить.
// Можно ли так сделать, проверяет игровой сервер по правилам ITEMS (shared/src/items.ts); здесь только запись.

import { and, asc, eq } from 'drizzle-orm';
import { ITEMS, type Item, type ItemKind, type Place } from '../items.ts';
import type { Db } from './db.ts';
import { items, players } from './schema.ts';

const columns = { id: items.id, kind: items.kind, x: items.x, y: items.y, rot: items.rot };
// Вещь и где она: held — в руке (тогда x, y, rot — где она лежала в рюкзаке до того), ground — стоит на земле
// (x, y — место на карте). Ни то ни другое — лежит в рюкзаке.
export type Stored = Item & { held?: boolean; ground?: boolean };

// Вещи игрока в том порядке, в каком он их получал: list — в рюкзаке, hands — в руках, ground — на земле. Кто ещё не получал
// стартовый набор, получает его здесь же: отметка kit и сами вещи пишутся одной транзакцией, так что две вкладки разом
// набор не задвоят. На земле одна вещь; окажись в базе отмечено больше, остальные считаются лежащими в рюкзаке.
// Хватает ли рук на всё, что отмечено «в руках», решает игровой сервер: он знает и про ведро.
export async function loadItems(db: Db, pid: string): Promise<{ list: Item[]; hands: Item[]; ground: Item | null }> {
  const rows = await db.transaction(async tx => {
    const [fresh] = await tx.update(players).set({ kit: true }).where(and(eq(players.id, pid), eq(players.kit, false))).returning({ id: players.id });
    if (fresh) await tx.insert(items).values(ITEMS.STARTER.map(it => ({ playerId: pid, ...it })));
    return tx.select({ ...columns, held: items.held, out: items.ground }).from(items).where(eq(items.playerId, pid)).orderBy(asc(items.id));
  });
  const list: Item[] = [], hands: Item[] = []; let ground: Item | null = null;
  for (const { held, out, ...it } of rows) {
    if (!ITEMS.isKind(it.kind)) continue;
    if (out && !ground && ITEMS.stands(it.kind)) ground = it as Item;
    else (held ? hands : list).push(it as Item);
  }
  return { list, hands, ground };
}

export async function addItem(db: Db, pid: string, kind: ItemKind, at: Place): Promise<Item> {
  const [row] = await db.insert(items).values({ playerId: pid, kind, ...at }).returning(columns);
  return row as Item;
}

// Записать, где теперь эти вещи: в какой клетке рюкзака, в руке или на земле (переложили одну, взяли в руку, поставили, разложили весь рюкзак заново).
// Всё одной транзакцией: вещь из руки и вещь, занявшая её место, не разойдутся.
export async function placeItems(db: Db, pid: string, list: readonly Stored[]): Promise<void> {
  if (!list.length) return;
  await db.transaction(async tx => {
    for (const it of list) await tx.update(items).set({ x: it.x, y: it.y, rot: it.rot, held: !!it.held, ground: !!it.ground }).where(and(eq(items.id, it.id), eq(items.playerId, pid)));
  });
}

// Вещь переходит к другому игроку — он взял её с земли: меняется хозяин и сразу пишется, где она у нового.
export async function passItem(db: Db, from: string, to: string, it: Stored): Promise<void> {
  await db.update(items).set({ playerId: to, x: it.x, y: it.y, rot: it.rot, held: !!it.held, ground: !!it.ground }).where(and(eq(items.id, it.id), eq(items.playerId, from)));
}

export async function dropItem(db: Db, pid: string, id: number): Promise<void> {
  await db.delete(items).where(and(eq(items.id, id), eq(items.playerId, pid)));
}
