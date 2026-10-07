<!-- Форма входа и регистрации: одна разметка, разная кнопка и адрес API. После успеха — в игру (или куда просили). -->
<script setup lang="ts">
import { NAME_MAX, NAME_MIN, PASSWORD_MIN, credentialsSchema } from '@fh/shared';

const props = defineProps<{ mode: 'login' | 'register' }>();
const route = useRoute();
const { fetch: refreshSession } = useUserSession();

const error = ref('');
const busy = ref(false);
const ready = ref(false);              // пока скрипты не ожили, форма не отправляется — иначе браузер отправил бы её сам
onMounted(() => { ready.value = true; });
const isRegister = computed(() => props.mode === 'register');

// Значения берём прямо из полей, а не через v-model: так не теряется то, что успели ввести до загрузки скриптов.
async function submit(ev: Event) {
  const form = new FormData(ev.target as HTMLFormElement);
  const name = String(form.get('name') || ''), password = String(form.get('password') || '');
  error.value = '';
  if (isRegister.value) {
    const check = credentialsSchema.safeParse({ name, password });
    if (!check.success) { error.value = check.error.issues[0]?.message || 'Проверьте имя и пароль'; return; }
  }
  busy.value = true;
  try {
    await $fetch(isRegister.value ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: { name, password },
    });
    await refreshSession();
    const q = route.query.next, next = typeof q === 'string' && /^\/(?!\/)/.test(q) ? q : '/play';   // только свои адреса
    await navigateTo(next);
  } catch (e: any) {
    error.value = e?.data?.message || 'Не получилось. Попробуйте ещё раз';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="auth panel" method="post" @submit.prevent="submit">
    <h1>{{ isRegister ? 'Регистрация' : 'Вход' }}</h1>
    <label class="field">
      Имя рыбака
      <input
        name="name" autocomplete="username" required
        :minlength="isRegister ? NAME_MIN : 1" :maxlength="NAME_MAX" autofocus
      >
      <small v-if="isRegister">{{ NAME_MIN }}–{{ NAME_MAX }} символов: буквы, цифры, _ и -. Его увидят другие игроки.</small>
    </label>
    <label class="field">
      Пароль
      <input
        name="password" type="password" required
        :autocomplete="isRegister ? 'new-password' : 'current-password'" :minlength="isRegister ? PASSWORD_MIN : 1" maxlength="128"
      >
      <small v-if="isRegister">Не короче {{ PASSWORD_MIN }} символов.</small>
    </label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button class="btn primary" type="submit" :disabled="busy || !ready">
      {{ busy ? 'Минутку…' : isRegister ? 'Создать рыбака' : 'Войти' }}
    </button>
    <p class="switch muted">
      <template v-if="isRegister">Уже играешь? <NuxtLink :to="{ path: '/login', query: route.query }">Войти</NuxtLink></template>
      <template v-else>Первый раз здесь? <NuxtLink :to="{ path: '/register', query: route.query }">Регистрация</NuxtLink></template>
      · <NuxtLink to="/">В меню</NuxtLink>
    </p>
  </form>
</template>

<style scoped>
.auth { width: min(380px, 100%); padding: 26px; display: grid; gap: 16px; }
h1 { font-size: 30px; color: var(--coat); text-shadow: 0 3px 0 var(--ink); text-align: center; }
.error { margin: 0; }
.switch { margin: 0; text-align: center; font-size: 13px; }
</style>
