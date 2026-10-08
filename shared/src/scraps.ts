// Рыба, выложенная на землю, долго не лежит: через LIFE секунд её уже нет (последние FADE секунд она тает на глазах),
// а раньше за ней может прийти чайка или кот. Когда и кто — решается по номеру вещи (fate), поэтому все копии причала
// решают одинаково. Конец начался — его видно всем (GroundView.end), а через TAKE секунд рыбы нет ни на земле, ни в базе.
// Пока её не унесли, её можно поднять: зверь уйдёт ни с чем. Решает всё это сервер, клиент только показывает.

export type ScrapEnd = 'gull' | 'cat' | 'fade';

export const SCRAPS = (() => {
  const LIFE = 60;                       // секунд лежит рыба на земле, если за ней никто не придёт
  const FADE = 2;                        // столько последних секунд она тает
  // Секунд от начала конца, пока рыбы не станет: чайка подлетает, клюёт и уносит её; кот подходит и съедает.
  const TAKE: Record<ScrapEnd, number> = { gull: 4, cat: 6, fade: FADE };
  const ANIMAL = 0.5;                    // с какой вероятностью за рыбой придёт зверь раньше, чем она растает
  const SOON = 15, LATE = 45;            // зверь приходит через столько секунд после того, как рыба легла: не раньше и не позже
  const ENDS: readonly ScrapEnd[] = ['gull', 'cat', 'fade'];
  const isEnd = (s: string): s is ScrapEnd => (ENDS as readonly string[]).includes(s);
  const hash = (n: number, s: number) => { let h = (n * 374761393 + s * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // Судьба рыбы id: кто за ней придёт (by) и через сколько секунд после того, как она легла на землю (at).
  function fate(id: number): { by: ScrapEnd; at: number } {
    if (hash(id, 1) >= ANIMAL) return { by: 'fade', at: LIFE - FADE };
    return { by: hash(id, 2) < 0.5 ? 'gull' : 'cat', at: SOON + hash(id, 3) * (LATE - SOON) };
  }
  return { LIFE, FADE, TAKE, ANIMAL, SOON, LATE, ENDS, isEnd, fate };
})();
