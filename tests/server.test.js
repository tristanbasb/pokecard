import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, upsertCard, getCard } from '../src/db.js';
import { addToCollection } from '../src/collection.js';
import { buildApp } from '../src/server.js';
import { TcgdexUnavailable } from '../src/tcgdex.js';
import { fouinar, dracaufeuEx } from './helpers.js';

const scanResult = { scanId: 1, status: 'done', card: fouinar };

function setup(overrides = {}) {
  const db = openDb(':memory:');
  upsertCard(db, fouinar);
  const photosDir = mkdtempSync(join(tmpdir(), 'pokecard-photos-'));
  const publicDir = mkdtempSync(join(tmpdir(), 'pokecard-public-'));
  writeFileSync(join(publicDir, 'index.html'), '<h1>Pokécard</h1>');
  writeFileSync(join(photosDir, '1.jpg'), 'jpeg');
  const app = buildApp({
    db,
    photosDir,
    publicDir,
    scanner: { scan: async () => scanResult, retry: async (id) => (id === 1 ? scanResult : null) },
    tcgdex: {
      searchCards: async () => [{ id: 'swsh3-136', localId: '136', name: 'Fouinar', imageUrl: null }],
      getCard: async (id, lang) => (id === 'sv03-125' ? { ...dracaufeuEx, lang } : null),
    },
    ...overrides,
  });
  return { app, db };
}

const body = {
  cardId: 'swsh3-136', lang: 'fr', variant: 'normal', condition: 'Near Mint',
};

const postJpeg = (app, payload) => app.inject({
  method: 'POST', url: '/api/scan', headers: { 'content-type': 'image/jpeg' }, payload,
});

test('POST /api/scan returns the scan result', async () => {
  const { app } = setup();
  const res = await postJpeg(app, Buffer.from('jpeg'));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().card.id, 'swsh3-136');
});

test('POST /api/scan refuses a body over 10 MB', async () => {
  const { app } = setup();
  const res = await postJpeg(app, Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.equal(res.statusCode, 413);
});

test('POST /api/scan refuses another content type', async () => {
  const { app } = setup();
  const res = await app.inject({
    method: 'POST', url: '/api/scan', headers: { 'content-type': 'text/plain' }, payload: 'x',
  });
  assert.equal(res.statusCode, 415);
});

test('POST /api/scan refuses an empty image', async () => {
  const { app } = setup();
  const res = await postJpeg(app, Buffer.alloc(0));
  assert.equal(res.statusCode, 400);
});

test('POST /api/scan/:id/retry works and 404s on unknown scans', async () => {
  const { app } = setup();
  assert.equal((await app.inject({ method: 'POST', url: '/api/scan/1/retry' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/scan/2/retry' })).statusCode, 404);
});

test('POST /api/collection adds a row', async () => {
  const { app } = setup();
  const res = await app.inject({ method: 'POST', url: '/api/collection', payload: body });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().quantity, 1);
});

test('an invalid condition gets a 400 with a French message', async () => {
  const { app } = setup();
  const res = await app.inject({ method: 'POST', url: '/api/collection', payload: { ...body, condition: 'Parfait' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().message, 'État invalide');
});

test('a card not stored yet is fetched from tcgdex', async () => {
  const { app, db } = setup();
  const res = await app.inject({
    method: 'POST', url: '/api/collection', payload: { ...body, cardId: 'sv03-125', lang: 'en' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(getCard(db, 'sv03-125', 'en').id, 'sv03-125');
});

test('an unknown card gets a 404', async () => {
  const { app } = setup();
  const res = await app.inject({ method: 'POST', url: '/api/collection', payload: { ...body, cardId: 'nope' } });
  assert.equal(res.statusCode, 404);
});

test('an unsupported language gets a 400', async () => {
  const { app } = setup();
  const res = await app.inject({ method: 'POST', url: '/api/collection', payload: { ...body, lang: '../x' } });
  assert.equal(res.statusCode, 400);
});

test('a tcgdex outage on add gets a 503', async () => {
  const { app } = setup({
    tcgdex: { getCard: async () => { throw new TcgdexUnavailable('down'); }, searchCards: async () => [] },
  });
  const res = await app.inject({ method: 'POST', url: '/api/collection', payload: { ...body, cardId: 'sv03-125' } });
  assert.equal(res.statusCode, 503);
});

test('a manual card is created without price', async () => {
  const { app } = setup();
  const res = await app.inject({
    method: 'POST',
    url: '/api/collection',
    payload: {
      lang: 'fr', variant: 'normal', condition: 'Mint', manualCard: { name: 'Promo rare', setName: 'Promo', number: '12' },
    },
  });
  assert.equal(res.statusCode, 201);
  const row = res.json();
  assert.equal(row.price, null);
  assert.equal(row.card.name, 'Promo rare');
  assert.match(row.cardId, /^manual-/);
});

test('a manual card needs a name', async () => {
  const { app } = setup();
  const res = await app.inject({
    method: 'POST',
    url: '/api/collection',
    payload: {
      lang: 'fr', variant: 'normal', condition: 'Mint', manualCard: { name: ' ' },
    },
  });
  assert.equal(res.statusCode, 400);
});

test('the photo comes from the scan, never from the client', async () => {
  const { app, db } = setup();
  db.prepare("INSERT INTO scans (id, created_at, photo_path, status) VALUES (7, 'x', '7.jpg', 'done')").run();
  const res = await app.inject({
    method: 'POST', url: '/api/collection', payload: { ...body, scanId: 7, photoPath: '../../secret' },
  });
  assert.equal(res.json().photoPath, '7.jpg');
});

test('PATCH and DELETE 404 on unknown rows', async () => {
  const { app } = setup();
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/collection/9', payload: { quantity: 2 } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/collection/9' })).statusCode, 404);
});

test('PATCH updates and DELETE removes a row', async () => {
  const { app, db } = setup();
  const row = addToCollection(db, body);
  const patched = await app.inject({ method: 'PATCH', url: `/api/collection/${row.id}`, payload: { quantity: 3 } });
  assert.equal(patched.json().quantity, 3);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/collection/${row.id}` })).statusCode, 204);
});

test('PATCH refuses an invalid quantity', async () => {
  const { app, db } = setup();
  const row = addToCollection(db, body);
  const res = await app.inject({ method: 'PATCH', url: `/api/collection/${row.id}`, payload: { quantity: 'beaucoup' } });
  assert.equal(res.statusCode, 400);
});

test('GET /api/collection returns rows and totals', async () => {
  const { app, db } = setup();
  addToCollection(db, { ...body, quantity: 2 });
  const res = await app.inject({ method: 'GET', url: '/api/collection?sort=price&search=fouin' });
  const json = res.json();
  assert.equal(json.rows.length, 1);
  assert.equal(json.totalCards, 2);
  assert.equal(json.estimatedValue, 0.08);
});

test('GET /api/cards/search returns candidates, 503 during an outage', async () => {
  const { app } = setup();
  const ok = await app.inject({ method: 'GET', url: '/api/cards/search?name=Fouinar&lang=fr' });
  assert.equal(ok.json()[0].id, 'swsh3-136');
  const down = setup({
    tcgdex: { searchCards: async () => { throw new TcgdexUnavailable('down'); }, getCard: async () => null },
  });
  const res = await down.app.inject({ method: 'GET', url: '/api/cards/search?name=Fouinar&lang=fr' });
  assert.equal(res.statusCode, 503);
});

test('GET /api/cards/:id returns card and history, 404 when unknown', async () => {
  const { app } = setup();
  const res = await app.inject({ method: 'GET', url: '/api/cards/swsh3-136?lang=fr' });
  assert.equal(res.json().card.name, 'Fouinar');
  assert.deepEqual(res.json().history, []);
  assert.equal((await app.inject({ method: 'GET', url: '/api/cards/x?lang=fr' })).statusCode, 404);
});

test('POST /api/prices/refresh handles all cards or one card', async () => {
  const { app, db } = setup({
    tcgdex: {
      searchCards: async () => [],
      getCard: async () => ({ ...fouinar, prices: { ...fouinar.prices, trend: 5 } }),
    },
  });
  addToCollection(db, body);
  const all = await app.inject({ method: 'POST', url: '/api/prices/refresh' });
  assert.deepEqual(all.json(), { updated: 1, failed: 0 });
  const one = await app.inject({ method: 'POST', url: '/api/prices/refresh', payload: { id: 'swsh3-136', lang: 'fr' } });
  assert.equal(one.json().card.prices.trend, 5);
});

test('with a PIN, api and photos need the cookie while the page stays public', async () => {
  const { app } = setup({ pin: '1234' });
  assert.equal((await app.inject({ method: 'GET', url: '/api/collection' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/photos/1.jpg' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/' })).statusCode, 200);
});

test('a wrong PIN is refused', async () => {
  const { app } = setup({ pin: '1234' });
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '0000' } });
  assert.equal(res.statusCode, 401);
});

test('a forged cookie is refused', async () => {
  const { app } = setup({ pin: '1234' });
  const res = await app.inject({ method: 'GET', url: '/api/collection', cookies: { session: 'forged' } });
  assert.equal(res.statusCode, 401);
});

test('the right PIN sets an HttpOnly cookie that opens the api', async () => {
  const { app } = setup({ pin: '1234' });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1234' } });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies.find((c) => c.name === 'session');
  assert.equal(cookie.httpOnly, true);
  const res = await app.inject({ method: 'GET', url: '/api/collection', cookies: { session: cookie.value } });
  assert.equal(res.statusCode, 200);
  const photo = await app.inject({ method: 'GET', url: '/photos/1.jpg', cookies: { session: cookie.value } });
  assert.equal(photo.statusCode, 200);
});

test('without a PIN nothing is checked', async () => {
  const { app } = setup();
  assert.equal((await app.inject({ method: 'GET', url: '/api/collection' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/photos/1.jpg' })).statusCode, 200);
});

test('photo paths cannot escape the photos folder', async () => {
  const { app } = setup();
  const res = await app.inject({ method: 'GET', url: '/photos/..%2f..%2fpackage.json' });
  assert.notEqual(res.statusCode, 200);
});

test('percent-encoding does not get around the PIN', async () => {
  const { app, db } = setup({ pin: '1234' });
  const row = addToCollection(db, body);
  for (const [method, url] of [
    ['GET', '/%61pi/collection'],
    ['GET', '/%61pi/export.csv'],
    ['PUT', '/%61pi/settings'],
    ['POST', '/%61pi/prices/refresh'],
    ['DELETE', `/%61pi/collection/${row.id}`],
    ['GET', '/api%2Fcollection'],
  ]) {
    const res = await app.inject({ method, url, payload: method === 'PUT' ? { priceMetric: 'low' } : undefined });
    assert.ok([401, 404].includes(res.statusCode), `${method} ${url} gave ${res.statusCode}`);
  }
  assert.notEqual((await app.inject({ method: 'GET', url: '/%70hotos/1.jpg' })).statusCode, 200);
  assert.equal(db.prepare('select count(*) n from collection').get().n, 1);
});

test('login stays reachable with a query string only through the login route', async () => {
  const { app } = setup({ pin: '1234' });
  const res = await app.inject({ method: 'POST', url: '/api/login?x=1', payload: { pin: '1234' } });
  assert.equal(res.statusCode, 200);
});

test('a manual card re-sent with the same scan creates nothing new', async () => {
  const { app, db } = setup();
  db.prepare("INSERT INTO scans (id, created_at, photo_path, status) VALUES (7, 'x', '7.jpg', 'done')").run();
  const payload = {
    lang: 'fr', variant: 'normal', condition: 'Mint', scanId: 7, manualCard: { name: 'Promo rare' },
  };
  const first = await app.inject({ method: 'POST', url: '/api/collection', payload });
  const second = await app.inject({ method: 'POST', url: '/api/collection', payload });
  assert.equal(second.json().id, first.json().id);
  assert.equal(second.json().quantity, 1);
  assert.equal(db.prepare("select count(*) n from cards where id like 'manual-%'").get().n, 1);
});

test('two manual saves of the same card merge', async () => {
  const { app, db } = setup();
  const payload = {
    lang: 'fr', variant: 'normal', condition: 'Mint', manualCard: { name: 'Promo rare', number: '12' },
  };
  await app.inject({ method: 'POST', url: '/api/collection', payload });
  const second = await app.inject({ method: 'POST', url: '/api/collection', payload });
  assert.equal(second.json().quantity, 2);
  assert.equal(db.prepare('select count(*) n from collection').get().n, 1);
});
