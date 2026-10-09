// Всё, что показывает интерфейс вокруг холста игры: ведро, рюкзак и вещи в нём, холодильник в доме, сытость и сон, кнопки действий, сообщения, время суток, кто на причале, связь.
// Пишет сюда движок (через GameUI), читают компоненты.

import { defineStore } from 'pinia';
import { HUNGER, PACKS, emptyBag, type Bag, type Item, type PackKind, type ServerMessages } from '@fh/shared';
import type { Actions, GameUI, HungerInfo, SkyInfo, Tone } from '~/game/engine';

const SOUND_KEY = 'fh-sound';
const recall = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };   // на сервере и в частном окне хранилища нет
export type Status = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'replaced' | 'offline' | 'error';

export const useGameStore = defineStore('game', {
  state: () => ({
    status: 'idle' as Status,
    error: '',
    roomId: '',
    bag: emptyBag() as Bag,
    pack: PACKS.DEFAULT as PackKind,
    items: [] as Item[],          // вещи в рюкзаке, как их видит сервер (перекладку окно рюкзака показывает сразу, не дожидаясь его)
    hands: [] as Item[],          // вещи в руках у героя: две лёгкие или одна тяжёлая
    packOpen: false,              // открыто окно рюкзака
    fridge: [] as ServerMessages['fridge']['list'],   // рыба на своей полке в холодильнике, как её видит сервер
    fridgeOpen: false,            // открыт холодильник (только пока герой стоит у него)
    // время суток и погода: часы, темнота фона, погода словами; можно ли их выставлять (разработка) и что выставлено
    sky: { label: '', dark: 0, minutes: 0, canSet: false, moved: false, weather: '', fixKind: null, fixWind: null } as SkyInfo,
    actions: { left: null, right: null, pack: null, fish: null, hot: false, stand: false, open: false, light: null, eat: null, dig: null, door: null, fridge: false } as Actions,
    hunger: { food: HUNGER.MAX, until: 0, lost: null } as HungerInfo,   // сытость и сон от голода
    toast: { text: '', tone: '' as Tone, fishId: null as string | null, show: false, seq: 0 },
    quietHint: false,
    debug: null as string | null,
    online: [] as { pid: string; name: string }[],
    sound: recall(SOUND_KEY) !== '0',   // звук включён; помним выбор игрока в этом браузере
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
      if (want) this.packOpen = false;
    },
    setSound(on: boolean) { this.sound = on; try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* в частном окне хранилища может не быть — выбор проживёт до перезагрузки */ } },
    // Мост от движка к хранилищу.
    ui(): GameUI {
      return {
        bag: bag => { this.bag = bag; },
        pack: kind => { this.pack = kind; },
        sky: info => { this.sky = info; },
        toast: (text, tone, fishId) => this.showToast(text, tone, fishId),
        actions: a => { this.actions = a; if (!a.fridge) this.fridgeOpen = false; },
        fridge: open => this.toggleFridge(open),
        moved: () => { this.quietHint = true; },
        debug: text => { this.debug = text; },
        online: list => { this.online = list; },
        hunger: info => { this.hunger = info; },
        // сколько червей в банке: в рюкзаке она или в руке, у неё новый счёт
        worms: (id, n) => {
          const set = (list: Item[]) => (list.some(it => it.id === id) ? list.map(it => (it.id === id ? { ...it, worms: n } : it)) : list);
          this.items = set(this.items); this.hands = set(this.hands);
        },
      };
    },
  },
});
