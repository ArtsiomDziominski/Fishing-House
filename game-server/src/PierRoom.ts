// Комната-причал: общий мир на ROOM_SIZE игроков. Когда она полна, матчмейкер Colyseus открывает ещё одну.
//
// Кто здесь главный:
// - ходит клиент сам (так нет задержки), а сервер проверяет каждый шаг: в проходимую ли клетку и не быстрее ли, чем можно;
//   не принял — шлёт игроку «self», и тот встаёт туда, где сервер его видит;
// - рыбалку ведёт только сервер: когда клюёт, кто клюнул, успел ли подсечь. Клиент шлёт лишь нажатия. Забросить можно
//   только с удочкой в одной руке и червями в другой (их берут из рюкзака) и с ведром на земле у места рыбака
//   (или в руке, но тогда не хватит рук на червей);
// - улов пишется в базу сразу при подсечке, место героя и рюкзака — при выходе и раз в минуту;
// - вещи в рюкзаке перекладывает тоже сервер, и в руку их берёт он же: проверяет по ITEMS, что вещь встаёт, и пишет
//   в базу по очереди (writes);
// - земля общая для всех копий причала: что на неё выложили, видят все и поднять может любой — тогда вещь становится его.
//   Она лежит и когда хозяин ушёл из игры. Копии узнают друг от друга, что легло и что подняли, через presence (Redis);
// - голод ведёт тоже сервер (HUNGER): сытость тает в tick, рыбу из ведра достают в руку, жарят у костра и едят; кто долго
//   голодал — засыпает (ничего не может, часть рыбы из ведра пропадает) и просыпается у дома сытым;
// - черви (WORMS) — тоже: червь уходит из банки, когда клюнула рыба; копают их лопатой на траве, и вскопанное место (ямка,
//   одна на все копии причала) пустеет на WORMS.REST секунд.

import { Room, definePlugins, type Client } from 'colyseus';
import { UniqueSessionPlugin } from 'colyseus/plugins/unique-session';
import { z } from 'zod';
import {
  World, FISH, ITEMS, HUNGER, SCRAPS, FIRE, WORMS, DIRS, PACK_KINDS, ITEM_KINDS, WEATHERS, ROOM_SIZE, SPEED, RUN, REACH, PUT_REACH, nearFire, faceFire, HOOK_GRACE,
  createFishing, addToBag, nearSeat, bucketNearSeat, standPoint, homePoint, startState, packInReach, dist, seat,
  type Bag, type Catch, type Fishing, type FishingEvent, type Hole, type Item, type ItemKind, type Point, type ScrapEnd, type ServerMessages, type WorldState,
} from '@fh/shared';
import {
  verifyTicket, loadPlayer, loadBag, saveWorld, recordCatch, loseCatches, loadItems, loadGround, addItem, placeItems, dropItem, claimItem, lightItem, fishItem,
  takeFish, cookItems, eatItem, scrapItem, setWorms, type Dropped, type Stored, type Ticket,
} from '@fh/shared/server';
import { db } from './db.ts';
import { Sky } from './sky.ts';
import { GroundState, HoleState, PierState, PlayerState } from './state.ts';

const TICK = 50;                    // мс между шагами симуляции (рыбалка, запас хода)
const PATCH = 100;                  // мс между рассылками состояния: 10 раз в секунду хватает спокойной игре
const AUTOSAVE = 60_000;            // мс между сохранениями места героя в базу
const RECONNECT = 20;               // секунд ждём игрока, у которого оборвалась связь
const SLACK = 4;                    // арт-пикселей прощаем на округления и рывки сети
const BUDGET_MAX = 26 * RUN;        // запас хода копится, пока сообщения идут пачкой, но не больше этого
const GROUND = 'ground';            // канал presence, по которому копии причала сообщают друг другу, что на земле
const BLAZE = 'fire';               // костёр: ключ presence (горит — 'lit', погас — 'out') и канал, по которому о нём сообщают
const HOLES = 'holes';              // ямки от лопат: хеш presence (номер → ямка JSON-ом, его читают открывшиеся копии) и канал новостей о них

// Вещь на земле — по мнению сервера. ready — уже записана в базу: до того её не поднять (её место в базе ещё старое).
// end — у рыбы: за ней пришла чайка или кот, или она тает (SCRAPS); нет — лежит.
type Ground = Dropped & { ready: boolean; end?: ScrapEnd };
// Что копии причала сообщают друг другу о земле: вещь легла, её подняли, лампу на ней зажгли или погасили, в ведро легла рыба,
// за рыбой на земле пришли (или она тает).
type GroundNews = { e: 'put'; it: Dropped } | { e: 'gone'; id: number } | { e: 'lit'; id: number; on: boolean } | { e: 'fish'; id: number; fish: string } | { e: 'end'; id: number; by: ScrapEnd };

interface Session {
  sid: string;                      // sessionId соединения: по нему находим клиента (this.clients.getById)
  pid: string;
  name: string;
  world: WorldState;                // где игрок на самом деле — по мнению сервера
  bag: Bag;
  unrecorded: Catch[];              // пойманы и уже в ведре, но ещё ждут записи в базу (в очереди writes)
  items: Item[];                    // вещи в рюкзаке — по мнению сервера
  hands: Item[];                    // вещи в руках: правая, потом левая (left), или одна тяжёлая; их x, y, rot — где они лежали в рюкзаке
  unsynced: Set<number>;            // вещи, которые при входе пришлось переложить, а в базе они ещё на старом месте
  writes: Promise<unknown>;         // очередь записей вещей в базу: по одной, в том порядке, в каком игрок их делал
  fishing: Fishing;
  view: PlayerState;                // то, что видят другие
  budget: number;                   // сколько ещё можно пройти, арт-пикселей
  dirty: boolean;                   // место изменилось с прошлого сохранения
  fed: number;                      // сытость, о которой игрок уже знает (целая); -1 — ещё не сообщали
  cook: number;                     // сколько секунд рыба в руках жарится у костра
  eat: { kind: string; left: boolean; until: number } | null;   // что ест сейчас, какой рукой и до какого мгновения (мс), — это видят все
  dig: { at: Point; until: number } | null;   // копает червей: куда воткнул лопату и до какого мгновения (мс), — это видят все
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
const itemGiveMsg = z.object({ kind: z.enum(ITEM_KINDS).refine(kind => !ITEMS.isFish(kind)) });   // рыбу дают только из ведра: у неё есть вид
const scrapMsg = z.object({ id: z.number().int(), by: z.enum(SCRAPS.ENDS as [ScrapEnd, ...ScrapEnd[]]) });
const fishTakeMsg = z.object({ species: z.string().max(24), left: z.boolean().optional() });
const eatMsg = z.object({ left: z.boolean().optional() });
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
  private fates = new Map<number, { clear(): void }>();   // рыба на земле: когда за ней придут (SCRAPS.fate), потом — когда её не станет
  private unsaved = 0;                // счётчик временных (отрицательных) id вещей, ещё не записанных в базу
  private offSky = () => {};          // отписка от часов и погоды причала
  private douse: { clear(): void } | null = null;   // дождь идёт — когда погаснет костёр
  private holes = new Map<string, Hole>();   // ямки от лопат; в состоянии комнаты — то же (state.holes)
  private weed = 0;                   // секунд до того, как убрать заросшие ямки

  async onCreate() {
    this.setPatchRate(PATCH);
    // Земля: сначала слушаем новости соседних копий, потом читаем, что на ней уже лежит, — так ничего не пропустим.
    await this.presence.subscribe(GROUND, this.onGroundNews);
    for (const it of await loadGround(db)) if (!this.ground.has(it.id)) this.setGround({ ...it, ready: true });
    // Костёр тоже один на все копии: так же сначала слушаем, потом читаем, горит ли он.
    this.state.fire = true;
    await this.presence.subscribe(BLAZE, this.onFireNews);
    if (await this.presence.get(BLAZE) === 'out') this.state.fire = false;
    this.watchRain();
    // Ямки — тоже: слушаем, потом читаем те, что вскопали до нас.
    await this.presence.subscribe(HOLES, this.onHoleNews);
    for (const [id, json] of Object.entries(await this.presence.hgetall(HOLES) ?? {})) { try { this.onHoleNews({ id, ...JSON.parse(json) as Hole }); } catch { /* битая запись — пропустим */ } }
    // Сменилась погода или часы причала перевели (в разработке) — сообщаем сразу всем, кто в комнате; пошёл дождь — костёр гаснет.
    this.offSky = Sky.onChange(what => { if (what === 'clock') this.broadcast('clock', Sky.clock()); else { this.broadcast('weather', Sky.weather()); this.watchRain(); } });
    this.onMessage('clock', clockMsg, (_client, m) => { if (Sky.canSet) Sky.setHour(m.hour); });
    this.onMessage('weather', weatherMsg, (_client, m) => { if (Sky.canSet) Sky.setWeather(m.kind, m.wind); });
    this.setSimulationInterval(dt => this.tick(dt / 1000), TICK);
    this.clock.setInterval(() => this.saveAll(false), AUTOSAVE);

    // Спящий от голода ничего не делает: экран у него чёрный, а что пришло — отголоски прежних нажатий. Ему — где он
    // на самом деле и как лежат его вещи (вдруг окно рюкзака успело что-то переложить).
    const awake = <M>(fn: (client: Client, m: M) => void) => (client: Client, m: M) => {
      const s = this.sessions.get(client.sessionId);
      if (s?.world.sleep) { this.reject(client, s); this.tellItems(client, s); } else fn(client, m);
    };
    this.onMessage('move', moveMsg, awake((client, m) => this.move(client, m.x, m.y, m.dir)));
    this.onMessage('sit', awake(client => this.sit(client)));
    this.onMessage('rest', awake(client => this.rest(client)));
    this.onMessage('kindle', awake(client => this.kindle(client)));
    this.onMessage('stand', awake(client => this.withSession(client, s => this.standUp(s))));
    this.onMessage('press', awake(client => this.withSession(client, s => { if (s.world.sitting) s.fishing.press(); })));
    this.onMessage('packOn', awake(client => this.packOn(client)));
    this.onMessage('packOff', point, awake((client, m) => this.packOff(client, m.x, m.y)));
    this.onMessage('packKind', packKindMsg, awake((client, m) => this.packKind(client, m.kind)));
    this.onMessage('itemMove', itemMoveMsg, awake((client, m) => this.itemMove(client, m.id, m.x, m.y, m.rot)));
    this.onMessage('itemDrop', itemDropMsg, awake((client, m) => this.itemDrop(client, m.id)));
    this.onMessage('itemTake', itemTakeMsg, awake((client, m) => this.itemTake(client, m.id, m.left)));
    this.onMessage('itemStow', itemStowMsg, awake((client, m) => this.itemStow(client, m.id, m.at)));
    this.onMessage('itemPut', itemPutMsg, awake((client, m) => this.itemPut(client, m.x, m.y, m.left)));
    this.onMessage('itemPick', itemPickMsg, awake((client, m) => this.itemPick(client, m.id, m.left)));
    this.onMessage('lamp', lampMsg, awake((client, m) => this.lamp(client, m.on, m.id)));
    this.onMessage('fishTake', fishTakeMsg, awake((client, m) => this.fishTake(client, m.species, m.left)));
    this.onMessage('eat', eatMsg, awake((client, m) => this.eat(client, m.left)));
    this.onMessage('dig', awake(client => this.dig(client)));
    this.onMessage('itemGive', itemGiveMsg, (client, m) => { if (Sky.canSet) this.itemGive(client, m.kind); });
    this.onMessage('scrap', scrapMsg, (_client, m) => { if (Sky.canSet && ITEMS.isFish(this.ground.get(m.id)?.kind ?? '')) this.ending(m.id, m.by, true); });
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
    if (world.sleep && world.sleep <= Date.now()) this.rise(world);   // уснул от голода и ушёл — выспался, пока его не было
    // вещи — в сетку нынешнего рюкзака. Кого пришлось переложить, тех в базе не трогаем, пока игрок сам не возьмётся
    // за рюкзак: вдруг запись мира отстала (вкладку перезагрузили, а прежний вход ещё сохраняется) и разложено всё верно
    // в руках — каждая вещь в своей руке, пока рука свободна (тяжёлая — обе); лишнее считается лежащим в рюкзаке.
    // Сырой рыбе в рюкзаке не место: руку она занимает первой, а своя занята — другую
    const stored = await loadItems(db, auth.pid), hands: Item[] = [], extra: Item[] = [];
    for (const it of [...stored.hands].sort((a, b) => Number(ITEMS.packable(a.kind)) - Number(ITEMS.packable(b.kind)))) {
      const at = ITEMS.handFor(hands, it.kind, ITEMS.sideOf(it)) ?? (ITEMS.packable(it.kind) ? null : ITEMS.handFor(hands, it.kind));
      if (at) hands.push({ ...it, left: at === 'left' }); else extra.push(ITEMS.unheld(it));
    }
    ITEMS.inOrder(hands);
    const packed = ITEMS.settle(ITEMS.grid(world.pack.kind), [...stored.list, ...extra]);
    const view = new PlayerState();
    view.pid = saved.id; view.name = saved.name;
    const s: Session = {
      sid: client.sessionId, pid: saved.id, name: saved.name, world, bag: saved.bag, unrecorded: [], items: packed.list, hands, unsynced: new Set([...packed.moved, ...extra].map(it => it.id)), writes: Promise.resolve(), view, budget: BUDGET_MAX, dirty: false, fed: -1, cook: 0, eat: null, dig: null,
      fishing: createFishing({
        hasRod: () => s.hands.some(it => ITEMS.isRod(it.kind)), hasBait: () => s.hands.some(it => ITEMS.isBait(it.kind)), hasWorms: () => this.bait(s) !== null, useWorm: () => this.useWorm(s),
        hasBucket: () => this.hasBucket(s), emit: ev => this.onFishing(client, s, ev), grace: HOOK_GRACE,
      }),
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
    this.tellHunger(s);
  }

  // Связь оборвалась сама — держим героя на месте, пока клиент переподключается.
  async onDrop(client: Client, code?: number) {
    if (code === 1001 || code === 1005 || code === 1006) await this.allowReconnection(client, RECONNECT).catch(() => {});
  }
  // Вернулся: личные сообщения, пока связи не было, пропали (уснул, проснулся, рыба пожарилась, погода сменилась) — всё заново.
  onReconnect(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    this.tell(client, 'clock', Sky.clock());
    this.tell(client, 'weather', Sky.weather());
    this.tell(client, 'self', s.world);
    this.tell(client, 'bag', s.bag);
    this.tellItems(client, s);
    this.tellHunger(s);
  }

  async onLeave(client: Client) {
    const s = this.sessions.get(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (s) await Promise.all([this.save(s, true), s.writes]);
  }

  async onDispose() {
    this.offSky(); this.douse?.clear();
    this.presence.unsubscribe(GROUND, this.onGroundNews); this.presence.unsubscribe(BLAZE, this.onFireNews); this.presence.unsubscribe(HOLES, this.onHoleNews);
    await this.saveAll(true);
  }

  // ---------- действия игрока ----------

  private withSession(client: Client, fn: (s: Session) => void) {
    const s = this.sessions.get(client.sessionId);
    if (s) fn(s);
  }
  private reject(client: Client, s: Session) { this.tell(client, 'self', s.world); }
  private clientOf(s: Session) { return this.sessions.get(s.sid) === s ? this.clients.getById(s.sid) : undefined; }
  // Вещи игрока целиком: что в рюкзаке и что в руке; note — почему не вышло то, о чём он просил.
  private tellItems(client: Client, s: Session, note?: ServerMessages['items']['note']) { this.tell(client, 'items', { list: s.items, hands: s.hands, ...(note && { note }) }); }

  private move(client: Client, x: number, y: number, dir: WorldState['dir']) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, d = dist(w, { x, y });
    if (w.sitting || !World.canWalk(x, y) || d > s.budget + SLACK) { this.reject(client, s); return; }
    if (s.dig && d > 0.5) s.dig = null;                 // ушёл, не докопав, — червей нет
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

  // Разжечь погасший костёр: стоя у огня или сидя у него, и только без дождя. Не вышло — молчим: клиент сам видит, что огня нет.
  private kindle(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (this.state.fire || s.world.sitting || !nearFire(s.world) || Sky.weather().kind === 'rain') return;
    this.setFire(true);
  }
  // Костёр загорелся или погас — у всех копий причала (и у себя: свои новости применяются так же), и это запомнено для тех,
  // что откроются потом.
  private setFire(lit: boolean) { this.presence.set(BLAZE, lit ? 'lit' : 'out'); this.presence.publish(BLAZE, { lit }); }
  private onFireNews = (n: { lit: boolean }) => { this.state.fire = n.lit; this.watchRain(); };
  // Дождь идёт FIRE.douse секунд — костёр гаснет. Дождь кончился раньше или огня и так нет — гасить нечего.
  private watchRain() {
    if (Sky.weather().kind !== 'rain' || !this.state.fire) { this.douse?.clear(); this.douse = null; return; }
    this.douse ??= this.clock.setTimeout(() => {
      this.douse = null;
      if (Sky.weather().kind === 'rain' && this.state.fire) this.setFire(false);
    }, FIRE.douse * 1000);
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
    if (!r) { this.tellItems(client, s, ITEMS.isRaw(s.hands.find(it => it.id === id)!.kind) ? 'raw' : at ? undefined : 'full'); return; }
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
    if (it.id < 0) { this.tellItems(client, s); return; }   // рыба, только что вынутая из ведра, ещё пишется в базу
    if ([...this.ground.values()].filter(g => g.owner === s.pid).length >= ITEMS.GROUND_MAX) { this.tellItems(client, s, 'litter'); return; }
    const lit = it.kind === 'lamp' && s.world.lamp && s.hands.includes(it);   // из рюкзака лампа ложится погашенной: там она не горела
    s.hands = s.hands.filter(h => h !== it); s.items = s.items.filter(h => h !== it);
    const fish = ITEMS.isBucket(it.kind) ? s.bag.recent.join(',') : ITEMS.isFish(it.kind) ? it.fish ?? '' : '';   // у рыбы — её вид
    const g: Ground = { id: it.id, kind: it.kind, x: at.x, y: at.y, lit, fish, owner: s.pid, ready: false, ...(ITEMS.isBait(it.kind) && { worms: it.worms ?? 0 }) };
    this.setGround(g);
    this.syncView(s);                                   // выложил лампу из руки — у него в руке свет погас
    this.tellItems(client, s);                          // окно рюкзака узнаёт, что вещи у него больше нет
    this.write(s, async () => {
      try { await dropItem(db, s.pid, g); }
      catch (err) { this.dropGround(g.id); throw err; }  // не записалась — вещь так и лежит у него в базе и вернётся при следующем входе
      g.ready = true;
      this.news({ e: 'put', it: { id: g.id, kind: g.kind, x: g.x, y: g.y, lit: g.lit, fish: g.fish, owner: g.owner, ...(g.worms !== undefined && { worms: g.worms }) } });
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
    const fish = ITEMS.isFish(g.kind) ? { fish: g.fish } : ITEMS.isBait(g.kind) ? { worms: g.worms ?? 0 } : {};   // рыба помнит свой вид, банка — сколько в ней червей
    if (hand) { mine = { id, kind: g.kind, x: 0, y: 0, rot: false, left: hand === 'left', ...fish }; held = true; }   // где она лежала в рюкзаке, уже не вспомнить — вернётся на свободное место
    else {
      const at = packInReach(w, w.pack, SLACK) && ITEMS.packable(g.kind) ? ITEMS.spot(ITEMS.grid(w.pack.kind), s.items, g.kind) : null;
      if (!at) { this.tellItems(client, s, 'busy'); return; }
      mine = { id, kind: g.kind, ...at, ...fish };
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
      try { const got = await addItem(db, s.pid, kind, { x: it.x, y: it.y, rot: it.rot }); it.id = got.id; if (got.worms !== undefined) it.worms = got.worms; }
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

  // Положить вещь на землю у себя: в память и в состояние комнаты (его видят все). Рыбе — её судьбу (doom).
  private setGround(g: Ground) {
    this.ground.set(g.id, g);
    const key = String(g.id), v = this.state.ground.get(key) ?? new GroundState();
    v.kind = g.kind; v.x = g.x; v.y = g.y; v.lit = g.lit; v.fish = g.fish; v.end = g.end ?? '';
    if (!this.state.ground.has(key)) this.state.ground.set(key, v);
    this.doom(g);
  }
  private dropGround(id: number) {
    this.ground.delete(id); this.state.ground.delete(String(id));
    this.fates.get(id)?.clear(); this.fates.delete(id);
  }

  // Сообщить о земле всем копиям причала — и себе тоже: свои новости применяются повторно, без вреда.
  private news(n: GroundNews) { this.presence.publish(GROUND, n); }
  private onGroundNews = (n: GroundNews) => {
    if (n.e === 'put') { const was = this.ground.get(n.it.id); this.setGround({ ...n.it, ready: true, ...(was?.end && { end: was.end }) }); }
    else if (n.e === 'end') this.ending(n.id, n.by, false);
    else if (n.e === 'gone') this.dropGround(n.id);
    else if (n.e === 'lit') { const g = this.ground.get(n.id); if (g && g.lit !== n.on) this.setGround({ ...g, lit: n.on }); }
    else { const g = this.ground.get(n.id); if (g && g.fish !== n.fish) this.setGround({ ...g, fish: n.fish }); }
  };

  // ---------- рыба на земле (SCRAPS) ----------

  // Рыба легла на землю — здесь, в другой копии причала (новость put) или лежала там ещё до того, как эта копия открылась:
  // её судьба (SCRAPS.fate) отсчитывается с этого мига. Раньше всех срок подходит у той копии, где её положили, — она и решает.
  private doom(g: Ground) {
    if (!ITEMS.isFish(g.kind) || g.end || this.fates.has(g.id)) return;
    const f = SCRAPS.fate(g.id);
    this.fates.set(g.id, this.clock.setTimeout(() => this.ending(g.id, f.by, true), f.at * 1000));
  }
  // За рыбой пришли (или она тает): это видят все (end), а через SCRAPS.TAKE её нет — ни на земле, ни в базе. mine — решила
  // эта копия: она сообщает остальным и убирает рыбу; остальные убирают её сами, только если новость gone так и не пришла.
  private ending(id: number, by: ScrapEnd, mine: boolean) {
    const g = this.ground.get(id); if (!g || g.end) return;
    this.fates.get(id)?.clear();
    if (!g.ready) { this.fates.set(id, this.clock.setTimeout(() => this.ending(id, by, mine), 1000)); return; }   // ещё пишется в базу
    if (mine && by === 'cat' && [...this.ground.values()].some(o => o.end === 'cat')) by = 'gull';   // кот один, он занят — прилетит чайка
    this.setGround({ ...g, end: by });
    if (mine) this.news({ e: 'end', id, by });
    this.fates.set(id, this.clock.setTimeout(() => this.scrap(id), (SCRAPS.TAKE[by] + (mine ? 0 : 3)) * 1000));
  }
  // Рыбы больше нет. Подняли раньше — её уже нет на земле, а в базе она теперь чья-то, и её не трогаем.
  private scrap(id: number) {
    this.fates.delete(id);
    if (!this.ground.has(id)) return;
    this.dropGround(id);
    scrapItem(db, id).then(() => this.news({ e: 'gone', id }), err => console.error(`рыба ${id} с земли не убрана:`, err));
  }

  // ---------- еда и голод ----------

  // Ведро под рукой, чтобы достать из него рыбу: в руке, у сидящего рыбака — у места рыбака, у стоящего — на земле рядом.
  // Чьё оно, не важно: в ведре у каждого свой улов.
  private pailNear(s: Session) {
    if (s.hands.some(h => ITEMS.isBucket(h.kind))) return true;
    if (s.world.sitting) return this.hasBucket(s);
    return ITEMS.nearest(s.world, [...this.ground.values()].filter(g => ITEMS.isBucket(g.kind)), SLACK) !== null;
  }

  // Достать рыбу этого вида из ведра в руку left (не назвали — в свободную). В руке она появляется сразу, с временным
  // номером; какую именно рыбу вынуть (самую мелкую) и номер вещи решает база — тогда игроку приходят руки и ведро заново.
  private fishTake(client: Client, species: string, left?: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (!FISH.byId[species]) return;
    if (!this.pailNear(s)) { this.tellItems(client, s, 'pail'); return; }
    if (!s.bag.counts[species]) { this.tellItems(client, s, 'empty'); this.tell(client, 'bag', s.bag); return; }
    const hand = ITEMS.handFor(s.hands, 'fish', left === undefined ? undefined : left ? 'left' : 'right');
    if (!hand) { this.tellItems(client, s, 'busy'); return; }
    const it: Item = { id: -++this.unsaved, kind: 'fish', x: 0, y: 0, rot: false, left: hand === 'left', fish: species };
    s.hands = ITEMS.inOrder([...s.hands, it]);
    s.bag.counts[species]--; s.bag.total--;              // вес и хвосты поправит ведро из базы
    this.syncView(s);
    this.tellItems(client, s);
    this.tell(client, 'bag', s.bag);
    this.write(s, async () => {
      let got: Item | null = null;
      try { got = await takeFish(db, s.pid, species, hand === 'left'); }
      finally {
        if (got) it.id = got.id; else s.hands = s.hands.filter(h => h !== it);   // рыбы не нашлось (вынули в другой вкладке) или база не ответила
        await this.reloadBag(s).catch(() => {});
        this.syncView(s);
        const c = this.clientOf(s);
        if (c) { this.tellItems(c, s, got ? undefined : 'empty'); this.tell(c, 'bag', s.bag); }
      }
    });
  }

  // Съесть рыбу из руки left (не назвали — жареную первой, потом сырую). Сытость — сразу, вещь из базы удаляется.
  private eat(client: Client, left?: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const it = ITEMS.meal(s.hands, left === undefined ? undefined : left ? 'left' : 'right');
    if (!it || it.id < 0) { this.tellItems(client, s); return; }
    if (s.eat) return;                                  // ещё жуёт прежнюю: рыба остаётся в руке
    const w = s.world, cooked = !ITEMS.isRaw(it.kind), was = w.food, fish = it.fish ?? '';
    w.food = HUNGER.eat(w.food, fish, cooked); w.starve = 0; s.dirty = true;
    s.hands = s.hands.filter(h => h !== it);
    s.eat = { kind: it.kind, left: !!it.left, until: Date.now() + HUNGER.EAT * 1000 };   // сытость сразу, а жуёт ещё EAT секунд
    this.syncView(s);
    this.tellItems(client, s);
    this.tell(client, 'food', { e: 'ate', fish, raw: !cooked, gain: Math.round(w.food - was) });
    this.tellHunger(s);
    this.write(s, () => eatItem(db, s.pid, it.id));
    void this.save(s, true);                             // рыбы в базе уже нет — пусть и сытость будет там сразу
  }

  // Голод за dt секунд: сытость тает; у костра сырая рыба в руках жарится. Сытость на нуле дольше STARVE — герой засыпает,
  // а когда сон кончился — просыпается у дома.
  private hunger(s: Session, dt: number, now: number) {
    const w = s.world;
    if (w.sleep) { if (now >= w.sleep) this.wake(s); return; }
    w.food = HUNGER.drain(w.food, dt);
    if (w.food > 0) w.starve = 0;
    else if ((w.starve += dt) >= HUNGER.STARVE) { this.faint(s, now); return; }
    this.cook(s, dt);
    if (Math.ceil(w.food) !== s.fed) this.tellHunger(s);
  }

  // Сидит у костра с сырой рыбой в руке (уже записанной в базу) — через COOK секунд она пожарится; встал или костёр погас —
  // жарка сначала.
  private cook(s: Session, dt: number) {
    const raw = s.hands.filter(h => ITEMS.isRaw(h.kind) && h.id > 0);
    if (!s.world.rest || !raw.length || !this.state.fire) { s.cook = 0; return; }
    if ((s.cook += dt) < HUNGER.COOK) return;
    s.cook = 0;
    for (const h of raw) h.kind = 'fish-fried';
    this.syncView(s);
    const c = this.clientOf(s);
    if (c) { this.tellItems(c, s); for (const h of raw) this.tell(c, 'food', { e: 'cooked', fish: h.fish ?? '' }); }
    const ids = raw.map(h => h.id);
    this.write(s, () => cookItems(db, s.pid, ids));
  }

  // Герой уснул от голода там, где стоял (сидел — встаёт): SLEEP секунд он ничего не может, а из ведра пропадает часть рыбы.
  private faint(s: Session, now: number) {
    const w = s.world;
    if (w.sitting) { s.fishing.leave(); const p = standPoint(); Object.assign(w, { sitting: false, x: p.x, y: p.y, dir: 'down' }); }
    w.rest = false; w.starve = 0; w.sleep = now + HUNGER.SLEEP * 1000; s.cook = 0; s.dig = null; s.dirty = true;
    this.syncView(s);
    const c = this.clientOf(s);
    if (c) this.reject(c, s);
    this.tellHunger(s);
    void this.save(s, true);                             // сон — сразу: перезайти, чтобы не спать, не выйдет
    this.write(s, async () => {
      const lost = await loseCatches(db, s.pid);
      await this.reloadBag(s);
      this.syncView(s);
      const c = this.clientOf(s);
      if (c) { this.tell(c, 'bag', s.bag); this.tellHunger(s, lost); }
    });
  }

  // Выспался: у крыльца дома, сытый.
  private rise(w: WorldState) {
    const p = homePoint();
    Object.assign(w, { x: p.x, y: p.y, dir: 'down', sitting: false, rest: false, food: HUNGER.MAX, starve: 0, sleep: 0 });
  }
  private wake(s: Session) {
    this.rise(s.world);
    s.budget = BUDGET_MAX; s.dirty = true;
    this.syncView(s);
    const c = this.clientOf(s);
    if (c) this.reject(c, s);                           // «self» — он теперь у дома
    this.tellHunger(s);
    void this.save(s, true);
  }

  // Сытость и сон — игроку. lost — сколько рыб пропало из ведра, пока он спал.
  private tellHunger(s: Session, lost?: number) {
    const w = s.world;
    s.fed = Math.ceil(w.food); s.dirty = true;
    const c = this.clientOf(s);
    if (c) this.tell(c, 'hunger', { food: s.fed, sleep: w.sleep ? Math.max(0, w.sleep - Date.now()) : 0, ...(lost !== undefined && { lost }) });
  }

  // ---------- черви и лопаты (WORMS) ----------

  // Банка червей в руке, в которой ещё есть черви; null — нет такой.
  private bait(s: Session) { return s.hands.find(h => ITEMS.isBait(h.kind) && (h.worms ?? 0) > 0) ?? null; }
  // Рыба клюнула — червя в банке больше нет. Игрок узнаёт, сколько осталось, в базу — в очереди вещей (у банки, только что
  // положенной из разработки, номер ещё временный — запись встанет после её собственной).
  private useWorm(s: Session) {
    const jar = this.bait(s); if (!jar) return;
    jar.worms = (jar.worms ?? 0) - 1;
    const n = jar.worms, c = this.clientOf(s);
    if (c) this.tell(c, 'worms', { e: 'used', id: jar.id, n });
    this.write(s, () => setWorms(db, s.pid, jar.id, n));
  }

  // Копать: стоя, с лопатой в одной руке и банкой в другой, на траве перед собой. WORMS.DIG секунд это видят все (dig),
  // потом — tick, dug. Не вышло — говорим почему.
  private dig(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, no = (e: 'none' | 'full' | 'ground' | 'jar' | 'shovel' | 'busy') => this.tell(client, 'worms', { e });
    if (w.sitting || w.rest || s.eat || s.dig) { no('busy'); return; }
    if (!s.hands.some(h => WORMS.isShovel(h.kind))) { no('shovel'); return; }
    const jar = s.hands.find(h => ITEMS.isBait(h.kind));
    if (!jar) { no('jar'); return; }
    if ((jar.worms ?? 0) >= WORMS.MAX) { no('full'); return; }
    const at = WORMS.spot(w, w.dir);
    if (!WORMS.canDig(at)) { no('ground'); return; }
    s.dig = { at, until: Date.now() + WORMS.DIG * 1000 };
    this.syncView(s);
  }
  // Докопал. Место вскопано недавно — червей нет (ямку не трогаем: она зарастёт в свой срок). Иначе новая ямка у всех копий
  // причала и черви в банку — сколько даёт лопата (после дождя вдвое); что не влезло, уползает. Лопату или банку успел
  // убрать — копал зря.
  private dug(s: Session) {
    const at = s.dig!.at, c = this.clientOf(s);
    s.dig = null;
    this.syncView(s);
    const shovel = s.hands.find(h => WORMS.isShovel(h.kind)), jar = s.hands.find(h => ITEMS.isBait(h.kind)), now = Sky.clock().now;
    const tell = (m: ServerMessages['worms']) => { if (c) this.tell(c, 'worms', m); };
    if (!shovel) { tell({ e: 'shovel' }); return; }
    if (!jar) { tell({ e: 'jar' }); return; }
    if (WORMS.dug(this.holes.values(), at, now)) { tell({ e: 'none' }); return; }
    const id = `${s.pid}-${now}`, hole: Hole = { x: at.x, y: at.y, at: now };
    this.presence.hset(HOLES, id, JSON.stringify(hole));
    this.presence.publish(HOLES, { id, ...hole });
    const wet = WORMS.wet(Date.now(), Sky.weather().kind === 'rain'), got = WORMS.yieldOf(shovel.kind, wet);
    const r = WORMS.fill(jar.worms ?? 0, got);
    jar.worms = r.n;
    tell({ e: 'dug', id: jar.id, n: r.n, got, lost: r.lost, wet });
    this.write(s, () => setWorms(db, s.pid, jar.id, r.n));
  }
  // Новая ямка — здесь или в другой копии причала (свои новости применяются так же).
  private onHoleNews = (h: Hole & { id: string }) => {
    if (this.holes.has(h.id) || !WORMS.fresh(h, Sky.clock().now)) return;
    this.holes.set(h.id, { x: h.x, y: h.y, at: h.at });
    const v = new HoleState(); v.x = h.x; v.y = h.y; v.at = h.at;
    this.state.holes.set(h.id, v);
  };
  // Заросшие ямки — долой: из памяти, состояния комнаты и presence (убрать одну и ту же ямку дважды не страшно).
  private weedHoles() {
    const now = Sky.clock().now;
    for (const [id, h] of this.holes) if (!WORMS.fresh(h, now)) { this.holes.delete(id); this.state.holes.delete(id); void this.presence.hdel(HOLES, id); }
  }

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
    // в очередь, как и вещи: ведро, которое как раз читается из базы (reloadBag), этой рыбы не потеряет
    s.unrecorded.push(fish);
    this.write(s, async () => {
      try { await recordCatch(db, s.pid, fish); }
      catch (err) { console.error(`улов ${s.pid} ${fish.id} ${fish.grams} г не записан:`, err); }
      finally { s.unrecorded = s.unrecorded.filter(f => f !== fish); }
    });
  }

  // Ведро заново из базы — только в очереди записей (write): всё, что было до этого, уже записано, а пойманное после
  // (unrecorded) ещё нет — его добавляем сами.
  private async reloadBag(s: Session) {
    const bag = await loadBag(db, s.pid);
    for (const f of s.unrecorded) addToBag(bag, f);
    s.bag = bag;
  }

  private tick(dt: number) {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      s.fishing.update(dt);
      s.budget = Math.min(BUDGET_MAX, s.budget + SPEED * RUN * 1.25 * HUNGER.pace(s.world.food) * dt);   // голодный и ходит медленнее
      this.hunger(s, dt, now);
      if (s.eat && now >= s.eat.until) { s.eat = null; this.syncView(s); }   // доел
      if (s.dig && now >= s.dig.until) this.dug(s);
    }
    if ((this.weed -= dt) <= 0) { this.weed = 5; this.weedHoles(); }
  }

  // ---------- состояние и база ----------

  private syncView(s: Session) {
    const w = s.world, v = s.view;
    v.x = w.x; v.y = w.y; v.dir = w.dir; v.sitting = w.sitting; v.rest = w.rest;
    v.wearing = w.pack.worn; v.px = w.pack.x; v.py = w.pack.y; v.pack = w.pack.kind;
    v.hand = s.hands.find(h => !h.left)?.kind ?? ''; v.off = s.hands.find(h => h.left)?.kind ?? '';
    v.lamp = w.lamp && ITEMS.lampOut(s.hands);
    v.sleep = !!w.sleep;
    v.eat = s.eat?.kind ?? ''; v.eatLeft = !!s.eat?.left;
    v.dig = !!s.dig;
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
