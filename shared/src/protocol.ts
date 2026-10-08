// Протокол между браузером и игровым сервером: имя комнаты, сообщения в обе стороны, что видно о других игроках.

import type { Catch } from './fish.ts';
import type { FishingEvent } from './fishing.ts';
import type { Item, ItemKind } from './items.ts';
import type { PackKind } from './packs.ts';
import type { Dir, WorldState } from './rules.ts';
import type { Weather, WeatherKind } from './weather.ts';

export const ROOM = 'pier';             // комната-причал; когда в ней тесно, сервер открывает ещё одну такую же
export const ROOM_SIZE = 50;            // игроков в одной копии причала
export const MOVE_EVERY = 0.1;          // как часто клиент шлёт своё место, секунд

// Что лежит в ведре. recent — три последние рыбы: их хвосты торчат из ведра.
export interface Bag { counts: Record<string, number>; best: Record<string, number>; total: number; grams: number; recent: string[] }

export const emptyBag = (): Bag => ({ counts: {}, best: {}, total: 0, grams: 0, recent: [] });

// Кладёт рыбу в ведро; first — такой вид пойман впервые, record — крупнее всех прежних этого вида.
export function addToBag(bag: Bag, fish: Catch): { first: boolean; record: boolean } {
  const first = !bag.counts[fish.id], record = !first && fish.grams > (bag.best[fish.id] || 0);
  bag.counts[fish.id] = (bag.counts[fish.id] || 0) + 1;
  bag.best[fish.id] = Math.max(bag.best[fish.id] || 0, fish.grams);
  bag.total++; bag.grams += fish.grams;
  bag.recent.push(fish.id); if (bag.recent.length > 3) bag.recent.shift();
  return { first, record };
}

// Браузер → сервер.
export interface ClientMessages {
  move: { x: number; y: number; dir: Dir };   // где герой сейчас
  sit: { put?: { x: number; y: number } };    // сесть на край причала; put — куда поставить ведро, если оно в руке
  rest: void;                                 // сесть у костра — там, где стоишь; встают тем же stand или просто уходят
  stand: void;                                // встать
  pick: void;                                 // взять ведро
  put: { x: number; y: number };              // поставить ведро сюда
  press: void;                                // забросить, подсечь — как F или пробел
  packOn: void;                               // надеть рюкзак (он должен лежать рядом)
  packOff: { x: number; y: number };          // снять рюкзак и положить сюда
  packKind: { kind: PackKind };               // выбрать другой рюкзак (вещи должны в него влезть)
  itemMove: { id: number; x: number; y: number; rot: boolean };   // переложить вещь в рюкзаке; рюкзак на спине или рядом
  itemDrop: { id: number };                   // выбросить вещь из рюкзака
  lamp: { on: boolean };                      // зажечь или погасить лампу; она в рюкзаке, рюкзак на спине или рядом
  itemGive: { kind: ItemKind };               // положить в рюкзак новую вещь. Только в разработке
  clock: { hour: number | null };             // перевести часы причала на этот час — сразу у всех; null — настоящее время. Только в разработке
  weather: { kind: WeatherKind | null; wind: boolean | null };   // выставить погоду и ветер — сразу у всех; null — по расписанию. Только в разработке
}

// Сервер → браузер (только своему игроку; остальных игроков видно в состоянии комнаты).
export interface ServerMessages {
  self: WorldState;                           // где ты на самом деле: при входе и когда сервер не принял ход
  bag: Bag;                                   // ведро целиком: при входе
  fish: FishingEvent & { bag?: Bag };         // рыбалка; к подсечке приложено новое ведро
  // Вещи в рюкзаке целиком: при входе, когда сервер не принял перекладку и когда вещей стало больше или их разложило
  // по новому рюкзаку. note — почему не вышло: far — рюкзак далеко, full — новой вещи нет места, tight — вещи не влезут
  // в выбранный рюкзак (тогда сервер шлёт и «self» со старым рюкзаком).
  items: { list: Item[]; note?: 'far' | 'full' | 'tight' };
  // Часы причала, мс: по ним у всех одно время суток. Приходят при входе и когда часы перевели.
  // canSet — сервер разрешает их переводить (разработка), moved — сейчас они переведены.
  clock: { now: number; canSet: boolean; moved: boolean };
  // Погода на причале: приходит при входе и когда она меняется. fixKind и fixWind — что выставлено вручную
  // в разработке (null — идёт по расписанию).
  weather: Weather & { fixKind: WeatherKind | null; fixWind: boolean | null };
}

// Как другие игроки видны в состоянии комнаты.
export interface PlayerView {
  pid: string; name: string;
  x: number; y: number; dir: Dir; sitting: boolean;
  rest: boolean;                                            // сидит у костра
  carrying: boolean; bx: number; by: number; bucketHome: boolean;
  wearing: boolean; px: number; py: number; pack: string;   // рюкзак: на спине или лежит в px, py; pack — его вид
  lamp: boolean;                                            // в рюкзаке лежит зажжённая лампа: ночью вокруг него светло
  recent: ArrayLike<string>;
}

// Почему сервер закрыл соединение.
export const KICK = { replaced: 'replaced' } as const;
