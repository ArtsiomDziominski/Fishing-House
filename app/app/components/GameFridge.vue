<!-- Холодильник в доме — своя полка игрока (FRIDGE): открывается F или кликом, стоя у него, и закрывается, когда отошёл.
     Рыба на полке — по видам, сырая и жареная отдельно: нажать — достать одну в свободную руку (take). Внизу — положить
     рыбу из рук (put) и переложить весь улов из ведра в руке (stock). Решает сервер, полку присылает он же. -->
<script setup lang="ts">
import { FISH, FRIDGE, ITEMS } from '@fh/shared';

const emit = defineEmits<{ put: []; take: [id: number]; stock: [] }>();
const game = useGameStore();

// Одинаковая рыба — одной строкой: вид, сырая или жареная, сколько; берут первую из них.
const rows = computed(() => {
  const by = new Map<string, { key: string; kind: 'fish' | 'fish-fried'; fish: string; ids: number[] }>();
  for (const f of game.fridge) {
    const key = f.kind + ':' + f.fish, row = by.get(key) ?? { key, kind: f.kind, fish: f.fish, ids: [] };
    row.ids.push(f.id); by.set(key, row);
  }
  return [...by.values()].sort((a, b) => a.fish.localeCompare(b.fish) || a.kind.localeCompare(b.kind));
});
const fishInHand = computed(() => game.hands.some(it => ITEMS.isFish(it.kind)));
const pailInHand = computed(() => game.hands.some(it => ITEMS.isBucket(it.kind)));
const full = computed(() => game.fridge.length >= FRIDGE.MAX);
</script>

<template>
  <aside v-if="game.fridgeOpen" class="fridge" aria-label="Холодильник">
    <div class="head">
      <span>Холодильник</span>
      <b>{{ game.fridge.length }} / {{ FRIDGE.MAX }}</b>
      <button type="button" class="close" aria-label="Закрыть" @click="game.toggleFridge(false)">×</button>
    </div>
    <ul v-if="rows.length" class="rows">
      <li v-for="r in rows" :key="r.key">
        <button type="button" :title="'Взять в руку: ' + ITEMS.title(r).toLowerCase()" @click="emit('take', r.ids[0]!)">
          <FishIcon :id="r.fish" :class="{ fried: r.kind === 'fish-fried' }" />
          <span>{{ FISH.byId[r.fish]?.name ?? 'Рыба' }} <small class="muted">{{ r.kind === 'fish-fried' ? 'жареная' : 'сырая' }}</small></span>
          <b>×{{ r.ids.length }}</b>
        </button>
      </li>
    </ul>
    <p v-else class="muted empty">Пусто. Положи сюда рыбу — здесь она не пропадёт, даже если уснёшь от голода.</p>
    <div class="buttons">
      <button type="button" :disabled="!fishInHand || full" @click="emit('put')">Положить рыбу из рук</button>
      <button v-if="pailInHand" type="button" :disabled="!game.bag.total || full" @click="emit('stock')">Переложить улов из ведра ({{ game.bag.total }})</button>
    </div>
    <p class="muted tip">Нажми на рыбу — возьмёшь её в свободную руку</p>
  </aside>
</template>

<style scoped>
.fridge {
  position: fixed; right: 12px; top: 64px; width: 280px;
  padding: 8px 12px 10px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  font-size: 13px;
}
.head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid var(--line); font-weight: 600; }
.head b { margin-left: auto; font-weight: 600; }
.close { border: 0; background: none; color: var(--paper); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
.rows { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; }
.rows button {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 2px 4px; border: 0; border-radius: 6px; background: none;
  color: var(--paper); font: inherit; text-align: left; cursor: pointer;
}
.rows button:hover { background: var(--wood-hover); }
.rows b { margin-left: auto; font-weight: 600; }
.fried { filter: sepia(0.7) saturate(1.6) brightness(0.8); }   /* жареная — подрумянена, как в рюкзаке */
.empty { margin: 4px 0 8px; }
.buttons { display: grid; gap: 6px; margin-top: 8px; }
.buttons button {
  padding: 7px 10px;
  border: 1px solid rgba(244, 227, 193, 0.35); border-radius: 8px;
  background: rgba(40, 22, 12, 0.9); color: var(--paper);
  font: 600 13px/1.2 var(--text); cursor: pointer;
}
.buttons button:hover:not(:disabled) { background: var(--wood-hover); }
.buttons button:disabled { opacity: 0.45; cursor: default; }
.tip { margin: 8px 0 0; font-size: 12px; }
@media (max-width: 560px) { .fridge { left: 12px; right: 12px; width: auto; top: auto; bottom: 120px; } }
</style>
