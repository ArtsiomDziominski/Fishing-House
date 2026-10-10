// Вещи в рюкзаке: удочки, сети, топор, лопаты, лампа, ведро и мелочь для рыбалки. Каждая занимает прямоугольник клеток в сетке рюкзака:
// мелочь — одну клетку, сачок и топор — две, лопата — три, удочка и большие сети — четыре, ведро — квадрат 4×4. Вещь можно повернуть на четверть
// оборота — ширина и высота меняются местами. Сколько клеток в рюкзаке, знает его вид (PACKS.grid).
// Вещи берут из рюкзака в руки и убирают обратно; в руках вещь клеток не занимает, но помнит, где лежала. Рук две —
// правая (клавиша E) и левая (Q), и какая вещь в какой руке, помнится. Вещи двух весов: лёгкую держат одной рукой,
// тяжёлую (сеть-накидку и невод) — только двумя, и взять её можно, лишь когда обе руки свободны. Ведро — такая же лёгкая
// вещь: его носят в любой руке, а рыбачить можно, когда оно в руке или стоит на земле у места рыбака. Вёдра трёх видов
// (BUCKETS): жестяное, красное и зелёное — каждое своего цвета и вмещает своё число рыб. Улов лежит в самом ведре
// (catches.bucket_id): кто унёс ведро, тот унёс и рыбу, а из ведра на земле её может достать любой.
// Любую вещь можно выложить на землю — из руки или из рюкзака; с земли её поднимает кто угодно, и она становится его.
// Лампа горит только в руке или на земле. Банка червей помнит, сколько в ней червей (Item.worms; черви и лопаты — worms.ts). Рыба из ведра — тоже вещь (fish — сырая, fish-fried — жареная, вид рыбы в Item.fish):
// сырую держат только в руке (в рюкзак её не убрать — её место в ведре), её жарят у костра и едят (голод — hunger.ts);
// жареную можно и в рюкзак. Где что лежит, решает и хранит сервер; клиент только просит переложить и по тем же правилам
// заранее подсвечивает, куда вещь встанет. Картинки — в app/app/game/items-art.ts.

import { FISH } from './fish.ts';
import { PACKS, type PackKind } from './packs.ts';
import { REACH, dist, type PackState } from './rules.ts';
import type { Point } from './world.ts';

export const ITEM_KINDS = [
  'rod-willow', 'rod-bamboo', 'rod-tele', 'rod-carbon', 'rod-gold',
  'net-scoop', 'net-cast', 'net-seine',
  'axe', 'lamp', 'bucket', 'bucket-red', 'bucket-green',
  'shovel-old', 'shovel-spade', 'shovel-scoop',
  'worms', 'floats',
  'fish', 'fish-fried',
] as const;
export type ItemKind = typeof ITEM_KINDS[number];
export type ItemGroup = 'rod' | 'net' | 'tool' | 'tackle' | 'food';

// Вещь в рюкзаке: id — её номер в базе, x и y — левая верхняя клетка, rot — повёрнута на четверть оборота.
// У вещи в руке x, y, rot — где она лежала в рюкзаке, а left — в левой ли она руке (тяжёлая — всегда «в правой», хоть и держат её обеими).
// fish — у рыбы (fish, fish-fried) её вид (FISH.byId); worms — у банки червей, сколько их в ней (WORMS.MAX — полная).
export interface Item { id: number; kind: ItemKind; x: number; y: number; rot: boolean; left?: boolean; fish?: string; worms?: number }
export type Hand = 'right' | 'left';
export interface Grid { w: number; h: number }
// Где вещь лежит, без номера: так её кладут впервые.
export type Place = Pick<Item, 'x' | 'y' | 'rot'>;
// Вещь на земле: x и y — место на карте, а не клетка; lit — горит ли (это про лампу); fish — хвосты последних рыб в ведре
// (id рыб через запятую), а у рыбы — её вид. Земля общая: такую вещь видят и могут поднять все, а кто её выложил, знает только сервер.
export interface GroundItem { id: number; kind: ItemKind; x: number; y: number; lit: boolean; fish: string }

// Заглянуть в рюкзак можно, когда он на спине или лежит рядом с героем. slack — запас сервера на рывки сети.
// Снятый рюкзак лежит снаружи у причала: из дома (inside), с острова (isle) и из океана (sea) до него не дотянуться, как бы ни совпали числа.
// Вёдра: size — сколько рыб вмещает, tint — цвет, в который перекрашена жесть (null — как на картинке, серое). Вид у всех
// один — 4×4 клетки, лёгкие; различаются цветом и вместимостью.
export type BucketKind = Extract<ItemKind, `bucket${string}`>;
export const BUCKETS: Record<BucketKind, { size: number; tint: [number, number, number] | null }> = {
  'bucket': { size: 15, tint: null },
  'bucket-red': { size: 30, tint: [196, 58, 44] },
  'bucket-green': { size: 50, tint: [74, 148, 70] },
};

export const packInReach = (hero: Point & { inside?: boolean; isle?: boolean; sea?: boolean }, pack: PackState, slack = 0) => pack.worn || (!hero.inside && !hero.isle && !hero.sea && dist(hero, pack) <= REACH + slack);

export const ITEMS = (() => {
  // w и h — клеток в ширину и в высоту, когда вещь не повёрнута; heavy — тяжёлая: её держат двумя руками; text — подпись в рюкзаке
  const BY_KIND: Record<ItemKind, { name: string; group: ItemGroup; w: number; h: number; heavy?: boolean; text: string }> = {
    'rod-willow': { name: 'Ивовая удочка', group: 'rod', w: 4, h: 1, text: 'Срезана у реки. Гнётся, но держит.' },
    'rod-bamboo': { name: 'Бамбуковая удочка', group: 'rod', w: 4, h: 1, text: 'Лёгкая и звонкая, с поплавком.' },
    'rod-tele': { name: 'Телескопическая удочка', group: 'rod', w: 4, h: 1, text: 'Складывается в три колена, с катушкой.' },
    'rod-carbon': { name: 'Карбоновая удочка', group: 'rod', w: 4, h: 1, text: 'Чёрная и упругая, с блесной.' },
    'rod-gold': { name: 'Золотая удочка', group: 'rod', w: 4, h: 1, text: 'Говорят, на неё клюёт сама золотая рыбка.' },
    'net-scoop': { name: 'Сачок', group: 'net', w: 2, h: 1, text: 'Подхватить рыбу у самой воды.' },
    'net-cast': { name: 'Сеть-накидка', group: 'net', w: 2, h: 2, heavy: true, text: 'Бросают кругом, по краю грузила.' },
    'net-seine': { name: 'Невод', group: 'net', w: 4, h: 1, heavy: true, text: 'Длинная сеть с поплавками и грузилами.' },
    'axe': { name: 'Топор', group: 'tool', w: 2, h: 1, text: 'Нарубить сучьев и наколоть дров.' },
    'bucket': { name: 'Жестяное ведро', group: 'tool', w: 4, h: 4, text: `С дужкой. Вмещает ${BUCKETS.bucket.size} рыб. Рыбачить можно, только когда ведро в руке или стоит рядом.` },
    'bucket-red': { name: 'Красное ведро', group: 'tool', w: 4, h: 4, text: `Эмалированное, вмещает ${BUCKETS['bucket-red'].size} рыб. Рыбачить можно, только когда ведро в руке или стоит рядом.` },
    'bucket-green': { name: 'Зелёное ведро', group: 'tool', w: 4, h: 4, text: `Большое, вмещает ${BUCKETS['bucket-green'].size} рыб. Рыбачить можно, только когда ведро в руке или стоит рядом.` },
    'shovel-old': { name: 'Старая лопата', group: 'tool', w: 3, h: 1, text: 'Черенок потёрт, штык тупой. Копает по одному червю — на траве, не у воды и не на тропинках.' },
    'shovel-spade': { name: 'Штыковая лопата', group: 'tool', w: 3, h: 1, text: 'Острая, входит в землю легко. Копает по два червя за раз.' },
    'shovel-scoop': { name: 'Совковая лопата', group: 'tool', w: 3, h: 1, text: 'Широкий совок — поддевает сразу пять червей.' },
    'lamp': { name: 'Походная лампа', group: 'tool', w: 1, h: 1, text: 'Керосиновая, с ручкой. Светит в руке или на земле, в рюкзаке — нет.' },
    'worms': { name: 'Банка червей', group: 'tackle', w: 1, h: 1, text: 'Наживка: червь уходит, когда клюнет рыба. Пополнить — накопать лопатой на траве у причала.' },
    'floats': { name: 'Поплавки', group: 'tackle', w: 1, h: 1, text: 'Красный и синий, на запас.' },
    'fish': { name: 'Сырая рыба', group: 'food', w: 1, h: 1, text: 'Прямо из ведра. Посиди с ней у костра — пожарится. Сырой почти не наешься.' },
    'fish-fried': { name: 'Жареная рыба', group: 'food', w: 1, h: 1, text: 'С костра, ещё тёплая. Плотва насыщает наполовину, остальные — досыта.' },
  };
  // Что лежит в рюкзаке у нового игрока. Влезает в самый маленький рюкзак — кожаный, с которого все начинают. Ведро в него
  // не влезает — оно сразу в левой руке (held, left). В банке пять червей: первую рыбу новичок ловит сразу, а копать лопатой
  // учится, когда они кончатся (новая банка, не из набора, — пустая: её счёт в базе по умолчанию 0).
  const STARTER: (Place & { kind: ItemKind; held?: boolean; left?: boolean; worms?: number })[] = [
    { kind: 'bucket', x: 0, y: 0, rot: false, held: true, left: true },
    { kind: 'rod-willow', x: 0, y: 0, rot: false },
    { kind: 'net-scoop', x: 0, y: 1, rot: false },
    { kind: 'worms', x: 2, y: 1, rot: false, worms: 5 },
    { kind: 'floats', x: 3, y: 1, rot: false },
    { kind: 'shovel-old', x: 0, y: 2, rot: false },
  ];

  const isKind = (v: unknown): v is ItemKind => ITEM_KINDS.includes(v as ItemKind);
  const info = (kind: ItemKind) => BY_KIND[kind];
  // Сколько клеток вещь занимает так, как лежит.
  const size = (kind: ItemKind, rot: boolean) => (rot ? { w: BY_KIND[kind].h, h: BY_KIND[kind].w } : { w: BY_KIND[kind].w, h: BY_KIND[kind].h });
  const cells = (kind: ItemKind) => BY_KIND[kind].w * BY_KIND[kind].h;
  const grid = (pack: PackKind): Grid => PACKS.grid(pack);
  // Квадратная вещь при повороте не меняется — её не поворачиваем вовсе.
  const turns = (kind: ItemKind) => BY_KIND[kind].w !== BY_KIND[kind].h;

  // Встанет ли вещь в клетку x, y: целиком внутри сетки и ни на ком не лежит. skip — её собственный id, когда её перекладывают.
  function fits(g: Grid, items: readonly Item[], kind: ItemKind, x: number, y: number, rot: boolean, skip?: number): boolean {
    const { w, h } = size(kind, rot);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + w > g.w || y + h > g.h) return false;
    for (const it of items) {
      if (it.id === skip) continue;
      const o = size(it.kind, it.rot);
      if (x < it.x + o.w && it.x < x + w && y < it.y + o.h && it.y < y + h) return false;
    }
    return true;
  }
  // Первое свободное место: строка за строкой сверху, слева направо; сначала как есть, потом повёрнутой. null — некуда.
  function spot(g: Grid, items: readonly Item[], kind: ItemKind): Place | null {
    for (const rot of turns(kind) ? [false, true] : [false]) {
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (fits(g, items, kind, x, y, rot)) return { x, y, rot };
    }
    return null;
  }
  // Разложить вещи в другую сетку (сменили рюкзак). Сначала пробуем не трогать тех, кто и так влезает, остальных — на
  // свободные места, крупных первыми; не вышло — раскладываем всё заново, тоже от крупных. null — в этот рюкзак не влезает.
  function repack(g: Grid, items: readonly Item[]): Item[] | null {
    const big = (list: readonly Item[]) => [...list].sort((a, b) => cells(b.kind) - cells(a.kind) || a.id - b.id);
    const place = (keep: Item[], rest: readonly Item[]) => {
      const out = [...keep];
      for (const it of big(rest)) {
        const p = spot(g, out, it.kind);
        if (!p) return null;
        out.push({ ...it, ...p });
      }
      return out;
    };
    const keep: Item[] = [], rest: Item[] = [];
    for (const it of items) (fits(g, keep, it.kind, it.x, it.y, it.rot) ? keep : rest).push(it);
    return place(keep, rest) || place([], items);
  }
  // Вещи из базы — в сетку рюкзака: кто стоит правильно, остаётся; кто наехал на соседа или вылез за край (рюкзак
  // поменяли, размеры правил), ищет свободное место. moved — кого переложили (в базе они пока на старом месте); кому места нет,
  // в list не попадает, но в базе остаётся — появится снова, когда рюкзак станет просторнее.
  function settle(g: Grid, items: readonly Item[]): { list: Item[]; moved: Item[] } {
    const list: Item[] = [], moved: Item[] = [], rest: Item[] = [];
    for (const it of items) (fits(g, list, it.kind, it.x, it.y, it.rot) ? list : rest).push(it);
    for (const it of rest) {
      const p = spot(g, list, it.kind);
      if (!p) continue;
      const next = { ...it, ...p };
      list.push(next); moved.push(next);
    }
    return { list, moved };
  }
  // Удочка ли это: с удочкой в руке рыбачат. kind приходит и строкой из состояния комнаты — незнакомая не удочка.
  const isRod = (kind: string) => isKind(kind) && BY_KIND[kind].group === 'rod';
  // Наживка — черви: рыбачат, держа их в другой руке.
  const isBait = (kind: string) => kind === 'worms';
  // Ведро: в него идёт улов, без него не забросить. Сколько рыб в него влезает — capacity (у не-ведра 0).
  const isBucket = (kind: string) => Object.hasOwn(BUCKETS, kind);
  const capacity = (kind: string) => BUCKETS[kind as BucketKind]?.size ?? 0;
  // Рыба, вынутая из ведра: сырая или жареная. raw — сырая: её держат только в руке.
  const isFish = (kind: string) => kind === 'fish' || kind === 'fish-fried';
  const isRaw = (kind: string) => kind === 'fish';
  // Можно ли убрать вещь в рюкзак: сырую рыбу — нет, её место в ведре.
  const packable = (kind: string) => !isRaw(kind);
  // Как назвать вещь игроку: рыбу — по её виду («Плотва из ведра», «Окунь с костра»), остальное — по виду вещи.
  function title(it: { kind: ItemKind; fish?: string }): string {
    const sp = isFish(it.kind) && it.fish ? FISH.byId[it.fish] : undefined;
    return sp ? `${sp.name} ${isRaw(it.kind) ? 'из ведра' : 'с костра'}` : BY_KIND[it.kind].name;
  }
  // Что съесть из рук: жареную рыбу первой, потом сырую; side — только из этой руки. null — есть нечего.
  function meal<T extends { kind: string; left?: boolean }>(hands: readonly T[], side?: Hand): T | null {
    const food = hands.filter(h => isFish(h.kind) && (!side || sideOf(h) === side));
    return food.find(h => !isRaw(h.kind)) ?? food[0] ?? null;
  }
  // Сколько вещей один игрок может держать выложенными на земле: больше — сначала подбери что-нибудь.
  // Земля общая на всех, и всё, что на ней лежит, рассылается каждому, — пусть её не заваливают.
  const GROUND_MAX = 12;
  // Куда положить вещь у ног героя: рядом с ним, не на другую вещь (ближе GAP) и туда, где можно стоять. walk — проходимость
  // карты (World.canWalk); taken — что уже лежит на земле. Тесно везде — прямо под ноги.
  const GAP = 5;
  const AROUND = [[9, 2], [-9, 2], [0, 7], [9, 7], [-9, 7], [0, -6], [15, 3], [-15, 3], [5, 12], [-5, 12], [15, 9], [-15, 9]] as const;
  function dropSpot(hero: Point, taken: readonly Point[], walk: (x: number, y: number) => boolean): Point {
    for (const [dx, dy] of AROUND) {
      const p = { x: Math.round(hero.x + dx), y: Math.round(hero.y + dy) };
      if (walk(p.x, p.y) && taken.every(t => dist(t, p) >= GAP)) return p;
    }
    return { x: Math.round(hero.x), y: Math.round(hero.y) };
  }
  // Ближайшая вещь на земле, до которой можно дотянуться. slack — запас сервера на рывки сети.
  function nearest<T extends Point>(hero: Point, ground: Iterable<T>, slack = 0): T | null {
    let best: T | null = null;
    for (const g of ground) if (dist(hero, g) <= REACH + slack && (!best || dist(hero, g) < dist(hero, best))) best = g;
    return best;
  }
  // Руки. Вес вещи — сколько рук она занимает: лёгкая одну, тяжёлая обе. kind приходит и строкой из состояния комнаты.
  const HANDS = 2;
  const weight = (kind: string) => (isKind(kind) && BY_KIND[kind].heavy ? 2 : 1);
  // Сколько рук занято.
  const load = (hands: readonly { kind: string }[]) => hands.reduce((n, it) => n + weight(it.kind), 0);
  // В какой руке вещь.
  const sideOf = (it: { left?: boolean }): Hand => (it.left ? 'left' : 'right');
  // Свободна ли рука: в ней ничего нет, и обе не заняты тяжёлой вещью.
  const free = (hands: readonly { kind: string; left?: boolean }[], side: Hand) => !hands.some(h => weight(h.kind) > 1 || sideOf(h) === side);
  // В какую руку взять вещь kind: тяжёлую — в обе (нужны обе свободные), лёгкую — в названную, а не назвали — в правую,
  // занята она — в левую. null — свободной руки нет.
  function handFor(hands: readonly { kind: string; left?: boolean }[], kind: string, side?: Hand): Hand | null {
    if (weight(kind) > 1) return hands.length ? null : 'right';
    if (side) return free(hands, side) ? side : null;
    return free(hands, 'right') ? 'right' : free(hands, 'left') ? 'left' : null;
  }
  // Хватит ли рук взять ещё и эту вещь (side — именно в эту руку).
  const canHold = (hands: readonly { kind: string; left?: boolean }[], kind: string, side?: Hand) => handFor(hands, kind, side) !== null;
  // Что в руке side: своя вещь или тяжёлая, которую держат обеими. null — рука пуста.
  const inHand = <T extends { kind: string; left?: boolean }>(hands: readonly T[], side: Hand): T | null => hands.find(h => weight(h.kind) > 1 || sideOf(h) === side) ?? null;
  // В руках вещи лежат по порядку: правая, потом левая.
  const inOrder = (hands: Item[]) => hands.sort((a, b) => Number(!!a.left) - Number(!!b.left));
  // Вещь, которая уходит из руки в рюкзак или на землю, о руке больше не помнит.
  const unheld = ({ left: _, ...it }: Item): Item => it;

  // Лампа у героя светит, только когда она в руке (и зажжена). В рюкзаке лампа не горит; лампа на земле горит сама по себе (GroundItem.lit).
  const lampOut = (hands: readonly { kind: string }[]) => hands.some(it => it.kind === 'lamp');
  // Какую лампу сейчас зажигать и гасить: ту, что в руке ('hand'), а нет её — ближайшую на земле, до которой дотянуться
  // (её зажигает и гасит любой). null — лампы под рукой нет. slack — запас сервера на рывки сети.
  function lampNear<T extends Point & { kind: string }>(hero: Point, hands: readonly { kind: string }[], ground: Iterable<T>, slack = 0): 'hand' | T | null {
    if (lampOut(hands)) return 'hand';
    return nearest(hero, [...ground].filter(g => g.kind === 'lamp'), slack);
  }

  // Взять вещь из рюкзака в руку side. Руку не назвали — в свободную, правую первой, а заняты обе — в правую (в ней сырая
  // рыба — в левую). Что было в этой руке (или тяжёлое в обеих), уходит в рюкзак: туда, где лежало, а занято — на место
  // взятой или на первое свободное. back — они же на новых местах. Тяжёлую берут только в пустые руки — сами руки игрок не освобождает.
  // Отказ строкой: none — такой вещи нет, hands — для тяжёлой нужны обе свободные руки, full — прежние вещи некуда деть,
  // raw — в этой руке сырая рыба, а её в рюкзак не убрать.
  function take(g: Grid, items: readonly Item[], hands: readonly Item[], id: number, side?: Hand): { list: Item[]; hands: Item[]; back: Item[] } | 'none' | 'hands' | 'full' | 'raw' {
    const it = items.find(i => i.id === id); if (!it) return 'none';
    const rawIn = (h: Hand) => hands.some(o => sideOf(o) === h && !packable(o.kind));
    const heavy = weight(it.kind) > 1, to: Hand = heavy ? 'right' : side ?? handFor(hands, it.kind) ?? (rawIn('right') ? 'left' : 'right');
    if (heavy && hands.length) return 'hands';
    const out = hands.filter(h => weight(h.kind) > 1 || sideOf(h) === to), keep = hands.filter(h => !out.includes(h));
    if (out.some(o => !packable(o.kind))) return 'raw';
    const list = items.filter(i => i !== it), back: Item[] = [];
    for (const o of out) {
      const at = [{ x: o.x, y: o.y, rot: o.rot }, { x: it.x, y: it.y, rot: o.rot }].find(p => fits(g, list, o.kind, p.x, p.y, p.rot)) || spot(g, list, o.kind);
      if (!at) return 'full';
      const b = { ...unheld(o), ...at };
      list.push(b); back.push(b);
    }
    return { list, hands: inOrder([...keep, { ...it, left: to === 'left' }]), back };
  }
  // Убрать вещь id из рук в рюкзак: в названную клетку (at) или, если её не назвали, туда, где лежала, а занято — на первое
  // свободное место. item — она же на новом месте. null — такой вещи в руках нет, она не встаёт или в рюкзак её не убрать (сырая рыба).
  function stow(g: Grid, items: readonly Item[], hands: readonly Item[], id: number, at: Place | null = null): { list: Item[]; hands: Item[]; item: Item } | null {
    const it = hands.find(h => h.id === id); if (!it || !packable(it.kind)) return null;
    let p: Place | null;
    if (at) p = fits(g, items, it.kind, at.x, at.y, at.rot && turns(it.kind)) ? { x: at.x, y: at.y, rot: at.rot && turns(it.kind) } : null;
    else p = fits(g, items, it.kind, it.x, it.y, it.rot) ? { x: it.x, y: it.y, rot: it.rot } : spot(g, items, it.kind);
    if (!p) return null;
    const item = { ...unheld(it), ...p };
    return { list: [...items, item], hands: hands.filter(h => h !== it), item };
  }
  // Сколько клеток занято.
  const used = (items: readonly Item[]) => items.reduce((n, it) => n + cells(it.kind), 0);

  return { STARTER, isKind, info, size, cells, grid, turns, fits, spot, repack, settle, used, isRod, isBait, isBucket, capacity, isFish, isRaw, packable, title, meal, GROUND_MAX, dropSpot, nearest, HANDS, weight, load, sideOf, free, handFor, canHold, inHand, inOrder, unheld, lampOut, lampNear, take, stow };
})();
