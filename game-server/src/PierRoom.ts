// Комната-причал: у каждого игрока свой причал (owner — id хозяина, комнату подбирают по pier), остальные на нём — гости.
// На причале до ROOM_SIZE игроков; когда тесно, матчмейкер Colyseus открывает ещё одну его копию.
//
// Кто здесь главный:
// - ходит клиент сам (так нет задержки), а сервер проверяет каждый шаг: в проходимую ли клетку и не быстрее ли, чем можно;
//   не принял — шлёт игроку «self», и тот встаёт туда, где сервер его видит;
// - рыбалку ведёт только сервер: когда клюёт, кто клюнул (по часам и погоде причала — FISH.pace, FISH.roll), успел ли подсечь. Клиент шлёт лишь нажатия. Забросить можно
//   только с удочкой в одной руке и червями в другой (их берут из рюкзака) и с ведром на земле у места рыбака
//   (или в руке, но тогда не хватит рук на червей), в котором есть место;
// - улов лежит в ведре, а не у игрока (bags): ведро унесли — унесли и рыбу, из ведра на земле её достаёт любой;
// - улов пишется в базу сразу при подсечке, место героя и рюкзака — при выходе и раз в минуту;
// - вещи в рюкзаке перекладывает тоже сервер, и в руку их берёт он же: проверяет по ITEMS, что вещь встаёт, и пишет
//   в базу по очереди (writes);
// - земля общая для всех копий причала: что на неё выложили, видят все и поднять может любой — и гость тоже, тогда вещь
//   становится его. Она лежит и когда хозяин ушёл из игры. Копии узнают друг от друга, что легло и что подняли, через
//   presence (Redis). У каждого причала своя земля (site, items.place): вещь с одного причала на другом не видна;
//   костёр и ямки — тоже свои у каждого причала, а часы и погода одни на всех;
// - в гостях (Session.home) герой приходит к месту рыбака, рыбачит и берёт с земли, как дома, но в дом не входит и рюкзак
//   не снимает; в базу пишется не место в гостях, а то, что он носит с собой (сытость, сон, лампа, вид рюкзака);
// - голод ведёт тоже сервер (HUNGER): сытость тает в tick, рыбу из ведра достают в руку, жарят у костра и едят; кто долго
//   голодал — засыпает (ничего не может, из рюкзака и рук крадут часть вещей) и просыпается у дома сытым;
// - черви (WORMS) — тоже: червь уходит из банки, когда клюнула рыба; копают их лопатой на траве, и вскопанное место (ямка,
//   одна на все копии причала) пустеет на WORMS.REST секунд;
// - в дом входят от двери (enter) и выходят от порога (exit): он у каждого игрока свой (чужих в нём не видно,
//   мебель никем не занята), внутри свой кадр и своя проходимость (Indoor). В креслах у камина жарят рыбу, как у костра, и его не заливает дождь; в кровати спят (bed) —
//   сытость тает медленнее; в холодильнике у каждого своя полка для рыбы (fridge*, в базе — items.fridge), в сундуке —
//   вещи (chest*, items.chest; вид сундука выбирает игрок, CHESTS). Земля, рюкзак на земле, рыбалка и копка — снаружи: из дома до них не дотянуться.
// - общие воды — общий остров (Isle) и открытый океан (Sea), одни на всех игроков: это та же комната, только pier у неё —
//   SEA_ROOM (shared). Хозяина у неё нет, все в ней — как в гостях (Session.home — мир дома, в базу пишется только то, что
//   носят с собой). Плывут туда на лодке (sail) от своего (или чужого, где гостишь) причала: сервер ставит героя у лодки,
//   пишет его и отвечает «voyage» — браузер сам переходит в комнату общих вод (JoinOptions.to — на остров или в океан), а
//   оттуда так же домой — к причалу, от которого отплыл. Между островом и океаном плывут внутри комнаты, ответ — «self».
//   На острове своя земля (ISLE_PLACE, в состоянии комнаты у вещи isle), свой костёр (isleFire), место рыбака на мостках —
//   там клюют лещ и сом (FISH, isle). В океане каждый в своей лодке (WorldState.sea): гребёт, где хочет, бросает якорь и
//   рыбачит (spot 'sea', у косяка — чаще и крупнее, shoalAt); ведро ставят в лодку (boatPlace — у каждого своя, s.boat),
//   за борт ничего не выложить. Копать в общих водах нечего, рюкзак не снимают, а лежащий у причала оттуда не достать.
//   Уснул там от голода — лодку прибило к своему причалу: проснётся у дома («voyage» домой, slept).

import { Room, definePlugins, matchMaker, type Client } from 'colyseus';
import { UniqueSessionPlugin } from 'colyseus/plugins/unique-session';
import { z } from 'zod';
import {
  Indoor, Isle, SEA, World, FRIDGE, FISH, ITEMS, HUNGER, SCRAPS, FIRE, WORMS, CHESTS, DIRS, PACK_KINDS, CHEST_KINDS, ITEM_KINDS, WEATHERS, VOYAGES, ROOM, ROOM_SIZE, SEA_ROOM, ISLE_PLACE, PLAYER_ID_RE, pierPlace, boatPlace, SPEED, RUN, REACH, PUT_REACH, nearFire, faceFire, HOOK_GRACE,
  createFishing, dayHour, addToBag, takeFromBag, emptyBag, haulText, bucketNearSeat, standPoint, standFrom, fisherAt, shoreCast, homePoint, nearDoor, nearBoat, nearShoal, seaSpawn, boatPoint, gridOf, seatOf, startState, packInReach, dist, seat,
  type Area, type Bag, type Catch, type ChestKind, type Fishing, type FishingEvent, type Hole, type Item, type ItemKind, type PierInfo, type Place, type Point, type ScrapEnd, type ServerMessages, type Voyage, type WorldState,
} from '@fh/shared';
import {
  verifyTicket, loadPlayer, loadBag, loadBags, saveWorld, saveAway, recordCatch, loadItems, loadGround, addItem, placeItems, dropItem, claimItem, lightItem, robItems,
  takeFish, cookItems, eatItem, scrapItem, setWorms, loadFridge, fridgePut, fridgeTake, fridgeStock, playerName, loadChest, chestPlace, chestMove, setChestKind,
  type Chilled, type Dropped, type Stored, type Ticket,
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
const CALL_HOME = 5000;             // мс: спящего в общих водах зовём домой не чаще (сообщение могло пропасть, пока связи не было)
// Ключи и каналы presence — у каждого причала свои (с местом: 'ground:pier:<хозяин>'): его копии видят одно и то же.
// Костёр острова — свой ключ и канал (с местом острова: 'fire:isle:<хозяин>'); земля острова идёт по каналу земли причала.
const GROUND = 'ground';            // канал, по которому копии причала сообщают друг другу, что на земле
const BLAZE = 'fire';               // костёр: ключ (горит — 'lit', погас — 'out') и канал, по которому о нём сообщают
const HOLES = 'holes';              // ямки от лопат: хеш (номер → ямка JSON-ом, его читают открывшиеся копии) и канал новостей о них
const AWAY = -1000;                 // рюкзак гостя остался на земле у него дома: на этом причале его нет
// Игрок ушёл с причала и ещё дописывает в базу (место, вещи из очереди) — ключ presence 'flush:<id>'. Другой причал, куда он
// перешёл, ждёт этого, прежде чем читать его из базы: иначе прочтёт старое и потом запишет его поверх нового.
const FLUSH = 'flush';
const FLUSH_TTL = 15;               // секунд: упавший процесс не держит игрока дольше
const FLUSH_WAIT = 8000;            // мс: дольше не ждём и читаем как есть

// Вещь на земле — по мнению сервера. ready — уже записана в базу: до того её не поднять (её место в базе ещё старое).
// end — у рыбы: за ней пришла чайка или кот, или она тает (SCRAPS); нет — лежит. isle — лежит на острове (x, y — в его кадре).
type Ground = Dropped & { ready: boolean; end?: ScrapEnd; isle: boolean };
// Что копии причала сообщают друг другу о земле: вещь легла (у ведра — с уловом), её подняли, лампу на ней зажгли или погасили,
// в ведре на земле поменялся улов (bag — как он записан в базе), за рыбой на земле пришли (или она тает).
type GroundNews = { e: 'put'; it: Dropped; isle?: boolean; bag?: Bag } | { e: 'gone'; id: number } | { e: 'lit'; id: number; on: boolean } | { e: 'bag'; id: number; bag: Bag } | { e: 'end'; id: number; by: ScrapEnd };
// Ведро, куда лечь рыбе или откуда её достать: id вещи и где оно — в руке (ground null) или на земле.
type Pail = { id: number; kind: string; ground: Ground | null };

interface Session {
  sid: string;                      // sessionId соединения: по нему находим клиента (this.clients.getById)
  pid: string;
  name: string;
  world: WorldState;                // где игрок на самом деле — по мнению сервера
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
  fridge: Chilled[];                // его полка в холодильнике — по мнению сервера
  life: Bag;                        // весь его улов за всё время (как в профиле): по нему — впервые ли пойман вид и рекорд ли
  chest: { kind: ChestKind; list: Item[] };   // его сундук в доме — по мнению сервера
  home: WorldState | null;          // он в гостях: где он у себя дома (так и запишем в базу — меняются только сытость, сон, лампа и вид рюкзака); null — он у себя
  boat: Item[];                     // в океане: ведро, поставленное в его лодку (в базе — на земле в boatPlace); x, y у него не важны
  ashore: boolean;                  // уснул в общих водах — лодку прибило к своему причалу: в базу — и место у крыльца дома
  called: number;                   // когда его, спящего, в последний раз звали из общих вод домой (мс; callHome)
}

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const moveMsg = point.extend({ dir: z.enum(DIRS) });
const packKindMsg = z.object({ kind: z.enum(PACK_KINDS) });
const chestKindMsg = z.object({ kind: z.enum(CHEST_KINDS) });
const cell = z.number().int().min(0).max(63);
const itemMoveMsg = z.object({ id: z.number().int(), x: cell, y: cell, rot: z.boolean() });
const itemDropMsg = z.object({ id: z.number().int() });
const itemTakeMsg = z.object({ id: z.number().int(), left: z.boolean().optional() });
const itemStowMsg = z.object({ id: z.number().int(), at: z.object({ x: cell, y: cell, rot: z.boolean() }).nullable() });
const chestPutMsg = itemStowMsg;
const chestTakeMsg = itemStowMsg;
const itemPutMsg = point.extend({ left: z.boolean().optional() });
const itemPickMsg = z.object({ id: z.number().int(), left: z.boolean().optional() });
const itemGiveMsg = z.object({ kind: z.enum(ITEM_KINDS).refine(kind => !ITEMS.isFish(kind)) });   // рыбу дают только из ведра: у неё есть вид
const scrapMsg = z.object({ id: z.number().int(), by: z.enum(SCRAPS.ENDS as [ScrapEnd, ...ScrapEnd[]]) });
const fishTakeMsg = z.object({ species: z.string().max(24), left: z.boolean().optional(), pail: z.number().int().optional() });
const eatMsg = z.object({ left: z.boolean().optional() });
const fridgePutMsg = z.object({ left: z.boolean().optional() });
const fridgeTakeMsg = z.object({ id: z.number().int(), left: z.boolean().optional() });
const lampMsg = z.object({ on: z.boolean(), id: z.number().int().optional() });
const clockMsg = z.object({ hour: z.number().min(0).max(24).nullable() });
const weatherMsg = z.object({ kind: z.enum(WEATHERS).nullable(), wind: z.boolean().nullable() });
// to нет — вкладка открыта до общих вод (sail тогда шли без него): не выкидываем её, а оставляем у лодки — перезагрузится и поплывёт.
const sailMsg = z.object({ to: z.enum(VOYAGES).optional() }).optional();

type Auth = Ticket & { id: string };
// Улов строкой, чтобы сравнить два ведра: порядок видов не важен.
const bagKey = (b: Bag) => [b.total, b.grams, b.recent.join(), ...Object.entries(b.counts).sort().map(([id, n]) => `${id}:${n}:${b.best[id]}`)].join('|');

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
  private owner = '';                 // чей это причал — id хозяина; остальные здесь в гостях. У общих вод хозяина нет
  private shared = false;             // это общие воды (SEA_ROOM): остров и океан, все — как в гостях
  private site = '';                  // чья земля здесь (items.place = pierPlace(owner)): у каждого причала своя; у общих вод — SEA_ROOM (за борт ничего не кладут)
  private isleSite = '';              // земля общего острова (ISLE_PLACE) — только у общих вод
  private ground = new Map<number, Ground>();   // всё, что лежит на земле; в состоянии комнаты — то же (state.ground)
  private bags = new Map<number, Bag>();        // что в вёдрах, которые знает эта копия: на земле и у её игроков (в руках и в рюкзаке); ключ — id ведра
  private pending = new Map<number, Catch[]>(); // пойманы и уже в ведре (ключ), но ещё ждут записи в базу — в очереди writes того, кто поймал
  private fates = new Map<number, { clear(): void }>();   // рыба на земле: когда за ней придут (SCRAPS.fate), потом — когда её не станет
  private unsaved = 0;                // счётчик временных (отрицательных) id вещей, ещё не записанных в базу
  private offSky = () => {};          // отписка от часов и погоды причала
  private douse: [{ clear(): void } | null, { clear(): void } | null] = [null, null];   // дождь идёт — когда погаснет костёр: у дома и на острове
  private holes = new Map<string, Hole>();   // ямки от лопат; в состоянии комнаты — то же (state.holes)
  private weed = 0;                   // секунд до того, как убрать заросшие ямки

  // Причал открывают для хозяина (pier — его id): у каждого игрока свой, и копии одного причала матчмейкер подбирает по pier.
  // pier = SEA_ROOM — общие воды: хозяина нет, в список причалов («В гости») они не попадают (в метаданных нет owner).
  async onCreate(options: { pier?: unknown }) {
    this.shared = options?.pier === SEA_ROOM;
    if (this.shared) {
      this.site = SEA_ROOM; this.isleSite = ISLE_PLACE;
      this.state.owner = SEA_ROOM; this.state.ownerName = 'Общие воды';
      await this.setMetadata({ pier: SEA_ROOM });
    } else {
      const owner = typeof options?.pier === 'string' && PLAYER_ID_RE.test(options.pier) ? options.pier : '';
      const name = owner ? await playerName(db, owner) : null;
      if (!name) throw new Error('Такого причала нет');
      this.owner = owner; this.site = pierPlace(owner);
      this.state.owner = owner; this.state.ownerName = name;
      await this.setMetadata({ pier: owner, owner, name });   // pier — по нему матчмейкер (filterBy) сводит хозяина и гостей в одну комнату: setMetadata заменяет метаданные целиком
    }
    this.setPatchRate(PATCH);
    // Земля: сначала слушаем новости соседних копий, потом читаем, что на ней уже лежит, — так ничего не пропустим. Вёдрам — их улов.
    // У причала — его земля, у общих вод — земля острова (за борт в океане ничего не кладут).
    await this.presence.subscribe(this.channel, this.onGroundNews);
    const lying = this.shared ? (await loadGround(db, this.isleSite)).map(it => ({ ...it, isle: true })) : (await loadGround(db, this.site)).map(it => ({ ...it, isle: false }));
    for (const [id, bag] of await loadBags(db, lying.filter(it => ITEMS.isBucket(it.kind)).map(it => it.id))) if (!this.bags.has(id)) this.bags.set(id, bag);
    for (const it of lying) if (!this.ground.has(it.id)) this.setGround({ ...it, ready: true });
    // Костёр тоже один на все копии (у общих вод — костёр острова): так же сначала слушаем, потом читаем, горит ли он.
    this.state.fire = true; this.state.isleFire = true;
    const isle = this.shared;
    await this.presence.subscribe(this.blazeOf(isle), isle ? this.onIsleFireNews : this.onFireNews);
    if (await this.presence.get(this.blazeOf(isle)) === 'out') { if (isle) this.state.isleFire = false; else this.state.fire = false; }
    this.watchRain();
    // Ямки — тоже: слушаем, потом читаем те, что вскопали до нас.
    await this.presence.subscribe(this.pits, this.onHoleNews);
    for (const [id, json] of Object.entries(await this.presence.hgetall(this.pits) ?? {})) { try { this.onHoleNews({ id, ...JSON.parse(json) as Hole }); } catch { /* битая запись — пропустим */ } }
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
    this.onMessage('enter', awake(client => this.enter(client)));
    this.onMessage('exit', awake(client => this.exit(client)));
    this.onMessage('sail', sailMsg, awake((client, m) => { const s = this.sessions.get(client.sessionId); if (m?.to) this.sail(client, m.to); else if (s) this.reject(client, s); }));
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
    this.onMessage('fishTake', fishTakeMsg, awake((client, m) => this.fishTake(client, m.species, m.left, m.pail)));
    this.onMessage('eat', eatMsg, awake((client, m) => this.eat(client, m.left)));
    this.onMessage('dig', awake(client => this.dig(client)));
    this.onMessage('bed', awake(client => this.toBed(client)));
    this.onMessage('fridgePut', fridgePutMsg, awake((client, m) => this.fridgePut(client, m.left)));
    this.onMessage('fridgeTake', fridgeTakeMsg, awake((client, m) => this.fridgeTake(client, m.id, m.left)));
    this.onMessage('fridgeStock', awake(client => this.fridgeStock(client)));
    this.onMessage('chestPut', chestPutMsg, awake((client, m) => this.chestPut(client, m.id, m.at)));
    this.onMessage('chestTake', chestTakeMsg, awake((client, m) => this.chestTake(client, m.id, m.at)));
    this.onMessage('chestMove', itemMoveMsg, awake((client, m) => this.chestMove(client, m.id, m.x, m.y, m.rot)));
    this.onMessage('chestKind', chestKindMsg, awake((client, m) => this.chestKind(client, m.kind)));
    this.onMessage('piers', client => { this.piers(client).catch(err => console.error('не вышло собрать список причалов:', err)); });
    this.onMessage('itemGive', itemGiveMsg, (client, m) => { if (Sky.canSet) this.itemGive(client, m.kind); });
    this.onMessage('scrap', scrapMsg, (_client, m) => { if (Sky.canSet && ITEMS.isFish(this.ground.get(m.id)?.kind ?? '')) this.ending(m.id, m.by, true); });
  }
  private get channel() { return `${GROUND}:${this.site}`; }
  private blazeOf(isle: boolean) { return `${BLAZE}:${isle ? this.isleSite : this.site}`; }   // костёр острова — 'fire:isle', один на всех
  private get pits() { return `${HOLES}:${this.site}`; }

  // Билет выдаёт сайт после входа (POST /api/game/ticket); без него в комнату не пустит.
  onAuth(_client: Client, options: { ticket?: unknown }): Auth {
    const ticket = verifyTicket(options?.ticket);
    if (!ticket) throw new Error('Билет недействителен — войдите заново');
    return { ...ticket, id: ticket.pid };
  }

  // to — приплыл на лодке (JoinOptions.to): в общие воды — на остров или в океан, к причалу (home) — встаёт у лодки.
  async onJoin(client: Client<{ auth: Auth }>, options: { to?: unknown } | undefined, auth: Auth) {
    await this.flushed(auth.pid);
    const saved = await loadPlayer(db, auth.pid);
    if (!saved) throw new Error('Игрок не найден');
    const stay = saved.world || startState();
    const rose = !!stay.sleep && stay.sleep <= Date.now();
    if (rose) this.rise(stay);                           // уснул от голода и ушёл — выспался, пока его не было
    const to = VOYAGES.find(v => v === options?.to);
    const home = this.shared || saved.id !== this.owner ? stay : null;
    const world = this.shared ? this.arrival(stay, to === 'sea' ? 'sea' : 'isle') : home ? this.visitor(home) : stay;
    if (!this.shared && to === 'home' && !world.sleep) {   // приплыл домой (или к причалу, где гостил) — у лодки
      const p = boatPoint();
      Object.assign(world, { x: p.x, y: p.y, dir: 'left', sitting: false, rest: false, bed: false, inside: false });
    }
    this.see(world, this.shared ? (world.sea ? 'sea' : 'isle') : home ? 'guest' : 'pier');
    // вещи — в сетку нынешнего рюкзака. Кого пришлось переложить, тех в базе не трогаем, пока игрок сам не возьмётся
    // за рюкзак: вдруг запись мира отстала (вкладку перезагрузили, а прежний вход ещё сохраняется) и разложено всё верно
    // в руках — каждая вещь в своей руке, пока рука свободна (тяжёлая — обе); лишнее считается лежащим в рюкзаке.
    // Сырой рыбе в рюкзаке не место: руку она занимает первой, а своя занята — другую
    const [stored, fridge, life, chest, moored] = await Promise.all([loadItems(db, auth.pid), loadFridge(db, auth.pid), loadBag(db, auth.pid), loadChest(db, auth.pid), loadGround(db, boatPlace(auth.pid))]), hands: Item[] = [], extra: Item[] = [];
    const boat: Item[] = moored.filter(it => ITEMS.isBucket(it.kind)).map(it => ({ id: it.id, kind: it.kind, x: 0, y: 0, rot: false }));   // ведро, оставленное в лодке
    // что в его вёдрах — в руках, в рюкзаке и в лодке: с собой он принёс и улов
    for (const [id, bag] of await loadBags(db, [...stored.hands, ...stored.list, ...boat].filter(it => ITEMS.isBucket(it.kind)).map(it => it.id))) this.bags.set(id, this.withPending(id, bag));
    for (const it of [...stored.hands].sort((a, b) => Number(ITEMS.packable(a.kind)) - Number(ITEMS.packable(b.kind)))) {
      const at = ITEMS.handFor(hands, it.kind, ITEMS.sideOf(it)) ?? (ITEMS.packable(it.kind) ? null : ITEMS.handFor(hands, it.kind));
      if (at) hands.push({ ...it, left: at === 'left' }); else extra.push(ITEMS.unheld(it));
    }
    ITEMS.inOrder(hands);
    const packed = ITEMS.settle(ITEMS.grid(world.pack.kind), [...stored.list, ...extra]);
    const view = new PlayerState();
    view.pid = saved.id; view.name = saved.name;
    const s: Session = {
      sid: client.sessionId, pid: saved.id, name: saved.name, world, items: packed.list, hands, unsynced: new Set([...packed.moved, ...extra].map(it => it.id)), writes: Promise.resolve(), view, budget: BUDGET_MAX, dirty: false, fed: -1, cook: 0, eat: null, dig: null, fridge, life, chest, home, boat, ashore: false, called: 0,
      fishing: createFishing({
        hasRod: () => s.hands.some(it => ITEMS.isRod(it.kind)), hasBait: () => s.hands.some(it => ITEMS.isBait(it.kind)), hasWorms: () => this.bait(s) !== null, useWorm: () => this.useWorm(s),
        hasBucket: () => this.hasBucket(s), hasRoom: () => this.bucketFor(s) !== null, emit: ev => this.onFishing(client, s, ev), grace: HOOK_GRACE,
        spot: () => (s.world.sea ? 'sea' : s.world.isle ? 'isle' : 'pier'),   // с мостков острова клюют и лещ с сомом, в океане — только морские
        shoal: () => s.world.sea && nearShoal(s.world, Sky.clock().now),       // якорь брошен у косяка — клюёт чаще и крупнее
        moment: () => ({ hour: dayHour(Sky.clock().now), weather: Sky.weather().kind }),   // клёв — по часам и погоде причала
      }),
    };
    if (world.sitting) s.fishing.sit();
    this.sessions.set(client.sessionId, s);
    this.syncView(s);
    this.state.players.set(client.sessionId, view);
    this.tell(client, 'clock', Sky.clock());           // время суток клиент считает сам, но по часам причала
    this.tell(client, 'weather', Sky.weather());
    this.tell(client, 'self', world);
    this.tellBags(client, s);
    this.tellItems(client, s);
    this.tellFridge(client, s);
    this.tellChest(client, s);
    this.tellHunger(s, rose);
    if (s.boat.length && this.atBoat(s)) this.unload(client, s);   // сошёл на берег у лодки — ведро из неё берёт с собой (вошёл в дом, к себе после сна — оно ждёт в лодке)
    if (this.shared && world.sleep) this.callHome(s, Date.now());   // спит — в общих водах ему не место: его лодка у причала
  }
  // Гость приходит к причалу: стоит у места рыбака, в доме, на острове, у костра и в кровати его нет. Рюкзак на спине — с ним,
  // а лежит у него дома на земле — там и остался.
  private visitor(home: WorldState): WorldState {
    const p = standPoint();
    return { ...home, x: p.x, y: p.y, dir: 'down', sitting: false, rest: false, bed: false, inside: false, isle: false, sea: false, seen: [...home.seen], pack: home.pack.worn ? { ...home.pack } : { ...home.pack, x: AWAY, y: AWAY } };
  }
  // Приплыл в общие воды (to): на остров — к лодке на пляже, лицом от воды; в океан — в своей лодке, подальше от чужих
  // (seaSpawn). Рюкзак, как у гостя: на спине — с ним, а лежит у причала — там и остался.
  private arrival(home: WorldState, to: 'isle' | 'sea'): WorldState {
    const p = to === 'isle' ? Isle.landing : this.seaPlace();
    return { ...home, x: p.x, y: p.y, dir: to === 'isle' ? 'up' : 'left', sitting: false, rest: false, bed: false, inside: false, isle: to === 'isle', sea: to === 'sea', seen: [...home.seen], pack: home.pack.worn ? { ...home.pack } : { ...home.pack, x: AWAY, y: AWAY } };
  }
  private seaPlace() { return seaSpawn([...this.sessions.values()].filter(o => o.world.sea).map(o => o.world)); }
  // Где он побывал — на карту мира (WorldState.seen; гостю и в общих водах пишется в базу вместе с сытостью).
  private see(w: WorldState, area: Area) { if (!w.seen.includes(area)) w.seen = [...w.seen, area]; }

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
    this.tellBags(client, s);
    this.tellItems(client, s);
    this.tellFridge(client, s);
    this.tellChest(client, s);
    this.tellHunger(s);
    if (this.shared && s.world.sleep) { s.called = 0; this.callHome(s, Date.now()); }   // «voyage» домой могло пропасть вместе со связью
  }

  async onLeave(client: Client) {
    const s = this.sessions.get(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (!s) return;
    const key = `${FLUSH}:${s.pid}`;
    this.presence.setex(key, '1', FLUSH_TTL);
    try { await Promise.all([this.save(s, true), s.writes]); }
    finally { this.presence.del(key); }
    for (const it of [...s.hands, ...s.items, ...s.boat]) if (ITEMS.isBucket(it.kind) && !this.ground.has(it.id)) this.bags.delete(it.id);   // его вёдра ушли вместе с ним
  }
  // Ждём, пока прежний причал допишет игрока в базу (FLUSH).
  private async flushed(pid: string) {
    const until = Date.now() + FLUSH_WAIT;
    while (Date.now() < until && await this.presence.get(`${FLUSH}:${pid}`)) await new Promise(ok => setTimeout(ok, 100));
  }

  async onDispose() {
    this.offSky(); for (const d of this.douse) d?.clear();
    this.presence.unsubscribe(this.channel, this.onGroundNews); this.presence.unsubscribe(this.pits, this.onHoleNews);
    this.presence.unsubscribe(this.blazeOf(this.shared), this.shared ? this.onIsleFireNews : this.onFireNews);
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
  // Полка в холодильнике целиком; note — почему не вышло, stocked — сколько рыб легло из ведра.
  private tellFridge(client: Client, s: Session, note?: ServerMessages['fridge']['note'], stocked?: number) {
    this.tell(client, 'fridge', { list: s.fridge, ...(note && { note }), ...(stocked !== undefined && { stocked }) });
  }

  private move(client: Client, x: number, y: number, dir: WorldState['dir']) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, d = dist(w, { x, y });
    if (w.sitting || !gridOf(w).canWalk(x, y) || d > s.budget + SLACK) { this.reject(client, s); return; }
    if (s.dig && d > 0.5) s.dig = null;                 // ушёл, не докопав, — червей нет
    s.budget = Math.max(0, s.budget - d);
    w.x = x; w.y = y; w.dir = dir; w.rest = false; w.bed = false; s.dirty = true;   // пошёл — значит, встал от костра (из кресла, с кровати)
    this.syncView(s);
  }

  // Ведро, если оно в руке, остаётся в руке: сидящему рыбаку его рисуют рядом. На острове садятся на край его мостков или
  // на берег там, где стоят, — если удилище оттуда достаёт до воды (shoreCast): лицом к воде, куда смотрел, если вода с обеих сторон.
  // В океане бросают якорь где угодно: рыбак садится на корму лодки, лицом туда, куда она смотрит (влево или вправо).
  private sit(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, at = seatOf(w.isle), shore = w.isle && dist(w, at) > seat.r + SLACK ? shoreCast(w, w.dir) : null;
    if (w.sitting) return;
    if (w.sea) {
      w.sitting = true; if (w.dir !== 'right') w.dir = 'left'; s.dirty = true;
      s.fishing.sit();
      this.syncView(s);
      return;
    }
    if (w.inside || !shore && dist(w, at) > seat.r + SLACK) { this.reject(client, s); return; }
    const to = shore ?? at;
    w.sitting = true; w.x = to.x; w.y = to.y; s.dirty = true;
    if (shore) w.dir = shore.flip ? 'right' : 'left';
    s.fishing.sit();
    this.syncView(s);
  }

  // У костра садятся прямо там, где стоят, лицом к огню; что в руках, остаётся в руках. В доме — в кресло у камина рядом:
  // герой встаёт в его точку и смотрит на огонь. Дом у каждого свой — кресло никто другой не займёт.
  private rest(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.sitting || w.rest || w.bed) return;
    if (w.inside) {
      const i = Indoor.chairNear(w), chair = Indoor.chairs[i];
      if (!chair) { this.reject(client, s); return; }
      Object.assign(w, { x: chair.x, y: chair.y, dir: chair.dir, rest: true }); s.dirty = true;
      this.syncView(s);
      return;
    }
    if (w.sea || !nearFire(w, w.isle)) { this.reject(client, s); return; }   // в океане костра нет
    w.rest = true; w.dir = faceFire(w, w.isle);
    this.syncView(s);
  }
  // Лечь спать в кровать: в доме, стоя у неё. Пока лежит, сытость тает медленнее (HUNGER.BED); встаёт —
  // stand или шаг.
  private toBed(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.bed) return;
    if (!w.inside || w.sitting || !Indoor.nearBed(w) || s.dig) { this.reject(client, s); return; }
    Object.assign(w, { x: Indoor.bed.x, y: Indoor.bed.y, dir: 'down', rest: false, bed: true }); s.cook = 0; s.dirty = true;
    this.syncView(s);
  }

  // Разжечь погасший костёр (у дома или на острове — тот, у которого стоишь): стоя у огня или сидя у него, и только без
  // дождя. Не вышло — молчим: клиент сам видит, что огня нет.
  private kindle(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (this.lit(w.isle) || w.sitting || w.inside || w.sea || !nearFire(w, w.isle) || Sky.weather().kind === 'rain') return;
    this.setFire(true, w.isle);
  }
  // Горит ли костёр у дома или на острове.
  private lit(isle: boolean) { return isle ? this.state.isleFire : this.state.fire; }
  // Костёр загорелся или погас — у всех копий причала (и у себя: свои новости применяются так же), и это запомнено для тех,
  // что откроются потом.
  private setFire(lit: boolean, isle: boolean) { const key = this.blazeOf(isle); this.presence.set(key, lit ? 'lit' : 'out'); this.presence.publish(key, { lit }); }
  private onFireNews = (n: { lit: boolean }) => { this.state.fire = n.lit; this.watchRain(); };
  private onIsleFireNews = (n: { lit: boolean }) => { this.state.isleFire = n.lit; this.watchRain(); };
  // Дождь идёт FIRE.douse секунд — костёр гаснет (и у дома, и на острове). Дождь кончился раньше или огня и так нет — гасить нечего.
  private watchRain() {
    for (const isle of [this.shared]) {                 // у причала — его костёр, у общих вод — костёр острова
      const i = Number(isle);
      if (Sky.weather().kind !== 'rain' || !this.lit(isle)) { this.douse[i]?.clear(); this.douse[i] = null; continue; }
      this.douse[i] ??= this.clock.setTimeout(() => {
        this.douse[i] = null;
        if (Sky.weather().kind === 'rain' && this.lit(isle)) this.setFire(false, isle);
      }, FIRE.douse * 1000);
    }
  }

  private standUp(s: Session) {
    const w = s.world;
    if (w.rest || w.bed) {                              // из кресла и с кровати встают рядом с ними, у костра — где сидел
      const chair = w.inside && w.rest ? Indoor.chairs[Indoor.inChair(w)] : undefined, p = w.bed ? Indoor.bed.stand : chair?.stand;
      Object.assign(w, { rest: false, bed: false });
      if (p) { Object.assign(w, { x: p.x, y: p.y, dir: 'down' }); s.budget = BUDGET_MAX; s.dirty = true; }
      this.syncView(s);
      return;
    }
    if (!s.world.sitting) return;
    s.fishing.leave();
    const p = standFrom(s.world);
    Object.assign(s.world, { sitting: false, x: p.x, y: p.y, dir: s.world.sea ? s.world.dir : 'down' });   // в океане — поднял якорь, лодка смотрит, куда смотрела
    if (!s.world.sea) s.budget = BUDGET_MAX;            // с мостков встают рядом (прыжок — не шаг); лодка с якоря — там же, и запас прежний: иначе якорем разгоняются
    s.dirty = true;
    this.syncView(s);
  }

  // Войти в дом: стоя у двери снаружи, и только к себе — гостям дверь не открывается. Внутри герой встаёт на порог лицом в комнату; сидел у костра или копал — бросил.
  // В ответ — «self»: по нему клиент и меняет кадр. Снятый рюкзак остаётся снаружи, где лежал.
  private enter(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.inside || w.isle || w.sea || w.sitting || s.home || !nearDoor(w)) { this.reject(client, s); return; }   // в чужой дом не входят
    Object.assign(w, { inside: true, x: Indoor.door.x, y: Indoor.door.y, dir: 'up', rest: false, bed: false });
    this.moved(client, s);
  }
  // Выйти из дома: стоя у порога внутри. Снаружи — у крыльца, лицом от двери.
  private exit(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (!w.inside || !Indoor.nearExit(w)) { this.reject(client, s); return; }
    const p = homePoint();
    Object.assign(w, { inside: false, x: p.x, y: p.y, dir: 'down', rest: false, bed: false });
    this.moved(client, s);
  }
  // Сесть в лодку и плыть (to): стоя у лодки (у причала — с края мостков, на острове — у её носа на пляже; в океане герой
  // и так в лодке — сидел на якоре, якорь поднимает). Сидел у костра или копал — бросил. Снятый рюкзак остаётся у причала.
  // От причала — только в общие воды, из общих вод домой — в другую комнату: герой встаёт у лодки (дома это и пишется
  // в базу), ответ — «voyage», и браузер переходит туда сам. Между островом и океаном — внутри комнаты: ответ — «self»
  // уже там, по нему клиент и меняет кадр; с острова в океан — в своей лодке, подальше от чужих, из океана на остров — к лодке
  // на пляже, и ведро из лодки — с собой. Плавают и гости — от любого причала.
  private sail(client: Client, to: Voyage) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.sea && w.sitting) this.standUp(s);
    const here = w.sea ? 'sea' : w.isle ? 'isle' : 'home';
    if (w.inside || w.sitting || w.bed || !nearBoat(w) || to === here || this.shared === (here === 'home')) { this.reject(client, s); return; }
    s.dig = null; s.cook = 0;
    if (!this.shared) {                                 // от причала: встаёт у лодки и отчаливает
      const p = boatPoint();
      Object.assign(w, { x: p.x, y: p.y, dir: 'left', rest: false, bed: false });
      this.moved(client, s);
      this.tell(client, 'voyage', { to });
      return;
    }
    if (to === 'home') { w.rest = false; this.syncView(s); void this.save(s, true); this.tell(client, 'voyage', { to }); return; }
    const p = to === 'isle' ? Isle.landing : this.seaPlace();
    Object.assign(w, { isle: to === 'isle', sea: to === 'sea', x: p.x, y: p.y, dir: to === 'isle' ? 'up' : 'left', rest: false, bed: false });
    this.see(w, to);
    this.moved(client, s);
    if (!w.sea && s.boat.length) this.unload(client, s);
  }
  // Герой перешёл из кадра в кадр: копка и жарка — сначала, запас хода полон (прыжок — не шаг), игроку — где он теперь.
  private moved(client: Client, s: Session) {
    s.dig = null; s.cook = 0; s.budget = BUDGET_MAX; s.dirty = true;
    this.syncView(s);
    this.reject(client, s);
    void this.save(s, true);                             // сразу: перезашёл — и он там же, где был, а не по ту сторону двери
  }

  // Рюкзак надевают стоя рядом с ним, снимают — на землю возле себя. Сидя он остаётся там, где был: на спине или на земле.
  private packOn(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.sitting || w.inside || w.isle || w.sea || w.pack.worn || dist(w, w.pack) > REACH + SLACK) { this.reject(client, s); return; }   // рюкзак лежит у причала
    w.pack.worn = true; s.dirty = true;
    this.syncView(s);
  }

  private packOff(client: Client, x: number, y: number) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world;
    if (w.sitting || w.inside || w.isle || w.sea || s.home || !w.pack.worn || dist(w, { x, y }) > PUT_REACH || !gridOf(w).canWalk(x, y)) { this.reject(client, s); return; }   // в доме и в общих водах рюкзак не снимают: место рюкзака — у причала; в гостях — тоже: оно помнится только дома
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
    if (s.world.inside) { this.tellItems(client, s, 'indoor'); return; }   // земля — снаружи
    if (!s.hands.includes(it) && !packInReach(s.world, s.world.pack, SLACK)) { this.tellItems(client, s, 'far'); return; }
    if (s.world.sea) { this.toBoat(client, s, it); return; }   // в океане — в лодку
    this.layDown(client, s, it, ITEMS.dropSpot(s.world, this.groundHere(s.world), gridOf(s.world).canWalk));
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
    if ([...r.back, ...r.hands].some(it => ITEMS.isBucket(it.kind))) this.tellBags(client, s);   // ведро взяли в руку или убрали — что в руках
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
    if (ITEMS.isBucket(r.item.kind)) this.tellBags(client, s);
  }

  // Положить вещь из руки left (не назвали — из первой) на землю рядом с собой — туда, куда показал игрок.
  private itemPut(client: Client, x: number, y: number, left?: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, it = left === undefined ? s.hands[0] : ITEMS.inHand(s.hands, left ? 'left' : 'right');
    if (w.inside) { this.tellItems(client, s, 'indoor'); return; }
    if (w.sea) { if (it) this.toBoat(client, s, it); else this.tellItems(client, s); return; }   // в океане — ведро в лодку, остальное утонет
    if (!it || w.sitting || dist(w, { x, y }) > PUT_REACH || !gridOf(w).canWalk(x, y)) { this.tellItems(client, s); return; }
    this.layDown(client, s, it, { x: Math.round(x), y: Math.round(y) });
  }

  // Вещь игрока ложится на землю. Видно её всем сразу, а поднять можно, когда она записана в базу: тогда о ней узнают
  // и другие копии причала. Лампа из руки ложится такой, какой была: горящей или погашенной, ведро — со своим уловом
  // (его видят все, и достать рыбу может любой). Своих вещей на земле — не больше GROUND_MAX.
  private layDown(client: Client, s: Session, it: Item, at: { x: number; y: number }) {
    if (it.id < 0) { this.tellItems(client, s); return; }   // рыба, только что вынутая из ведра, ещё пишется в базу
    if ([...this.ground.values()].filter(g => g.owner === s.pid).length >= ITEMS.GROUND_MAX) { this.tellItems(client, s, 'litter'); return; }
    const lit = it.kind === 'lamp' && s.world.lamp && s.hands.includes(it);   // из рюкзака лампа ложится погашенной: там она не горела
    s.hands = s.hands.filter(h => h !== it); s.items = s.items.filter(h => h !== it);
    const fish = ITEMS.isFish(it.kind) ? it.fish ?? '' : '';   // у рыбы — её вид; хвосты над ведром — из его улова (setGround)
    const g: Ground = { id: it.id, kind: it.kind, x: at.x, y: at.y, lit, fish, owner: s.pid, ready: false, isle: s.world.isle, ...(ITEMS.isBait(it.kind) && { worms: it.worms ?? 0 }) };
    const pail = ITEMS.isBucket(it.kind);
    if (pail && !this.bags.has(it.id)) this.bags.set(it.id, emptyBag());
    this.setGround(g);
    this.syncView(s);                                   // выложил лампу из руки — у него в руке свет погас
    this.tellItems(client, s);                          // окно рюкзака узнаёт, что вещи у него больше нет
    if (pail) this.tellBags(client, s);
    this.write(s, async () => {
      try { await dropItem(db, s.pid, g, g.isle ? this.isleSite : this.site); }
      catch (err) { this.dropGround(g.id); throw err; }  // не записалась — вещь так и лежит у него в базе и вернётся при следующем входе
      g.ready = true;
      this.news({ e: 'put', it: { id: g.id, kind: g.kind, x: g.x, y: g.y, lit: g.lit, fish: g.fish, owner: g.owner, ...(g.worms !== undefined && { worms: g.worms }) }, isle: g.isle, ...(pail && { bag: this.bags.get(g.id) }) });
    });
  }

  // Поднять вещь с земли, стоя рядом: свою или чужую. Она идёт в руку left (не назвали — в свободную), а если рука занята — в рюкзак, когда он под
  // рукой и в нём есть место. Вещь становится своей: в базе у неё меняется хозяин (ведро — вместе с уловом). С земли она пропадает сразу, но
  // её могли в тот же миг поднять в другой копии причала — тогда база скажет, что не вышло, и вещь у игрока пропадёт.
  private itemPick(client: Client, id: number, left?: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, g = this.ground.get(id);
    if (w.sea || this.atBoat(s) && s.boat.some(b => b.id === id)) { this.fromBoat(client, s, id, left); return; }   // в океане — только ведро из своей лодки; на берегу — и у лодки, если оно там осталось
    if (!g || !g.ready || w.sitting || w.inside || g.isle !== w.isle || dist(w, g) > REACH + SLACK) { this.tellItems(client, s); return; }
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
    const pail = ITEMS.isBucket(g.kind);
    if (pail) this.tellBags(client, s);
    this.write(s, async () => {
      let ok: boolean;
      try { ok = await claimItem(db, s.pid, { ...mine, held }); }
      catch (err) { this.loseItem(client, s, id); if (!this.ground.has(id)) this.setGround(g); throw err; }   // база не ответила — вещь остаётся на земле
      if (!ok) { this.loseItem(client, s, id, 'gone'); return; }
      this.news({ e: 'gone', id });
      if (lamp) void this.save(s, true);
      if (pail) await this.refresh(id);                 // пока ведро лежало, из него могли достать рыбу в другой копии причала
    });
  }

  // Вещь, которую игроку дали раньше времени, у него забирают обратно (с земли её поднял кто-то другой или база не ответила).
  private loseItem(client: Client, s: Session, id: number, note?: ServerMessages['items']['note']) {
    s.hands = s.hands.filter(h => h.id !== id); s.items = s.items.filter(h => h.id !== id);
    if (!this.ground.has(id)) this.bags.delete(id);
    this.syncView(s);
    if (this.sessions.get(client.sessionId) === s) { this.tellItems(client, s, note); this.tellBags(client, s); }
  }

  // ---------- ведро в лодке (океан) ----------
  // За борт ничего не кладут — утонет; ведро ставят в свою лодку, к ногам рыбака (одно): в него идёт улов, из него
  // достают рыбу. В базе оно лежит «на земле» в лодке игрока (boatPlace), в общей земле его не видно, в лодку к другому
  // не дотянуться. Сошёл на берег — берёт его с собой (unload).

  // Поставить ведро из руки или рюкзака (он на спине) в лодку — можно и сидя на якоре.
  private toBoat(client: Client, s: Session, it: Item) {
    if (!ITEMS.isBucket(it.kind)) { this.tellItems(client, s, 'sea'); return; }
    if (s.boat.length) { this.tellItems(client, s, 'boat'); return; }
    if (it.id < 0) { this.tellItems(client, s); return; }
    s.hands = s.hands.filter(h => h !== it); s.items = s.items.filter(h => h !== it); s.unsynced.delete(it.id);
    const b: Item = { ...ITEMS.unheld(it), x: 0, y: 0, rot: false };
    s.boat = [b];
    this.syncView(s);
    this.tellItems(client, s);
    this.tellBags(client, s);
    this.write(s, () => dropItem(db, s.pid, { id: b.id, kind: b.kind, x: 0, y: 0, lit: false, fish: '' }, boatPlace(s.pid)));
  }
  // Взять ведро из лодки в руку left (не назвали — в свободную).
  private fromBoat(client: Client, s: Session, id: number, left?: boolean) {
    const it = s.boat.find(b => b.id === id);
    if (!it) { this.tellItems(client, s); return; }
    const hand = ITEMS.handFor(s.hands, it.kind, left === undefined ? undefined : left ? 'left' : 'right');
    if (!hand) { this.tellItems(client, s, 'busy'); return; }
    const mine: Item = { ...it, left: hand === 'left' };
    s.boat = s.boat.filter(b => b !== it);
    s.hands = ITEMS.inOrder([...s.hands, mine]);
    this.syncView(s);
    this.tellItems(client, s);
    this.tellBags(client, s);
    this.write(s, () => claimItem(db, s.pid, { ...mine, held: true }));
  }
  // Сошёл на берег (или приплыл домой) — ведро из лодки с собой: в свободную руку, а нет её — в рюкзак на спине, если
  // влезет. Некуда — ждёт в лодке до следующего выхода в океан.
  private unload(client: Client, s: Session) {
    for (const it of [...s.boat]) {
      const hand = ITEMS.handFor(s.hands, it.kind), at = hand || !s.world.pack.worn ? null : ITEMS.spot(ITEMS.grid(s.world.pack.kind), s.items, it.kind);
      if (!hand && !at) continue;
      const mine: Item = hand ? { ...it, left: hand === 'left' } : { ...it, ...at! };
      s.boat = s.boat.filter(b => b !== it);
      if (hand) s.hands = ITEMS.inOrder([...s.hands, mine]); else s.items.push(mine);
      this.write(s, () => claimItem(db, s.pid, { ...mine, held: !!hand }));
    }
    this.syncView(s);
    this.tellItems(client, s);
    this.tellBags(client, s);
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
    if (!g || g.kind !== 'lamp' || !g.ready || s.world.sitting || s.world.inside || g.isle !== s.world.isle || dist(s.world, g) > REACH + SLACK || g.lit === on) return;
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
      try {
        const got = await addItem(db, s.pid, kind, { x: it.x, y: it.y, rot: it.rot }); it.id = got.id; if (got.worms !== undefined) it.worms = got.worms;
        if (ITEMS.isBucket(kind)) this.bags.set(got.id, emptyBag());   // новое ведро — пустое
      }
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

  // Земля там, где герой: у причала или на острове (в доме и в океане — никакой).
  private groundHere(w: WorldState) { return w.inside || w.sea ? [] : [...this.ground.values()].filter(g => g.isle === w.isle); }
  // Положить вещь на землю у себя: в память и в состояние комнаты (его видят все). Рыбе — её судьбу (doom). У ведра хвосты
  // над ним и что в нём — из его улова (bags).
  private setGround(g: Ground) {
    this.ground.set(g.id, g);
    const key = String(g.id), v = this.state.ground.get(key) ?? new GroundState();
    const bag = ITEMS.isBucket(g.kind) ? this.bags.get(g.id) ?? emptyBag() : null;
    v.kind = g.kind; v.x = g.x; v.y = g.y; v.lit = g.lit; v.isle = g.isle; v.fish = bag ? bag.recent.join(',') : g.fish; v.end = g.end ?? ''; v.haul = bag ? haulText(bag) : '';
    if (!this.state.ground.has(key)) this.state.ground.set(key, v);
    this.doom(g);
  }
  private dropGround(id: number) {
    this.ground.delete(id); this.state.ground.delete(String(id));
    this.fates.get(id)?.clear(); this.fates.delete(id);
  }

  // Сообщить о земле всем копиям причала — и себе тоже: свои новости применяются повторно, без вреда.
  private news(n: GroundNews) { this.presence.publish(this.channel, n); }
  private onGroundNews = (n: GroundNews) => {
    if (n.e === 'put') {
      const was = this.ground.get(n.it.id);
      if (n.bag && !this.bags.has(n.it.id)) this.bags.set(n.it.id, this.withPending(n.it.id, n.bag));   // ведро принесли из другой копии
      this.setGround({ ...n.it, isle: !!n.isle, ready: true, ...(was?.end && { end: was.end }) });
    }
    else if (n.e === 'end') this.ending(n.id, n.by, false);
    else if (n.e === 'gone') { this.dropGround(n.id); if (!this.holder(n.id)) this.bags.delete(n.id); }   // ведро унесли в другой копии — его улов не наш
    else if (n.e === 'lit') { const g = this.ground.get(n.id); if (g && g.lit !== n.on) this.setGround({ ...g, lit: n.on }); }
    else if (this.ground.has(n.id)) this.applyBag(n.id, n.bag);
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
    if (mine && by === 'cat' && (g.isle || [...this.ground.values()].some(o => o.end === 'cat'))) by = 'gull';   // кот один, он занят (или рыба на острове — туда коту не добраться) — прилетит чайка
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

  // Вёдра под рукой, из которых можно достать рыбу, — по порядку: в руках (правая первой), у сидящего рыбака — у места
  // рыбака, у стоящего — на земле, докуда дотянется (ближнее первым). Чьё ведро на земле, не важно: достать из него может
  // любой. В дом ведро приносят в руке: земля — снаружи.
  private pailsNear(s: Session): Pail[] {
    const out: Pail[] = [...s.hands, ...(s.world.sea || this.atBoat(s) ? s.boat : [])].filter(h => ITEMS.isBucket(h.kind) && h.id > 0).map(h => ({ id: h.id, kind: h.kind, ground: null }));   // в океане и у лодки на берегу — и ведро в лодке
    if (s.world.inside) return out;
    const lying = this.groundHere(s.world).filter(g => ITEMS.isBucket(g.kind) && g.ready), at = fisherAt(s.world);
    if (s.world.sitting) out.push(...lying.filter(g => bucketNearSeat(g, at)).sort((a, b) => dist(a, at) - dist(b, at)).map(g => ({ id: g.id, kind: g.kind, ground: g })));
    else out.push(...lying.filter(g => dist(s.world, g) <= REACH + SLACK).sort((a, b) => dist(a, s.world) - dist(b, s.world)).map(g => ({ id: g.id, kind: g.kind, ground: g })));
    return out;
  }

  // Достать рыбу этого вида из ведра под рукой — названного (id) или первого, где она есть, — в руку left (не назвали — в свободную). В руке она
  // появляется сразу, с временным номером; какую именно рыбу вынуть (самую мелкую) и номер вещи решает база — тогда игроку
  // приходят руки, а ведро — всем, кто его видит.
  private fishTake(client: Client, species: string, left?: boolean, id?: number) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (!FISH.byId[species]) return;
    const near = this.pailsNear(s).filter(p => id === undefined || p.id === id), pail = near.find(p => this.bags.get(p.id)?.counts[species]);
    if (!near.length) { this.tellItems(client, s, 'pail'); return; }
    if (!pail) { this.tellItems(client, s, 'empty'); this.tellBags(client, s); return; }
    const hand = ITEMS.handFor(s.hands, 'fish', left === undefined ? undefined : left ? 'left' : 'right');
    if (!hand) { this.tellItems(client, s, 'busy'); return; }
    const it: Item = { id: -++this.unsaved, kind: 'fish', x: 0, y: 0, rot: false, left: hand === 'left', fish: species };
    s.hands = ITEMS.inOrder([...s.hands, it]);
    takeFromBag(this.bags.get(pail.id)!, species);       // вес и хвосты поправит ведро из базы
    this.shown(pail.id);
    this.syncView(s);
    this.tellItems(client, s);
    this.write(s, async () => {
      let got: Item | null = null;
      try { got = await takeFish(db, s.pid, pail.id, species, hand === 'left'); }
      finally {
        if (got) it.id = got.id; else s.hands = s.hands.filter(h => h !== it);   // рыбы не нашлось (вынули в другой вкладке, ведро унесли) или база не ответила
        this.syncView(s);
        const c = this.clientOf(s);
        if (c) this.tellItems(c, s, got ? undefined : 'empty');
        await this.refresh(pail.id).catch(err => console.error(`ведро ${pail.id} не перечитано:`, err));
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
    if (w.sleep) { if (this.shared) this.callHome(s, now); else if (now >= w.sleep) this.wake(s); return; }   // в общих водах спит не здесь — у себя дома
    w.food = HUNGER.drain(w.food, w.bed ? dt * HUNGER.BED : dt);   // в кровати — медленнее
    if (w.food > 0) w.starve = 0;
    else if ((w.starve += dt) >= HUNGER.STARVE) { this.faint(s, now); return; }
    this.cook(s, dt);
    if (Math.ceil(w.food) !== s.fed) this.tellHunger(s);
  }

  // Сидит у костра с сырой рыбой в руке (уже записанной в базу) — через COOK секунд она пожарится; встал или костёр погас —
  // жарка сначала. Камин в доме горит всегда.
  private cook(s: Session, dt: number) {
    const raw = s.hands.filter(h => ITEMS.isRaw(h.kind) && h.id > 0);
    if (!s.world.rest || !raw.length || (!s.world.inside && !this.lit(s.world.isle))) { s.cook = 0; return; }
    if ((s.cook += dt) < HUNGER.COOK) return;
    s.cook = 0;
    for (const h of raw) h.kind = 'fish-fried';
    this.syncView(s);
    const c = this.clientOf(s);
    if (c) { this.tellItems(c, s); for (const h of raw) this.tell(c, 'food', { e: 'cooked', fish: h.fish ?? '' }); }
    const ids = raw.map(h => h.id);
    this.write(s, () => cookItems(db, s.pid, ids));
  }

  // Герой уснул от голода там, где стоял (сидел — встаёт): SLEEP секунд он ничего не может, а пока он без сознания, из
  // рюкзака и рук крадут часть вещей (HUNGER.lost) — какие попадутся, ведро вместе с уловом тоже. Что на земле и в
  // холодильнике, не трогают. Что пропало, он увидит в рюкзаке; проснувшись, узнает, что мог что-то потерять (tellHunger woke).
  private faint(s: Session, now: number) {
    const w = s.world;
    if (w.sitting) { s.fishing.leave(); const p = standFrom(w); Object.assign(w, { sitting: false, x: p.x, y: p.y, dir: 'down' }); }
    w.rest = false; w.bed = false; w.starve = 0; w.sleep = now + HUNGER.SLEEP * 1000; s.cook = 0; s.dig = null; s.dirty = true;
    const pack = s.home && !w.pack.worn ? [] : s.items;          // гость без рюкзака: рюкзак у него дома, из него не украсть
    const all = [...s.hands, ...pack].filter(it => it.id > 0);   // ещё не записанную вещь не украсть: её номера пока нет
    const gone = new Set(all.sort(() => Math.random() - 0.5).slice(0, HUNGER.lost(all.length)).map(it => it.id));
    if (gone.size) {
      s.hands = s.hands.filter(it => !gone.has(it.id)); s.items = s.items.filter(it => !gone.has(it.id));
      for (const id of gone) { s.unsynced.delete(id); this.bags.delete(id); }
      const ids = [...gone];
      this.write(s, () => robItems(db, s.pid, ids));
    }
    this.syncView(s);
    const c = this.clientOf(s);
    if (c) { this.reject(c, s); if (gone.size) { this.tellItems(c, s); this.tellBags(c, s); } }
    this.tellHunger(s);
    if (!this.shared) { void this.save(s, true); return; }   // сон — сразу: перезайти, чтобы не спать, не выйдет
    // В общих водах спящему не место: лодку прибило к своему причалу — спит он у дома, а браузер переходит туда.
    s.ashore = true; s.called = now;                     // зовём, когда сон уже в базе, — повторит callHome
    void this.save(s, true).then(() => { s.called = 0; this.callHome(s, Date.now()); });
  }

  // Выспался: у крыльца дома (уснул в доме — всё равно у крыльца), сытый.
  private rise(w: WorldState) {
    const p = homePoint();
    Object.assign(w, { x: p.x, y: p.y, dir: 'down', sitting: false, rest: false, bed: false, inside: false, isle: false, sea: false, food: HUNGER.MAX, starve: 0, sleep: 0 });
  }
  private wake(s: Session) {
    this.rise(s.world);
    s.budget = BUDGET_MAX; s.dirty = true;
    this.syncView(s);
    const c = this.clientOf(s);
    if (c) this.reject(c, s);                           // «self» — он теперь у дома
    this.tellHunger(s, true);
    void this.save(s, true);
  }

  // Спит в общих водах (уснул тут или вошёл спящим) — ему тут не место, лодку прибило к своему причалу: «voyage» домой со slept,
  // и браузер входит к себе; пока не ушёл — не чаще раза в CALL_HOME мс, проснуться ему там же, у дома.
  private callHome(s: Session, now: number) {
    if (now - s.called < CALL_HOME) return;
    const c = this.clientOf(s); if (!c) return;
    s.called = now;
    this.tell(c, 'voyage', { to: 'home', slept: true });
  }

  // Сытость и сон — игроку. woke — он только что проснулся: пока спал, у него могли украсть вещи.
  private tellHunger(s: Session, woke = false) {
    const w = s.world;
    s.fed = Math.ceil(w.food); s.dirty = true;
    const c = this.clientOf(s);
    if (c) this.tell(c, 'hunger', { food: s.fed, sleep: w.sleep ? Math.max(0, w.sleep - Date.now()) : 0, ...(woke && { woke }) });
  }

  // ---------- холодильник (FRIDGE) ----------
  // У каждого своя полка: что на ней, сервер помнит (s.fridge) и пишет в базу в очереди вещей. Рыба на полке не портится,
  // и во сне от голода из холодильника ничего не пропадает — крадут только из рюкзака и рук.

  // Положить рыбу из руки left (не назвали — первую, какая есть) в холодильник — стоя у него.
  private fridgePut(client: Client, left?: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (!s.world.inside || s.world.bed || !Indoor.nearFridge(s.world)) { this.tellFridge(client, s, 'far'); return; }
    const it = s.hands.find(h => ITEMS.isFish(h.kind) && h.id > 0 && (left === undefined || !!h.left === left));
    if (!it) { this.tellFridge(client, s, 'empty'); return; }
    if (s.fridge.length >= FRIDGE.MAX) { this.tellFridge(client, s, 'full'); return; }
    s.hands = s.hands.filter(h => h !== it);
    s.fridge.push({ id: it.id, kind: it.kind as Chilled['kind'], fish: it.fish ?? '' });
    this.syncView(s);
    this.tellItems(client, s);
    this.tellFridge(client, s);
    this.write(s, async () => { if (!await fridgePut(db, s.pid, it.id)) await this.reloadFridge(s); });
  }
  // Достать рыбу id из холодильника в руку left (не назвали — в свободную).
  private fridgeTake(client: Client, id: number, left?: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (!s.world.inside || s.world.bed || !Indoor.nearFridge(s.world)) { this.tellFridge(client, s, 'far'); return; }
    const k = s.fridge.findIndex(f => f.id === id), f = s.fridge[k];
    if (!f) { this.tellFridge(client, s, 'empty'); return; }
    const hand = ITEMS.handFor(s.hands, f.kind, left === undefined ? undefined : left ? 'left' : 'right');
    if (!hand) { this.tellFridge(client, s, 'busy'); return; }
    const it: Item = { id: f.id, kind: f.kind, x: 0, y: 0, rot: false, left: hand === 'left', fish: f.fish };
    s.fridge.splice(k, 1);
    s.hands = ITEMS.inOrder([...s.hands, it]);
    this.syncView(s);
    this.tellItems(client, s);
    this.tellFridge(client, s);
    this.write(s, async () => {
      if (await fridgeTake(db, s.pid, f.id, hand === 'left')) return;
      s.hands = s.hands.filter(h => h !== it);           // её уже вынули в другой вкладке
      await this.reloadFridge(s);
      const c = this.clientOf(s); if (c) this.tellItems(c, s);
    });
  }
  // Переложить улов из ведра в руке (первого, где есть рыба) в холодильник, сколько влезет (земля снаружи).
  private fridgeStock(client: Client) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (!s.world.inside || s.world.bed || !Indoor.nearFridge(s.world)) { this.tellFridge(client, s, 'far'); return; }
    const pails = s.hands.filter(h => ITEMS.isBucket(h.kind) && h.id > 0), pail = pails.find(h => this.bags.get(h.id)?.total);
    if (!pails.length) { this.tellFridge(client, s, 'pail'); return; }
    if (!pail) { this.tellFridge(client, s, 'empty'); return; }
    if (s.fridge.length >= FRIDGE.MAX) { this.tellFridge(client, s, 'full'); return; }
    this.write(s, async () => {
      let n = 0;
      try { n = await fridgeStock(db, s.pid, pail.id); s.fridge = await loadFridge(db, s.pid); await this.refresh(pail.id); }
      finally {
        this.syncView(s);
        const c = this.clientOf(s);
        if (c) this.tellFridge(c, s, n ? undefined : 'empty', n);   // ведро — уже у него (refresh): по нему видно, всё ли влезло
      }
    });
  }
  // Полка заново из базы (только в очереди записей) — игроку тоже.
  private async reloadFridge(s: Session) {
    s.fridge = await loadFridge(db, s.pid);
    const c = this.clientOf(s); if (c) this.tellFridge(c, s);
  }

  // ---------- сундук (CHESTS) ----------
  // Свой сундук в доме: что в нём, сервер помнит (s.chest) и пишет в базу в очереди вещей. В чужой дом не войти, а во сне
  // из сундука не крадут — вещи в нём целы. Рыбе в нём не место: для неё холодильник.

  private atChest(s: Session) { return s.world.inside && !s.world.bed && Indoor.nearChest(s.world); }
  private tellChest(client: Client, s: Session, note?: ServerMessages['chest']['note']) { this.tell(client, 'chest', { kind: s.chest.kind, list: s.chest.list, ...(note && { note }) }); }
  // Куда встанет вещь в сетке g: в клетку at (если влезет) или на первое свободное место; null — некуда.
  private cellFor(g: { w: number; h: number }, list: readonly Item[], it: Item, at: Place | null): Place | null {
    if (!at) return ITEMS.spot(g, list, it.kind);
    const rot = at.rot && ITEMS.turns(it.kind);
    return ITEMS.fits(g, list, it.kind, at.x, at.y, rot, it.id) ? { x: at.x, y: at.y, rot } : null;
  }
  // Не вышло — и сундук, и рюкзак как они есть на самом деле (окно могло уже показать перекладку).
  private undoChest(client: Client, s: Session, note?: ServerMessages['chest']['note']) { this.tellChest(client, s, note); this.tellItems(client, s); }

  // Положить вещь из рюкзака (он на спине или рядом) или из рук в сундук: в клетку at или на свободное место.
  private chestPut(client: Client, id: number, at: Place | null) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const held = s.hands.find(h => h.id === id), it = held ?? s.items.find(h => h.id === id);
    if (!it || id < 0) { this.undoChest(client, s); return; }
    if (!this.atChest(s) || (!held && !packInReach(s.world, s.world.pack, SLACK))) { this.undoChest(client, s, 'far'); return; }
    if (ITEMS.isFish(it.kind)) { this.undoChest(client, s, 'fish'); return; }
    if (ITEMS.isBucket(it.kind) && (this.bags.get(id)?.total || this.pending.get(id)?.length)) { this.undoChest(client, s, 'catch'); return; }   // улов — в холодильник, не в сундук
    const cell = this.cellFor(CHESTS.grid(s.chest.kind), s.chest.list, it, at);
    if (!cell) { this.undoChest(client, s, at ? undefined : 'full'); return; }
    const put: Item = { ...ITEMS.unheld(it), ...cell };
    if (held) s.hands = s.hands.filter(h => h !== it); else s.items = s.items.filter(h => h !== it);
    s.unsynced.delete(id);
    s.chest.list = [...s.chest.list, put];
    if (ITEMS.isBucket(it.kind)) { this.bags.delete(id); if (held) this.tellBags(client, s); }   // ведро в сундуке — его улов комнате больше не нужен
    this.syncView(s);
    this.tellItems(client, s);
    this.tellChest(client, s);
    this.write(s, async () => { if (!await chestPlace(db, s.pid, put, true)) await this.reloadChest(s); });
  }
  // Вынуть вещь из сундука в рюкзак (он на спине или рядом): в клетку at или на свободное место.
  private chestTake(client: Client, id: number, at: Place | null) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const it = s.chest.list.find(c => c.id === id);
    if (!it) { this.undoChest(client, s); return; }
    if (!this.atChest(s) || !packInReach(s.world, s.world.pack, SLACK)) { this.undoChest(client, s, 'far'); return; }
    const cell = this.cellFor(ITEMS.grid(s.world.pack.kind), s.items, it, at);
    if (!cell) { this.undoChest(client, s, at ? undefined : 'full'); return; }
    const back: Item = { ...it, ...cell };
    s.chest.list = s.chest.list.filter(c => c !== it);
    s.items = [...s.items, back].sort((a, b) => a.id - b.id);
    this.tellItems(client, s);
    this.tellChest(client, s);
    this.write(s, async () => {
      if (!await chestPlace(db, s.pid, back, false)) { s.items = s.items.filter(h => h !== back); await this.reloadChest(s); const c = this.clientOf(s); if (c) this.tellItems(c, s); return; }
      if (ITEMS.isBucket(back.kind)) { const bag = (await loadBags(db, [id])).get(id); if (bag) this.bags.set(id, this.withPending(id, bag)); }   // ведро снова с ним — и его улов
    });
  }
  // Переложить вещь в сундуке.
  private chestMove(client: Client, id: number, x: number, y: number, rot: boolean) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const it = s.chest.list.find(c => c.id === id);
    if (!it) { this.tellChest(client, s); return; }
    if (!this.atChest(s)) { this.tellChest(client, s, 'far'); return; }
    const cell = this.cellFor(CHESTS.grid(s.chest.kind), s.chest.list, it, { x, y, rot });
    if (!cell) { this.tellChest(client, s); return; }
    if (it.x === cell.x && it.y === cell.y && it.rot === cell.rot) return;
    Object.assign(it, cell);
    this.write(s, () => chestMove(db, s.pid, [it]));
  }
  // Другой сундук: вещи должны в него влезть. Тесно — оставляем прежний и говорим почему; влезли, но не на свои места —
  // раскладываем заново и присылаем, где они теперь.
  private chestKind(client: Client, kind: ChestKind) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    if (s.chest.kind === kind) return;
    if (!this.atChest(s)) { this.tellChest(client, s, 'far'); return; }
    const list = ITEMS.repack(CHESTS.grid(kind), s.chest.list);
    if (!list) { this.tellChest(client, s, 'tight'); return; }
    const was = new Map(s.chest.list.map(it => [it.id, it]));
    const moved = list.filter(it => { const o = was.get(it.id)!; return o.x !== it.x || o.y !== it.y || o.rot !== it.rot; });
    s.chest = { kind, list: list.sort((a, b) => a.id - b.id) };
    this.tellChest(client, s);
    this.write(s, async () => { await chestMove(db, s.pid, moved); await setChestKind(db, s.pid, kind); });
  }
  // Сундук заново из базы (только в очереди записей) — игроку тоже.
  private async reloadChest(s: Session) {
    s.chest = await loadChest(db, s.pid);
    const c = this.clientOf(s); if (c) this.tellChest(c, s);
  }

  // ---------- в гости ----------

  // На каких причалах сейчас есть игроки (кроме этого): копии одного причала складываем. Знает матчмейкер — и о комнатах
  // других процессов (через Redis).
  private async piers(client: Client) {
    const by = new Map<string, PierInfo>();
    for (const r of await matchMaker.query({ name: ROOM })) {
      const m = r.metadata as { owner?: string; name?: string } | undefined;
      if (!m?.owner || m.owner === this.owner || !r.clients) continue;
      const p = by.get(m.owner) ?? { owner: m.owner, name: m.name ?? '', players: 0 };
      p.players += r.clients; by.set(m.owner, p);
    }
    this.tell(client, 'piers', { list: [...by.values()].sort((a, b) => b.players - a.players || a.name.localeCompare(b.name)) });
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
    if (w.inside || w.isle || w.sea) { no('ground'); return; }   // в доме пол, на острове песок и корни — не трава, в океане — вода
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
    this.presence.hset(this.pits, id, JSON.stringify(hole));
    this.presence.publish(this.pits, { id, ...hole });
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
    for (const [id, h] of this.holes) if (!WORMS.fresh(h, now)) { this.holes.delete(id); this.state.holes.delete(id); void this.presence.hdel(this.pits, id); }
  }

  // ---------- рыбалка ----------

  // Куда класть улов: ведро, в котором есть место (ITEMS.capacity). Сначала своё — в руке или выложенное им самим у места
  // рыбака, потом ближайшее к месту рыбака чужое. null — некуда: вёдер нет или все полны (hasBucket скажет, что из двух).
  private bucketFor(s: Session): Pail | null {
    return this.pails(s).find(p => (this.bags.get(p.id)?.total ?? 0) < ITEMS.capacity(p.kind)) ?? null;
  }
  private pails(s: Session): Pail[] {
    const held: Pail[] = [...s.hands, ...(s.world.sea ? s.boat : [])].filter(h => ITEMS.isBucket(h.kind) && h.id > 0).map(h => ({ id: h.id, kind: h.kind, ground: null }));   // в океане — и ведро в лодке
    const at = fisherAt(s.world), rank = (g: Ground) => (g.owner === s.pid ? 0 : 1000) + dist(g, at);   // на берегу острова — у того места, где сидит
    const lying = this.groundHere(s.world).filter(g => ITEMS.isBucket(g.kind) && bucketNearSeat(g, at)).sort((a, b) => rank(a) - rank(b));
    return [...held, ...lying.map(g => ({ id: g.id, kind: g.kind, ground: g }))];
  }
  private hasBucket(s: Session) { return this.pails(s).length > 0; }

  // Подсечка: рыба ложится в ведро (bucketFor) сразу — её видят все, кто видит ведро, — а в базу пишется в очереди записей,
  // и пока не записана, лежит в pending: так её не потеряет ни одно перечитывание ведра. Впервые ли пойман вид и рекорд ли —
  // по всему улову игрока (life).
  private onFishing(client: Client, s: Session, ev: FishingEvent) {
    if (ev.e !== 'hook') { this.tell(client, 'fish', ev); return; }
    const fish = ev.fish, b = this.bucketFor(s);
    if (!b) { this.tell(client, 'fish', { e: 'bucketFull' }); return; }   // fishing подсекает, только когда место есть, — на всякий случай
    const bag = this.bags.get(b.id) ?? emptyBag();
    this.bags.set(b.id, bag);
    addToBag(bag, fish);
    const { first, record } = addToBag(s.life, fish);
    this.pending.set(b.id, [...this.pending.get(b.id) ?? [], fish]);
    const g = this.ground.get(b.id); if (g) this.setGround(g);   // хвосты над ведром и что в нём — всем
    this.syncView(s);
    this.tell(client, 'fish', { ...ev, pail: { id: b.id, n: bag.total, size: ITEMS.capacity(b.kind) }, ...(first && { first }), ...(record && { record }), ...(!g && { bags: this.handBags(s) }) });
    this.write(s, async () => {
      try { await recordCatch(db, s.pid, fish, b.id); }
      catch (err) { console.error(`улов ${s.pid} ${fish.id} ${fish.grams} г в ведро ${b.id} не записан:`, err); }
      finally { const rest = (this.pending.get(b.id) ?? []).filter(f => f !== fish); if (rest.length) this.pending.set(b.id, rest); else this.pending.delete(b.id); }
      await this.refresh(b.id);                          // не записалась — из ведра она и пропадёт
    });
  }

  // ---------- что в вёдрах (bags) ----------

  // Улов ведра, как он записан в базе, и к нему — рыба этой копии, которая ещё пишется (pending).
  private withPending(id: number, bag: Bag) {
    const out = structuredClone(bag);
    for (const f of this.pending.get(id) ?? []) addToBag(out, f);
    return out;
  }
  // Вёдра у него в руках — с тем, что в них (GameHands), и ведро в его лодке (boat): в океане оно у ног, а на берегу осталось
  // в лодке, когда руки были заняты, — взять его можно у лодки.
  private handBags(s: Session): ServerMessages['bags'] {
    return [
      ...s.hands.filter(h => ITEMS.isBucket(h.kind)).map(h => ({ id: h.id, left: !!h.left, bag: this.bags.get(h.id) ?? emptyBag() })),
      ...s.boat.map(h => ({ id: h.id, left: false, bag: this.bags.get(h.id) ?? emptyBag(), boat: true })),
    ];
  }
  // Стоит у своей лодки на берегу (у мостков причала или на пляже острова): ведро, оставшееся в ней, — под рукой.
  private atBoat(s: Session) { const w = s.world; return !w.sea && !w.inside && !w.sitting && !w.bed && nearBoat(w); }
  private tellBags(client: Client, s: Session) { this.tell(client, 'bags', this.handBags(s)); }
  // Игрок этой копии, у которого вещь id — в руках или в рюкзаке.
  private holder(id: number) {
    for (const s of this.sessions.values()) if (s.hands.some(h => h.id === id) || s.items.some(h => h.id === id) || s.boat.some(h => h.id === id)) return s;
    return null;
  }
  // Улов ведра поменялся здесь: на земле — в состояние комнаты (хвосты и что в нём), в руке — тому, у кого оно.
  private shown(id: number) {
    const g = this.ground.get(id); if (g) this.setGround(g);
    const s = this.holder(id); if (!s) return;
    this.syncView(s);
    const c = this.clientOf(s);
    if (c && (s.hands.some(h => h.id === id) || s.boat.some(h => h.id === id))) this.tellBags(c, s);
  }
  // Улов ведра — как он записан в базе (к нему — своя ещё не записанная рыба). Не поменялся — молчим: иначе у того, кто
  // поймал, счёт в ведре вырос бы раньше, чем рыба долетела.
  private applyBag(id: number, dbBag: Bag) {
    const bag = this.withPending(id, dbBag), was = this.bags.get(id);
    this.bags.set(id, bag);
    if (!was || bagKey(was) !== bagKey(bag)) this.shown(id);
  }
  // Перечитать ведро из базы — в очереди записей, после того как в нём что-то поменялось. Ведро на земле — новость всем копиям
  // причала (и себе): каждая добавит к нему свою ещё не записанную рыбу. В руке или в рюкзаке — только у себя.
  private async refresh(id: number) {
    const bag = (await loadBags(db, [id])).get(id)!;
    if (this.ground.has(id)) this.news({ e: 'bag', id, bag });
    else if (this.holder(id)) this.applyBag(id, bag);
  }

  private tick(dt: number) {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      s.fishing.update(dt);
      s.budget = Math.min(BUDGET_MAX, s.budget + SPEED * RUN * 1.25 * HUNGER.pace(s.world.food) * (s.world.sea ? SEA.ROW : 1) * dt);   // голодный ходит медленнее, на вёслах — тоже
      this.hunger(s, dt, now);
      if (s.eat && now >= s.eat.until) { s.eat = null; this.syncView(s); }   // доел
      if (s.dig && now >= s.dig.until) this.dug(s);
    }
    if ((this.weed -= dt) <= 0) { this.weed = 5; this.weedHoles(); }
  }

  // ---------- состояние и база ----------

  private syncView(s: Session) {
    const w = s.world, v = s.view;
    v.x = w.x; v.y = w.y; v.dir = w.dir; v.sitting = w.sitting; v.rest = w.rest; v.bed = w.bed; v.inside = w.inside; v.isle = w.isle; v.sea = w.sea;
    v.boat = s.boat[0]?.kind ?? '';
    v.wearing = w.pack.worn; v.px = w.pack.x; v.py = w.pack.y; v.pack = w.pack.kind;
    v.hand = s.hands.find(h => !h.left)?.kind ?? ''; v.off = s.hands.find(h => h.left)?.kind ?? '';
    v.lamp = w.lamp && ITEMS.lampOut(s.hands);
    v.sleep = !!w.sleep;
    v.eat = s.eat?.kind ?? ''; v.eatLeft = !!s.eat?.left;
    v.dig = !!s.dig;
    const pail = s.hands.find(h => ITEMS.isBucket(h.kind)) ?? (w.sea ? s.boat[0] : undefined), recent = pail ? (this.bags.get(pail.id)?.recent ?? []).filter(id => FISH.byId[id]) : [];   // хвосты из ведра в руке (в океане — или в лодке)
    if (v.recent.length !== recent.length || recent.some((id, i) => v.recent[i] !== id)) {
      v.recent.clear(); for (const id of recent) v.recent.push(id);
    }
  }

  private async save(s: Session, force: boolean) {
    if (!s.dirty && !force) return;
    s.dirty = false;
    const w = s.world, h = s.home;                       // в гостях дома всё как было — кроме того, что он носит с собой, и того, где побывал
    try {
      if (h) {
        // уснул в общих водах — его лодку прибило к своему причалу: дома он и спит, у крыльца
        // (и при каком положении картинки записано место, и рюкзак у причала — в тех же координатах: cleanWorld их не сдвинет)
        const at = s.ashore ? (() => { const p = homePoint(); return { x: p.x, y: p.y, dir: 'down' as const, sitting: false, rest: false, bed: false, inside: false, isle: false, sea: false, picX: World.pic.x, picY: World.pic.y, pack: { ...h.pack, kind: w.pack.kind } }; })() : {};
        const patch = { food: w.food, starve: w.starve, sleep: w.sleep, lamp: w.lamp, seen: w.seen, ...at };
        await saveAway(db, s.pid, patch, w.pack.kind, { ...h, ...patch, pack: { ...h.pack, kind: w.pack.kind } });
      }
      else await saveWorld(db, s.pid, { ...w, pack: { ...w.pack } });
    }
    catch (err) { s.dirty = true; console.error(`не сохранилось место игрока ${s.pid}:`, err); }
  }
  private async saveAll(force: boolean) { await Promise.all([...this.sessions.values()].map(s => this.save(s, force))); }

  private tell<K extends keyof ServerMessages>(client: Client, type: K, message: ServerMessages[K]) { client.send(type, message); }
}
