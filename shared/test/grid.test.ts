import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.ts';
import { INDOOR, Indoor } from '../src/indoor.ts';
import { Isle } from '../src/island.ts';
import { standPoint } from '../src/rules.ts';

test('шаг сквозь мебель и воду виден по прямой, а честный путь стен не задевает', () => {
  const [x, y, w, h] = INDOOR.blocks.table!, mid = x + w / 2;
  assert.ok(Indoor.canWalk(mid, y - 4) && Indoor.canWalk(mid, y + h + 4), 'по обе стороны стола можно стоять');
  assert.ok(Math.abs(Indoor.wall(mid, y - 4, mid, y + h + 4) - h) <= 1, 'через стол — стена во всю его глубину');
  assert.equal(Indoor.wall(mid, y - 4, mid - 20, y - 4), 0, 'вдоль стола — свободно');
  for (const [grid, from, to] of [[World, standPoint(), World.door], [Isle, Isle.landing, standPoint(true)], [Indoor, Indoor.door, Indoor.bed.stand]] as const) {
    let at = grid.nearestWalkable(from.x, from.y)!;
    for (const p of grid.findPath(at, to)!) { assert.equal(grid.wall(at.x, at.y, p.x, p.y), 0, `отрезок пути ${at.x},${at.y} → ${p.x},${p.y}`); at = p; }
  }
});

test('кто стоит в стене, выйти из неё может: откуда вышли, стеной не считается', () => {
  const chair = Indoor.chairs[0]!;
  assert.ok(!Indoor.canWalk(chair.x, chair.y), 'в кресле сидят внутри мебели');
  assert.equal(Indoor.wall(chair.x, chair.y, chair.stand.x, chair.stand.y), 0);
  assert.equal(Indoor.wall(chair.stand.x, chair.stand.y, chair.stand.x, chair.stand.y), 0, 'стоять на месте — не стена');
});
