<!-- Сытость — своя панель под ведром (стоят в одной колонке, .hud-left на странице игры): тает за световой день, рыба с костра её пополняет. Пустая — герой голоден и еле ходит. -->
<script setup lang="ts">
import { HUNGER } from '@fh/shared';

const game = useGameStore();
const food = computed(() => game.hunger.food);
const tone = computed(() => (food.value <= 0 ? 'empty' : food.value <= HUNGER.LOW ? 'low' : ''));
</script>

<template>
  <div class="hunger" :class="tone" :title="food > 0 ? 'Сытость: пополняет рыба, жаренная на костре' : 'Голоден: поешь, иначе уснёшь от усталости'">
    <span class="label">{{ food > 0 ? 'Сытость' : 'Голоден!' }}</span>
    <span class="bar" role="meter" aria-label="Сытость" :aria-valuenow="food" aria-valuemin="0" :aria-valuemax="HUNGER.MAX"><i :style="{ width: food / HUNGER.MAX * 100 + '%' }" /></span>
    <b>{{ food }}</b>
  </div>
</template>

<style scoped>
.hunger {
  display: flex; align-items: center; gap: 8px;
  min-width: 200px; padding: 7px 12px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  font-size: 13px;
}
@media (max-width: 560px) {
  .hunger { padding: 6px 10px; }
}
.label { min-width: 62px; }
.bar { flex: 1 1 auto; min-width: 60px; height: 8px; border: 1px solid rgba(36, 7, 2, 0.8); border-radius: 3px; background: rgba(36, 7, 2, 0.5); overflow: hidden; }
.bar i { display: block; height: 100%; background: #8a9a3c; transition: width 0.6s ease; }
b { min-width: 3ch; text-align: right; font: 600 12px/1 Consolas, "Courier New", monospace; }
.low .bar i { background: #d9a03a; }
.empty .label { color: #e8826a; animation: pulse 1s ease-in-out infinite alternate; }
@keyframes pulse { to { opacity: 0.45; } }
</style>
