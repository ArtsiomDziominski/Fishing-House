// Комната-причал: общий мир на ROOM_SIZE игроков. Когда она полна, матчмейкер Colyseus открывает ещё одну.
//
// Кто здесь главный:
// - ходит клиент сам (так нет задержки), а сервер проверяет каждый шаг: в проходимую ли клетку и не быстрее ли, чем можно;
//   не принял — шлёт игроку «self», и тот встаёт туда, где сервер его видит;
// - рыбалку ведёт только сервер: когда клюёт, кто клюнул, успел ли подсечь. Клиент шлёт лишь нажатия. Забросить можно
//   только с удочкой в руке (её берут из рюкзака) и с ведром — в руке или на земле у места рыбака;
// - улов пишется в базу сразу при подсечке, место героя и рюкзака — при выходе и раз в минуту;
// - вещи в рюкзаке перекладывает тоже сервер, и в руку их берёт он же: проверяет по ITEMS, что вещь встаёт, и пишет
//   в базу по очереди (writes);
// - земля общая для всех копий причала: что на неё выложили, видят все и поднять может любой — тогда вещь становится его.
//   Она лежит и когда хозяин ушёл из игры. Копии узнают друг от друга, что легло и что подняли, через presence (Redis).

import { Room, definePlugins, type Client } from 'colyseus';
import { UniqueSessionPlugin } from 'colyseus/plugins/unique-session';
import { z } from 'zod';
import {
  World, FISH, ITEMS, DIRS, PACK_KINDS, ITEM_KINDS, WEATHERS, ROOM_SIZE, SPEED, RUN, REACH, PUT_REACH, nearFire, faceFire, HOOK_GRACE,
  createFishing, addToBag, nearSeat, bucketNearSeat, standPoint, startState, packInReach, dist, seat,
  type Bag, type Fishing, type FishingEvent, type Item, type ItemKind, type ServerMessages, type WorldState,
} from '@fh/shared';
import { verifyTicket, loadPlayer, saveWorld, recordCatch, loadItems, loadGround, addItem, placeItems, dropItem, claimItem, lightItem, fishItem, type Dropped, type Stored, type Ticket } from '@fh/shared/server';
import { db } from './db.ts';
import { Sky } from './sky.ts';
import { GroundState, PierState, PlayerState } from './state.ts';

const TICK = 50;                    // мс между шагами симуляции (рыбалка, запас хода)
const PATCH = 100;                  // мс между рассылками состояния: 10 раз в секунду хватает спокойной игре
const AUTOSAVE = 60_000;            // мс между сохранениями места героя в базу
const RECONNECT = 20;               // секунд ждём игрока, у которого оборвалась связь
const SLACK = 4;                    // арт-пикселей прощаем на округления и рывки сети
const BUDGET_MAX = 26 * RUN;        // запас хода копится, пока сообщения идут пачкой, но не больше этого
const GROUND = 'ground';            // канал presence, по которому копии причала сообщают друг другу, что на земле

// Вещь на земле — по мнению сервера. ready — уже записана в базу: до того её не поднять (её место в базе ещё старое).
type Ground = Dropped & { ready: boolean };
// Что копии причала сообщают друг другу о земле: вещь легла, её подняли, лампу на ней зажгли или погасили, в ведро легла рыба.
type GroundNews = { e: 'put'; it: Dropped } | { e: 'gone'; id: number } | { e: 'lit'; id: number; on: boolean } | { e: 'fish'; id: number; fish: string };

interface Session {
  pid: string;
  name: string;
  world: WorldState;                // где игрок на самом деле — по мнению сервера
  bag: Bag;
  items: Item[];                    // вещи в рюкзаке — по мнению сервера
  hands: Item[];                    // вещи в руках: правая, потом левая (left), или одна тяжёлая; их x, y, rot — где они лежали в рюкзаке
  unsynced: Set<number>;            // вещи, которые при входе пришлось переложить, а в базе они ещё на старом месте
  writes: Promise<unknown>;         // очередь записей вещей в базу: по одной, в том порядке, в каком игрок их делал
  fishing: Fishing;
  view: PlayerState;                // то, что видят другие
  budget: number;                   // сколько ещё можно пройти, арт-пикселей
  dirty: boolean;                   // место изменилось с прошлого сохранения
}

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const moveMsg = point.extend({ dir: z.enum(DIRS) });
const packKindMsg = z.object({ kind: z.enum(PACK_KINDS) });
const cell = z.number().int().min(0).max(63);
const itemMoveMsg = z.object({ id: z.number().int(), x: cell, y: cell, rot: z.boolean() });
const itemDropMsg = z.object({ id: z.number().int() });
const itemTakeMsg = z.object({ id: z.number().int(), left: z.boolean().optional() });
const itemStowMsg = z.object({ id: z.number().int(), at: z.object({ x: cell, y: cell, rot: z.boolean() }).nullable() });
const itemPutMsg = point.extend({ left: z.boolean().optional() });
const itemPickMsg = z.object({ id: z.number().int(), left: z.boolean().optional() });
const itemGiveMsg = z.object({ kind: z.enum(ITEM_KINDS) });
const lampMsg = z.object({ on: z.boolean(), id: z.number().int().optional() });
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
  private ground = new Map<number, Ground>();   // всё, что лежит на земле; в состоянии комнаты — то же (state.ground)
  private unsaved = 0;                // счётчик временных (отрицательных) id вещей, ещё не записанных в базу
  private offSky = () => {};          // отписка от часов и погоды причала

  async onCreate() {
    this.setPatchRate(PATCH);
    // Земля: сначала слушаем новости соседних копий, потом читаем, что на ней уже лежит, — так ничего не пропустим.
    await this.presence.subscribe(GROUND, this.onGroundNews);
    for (const it of await loadGround(db)) if (!this.ground.has(it.id)) this.setGround({ ...it, ready: true });
    // Сменилась погода или часы причала перевели (в разработке) — сообщаем сразу всем, кто в комнате.
    this.offSky = Sky.onChange(what => { if (what === 'clock') this.broadcast('clock', Sky.clock()); else this.broadcast('weather', Sky.weather()); });
    this.onMessage('clock', clockMsg, (_client, m) => { if (Sky.canSet) Sky.setHour(m.hour); });
    this.onMessage('weather', weatherMsg, (_client, m) => { if (Sky.canSet) Sky.setWeather(m.kind, m.wind); });
    this.setSimulationInterval(dt => this.tick(dt / 1000), TICK);
    this.clock.setInterval(() => this.saveAll(false), AUTOSAVE);

    this.onMessage('move', moveMsg, (client, m) => this.move(client, m.x, m.y, m.dir));
    this.onMessage('sit', client => this.sit(client));
    this.onMessage('rest', client => this.rest(client));
    this.onMessage('stand', client => this.withSession(client, s => this.standUp(s)));
    this.onMessage('press', client => this.withSession(client, s => { if (s.world.sitting) s.fishing.press(); }));
    this.onMessage('packOn', client => this.packOn(client));
    this.onMessage('packOff', point, (client, m) => this.packOff(client, m.x, m.y));
    this.onMessage('packKind', packKindMsg, (client, m) => this.packKind(client, m.kind));
    this.onMessage('itemMove', itemMoveMsg, (client, m) => this.itemMove(client, m.id, m.x, m.y, m.rot));
    this.onMessage('itemDrop', itemDropMsg, (client, m) => this.itemDrop(client, m.id));
    this.onMessage('itemTake', itemTakeMsg, (client, m) => this.itemTake(client, m.id, m.left));
    this.onMessage('itemStow', itemStowMsg, (client, m) => this.itemStow(client, m.id, m.at));
    this.onMessage('itemPut', itemPutMsg, (client, m) => this.itemPut(client, m.x, m.y, m.left));
    this.onMessage('itemPick', itemPickMsg, (client, m) => this.itemPick(client, m.id, m.left));
    this.onMessage('lamp', lampMsg, (client, m) => this.lamp(client, m.on, m.id));
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
    // в руках — каждая вещь в своей руке, пока рука свободна (тяжёлая — обе); лишнее считается лежащим в рюкзаке
    const stored = await loadItems(db, auth.pid), hands: Item[] = [], extra: Item[] = [];
    for (const it of stored.hands) {
      const at = ITEMS.handFor(hands, it.kind, ITEMS.sideOf(it));
      if (at) hands.push({ ...it, left: at === 'left' }); else extra.push(ITEMS.unheld(it));
    }
    ITEMS.inOrder(hands);
    const packed = ITEMS.settle(ITEMS.grid(world.pack.kind), [...stored.list, ...extra]);
    const view = new PlayerState();
    view.pid = saved.id; view.name = saved.name;
    const s: Session = {
      pid: saved.id, name: saved.name, world, bag: saved.bag, items: packed.list, hands, unsynced: new Set([...packed.moved, ...extra].map(it => it.id)), writes: Promise.resolve(), view, budget: BUDGET_MAX, dirty: false,
      fishing: createFishing({ hasRod: () => s.hands.some(it => ITEMS.isRod(it.kind)), hasBucket: () => this.hasBucket(s), emit: ev => this.onFishing(client, s, ev), grace: HOOK_GRACE }),
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

  async onDispose() { this.offSky(); this.presence.unsubscribe(GROUND, this.onGroundNews); await this.saveAll(true); }

  // ---------- действия игрока ----------

  private withSession(client: Client, fn: (s: Session) => void) {
    const s = this.sessions.get(client.sessionId);
    if (s) fn(s);
  }
  private reject(client: Client, s: Session) { this.tell(client, 'self', s.world); }
  // Вещи игрока целиком: что в рюкзаке и что в руке; note — почему не вышло то, о чём он просил.
  private tellItems(client: Client, s: Session, note?: ServerMessages['items']['note']) { this.tell(client, 'items', { list: s.items, hands: s.hands, ...(note && { note }) }); }

  private move(client: Client, x: number, y: number, dir: WorldState['dir']) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, d = dist(w, { x, y });
    if (w.sitting || !World.canWalk(x, y) || d > s.budget + SLACK) { this.reject(client, s); return; }
    s.budget = Math.max(0, s.budget - d);
    w.x = x; w.y = y; w.dir = dir; w.rest = false; s.dirty = true;   // пошёл — значит, встал от костра
    this.syncView(s);
  }

  // Ведро, если оно в руке, остаётся в руке: сидящему рыбаку его рисуют рядом.
  private sit(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.sitting) return;
    if (dist(w, seat) > seat.r + SLACK) { this.reject(client, s); return; }
    w.sitting = true; w.x = seat.x; w.y = seat.y; s.dirty = true;
    s.fishing.sit();
    this.syncView(s);
  }

  // У костра садятся прямо там, где стоят, лицом к огню; что в руках, остаётся в руках.
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

  // Выложить вещь на землю у ног: из рук — где угодно, из рюкзака — заглянув в него. Куда именно, решаем мы (ITEMS.dropSpot).
  private itemDrop(client: Client, id: number) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const it = s.hands.find(h => h.id === id) || s.items.find(h => h.id === id);
    if (!it || id < 0 || s.world.sitting) { this.tellItems(client, s); return; }
    if (!s.hands.includes(it) && !packInReach(s.world, s.world.pack, SLACK)) { this.tellItems(client, s, 'far'); return; }
    this.layDown(client, s, it, ITEMS.dropSpot(s.world, [...this.ground.values()], World.canWalk));
  }
  // Взять вещь из рюкзака в руку left (не назвали — в свободную; рюкзак на спине или рядом). Что было в этой руке, уходит
  // в рюкзак; некуда — отказ. Тяжёлую — только в пустые руки. Вещь, которая ещё пишется в базу (id отрицательный), в руки не берём: её номер
  // пока никто не знает.
  private itemTake(client: Client, id: number, left?: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (!packInReach(s.world, s.world.pack, SLACK)) { this.tellItems(client, s, 'far'); return; }
    const r = id > 0 ? ITEMS.take(ITEMS.grid(s.world.pack.kind), s.items, s.hands, id, left === undefined ? undefined : left ? 'left' : 'right') : 'none';
    if (typeof r === 'string') { this.tellItems(client, s, r === 'none' ? undefined : r); return; }
    s.items = r.list; s.hands = r.hands;
    this.syncView(s);
    this.place(s, [{ ...r.hands.find(it => it.id === id)!, held: true }, ...r.back]);
    if (r.back.length) this.tellItems(client, s);       // куда встали прежние вещи из рук, решили мы — пусть клиент сверится
  }

  // Убрать вещь из рук в рюкзак: в названную клетку или на свободное место.
  private itemStow(client: Client, id: number, at: { x: number; y: number; rot: boolean } | null) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (!s.hands.some(it => it.id === id)) { this.tellItems(client, s); return; }
    if (!packInReach(s.world, s.world.pack, SLACK)) { this.tellItems(client, s, 'far'); return; }
    const r = ITEMS.stow(ITEMS.grid(s.world.pack.kind), s.items, s.hands, id, at);
    if (!r) { this.tellItems(client, s, at ? undefined : 'full'); return; }
    s.items = r.list; s.hands = r.hands;
    this.syncView(s);
    this.place(s, [r.item]);
  }

  // Положить вещь из руки left (не назвали — из первой) на землю рядом с собой — туда, куда показал игрок.
  private itemPut(client: Client, x: number, y: number, left?: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, it = left === undefined ? s.hands[0] : ITEMS.inHand(s.hands, left ? 'left' : 'right');
    if (!it || w.sitting || dist(w, { x, y }) > PUT_REACH || !World.canWalk(x, y)) { this.tellItems(client, s); return; }
    this.layDown(client, s, it, { x: Math.round(x), y: Math.round(y) });
  }

  // Вещь игрока ложится на землю. Видно её всем сразу, а поднять можно, когда она записана в базу: тогда о ней узнают
  // и другие копии причала. Лампа из руки ложится такой, какой была: горящей или погашенной, ведро — с хвостами последних
  // рыб хозяина. Своих вещей на земле — не больше GROUND_MAX.
  private layDown(client: Client, s: Session, it: Item, at: { x: number; y: number }) {
    if ([...this.ground.values()].filter(g => g.owner === s.pid).length >= ITEMS.GROUND_MAX) { this.tellItems(client, s, 'litter'); return; }
    const lit = it.kind === 'lamp' && s.world.lamp && s.hands.includes(it);   // из рюкзака лампа ложится погашенной: там она не горела
    s.hands = s.hands.filter(h => h !== it); s.items = s.items.filter(h => h !== it);
    const fish = ITEMS.isBucket(it.kind) ? s.bag.recent.join(',') : '';
    const g: Ground = { id: it.id, kind: it.kind, x: at.x, y: at.y, lit, fish, owner: s.pid, ready: false };
    this.setGround(g);
    this.syncView(s);                                   // выложил лампу из руки — у него в руке свет погас
    this.tellItems(client, s);                          // окно рюкзака узнаёт, что вещи у него больше нет
    this.write(s, async () => {
      try { await dropItem(db, s.pid, g); }
      catch (err) { this.dropGround(g.id); throw err; }  // не записалась — вещь так и лежит у него в базе и вернётся при следующем входе
      g.ready = true;
      this.news({ e: 'put', it: { id: g.id, kind: g.kind, x: g.x, y: g.y, lit: g.lit, fish: g.fish, owner: g.owner } });
    });
  }

  // Поднять вещь с земли, стоя рядом: свою или чужую. Она идёт в руку left (не назвали — в свободную), а если рука занята — в рюкзак, когда он под
  // рукой и в нём есть место. Вещь становится своей: в базе у неё меняется хозяин. С земли она пропадает сразу, но
  // её могли в тот же миг поднять в другой копии причала — тогда база скажет, что не вышло, и вещь у игрока пропадёт.
  private itemPick(client: Client, id: number, left?: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, g = this.ground.get(id);
    if (!g || !g.ready || w.sitting || dist(w, g) > REACH + SLACK) { this.tellItems(client, s); return; }
    let mine: Item, held = false;
    const hand = ITEMS.handFor(s.hands, g.kind, left === undefined ? undefined : left ? 'left' : 'right');
    if (hand) { mine = { id, kind: g.kind, x: 0, y: 0, rot: false, left: hand === 'left' }; held = true; }   // где она лежала в рюкзаке, уже не вспомнить — вернётся на свободное место
    else {
      const at = packInReach(w, w.pack, SLACK) ? ITEMS.spot(ITEMS.grid(w.pack.kind), s.items, g.kind) : null;
      if (!at) { this.tellItems(client, s, 'busy'); return; }
      mine = { id, kind: g.kind, ...at };
    }
    this.dropGround(id);
    if (held) s.hands = ITEMS.inOrder([...s.hands, mine]); else s.items.push(mine);
    const lamp = g.kind === 'lamp' && w.lamp !== g.lit;
    if (lamp) w.lamp = g.lit;                           // лампа переходит такой, какой лежала: горящей или погашенной
    this.syncView(s);
    this.tellItems(client, s);                          // куда легла вещь, решили мы
    this.write(s, async () => {
      let ok: boolean;
      try { ok = await claimItem(db, s.pid, { ...mine, held }); }
      catch (err) { this.loseItem(client, s, id); if (!this.ground.has(id)) this.setGround(g); throw err; }   // база не ответила — вещь остаётся на земле
      if (!ok) { this.loseItem(client, s, id, 'gone'); return; }
      this.news({ e: 'gone', id });
      if (lamp) void this.save(s, true);
    });
  }

  // Вещь, которую игроку дали раньше времени, у него забирают обратно (с земли её поднял кто-то другой или база не ответила).
  private loseItem(client: Client, s: Session, id: number, note?: ServerMessages['items']['note']) {
    s.hands = s.hands.filter(h => h.id !== id); s.items = s.items.filter(h => h.id !== id);
    this.syncView(s);
    if (this.sessions.get(client.sessionId) === s) this.tellItems(client, s, note);
  }

  // Зажечь или погасить лампу: свою в руке или (id) ту, что стоит на земле рядом, — чью угодно.
  // Лампы под рукой нет или далеко — молчим: кнопки у игрока тогда и нет.
  private lamp(client: Client, on: boolean, id?: number) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (id === undefined) {
      if (!ITEMS.lampOut(s.hands) || s.world.lamp === on) return;
      s.world.lamp = on; s.dirty = true;
      this.syncView(s);
      void this.save(s, true);         // сразу: лампа в руке должна гореть и после перезахода, а место героя пишется лишь раз в минуту
      return;
    }
    const g = this.ground.get(id);
    if (!g || g.kind !== 'lamp' || !g.ready || s.world.sitting || dist(s.world, g) > REACH + SLACK || g.lit === on) return;
    this.setGround({ ...g, lit: on });
    this.write(s, async () => { await lightItem(db, id, on); this.news({ e: 'lit', id, on }); });
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

  // ---------- земля ----------

  // Положить вещь на землю у себя: в память и в состояние комнаты (его видят все).
  private setGround(g: Ground) {
    this.ground.set(g.id, g);
    const key = String(g.id), v = this.state.ground.get(key) ?? new GroundState();
    v.kind = g.kind; v.x = g.x; v.y = g.y; v.lit = g.lit; v.fish = g.fish;
    if (!this.state.ground.has(key)) this.state.ground.set(key, v);
  }
  private dropGround(id: number) { this.ground.delete(id); this.state.ground.delete(String(id)); }

  // Сообщить о земле всем копиям причала — и себе тоже: свои новости применяются повторно, без вреда.
  private news(n: GroundNews) { this.presence.publish(GROUND, n); }
  private onGroundNews = (n: GroundNews) => {
    if (n.e === 'put') this.setGround({ ...n.it, ready: true });
    else if (n.e === 'gone') this.dropGround(n.id);
    else if (n.e === 'lit') { const g = this.ground.get(n.id); if (g && g.lit !== n.on) this.setGround({ ...g, lit: n.on }); }
    else { const g = this.ground.get(n.id); if (g && g.fish !== n.fish) this.setGround({ ...g, fish: n.fish }); }
  };

  // ---------- рыбалка ----------

  // Куда класть улов: ведро в руке рыбака ('hand') или ведро на земле у места рыбака — своё (его выложил он сам), а нет
  // своего — ближайшее чужое. null — некуда.
  private bucketFor(s: Session): 'hand' | Ground | null {
    if (s.hands.some(h => ITEMS.isBucket(h.kind))) return 'hand';
    let best: Ground | null = null;
    const rank = (g: Ground) => (g.owner === s.pid ? 0 : 1000) + dist(g, seat);
    for (const g of this.ground.values()) if (ITEMS.isBucket(g.kind) && bucketNearSeat(g) && (!best || rank(g) < rank(best))) best = g;
    return best;
  }
  private hasBucket(s: Session) { return this.bucketFor(s) !== null; }

  private onFishing(client: Client, s: Session, ev: FishingEvent) {
    if (ev.e !== 'hook') { this.tell(client, 'fish', ev); return; }
    const fish = ev.fish;
    addToBag(s.bag, fish);
    this.tell(client, 'fish', { ...ev, bag: s.bag });
    this.syncView(s);
    const b = this.bucketFor(s);                        // рыба легла в ведро на земле — его хвосты видят все
    if (b && b !== 'hand' && b.ready) {
      const tails = s.bag.recent.join(',');
      this.setGround({ ...b, fish: tails });
      this.write(s, async () => { await fishItem(db, b.id, tails); this.news({ e: 'fish', id: b.id, fish: tails }); });
    }
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
    v.wearing = w.pack.worn; v.px = w.pack.x; v.py = w.pack.y; v.pack = w.pack.kind;
    v.hand = s.hands.find(h => !h.left)?.kind ?? ''; v.off = s.hands.find(h => h.left)?.kind ?? '';
    v.lamp = w.lamp && ITEMS.lampOut(s.hands);
    const recent = s.bag.recent.filter(id => FISH.byId[id]);
    if (v.recent.length !== recent.length || recent.some((id, i) => v.recent[i] !== id)) {
      v.recent.clear(); for (const id of recent) v.recent.push(id);
    }
  }

  private async save(s: Session, force: boolean) {
    if (!s.dirty && !force) return;
    s.dirty = false;
    try { await saveWorld(db, s.pid, { ...s.world, pack: { ...s.world.pack } }); }
    catch (err) { s.dirty = true; console.error(`не сохранилось место игрока ${s.pid}:`, err); }
  }
  private async saveAll(force: boolean) { await Promise.all([...this.sessions.values()].map(s => this.save(s, force))); }

  private tell<K extends keyof ServerMessages>(client: Client, type: K, message: ServerMessages[K]) { client.send(type, message); }
}
