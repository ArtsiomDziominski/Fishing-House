// Состояние комнаты-причала, которое Colyseus сам рассылает всем в комнате (только изменения, в двоичном виде).
// Здесь только то, что видно о других игроках, и вещи на земле. Улов и рыбалку игрок получает сообщениями — их видит только он.
// Поля совпадают с PlayerView из @fh/shared — клиент читает их оттуда.

import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerState = schema({
  pid: t.string(),            // публичный id: по нему открывается профиль
  name: t.string(),
  x: t.float32(),
  y: t.float32(),
  dir: t.string(),
  sitting: t.boolean(),       // сидит на краю причала с удочкой
  rest: t.boolean(),          // сидит у костра, а в доме — у камина
  bed: t.boolean(),           // спит в кровати в доме
  inside: t.boolean(),        // в доме: x, y — в кадре комнаты (Indoor)
  isle: t.boolean(),          // на общем острове: x, y — в кадре острова (Isle)
  sea: t.boolean(),           // в своей лодке в открытом океане: x, y — середина лодки в кадре океана (Sea)
  boat: t.string(),           // вид ведра в его лодке (в океане — у ног; на берегу — осталось там, руки были заняты); пусто — ведра в лодке нет
  wearing: t.boolean(),       // рюкзак на спине
  px: t.int16(),              // где лежит рюкзак, если не на спине
  py: t.int16(),
  pack: t.string(),           // вид рюкзака (PACK_KINDS)
  hand: t.string(),           // что в правой руке: вид вещи (ITEM_KINDS) или пусто; тяжёлая вещь (в обеих) — только здесь
  off: t.string(),            // что в левой руке
  lamp: t.boolean(),          // лампа у него в руке зажжена и светит
  sleep: t.boolean(),         // спит от голода
  eat: t.string(),            // что он сейчас ест: вид рыбы-вещи ('fish', 'fish-fried'); пусто — не ест
  eatLeft: t.boolean(),       // ест левой рукой
  dig: t.boolean(),           // копает червей: лопата втыкается перед ним (WORMS.spot)
  recent: t.array('string'),  // хвосты последних рыб в ведре у него в руке (нет его — в ведре в лодке) — над ведром
}, 'PlayerState');
export type PlayerState = SchemaType<typeof PlayerState>;

// Вещь на земле. Поля совпадают с GroundView из @fh/shared. Кто её выложил, не рассылается: поднять её может любой.
export const GroundState = schema({
  kind: t.string(),           // вид вещи (ITEM_KINDS)
  x: t.int16(),               // где лежит на карте
  y: t.int16(),
  lit: t.boolean(),           // горит (лампа)
  fish: t.string(),           // ведро — хвосты рыб над ним (id через запятую), рыба — её вид
  end: t.string(),            // рыба: за ней пришла чайка или кот ('gull', 'cat') или она тает ('fade'); пусто — лежит
  haul: t.string(),           // ведро: сколько каких рыб в нём ('roach:2,perch:1', haulText) — достать может любой
  isle: t.boolean(),          // лежит на общем острове (x, y — в кадре острова), а не у причала
}, 'GroundState');
export type GroundState = SchemaType<typeof GroundState>;

// Ямка от лопаты. Поля совпадают с HoleView из @fh/shared. Зарастает через WORMS.REST.
export const HoleState = schema({
  x: t.int16(),               // где она на карте
  y: t.int16(),
  at: t.float64(),            // когда вскопана: мс, часы сервера
}, 'HoleState');
export type HoleState = SchemaType<typeof HoleState>;

export const PierState = schema({
  owner: t.string(),             // чей это причал: id хозяина (остальные здесь в гостях); у общих вод — SEA_ROOM, хозяина нет
  ownerName: t.string(),         // и его имя
  players: t.map(PlayerState),   // ключ — sessionId соединения
  ground: t.map(GroundState),    // ключ — id вещи строкой; земля одна на все копии причала (у каждого причала своя, items.place); у общих вод — земля острова
  fire: t.boolean(),             // костёр горит (гаснет под дождём, разжигает игрок); один на все копии этого причала
  isleFire: t.boolean(),         // костёр на общем острове — так же, один на все копии общих вод
  holes: t.map(HoleState),       // ямки от лопат (ключ — номер ямки); одни на все копии этого причала
}, 'PierState');
export type PierState = SchemaType<typeof PierState>;
