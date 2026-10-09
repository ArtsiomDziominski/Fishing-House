import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanWorld } from '../src/server/players.ts';
import { startPack, startState, type WorldState } from '../src/rules.ts';
import { World } from '../src/world.ts';
import { INDOOR, Indoor } from '../src/indoor.ts';

const SHIFT = World.pic.x, DROP = World.pic.y;   // на столько картинка сдвинута вправо и вниз на нынешней карте

test('запись времён, когда карта была одной картинкой, переносится на большую карту', () => {
  // рыбак сидит на причале, рюкзак лежит во дворе — всё в координатах картинки, без picX и picY. Ведро в старых записях
  // ещё жило в мире — теперь оно вещь (миграция 0007), и из записи пропадает
  const old = { x: 70, y: 254, dir: 'down', sitting: true, bucket: { x: 96, y: 241, carried: false, home: false }, pack: { x: 110, y: 243, worn: false, kind: 'sailor' } } as unknown as WorldState;
  const now = cleanWorld(old)!;
  assert.equal(now.picX, SHIFT);
  assert.equal(now.picY, DROP);
  assert.deepEqual([now.x, now.y], [World.seat.x, World.seat.y]);
  assert.ok(!('bucket' in now));
  assert.deepEqual(now.pack, { x: 110 + SHIFT, y: 243 + DROP, worn: false, kind: 'sailor' });
});

test('запись широкой карты без picY опускается вместе с картинкой', () => {
  const old = { ...startState(), x: 70 + SHIFT, y: 254, pack: { x: 110 + SHIFT, y: 243, worn: false, kind: 'sailor' }, picX: SHIFT } as Partial<WorldState>;
  delete old.picY;
  const now = cleanWorld(old as WorldState)!;
  assert.deepEqual([now.x, now.y], [World.seat.x, World.seat.y]);
  assert.deepEqual(now.pack, { x: 110 + SHIFT, y: 243 + DROP, worn: false, kind: 'sailor' });
});

test('запись нынешней карты остаётся как есть, сколько её ни проверяй', () => {
  const fresh = startState();
  assert.deepEqual(cleanWorld(fresh), fresh);
  const moved = { ...fresh, x: World.seat.x + 30, y: World.seat.y - 20, sitting: false, pack: { ...fresh.pack, x: World.seat.x + 26, y: World.seat.y - 13 } };
  const once = cleanWorld(moved)!;
  assert.deepEqual(once.pack, moved.pack);
  assert.deepEqual(cleanWorld(once), once);
});

test('в старой записи без рюкзака он ждёт у дома, а сломанная запись не принимается', () => {
  const noPack = { x: 70, y: 254, dir: 'down', sitting: true, bucket: { x: 157, y: 202, carried: false, home: true } } as unknown as WorldState;
  const now = cleanWorld(noPack)!;
  assert.deepEqual(now.pack, startPack());
  assert.equal(cleanWorld(null), null);
  assert.equal(cleanWorld({ x: 'nope' } as unknown as WorldState), null);
});

test('герой из непроходимого места встаёт на ближайшее проходимое', () => {
  const lost = { ...startState(), x: 5, y: 5, sitting: false };   // в левом верхнем углу: там герой не помещается в кадр
  const now = cleanWorld(lost)!;
  assert.ok(World.canWalk(now.x, now.y));
});

test('герой в доме остаётся в доме, а с места, где теперь мебель, встаёт рядом', () => {
  const home = { ...startState(), sitting: false, inside: true, x: Indoor.door.x, y: Indoor.door.y - 20 };
  assert.deepEqual(cleanWorld(home), home);
  const inBed = cleanWorld({ ...home, x: INDOOR.blocks.bed![0] + 20, y: INDOOR.blocks.bed![1] + 30, sitting: true })!;
  assert.ok(inBed.inside && !inBed.sitting && Indoor.canWalk(inBed.x, inBed.y));
  const lay = cleanWorld({ ...home, x: Indoor.bed.x, y: Indoor.bed.y, bed: true, rest: false })!;
  assert.ok(!lay.bed && Indoor.canWalk(lay.x, lay.y), 'войдя, герой не лежит в кровати, а стоит рядом');
  const old = { ...startState() } as Partial<WorldState>;
  delete old.inside;
  assert.equal(cleanWorld(old as WorldState)!.inside, false);
});
