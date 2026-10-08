import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, ITEM_KINDS, packInReach, type GroundItem, type Item } from '../src/items.ts';
import { PACKS, PACK_KINDS } from '../src/packs.ts';
import { REACH, startPack } from '../src/rules.ts';

// стартовый набор в рюкзаке (без ведра — оно сразу в руке)
const starter = (): Item[] => ITEMS.STARTER.filter(it => !it.held).map(({ held: _, left: __, ...it }, i) => ({ id: i + 1, ...it }));

test('у каждой вещи имя, подпись и размер в одну, две или четыре клетки, у ведра — 16', () => {
  for (const kind of ITEM_KINDS) {
    const it = ITEMS.info(kind);
    assert.ok(it.name && it.text, kind);
    assert.ok((kind === 'bucket' ? [16] : [1, 2, 4]).includes(ITEMS.cells(kind)), `${kind}: ${ITEMS.cells(kind)} клеток`);
  }
  const groups = (g: string) => ITEM_KINDS.filter(k => ITEMS.info(k).group === g).length;
  assert.equal(groups('rod'), 5);
  assert.ok(groups('net') >= 2);
  assert.deepEqual(ITEMS.size('axe', false), { w: 2, h: 1 });
});

test('рюкзаки от кожаного к ягодному всё просторнее, и в любой влезает удочка', () => {
  let last = 0;
  for (const kind of PACK_KINDS) {
    const g = PACKS.grid(kind), n = g.w * g.h;
    assert.ok(n > last, `${kind}: ${n} клеток не больше, чем у предыдущего`);
    assert.ok(Math.max(g.w, g.h) >= 4, `${kind}: удочка 4×1 не помещается`);
    last = n;
  }
});

test('стартовый набор лежит в кожаном рюкзаке без наложений', () => {
  const g = ITEMS.grid('leather'), list = starter();
  for (const it of list) assert.ok(ITEMS.fits(g, list, it.kind, it.x, it.y, it.rot, it.id), it.kind);
  assert.equal(ITEMS.settle(g, list).moved.length, 0);
});

test('вещь не встаёт за край и на соседа, а повёрнутая меняет ширину и высоту', () => {
  const g = ITEMS.grid('leather'), list = starter();
  assert.ok(!ITEMS.fits(g, list, 'worms', 0, 0, false));                 // там удочка
  assert.ok(ITEMS.fits(g, list, 'worms', 0, 2, false));
  assert.ok(!ITEMS.fits(g, list, 'rod-gold', 1, 2, false));              // вылезает справа
  assert.ok(!ITEMS.fits(g, [], 'rod-gold', 0, 0, true));                 // стоймя в три клетки высоты не встанет
  assert.ok(ITEMS.fits(ITEMS.grid('canvas'), [], 'rod-gold', 4, 0, true));
  assert.deepEqual(ITEMS.size('net-scoop', true), { w: 1, h: 2 });
  assert.ok(!ITEMS.fits(g, list, 'worms', 0.5, 2, false));               // только целые клетки
  const rod = list[0]!;
  assert.ok(ITEMS.fits(g, list, rod.kind, 0, 2, false, rod.id));         // саму себя не задевает
});

test('свободное место ищется сверху, а если некуда — null', () => {
  const g = ITEMS.grid('leather'), list = starter();
  assert.deepEqual(ITEMS.spot(g, list, 'net-cast'), null);               // накидке 2×2 в кожаном со стартовым набором тесно
  assert.deepEqual(ITEMS.spot(g, list, 'net-scoop'), { x: 0, y: 2, rot: false });
  assert.deepEqual(ITEMS.spot(ITEMS.grid('sailor'), list, 'net-cast'), { x: 4, y: 0, rot: false });
});

test('в рюкзак поменьше вещи перекладываются, а если не влезают — null', () => {
  const big = ITEMS.grid('berry'), list: Item[] = [
    { id: 1, kind: 'net-cast', x: 4, y: 4, rot: false },
    { id: 2, kind: 'rod-gold', x: 0, y: 5, rot: false },
    { id: 3, kind: 'worms', x: 5, y: 0, rot: false },
  ];
  for (const it of list) assert.ok(ITEMS.fits(big, list, it.kind, it.x, it.y, it.rot, it.id));
  const small = ITEMS.grid('leather'), packed = ITEMS.repack(small, list)!;
  assert.ok(packed, 'накидка, удочка и черви влезают в 4×3');
  assert.equal(packed.length, 3);
  for (const it of packed) assert.ok(ITEMS.fits(small, packed, it.kind, it.x, it.y, it.rot, it.id), `${it.kind} ${it.x},${it.y}`);
  const more = [...list, { id: 4, kind: 'net-cast', x: 0, y: 0, rot: false } as Item];
  assert.equal(ITEMS.repack(small, more), null);
});

test('вещи, вылезшие за край, ищут новое место, а кому некуда — пропадают из списка, но не из базы', () => {
  const g = ITEMS.grid('leather'), list: Item[] = [
    { id: 1, kind: 'worms', x: 5, y: 5, rot: false },
    { id: 2, kind: 'net-cast', x: 0, y: 0, rot: false },
    { id: 3, kind: 'net-cast', x: 0, y: 0, rot: false },
    { id: 4, kind: 'net-cast', x: 2, y: 2, rot: false },
  ];
  const { list: shown, moved } = ITEMS.settle(g, list);
  assert.deepEqual(shown.map(it => it.id).sort(), [1, 2, 3]);
  assert.deepEqual(moved.map(it => it.id).sort(), [1, 3]);
  for (const it of shown) assert.ok(ITEMS.fits(g, shown, it.kind, it.x, it.y, it.rot, it.id));
});

test('ведро — вещь 4×4: лёгкое, у нового игрока сразу в левой руке, в кожаный рюкзак не влезает', () => {
  assert.deepEqual(ITEMS.size('bucket', false), { w: 4, h: 4 });
  assert.equal(ITEMS.weight('bucket'), 1);
  assert.ok(ITEMS.isBucket('bucket') && !ITEMS.isBucket('lamp') && !ITEMS.turns('bucket'));
  assert.deepEqual(ITEMS.STARTER.filter(it => it.held), [{ kind: 'bucket', x: 0, y: 0, rot: false, held: true, left: true }]);
  assert.equal(ITEMS.spot(ITEMS.grid('leather'), [], 'bucket'), null);
  assert.deepEqual(ITEMS.spot(ITEMS.grid('canvas'), [], 'bucket'), { x: 0, y: 0, rot: false });
  const pail: Item = { id: 3, kind: 'bucket', x: 0, y: 0, rot: false, left: false };
  assert.equal(ITEMS.handFor([pail], 'worms'), 'left');                 // ведро в правой — вторая вещь в левую
  assert.equal(ITEMS.handFor([], 'bucket', 'right'), 'right');
});

test('вещи двух весов: лёгкую держат одной рукой, тяжёлую — двумя', () => {
  for (const kind of ITEM_KINDS) assert.equal(ITEMS.weight(kind), kind === 'net-cast' || kind === 'net-seine' ? 2 : 1, kind);
  assert.equal(ITEMS.weight('нет такой'), 1);
  const [rod, scoop, worms, floats] = starter() as [Item, Item, Item, Item], cast: Item = { id: 9, kind: 'net-cast', x: 0, y: 3, rot: false };
  assert.equal(ITEMS.load([]), 0);
  assert.equal(ITEMS.load([worms, floats]), 2);
  assert.equal(ITEMS.load([cast]), 2);
  // рук две, правая и левая
  const R = (it: Item): Item => ({ ...it, left: false }), L = (it: Item): Item => ({ ...it, left: true });
  assert.ok(ITEMS.free([], 'right') && ITEMS.free([], 'left'));
  assert.ok(!ITEMS.free([R(worms)], 'right') && ITEMS.free([R(worms)], 'left') && !ITEMS.free([R(cast)], 'left'));
  assert.equal(ITEMS.handFor([], worms.kind), 'right');
  assert.equal(ITEMS.handFor([R(rod)], worms.kind), 'left');
  assert.equal(ITEMS.handFor([R(rod), L(floats)], worms.kind), null);   // обе заняты
  assert.equal(ITEMS.handFor([L(rod)], worms.kind, 'left'), null);
  assert.equal(ITEMS.handFor([L(rod)], worms.kind, 'right'), 'right');
  assert.equal(ITEMS.handFor([], cast.kind), 'right');                   // тяжёлая — в обе, числится в правой
  assert.equal(ITEMS.handFor([L(worms)], cast.kind), null);             // тяжёлую — только в обе свободные
  assert.equal(ITEMS.handFor([R(worms)], cast.kind), null);
  assert.ok(ITEMS.canHold([R(rod)], rod.kind) && !ITEMS.canHold([R(worms), L(floats)], scoop.kind) && !ITEMS.canHold([R(rod)], scoop.kind, 'right'));
  assert.equal(ITEMS.inHand([R(cast)], 'left')?.id, cast.id);            // тяжёлую держат обеими
  assert.equal(ITEMS.inHand([R(rod), L(worms)], 'left')?.id, worms.id);
  assert.equal(ITEMS.inHand([R(rod)], 'left'), null);
});

test('вещи берут из рюкзака в правую или левую руку, тяжёлую — в обе; что было в руке, уходит в рюкзак', () => {
  const g = ITEMS.grid('sailor'), seine: Item = { id: 5, kind: 'net-seine', x: 0, y: 3, rot: false };
  const list = [...starter(), seine], [rod, scoop, worms, floats] = list as [Item, Item, Item, Item];
  const R = (it: Item): Item => ({ ...it, left: false }), L = (it: Item): Item => ({ ...it, left: true });
  assert.equal(ITEMS.take(g, list, [], 99), 'none');                      // такой вещи в рюкзаке нет
  const ok = <T>(r: T | string) => { assert.ok(typeof r !== 'string', String(r)); return r as T; };
  // руку не назвали — сначала в правую, потом в левую
  const a = ok(ITEMS.take(g, list, [], floats.id)), b = ok(ITEMS.take(g, a.list, a.hands, worms.id));
  assert.deepEqual(b.hands, [R(floats), L(worms)]);                       // в руках вещи помнят, где лежали
  assert.deepEqual(b.back, []);
  assert.deepEqual(b.list.map(it => it.id), [rod.id, scoop.id, seine.id]);
  // обе заняты — третья идёт в правую, а то, что было в правой, — на своё место в рюкзаке
  const c = ok(ITEMS.take(g, b.list, b.hands, scoop.id));
  assert.deepEqual(c.hands, [R(scoop), L(worms)]);
  assert.deepEqual(c.back, [floats]);
  // названная рука: удочку — в левую, вместо червей; правая не тронута
  const cl = ok(ITEMS.take(g, c.list, c.hands, rod.id, 'left'));
  assert.deepEqual(cl.hands, [R(scoop), L(rod)]);
  assert.deepEqual(cl.back, [worms]);
  // тяжёлый невод — только в обе свободные руки: занята хоть одна — нельзя
  assert.equal(ITEMS.take(g, c.list, c.hands, seine.id), 'hands');
  assert.equal(ITEMS.take(g, list, [R(rod)], seine.id), 'hands');
  const d = ok(ITEMS.take(g, list, [], seine.id));
  assert.deepEqual(d.hands, [R(seine)]);
  assert.deepEqual(d.back, []);
  // невод в руках, берём сачок в левую: невод возвращается на своё место
  const e = ok(ITEMS.take(g, d.list, d.hands, scoop.id, 'left'));
  assert.deepEqual(e.hands, [L(scoop)]);
  assert.deepEqual(e.back, [seine]);
  // своё место заняли — вещь из рук встаёт на место взятой
  const moved = e.list.map(it => (it.id === worms.id ? { ...it, x: scoop.x, y: scoop.y } : it));
  const h = ok(ITEMS.take(g, moved, [R(scoop), L({ ...floats, x: scoop.x, y: scoop.y })], worms.id, 'left'));
  assert.equal(h.back.length, 1);
  for (const it of h.list) assert.ok(ITEMS.fits(g, h.list, it.kind, it.x, it.y, it.rot, it.id), it.kind);
  // рюкзак забит удочками, в руках накидка: взять удочку нельзя — накидку некуда деть
  const small = ITEMS.grid('leather'), rods: Item[] = [0, 1, 2].map(y => ({ id: 10 + y, kind: 'rod-bamboo', x: 0, y, rot: false }));
  assert.equal(ITEMS.take(small, rods, [{ id: 20, kind: 'net-cast', x: 0, y: 0, rot: false }], 10), 'full');
});

test('вещь из рук убирают в рюкзак: в названную клетку, на прежнее место или на первое свободное', () => {
  const g = ITEMS.grid('leather'), list = starter(), scoop = list[1]!, worms = list[2]!;
  const taken = ITEMS.take(g, list, [], scoop.id); assert.ok(typeof taken !== 'string');
  const { list: rest, hands } = taken;
  assert.equal(ITEMS.stow(g, rest, [], scoop.id), null);                 // руки пусты
  assert.equal(ITEMS.stow(g, rest, hands, worms.id), null);              // этой вещи в руках нет
  const home = ITEMS.stow(g, rest, hands, scoop.id)!;
  assert.deepEqual(home.item, scoop);                                    // место не заняли — возвращается туда же
  assert.deepEqual(home.hands, []);
  const busy = [...rest, { id: 9, kind: 'worms', x: 0, y: 1, rot: false } as Item];
  assert.deepEqual(ITEMS.stow(g, busy, hands, scoop.id)!.item, { ...scoop, x: 0, y: 2 });   // заняли — первое свободное
  const put = ITEMS.stow(g, rest, hands, scoop.id, { x: 2, y: 2, rot: false })!;
  assert.deepEqual(put.item, { ...scoop, x: 2, y: 2 });
  assert.equal(put.list.length, list.length);
  assert.equal(ITEMS.stow(g, rest, hands, scoop.id, { x: 2, y: 1, rot: false }), null);    // там черви
  assert.equal(ITEMS.stow(g, rest, hands, scoop.id, { x: 3, y: 2, rot: false }), null);    // вылезает за край
  assert.deepEqual(ITEMS.stow(g, rest, hands, scoop.id, { x: 0, y: 1, rot: true })!.item, { ...scoop, x: 0, y: 1, rot: true });
  // из двух вещей в руках убирается названная, вторая остаётся
  const two = ITEMS.take(g, rest, hands, worms.id); assert.ok(typeof two !== 'string');
  assert.deepEqual(ITEMS.stow(g, two.list, two.hands, scoop.id)!.hands, [{ ...worms, left: true }]);   // черви — в левой, там и остаются
  // квадратную вещь не поворачивают, даже если просят
  assert.equal(ITEMS.stow(g, [], [{ id: 5, kind: 'worms', x: 0, y: 0, rot: false }], 5, { x: 1, y: 1, rot: true })!.item.rot, false);
  const rods: Item[] = [0, 1, 2].map(y => ({ id: 10 + y, kind: 'rod-bamboo', x: 0, y, rot: false }));
  assert.equal(ITEMS.stow(g, rods, hands, scoop.id), null);              // рюкзак полон
});

test('лампа у героя светит только в руке, а на земле — сама по себе', () => {
  const lamp: Item = { id: 7, kind: 'lamp', x: 0, y: 0, rot: false }, worms = starter()[2]!;
  const out: GroundItem = { id: 8, kind: 'lamp', x: 300, y: 250, lit: true, fish: '' }, axe: GroundItem = { id: 9, kind: 'axe', x: 300, y: 250, lit: false, fish: '' };
  assert.ok(!ITEMS.lampOut([]) && !ITEMS.lampOut([worms]));
  assert.ok(ITEMS.lampOut([lamp]) && ITEMS.lampOut([worms, lamp]));
  // зажечь и погасить — лампу в руке, а нет её — ближайшую на земле, до которой дотянуться; топор на земле — не лампа
  assert.equal(ITEMS.lampNear({ x: 0, y: 0 }, [worms, lamp], [out]), 'hand');
  assert.equal(ITEMS.lampNear({ x: out.x + REACH, y: out.y }, [], [axe, out]), out);
  assert.equal(ITEMS.lampNear({ x: out.x + REACH + 3, y: out.y }, [], [out]), null);
  assert.equal(ITEMS.lampNear({ x: out.x + REACH + 3, y: out.y }, [], [out], 4), out);
  assert.equal(ITEMS.lampNear({ x: axe.x, y: axe.y }, [worms], [axe]), null);
});

test('с земли поднимают ближайшую вещь, до которой можно дотянуться', () => {
  const near: GroundItem = { id: 1, kind: 'axe', x: 10, y: 0, lit: false, fish: '' }, nearer: GroundItem = { id: 2, kind: 'worms', x: 4, y: 3, lit: false, fish: '' };
  const far: GroundItem = { id: 3, kind: 'lamp', x: REACH + 1, y: 0, lit: true, fish: '' };
  assert.equal(ITEMS.nearest({ x: 0, y: 0 }, [near, far, nearer]), nearer);
  assert.equal(ITEMS.nearest({ x: 0, y: 0 }, [far]), null);
  assert.equal(ITEMS.nearest({ x: 0, y: 0 }, [far], 2), far);
  assert.equal(ITEMS.nearest({ x: 0, y: 0 }, []), null);
});

test('вещь кладут у ног: туда, где можно стоять, и не на другую вещь', () => {
  const hero = { x: 100, y: 100 }, everywhere = () => true;
  const first = ITEMS.dropSpot(hero, [], everywhere);
  assert.ok(Math.hypot(first.x - hero.x, first.y - hero.y) <= REACH, 'рядом с героем');
  const second = ITEMS.dropSpot(hero, [first], everywhere);
  assert.ok(Math.hypot(second.x - first.x, second.y - first.y) >= 5, 'не на первую вещь');
  // справа вода — кладём слева
  const left = ITEMS.dropSpot(hero, [], x => x <= hero.x);
  assert.ok(left.x <= hero.x);
  // ступить некуда — прямо под ноги
  assert.deepEqual(ITEMS.dropSpot({ x: 50.4, y: 60.6 }, [], () => false), { x: 50, y: 61 });
});

test('заглянуть в рюкзак можно, когда он на спине или рядом', () => {
  const pack = startPack();
  assert.ok(packInReach({ x: pack.x + REACH, y: pack.y }, pack));
  assert.ok(!packInReach({ x: pack.x + REACH + 3, y: pack.y }, pack));
  assert.ok(packInReach({ x: pack.x + REACH + 3, y: pack.y }, pack, 4));
  assert.ok(packInReach({ x: 0, y: 0 }, { ...pack, worn: true }));
});

test('рыба из ведра — лёгкая вещь в одну клетку: сырую в рюкзак не убрать, жареную — можно', () => {
  const g = ITEMS.grid('leather');
  assert.ok(ITEMS.isFish('fish') && ITEMS.isFish('fish-fried') && !ITEMS.isFish('bucket'));
  assert.equal(ITEMS.cells('fish'), 1); assert.equal(ITEMS.weight('fish'), 1);
  const raw: Item = { id: 50, kind: 'fish', x: 0, y: 0, rot: false, left: true, fish: 'roach' };
  assert.equal(ITEMS.stow(g, [], [raw], 50), null);
  const fried: Item = { ...raw, kind: 'fish-fried' };
  const r = ITEMS.stow(g, [], [fried], 50)!;
  assert.ok(r && r.hands.length === 0 && r.item.fish === 'roach', 'жареная рыба легла в рюкзак и помнит свой вид');
});

test('рыбу зовут по её виду, а есть из рук начинают с жареной', () => {
  assert.equal(ITEMS.title({ kind: 'fish', fish: 'perch' }), 'Окунь из ведра');
  assert.equal(ITEMS.title({ kind: 'fish-fried', fish: 'pike' }), 'Щука с костра');
  assert.equal(ITEMS.title({ kind: 'axe' }), 'Топор');
  const raw: Item = { id: 1, kind: 'fish', x: 0, y: 0, rot: false, fish: 'roach' };
  const fried: Item = { id: 2, kind: 'fish-fried', x: 0, y: 0, rot: false, left: true, fish: 'pike' };
  assert.equal(ITEMS.meal([raw, fried])?.id, 2);
  assert.equal(ITEMS.meal([raw, fried], 'right')?.id, 1);
  assert.equal(ITEMS.meal([{ id: 3, kind: 'lamp', x: 0, y: 0, rot: false }]), null);
});
