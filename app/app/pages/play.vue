<!-- Игра. Страница живёт только в браузере (routeRules в nuxt.config): берём билет у сайта,
     входим в комнату-причал на игровом сервере и запускаем движок на холсте. -->
<script setup lang="ts">
import { Client, type Room } from '@colyseus/sdk';
import { ROOM, World, type ClientMessages, type ItemKind, type Place, type ServerMessages, type WeatherKind } from '@fh/shared';
import { startGame, type GameHandle } from '~/game/engine';

definePageMeta({ layout: false, middleware: 'auth' });
useHead({ title: 'Причал — Fishing House', bodyAttrs: { class: 'in-game' } });

const game = useGameStore();
const config = useRuntimeConfig();
const canvas = ref<HTMLCanvasElement>();
let room: Room | null = null;
let handle: GameHandle | null = null;

// Адрес игрового сервера: полный (http://localhost:2567) или путь на этом же сайте (/game — за Caddy).
function endpoint() {
  const url = config.public.gameUrl;
  return url.startsWith('/') ? location.origin + url : url;
}

function setWeather(kind: WeatherKind | null, wind: boolean | null) { handle?.setWeather(kind, wind); }
function setSound(on: boolean) { game.setSound(on); handle?.setSound(on); }

// Вещи в рюкзаке и в руке: окно рюкзака просит, сервер решает и, если не согласен, присылает «items» с причиной.
const send = <K extends keyof ClientMessages>(type: K, msg: ClientMessages[K]) => room?.send(type, msg);
const ITEM_NOTES: Record<NonNullable<ServerMessages['items']['note']>, string> = {
  far: 'Рюкзак далеко — подойди к нему',
  full: 'В рюкзаке нет места',
  tight: 'Вещи в этот рюкзак не влезут — сначала выложи лишнее',
  busy: 'Рука занята — убери вещь в рюкзак',
};
function moveItem(id: number, x: number, y: number, rot: boolean) { send('itemMove', { id, x, y, rot }); }
function dropItem(id: number) { send('itemDrop', { id }); }
function takeItem(id: number) { send('itemTake', { id }); }
function stowItem(at: Place) { send('itemStow', { at }); }
function giveItem(kind: ItemKind) { send('itemGive', { kind }); }

function stop() {
  handle?.destroy(); handle = null;
  const r = room; room = null;
  r?.removeAllListeners();
  return r;
}

async function connect() {
  stop()?.leave().catch(() => {});
  game.reset();
  game.status = 'connecting';
  try {
    const { ticket } = await $fetch<{ ticket: string }>('/api/game/ticket', { method: 'POST' });
    const r = await new Client(endpoint()).joinOrCreate(ROOM, { ticket });
    room = r;
    game.roomId = r.roomId;
    r.onMessage('items', (m: ServerMessages['items']) => {
      game.items = m.list; game.hand = m.hand;
      if (m.note) game.showToast(ITEM_NOTES[m.note], 'bad');
    });
    r.onDrop(() => { game.status = 'reconnecting'; });
    r.onReconnect(() => { game.status = 'online'; });
    r.onLeave((_code, reason) => {
      if (room !== r) return;
      stop();
      game.status = reason === 'replaced' ? 'replaced' : 'offline';
    });
    handle = await startGame(canvas.value!, r, game.ui());
    handle.setSound(game.sound);
    if (room === r) game.status = 'online';
  } catch (e: any) {
    if (e?.statusCode === 401) return navigateTo({ path: '/login', query: { next: '/play' } });
    stop()?.leave().catch(() => {});
    game.status = 'error';
    game.error = e?.data?.message || e?.message || 'Не удалось подключиться к игровому серверу';
  }
}

onMounted(connect);
onBeforeUnmount(() => { stop()?.leave().catch(() => {}); });

const overlay = computed(() => {
  switch (game.status) {
    case 'connecting': return { title: 'Идём на причал…', text: '' };
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

    <GameCatch />
    <GameToast />
    <GameDock @bucket="handle?.bucketAction()" @pack="handle?.packAction()" @fish="handle?.fishAction()" @stand="handle?.standUp()" @open="game.togglePack()" @lamp="handle?.lampAction()" @ground="handle?.groundAction()" />
    <GamePack @pick="handle?.setPack($event)" />
    <GameOnline @clock="handle?.setClock($event)" @weather="setWeather" @sound="setSound" />
    <GameBackpack @move="moveItem" @drop="dropItem" @take="takeItem" @stow="stowItem" @give="giveItem" />

    <div v-if="overlay" class="overlay" :class="{ soft: game.status === 'reconnecting' || game.status === 'connecting' }">
      <div class="panel box">
        <h2>{{ overlay.title }}</h2>
        <p v-if="overlay.text" class="muted">{{ overlay.text }}</p>
        <div v-if="game.status !== 'connecting' && game.status !== 'reconnecting'" class="buttons">
          <button type="button" class="btn primary" @click="connect">{{ game.status === 'replaced' ? 'Играть здесь' : 'Подключиться снова' }}</button>
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
.overlay { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(8, 4, 2, 0.6); }
.overlay.soft { background: rgba(8, 4, 2, 0.25); pointer-events: none; }
.box { padding: 22px 26px; max-width: 380px; text-align: center; display: grid; gap: 12px; }
.box h2 { font-size: 22px; color: var(--coat); }
.box p { margin: 0; }
.buttons { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
</style>
