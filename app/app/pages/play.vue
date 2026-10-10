<!-- Игра. Страница живёт только в браузере (routeRules в nuxt.config): берём билет у сайта,
     входим в комнату-причал на игровом сервере и запускаем движок на холсте.
     У каждого игрока свой причал; ?pier=<id> — сходить в гости к этому игроку (без него — к себе).
     ?at=isle|sea — в общих водах (общий остров или открытый океан, комната SEA_ROOM), from — от чьего причала отплыл (туда
     и вернётся; без него — к себе). Плывут туда и обратно по слову сервера («voyage»): страница сама меняет адрес и комнату,
     а новый движок начинает с тёмного экрана переправы (arriving). -->
<script setup lang="ts">
import { Client, type Room } from '@colyseus/sdk';
import { ROOM, SEA_ROOM, World, ITEMS, FRIDGE, type ChestKind, type ClientMessages, type ItemKind, type Place, type ServerMessages, type Voyage, type WeatherKind } from '@fh/shared';
import { startGame, type GameHandle } from '~/game/engine';

definePageMeta({ layout: false, middleware: 'auth' });
useHead({ title: 'Причал — Fishing House', bodyAttrs: { class: 'in-game' } });

const game = useGameStore();
const config = useRuntimeConfig();
const route = useRoute();
const router = useRouter();
const { user } = useUserSession();
const canvas = ref<HTMLCanvasElement>();
let room: Room | null = null;
let handle: GameHandle | null = null;

// Адрес игрового сервера: полный (http://localhost:2567) или путь на этом же сайте (/game — за Caddy).
function endpoint() {
  const url = config.public.gameUrl;
  return url.startsWith('/') ? location.origin + url : url;
}

function setWeather(kind: WeatherKind | null, wind: boolean | null) { handle?.setWeather(kind, wind); }
function takeFish(species: string, pail: number) { handle?.takeFish(species, pail); }   // из ведра в руке или рядом — какое показали

// Вещи в рюкзаке и в руках: окно рюкзака просит, сервер решает и, если не согласен, присылает «items» с причиной.
const send = <K extends keyof ClientMessages>(type: K, msg: ClientMessages[K]) => room?.send(type, msg);
const ITEM_NOTES: Record<NonNullable<ServerMessages['items']['note']>, string> = {
  far: 'Рюкзак далеко — подойди к нему',
  full: 'В рюкзаке нет места',
  tight: 'Вещи в этот рюкзак не влезут — сначала выложи лишнее',
  busy: 'Руки заняты — убери вещь в рюкзак',
  hands: 'Нужны обе свободные руки — сначала убери то, что в руках',
  gone: 'Кто-то успел поднять это раньше',
  litter: `На земле уже ${ITEMS.GROUND_MAX} твоих вещей — подбери что-нибудь`,
  raw: 'Сырую рыбу в рюкзак не убрать — пожарь её у костра или съешь',
  pail: 'Ведро далеко — подойди к нему или возьми его в руку',
  empty: 'Такой рыбы в ведре уже нет',
  indoor: 'В доме на пол ничего не кладут — выйди на улицу',
  sea: 'За борт ничего не положить — утонет. В лодку ставят только ведро',
  boat: 'В лодке уже стоит ведро — второе не поставить',
};
// Холодильник в доме: окно просит, сервер решает и присылает полку целиком («fridge»), а если не вышло — почему.
const FRIDGE_NOTES: Record<NonNullable<ServerMessages['fridge']['note']>, string> = {
  far: 'Холодильник далеко — подойди к нему',
  full: `Холодильник полон — в нём уже ${FRIDGE.MAX} рыб`,
  busy: 'Руки заняты — освободи одну, чтобы взять рыбу',
  pail: 'Возьми ведро в руку — улов перекладывают из него',
  empty: 'Класть нечего: ни в руках, ни в ведре рыбы нет',
};
const fishWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'рыба' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'рыбы' : 'рыб');
function moveItem(id: number, x: number, y: number, rot: boolean) { send('itemMove', { id, x, y, rot }); }
function dropItem(id: number) { send('itemDrop', { id }); }
function takeItem(id: number, left?: boolean) { send('itemTake', left === undefined ? { id } : { id, left }); }
function stowItem(id: number, at: Place) { send('itemStow', { id, at }); }
function giveItem(kind: ItemKind) { send('itemGive', { kind }); }
// Сундук в доме: тоже просит окно, а сервер присылает «chest» целиком — и почему не вышло, если не вышло.
const CHEST_NOTES: Record<NonNullable<ServerMessages['chest']['note']>, string> = {
  far: 'Сундук или рюкзак далеко — подойди к сундуку, рюкзак держи на спине или рядом',
  full: 'В сундуке нет места',
  tight: 'Вещи в этот сундук не влезут — сначала забери лишнее',
  fish: 'Рыбе место в холодильнике, а не в сундуке',
  catch: 'Ведро с уловом в сундук не убрать — сначала переложи рыбу в холодильник',
};
function chestPut(id: number, at: Place) { send('chestPut', { id, at }); }
function chestTake(id: number, at: Place) { send('chestTake', { id, at }); }
function chestMove(id: number, x: number, y: number, rot: boolean) { send('chestMove', { id, x, y, rot }); }
function chestKind(kind: ChestKind) { send('chestKind', { kind }); }

// Чей причал открыть: из адреса (?pier=) или свой.
const pierId = () => (typeof route.query.pier === 'string' && route.query.pier) || user.value?.id || '';
// Общие воды из адреса (?at=): на острове или в океане; null — на причале.
const atWaters = (): 'isle' | 'sea' | null => (route.query.at === 'isle' || route.query.at === 'sea' ? route.query.at : null);
// От чьего причала отплыл в общие воды (?from=) — туда и вернётся; без него — к себе.
const fromPier = () => (typeof route.query.from === 'string' && route.query.from) || user.value?.id || '';
let arriving: Voyage | null = null;                     // плывём на лодке — куда: новый движок начнёт с тёмного экрана переправы
// Сходить в гости (или домой): меняем адрес и входим на другой причал. Прежний причал покидаем до входа —
// пусть он успеет сохранить героя.
async function visit(owner: string) {
  arriving = null;
  await router.replace({ query: owner === user.value?.id ? {} : { pier: owner } });
  await connect();
}
// Сервер отпустил плыть в другую комнату: в общие воды — запомним, от чьего причала; домой — к нему (уснул от голода — лодку
// прибило к своему причалу: туда, и без переправы — он спит).
watch(() => game.voyage, async m => {
  if (!m) return;
  game.voyage = null;
  const me = user.value?.id, { pier: _p, at: _a, from: _f, ...keep } = route.query;   // ?hour=, ?debug — остаются
  if (m.to === 'home') {
    const to = m.slept ? '' : fromPier();
    arriving = m.slept ? null : 'home';
    await router.replace({ query: { ...keep, ...(to && to !== me && { pier: to }) } });
  } else {
    const from = atWaters() ? fromPier() : pierId();
    arriving = m.to;
    await router.replace({ query: { ...keep, at: m.to, ...(from && from !== me && { from }) } });
  }
  await connect();
});
// Переплыл между островом и океаном в общих водах — адрес тоже: перезагрузил страницу — и он там же.
watch(() => game.where, where => {
  const at = atWaters();
  if (at && (where === 'isle' || where === 'sea') && where !== at) router.replace({ query: { ...route.query, at: where } });
});

function stop() {
  handle?.destroy(); handle = null;
  const r = room; room = null;
  r?.removeAllListeners();
  return r;
}

// Входы идут по очереди: «В гости» во время входа (или двойной клик) не запустит второй движок поверх первого
// и не выбьет новую комнату старой, вошедшей позже.
let queue: Promise<unknown> = Promise.resolve();
function connect() { return (queue = queue.then(enter, enter)); }

async function enter() {
  await stop()?.leave().catch(() => {});
  const sail = arriving; arriving = null;
  game.reset();
  game.status = sail ? 'sailing' : 'connecting';
  try {
    const { ticket } = await $fetch<{ ticket: string }>('/api/game/ticket', { method: 'POST' });
    const at = atWaters();
    const r = await new Client(endpoint()).joinOrCreate(ROOM, at ? { ticket, pier: SEA_ROOM, to: at } : { ticket, pier: pierId(), ...(sail === 'home' && { to: 'home' as const }) });
    room = r;
    game.roomId = r.roomId;
    r.onMessage('items', (m: ServerMessages['items']) => {
      game.items = m.list; game.hands = m.hands;
      if (m.note) game.showToast(ITEM_NOTES[m.note], 'bad');
    });
    r.onMessage('fridge', (m: ServerMessages['fridge']) => {
      game.fridge = m.list;
      if (m.note) game.showToast(FRIDGE_NOTES[m.note], 'bad');
      else if (m.stocked) game.showToast(`В холодильник легло: ${m.stocked} ${fishWord(m.stocked)}${game.fridge.length >= FRIDGE.MAX && game.bags.some(b => b.bag.total) ? ' — остальное не влезло' : ''}`, 'good');
    });
    r.onMessage('chest', (m: ServerMessages['chest']) => {
      game.chest = { kind: m.kind, list: m.list };
      if (m.note) game.showToast(CHEST_NOTES[m.note], 'bad');
    });
    r.onMessage('piers', (m: ServerMessages['piers']) => { game.piers = m.list; });
    r.onDrop(() => { game.status = 'reconnecting'; });
    r.onReconnect(() => { game.status = 'online'; });
    r.onLeave((_code, reason) => {
      if (room !== r) return;
      stop();
      game.status = reason === 'replaced' ? 'replaced' : 'offline';
    });
    handle = await startGame(canvas.value!, r, game.ui(), { arriving: sail });
    handle.setSound(game.sound);   // звук включают и выключают в настройках главного меню
    if (room === r) game.status = 'online';
    if (user.value?.id) game.startSteps(user.value.id);   // новичку — шаги в углу
  } catch (e: any) {
    if (e?.statusCode === 401) return navigateTo({ path: '/login', query: { next: route.fullPath } });
    stop()?.leave().catch(() => {});
    game.status = 'error';
    game.error = e?.data?.message || e?.message || 'Не удалось подключиться к игровому серверу';
  }
}

onMounted(connect);
onBeforeUnmount(() => { stop()?.leave().catch(() => {}); });

const overlay = computed(() => {
  switch (game.status) {
    case 'connecting': return { title: atWaters() ? 'Плывём…' : 'Идём на причал…', text: '' };
    case 'reconnecting': return { title: 'Связь прервалась', text: 'Переподключаемся — герой ждёт на месте.' };
    case 'replaced': return { title: 'Игра открыта в другом окне', text: 'Играть можно только в одном окне сразу.' };
    case 'offline': return { title: 'Соединение закрыто', text: 'Улов сохранён.' };
    case 'error': return { title: 'Не получилось войти в игру', text: game.error };
    default: return null;
  }
});
</script>

<template>
  <div class="play">
    <img class="backdrop" :src="'/assets/world.png?v=' + World.rev" :style="{ '--dark': game.sky.dark }" alt="" aria-hidden="true">
    <main class="stage">
      <canvas ref="canvas" width="569" height="320" aria-label="Домик рыбака у реки" />
    </main>

    <!-- слева вверху колонкой: что в руках (у ведра — улов), под ним сытость, а новичку — первые шаги; каждое своей панелью, одной ширины -->
    <div class="hud-left">
      <GameHands @take="takeFish" />
      <GameHunger />
      <GameSteps />
    </div>
    <GameToast />
    <GameDock @left="handle?.handAction('left')" @right="handle?.handAction('right')" @pack="handle?.packAction()" @fish="handle?.fishAction()" @stand="handle?.standUp()" @open="game.togglePack()" @lamp="handle?.lampAction()" @eat="handle?.eatAction()" @dig="handle?.digAction()" @door="handle?.doorAction()" />
    <GamePack @pick="handle?.setPack($event)" />
    <GameOnline @clock="handle?.setClock($event)" @weather="setWeather" @piers="send('piers', undefined)" @visit="visit" />
    <GameBackpack
      @move="moveItem" @drop="dropItem" @take="takeItem" @stow="stowItem" @give="giveItem"
      @chest-put="chestPut" @chest-take="chestTake" @chest-move="chestMove" @chest-kind="chestKind"
    />
    <GameFridge @put="send('fridgePut', {})" @take="send('fridgeTake', { id: $event })" @stock="send('fridgeStock', undefined)" />
    <GameSleep />
    <GameVoyage @go="handle?.sailTo($event)" @stay="handle?.stay()" />
    <GameMap />

    <div v-if="overlay" class="overlay" :class="{ soft: game.status === 'reconnecting' || game.status === 'connecting' }">
      <div class="panel box">
        <h2>{{ overlay.title }}</h2>
        <p v-if="overlay.text" class="muted">{{ overlay.text }}</p>
        <div v-if="game.status !== 'connecting' && game.status !== 'reconnecting'" class="buttons">
          <button type="button" class="btn primary" @click="connect">{{ game.status === 'replaced' ? 'Играть здесь' : 'Подключиться снова' }}</button>
          <button v-if="game.status === 'error' && (route.query.pier || route.query.at)" type="button" class="btn ghost" @click="visit(user?.id ?? '')">К себе на причал</button>
          <NuxtLink to="/" class="btn ghost">В меню</NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* фон вокруг холста темнеет вместе с игрой: --dark — насколько сейчас темно, 0..1 */
.backdrop { filter: blur(26px) brightness(calc(0.42 - 0.26 * var(--dark, 0))) saturate(1.15); transition: filter 3s linear; }
.stage { position: fixed; inset: 0; display: grid; place-items: center; }
/* холст всегда 16:9; движок рисует его целым множителем чуть крупнее, а браузер плавно ужимает до размера окна */
canvas {
  display: block;
  cursor: pointer;
  box-shadow: 0 0 0 2px rgba(20, 8, 4, 0.9), 0 18px 60px rgba(0, 0, 0, 0.6);
}
.hud-left { position: fixed; left: 12px; top: 12px; display: grid; gap: 8px; }
@media (max-width: 560px) {
  .hud-left { right: 12px; }
}
.overlay { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(8, 4, 2, 0.6); }
.overlay.soft { background: rgba(8, 4, 2, 0.25); pointer-events: none; }
.box { padding: 22px 26px; max-width: 380px; text-align: center; display: grid; gap: 12px; }
.box h2 { font-size: 22px; color: var(--coat); }
.box p { margin: 0; }
.buttons { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
</style>
