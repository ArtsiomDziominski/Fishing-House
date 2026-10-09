import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTER_REACH, EXIT_REACH, FRIDGE, INDOOR, Indoor } from '../src/indoor.ts';
import { HUNGER } from '../src/hunger.ts';
import { World } from '../src/world.ts';
import { homePoint, nearDoor } from '../src/rules.ts';

test('в дом входят от крыльца, а выходят от порога внутри', () => {
  const porch = homePoint();
  assert.ok(nearDoor(porch), 'у крыльца можно войти');
  assert.ok(!nearDoor({ x: World.door.x + ENTER_REACH + 5, y: World.door.y }), 'издалека — нет');
  assert.ok(Indoor.canWalk(Indoor.door.x, Indoor.door.y), 'на пороге можно стоять');
  assert.ok(Indoor.nearExit(Indoor.door));
  assert.ok(!Indoor.nearExit({ x: Indoor.door.x, y: Indoor.door.y - EXIT_REACH - 5 }));
});

test('сквозь мебель и стены в доме не пройти, а от порога дойти можно до кресел, кровати, холодильника и до любого угла', () => {
  for (const [x, y, w, h] of Object.values(INDOOR.blocks)) assert.ok(!Indoor.canWalk(x + w / 2, y + h / 2), `мебель ${x},${y}`);
  assert.ok(!Indoor.canWalk(INDOOR.room.x0 - 2, 240) && !Indoor.canWalk(INDOOR.room.x1 + 2, 240), 'боковые стены');
  assert.ok(!Indoor.canWalk(INDOOR.doorway.x0 - 10, INDOOR.room.bottom + 1), 'нижняя стена — мимо проёма');
  const spots = [...Indoor.chairs.map(c => c.stand), Indoor.bed.stand, { x: 170, y: 220 }, { x: 470, y: 290 }, { x: 300, y: 200 }];
  for (const to of spots) {
    const path = Indoor.findPath(Indoor.door, to);
    assert.ok(path && path.length, `путь к ${to.x},${to.y}`);
  }
});

test('в кресла у камина садятся стоя рядом: сидят лицом к огню, а встают туда, откуда до кресла рукой подать', () => {
  Indoor.chairs.forEach((c, i) => {
    assert.ok(Indoor.canWalk(c.stand.x, c.stand.y), `у кресла ${i} можно стоять`);
    assert.equal(Indoor.chairNear(c.stand), i, `от места у кресла ${i} садятся в него`);
    assert.equal(Indoor.inChair(c), i, 'сидящий — в точке кресла');
    assert.ok(!Indoor.canWalk(c.x, c.y), 'кресло — мебель');
    assert.equal(c.dir, c.x < INDOOR.fire.x ? 'right' : 'left', 'смотрит на огонь');
  });
  assert.equal(Indoor.chairNear(Indoor.door), -1, 'от порога — ни в одно');
  assert.equal(Indoor.chairNear(Indoor.bed.stand), -1, 'от кровати — тоже');
});

test('лечь в кровать и открыть холодильник можно только стоя у них', () => {
  assert.ok(Indoor.nearBed(Indoor.bed.stand) && Indoor.inBed(Indoor.bed));
  assert.ok(!Indoor.nearBed(Indoor.door) && !Indoor.nearBed(Indoor.chairs[0]!.stand));
  assert.ok(Indoor.canWalk(Indoor.fridge.x, Indoor.fridge.y) && Indoor.nearFridge(Indoor.fridge), 'перед холодильником');
  assert.ok(Indoor.findPath(Indoor.door, Indoor.fridge)?.length, 'до холодильника можно дойти');
  assert.ok(!Indoor.nearFridge(Indoor.door) && !Indoor.nearFridge(Indoor.chairs[0]!.stand));
  assert.ok(FRIDGE.MAX > 0);
});

test('в кровати сытость тает медленнее', () => {
  const awake = HUNGER.drain(HUNGER.MAX, 600), asleep = HUNGER.drain(HUNGER.MAX, 600 * HUNGER.BED);
  assert.ok(asleep > awake && HUNGER.BED < 1);
});
