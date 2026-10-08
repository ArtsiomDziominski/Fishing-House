import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, ITEM_KINDS, packInReach, type Item } from '../src/items.ts';
import { PACKS, PACK_KINDS } from '../src/packs.ts';
import { REACH, startPack } from '../src/rules.ts';

const starter = (): Item[] => ITEMS.STARTER.map((it, i) => ({ id: i + 1, ...it }));

test('у каждой вещи имя, подпись и размер в одну, две или четыре клетки', () => {
  for (const kind of ITEM_KINDS) {
    const it = ITEMS.info(kind);
    assert.ok(it.name && it.text, kind);
    assert.ok([1, 2, 4].includes(ITEMS.cells(kind)), `${kind}: ${ITEMS.cells(kind)} клеток`);
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

test('вещь берут из рюкзака в руку, а прежняя из руки уходит в рюкзак', () => {
  const g = ITEMS.grid('leather'), list = starter(), [rod, scoop, worms, floats] = list as [Item, Item, Item, Item];
  assert.equal(ITEMS.take(g, list, null, 99), null);                     // такой вещи в рюкзаке нет
  const a = ITEMS.take(g, list, null, rod.id)!;
  assert.equal(a.hand.id, rod.id); assert.equal(a.back, null);
  assert.deepEqual(a.list.map(it => it.id), [scoop.id, worms.id, floats.id]);
  assert.deepEqual(a.hand, rod);                                         // в руке вещь помнит, где лежала
  // удочка в руке, берём сачок: на его место удочка не встаёт — возвращается на своё
  const b = ITEMS.take(g, a.list, a.hand, scoop.id)!;
  assert.equal(b.hand.id, scoop.id);
  assert.deepEqual(b.back, rod);
  assert.ok(b.list.includes(b.back!) && !b.list.some(it => it.id === scoop.id));
  // черви в руке, берём поплавки: черви встают прямо на их место
  const c = ITEMS.take(g, list, null, worms.id)!, d = ITEMS.take(g, c.list, c.hand, floats.id)!;
  assert.deepEqual(d.back, { ...worms, x: floats.x, y: floats.y });
  for (const it of d.list) assert.ok(ITEMS.fits(g, d.list, it.kind, it.x, it.y, it.rot, it.id), it.kind);
  // рюкзак забит удочками, в руке накидка 2×2: взять удочку нельзя — накидку некуда деть
  const rods: Item[] = [0, 1, 2].map(y => ({ id: 10 + y, kind: 'rod-bamboo', x: 0, y, rot: false }));
  assert.equal(ITEMS.take(g, rods, { id: 20, kind: 'net-cast', x: 0, y: 0, rot: false }, 10), null);
});

test('вещь из руки убирают в рюкзак: в названную клетку, на прежнее место или на первое свободное', () => {
  const g = ITEMS.grid('leather'), list = starter(), scoop = list[1]!;
  const { list: rest, hand } = ITEMS.take(g, list, null, scoop.id)!;
  assert.equal(ITEMS.stow(g, rest, null), null);                         // рука пуста
  assert.deepEqual(ITEMS.stow(g, rest, hand)!.item, scoop);              // место не заняли — возвращается туда же
  const taken = [...rest, { id: 9, kind: 'worms', x: 0, y: 1, rot: false } as Item];
  assert.deepEqual(ITEMS.stow(g, taken, hand)!.item, { ...scoop, x: 0, y: 2 });   // заняли — первое свободное
  const put = ITEMS.stow(g, rest, hand, { x: 2, y: 2, rot: false })!;
  assert.deepEqual(put.item, { ...scoop, x: 2, y: 2 });
  assert.equal(put.list.length, list.length);
  assert.equal(ITEMS.stow(g, rest, hand, { x: 2, y: 1, rot: false }), null);       // там черви
  assert.equal(ITEMS.stow(g, rest, hand, { x: 3, y: 2, rot: false }), null);       // вылезает за край
  assert.deepEqual(ITEMS.stow(g, rest, hand, { x: 0, y: 1, rot: true })!.item, { ...scoop, x: 0, y: 1, rot: true });
  // квадратную вещь не поворачивают, даже если просят
  assert.equal(ITEMS.stow(g, [], { id: 5, kind: 'worms', x: 0, y: 0, rot: false }, { x: 1, y: 1, rot: true })!.item.rot, false);
  const rods: Item[] = [0, 1, 2].map(y => ({ id: 10 + y, kind: 'rod-bamboo', x: 0, y, rot: false }));
  assert.equal(ITEMS.stow(g, rods, hand), null);                         // рюкзак полон
});

test('лампа светит в руке или на земле, а из рюкзака — нет', () => {
  const lamp: Item = { id: 7, kind: 'lamp', x: 300, y: 250, rot: false }, rod = starter()[0]!;
  assert.ok(ITEMS.stands('lamp') && !ITEMS.stands('rod-willow'));
  assert.ok(!ITEMS.lampOut(null, null) && !ITEMS.lampOut(rod, null));
  assert.ok(ITEMS.lampOut(lamp, null) && ITEMS.lampOut(rod, lamp));
  // зажечь и погасить — когда лампа в руке или стоит рядом
  assert.ok(ITEMS.lampNear({ x: 0, y: 0 }, lamp, null));
  assert.ok(ITEMS.lampNear({ x: lamp.x + REACH, y: lamp.y }, null, lamp));
  assert.ok(!ITEMS.lampNear({ x: lamp.x + REACH + 3, y: lamp.y }, null, lamp));
  assert.ok(ITEMS.lampNear({ x: lamp.x + REACH + 3, y: lamp.y }, null, lamp, 4));
  assert.ok(!ITEMS.lampNear({ x: lamp.x, y: lamp.y }, rod, null));
});

test('заглянуть в рюкзак можно, когда он на спине или рядом', () => {
  const pack = startPack();
  assert.ok(packInReach({ x: pack.x + REACH, y: pack.y }, pack));
  assert.ok(!packInReach({ x: pack.x + REACH + 3, y: pack.y }, pack));
  assert.ok(packInReach({ x: pack.x + REACH + 3, y: pack.y }, pack, 4));
  assert.ok(packInReach({ x: 0, y: 0 }, { ...pack, worn: true }));
});
