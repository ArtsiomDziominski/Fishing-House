<!-- Справа вверху: часы и погода причала, клёв (нажать — кто сейчас клюёт охотнее), чей это причал (и куда сходить в гости;
     в общих водах — общий остров или открытый океан), кто сейчас здесь (имя — ссылка на профиль) и выход в меню.
     В разработке часы и погоду можно выставить: это делает сервер, сразу у всех игроков. -->
<script setup lang="ts">
import { SEA_ROOM, WEATHERS, WEATHER_NAMES, type WeatherKind } from '@fh/shared';
import type { BiteInfo } from '~/game/engine';

const emit = defineEmits<{
  clock: [hour: number | null];                            // перевести часы причала на этот час; null — настоящее время
  weather: [kind: WeatherKind | null, wind: boolean | null];   // выставить погоду и ветер; null — по расписанию
  piers: [];                                               // спросить у сервера, где сейчас есть игроки
  visit: [owner: string];                                  // перейти на причал этого игрока (свой id — домой)
}>();
const game = useGameStore();
const { user } = useUserSession();
const open = ref<'clock' | 'bite' | 'list' | 'piers' | null>(null);
// В общих водах (остров и океан — одни на всех, хозяина нет): вместо «чей причал» — где ты; в гости отсюда не ходят — сначала
// доплыть до причала на лодке.
const waters = computed(() => game.whose.owner === SEA_ROOM);

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
function toggle(ev: Event, what: 'clock' | 'bite' | 'list' | 'piers') {
  blur(ev); open.value = open.value === what ? null : what;
  if (open.value === 'piers') { game.piers = null; emit('piers'); }   // список каждый раз свежий
}
function go(ev: Event, owner: string) { blur(ev); open.value = null; emit('visit', owner); }
// Перешёл в другую комнату (переплыл, ушёл в гости) — список причалов был про прежнюю: закрываем, откроют — спросим заново.
watch(() => game.roomId, () => { if (open.value === 'piers') open.value = null; });
// Клёв: какой он и почему, и как клюёт каждый вид по сравнению с обычным для него — в среднем за сутки и всякую погоду (FISH.forecast).
const LEVELS = ['слабый', 'обычный', 'хороший'];
const PARTS: Record<BiteInfo['part'], string> = { night: 'Ночь', morning: 'Утро', day: 'День', evening: 'Вечер' };
const bite = computed(() => game.bite);
const biteWhy = computed(() => {
  const b = bite.value; if (!b) return '';
  const tip = b.spot === 'sea' ? seaTip(b)
    : b.weather === 'rain' ? 'в дождь рыба клюёт чаще'
    : b.part === 'night' && !b.isle ? 'у причала клюёт вяло, а на острове берут сом и лещ'
    : b.part === 'night' ? 'сом и лещ вышли кормиться'
    : b.part === 'morning' ? 'на зорьке охотится щука'
    : b.weather === 'fog' ? 'в тумане, говорят, показывается золотая рыбка'
    : b.part === 'day' && b.weather === 'clear' ? 'в ясный день греется карась'
    : b.weather === 'cloudy' ? 'в пасмурь смелеет щука'
    : 'к ночи на острове проснётся сом';
  return `${PARTS[b.part]}, ${WEATHER_NAMES[b.weather].toLowerCase()}: ${tip}`;
});
// В океане: у косяка (якорь брошен рядом с ним) клюёт чаще и крупнее — это главное; иначе — кто сейчас выходит кормиться.
function seaTip(b: BiteInfo) {
  const fish = b.part === 'night' ? 'ночью к свету поднимается кальмар'
    : b.part === 'morning' ? 'на рассвете бывает тунец'
    : b.weather === 'rain' || b.weather === 'cloudy' ? 'в непогоду берёт треска'
    : b.weather === 'fog' ? 'в тумане со дна идёт камбала'
    : b.part === 'evening' ? 'к вечеру клюёт морской окунь'
    : 'в ясный день гуляет скумбрия';
  return b.shoal ? `ты у косяка — клюёт чаще и крупнее, а ${fish}` : `${fish}; ищи косяк — где кружат чайки, там клюёт лучше`;
}
const WHERE: Record<BiteInfo['spot'], string> = { pier: 'у причала', isle: 'на острове', sea: 'в океане' };
const moodOf = (r: number) => (r >= 1.6 ? { text: 'клюёт охотно', tone: 'up' } : r >= 1.2 ? { text: 'чаще обычного', tone: 'up' } : r >= 0.85 ? { text: 'как обычно', tone: '' } : r >= 0.45 ? { text: 'реже обычного', tone: 'down' } : { text: 'почти не клюёт', tone: 'down' });
const playersWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'игрок' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'игрока' : 'игроков');
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
      <button
        v-if="bite" type="button" class="chip bite" :class="'is-' + bite.level"
        :title="`Клёв ${LEVELS[bite.level]}. Нажми — кто сейчас клюёт охотнее`" :aria-expanded="open === 'bite'" @click="toggle($event, 'bite')"
      >
        Клёв<span class="dots" :aria-label="LEVELS[bite.level]"><i v-for="n in 3" :key="n" :class="{ on: n <= bite.level + 1 }" /></span>
      </button>
      <span v-if="waters" class="chip pier still" title="Общие воды: сюда приплывают на лодках со всех причалов">
        {{ game.where === 'sea' ? 'Открытый океан' : 'Общий остров' }}
      </span>
      <button
        v-else-if="game.whose.owner" type="button" class="chip pier" :class="{ guest: game.whose.guest }"
        title="Чей это причал. Нажми, чтобы сходить в гости" :aria-expanded="open === 'piers'" @click="toggle($event, 'piers')"
      >
        {{ game.whose.guest ? `В гостях: ${game.whose.name}` : 'Твой причал' }}
      </button>
      <button type="button" class="chip" :aria-expanded="open === 'list'" @click="toggle($event, 'list')">
        <span class="dot" :class="'is-' + game.status" />
        {{ waters ? 'В общих водах' : 'На причале' }}: {{ game.online.length }}
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

    <div v-if="open === 'bite' && bite" class="list bitebox">
      <b>Клёв {{ WHERE[bite.spot] }}<template v-if="bite.shoal">, у косяка</template> — {{ LEVELS[bite.level] }}</b>
      <p class="muted">{{ biteWhy }}</p>
      <ul>
        <li v-for="f in bite.fish" :key="f.id">
          <span>{{ f.name }}</span>
          <span class="mood" :class="moodOf(f.ratio).tone">{{ moodOf(f.ratio).text }}</span>
        </li>
      </ul>
      <p class="muted">Клёв меняется с часом и погодой.<template v-if="bite.spot === 'pier'"> С острова клюют ещё лещ и сом, а в открытом океане — морская рыба.</template><template v-else-if="bite.spot === 'sea'"> Здесь клюёт только морская рыба.</template></p>
    </div>

    <div v-if="open === 'piers' && !waters" class="list piers">
      <button v-if="game.whose.guest" type="button" class="home" @click="go($event, user?.id ?? '')">Домой, на свой причал</button>
      <span class="muted">Сейчас играют на причалах:</span>
      <p v-if="game.piers === null" class="muted">Смотрим…</p>
      <p v-else-if="!game.piers.length" class="muted">Больше никого нет. Сходить в гости можно и из профиля игрока.</p>
      <button v-for="p in game.piers" :key="p.owner" type="button" @click="go($event, p.owner)">
        <span>{{ p.owner === user?.id ? 'Твой причал' : p.name }}</span>
        <span class="muted">{{ p.players }} {{ playersWord(p.players) }}</span>
      </button>
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
.dot.is-reconnecting, .dot.is-connecting, .dot.is-sailing { background: var(--coat); }
.dot.is-offline, .dot.is-error, .dot.is-replaced { background: var(--bad); }
.list {
  margin: 0; padding: 8px 12px; list-style: none;
  max-height: 50vh; overflow: auto; min-width: 160px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood);
  user-select: text;
}
.list li { padding: 2px 0; }
.chip.pier.guest { border-color: var(--coat); }   /* ты в гостях */
.chip.pier.still { cursor: default; border-color: var(--coat); }
.chip.pier.still:hover { background: var(--wood); }
/* клёв: три точки — слабый, обычный, хороший */
.dots { display: flex; gap: 3px; }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: rgba(244, 227, 193, 0.25); }
.dots i.on { background: var(--paper); }
.chip.bite.is-2 .dots i.on { background: var(--good); }
.chip.bite.is-0 .dots i.on { background: var(--bad); }
.bitebox { display: grid; gap: 6px; width: 244px; user-select: none; }
.bitebox p { margin: 0; font-size: 12px; line-height: 1.35; }
.bitebox ul { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.bitebox li { display: flex; justify-content: space-between; gap: 8px; }
.mood { color: var(--paper-dim); font-size: 12px; }
.mood.up { color: var(--good); }
.mood.down { color: #d9a07a; }
.piers { display: grid; gap: 6px; width: 244px; user-select: none; }
.piers button {
  display: flex; justify-content: space-between; gap: 8px;
  padding: 6px 10px;
  border: 1px solid rgba(244, 227, 193, 0.3); border-radius: 8px;
  background: none; color: var(--paper);
  font: 600 13px/1.2 var(--text); text-align: left;
  cursor: pointer;
}
.piers button:hover { background: var(--wood-hover); }
.piers button.home { justify-content: center; border-color: var(--coat); color: var(--coat); }
.piers p { margin: 0; font-size: 12px; line-height: 1.35; }
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
  .online { top: 108px; }   /* под панелями ведра и сытости */
  .wx { display: none; }   /* на узком экране погоду видно и так — в чипе остаются только часы */
}
</style>
