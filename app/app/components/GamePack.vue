<!-- Слева внизу: какой рюкзак у героя. Клик открывает список — выбрать другой (его увидят и остальные на причале).
     Рюкзаки разной вместимости; в меньший можно перейти, только если вещи в него влезут — тогда они сразу перекладываются. -->
<script setup lang="ts">
import { ITEMS, PACKS, PACK_KINDS, World, type PackKind } from '@fh/shared';

const emit = defineEmits<{ pick: [kind: PackKind] }>();
const game = useGameStore();
const open = ref(false);

// Картинки — кадры листа pack.png в порядке PACK_KINDS; размер кадра знает карта.
const sheet = { '--w': World.pack.icon.w, '--h': World.pack.icon.h, '--n': PACK_KINDS.length };
const frame = (kind: PackKind) => ({ '--i': PACK_KINDS.indexOf(kind) });

// после клика снимаем фокус с кнопки, иначе пробел и Enter будут нажимать её, а не подсекать
function toggle(ev: MouseEvent) { (ev.currentTarget as HTMLElement).blur(); open.value = !open.value; }
function pick(kind: PackKind) {
  open.value = false;
  if (kind === game.pack) return;
  // раскладываем так же, как сервер, — вещи сразу видны на новых местах; не влезают — рюкзак не меняем
  const list = ITEMS.repack(PACKS.grid(kind), game.items);
  if (!list) { game.showToast(`Вещи не влезут в ${PACKS.name(kind).toLowerCase()} рюкзак — сначала выложи лишнее`, 'bad'); return; }
  game.items = list.sort((a, b) => a.id - b.id);
  emit('pick', kind);
}
const room = (kind: PackKind) => { const g = PACKS.grid(kind); return `${g.w}×${g.h}`; };
</script>

<template>
  <div class="packs" :style="sheet">
    <ul v-if="open" class="list" aria-label="Рюкзаки">
      <li v-for="kind in PACK_KINDS" :key="kind">
        <button type="button" :class="{ on: kind === game.pack }" :aria-pressed="kind === game.pack" @click="pick(kind)">
          <i class="pic" :style="frame(kind)" /><span>{{ PACKS.name(kind) }}</span><small :title="`${PACKS.grid(kind).w * PACKS.grid(kind).h} клеток для вещей`">{{ room(kind) }}</small>
        </button>
      </li>
    </ul>
    <button type="button" class="chip" title="Выбрать рюкзак" :aria-expanded="open" @click="toggle">
      <i class="pic" :style="frame(game.pack)" /><span>Рюкзак</span>
    </button>
  </div>
</template>

<style scoped>
.packs { --k: 2; position: fixed; left: 12px; bottom: 12px; display: grid; justify-items: start; gap: 6px; font-size: 13px; }
.pic {
  display: block; flex: none;
  width: calc(var(--w) * var(--k) * 1px); height: calc(var(--h) * var(--k) * 1px);
  background: url('/assets/pack.png') calc(var(--i) * var(--w) * var(--k) * -1px) 0 / calc(var(--n) * var(--w) * var(--k) * 1px) auto no-repeat;
  image-rendering: pixelated;
}
.chip, .list button {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid rgba(244, 227, 193, 0.3); border-radius: 8px;
  background: var(--wood); color: var(--paper);
  font: 600 13px/1.2 var(--text);
  cursor: pointer;
}
.chip { padding: 4px 11px 4px 7px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35); }
.chip:hover, .list button:hover { background: var(--wood-hover); }
.list {
  margin: 0; padding: 6px; list-style: none; display: grid; gap: 4px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}
.list button { width: 100%; padding: 4px 12px 4px 6px; border-color: transparent; background: none; }
.list button.on { border-color: var(--coat); }
.list small { margin-left: auto; padding-left: 12px; font: 600 11px/1 var(--mono); color: var(--paper-dim); }
@media (max-width: 560px) {
  .chip { --k: 1; padding: 6px; }   /* рядом с кнопками масштаба — того же роста */
  .chip span { display: none; }
}
</style>
