import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCRAPS } from '../src/scraps.ts';

test('рыба на земле лежит не дольше минуты: тает в конце или раньше за ней приходит чайка или кот', () => {
  const fates = Array.from({ length: 2000 }, (_, i) => SCRAPS.fate(i + 1));
  for (const f of fates) {
    assert.ok(SCRAPS.isEnd(f.by));
    assert.ok(f.at + SCRAPS.TAKE[f.by] <= SCRAPS.LIFE, `${f.by} через ${f.at} с`);
    if (f.by === 'fade') assert.equal(f.at, SCRAPS.LIFE - SCRAPS.FADE);
    else assert.ok(f.at >= SCRAPS.SOON && f.at <= SCRAPS.LATE);
  }
  // примерно половину уносят звери, и чайки и коты приходят
  const share = (by: string) => fates.filter(f => f.by === by).length / fates.length;
  assert.ok(Math.abs(share('fade') - (1 - SCRAPS.ANIMAL)) < 0.05);
  assert.ok(share('gull') > 0.15 && share('cat') > 0.15);
  assert.deepEqual(SCRAPS.fate(77), SCRAPS.fate(77));          // одна и та же рыба — одна судьба во всех копиях причала
  assert.ok(!SCRAPS.isEnd('') && !SCRAPS.isEnd('dog'));
});
