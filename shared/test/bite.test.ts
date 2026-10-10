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
  for (const spot of ['pier', 'isle', 'sea'] as const) for (const hour of [2, 6, 12, 19]) {
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

test('морские рыбы клюют только в открытом океане, а речные там не клюют', () => {
  const sea = FISH.SPECIES.filter(sp => sp.sea > 0).map(sp => sp.id).sort();
  assert.ok(sea.length >= 6, 'в океане своя рыба');
  for (const sp of FISH.SPECIES) assert.ok(!sp.sea || (!sp.chance && !sp.isle), `${sp.name}: морская — только в океане`);
  let s = 11; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const seen = { pier: new Set<string>(), isle: new Set<string>(), sea: new Set<string>() };
  for (let k = 0; k < 20000; k++) for (const spot of ['pier', 'isle', 'sea'] as const) {
    const m = k % 3 ? at(k % 24, (['clear', 'cloudy', 'rain', 'fog'] as const)[k % 4]) : undefined;
    seen[spot].add(FISH.roll(rnd, spot, m, k % 2 === 0).id);
  }
  assert.deepEqual([...seen.sea].sort(), sea, 'в океане клюют все морские и только они');
  for (const spot of ['pier', 'isle'] as const) for (const id of sea) assert.ok(!seen[spot].has(id), `${id} не клюёт: ${spot}`);
  assert.deepEqual(FISH.here('sea').map(sp => sp.id).sort(), sea);
  assert.deepEqual(FISH.where(FISH.byId.tuna!), ['sea']);
  assert.deepEqual(FISH.where(FISH.byId.roach!), ['pier', 'isle']);
  assert.equal(FISH.roll(() => 1, 'sea').id, FISH.here('sea').at(-1)!.id, 'генератор выдал край — всё равно морская, а не плотва');
});

test('у косяка рыба крупнее: в среднем улов тяжелее, чем вдали от него', () => {
  const mean = (rich: boolean) => {
    let s = 5, g = 0; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let k = 0; k < 20000; k++) g += FISH.roll(rnd, 'sea', at(12), rich).grams;
    return g / 20000;
  };
  const far = mean(false), near = mean(true);
  assert.ok(near > far * 1.15, `у косяка ${Math.round(near)} г против ${Math.round(far)} г`);
  for (const sp of FISH.here('sea')) assert.ok(sp.weight[0] > 0 && sp.weight[1] > sp.weight[0], sp.id);
});

test('клёв в океане — только морские рыбы, темп и уровень — как у других мест', () => {
  for (const hour of [0, 3, 6, 9, 12, 15, 18, 21]) for (const weather of ['clear', 'cloudy', 'rain', 'fog'] as const) {
    const f = FISH.forecast('sea', at(hour, weather));
    assert.ok(f.pace >= 0.65 && f.pace <= 1.8, `темп ${f.pace} в ${hour} ч, ${weather}`);
    assert.ok([0, 1, 2].includes(f.level));
    assert.equal(f.fish.length, FISH.here('sea').length);
    for (const x of f.fish) { assert.ok(FISH.byId[x.id]!.sea > 0, x.id); assert.ok(Number.isFinite(x.ratio) && x.ratio > 0, x.id); }
    for (const spot of ['pier', 'isle'] as const) assert.ok(FISH.forecast(spot, at(hour, weather)).fish.every(x => !FISH.byId[x.id]!.sea), `${spot}: морских нет`);
  }
  assert.equal(FISH.pace('sea', at(12)), 1, 'ясный полдень — обычный клёв');
  assert.equal(FISH.forecast('sea', at(12)).level, 1);
  assert.equal(FISH.forecast('sea', at(12, 'rain')).level, 2, 'дождь — хороший');
  assert.equal(FISH.forecast('sea', at(6)).fish[0]!.id, 'tuna', 'на рассвете охотнее всех — тунец');
  assert.equal(FISH.forecast('sea', at(2)).fish[0]!.id, 'squid', 'ночью — кальмар');
});

test('кальмар клюёт ночью куда чаще, чем в полдень', () => {
  const night = caught('sea', at(2), 'squid'), noon = caught('sea', at(12), 'squid');
  assert.ok(night > 0.15, `ночью кальмар — заметная доля поклёвок (${night})`);
  assert.ok(noon < 0.02, `в полдень он почти не берёт (${noon})`);
});
