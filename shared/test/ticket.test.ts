import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GAME_SECRET = 'test-secret-test-secret-test-secret-123';
const { issueTicket, verifyTicket } = await import('../src/server/ticket.ts');

test('билет проверяется и истекает через минуту', () => {
  const t = issueTicket('abc1234567', 'Рыбак', 1_000_000);
  assert.deepEqual(verifyTicket(t, 1_000_000), { pid: 'abc1234567', name: 'Рыбак', exp: 1060 });
  assert.equal(verifyTicket(t, 1_000_000 + 61_000), null);
});

test('подделку не принимает', () => {
  const t = issueTicket('abc1234567', 'Рыбак');
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ pid: 'zzz', name: 'x', exp: 9e9 })).toString('base64url');
  assert.equal(verifyTicket(forged + '.' + sig), null);
  assert.equal(verifyTicket(body + '.AAAA'), null);
  assert.equal(verifyTicket(42), null);
});
