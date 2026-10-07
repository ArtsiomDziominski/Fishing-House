<!-- Справа вверху: часы и погода причала, кто сейчас здесь (имя — ссылка на профиль) и выход в меню.
     В разработке часы и погоду можно выставить: это делает сервер, сразу у всех игроков. -->
<script setup lang="ts">
import { WEATHERS, WEATHER_NAMES, type WeatherKind } from '@fh/shared';

const emit = defineEmits<{
  clock: [hour: number | null];                            // перевести часы причала на этот час; null — настоящее время
  weather: [kind: WeatherKind | null, wind: boolean | null];   // выставить погоду и ветер; null — по расписанию
}>();
const game = useGameStore();
const { user } = useUserSession();
const open = ref<'clock' | 'list' | null>(null);

const PRESETS = [{ name: 'Утро', hour: 6 }, { name: 'День', hour: 12 }, { name: 'Вечер', hour: 19 }, { name: 'Ночь', hour: 23 }];
const DAY_MINUTES = 24 * 60;
const KINDS: { name: string; kind: WeatherKind | null }[] = [{ name: 'Сама', kind: null }, ...WEATHERS.map(kind => ({ name: WEATHER_NAMES[kind], kind }))];
const WINDS: { name: string; wind: boolean | null }[] = [{ name: 'Сам', wind: null }, { name: 'Тихо', wind: false }, { name: 'Дует', wind: true }];
// что-то выставлено вручную — время или погода не такие, как были бы сами
const manual = computed(() => game.sky.moved || game.sky.fixKind !== null || game.sky.fixWind !== null);

// Пока ползунок тянут, он показывает то, что под пальцем, а не ответ сервера: тот приходит с опозданием и дёргал бы ручку назад.
const draft = ref<number | null>(null);
let settle: ReturnType<typeof setTimeout> | undefined;
function slide(ev: Event) {
  clearTimeout(settle);
  draft.value = Number((ev.currentTarget as HTMLInputElement).value);
  emit('clock', draft.value / 60);
}
function release(ev: Event) {                          // отпустили: фокус снимаем, чтобы клавиши снова вели героя
  blur(ev);
  clearTimeout(settle); settle = setTimeout(() => { draft.value = null; }, 500);
}
onBeforeUnmount(() => clearTimeout(settle));

// после клика снимаем фокус с кнопки, иначе пробел и Enter будут нажимать её, а не подсекать
function blur(ev: Event) { (ev.currentTarget as HTMLElement).blur(); }
function toggle(ev: Event, what: 'clock' | 'list') { blur(ev); open.value = open.value === what ? null : what; }
function setClock(ev: Event, hour: number | null) { blur(ev); draft.value = null; emit('clock', hour); }
function setKind(ev: Event, kind: WeatherKind | null) { blur(ev); emit('weather', kind, game.sky.fixWind); }
function setWind(ev: Event, wind: boolean | null) { blur(ev); emit('weather', game.sky.fixKind, wind); }
</script>

<template>
  <div class="online">
    <div class="bar">
      <template v-if="game.sky.label">
        <button
          v-if="game.sky.canSet" type="button" class="chip clock" :class="{ manual }"
          title="Время и погода на причале. Нажми, чтобы выставить их" :aria-expanded="open === 'clock'" @click="toggle($event, 'clock')"
        >
          {{ game.sky.label }}<span class="wx"> · {{ game.sky.weather }}</span>
        </button>
        <span v-else class="chip clock still" title="Время и погода на причале: игровой час идёт минуту">{{ game.sky.label }}<span class="wx"> · {{ game.sky.weather }}</span></span>
      </template>
      <button type="button" class="chip" :aria-expanded="open === 'list'" @click="toggle($event, 'list')">
        <span class="dot" :class="'is-' + game.status" />
        На причале: {{ game.online.length }}
      </button>
      <NuxtLink to="/" class="chip" title="В меню">Меню</NuxtLink>
    </div>

    <div v-if="open === 'clock' && game.sky.canSet" class="list skybox">
      <label class="group">
        <span>Перевести часы</span>
        <!-- ползунок — минуты игровых суток с шагом в десять -->
        <input
          type="range" min="0" :max="DAY_MINUTES - 10" step="10" :value="draft ?? game.sky.minutes" aria-label="Время суток"
          @input="slide" @change="release"
        >
      </label>
      <div class="row four">
        <button v-for="p in PRESETS" :key="p.name" type="button" @click="setClock($event, p.hour)">{{ p.name }}</button>
      </div>
      <button type="button" :disabled="!game.sky.moved" @click="setClock($event, null)">Настоящее время</button>

      <div class="group">
        <span>Погода — {{ game.sky.weather.toLowerCase() }}</span>
        <div class="row two">
          <button v-for="k in KINDS" :key="k.name" type="button" :class="{ on: game.sky.fixKind === k.kind }" :aria-pressed="game.sky.fixKind === k.kind" @click="setKind($event, k.kind)">{{ k.name }}</button>
        </div>
      </div>
      <div class="group">
        <span>Ветер</span>
        <div class="row three">
          <button v-for="w in WINDS" :key="w.name" type="button" :class="{ on: game.sky.fixWind === w.wind }" :aria-pressed="game.sky.fixWind === w.wind" @click="setWind($event, w.wind)">{{ w.name }}</button>
        </div>
      </div>
      <p class="muted">Время и погода меняются на сервере — сразу у всех игроков. Работает только в разработке.</p>
    </div>

    <ul v-if="open === 'list'" class="list">
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
.chip, .skybox button {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 11px;
  border: 1px solid rgba(244, 227, 193, 0.3); border-radius: 8px;
  background: var(--wood);
  color: var(--paper);
  font: 600 13px/1.2 var(--text);
  text-decoration: none;
  cursor: pointer;
}
.chip:hover, .skybox button:hover { background: var(--wood-hover); color: var(--paper); }
.chip.clock { gap: 0; white-space: pre; font-variant-numeric: tabular-nums; }
.chip.clock.manual { border-color: var(--coat); }   /* время или погода выставлены вручную */
.chip.clock.still { cursor: default; }
.chip.clock.still:hover { background: var(--wood); }
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
.skybox { display: grid; gap: 8px; width: 244px; max-height: 80vh; padding: 10px 12px; user-select: none; }
.group { display: grid; gap: 6px; font-weight: 600; }
.group input { width: 100%; margin: 0; accent-color: var(--coat); cursor: pointer; }
.row { display: grid; gap: 4px; }
.row.four { grid-template-columns: repeat(4, 1fr); }
.row.three { grid-template-columns: repeat(3, 1fr); }
.row.two { grid-template-columns: repeat(2, 1fr); }
.skybox button { justify-content: center; padding: 6px 4px; background: none; }
.skybox button.on { border-color: var(--coat); color: var(--coat); }
.skybox button:disabled { opacity: 0.4; cursor: default; background: none; }
.skybox p { margin: 0; font-size: 12px; line-height: 1.35; }
@media (max-width: 560px) {
  .online { top: 64px; }   /* под панелью ведра */
  .wx { display: none; }   /* на узком экране погоду видно и так — в чипе остаются только часы */
}
</style>
