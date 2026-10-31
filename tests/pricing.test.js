import test from 'node:test';
import assert from 'node:assert/strict';
import { priceFor } from '../src/pricing.js';
import { fouinar, dracaufeuEx } from './helpers.js';

test('normal uses trend', () => {
  assert.equal(priceFor(fouinar, 'normal'), 0.04);
});

test('reverse uses the holo trend', () => {
  assert.equal(priceFor(fouinar, 'reverse'), 0.23);
});

test('holo uses trend, not the holo fields', () => {
  assert.equal(priceFor(dracaufeuEx, 'holo'), 3.76);
  assert.equal(priceFor({ ...fouinar, prices: { ...fouinar.prices, trend: 47, trendHolo: 82 } }, 'holo'), 47);
});

test('reverse falls back to trend when the holo trend is missing', () => {
  assert.equal(priceFor(dracaufeuEx, 'reverse'), 3.76);
});

test('a card without prices returns null', () => {
  const none = { ...fouinar, prices: { trend: null, trendHolo: null, low: null, lowHolo: null, avg30: null, avg30Holo: null, updatedAt: null } };
  assert.equal(priceFor(none, 'normal'), null);
  assert.equal(priceFor(none, 'reverse'), null);
});

test('metric selects the field', () => {
  assert.equal(priceFor(fouinar, 'normal', 'avg30'), 0.06);
  assert.equal(priceFor(fouinar, 'normal', 'low'), 0.02);
  assert.equal(priceFor(fouinar, 'reverse', 'avg30'), 0.24);
  assert.equal(priceFor(fouinar, 'reverse', 'low'), 0.08);
});
