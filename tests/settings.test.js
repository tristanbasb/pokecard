import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, upsertCard, insertScan, updateScan } from '../src/db.js';
import { addToCollection } from '../src/collection.js';
import { buildApp } from '../src/server.js';
import { fouinar } from './helpers.js';

function setup() {
  const db = openDb(':memory:');
  upsertCard(db, fouinar);
  const app = buildApp({
    db,
    scanner: {},
    tcgdex: {},
    photosDir: mkdtempSync(join(tmpdir(), 'pc-')),
    publicDir: mkdtempSync(join(tmpdir(), 'pc-')),
  });
  return { app, db };
}

test('settings default to the trend metric', async () => {
  const { app } = setup();
  const res = await app.inject({ method: 'GET', url: '/api/settings' });
  assert.deepEqual(res.json(), { priceMetric: 'trend' });
});

test('changing the metric changes collection prices', async () => {
  const { app, db } = setup();
  addToCollection(db, { cardId: 'swsh3-136', lang: 'fr', variant: 'normal', condition: 'Mint' });
  const put = await app.inject({ method: 'PUT', url: '/api/settings', payload: { priceMetric: 'avg30' } });
  assert.deepEqual(put.json(), { priceMetric: 'avg30' });
  const list = await app.inject({ method: 'GET', url: '/api/collection' });
  assert.equal(list.json().rows[0].price, 0.06);
});

test('an unknown metric gets a 400', async () => {
  const { app } = setup();
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { priceMetric: 'magie' } });
  assert.equal(res.statusCode, 400);
});

test('GET /api/scans lists only the requested status, without raw responses', async () => {
  const { app, db } = setup();
  const pending = insertScan(db, { photoPath: 'p.jpg' });
  updateScan(db, pending, { response: { identification: { name: 'Fouinar' }, raw: { secret: 1 } } });
  const done = insertScan(db, { photoPath: 'd.jpg' });
  updateScan(db, done, { status: 'done' });
  const res = await app.inject({ method: 'GET', url: '/api/scans?status=pending' });
  const scans = res.json();
  assert.equal(scans.length, 1);
  assert.equal(scans[0].id, pending);
  assert.equal(scans[0].photoUrl, '/photos/p.jpg');
  assert.equal(scans[0].name, 'Fouinar');
  assert.equal('response' in scans[0], false);
});
