// Сундуки в доме: у каждого игрока свой, в нём хранят вещи, и их никто не унесёт — в чужой дом не войти, а во сне от голода
// крадут только из рюкзака и рук. Вид сундука выбирает игрок (CHEST_KINDS — от меньшего к большему); вместимость — сетка
// клеток, как у рюкзака (ITEMS.fits). Рыбе в сундуке не место — для неё холодильник.
// Цвета — пять тонов дерева от света к тени и цвет оковки: ими окно рюкзака рисует рамку сундука.

import type { Grid } from './items.ts';

export const CHEST_KINDS = ['box', 'chest', 'trunk'] as const;
export type ChestKind = typeof CHEST_KINDS[number];

export const CHESTS = (() => {
  const BY_ID: Record<ChestKind, { name: string; w: number; h: number; tones: string[]; band: string }> = {
    box: { name: 'Сундучок', w: 5, h: 4, tones: ['c8935a', 'a8743f', '87582c', '66401d', '432812'], band: '8b8f98' },
    chest: { name: 'Сундук', w: 7, h: 5, tones: ['a8693a', '8a5228', '6c3e1c', '4f2b12', '33190a'], band: 'b4b8bf' },
    trunk: { name: 'Большой сундук', w: 9, h: 6, tones: ['b8503a', '983c2a', '782c1e', '581f15', '3a120c'], band: 'd9c36a' },
  };
  const rgb = (h: string) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const isKind = (v: unknown): v is ChestKind => CHEST_KINDS.includes(v as ChestKind);
  return {
    DEFAULT: CHEST_KINDS[0] as ChestKind,
    name: (kind: ChestKind) => BY_ID[kind].name,
    grid: (kind: ChestKind): Grid => ({ w: BY_ID[kind].w, h: BY_ID[kind].h }),
    tones: (kind: ChestKind): number[][] => BY_ID[kind].tones.map(rgb),
    band: (kind: ChestKind): number[] => rgb(BY_ID[kind].band),
    isKind,
  };
})();
