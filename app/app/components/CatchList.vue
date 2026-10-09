<!-- Ведро по видам: значок, имя, сколько поймано. Используется в игре и в профиле игрока.
     pickable — в игре: по пойманной рыбе можно нажать, чтобы достать её из ведра в руку (pick). -->
<script setup lang="ts">
import { FISH, type Bag } from '@fh/shared';

const props = defineProps<{ bag: Bag; compact?: boolean; pickable?: boolean }>();
const emit = defineEmits<{ pick: [species: string] }>();
const can = (id: string) => props.pickable && !!props.bag.counts[id];
// у причала не клюёт (FISH: chance 0) — ловят её только с мостков острова
const where = (sp: (typeof FISH.SPECIES)[number]) => (sp.chance ? '' : ' — клюёт только у острова');
</script>

<template>
  <ul class="catch-list" :class="{ compact }">
    <li
      v-for="sp in FISH.SPECIES" :key="sp.id" :class="{ caught: bag.counts[sp.id], pick: can(sp.id) }"
      :title="bag.counts[sp.id] ? `${sp.name}: ${bag.counts[sp.id]} шт., самая крупная ${FISH.weightText(bag.best[sp.id] || 0)}${can(sp.id) ? ' — нажми, чтобы достать в руку' : ''}` : `${sp.name}: ${pickable ? 'в ведре нет' : 'ещё не поймана'}${where(sp)}`"
      @click="can(sp.id) && emit('pick', sp.id)"
    >
      <FishIcon :id="sp.id" :dim="!bag.counts[sp.id]" />
      <span class="name">{{ sp.name }}</span>
      <span v-if="!compact && bag.counts[sp.id]" class="best">до {{ FISH.weightText(bag.best[sp.id] || 0) }}</span>
      <span class="n">{{ bag.counts[sp.id] ? '×' + bag.counts[sp.id] : '' }}</span>
    </li>
  </ul>
</template>

<style scoped>
.catch-list { margin: 0; padding: 0; list-style: none; }
.catch-list li { display: flex; align-items: center; gap: 8px; height: 24px; opacity: 0.55; }
.catch-list li.caught { opacity: 1; }
.catch-list li.pick { cursor: pointer; border-radius: 5px; }
.catch-list li.pick:hover { background: var(--wood-hover); }
.catch-list .best { margin-left: auto; padding-left: 14px; opacity: 0.7; font-size: 12px; }
.catch-list .n { margin-left: auto; padding-left: 14px; font: 600 12px/1 Consolas, "Courier New", monospace; min-width: 3ch; text-align: right; }
.catch-list .best + .n { margin-left: 0; }
@media (max-width: 560px) {
  .catch-list.compact { display: flex; justify-content: space-between; gap: 4px; }
  .catch-list.compact li { flex-direction: column; gap: 2px; height: auto; }
  .catch-list.compact .name { display: none; }
  .catch-list.compact .n { margin: 0; padding: 0; min-height: 12px; text-align: center; }
}
</style>
