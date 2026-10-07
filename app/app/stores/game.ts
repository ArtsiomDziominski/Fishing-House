// Всё, что показывает интерфейс вокруг холста игры: ведро, рюкзак, кнопки действий, сообщения, время суток, кто на причале, связь.
// Пишет сюда движок (через GameUI), читают компоненты.

import { defineStore } from 'pinia';
import { PACKS, emptyBag, type Bag, type PackKind } from '@fh/shared';
import type { Actions, GameUI, SkyInfo, Tone } from '~/game/engine';

export type Status = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'replaced' | 'offline' | 'error';

export const useGameStore = defineStore('game', {
  state: () => ({
    status: 'idle' as Status,
    error: '',
    roomId: '',
    bag: emptyBag() as Bag,
    pack: PACKS.DEFAULT as PackKind,
    sky: { label: '', dark: 0, minutes: 0, canSet: false, moved: false } as SkyInfo,   // время суток: часы, темнота фона, можно ли переводить часы
    actions: { bucket: null, pack: null, fish: null, hot: false, stand: false } as Actions,
    toast: { text: '', tone: '' as Tone, fishId: null as string | null, show: false, seq: 0 },
    quietHint: false,
    debug: null as string | null,
    canZoomIn: true,
    canZoomOut: true,
    online: [] as { pid: string; name: string }[],
  }),
  actions: {
    reset() { this.$reset(); },
    showToast(text: string, tone: Tone = '', fishId: string | null = null) {
      const seq = this.toast.seq + 1;
      this.toast = { text, tone, fishId, show: true, seq };
      setTimeout(() => { if (this.toast.seq === seq) this.toast.show = false; }, 2600);
    },
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
        zoom: (canIn, canOut) => { this.canZoomIn = canIn; this.canZoomOut = canOut; },
        online: list => { this.online = list; },
      };
    },
  },
});
