// Комната-причал: общий мир на ROOM_SIZE игроков. Когда она полна, матчмейкер Colyseus открывает ещё одну.
//
// Кто здесь главный:
// - ходит клиент сам (так нет задержки), а сервер проверяет каждый шаг: в проходимую ли клетку и не быстрее ли, чем можно;
//   не принял — шлёт игроку «self», и тот встаёт туда, где сервер его видит;
// - рыбалку ведёт только сервер: когда клюёт, кто клюнул, успел ли подсечь. Клиент шлёт лишь нажатия;
// - улов пишется в базу сразу при подсечке, место героя, ведра и рюкзака — при выходе и раз в минуту.

import { Room, definePlugins, type Client } from 'colyseus';
import { UniqueSessionPlugin } from 'colyseus/plugins/unique-session';
import { z } from 'zod';
import {
  World, FISH, DIRS, PACK_KINDS, ROOM_SIZE, SPEED, REACH, PUT_REACH, NEAR_PIER, HOOK_GRACE,
  createFishing, addToBag, nearSeat, bucketNearSeat, standPoint, startState, dist, seat,
  type Bag, type Fishing, type FishingEvent, type ServerMessages, type WorldState,
} from '@fh/shared';
import { verifyTicket, loadPlayer, saveWorld, recordCatch, type Ticket } from '@fh/shared/server';
import { db } from './db.ts';
import { Clock } from './clock.ts';
import { PierState, PlayerState } from './state.ts';

const TICK = 50;                    // мс между шагами симуляции (рыбалка, запас хода)
const PATCH = 100;                  // мс между рассылками состояния: 10 раз в секунду хватает спокойной игре
const AUTOSAVE = 60_000;            // мс между сохранениями места героя в базу
const RECONNECT = 20;               // секунд ждём игрока, у которого оборвалась связь
const SLACK = 4;                    // арт-пикселей прощаем на округления и рывки сети
const BUDGET_MAX = 26;              // запас хода копится, пока сообщения идут пачкой, но не больше этого

interface Session {
  pid: string;
  name: string;
  world: WorldState;                // где игрок на самом деле — по мнению сервера
  bag: Bag;
  fishing: Fishing;
  view: PlayerState;                // то, что видят другие
  budget: number;                   // сколько ещё можно пройти, арт-пикселей
  dirty: boolean;                   // место изменилось с прошлого сохранения
}

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const moveMsg = point.extend({ dir: z.enum(DIRS) });
const sitMsg = z.object({ put: point.optional() }).optional();
const packKindMsg = z.object({ kind: z.enum(PACK_KINDS) });
const clockMsg = z.object({ hour: z.number().min(0).max(24).nullable() });

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
  private offClock = () => {};        // отписка от часов причала

  onCreate() {
    this.setPatchRate(PATCH);
    // Часы причала перевели (в разработке) — время суток меняется сразу у всех, кто в комнате.
    this.offClock = Clock.onChange(() => this.broadcast('clock', this.timeNow()));
    this.onMessage('clock', clockMsg, (_client, m) => { if (Clock.canSet) Clock.setHour(m.hour); });
    this.setSimulationInterval(dt => this.tick(dt / 1000), TICK);
    this.clock.setInterval(() => this.saveAll(false), AUTOSAVE);

    this.onMessage('move', moveMsg, (client, m) => this.move(client, m.x, m.y, m.dir));
    this.onMessage('sit', sitMsg, (client, m) => this.sit(client, m?.put));
    this.onMessage('stand', client => this.withSession(client, s => this.standUp(s)));
    this.onMessage('pick', client => this.pick(client));
    this.onMessage('put', point, (client, m) => this.put(client, m.x, m.y));
    this.onMessage('press', client => this.withSession(client, s => { if (s.world.sitting) s.fishing.press(); }));
    this.onMessage('packOn', client => this.packOn(client));
    this.onMessage('packOff', point, (client, m) => this.packOff(client, m.x, m.y));
    this.onMessage('packKind', packKindMsg, (client, m) => this.withSession(client, s => {
      if (s.world.pack.kind === m.kind) return;
      s.world.pack.kind = m.kind; s.dirty = true;
      this.syncView(s);
    }));
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
    const view = new PlayerState();
    view.pid = saved.id; view.name = saved.name;
    const s: Session = {
      pid: saved.id, name: saved.name, world, bag: saved.bag, view, budget: BUDGET_MAX, dirty: false,
      fishing: createFishing({ hasBucket: () => bucketNearSeat(s.world.bucket), emit: ev => this.onFishing(client, s, ev), grace: HOOK_GRACE }),
    };
    if (world.sitting) s.fishing.sit();
    this.sessions.set(client.sessionId, s);
    this.syncView(s);
    this.state.players.set(client.sessionId, view);
    this.tell(client, 'clock', this.timeNow());        // время суток клиент считает сам, но по часам причала
    this.tell(client, 'self', world);
    this.tell(client, 'bag', s.bag);
  }

  // Связь оборвалась сама — держим героя на месте, пока клиент переподключается.
  async onDrop(client: Client, code?: number) {
    if (code === 1001 || code === 1005 || code === 1006) await this.allowReconnection(client, RECONNECT).catch(() => {});
  }

  async onLeave(client: Client) {
    const s = this.sessions.get(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (s) await this.save(s, true);
  }

  async onDispose() { this.offClock(); await this.saveAll(true); }

  // ---------- действия игрока ----------

  private withSession(client: Client, fn: (s: Session) => void) {
    const s = this.sessions.get(client.sessionId);
    if (s) fn(s);
  }
  private reject(client: Client, s: Session) { this.tell(client, 'self', s.world); }

  private move(client: Client, x: number, y: number, dir: WorldState['dir']) {
    const s = this.sessions.get(client.sessionId); if (!s) return;
    const w = s.world, d = dist(w, { x, y });
    if (w.sitting || !World.canWalk(x, y) || d > s.budget + SLACK) { this.reject(client, s); return; }
    s.budget = Math.max(0, s.budget - d);
    w.x = x; w.y = y; w.dir = dir; s.dirty = true;
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

  private standUp(s: Session) {
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
      s.budget = Math.min(BUDGET_MAX, s.budget + SPEED * 1.25 * dt);
    }
  }

  // ---------- состояние и база ----------

  private syncView(s: Session) {
    const w = s.world, v = s.view;
    v.x = w.x; v.y = w.y; v.dir = w.dir; v.sitting = w.sitting;
    v.carrying = w.bucket.carried; v.bx = w.bucket.x; v.by = w.bucket.y; v.bucketHome = w.bucket.home;
    v.wearing = w.pack.worn; v.px = w.pack.x; v.py = w.pack.y; v.pack = w.pack.kind;
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

  private timeNow(): ServerMessages['clock'] { return { now: Clock.now(), canSet: Clock.canSet, moved: Clock.moved() }; }
  private tell<K extends keyof ServerMessages>(client: Client, type: K, message: ServerMessages[K]) { client.send(type, message); }
}
