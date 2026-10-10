import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEA, Sea, boatCast, nearShoal, seaSpawn, shoalAt } from '../src/sea.ts';
import { FISH } from '../src/fish.ts';

const inBox = (p: { x: number; y: number }) => p.x >= SEA.box.x0 && p.x <= SEA.box.x1 && p.y >= SEA.box.y0 && p.y <= SEA.box.y1;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test('в океане лодка плавает только ниже горизонта, в своей полосе воды', () => {
  const b = SEA.box;
  for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y1], [(b.x0 + b.x1) >> 1, (b.y0 + b.y1) >> 1]] as const) assert.ok(Sea.canWalk(x, y), `${x}, ${y}`);
  for (const y of [0, SEA.horizon - 1, SEA.horizon, b.y0 - 1]) assert.ok(!Sea.canWalk(320, y), `выше полосы: ${y}`);
  assert.ok(!Sea.canWalk(b.x0 - 1, b.y0 + 10) && !Sea.canWalk(b.x1 + 1, b.y0 + 10) && !Sea.canWalk(320, b.y1 + 1), 'за краями кадра — нет');
  assert.ok(SEA.horizon < b.y0);
});

test('косяк всегда в океане, ходит по нему и у всех один', () => {
  const lap = SEA.SHOAL.loop[0] * SEA.SHOAL.loop[1] * 1000;
  for (let ms = 0; ms < lap; ms += 7919) { const s = shoalAt(ms); assert.ok(inBox(s), `косяк в ${ms} мс: ${s.x}, ${s.y}`); }
  for (const ms of [1.7e12, 1.76e12 + 12345, 2e12]) assert.ok(inBox(shoalAt(ms)), String(ms));
  assert.deepEqual(shoalAt(1.7e12), shoalAt(1.7e12), 'одно мгновение — одно место');
  assert.ok(dist(shoalAt(0), shoalAt(60_000)) > 10, 'за минуту косяк заметно сдвигается');
  assert.equal(shoalAt(0).r, SEA.SHOAL.r);
});

test('у середины косяка — рядом с ним, а за его краем — уже нет', () => {
  for (const ms of [0, 90_000, 1.7e12]) {
    const s = shoalAt(ms);
    assert.ok(nearShoal(s, ms), 'в середине');
    assert.ok(nearShoal({ x: s.x + s.r - 1, y: s.y }, ms), 'у края, внутри');
    assert.ok(!nearShoal({ x: s.x, y: s.y + s.r + 1 }, ms), 'за краем');
  }
});

test('в лодке, смотрящей вправо, рыбак, удилище и ведро — зеркально по точке лодки', () => {
  const p = { x: 300, y: 220 }, l = boatCast(p, 'left'), r = boatCast(p, 'right');
  assert.ok(!l.flip && r.flip);
  assert.deepEqual(boatCast(p), l, 'не сказали — смотрит влево');
  for (const k of ['seat', 'tip', 'pail'] as const) {
    assert.equal(r[k].x - p.x, -(l[k].x - p.x), `${k}: x зеркально`);
    assert.equal(r[k].y, l[k].y, `${k}: y тот же`);
  }
  assert.equal(l.waterY, r.waterY);
  assert.ok(l.tip.x < p.x && l.tip.y < l.seat.y && l.waterY > p.y, 'удилище — за кормой и над водой, поплавок — на воде');
  const odd = boatCast({ x: 300.4, y: 219.6 }, 'right');
  assert.deepEqual(odd, r, 'точку лодки округляют — у клиента и сервера одно и то же');
});

test('приплывший встаёт не ближе SEA.SPREAD к чужим лодкам, пока есть место, и всегда в океане', () => {
  const boats: { x: number; y: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const p = seaSpawn(boats);
    assert.ok(inBox(p) && Sea.canWalk(p.x, p.y), `лодка ${k} в океане`);
    for (const b of boats) assert.ok(dist(p, b) >= SEA.SPREAD, `лодка ${k} не ближе ${SEA.SPREAD} к другим`);
    boats.push(p);
  }
  assert.ok(boats[0]!.y > (SEA.box.y0 + SEA.box.y1) / 2, 'первая — ближе к низу кадра, откуда приплывают');
  const crowd: { x: number; y: number }[] = [];
  for (let y = SEA.box.y0; y <= SEA.box.y1; y += 12) for (let x = SEA.box.x0; x <= SEA.box.x1; x += 12) crowd.push({ x, y });
  const p = seaSpawn(crowd);
  assert.ok(inBox(p) && Sea.canWalk(p.x, p.y), 'в тесноте — всё равно в океане');
});

test('все рыбы, и морские тоже, влезают в значок улова 24×10, а их буквы есть в палитре', () => {
  for (const sp of FISH.SPECIES) {
    const s = FISH.sprite(sp);
    assert.ok(s.w <= 24 && s.h <= 10, `${sp.name}: ${s.w}×${s.h}`);
    for (const row of sp.map) for (const ch of row) assert.ok(ch === '.' || sp.pal[ch], `${sp.name}: буква ${ch} без цвета`);
    for (const c of sp.tail) assert.match(c, /^[0-9a-f]{6}$/, `${sp.name}: хвост`);
    assert.ok(sp.window > 0 && sp.weight[1] > sp.weight[0], sp.name);
  }
  assert.equal(new Set(FISH.SPECIES.map(sp => sp.id)).size, FISH.SPECIES.length, 'id видов не повторяются');
  assert.ok(FISH.SPECIES.every(sp => sp.id.length <= 24 && /^[a-z]+$/.test(sp.id)), 'id — короткое слово: так он ходит в сообщениях и в haul');
});
