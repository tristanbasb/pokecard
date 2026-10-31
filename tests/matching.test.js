import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNumber, pickCard, findCard } from '../src/matching.js';
import { fouinar, dracaufeuEx } from './helpers.js';

test('normalizeNumber handles the printed shapes', () => {
  const cases = {
    '025': '25',
    '025/165': '25',
    'TG12/TG30': 'TG12',
    tg12: 'TG12',
    SV107: 'SV107',
    GG05: 'GG5',
    SWSH001: 'SWSH1',
    0: '0',
    ' 136 / 189 ': '136',
    'H12': 'H12',
    '177a': '177A',
  };
  for (const [raw, expected] of Object.entries(cases)) assert.equal(normalizeNumber(raw), expected, raw);
  assert.equal(normalizeNumber(null), null);
  assert.equal(normalizeNumber(''), null);
});

const identified = (over = {}) => ({
  name: 'Fouinar', number: '136', printedTotal: 189, language: 'fr', confidence: 'high', ...over,
});

test('one candidate with high confidence is not ambiguous', () => {
  const result = pickCard(identified(), [fouinar]);
  assert.equal(result.card, fouinar);
  assert.equal(result.ambiguous, false);
  assert.deepEqual(result.alternatives, []);
});

test('two candidates are ambiguous', () => {
  const result = pickCard(identified({ printedTotal: null }), [fouinar, dracaufeuEx]);
  assert.equal(result.ambiguous, true);
  assert.equal(result.card, fouinar);
  assert.deepEqual(result.alternatives, [dracaufeuEx]);
});

test('printedTotal separates two reprints', () => {
  const reprint = { ...fouinar, id: 'other-136', printedTotal: 200 };
  const result = pickCard(identified(), [reprint, fouinar]);
  assert.equal(result.card, fouinar);
  assert.equal(result.ambiguous, false);
});

test('a printedTotal matching nobody eliminates nobody', () => {
  const result = pickCard(identified({ printedTotal: 999 }), [fouinar, dracaufeuEx]);
  assert.equal(result.alternatives.length, 1);
  assert.equal(result.ambiguous, true);
});

test('candidates without printedTotal are kept', () => {
  const noTotal = { ...fouinar, printedTotal: null };
  assert.equal(pickCard(identified(), [noTotal]).card, noTotal);
});

test('low confidence is ambiguous even with one candidate', () => {
  assert.equal(pickCard(identified({ confidence: 'low' }), [fouinar]).ambiguous, true);
});

test('no candidate gives no card and is ambiguous', () => {
  assert.deepEqual(pickCard(identified(), []), { card: null, alternatives: [], ambiguous: true });
});

function fakeTcgdex(briefs, cards = {}) {
  const searches = [];
  const details = [];
  return {
    searches,
    details,
    searchCards: async (query) => {
      searches.push(query);
      return briefs(query);
    },
    getCard: async (id, lang) => {
      details.push({ id, lang });
      return cards[id] ?? null;
    },
  };
}

test('findCard drops a contains-match on the number', async () => {
  const swsh = { ...fouinar, id: 'swsh4-25', number: '25', printedTotal: 185, name: 'Dracaufeu' };
  const tcgdex = fakeTcgdex(() => [
    { id: 'swsh4-25', localId: '25', name: 'Dracaufeu' },
    { id: 'me02-125', localId: '125', name: 'Méga-Dracaufeu X-ex' },
  ], { 'swsh4-25': swsh });
  const result = await findCard(identified({ name: 'Dracaufeu', number: '025', printedTotal: 185 }), tcgdex);
  assert.equal(result.card.id, 'swsh4-25');
  assert.equal(result.ambiguous, false);
  assert.deepEqual(tcgdex.details.map((d) => d.id), ['swsh4-25']);
});

test('findCard retries on the first word when the full name finds nothing', async () => {
  const tcgdex = fakeTcgdex(
    ({ name }) => (name === 'Dracaufeu' ? [{ id: 'sv03-125', localId: '125', name: 'Dracaufeu-ex' }] : []),
    { 'sv03-125': dracaufeuEx },
  );
  const result = await findCard(identified({ name: 'Dracaufeu ex', number: '125', printedTotal: 197 }), tcgdex);
  assert.equal(result.card.id, 'sv03-125');
  assert.deepEqual(tcgdex.searches.map((s) => s.name), ['Dracaufeu ex', 'Dracaufeu']);
});

test('findCard also cuts the first word on a hyphen', async () => {
  const tcgdex = fakeTcgdex(
    ({ name }) => (name === 'Dracaufeu' ? [{ id: 'sv03-125', localId: '125', name: 'Dracaufeu-ex' }] : []),
    { 'sv03-125': dracaufeuEx },
  );
  const result = await findCard(identified({ name: 'Dracaufeu-EX', number: '125', printedTotal: 197 }), tcgdex);
  assert.equal(result.card.id, 'sv03-125');
});

test('findCard without a matching number proposes at most 8 same-name cards', async () => {
  const briefs = Array.from({ length: 12 }, (_, i) => ({ id: `s-${i}`, localId: String(i), name: 'Pikachu' }));
  const cards = Object.fromEntries(briefs.map((b) => [b.id, { ...fouinar, id: b.id, number: b.localId }]));
  const tcgdex = fakeTcgdex(({ number }) => (number ? [] : briefs), cards);
  const result = await findCard(identified({ name: 'Pikachu', number: '999' }), tcgdex);
  assert.equal(result.ambiguous, true);
  assert.equal(result.alternatives.length + 1, 8);
  assert.equal(tcgdex.details.length, 8);
});

test('findCard with no number lists same-name cards as ambiguous', async () => {
  const tcgdex = fakeTcgdex(() => [{ id: 'swsh3-136', localId: '136', name: 'Fouinar' }], { 'swsh3-136': fouinar });
  const result = await findCard(identified({ number: null }), tcgdex);
  assert.equal(result.card.id, 'swsh3-136');
  assert.equal(result.ambiguous, true);
});

test('findCard searches an unsupported language in English', async () => {
  const tcgdex = fakeTcgdex(() => []);
  await findCard(identified({ language: 'ko' }), tcgdex);
  assert.ok(tcgdex.searches.every((s) => s.lang === 'en'));
});

test('findCard with no name finds nothing and does not search', async () => {
  const tcgdex = fakeTcgdex(() => []);
  const result = await findCard(identified({ name: null }), tcgdex);
  assert.equal(result.card, null);
  assert.equal(tcgdex.searches.length, 0);
});

test('findCard reads a padded tcgdex number', async () => {
  const card = { ...dracaufeuEx, number: '025' };
  const tcgdex = fakeTcgdex(() => [{ id: 'x', localId: '025', name: 'Dracaufeu' }], { x: card });
  const result = await findCard(identified({ name: 'Dracaufeu', number: '25', printedTotal: null }), tcgdex);
  assert.equal(result.card, card);
});

test('findCard finds a zero-padded prefixed number despite the substring filter', async () => {
  const target = { ...dracaufeuEx, id: 'swsh12pt5gg-TG03', number: 'TG03', printedTotal: 30 };
  const others = Array.from({ length: 12 }, (_, i) => ({ id: `s-${i}`, localId: String(i + 1), name: 'Dracaufeu' }));
  const all = [...others, { id: target.id, localId: 'TG03', name: 'Dracaufeu' }];
  const tcgdex = fakeTcgdex(
    ({ number }) => (number ? all.filter((card) => card.localId.includes(number)) : all),
    { [target.id]: target },
  );
  const result = await findCard(identified({ name: 'Dracaufeu', number: 'TG03', printedTotal: null }), tcgdex);
  assert.equal(result.card?.id, target.id);
  assert.equal(result.ambiguous, false);
});
