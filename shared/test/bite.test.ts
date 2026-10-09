import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FISH, type FishSpot, type Moment } from '../src/fish.ts';
import { createFishing, TIME, type FishingEvent } from '../src/fishing.ts';

// Доля вида среди поклёвок здесь и сейчас — по тысячам бросков с одним и тем же генератором.
function caught(at: FishSpot, m: Moment | undefined, id: string, n = 20000) {
  let s = 7; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  let k = 0; for (let i = 0; i < n; i++) if (FISH.roll(rnd, at, m).id === id) k++;
  return k / n;
}
const at = (hour: number, weather: Moment['weather'] = 'clear'): Moment => ({ hour, weather });

test('сом клюёт ночью, а днём почти нет', () => {
  const night = caught('isle', at(2), 'catfish'), day = caught('isle', at(13), 'catfish');
  assert.ok(night > 0.25, `ночью сом — заметная доля поклёвок (${night})`);
  assert.ok(day < 0.02, `днём сом почти не клюёт (${day})`);
});

test('щука клюёт на рассвете и в пасмурь охотнее, чем в ясный полдень', () => {
  const dawn = caught('pier', at(6), 'pike'), noon = caught('pier', at(12), 'pike'), grey = caught('pier', at(6, 'cloudy'), 'pike');
  assert.ok(dawn > noon * 2, `на рассвете вдвое чаще (${dawn} против ${noon})`);
  assert.ok(grey > dawn, 'в пасмурный рассвет — ещё чаще');
});

test('в дождь клюёт чаще: поклёвки ждать меньше', () => {
  for (const spot of ['pier', 'isle'] as const) for (const hour of [2, 6, 12, 19]) {
    assert.ok(FISH.pace(spot, at(hour, 'rain')) > FISH.pace(spot, at(hour)), `${spot}, ${hour} ч`);
  }
  const wait = (weather: Moment['weather']) => {
    const events: FishingEvent[] = [];
    const f = createFishing({ rnd: () => 0.5, hasRod: () => true, hasBait: () => true, hasBucket: () => true, emit: e => events.push(e), moment: () => at(12, weather) });
    f.sit(); f.press();
    return f.st.wait;
  };
  assert.ok(wait('rain') < wait('clear'));
  assert.ok(wait('clear') <= TIME.waitMax && wait('rain') >= TIME.waitMin / 1.8);
});

test('ночью у причала клёв слабый, а с острова ночью ловится лучше', () => {
  assert.equal(FISH.forecast('pier', at(2)).level, 0);
  assert.ok(FISH.pace('isle', at(2)) > FISH.pace('pier', at(2)));
  assert.equal(FISH.forecast('pier', at(12)).level, 1, 'ясный полдень — обычный клёв');
  assert.equal(FISH.forecast('pier', at(12, 'rain')).level, 2, 'дождь — хороший');
});

test('без часов и погоды клюёт как прежде: по долям места и без спешки', () => {
  assert.equal(FISH.pace('pier'), 1);
  for (const sp of FISH.SPECIES) assert.equal(FISH.share(sp, 'pier'), sp.chance);
  const events: FishingEvent[] = [];
  const f = createFishing({ rnd: () => 0.5, hasRod: () => true, hasBait: () => true, hasBucket: () => true, emit: e => events.push(e) });
  f.sit(); f.press();
  assert.equal(f.st.wait, TIME.waitMin + 0.5 * (TIME.waitMax - TIME.waitMin));
});

test('в клёве для интерфейса только те, кто здесь водится, от охотных к вялым', () => {
  const pier = FISH.forecast('pier', at(2)).fish.map(f => f.id);
  assert.ok(!pier.includes('catfish') && !pier.includes('bream'), 'у причала нет леща и сома');
  const isle = FISH.forecast('isle', at(2)).fish;
  assert.equal(isle[0]!.id, 'catfish', 'ночью на острове первым — сом');
  for (let i = 1; i < isle.length; i++) assert.ok(isle[i - 1]!.ratio >= isle[i]!.ratio);
});
