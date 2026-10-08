import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFishing, TIME, HOOK_GRACE, type FishingEvent } from '../src/fishing.ts';
import { FISH } from '../src/fish.ts';
import { addToBag, emptyBag } from '../src/protocol.ts';

// hand.rod — в руке ли удочка: тест может убрать её посреди рыбалки
function run(bucket = true, rod = true) {
  const events: FishingEvent[] = [], hand = { rod };
  const f = createFishing({ rnd: () => 0.1, hasRod: () => hand.rod, hasBucket: () => bucket, emit: e => events.push(e), grace: HOOK_GRACE });
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
  const { f, events } = run(false, false);
  f.sit(); f.press();
  assert.deepEqual(events, [{ e: 'needRod' }]);
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
