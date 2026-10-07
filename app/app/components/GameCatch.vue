<!-- Что лежит в ведре — панель слева вверху. -->
<script setup lang="ts">
import { FISH } from '@fh/shared';

const game = useGameStore();
</script>

<template>
  <aside class="catch" aria-label="Улов">
    <div class="head">
      <img src="/assets/bucket.png" alt="">
      <span>В ведре</span>
      <b>{{ game.bag.total ? `${game.bag.total} · ${FISH.weightText(game.bag.grams)}` : 'пусто' }}</b>
    </div>
    <CatchList :bag="game.bag" compact />
  </aside>
</template>

<style scoped>
.catch {
  position: fixed; left: 12px; top: 12px;
  padding: 8px 12px 9px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  font-size: 13px;
}
.head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid var(--line); }
.head img { width: 34px; height: 36px; image-rendering: pixelated; }
.head b { margin-left: auto; padding-left: 14px; font-weight: 600; }
@media (max-width: 560px) {
  .catch { right: 12px; padding: 6px 10px; }
  .head { display: none; }
}
</style>
