<!-- Окно рюкзака (I или кнопка внизу): слева сетка клеток, в ней вещи, справа рыбак лицом к нам и по бокам от него гнёзда рук: правой (E) — слева на экране, левой (Q) — справа.
     Вещь тянут мышью или пальцем на свободные клетки, R или правая кнопка мыши поворачивают её. Двойной клик или
     удержание берут вещь из рюкзака в руки, а вещь из рук убирают обратно; то же — перетащить её на рыбака или с него
     в клетку. Лёгкая вещь (и ведро) занимает одну руку, тяжёлая — обе: она в гнезде правой, а гнездо левой закрыто с подписью;
     взять её можно только в пустые руки. На банке червей написано, сколько в ней: «хватает», число или «пусто» (WORMS.label).
     У открытого сундука в доме окно показывает и его — слева от рюкзака: вещи перетаскивают между ними, двойной клик или
     удержание перекладывают из рюкзака в сундук и обратно; вверху — какой сундук выбрать (CHESTS). Рюкзак остался на улице —
     его сетка притушена, в сундук можно положить только то, что в руках. Что куда встанет, решает сервер: окно сразу
     показывает перекладку и шлёт её, а если сервер не согласен, он присылает, как всё лежит на самом деле. -->
<script setup lang="ts">
import { CHESTS, CHEST_KINDS, ITEMS, ITEM_KINDS, PACKS, WORMS, type ChestKind, type Grid, type Hand, type Item, type ItemKind, type Place } from '@fh/shared';
import { CELL, EDGE, backpackLayout, bothHands, cellAt, drawBackpack, handSlots, slotAt, slotOf, type Drag, type From, type Rect } from '~/game/backpack-view';

const emit = defineEmits<{
  move: [id: number, x: number, y: number, rot: boolean];
  drop: [id: number];
  take: [id: number, left?: boolean];    // взять вещь из рюкзака в руки (left — в какую; нет — в свободную)
  stow: [id: number, at: Place];         // убрать вещь из рук в рюкзак, в эту клетку
  give: [kind: ItemKind];
  chestPut: [id: number, at: Place];     // вещь из рюкзака или из рук — в сундук, в эту клетку
  chestTake: [id: number, at: Place];    // вещь из сундука — в рюкзак, в эту клетку
  chestMove: [id: number, x: number, y: number, rot: boolean];
  chestKind: [kind: ChestKind];
}>();
const game = useGameStore();
const el = ref<HTMLCanvasElement>();
const selected = ref<number | null>(null);
const hover = ref<number | null>(null);
const drag = shallowRef<Drag | null>(null);
const hold = shallowRef<{ id: number; k: number } | null>(null);   // вещь держат нажатой: скоро уйдёт в руку или обратно
const gift = ref<ItemKind>(ITEM_KINDS[0]);
const GIFTS = ITEM_KINDS.filter(kind => !ITEMS.isFish(kind));   // рыбу не дают: её достают из ведра
const k = ref(2);                        // во сколько раз холст рюкзака крупнее арт-пикселей
const stacked = ref(false);              // на узком экране рыбак стоит над рюкзаком, а не сбоку

const grid = computed(() => ITEMS.grid(game.pack));
const chestGrid = computed<Grid | null>(() => (game.chestOpen ? CHESTS.grid(game.chest.kind) : null));
const lay = computed(() => backpackLayout(grid.value, stacked.value, chestGrid.value));
const used = computed(() => ITEMS.used(game.items));
const chestUsed = computed(() => ITEMS.used(game.chest.list));
const open = computed(() => game.packOpen || game.chestOpen);
const far = computed(() => !game.actions.open);   // рюкзак не под рукой: открыт только сундук, а рюкзак остался на улице
// вещь по номеру — в рюкзаке она, в руке или в сундуке
const thing = (id: number | null) => (id === null ? null : game.items.find(it => it.id === id) || game.hands.find(it => it.id === id) || game.chest.list.find(it => it.id === id) || null);
const inHand = (id: number | null) => id !== null && game.hands.some(it => it.id === id);
const inChest = (id: number | null) => id !== null && game.chest.list.some(it => it.id === id);
const heavy = (kind: ItemKind) => ITEMS.weight(kind) > 1;
// про какую вещь рассказать внизу: которую тянут, выбранную или ту, что под указателем
const shown = computed(() => thing(drag.value?.id ?? selected.value ?? hover.value));

function cellsText(kind: ItemKind) {
  const n = ITEMS.cells(kind), z = ITEMS.size(kind, false);
  return `${n} ${n === 1 ? 'клетка' : 'клетки'}${n > 1 ? ` · ${z.w}×${z.h}` : ''}`;
}
// сколько рук нужно вещи — и где она сейчас, если уже в руках
const handsText = (kind: ItemKind, held: boolean) => (heavy(kind) ? (held ? 'в двух руках' : 'в две руки') : held ? 'в руке' : 'в одну руку');

// Сколько червей в банке — словами (у банки без счёта он полный: так её завела база).
const wormsText = (it: Item) => WORMS.label(it.worms ?? 0);
// Банки червей и где они на холсте — в рюкзаке, в сундуке или в гнезде руки; ту, что тянут, не подписываем.
const jars = computed(() => {
  const out: { id: number; text: string; empty: boolean; r: { x: number; y: number; w: number; h: number } }[] = [];
  const cells = (list: readonly Item[], o: Rect) => { for (const it of list) if (ITEMS.isBait(it.kind)) out.push({ id: it.id, text: wormsText(it), empty: (it.worms ?? 1) <= 0, r: { x: o.x + EDGE + it.x * CELL, y: o.y + EDGE + it.y * CELL, w: CELL, h: CELL } }); };
  cells(game.items, lay.value.grid);
  if (lay.value.chest) cells(game.chest.list, lay.value.chest);
  for (const { it, at } of handSlots(lay.value, game.hands)) if (ITEMS.isBait(it.kind)) out.push({ id: it.id, text: wormsText(it), empty: (it.worms ?? 1) <= 0, r: { x: at.x, y: at.y + ((at.h + CELL) >> 1) - 2, w: at.w, h: 8 } });
  return out.filter(j => drag.value?.id !== j.id);
});
// Где гнездо руки на холсте — для подписей поверх него (в арт-пикселях; CSS умножает на k).
const slotStyle = (side: Hand) => { const q = slotOf(lay.value, side); return { '--x': q.x, '--y': q.y, '--lw': q.w, '--lh': q.h }; };

function draw() {
  const c = el.value; if (!c) return;
  const chest = chestGrid.value ? { kind: game.chest.kind, grid: chestGrid.value, items: game.chest.list } : null;
  drawBackpack(c.getContext('2d')!, { pack: game.pack, grid: grid.value, layout: lay.value, items: game.items, hands: game.hands, selected: selected.value, hover: hover.value, drag: drag.value, hold: hold.value, chest, far: far.value });
}
watch([() => game.items, () => game.hands, () => game.pack, () => game.chest, selected, hover, drag, hold, open, far, lay, k, stacked], () => nextTick(draw));

// ×3 на больших экранах, как и мир на 1920×1080, ×2 на остальных. Не влезает с рыбаком сбоку — он встаёт над рюкзаком;
// на совсем узких — сколько влезет.
function fit() {
  const side = backpackLayout(grid.value, false, chestGrid.value).w, pile = backpackLayout(grid.value, true, chestGrid.value).w, room = innerWidth - 32;
  const big = innerWidth >= 1200 && innerHeight >= 860 ? 3 : 2;
  if (side * big <= room) { stacked.value = false; k.value = big; }
  else if (side * 2 <= room) { stacked.value = false; k.value = 2; }
  else { stacked.value = true; k.value = Math.max(1, Math.min(2, Math.floor(room / pile))); }
}
watch([grid, chestGrid], fit);

// ---------- в руки и обратно ----------

// Не хватает рук — прежние вещи сами уходят в рюкзак. Тяжёлую вещь берут только в пустые руки: их освобождает сам игрок.
const TAKE_FAIL = { none: '', hands: 'Нужны обе свободные руки — сначала убери то, что в руках', full: 'Вещи из рук некуда положить — в рюкзаке тесно', raw: 'В этой руке сырая рыба, а её в рюкзак не убрать — съешь её или пожарь у костра' };
function take(id: number, side?: Hand) {
  const r = ITEMS.take(grid.value, game.items, game.hands, id, side);
  if (typeof r === 'string') { if (TAKE_FAIL[r]) game.showToast(TAKE_FAIL[r], 'bad'); return; }
  game.items = r.list; game.hands = r.hands; selected.value = id;
  emit('take', id, side && side === 'left');
}
// at — в какую клетку; не названа — туда, где вещь лежала, а занято — на первое свободное место.
function stow(id: number, at: Place | null = null) {
  const r = ITEMS.stow(grid.value, game.items, game.hands, id, at);
  if (!r) { if (inHand(id)) game.showToast(ITEMS.packable(thing(id)!.kind) ? (at ? 'Сюда вещь не встаёт' : 'В рюкзаке нет места') : 'Сырую рыбу в рюкзак не убрать — пожарь её у костра', 'bad'); return; }
  game.items = r.list; game.hands = r.hands; selected.value = id;
  emit('stow', id, { x: r.item.x, y: r.item.y, rot: r.item.rot });
}
// ---------- сундук ----------

// Куда встанет вещь в сетке g: в клетку at (если влезет) или на первое свободное место — так же решает и сервер.
const cellFor = (g: Grid, list: readonly Item[], it: Item, at: Place | null): Place | null => {
  if (!at) return ITEMS.spot(g, list, it.kind);
  const rot = at.rot && ITEMS.turns(it.kind);
  return ITEMS.fits(g, list, it.kind, at.x, at.y, rot, it.id) ? { x: at.x, y: at.y, rot } : null;
};
// Из рюкзака или из рук — в сундук.
function toChest(id: number, at: Place | null = null) {
  const it = thing(id), g = chestGrid.value; if (!it || !g || inChest(id)) return;
  if (ITEMS.isFish(it.kind)) { game.showToast('Рыбе место в холодильнике, а не в сундуке', 'bad'); return; }
  if (game.bags.find(b => b.id === id)?.bag.total) { game.showToast('Ведро с уловом в сундук не убрать — сначала переложи рыбу в холодильник', 'bad'); return; }   // что в ведре в рюкзаке, знает только сервер
  if (!inHand(id) && far.value) { game.showToast('Рюкзак остался на улице — до него не дотянуться', 'bad'); return; }
  const cell = cellFor(g, game.chest.list, it, at);
  if (!cell) { game.showToast(at ? 'Сюда вещь не встаёт' : 'В сундуке нет места', 'bad'); return; }
  game.items = game.items.filter(o => o.id !== id); game.hands = game.hands.filter(o => o.id !== id);
  game.chest = { ...game.chest, list: [...game.chest.list, { ...ITEMS.unheld(it), ...cell }] };
  selected.value = id;
  emit('chestPut', id, cell);
}
// Из сундука — в рюкзак.
function fromChest(id: number, at: Place | null = null) {
  const it = game.chest.list.find(o => o.id === id); if (!it) return;
  if (far.value) { game.showToast('Рюкзак остался на улице — до него не дотянуться', 'bad'); return; }
  const cell = cellFor(grid.value, game.items, it, at);
  if (!cell) { game.showToast(at ? 'Сюда вещь не встаёт' : 'В рюкзаке нет места', 'bad'); return; }
  game.chest = { ...game.chest, list: game.chest.list.filter(o => o.id !== id) };
  game.items = [...game.items, { ...it, ...cell }];
  selected.value = id;
  emit('chestTake', id, cell);
}
function chestPlace(id: number, x: number, y: number, rot: boolean) {
  game.chest = { ...game.chest, list: game.chest.list.map(it => (it.id === id ? { ...it, x, y, rot } : it)) };
  emit('chestMove', id, x, y, rot);
}
function pickChest(kind: ChestKind, ev: Event) {
  blur(ev);
  if (kind === game.chest.kind) return;
  if (!ITEMS.repack(CHESTS.grid(kind), game.chest.list)) { game.showToast('Вещи в этот сундук не влезут — сначала вынь лишнее', 'bad'); return; }
  emit('chestKind', kind);
}

// Двойной клик или удержание: из рюкзака — в руки (а у открытого сундука — в сундук), из рук — в рюкзак, из сундука — в рюкзак.
const swap = (id: number) => (inChest(id) ? fromChest(id) : inHand(id) ? stow(id) : game.chestOpen ? toChest(id) : take(id));

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
// Вещь в сетке rect под точкой.
function itemIn(list: readonly Item[], rect: Rect, x: number, y: number): Item | null {
  if (!within(rect, x, y)) return null;
  const c = cellAt(rect, x, y);
  return list.find(it => { const z = ITEMS.size(it.kind, it.rot); return c.x >= it.x && c.x < it.x + z.w && c.y >= it.y && c.y < it.y + z.h; }) || null;
}
// Вещь в рюкзаке или в сундуке под точкой.
function itemAt(x: number, y: number): { it: Item; from: From } | null {
  const c = lay.value.chest ? itemIn(game.chest.list, lay.value.chest, x, y) : null;
  if (c) return { it: c, from: 'chest' };
  const p = itemIn(game.items, lay.value.grid, x, y);
  return p ? { it: p, from: 'pack' } : null;
}
// Что под указателем: вещь в рюкзаке, в сундуке или та, что в руках (тяжёлая — в обоих гнёздах сразу).
function hit(x: number, y: number): { it: Item; from: From } | null {
  const it = itemAt(x, y);
  if (it) return it;
  const held = handSlots(lay.value, game.hands).find(h => within(h.at, x, y));
  return held ? { it: held.it, from: 'hand' } : null;
}
// Как далеко точка от прямоугольника (0 — внутри): к какой сетке ближе, туда вещь и встанет.
const off = (r: Rect, x: number, y: number) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.y - y, 0, y - r.y - r.h));
// Куда встанет вещь, которую тянут: в ближайшую клетку к её левому верхнему углу (подсветка не вылезает за сетку).
// Над панелью рыбака клетки не ищем: вещь из рюкзака там просится в руки.
// Над сундуком (или ближе к нему, чем к рюкзаку) — в сундук. В руки — только из рюкзака.
function aim(from: From, id: number, kind: ItemKind, rot: boolean, x: number, y: number): Drag {
  const L = lay.value, d: Drag = { id, kind, rot, x, y, from, at: null, into: 'pack', hand: false, ok: false };
  if (press && within(L.pane, press.x, press.y)) {
    if (from !== 'pack') return d;
    const side = slotAt(L, press.x, press.y);           // указатель над гнездом руки — в неё, иначе в свободную
    return { ...d, hand: true, side, ok: !far.value && typeof ITEMS.take(grid.value, game.items, game.hands, id, side) !== 'string' };
  }
  const chest = !!L.chest && !!press && off(L.chest, press.x, press.y) < off(L.grid, press.x, press.y);
  const into = chest ? 'chest' : 'pack', o = chest ? L.chest! : L.grid, g = chest ? chestGrid.value! : grid.value, list = chest ? game.chest.list : game.items;
  const z = ITEMS.size(kind, rot), cx = Math.round((x - o.x - EDGE) / CELL), cy = Math.round((y - o.y - EDGE) / CELL);
  if (z.w > g.w || z.h > g.h) return { ...d, into };
  const at = { x: Math.min(Math.max(cx, 0), g.w - z.w), y: Math.min(Math.max(cy, 0), g.h - z.h) };
  const allowed = chest ? !ITEMS.isFish(kind) && (from !== 'pack' || !far.value) : !far.value;   // рыбе в сундуке не место; рюкзак на улице — в него не положить
  return { ...d, into, at, ok: allowed && at.x === cx && at.y === cy && ITEMS.fits(g, list, kind, cx, cy, rot, id) };
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
  if (ev.button === 2) {                                // правая кнопка поворачивает вещь в рюкзаке или в сундуке
    ev.preventDefault();
    if (drag.value) turnDrag(); else { const p = toArt(ev), h = itemAt(p.x, p.y); if (h) { selected.value = h.it.id; rotate(); } }
    return;
  }
  if (ev.button !== 0) return;
  const p = toArt(ev), h = hit(p.x, p.y), now = performance.now();
  selected.value = h?.it.id ?? null;
  if (!h) { tap = null; return; }
  if (tap && tap.id === h.it.id && now - tap.t < DOUBLE) { tap = null; swap(h.it.id); return; }
  tap = { id: h.it.id, t: now };
  const it = h.it, z = ITEMS.size(it.kind, it.rot), o = h.from === 'chest' ? lay.value.chest! : lay.value.grid;
  // вещь из рюкзака и сундука держат за то место, где нажали; вещь из руки — за середину
  const grab = h.from !== 'hand' ? { gx: p.x - (o.x + EDGE + it.x * CELL), gy: p.y - (o.y + EDGE + it.y * CELL) } : { gx: (z.w * CELL) >> 1, gy: (z.h * CELL) >> 1 };
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
  if (d.hand) { take(d.id, d.side); return; }
  if (!d.ok || !d.at) return;
  const at = { x: d.at.x, y: d.at.y, rot: d.rot };
  if (d.into === 'chest') { if (d.from === 'chest') chestPlace(d.id, at.x, at.y, at.rot); else toChest(d.id, at); }
  else if (d.from === 'hand') stow(d.id, at);
  else if (d.from === 'chest') fromChest(d.id, at);
  else place(d.id, at.x, at.y, at.rot);
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
// Вещь в руках не поворачивают: она клеток не занимает.
function rotate() {
  if (drag.value) { turnDrag(); return; }
  const boxed = inChest(selected.value), list = boxed ? game.chest.list : game.items, g = boxed ? CHESTS.grid(game.chest.kind) : grid.value;
  const it = list.find(i => i.id === selected.value), put = boxed ? chestPlace : place;
  if (!it || !ITEMS.turns(it.kind)) return;
  const others = list.filter(o => o.id !== it.id);
  if (ITEMS.fits(g, others, it.kind, it.x, it.y, !it.rot)) { put(it.id, it.x, it.y, !it.rot); return; }
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (ITEMS.fits(g, others, it.kind, x, y, !it.rot)) { put(it.id, x, y, !it.rot); return; }
  game.showToast('Повернуть не выйдет — тесно', 'bad');
}

// Выложить вещь на землю у ног: её видно всем, и поднять её может любой — и ты сам, клавишей G.
function drop(ev: MouseEvent) {
  blur(ev);
  const id = selected.value; if (id === null) return;
  selected.value = null;
  if (inHand(id)) game.hands = game.hands.filter(it => it.id !== id); else game.items = game.items.filter(it => it.id !== id);
  emit('drop', id);
}

function close() { game.packOpen = false; game.chestOpen = false; }
// после клика снимаем фокус с кнопки, иначе пробел и Enter будут нажимать её, а не подсекать
function blur(ev: Event) { (ev.currentTarget as HTMLElement).blur(); }

watch([() => game.packOpen, () => game.chestOpen], () => {
  cancel(); tap = null; selected.value = null; hover.value = null;
  if (open.value) fit();
});
// уснул от голода — окно закрывается (и клавиши рюкзака не слушаются, пока спит)
watch(() => game.hunger.until, asleep => { if (asleep && open.value) close(); });
// отошёл от рюкзака, оставив его на земле, — окно закрывается (у открытого сундука рюкзак просто притушен)
watch(() => game.actions.open, near => {
  if (!near && game.packOpen && !game.chestOpen) { game.packOpen = false; game.showToast('Рюкзак остался позади'); }
});
// вещь, на которой стояло выделение, исчезла (выбросили, сервер прислал другое)
watch([() => game.items, () => game.hands, () => game.chest], () => { if (selected.value !== null && !thing(selected.value)) selected.value = null; });

// Клавиши ловим раньше движка: Esc при открытом рюкзаке закрывает его, а не поднимает рыбака с места.
function key(ev: KeyboardEvent) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || game.hunger.until) return;
  if ((ev.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
  if (ev.code === 'KeyI') { if (!ev.repeat) { if (game.chestOpen) close(); else game.togglePack(); } ev.preventDefault(); return; }
  if (!open.value) return;
  if (ev.code === 'Escape') { close(); ev.preventDefault(); ev.stopImmediatePropagation(); }
  else if (ev.code === 'KeyR' && !ev.repeat) { rotate(); ev.preventDefault(); }
}
onMounted(() => { addEventListener('keydown', key, { capture: true }); addEventListener('resize', fit); fit(); });
onBeforeUnmount(() => { removeEventListener('keydown', key, { capture: true }); removeEventListener('resize', fit); stopHold(); });
</script>

<template>
  <section v-if="open" class="backpack" :style="{ '--k': k, '--w': lay.w, '--h': lay.h }" role="dialog" :aria-label="game.chestOpen ? 'Сундук и рюкзак' : 'Рюкзак'">
    <header>
      <template v-if="game.chestOpen">
        <h2>{{ CHESTS.name(game.chest.kind) }}</h2>
        <span class="room" title="Сколько клеток сундука занято">{{ chestUsed }} / {{ chestGrid!.w * chestGrid!.h }}</span>
        <span class="and">и</span>
        <h2>{{ PACKS.name(game.pack).toLowerCase() }} рюкзак</h2>
      </template>
      <h2 v-else>{{ PACKS.name(game.pack) }} рюкзак</h2>
      <span class="room" title="Сколько клеток рюкзака занято">{{ used }} / {{ grid.w * grid.h }}</span>
      <button type="button" class="close" title="Закрыть — I или Esc" @click="close">×</button>
    </header>
    <!-- какой сундук стоит в доме: вещи должны влезть в новый -->
    <div v-if="game.chestOpen" class="kinds" role="group" aria-label="Какой сундук">
      <button v-for="kind in CHEST_KINDS" :key="kind" type="button" :class="{ on: game.chest.kind === kind }" :aria-pressed="game.chest.kind === kind" @click="pickChest(kind, $event)">
        {{ CHESTS.name(kind) }} <small>{{ CHESTS.grid(kind).w }}×{{ CHESTS.grid(kind).h }}</small>
      </button>
    </div>
    <div class="board">
      <canvas
        ref="el" :width="lay.w" :height="lay.h" :class="{ dragging: drag, over: hover !== null }"
        @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @pointerleave="hover = null" @contextmenu.prevent
      />
      <!-- подпись над рыбаком: заняты ли руки -->
      <span class="hand" :class="{ empty: !game.hands.length }" :style="{ '--x': lay.label.x, '--y': lay.label.y, '--lw': lay.label.w, '--lh': lay.label.h }">{{ game.hands.length ? 'В руках' : 'Руки пусты' }}</span>
      <!-- клавиша каждой руки над её гнездом; с тяжёлой вещью гнездо левой руки закрыто, и на нём сказано почему -->
      <span v-for="side in (['left', 'right'] as const)" :key="side" class="key" :style="slotStyle(side)">{{ side === 'left' ? 'Q' : 'E' }}</span>
      <span v-if="bothHands(game.hands)" class="busy" :style="slotStyle('left')">держит двумя руками</span>
      <!-- сколько червей в банке — прямо на ней -->
      <span v-for="j in jars" :key="'jar' + j.id" class="jar" :class="{ empty: j.empty }" :style="{ '--x': j.r.x, '--y': j.r.y, '--lw': j.r.w, '--lh': j.r.h }">{{ j.text }}</span>
      <!-- рюкзак остался на улице: его сетка притушена, и на ней сказано почему -->
      <span v-if="far" class="far" :style="{ '--x': lay.grid.x, '--y': lay.grid.y, '--lw': lay.grid.w, '--lh': lay.grid.h }"><span>Рюкзак на улице</span></span>
    </div>
    <footer>
      <template v-if="shown">
        <div class="what"><b>{{ ITEMS.title(shown) }}</b><span class="cells">{{ inHand(shown.id) ? handsText(shown.kind, true) : cellsText(shown.kind) + ' · ' + (inChest(shown.id) ? 'в сундуке' : handsText(shown.kind, false)) }}</span></div>
        <p v-if="ITEMS.isBait(shown.kind)" class="text">В банке: <b class="count" :class="{ empty: (shown.worms ?? 1) <= 0 }">{{ wormsText(shown) }}</b><template v-if="(shown.worms ?? 1) <= 0"> — накопай лопатой</template></p>
        <p class="text">{{ ITEMS.info(shown.kind).text }}</p>
        <div v-if="selected === shown.id && !drag" class="buttons">
          <template v-if="inChest(shown.id)">
            <button type="button" :disabled="far" @click="blur($event); fromChest(shown.id)">В рюкзак</button>
            <button v-if="ITEMS.turns(shown.kind)" type="button" @click="blur($event); rotate()"><kbd>R</kbd>Повернуть</button>
          </template>
          <template v-else>
            <button v-if="inHand(shown.id) && ITEMS.packable(shown.kind)" type="button" :disabled="far" @click="blur($event); stow(shown.id)">В рюкзак</button>
            <template v-else-if="!inHand(shown.id)">
              <button type="button" @click="blur($event); take(shown.id)">{{ heavy(shown.kind) ? 'В руки' : 'В руку' }}</button>
              <button v-if="ITEMS.turns(shown.kind)" type="button" @click="blur($event); rotate()"><kbd>R</kbd>Повернуть</button>
            </template>
            <button v-if="game.chestOpen && !ITEMS.isFish(shown.kind)" type="button" :disabled="far && !inHand(shown.id)" @click="blur($event); toChest(shown.id)">В сундук</button>
            <button v-if="!game.chestOpen" type="button" @click="drop">На землю</button>
          </template>
        </div>
      </template>
      <p v-else-if="game.chestOpen" class="text muted">
        Перетаскивай вещи между сундуком и рюкзаком. Двойной клик или удержание — переложить в сундук или обратно.
        Вещи в сундуке никто не унесёт, а рыбу храни в холодильнике.
      </p>
      <p v-else class="text muted">
        Перетащи вещь на свободные клетки. Двойной клик или удержание — взять в руки или убрать обратно.
        Лёгкая вещь занимает одну руку, тяжёлая — обе.
        <span class="for-keys"><kbd>R</kbd> или правая кнопка — повернуть.</span>
      </p>
      <!-- разработка: положить в рюкзак любую вещь (сервер слушает это, только когда разрешено и время с погодой) -->
      <div v-if="game.sky.canSet" class="dev">
        <select v-model="gift" aria-label="Какую вещь положить" @change="blur">
          <option v-for="kind in GIFTS" :key="kind" :value="kind">{{ ITEMS.info(kind).name }} · {{ cellsText(kind) }}</option>
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
  max-height: calc(92vh - 16px); overflow: auto;   /* с подъёмом на 4% окно не уходит за верх экрана */
  border: 1px solid var(--line); border-radius: 9px;
  background: rgba(40, 22, 12, 0.94);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
  font-size: 13px;
}
header { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
header h2 { font-size: 18px; color: var(--coat); white-space: nowrap; }
.room { font: 600 12px/1 var(--mono); color: var(--paper-dim); }
header .close { margin-left: auto; }
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
.far {
  position: absolute; left: calc(var(--x) * var(--k) * 1px); top: calc(var(--y) * var(--k) * 1px);
  width: calc(var(--lw) * var(--k) * 1px); height: calc(var(--lh) * var(--k) * 1px);
  display: grid; place-items: center;
  font: 400 calc(5px * var(--k) + 2px)/1.1 var(--pixel); color: var(--paper); text-align: center;
  pointer-events: none;
}
.far span { padding: 3px 8px; border-radius: 6px; background: rgba(20, 8, 4, 0.85); }
.and { color: var(--paper-dim); }
.kinds { display: flex; flex-wrap: wrap; gap: 4px; }
.kinds button {
  padding: 4px 9px;
  border: 1px solid rgba(244, 227, 193, 0.3); border-radius: 7px;
  background: none; color: var(--paper);
  font: 600 12px/1.2 var(--text); cursor: pointer;
}
.kinds button small { color: var(--paper-dim); font-weight: 400; }
.kinds button.on { border-color: var(--coat); color: var(--coat); }
.kinds button:hover { background: var(--wood-hover); }
.buttons button:disabled { opacity: 0.45; cursor: default; }
.key, .busy {
  position: absolute; left: calc(var(--x) * var(--k) * 1px); top: calc(var(--y) * var(--k) * 1px);
  width: calc(var(--lw) * var(--k) * 1px); height: calc(var(--lh) * var(--k) * 1px);
  font: 400 calc(5px * var(--k) + 2px)/1 var(--pixel); color: var(--paper-dim); text-align: center;
  pointer-events: none;
}
.key { display: flex; align-items: flex-end; justify-content: center; padding-bottom: calc(3px * var(--k)); opacity: 0.7; }
.jar {
  position: absolute; left: calc(var(--x) * var(--k) * 1px); top: calc(var(--y) * var(--k) * 1px);
  width: calc(var(--lw) * var(--k) * 1px); height: calc(var(--lh) * var(--k) * 1px);
  display: flex; align-items: flex-end; justify-content: center;
  font: 400 calc(3px * var(--k) + 3px)/1 var(--pixel); color: var(--paper); text-shadow: 0 1px 0 #240702, 1px 0 0 #240702, -1px 0 0 #240702, 0 -1px 0 #240702;
  pointer-events: none;
}
.jar.empty, .count.empty { color: #e88a6a; }
.count { font-weight: 600; color: var(--paper); }
.busy { display: grid; place-items: center; writing-mode: vertical-rl; transform: rotate(180deg); letter-spacing: 0.04em; }
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
.dev { padding-top: 6px; border-top: 1px dashed var(--line); }
.dev select { flex: 1 1 0; min-width: 0; }
@media (hover: none) and (pointer: coarse) { .for-keys, .buttons kbd { display: none; } }
@media (max-width: 560px) { header h2 { font-size: 15px; } }
</style>
