<!-- Публичный профиль: кто угодно, зная id игрока, видит его деньги, ведро и последние уловы. -->
<script setup lang="ts">
import { FISH } from '@fh/shared';
import type { Profile } from '@fh/shared/server';

const route = useRoute();
const id = computed(() => String(route.params.id));
const { user } = useUserSession();
const { data: p, error } = await useFetch<Profile>(() => `/api/players/${id.value}`);
const mine = computed(() => user.value?.id === id.value);

useHead(() => ({ title: p.value ? `${p.value.name} — Fishing House` : 'Игрок не найден — Fishing House' }));

const date = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const time = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const money = (n: number) => {
  const m10 = n % 10, m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'монета' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'монеты' : 'монет';
  return `${n.toLocaleString('ru-RU')} ${word}`;
};

const copied = ref(false);
async function copyLink() {
  try { await navigator.clipboard.writeText(location.href); copied.value = true; setTimeout(() => { copied.value = false; }, 1500); } catch { /* буфер недоступен */ }
}
</script>

<template>
  <main class="profile panel">
    <template v-if="p">
      <header>
        <img class="icon" src="/assets/icon.png" alt="" width="38" height="38">
        <div>
          <h1>{{ p.name }}</h1>
          <p class="muted">Рыбачит с {{ date(p.createdAt) }} · последний раз в игре {{ p.lastSeenAt ? date(p.lastSeenAt) : 'ещё не был' }}</p>
        </div>
      </header>

      <section class="stats">
        <div><span class="muted">Деньги</span><b>{{ money(p.money) }}</b></div>
        <div><span class="muted">Рыб в ведре</span><b>{{ p.bag.total }}</b></div>
        <div><span class="muted">Общий вес</span><b>{{ p.bag.total ? FISH.weightText(p.bag.grams) : '—' }}</b></div>
      </section>

      <section>
        <h2>Ведро</h2>
        <CatchList :bag="p.bag" />
      </section>

      <section v-if="p.latest.length">
        <h2>Последние уловы</h2>
        <ul class="latest">
          <li v-for="(c, i) in p.latest" :key="i">
            <FishIcon :id="c.species" />
            <span>{{ FISH.byId[c.species]?.name || c.species }}</span>
            <b>{{ FISH.weightText(c.grams) }}</b>
            <span class="muted when">{{ time(c.caughtAt) }}</span>
          </li>
        </ul>
      </section>

      <footer>
        <NuxtLink v-if="mine" to="/play" class="btn primary">Играть</NuxtLink>
        <button type="button" class="btn" @click="copyLink">{{ copied ? 'Ссылка скопирована' : 'Ссылка на профиль' }}</button>
        <NuxtLink to="/" class="btn ghost">В меню</NuxtLink>
      </footer>
      <p class="id muted">id игрока: <code>{{ p.id }}</code></p>
    </template>

    <template v-else>
      <h1>Игрок не найден</h1>
      <p class="muted">{{ error?.statusCode === 404 ? 'Такого id нет. Проверь ссылку.' : 'Не удалось загрузить профиль.' }}</p>
      <footer><NuxtLink to="/" class="btn">В меню</NuxtLink></footer>
    </template>
  </main>
</template>

<style scoped>
.profile { width: min(520px, 100%); padding: 24px 26px; display: grid; gap: 20px; }
header { display: flex; align-items: center; gap: 14px; }
.icon { image-rendering: pixelated; }
h1 { font-size: 30px; color: var(--coat); text-shadow: 0 3px 0 var(--ink); word-break: break-word; }
header p { margin: 4px 0 0; font-size: 13px; }
h2 { font-size: 18px; margin-bottom: 10px; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.stats div { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: rgba(15, 8, 4, 0.35); }
.stats span { font-size: 12px; }
.stats b { font: 400 22px/1.2 var(--pixel); }
.latest { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.latest li { display: flex; align-items: center; gap: 10px; }
.latest .when { margin-left: auto; font-size: 12px; }
footer { display: flex; flex-wrap: wrap; gap: 10px; }
.id { margin: -8px 0 0; font-size: 12px; }
@media (max-width: 480px) { .stats { grid-template-columns: 1fr 1fr; } }
</style>
