// Всё, что показывает интерфейс вокруг холста игры: вёдра и улов в них, рюкзак и вещи в нём, холодильник и сундук в доме, сытость и сон, кнопки действий, сообщения, время суток и клёв, шаги новичка, чей причал и кто на нём, куда сходить в гости, связь.
// Пишет сюда движок (через GameUI), читают компоненты.

import { defineStore } from 'pinia';
import { CHESTS, HUNGER, PACKS, type Area, type Item, type PackKind, type PierInfo, type ServerMessages, type Voyage } from '@fh/shared';
import type { Actions, BiteInfo, GameUI, HungerInfo, NearPail, PierOwner, Scene, SkyInfo, Step, Tone } from '~/game/engine';

const SOUND_KEY = 'fh-sound';
const recall = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };   // на сервере и в частном окне хранилища нет
const keep = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* в частном окне хранилища может не быть — проживёт до перезагрузки */ } };
// Шаги новичка — в этом браузере, у каждого игрока свои: 'off' — не показывать (прошёл, закрыл или он не новичок), иначе — что уже сделано.
export const STEPS: Step[] = ['pack', 'gear', 'fish', 'fried', 'house'];
const STEPS_KEY = (pid: string) => 'fh-steps-' + pid;
export type Status = 'idle' | 'connecting' | 'sailing' | 'online' | 'reconnecting' | 'replaced' | 'offline' | 'error';   // sailing — входим в другую комнату на лодке: на холсте — экран переправы

export const useGameStore = defineStore('game', {
  state: () => ({
    status: 'idle' as Status,
    error: '',
    roomId: '',
    bags: [] as ServerMessages['bags'],   // вёдра в руках героя и что в них
    near: null as NearPail | null,        // ведро на земле под рукой и что в нём
    pack: PACKS.DEFAULT as PackKind,
    items: [] as Item[],          // вещи в рюкзаке, как их видит сервер (перекладку окно рюкзака показывает сразу, не дожидаясь его)
    hands: [] as Item[],          // вещи в руках у героя: две лёгкие или одна тяжёлая
    packOpen: false,              // открыто окно рюкзака
    fridge: [] as ServerMessages['fridge']['list'],   // рыба на своей полке в холодильнике, как её видит сервер
    fridgeOpen: false,            // открыт холодильник (только пока герой стоит у него)
    chest: { kind: CHESTS.DEFAULT, list: [] } as Omit<ServerMessages['chest'], 'note'>,   // свой сундук в доме, как его видит сервер (перекладку окно показывает сразу)
    chestOpen: false,             // открыт сундук (только пока герой стоит у него) — он в окне рюкзака, рядом с рюкзаком
    whose: { owner: '', name: '', guest: false } as PierOwner,   // чей это причал; guest — ты в гостях
    piers: null as PierInfo[] | null,   // где сейчас есть игроки — куда сходить в гости (null — ещё не спрашивали)
    // время суток и погода: часы, темнота фона, погода словами; можно ли их выставлять (разработка) и что выставлено
    sky: { label: '', dark: 0, minutes: 0, canSet: false, moved: false, weather: '', fixKind: null, fixWind: null } as SkyInfo,
    bite: null as BiteInfo | null,   // какой сейчас клёв там, где герой
    // шаги новичка: для кого (pid), показывать ли, что уже сделано; seen — что герой сделал за этот вход, ещё до того, как
    // стало ясно, новичок ли он; all — всё сделано, панель скоро уйдёт
    steps: { pid: '', show: false, done: [] as Step[], seen: [] as Step[], all: false },
    actions: { left: null, right: null, pack: null, fish: null, hot: false, stand: null, open: false, light: null, eat: null, dig: null, door: null, fridge: false, chest: false } as Actions,
    hunger: { food: HUNGER.MAX, until: 0 } as HungerInfo,   // сытость и сон от голода
    robbed: false,                // очнулся после голодного сна — пока спал, могли что-то украсть (GameSleep говорит об этом)
    toast: { text: '', tone: '' as Tone, fishId: null as string | null, show: false, seq: 0 },
    quietHint: false,
    debug: null as string | null,
    online: [] as { pid: string; name: string }[],
    sound: recall(SOUND_KEY) !== '0',   // звук включён; помним выбор игрока в этом браузере
    seen: ['pier'] as Area[],     // где герой уже бывал: на карте мира остальное скрыто темнотой
    where: 'pier' as Scene,       // какой кадр сейчас: причал (свой или чужой — whose), дом, общий остров или открытый океан
    mapOpen: false,               // открыта карта мира (M или кнопка)
    voyage: null as ServerMessages['voyage'] | null,   // сервер отпустил плыть в другую комнату — страница игры переходит туда
    sailing: null as Voyage[] | null,                   // сел в лодку: куда можно плыть отсюда (окно выбора, GameVoyage.vue)
  }),
  actions: {
    reset() { this.$reset(); },
    showToast(text: string, tone: Tone = '', fishId: string | null = null) {
      const seq = this.toast.seq + 1;
      this.toast = { text, tone, fishId, show: true, seq };
      setTimeout(() => { if (this.toast.seq === seq) this.toast.show = false; }, 2600);
    },
    // Открыть или закрыть рюкзак (I или кнопка). Заглянуть в него можно, когда он на спине или рядом.
    togglePack(open?: boolean) {
      const want = open ?? !this.packOpen;
      if (want && !this.actions.open) { this.showToast('Рюкзак далеко — подойди к нему', 'bad'); return; }
      this.packOpen = want;
    },
    // Открыть или закрыть холодильник (F у него, клик по нему или кнопка). Отошёл от него — он закрывается сам.
    toggleFridge(open?: boolean) {
      const want = open ?? !this.fridgeOpen;
      if (want && !this.actions.fridge) { this.showToast('Холодильник далеко — подойди к нему', 'bad'); return; }
      this.fridgeOpen = want;
      if (want) { this.packOpen = false; this.chestOpen = false; }
    },
    // Открыть или закрыть сундук (F у него, клик по нему). Он открывается в окне рюкзака; отошёл — закрывается сам.
    toggleChest(open?: boolean) {
      const want = open ?? !this.chestOpen;
      if (want && !this.actions.chest) { this.showToast('Сундук далеко — подойди к нему', 'bad'); return; }
      this.chestOpen = want;
      if (want) this.fridgeOpen = false; else this.packOpen = false;
    },
    setSound(on: boolean) { this.sound = on; keep(SOUND_KEY, on ? '1' : '0'); },
    // Открыть или закрыть карту мира (M или кнопка): что открыто, где герой бывал (seen), а где он сейчас — where.
    // Карта открывается поверх всего: рюкзак, холодильник, сундук и выбор, куда плыть, — закрываются.
    toggleMap(open?: boolean) {
      this.mapOpen = open ?? !this.mapOpen;
      if (this.mapOpen) { this.packOpen = false; this.fridgeOpen = false; this.chestOpen = false; }
    },
    // Шаги новичка: показываем тому, кто ещё не поймал ни одной рыбы (по профилю) и не прошёл и не закрыл их в этом браузере.
    async startSteps(pid: string) {
      if (!pid || this.steps.pid === pid) return;
      this.steps.pid = pid;
      let saved = recall(STEPS_KEY(pid));
      if (saved === null) {
        const profile = await $fetch<{ latest: unknown[] }>(`/api/players/${pid}`).catch(() => null);
        if (!profile || this.steps.pid !== pid) return;
        saved = profile.latest.length ? 'off' : '[]';
        keep(STEPS_KEY(pid), saved);
      }
      if (saved === 'off') return;
      let done: Step[] = [];
      try { done = (JSON.parse(saved) as string[]).filter((s): s is Step => STEPS.includes(s as Step)); } catch { /* испорчено — начнём сначала */ }
      this.steps.done = done; this.steps.show = true;
      for (const s of this.steps.seen) this.stepDone(s);
    },
    stepDone(step: Step) {
      const st = this.steps;
      if (!st.seen.includes(step)) st.seen.push(step);
      if (!st.show || st.done.includes(step)) return;
      st.done.push(step);
      keep(STEPS_KEY(st.pid), JSON.stringify(st.done));
      if (STEPS.every(s => st.done.includes(s))) {   // всё сделано — похвалим и через несколько секунд уберём насовсем
        st.all = true; keep(STEPS_KEY(st.pid), 'off');
        setTimeout(() => { if (st.all) st.show = false; }, 8000);
      }
    },
    closeSteps() { this.steps.show = false; if (this.steps.pid) keep(STEPS_KEY(this.steps.pid), 'off'); },
    // Мост от движка к хранилищу.
    ui(): GameUI {
      return {
        bags: list => { this.bags = list; },
        near: pail => { this.near = pail; },
        robbed: () => { this.robbed = true; },
        pack: kind => { this.pack = kind; },
        sky: info => { this.sky = info; },
        toast: (text, tone, fishId) => this.showToast(text, tone, fishId),
        actions: a => { this.actions = a; if (!a.fridge) this.fridgeOpen = false; if (!a.chest && this.chestOpen) this.toggleChest(false); },
        fridge: open => this.toggleFridge(open),
        chest: open => this.toggleChest(open),
        pier: info => { this.whose = info; },
        moved: () => { this.quietHint = true; },
        debug: text => { this.debug = text; },
        online: list => { this.online = list; },
        hunger: info => { this.hunger = info; },
        bite: info => { this.bite = info; },
        step: done => this.stepDone(done),
        seen: list => { this.seen = list; },
        where: scene => { this.where = scene; },
        voyage: m => { this.voyage = m; },
        sail: choices => { this.sailing = choices; },
        busy: () => this.mapOpen,
        // сколько червей в банке: в рюкзаке она или в руке, у неё новый счёт
        worms: (id, n) => {
          const set = (list: Item[]) => (list.some(it => it.id === id) ? list.map(it => (it.id === id ? { ...it, worms: n } : it)) : list);
          this.items = set(this.items); this.hands = set(this.hands);
        },
      };
    },
  },
});
