import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, upsertCard, insertScan, getScan, setSetting } from '../src/db.js';
import { addToCollection, updateRow, deleteRow, listCollection } from '../src/collection.js';
import { fouinar, dracaufeuEx } from './helpers.js';

function setup() {
  const db = openDb(':memory:');
  upsertCard(db, fouinar);
  upsertCard(db, dracaufeuEx);
  return db;
}

const base = { cardId: 'swsh3-136', lang: 'fr', variant: 'normal', condition: 'Near Mint' };

test('two identical adds merge into one row', () => {
  const db = setup();
  addToCollection(db, base);
  const row = addToCollection(db, base);
  assert.equal(row.quantity, 2);
  assert.equal(listCollection(db).rows.length, 1);
});

test('a different condition makes a second row', () => {
  const db = setup();
  addToCollection(db, base);
  addToCollection(db, { ...base, condition: 'Played' });
  assert.equal(listCollection(db).rows.length, 2);
});

test('a merge keeps the first photo', () => {
  const db = setup();
  addToCollection(db, { ...base, photoPath: 'first.jpg' });
  const row = addToCollection(db, { ...base, photoPath: 'second.jpg' });
  assert.equal(row.photoPath, 'first.jpg');
});

test('the same scanId sent twice counts once', () => {
  const db = setup();
  const scanId = insertScan(db, { photoPath: 'a.jpg' });
  const first = addToCollection(db, { ...base, scanId });
  const second = addToCollection(db, { ...base, scanId });
  assert.equal(second.id, first.id);
  assert.equal(second.quantity, 1);
  assert.equal(getScan(db, scanId).collectionId, first.id);
});

test('updateRow merges into a row already owned', () => {
  const db = setup();
  const nm = addToCollection(db, { ...base, quantity: 2 });
  const played = addToCollection(db, { ...base, condition: 'Played', quantity: 3 });
  const merged = updateRow(db, played.id, { condition: 'Near Mint' });
  assert.equal(merged.id, nm.id);
  assert.equal(merged.quantity, 5);
  assert.equal(listCollection(db).rows.length, 1);
});

test('updateRow changes note and quantity', () => {
  const db = setup();
  const row = addToCollection(db, base);
  const updated = updateRow(db, row.id, { quantity: 4, note: 'classeur 2' });
  assert.equal(updated.quantity, 4);
  assert.equal(updated.note, 'classeur 2');
});

test('updateRow returns null for an unknown row', () => {
  assert.equal(updateRow(setup(), 999, { quantity: 2 }), null);
});

test('deleteRow removes the row and reports it', () => {
  const db = setup();
  const row = addToCollection(db, base);
  assert.equal(deleteRow(db, row.id), true);
  assert.equal(deleteRow(db, row.id), false);
  assert.equal(listCollection(db).rows.length, 0);
});

test('invalid values throw RangeError', () => {
  const db = setup();
  assert.throws(() => addToCollection(db, { ...base, quantity: 0 }), RangeError);
  assert.throws(() => addToCollection(db, { ...base, quantity: -1 }), RangeError);
  assert.throws(() => addToCollection(db, { ...base, quantity: 1.5 }), RangeError);
  assert.throws(() => addToCollection(db, { ...base, condition: 'Parfait' }), RangeError);
  assert.throws(() => addToCollection(db, { ...base, variant: 'gold' }), RangeError);
  const row = addToCollection(db, base);
  assert.throws(() => updateRow(db, row.id, { quantity: 0 }), RangeError);
  assert.throws(() => updateRow(db, row.id, { condition: 'Parfait' }), RangeError);
});

test('totals multiply price by quantity and count unknown prices apart', () => {
  const db = setup();
  upsertCard(db, { ...fouinar, id: 'x-1', prices: { trend: null, trendHolo: null, low: null, lowHolo: null, avg30: null, avg30Holo: null, updatedAt: null } });
  addToCollection(db, { ...base, quantity: 10 });
  addToCollection(db, { cardId: 'sv03-125', lang: 'fr', variant: 'holo', condition: 'Mint' });
  addToCollection(db, { cardId: 'x-1', lang: 'fr', variant: 'normal', condition: 'Mint', quantity: 2 });
  const { totalCards, estimatedValue, unknownPriceCount } = listCollection(db);
  assert.equal(totalCards, 13);
  assert.equal(Math.round(estimatedValue * 100), 416);
  assert.equal(unknownPriceCount, 1);
});

test('the price metric setting changes prices', () => {
  const db = setup();
  addToCollection(db, base);
  setSetting(db, 'priceMetric', 'avg30');
  assert.equal(listCollection(db).rows[0].price, 0.06);
});

test('search ignores case and accents', () => {
  const db = setup();
  upsertCard(db, { ...fouinar, id: 'sm7.5-1', name: 'Salamèche' });
  addToCollection(db, { ...base, cardId: 'sm7.5-1' });
  addToCollection(db, base);
  assert.deepEqual(listCollection(db, { search: 'SALAMECHE' }).rows.map((r) => r.card.name), ['Salamèche']);
});

test('filters narrow rows while totals follow the filter', () => {
  const db = setup();
  addToCollection(db, base);
  addToCollection(db, { cardId: 'sv03-125', lang: 'fr', variant: 'holo', condition: 'Mint' });
  assert.equal(listCollection(db, { set: 'sv03' }).rows.length, 1);
  assert.equal(listCollection(db, { rarity: 'Peu Commune' }).rows[0].card.id, 'swsh3-136');
  const mint = listCollection(db, { condition: 'Mint' });
  assert.equal(mint.rows[0].card.id, 'sv03-125');
  assert.equal(mint.totalCards, 1);
});

test('sort by price puts unknown prices last', () => {
  const db = setup();
  upsertCard(db, { ...fouinar, id: 'x-1', name: 'Aaa', prices: { trend: null, trendHolo: null, low: null, lowHolo: null, avg30: null, avg30Holo: null, updatedAt: null } });
  addToCollection(db, { ...base, cardId: 'x-1' });
  addToCollection(db, base);
  addToCollection(db, { cardId: 'sv03-125', lang: 'fr', variant: 'holo', condition: 'Mint' });
  assert.deepEqual(listCollection(db, { sort: 'price' }).rows.map((r) => r.card.id), ['sv03-125', 'swsh3-136', 'x-1']);
});

test('sort by name orders alphabetically with French rules', () => {
  const db = setup();
  upsertCard(db, { ...fouinar, id: 'x-2', name: 'Évoli' });
  addToCollection(db, base);
  addToCollection(db, { ...base, cardId: 'x-2' });
  addToCollection(db, { cardId: 'sv03-125', lang: 'fr', variant: 'holo', condition: 'Mint' });
  assert.deepEqual(listCollection(db, { sort: 'name' }).rows.map((r) => r.card.name), ['Dracaufeu-ex', 'Évoli', 'Fouinar']);
});

test('rows carry card and price', () => {
  const db = setup();
  const row = addToCollection(db, { ...base, variant: 'reverse' });
  assert.equal(row.price, 0.23);
  assert.equal(row.card.name, 'Fouinar');
  assert.equal(row.variant, 'reverse');
});
