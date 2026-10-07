import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACKS, PACK_KINDS } from '../src/packs.ts';
import { REACH, startState } from '../src/rules.ts';
import { World } from '../src/world.ts';

test('кожаный рюкзак остаётся таким, как на картинке', () => {
  assert.equal(PACKS.DEFAULT, 'leather');
  assert.deepEqual(PACKS.tint('leather', [177, 111, 56]), [177, 111, 56]);
});

test('у каждого вида своё имя и свои пять тонов от света к тени', () => {
  const seen = new Set<string>(), lum = (c: number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
  for (const kind of PACK_KINDS) {
    const tones = PACKS.tones(kind);
    assert.ok(PACKS.name(kind));
    assert.equal(tones.length, 5);
    for (const c of tones) assert.ok(c.length === 3 && c.every(v => Number.isInteger(v) && v >= 0 && v <= 255), `${kind}: ${c}`);
    for (let i = 1; i < 5; i++) assert.ok(lum(tones[i]!) < lum(tones[i - 1]!), `${kind}: тон ${i + 1} не темнее тона ${i}`);
    seen.add(tones.join());
  }
  assert.equal(seen.size, PACK_KINDS.length);
});

test('контур рюкзака не перекрашивается', () => {
  for (const kind of PACK_KINDS) assert.deepEqual(PACKS.tint(kind, [36, 7, 2]), [36, 7, 2]);
});

test('вид рюкзака из чужих данных проверяется', () => {
  assert.ok(PACKS.isKind('sailor'));
  assert.ok(!PACKS.isKind('golden') && !PACKS.isKind(undefined) && !PACKS.isKind(7));
});

test('новый игрок: рюкзак лежит у дома, и к нему можно подойти', () => {
  const { pack } = startState();
  assert.deepEqual(pack, { x: World.pack.baseX, y: World.pack.baseY, worn: false, kind: 'leather' });
  const near = World.nearestWalkable(pack.x, pack.y + 5);
  assert.ok(near && Math.hypot(near.x - pack.x, near.y - pack.y) <= REACH);
});
