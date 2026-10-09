<!-- Что в руках — панель слева вверху (где она стоит, решает страница игры, .hud-left): левая рука (Q) и правая (E),
     тяжёлая вещь — одной строкой на обе. У ведра под ним — какая рыба в нём и сколько: нажать на рыбу — достать её
     в свободную руку (take). У банки — сколько червей, как в рюкзаке (WORMS.label). Остальное — просто название. -->
<script setup lang="ts">
import { FISH, ITEMS, WORMS, type Hand, type Item } from '@fh/shared';
import { itemSprite } from '~/game/items-art';

const emit = defineEmits<{ take: [species: string] }>();
const game = useGameStore();

// картинка вещи — та же, что в рюкзаке; холст собирается один раз, а адрес картинки запоминаем
const icons = new Map<string, string>();
function icon(it: Item) {
  const key = it.kind + ':' + (it.fish ?? '');
  let src = icons.get(key);
  if (!src) { src = itemSprite(it.kind, false, it.fish).toDataURL(); icons.set(key, src); }
  return src;
}

const rows = computed(() => {
  const heavy = game.hands.find(it => ITEMS.weight(it.kind) > 1);
  if (heavy) return [{ side: 'both' as const, label: 'Обе руки', it: heavy }];
  const at = (side: Hand) => game.hands.find(it => ITEMS.sideOf(it) === side) ?? null;
  return [{ side: 'left' as const, label: 'Левая', it: at('left') }, { side: 'right' as const, label: 'Правая', it: at('right') }];
});

const caught = computed(() => FISH.SPECIES.filter(sp => game.bag.counts[sp.id]));
</script>

<template>
  <aside class="hands" aria-label="Что в руках">
    <div v-for="r in rows" :key="r.side" class="row" :class="{ empty: !r.it }">
      <div class="head">
        <span class="side">{{ r.label }}<kbd v-if="r.side === 'left'">Q</kbd><kbd v-else-if="r.side === 'right'">E</kbd></span>
        <span class="pic"><img v-if="r.it" :src="icon(r.it)" alt=""></span>
        <span class="name">{{ r.it ? ITEMS.title(r.it) : 'пусто' }}</span>
        <b v-if="r.it && ITEMS.isBait(r.it.kind)" class="n" :class="{ none: (r.it.worms ?? 1) <= 0 }">{{ WORMS.label(r.it.worms ?? 0) }}</b>
        <b v-else-if="r.it && ITEMS.isBucket(r.it.kind)" class="n">{{ game.bag.total ? `${game.bag.total} · ${FISH.weightText(game.bag.grams)}` : 'пусто' }}</b>
      </div>
      <ul v-if="r.it && ITEMS.isBucket(r.it.kind) && caught.length" class="fish">
        <li v-for="sp in caught" :key="sp.id" :title="`${sp.name}: ${game.bag.counts[sp.id]} шт., самая крупная ${FISH.weightText(game.bag.best[sp.id] || 0)} — нажми, чтобы достать в руку`" @click="emit('take', sp.id)">
          <FishIcon :id="sp.id" />
          <span>{{ sp.name }}</span>
          <b>×{{ game.bag.counts[sp.id] }}</b>
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
.n { margin-left: auto; padding-left: 12px; font: 600 12px/1 Consolas, "Courier New", monospace; }
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
