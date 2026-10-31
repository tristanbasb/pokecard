import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openDb, upsertCard, getCard, insertScan, updateScan, getScan, listScans, getSetting, setSetting,
} from '../src/db.js';
import { fouinar } from './helpers.js';

test('openDb can reopen an existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pokecard-'));
  const path = join(dir, 'test.sqlite');
  openDb(path).close();
  const db = openDb(path);
  db.close();
  rmSync(dir, { recursive: true });
});

test('a card reads back identical after upsert', () => {
  const db = openDb(':memory:');
  upsertCard(db, fouinar);
  assert.deepEqual(getCard(db, 'swsh3-136', 'fr'), fouinar);
});

test('same id in two languages stays two cards', () => {
  const db = openDb(':memory:');
  upsertCard(db, fouinar);
  upsertCard(db, { ...fouinar, lang: 'en', name: 'Furret' });
  assert.equal(getCard(db, 'swsh3-136', 'fr').name, 'Fouinar');
  assert.equal(getCard(db, 'swsh3-136', 'en').name, 'Furret');
});

test('a second upsert updates without duplicating', () => {
  const db = openDb(':memory:');
  upsertCard(db, fouinar);
  upsertCard(db, { ...fouinar, name: 'Renommée' });
  assert.equal(getCard(db, 'swsh3-136', 'fr').name, 'Renommée');
  assert.equal(db.prepare('select count(*) n from cards').get().n, 1);
});

test('getCard returns null for an unknown card', () => {
  assert.equal(getCard(openDb(':memory:'), 'nope', 'fr'), null);
});

test('settings fall back then persist', () => {
  const db = openDb(':memory:');
  assert.equal(getSetting(db, 'x', 'y'), 'y');
  setSetting(db, 'x', 'z');
  assert.equal(getSetting(db, 'x', 'y'), 'z');
});

test('updateScan keeps response json and tokens', () => {
  const db = openDb(':memory:');
  const id = insertScan(db, { photoPath: '1.jpg' });
  assert.equal(getScan(db, id).status, 'pending');
  updateScan(db, id, { status: 'done', response: { name: 'Fouinar' }, inputTokens: 12, outputTokens: 34 });
  const scan = getScan(db, id);
  assert.equal(scan.status, 'done');
  assert.deepEqual(scan.response, { name: 'Fouinar' });
  assert.equal(scan.inputTokens, 12);
  assert.equal(scan.outputTokens, 34);
  assert.equal(scan.photoPath, '1.jpg');
});

test('listScans filters by status', () => {
  const db = openDb(':memory:');
  const a = insertScan(db, { photoPath: 'a.jpg' });
  const b = insertScan(db, { photoPath: 'b.jpg' });
  updateScan(db, b, { status: 'done' });
  assert.deepEqual(listScans(db, 'pending').map((s) => s.id), [a]);
});
