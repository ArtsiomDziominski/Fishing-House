import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHERS, WEATHER_NAMES, WEATHER_SPAN, weatherAt, weatherText } from '../src/weather.ts';

const SPAN = WEATHER_SPAN * 1000, T0 = 1_800_000_000_000 - (1_800_000_000_000 % SPAN);   // начало какого-то отрезка

test('погода одна на весь отрезок времени и одинакова у всех, кто спросит', () => {
  for (let n = 0; n < 50; n++) {
    const start = T0 + n * SPAN, w = weatherAt(start);
    assert.ok(WEATHERS.includes(w.kind) && typeof w.wind === 'boolean');
    assert.deepEqual(weatherAt(start + 1), w);
    assert.deepEqual(weatherAt(start + SPAN / 2), w);
    assert.deepEqual(weatherAt(start + SPAN - 1), w);
  }
});

test('бывает всякая погода, и ветер дует в любую', () => {
  const seen = new Map<string, number>(), N = 20000;
  for (let n = 0; n < N; n++) { const w = weatherAt(T0 + n * SPAN), key = w.kind + (w.wind ? '+ветер' : ''); seen.set(key, (seen.get(key) || 0) + 1); }
  for (const kind of WEATHERS) for (const wind of ['', '+ветер']) assert.ok((seen.get(kind + wind) || 0) > N * 0.03, `редко или никогда: ${kind}${wind}`);
  const share = (kind: string) => ((seen.get(kind) || 0) + (seen.get(kind + '+ветер') || 0)) / N;
  assert.ok(Math.abs(share('clear') - 0.44) < 0.03, `ясно: ${share('clear')}`);
  assert.ok(Math.abs(share('cloudy') - 0.24) < 0.03, `пасмурно: ${share('cloudy')}`);
  assert.ok(Math.abs(share('rain') - 0.18) < 0.03, `дождь: ${share('rain')}`);
  assert.ok(Math.abs(share('fog') - 0.14) < 0.03, `туман: ${share('fog')}`);
  const windy = [...seen].filter(([k]) => k.endsWith('+ветер')).reduce((s, [, v]) => s + v, 0) / N;
  assert.ok(Math.abs(windy - 0.35) < 0.03, `ветер: ${windy}`);
});

test('погода меняется: подряд одна и та же держится недолго', () => {
  let run = 1, longest = 1, prev = weatherAt(T0).kind;
  for (let n = 1; n < 5000; n++) { const kind = weatherAt(T0 + n * SPAN).kind; run = kind === prev ? run + 1 : 1; longest = Math.max(longest, run); prev = kind; }
  assert.ok(longest < 30, `одна погода ${longest} отрезков подряд`);
});

test('погода словами', () => {
  assert.equal(weatherText({ kind: 'clear', wind: false }), 'Ясно');
  assert.equal(weatherText({ kind: 'rain', wind: true }), 'Дождь, ветер');
  assert.equal(WEATHER_NAMES.cloudy, 'Пасмурно');
  assert.equal(weatherText({ kind: 'fog', wind: false }), 'Туман');
});
