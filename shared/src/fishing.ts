// Рыбалка с края причала — правила. Их ведёт сервер: он решает, когда клюёт, кто клюнул и успел ли игрок подсечь.
// Клиент только показывает фазы по событиям сервера (app/app/game/fishing-view.ts).
// Рыбачат удочкой в одной руке и с червями в другой. Без них не забросить, а убрал удочку или червей посреди
// рыбалки — леска сматывается. Червь уходит, когда рыба клюнула (поймал её или сорвалась); рано дёрнул — червь цел.
// Банка опустела — рыбак больше не забрасывает (noWorms). Ведро рядом полное — тоже (bucketFull): подсеченной рыбе
// некуда лечь, и она уходит.
//
// Фазы: off — герой не сидит; rest — сидит, леска в воде, как на картинке; cast — заброс;
// wait — ждём поклёвку (сколько — от клёва: FISH.pace); bite — клюёт, надо подсечь; pull — рыба идёт вверх по леске;
// fly — летит в ведро; pause — короткая передышка; scare — рыба ушла (рано дёрнул или прозевал).

import { FISH, type Catch, type FishSpot, type Moment } from './fish.ts';

export const TIME = { cast: 0.55, waitMin: 2.2, waitMax: 6.5, pull: 0.5, fly: 0.7, pause: 0.6, scare: 0.9 };

// Запас на сетевую задержку: подсечку, пришедшую чуть позже окна, сервер всё ещё засчитывает.
export const HOOK_GRACE = 0.3;

export type Phase = 'off' | 'rest' | 'cast' | 'wait' | 'bite' | 'pull' | 'fly' | 'pause' | 'scare';

// Что сервер сообщает игроку о его рыбалке. hook — рыба подсечена и уже лежит в ведре.
export type FishingEvent =
  | { e: 'needRod' } | { e: 'needBait' } | { e: 'noWorms' } | { e: 'needBucket' } | { e: 'bucketFull' } | { e: 'cast' } | { e: 'nibble' } | { e: 'bite' }
  | { e: 'early' } | { e: 'miss' } | { e: 'rest' } | { e: 'hook'; fish: Catch };

export interface FishingState { phase: Phase; t: number; wait: number; nibble: number; fish: Catch | null }

export interface FishingOptions {
  rnd?: () => number;
  hasRod: () => boolean;              // в руке ли удочка
  hasBait: () => boolean;             // в руке ли черви
  hasWorms?: () => boolean;           // есть ли в этой банке хоть один червь
  useWorm?: () => void;               // рыба клюнула — червя больше нет
  hasBucket: () => boolean;           // стоит ли ведро рядом с местом рыбака
  hasRoom?: () => boolean;            // есть ли в ведре (в каком-нибудь из тех, что рядом) место ещё для одной рыбы
  emit: (ev: FishingEvent) => void;
  grace?: number;                     // сколько секунд прибавить к окну подсечки
  spot?: () => FishSpot;              // где рыбачат: у причала или с мостков острова — там клюют разные рыбы (FISH.roll)
  moment?: () => Moment;              // который час и какая погода: от них зависит, кто клюёт и как скоро (FISH.pace); не сказали — как в ясный полдень
}

export function createFishing({ rnd = Math.random, hasRod, hasBait, hasWorms = () => true, useWorm = () => {}, hasBucket, hasRoom = () => true, emit, grace = 0, spot = () => 'pier', moment }: FishingOptions) {
  const st: FishingState = { phase: 'off', t: 0, wait: 0, nibble: -1, fish: null };
  const set = (phase: Phase) => { st.phase = phase; st.t = 0; };
  function cast() {
    set('cast');
    st.wait = (TIME.waitMin + rnd() * (TIME.waitMax - TIME.waitMin)) / FISH.pace(spot(), moment?.());   // хороший клёв — ждать меньше
    st.nibble = st.wait > 3.4 && rnd() < 0.6 ? st.wait * (0.3 + rnd() * 0.35) : -1;   // ложный тычок перед настоящей поклёвкой
    emit({ e: 'cast' });
  }
  function sit() { st.fish = null; set('rest'); }
  function leave() { st.fish = null; set('off'); }         // подсеченная рыба уже в ведре — вставать можно когда угодно
  function press() {
    if (st.phase === 'rest') {
      if (!hasRod()) { emit({ e: 'needRod' }); return; }
      if (!hasBait()) { emit({ e: 'needBait' }); return; }
      if (!hasWorms()) { emit({ e: 'noWorms' }); return; }
      if (!hasBucket()) { emit({ e: 'needBucket' }); return; }
      if (!hasRoom()) { emit({ e: 'bucketFull' }); return; }
      cast();
    } else if (st.phase === 'wait') { set('scare'); emit({ e: 'early' }); }
    else if (st.phase === 'bite' && st.fish && !hasRoom()) { st.fish = null; set('scare'); emit({ e: 'bucketFull' }); }   // пока клевало, ведро наполнили — рыбу некуда деть
    else if (st.phase === 'bite' && st.fish) { const fish = st.fish; set('pull'); emit({ e: 'hook', fish }); }
  }
  // Забросить снова, если в банке ещё есть черви и в ведре есть место; нет — сматываем леску и говорим почему.
  function recast() {
    if (!hasWorms()) { set('rest'); emit({ e: 'noWorms' }); }
    else if (!hasRoom()) { set('rest'); emit({ e: 'bucketFull' }); }
    else cast();
  }
  function update(dt: number) {
    // удочку или червей убрали из руки — рыбалка кончилась; рыба, что уже подсечена, и так в ведре
    if (st.phase !== 'off' && st.phase !== 'rest' && !(hasRod() && hasBait())) { st.fish = null; set('rest'); emit({ e: 'rest' }); return; }
    const t0 = st.t;
    st.t += dt;
    if (st.phase === 'cast' && st.t >= TIME.cast) set('wait');
    else if (st.phase === 'wait') {
      if (st.nibble > 0 && t0 < st.nibble && st.t >= st.nibble) emit({ e: 'nibble' });
      if (st.t >= st.wait) { st.fish = FISH.roll(rnd, spot(), moment?.()); useWorm(); set('bite'); emit({ e: 'bite' }); }   // клюнула — червя объела, поймай её или нет
    }
    else if (st.phase === 'bite' && st.fish && st.t >= FISH.byId[st.fish.id]!.window + grace) { st.fish = null; set('scare'); emit({ e: 'miss' }); }
    else if (st.phase === 'scare' && st.t >= TIME.scare) recast();
    else if (st.phase === 'pull' && st.t >= TIME.pull) set('fly');
    else if (st.phase === 'fly' && st.t >= TIME.fly) { st.fish = null; set('pause'); }
    else if (st.phase === 'pause' && st.t >= TIME.pause) { if (hasBucket()) recast(); else { set('rest'); emit({ e: 'rest' }); } }   // полное ведро — recast скажет
  }
  return { st, sit, leave, press, update };
}

export type Fishing = ReturnType<typeof createFishing>;
