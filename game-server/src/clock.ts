// Часы причала: по ним у всех игроков одно время суток. Обычно это просто время сервера.
// В разработке их можно перевести (в игре — нажать на часы справа вверху): время меняется сразу у всех игроков
// во всех комнатах этого процесса. Сдвиг живёт в памяти — после перезапуска сервера время снова настоящее.
//
//   DEV_CLOCK=1 — перевод часов разрешён, DEV_CLOCK=0 — запрещён;
//   не задано — разрешён везде, кроме продакшена (NODE_ENV=production).

import { clockShift } from '@fh/shared';

const flag = process.env.DEV_CLOCK;
let shift = 0;                                  // на сколько часы причала впереди настоящих, мс
const listeners = new Set<() => void>();

export const Clock = {
  canSet: flag ? flag === '1' : process.env.NODE_ENV !== 'production',
  now: () => Date.now() + shift,
  moved: () => shift !== 0,
  // Перевести часы на этот игровой час (время идёт дальше, как шло) или вернуть настоящее время (null).
  setHour(hour: number | null) {
    shift = hour === null ? 0 : clockShift(hour, Date.now()) + 1;   // на миллисекунду дальше: иначе округление покажет предыдущую минуту
    for (const tell of listeners) tell();
  },
  // Комната подписывается, чтобы сообщить своим игрокам новое время; возвращает отписку.
  onChange(tell: () => void) { listeners.add(tell); return () => { listeners.delete(tell); }; },
};
