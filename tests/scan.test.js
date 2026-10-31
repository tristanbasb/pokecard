import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { openDb, getCard, getScan } from '../src/db.js';
import { listCollection } from '../src/collection.js';
import { ScanRefused, ScanInvalid } from '../src/claude.js';
import { createScanner } from '../src/scan.js';
import { TcgdexUnavailable } from '../src/tcgdex.js';
import { fouinar, dracaufeuEx } from './helpers.js';

const identification = {
  name: 'Fouinar',
  setName: null,
  setCode: null,
  number: '136',
  printedTotal: 189,
  language: 'fr',
  variant: 'reverse',
  condition: 'Near Mint',
  defects: ['coin blanchi'],
  confidence: 'high',
};
const jpeg = Buffer.from('fake-jpeg');
const okIdentify = async () => ({
  identification,
  usage: { input_tokens: 10, output_tokens: 20 },
  raw: { id: 'msg_1' },
});
const okTcgdex = {
  searchCards: async () => [{ id: 'swsh3-136', localId: '136', name: 'Fouinar', imageUrl: null }],
  getCard: async () => fouinar,
};

function setup(overrides = {}) {
  const db = openDb(':memory:');
  const photosDir = mkdtempSync(join(tmpdir(), 'pokecard-photos-'));
  const scanner = createScanner({
    db, photosDir, identify: okIdentify, tcgdex: okTcgdex, ...overrides,
  });
  return { db, photosDir, scanner };
}

test('a successful scan stores photo, card, response and tokens', async () => {
  const { db, photosDir, scanner } = setup();
  const result = await scanner.scan(jpeg);
  assert.equal(result.status, 'done');
  assert.equal(result.card.id, 'swsh3-136');
  assert.equal(result.ambiguous, false);
  assert.equal(result.price, 0.23);
  assert.equal(result.photoUrl, `/photos/${result.scanId}.jpg`);
  assert.deepEqual(result.identification, identification);
  assert.deepEqual(readFileSync(join(photosDir, `${result.scanId}.jpg`)), jpeg);
  assert.equal(getCard(db, 'swsh3-136', 'fr').name, 'Fouinar');
  const stored = getScan(db, result.scanId);
  assert.equal(stored.status, 'done');
  assert.deepEqual(stored.response.raw, { id: 'msg_1' });
  assert.equal(stored.inputTokens, 10);
  assert.equal(stored.outputTokens, 20);
});

test('the image reaches identify as base64', async () => {
  let received;
  const { scanner } = setup({
    identify: async (image) => { received = image; return okIdentify(); },
  });
  await scanner.scan(jpeg);
  assert.equal(received, jpeg.toString('base64'));
});

test('alternatives are stored and priced so they can be chosen', async () => {
  const other = { ...dracaufeuEx, number: '136', printedTotal: 189 };
  const { db, scanner } = setup({
    tcgdex: {
      searchCards: async () => [
        { id: 'swsh3-136', localId: '136', name: 'Fouinar' },
        { id: 'sv03-125', localId: '136', name: 'Fouinar' },
      ],
      getCard: async (id) => (id === 'swsh3-136' ? fouinar : other),
    },
  });
  const result = await scanner.scan(jpeg);
  assert.equal(result.ambiguous, true);
  assert.equal(result.alternatives[0].id, 'sv03-125');
  assert.equal(result.alternatives[0].price, 3.76);
  assert.ok(getCard(db, 'sv03-125', 'fr'));
});

for (const [label, error] of [
  ['connection', new Anthropic.APIConnectionError({ message: 'down' })],
  ['rate limit', new Anthropic.RateLimitError(429, {}, 'slow', new Headers())],
  ['server error', new Anthropic.InternalServerError(500, {}, 'boom', new Headers())],
  ['bad key', new Anthropic.AuthenticationError(401, {}, 'key', new Headers())],
]) {
  test(`a ${label} error leaves the scan pending with its photo`, async () => {
    const { db, photosDir, scanner } = setup({ identify: async () => { throw error; } });
    const result = await scanner.scan(jpeg);
    assert.equal(result.status, 'pending');
    assert.ok(result.message);
    assert.equal(getScan(db, result.scanId).status, 'pending');
    assert.ok(existsSync(join(photosDir, `${result.scanId}.jpg`)));
  });
}

for (const [label, error] of [['refusal', new ScanRefused('no')], ['invalid', new ScanInvalid('bad')]]) {
  test(`a ${label} fails the scan and writes nothing to the collection`, async () => {
    const { db, scanner } = setup({ identify: async () => { throw error; } });
    const result = await scanner.scan(jpeg);
    assert.equal(result.status, 'failed');
    assert.ok(result.message);
    assert.equal(listCollection(db).rows.length, 0);
  });
}

test('a tcgdex outage stays pending and retry does not call Claude again', async () => {
  let identifyCalls = 0;
  let down = true;
  const { scanner } = setup({
    identify: async () => { identifyCalls += 1; return okIdentify(); },
    tcgdex: {
      searchCards: async (query) => {
        if (down) throw new TcgdexUnavailable('down');
        return okTcgdex.searchCards(query);
      },
      getCard: okTcgdex.getCard,
    },
  });
  const first = await scanner.scan(jpeg);
  assert.equal(first.status, 'pending');
  assert.deepEqual(first.identification, identification);
  down = false;
  const second = await scanner.retry(first.scanId);
  assert.equal(second.status, 'done');
  assert.equal(second.card.id, 'swsh3-136');
  assert.equal(identifyCalls, 1);
});

test('retry after a Claude outage calls identify with the stored photo', async () => {
  const images = [];
  let down = true;
  const { scanner } = setup({
    identify: async (image) => {
      images.push(image);
      if (down) throw new Anthropic.APIConnectionError({ message: 'down' });
      return okIdentify();
    },
  });
  const first = await scanner.scan(jpeg);
  down = false;
  const second = await scanner.retry(first.scanId);
  assert.equal(second.status, 'done');
  assert.deepEqual(images, [jpeg.toString('base64'), jpeg.toString('base64')]);
});

test('retry of an unknown scan returns null', async () => {
  assert.equal(await setup().scanner.retry(999), null);
});

test('a card not found is done, without card, with a message', async () => {
  const { scanner } = setup({ tcgdex: { searchCards: async () => [], getCard: async () => null } });
  const result = await scanner.scan(jpeg);
  assert.equal(result.status, 'done');
  assert.equal(result.card, null);
  assert.equal(result.price, null);
  assert.ok(result.message);
});

test('a photo with no readable card is done without card', async () => {
  const { scanner } = setup({
    identify: async () => ({
      identification: { ...identification, name: null, number: null, confidence: 'low' },
      usage: { input_tokens: 1, output_tokens: 1 },
      raw: {},
    }),
  });
  const result = await scanner.scan(jpeg);
  assert.equal(result.card, null);
  assert.ok(result.message);
});
