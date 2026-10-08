// Черви и лопаты. Черви живут в банке (вещь worms, Item.worms — сколько их в ней, хранит сервер, у каждой банки свой счёт):
// в полной MAX. На рыбалке червь уходит, когда рыба клюнула — поймал её или сорвалась; рано дёрнул — червь цел. Пустая
// банка — не забросить. Пополняют банку лопатой: копают на траве и земле (не на настиле, тропинках и у воды — DIG_DATA,
// tools/build-dig.mjs), держа лопату в одной руке и банку в другой. Лопаты три — копают по 1, 2 и 5 червей. Вскопанное место
// пустеет на REST секунд (ямку видят все); после дождя червей вдвое. В полную банку не копают, а лишнее уползает.

import { DIG_DATA } from './dig-data.ts';
import { dist, type Dir } from './rules.ts';
import { weatherAt } from './weather.ts';
import { World, type Point } from './world.ts';

// Ямка от лопаты: где она и когда вскопана (мс, часы сервера).
export interface Hole extends Point { at: number }

export const WORMS = (() => {
  const MAX = 30;                  // червей в полной банке
  const MANY = 10;                 // больше — их не сосчитать: «хватает»
  const LOW = 10;                  // осталось столько — подсказка
  const DIG = 1.5;                 // секунд копает
  const REST = 600;                // секунд вскопанное место пустеет (и столько видна ямка)
  const NEAR = 8;                  // ближе этого к свежей ямке — то же место
  const WET = 600;                 // секунд после дождя земля сырая: червей вдвое
  // Лопаты — сколько червей за раз: простая всем, остальные пока не достать.
  const SHOVELS: Record<string, number> = { 'shovel-old': 1, 'shovel-spade': 2, 'shovel-scoop': 5 };

  // Как назвать, сколько в банке: много — «хватает», мало — числом, ни одного — «пусто».
  const label = (n: number) => (n <= 0 ? 'пусто' : n > MANY ? 'хватает' : String(n));
  // Сколько червей за раз копает эта вещь; 0 — не лопата. kind приходит и строкой из состояния комнаты.
  const shovel = (kind: string) => SHOVELS[kind] ?? 0;
  const isShovel = (kind: string) => shovel(kind) > 0;

  // Маска травы — растр карты; ходить там тоже должно быть можно (не под домом, не в очаге, не в чаще) — по исходной
  // проходимости, без ведра и рюкзака, которые клиент ставит препятствиями.
  const mask = new Uint8Array(DIG_DATA.w * DIG_DATA.h);
  { let p = 0; for (let i = 0; i < DIG_DATA.dig.length; i += 2) { mask.fill(DIG_DATA.dig[i]!, p, p + DIG_DATA.dig[i + 1]!); p += DIG_DATA.dig[i + 1]!; } }
  for (let i = 0; i < mask.length; i++) if (!World.walk[i]) mask[i] = 0;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < DIG_DATA.w && y < DIG_DATA.h && mask[y * DIG_DATA.w + x] === 1;
  // Можно ли копать в точке: она и всё в паре пикселей вокруг — трава.
  function canDig(p: Point): boolean {
    const x = Math.round(p.x), y = Math.round(p.y);
    return at(x, y) && at(x - 2, y) && at(x + 2, y) && at(x, y - 2) && at(x, y + 2);
  }
  // Куда втыкается лопата у героя, который стоит в p и смотрит dir: перед ним, а боком — сбоку на длину черенка.
  function spot(p: Point, dir: Dir): Point {
    const [dx, dy] = dir === 'left' ? [-11, 1] : dir === 'right' ? [11, 1] : dir === 'up' ? [0, -4] : [0, 6];
    return { x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
  }
  // Ямка, которая ещё не заросла (now — мс, часы сервера).
  const fresh = (h: Hole, now: number) => now - h.at < REST * 1000;
  // Это место уже вскопано и ещё пустое.
  const dug = (holes: Iterable<Hole>, p: Point, now: number) => { for (const h of holes) if (fresh(h, now) && dist(h, p) < NEAR) return true; return false; };
  // Сырая ли земля: дождь идёт сейчас (rain) или шёл по расписанию погоды в последние WET секунд (ms — настоящее время).
  function wet(ms: number, rain: boolean): boolean {
    if (rain) return true;
    for (let t = 0; t <= WET; t += 60) if (weatherAt(ms - t * 1000).kind === 'rain') return true;
    return false;
  }
  // Сколько червей выкопала лопата kind: после дождя — вдвое.
  const yieldOf = (kind: string, wetGround: boolean) => shovel(kind) * (wetGround ? 2 : 1);
  // Положить got червей в банку, где их n: сверх MAX они уползают (lost).
  function fill(n: number, got: number): { n: number; lost: number } {
    const all = Math.max(0, n) + got;
    return { n: Math.min(MAX, all), lost: Math.max(0, all - MAX) };
  }

  return { MAX, MANY, LOW, DIG, REST, NEAR, WET, SHOVELS, label, shovel, isShovel, canDig, spot, fresh, dug, wet, yieldOf, fill };
})();
