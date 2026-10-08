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

test('вещи двух весов: лёгкую держат одной рукой, тяжёлую — двумя, ведро занимает руку', () => {
  for (const kind of ITEM_KINDS) assert.equal(ITEMS.weight(kind), kind === 'net-cast' || kind === 'net-seine' ? 2 : 1, kind);
  assert.equal(ITEMS.weight('нет такой'), 1);
  const [rod, scoop, worms, floats] = starter() as [Item, Item, Item, Item], cast: Item = { id: 9, kind: 'net-cast', x: 0, y: 3, rot: false };
  assert.equal(ITEMS.load([]), 0);
  assert.equal(ITEMS.load([], true), 1);
  assert.equal(ITEMS.load([worms, floats]), 2);
  assert.equal(ITEMS.load([rod], true), 2);                              // удочка и ведро — по руке на каждое
  assert.equal(ITEMS.load([cast]), 2);
  assert.ok(ITEMS.canHold([], cast.kind) && ITEMS.canHold([worms], floats.kind) && ITEMS.canHold([], rod.kind, true) && ITEMS.canHold([rod], worms.kind));
  assert.ok(!ITEMS.canHold([worms], cast.kind) && !ITEMS.canHold([], cast.kind, true) && !ITEMS.canHold([rod], scoop.kind, true) && !ITEMS.canHold([worms, floats], scoop.kind));
});

test('вещи берут из рюкзака в руки: две лёгкие или одну тяжёлую, лишние уходят в рюкзак', () => {
  const g = ITEMS.grid('sailor'), seine: Item = { id: 5, kind: 'net-seine', x: 0, y: 3, rot: false };
  const list = [...starter(), seine], [rod, scoop, worms, floats] = list as [Item, Item, Item, Item];
  assert.equal(ITEMS.take(g, list, [], 99), 'none');                      // такой вещи в рюкзаке нет
  const ok = <T>(r: T | string) => { assert.ok(typeof r !== 'string', String(r)); return r as T; };
  // две лёгкие вещи — в две руки, по порядку номеров
  const a = ok(ITEMS.take(g, list, [], floats.id)), b = ok(ITEMS.take(g, a.list, a.hands, worms.id));
  assert.deepEqual(b.hands, [worms, floats]);                             // в руках вещи помнят, где лежали
  assert.deepEqual(b.back, []);
  assert.deepEqual(b.list.map(it => it.id), [rod.id, scoop.id, seine.id]);
  // третья лёгкая — вместо первой из рук: та возвращается на своё место
  const c = ok(ITEMS.take(g, b.list, b.hands, scoop.id));
  assert.deepEqual(c.hands.map(it => it.id), [scoop.id, floats.id]);
  assert.deepEqual(c.back, [worms]);
  // удочка — тоже в одну руку: с ней в руках остаётся место для второй вещи
  const r = ok(ITEMS.take(g, list, [], rod.id)), rw = ok(ITEMS.take(g, r.list, r.hands, worms.id));
  assert.deepEqual(rw.hands, [rod, worms]);
  // тяжёлый невод — в обе руки: всё, что в руках, уходит в рюкзак на свои места
  const d = ok(ITEMS.take(g, c.list, c.hands, seine.id));
  assert.deepEqual(d.hands, [seine]);
  assert.deepEqual(d.back, [scoop, floats]);
  for (const it of d.list) assert.ok(ITEMS.fits(g, d.list, it.kind, it.x, it.y, it.rot, it.id), it.kind);
  // невод в руках, берём сачок: невод возвращается на своё место
  const e = ok(ITEMS.take(g, d.list, d.hands, scoop.id));
  assert.deepEqual(e.hands, [scoop]);
  assert.deepEqual(e.back, [seine]);
  // своё место заняли — вещь из рук встаёт на место взятой
  const moved = e.list.map(it => (it.id === worms.id ? { ...it, x: scoop.x, y: scoop.y } : it));
  const h = ok(ITEMS.take(g, moved, [scoop, { ...floats, x: scoop.x, y: scoop.y }], worms.id));   // обе помнят одну клетку, она свободна только раз
  assert.equal(h.back.length, 1);
  for (const it of h.list) assert.ok(ITEMS.fits(g, h.list, it.kind, it.x, it.y, it.rot, it.id), it.kind);
  // с ведром в руке: одна лёгкая вещь (хоть удочка), вторая заменяет её; тяжёлую не взять совсем
  const w = ok(ITEMS.take(g, list, [], rod.id, true)), x = ok(ITEMS.take(g, w.list, w.hands, floats.id, true));
  assert.deepEqual(w.hands, [rod]);
  assert.deepEqual(x.hands, [floats]);
  assert.deepEqual(x.back, [rod]);
  assert.equal(ITEMS.take(g, list, [], seine.id, true), 'hands');
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
  assert.deepEqual(ITEMS.stow(g, two.list, two.hands, scoop.id)!.hands, [worms]);
  // квадратную вещь не поворачивают, даже если просят
  assert.equal(ITEMS.stow(g, [], [{ id: 5, kind: 'worms', x: 0, y: 0, rot: false }], 5, { x: 1, y: 1, rot: true })!.item.rot, false);
  const rods: Item[] = [0, 1, 2].map(y => ({ id: 10 + y, kind: 'rod-bamboo', x: 0, y, rot: false }));
  assert.equal(ITEMS.stow(g, rods, hands, scoop.id), null);              // рюкзак полон
});

test('лампа светит в руке или на земле, а из рюкзака — нет', () => {
  const lamp: Item = { id: 7, kind: 'lamp', x: 300, y: 250, rot: false }, worms = starter()[2]!;
  assert.ok(ITEMS.stands('lamp') && !ITEMS.stands('rod-willow'));
  assert.ok(!ITEMS.lampOut([], null) && !ITEMS.lampOut([worms], null));
  assert.ok(ITEMS.lampOut([lamp], null) && ITEMS.lampOut([worms, lamp], null) && ITEMS.lampOut([worms], lamp));
  // зажечь и погасить — когда лампа в руке или стоит рядом
  assert.ok(ITEMS.lampNear({ x: 0, y: 0 }, [worms, lamp], null));
  assert.ok(ITEMS.lampNear({ x: lamp.x + REACH, y: lamp.y }, [], lamp));
  assert.ok(!ITEMS.lampNear({ x: lamp.x + REACH + 3, y: lamp.y }, [], lamp));
  assert.ok(ITEMS.lampNear({ x: lamp.x + REACH + 3, y: lamp.y }, [], lamp, 4));
  assert.ok(!ITEMS.lampNear({ x: lamp.x, y: lamp.y }, [worms], null));
});

test('заглянуть в рюкзак можно, когда он на спине или рядом', () => {
  const pack = startPack();
  assert.ok(packInReach({ x: pack.x + REACH, y: pack.y }, pack));
  assert.ok(!packInReach({ x: pack.x + REACH + 3, y: pack.y }, pack));
  assert.ok(packInReach({ x: pack.x + REACH + 3, y: pack.y }, pack, 4));
  assert.ok(packInReach({ x: 0, y: 0 }, { ...pack, worn: true }));
});
