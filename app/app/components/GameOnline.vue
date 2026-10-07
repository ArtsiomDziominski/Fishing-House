<!-- Справа вверху: выход в меню и кто сейчас на этом причале (имя — ссылка на профиль). -->
<script setup lang="ts">
const game = useGameStore();
const { user } = useUserSession();
const open = ref(false);
</script>

<template>
  <div class="online">
    <div class="bar">
      <button type="button" class="chip" :aria-expanded="open" @click="open = !open; ($event.currentTarget as HTMLElement).blur()">
        <span class="dot" :class="'is-' + game.status" />
        На причале: {{ game.online.length }}
      </button>
      <NuxtLink to="/" class="chip" title="В меню">Меню</NuxtLink>
    </div>
    <ul v-if="open" class="list">
      <li v-for="p in game.online" :key="p.pid">
        <a :href="`/player/${p.pid}`" target="_blank" rel="noopener">{{ p.name }}</a>
        <span v-if="p.pid === user?.id" class="muted"> — это ты</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.online { position: fixed; right: 12px; top: 12px; display: grid; justify-items: end; gap: 6px; font-size: 13px; }
.bar { display: flex; gap: 6px; }
.chip {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 11px;
  border: 1px solid rgba(244, 227, 193, 0.3); border-radius: 8px;
  background: var(--wood);
  color: var(--paper);
  font: 600 13px/1.2 var(--text);
  text-decoration: none;
  cursor: pointer;
}
.chip:hover { background: var(--wood-hover); color: var(--paper); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--paper-dim); }
.dot.is-online { background: var(--good); }
.dot.is-reconnecting, .dot.is-connecting { background: var(--coat); }
.dot.is-offline, .dot.is-error, .dot.is-replaced { background: var(--bad); }
.list {
  margin: 0; padding: 8px 12px; list-style: none;
  max-height: 50vh; overflow: auto; min-width: 160px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood);
  user-select: text;
}
.list li { padding: 2px 0; }
@media (max-width: 560px) { .online { top: 64px; } }   /* под панелью ведра */
</style>
