<!-- Сон от голода: экран чёрный, посередине — надпись и сколько ещё ждать. Проснётся герой у своего дома, сытым. -->
<script setup lang="ts">
const game = useGameStore();
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 250); });
onBeforeUnmount(() => clearInterval(timer));

// связь закрылась — чёрный экран уходит: под ним кнопки «Подключиться снова»; пока переподключаемся, он остаётся
const inGame = computed(() => game.status === 'online' || game.status === 'reconnecting');
const left = computed(() => Math.max(0, Math.ceil((game.hunger.until - now.value) / 1000)));
const clock = computed(() => `${Math.floor(left.value / 60)}:${String(left.value % 60).padStart(2, '0')}`);
// 1 рыба, 2 рыбы, 5 рыб
const fish = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'рыба' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'рыбы' : 'рыб');
const lost = computed(() => {
  const n = game.hunger.lost;
  if (n === null) return '';
  return n ? `Пока ты спал, из ведра ${n % 10 === 1 && n % 100 !== 11 ? 'пропала' : 'пропало'} ${n} ${fish(n)}.` : 'Рыба в ведре цела.';
});
</script>

<template>
  <Transition name="sleep">
    <div v-if="game.hunger.until && inGame" class="sleep" role="alertdialog" aria-live="assertive" aria-label="Ты уснул от голода">
      <div class="zz" aria-hidden="true">z z z</div>
      <h2>Ты уснул от голода</h2>
      <p>{{ left ? `Проснёшься у своего дома, сытым, через ${clock}` : 'Просыпаешься…' }}</p>
      <p v-if="lost" class="muted">{{ lost }}</p>
    </div>
  </Transition>
</template>

<style scoped>
.sleep {
  position: fixed; inset: 0;                  /* поверх игры и рюкзака, но под окном связи — оно ниже на странице */
  display: grid; place-content: center; justify-items: center; gap: 10px; padding: 16px;
  background: #000; color: var(--paper); text-align: center;
}
.sleep h2 { font-size: 26px; color: var(--coat); }
.sleep p { margin: 0; font-size: 16px; }
.zz { font: 400 22px/1 var(--pixel); letter-spacing: 0.4em; color: var(--paper-dim); animation: drift 2.4s ease-in-out infinite; }
@keyframes drift { 50% { transform: translateY(-6px); opacity: 0.6; } }
.sleep-enter-active, .sleep-leave-active { transition: opacity 1.2s ease; }
.sleep-enter-from, .sleep-leave-to { opacity: 0; }
</style>
