import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISLE, Isle, onIsle, SHORE, shoreCast, shoreToward } from '../src/island.ts';
import { World } from '../src/world.ts';
import { FISH } from '../src/fish.ts';
import { createFishing, TIME, type FishingEvent } from '../src/fishing.ts';
import { packInReach } from '../src/items.ts';
import { BOAT_AT, boatPoint, bucketNearSeat, fisherAt, gridOf, nearBoat, nearFire, nearSeat, seatOf, shoreSit, standFrom, standPoint, startPack } from '../src/rules.ts';

test('на острове от лодки можно дойти до мостков, к костру и под деревья, а в воду, в стволы и в очаг — нет', () => {
  assert.ok(Isle.canWalk(Isle.landing.x, Isle.landing.y), 'у лодки можно стоять');
  assert.ok(Isle.canWalk(Isle.seat.x, Isle.seat.y), 'на месте рыбака — тоже');
  const fire = ISLE.fire, byFire = Isle.nearestWalkable(fire.x, fire.y + fire.ry + 8)!;
  for (const to of [Isle.seat, byFire, standPoint(true)]) {
    const path = Isle.findPath(Isle.landing, to);
    assert.ok(path && path.length, `путь к ${to.x},${to.y}`);
  }
  assert.ok(nearFire(byFire, true), 'у костра острова можно сесть');
  assert.ok(!nearFire(byFire), 'а это не костёр у дома');
  assert.ok(!Isle.canWalk(fire.x, fire.y), 'в очаг не войти');
  for (const [kind, x, y] of ISLE.trees) assert.ok(!Isle.canWalk(x, y - 1), `ствол ${kind} ${x},${y}`);
  assert.ok(!Isle.canWalk(20, 20) && !Isle.canWalk(600, 340), 'вода вокруг');
  for (let i = 0; i < Isle.walk.length; i++) {
    if (!Isle.walk[i]) continue;
    const x = i % Isle.W, y = Math.floor(i / Isle.W);
    if (!onIsle(x + 0.5, y + 0.5)) assert.ok(y >= Isle.seat.y - 40, `ходить можно только по суше и мосткам: ${x},${y}`);
  }
});

test('мостки острова — как у причала: рыбак, леска и удилище стоят от места рыбака так же', () => {
  const p = World.seat, i = Isle.seat;
  for (const [a, b] of [[World.fisher, Isle.fisher], [World.line, Isle.line]] as const) {
    assert.equal(a.x - p.x, b.x - i.x); assert.equal(a.y - p.y, b.y - i.y);
  }
  assert.equal(World.rod.x - p.x, Isle.rod.x - i.x);
  assert.equal(World.rod.waterY - p.y, Isle.rod.waterY - i.y);
  assert.ok(nearSeat(i, true) && !nearSeat(i), 'место рыбака у каждого берега своё');
  assert.deepEqual(seatOf(true), Isle.seat);
  assert.ok(bucketNearSeat({ x: i.x + 26, y: i.y - 13 }, seatOf(true)), 'ведро у мостков острова — рядом с рыбаком');
});

test('лещ и сом клюют только у острова, а на острове бывает и вся прежняя рыба', () => {
  const seen = { pier: new Set<string>(), isle: new Set<string>() };
  let n = 0; const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  for (let k = 0; k < 20000; k++) { seen.pier.add(FISH.roll(rnd, 'pier').id); seen.isle.add(FISH.roll(rnd, 'isle').id); }
  assert.ok(!seen.pier.has('bream') && !seen.pier.has('catfish'), 'у причала их нет');
  for (const sp of FISH.SPECIES.filter(sp => !sp.sea)) assert.ok(seen.isle.has(sp.id), `на острове клюёт ${sp.name}`);
  const isleOnly = FISH.SPECIES.filter(sp => !sp.chance && sp.isle).map(sp => sp.id).sort();   // морские не в счёт: они только в океане
  assert.deepEqual(isleOnly, ['bream', 'catfish']);
});

test('рыбалка с мостков острова тянет рыбу по долям острова', () => {
  const caught: string[] = [];
  let k = 0; const rnd = () => [0.01, 0.99][k++ % 2]!;   // клюёт сразу последний по списку вид — сом
  const f = createFishing({ rnd, hasRod: () => true, hasBait: () => true, hasBucket: () => true, spot: () => 'isle', emit: (e: FishingEvent) => { if (e.e === 'hook') caught.push(e.fish.id); } });
  f.sit(); f.press();
  f.update(TIME.cast); f.update(TIME.waitMax);
  assert.equal(f.st.phase, 'bite');
  assert.equal(f.st.fish?.id, 'catfish');
  f.press();
  assert.deepEqual(caught, ['catfish']);
});

test('в лодку садятся у мостков причала или у пляжа острова, из дома — нет', () => {
  assert.ok(nearBoat(BOAT_AT), 'у мостков');
  assert.ok(World.canWalk(boatPoint().x, boatPoint().y), 'приплывший встаёт на мостки');
  assert.ok(!nearBoat({ ...BOAT_AT, inside: true }), 'не из дома');
  assert.ok(nearBoat({ ...Isle.landing, isle: true }), 'у пляжа острова');
  assert.ok(!nearBoat({ ...BOAT_AT, isle: true }), 'на острове — только у его лодки');
  assert.ok(!nearBoat({ x: World.seat.x - 60, y: World.seat.y }), 'издалека не отплыть');
  assert.equal(gridOf({ isle: true }), Isle);
  assert.equal(gridOf({}), World);
});

test('с острова до рюкзака у причала не дотянуться, а надетый — при себе', () => {
  const pack = startPack();
  const atPack = { x: pack.x, y: pack.y };
  assert.ok(packInReach(atPack, pack));
  assert.ok(!packInReach({ ...atPack, isle: true }, pack), 'те же x, y, но на острове');
  assert.ok(packInReach({ ...Isle.landing, isle: true }, { ...pack, worn: true }));
});

test('на острове рыбачат и с берега: на западе лицом влево, на востоке — вправо, леска над водой', () => {
  const find = (x0: number, y0: number, dir: string) => {
    for (let r = 0; r < 30; r++) for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) {
      const c = shoreCast({ x, y }, dir); if (c && c.flip === (dir === 'right')) return c;
    }
    return null;
  };
  const west = find(170, 180, 'left'), east = find(505, 170, 'right'), south = find(250, 228, 'left');
  for (const c of [west, east, south]) {
    assert.ok(c, 'на берегу есть где сесть');
    assert.ok(Isle.canWalk(c.x, c.y), 'сидит на суше');
    assert.equal(c.tip.y - c.y, World.rod.tipY - World.seat.y, 'кончик удилища — как у мостков');
    assert.equal(Math.abs(c.tip.x - c.x), World.seat.x - World.rod.x);
    assert.equal(c.tip.x > c.x, c.flip, 'удилище — в ту сторону, куда смотрит');
    for (let y = c.y; y <= c.waterY; y++) assert.ok(!onIsle(c.tip.x + 0.5, y + 0.5), `под кончиком вода, а не суша: ${c.tip.x},${y}`);
    assert.ok(c.waterY > c.y && c.waterY - c.y <= SHORE.drop + SHORE.deep, 'поплавок недалеко');
    assert.ok(Isle.canWalk(c.pail.x, c.pail.y), 'ведро — на суше');
    assert.deepEqual(shoreCast(c, c.flip ? 'right' : 'left'), c, 'тот же ответ с тем же взглядом — у клиента и сервера');
  }
  assert.equal(shoreCast({ x: 330, y: 220 }), null, 'посреди острова — нет');
  assert.equal(shoreCast(Isle.seat), null, 'у мостков — их место рыбака');
  assert.equal(shoreCast({ x: Isle.seat.x + 20, y: Isle.seat.y }), null, 'на настиле мостков — тоже');
  assert.equal(shoreCast(Isle.landing), null, 'у лодки — нет');
  assert.equal(shoreCast({ x: 20, y: 20 }), null, 'в воде — нет');
  // смотрит не туда — садится лицом к воде
  assert.equal(shoreCast(west!, 'right')?.flip, false);
  assert.equal(shoreCast(east!, 'left')?.flip, true);
});

test('сидящий на берегу встаёт там же, ведро считается рядом с ним; клик по воде ведёт к берегу', () => {
  const c = shoreToward(140, 200, Isle.landing)!;
  assert.ok(c, 'к воде у западного мыса есть берег');
  assert.ok(Math.hypot(c.tip.x - 140, c.waterY - 200) <= 16, 'поплавок ляжет рядом с точкой');
  const w = { x: c.x, y: c.y, isle: true, sitting: true, dir: c.flip ? 'right' : 'left' };
  assert.deepEqual(shoreSit(w), c);
  assert.deepEqual(standFrom(w), { x: c.x, y: c.y }, 'встаёт, где сидел');
  assert.deepEqual(fisherAt(w), { x: c.x, y: c.y });
  assert.ok(bucketNearSeat(c.pail, fisherAt(w)), 'ведро у ног — рядом');
  assert.ok(!bucketNearSeat(Isle.seat, fisherAt(w)), 'а у мостков — уже далеко');
  assert.equal(shoreSit({ ...Isle.seat, isle: true, sitting: true, dir: 'down' }), null, 'на мостках сидят на их месте');
  assert.deepEqual(standFrom({ ...Isle.seat, isle: true, sitting: true }), standPoint(true));
  assert.equal(shoreToward(20, 20, Isle.landing), null, 'посреди реки — не достать');
});
