import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderBudget, initialPixelRatio } from '../client/render-quality';
import { FpsCounter } from '../client/fps';

test('resolution keeps a high-density display within the arena pixel budget', () => {
  assert.equal(initialPixelRatio(2, 1440, 900, false), 1.25);
  assert.equal(initialPixelRatio(3, 390, 844, true), 1);
  const large = initialPixelRatio(2, 3840, 2160, false);
  assert.equal(large, .5);
  assert.ok(3840 * 2160 * large * large <= 1920 * 1080);
});

test('quality only drops for sustained slow visible frames and ignores background time', () => {
  const budget = new RenderBudget(0);
  for (let now = 0; now < 6000; now += 40) assert.equal(budget.observe(now, true), false);
  for (let now = 6000; now <= 7000; now += 40) assert.equal(budget.observe(now, true), false);
  assert.equal(budget.observe(7400, false), false);
  for (let now = 8000; now <= 9000; now += 40) assert.equal(budget.observe(now, true), false);
  let changes = 0;
  for (let now = 9040; now <= 10040; now += 40) changes += +budget.observe(now, true);
  assert.equal(changes, 1);
  const steady = new RenderBudget(0);
  for (let i = 0; i < 1200; i++) assert.equal(steady.observe(i * 1000 / 60, true), false);
});

test('FPS counter counts frames, writes infrequently, and resets after a hidden tab', () => {
  let value = '', writes = 0;
  const output = { get textContent() { return value; }, set textContent(next: string) { value = next; writes++; } };
  const counter = new FpsCounter(output as HTMLElement);
  for (let i = 0; i <= 120; i++) counter.frame(100 + i * 1000 / 60);
  assert.equal(value, '60 FPS'); assert.equal(writes, 1);
  counter.frame(5000, false); counter.frame(10000);
  for (let i = 1; i <= 20; i++) counter.frame(10000 + i * 25);
  assert.equal(value, '40 FPS'); assert.equal(writes, 2);
});
