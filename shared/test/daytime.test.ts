import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_LENGTH, LIGHTS, clockShift, clockText, dayHour, dayPart, skyAt } from '../src/daytime.ts';

const WHITE = [255, 255, 255];

test('игровые сутки идут по часам сервера и повторяются каждые DAY_LENGTH секунд', () => {
  const day = DAY_LENGTH * 1000, t0 = 1_800_000_000_000 - (1_800_000_000_000 % day);   // начало каких-то суток
  assert.equal(dayHour(t0), 0);
  assert.equal(dayHour(t0 + day / 2), 12);
  assert.equal(dayHour(t0 + day / 4), 6);
  assert.equal(dayHour(t0 + day), 0);
  assert.equal(dayHour(t0 + 7 * day + day / 24), 1);
  for (let ms = t0; ms < t0 + day; ms += 7919) { const h = dayHour(ms); assert.ok(h >= 0 && h < 24, String(h)); }
});

test('переведённые часы показывают нужный час и идут дальше с той же скоростью', () => {
  const now = 1_800_000_123_456, hourMs = DAY_LENGTH * 1000 / 24;
  for (const hour of [0, 6, 12.5, 19, 23.99]) {
    const shift = clockShift(hour, now);
    assert.ok(Math.abs(shift) < DAY_LENGTH * 1000, `час ${hour}: сдвиг не больше суток`);
    assert.ok(Math.abs(dayHour(now + shift) - hour) < 1e-6, `час ${hour}: сейчас ${dayHour(now + shift)}`);
    assert.ok(Math.abs(dayHour(now + shift + hourMs) - (hour + 1) % 24) < 1e-6, `час ${hour}: через игровой час`);
  }
  assert.ok(Math.abs(clockShift(dayHour(now), now)) < 1e-3);   // на тот же час — переводить нечего
  assert.ok(Math.abs(clockShift(30, now) - clockShift(6, now)) < 1e-3);   // 30 часов — это 6 утра
});

test('часть суток и часы', () => {
  assert.deepEqual([0, 4.9, 5, 7.9, 8, 17.9, 18, 20.9, 21, 23.9].map(h => dayPart(h).id),
    ['night', 'night', 'morning', 'morning', 'day', 'day', 'evening', 'evening', 'night', 'night']);
  assert.equal(dayPart(21).name, 'Ночь');
  assert.equal(dayPart(24).id, 'night');                 // 24 — та же полночь
  assert.equal(clockText(0), '00:00');
  assert.equal(clockText(19.67), '19:40');               // шаг — десять минут
  assert.equal(clockText(23.999), '23:50');
  assert.equal(clockText(24), '00:00');
});

test('днём кадр не затемнён и свет в доме не горит', () => {
  for (const h of [8, 10, 12, 15, 17]) {
    const sky = skyAt(h);
    assert.deepEqual(sky.tint, WHITE, `час ${h}`);
    assert.equal(sky.lights, 0, `час ${h}`);
    assert.equal(sky.dark, 0, `час ${h}`);
  }
});

test('ночью темно и свет в доме горит', () => {
  for (const h of [21, 23, 0, 2, 4]) {
    const sky = skyAt(h);
    assert.equal(sky.lights, 1, `час ${h}`);
    assert.ok(sky.dark > 0.4, `час ${h}: темнота ${sky.dark}`);
    assert.ok(sky.tint[2] > sky.tint[0], `час ${h}: ночь синяя`);
  }
  assert.deepEqual(skyAt(0), skyAt(24));
});

test('свет зажигают вечером и гасят утром — быстро, но не рывком', () => {
  assert.equal(skyAt(LIGHTS.on - 0.01).lights, 0);
  assert.ok(skyAt(LIGHTS.on + LIGHTS.fade / 2).lights > 0.4 && skyAt(LIGHTS.on + LIGHTS.fade / 2).lights < 0.6);
  assert.equal(skyAt(LIGHTS.on + LIGHTS.fade + 0.001).lights, 1);
  assert.equal(skyAt(LIGHTS.off - 0.01).lights, 1);
  assert.ok(skyAt(LIGHTS.off + LIGHTS.fade / 2).lights > 0.4 && skyAt(LIGHTS.off + LIGHTS.fade / 2).lights < 0.6);
  assert.equal(skyAt(LIGHTS.off + LIGHTS.fade + 0.001).lights, 0);
});

test('небо меняется плавно: за игровую минуту цвет сдвигается чуть-чуть', () => {
  for (let h = 0; h < 24; h += 1 / 60) {
    const a = skyAt(h), b = skyAt(h + 1 / 60);
    for (let c = 0; c < 3; c++) {
      assert.ok(a.tint[c]! >= 0 && a.tint[c]! <= 255);
      assert.ok(Math.abs(a.tint[c]! - b.tint[c]!) <= 3, `час ${h.toFixed(2)}: скачок цвета`);
    }
    assert.ok(a.dark >= 0 && a.dark < 1 && a.lights >= 0 && a.lights <= 1);
  }
});
