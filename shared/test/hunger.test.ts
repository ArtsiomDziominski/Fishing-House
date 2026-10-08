import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUNGER } from '../src/hunger.ts';
import { DAY_LENGTH, NIGHT_HOURS } from '../src/daytime.ts';
import { FISH } from '../src/fish.ts';
import { World } from '../src/world.ts';
import { homePoint, startState } from '../src/rules.ts';
import { cleanWorld } from '../src/server/players.ts';

test('сытость уходит вся ровно за световой день и не ниже нуля', () => {
  const day = (NIGHT_HOURS.from - NIGHT_HOURS.to) / 24 * DAY_LENGTH;
  assert.equal(HUNGER.DAYLIGHT, day);
  assert.ok(Math.abs(HUNGER.drain(HUNGER.MAX, day / 2) - HUNGER.MAX / 2) < 1e-9);
  assert.equal(HUNGER.drain(HUNGER.MAX, day), 0);
  assert.equal(HUNGER.drain(3, day), 0);
});

test('жареная плотва насыщает наполовину, остальная жареная рыба — досыта, сырая — чуть-чуть', () => {
  assert.equal(HUNGER.eat(0, 'roach', true), 50);
  assert.equal(HUNGER.eat(70, 'roach', true), 100);
  for (const sp of FISH.SPECIES.filter(s => s.id !== HUNGER.SIMPLE)) assert.equal(HUNGER.eat(0, sp.id, true), 100, sp.id);
  for (const sp of FISH.SPECIES) assert.equal(HUNGER.eat(0, sp.id, false), HUNGER.RAW, sp.id);
  assert.ok(HUNGER.RAW < 50);
});

test('голодный ходит медленнее, сытый — как обычно', () => {
  assert.equal(HUNGER.pace(1), 1);
  assert.equal(HUNGER.pace(0), HUNGER.SLOW);
  assert.ok(HUNGER.SLOW < 1);
});

test('уснувший от голода теряет треть рыбы из ведра с округлением вниз', () => {
  assert.equal(HUNGER.lost(0), 0);
  assert.equal(HUNGER.lost(2), 0);
  assert.equal(HUNGER.lost(10), 3);
  assert.equal(HUNGER.lost(7), 2);
});

test('спать и голодать до сна — по три минуты', () => {
  assert.equal(HUNGER.STARVE, 180);
  assert.equal(HUNGER.SLEEP, 180);
});

test('проснуться можно у крыльца дома: там можно стоять, и это рядом с дверью', () => {
  const p = homePoint();
  assert.ok(World.canWalk(p.x, p.y));
  assert.ok(Math.hypot(p.x - World.door.x, p.y - World.door.y) < 6);
});

test('новый игрок сыт и не спит, а в старых записях голода нет — герой сыт', () => {
  const fresh = startState();
  assert.equal(fresh.food, HUNGER.MAX); assert.equal(fresh.starve, 0); assert.equal(fresh.sleep, 0);
  const { food: _, starve: __, sleep: ___, ...old } = fresh;
  const w = cleanWorld(old as typeof fresh)!;
  assert.equal(w.food, HUNGER.MAX); assert.equal(w.starve, 0); assert.equal(w.sleep, 0);
  const odd = cleanWorld({ ...fresh, food: 250, starve: -4, sleep: 12345 })!;
  assert.equal(odd.food, HUNGER.MAX); assert.equal(odd.starve, 0); assert.equal(odd.sleep, 12345);
});
