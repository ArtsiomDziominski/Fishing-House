<!-- Главное меню. -->
<script setup lang="ts">
const { loggedIn, user, clear } = useUserSession();

async function logout() {
  await clear();
  await navigateTo('/');
}
</script>

<template>
  <main class="menu panel">
    <img class="icon" src="/assets/icon.png" alt="" width="57" height="57">
    <h1>Fishing House</h1>
    <p class="tagline muted">Домик рыбака у реки. Общий причал, своё ведро и пять видов рыб.</p>

    <nav v-if="loggedIn && user" class="buttons">
      <p class="hello">Привет, <b>{{ user.name }}</b>!</p>
      <NuxtLink to="/play" class="btn primary">Играть</NuxtLink>
      <NuxtLink :to="`/player/${user.id}`" class="btn">Мой улов и профиль</NuxtLink>
      <button type="button" class="btn ghost" @click="logout">Выйти</button>
    </nav>
    <nav v-else class="buttons">
      <NuxtLink to="/login" class="btn primary">Войти</NuxtLink>
      <NuxtLink to="/register" class="btn">Регистрация</NuxtLink>
    </nav>

    <details class="how">
      <summary>Как играть</summary>
      <ul>
        <li>Ходи клавишами <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> или кликом по миру.</li>
        <li>Принеси ведро к причалу: <kbd>E</kbd> — взять или поставить.</li>
        <li>Сядь на край причала и забрось удочку: <kbd>F</kbd> или пробел.</li>
        <li>Поплавок ушёл под воду, над головой <b>!</b> — подсекай. Рыба летит в ведро.</li>
        <li>На причале рыбачат и другие игроки — их имена видно над головами.</li>
      </ul>
    </details>
  </main>
</template>

<style scoped>
.menu { width: min(420px, 100%); padding: 28px 28px 22px; text-align: center; }
.icon { image-rendering: pixelated; display: block; margin: 0 auto 10px; }
h1 { font-size: 40px; color: var(--coat); text-shadow: 0 3px 0 var(--ink); }
.tagline { margin: 10px 0 22px; }
.buttons { display: grid; gap: 10px; }
.hello { margin: 0 0 4px; }
.how { margin-top: 20px; text-align: left; }
.how summary { cursor: pointer; color: var(--paper-dim); text-align: center; }
.how ul { margin: 12px 0 0; padding-left: 18px; display: grid; gap: 6px; }
</style>
