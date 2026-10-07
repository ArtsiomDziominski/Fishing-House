// Погода на причале: ясно, пасмурно, дождь или туман, и отдельно — дует ли ветер (он бывает в любую погоду).
// Погоду ведёт сервер и сообщает её игрокам, клиент только рисует. Расписание считается от времени,
// поэтому у всех процессов игрового сервера погода одна.

export const WEATHERS = ['clear', 'cloudy', 'rain', 'fog'] as const;
export type WeatherKind = typeof WEATHERS[number];
export interface Weather { kind: WeatherKind; wind: boolean }

export const WEATHER_NAMES: Record<WeatherKind, string> = { clear: 'Ясно', cloudy: 'Пасмурно', rain: 'Дождь', fog: 'Туман' };
// «Дождь, ветер» — подпись для интерфейса.
export const weatherText = (w: Weather): string => WEATHER_NAMES[w.kind] + (w.wind ? ', ветер' : '');

export const WEATHER_SPAN = 5 * 60;           // секунд настоящего времени держится одна погода
const SHARES: [WeatherKind, number][] = [['clear', 44], ['cloudy', 24], ['rain', 18], ['fog', 14]];   // как часто какая погода, в процентах
const WIND_CHANCE = 0.35;                     // доля отрезков с ветром

// Число 0..1 по номеру отрезка времени: одно и то же у всех, кто спросит.
function dice(n: number, salt: number): number {
  let h = Math.imul(n ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Погода по расписанию в момент ms (настоящее время сервера, мс).
export function weatherAt(ms: number): Weather {
  const n = Math.floor(ms / 1000 / WEATHER_SPAN);
  let roll = dice(n, 1) * 100, kind: WeatherKind = SHARES[0]![0];
  for (const [k, share] of SHARES) { if (roll < share) { kind = k; break; } roll -= share; }
  return { kind, wind: dice(n, 2) < WIND_CHANCE };
}
