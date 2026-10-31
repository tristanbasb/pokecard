import { getScan, getSetting, updateScan, rowToCard } from './db.js';
import { priceFor } from './pricing.js';

export const CONDITIONS = ['Mint', 'Near Mint', 'Excellent', 'Good', 'Light Played', 'Played', 'Poor'];
export const VARIANTS = ['normal', 'holo', 'reverse', 'autre'];

const ROW_QUERY = `
  SELECT
    collection.id AS row_id, collection.variant, collection.condition, collection.quantity,
    collection.note, collection.photo_path, collection.added_at, cards.*
  FROM collection
  JOIN cards ON cards.id = collection.card_id AND cards.lang = collection.lang
`;

const folded = (text) => (text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function validate({ variant, condition, quantity }) {
  if (variant !== undefined && !VARIANTS.includes(variant)) throw new RangeError('Variante invalide');
  if (condition !== undefined && !CONDITIONS.includes(condition)) throw new RangeError('État invalide');
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) throw new RangeError('Quantité invalide');
}

function toRow(raw, metric) {
  const card = rowToCard(raw);
  return {
    id: raw.row_id,
    cardId: card.id,
    lang: card.lang,
    variant: raw.variant,
    condition: raw.condition,
    quantity: raw.quantity,
    note: raw.note,
    photoPath: raw.photo_path,
    addedAt: raw.added_at,
    card,
    price: priceFor(card, raw.variant, metric),
  };
}

const metricOf = (db) => getSetting(db, 'priceMetric', 'trend');

export function getRow(db, id) {
  const raw = db.prepare(`${ROW_QUERY} WHERE collection.id = ?`).get(id);
  return raw ? toRow(raw, metricOf(db)) : null;
}

export function addToCollection(db, {
  cardId, lang, variant, condition, quantity = 1, note = null, photoPath = null, scanId = null,
}) {
  validate({ variant, condition, quantity });
  return db.transaction(() => {
    const previous = scanId === null ? null : getScan(db, scanId)?.collectionId;
    const existing = previous ? getRow(db, previous) : null;
    if (existing) return existing;

    const { id } = db.prepare(`
      INSERT INTO collection (card_id, lang, variant, condition, quantity, note, photo_path, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (card_id, lang, variant, condition) DO UPDATE SET
        quantity = quantity + excluded.quantity,
        note = COALESCE(note, excluded.note),
        photo_path = COALESCE(photo_path, excluded.photo_path)
      RETURNING id
    `).get(cardId, lang, variant, condition, quantity, note, photoPath, new Date().toISOString());
    if (scanId !== null) updateScan(db, scanId, { collectionId: id });
    return getRow(db, id);
  })();
}

export function updateRow(db, id, patch) {
  validate(patch);
  return db.transaction(() => {
    const current = getRow(db, id);
    if (!current) return null;
    const next = { ...current, ...patch };
    const twin = db.prepare(`
      SELECT id FROM collection
      WHERE card_id = ? AND lang = ? AND variant = ? AND condition = ? AND id != ?
    `).get(current.cardId, current.lang, next.variant, next.condition, id);

    if (twin) {
      db.prepare(`
        UPDATE collection SET
          quantity = quantity + ?,
          note = COALESCE(note, ?),
          photo_path = COALESCE(photo_path, ?)
        WHERE id = ?
      `).run(next.quantity, next.note, next.photoPath, twin.id);
      db.prepare('UPDATE scans SET collection_id = ? WHERE collection_id = ?').run(twin.id, id);
      db.prepare('DELETE FROM collection WHERE id = ?').run(id);
      return getRow(db, twin.id);
    }

    db.prepare('UPDATE collection SET variant = ?, condition = ?, quantity = ?, note = ? WHERE id = ?')
      .run(next.variant, next.condition, next.quantity, next.note, id);
    return getRow(db, id);
  })();
}

export function deleteRow(db, id) {
  return db.prepare('DELETE FROM collection WHERE id = ?').run(id).changes > 0;
}

const collator = new Intl.Collator('fr', { sensitivity: 'base' });
const SORTS = {
  added: (a, b) => b.id - a.id,
  name: (a, b) => collator.compare(a.card.name, b.card.name),
  price: (a, b) => (b.price ?? -1) - (a.price ?? -1),
};

export function listCollection(db, {
  search, set, rarity, condition, sort = 'added',
} = {}) {
  const metric = metricOf(db);
  const needle = folded(search);
  const rows = db.prepare(ROW_QUERY).all()
    .map((raw) => toRow(raw, metric))
    .filter((row) => !needle || folded(row.card.name).includes(needle))
    .filter((row) => !set || row.card.setId === set)
    .filter((row) => !rarity || row.card.rarity === rarity)
    .filter((row) => !condition || row.condition === condition)
    .sort(SORTS[sort] ?? SORTS.added);

  return {
    rows,
    totalCards: rows.reduce((sum, row) => sum + row.quantity, 0),
    estimatedValue: rows.reduce((sum, row) => sum + (row.price ?? 0) * row.quantity, 0),
    unknownPriceCount: rows.filter((row) => row.price === null).length,
  };
}
