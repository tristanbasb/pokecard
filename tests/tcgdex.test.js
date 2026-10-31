import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTcgdex, TcgdexUnavailable } from '../src/tcgdex.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/tcgdex/${name}.json`, import.meta.url), 'utf8');

function fakeFetch(body, status = 200) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    return new Response(body, { status });
  };
  return { fetch, calls };
}

test('getCard maps a tcgdex card', async () => {
  const { fetch, calls } = fakeFetch(fixture('swsh3-136'));
  const card = await createTcgdex({ fetch }).getCard('swsh3-136', 'fr');
  assert.equal(calls[0], 'https://api.tcgdex.net/v2/fr/cards/swsh3-136');
  assert.equal(card.id, 'swsh3-136');
  assert.equal(card.lang, 'fr');
  assert.equal(card.name, 'Fouinar');
  assert.equal(card.setId, 'swsh3');
  assert.equal(card.setName, 'Ténèbres Embrasées');
  assert.equal(card.number, '136');
  assert.equal(card.printedTotal, 189);
  assert.equal(card.imageUrl, 'https://assets.tcgdex.net/fr/swsh/swsh3/136/high.webp');
  assert.equal(card.prices.trend, 0.04);
  assert.equal(card.prices.trendHolo, 0.23);
  assert.equal(card.prices.low, 0.02);
  assert.equal(card.prices.avg30, 0.06);
});

test('a card without image or pricing maps to nulls', async () => {
  const { fetch } = fakeFetch(fixture('A4-139'));
  const card = await createTcgdex({ fetch }).getCard('A4-139', 'fr');
  assert.equal(card.imageUrl, null);
  assert.deepEqual(card.prices, {
    trend: null, trendHolo: null, low: null, lowHolo: null, avg30: null, avg30Holo: null, updatedAt: null,
  });
});

test('a price of zero maps to null', async () => {
  const { fetch } = fakeFetch(fixture('sv03-125'));
  const card = await createTcgdex({ fetch }).getCard('sv03-125', 'fr');
  assert.equal(card.prices.trend, 3.76);
  assert.equal(card.prices.trendHolo, null);
});

test('a 404 returns null', async () => {
  const { fetch } = fakeFetch('{}', 404);
  assert.equal(await createTcgdex({ fetch }).getCard('nope', 'fr'), null);
});

test('a 500 throws TcgdexUnavailable', async () => {
  const { fetch } = fakeFetch('oops', 500);
  await assert.rejects(createTcgdex({ fetch }).getCard('x', 'fr'), TcgdexUnavailable);
});

test('a rejected fetch throws TcgdexUnavailable', async () => {
  const fetch = async () => { throw new TypeError('network down'); };
  await assert.rejects(createTcgdex({ fetch }).searchCards({ name: 'x', lang: 'fr' }), TcgdexUnavailable);
});

test('searchCards encodes the name and sends the number', async () => {
  const { fetch, calls } = fakeFetch('[]');
  await createTcgdex({ fetch }).searchCards({ name: 'Salamèche', number: '4', lang: 'fr' });
  const url = new URL(calls[0]);
  assert.equal(url.pathname, '/v2/fr/cards');
  assert.equal(url.searchParams.get('name'), 'Salamèche');
  assert.equal(url.searchParams.get('localId'), '4');
});

test('searchCards omits localId without a number', async () => {
  const { fetch, calls } = fakeFetch('[]');
  await createTcgdex({ fetch }).searchCards({ name: 'Fouinar', number: null, lang: 'fr' });
  assert.equal(new URL(calls[0]).searchParams.has('localId'), false);
});

test('searchCards removes TCG Pocket cards and builds image urls', async () => {
  const { fetch } = fakeFetch(fixture('search-fouinar'));
  const cards = await createTcgdex({ fetch }).searchCards({ name: 'Fouinar', lang: 'fr' });
  assert.ok(cards.some((c) => c.id === 'swsh3-136'));
  assert.equal(cards.some((c) => c.id === 'A4-139'), false);
  const swsh = cards.find((c) => c.id === 'swsh3-136');
  assert.deepEqual(swsh, {
    id: 'swsh3-136', localId: '136', name: 'Fouinar', imageUrl: 'https://assets.tcgdex.net/fr/swsh/swsh3/136/high.webp',
  });
});

test('Pocket filter covers every set id shape', async () => {
  const body = JSON.stringify(['A1-1', 'A1a-2', 'B2a-3', 'P-A-4', 'base1-4', 'bw1-1', 'sv03-125'].map(
    (id) => ({ id, localId: '1', name: 'x' }),
  ));
  const { fetch } = fakeFetch(body);
  const cards = await createTcgdex({ fetch }).searchCards({ name: 'x', lang: 'fr' });
  assert.deepEqual(cards.map((c) => c.id), ['base1-4', 'bw1-1', 'sv03-125']);
});
