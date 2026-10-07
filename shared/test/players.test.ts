import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanWorld } from '../src/server/players.ts';
import { startPack, startState, type WorldState } from '../src/rules.ts';
import { World } from '../src/world.ts';

const SHIFT = World.pic.x, DROP = World.pic.y;   // на столько картинка сдвинута вправо и вниз на нынешней карте

test('запись времён, когда карта была одной картинкой, переносится на большую карту', () => {
  // рыбак сидит на причале, ведро стоит на настиле, рюкзак лежит во дворе — всё в координатах картинки, без picX и picY
  const old = { x: 70, y: 254, dir: 'down', sitting: true, bucket: { x: 96, y: 241, carried: false, home: false }, pack: { x: 110, y: 243, worn: false, kind: 'sailor' } } as unknown as WorldState;
  const now = cleanWorld(old)!;
  assert.equal(now.picX, SHIFT);
  assert.equal(now.picY, DROP);
  assert.deepEqual([now.x, now.y], [World.seat.x, World.seat.y]);
  assert.deepEqual(now.bucket, { x: 96 + SHIFT, y: 241 + DROP, carried: false, home: false });
  assert.deepEqual(now.pack, { x: 110 + SHIFT, y: 243 + DROP, worn: false, kind: 'sailor' });
});

test('запись широкой карты без picY опускается вместе с картинкой', () => {
  const old = { ...startState(), x: 70 + SHIFT, y: 254, bucket: { x: 96 + SHIFT, y: 241, carried: false, home: false }, picX: SHIFT } as Partial<WorldState>;
  delete old.picY;
  const now = cleanWorld(old as WorldState)!;
  assert.deepEqual([now.x, now.y], [World.seat.x, World.seat.y]);
  assert.deepEqual(now.bucket, { x: 96 + SHIFT, y: 241 + DROP, carried: false, home: false });
});

test('запись нынешней карты остаётся как есть, сколько её ни проверяй', () => {
  const fresh = startState();
  assert.deepEqual(cleanWorld(fresh), fresh);
  const moved = { ...fresh, x: World.seat.x + 30, y: World.seat.y - 20, sitting: false, bucket: { x: World.seat.x + 26, y: World.seat.y - 13, carried: false, home: false } };
  const once = cleanWorld(moved)!;
  assert.deepEqual(once.bucket, moved.bucket);
  assert.deepEqual(cleanWorld(once), once);
});

test('в старой записи без рюкзака он ждёт у дома, а сломанная запись не принимается', () => {
  const noPack = { x: 70, y: 254, dir: 'down', sitting: true, bucket: { x: 157, y: 202, carried: false, home: true } } as unknown as WorldState;
  const now = cleanWorld(noPack)!;
  assert.deepEqual(now.pack, startPack());
  assert.deepEqual(now.bucket, { x: World.bucket.baseX, y: World.bucket.baseY, carried: false, home: true });   // ведро у дома осталось у дома
  assert.equal(cleanWorld(null), null);
  assert.equal(cleanWorld({ x: 'nope' } as unknown as WorldState), null);
});

test('герой из непроходимого места встаёт на ближайшее проходимое', () => {
  const lost = { ...startState(), x: 5, y: 5, sitting: false };   // в левом верхнем углу: там герой не помещается в кадр
  const now = cleanWorld(lost)!;
  assert.ok(World.canWalk(now.x, now.y));
});
