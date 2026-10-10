<!-- Главное меню. Кнопки «Подсказки» и «Настройки» меняют кнопки меню на подсказки (components/MenuHints.vue) или настройки
     (components/MenuSettings.vue) в той же панели. -->
<script setup lang="ts">
const { loggedIn, user, clear } = useUserSession();
const settings = ref(false);   // открыты настройки; открываются только нажатием, то есть уже в браузере
const hints = ref(false);      // открыты подсказки

async function logout() {
  await clear();
  await navigateTo('/');
}
</script>

<template>
  <main class="menu panel">
    <img class="icon" src="/assets/icon.png" alt="" width="57" height="57">
    <h1>Fishing House</h1>
    <p class="tagline muted">Домик рыбака у реки, общий остров и открытый океан.</p>

    <ClientOnly v-if="settings">
      <MenuSettings @back="settings = false" />
    </ClientOnly>
    <MenuHints v-else-if="hints" @back="hints = false" />
    <nav v-else-if="loggedIn && user" class="buttons">
      <p class="hello">Привет, <b>{{ user.name }}</b>!</p>
      <NuxtLink to="/play" class="btn primary">Играть</NuxtLink>
      <NuxtLink :to="`/player/${user.id}`" class="btn">Мой улов и профиль</NuxtLink>
      <button type="button" class="btn" @click="hints = true">Подсказки</button>
      <button type="button" class="btn" @click="settings = true">Настройки</button>
      <button type="button" class="btn ghost" @click="logout">Выйти</button>
    </nav>
    <nav v-else class="buttons">
      <NuxtLink to="/login" class="btn primary">Войти</NuxtLink>
      <NuxtLink to="/register" class="btn">Регистрация</NuxtLink>
      <button type="button" class="btn" @click="hints = true">Подсказки</button>
      <button type="button" class="btn" @click="settings = true">Настройки</button>
    </nav>
  </main>
</template>

<style scoped>
.menu { width: min(420px, 100%); padding: 28px 28px 22px; text-align: center; }
.icon { image-rendering: pixelated; display: block; margin: 0 auto 10px; }
h1 { font-size: 40px; color: var(--coat); text-shadow: 0 3px 0 var(--ink); }
.tagline { margin: 10px 0 22px; }
.buttons { display: grid; gap: 10px; }
.hello { margin: 0 0 4px; }
</style>
