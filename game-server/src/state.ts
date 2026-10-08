// Состояние комнаты-причала, которое Colyseus сам рассылает всем в комнате (только изменения, в двоичном виде).
// Здесь только то, что видно о других игроках. Улов и рыбалку игрок получает сообщениями — их видит только он.
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
  carrying: t.boolean(),      // ведро в руке
  bx: t.int16(),              // где стоит ведро, если не в руке
  by: t.int16(),
  bucketHome: t.boolean(),    // ведро на своём месте с картинки, никем не тронутое
  wearing: t.boolean(),       // рюкзак на спине
  px: t.int16(),              // где лежит рюкзак, если не на спине
  py: t.int16(),
  pack: t.string(),           // вид рюкзака (PACK_KINDS)
  hand: t.string(),           // что в руках: вид вещи (ITEM_KINDS) или пусто; тяжёлая вещь — только здесь
  off: t.string(),            // вторая рука — та, что носит ведро
  ground: t.string(),         // что игрок поставил на землю: вид вещи или пусто
  gx: t.int16(),              // и где
  gy: t.int16(),
  lamp: t.boolean(),          // его лампа зажжена и светит: она в руке или на земле
  recent: t.array('string'),  // хвосты последних рыб над ведром
}, 'PlayerState');
export type PlayerState = SchemaType<typeof PlayerState>;

export const PierState = schema({
  players: t.map(PlayerState),   // ключ — sessionId соединения
}, 'PierState');
export type PierState = SchemaType<typeof PierState>;
