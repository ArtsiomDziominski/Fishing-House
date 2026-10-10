<!-- Карта мира: кнопка «Карта» справа внизу (там свободно — снизу посередине кнопки действий, слева рюкзак) и окно с картой.
     Что на ней открыто — где герой бывал (game.seen, остальное в тумане), булавка «ты здесь» — где он сейчас (game.where,
     в гостях — game.whose). Карту рисует game/map-view.ts на холсте MAP.W×MAP.H, окно увеличивает его целым множителем —
     пиксели остаются чёткими; подписи мест — HTML поверх, по MAP_SPOTS. M — открыть и закрыть, Esc — закрыть: ловим их
     раньше движка (capture) и помечаем взятыми, пока карта открыта, он клавиш не трогает. Холст перерисовывается каждый кадр
     только пока окно открыто — булавка качается, по морю бегут волны. -->
<script setup lang="ts">
import { MAP, MAP_SPOTS, drawWorldMap, type MapSpot } from '~/game/map-view';

const game = useGameStore();
const canvas = ref<HTMLCanvasElement>();
const k = ref(3);                                       // во сколько раз увеличена карта — целое, чтобы пиксели не плыли

// Где герой сейчас: в доме — у дома, на причале — у своего или (в гостях) у соседей.
const here = computed<MapSpot>(() => {
  switch (game.where) {
    case 'isle': return 'isle';
    case 'sea': return 'sea';
    case 'room': return 'house';
    default: return game.whose.guest ? 'guest' : 'pier';
  }
});
const known = (spot: MapSpot) => spot === 'pier' || spot === 'house' || game.seen.includes(spot);
// Подписи мест в долях карты. Сдвиг влево растёт к правому краю (у левого — 0, у правого — вся ширина подписи):
// посередине подпись стоит по центру, а у краёв не вылезает за рамку.
const labels = computed(() => (Object.keys(MAP_SPOTS) as MapSpot[]).map(id => {
  const s = MAP_SPOTS[id], open = known(id);
  const note = id === 'guest' && here.value === 'guest' && game.whose.name ? `в гостях: ${game.whose.name}` : '';
  return {
    id, open, note, here: here.value === id, name: s.name, hidden: s.hidden,
    style: { left: `${(s.lx / MAP.W) * 100}%`, top: `${(s.ly / MAP.H) * 100}%`, '--shift': `${(-s.lx / MAP.W) * 100}%` },
  };
}));
// Что ещё скрыто — подсказка внизу окна, как это открыть.
const closed = computed(() => ({ boat: !known('isle') || !known('sea'), guest: !known('guest') }));

// Сколько влезает: окно с заголовком и подсказкой внизу — не больше экрана, и не крупнее ×4 (на большом экране карта не
// заслоняет всё). На совсем узком экране ×1 не влезает — тогда холст просто ужимается по ширине.
function fit() { k.value = Math.max(1, Math.min(4, Math.floor((innerWidth - 48) / MAP.W), Math.floor((innerHeight - 150) / MAP.H))); }

let raf = 0;
function frame(now: number) {
  if (!game.mapOpen) { raf = 0; return; }
  const c = canvas.value?.getContext('2d');             // холст появляется на следующем кадре после открытия
  if (c) drawWorldMap(c, { seen: game.seen, here: here.value, t: now / 1000 });
  raf = requestAnimationFrame(frame);
}
function start() { fit(); if (!raf) raf = requestAnimationFrame(frame); }
function stop() { cancelAnimationFrame(raf); raf = 0; }
watch(() => game.mapOpen, open => (open ? start() : stop()));
// уснул от голода — карта закрывается: под чёрным экраном её не видно, а клавиши спящего не слушаются
watch(() => game.hunger.until, asleep => { if (asleep) game.toggleMap(false); });

// после клика снимаем фокус с кнопки, иначе пробел и Enter будут нажимать её, а не подсекать
function toggle(ev: MouseEvent) { (ev.currentTarget as HTMLElement).blur(); game.toggleMap(); }
function onKey(ev: KeyboardEvent) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || game.hunger.until) return;
  if ((ev.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
  if (ev.code === 'KeyM') { if (!ev.repeat) game.toggleMap(); ev.preventDefault(); }
  else if (ev.code === 'Escape' && game.mapOpen) { game.toggleMap(false); ev.preventDefault(); }
}
onMounted(() => {
  addEventListener('keydown', onKey, { capture: true }); addEventListener('resize', fit);
  if (game.mapOpen) start();
});
onBeforeUnmount(() => { removeEventListener('keydown', onKey, { capture: true }); removeEventListener('resize', fit); stop(); });
</script>

<template>
  <button type="button" class="map-btn" title="Карта мира" :aria-expanded="game.mapOpen" @click="toggle">
    <kbd>M</kbd><span>Карта</span>
  </button>

  <div v-if="game.mapOpen" class="shade" @click.self="game.toggleMap(false)">
    <section class="world" :class="{ tiny: k === 1 }" :style="{ '--k': k, '--w': MAP.W }" role="dialog" aria-label="Карта мира">
      <header>
        <h2>Карта мира</h2>
        <span class="keys"><kbd>M</kbd> или <kbd>Esc</kbd> — закрыть</span>
        <button type="button" class="close" aria-label="Закрыть" @click="game.toggleMap(false)">×</button>
      </header>
      <div class="board">
        <canvas ref="canvas" :width="MAP.W" :height="MAP.H" aria-hidden="true" />
        <span
          v-for="l in labels" :key="l.id" class="label" :class="{ shut: !l.open, here: l.here }" :style="l.style"
          :title="l.open ? undefined : l.hidden"
        >
          <b>{{ l.name }}</b>
          <small v-if="!l.open">{{ l.hidden }}</small>
          <small v-else-if="l.note">{{ l.note }}</small>
        </span>
      </div>
      <p v-if="closed.boat || closed.guest" class="muted tip">
        В тумане — места, где ты ещё не был.
        <template v-if="closed.boat"> Сядь в лодку (<kbd>H</kbd>) — уплывёшь на общий остров или в открытый океан.</template>
        <template v-if="closed.guest"> {{ game.where === 'isle' || game.where === 'sea' ? 'В гости ходят от причала — доплыви домой и нажми «Твой причал» справа вверху.' : 'Сходи в гости — нажми «Твой причал» справа вверху.' }}</template>
      </p>
    </section>
  </div>
</template>

<style scoped>
.map-btn {
  position: fixed; right: 12px; bottom: 12px;
  display: flex; align-items: center; gap: 8px;
  padding: 5px 11px 5px 8px;
  border: 1px solid rgba(244, 227, 193, 0.3); border-radius: 8px;
  background: var(--wood); color: var(--paper);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  font: 600 13px/1.2 var(--text);
  cursor: pointer;
}
.map-btn:hover { background: var(--wood-hover); }
.map-btn[aria-expanded="true"] { border-color: var(--coat); }

.shade { position: fixed; inset: 0; display: grid; place-items: center; padding: 12px; background: rgba(8, 4, 2, 0.55); }
.world {
  display: grid; gap: 8px; padding: 10px 12px 12px;
  width: min(calc(var(--w) * var(--k) * 1px + 24px), 100%);
  max-height: 100%; overflow: auto;
  border: 1px solid var(--line); border-radius: 9px;
  background: rgba(40, 22, 12, 0.94);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
  font-size: 13px;
}
header { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
header h2 { font-size: 18px; color: var(--coat); white-space: nowrap; }
.keys { color: var(--paper-dim); font-size: 12px; }
.close {
  margin-left: auto; width: 26px; height: 26px; padding: 0;
  border: 1px solid rgba(244, 227, 193, 0.3); border-radius: 6px;
  background: none; color: var(--paper); font: 600 18px/1 var(--text); cursor: pointer;
}
.close:hover { background: var(--wood-hover); }
.board { position: relative; font-size: calc(9px + var(--k) * 1px); }   /* подписи растут вместе с картой */
canvas {
  display: block; width: 100%; height: auto; aspect-ratio: 16 / 9;
  image-rendering: pixelated;
}
.label {
  position: absolute; transform: translateX(var(--shift));
  display: grid; justify-items: center; gap: 1px;
  padding: 1px 6px 2px;
  border: 1px solid rgba(244, 227, 193, 0.3); border-radius: 5px;
  background: rgba(40, 22, 12, 0.86); color: var(--paper);
  line-height: 1.2; text-align: center; white-space: nowrap;
  pointer-events: none;
}
.label b { font-weight: 600; }
.label small { font-size: 0.9em; color: var(--paper-dim); }
.label.here { border-color: var(--coat); color: var(--coat); }
.label.shut { border-color: rgba(244, 227, 193, 0.14); background: rgba(10, 14, 22, 0.72); color: var(--paper-dim); }
.label.shut small { color: rgba(244, 227, 193, 0.5); }
.tip { margin: 0; font-size: 12px; line-height: 1.4; }
@media (hover: none) and (pointer: coarse) {
  .map-btn kbd, .keys { display: none; }
  .map-btn { padding: 5px 11px; }
}
/* карта без увеличения (телефон): подписи теснятся — оставляем только открытые места, как открыть остальное — в подсказке внизу */
.tiny .label small, .tiny .label.shut { display: none; }
.tiny .label { padding: 0 4px; }
</style>
