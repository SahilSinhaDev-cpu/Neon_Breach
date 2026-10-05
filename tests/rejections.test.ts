import test from 'node:test';
import assert from 'node:assert/strict';
import { logRejection } from '../server/rejections';
test('rejection diagnostics collapse floods and omit tokens or packet contents', () => {
  const lines: string[] = [], previous = console.warn;
  console.warn = (...values) => lines.push(values.join(' '));
  try {
    for (let i = 0; i < 50; i++) logRejection('shot', 'LOG234', 'operator', 'fire cooldown', 1000 + i);
    logRejection('shot', 'LOG234', 'operator', 'fire cooldown', 2000);
    logRejection('leave', 'LOG234', 'operator', 'invalid action', 2000);
    assert.equal(lines.length, 3); assert.match(lines[0], /rejected shot.*fire cooldown/); assert.match(lines[2], /rejected leave/);
  } finally { console.warn = previous; }
});
