// Время суток. Игровые сутки идут по часам сервера, поэтому у всех игроков и во всех комнатах время одно и то же.
// Здесь же — как оно выглядит: каким цветом затемнён кадр в каждый час и когда в доме горит свет (рисует это клиент).

export const DAY_LENGTH = 24 * 60;            // секунд настоящего времени в игровых сутках: игровой час идёт минуту

const wrap = (hour: number) => ((hour % 24) + 24) % 24;

// Игровой час 0..24 в момент ms — время сервера в миллисекундах.
export const dayHour = (ms: number): number => wrap(ms / 1000 / DAY_LENGTH * 24);
// На сколько миллисекунд перевести часы, чтобы в момент ms был час hour. Так сервер переводит часы причала в разработке.
export const clockShift = (hour: number, ms: number): number => (wrap(hour) - dayHour(ms)) / 24 * DAY_LENGTH * 1000;

export interface DayPart { id: 'night' | 'morning' | 'day' | 'evening'; name: string }
const NIGHT: DayPart = { id: 'night', name: 'Ночь' };
export const NIGHT_HOURS = { from: 21, to: 5 };   // ночь: с какого часа и до какого (по ней же спят кот и собака)
// [до какого часа, часть суток]
const PARTS: [number, DayPart][] = [[NIGHT_HOURS.to, NIGHT], [8, { id: 'morning', name: 'Утро' }], [18, { id: 'day', name: 'День' }], [NIGHT_HOURS.from, { id: 'evening', name: 'Вечер' }], [24, NIGHT]];
export const dayPart = (hour: number): DayPart => { const h = wrap(hour); return (PARTS.find(p => h < p[0]) || PARTS[0]!)[1]; };

// «19:40» — часы в игре идут с шагом в десять минут.
export function clockText(hour: number): string {
  const min = Math.floor(wrap(hour) * 6) * 10;
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

// Небо по часам: [час, r, g, b] — цвет, на который умножается кадр; между точками он меняется плавно. Белый — обычный день.
const SKY: [number, number, number, number][] = [
  [0, 104, 122, 192], [4.5, 104, 122, 192],       // ночь
  [5.75, 226, 172, 166],                          // рассвет
  [7.25, 255, 255, 255], [17.5, 255, 255, 255],   // день
  [19, 255, 178, 128],                            // закат
  [20.5, 104, 122, 192], [24, 104, 122, 192],     // ночь
];
// Свет в доме: в котором часу его зажигают и гасят и сколько игровых часов он разгорается.
export const LIGHTS = { on: 19, off: 6, fade: 0.06 };

// tint — цвет, на который умножается кадр; lights — горит ли свет в доме, 0..1; dark — насколько темно, 0..1 (днём 0).
export interface Sky { tint: [number, number, number]; lights: number; dark: number }

export function skyAt(hour: number): Sky {
  const h = wrap(hour);
  let i = 1; while (SKY[i]![0] < h) i++;
  const a = SKY[i - 1]!, b = SKY[i]!, k = (h - a[0]) / (b[0] - a[0]);
  const mix = (c: 1 | 2 | 3) => Math.round(a[c] + (b[c] - a[c]) * k);
  const tint: Sky['tint'] = [mix(1), mix(2), mix(3)];
  const lights = h >= LIGHTS.on ? Math.min(1, (h - LIGHTS.on) / LIGHTS.fade) : h < LIGHTS.off ? 1 : Math.max(0, 1 - (h - LIGHTS.off) / LIGHTS.fade);
  return { tint, lights, dark: 1 - (0.299 * tint[0] + 0.587 * tint[1] + 0.114 * tint[2]) / 255 };
}
