<!-- Окно рюкзака (I или кнопка внизу): сетка клеток, в ней вещи. Вещь тянут мышью или пальцем на свободные клетки,
     R или правая кнопка мыши поворачивают её. Встанет ли вещь, решает сервер: окно сразу показывает перекладку и шлёт её,
     а если сервер не согласен, он присылает, как всё лежит на самом деле. -->
<script setup lang="ts">
import { ITEMS, ITEM_KINDS, PACKS, type Item, type ItemKind } from '@fh/shared';
import { CELL, EDGE, backpackSize, drawBackpack, type Drag } from '~/game/backpack-view';

const emit = defineEmits<{ move: [id: number, x: number, y: number, rot: boolean]; drop: [id: number]; give: [kind: ItemKind] }>();
const game = useGameStore();
const el = ref<HTMLCanvasElement>();
const selected = ref<number | null>(null);
const hover = ref<number | null>(null);
const drag = shallowRef<Drag | null>(null);
const sure = ref(false);                 // «Выбросить» нажали один раз — второе нажатие выбросит
const gift = ref<ItemKind>(ITEM_KINDS[0]);
const k = ref(2);                        // во сколько раз холст рюкзака крупнее арт-пикселей

const grid = computed(() => ITEMS.grid(game.pack));
const size = computed(() => backpackSize(grid.value));
const used = computed(() => ITEMS.used(game.items));
// про какую вещь рассказать внизу: которую тянут, выбранную или ту, что под указателем
const shown = computed(() => game.items.find(it => it.id === (drag.value?.id ?? selected.value ?? hover.value)) || null);

function cellsText(kind: ItemKind) {
  const n = ITEMS.cells(kind), z = ITEMS.size(kind, false);
  return `${n} ${n === 1 ? 'клетка' : 'клетки'}${n > 1 ? ` · ${z.w}×${z.h}` : ''}`;
}

function draw() {
  const c = el.value; if (!c) return;
  drawBackpack(c.getContext('2d')!, { pack: game.pack, grid: grid.value, items: game.items, selected: selected.value, hover: hover.value, drag: drag.value });
}
watch([() => game.items, () => game.pack, selected, hover, drag, () => game.packOpen, k], () => nextTick(draw));

// ×3 на больших экранах, как и мир на 1920×1080, ×2 на остальных; на совсем узких — сколько влезет
function fit() {
  const w = size.value.w;
  k.value = innerWidth >= 1200 && innerHeight >= 860 ? 3 : 2;
  if (w * k.value + 32 > innerWidth) k.value = Math.max(1, Math.floor((innerWidth - 32) / w));
}
watch(size, fit);

// ---------- перетаскивание ----------

// press — на какой вещи нажали и за какое её место держат (gx, gy — от левого верхнего угла, арт-пиксели)
let press: { id: number; x0: number; y0: number; gx: number; gy: number; x: number; y: number } | null = null;

function toArt(ev: PointerEvent) {
  const r = el.value!.getBoundingClientRect();
  return { x: Math.floor((ev.clientX - r.left) / r.width * size.value.w), y: Math.floor((ev.clientY - r.top) / r.height * size.value.h) };
}
function itemAt(x: number, y: number): Item | null {
  const cx = Math.floor((x - EDGE) / CELL), cy = Math.floor((y - EDGE) / CELL);
  return game.items.find(it => { const z = ITEMS.size(it.kind, it.rot); return cx >= it.x && cx < it.x + z.w && cy >= it.y && cy < it.y + z.h; }) || null;
}
// Куда встанет вещь, которую тянут: в ближайшую клетку к её левому верхнему углу (подсветка не вылезает за сетку).
function aim(id: number, kind: ItemKind, rot: boolean, x: number, y: number): Drag {
  const z = ITEMS.size(kind, rot), g = grid.value;
  const cx = Math.round((x - EDGE) / CELL), cy = Math.round((y - EDGE) / CELL);
  if (z.w > g.w || z.h > g.h) return { id, kind, rot, x, y, at: null, ok: false };
  const at = { x: Math.min(Math.max(cx, 0), g.w - z.w), y: Math.min(Math.max(cy, 0), g.h - z.h) };
  return { id, kind, rot, x, y, at, ok: at.x === cx && at.y === cy && ITEMS.fits(g, game.items, kind, cx, cy, rot, id) };
}
function place(id: number, x: number, y: number, rot: boolean) {
  game.items = game.items.map(it => (it.id === id ? { ...it, x, y, rot } : it));
  emit('move', id, x, y, rot);
}

function down(ev: PointerEvent) {
  if (ev.button === 2) { ev.preventDefault(); if (drag.value) turnDrag(); else { const it = itemAt(toArt(ev).x, toArt(ev).y); if (it) { selected.value = it.id; rotate(); } } return; }
  if (ev.button !== 0) return;
  const p = toArt(ev), it = itemAt(p.x, p.y);
  selected.value = it?.id ?? null; sure.value = false;
  if (!it) return;
  press = { id: it.id, x0: p.x, y0: p.y, gx: p.x - (EDGE + it.x * CELL), gy: p.y - (EDGE + it.y * CELL), x: p.x, y: p.y };
  el.value!.setPointerCapture(ev.pointerId);
}
function move(ev: PointerEvent) {
  const p = toArt(ev);
  if (!press) { hover.value = itemAt(p.x, p.y)?.id ?? null; return; }
  press.x = p.x; press.y = p.y;
  const it = game.items.find(i => i.id === press!.id);
  if (!it) { press = null; drag.value = null; return; }
  if (!drag.value && Math.hypot(p.x - press.x0, p.y - press.y0) < 3) return;   // это ещё клик, а не перетаскивание
  const rot = drag.value ? drag.value.rot : it.rot;
  drag.value = aim(it.id, it.kind, rot, p.x - press.gx, p.y - press.gy);
}
function up() {
  const d = drag.value;
  if (d?.ok && d.at) place(d.id, d.at.x, d.at.y, d.rot);
  press = null; drag.value = null;
}
function cancel() { press = null; drag.value = null; }

// Повернуть вещь, которую тянут: держим её за середину, чтобы она осталась под указателем.
function turnDrag() {
  const d = drag.value; if (!d || !press || !ITEMS.turns(d.kind)) return;
  const z = ITEMS.size(d.kind, !d.rot);
  press.gx = (z.w * CELL) >> 1; press.gy = (z.h * CELL) >> 1;
  drag.value = aim(d.id, d.kind, !d.rot, press.x - press.gx, press.y - press.gy);
}
// Повернуть выбранную вещь там, где лежит: тот же левый верхний угол, а если там тесно — первое место, где встанет.
function rotate() {
  if (drag.value) { turnDrag(); return; }
  const it = game.items.find(i => i.id === selected.value);
  if (!it || !ITEMS.turns(it.kind)) return;
  const g = grid.value, others = game.items.filter(o => o.id !== it.id);
  if (ITEMS.fits(g, others, it.kind, it.x, it.y, !it.rot)) { place(it.id, it.x, it.y, !it.rot); return; }
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (ITEMS.fits(g, others, it.kind, x, y, !it.rot)) { place(it.id, x, y, !it.rot); return; }
  game.showToast('Повернуть не выйдет — тесно', 'bad');
}

let sureTimer: ReturnType<typeof setTimeout> | undefined;
function drop(ev: MouseEvent) {
  blur(ev);
  const id = selected.value; if (id === null) return;
  if (!sure.value) { sure.value = true; clearTimeout(sureTimer); sureTimer = setTimeout(() => { sure.value = false; }, 3000); return; }
  sure.value = false; selected.value = null;
  game.items = game.items.filter(it => it.id !== id);
  emit('drop', id);
}

function close() { game.packOpen = false; }
// после клика снимаем фокус с кнопки, иначе пробел и Enter будут нажимать её, а не подсекать
function blur(ev: Event) { (ev.currentTarget as HTMLElement).blur(); }

watch(() => game.packOpen, open => {
  press = null; drag.value = null; selected.value = null; hover.value = null; sure.value = false;
  if (open) fit();
});
// отошёл от рюкзака, оставив его на земле, — окно закрывается
watch(() => game.actions.open, near => {
  if (!near && game.packOpen) { game.packOpen = false; game.showToast('Рюкзак остался позади'); }
});
// вещь, на которой стояло выделение, исчезла (выбросили, сервер прислал другое)
watch(() => game.items, list => { if (selected.value !== null && !list.some(it => it.id === selected.value)) selected.value = null; });

// Клавиши ловим раньше движка: Esc при открытом рюкзаке закрывает его, а не поднимает рыбака с места.
function key(ev: KeyboardEvent) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if ((ev.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
  if (ev.code === 'KeyI') { if (!ev.repeat) game.togglePack(); ev.preventDefault(); return; }
  if (!game.packOpen) return;
  if (ev.code === 'Escape') { close(); ev.preventDefault(); ev.stopImmediatePropagation(); }
  else if (ev.code === 'KeyR' && !ev.repeat) { rotate(); ev.preventDefault(); }
}
onMounted(() => { addEventListener('keydown', key, { capture: true }); addEventListener('resize', fit); fit(); });
onBeforeUnmount(() => { removeEventListener('keydown', key, { capture: true }); removeEventListener('resize', fit); clearTimeout(sureTimer); });
</script>

<template>
  <section v-if="game.packOpen" class="backpack" :style="{ '--k': k, '--w': size.w, '--h': size.h }" role="dialog" aria-label="Рюкзак">
    <header>
      <h2>{{ PACKS.name(game.pack) }} рюкзак</h2>
      <span class="room" title="Сколько клеток занято">{{ used }} / {{ grid.w * grid.h }}</span>
      <button type="button" class="close" title="Закрыть — I или Esc" @click="close">×</button>
    </header>
    <canvas
      ref="el" :width="size.w" :height="size.h" :class="{ dragging: drag, over: hover !== null }"
      @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @pointerleave="hover = null" @contextmenu.prevent
    />
    <footer>
      <template v-if="shown">
        <div class="what"><b>{{ ITEMS.info(shown.kind).name }}</b><span class="cells">{{ cellsText(shown.kind) }}</span></div>
        <p class="text">{{ ITEMS.info(shown.kind).text }}</p>
        <div v-if="selected === shown.id && !drag" class="buttons">
          <button v-if="ITEMS.turns(shown.kind)" type="button" @click="blur($event); rotate()"><kbd>R</kbd>Повернуть</button>
          <button type="button" class="drop" :class="{ sure }" @click="drop">{{ sure ? 'Точно выбросить?' : 'Выбросить' }}</button>
        </div>
      </template>
      <p v-else class="text muted">Перетащи вещь на свободные клетки. <span class="for-keys"><kbd>R</kbd> или правая кнопка — повернуть.</span></p>
      <!-- разработка: положить в рюкзак любую вещь (сервер слушает это, только когда разрешено и время с погодой) -->
      <div v-if="game.sky.canSet" class="dev">
        <select v-model="gift" aria-label="Какую вещь положить" @change="blur">
          <option v-for="kind in ITEM_KINDS" :key="kind" :value="kind">{{ ITEMS.info(kind).name }} · {{ cellsText(kind) }}</option>
        </select>
        <button type="button" @click="blur($event); emit('give', gift)">Положить</button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.backpack {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -54%);
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 10px 12px 12px;
  width: calc(var(--w) * var(--k) * 1px + 24px);
  border: 1px solid var(--line); border-radius: 9px;
  background: rgba(40, 22, 12, 0.94);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
  font-size: 13px;
}
header { display: flex; align-items: center; gap: 10px; }
header h2 { font-size: 18px; color: var(--coat); }
.room { margin-left: auto; font: 600 12px/1 var(--mono); color: var(--paper-dim); }
.close {
  width: 26px; height: 26px; padding: 0;
  border: 1px solid rgba(244, 227, 193, 0.3); border-radius: 6px;
  background: none; color: var(--paper); font: 600 18px/1 var(--text); cursor: pointer;
}
.close:hover { background: var(--wood-hover); }
canvas {
  display: block;
  width: calc(var(--w) * var(--k) * 1px); height: calc(var(--h) * var(--k) * 1px);
  image-rendering: pixelated;
  touch-action: none;
}
canvas.over { cursor: grab; }
canvas.dragging { cursor: grabbing; }
footer { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; min-height: 58px; align-content: start; }
.what { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
.what b { font-family: var(--pixel); font-weight: 400; font-size: 15px; letter-spacing: 0.03em; }
.cells { margin-left: auto; color: var(--paper-dim); font-size: 12px; white-space: nowrap; }
.text { margin: 0; color: var(--paper-dim); }
.buttons, .dev { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.buttons button, .dev button, .dev select {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px;
  border: 1px solid rgba(244, 227, 193, 0.35); border-radius: 7px;
  background: var(--wood); color: var(--paper);
  font: 600 13px/1.2 var(--text);
  cursor: pointer;
}
.buttons button:hover, .dev button:hover { background: var(--wood-hover); }
.drop.sure { border-color: var(--bad); background: var(--bad); color: var(--ink); }
.dev { padding-top: 6px; border-top: 1px dashed var(--line); }
.dev select { flex: 1 1 0; min-width: 0; }
@media (hover: none) and (pointer: coarse) { .for-keys, .buttons kbd { display: none; } }
</style>
