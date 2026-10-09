<!-- Настройки в главном меню: пока только звук. Выбор лежит в браузере (fh-sound в хранилище игры), игра читает его при входе.
     Рисовать только в браузере (ClientOnly): на сервере хранилища нет, и выбор приехал бы на страницу как «включён». -->
<script setup lang="ts">
const emit = defineEmits<{ back: [] }>();
const game = useGameStore();
</script>

<template>
  <section class="settings" aria-label="Настройки">
    <h2>Настройки</h2>
    <button type="button" class="btn" :aria-pressed="game.sound" @click="game.setSound(!game.sound)">
      {{ game.sound ? 'Звук: включён' : 'Звук: выключен' }}
    </button>
    <button type="button" class="btn ghost" @click="emit('back')">Назад</button>
  </section>
</template>

<style scoped>
.settings { display: grid; gap: 10px; }
h2 { margin: 0 0 4px; font-size: 22px; color: var(--coat); }
</style>
