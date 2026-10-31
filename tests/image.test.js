import test from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin } from '../public/image.js';

test('a landscape photo shrinks to 1280 wide', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1280, height: 960 });
});

test('a portrait photo shrinks to 1280 tall', () => {
  assert.deepEqual(fitWithin(3000, 4000), { width: 960, height: 1280 });
});

test('a small photo is left alone', () => {
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});

test('dimensions stay whole numbers', () => {
  const { width, height } = fitWithin(4032, 3024);
  assert.equal(width, 1280);
  assert.equal(height, 960);
  assert.deepEqual(fitWithin(3333, 1111), { width: 1280, height: 427 });
});
