import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, upsertCard } from '../src/db.js';
import { addToCollection } from '../src/collection.js';
import { toCsv } from '../src/csv.js';
import { buildApp } from '../src/server.js';
import { fouinar } from './helpers.js';

const row = (over = {}) => ({
  cardId: 'swsh3-136',
  lang: 'fr',
  variant: 'reverse',
  condition: 'Near Mint',
  quantity: 2,
  note: null,
  card: fouinar,
  price: 0.23,
  ...over,
});

const lines = (csv) => csv.replace(/^﻿/, '').split('\r\n');

test('starts with a BOM and uses a French header with semicolons', () => {
  const csv = toCsv([]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(lines(csv)[0], 'Nom;Extension;Numéro;Rareté;Langue;Variante;État;Quantité;Prix de référence (€);Note');
});

test('prices use a decimal comma and accents stay intact', () => {
  const [, first] = lines(toCsv([row()]));
  assert.equal(first, 'Fouinar;Ténèbres Embrasées;136;Peu Commune;fr;reverse;Near Mint;2;0,23;');
});

test('an unknown price gives an empty cell', () => {
  const [, first] = lines(toCsv([row({ price: null })]));
  assert.equal(first.split(';')[8], '');
});

test('separators, quotes and newlines are escaped', () => {
  const csv = toCsv([row({ note: 'a;b "c"\nd' })]);
  assert.ok(csv.includes('"a;b ""c""\nd"'));
});

test('cells starting with a formula character are neutralized', () => {
  for (const start of ['=', '+', '-', '@']) {
    const [, first] = lines(toCsv([row({ note: `${start}SOMME(A1)` })]));
    assert.ok(first.endsWith(`;'${start}SOMME(A1)`), first);
  }
});

test('a dangerous card name is neutralized too', () => {
  const [, first] = lines(toCsv([row({ card: { ...fouinar, name: '=cmd' } })]));
  assert.ok(first.startsWith("'=cmd;"));
});

test('GET /api/export.csv sends an attachment', async () => {
  const db = openDb(':memory:');
  upsertCard(db, fouinar);
  addToCollection(db, { cardId: 'swsh3-136', lang: 'fr', variant: 'normal', condition: 'Mint' });
  const app = buildApp({
    db,
    scanner: {},
    tcgdex: {},
    photosDir: mkdtempSync(join(tmpdir(), 'pc-')),
    publicDir: mkdtempSync(join(tmpdir(), 'pc-')),
  });
  const res = await app.inject({ method: 'GET', url: '/api/export.csv' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/csv; charset=utf-8/);
  assert.match(res.headers['content-disposition'], /^attachment; filename="/);
  assert.ok(res.body.includes('Fouinar'));
});
