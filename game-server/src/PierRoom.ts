// Комната-причал: общий мир на ROOM_SIZE игроков. Когда она полна, матчмейкер Colyseus открывает ещё одну.
//
// Кто здесь главный:
// - ходит клиент сам (так нет задержки), а сервер проверяет каждый шаг: в проходимую ли клетку и не быстрее ли, чем можно;
//   не принял — шлёт игроку «self», и тот встаёт туда, где сервер его видит;
// - рыбалку ведёт только сервер: когда клюёт, кто клюнул, успел ли подсечь. Клиент шлёт лишь нажатия;
// - улов пишется в базу сразу при подсечке, место героя, ведра и рюкзака — при выходе и раз в минуту;
// - вещи в рюкзаке перекладывает тоже сервер, и в руку их берёт он же: проверяет по ITEMS, что вещь встаёт, и пишет
//   в базу по очереди (writes).

import { Room, definePlugins, type Client } from 'colyseus';
import { UniqueSessionPlugin } from 'colyseus/plugins/unique-session';
import { z } from 'zod';
import {
  World, FISH, ITEMS, DIRS, PACK_KINDS, ITEM_KINDS, WEATHERS, ROOM_SIZE, SPEED, RUN, REACH, PUT_REACH, nearFire, faceFire, NEAR_PIER, HOOK_GRACE,
  createFishing, addToBag, nearSeat, bucketNearSeat, standPoint, startState, packInReach, dist, seat,
  type Bag, type Fishing, type FishingEvent, type Item, type ItemKind, type ServerMessages, type WorldState,
} from '@fh/shared';
import { verifyTicket, loadPlayer, saveWorld, recordCatch, loadItems, addItem, placeItems, dropItem, type Stored, type Ticket } from '@fh/shared/server';
import { db } from './db.ts';
import { Sky } from './sky.ts';
import { PierState, PlayerState } from './state.ts';

const TICK = 50;                    // мс между шагами симуляции (рыбалка, запас хода)
const PATCH = 100;                  // мс между рассылками состояния: 10 раз в секунду хватает спокойной игре
const AUTOSAVE = 60_000;            // мс между сохранениями места героя в базу
const RECONNECT = 20;               // секунд ждём игрока, у которого оборвалась связь
const SLACK = 4;                    // арт-пикселей прощаем на округления и рывки сети
const BUDGET_MAX = 26 * RUN;        // запас хода копится, пока сообщения идут пачкой, но не больше этого

interface Session {
  pid: string;
  name: string;
  world: WorldState;                // где игрок на самом деле — по мнению сервера
  bag: Bag;
  items: Item[];                    // вещи в рюкзаке — по мнению сервера
  hand: Item | null;                // вещь в руке; её x, y, rot — где она лежала в рюкзаке
  ground: Item | null;              // вещь на земле (лампа); её x, y — место на карте
  unsynced: Set<number>;            // вещи, которые при входе пришлось переложить, а в базе они ещё на старом месте
  writes: Promise<unknown>;         // очередь записей вещей в базу: по одной, в том порядке, в каком игрок их делал
  fishing: Fishing;
  view: PlayerState;                // то, что видят другие
  budget: number;                   // сколько ещё можно пройти, арт-пикселей
  dirty: boolean;                   // место изменилось с прошлого сохранения
}

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const moveMsg = point.extend({ dir: z.enum(DIRS) });
const sitMsg = z.object({ put: point.optional() }).optional();
const packKindMsg = z.object({ kind: z.enum(PACK_KINDS) });
const cell = z.number().int().min(0).max(63);
const itemMoveMsg = z.object({ id: z.number().int(), x: cell, y: cell, rot: z.boolean() });
const itemDropMsg = z.object({ id: z.number().int() });
const itemTakeMsg = z.object({ id: z.number().int() });
const itemStowMsg = z.object({ at: z.object({ x: cell, y: cell, rot: z.boolean() }).nullable() });
const itemGiveMsg = z.object({ kind: z.enum(ITEM_KINDS) });
const lampMsg = z.object({ on: z.boolean() });
const clockMsg = z.object({ hour: z.number().min(0).max(24).nullable() });
const weatherMsg = z.object({ kind: z.enum(WEATHERS).nullable(), wind: z.boolean().nullable() });

type Auth = Ticket & { id: string };

export class PierRoom extends Room<{ state: PierState; client: Client<{ auth: Auth }> }> {
  maxClients = ROOM_SIZE;
  maxMessagesPerSecond = 40;
  state = new PierState();
  plugins = definePlugins({
    // Один игрок — одна вкладка: при входе со второй первая отключается (с причиной «replaced»).
    // Сессии игрока Colyseus находит по auth.id — его выставляет onAuth.
    unique: new UniqueSessionPlugin({ onDuplicate: 'replace' }),
  });

  private sessions = new Map<string, Session>();
  private unsaved = 0;                // счётчик временных (отрицательных) id вещей, ещё не записанных в базу
  private offSky = () => {};          // отписка от часов и погоды причала

  onCreate() {
    this.setPatchRate(PATCH);
    // Сменилась погода или часы причала перевели (в разработке) — сообщаем сразу всем, кто в комнате.
    this.offSky = Sky.onChange(what => { if (what === 'clock') this.broadcast('clock', Sky.clock()); else this.broadcast('weather', Sky.weather()); });
    this.onMessage('clock', clockMsg, (_client, m) => { if (Sky.canSet) Sky.setHour(m.hour); });
    this.onMessage('weather', weatherMsg, (_client, m) => { if (Sky.canSet) Sky.setWeather(m.kind, m.wind); });
    this.setSimulationInterval(dt => this.tick(dt / 1000), TICK);
    this.clock.setInterval(() => this.saveAll(false), AUTOSAVE);

    this.onMessage('move', moveMsg, (client, m) => this.move(client, m.x, m.y, m.dir));
    this.onMessage('sit', sitMsg, (client, m) => this.sit(client, m?.put));
    this.onMessage('rest', client => this.rest(client));
    this.onMessage('stand', client => this.withSession(client, s => this.standUp(s)));
    this.onMessage('pick', client => this.pick(client));
    this.onMessage('put', point, (client, m) => this.put(client, m.x, m.y));
    this.onMessage('press', client => this.withSession(client, s => { if (s.world.sitting) s.fishing.press(); }));
    this.onMessage('packOn', client => this.packOn(client));
    this.onMessage('packOff', point, (client, m) => this.packOff(client, m.x, m.y));
    this.onMessage('packKind', packKindMsg, (client, m) => this.packKind(client, m.kind));
    this.onMessage('itemMove', itemMoveMsg, (client, m) => this.itemMove(client, m.id, m.x, m.y, m.rot));
    this.onMessage('itemDrop', itemDropMsg, (client, m) => this.itemDrop(client, m.id));
    this.onMessage('itemTake', itemTakeMsg, (client, m) => this.itemTake(client, m.id));
    this.onMessage('itemStow', itemStowMsg, (client, m) => this.itemStow(client, m.at));
    this.onMessage('itemPut', point, (client, m) => this.itemPut(client, m.x, m.y));
    this.onMessage('itemPick', client => this.itemPick(client));
    this.onMessage('lamp', lampMsg, (client, m) => this.lamp(client, m.on));
    this.onMessage('itemGive', itemGiveMsg, (client, m) => { if (Sky.canSet) this.itemGive(client, m.kind); });
  }

  // Билет выдаёт сайт после входа (POST /api/game/ticket); без него в комнату не пустит.
  onAuth(_client: Client, options: { ticket?: unknown }): Auth {
    const ticket = verifyTicket(options?.ticket);
    if (!ticket) throw new Error('Билет недействителен — войдите заново');
    return { ...ticket, id: ticket.pid };
  }

  async onJoin(client: Client<{ auth: Auth }>, _options: unknown, auth: Auth) {
    const saved = await loadPlayer(db, auth.pid);
    if (!saved) throw new Error('Игрок не найден');
    const world = saved.world || startState();
    // вещи — в сетку нынешнего рюкзака. Кого пришлось переложить, тех в базе не трогаем, пока игрок сам не возьмётся
    // за рюкзак: вдруг запись мира отстала (вкладку перезагрузили, а прежний вход ещё сохраняется) и разложено всё верно
    const stored = await loadItems(db, auth.pid), packed = ITEMS.settle(ITEMS.grid(world.pack.kind), stored.list);
    // вещь на земле: карту могли перестроить, и её место оказалось в лесу или в воде — тогда она встаёт на ближайшую траву
    const out = stored.ground, at = out && (World.canWalk(out.x, out.y) ? out : World.nearestWalkable(out.x, out.y) || World.nearestWalkable(world.x, world.y) || world);
    const ground = out && at ? { ...out, x: Math.round(at.x), y: Math.round(at.y), rot: false } : null;
    const view = new PlayerState();
    view.pid = saved.id; view.name = saved.name;
    const s: Session = {
      pid: saved.id, name: saved.name, world, bag: saved.bag, items: packed.list, hand: stored.hand, ground, unsynced: new Set(packed.moved.map(it => it.id)), writes: Promise.resolve(), view, budget: BUDGET_MAX, dirty: false,
      fishing: createFishing({ hasBucket: () => bucketNearSeat(s.world.bucket), emit: ev => this.onFishing(client, s, ev), grace: HOOK_GRACE }),
    };
    if (world.sitting) s.fishing.sit();
    this.sessions.set(client.sessionId, s);
    this.syncView(s);
    this.state.players.set(client.sessionId, view);
    this.tell(client, 'clock', Sky.clock());           // время суток клиент считает сам, но по часам причала
    this.tell(client, 'weather', Sky.weather());
    this.tell(client, 'self', world);
    this.tell(client, 'bag', s.bag);
    this.tellItems(client, s);
  }

  // Связь оборвалась сама — держим героя на месте, пока клиент переподключается.
  async onDrop(client: Client, code?: number) {
    if (code === 1001 || code === 1005 || code === 1006) await this.allowReconnection(client, RECONNECT).catch(() => {});
  }

  async onLeave(client: Client) {
    const s = this.sessions.get(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (s) await Promise.all([this.save(s, true), s.writes]);
  }

  async onDispose() { this.offSky(); await this.saveAll(true); }

  // ---------- действия игрока ----------

  private withSession(client: Client, fn: (s: Session) => void) {
    const s = this.sessions.get(client.sessionId);
    if (s) fn(s);
  }
  private reject(client: Client, s: Session) { this.tell(client, 'self', s.world); }
  // Вещи игрока целиком: что в рюкзаке и что в руке; note — почему не вышло то, о чём он просил.
  private tellItems(client: Client, s: Session, note?: ServerMessages['items']['note']) { this.tell(client, 'items', { list: s.items, hand: s.hand, ground: s.ground, ...(note && { note }) }); }

  private move(client: Client, x: number, y: number, dir: WorldState['dir']) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, d = dist(w, { x, y });
    if (w.sitting || !World.canWalk(x, y) || d > s.budget + SLACK) { this.reject(client, s); return; }
    s.budget = Math.max(0, s.budget - d);
    w.x = x; w.y = y; w.dir = dir; w.rest = false; s.dirty = true;   // пошёл — значит, встал от костра
    this.syncView(s);
  }

  // put — куда герой ставит ведро, если садится с ним в руке.
  private sit(client: Client, put?: { x: number; y: number }) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.sitting) return;
    if (dist(w, seat) > seat.r + SLACK) { this.reject(client, s); return; }
    if (w.bucket.carried) {
      if (!put || dist(put, seat) > NEAR_PIER || !World.canWalk(put.x, put.y)) { this.reject(client, s); return; }
      w.bucket = { x: Math.round(put.x), y: Math.round(put.y), carried: false, home: false };
    }
    w.sitting = true; w.x = seat.x; w.y = seat.y; s.dirty = true;
    s.fishing.sit();
    this.syncView(s);
  }

  // У костра садятся прямо там, где стоят, лицом к огню; ведро, если оно в руке, остаётся в руке.
  private rest(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.sitting || w.rest) return;
    if (!nearFire(w)) { this.reject(client, s); return; }
    w.rest = true; w.dir = faceFire(w);
    this.syncView(s);
  }

  private standUp(s: Session) {
    if (s.world.rest) { s.world.rest = false; this.syncView(s); return; }
    if (!s.world.sitting) return;
    s.fishing.leave();
    const p = standPoint();
    Object.assign(s.world, { sitting: false, x: p.x, y: p.y, dir: 'down' });
    s.budget = BUDGET_MAX; s.dirty = true;
    this.syncView(s);
  }

  private pick(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.sitting || w.bucket.carried || dist(w, w.bucket) > REACH + SLACK) { this.reject(client, s); return; }
    w.bucket.carried = true; w.bucket.home = false; s.dirty = true;
    this.syncView(s);
  }

  private put(client: Client, x: number, y: number) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (!w.bucket.carried || dist(w, { x, y }) > PUT_REACH || !World.canWalk(x, y)) { this.reject(client, s); return; }
    w.bucket = { x: Math.round(x), y: Math.round(y), carried: false, home: false }; s.dirty = true;
    this.syncView(s);
  }

  // Рюкзак надевают стоя рядом с ним, снимают — на землю возле себя. Сидя он остаётся там, где был: на спине или на земле.
  private packOn(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.sitting || w.pack.worn || dist(w, w.pack) > REACH + SLACK) { this.reject(client, s); return; }
    w.pack.worn = true; s.dirty = true;
    this.syncView(s);
  }

  private packOff(client: Client, x: number, y: number) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.sitting || !w.pack.worn || dist(w, { x, y }) > PUT_REACH || !World.canWalk(x, y)) { this.reject(client, s); return; }
    w.pack = { x: Math.round(x), y: Math.round(y), worn: false, kind: w.pack.kind }; s.dirty = true;
    this.syncView(s);
  }

  // Другой рюкзак: вещи должны в него влезть. Тесно — оставляем прежний («self») и говорим почему; влезли, но не на
  // свои места — раскладываем заново и присылаем, где они теперь.
  private packKind(client: Client, kind: WorldState['pack']['kind']) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (s.world.pack.kind === kind) return;
    const list = ITEMS.repack(ITEMS.grid(kind), s.items);
    if (!list) { this.reject(client, s); this.tellItems(client, s, 'tight'); return; }
    const was = new Map(s.items.map(it => [it.id, it]));
    const moved = list.filter(it => { const o = was.get(it.id)!; return o.x !== it.x || o.y !== it.y || o.rot !== it.rot; });
    s.items = list.sort((a, b) => a.id - b.id);
    if (moved.length) { this.place(s, moved); this.tellItems(client, s); }
    s.world.pack.kind = kind; s.dirty = true;
    this.syncView(s);
    void this.save(s, true);           // вид рюкзака — сразу: по нему при следующем входе раскладываются вещи
  }

  // ---------- вещи в рюкзаке ----------

  // Переложить вещь можно, только заглянув в рюкзак: он на спине или рядом. Не встаёт — присылаем, как всё лежит на самом деле.
  private itemMove(client: Client, id: number, x: number, y: number, rot: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const it = s.items.find(i => i.id === id);
    if (!it) { this.tellItems(client, s); return; }
    if (!packInReach(s.world, s.world.pack, SLACK)) { this.tellItems(client, s, 'far'); return; }
    rot = rot && ITEMS.turns(it.kind);
    if (!ITEMS.fits(ITEMS.grid(s.world.pack.kind), s.items, it.kind, x, y, rot, it.id)) { this.tellItems(client, s); return; }
    if (it.x === x && it.y === y && it.rot === rot) return;
    it.x = x; it.y = y; it.rot = rot;
    this.place(s, [it]);
  }

  // Выбросить вещь: из рюкзака — заглянув в него, из руки — где угодно.
  private itemDrop(client: Client, id: number) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (s.hand?.id === id) {
      s.hand = null;
      this.syncView(s);
      this.write(s, () => dropItem(db, s.pid, id));
      return;
    }
    const i = s.items.findIndex(it => it.id === id);
    if (i < 0) { this.tellItems(client, s); return; }
    if (!packInReach(s.world, s.world.pack, SLACK)) { this.tellItems(client, s, 'far'); return; }
    s.items.splice(i, 1);
    this.syncView(s);                                   // выложил лампу — свет погас
    this.write(s, () => dropItem(db, s.pid, id));
  }

  // Взять вещь из рюкзака в руку (рюкзак на спине или рядом). Что было в руке, уходит в рюкзак; некуда — отказ.
  // Вещь, которая ещё пишется в базу (id отрицательный), в руку не берём: её номер пока никто не знает.
  private itemTake(client: Client, id: number) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (!packInReach(s.world, s.world.pack, SLACK)) { this.tellItems(client, s, 'far'); return; }
    const found = s.items.some(it => it.id === id);
    const r = id > 0 ? ITEMS.take(ITEMS.grid(s.world.pack.kind), s.items, s.hand, id) : null;
    if (!r) { this.tellItems(client, s, found && id > 0 ? 'full' : undefined); return; }
    s.items = r.list; s.hand = r.hand;
    this.syncView(s);
    this.place(s, [{ ...r.hand, held: true }, ...(r.back ? [r.back] : [])]);
    if (r.back) this.tellItems(client, s);              // куда встала прежняя вещь из руки, решили мы — пусть клиент сверится
  }

  // Убрать вещь из руки в рюкзак: в названную клетку или на свободное место.
  private itemStow(client: Client, at: { x: number; y: number; rot: boolean } | null) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (!s.hand) { this.tellItems(client, s); return; }
    if (!packInReach(s.world, s.world.pack, SLACK)) { this.tellItems(client, s, 'far'); return; }
    const r = ITEMS.stow(ITEMS.grid(s.world.pack.kind), s.items, s.hand, at);
    if (!r) { this.tellItems(client, s, at ? undefined : 'full'); return; }
    s.items = r.list; s.hand = null;
    this.syncView(s);
    this.place(s, [r.item]);
  }

  // Поставить вещь из руки на землю рядом с собой. Пока это только лампа, и стоять на земле может одна.
  private itemPut(client: Client, x: number, y: number) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, it = s.hand;
    if (!it || !ITEMS.stands(it.kind) || s.ground || it.id < 0 || w.sitting || dist(w, { x, y }) > PUT_REACH || !World.canWalk(x, y)) { this.tellItems(client, s); return; }
    s.ground = { ...it, x: Math.round(x), y: Math.round(y), rot: false }; s.hand = null;
    this.syncView(s);
    this.place(s, [{ ...s.ground, ground: true }]);
  }

  // Взять свою вещь с земли, стоя рядом: в руку, а если рука занята — в рюкзак, когда он под рукой и в нём есть место.
  private itemPick(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, it = s.ground;
    if (!it || w.sitting || dist(w, it) > REACH + SLACK) { this.tellItems(client, s); return; }
    if (!s.hand) {
      s.hand = { ...it, x: 0, y: 0 }; s.ground = null;   // где она лежала в рюкзаке, уже не вспомнить — вернётся на свободное место
      this.syncView(s);
      this.place(s, [{ ...s.hand, held: true }]);
      return;
    }
    const at = packInReach(w, w.pack, SLACK) ? ITEMS.spot(ITEMS.grid(w.pack.kind), s.items, it.kind) : null;
    if (!at) { this.tellItems(client, s, 'busy'); return; }
    const back = { ...it, ...at };
    s.items.push(back); s.ground = null;
    this.syncView(s);
    this.place(s, [back]);
    this.tellItems(client, s);                          // куда легла вещь, решили мы
  }

  // Лампу зажигают и гасят, когда она под рукой: в руке или стоит на земле рядом. В рюкзаке она не горит вовсе.
  // Нет лампы или далеко — молчим: кнопки у игрока тогда и нет.
  private lamp(client: Client, on: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (!ITEMS.lampNear(s.world, s.hand, s.ground, SLACK) || s.world.lamp === on) return;
    s.world.lamp = on; s.dirty = true;
    this.syncView(s);
    void this.save(s, true);           // сразу: лампа на земле должна гореть и после перезахода, а место героя пишется лишь раз в минуту
  }

  // Новая вещь — на первое свободное место. Пока строка пишется в базу, место уже занято (id пока отрицательный),
  // чтобы туда ничего не переложили; номер из базы — и игроку приходит рюкзак целиком.
  private itemGive(client: Client, kind: ItemKind) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const at = ITEMS.spot(ITEMS.grid(s.world.pack.kind), s.items, kind);
    if (!at) { this.tellItems(client, s, 'full'); return; }
    const it: Item = { id: -++this.unsaved, kind, ...at };
    s.items.push(it);
    this.syncView(s);
    this.write(s, async () => {
      try { it.id = (await addItem(db, s.pid, kind, { x: it.x, y: it.y, rot: it.rot })).id; }
      catch (err) { s.items = s.items.filter(o => o !== it); this.syncView(s); throw err; }
      finally { if (this.sessions.get(client.sessionId) === s) this.tellItems(client, s); }
    });
  }

  // Записать места этих вещей, а заодно и тех, кого переложили при входе (unsynced): игрок их видел и раз уж взялся
  // за рюкзак — согласен с тем, как они лежат.
  private place(s: Session, list: Stored[]) {
    const ids = new Set(list.map(it => it.id));
    const all: Stored[] = [...list, ...s.items.filter(it => s.unsynced.has(it.id) && !ids.has(it.id))].map(it => ({ ...it }));
    s.unsynced.clear();
    this.write(s, () => placeItems(db, s.pid, all));
  }

  // Записи вещей в базу идут друг за другом: две быстрые перекладки одной вещи не обгонят одна другую.
  private write(s: Session, op: () => Promise<unknown>) {
    s.writes = s.writes.then(op).catch(err => console.error(`вещи игрока ${s.pid} не записаны:`, err));
  }

  // ---------- рыбалка ----------

  private onFishing(client: Client, s: Session, ev: FishingEvent) {
    if (ev.e !== 'hook') { this.tell(client, 'fish', ev); return; }
    const fish = ev.fish;
    addToBag(s.bag, fish);
    this.tell(client, 'fish', { ...ev, bag: s.bag });
    this.syncView(s);
    recordCatch(db, s.pid, fish).catch(err => console.error(`улов ${s.pid} ${fish.id} ${fish.grams} г не записан:`, err));
  }

  private tick(dt: number) {
    for (const s of this.sessions.values()) {
      s.fishing.update(dt);
      s.budget = Math.min(BUDGET_MAX, s.budget + SPEED * RUN * 1.25 * dt);
    }
  }

  // ---------- состояние и база ----------

  private syncView(s: Session) {
    const w = s.world, v = s.view;
    v.x = w.x; v.y = w.y; v.dir = w.dir; v.sitting = w.sitting; v.rest = w.rest;
    v.carrying = w.bucket.carried; v.bx = w.bucket.x; v.by = w.bucket.y; v.bucketHome = w.bucket.home;
    v.wearing = w.pack.worn; v.px = w.pack.x; v.py = w.pack.y; v.pack = w.pack.kind;
    v.hand = s.hand?.kind ?? '';
    v.ground = s.ground?.kind ?? ''; v.gx = s.ground?.x ?? 0; v.gy = s.ground?.y ?? 0;
    v.lamp = w.lamp && ITEMS.lampOut(s.hand, s.ground);
    const recent = s.bag.recent.filter(id => FISH.byId[id]);
    if (v.recent.length !== recent.length || recent.some((id, i) => v.recent[i] !== id)) {
      v.recent.clear(); for (const id of recent) v.recent.push(id);
    }
  }

  private async save(s: Session, force: boolean) {
    if (!s.dirty && !force) return;
    s.dirty = false;
    try { await saveWorld(db, s.pid, { ...s.world, bucket: { ...s.world.bucket }, pack: { ...s.world.pack } }); }
    catch (err) { s.dirty = true; console.error(`не сохранилось место игрока ${s.pid}:`, err); }
  }
  private async saveAll(force: boolean) { await Promise.all([...this.sessions.values()].map(s => this.save(s, force))); }

  private tell<K extends keyof ServerMessages>(client: Client, type: K, message: ServerMessages[K]) { client.send(type, message); }
}
