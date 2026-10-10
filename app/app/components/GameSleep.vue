<!-- Сон от голода: экран чёрный, посередине — надпись и сколько ещё ждать. Проснётся герой у дома этого причала (в гостях — у чужого), сытым.
     Пока он без сознания, из рюкзака и рук крадут часть вещей, — проснувшись, он видит записку об этом (game.robbed),
     пока сам её не закроет. -->
<script setup lang="ts">
const game = useGameStore();
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 250); });
onBeforeUnmount(() => clearInterval(timer));

// связь закрылась — чёрный экран уходит: под ним кнопки «Подключиться снова»; пока переподключаемся, он остаётся
const inGame = computed(() => game.status === 'online' || game.status === 'reconnecting');
const left = computed(() => Math.max(0, Math.ceil((game.hunger.until - now.value) / 1000)));
const where = computed(() => (game.whose.guest && game.where !== 'isle' && game.where !== 'sea' ? 'у дома' : 'у своего дома'));   // в гостях просыпаются у дома хозяина, в общих водах лодку прибивает к своему причалу
const clock = computed(() => `${Math.floor(left.value / 60)}:${String(left.value % 60).padStart(2, '0')}`);
</script>

<template>
  <Transition name="sleep">
    <div v-if="game.hunger.until && inGame" class="sleep" role="alertdialog" aria-live="assertive" aria-label="Ты уснул от голода">
      <div class="zz" aria-hidden="true">z z z</div>
      <h2>Ты уснул от голода</h2>
      <p>{{ left ? `Проснёшься ${where}, сытым, через ${clock}` : 'Просыпаешься…' }}</p>
      <p class="muted">Пока ты без сознания, вещи в рюкзаке и в руках без присмотра. Что лежит в холодильнике и в сундуке дома, никто не тронет.</p>
    </div>
  </Transition>
  <Transition name="note">
    <div v-if="game.robbed && !game.hunger.until && inGame" class="robbed" role="alert">
      <h3>Ты очнулся {{ where }}</h3>
      <p>Пока ты лежал без сознания, кто-то порылся в твоих вещах. Возможно, что-то пропало из рюкзака или из рук — загляни в рюкзак (I) и проверь.</p>
      <button type="button" @click="game.robbed = false">Понятно</button>
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
.sleep p { margin: 0; font-size: 16px; max-width: 420px; }
.zz { font: 400 22px/1 var(--pixel); letter-spacing: 0.4em; color: var(--paper-dim); animation: drift 2.4s ease-in-out infinite; }
@keyframes drift { 50% { transform: translateY(-6px); opacity: 0.6; } }
.sleep-enter-active, .sleep-leave-active { transition: opacity 1.2s ease; }
.sleep-enter-from, .sleep-leave-to { opacity: 0; }
.robbed {
  position: fixed; left: 50%; top: 22%; transform: translateX(-50%);
  width: min(360px, calc(100vw - 32px)); padding: 14px 16px 12px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood); color: var(--paper);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  font-size: 14px; text-align: center;
}
.robbed h3 { margin: 0 0 6px; font-size: 17px; color: var(--coat); }
.robbed p { margin: 0 0 12px; line-height: 1.4; }
.robbed button { padding: 6px 18px; cursor: pointer; }
.note-enter-active, .note-leave-active { transition: opacity 0.4s ease; }
.note-enter-from, .note-leave-to { opacity: 0; }
</style>
