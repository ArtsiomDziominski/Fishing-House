<!-- Сел в лодку — куда плыть (game.sailing — места, куда можно отсюда): от причала — на общий остров или в открытый океан,
     с острова — в океан или домой, из океана — к острову или домой. Клавиши 1, 2 — выбрать, Esc — передумать
     (Esc ловит и движок: закрывает это окно, а не встаёт). Отошёл от лодки — окно закрывает движок. Выбор — go. -->
<script setup lang="ts">
import type { Voyage } from '@fh/shared';

const emit = defineEmits<{ go: [to: Voyage]; stay: [] }>();
const game = useGameStore();

// Что за место и чем оно хорошо — коротко, чтобы выбрать не раздумывая.
const PLACES: Record<Voyage, { name: string; text: string }> = {
  isle: { name: 'На общий остров', text: 'Сюда приплывают со всех причалов. С мостков и с берега клюют лещ и сом, есть костёр' },
  sea: { name: 'В открытый океан', text: 'Рыбачишь из своей лодки где хочешь. Морская рыба, а у косяка, где кружат чайки, клюёт чаще и крупнее' },
  home: { name: 'Домой, к причалу', text: 'Обратно к причалу, от которого отплыл' },
};
const list = computed(() => (game.sailing ?? []).map((to, i) => ({ to, key: String(i + 1), ...PLACES[to] })));

function pick(ev: Event | null, to: Voyage) {
  (ev?.currentTarget as HTMLElement | null)?.blur();
  emit('go', to);
}
function onKey(ev: KeyboardEvent) {
  if (!game.sailing || game.mapOpen || ev.ctrlKey || ev.metaKey || ev.altKey || (ev.target as HTMLElement | null)?.closest?.('input, textarea')) return;
  const it = list.value.find(p => p.key === ev.key);
  if (it) { ev.preventDefault(); pick(null, it.to); }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <aside v-if="game.sailing" class="voyage" aria-label="Куда плыть">
    <div class="head">
      <span>Куда плыть?</span>
      <button type="button" class="close" aria-label="Остаться" @click="emit('stay')">×</button>
    </div>
    <button v-for="p in list" :key="p.to" type="button" class="place" @click="pick($event, p.to)">
      <kbd>{{ p.key }}</kbd>
      <span><b>{{ p.name }}</b><small>{{ p.text }}</small></span>
    </button>
    <p class="muted tip"><kbd>Esc</kbd> — остаться</p>
  </aside>
</template>

<style scoped>
.voyage {
  position: fixed; left: 50%; bottom: 130px; transform: translateX(-50%); width: min(360px, calc(100vw - 24px));
  display: grid; gap: 6px;
  padding: 8px 12px 10px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  font-size: 13px;
}
.head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--line); font-weight: 600; }
.close { margin-left: auto; border: 0; background: none; color: var(--paper); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
.place {
  display: flex; align-items: flex-start; gap: 10px; width: 100%;
  padding: 7px 10px;
  border: 1px solid rgba(244, 227, 193, 0.35); border-radius: 8px;
  background: rgba(40, 22, 12, 0.9); color: var(--paper);
  font: 13px/1.3 var(--text); text-align: left; cursor: pointer;
}
.place:hover { background: var(--wood-hover); }
.place span { display: grid; gap: 2px; }
.place b { font-weight: 600; font-size: 14px; }
.place small { opacity: 0.75; }
.tip { margin: 2px 0 0; font-size: 12px; }
</style>
