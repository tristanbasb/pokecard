import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, upsertCard, getCard, getSetting, setSetting } from '../src/db.js';
import { addToCollection } from '../src/collection.js';
import { refreshPrices, refreshCard, getPriceHistory, startDailyRefresh } from '../src/pricing.js';
import { TcgdexUnavailable } from '../src/tcgdex.js';
import { fouinar, dracaufeuEx } from './helpers.js';

const noPrices = {
  trend: null, trendHolo: null, low: null, lowHolo: null, avg30: null, avg30Holo: null, updatedAt: null,
};

function setup(...cards) {
  const db = openDb(':memory:');
  for (const card of cards) {
    upsertCard(db, card);
    addToCollection(db, { cardId: card.id, lang: card.lang, variant: 'normal', condition: 'Mint' });
  }
  return db;
}

const opts = { delayMs: 0 };

test('a success updates prices and adds history', async () => {
  const db = setup(fouinar);
  const tcgdex = { getCard: async () => ({ ...fouinar, prices: { ...fouinar.prices, trend: 1.5 } }) };
  assert.deepEqual(await refreshPrices(db, tcgdex, opts), { updated: 1, failed: 0 });
  assert.equal(getCard(db, 'swsh3-136', 'fr').prices.trend, 1.5);
  const history = getPriceHistory(db, 'swsh3-136', 'fr');
  assert.equal(history.length, 1);
  assert.equal(history[0].trend, 1.5);
  assert.equal(history[0].trendHolo, 0.23);
});

test('two runs the same day leave one history line with the latest value', async () => {
  const db = setup(fouinar);
  let trend = 1;
  const tcgdex = { getCard: async () => ({ ...fouinar, prices: { ...fouinar.prices, trend: trend++ } }) };
  await refreshPrices(db, tcgdex, opts);
  await refreshPrices(db, tcgdex, opts);
  const history = getPriceHistory(db, 'swsh3-136', 'fr');
  assert.equal(history.length, 1);
  assert.equal(history[0].trend, 2);
});

test('an outage keeps prices and continues with the next cards', async () => {
  const db = setup(fouinar, dracaufeuEx);
  const tcgdex = {
    getCard: async (id) => {
      if (id === 'swsh3-136') throw new TcgdexUnavailable('down');
      return { ...dracaufeuEx, prices: { ...dracaufeuEx.prices, trend: 9 } };
    },
  };
  assert.deepEqual(await refreshPrices(db, tcgdex, opts), { updated: 1, failed: 1 });
  assert.deepEqual(getCard(db, 'swsh3-136', 'fr'), fouinar);
  assert.equal(getCard(db, 'sv03-125', 'fr').prices.trend, 9);
});

test('a card gone from tcgdex keeps its prices and counts as failed', async () => {
  const db = setup(fouinar);
  assert.deepEqual(await refreshPrices(db, { getCard: async () => null }, opts), { updated: 0, failed: 1 });
  assert.deepEqual(getCard(db, 'swsh3-136', 'fr'), fouinar);
});

test('a response without prices keeps the old prices', async () => {
  const db = setup(fouinar);
  const tcgdex = { getCard: async () => ({ ...fouinar, prices: noPrices }) };
  assert.deepEqual(await refreshPrices(db, tcgdex, opts), { updated: 0, failed: 0 });
  assert.deepEqual(getCard(db, 'swsh3-136', 'fr').prices, fouinar.prices);
  assert.equal(getPriceHistory(db, 'swsh3-136', 'fr').length, 0);
});

test('manual cards are never requested and never fail', async () => {
  const db = setup({ ...fouinar, id: 'manual-abc', prices: noPrices });
  let calls = 0;
  const tcgdex = { getCard: async () => { calls += 1; return null; } };
  assert.deepEqual(await refreshPrices(db, tcgdex, opts), { updated: 0, failed: 0 });
  assert.equal(calls, 0);
});

test('a card only seen during a scan is not refreshed', async () => {
  const db = setup();
  upsertCard(db, fouinar);
  let calls = 0;
  await refreshPrices(db, { getCard: async () => { calls += 1; return fouinar; } }, opts);
  assert.equal(calls, 0);
});

test('refreshCard updates one card and returns it', async () => {
  const db = setup(fouinar);
  const tcgdex = { getCard: async () => ({ ...fouinar, prices: { ...fouinar.prices, trend: 2 } }) };
  const card = await refreshCard(db, tcgdex, 'swsh3-136', 'fr');
  assert.equal(card.prices.trend, 2);
});

test('refreshCard lets an outage surface and keeps prices', async () => {
  const db = setup(fouinar);
  const tcgdex = { getCard: async () => { throw new TcgdexUnavailable('down'); } };
  await assert.rejects(refreshCard(db, tcgdex, 'swsh3-136', 'fr'), TcgdexUnavailable);
  assert.deepEqual(getCard(db, 'swsh3-136', 'fr'), fouinar);
});

const tick = () => new Promise((resolve) => { setTimeout(resolve, 20); });

test('startDailyRefresh runs at start when never run, and records it', async () => {
  const db = setup(fouinar);
  let calls = 0;
  const stop = startDailyRefresh(db, { getCard: async () => { calls += 1; return fouinar; } }, { delayMs: 0 });
  await tick();
  stop();
  assert.equal(calls, 1);
  assert.ok(getSetting(db, 'lastPriceRefresh', null));
});

test('startDailyRefresh skips the start run after a recent refresh', async () => {
  const db = setup(fouinar);
  setSetting(db, 'lastPriceRefresh', new Date().toISOString());
  let calls = 0;
  const stop = startDailyRefresh(db, { getCard: async () => { calls += 1; return fouinar; } }, { delayMs: 0 });
  await tick();
  stop();
  assert.equal(calls, 0);
});
