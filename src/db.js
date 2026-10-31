import Database from 'better-sqlite3';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT NOT NULL,
    lang TEXT NOT NULL,
    name TEXT NOT NULL,
    set_id TEXT,
    set_name TEXT,
    number TEXT,
    printed_total INTEGER,
    rarity TEXT,
    image_url TEXT,
    price_trend REAL,
    price_trend_holo REAL,
    price_low REAL,
    price_low_holo REAL,
    price_avg30 REAL,
    price_avg30_holo REAL,
    price_updated_at TEXT,
    PRIMARY KEY (id, lang)
  );
  CREATE TABLE IF NOT EXISTS collection (
    id INTEGER PRIMARY KEY,
    card_id TEXT NOT NULL,
    lang TEXT NOT NULL,
    variant TEXT NOT NULL,
    condition TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    note TEXT,
    photo_path TEXT,
    added_at TEXT NOT NULL,
    UNIQUE (card_id, lang, variant, condition),
    FOREIGN KEY (card_id, lang) REFERENCES cards (id, lang)
  );
  CREATE TABLE IF NOT EXISTS price_history (
    card_id TEXT NOT NULL,
    lang TEXT NOT NULL,
    date TEXT NOT NULL,
    trend REAL,
    trend_holo REAL,
    PRIMARY KEY (card_id, lang, date),
    FOREIGN KEY (card_id, lang) REFERENCES cards (id, lang)
  );
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    photo_path TEXT,
    claude_response_json TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    status TEXT NOT NULL,
    collection_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`;

export function openDb(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function rowToCard(row) {
  return {
    id: row.id,
    lang: row.lang,
    name: row.name,
    setId: row.set_id,
    setName: row.set_name,
    number: row.number,
    printedTotal: row.printed_total,
    rarity: row.rarity,
    imageUrl: row.image_url,
    prices: {
      trend: row.price_trend,
      trendHolo: row.price_trend_holo,
      low: row.price_low,
      lowHolo: row.price_low_holo,
      avg30: row.price_avg30,
      avg30Holo: row.price_avg30_holo,
      updatedAt: row.price_updated_at,
    },
  };
}

export function upsertCard(db, card) {
  db.prepare(`
    INSERT INTO cards (id, lang, name, set_id, set_name, number, printed_total, rarity, image_url,
      price_trend, price_trend_holo, price_low, price_low_holo, price_avg30, price_avg30_holo, price_updated_at)
    VALUES (@id, @lang, @name, @setId, @setName, @number, @printedTotal, @rarity, @imageUrl,
      @trend, @trendHolo, @low, @lowHolo, @avg30, @avg30Holo, @updatedAt)
    ON CONFLICT (id, lang) DO UPDATE SET
      name = excluded.name, set_id = excluded.set_id, set_name = excluded.set_name,
      number = excluded.number, printed_total = excluded.printed_total, rarity = excluded.rarity,
      image_url = excluded.image_url, price_trend = excluded.price_trend,
      price_trend_holo = excluded.price_trend_holo, price_low = excluded.price_low,
      price_low_holo = excluded.price_low_holo, price_avg30 = excluded.price_avg30,
      price_avg30_holo = excluded.price_avg30_holo, price_updated_at = excluded.price_updated_at
  `).run({ ...card, ...card.prices });
}

export function getCard(db, id, lang) {
  const row = db.prepare('SELECT * FROM cards WHERE id = ? AND lang = ?').get(id, lang);
  return row ? rowToCard(row) : null;
}

function rowToScan(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    photoPath: row.photo_path,
    response: row.claude_response_json ? JSON.parse(row.claude_response_json) : null,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    status: row.status,
    collectionId: row.collection_id,
  };
}

export function insertScan(db, { photoPath }) {
  return Number(db.prepare(
    "INSERT INTO scans (created_at, photo_path, status) VALUES (?, ?, 'pending')",
  ).run(new Date().toISOString(), photoPath).lastInsertRowid);
}

export function updateScan(db, id, { status, photoPath, response, inputTokens, outputTokens, collectionId }) {
  db.prepare(`
    UPDATE scans SET
      status = COALESCE(@status, status),
      photo_path = COALESCE(@photoPath, photo_path),
      claude_response_json = COALESCE(@json, claude_response_json),
      input_tokens = COALESCE(@inputTokens, input_tokens),
      output_tokens = COALESCE(@outputTokens, output_tokens),
      collection_id = COALESCE(@collectionId, collection_id)
    WHERE id = @id
  `).run({
    id,
    status: status ?? null,
    photoPath: photoPath ?? null,
    json: response === undefined ? null : JSON.stringify(response),
    inputTokens: inputTokens ?? null,
    outputTokens: outputTokens ?? null,
    collectionId: collectionId ?? null,
  });
}

export function getScan(db, id) {
  const row = db.prepare('SELECT * FROM scans WHERE id = ?').get(id);
  return row ? rowToScan(row) : null;
}

export function listScans(db, status) {
  return db.prepare('SELECT * FROM scans WHERE status = ? ORDER BY id').all(status).map(rowToScan);
}

export function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
