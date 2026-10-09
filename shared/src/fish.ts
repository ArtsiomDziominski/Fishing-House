// Рыбы: семь видов, их пиксельные карты (головой влево) и правила улова.
// chance — доля поклёвок у причала, isle — у мостков острова (island.ts): лещ и сом водятся только там, на глубине.
// weight — граммы от и до, window — сколько секунд даётся на подсечку, tail — цвета хвоста и спины, которыми рыба торчит из ведра.
// Код общий: сервер решает, кто клюнул (roll), клиент рисует спрайты.

export interface Species {
  id: string; name: string; chance: number; isle: number; weight: [number, number]; window: number;
  tail: [string, string]; pal: Record<string, string>; map: string[];
}
// Где рыбачат: с края причала или с мостков острова.
export type FishSpot = 'pier' | 'isle';
export interface Sprite { w: number; h: number; data: Uint8ClampedArray }
export interface Catch { id: string; grams: number }

export const FISH = (() => {
  const SPECIES: Species[] = [
    {
      id: 'roach', name: 'Плотва', chance: 38, isle: 24, weight: [90, 380], window: 1.25, tail: ['c9532d', 'b5b9b8'],
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
      id: 'perch', name: 'Окунь', chance: 26, isle: 22, weight: [120, 650], window: 1.1, tail: ['c9532d', '8a9a3c'],
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
      id: 'crucian', name: 'Карась', chance: 20, isle: 10, weight: [180, 950], window: 1.15, tail: ['9a6a1e', 'd2a03a'],
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
      id: 'pike', name: 'Щука', chance: 11, isle: 15, weight: [900, 4800], window: 0.85, tail: ['9a4a26', '5a6e2a'],
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
      id: 'gold', name: 'Золотая рыбка', chance: 5, isle: 3, weight: [60, 240], window: 0.7, tail: ['f6a23a', 'f08a1c'],
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
      id: 'bream', name: 'Лещ', chance: 0, isle: 18, weight: [300, 2800], window: 1.15, tail: ['5c4c32', 'b8954a'],
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
      id: 'catfish', name: 'Сом', chance: 0, isle: 8, weight: [1500, 9000], window: 0.8, tail: ['2e2a24', '5a5446'],
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

  // Доля поклёвок вида там, где рыбачат.
  const share = (sp: Species, at: FishSpot) => (at === 'isle' ? sp.isle : sp.chance);
  // Кто клюнул: вид по долям того места, где рыбачат, и вес — чаще мелкая, изредка крупная.
  function roll(rnd: () => number = Math.random, at: FishSpot = 'pier'): Catch {
    const total = SPECIES.reduce((s, f) => s + share(f, at), 0);
    let r = rnd() * total, sp = SPECIES[0]!;
    for (const f of SPECIES) { const c = share(f, at); if (r < c) { sp = f; break; } r -= c; }
    const k = Math.pow(rnd(), 1.8), grams = sp.weight[0] + (sp.weight[1] - sp.weight[0]) * k;
    return { id: sp.id, grams: Math.round(grams / 10) * 10 };
  }
  function weightText(grams: number): string {
    return grams >= 1000 ? (grams / 1000).toFixed(grams % 1000 ? 1 : 0).replace('.', ',') + ' кг' : grams + ' г';
  }

  return { SPECIES, byId, sprite, upright, share, roll, weightText };
})();
