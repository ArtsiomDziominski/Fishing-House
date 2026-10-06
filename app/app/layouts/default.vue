<!-- Страницы вокруг игры: меню, вход, профиль. Фон — размытый мир, по центру — деревянная панель. -->
<template>
  <div class="page">
    <img class="backdrop" src="/assets/world.png" alt="" aria-hidden="true">
    <slot />
  </div>
</template>

<style scoped>
.page { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px; }
</style>
