<!-- Что в руках — панель слева вверху (где она стоит, решает страница игры, .hud-left): левая рука (Q) и правая (E),
     тяжёлая вещь — одной строкой на обе. У ведра — сколько в нём рыб из скольких (ITEMS.capacity) и какая рыба: нажать на
     рыбу — достать её в свободную руку (take). Ниже — ведро на земле под рукой (game.near): из него достать рыбу может
     любой; в океане там — ведро в своей лодке («В лодке»). У банки — сколько червей, как в рюкзаке (WORMS.label). Остальное — просто название. -->
<script setup lang="ts">
import { FISH, ITEMS, WORMS, type Hand, type Item } from '@fh/shared';
import { itemSprite } from '~/game/items-art';

const emit = defineEmits<{ take: [species: string, pail: number] }>();
const game = useGameStore();

// картинка вещи — та же, что в рюкзаке; холст собирается один раз, а адрес картинки запоминаем
const icons = new Map<string, string>();
function icon(it: Pick<Item, 'kind' | 'fish'>) {
  const key = it.kind + ':' + (it.fish ?? '');
  let src = icons.get(key);
  if (!src) { src = itemSprite(it.kind, false, it.fish).toDataURL(); icons.set(key, src); }
  return src;
}

// Что в ведре: сколько каких рыб (best — самая крупная, если знаем), всего и сколько влезает.
interface Pail { id: number; counts: Record<string, number>; best: Record<string, number>; total: number; grams: number | null; size: number }
function inHand(it: Item): Pail {
  const bag = game.bags.find(b => b.id === it.id)?.bag;
  return { id: it.id, counts: bag?.counts ?? {}, best: bag?.best ?? {}, total: bag?.total ?? 0, grams: bag?.grams ?? 0, size: ITEMS.capacity(it.kind) };
}

const rows = computed(() => {
  const pail = (it: Item | null) => (it && ITEMS.isBucket(it.kind) ? inHand(it) : null);
  const heavy = game.hands.find(it => ITEMS.weight(it.kind) > 1);
  if (heavy) return [{ side: 'both' as const, label: 'Обе руки', it: heavy, pail: null }];
  const at = (side: Hand) => game.hands.find(it => ITEMS.sideOf(it) === side) ?? null;
  return (['left', 'right'] as const).map(side => ({ side, label: side === 'left' ? 'Левая' : 'Правая', it: at(side), pail: pail(at(side)) }));
});
// ведро на земле под рукой: веса рыб в нём не видно — только сколько каких
const near = computed(() => {
  const n = game.near; if (!n) return null;
  const total = Object.values(n.haul).reduce((a, b) => a + b, 0);
  return { boat: !!n.boat, it: { kind: n.kind as Item['kind'] }, pail: { id: n.id, counts: n.haul, best: {}, total, grams: null, size: ITEMS.capacity(n.kind) } as Pail };
});

const caught = (p: Pail) => FISH.SPECIES.filter(sp => p.counts[sp.id]);
const fill = (p: Pail) => `${p.total} / ${p.size}${p.total && p.grams ? ` · ${FISH.weightText(p.grams)}` : ''}`;
const hint = (p: Pail, sp: { id: string; name: string }) =>
  `${sp.name}: ${p.counts[sp.id]} шт.${p.best[sp.id] ? `, самая крупная ${FISH.weightText(p.best[sp.id]!)}` : ''} — нажми, чтобы достать в руку`;
</script>

<template>
  <aside class="hands" aria-label="Что в руках">
    <div v-for="r in rows" :key="r.side" class="row" :class="{ empty: !r.it }">
      <div class="head">
        <span class="side">{{ r.label }}<kbd v-if="r.side === 'left'">Q</kbd><kbd v-else-if="r.side === 'right'">E</kbd></span>
        <span class="pic"><img v-if="r.it" :src="icon(r.it)" alt=""></span>
        <span class="name">{{ r.it ? ITEMS.title(r.it) : 'пусто' }}</span>
        <b v-if="r.it && ITEMS.isBait(r.it.kind)" class="n" :class="{ none: (r.it.worms ?? 1) <= 0 }">{{ WORMS.label(r.it.worms ?? 0) }}</b>
        <b v-else-if="r.pail" class="n" :class="{ none: r.pail.total >= r.pail.size }" :title="r.pail.total >= r.pail.size ? 'Ведро полное' : ''">{{ fill(r.pail) }}</b>
      </div>
      <ul v-if="r.pail && caught(r.pail).length" class="fish">
        <li v-for="sp in caught(r.pail)" :key="sp.id" :title="hint(r.pail, sp)" @click="emit('take', sp.id, r.pail.id)">
          <FishIcon :id="sp.id" />
          <span>{{ sp.name }}</span>
          <b>×{{ r.pail.counts[sp.id] }}</b>
        </li>
      </ul>
    </div>
    <div v-if="near" class="row near">
      <div class="head">
        <span class="side">{{ near.boat ? 'В лодке' : 'Рядом' }}</span>
        <span class="pic"><img :src="icon(near.it)" alt=""></span>
        <span class="name">{{ ITEMS.title(near.it) }}</span>
        <b class="n" :class="{ none: near.pail.total >= near.pail.size }" :title="near.pail.total >= near.pail.size ? 'Ведро полное' : ''">{{ fill(near.pail) }}</b>
      </div>
      <ul v-if="caught(near.pail).length" class="fish">
        <li v-for="sp in caught(near.pail)" :key="sp.id" :title="hint(near.pail, sp)" @click="emit('take', sp.id, near.pail.id)">
          <FishIcon :id="sp.id" />
          <span>{{ sp.name }}</span>
          <b>×{{ near.pail.counts[sp.id] }}</b>
        </li>
      </ul>
    </div>
  </aside>
</template>

<style scoped>
.hands {
  min-width: 200px; padding: 6px 12px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  font-size: 13px;
}
.row + .row { border-top: 1px solid var(--line); }
.head { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.side { display: flex; align-items: center; gap: 4px; min-width: 66px; opacity: 0.75; }
.side kbd { font-size: 10px; }
.pic { display: grid; place-items: center; width: 28px; height: 28px; }
.pic img { max-width: 28px; max-height: 28px; image-rendering: pixelated; }
.empty .name { opacity: 0.55; }
.n { margin-left: auto; padding-left: 12px; font: 600 12px/1 Consolas, "Courier New", monospace; white-space: nowrap; }
.n.none { color: #e8826a; }
.fish { margin: 0 0 6px; padding: 0; list-style: none; }
.fish li { display: flex; align-items: center; gap: 8px; height: 24px; padding: 0 4px; border-radius: 5px; cursor: pointer; }
.fish li:hover { background: var(--wood-hover); }
.fish b { margin-left: auto; padding-left: 12px; font: 600 12px/1 Consolas, "Courier New", monospace; }
@media (max-width: 560px) {
  .hands { padding: 4px 10px; }
  .side { min-width: 0; }
  .side kbd { display: none; }
}
</style>
