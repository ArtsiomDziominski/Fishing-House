<!-- Всплывающее сообщение сверху: поймал, сорвалась, ведро далеко. -->
<script setup lang="ts">
const game = useGameStore();
</script>

<template>
  <div class="toast" :class="[game.toast.tone, { show: game.toast.show }]" role="status" aria-live="polite">
    <FishIcon v-if="game.toast.fishId" :id="game.toast.fishId" />
    {{ game.toast.text }}
  </div>
</template>

<style scoped>
.toast {
  position: fixed; left: 0; right: 0; top: 14px;
  width: fit-content; max-width: calc(100% - 24px); margin: 0 auto;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--line); border-radius: 9px;
  background: rgba(40, 22, 12, 0.9);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  font-size: 14px; text-align: center;
  opacity: 0; transform: translateY(-8px);
  transition: opacity 0.25s ease, transform 0.25s ease;
  pointer-events: none;
}
.toast.show { opacity: 1; transform: none; }
.toast.good { border-color: rgba(250, 199, 8, 0.7); }
.toast.bad { border-color: rgba(201, 83, 45, 0.7); }
@media (max-width: 560px) { .toast { top: 104px; } }
</style>
