<!-- Окно рюкзака (I или кнопка внизу): слева сетка клеток, в ней вещи, справа рыбак и вещь у него в руке.
     Вещь тянут мышью или пальцем на свободные клетки, R или правая кнопка мыши поворачивают её. Двойной клик или
     удержание берут вещь из рюкзака в руку, а вещь из руки убирают обратно; то же — перетащить её на рыбака или с него
     в клетку. Что куда встанет, решает сервер: окно сразу показывает перекладку и шлёт её, а если сервер не согласен,
     он присылает, как всё лежит на самом деле. -->
<script setup lang="ts">
import { ITEMS, ITEM_KINDS, PACKS, type Item, type ItemKind, type Place } from '@fh/shared';
import { CELL, EDGE, backpackLayout, drawBackpack, type Drag } from '~/game/backpack-view';

const emit = defineEmits<{
  move: [id: number, x: number, y: number, rot: boolean];
  drop: [id: number];
  take: [id: number];                    // взять вещь из рюкзака в руку
  stow: [at: Place];                     // убрать вещь из руки в рюкзак, в эту клетку
  give: [kind: ItemKind];
}>();
const game = useGameStore();
const el = ref<HTMLCanvasElement>();
const selected = ref<number | null>(null);
const hover = ref<number | null>(null);
const drag = shallowRef<Drag | null>(null);
const hold = shallowRef<{ id: number; k: number } | null>(null);   // вещь держат нажатой: скоро уйдёт в руку или обратно
const sure = ref(false);                 // «Выбросить» нажали один раз — второе нажатие выбросит
const gift = ref<ItemKind>(ITEM_KINDS[0]);
const k = ref(2);                        // во сколько раз холст рюкзака крупнее арт-пикселей
const stacked = ref(false);              // на узком экране рыбак стоит над рюкзаком, а не сбоку

const grid = computed(() => ITEMS.grid(game.pack));
const lay = computed(() => backpackLayout(grid.value, stacked.value));
const used = computed(() => ITEMS.used(game.items));
// вещь по номеру — в рюкзаке она или в руке
const thing = (id: number | null) => (id === null ? null : game.items.find(it => it.id === id) || (game.hand?.id === id ? game.hand : null));
const inHand = (id: number | null) => id !== null && game.hand?.id === id;
// про какую вещь рассказать внизу: которую тянут, выбранную или ту, что под указателем
const shown = computed(() => thing(drag.value?.id ?? selected.value ?? hover.value));

function cellsText(kind: ItemKind) {
  const n = ITEMS.cells(kind), z = ITEMS.size(kind, false);
  return `${n} ${n === 1 ? 'клетка' : 'клетки'}${n > 1 ? ` · ${z.w}×${z.h}` : ''}`;
}

function draw() {
  const c = el.value; if (!c) return;
  drawBackpack(c.getContext('2d')!, { pack: game.pack, grid: grid.value, layout: lay.value, items: game.items, hand: game.hand, selected: selected.value, hover: hover.value, drag: drag.value, hold: hold.value });
}
watch([() => game.items, () => game.hand, () => game.pack, selected, hover, drag, hold, () => game.packOpen, k, stacked], () => nextTick(draw));

// ×3 на больших экранах, как и мир на 1920×1080, ×2 на остальных. Не влезает с рыбаком сбоку — он встаёт над рюкзаком;
// на совсем узких — сколько влезет.
function fit() {
  const side = backpackLayout(grid.value, false).w, pile = backpackLayout(grid.value, true).w, room = innerWidth - 32;
  const big = innerWidth >= 1200 && innerHeight >= 860 ? 3 : 2;
  if (side * big <= room) { stacked.value = false; k.value = big; }
  else if (side * 2 <= room) { stacked.value = false; k.value = 2; }
  else { stacked.value = true; k.value = Math.max(1, Math.min(2, Math.floor(room / pile))); }
}
watch(grid, fit);

// ---------- в руку и обратно ----------

function take(id: number) {
  const r = ITEMS.take(grid.value, game.items, game.hand, id);
  if (!r) { if (game.items.some(it => it.id === id)) game.showToast('Вещь из руки некуда положить — в рюкзаке тесно', 'bad'); return; }
  game.items = r.list; game.hand = r.hand; selected.value = r.hand.id; sure.value = false;
  emit('take', id);
}
// at — в какую клетку; не названа — туда, где вещь лежала, а занято — на первое свободное место.
function stow(at: Place | null = null) {
  const r = ITEMS.stow(grid.value, game.items, game.hand, at);
  if (!r) { if (game.hand) game.showToast(at ? 'Сюда вещь не встаёт' : 'В рюкзаке нет места', 'bad'); return; }
  game.items = r.list; game.hand = null; selected.value = r.item.id; sure.value = false;
  emit('stow', { x: r.item.x, y: r.item.y, rot: r.item.rot });
}
// Двойной клик или удержание: из рюкзака — в руку, из руки — в рюкзак.
const swap = (id: number) => (inHand(id) ? stow() : take(id));

// ---------- перетаскивание ----------

const HOLD = 500, HOLD_SHOW = 0.3;       // мс, сколько держать вещь нажатой; с какой доли этого срока показывать полоску
const DOUBLE = 350;                      // мс между нажатиями двойного клика

// press — на какой вещи нажали, откуда она и за какое её место держат (gx, gy — от левого верхнего угла, арт-пиксели)
let press: { id: number; from: Drag['from']; x0: number; y0: number; gx: number; gy: number; x: number; y: number } | null = null;
let tap: { id: number; t: number } | null = null;     // прошлое нажатие — вдруг это первое из двойного клика
let holdTimer: ReturnType<typeof setInterval> | undefined;

function toArt(ev: PointerEvent) {
  const r = el.value!.getBoundingClientRect();
  return { x: Math.floor((ev.clientX - r.left) / r.width * lay.value.w), y: Math.floor((ev.clientY - r.top) / r.height * lay.value.h) };
}
const within = (r: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
function itemAt(x: number, y: number): Item | null {
  const o = lay.value.grid, cx = Math.floor((x - o.x - EDGE) / CELL), cy = Math.floor((y - o.y - EDGE) / CELL);
  return game.items.find(it => { const z = ITEMS.size(it.kind, it.rot); return cx >= it.x && cx < it.x + z.w && cy >= it.y && cy < it.y + z.h; }) || null;
}
// Что под указателем: вещь в рюкзаке или та, что в руке.
function hit(x: number, y: number): { it: Item; from: Drag['from'] } | null {
  const it = itemAt(x, y);
  if (it) return { it, from: 'pack' };
  return game.hand && within(lay.value.slot, x, y) ? { it: game.hand, from: 'hand' } : null;
}
// Куда встанет вещь, которую тянут: в ближайшую клетку к её левому верхнему углу (подсветка не вылезает за сетку).
// Над панелью рыбака клетки не ищем: вещь из рюкзака там просится в руку.
function aim(from: Drag['from'], id: number, kind: ItemKind, rot: boolean, x: number, y: number): Drag {
  const z = ITEMS.size(kind, rot), g = grid.value, o = lay.value.grid, d: Drag = { id, kind, rot, x, y, from, at: null, hand: false, ok: false };
  if (press && within(lay.value.pane, press.x, press.y)) return from === 'pack' ? { ...d, hand: true, ok: !!ITEMS.take(g, game.items, game.hand, id) } : d;
  const cx = Math.round((x - o.x - EDGE) / CELL), cy = Math.round((y - o.y - EDGE) / CELL);
  if (z.w > g.w || z.h > g.h) return d;
  const at = { x: Math.min(Math.max(cx, 0), g.w - z.w), y: Math.min(Math.max(cy, 0), g.h - z.h) };
  return { ...d, at, ok: at.x === cx && at.y === cy && ITEMS.fits(g, game.items, kind, cx, cy, rot, id) };
}
function place(id: number, x: number, y: number, rot: boolean) {
  game.items = game.items.map(it => (it.id === id ? { ...it, x, y, rot } : it));
  emit('move', id, x, y, rot);
}

function stopHold() { clearInterval(holdTimer); holdTimer = undefined; hold.value = null; }
// Вещь держат нажатой и не тянут: через HOLD она уходит в руку или обратно. Пока ждём — растёт полоска.
function startHold(id: number) {
  stopHold();
  const t0 = performance.now();
  holdTimer = setInterval(() => {
    if (!press || press.id !== id || drag.value) { stopHold(); return; }
    const done = (performance.now() - t0) / HOLD;
    if (done >= 1) { stopHold(); press = null; tap = null; swap(id); return; }
    hold.value = done > HOLD_SHOW ? { id, k: (done - HOLD_SHOW) / (1 - HOLD_SHOW) } : null;
  }, 30);
}

function down(ev: PointerEvent) {
  if (ev.button === 2) {                                // правая кнопка поворачивает вещь в рюкзаке
    ev.preventDefault();
    if (drag.value) turnDrag(); else { const p = toArt(ev), it = itemAt(p.x, p.y); if (it) { selected.value = it.id; rotate(); } }
    return;
  }
  if (ev.button !== 0) return;
  const p = toArt(ev), h = hit(p.x, p.y), now = performance.now();
  selected.value = h?.it.id ?? null; sure.value = false;
  if (!h) { tap = null; return; }
  if (tap && tap.id === h.it.id && now - tap.t < DOUBLE) { tap = null; swap(h.it.id); return; }
  tap = { id: h.it.id, t: now };
  const it = h.it, z = ITEMS.size(it.kind, it.rot), o = lay.value.grid;
  // вещь из рюкзака держат за то место, где нажали; вещь из руки — за середину
  const grab = h.from === 'pack' ? { gx: p.x - (o.x + EDGE + it.x * CELL), gy: p.y - (o.y + EDGE + it.y * CELL) } : { gx: (z.w * CELL) >> 1, gy: (z.h * CELL) >> 1 };
  press = { id: it.id, from: h.from, x0: p.x, y0: p.y, ...grab, x: p.x, y: p.y };
  el.value!.setPointerCapture(ev.pointerId);
  startHold(it.id);
}
function move(ev: PointerEvent) {
  const p = toArt(ev);
  if (!press) { hover.value = hit(p.x, p.y)?.it.id ?? null; return; }
  press.x = p.x; press.y = p.y;
  const it = thing(press.id);
  if (!it) { cancel(); return; }
  if (!drag.value && Math.hypot(p.x - press.x0, p.y - press.y0) < 3) return;   // это ещё клик, а не перетаскивание
  stopHold(); tap = null;
  const rot = drag.value ? drag.value.rot : it.rot;
  drag.value = aim(press.from, it.id, it.kind, rot, p.x - press.gx, p.y - press.gy);
}
function up() {
  const d = drag.value;
  stopHold(); press = null; drag.value = null;
  if (!d) return;
  if (d.from === 'hand') { if (d.ok && d.at) stow({ x: d.at.x, y: d.at.y, rot: d.rot }); }
  else if (d.hand) take(d.id);
  else if (d.ok && d.at) place(d.id, d.at.x, d.at.y, d.rot);
}
function cancel() { stopHold(); press = null; drag.value = null; }

// Повернуть вещь, которую тянут: держим её за середину, чтобы она осталась под указателем.
function turnDrag() {
  const d = drag.value; if (!d || !press || !ITEMS.turns(d.kind)) return;
  const z = ITEMS.size(d.kind, !d.rot);
  press.gx = (z.w * CELL) >> 1; press.gy = (z.h * CELL) >> 1;
  drag.value = aim(d.from, d.id, d.kind, !d.rot, press.x - press.gx, press.y - press.gy);
}
// Повернуть выбранную вещь там, где лежит: тот же левый верхний угол, а если там тесно — первое место, где встанет.
// Вещь в руке не поворачивают: она клеток не занимает.
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
  if (inHand(id)) game.hand = null; else game.items = game.items.filter(it => it.id !== id);
  emit('drop', id);
}

function close() { game.packOpen = false; }
// после клика снимаем фокус с кнопки, иначе пробел и Enter будут нажимать её, а не подсекать
function blur(ev: Event) { (ev.currentTarget as HTMLElement).blur(); }

watch(() => game.packOpen, open => {
  cancel(); tap = null; selected.value = null; hover.value = null; sure.value = false;
  if (open) fit();
});
// отошёл от рюкзака, оставив его на земле, — окно закрывается
watch(() => game.actions.open, near => {
  if (!near && game.packOpen) { game.packOpen = false; game.showToast('Рюкзак остался позади'); }
});
// вещь, на которой стояло выделение, исчезла (выбросили, сервер прислал другое)
watch([() => game.items, () => game.hand], () => { if (selected.value !== null && !thing(selected.value)) selected.value = null; });

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
onBeforeUnmount(() => { removeEventListener('keydown', key, { capture: true }); removeEventListener('resize', fit); clearTimeout(sureTimer); stopHold(); });
</script>

<template>
  <section v-if="game.packOpen" class="backpack" :style="{ '--k': k, '--w': lay.w, '--h': lay.h }" role="dialog" aria-label="Рюкзак">
    <header>
      <h2>{{ PACKS.name(game.pack) }} рюкзак</h2>
      <span class="room" title="Сколько клеток занято">{{ used }} / {{ grid.w * grid.h }}</span>
      <button type="button" class="close" title="Закрыть — I или Esc" @click="close">×</button>
    </header>
    <div class="board">
      <canvas
        ref="el" :width="lay.w" :height="lay.h" :class="{ dragging: drag, over: hover !== null }"
        @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @pointerleave="hover = null" @contextmenu.prevent
      />
      <!-- подпись над рыбаком: что у него в руке -->
      <span class="hand" :class="{ empty: !game.hand }" :style="{ '--x': lay.label.x, '--y': lay.label.y, '--lw': lay.label.w, '--lh': lay.label.h }">{{ game.hand ? 'В руке' : 'Рука пуста' }}</span>
    </div>
    <footer>
      <template v-if="shown">
        <div class="what"><b>{{ ITEMS.info(shown.kind).name }}</b><span class="cells">{{ inHand(shown.id) ? 'в руке' : cellsText(shown.kind) }}</span></div>
        <p class="text">{{ ITEMS.info(shown.kind).text }}</p>
        <div v-if="selected === shown.id && !drag" class="buttons">
          <button v-if="inHand(shown.id)" type="button" @click="blur($event); stow()">В рюкзак</button>
          <template v-else>
            <button type="button" @click="blur($event); take(shown.id)">В руку</button>
            <button v-if="ITEMS.turns(shown.kind)" type="button" @click="blur($event); rotate()"><kbd>R</kbd>Повернуть</button>
          </template>
          <button type="button" class="drop" :class="{ sure }" @click="drop">{{ sure ? 'Точно выбросить?' : 'Выбросить' }}</button>
        </div>
      </template>
      <p v-else class="text muted">
        Перетащи вещь на свободные клетки. Двойной клик или удержание — взять в руку или убрать обратно.
        <span class="for-keys"><kbd>R</kbd> или правая кнопка — повернуть.</span>
      </p>
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
  max-height: calc(100vh - 16px); overflow: auto;
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
.board { position: relative; }
canvas {
  display: block;
  width: calc(var(--w) * var(--k) * 1px); height: calc(var(--h) * var(--k) * 1px);
  image-rendering: pixelated;
  touch-action: none;
}
canvas.over { cursor: grab; }
canvas.dragging { cursor: grabbing; }
/* подпись стоит на холсте, в его же арт-пикселях; нажатия проходят сквозь неё */
.hand {
  position: absolute; left: calc(var(--x) * var(--k) * 1px); top: calc(var(--y) * var(--k) * 1px);
  width: calc(var(--lw) * var(--k) * 1px); height: calc(var(--lh) * var(--k) * 1px);
  display: grid; place-items: center;
  font: 400 calc(5px * var(--k) + 2px)/1.1 var(--pixel); letter-spacing: 0.03em; text-align: center;
  color: var(--coat);
  pointer-events: none;
}
.hand.empty { color: var(--paper-dim); }
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
