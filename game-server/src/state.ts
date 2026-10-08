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
  rest: t.boolean(),          // сидит у костра
  wearing: t.boolean(),       // рюкзак на спине
  px: t.int16(),              // где лежит рюкзак, если не на спине
  py: t.int16(),
  pack: t.string(),           // вид рюкзака (PACK_KINDS)
  hand: t.string(),           // что в правой руке: вид вещи (ITEM_KINDS) или пусто; тяжёлая вещь (в обеих) — только здесь
  off: t.string(),            // что в левой руке
  lamp: t.boolean(),          // лампа у него в руке зажжена и светит
  recent: t.array('string'),  // хвосты последних рыб — над ведром, когда оно у него в руке
}, 'PlayerState');
export type PlayerState = SchemaType<typeof PlayerState>;

// Вещь на земле. Поля совпадают с GroundView из @fh/shared. Кто её выложил, не рассылается: поднять её может любой.
export const GroundState = schema({
  kind: t.string(),           // вид вещи (ITEM_KINDS)
  x: t.int16(),               // где лежит на карте
  y: t.int16(),
  lit: t.boolean(),           // горит (лампа)
  fish: t.string(),           // хвосты рыб над ведром: id через запятую
}, 'GroundState');
export type GroundState = SchemaType<typeof GroundState>;

export const PierState = schema({
  players: t.map(PlayerState),   // ключ — sessionId соединения
  ground: t.map(GroundState),    // ключ — id вещи строкой; земля одна на все копии причала
}, 'PierState');
export type PierState = SchemaType<typeof PierState>;
