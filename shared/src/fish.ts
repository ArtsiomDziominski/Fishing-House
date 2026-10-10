// Рыбы: речные и морские, их пиксельные карты (головой влево) и правила улова.
// chance — доля поклёвок у причала, isle — у острова (island.ts): лещ и сом водятся только там, на глубине; sea — в открытом
// океане (sea.ts): там клюют только морские, а речных нет.
// weight — граммы от и до, window — сколько секунд даётся на подсечку, tail — цвета хвоста и спины, которыми рыба торчит из ведра.
// Клёв зависит от времени суток и погоды: доля вида множится на when (часть суток, dayPart) и wx (погода), а от того,
// сколько рыбы сейчас клюёт, зависит, как скоро будет поклёвка (pace). Сом берёт ночью, щука — на рассвете и в пасмурь,
// карась — днём в ясную жару, окунь ночью спит; в дождь клюёт чаще. В океане скумбрия берёт ясным днём, треска — в пасмурь
// и дождь, кальмар — ночью, редкий тяжёлый тунец — на рассвете.
// Код общий: сервер решает, кто клюнул (roll), клиент рисует спрайты и показывает, какой сейчас клёв (forecast).

import { dayPart, type DayPart } from './daytime.ts';
import { WEATHER_SHARES, type WeatherKind } from './weather.ts';

type PartOf<T> = Record<DayPart['id'], T>;
export interface Species {
  id: string; name: string; chance: number; isle: number; sea: number; weight: [number, number]; window: number;
  when: PartOf<number>; wx: Record<WeatherKind, number>;
  tail: [string, string]; pal: Record<string, string>; map: string[];
}
// Где рыбачат: с края причала, у острова (с мостков и с берега) или из лодки в открытом океане.
export type FishSpot = 'pier' | 'isle' | 'sea';
// Когда рыбачат: игровой час и погода — от них зависит клёв.
export interface Moment { hour: number; weather: WeatherKind }
// Клёв для интерфейса: pace — во сколько раз чаще, чем в ясный полдень, клюёт; level — 0 слабый, 1 обычный, 2 хороший;
// fish — кто здесь водится и во сколько раз чаще, чем обычно для него (в среднем за сутки и всякую погоду), он сейчас клюёт (ratio), от охотных к вялым.
export interface Forecast { pace: number; level: 0 | 1 | 2; fish: { id: string; name: string; ratio: number }[] }
export interface Sprite { w: number; h: number; data: Uint8ClampedArray }
export interface Catch { id: string; grams: number }

export const FISH = (() => {
  const SPECIES: Species[] = [
    {
      id: 'roach', name: 'Плотва', chance: 38, isle: 24, sea: 0, weight: [90, 380], window: 1.25, 
      when: { night: 0.5, morning: 1.4, day: 1, evening: 1.3 }, wx: { clear: 1, cloudy: 1.1, rain: 1.2, fog: 1 },
      tail: ['c9532d', 'b5b9b8'],
      pal: { o: '240702', e: '0d0502', B: '5b7381', S: 'b5b9b8', W: 'e4e8e4', R: 'c9532d' },
      map: [
        '....oooooo......',
        '..ooBBBBBBooo..o',
        '.oSSBBBBBBBBSooR',
        'oSeSSSSSSSSSSSRR',
        'oSSSSSSSSSSSSoRR',
        '.oWWWWWWWWWWoo.o',
        '..ooRRoooRRo....',
        '....oo...oo.....',
      ],
    },
    {
      id: 'perch', name: 'Окунь', chance: 26, isle: 22, sea: 0, weight: [120, 650], window: 1.1, 
      when: { night: 0.2, morning: 1.3, day: 1.3, evening: 0.9 }, wx: { clear: 1.2, cloudy: 1, rain: 0.8, fog: 0.7 },
      tail: ['c9532d', '8a9a3c'],
      pal: { o: '240702', e: '0d0502', G: '4c6b2a', g: '8a9a3c', D: '2c4420', Y: 'd9c36a', R: 'c9532d' },
      map: [
        '.....o.o.o......',
        '....oGoGoGoo....',
        '..ooGGGGGGGGoo.o',
        '.oGgDgGDgGDgGooR',
        'oGeggDggDggDggRR',
        'oYYYYDYYDYYDYoRR',
        '.oYYYYYYYYYYoo.o',
        '..ooRRoooRRo....',
        '....oo...oo.....',
      ],
    },
    {
      id: 'crucian', name: 'Карась', chance: 20, isle: 10, sea: 0, weight: [180, 950], window: 1.15, 
      when: { night: 0.4, morning: 0.9, day: 1.5, evening: 1.1 }, wx: { clear: 1.4, cloudy: 1, rain: 0.7, fog: 0.9 },
      tail: ['9a6a1e', 'd2a03a'],
      pal: { o: '240702', e: '0d0502', A: '9a6a1e', a: 'd2a03a', b: 'ecd585' },
      map: [
        '.....ooooo......',
        '...ooAAAAAoo....',
        '..oAAAAAAAAAo..o',
        '.oAAaaaaaaaaAooA',
        'oAeaaaaaaaaaaAAA',
        'oAaaaaaaaaaaaoAA',
        '.oaaaabbbbbaoo.o',
        '..oobbbbbbbo....',
        '....ooAAoo......',
        '......oo........',
      ],
    },
    {
      id: 'pike', name: 'Щука', chance: 11, isle: 15, sea: 0, weight: [900, 4800], window: 0.85, 
      when: { night: 0.3, morning: 2.6, day: 0.7, evening: 1.4 }, wx: { clear: 0.8, cloudy: 1.5, rain: 1.3, fog: 1.2 },
      tail: ['9a4a26', '5a6e2a'],
      pal: { o: '240702', e: '0d0502', P: '5a6e2a', p: 'aab65a', L: 'dcd9a2', F: '9a4a26' },
      map: [
        '.........ooooooooo......',
        '....oooooPPPPPPPPPooo..o',
        '.oooPPPpPPpPPpPPpPPPPooF',
        'oPePPpPPpPPpPPpPPpPPPFFF',
        'oooLLLLLLLLLLLLLLLLLLooF',
        '...oooooooFFoooooooo...o',
        '..........oo............',
      ],
    },
    {
      id: 'gold', name: 'Золотая рыбка', chance: 5, isle: 3, sea: 0, weight: [60, 240], window: 0.7, 
      when: { night: 0.4, morning: 1.2, day: 1, evening: 1 }, wx: { clear: 1, cloudy: 1, rain: 1, fog: 2 },
      tail: ['f6a23a', 'f08a1c'],
      pal: { o: '240702', e: '0d0502', O: 'f08a1c', Y: 'f8c12a', T: 'f6a23a', w: 'fff6d8' },
      map: [
        '......oooo......',
        '....ooOOOOoo..oo',
        '...oOOOOOOOOooTo',
        '..oOOwOOOOOOOTTo',
        '.oOeOOOOOOOOTTo.',
        '.oOOOOOOOOOOTTo.',
        '..oYYYYYYYYooTTo',
        '...ooYYYYoo.oTTo',
        '.....oTToo...oo.',
        '......oo........',
      ],
    },
    {
      // лещ: высокий и плоский, бронзовый, с длинным плавником снизу; только у острова
      id: 'bream', name: 'Лещ', chance: 0, isle: 18, sea: 0, weight: [300, 2800], window: 1.15, 
      when: { night: 1.6, morning: 1.4, day: 0.6, evening: 1.4 }, wx: { clear: 0.9, cloudy: 1.2, rain: 1.2, fog: 1.1 },
      tail: ['5c4c32', 'b8954a'],
      pal: { o: '240702', e: '0d0502', B: '6b5a2e', S: 'b8954a', s: 'a07f3c', L: 'dcc98e', F: '5c4c32' },
      map: [
        '......oooo......',
        '....ooBBBBoo....',
        '...oBBBBBBBBo..o',
        '..oSBBSSSSSBBooF',
        '.oSSSSsSSsSSSoFF',
        'oeSSSSSSSSSSSSFF',
        'oSSLLLLLLLLSSoFF',
        '.oLLLLLLLLLLoooF',
        '..ooFFFFFFFoo..o',
        '....ooooooo.....',
      ],
    },
    {
      // сом: длинный, тёмный, с усами; клюёт редко и тяжело, только у острова
      id: 'catfish', name: 'Сом', chance: 0, isle: 8, sea: 0, weight: [1500, 9000], window: 0.8, 
      when: { night: 3.5, morning: 0.6, day: 0.15, evening: 1.6 }, wx: { clear: 0.9, cloudy: 1.1, rain: 1.6, fog: 1.1 },
      tail: ['2e2a24', '5a5446'],
      pal: { o: '240702', e: 'e8e0c4', D: '2e2a24', G: '5a5446', L: '9a927c', w: '8a8070' },
      map: [
        '.........oooooooooo.....',
        '....ooooDDDDDDDDDDDooo.o',
        '.ooDDDDDDGDDDGDDDDDDDooD',
        'oDeDDGGGGGGGGGGGGGGGDDDD',
        'oLLLLLLLLLLLLLLLLLLLDooD',
        'wo.oooooooDDoooooooooo.o',
        'w.w.......oo............',
      ],
    },
    // Морские — клюют только в открытом океане (sea), у причала и острова их нет. Доли sea в сумме — 100, как у причала и острова.
    {
      // сельдь: узкая, серебристая, с синей спиной и вилкой хвоста; клюёт чаще всех, охотнее в сумерки — ночью она поднимается к поверхности
      id: 'herring', name: 'Сельдь', chance: 0, isle: 0, sea: 31, weight: [120, 480], window: 1.2,
      when: { night: 1.2, morning: 1.3, day: 0.8, evening: 1.4 }, wx: { clear: 0.9, cloudy: 1.1, rain: 1.1, fog: 1.1 },
      tail: ['4a6878', 'b9c4c6'],
      pal: { o: '240702', e: '0d0502', D: '2e4f66', B: '4d7a8c', S: 'b9c4c6', G: '8f9ea4', W: 'e6ebe6', T: '4a6878' },
      map: [
        '.....oooooooo....o',
        '...ooDDDDDDDDoo.oT',
        '.ooBBBBBBBBBBBBooT',
        'oSeGSSSSSSSSSSSTT.',
        'oSSGSSSSSSSSSSoTT.',
        '.ooWWWWWWWWWWWWooT',
        '...oooooooooooo.oT',
        '.......oo........o',
      ],
    },
    {
      // скумбрия: зелёная спина в тёмных волнистых полосах; стайная и быстрая — берёт ясным днём, ночью почти нет
      id: 'mackerel', name: 'Скумбрия', chance: 0, isle: 0, sea: 24, weight: [200, 1100], window: 1,
      when: { night: 0.25, morning: 1.3, day: 1.4, evening: 1 }, wx: { clear: 1.4, cloudy: 1, rain: 0.6, fog: 0.7 },
      tail: ['1c2f33', '2f6b6a'],
      pal: { o: '240702', e: '0d0502', G: '2f6b6a', K: '1c2f33', S: 'c8d2cc', W: 'eef0e8', T: '3b5f62' },
      map: [
        '......oo.........o',
        '...oooGGooooooo.oT',
        '.ooGKGGKGGKGGKGooT',
        'oGeKGGKGGKGGKGGTT.',
        'oSSSSSSSSSSSSSoTT.',
        '.ooWWWWWWWWWWWWooT',
        '...oooooooooo.o.oT',
        '.................o',
      ],
    },
    {
      // треска: крупная, пятнистая, с усиком на подбородке и тремя плавниками на спине; любит пасмурь и дождь
      id: 'cod', name: 'Треска', chance: 0, isle: 0, sea: 15, weight: [800, 7500], window: 1.05,
      when: { night: 1.1, morning: 1.1, day: 0.8, evening: 1.2 }, wx: { clear: 0.7, cloudy: 1.4, rain: 1.5, fog: 1.2 },
      tail: ['7a6a3e', 'a8955a'],
      pal: { o: '240702', e: '0d0502', C: '7a6a3e', c: 'a8955a', d: '4e4426', L: 'e0d8b8', W: 'ece4cc', b: '7a6a3e' },
      map: [
        '.....ooo..ooo..oo..o',
        '...ooCcCooCcCooCcooC',
        '..oCCCCCCCCCCCCCCooC',
        '.oCcdCCdCCCdCCdCCoCC',
        'oCeCCdCCCdCCCCdCCCCC',
        'oCCLLLLLLLLLLLLLLoCC',
        '.oWWWWWWWWWWWWWWoooC',
        '..oWoooWWoooooo....o',
        '..bo..oo..oo........',
      ],
    },
    {
      // камбала: плоская, бурая в рыжих пятнах, с бахромой плавников вокруг и обоими глазами сверху; лежит на дне — ей всё
      // равно, светло ли, а в туман и ночью берёт охотнее
      id: 'flounder', name: 'Камбала', chance: 0, isle: 0, sea: 12, weight: [250, 2000], window: 1.2,
      when: { night: 1.3, morning: 1, day: 0.9, evening: 1.1 }, wx: { clear: 0.9, cloudy: 1.1, rain: 1, fog: 1.4 },
      tail: ['5a4228', 'd47a2e'],
      pal: { o: '240702', e: '0d0502', w: 'd8c8a0', F: '6e5434', O: 'd47a2e', r: '5a4228', T: '5a4228' },
      map: [
        '....ooooooooo.....',
        '..oorrrrrrrrroo...',
        '.oweFFFFFFFFFFro.o',
        'oweFFOFFFFFOFFFFoT',
        'oFFFFFFFOFFFFFFFTT',
        'oFFOFFFFFFFFOFFFoT',
        '.oFFFFFFFFFFFFro.o',
        '..oorrrrrrrrroo...',
        '....ooooooooo.....',
      ],
    },
    {
      // морской окунь: красный, глазастый, с колючим гребнем; живёт глубоко и подходит в сумерки, лучше всего — вечером
      id: 'redfish', name: 'Морской окунь', chance: 0, isle: 0, sea: 10, weight: [300, 2200], window: 1.05,
      when: { night: 0.7, morning: 1.2, day: 0.7, evening: 1.6 }, wx: { clear: 1, cloudy: 1.2, rain: 0.9, fog: 1.1 },
      tail: ['b8402a', 'd86a3a'],
      pal: { o: '240702', e: '0d0502', R: 'b8402a', r: 'd86a3a', D: '8a2c1e', P: 'eeb48c', w: 'e8d8b0' },
      map: [
        '....o.o.o.o.....',
        '...oDoDoDoDoo...',
        '..ooRRRRRRRRoo.o',
        '.oRRrRRrRRrRRooR',
        'oRwerrrrrrrrrrRR',
        'oPPrrrrrrrrrroRR',
        '.oPPPPPPPPPPoo.o',
        '..ooRRoooRRo....',
        '....oo...oo.....',
      ],
    },
    {
      // кальмар: щупальцами вперёд (влево), розовый в крапинку, с плавниками-ромбом на конце; ночью поднимается к свету
      // и берёт куда чаще, днём уходит в глубину
      id: 'squid', name: 'Кальмар', chance: 0, isle: 0, sea: 6, weight: [120, 1300], window: 0.9,
      when: { night: 3.6, morning: 0.5, day: 0.1, evening: 1.3 }, wx: { clear: 1.1, cloudy: 1, rain: 0.8, fog: 1.2 },
      tail: ['c98272', 'e0a898'],
      pal: { o: '240702', e: '0d0502', M: 'e0a898', m: 'b9604e', p: 'f2cbbd', A: 'c98272', F: 'c98272' },
      map: [
        '..............oo....',
        '.............oFFoo..',
        '.AAA.oooooooooFFFFo.',
        'A...ooMMmMMMmMMmMMo.',
        'AAAAoMeMMMmMMMMMMMMo',
        'A...oopppppppppppMo.',
        '.AAA.oooooooooFFFFo.',
        '.............oFFoo..',
        '..............oo....',
      ],
    },
    {
      // тунец: тяжёлая торпеда, тёмно-синяя спина, жёлтые плавники и полумесяц хвоста; редкий, берёт на рассвете и в ясную
      // погоду, а сходит быстрее всех — подсекать сразу
      id: 'tuna', name: 'Тунец', chance: 0, isle: 0, sea: 2, weight: [3000, 18000], window: 0.6,
      when: { night: 0.15, morning: 3.2, day: 0.6, evening: 0.9 }, wx: { clear: 1.3, cloudy: 1, rain: 0.6, fog: 0.5 },
      tail: ['3a5274', 'e0b82a'],
      pal: { o: '240702', e: '0d0502', N: '1f2f4a', n: '35506e', S: 'b8c2c8', W: 'e4e8e4', Y: 'e0b82a', T: '3a5274' },
      map: [
        '......ooo..oo........o',
        '....ooNNNooYYoo.o...oT',
        '..ooNNNNNNNNNNNNoY.oTo',
        '.ooNNNNNNNNNNNNNNooTo.',
        'oNennnnnnnnnnnnnnnTT..',
        'oSSSSSSSSSSSSSSSSooTo.',
        '.ooWWWWWWWWWWWWWoY.oTo',
        '...ooooooooYYoo.o...oT',
        '...........oo........o',
      ],
    },
  ];
  const byId: Record<string, Species> = {}; for (const s of SPECIES) byId[s.id] = s;

  const rgb = (h: string) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  // Спрайт вида: { w, h, data } — RGBA. silhouette = true — бледный силуэт для ещё не пойманных.
  function sprite(sp: Species, silhouette = false): Sprite {
    const h = sp.map.length, w = sp.map[0]!.length, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      if (sp.map[y]!.length !== w) throw new Error(`fish ${sp.id}: строка ${y} не ${w} символов`);
      for (let x = 0; x < w; x++) {
        const ch = sp.map[y]![x]!; if (ch === '.') continue;
        const c = silhouette ? [244, 227, 193] : rgb(sp.pal[ch] || 'ff00ff'), o = (y * w + x) * 4;
        data[o] = c[0]!; data[o + 1] = c[1]!; data[o + 2] = c[2]!; data[o + 3] = silhouette ? 60 : 255;
      }
    }
    return { w, h, data };
  }
  // Тот же спрайт головой вверх — так рыба висит на леске.
  function upright(s: Sprite): Sprite {
    const w = s.h, h = s.w, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const a = (y * s.w + x) * 4, b = (x * w + (w - 1 - y)) * 4;
      data[b] = s.data[a]!; data[b + 1] = s.data[a + 1]!; data[b + 2] = s.data[a + 2]!; data[b + 3] = s.data[a + 3]!;
    }
    return { w, h, data };
  }

  // Насколько вид сейчас охотнее (больше 1) или ленивее обычного; без времени и погоды — как обычно.
  const mood = (sp: Species, m?: Moment) => (m ? sp.when[dayPart(m.hour).id] * sp.wx[m.weather] : 1);
  // Доля поклёвок вида там, где рыбачат, и тогда, когда рыбачат.
  const share = (sp: Species, at: FishSpot, m?: Moment) => (at === 'isle' ? sp.isle : at === 'sea' ? sp.sea : sp.chance) * mood(sp, m);
  const total = (at: FishSpot, m?: Moment) => SPECIES.reduce((s, f) => s + share(f, at, m), 0);
  // Кто здесь водится и где водится вид — для списков улова и подсказок: речных в океане нет, а морских нет ни у причала, ни у острова.
  const SPOTS: FishSpot[] = ['pier', 'isle', 'sea'];
  const here = (at: FishSpot) => SPECIES.filter(sp => share(sp, at) > 0);
  const where = (sp: Species) => SPOTS.filter(at => share(sp, at) > 0);
  // Дождь будит всю рыбу разом, сверх того, кто в нём клюёт охотнее.
  const RAIN_PACE: Record<WeatherKind, number> = { clear: 1, cloudy: 1.1, rain: 1.3, fog: 1 };
  const PACE = { min: 0.65, max: 1.8 };
  const USUAL: Moment = { hour: 12, weather: 'clear' };   // обычный клёв — ясный полдень
  // Во сколько раз чаще, чем в ясный полдень, сейчас клюёт: чем больше рыбы проснулось, тем скорее поклёвка (ожидание делят
  // на это число). Корень — чтобы ночь у причала не тянулась бесконечно, а утро в дождь не сыпало рыбой.
  function pace(at: FishSpot, m?: Moment): number {
    if (!m) return 1;
    return Math.min(PACE.max, Math.max(PACE.min, Math.sqrt(total(at, m) / total(at, USUAL)) * RAIN_PACE[m.weather]));
  }
  // Сколько поклёвок этого вида приходится на одну обычную (ясный полдень) — с поправкой на то, как скоро сейчас клюёт.
  const rate = (sp: Species, at: FishSpot, m: Moment) => pace(at, m) * share(sp, at, m) / total(at, m);
  // Как вид клюёт в среднем: части суток по их длине (час внутри каждой), погода — по тому, как часто она бывает.
  const PARTS: [number, number][] = [[2, 8], [6, 3], [12, 10], [19, 3]];   // [час, сколько часов длится эта часть суток]
  const usual = new Map<string, number>();
  function typical(sp: Species, at: FishSpot) {
    const key = sp.id + at;
    if (!usual.has(key)) {
      let sum = 0, all = 0;
      for (const [hour, h] of PARTS) for (const [weather, w] of WEATHER_SHARES) { sum += h * w * rate(sp, at, { hour, weather }); all += h * w; }
      usual.set(key, sum / all);
    }
    return usual.get(key)!;
  }
  // Клёв для интерфейса: как часто клюёт и кто сейчас клюёт чаще или реже, чем обычно для него, — только те, кто здесь водится.
  function forecast(at: FishSpot, m: Moment): Forecast {
    const p = pace(at, m);
    const fish = here(at).map(sp => ({ id: sp.id, name: sp.name, ratio: rate(sp, at, m) / typical(sp, at) }));
    fish.sort((a, b) => b.ratio - a.ratio);
    return { pace: p, level: p < 0.8 ? 0 : p < 1.12 ? 1 : 2, fish };
  }
  // Кто клюнул: вид по долям того места и того времени, когда рыбачат, и вес — чаще мелкая, изредка крупная; rich — у косяка
  // в океане (sea.ts): крупная попадается чаще. Перебираем только тех, кто здесь водится: если от округления r не уложился
  // в доли, клюёт последний из них, а не первый по списку — иначе в океане могла бы клюнуть плотва.
  function roll(rnd: () => number = Math.random, at: FishSpot = 'pier', m?: Moment, rich = false): Catch {
    let r = rnd() * total(at, m), sp = SPECIES[0]!;
    for (const f of SPECIES) { const c = share(f, at, m); if (c <= 0) continue; sp = f; if (r < c) break; r -= c; }
    const k = Math.pow(rnd(), rich ? 1.15 : 1.8), grams = sp.weight[0] + (sp.weight[1] - sp.weight[0]) * k;
    return { id: sp.id, grams: Math.round(grams / 10) * 10 };
  }
  function weightText(grams: number): string {
    return grams >= 1000 ? (grams / 1000).toFixed(grams % 1000 ? 1 : 0).replace('.', ',') + ' кг' : grams + ' г';
  }

  return { SPECIES, byId, sprite, upright, mood, share, here, where, pace, forecast, roll, weightText };
})();
