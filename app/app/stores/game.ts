// Всё, что показывает интерфейс вокруг холста игры: ведро, рюкзак и вещи в нём, кнопки действий, сообщения, время суток, кто на причале, связь.
// Пишет сюда движок (через GameUI), читают компоненты.

import { defineStore } from 'pinia';
import { PACKS, emptyBag, type Bag, type Item, type PackKind } from '@fh/shared';
import type { Actions, GameUI, SkyInfo, Tone } from '~/game/engine';

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
    // время суток и погода: часы, темнота фона, погода словами; можно ли их выставлять (разработка) и что выставлено
    sky: { label: '', dark: 0, minutes: 0, canSet: false, moved: false, weather: '', fixKind: null, fixWind: null } as SkyInfo,
    actions: { left: null, right: null, pack: null, fish: null, hot: false, stand: false, open: false, light: null } as Actions,
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
    setSound(on: boolean) { this.sound = on; try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* в частном окне хранилища может не быть — выбор проживёт до перезагрузки */ } },
    // Мост от движка к хранилищу.
    ui(): GameUI {
      return {
        bag: bag => { this.bag = bag; },
        pack: kind => { this.pack = kind; },
        sky: info => { this.sky = info; },
        toast: (text, tone, fishId) => this.showToast(text, tone, fishId),
        actions: a => { this.actions = a; },
        moved: () => { this.quietHint = true; },
        debug: text => { this.debug = text; },
        online: list => { this.online = list; },
      };
    },
  },
});
