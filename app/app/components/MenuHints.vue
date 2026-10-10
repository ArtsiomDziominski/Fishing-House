<!-- Подсказки в главном меню: как рыбачить, когда кто клюёт и что делать в мире. Открываются кнопкой «Подсказки» в той же панели,
     что и настройки. Клёв здесь не «сейчас», а вообще: какая часть суток и погода каждому виду по душе — из тех же чисел, по которым
     решает сервер (when и wx у вида в FISH), так что подсказка не разойдётся с игрой. -->
<script setup lang="ts">
import { FISH, WEATHER_NAMES, type FishSpot, type Species, type WeatherKind } from '@fh/shared';

const emit = defineEmits<{ back: [] }>();
type Tab = 'fishing' | 'bite' | 'world';
const TABS: { id: Tab; name: string }[] = [{ id: 'fishing', name: 'Рыбалка' }, { id: 'bite', name: 'Клёв' }, { id: 'world', name: 'В мире' }];
const tab = ref<Tab>('fishing');

// Когда вид клюёт охотнее всего: лучшая часть суток и погода, если она заметно лучше прочих (иначе погода ему всё равно).
const WHEN: Record<keyof Species['when'], string> = { night: 'ночью', morning: 'на рассвете', day: 'днём', evening: 'вечером' };
const WX: Record<WeatherKind, string> = { clear: 'в ясную погоду', cloudy: 'в пасмурь', rain: 'в дождь', fog: 'в туман' };
function best(sp: Species) {
  const part = (Object.keys(sp.when) as (keyof Species['when'])[]).reduce((a, b) => (sp.when[b] > sp.when[a] ? b : a));
  const wx = (Object.keys(sp.wx) as WeatherKind[]).reduce((a, b) => (sp.wx[b] > sp.wx[a] ? b : a));
  return sp.wx[wx] >= 1.15 ? `${WHEN[part]}, ${WX[wx]}` : WHEN[part];
}
const PLACES: { at: FishSpot; name: string; note: string }[] = [
  { at: 'pier', name: 'У причала', note: 'Ночью у причала клюёт вяло — лучше плыть на остров.' },
  { at: 'isle', name: 'На острове', note: 'Здесь же берут лещ и сом, которых у причала нет. Рыбачат с мостков и с берега.' },
  { at: 'sea', name: 'В открытом океане', note: 'Только морская рыба. У косяка — где кружат чайки — клюёт чаще и крупнее.' },
];
const places = PLACES.map(p => ({ ...p, fish: FISH.here(p.at).map(sp => ({ id: sp.id, name: sp.name, when: best(sp) })) }));
const weathers = Object.values(WEATHER_NAMES).join(', ').toLowerCase();

// после клика снимаем фокус, чтобы Enter не жал вкладку снова
function pick(ev: Event, id: Tab) { (ev.currentTarget as HTMLElement).blur(); tab.value = id; }
</script>

<template>
  <section class="hints" aria-label="Подсказки">
    <h2>Подсказки</h2>
    <div class="tabs" role="tablist">
      <button
        v-for="t in TABS" :key="t.id" type="button" role="tab" class="tab" :class="{ on: tab === t.id }" :aria-selected="tab === t.id"
        @click="pick($event, t.id)"
      >
        {{ t.name }}
      </button>
    </div>

    <div class="page" role="tabpanel">
      <template v-if="tab === 'fishing'">
        <h3>Как рыбачить</h3>
        <ol>
          <li>Надень рюкзак: он лежит у причала, подойди и нажми <kbd>B</kbd>.</li>
          <li>Поставь ведро у края причала — <kbd>Q</kbd> или <kbd>E</kbd> кладут то, что в левой или правой руке. Без ведра не рыбачат, в полное не забросить.</li>
          <li>Открой рюкзак (<kbd>I</kbd>) и дважды кликни по удочке и по банке червей: удочка в одной руке, черви в другой.</li>
          <li>Сядь на край причала и забрось: <kbd>F</kbd> или пробел.</li>
          <li>Поплавок ушёл под воду, над головой <b>!</b> — сразу подсекай тем же <kbd>F</kbd>. Опоздал — рыба сорвётся.</li>
          <li>Рыба летит в ведро. Каждая поклёвка съедает одного червя.</li>
        </ol>
        <h3>Черви</h3>
        <p>Банка опустела — возьми лопату из рюкзака и копай на траве (<kbd>G</kbd>). На острове и в океане не копают — запасись дома.</p>
        <h3>Улов и еда</h3>
        <p>Сытость тает за день. <kbd>X</kbd> — съесть рыбу из рук или достать из ведра. Жареная сытнее: сядь с рыбой у костра (<kbd>F</kbd>), а в дождь, когда костёр гаснет, — у камина в доме.</p>
        <p>Рыба, брошенная на землю, долго не пролежит: её унесёт чайка или съест кот. Храни улов в ведре или в холодильнике дома.</p>
        <h3>Клавиши</h3>
        <ul class="keys">
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> или клик — идти</li>
          <li><kbd>Q</kbd> <kbd>E</kbd> — левая и правая рука: положить или поднять</li>
          <li><kbd>I</kbd> — рюкзак, <kbd>B</kbd> — надеть или снять</li>
          <li><kbd>F</kbd> — сесть, забросить, подсечь</li>
          <li><kbd>X</kbd> — поесть, <kbd>G</kbd> — копать червей</li>
          <li><kbd>L</kbd> — лампа, <kbd>H</kbd> — дверь и лодка</li>
          <li><kbd>M</kbd> — карта мира, <kbd>Esc</kbd> — встать или закрыть</li>
        </ul>
      </template>

      <template v-else-if="tab === 'bite'">
        <p>Клёв зависит от часа и погоды: игровой час идёт минуту, погода ({{ weathers }}) одна на весь мир. В дождь клюёт чаще всего, а каждый вид любит своё время.</p>
        <section v-for="p in places" :key="p.at" class="place">
          <h3>{{ p.name }}</h3>
          <ul class="fish">
            <li v-for="f in p.fish" :key="f.id"><span>{{ f.name }}</span><span class="muted">{{ f.when }}</span></li>
          </ul>
          <p class="muted">{{ p.note }}</p>
        </section>
        <p class="muted">Не зевай с подсечкой: щука, сом, тунец и золотая рыбка ждут недолго.</p>
      </template>

      <template v-else>
        <h3>Свой причал и дом</h3>
        <p>У каждого свой причал с домом. Дверь — <kbd>H</kbd>. В доме кресла у камина (жарить рыбу), кровать, холодильник для улова и сундук для вещей — туда никто не залезет.</p>
        <h3>Гости</h3>
        <p>Нажми «Твой причал» справа вверху — увидишь, где сейчас играют, и сходишь в гости. Ещё — кнопка «Сходить в гости» в профиле игрока. В гостях можно рыбачить, а из вёдер на земле рыбу достаёт любой — не оставляй своё без присмотра.</p>
        <h3>Лодка: остров и океан</h3>
        <p>Лодка стоит справа у мостков: подойди и нажми <kbd>H</kbd>. Плыви на <b>общий остров</b> — там лещ, сом, костёр и рыбалка прямо с берега — или в <b>открытый океан</b>. Остров и океан одни на всех: там встретишь игроков со всех причалов.</p>
        <h3>В океане</h3>
        <p>Гребёшь стрелками или кликом по воде, <kbd>F</kbd> — бросить якорь и рыбачить с кормы, <kbd>Esc</kbd> — поднять. Ведро стоит в лодке: руки заняты удочкой и червями. Ищи чаек — под ними косяк.</p>
        <h3>Карта мира</h3>
        <p><kbd>M</kbd> или кнопка «Карта». Где ещё не бывал, лежит туман — сплавай, и он рассеется.</p>
        <h3>Голод и сон</h3>
        <p>Если сытость кончится, герой ослабнет, а потом уснёт прямо на месте. Пока спит, из рюкзака и рук могут утащить вещи. Проснёшься у своего дома — что лежит на земле, в холодильнике и в сундуке, останется цело.</p>
      </template>
    </div>

    <button type="button" class="btn ghost" @click="emit('back')">Назад</button>
  </section>
</template>

<style scoped>
.hints { display: grid; gap: 10px; text-align: left; }
h2 { margin: 0 0 4px; font-size: 22px; color: var(--coat); text-align: center; }
h3 { margin: 12px 0 4px; font-size: 15px; color: var(--coat); }
h3:first-child { margin-top: 0; }
.tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.tab {
  padding: 7px 4px;
  border: 1px solid var(--line); border-radius: 8px;
  background: none; color: var(--paper);
  font: 600 14px/1.2 var(--text);
  cursor: pointer;
}
.tab:hover { background: var(--wood-hover); }
.tab.on { border-color: var(--coat); color: var(--coat); }
.page { max-height: min(52vh, 440px); overflow: auto; padding-right: 4px; font-size: 13px; line-height: 1.45; }
.page p { margin: 0 0 6px; }
.page ol, .page ul { margin: 0 0 6px; padding-left: 18px; display: grid; gap: 4px; }
.keys { padding-left: 0 !important; list-style: none; }
.place { margin-top: 10px; }
.fish { padding-left: 0 !important; list-style: none; gap: 2px !important; }
.fish li { display: flex; justify-content: space-between; gap: 10px; }
.fish li .muted { text-align: right; }
</style>
