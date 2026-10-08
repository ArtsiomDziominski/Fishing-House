<!-- Низ экрана: кнопки действий (то же, что E, Q, I, L, F и Esc) и подсказка по управлению. -->
<script setup lang="ts">
import { ITEMS } from '@fh/shared';

const emit = defineEmits<{ bucket: []; pack: []; open: []; lamp: []; fish: []; stand: [] }>();
const game = useGameStore();

// Лампу зажигают и гасят, когда она в рюкзаке, а рюкзак на спине или рядом — как и перекладывают вещи.
const hasLamp = computed(() => game.actions.open && ITEMS.lit(game.items));
function onKey(ev: KeyboardEvent) {
  if (ev.code !== 'KeyL' || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey || !hasLamp.value) return;
  if ((ev.target as HTMLElement | null)?.closest?.('input, select, textarea')) return;
  emit('lamp');
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

// после клика снимаем фокус с кнопки, иначе пробел и Enter будут нажимать её, а не подсекать
function press(ev: MouseEvent, what: 'bucket' | 'pack' | 'open' | 'lamp' | 'fish' | 'stand') {
  (ev.currentTarget as HTMLElement).blur();
  if (what === 'bucket') emit('bucket'); else if (what === 'pack') emit('pack'); else if (what === 'open') emit('open'); else if (what === 'lamp') emit('lamp'); else if (what === 'fish') emit('fish'); else emit('stand');
}
</script>

<template>
  <div class="dock">
    <div class="actions">
      <button v-if="game.actions.bucket" type="button" @click="press($event, 'bucket')"><kbd>E</kbd><span>{{ game.actions.bucket }}</span></button>
      <button v-if="game.actions.pack" type="button" @click="press($event, 'pack')"><kbd>Q</kbd><span>{{ game.actions.pack }}</span></button>
      <button v-if="game.actions.open" type="button" @click="press($event, 'open')"><kbd>I</kbd><span>{{ game.packOpen ? 'Закрыть рюкзак' : 'Открыть рюкзак' }}</span></button>
      <button v-if="hasLamp" type="button" @click="press($event, 'lamp')"><kbd>L</kbd><span>{{ game.actions.lamp ? 'Погасить лампу' : 'Зажечь лампу' }}</span></button>
      <button v-if="game.actions.fish" type="button" :class="{ hot: game.actions.hot }" @click="press($event, 'fish')"><kbd>F</kbd><span>{{ game.actions.fish }}</span></button>
      <button v-if="game.actions.stand" type="button" @click="press($event, 'stand')"><kbd>Esc</kbd><span>Встать</span></button>
    </div>

    <div v-if="game.debug !== null" class="hint debug">{{ game.debug }}</div>
    <div v-else class="hint" :class="{ quiet: game.quietHint }">
      <span class="for-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> или клик — идти</span>
      <span class="for-keys"><kbd>E</kbd> — взять или поставить ведро</span>
      <span class="for-keys"><kbd>Q</kbd> — надеть или снять рюкзак</span>
      <span class="for-keys"><kbd>I</kbd> — заглянуть в рюкзак</span>
      <span v-if="hasLamp" class="for-keys"><kbd>L</kbd> — зажечь или погасить лампу</span>
      <span class="for-keys"><kbd>F</kbd> или пробел — рыбачить</span>
      <span class="for-touch">Коснись места — рыбак пойдёт туда</span>
      <span class="for-touch">Ведро, рюкзак и рыбалка — кнопками внизу</span>
    </div>
  </div>
</template>

<style scoped>
.dock {
  position: fixed; left: 0; right: 0; bottom: 12px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 0 140px;   /* слева — выбор рюкзака; справа столько же, чтобы кнопки стояли по центру */
  pointer-events: none;
  font-size: 13px;
}
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.actions button {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  border: 1px solid rgba(244, 227, 193, 0.35); border-radius: 9px;
  background: rgba(40, 22, 12, 0.9);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  color: var(--paper);
  font: 600 14px/1.2 var(--text);
  cursor: pointer;
  pointer-events: auto;
}
.actions button:hover { background: var(--wood-hover); }
.actions button.hot { border-color: var(--ink); background: var(--coat); color: var(--ink); animation: tug 0.28s ease-in-out infinite alternate; }
.actions button.hot kbd { border-color: rgba(36, 7, 2, 0.6); background: rgba(36, 7, 2, 0.1); }
@keyframes tug { to { transform: translateY(-3px) scale(1.06); } }

.hint {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 18px;
  padding: 7px 14px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
  transition: opacity 0.6s ease;
}
.hint.quiet { opacity: 0.32; }
.hint.debug { font-family: var(--mono); white-space: normal; }
.hint .for-touch { display: none; }
@media (hover: none) and (pointer: coarse) {
  .hint .for-keys, .actions kbd { display: none; }
  .hint .for-touch { display: inline; }
}
@media (max-width: 560px) {
  .dock { bottom: 54px; padding: 0 12px; }
  .hint.quiet { display: none; }
}
</style>
