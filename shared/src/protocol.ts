// Протокол между браузером и игровым сервером: имя комнаты, сообщения в обе стороны, что видно о других игроках.

import type { Catch } from './fish.ts';
import type { FishingEvent } from './fishing.ts';
import type { Item, ItemKind, Place } from './items.ts';
import type { PackKind } from './packs.ts';
import type { ChestKind } from './chests.ts';
import type { Dir, WorldState } from './rules.ts';
import type { ScrapEnd } from './scraps.ts';
import type { Weather, WeatherKind } from './weather.ts';

export const ROOM = 'pier';             // комната-причал; у каждого игрока свой причал, а когда на нём тесно, сервер открывает ещё одну его копию
export const ROOM_SIZE = 50;            // игроков в одной копии причала
export const MOVE_EVERY = 0.1;          // как часто клиент шлёт своё место, секунд
// С чем браузер входит в комнату: билет от сайта и чей это причал (pier — id хозяина; свой или того, к кому идёшь в гости).
// Матчмейкер подбирает комнату по pier: у каждого причала свои копии.
export interface JoinOptions { ticket: string; pier: string }
// Где лежит вещь на земле (items.place): у каждого причала своя земля, и вещь, оставленную на одном, на другом не видно.
export const pierPlace = (owner: string) => `pier:${owner}`;
// Земля острова этого причала (island.ts): у каждого причала свой остров, и вещи на нём лежат отдельно от причала.
export const islePlace = (owner: string) => `isle:${owner}`;
// Причал, где сейчас кто-то есть: чей (owner — id, name — имя хозяина) и сколько там игроков. Список — сообщение piers.
export interface PierInfo { owner: string; name: string; players: number }
// Чей причал — в состоянии комнаты: id и имя хозяина.
export interface PierView { owner: string; ownerName: string }

// Что лежит в ведре. recent — три последние рыбы: их хвосты торчат из ведра.
// Улов — у ведра, а не у игрока; в профиле Bag — весь улов игрока за всё время (recent — последние пойманные).
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
// Вынули рыбу вида species (вес и хвосты поправит ведро из базы).
export function takeFromBag(bag: Bag, species: string) {
  if (!bag.counts[species]) return;
  bag.counts[species]--; bag.total--;
  if (!bag.counts[species]) { delete bag.counts[species]; delete bag.best[species]; }
}
// Сколько каких рыб в ведре на земле — строкой для состояния комнаты (GroundView.haul): 'roach:2,perch:1'. И обратно.
export const haulText = (bag: Bag) => Object.entries(bag.counts).filter(([, n]) => n > 0).map(([id, n]) => `${id}:${n}`).join(',');
export function haulOf(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of text ? text.split(',') : []) { const [id, n] = part.split(':'); if (id && Number(n) > 0) out[id] = Number(n); }
  return out;
}

// Браузер → сервер.
export interface ClientMessages {
  move: { x: number; y: number; dir: Dir };   // где герой сейчас
  sit: void;                                  // сесть на край причала; ведро в руке остаётся в руке (рисуется рядом с рыбаком)
  rest: void;                                 // сесть у костра — там, где стоишь (в доме — в свободное кресло у камина рядом); встают тем же stand или просто уходят
  kindle: void;                               // разжечь погасший костёр: стоя или сидя у огня, когда нет дождя
  stand: void;                                // встать (из кресла и с кровати — рядом с ними)
  bed: void;                                  // лечь спать в кровать: в доме, стоя у неё, если она свободна (Indoor.nearBed)
  enter: void;                                // войти в дом: стоя у двери снаружи (nearDoor); в ответ — «self» уже в доме
  exit: void;                                 // выйти из дома: стоя у порога внутри (Indoor.nearExit); в ответ — «self» у крыльца
  sail: void;                                 // плыть на остров или обратно: стоя у лодки (nearBoat); в ответ — «self» уже на том берегу
  press: void;                                // забросить, подсечь — как F или пробел
  packOn: void;                               // надеть рюкзак (он должен лежать рядом)
  packOff: { x: number; y: number };          // снять рюкзак и положить сюда
  packKind: { kind: PackKind };               // выбрать другой рюкзак (вещи должны в него влезть)
  itemMove: { id: number; x: number; y: number; rot: boolean };   // переложить вещь в рюкзаке; рюкзак на спине или рядом
  itemDrop: { id: number };                   // выложить вещь на землю у ног — из руки (где угодно) или из рюкзака (он на спине или рядом)
  itemTake: { id: number; left?: boolean };   // взять вещь из рюкзака в руку: левую (left) или правую; не назвали — в свободную. Что было в этой руке, уходит в рюкзак
  itemStow: { id: number; at: Place | null }; // убрать вещь из рук в рюкзак: в эту клетку или (null) на свободное место
  itemPut: { x: number; y: number; left?: boolean };   // положить на землю сюда, рядом с собой, то, что в левой (left) или правой руке (Q и E)
  itemPick: { id: number; left?: boolean };   // поднять вещь с земли — любую, свою или чужую: в эту руку (не назвали — в свободную), а занята — в рюкзак, если он рядом. Она становится твоей
  lamp: { on: boolean; id?: number };         // зажечь или погасить лампу: ту, что в руке, или (id) ту, что стоит на земле рядом
  // достать рыбу этого вида из ведра pail (в руке или на земле рядом — чьего угодно; не назвали — из первого, где она есть) в руку left
  // (не назвали — в свободную)
  fishTake: { species: string; left?: boolean; pail?: number };
  eat: { left?: boolean };                    // съесть рыбу из руки left (не назвали — жареную первой, потом сырую)
  fridgePut: { left?: boolean };              // положить рыбу из руки left в холодильник (не назвали — из любой); стоя у него (Indoor.nearFridge)
  fridgeTake: { id: number; left?: boolean }; // достать рыбу id из холодильника в руку left (не назвали — в свободную)
  fridgeStock: void;                          // переложить улов из ведра в руке в холодильник — сколько влезет
  chestPut: { id: number; at: Place | null }; // положить вещь из рюкзака или из рук в свой сундук: в эту клетку или (null) на свободное место; стоя у сундука в доме (Indoor.nearChest)
  chestTake: { id: number; at: Place | null };// вынуть вещь из сундука в рюкзак: в эту клетку или (null) на свободное место
  chestMove: { id: number; x: number; y: number; rot: boolean };   // переложить вещь в сундуке
  chestKind: { kind: ChestKind };             // выбрать другой сундук (вещи должны в него влезть)
  piers: void;                                // на каких причалах сейчас есть игроки — в ответ «piers»
  dig: void;                                  // копать червей: лопата в одной руке, банка в другой, перед героем трава (WORMS)
  itemGive: { kind: ItemKind };               // положить в рюкзак новую вещь. Только в разработке
  scrap: { id: number; by: ScrapEnd };        // позвать к рыбе на земле чайку или кота (или дать ей растаять) прямо сейчас. Только в разработке
  clock: { hour: number | null };             // перевести часы причала на этот час — сразу у всех; null — настоящее время. Только в разработке
  weather: { kind: WeatherKind | null; wind: boolean | null };   // выставить погоду и ветер — сразу у всех; null — по расписанию. Только в разработке
}

// Сервер → браузер (только своему игроку; остальных игроков видно в состоянии комнаты).
export interface ServerMessages {
  self: WorldState;                           // где ты на самом деле: при входе и когда сервер не принял ход
  // Вёдра в руках (правая первой; left — в левой) и что в каждом: при входе, когда ведро взяли или убрали и когда в нём
  // что-то поменялось. Что в ведре на земле, видно всем в состоянии комнаты (GroundView.haul).
  bags: { id: number; left: boolean; bag: Bag }[];
  // Рыбалка. К подсечке приложено: в какое ведро легла рыба (pail) и сколько в нём теперь из скольких (n, size); first —
  // такой рыбы в этом ведре ещё не было, record — крупнее всех таких в нём; bags — вёдра в руках, если рыба легла в ведро в руке.
  fish: FishingEvent & { pail?: { id: number; n: number; size: number }; first?: boolean; record?: boolean; bags?: ServerMessages['bags'] };
  // Вещи целиком — что в рюкзаке (list) и что в руках (hands: до двух лёгких — у каждой left, в какой она руке, — или одна тяжёлая). Что лежит на земле,
  // видно всем в состоянии комнаты (ground):
  // при входе, когда сервер не принял перекладку и когда вещей стало больше или их разложило по новому рюкзаку.
  // note — почему не вышло: far — рюкзак далеко, full — вещи нет места, tight — вещи не влезут в выбранный рюкзак
  // (тогда сервер шлёт и «self» со старым рюкзаком), busy — руки заняты, а в рюкзак вещь с земли не убрать,
  // hands — тяжёлую вещь берут только двумя свободными руками, gone — вещь с земли успел поднять кто-то другой,
  // litter — на земле уже ITEMS.GROUND_MAX твоих вещей, raw — сырую рыбу в рюкзак не убрать, pail — ведра под рукой нет,
  // empty — такой рыбы в ведре нет, indoor — в доме на пол ничего не кладут и с земли не поднимают (земля — снаружи).
  items: { list: Item[]; hands: Item[]; note?: 'far' | 'full' | 'tight' | 'busy' | 'hands' | 'gone' | 'litter' | 'raw' | 'pail' | 'empty' | 'indoor' };
  // Голод (hunger.ts): food — сытость 0..100; sleep — сколько ещё мс герой спит от усталости (0 — не спит);
  // woke — только что проснулся (или выспался, пока его не было в игре): пока он спал, из рюкзака и рук могли украсть вещи.
  // Приходит при входе, когда сытость убывает на целую единицу, когда герой поел, уснул и проснулся.
  hunger: { food: number; sleep: number; woke?: boolean };
  // Что случилось с едой: рыба в руке пожарилась у костра (cooked) или её съели (ate: gain — сколько сытости прибавилось).
  food: { e: 'cooked' | 'ate'; fish: string; raw?: boolean; gain?: number };
  // Черви (WORMS): used — рыба клюнула, в банке id осталось n; dug — накопал got червей (wet — земля после дождя), в банке
  // теперь n, lost — уползло, не влезло. Отказы копать: none — тут уже вскопано, червей нет; full — банка полна; ground —
  // здесь не копают (не трава); jar — нет банки в другой руке; shovel — нет лопаты в руке; busy — сидит, ест или уже копает.
  worms: { e: 'used'; id: number; n: number } | { e: 'dug'; id: number; n: number; got: number; lost: number; wet: boolean }
    | { e: 'none' | 'full' | 'ground' | 'jar' | 'shovel' | 'busy' };
  // Холодильник в доме — полка игрока (FRIDGE): list — рыба на ней. Приходит при входе и после каждой перемены.
  // note — почему не вышло: far — до холодильника далеко, full — полка полна, busy — руки заняты, pail — ведра нет в руке,
  // empty — нечего класть (в руках нет рыбы, в ведре пусто) или такой рыбы уже нет на полке; stocked — сколько рыб переложено из ведра.
  fridge: { list: { id: number; kind: 'fish' | 'fish-fried'; fish: string }[]; note?: 'far' | 'full' | 'busy' | 'pail' | 'empty'; stocked?: number };
  // Свой сундук в доме (CHESTS): вид и вещи в его сетке. Приходит при входе и когда сервер не согласен с перекладкой.
  // note — почему не вышло: far — до сундука далеко (или рюкзак не под рукой), full — в сундуке или рюкзаке нет места,
  // tight — вещи не влезут в выбранный сундук, fish — рыбе место в холодильнике, а не в сундуке.
  chest: { kind: ChestKind; list: Item[]; note?: 'far' | 'full' | 'tight' | 'fish' | 'catch' };   // catch — ведро с уловом
  // Причалы, где сейчас есть игроки (кроме этого), — в ответ на «piers»: туда можно сходить в гости.
  piers: { list: PierInfo[] };
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
  rest: boolean;                                            // сидит у костра, а в доме — в кресле у камина
  bed: boolean;                                             // спит в кровати в доме
  inside: boolean;                                          // в доме: x, y — в кадре комнаты (indoor.ts); видят его только те, кто тоже внутри
  isle: boolean;                                            // на острове: x, y — в кадре острова (island.ts); видят его те, кто тоже там
  wearing: boolean; px: number; py: number; pack: string;   // рюкзак: на спине или лежит в px, py; pack — его вид
  hand: string; off: string;                                // что в правой и в левой руке: вид вещи (ITEM_KINDS, ведро тоже) или пусто.
                                                            // Тяжёлая вещь — только в hand (держат её двумя руками)
  lamp: boolean;                                            // лампа у него в руке зажжена и светит
  sleep: boolean;                                           // спит от голода
  eat: string; eatLeft: boolean;                            // что он сейчас ест ('fish', 'fish-fried'; пусто — не ест) и какой рукой
  dig: boolean;                                             // копает червей: лопата втыкается перед ним (WORMS.spot)
  recent: ArrayLike<string>;                                // хвосты последних рыб в ведре у него в руке (правой первой) — над ведром
}

// Вещь на земле, как её видят все в состоянии комнаты (ключ — её id строкой). Поля совпадают с GroundState
// в game-server/src/state.ts. Земля одна на все копии причала и не пустеет, когда игрок уходит. fish — у ведра хвосты рыб над ним, у рыбы — её вид.
// end — у рыбы: за ней пришла чайка или кот, или она тает (ScrapEnd в scraps.ts); пусто — лежит.
// haul — у ведра: сколько каких рыб в нём (haulText); достать оттуда рыбу может любой, кто рядом.
// isle — лежит на острове (x, y — в кадре острова), а не у причала.
export interface GroundView { kind: string; x: number; y: number; lit: boolean; fish: string; end: string; haul: string; isle: boolean }

// Ямка от лопаты, как её видят все в состоянии комнаты (ключ — её номер строкой): где она и когда вскопана (мс, часы сервера).
// Поля совпадают с HoleState в game-server/src/state.ts. Ямки общие для всех копий причала и зарастают через WORMS.REST.
export interface HoleView { x: number; y: number; at: number }

// Почему сервер закрыл соединение.
export const KICK = { replaced: 'replaced' } as const;
