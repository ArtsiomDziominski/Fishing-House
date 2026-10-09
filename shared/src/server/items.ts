// Вещи игрока — в базе: загрузить (новому игроку — со стартовым набором), положить новую, записать места и что в руке.
// Рыба из ведра — тоже вещь (fish, fish-fried): её вид лежит в items.fish, а в улове (catches) она отмечена gone.
// Земля общая: вещи на ней (items.ground) принадлежат тому, кто их выложил, пока их не поднимет кто-нибудь — тогда у вещи
// меняется хозяин. Рыбу можно положить в холодильник в доме (items.fridge): там у каждого своя полка. Можно ли так сделать, проверяет игровой сервер по правилам ITEMS (shared/src/items.ts); здесь только запись.

import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { ITEMS, type GroundItem, type Item, type ItemKind, type Place } from '../items.ts';
import { FRIDGE } from '../indoor.ts';
import type { Db } from './db.ts';
import { catches, items, players } from './schema.ts';

const columns = { id: items.id, kind: items.kind, x: items.x, y: items.y, rot: items.rot };
// Вещь и где она: held — в руке (тогда x, y, rot — где она лежала в рюкзаке до того, left — в левой ли). Иначе — лежит в рюкзаке.
export type Stored = Item & { held?: boolean };
// Вещь на земле и кто её выложил (owner — публичный id игрока); у банки червей — сколько в ней (worms): поднявшему она достанется такой же.
export type Dropped = GroundItem & { owner: string; worms?: number };

// Вещи игрока в том порядке, в каком он их получал: list — в рюкзаке, hands — в руках. Выложенных на землю здесь нет —
// они в loadGround. Кто ещё не получал стартовый набор, получает его здесь же: отметка kit и сами вещи пишутся одной
// транзакцией, так что две вкладки разом набор не задвоят.
// Хватает ли рук на всё, что отмечено «в руках», решает игровой сервер.
export async function loadItems(db: Db, pid: string): Promise<{ list: Item[]; hands: Item[] }> {
  const rows = await db.transaction(async tx => {
    const [fresh] = await tx.update(players).set({ kit: true }).where(and(eq(players.id, pid), eq(players.kit, false))).returning({ id: players.id });
    if (fresh) await tx.insert(items).values(ITEMS.STARTER.map(({ left, ...it }) => ({ playerId: pid, ...it, leftHand: !!left })));
    return tx.select({ ...columns, held: items.held, left: items.leftHand, fish: items.fish, worms: items.worms }).from(items).where(and(eq(items.playerId, pid), eq(items.ground, false), eq(items.fridge, false))).orderBy(asc(items.id));
  });
  const list: Item[] = [], hands: Item[] = [];
  for (const { held, left, fish, worms, ...row } of rows) {
    if (!ITEMS.isKind(row.kind)) continue;
    const it = (ITEMS.isFish(row.kind) ? { ...row, fish } : ITEMS.isBait(row.kind) ? { ...row, worms } : row) as Item;
    if (held) hands.push({ ...it, left }); else list.push(it);
  }
  return { list, hands };
}

// Всё, что лежит на земле, — у всех игроков разом: его видят во всех копиях причала, даже когда хозяина нет в игре.
export async function loadGround(db: Db): Promise<Dropped[]> {
  const rows = await db.select({ id: items.id, kind: items.kind, x: items.x, y: items.y, lit: items.lit, fish: items.fish, owner: items.playerId, worms: items.worms }).from(items).where(eq(items.ground, true)).orderBy(asc(items.id));
  const out: Dropped[] = [];
  for (const { worms, ...r } of rows) if (ITEMS.isKind(r.kind)) out.push({ ...r, kind: r.kind, ...(ITEMS.isBait(r.kind) && { worms }) });
  return out;
}

export async function addItem(db: Db, pid: string, kind: ItemKind, at: Place): Promise<Item> {
  const [row] = await db.insert(items).values({ playerId: pid, kind, ...at }).returning({ ...columns, worms: items.worms });
  const { worms, ...it } = row!;
  return (ITEMS.isBait(kind) ? { ...it, worms } : it) as Item;
}

// Сколько теперь червей в банке игрока: рыба клюнула или он накопал ещё (WORMS).
export async function setWorms(db: Db, pid: string, id: number, n: number): Promise<void> {
  await db.update(items).set({ worms: n }).where(and(eq(items.id, id), eq(items.playerId, pid)));
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
// Хвосты над ведром остаются на земле, а вид рыбы (fish, fish-fried) уходит вместе с ней.
export async function claimItem(db: Db, to: string, at: Stored): Promise<boolean> {
  const fish = sql`CASE WHEN ${items.kind} IN ('fish', 'fish-fried') THEN ${items.fish} ELSE '' END`;
  const rows = await db.update(items).set({ playerId: to, x: at.x, y: at.y, rot: at.rot, held: !!at.held, leftHand: !!at.held && !!at.left, ground: false, lit: false, fish })
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

// Достать рыбу вида species из ведра в руку (left — в левую): самую мелкую из тех, что ещё в ведре, — крупные пусть остаются
// рекордами. В улове она отмечается gone, а в руке появляется вещь fish. Одной транзакцией: две вкладки одну рыбу не вынут.
// null — такой рыбы в ведре нет.
export async function takeFish(db: Db, pid: string, species: string, left: boolean): Promise<Item | null> {
  return db.transaction(async tx => {
    const [c] = await tx.select({ id: catches.id }).from(catches)
      .where(and(eq(catches.playerId, pid), eq(catches.species, species), eq(catches.gone, false)))
      .orderBy(asc(catches.grams), asc(catches.id)).limit(1).for('update', { skipLocked: true });
    if (!c) return null;
    await tx.update(catches).set({ gone: true }).where(eq(catches.id, c.id));
    const [row] = await tx.insert(items).values({ playerId: pid, kind: 'fish', fish: species, x: 0, y: 0, held: true, leftHand: left }).returning(columns);
    return { ...row, fish: species, left } as Item;
  });
}

// Рыба в руках пожарилась у костра.
export async function cookItems(db: Db, pid: string, ids: number[]): Promise<void> {
  if (ids.length) await db.update(items).set({ kind: 'fish-fried' }).where(and(inArray(items.id, ids), eq(items.playerId, pid), eq(items.kind, 'fish')));
}

// Рыбу съели — вещи больше нет.
export async function eatItem(db: Db, pid: string, id: number): Promise<void> {
  await db.delete(items).where(and(eq(items.id, id), eq(items.playerId, pid)));
}

// Рыбу с земли унесла чайка, съел кот или она растаяла (SCRAPS) — вещи больше нет. Только пока она лежит на земле:
// подняли — она уже чья-то в руке или в рюкзаке, и её не трогаем.
export async function scrapItem(db: Db, id: number): Promise<void> {
  await db.delete(items).where(and(eq(items.id, id), eq(items.ground, true), inArray(items.kind, ['fish', 'fish-fried'])));
}

// ---------- холодильник (FRIDGE) ----------

// Рыба на полке игрока в холодильнике: номер вещи, сырая или жареная (kind) и её вид (fish). По порядку, как клали.
export type Chilled = { id: number; kind: 'fish' | 'fish-fried'; fish: string };

export async function loadFridge(db: Db, pid: string): Promise<Chilled[]> {
  const rows = await db.select({ id: items.id, kind: items.kind, fish: items.fish }).from(items).where(and(eq(items.playerId, pid), eq(items.fridge, true))).orderBy(asc(items.id));
  return rows.filter((r): r is Chilled => ITEMS.isFish(r.kind));
}

// Рыбу из руки — в холодильник. Только свою, только рыбу и только пока она в руке: так её не положить дважды из двух вкладок.
export async function fridgePut(db: Db, pid: string, id: number): Promise<boolean> {
  const rows = await db.update(items).set({ fridge: true, held: false, leftHand: false, x: 0, y: 0, rot: false })
    .where(and(eq(items.id, id), eq(items.playerId, pid), eq(items.held, true), inArray(items.kind, ['fish', 'fish-fried']))).returning({ id: items.id });
  return rows.length > 0;
}

// Рыбу из холодильника — в руку left. Только пока она ещё там: две вкладки одну рыбу не вынут.
export async function fridgeTake(db: Db, pid: string, id: number, left: boolean): Promise<boolean> {
  const rows = await db.update(items).set({ fridge: false, held: true, leftHand: left })
    .where(and(eq(items.id, id), eq(items.playerId, pid), eq(items.fridge, true))).returning({ id: items.id });
  return rows.length > 0;
}

// Переложить улов из ведра в холодильник: сколько влезет до FRIDGE.MAX, начиная с крупных — мелочь пусть лежит в ведре
// под рукой. В улове рыба отмечается gone, на полке появляются вещи fish. Одной транзакцией. Возвращает, сколько переложено.
export async function fridgeStock(db: Db, pid: string): Promise<number> {
  return db.transaction(async tx => {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(items).where(and(eq(items.playerId, pid), eq(items.fridge, true)));
    const room = FRIDGE.MAX - n;
    if (room <= 0) return 0;
    const got = await tx.select({ id: catches.id, species: catches.species }).from(catches)
      .where(and(eq(catches.playerId, pid), eq(catches.gone, false)))
      .orderBy(sql`${catches.grams} desc`, asc(catches.id)).limit(room).for('update', { skipLocked: true });
    if (!got.length) return 0;
    await tx.update(catches).set({ gone: true }).where(inArray(catches.id, got.map(c => c.id)));
    await tx.insert(items).values(got.map(c => ({ playerId: pid, kind: 'fish', fish: c.species, x: 0, y: 0, fridge: true })));
    return got.length;
  });
}
