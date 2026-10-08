import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORMS } from '../src/worms.ts';
import { ITEMS } from '../src/items.ts';
import { PACKS } from '../src/packs.ts';
import { World, seat } from '../src/index.ts';

test('в банке больше десяти червей — «хватает», меньше — числом, ни одного — «пусто»', () => {
  assert.equal(WORMS.label(30), 'хватает');
  assert.equal(WORMS.label(11), 'хватает');
  assert.equal(WORMS.label(10), '10');
  assert.equal(WORMS.label(1), '1');
  assert.equal(WORMS.label(0), 'пусто');
});

test('три лопаты копают по одному, два и пять червей, а после дождя вдвое', () => {
  assert.deepEqual(['shovel-old', 'shovel-spade', 'shovel-scoop'].map(k => WORMS.yieldOf(k, false)), [1, 2, 5]);
  assert.equal(WORMS.yieldOf('shovel-scoop', true), 10);
  assert.equal(WORMS.shovel('rod-willow'), 0);
  assert.ok(ITEMS.isKind('shovel-scoop') && ITEMS.weight('shovel-scoop') === 1, 'лопата — лёгкая вещь: банка во второй руке');
});

test('в банку больше тридцати не влезает — лишние уползают', () => {
  assert.deepEqual(WORMS.fill(10, 5), { n: 15, lost: 0 });
  assert.deepEqual(WORMS.fill(28, 5), { n: 30, lost: 3 });
  assert.deepEqual(WORMS.fill(0, 1), { n: 1, lost: 0 });
});

test('копают на траве, но не на настиле причала, не в воде и не под домом', () => {
  const grass = { x: 550, y: 255 };                   // луг справа от костра, ниже дороги
  assert.ok(WORMS.canDig(grass), 'на поляне копать можно');
  assert.ok(!WORMS.canDig(seat), 'на настиле нельзя');
  assert.ok(!WORMS.canDig({ x: 300, y: 340 }), 'в реке нельзя');
  assert.ok(!WORMS.canDig({ x: World.door.x, y: World.door.y - 10 }), 'в доме нельзя');
});

test('вскопанное место пустеет на десять минут, а рядом копать можно', () => {
  const now = 1_000_000, holes = [{ x: 330, y: 200, at: now }];
  assert.ok(WORMS.dug(holes, { x: 332, y: 201 }, now + 1000));
  assert.ok(!WORMS.dug(holes, { x: 330 + WORMS.NEAR + 1, y: 200 }, now + 1000), 'шаг в сторону — уже другое место');
  assert.ok(!WORMS.dug(holes, { x: 330, y: 200 }, now + WORMS.REST * 1000), 'через REST секунд червей там снова много');
});

test('лопата втыкается перед героем, а боком — сбоку', () => {
  const p = { x: 100, y: 100 };
  assert.ok(WORMS.spot(p, 'down').y > p.y);
  assert.ok(WORMS.spot(p, 'left').x < p.x && WORMS.spot(p, 'right').x > p.x);
});

test('в стартовом наборе есть простая лопата, и всё влезает в кожаный рюкзак', () => {
  const kit = ITEMS.STARTER.filter(it => !it.held);
  assert.ok(kit.some(it => it.kind === 'shovel-old'));
  const g = ITEMS.grid(PACKS.DEFAULT), placed: { id: number; kind: typeof kit[number]['kind']; x: number; y: number; rot: boolean }[] = [];
  kit.forEach((it, i) => { assert.ok(ITEMS.fits(g, placed, it.kind, it.x, it.y, it.rot), it.kind); placed.push({ id: i + 1, ...it }); });
});
