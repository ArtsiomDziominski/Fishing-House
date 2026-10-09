import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFishing, TIME, HOOK_GRACE, type FishingEvent } from '../src/fishing.ts';
import { FISH } from '../src/fish.ts';
import { addToBag, emptyBag } from '../src/protocol.ts';

// hand.rod, hand.bait — в руке ли удочка и черви: тест может убрать их посреди рыбалки
function run(bucket = true, rod = true, bait = true) {
  const events: FishingEvent[] = [], hand = { rod, bait };
  const f = createFishing({ rnd: () => 0.1, hasRod: () => hand.rod, hasBait: () => hand.bait, hasBucket: () => bucket, emit: e => events.push(e), grace: HOOK_GRACE });
  const step = (sec: number) => { for (let t = 0; t < sec; t += 0.05) f.update(0.05); };
  return { f, events, step, hand };
}

test('без удочки в руке забросить нельзя, а убрал её — рыбалка кончилась', () => {
  const { f, events, step, hand } = run(true, false);
  f.sit(); f.press();
  assert.deepEqual(events, [{ e: 'needRod' }]);
  assert.equal(f.st.phase, 'rest');
  hand.rod = true; f.press();
  assert.equal(events.at(-1)!.e, 'cast');
  step(TIME.cast + 0.2);
  assert.equal(f.st.phase, 'wait');
  hand.rod = false; step(0.05);
  assert.equal(f.st.phase, 'rest');
  assert.equal(events.at(-1)!.e, 'rest');
  step(TIME.waitMax + 1);
  assert.equal(f.st.phase, 'rest', 'без удочки само не забрасывается');
  assert.ok(!events.some(e => e.e === 'bite'));
});

test('без удочки и без ведра сначала просят удочку', () => {
  const { f, events } = run(false, false, false);
  f.sit(); f.press();
  assert.deepEqual(events, [{ e: 'needRod' }]);
});

test('без червей в руке забросить нельзя, а убрал их — рыбалка кончилась', () => {
  const { f, events, step, hand } = run(true, true, false);
  f.sit(); f.press();
  assert.deepEqual(events, [{ e: 'needBait' }]);
  assert.equal(f.st.phase, 'rest');
  hand.bait = true; f.press();
  assert.equal(events.at(-1)!.e, 'cast');
  step(TIME.cast + 0.2);
  hand.bait = false; step(0.05);
  assert.equal(f.st.phase, 'rest');
  assert.equal(events.at(-1)!.e, 'rest');
  step(TIME.waitMax + 1);
  assert.ok(!events.some(e => e.e === 'bite'), 'без червей само не забрасывается');
});

test('с удочкой, но без червей и без ведра сначала просят червей', () => {
  const { f, events } = run(false, true, false);
  f.sit(); f.press();
  assert.deepEqual(events, [{ e: 'needBait' }]);
});

test('без ведра рядом забросить нельзя', () => {
  const { f, events } = run(false);
  f.sit(); f.press();
  assert.deepEqual(events, [{ e: 'needBucket' }]);
  assert.equal(f.st.phase, 'rest');
});

test('поклёвка и подсечка: рыба выдаётся сразу при подсечке', () => {
  const { f, events, step } = run();
  f.sit(); f.press();
  step(TIME.cast + f.st.wait + 0.1);
  assert.equal(f.st.phase, 'bite');
  f.press();
  const hook = events.find(e => e.e === 'hook');
  assert.ok(hook && hook.e === 'hook' && FISH.byId[hook.fish.id]);
  assert.equal(f.st.phase, 'pull');
  step(TIME.pull + TIME.fly + TIME.pause + 0.1);
  assert.equal(events.at(-1)!.e, 'cast', 'после передышки удочка забрасывается снова');
});

test('рано дёрнул — рыба уходит, прозевал — срывается', () => {
  const { f, events, step } = run();
  f.sit(); f.press(); step(TIME.cast + 0.1); f.press();
  assert.equal(events.at(-1)!.e, 'early');
  step(TIME.scare + 0.05);
  assert.equal(f.st.phase, 'cast');
  step(TIME.cast + f.st.wait + 0.1);
  assert.equal(f.st.phase, 'bite');
  step(FISH.byId[f.st.fish!.id]!.window + HOOK_GRACE);
  assert.equal(events.at(-1)!.e, 'miss');
});

test('ведро: счёт, рекорды и три последних хвоста', () => {
  const bag = emptyBag();
  assert.deepEqual(addToBag(bag, { id: 'roach', grams: 100 }), { first: true, record: false });
  assert.deepEqual(addToBag(bag, { id: 'roach', grams: 300 }), { first: false, record: true });
  addToBag(bag, { id: 'pike', grams: 1000 }); addToBag(bag, { id: 'gold', grams: 60 });
  assert.equal(bag.total, 4); assert.equal(bag.grams, 1460); assert.equal(bag.best.roach, 300);
  assert.deepEqual(bag.recent, ['roach', 'pike', 'gold']);
});

test('червь уходит, когда рыба клюнула — поймана она или сорвалась, а рано дёрнул — червь цел', () => {
  const events: FishingEvent[] = [], jar = { n: 3 };
  const f = createFishing({ rnd: () => 0.1, hasRod: () => true, hasBait: () => true, hasWorms: () => jar.n > 0, useWorm: () => { jar.n--; }, hasBucket: () => true, emit: e => events.push(e), grace: HOOK_GRACE });
  const step = (sec: number) => { for (let t = 0; t < sec; t += 0.05) f.update(0.05); };
  f.sit(); f.press();
  step(TIME.cast + 0.2); f.press();                    // рано дёрнул
  assert.equal(events.at(-1)!.e, 'early');
  assert.equal(jar.n, 3);
  step(TIME.scare + TIME.cast + f.st.wait + 0.2);      // заброс заново и поклёвка
  assert.equal(f.st.phase, 'bite');
  assert.equal(jar.n, 2);
  f.press();
  assert.equal(events.at(-1)!.e, 'hook');
  step(TIME.pull + TIME.fly + TIME.pause + TIME.cast + f.st.wait + 0.3);
  assert.equal(f.st.phase, 'bite');
  assert.equal(jar.n, 1);
  step(3);                                             // прозевал — сорвалась: червь этой поклёвки уже ушёл, новый не тратится
  assert.ok(events.some(e => e.e === 'miss'));
  assert.equal(jar.n, 1);
});

test('банка опустела — рыбак больше не забрасывает и говорит почему', () => {
  const events: FishingEvent[] = [], jar = { n: 1 };
  const f = createFishing({ rnd: () => 0.1, hasRod: () => true, hasBait: () => true, hasWorms: () => jar.n > 0, useWorm: () => { jar.n--; }, hasBucket: () => true, emit: e => events.push(e), grace: HOOK_GRACE });
  const step = (sec: number) => { for (let t = 0; t < sec; t += 0.05) f.update(0.05); };
  f.sit(); f.press();
  step(TIME.cast + f.st.wait + 0.1); f.press();
  step(TIME.pull + TIME.fly + TIME.pause + 0.1);
  assert.equal(f.st.phase, 'rest');
  assert.equal(events.at(-1)!.e, 'noWorms');
  f.press();
  assert.equal(events.at(-1)!.e, 'noWorms', 'и забросить вручную тоже нельзя');
});

test('полное ведро: не забросить, а если наполнили, пока клевало, — рыбу некуда деть', () => {
  const events: FishingEvent[] = [], room = { n: 0 };
  const f = createFishing({ rnd: () => 0.1, hasRod: () => true, hasBait: () => true, hasBucket: () => true, hasRoom: () => room.n > 0, emit: e => events.push(e), grace: HOOK_GRACE });
  const step = (sec: number) => { for (let t = 0; t < sec; t += 0.05) f.update(0.05); };
  f.sit(); f.press();
  assert.deepEqual(events, [{ e: 'bucketFull' }], 'в полное ведро не забрасывают');
  assert.equal(f.st.phase, 'rest');
  room.n = 1; f.press();
  assert.equal(events.at(-1)!.e, 'cast');
  step(TIME.cast + f.st.wait + 0.1);
  assert.equal(f.st.phase, 'bite');
  room.n = 0; f.press();                               // пока клевало, ведро наполнил кто-то другой
  assert.equal(events.at(-1)!.e, 'bucketFull');
  assert.ok(!events.some(e => e.e === 'hook'));
  room.n = 1; step(TIME.scare + 0.1);
  assert.equal(events.at(-1)!.e, 'cast', 'место появилось — забрасывает снова');
  step(f.st.wait + TIME.cast + 0.1); f.press();
  assert.equal(events.at(-1)!.e, 'hook');
  room.n = 0; step(TIME.pull + TIME.fly + TIME.pause + 0.1);
  assert.equal(f.st.phase, 'rest');
  assert.equal(events.at(-1)!.e, 'bucketFull', 'последняя рыба заполнила ведро — дальше не забрасывает');
});
