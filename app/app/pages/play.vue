<!-- Игра. Страница живёт только в браузере (routeRules в nuxt.config): берём билет у сайта,
     входим в комнату-причал на игровом сервере и запускаем движок на холсте. -->
<script setup lang="ts">
import { Client, type Room } from '@colyseus/sdk';
import { ROOM, World } from '@fh/shared';
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
    r.onDrop(() => { game.status = 'reconnecting'; });
    r.onReconnect(() => { game.status = 'online'; });
    r.onLeave((_code, reason) => {
      if (room !== r) return;
      stop();
      game.status = reason === 'replaced' ? 'replaced' : 'offline';
    });
    handle = await startGame(canvas.value!, r, game.ui());
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
      <canvas ref="canvas" width="240" height="320" aria-label="Домик рыбака у реки" />
    </main>

    <GameCatch />
    <GameToast />
    <GameDock @bucket="handle?.bucketAction()" @pack="handle?.packAction()" @fish="handle?.fishAction()" @stand="handle?.standUp()" />
    <GamePack @pick="handle?.setPack($event)" />
    <GameOnline @clock="handle?.setClock($event)" />
    <div class="zoom" aria-label="Масштаб">
      <button type="button" title="Мельче (−)" :disabled="!game.canZoomOut" @click="handle?.zoom(-1); ($event.currentTarget as HTMLElement).blur()">−</button>
      <button type="button" title="Крупнее (+)" :disabled="!game.canZoomIn" @click="handle?.zoom(1); ($event.currentTarget as HTMLElement).blur()">+</button>
    </div>

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
canvas {
  display: block;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  cursor: pointer;
  box-shadow: 0 0 0 2px rgba(20, 8, 4, 0.9), 0 18px 60px rgba(0, 0, 0, 0.6);
}
.zoom { position: fixed; right: 12px; bottom: 12px; display: flex; gap: 6px; }
.zoom button {
  width: 32px; height: 32px; padding: 0;
  border: 1px solid rgba(244, 227, 193, 0.3); border-radius: 8px;
  background: var(--wood); color: var(--paper);
  font: 600 18px/1 var(--mono);
  cursor: pointer;
}
.zoom button:hover { background: var(--wood-hover); }
.zoom button:disabled { opacity: 0.35; cursor: default; }
.overlay { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(8, 4, 2, 0.6); }
.overlay.soft { background: rgba(8, 4, 2, 0.25); pointer-events: none; }
.box { padding: 22px 26px; max-width: 380px; text-align: center; display: grid; gap: 12px; }
.box h2 { font-size: 22px; color: var(--coat); }
.box p { margin: 0; }
.buttons { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
</style>
