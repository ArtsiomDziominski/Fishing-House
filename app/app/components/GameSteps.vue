<!-- Шаги новичка — своя панель под сытостью (колонка .hud-left на странице игры): пять галочек от рюкзака до дома.
     Видна тому, кто ещё не поймал ни одной рыбы, пока он не пройдёт их или не закроет (game.startSteps, stepDone).
     Что сделано, говорит движок (ui.step); под первым несделанным — как это сделать. -->
<script setup lang="ts">
import type { Scene, Step } from '~/game/engine';
import { STEPS } from '~/stores/game';

const game = useGameStore();
// keys — подсказка для клавиатуры, touch — для пальца (кнопки действий внизу)
const TEXT: Record<Step, { title: string; keys: string; touch: string }> = {
  pack: { title: 'Надень рюкзак', keys: 'Подойди к рюкзаку у причала и нажми B', touch: 'Подойди к рюкзаку у причала и нажми «Надеть рюкзак»' },
  gear: { title: 'Возьми удочку и червей', keys: 'Поставь ведро у края причала (Q), открой рюкзак (I) и дважды кликни по удочке и по банке', touch: 'Поставь ведро у края причала, открой рюкзак и возьми удочку и банку' },
  fish: { title: 'Поймай рыбу', keys: 'Сядь на краю причала (F). Над поплавком «!» — жми F ещё раз', touch: 'Сядь на краю причала и забрось. Над поплавком «!» — подсекай' },
  fried: { title: 'Пожарь рыбу у костра', keys: 'Достань рыбу из ведра (X) и сядь у костра (F). В дождь костёр гаснет — жарь у камина в доме', touch: 'Достань рыбу из ведра и сядь у костра. В дождь костёр гаснет — жарь у камина в доме' },
  house: { title: 'Загляни в дом', keys: 'Подойди к двери и нажми H', touch: 'Подойди к двери и войди' },
};
// На острове и в океане снасти и место рыбака не те, что у причала: там свои подсказки
const AWAY: Partial<Record<Scene, Partial<Record<Step, { keys: string; touch: string }>>>> = {
  isle: {
    gear: { keys: 'Поставь ведро у мостков (Q), открой рюкзак (I) и дважды кликни по удочке и по банке', touch: 'Поставь ведро у мостков, открой рюкзак и возьми удочку и банку' },
    fish: { keys: 'Сядь на краю мостков или на берегу у воды (F). Над поплавком «!» — жми F ещё раз', touch: 'Сядь на краю мостков или на берегу и забрось. Над поплавком «!» — подсекай' },
  },
  sea: {
    gear: { keys: 'Брось якорь (F): ведро само встанет в лодку, а удочка и черви из рюкзака на спине — в руки', touch: 'Брось якорь: ведро само встанет в лодку, а удочка и черви из рюкзака на спине — в руки' },
    fish: { keys: 'Брось якорь (F) и забрось (F). Над поплавком «!» — жми F ещё раз. Где кружат чайки, клюёт лучше', touch: 'Брось якорь и забрось. Над поплавком «!» — подсекай. Где кружат чайки, клюёт лучше' },
  },
};
const list = computed(() => STEPS.map(id => ({ id, ...TEXT[id], ...AWAY[game.where]?.[id], done: game.steps.done.includes(id) })));
const now = computed(() => list.value.find(s => !s.done)?.id ?? null);   // первый несделанный — с подсказкой

// после клика снимаем фокус с кнопки, иначе пробел и Enter будут нажимать её, а не подсекать
function close(ev: MouseEvent) { (ev.currentTarget as HTMLElement).blur(); game.closeSteps(); }
</script>

<template>
  <section v-if="game.steps.show" class="steps" aria-label="Первые шаги">
    <header>
      <span>{{ game.steps.all ? 'Всё получилось!' : 'Первые шаги' }}</span>
      <button type="button" title="Убрать подсказки" aria-label="Убрать подсказки" @click="close">×</button>
    </header>
    <p v-if="game.steps.all" class="hint">
      Дальше — сам. Черви кончатся — накопай лопатой на траве. Клёв зависит от часа и погоды, а ночью на острове берёт сом.
    </p>
    <ol v-else>
      <li v-for="s in list" :key="s.id" :class="{ done: s.done, now: s.id === now }">
        <i aria-hidden="true">{{ s.done ? '✓' : '' }}</i>
        <span>{{ s.title }}</span>
        <small v-if="s.id === now" class="hint"><span class="for-keys">{{ s.keys }}</span><span class="for-touch">{{ s.touch }}</span></small>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.steps {
  width: 0; min-width: 100%;   /* шириной с колонку — по панели рук и сытости, а не по длинной подсказке */
  padding: 7px 12px 9px;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--wood);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  font-size: 13px;
}
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 700; color: var(--coat); }
header button {
  padding: 0 4px; border: 0; background: none;
  color: var(--paper-dim); font: 700 16px/1 var(--text);
  cursor: pointer;
}
header button:hover { color: var(--paper); }
ol { display: grid; gap: 3px; margin: 6px 0 0; padding: 0; list-style: none; }
li { display: grid; grid-template-columns: 16px 1fr; align-items: start; column-gap: 7px; }
li i {
  display: grid; place-items: center;
  width: 14px; height: 14px; margin-top: 1px;
  border: 1px solid rgba(244, 227, 193, 0.45); border-radius: 50%;
  font: 700 10px/1 var(--text); font-style: normal;
}
li.done { color: var(--paper-dim); }
li.done span { text-decoration: line-through; text-decoration-color: rgba(244, 227, 193, 0.4); }
li.done i { border-color: var(--good); background: var(--good); color: var(--ink); }
li.now { font-weight: 600; }
li.now i { border-color: var(--coat); }
.hint { grid-column: 2; display: block; margin: 2px 0 2px; color: var(--paper-dim); font-size: 12px; font-weight: 400; line-height: 1.35; }
p.hint { margin: 6px 0 0; }
.hint .for-touch { display: none; }
@media (hover: none) and (pointer: coarse) {
  .hint .for-keys { display: none; }
  .hint .for-touch { display: inline; }
}
@media (max-width: 560px) {
  li:not(.now) { display: none; }   /* на узком экране — только то, что делать сейчас */
}
</style>
