// Небо причала: часы и погода — одни на всех игроков.
// Часы — обычно просто время сервера. Погода идёт по расписанию от того же времени (weatherAt в @fh/shared),
// поэтому у всех процессов она одна; когда она меняется, комнаты сообщают её своим игрокам.
//
// В разработке и часы, и погоду можно выставить из игры (нажать на часы справа вверху): меняется сразу
// у всех игроков во всех комнатах этого процесса. Выставленное живёт в памяти — после перезапуска сервера
// время и погода снова настоящие.
//
//   DEV_TOOLS=1 — выставлять разрешено, DEV_TOOLS=0 — запрещено;
//   не задано — разрешено везде, кроме продакшена (NODE_ENV=production).

import { clockShift, weatherAt, type ServerMessages, type WeatherKind } from '@fh/shared';

type What = 'clock' | 'weather';

const flag = process.env.DEV_TOOLS;
const canSet = flag ? flag === '1' : process.env.NODE_ENV !== 'production';
let shift = 0;                                  // на сколько часы причала впереди настоящих, мс
let fixKind: WeatherKind | null = null, fixWind: boolean | null = null;   // погода и ветер, выставленные вручную; null — по расписанию
const listeners = new Set<(what: What) => void>();
const tellAll = (what: What) => { for (const tell of listeners) tell(what); };

function weather(): ServerMessages['weather'] {
  const plan = weatherAt(Date.now());
  return { kind: fixKind ?? plan.kind, wind: fixWind ?? plan.wind, fixKind, fixWind };
}

// Раз в секунду смотрим, не сменилась ли погода по расписанию.
let told = JSON.stringify(weather());
function checkWeather() { const now = JSON.stringify(weather()); if (now !== told) { told = now; tellAll('weather'); } }
setInterval(checkWeather, 1000).unref();

export const Sky = {
  canSet,
  clock: (): ServerMessages['clock'] => ({ now: Date.now() + shift, canSet, moved: shift !== 0 }),
  weather,
  // Перевести часы на этот игровой час (время идёт дальше, как шло) или вернуть настоящее время (null).
  setHour(hour: number | null) {
    shift = hour === null ? 0 : clockShift(hour, Date.now()) + 1;   // на миллисекунду дальше: иначе округление покажет предыдущую минуту
    tellAll('clock');
  },
  // Выставить погоду и ветер; null — пусть идут по расписанию.
  setWeather(kind: WeatherKind | null, wind: boolean | null) { fixKind = kind; fixWind = wind; checkWeather(); },
  // Комната подписывается, чтобы сообщать своим игрокам новое время и погоду; возвращает отписку.
  onChange(tell: (what: What) => void) { listeners.add(tell); return () => { listeners.delete(tell); }; },
};
