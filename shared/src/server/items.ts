// Вещи игрока — в базе: загрузить (новому игроку — со стартовым набором), положить новую, записать места и что в руке.
// Рыба из ведра — тоже вещь (fish, fish-fried): её вид лежит в items.fish, а в улове (catches) она отмечена gone.
// Улов лежит в ведре (catches.bucket_id) и переходит вместе с ним: подняли ведро — подняли и рыбу.
// Земля у каждого места своя (items.place): вещи на ней (items.ground) принадлежат тому, кто их выложил, пока их не поднимет
// кто-нибудь — тогда у вещи меняется хозяин. Рыбу можно положить в холодильник в доме (items.fridge): там у каждого своя полка;
// остальные вещи — в свой сундук в доме (items.chest, его вид — players.chest). Можно ли так сделать, проверяет игровой сервер по правилам ITEMS (shared/src/items.ts); здесь только запись.

import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm';
import { ITEMS, ITEM_KINDS, type GroundItem, type Item, type ItemKind, type Place } from '../items.ts';
import { FRIDGE } from '../indoor.ts';
import { CHESTS, type ChestKind } from '../chests.ts';
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
    return tx.select({ ...columns, held: items.held, left: items.leftHand, fish: items.fish, worms: items.worms }).from(items).where(and(eq(items.playerId, pid), eq(items.ground, false), eq(items.fridge, false), eq(items.chest, false))).orderBy(asc(items.id));
  });
  const list: Item[] = [], hands: Item[] = [];
  for (const { held, left, fish, worms, ...row } of rows) {
    if (!ITEMS.isKind(row.kind)) continue;
    const it = (ITEMS.isFish(row.kind) ? { ...row, fish } : ITEMS.isBait(row.kind) ? { ...row, worms } : row) as Item;
    if (held) hands.push({ ...it, left }); else list.push(it);
  }
  return { list, hands };
}

// Всё, что лежит на земле этого места (place), — у всех игроков разом: его видят во всех копиях причала, даже когда хозяина нет в игре.
export async function loadGround(db: Db, place: string): Promise<Dropped[]> {
  const rows = await db.select({ id: items.id, kind: items.kind, x: items.x, y: items.y, lit: items.lit, fish: items.fish, owner: items.playerId, worms: items.worms }).from(items).where(and(eq(items.ground, true), eq(items.place, place))).orderBy(asc(items.id));
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
    for (const it of list) await tx.update(items).set({ x: it.x, y: it.y, rot: it.rot, held: !!it.held, leftHand: !!it.held && !!it.left, ground: false, chest: false }).where(and(eq(items.id, it.id), eq(items.playerId, pid)));
  });
}

// Выложить свою вещь на землю места place: x, y — место на карте, lit — горит ли (лампа), fish — вид рыбы (у ведра пусто:
// что в нём — в улове).
export async function dropItem(db: Db, pid: string, it: GroundItem, place: string): Promise<void> {
  await db.update(items).set({ x: it.x, y: it.y, rot: false, held: false, leftHand: false, ground: true, chest: false, place, lit: it.lit, fish: ITEMS.isBucket(it.kind) ? '' : it.fish }).where(and(eq(items.id, it.id), eq(items.playerId, pid)));
}

// Поднять вещь с земли: она становится вещью игрока to и сразу ложится к нему в руку или в рюкзак (at). Чья она была, не важно,
// важно лишь, что она ещё на земле: поднять одну вещь в двух копиях причала разом выйдет только у одного — false у второго.
// Вид рыбы (fish, fish-fried) уходит вместе с ней, а улов в ведре — вместе с ведром (он привязан к нему, а не к игроку).
export async function claimItem(db: Db, to: string, at: Stored): Promise<boolean> {
  const rows = await db.update(items).set({ playerId: to, x: at.x, y: at.y, rot: at.rot, held: !!at.held, leftHand: !!at.held && !!at.left, ground: false, chest: false, lit: false })
    .where(and(eq(items.id, at.id), eq(items.ground, true))).returning({ id: items.id });
  return rows.length > 0;
}

// Зажечь или погасить лампу на земле — это может любой, кто рядом.
export async function lightItem(db: Db, id: number, lit: boolean): Promise<void> {
  await db.update(items).set({ lit }).where(and(eq(items.id, id), eq(items.ground, true)));
}

// Ведро bucket под рукой у игрока pid: лежит на земле (чьё угодно) или его собственное. Внутри транзакции — ведро заодно
// держится, пока она не кончится: поднять его в другой копии причала, пока из него достают рыбу, не выйдет.
async function pailFor(tx: Parameters<Parameters<Db['transaction']>[0]>[0], pid: string, bucket: number): Promise<boolean> {
  const [b] = await tx.select({ id: items.id }).from(items)
    .where(and(eq(items.id, bucket), inArray(items.kind, BUCKET_KINDS), or(eq(items.ground, true), eq(items.playerId, pid)))).for('share');
  return !!b;
}
const BUCKET_KINDS = ITEM_KINDS.filter(kind => ITEMS.isBucket(kind));

// Достать рыбу вида species из ведра bucket (на земле — чьего угодно, или своего) в руку игрока pid (left — в левую): самую
// мелкую из тех, что в нём, — крупные пусть остаются. В улове она отмечается gone, а в руке появляется вещь fish. Одной
// транзакцией: две вкладки одну рыбу не вынут. null — такой рыбы в ведре нет или ведра уже нет под рукой.
export async function takeFish(db: Db, pid: string, bucket: number, species: string, left: boolean): Promise<Item | null> {
  return db.transaction(async tx => {
    if (!await pailFor(tx, pid, bucket)) return null;
    const [c] = await tx.select({ id: catches.id }).from(catches)
      .where(and(eq(catches.bucketId, bucket), eq(catches.species, species), eq(catches.gone, false)))
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

// Пока герой спал от голода, у него украли эти вещи (из рюкзака и рук; что на земле, в холодильнике и в сундуке — не его
// забота, их не трогаем). Вещи больше нет; украли ведро — рыба в нём ни в каком ведре (catches.bucket_id обнуляется сам). Возвращает,
// какие вещи и правда пропали.
export async function robItems(db: Db, pid: string, ids: readonly number[]): Promise<number[]> {
  if (!ids.length) return [];
  const rows = await db.delete(items).where(and(inArray(items.id, [...ids]), eq(items.playerId, pid), eq(items.ground, false), eq(items.fridge, false), eq(items.chest, false))).returning({ id: items.id });
  return rows.map(r => r.id);
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

// Переложить улов из своего ведра bucket в холодильник: сколько влезет до FRIDGE.MAX, начиная с крупных — мелочь пусть
// лежит в ведре под рукой. В улове рыба отмечается gone, на полке появляются вещи fish. Одной транзакцией. Возвращает, сколько переложено.
export async function fridgeStock(db: Db, pid: string, bucket: number): Promise<number> {
  return db.transaction(async tx => {
    if (!await pailFor(tx, pid, bucket)) return 0;
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(items).where(and(eq(items.playerId, pid), eq(items.fridge, true)));
    const room = FRIDGE.MAX - n;
    if (room <= 0) return 0;
    const got = await tx.select({ id: catches.id, species: catches.species }).from(catches)
      .where(and(eq(catches.bucketId, bucket), eq(catches.gone, false)))
      .orderBy(sql`${catches.grams} desc`, asc(catches.id)).limit(room).for('update', { skipLocked: true });
    if (!got.length) return 0;
    await tx.update(catches).set({ gone: true }).where(inArray(catches.id, got.map(c => c.id)));
    await tx.insert(items).values(got.map(c => ({ playerId: pid, kind: 'fish', fish: c.species, x: 0, y: 0, fridge: true })));
    return got.length;
  });
}

// ---------- сундук (CHESTS) ----------

// Свой сундук: его вид и вещи в его сетке — по порядку, как получал.
export async function loadChest(db: Db, pid: string): Promise<{ kind: ChestKind; list: Item[] }> {
  const [row] = await db.select({ kind: players.chest }).from(players).where(eq(players.id, pid));
  const rows = await db.select({ ...columns, worms: items.worms }).from(items).where(and(eq(items.playerId, pid), eq(items.chest, true))).orderBy(asc(items.id));
  const list: Item[] = [];
  for (const { worms, ...r } of rows) if (ITEMS.isKind(r.kind)) list.push((ITEMS.isBait(r.kind) ? { ...r, worms } : r) as Item);
  return { kind: CHESTS.isKind(row?.kind) ? row.kind : CHESTS.DEFAULT, list };
}

// Свою вещь — в сундук или из сундука (chest), в эту клетку его сетки или рюкзака. Только свою и только не с земли и не
// из холодильника: так её не переложить дважды из двух вкладок. false — вещи там, откуда её брали, уже нет.
export async function chestPlace(db: Db, pid: string, it: Item, chest: boolean): Promise<boolean> {
  const rows = await db.update(items).set({ chest, x: it.x, y: it.y, rot: it.rot, held: false, leftHand: false })
    .where(and(eq(items.id, it.id), eq(items.playerId, pid), eq(items.ground, false), eq(items.fridge, false), eq(items.chest, !chest))).returning({ id: items.id });
  return rows.length > 0;
}

// Записать, где теперь эти вещи в сундуке (переложили одну или разложили весь заново под новый сундук).
export async function chestMove(db: Db, pid: string, list: readonly Item[]): Promise<void> {
  if (!list.length) return;
  await db.transaction(async tx => {
    for (const it of list) await tx.update(items).set({ x: it.x, y: it.y, rot: it.rot }).where(and(eq(items.id, it.id), eq(items.playerId, pid), eq(items.chest, true)));
  });
}

// Другой сундук.
export async function setChestKind(db: Db, pid: string, kind: ChestKind): Promise<void> {
  await db.update(players).set({ chest: kind }).where(eq(players.id, pid));
}
